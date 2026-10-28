"""MLB: team stats from the MLB Stats API, Statcast team metrics from Baseball Savant.

  - Pythagorean record: exponent 1.83 on runs; luck = wins - Pythagorean wins
  - wOBA computed from counting stats with fixed linear weights (see WOBA below)
  - FIP computed with a league constant that makes league FIP equal league ERA
  - Splits: vs LHP / RHP, home / away (hitting); rotation / bullpen (pitching)
  - Statcast: barrel %, hard-hit %, xwOBA for the offense and allowed by the staff
  - Playoff odds: 10,000 simulations of the remaining regular season, Log5 on
    Pythagorean win % (blended toward .500 by 30 games) plus home field. Ties for a
    spot are broken by a coin flip (simplified).
"""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date

import numpy as np

from common import (SourceError, add_home_edge, get_csv_text, get_json, log5, now_iso, pythag, r, ranks,
                    read_json, season_file, season_year)

API = "https://statsapi.mlb.com/api/v1"
SAVANT = "https://baseballsavant.mlb.com"
PYTH_EXP = 1.83
SIMS = 10_000
# Linear weights for wOBA (FanGraphs-scale averages for recent seasons)
WOBA = {"ubb": 0.696, "hbp": 0.726, "1b": 0.883, "2b": 1.244, "3b": 1.569, "hr": 2.004}
LEAGUE_ABBR = {103: "AL", 104: "NL"}
DIVISIONS = {200: "AL West", 201: "AL East", 202: "AL Central", 203: "NL West", 204: "NL East", 205: "NL Central"}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def num(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def woba(s):
    singles = num(s.get("hits")) - num(s.get("doubles")) - num(s.get("triples")) - num(s.get("homeRuns"))
    ubb = num(s.get("baseOnBalls")) - num(s.get("intentionalWalks"))
    den = num(s.get("atBats")) + num(s.get("baseOnBalls")) - num(s.get("intentionalWalks")) + num(s.get("sacFlies")) + num(s.get("hitByPitch"))
    if den <= 0:
        return None
    return (WOBA["ubb"] * ubb + WOBA["hbp"] * num(s.get("hitByPitch")) + WOBA["1b"] * singles + WOBA["2b"] * num(s.get("doubles"))
            + WOBA["3b"] * num(s.get("triples")) + WOBA["hr"] * num(s.get("homeRuns"))) / den


def outs_of(s):
    o = s.get("outs") or s.get("outsPitched")
    if o is not None:
        return num(o)
    ip = str(s.get("inningsPitched") or "0")
    whole, _, frac = ip.partition(".")
    return num(whole) * 3 + num(frac or 0)


def team_stats(season, group, sit_codes=None):
    params = {"season": season, "group": group, "sportIds": 1, "limit": 200}
    if sit_codes:
        params.update({"stats": "statSplits", "sitCodes": sit_codes})
    else:
        params["stats"] = "season"
    data = get_json(f"{API}/teams/stats", params)
    out = defaultdict(dict)
    for sp in data["stats"][0]["splits"]:
        code = (sp.get("split") or {}).get("code", "season")
        out[str(sp["team"]["id"])][code] = sp["stat"]
    return out


def savant(season, kind, teams_by_name, teams_by_abbr):
    """kind: 'statcast' or 'expected_statistics'; returns {team_id: {'batter': row, 'pitcher': row}}."""
    out = defaultdict(dict)
    for who in ("batter", "pitcher"):
        extra = "&filterType=bip" if kind == "expected_statistics" else ""
        url = f"{SAVANT}/leaderboard/{kind}?type={who}-team&year={season}&position=&team=&min=0{extra}&csv=true"
        text = get_csv_text(url)
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows or "team" not in rows[0]:
            raise SourceError(f"Baseball Savant {kind} ({who}) returned no rows")
        for row in rows:
            tid = teams_by_name.get(row["team"]) or teams_by_abbr.get(row.get("team_id", ""))
            if tid:
                out[tid][who] = row
    return out


def compute(season: int, full: bool, log) -> dict:
    status = {}
    teams_raw = get_json(f"{API}/teams", {"sportId": 1, "season": season})["teams"]
    info = {str(t["id"]): t for t in teams_raw}
    by_name = {t["teamName"]: str(t["id"]) for t in teams_raw}
    by_abbr = {t["abbreviation"]: str(t["id"]) for t in teams_raw}
    by_abbr.update({"AZ": by_abbr.get("AZ") or by_abbr.get("ARI"), "ARI": by_abbr.get("ARI") or by_abbr.get("AZ"),
                    "OAK": by_abbr.get("ATH") or by_abbr.get("OAK"), "ATH": by_abbr.get("ATH") or by_abbr.get("OAK")})
    ids = sorted(info)

    # --- standings
    st = get_json(f"{API}/standings", {"leagueId": "103,104", "season": season, "standingsTypes": "regularSeason"})
    stand = {}
    for rec in st.get("records", []):
        for tr in rec.get("teamRecords", []):
            split = {s["type"]: f"{s['wins']}-{s['losses']}" for s in (tr.get("records") or {}).get("splitRecords", [])}
            stand[str(tr["team"]["id"])] = {"w": tr["wins"], "l": tr["losses"], "rs": tr.get("runsScored", 0), "ra": tr.get("runsAllowed", 0),
                                            "one_run": split.get("oneRun"), "extra": split.get("extraInning")}

    # --- schedule: finals for months, history and game logs; remaining games for the simulation
    sched = get_json(f"{API}/schedule", {"sportId": 1, "season": season, "gameType": "R",
                                          "fields": "dates,date,games,gamePk,status,abstractGameState,detailedState,teams,away,home,team,id,score,officialDate,doubleHeader,gameNumber"})
    finals, remaining, seen = [], [], set()
    for d in sched.get("dates", []):
        for g in d["games"]:
            if g["gamePk"] in seen:
                continue
            seen.add(g["gamePk"])
            a, h = str(g["teams"]["away"]["team"]["id"]), str(g["teams"]["home"]["team"]["id"])
            state = g["status"]["abstractGameState"]
            if state == "Final" and g["teams"]["home"].get("score") is not None and "Postponed" not in g["status"].get("detailedState", ""):
                finals.append((g.get("officialDate") or d["date"], h, a, g["teams"]["home"]["score"], g["teams"]["away"]["score"]))
            elif state != "Final" and "Postponed" not in g["status"].get("detailedState", "") and season == season_year("mlb"):
                remaining.append((h, a))
    finals.sort()

    months = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    glog = defaultdict(list)
    cum = defaultdict(lambda: [0, 0, 0, 0])  # w, l, rs, ra
    hist = defaultdict(list)
    labels = []

    def snapshot(label):
        labels.append(label)
        for t in ids:
            w, l, rs, ra = cum[t]
            hist[t].append([r(pythag(rs, ra, PYTH_EXP), 3) if rs + ra else None, r(w / (w + l), 3) if w + l else None])

    last_week = None
    for day, h, a, hs, as_ in finals:
        dd = date.fromisoformat(day)
        wk = dd.isocalendar()[:2]
        if last_week and wk != last_week:
            snapshot(prev_day_label)
        last_week = wk
        prev_day_label = f"{MONTHS[dd.month - 1]} {dd.day}"
        for me, opp, rs, ra in ((h, a, hs, as_), (a, h, as_, hs)):
            won = rs > ra
            months[me][MONTHS[dd.month - 1]][0 if won else 1] += 1
            c = cum[me]; c[0 if won else 1] += 1; c[2] += rs; c[3] += ra
            glog[me].append([day, opp, rs, ra])
    if finals:
        snapshot(prev_day_label)

    # --- team stats
    try:
        hit = team_stats(season, "hitting"); pit = team_stats(season, "pitching")
        hsplit = team_stats(season, "hitting", "vl,vr,h,a"); psplit = team_stats(season, "pitching", "sp,rp")
        status["statsapi"] = "ok"
    except SourceError as e:
        raise SourceError(f"MLB Stats API team stats: {e}")

    # League FIP constant
    tot = defaultdict(float)
    for t in ids:
        s = pit.get(t, {}).get("season", {})
        for k in ("earnedRuns", "homeRuns", "baseOnBalls", "hitByPitch", "strikeOuts"):
            tot[k] += num(s.get(k))
        tot["ip"] += outs_of(s) / 3
    c_fip = (9 * tot["earnedRuns"] / tot["ip"]) - (13 * tot["homeRuns"] + 3 * (tot["baseOnBalls"] + tot["hitByPitch"]) - 2 * tot["strikeOuts"]) / tot["ip"] if tot["ip"] else 3.1

    def fip(s):
        ip = outs_of(s) / 3
        return (13 * num(s.get("homeRuns")) + 3 * (num(s.get("baseOnBalls")) + num(s.get("hitByPitch"))) - 2 * num(s.get("strikeOuts"))) / ip + c_fip if ip else None

    def era(s):
        ip = outs_of(s) / 3
        return 9 * num(s.get("earnedRuns")) / ip if ip else None

    # --- Statcast
    sc = defaultdict(dict)
    try:
        for kind in ("statcast", "expected_statistics"):
            for tid, rows in savant(season, kind, by_name, by_abbr).items():
                for who, row in rows.items():
                    sc[tid][f"{kind}_{who}"] = row
        status["savant"] = "ok"
    except SourceError as e:
        status["savant"] = str(e)
        prev = read_json(season_file("mlb", season), {}) or {}
        for t in prev.get("teams", []):
            for k in ("brl", "hh", "xwoba", "brl_a", "hh_a", "xwoba_a"):
                if k in t["v"]:
                    sc[t["id"]].setdefault("_prev", {})[k] = t["v"][k]

    # --- playoff odds
    pyth = {t: pythag(stand.get(t, {}).get("rs", 0), stand.get(t, {}).get("ra", 0), PYTH_EXP) for t in ids}
    odds = simulate(ids, info, stand, pyth, remaining, log) if remaining else None

    out_teams = []
    for t in ids:
        s = stand.get(t, {"w": 0, "l": 0, "rs": 0, "ra": 0})
        gp = s["w"] + s["l"]
        h = hit.get(t, {}).get("season", {}); p = pit.get(t, {}).get("season", {})
        hs = hsplit.get(t, {}); ps = psplit.get(t, {})
        pa = num(h.get("plateAppearances")); bf = num(p.get("battersFaced")); ip = outs_of(p) / 3
        v = {
            "wins": s["w"], "losses": s["l"], "rd": s["rs"] - s["ra"],
            "rpg": r(s["rs"] / gp, 2) if gp else None, "rapg": r(s["ra"] / gp, 2) if gp else None,
            "pyth_w": r(pyth[t] * gp, 1), "pyth_l": r((1 - pyth[t]) * gp, 1), "luck": r(s["w"] - pyth[t] * gp, 1),
            "one_run": s.get("one_run"), "extra": s.get("extra"),
            "avg": r(num(h.get("avg"), None), 3), "obp": r(num(h.get("obp"), None), 3), "slg": r(num(h.get("slg"), None), 3),
            "ops": r(num(h.get("ops"), None), 3), "iso": r(num(h.get("slg"), 0) - num(h.get("avg"), 0), 3) if h else None,
            "babip": r(num(h.get("babip"), None), 3),
            "k_pct": r(num(h.get("strikeOuts")) / pa, 3) if pa else None, "bb_pct": r(num(h.get("baseOnBalls")) / pa, 3) if pa else None,
            "woba": r(woba(h), 3) if h else None,
            "woba_vl": r(woba(hs.get("vl", {})), 3) if hs.get("vl") else None, "woba_vr": r(woba(hs.get("vr", {})), 3) if hs.get("vr") else None,
            "ops_vl": r(num(hs.get("vl", {}).get("ops"), None), 3), "ops_vr": r(num(hs.get("vr", {}).get("ops"), None), 3),
            "ops_home": r(num(hs.get("h", {}).get("ops"), None), 3), "ops_away": r(num(hs.get("a", {}).get("ops"), None), 3),
            "era": r(era(p), 2) if p else None, "fip": r(fip(p), 2) if p else None, "whip": r(num(p.get("whip"), None), 2),
            "kbb_pct": r((num(p.get("strikeOuts")) - num(p.get("baseOnBalls"))) / bf, 3) if bf else None,
            "hr9": r(9 * num(p.get("homeRuns")) / ip, 2) if ip else None,
            "sp_era": r(era(ps["sp"]), 2) if ps.get("sp") else None, "rp_era": r(era(ps["rp"]), 2) if ps.get("rp") else None,
            "sp_fip": r(fip(ps["sp"]), 2) if ps.get("sp") else None, "rp_fip": r(fip(ps["rp"]), 2) if ps.get("rp") else None,
            "sp_ip": r(outs_of(ps["sp"]) / 3, 1) if ps.get("sp") else None, "rp_ip": r(outs_of(ps["rp"]) / 3, 1) if ps.get("rp") else None,
        }
        stc = sc.get(t, {})
        if "_prev" in stc:
            v.update(stc["_prev"])
        else:
            b, pp = stc.get("statcast_batter", {}), stc.get("statcast_pitcher", {})
            xb, xp = stc.get("expected_statistics_batter", {}), stc.get("expected_statistics_pitcher", {})
            pct = lambda x: r(num(x, None) / 100, 3) if num(x, None) is not None else None
            v.update({"brl": pct(b.get("brl_percent")), "hh": pct(b.get("ev95percent")), "xwoba": r(num(xb.get("est_woba"), None), 3),
                      "brl_a": pct(pp.get("brl_percent")), "hh_a": pct(pp.get("ev95percent")), "xwoba_a": r(num(xp.get("est_woba"), None), 3)})
        if odds:
            v.update(odds[t])
        ti = info[t]
        out_teams.append({
            "id": t, "abbr": ti["abbreviation"], "name": ti["teamName"],
            "lg": LEAGUE_ABBR.get(ti["league"]["id"]), "div": DIVISIONS.get(ti["division"]["id"]),
            "record": f"{s['w']}-{s['l']}", "v": v, "hist": hist.get(t, []),
            "months": [[m, f"{wl[0]}-{wl[1]}"] for m, wl in months[t].items()],
            "log": glog.get(t, []),
        })

    rank_rd = ranks({t["id"]: t["v"]["rd"] for t in out_teams})
    for t in out_teams:
        t["v"]["rd_rank"] = rank_rd.get(t["id"])
    out_teams.sort(key=lambda t: -(t["v"]["pyth_w"] or 0) / max(1, t["v"]["wins"] + t["v"]["losses"]))

    return {
        "league": "mlb", "season": season, "generatedAt": now_iso(),
        "final": season < season_year("mlb"),
        "asOf": labels[-1] if labels else "Preseason",
        "histKeys": ["pyth_pct", "win_pct"], "histLabels": labels,
        "fipConstant": r(c_fip, 3), "wobaWeights": WOBA,
        "teams": out_teams, "status": status,
    }


def simulate(ids, info, stand, pyth, remaining, log):
    idx = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    G = np.array([stand.get(t, {}).get("w", 0) + stand.get(t, {}).get("l", 0) for t in ids], dtype=float)
    W0 = np.array([stand.get(t, {}).get("w", 0) for t in ids], dtype=float)
    strength = {t: (pyth[t] * G[idx[t]] + 0.5 * 30) / (G[idx[t]] + 30) for t in ids}
    rng = np.random.default_rng(20261025)
    W = np.tile(W0, (SIMS, 1))
    Gt = G.copy()
    for h, a in remaining:
        if h not in idx or a not in idx:
            continue
        p = add_home_edge(log5(strength[h], strength[a]), 0.16)
        res = (rng.random(SIMS) < p).astype(float)
        W[:, idx[h]] += res; W[:, idx[a]] += 1 - res
        Gt[idx[h]] += 1; Gt[idx[a]] += 1
    pct = W / np.maximum(Gt, 1) + rng.random((SIMS, n)) * 1e-6
    div_of = {t: info[t]["division"]["id"] for t in ids}
    lg_of = {t: info[t]["league"]["id"] for t in ids}
    po = np.zeros(n); dv = np.zeros(n); bye = np.zeros(n)
    for s in range(SIMS):
        for lg in (103, 104):
            members = [t for t in ids if lg_of[t] == lg]
            winners = []
            for d in {div_of[t] for t in members}:
                winners.append(max((t for t in members if div_of[t] == d), key=lambda t: pct[s, idx[t]]))
            winners.sort(key=lambda t: pct[s, idx[t]], reverse=True)
            wc = sorted((t for t in members if t not in winners), key=lambda t: pct[s, idx[t]], reverse=True)[:3]
            for t in winners:
                po[idx[t]] += 1; dv[idx[t]] += 1
            for t in winners[:2]:
                bye[idx[t]] += 1
            for t in wc:
                po[idx[t]] += 1
    log(f"mlb: simulated {len(remaining)} remaining games x {SIMS:,}")
    return {t: {"po": r(100 * po[i] / SIMS, 1), "div": r(100 * dv[i] / SIMS, 1), "bye": r(100 * bye[i] / SIMS, 1)} for t, i in idx.items()}
