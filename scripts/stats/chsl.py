"""Catholic High School League (Detroit area + Toledo): football and boys basketball.

Writes data/chsl/<sport>-<year>.json  (sport: fb | bb; year: the school year it starts in,
so bb-2026 is the 2026-27 basketball season).

Sources
  MHSAA team schedules: the public JSON behind each team page on mhsaa.com
    (my.mhsaa.com .../SportTeamInfo/GetTeamSchedule). Every CHSL school has one, the
    Toledo schools included. It gives each game, score, league-game flag, postseason
    info, the team's CHSL division and that division's standings.
  St. John's Jesuit's athletics site (sjjtitans.com, SIDEARM): its plain-text schedule
    fills in the Ohio games MHSAA doesn't have (Ohio playoffs, some non-league games).

Teams are found by starting from Divine Child and St. John's Jesuit and following
opponents: any team whose MHSAA league is the Catholic High School League is in.
That crawl runs weekly (or when there's no saved list); other runs reuse the list.

Computed here
  records (overall, home / away / neutral, points), division standings (MHSAA's league
  records, in MHSAA's order), a power rating (least squares on capped margins with a
  solved home edge, the same method as the college Predictor), CHSL ranks, and
  predicted margins / win chances for upcoming games between CHSL teams.

Permission: MHSAA's and SIDEARM's terms limit their content to personal viewing, so
this step only runs when ENABLED is True (John turned it on Nov 8, 2026).
"""
from __future__ import annotations

import io
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from common import DATA, UA, SourceError, get_json, http_get, least_squares_ratings, norm_cdf, now_iso, r, ranks, read_json, write_json

# Switched on once MHSAA and St. John's Jesuit have given permission (see the module notes)
ENABLED = True  # John confirmed, Nov 8 2026

API = "https://my.mhsaa.com/DesktopModules/MHSAA-Endpoint/"
EASTERN = ZoneInfo("America/Detroit")
SEEDS = ["divinechild", "toledo-st-johns-jesuit-oh"]
SJJ = "toledo-st-johns-jesuit-oh"
SJJ_SITE = "https://sjjtitans.com"

SPORTS = {
    "fb": {"code": "FB", "name": "Football", "page": "football", "cap": 28, "sigma": 14.0, "ridge": 0.6, "hfa_max": 5.0,
           "start": (8, 1), "end": (12, 5)},
    "bb": {"code": "BB", "name": "Basketball", "page": "mens-basketball", "cap": 25, "sigma": 10.5, "ridge": 0.6, "hfa_max": 5.0,
           "start": (11, 15), "end": (3, 31)},
}

# Short names and abbreviations (MHSAA's short names are blank for the Toledo schools
# and clipped for others). Unknown teams fall back to MHSAA's names.
SHORT = {
    "toledo-st-johns-jesuit-oh": ("St. John's Jesuit", "SJJ"), "divinechild": ("Divine Child", "DC"),
    "toledo-central-catholic-oh": ("Toledo Central Catholic", "TCC"), "toledo-st-francis-de-sales-oh": ("St. Francis", "SFS"),
    "detroitcatholiccentral": ("Catholic Central", "DCC"), "delasalle": ("De La Salle", "DLS"), "olsm": ("St. Mary's Prep", "OLSM"),
    "brotherrice": ("Brother Rice", "BR"), "udj": ("U of D Jesuit", "UDJ"), "dcds": ("Country Day", "DCDS"),
    "lumenchristi": ("Lumen Christi", "LC"), "fathergabrielrichard": ("Fr. Gabriel Richard", "FGR"),
    "gabrielrichard": ("Gabriel Richard", "GR"), "cranbrook": ("Cranbrook", "CRAN"), "loyola": ("Loyola", "LOY"),
    "liggett": ("Liggett", "ULS"), "everest": ("Everest", "EVER"), "oll": ("Our Lady of the Lakes", "OLL"),
    "cardinalmooney": ("Cardinal Mooney", "CM"), "bishopfoley": ("Bishop Foley", "BF"), "cabrini": ("Cabrini", "CAB"),
    "shrinecatholic": ("Shrine", "SHR"), "lutherannorth": ("Lutheran North", "LN"), "greenhills": ("Greenhills", "GH"),
    "fja": ("Frankel Jewish Academy", "FJA"), "austincatholic": ("Austin Catholic", "AC"), "cristorey": ("Cristo Rey", "CR"),
}
# St. John's Jesuit's site names opponents its own way
SJJ_ALIASES = {
    "st marys prep": "olsm", "orchard lake st marys": "olsm", "university of detroit jesuit": "udj", "u of d jesuit": "udj",
    "detroit catholic central": "detroitcatholiccentral", "catholic central": "detroitcatholiccentral",
    "central catholic": "toledo-central-catholic-oh", "st francis": "toledo-st-francis-de-sales-oh",
    "de la salle collegiate": "delasalle", "de la salle": "delasalle", "brother rice": "brotherrice", "divine child": "divinechild",
    "lumen christi": "lumenchristi", "country day": "dcds", "detroit country day": "dcds",
}
DIVISION_ORDER = ["Central", "AA", "A", "B", "C", "Intersectional 1", "Intersectional 2"]

