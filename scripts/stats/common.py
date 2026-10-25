"""Shared helpers for the nightly stats job: HTTP, files, seasons, and the rating math.

Everything here is plain numpy so it is easy to read and check:
  - least_squares_ratings(): Predictor (capped margins + home field) and SRS
  - Elo with a margin-of-victory multiplier (FiveThirtyEight style)
  - log5 / pythagorean helpers and a normal CDF for win probabilities
"""
from __future__ import annotations

import gzip
import io
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
UA = "podium-stats-app/1.0 (personal, non-commercial; github.com nightly job)"

# ---------------------------------------------------------------- time & seasons

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def eastern_today():
    # Eastern time without extra dependencies: UTC-4 in daylight time, UTC-5 otherwise (close enough for season math)
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date()


def season_year(league: str, d=None) -> int:
    """Football seasons are named for the year they start; MLB uses the calendar year."""
    d = d or eastern_today()
    if league == "mlb":
        return d.year
    return d.year - 1 if d.month <= 7 else d.year


def in_season(league: str, d=None) -> bool:
    d = d or eastern_today()
    md = (d.month, d.day)
    if league == "nfl":
        return md >= (9, 1) or md <= (2, 15)
    if league == "cfb":
        return md >= (8, 20) or md <= (1, 25)
    return (3, 18) <= md <= (11, 8)


# ---------------------------------------------------------------- HTTP

class SourceError(Exception):
    pass


def http_get(url: str, headers: dict | None = None, retries: int = 3, timeout: int = 90) -> bytes:
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} from {url.split('?')[0]}"
            if e.code in (400, 401, 403, 404):
                break  # not worth retrying
        except Exception as e:  # network hiccup
            last = f"{type(e).__name__}: {e} ({url.split('?')[0]})"
        time.sleep(2 * (attempt + 1))
    raise SourceError(last or f"Failed to fetch {url}")


def get_json(url: str, params: dict | None = None, headers: dict | None = None):
    if params:
        url = f"{url}?{urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})}"
    return json.loads(http_get(url, {"Accept": "application/json", **(headers or {})}))


def get_csv_text(url: str) -> str:
    return http_get(url).decode("utf-8-sig")


# ---------------------------------------------------------------- files

def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, default=_json_default)
    path.write_text(text + "\n")


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if math.isnan(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def r(x, nd=3):
    """Round for output; NaN/None become None so the JSON stays valid."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def season_file(league: str, season: int) -> Path:
    return DATA / league / f"{season}.json"


# ---------------------------------------------------------------- ratings math

def least_squares_ratings(games, team_ids, *, hfa=True, cap=None, ridge=0.0, prior=None, center_ids=None):
    """Solve for one rating per team (and optionally home-field advantage).

    games: iterable of (home_id, away_id, home_margin, neutral)
    Minimizes  sum (m - (r_home - r_away + H*[not neutral]))^2  +  ridge * sum (r_i - prior_i)^2
    with margins capped at +/- cap. Ratings are then shifted so the mean over center_ids is 0.
    Returns (ratings: dict id -> float, H: float).
    """
    ids = list(team_ids)
    idx = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    rows, y = [], []
    for h, a, m, neutral in games:
        if h not in idx or a not in idx:
            continue
        row = np.zeros(n + (1 if hfa else 0))
        row[idx[h]] = 1.0
        row[idx[a]] = -1.0
        if hfa and not neutral:
            row[n] = 1.0
        rows.append(row)
        y.append(max(-cap, min(cap, m)) if cap else m)
    k = n + (1 if hfa else 0)
    if not rows:
        return {t: 0.0 for t in ids}, 0.0
    X = np.array(rows)
    Y = np.array(y, dtype=float)
    # Ridge toward the prior (team ratings only), plus a tiny term so the system is always solvable
    lam = np.full(k, max(ridge, 1e-3))
    if hfa:
        lam[n] = 1e-3
    p = np.zeros(k)
    if prior:
        for t, v in prior.items():
            if t in idx:
                p[idx[t]] = v
    A = X.T @ X + np.diag(lam)
    b = X.T @ Y + lam * p
    sol = np.linalg.solve(A, b)
    rat = {t: float(sol[idx[t]]) for t in ids}
    center = [rat[t] for t in (center_ids or ids) if t in rat]
    shift = float(np.mean(center)) if center else 0.0
    rat = {t: v - shift for t, v in rat.items()}
    return rat, float(sol[n]) if hfa else 0.0


class Elo:
    """Elo with a margin-of-victory multiplier (FiveThirtyEight's NFL/college formula)."""

    def __init__(self, k=20.0, hfa=48.0, mean=1505.0, revert=1 / 3, start=None):
        self.k, self.hfa, self.mean, self.revert = k, hfa, mean, revert
        self.r: dict = {}
        self.start = start or {}

    def get(self, t):
        if t not in self.r:
            self.r[t] = self.start.get(t, self.mean)
        return self.r[t]

    def new_season(self):
        for t in self.r:
            self.r[t] = self.r[t] + (self.mean - self.r[t]) * self.revert

    def expected(self, home, away, neutral=False):
        d = self.get(home) - self.get(away) + (0 if neutral else self.hfa)
        return 1 / (1 + 10 ** (-d / 400))

    def update(self, home, away, home_margin, neutral=False):
        exp = self.expected(home, away, neutral)
        res = 1.0 if home_margin > 0 else 0.0 if home_margin < 0 else 0.5
        d = self.get(home) - self.get(away) + (0 if neutral else self.hfa)
        winner_diff = d if home_margin > 0 else -d
        mult = math.log(abs(home_margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2) if home_margin else 1.0
        delta = self.k * mult * (res - exp)
        self.r[home] = self.get(home) + delta
        self.r[away] = self.get(away) - delta


def norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def pythag(pf: float, pa: float, exp: float) -> float:
    if pf <= 0 and pa <= 0:
        return 0.5
    return pf ** exp / (pf ** exp + pa ** exp)


def log5(pa: float, pb: float) -> float:
    den = pa + pb - 2 * pa * pb
    return 0.5 if den == 0 else (pa - pa * pb) / den


def add_home_edge(p: float, logit_edge: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    lo = math.log(p / (1 - p)) + logit_edge
    return 1 / (1 + math.exp(-lo))


def ranks(values: dict, higher_is_better=True) -> dict:
    """Competition ranks (1 = best); None values get None."""
    items = [(k, v) for k, v in values.items() if v is not None and not (isinstance(v, float) and math.isnan(v))]
    items.sort(key=lambda kv: kv[1], reverse=higher_is_better)
    out, prev, rank = {}, None, 0
    for i, (k, v) in enumerate(items, 1):
        if v != prev:
            rank = i
        out[k] = rank
        prev = v
    return out
