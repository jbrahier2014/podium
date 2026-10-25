"""NFL: ratings from game results (nflverse schedule) and efficiency from nflverse play-by-play.

  - SRS:         least squares on regular-season margins (no home field), centered on 0
  - Elo:         FiveThirtyEight-style, warmed up from 2019 and carried across seasons
  - Pythagorean: exponent 2.37 on points; luck = actual wins - Pythagorean wins
  - EPA, success rate, explosive plays, early-down pass rate, CPOE, 3rd down,
    red-zone TD rate, sacks, turnovers: aggregated from play-by-play (regular season)
  - Playoff odds: 10,000 simulations of the remaining schedule. Each game uses Log5 on
    Pythagorean win % (blended toward .500 by 4 games early on) plus home field.
    Seeding uses win %, then division (or conference) record, then a coin flip —
    a simplification of the NFL's full tiebreaker list.
"""
from __future__ import annotations

import io
import math
from collections import defaultdict

import numpy as np
import pandas as pd

from common import (Elo, SourceError, add_home_edge, http_get, least_squares_ratings, log5, now_iso,
                    pythag, r, ranks, read_json, season_file, season_year)

GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
PYTH_EXP = 2.37
SIMS = 10_000

ESPN_ID = {"ARI": "22", "ATL": "1", "BAL": "33", "BUF": "2", "CAR": "29", "CHI": "3", "CIN": "4", "CLE": "5", "DAL": "6",
           "DEN": "7", "DET": "8", "GB": "9", "HOU": "34", "IND": "11", "JAX": "30", "KC": "12", "LV": "13", "LAC": "24",
           "LA": "14", "MIA": "15", "MIN": "16", "NE": "17", "NO": "18", "NYG": "19", "NYJ": "20", "PHI": "21", "PIT": "23",
           "SF": "25", "SEA": "26", "TB": "27", "TEN": "10", "WAS": "28"}
ALIASES = {"OAK": "LV", "SD": "LAC", "STL": "LA", "LAR": "LA", "WSH": "WAS"}
DIVISION = {
    "AFC East": ["BUF", "MIA", "NE", "NYJ"], "AFC North": ["BAL", "CIN", "CLE", "PIT"],
    "AFC South": ["HOU", "IND", "JAX", "TEN"], "AFC West": ["DEN", "KC", "LV", "LAC"],
    "NFC East": ["DAL", "NYG", "PHI", "WAS"], "NFC North": ["CHI", "DET", "GB", "MIN"],
    "NFC South": ["ATL", "CAR", "NO", "TB"], "NFC West": ["ARI", "LA", "SF", "SEA"],
}
DIV_OF = {t: d for d, ts in DIVISION.items() for t in ts}
CONF_OF = {t: d[:3] for t, d in DIV_OF.items()}
TEAMS = sorted(DIV_OF)
POST_LABEL = {"WC": "Wild card", "DIV": "Divisional", "CON": "Conf champ", "SB": "Super Bowl"}

_games_cache = {}


def all_games() -> pd.DataFrame:
    if "df" not in _games_cache:
        df = pd.read_csv(io.BytesIO(http_get(GAMES_URL)))
        for c in ("away_team", "home_team"):
            df[c] = df[c].replace(ALIASES)
        _games_cache["df"] = df
    return _games_cache["df"]


def elo_through(df: pd.DataFrame, upto_season: int):
    """Run Elo from 2019 through the end of upto_season - 1; return the Elo object ready for upto_season."""
    elo = Elo(k=20, hfa=48, mean=1505, revert=1 / 3)
    for s in range(2019, upto_season):
        part = df[(df.season == s) & df.home_score.notna()].sort_values(["week", "gameday"])
        if s > 2019:
            elo.new_season()
        for g in part.itertuples():
            elo.update(g.home_team, g.away_team, g.home_score - g.away_score, g.location == "Neutral")
    if upto_season > 2019:
        elo.new_season()
    return elo