calls = {"n": 0}


# ---------------------------------------------------------------- seasons

def school_year(d: date | None = None) -> int:
    d = d or datetime.now(EASTERN).date()
    return d.year if d.month >= 7 else d.year - 1


def season_label(sport: str, year: int) -> str:
    return str(year) if sport == "fb" else f"{year}-{str(year + 1)[-2:]}"


def season_over(sport: str, year: int, today: date | None = None) -> bool:
    today = today or datetime.now(EASTERN).date()
    m, d = SPORTS[sport]["end"]
    end = date(year + (1 if m < 7 else 0), m, d)
    return today > end


def in_season(sport: str, today: date | None = None) -> bool:
    today = today or datetime.now(EASTERN).date()
    y = school_year(today)
    sm, sd = SPORTS[sport]["start"]
    em, ed = SPORTS[sport]["end"]
    start = date(y + (1 if sm < 7 else 0), sm, sd) - timedelta(days=14)
    end = date(y + (1 if em < 7 else 0), em, ed)
    return start <= today <= end


# ---------------------------------------------------------------- sources

def mhsaa_org(vanity: str) -> int | None:
    calls["n"] += 1
    raw = http_get(f"{API}handlers/schoolteaminfo.ashx?method=getschoolidfromvanityurl&vanityUrl={vanity}").decode().strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


def mhsaa_schedule(org: int, sport: str, year: int):
    calls["n"] += 1
    return get_json(f"{API}API/SportTeamInfo/GetTeamSchedule",
                    {"orgId": org, "sportTypeCode": SPORTS[sport]["code"], "gender": "M", "level": "V", "year": year})


def sjj_pages(sport: str, year: int) -> tuple[str, str]:
    """St. John's Jesuit's schedule page (HTML, for logos) and plain-text schedule ('' if not posted)."""
    page = http_get(f"{SJJ_SITE}/sports/{SPORTS[sport]['page']}/schedule/{season_label(sport, year)}").decode("utf-8", "ignore")
    m = re.search(r"schedule_txt\.ashx\?schedule=(\d+)", page)
    if not m:
        return page, ""
    return page, http_get(f"{SJJ_SITE}/services/schedule_txt.ashx?schedule={m.group(1)}").decode("utf-8", "ignore")


def is_chsl(league: dict | None) -> bool:
    return bool(league) and "catholic high school league" in (league.get("Name") or "").lower()


def vanity_of(url: str | None) -> str | None:
    parts = (url or "").split("/")
    return parts[2] if len(parts) > 2 and parts[1] == "schools" else None


