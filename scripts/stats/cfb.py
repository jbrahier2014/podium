"""College football (FBS): our power ratings plus CollegeFootballData advanced stats.

Ratings (computed here, every week of the season so movement can be charted):
  - Predictor: least squares on margins capped at 28, with a solved home-field edge.
               Early in a season it leans slightly on last season (a ridge "prior" worth
               about two games), which fades as games are played.
  - Elo:       FiveThirtyEight-style, carried across seasons with 1/3 reversion.
  - SRS:       least squares on raw margins, no home field (the classic definition).
All non-FBS opponents are pooled into one "FCS" team so those games still count.

From CollegeFootballData (key in the CFBD_API_KEY secret): advanced season stats,
SP+, season stats, drives (red zone), talent composite, returning production.
CFBD's free tier allows 1,000 calls a month, so light (game-day) runs only refresh
games and advanced stats; everything else refreshes nightly or weekly.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from common import (Elo, SourceError, get_json, least_squares_ratings, now_iso, r, ranks,
                    read_json, season_file, season_year, write_json)

API = "https://api.collegefootballdata.com"
CAP = 28          # Predictor margin cap
PRIOR_WEIGHT = 2  # ridge weight toward last season (about two games' worth)
PRIOR_SHRINK = 0.6
SIGMA = 15.0      # std dev of game margins around the Predictor line (for win probability)
FCS = "FCS"

calls = {"n": 0}


def cfbd(path, **params):
    key = os.environ.get("CFBD_API_KEY", "").strip()
    if not key:
        raise SourceError("CFBD_API_KEY secret is not set")
    calls["n"] += 1
    return get_json(f"{API}{path}", params, {"Authorization": f"Bearer {key}"})


def g(d, *names, default=None):
    """Read a field that may be camelCase (API v2) or snake_case (v1)."""
    for n in names:
        if isinstance(d, dict) and n in d and d[n] is not None:
            return d[n]
    return default


def fetch_games(season, include_post):
    games = cfbd("/games", year=season, seasonType="regular", classification="fbs", division="fbs")
    if include_post:
        try:
            games += cfbd("/games", year=season, seasonType="postseason", classification="fbs", division="fbs")
        except SourceError:
            pass
    return games


def compute(season: int, full: bool, log) -> dict:
    current = season_year("cfb")
    prev_out = read_json(season_file("cfb", season), {}) or {}
    last_season = read_json(season_file("cfb", season - 1), {}) or {}
    now = datetime.now(timezone.utc)
    include_post = season < current or now.month in (12, 1)

    raw = fetch_games(season, include_post)

    # --- teams and completed games
    fbs, names, conf = set(), {}, {}
    for x in raw:
        for side in ("home", "away"):
            tid = str(g(x, f"{side}Id", f"{side}_id"))
            names[tid] = g(x, f"{side}Team", f"{side}_team")
            if (g(x, f"{side}Classification", f"{side}_division") or "").lower() == "fbs":
                fbs.add(tid)
                conf[tid] = g(x, f"{side}Conference", f"{side}_conference")
    node = lambda t: t if t in fbs else FCS
    max_reg = max([g(x, "week") or 0 for x in raw if (g(x, "seasonType", "season_type") or "regular") == "regular"] or [0])

    games = []  # (week, home, away, home_margin, neutral, home_pts, away_pts)
    for x in raw:
        hp, ap = g(x, "homePoints", "home_points"), g(x, "awayPoints", "away_points")
        if hp is None or ap is None or not g(x, "completed", default=True):
            continue
        h, a = node(str(g(x, "homeId", "home_id"))), node(str(g(x, "awayId", "away_id")))
        if h == FCS and a == FCS:
            continue
        wk = g(x, "week") or 0
        if (g(x, "seasonType", "season_type") or "regular") != "regular":
            wk = max_reg + 1
        games.append((wk, h, a, hp - ap, bool(g(x, "neutralSite", "neutral_site")), hp, ap))
    games.sort(key=lambda z: z[0])
    nodes = sorted(fbs) + [FCS]
    weeks = sorted({z[0] for z in games})
    log(f"cfb {season}: {len(fbs)} FBS teams, {len(games)} completed games, weeks {weeks[:1]}..{weeks[-1:]}")

    # --- priors and Elo carried from last season
    last_pred = {t["id"]: t["v"].get("pred") for t in last_season.get("teams", []) if t["v"].get("pred") is not None}
    prior = {t: PRIOR_SHRINK * v for t, v in last_pred.items()}
    prior[FCS] = last_season.get("fcs_pred", -20.0) * PRIOR_SHRINK
    elo_start = {k: v for k, v in (last_season.get("elo_end") or {}).items()}
    elo = Elo(k=25, hfa=55, mean=1500, revert=1 / 3, start=elo_start)
    if elo_start:
        elo.r = dict(elo_start)
        elo.new_season()
    elo.start = {FCS: 1250}

    # --- weekly snapshots
    hist = defaultdict(list)
    labels = []
    snap = {}
    gi = 0
    for wk in weeks:
        while gi < len(games) and games[gi][0] <= wk:
            _, h, a, m, neu, *_ = games[gi]
            elo.update(h, a, m, neu)
            gi += 1
        played = [(h, a, m, neu) for w, h, a, m, neu, *_ in games if w <= wk]
        pred, hfa = least_squares_ratings(played, nodes, hfa=True, cap=CAP, ridge=PRIOR_WEIGHT, prior=prior, center_ids=sorted(fbs))
        srs, _ = least_squares_ratings(played, nodes, hfa=False, ridge=0.3, center_ids=sorted(fbs))
        snap = {"pred": pred, "srs": srs, "elo": {t: elo.get(t) for t in nodes}, "hfa": hfa}
        labels.append("Bowls" if wk > max_reg else f"Wk {wk}")
        for t in sorted(fbs):
            hist[t].append([r(pred[t], 2), r(elo.get(t), 0), r(srs[t], 2)])

    if not snap:  # no games yet this season: show last season's carryover
        pred = {t: prior.get(t, 0.0) for t in nodes}
        snap = {"pred": pred, "srs": {t: 0.0 for t in nodes}, "elo": {t: elo.get(t) for t in nodes}, "hfa": 2.5}

    pred = snap["pred"]
    fbs_pred = {t: pred[t] for t in fbs}
    pred_rank = ranks(fbs_pred)
    prev_rank = {}
    if len(next(iter(hist.values()), [])) >= 2:
        prev_rank = ranks({t: hist[t][-2][0] for t in fbs})

    # --- records, SOS, results vs Top 25 / Top 50 (by our Predictor)
    rec = defaultdict(lambda: [0, 0])
    pts = defaultdict(lambda: [0, 0, 0])  # pf, pa, games
    opps = defaultdict(list)
    vs = {25: defaultdict(lambda: [0, 0]), 50: defaultdict(lambda: [0, 0])}
    for _, h, a, m, _, hp, ap in games:
        for me, opp, mm, pf, pa in ((h, a, m, hp, ap), (a, h, -m, ap, hp)):
            if me == FCS:
                continue
            rec[me][0 if mm > 0 else 1] += 1 if mm != 0 else 0
            pts[me][0] += pf; pts[me][1] += pa; pts[me][2] += 1
            opps[me].append(opp)
            orank = pred_rank.get(opp)
            for n in (25, 50):
                if orank and orank <= n:
                    vs[n][me][0 if mm > 0 else 1] += 1
    sos = {t: (float(np.mean([pred[o] for o in opps[t]])) if opps[t] else None) for t in fbs}
    sos_rank = ranks(sos)

    # --- CollegeFootballData extras
    name_to_id = {v: k for k, v in names.items() if k in fbs}
    extra = defaultdict(dict)
    status = {}

    def keep_previous(keys):
        for t in prev_out.get("teams", []):
            for k in keys:
                if k in t["v"]:
                    extra[t["id"]][k] = t["v"][k]

    ADV_KEYS = ["o_epa", "d_epa", "o_sr", "d_sr", "o_expl", "d_expl", "o_ppo", "d_ppo", "o_havoc", "d_havoc", "o_line", "d_line",
                "o_stuff", "d_stuff", "o_pass_epa", "o_rush_epa", "d_pass_epa", "d_rush_epa", "o_pass_sr", "o_rush_sr", "d_pass_sr", "d_rush_sr", "o_fp", "d_fp"]
    try:
        for row in cfbd("/stats/season/advanced", year=season, excludeGarbageTime="true"):
            tid = name_to_id.get(row.get("team"))
            if not tid:
                continue
            for side, p in (("offense", "o"), ("defense", "d")):
                s = row.get(side) or {}
                fp = (s.get("fieldPosition") or {}).get("averageStart")
                extra[tid].update({
                    f"{p}_epa": r(s.get("ppa"), 3), f"{p}_sr": r(s.get("successRate"), 3), f"{p}_expl": r(s.get("explosiveness"), 3),
                    f"{p}_ppo": r(s.get("pointsPerOpportunity"), 2), f"{p}_havoc": r((s.get("havoc") or {}).get("total"), 3),
                    f"{p}_line": r(s.get("lineYards"), 2), f"{p}_stuff": r(s.get("stuffRate"), 3),
                    f"{p}_pass_epa": r((s.get("passingPlays") or {}).get("ppa"), 3), f"{p}_rush_epa": r((s.get("rushingPlays") or {}).get("ppa"), 3),
                    f"{p}_pass_sr": r((s.get("passingPlays") or {}).get("successRate"), 3), f"{p}_rush_sr": r((s.get("rushingPlays") or {}).get("successRate"), 3),
                    # Report as the yard line from the offense's own goal (own 25 = 25)
                    f"{p}_fp": r((100 - fp) if fp and fp > 50 else fp, 1),
                })
        status["advanced"] = "ok"
    except SourceError as e:
        status["advanced"] = str(e); keep_previous(ADV_KEYS)

    if full or season < season_year("cfb"):
        try:
            for row in cfbd("/ratings/sp", year=season):
                tid = name_to_id.get(row.get("team"))
                if tid:
                    extra[tid].update({"sp": r(row.get("rating"), 1), "sp_off": r((row.get("offense") or {}).get("rating"), 1),
                                       "sp_def": r((row.get("defense") or {}).get("rating"), 1)})
            status["sp"] = "ok"
        except SourceError as e:
            status["sp"] = str(e); keep_previous(["sp", "sp_off", "sp_def"])

        try:
            per = defaultdict(dict)
            for row in cfbd("/stats/season", year=season):
                tid = name_to_id.get(row.get("team"))
                if tid:
                    try:
                        per[tid][row["statName"]] = float(row["statValue"])
                    except (TypeError, ValueError):
                        pass
            stat_names = sorted({k for d in per.values() for k in d})
            for tid, s in per.items():
                def div(a, b):
                    return a / b if a is not None and b else None
                plays = (s.get("rushingAttempts") or 0) + (s.get("passAttempts") or 0)
                oplays = (s.get("rushingAttemptsOpponent") or 0) + (s.get("passAttemptsOpponent") or 0)
                if "turnoversOpponent" in s and "turnovers" in s:
                    tom = s["turnoversOpponent"] - s["turnovers"]
                else:
                    tom = (s.get("fumblesRecovered", 0) + s.get("passesIntercepted", 0)) - (s.get("fumblesLost", 0) + s.get("interceptions", 0))
                extra[tid].update({
                    "o_ypp": r(div(s.get("totalYards"), plays), 2), "d_ypp": r(div(s.get("totalYardsOpponent"), oplays), 2),
                    "to_margin": r(tom, 0), "o_3rd": r(div(s.get("thirdDownConversions"), s.get("thirdDowns")), 3),
                    "d_3rd": r(div(s.get("thirdDownConversionsOpponent"), s.get("thirdDownsOpponent")), 3),
                    "sacks": r(s.get("sacks"), 0), "sacks_allowed": r(s.get("sacksOpponent"), 0),
                })
            status["season_stats"] = "ok"
            status["season_stat_names"] = stat_names[:120]
        except SourceError as e:
            status["season_stats"] = str(e); keep_previous(["o_ypp", "d_ypp", "to_margin", "o_3rd", "d_3rd", "sacks", "sacks_allowed"])

        try:
            rz = defaultdict(lambda: [0, 0, 0, 0])  # off trips, off TDs, def trips, def TDs
            for d in cfbd("/drives", year=season):
                off, de = name_to_id.get(d.get("offense")), name_to_id.get(d.get("defense"))
                s_ytg, e_ytg = g(d, "startYardsToGoal", "start_yards_to_goal"), g(d, "endYardsToGoal", "end_yards_to_goal")
                gained = (g(d, "endOffenseScore", "end_offense_score") or 0) - (g(d, "startOffenseScore", "start_offense_score") or 0)
                td = gained >= 6
                reached = td or (s_ytg is not None and s_ytg <= 20) or (e_ytg is not None and e_ytg <= 20)
                if not reached:
                    continue
                if off:
                    rz[off][0] += 1; rz[off][1] += td
                if de:
                    rz[de][2] += 1; rz[de][3] += td
            for tid, (ot, otd, dt, dtd) in rz.items():
                extra[tid].update({"o_rz": r(otd / ot, 3) if ot else None, "d_rz": r(dtd / dt, 3) if dt else None})
            status["drives"] = "ok"
        except SourceError as e:
            status["drives"] = str(e); keep_previous(["o_rz", "d_rz"])

        # Talent and returning production change once a year: refresh weekly at most
        fetched = prev_out.get("fetched", {})
        stale = lambda k: season < season_year("cfb") or not fetched.get(k) or (datetime.now(timezone.utc) - datetime.fromisoformat(fetched[k].replace("Z", "+00:00"))).days >= 7
        if stale("talent"):
            try:
                for row in cfbd("/talent", year=season):
                    tid = name_to_id.get(row.get("team") or row.get("school"))
                    if tid:
                        extra[tid]["talent"] = r(row.get("talent"), 1)
                fetched["talent"] = now_iso(); status["talent"] = "ok"
            except SourceError as e:
                status["talent"] = str(e); keep_previous(["talent"])
        else:
            keep_previous(["talent"])
        if stale("returning"):
            try:
                for row in cfbd("/player/returning", year=season):
                    tid = name_to_id.get(row.get("team"))
                    if tid:
                        extra[tid].update({"ret_ppa": r(row.get("percentPPA"), 3), "ret_usage": r(row.get("usage"), 3)})
                fetched["returning"] = now_iso(); status["returning"] = "ok"
            except SourceError as e:
                status["returning"] = str(e); keep_previous(["ret_ppa", "ret_usage"])
        else:
            keep_previous(["ret_ppa", "ret_usage"])
    else:
        fetched = prev_out.get("fetched", {})
        keep_previous(["sp", "sp_off", "sp_def", "o_ypp", "d_ypp", "to_margin", "o_3rd", "d_3rd", "sacks", "sacks_allowed",
                       "o_rz", "d_rz", "talent", "ret_ppa", "ret_usage"])

    # --- assemble
    teams = []
    for t in sorted(fbs, key=lambda t: -pred[t]):
        w, l = rec[t]
        pf, pa, gp = pts[t]
        v = {
            "pred": r(pred[t], 2), "pred_rank": pred_rank.get(t),
            "pred_chg": r(pred[t] - hist[t][-2][0], 2) if len(hist[t]) >= 2 else None,
            "rank_chg": (prev_rank[t] - pred_rank[t]) if t in prev_rank else None,
            "elo": r(snap["elo"][t], 0), "srs": r(snap["srs"][t], 2),
            "sos": r(sos[t], 2), "sos_rank": sos_rank.get(t),
            "top25": f"{vs[25][t][0]}-{vs[25][t][1]}", "top50": f"{vs[50][t][0]}-{vs[50][t][1]}",
            "wins": w, "losses": l, "ppg": r(pf / gp, 1) if gp else None, "papg": r(pa / gp, 1) if gp else None,
            "pd": pf - pa,
        }
        v.update({k: val for k, val in extra.get(t, {}).items() if val is not None})
        teams.append({"id": t, "name": names.get(t), "conf": conf.get(t), "record": f"{w}-{l}", "v": v, "hist": hist.get(t, [])})

    return {
        "league": "cfb", "season": season, "generatedAt": now_iso(),
        "final": season < season_year("cfb"),
        "asOf": labels[-1] if labels else "Preseason",
        "hfa": r(snap["hfa"], 2), "sigma": SIGMA,
        "histKeys": ["pred", "elo", "srs"], "histLabels": labels,
        "teams": teams,
        "fcs_pred": r(pred.get(FCS), 2),
        "elo_end": {t: r(v, 1) for t, v in elo.r.items()},
        "fetched": fetched, "status": status,
    }