def pbp_aggregates(season: int, log):
    cols = ["season_type", "week", "game_id", "posteam", "defteam", "play_type", "pass", "rush", "epa", "success", "yards_gained",
            "down", "wp", "cpoe", "interception", "fumble_lost", "third_down_converted", "third_down_failed", "sack",
            "fixed_drive", "fixed_drive_result", "drive_inside20"]
    import pyarrow.parquet as pq
    raw = http_get(PBP_URL.format(season=season), timeout=180)
    have = set(pq.read_schema(io.BytesIO(raw)).names)
    df = pd.read_parquet(io.BytesIO(raw), columns=[c for c in cols if c in have])
    df = df[df.season_type == "REG"].copy()
    for c in ("posteam", "defteam"):
        df[c] = df[c].replace(ALIASES)
    log(f"nfl {season}: {len(df):,} regular-season plays")

    plays = df[df.play_type.isin(["pass", "run"]) & df.epa.notna() & ((df["pass"] == 1) | (df["rush"] == 1))].copy()
    plays["explosive"] = ((plays["rush"] == 1) & (plays.yards_gained >= 10)) | ((plays["pass"] == 1) & (plays.yards_gained >= 20))
    out = defaultdict(dict)

    def side(group_col, prefix):
        gb = plays.groupby(group_col)
        out_ = {
            f"{prefix}_epa": gb.epa.mean(), f"{prefix}_sr": gb.success.mean(), f"{prefix}_expl": gb.explosive.mean(),
            f"{prefix}_pass_epa": plays[plays["pass"] == 1].groupby(group_col).epa.mean(),
            f"{prefix}_rush_epa": plays[plays["rush"] == 1].groupby(group_col).epa.mean(),
            f"{prefix}_pass_sr": plays[plays["pass"] == 1].groupby(group_col).success.mean(),
            f"{prefix}_rush_sr": plays[plays["rush"] == 1].groupby(group_col).success.mean(),
        }
        for k, s in out_.items():
            for t, v in s.items():
                out[t][k] = r(v, 3)

    side("posteam", "o")
    side("defteam", "d")

    early = plays[plays.down.isin([1, 2]) & plays.wp.between(0.2, 0.8)]
    for t, v in early.groupby("posteam")["pass"].mean().items():
        out[t]["ed_pass"] = r(v, 3)
    if "cpoe" in plays:
        for t, v in plays[plays.cpoe.notna()].groupby("posteam").cpoe.mean().items():
            out[t]["cpoe"] = r(v, 2)

    give = df.groupby("posteam")[["interception", "fumble_lost"]].sum().sum(axis=1)
    take = df.groupby("defteam")[["interception", "fumble_lost"]].sum().sum(axis=1)
    for t in TEAMS:
        out[t]["to_margin"] = int(take.get(t, 0) - give.get(t, 0))
    third = df[(df.third_down_converted == 1) | (df.third_down_failed == 1)]
    for t, v in third.groupby("posteam").third_down_converted.mean().items():
        out[t]["o_3rd"] = r(v, 3)
    for t, v in third.groupby("defteam").third_down_converted.mean().items():
        out[t]["d_3rd"] = r(v, 3)
    for t, v in df.groupby("defteam").sack.sum().items():
        out[t]["sacks"] = int(v)
    for t, v in df.groupby("posteam").sack.sum().items():
        out[t]["sacks_allowed"] = int(v)

    if "drive_inside20" in df and "fixed_drive_result" in df:
        drives = df[df.posteam.notna()].groupby(["game_id", "posteam", "fixed_drive"]).agg(
            defteam=("defteam", "first"), inside=("drive_inside20", "max"), result=("fixed_drive_result", "first")).reset_index()
        rz = drives[drives.inside == 1]
        rz = rz.assign(td=rz.result == "Touchdown")
        for t, v in rz.groupby("posteam").td.mean().items():
            out[t]["o_rz"] = r(v, 3)
        for t, v in rz.groupby("defteam").td.mean().items():
            out[t]["d_rz"] = r(v, 3)

    # Per-game EPA log (for trend charts)
    glog = defaultdict(list)
    o = plays.groupby(["week", "game_id", "posteam"]).agg(epa=("epa", "mean"), opp=("defteam", "first")).reset_index()
    d = plays.groupby(["game_id", "defteam"]).epa.mean()
    for row in o.itertuples():
        glog[row.posteam].append([int(row.week), row.opp, r(row.epa, 3), r(d.get((row.game_id, row.posteam)), 3)])
    return out, glog