def discover(sport: str, year: int, known: dict, not_chsl: set, log):
    """Crawl from the seeds through opponents. Returns ({vanity: (org, schedule_json)}, orgs, not_chsl)."""
    found, queue, done = {}, list(SEEDS), set()
    orgs = dict(known)
    while queue:
        v = queue.pop(0)
        if v in done or v in not_chsl:
            continue
        done.add(v)
        try:
            org = orgs.get(v) or mhsaa_org(v)
            if not org:
                not_chsl.add(v)
                continue
            orgs[v] = org
            j = mhsaa_schedule(org, sport, year)
        except SourceError as e:
            log(f"chsl: {v}: {e}")
            continue
        if not is_chsl((j or {}).get("League")):
            not_chsl.add(v)
            continue
        found[v] = (org, j)
        for s in j.get("LeagueStandings") or []:
            sv = vanity_of(s.get("TeamUrl"))
            if sv and sv not in done:
                queue.insert(0, sv)
        for c in j.get("Contests") or []:
            for o in c.get("Opponents") or []:
                ov = vanity_of(o.get("ScheduleUrl"))
                if ov and ov not in done and ov not in not_chsl:
                    queue.append(ov)
        time.sleep(0.15)
    return found, orgs, not_chsl


# ---------------------------------------------------------------- parsing

SCORE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*(.*)$")


def parse_score(text: str | None):
    """'27-6' -> (27, 6, ''), '31-25 (OT)' -> (31, 25, 'OT'), '1-0 Forfeit' -> (1, 0, 'Forfeit')."""
    m = SCORE.match(text or "")
    if not m:
        return None
    extra = m.group(3).strip().strip("()")
    return int(m.group(1)), int(m.group(2)), extra


def to_iso(start: str | None) -> tuple[str | None, bool]:
    """MHSAA local time '2026-10-02T19:00:00' -> ISO with the Eastern offset; (iso, time_tbd)."""
    if not start:
        return None, True
    dt = datetime.fromisoformat(start[:19]).replace(tzinfo=EASTERN)
    tbd = dt.hour == 0 and dt.minute <= 1
    if tbd:
        dt = dt.replace(hour=19, minute=0)  # unknown time: assume a night game for sorting
    return dt.isoformat(), tbd


def norm(s: str) -> str:
    s = re.sub(r"\(.*?\)", " ", s.lower()).replace("saint", "st").replace("’", "'")
    s = re.sub(r"[^a-z0-9 ]", "", s.replace("'", ""))
    return re.sub(r"\s+", " ", s).strip()


def parse_sidearm_text(text: str, sport: str, year: int):
    """Rows of a SIDEARM text schedule: [{day, time, at, opponent, location, tournament, result}]."""
    lines = [ln.rstrip("\r") for ln in text.split("\n")]
    head_i = next((i for i, ln in enumerate(lines) if ln.startswith("Date") and "Opponent" in ln), None)
    if head_i is None:
        return []
    head = lines[head_i]
    cols = ["Date", "Time", "At", "Opponent", "Location", "Tournament", "Result"]
    pos = [head.find(c) for c in cols]
    rows = []
    for ln in lines[head_i + 1:]:
        if not ln.strip():
            continue
        cell = lambda k: ln[pos[k]:pos[k + 1] if k + 1 < len(pos) and pos[k + 1] > 0 else None].strip() if pos[k] >= 0 else ""
        dm = re.match(r"([A-Z][a-z]{2})\s+(\d{1,2})", cell(0))
        if not dm:
            continue
        mon = datetime.strptime(dm.group(1), "%b").month
        yr = year if mon >= 7 else year + 1
        res = re.search(r"\b([WLT])\s+(\d+)-(\d+)(?:\s*\(?(\d*OT)\)?)?\s*$", ln)
        rows.append({
            "day": date(yr, mon, int(dm.group(2))).isoformat(), "time": cell(1), "at": cell(2).lower(),
            "opponent": cell(3), "location": cell(4), "tournament": cell(5),
            "result": (res.group(1), int(res.group(2)), int(res.group(3)), res.group(4) or "") if res else None,
        })
    return rows


# ---------------------------------------------------------------- build

def team_names(v: str, j: dict | None):
    rec = (j or {}).get("Record") or {}
    name = (rec.get("PopularName") or v).replace(" (OH)", "")
    short, abbr = SHORT.get(v, (None, None))
    short = short or rec.get("SchoolShortName") or name
    abbr = abbr or "".join(w[0] for w in re.findall(r"[A-Za-z]+", short) if w[0].isupper())[:4] or short[:3].upper()
    return name, short, abbr


def division_name(league: dict | None) -> str:
    n = (league or {}).get("Name") or ""
    n = re.sub(r"(?i)^catholic high school league\s*[-–]?\s*", "", n).strip()
    n = n.replace("#", "").strip()
    return n or "CHSL"


def build(sport: str, year: int, found: dict, sjj_rows: list, now: datetime):
    cfg = SPORTS[sport]
    teams, games = {}, {}
    standings = {}
    for v, (org, j) in found.items():
        name, short, abbr = team_names(v, j)
        div = division_name(j.get("League"))
        teams[v] = {"id": v, "org": org, "name": name, "short": short, "abbr": abbr, "division": div,
                    "page": f"https://www.mhsaa.com/schools/{v}/boys/varsity/{'football' if sport == 'fb' else 'basketball'}/{year}"}
        if div not in standings and j.get("LeagueStandings"):
            standings[div] = [(vanity_of(s.get("TeamUrl")), s.get("ConfrenceNumberOfWins") or 0, s.get("ConfrenceNumberOfLosses") or 0,
                               s.get("ConfrenceNumberOfTies") or 0) for s in j["LeagueStandings"]]

    def side(v, name):
        return {"id": v if v in teams else None, "name": teams[v]["short"] if v in teams else (name or v or "TBA").replace(" (OH)", ""),
                "score": None}

    for v, (org, j) in found.items():
        for c in j.get("Contests") or []:
            ctype = c.get("ContestType")
            if ctype not in (1, 3):
                continue
            opp = (c.get("Opponents") or [{}])[0]
            ov = vanity_of(opp.get("ScheduleUrl"))
            start, tbd = to_iso(c.get("StartDate"))
            if not start:
                continue
            ha = (c.get("HomeAwayCode") or "").strip().upper()
            me, them = side(v, None), side(ov, opp.get("PopularName"))
            if not them["id"] and ov:
                them["key"] = ov
            sc = parse_score(c.get("ScoreText"))
            extra = ""
            if sc:
                me["score"], them["score"], extra = sc
            home, away = (them, me) if ha == "A" else (me, them)
            gid = str(c.get("SportContestId"))
            g = {
                "id": gid, "start": start, "day": start[:10], "tbd": tbd, "neutral": ha not in ("H", "A"),
                "home": home, "away": away, "league": bool(c.get("IsLeagueGame")), "post": bool(c.get("IsPostSeasonContest")),
                "note": (c.get("TournamentName") or c.get("PostSeasonInfo") or "").strip() or None,
                "scrimmage": ctype == 3, "forfeit": "forfeit" in extra.lower(), "ot": extra.upper() if "OT" in extra.upper() else None,
            }
            have = games.get(gid)
            if have:
                # Same game from the other team's schedule: fill in what's missing
                if have["home"]["score"] is None and g["home"]["score"] is not None:
                    have["home"]["score"], have["away"]["score"] = (g["home"]["score"], g["away"]["score"]) \
                        if have["home"]["id"] == g["home"]["id"] else (g["away"]["score"], g["home"]["score"])
                have["league"] = have["league"] or g["league"]
                continue
            games[gid] = g

    sources = {"mhsaa": "ok"}
    if sjj_rows:
        merge_sjj(games, teams, sjj_rows, now)
        sources["sjj"] = "ok"

    # Status
    for g in games.values():
        done = g["home"]["score"] is not None and g["away"]["score"] is not None
        g["state"] = "post" if done else ("pre" if datetime.fromisoformat(g["start"]) > now - timedelta(hours=5) else "noscore")

    out_games = sorted(games.values(), key=lambda g: (g["start"], g["id"]))
    played = [g for g in out_games if g["state"] == "post" and not g["scrimmage"]]

    # Records
    for t in teams.values():
        rec = {k: [0, 0, 0] for k in ("all", "home", "away", "neutral", "league")}
        pf = pa = n_pts = 0
        results = []
        for g in played:
            mine = "home" if g["home"]["id"] == t["id"] else "away" if g["away"]["id"] == t["id"] else None
            if not mine:
                continue
            me, op = g[mine], g["away" if mine == "home" else "home"]
            i = 0 if me["score"] > op["score"] else 1 if me["score"] < op["score"] else 2
            where = "neutral" if g["neutral"] else mine
            for k in ("all", where) + (("league",) if g["league"] else ()):
                rec[k][i] += 1
            results.append("WLT"[i])
            if not g["forfeit"]:
                pf += me["score"]; pa += op["score"]; n_pts += 1
        fmt = lambda x: f"{x[0]}-{x[1]}" + (f"-{x[2]}" if x[2] else "")
        streak = ""
        if results:
            k = 1
            while k < len(results) and results[-k - 1] == results[-1]:
                k += 1
            streak = f"{results[-1]}{k}"
        t.update({"record": fmt(rec["all"]), "wins": rec["all"][0], "losses": rec["all"][1], "ties": rec["all"][2],
                  "home": fmt(rec["home"]), "away": fmt(rec["away"]), "neutral": fmt(rec["neutral"]),
                  "ppg": r(pf / n_pts, 1) if n_pts else None, "papg": r(pa / n_pts, 1) if n_pts else None,
                  "pd": pf - pa, "streak": streak, "leagueGames": fmt(rec["league"])})

    # Division standings: MHSAA's league records and order
    divisions = []
    for div, rows in standings.items():
        rows = [x for x in rows if x[0] in teams]
        for v, w, l, tie in rows:
            teams[v]["conf"] = f"{w}-{l}" + (f"-{tie}" if tie else "")
            teams[v]["confWins"], teams[v]["confLosses"] = w, l
        divisions.append({"name": div, "teams": [x[0] for x in rows]})
    for v, t in teams.items():  # anyone MHSAA left out of a standings list
        if not any(v in d["teams"] for d in divisions):
            d = next((d for d in divisions if d["name"] == t["division"]), None)
            if not d:
                d = {"name": t["division"], "teams": []}
                divisions.append(d)
            d["teams"].append(v)
            t.setdefault("conf", t["leagueGames"])
    order = {n: i for i, n in enumerate(DIVISION_ORDER)}
    divisions.sort(key=lambda d: (order.get(d["name"], 50), d["name"]))

    # Power rating: CHSL teams plus every opponent they played (non-CHSL opponents
    # have few games, so the ridge keeps them near average)
    node = lambda s: s["id"] or f"x:{s.get('key') or norm(s['name'])}"
    rated = [(node(g["home"]), node(g["away"]), g["home"]["score"] - g["away"]["score"], g["neutral"]) for g in played if not g["forfeit"]]
    nodes = sorted({x for h, a, _, _ in rated for x in (h, a)} | set(teams))
    rating, hfa = least_squares_ratings(rated, nodes, hfa=True, cap=cfg["cap"], ridge=cfg["ridge"], center_ids=list(teams))
    hfa = max(0.0, min(cfg["hfa_max"], hfa))
    rk = ranks({v: rating[v] for v in teams if teams[v]["wins"] + teams[v]["losses"] + teams[v]["ties"] > 0})
    for v, t in teams.items():
        t["rating"] = r(rating.get(v), 1)
        t["rank"] = rk.get(v)

    # Predictions for upcoming games between CHSL teams
    for g in out_games:
        h, a = g["home"]["id"], g["away"]["id"]
        if g["state"] == "pre" and h in teams and a in teams and teams[h]["rank"] and teams[a]["rank"]:
            m = rating[h] - rating[a] + (0 if g["neutral"] else hfa)
            g["pred"] = {"margin": r(m, 1), "homeWin": r(norm_cdf(m / cfg["sigma"]), 3)}

    return {
        "sport": sport, "sportName": cfg["name"], "year": year, "label": season_label(sport, year),
        "generatedAt": now_iso(), "final": season_over(sport, year, now.astimezone(EASTERN).date()),
        "asOf": played[-1]["day"] if played else None, "hfa": r(hfa, 1), "sigma": cfg["sigma"],
        "divisions": divisions, "teams": sorted(teams.values(), key=lambda t: (t["rank"] or 999, t["short"])),
        "games": out_games, "sources": sources,
    }