def simulate(season_df: pd.DataFrame, strength: dict, log):
    """Monte Carlo of the remaining regular season. Returns {abbr: {po, div, bye}} in %."""
    reg = season_df[season_df.game_type == "REG"]
    done = reg[reg.home_score.notna()]
    left = reg[reg.home_score.isna()]
    if left.empty:
        return None
    idx = {t: i for i, t in enumerate(TEAMS)}
    n = len(TEAMS)
    W = np.zeros(n); G = np.zeros(n); DW = np.zeros(n); DG = np.zeros(n); CW = np.zeros(n); CG = np.zeros(n)

    def add(h, a, res_h, wv, gv, dwv, dgv, cwv, cgv):
        hi, ai = idx[h], idx[a]
        wv[..., hi] += res_h; wv[..., ai] += 1 - res_h; gv[hi] += 1; gv[ai] += 1
        if DIV_OF[h] == DIV_OF[a]:
            dwv[..., hi] += res_h; dwv[..., ai] += 1 - res_h; dgv[hi] += 1; dgv[ai] += 1
        if CONF_OF[h] == CONF_OF[a]:
            cwv[..., hi] += res_h; cwv[..., ai] += 1 - res_h; cgv[hi] += 1; cgv[ai] += 1

    for g in done.itertuples():
        res = 1.0 if g.home_score > g.away_score else 0.0 if g.home_score < g.away_score else 0.5
        add(g.home_team, g.away_team, res, W, G, DW, DG, CW, CG)

    rng = np.random.default_rng(20261025)
    Ws = np.tile(W, (SIMS, 1)); DWs = np.tile(DW, (SIMS, 1)); CWs = np.tile(CW, (SIMS, 1))
    for g in left.itertuples():
        p = log5(strength[g.home_team], strength[g.away_team])
        if g.location != "Neutral":
            p = add_home_edge(p, 0.23)
        res = (rng.random(SIMS) < p).astype(float)
        add(g.home_team, g.away_team, res, Ws, G, DWs, DG, CWs, CG)

    pct = Ws / np.maximum(G, 1)
    dpct = DWs / np.maximum(DG, 1)
    cpct = CWs / np.maximum(CG, 1)
    noise = rng.random((SIMS, n)) * 1e-6
    po = np.zeros(n); dv = np.zeros(n); bye = np.zeros(n)
    for s in range(SIMS):
        for conf in ("AFC", "NFC"):
            winners = []
            for dname, ts in DIVISION.items():
                if not dname.startswith(conf):
                    continue
                best = max(ts, key=lambda t: (pct[s, idx[t]], dpct[s, idx[t]], noise[s, idx[t]]))
                winners.append(best)
            winners.sort(key=lambda t: (pct[s, idx[t]], cpct[s, idx[t]], noise[s, idx[t]]), reverse=True)
            others = [t for t in TEAMS if CONF_OF[t] == conf and t not in winners]
            others.sort(key=lambda t: (pct[s, idx[t]], cpct[s, idx[t]], noise[s, idx[t]]), reverse=True)
            for t in winners:
                po[idx[t]] += 1; dv[idx[t]] += 1
            bye[idx[winners[0]]] += 1
            for t in others[:3]:
                po[idx[t]] += 1
    log(f"nfl: simulated {len(left)} remaining games x {SIMS:,}")
    return {t: {"po": r(100 * po[i] / SIMS, 1), "div": r(100 * dv[i] / SIMS, 1), "bye": r(100 * bye[i] / SIMS, 1)} for t, i in idx.items()}