def merge_sjj(games: dict, teams: dict, rows: list, now: datetime):
    """Fill St. John's Jesuit's games from its own site: scores MHSAA lacks, and games it doesn't list."""
    by_day = {}
    for g in games.values():
        if SJJ in (g["home"]["id"], g["away"]["id"]):
            by_day.setdefault(g["day"], []).append(g)

    def match_team(name: str):
        n = norm(name)
        if n in SJJ_ALIASES and SJJ_ALIASES[n] in teams:
            return SJJ_ALIASES[n]
        for v, t in teams.items():
            if v != SJJ and n and (n == norm(t["short"]) or n == norm(t["name"])):
                return v
        return None

    for row in rows:
        res = row["result"]
        have = by_day.get(row["day"])
        if have:
            g = have[0]
            # The school knows where its own games were (MHSAA's two entries can disagree)
            at = row["at"]
            if at.startswith(("home", "away")):
                want = "home" if at.startswith("home") else "away"
                if g[want]["id"] != SJJ:
                    g["home"], g["away"] = g["away"], g["home"]
                g["neutral"] = False
            elif at.startswith("neutral"):
                g["neutral"] = True
            mine = "home" if g["home"]["id"] == SJJ else "away"
            if res and (g[mine]["score"] is None or g["scrimmage"]):
                g[mine]["score"], g["away" if mine == "home" else "home"]["score"] = res[1], res[2]
                g["scrimmage"] = False
                g["ot"] = g["ot"] or (res[3] or None)
            continue
        # Not on MHSAA: past games only count with a result (no result = a scrimmage or a cancellation)
        start = datetime.fromisoformat(row["day"]).replace(hour=19, tzinfo=EASTERN)
        tm = re.match(r"(\d{1,2}):(\d{2})\s*([AP]M)", row["time"] or "")
        if tm:
            hh = int(tm.group(1)) % 12 + (12 if tm.group(3) == "PM" else 0)
            start = start.replace(hour=hh, minute=int(tm.group(2)))
        if not res and start < now:
            continue
        ov = match_team(row["opponent"])
        me = {"id": SJJ, "name": teams[SJJ]["short"], "score": res[1] if res else None}
        them = {"id": ov, "name": teams[ov]["short"] if ov else row["opponent"], "score": res[2] if res else None}
        neutral = row["at"].startswith("neutral")
        home, away = (them, me) if row["at"].startswith("away") else (me, them)
        gid = f"sjj-{row['day']}"
        games[gid] = {"id": gid, "start": start.isoformat(), "day": row["day"], "tbd": not tm, "neutral": neutral, "home": home, "away": away,
                      "league": False, "post": bool(re.search(r"(?i)ohsaa|tournament|district|regional|sectional", row["tournament"] or "")),
                      "note": row["tournament"] or None, "scrimmage": False, "forfeit": False, "ot": (res[3] or None) if res else None,
                      "source": "sjj"}


# ---------------------------------------------------------------- logos
# Only for the CHSL schools and the opponents of St. John's Jesuit and Divine Child.
# Sources, in order: a short list of hand-picked logos (schools neither source has),
# St. John's Jesuit's schedule pages (its own logo and every opponent's, football and
# basketball), then MHSAA's school logos (filed under the school's current or old id).
# One shared store (data/chsl/logos.json) serves both sports; misses are retried
# every 30 days. Each logo also gets its content box (the part that isn't white or
# transparent) so the app can trim built-in margins and give every logo the same
# spacing on its white tile.

LOGOS_FILE = DATA / "chsl" / "logos.json"
LOGO_TEAMS = ("toledo-st-johns-jesuit-oh", "divinechild")
# OHSAA/MHSAA marks, generic placeholders, and the St. John's Jesuit logo its site
# shows for opponents it has no logo for
GENERIC_LOGO = re.compile(r"(?i)ohsaa|mhsaa|default|placeholder|nologo|/stjohns\.png|/site/site\.png")
LOGO_OVERRIDES = {
    "liggett": "https://universityliggettsch.static.amais.com/crestred_1-121.png",  # school site; not on MHSAA
}


def sjj_logos(html: str, year: int) -> tuple[str | None, dict]:
    """(SJJ's own logo, {day: opponent logo URL}) from a SIDEARM schedule page."""
    own = re.search(r"https://[^\"']*images/logos/site/site\.png", html or "")
    by_day = {}
    for chunk in (html or "").split("sidearm-schedule-game-opponent-logo")[1:]:
        src = re.search(r'(?:data-src|src)="([^"]+)"', chunk[:600])
        dm = re.search(r"<span>\s*([A-Z][a-z]{2})\s+(\d{1,2})", chunk[:2500])
        if not (src and dm) or GENERIC_LOGO.search(src.group(1).split("?")[0]):
            continue
        mon = datetime.strptime(dm.group(1), "%b").month
        day = date(year if mon >= 7 else year + 1, mon, int(dm.group(2))).isoformat()
        path = src.group(1).split("?")[0]
        url = path if path.startswith("http") else SJJ_SITE + urllib.parse.quote(path)
        by_day[day] = f"{url}?width=160&height=160&mode=max"
    return (own.group(0) if own else None), by_day