def compute(season: int, full: bool, log) -> dict:
    df = all_games()
    sdf = df[df.season == season].copy()
    if sdf.empty:
        raise SourceError(f"No {season} games in the nflverse schedule")
    sdf["week_key"] = sdf.week
    reg = sdf[sdf.game_type == "REG"]
    done_all = sdf[sdf.home_score.notna()].sort_values(["week", "gameday"])
    done_reg = done_all[done_all.game_type == "REG"]

    # --- weekly snapshots: SRS (regular season) and Elo (all games)
    elo = elo_through(df, season)
    hist = defaultdict(list)
    labels = []
    srs = {t: 0.0 for t in TEAMS}
    for wk in sorted(done_all.week.unique()):
        for g in done_all[done_all.week == wk].itertuples():
            elo.update(g.home_team, g.away_team, g.home_score - g.away_score, g.location == "Neutral")
        played = [(g.home_team, g.away_team, g.home_score - g.away_score, True) for g in done_reg[done_reg.week <= wk].itertuples()]
        if played:
            srs, _ = least_squares_ratings(played, TEAMS, hfa=False, ridge=0.3)
        gt = done_all[done_all.week == wk].game_type.iloc[0]
        labels.append(f"Wk {wk}" if gt == "REG" else POST_LABEL.get(gt, gt))
        for t in TEAMS:
            hist[t].append([r(srs[t], 2), r(elo.get(t), 0)])

    # --- records, points, Pythagorean
    rec = defaultdict(lambda: [0, 0, 0]); pts = defaultdict(lambda: [0, 0])
    for g in done_reg.itertuples():
        for me, opp, pf, pa in ((g.home_team, g.away_team, g.home_score, g.away_score), (g.away_team, g.home_team, g.away_score, g.home_score)):
            rec[me][0 if pf > pa else 1 if pf < pa else 2] += 1
            pts[me][0] += pf; pts[me][1] += pa
    games_played = {t: sum(rec[t]) for t in TEAMS}
    pyth = {t: pythag(pts[t][0], pts[t][1], PYTH_EXP) if games_played[t] else 0.5 for t in TEAMS}
    strength = {t: (pyth[t] * games_played[t] + 0.5 * 4) / (games_played[t] + 4) for t in TEAMS}

    # --- play-by-play efficiency (skip re-downloading finished past seasons)
    prev = read_json(season_file("nfl", season), {}) or {}
    status = {}
    try:
        eff, glog = pbp_aggregates(season, log)
        status["pbp"] = "ok"
    except SourceError as e:
        status["pbp"] = str(e)
        eff = {t["abbr"]: {k: v for k, v in t["v"].items() if k.startswith(("o_", "d_")) or k in ("ed_pass", "cpoe", "to_margin", "sacks", "sacks_allowed")} for t in prev.get("teams", [])}
        glog = {t["abbr"]: t.get("log", []) for t in prev.get("teams", [])}

    odds = None
    if season == season_year("nfl"):
        odds = simulate(sdf, strength, log)

    srs_rank = ranks(srs)
    teams = []
    for t in sorted(TEAMS, key=lambda t: -srs[t]):
        w, l, tie = rec[t]
        gp = games_played[t]
        v = {
            "srs": r(srs[t], 2), "srs_rank": srs_rank.get(t),
            "srs_chg": r(srs[t] - hist[t][-2][0], 2) if len(hist[t]) >= 2 else None,
            "elo": r(elo.get(t), 0), "wins": w, "losses": l, "ties": tie,
            "pd": int(pts[t][0] - pts[t][1]), "ppg": r(pts[t][0] / gp, 1) if gp else None, "papg": r(pts[t][1] / gp, 1) if gp else None,
            "pyth_w": r(pyth[t] * gp, 1) if gp else None, "luck": r(w + 0.5 * tie - pyth[t] * gp, 1) if gp else None,
        }
        v.update({k: val for k, val in eff.get(t, {}).items() if val is not None})
        if odds:
            v.update(odds[t])
        teams.append({"id": ESPN_ID[t], "abbr": t, "div": DIV_OF[t], "record": f"{w}-{l}" + (f"-{tie}" if tie else ""),
                      "v": v, "hist": hist.get(t, []), "log": glog.get(t, [])})

    return {
        "league": "nfl", "season": season, "generatedAt": now_iso(),
        "final": season < season_year("nfl"),
        "asOf": labels[-1] if labels else "Preseason",
        "hfa": 1.8, "sigma": 13.5,
        "histKeys": ["srs", "elo"], "histLabels": labels,
        "teams": teams, "status": status,
    }