def school_index() -> dict:
    """MHSAA's school list: vanity -> [SchoolID, OldSchoolId] (one call)."""
    calls["n"] += 1
    req = urllib.request.Request(f"{API}API/School/Search", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.loads(r.read())
    return {x["VanityURL"]: [x.get("SchoolID"), x.get("OldSchoolId")] for x in rows if x.get("VanityURL")}


def image_exists(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200 and (r.headers.get("Content-Type") or "").startswith("image/")
    except Exception:
        return False


def mhsaa_logo(ids) -> str:
    for i in [x for x in ids if x]:
        for ext in ("png", "jpg", "gif"):
            url = f"https://my.mhsaa.com/Portals/0/Logos/Schools/{i}.{ext}"
            if image_exists(url):
                return url
    return ""


def content_box(raw: bytes):
    """[left, top, right, bottom, aspect]: the logo's visible part as fractions of the
    image (white and transparent pixels don't count), plus width / height."""
    from PIL import Image  # only the logo step needs Pillow
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    mask = (a[..., 3] > 24) & ~((a[..., 0] > 232) & (a[..., 1] > 232) & (a[..., 2] > 232))
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    h, w = mask.shape
    return [round(float(v), 4) for v in (xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h, w / h)]


def side_key(s: dict) -> str | None:
    return s.get("id") or s.get("key") or (f"n:{norm(s['name'])}" if s.get("name") else None)


def add_logos(data: dict, pages: list, store: dict, log) -> None:
    """Fill teams[].logo and every game side's logo for the limited set of schools, and
    put the content boxes of the logos used in data["logoBoxes"]. store is shared
    across sports and saved by the caller."""
    now = datetime.now(timezone.utc)
    want = {t["id"] for t in data["teams"]}
    for g in data["games"]:
        if any(x in LOGO_TEAMS for x in (g["home"].get("id"), g["away"].get("id"))):
            for s in (g["home"], g["away"]):
                k = side_key(s)
                if k:
                    want.add(k)
    logos = store.setdefault("map", {})
    for k, url in LOGO_OVERRIDES.items():
        logos[k] = url
    # 1. St. John's Jesuit's site: its own logo plus each opponent's, matched by game day
    for html, year in pages:
        own, by_day = sjj_logos(html, year)
        if own:
            logos[SJJ] = own
        for g in data["games"]:
            if SJJ in (g["home"].get("id"), g["away"].get("id")) and g["day"] in by_day:
                opp = g["away"] if g["home"].get("id") == SJJ else g["home"]
                k = side_key(opp)
                if k and not logos.get(k):
                    logos[k] = by_day[g["day"]]
    # 2. MHSAA's school logos for the rest (retry misses after 30 days)
    stale = not store.get("checkedAt") or now - datetime.fromisoformat(store["checkedAt"].replace("Z", "+00:00")) > timedelta(days=30)
    todo = [k for k in want if not logos.get(k) and (k not in logos or stale) and not k.startswith("n:")]
    if todo:
        try:
            index = store.get("_index") or school_index()
            store["_index"] = index
            for k in todo:
                logos[k] = mhsaa_logo(index.get(k, []))
            store["checkedAt"] = now_iso()
        except Exception as e:  # logos are a nicety; never fail the run over them
            log(f"chsl logos: {e}")
    # 3. Content boxes for trimming (once per logo URL)
    boxes = store.setdefault("boxes", {})
    for k in want:
        url = logos.get(k)
        if url and url not in boxes:
            try:
                boxes[url] = content_box(http_get(url, timeout=30))
            except Exception as e:
                boxes[url] = None
                log(f"chsl logos: no box for {k}: {e}")
    for t in data["teams"]:
        t["logo"] = logos.get(t["id"]) or None
    used = set()
    for g in data["games"]:
        for s in (g["home"], g["away"]):
            k = side_key(s)
            if k and logos.get(k):
                s["logo"] = logos[k]
                used.add(logos[k])
    used |= {t["logo"] for t in data["teams"] if t["logo"]}
    data["logoBoxes"] = {u: boxes[u] for u in used if boxes.get(u)}
    log(f"chsl logos: {sum(1 for k in want if logos.get(k))} of {len(want)} schools")


# ---------------------------------------------------------------- job

def update(log, force=False):
    """Refresh the current season of each sport (and finish last season's if needed)."""
    if not ENABLED:
        return {"ok": True, "skipped": "waiting for permission (chsl.ENABLED)"}
    now = datetime.now(timezone.utc)
    today = now.astimezone(EASTERN).date()
    cur = school_year(today)
    out = {"ok": True, "files": {}, "errors": []}
    store = read_json(LOGOS_FILE, {}) or {}
    pages = {}  # St. John's Jesuit schedule pages fetched this run (logos for both sports)
    for sport in ("fb", "bb"):
        for year in (cur - 1, cur):
            path = DATA / "chsl" / f"{sport}-{year}.json"
            have = read_json(path, {}) or {}
            if have.get("final") and not force:
                continue
            if year == cur and not in_season(sport, today) and have and not force:
                # Off-season: refresh once a week so a new schedule shows up
                if have.get("generatedAt") and now - datetime.fromisoformat(have["generatedAt"].replace("Z", "+00:00")) < timedelta(days=7):
                    continue
            try:
                disc = have.get("discovery") or {}
                stale = not disc.get("at") or now - datetime.fromisoformat(disc["at"].replace("Z", "+00:00")) > timedelta(days=7)
                if stale or force:
                    found, orgs, not_chsl = discover(sport, year, disc.get("orgs") or {}, set(), log)
                    disc = {"at": now_iso(), "orgs": orgs, "notChsl": sorted(not_chsl), "teams": sorted(found)}
                else:
                    found = {}
                    for v in disc.get("teams", []):
                        org = disc["orgs"].get(v)
                        try:
                            found[v] = (org, mhsaa_schedule(org, sport, year))
                        except SourceError as e:
                            log(f"chsl: {v}: {e}")
                        time.sleep(0.15)
                if not found:
                    log(f"chsl {sport} {year}: no CHSL teams found (season not posted yet?)")
                    continue
                html = ""
                try:
                    html, text = sjj_pages(sport, year)
                    rows = parse_sidearm_text(text, sport, year)
                except SourceError as e:
                    rows = []
                    log(f"chsl: St. John's Jesuit site: {e}")
                data = build(sport, year, found, rows, now)
                if not rows:
                    data["sources"]["sjj"] = "unavailable"
                pages[f"{sport}-{year}"] = (html, year)
                add_logos(data, list(pages.values()), store, log)
                data["discovery"] = disc
                write_json(path, data)
                out["files"][f"{sport}-{year}"] = {"teams": len(data["teams"]), "games": len(data["games"])}
                log(f"chsl {sport} {year}: {len(data['teams'])} teams, {len(data['games'])} games")
            except Exception as e:  # one sport failing shouldn't stop the other
                out["ok"] = False
                out["errors"].append(f"{sport} {year}: {type(e).__name__}: {e}")
                log(f"chsl ERROR {sport} {year}: {e}")
    store.pop("_index", None)
    write_json(LOGOS_FILE, store)
    out["calls"] = calls["n"]
    return out
