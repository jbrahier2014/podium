"""Expected points (EP) models for live games -> data/ep/<league>.json

The app computes EP for every live play itself (ESPN's feed has down, distance,
field position, clock and score, but no EP). This fits the small model it uses.

Method
  Target: the published EP of a mature model on every play, so Podium's numbers
  track the article's model rather than starting from scratch:
    college  cfbfastR / sportsdataverse model_pbp (ep_before), the model described in
             "College Football Expected Points Model Fundamentals"
    NFL      nflverse play-by-play (ep, the nflfastR model)
  Both are "next score" models: EP = sum over the seven next-score outcomes of
  probability x points (TD 7, FG 3, safety 2, none 0, and the opponent's negatives).

  Fit: ridge least squares on a fixed basis (see basis() below; app/js/data/ep.js
  mirrors it exactly): a piecewise-linear curve over yards to goal for each down,
  log and straight-line distance and goal-to-go per down, end-of-half terms and score difference.
  About 80 coefficients; the job reports R² and mean absolute error against the
  source model on held-out plays.

  Also fitted, for the 4th-down comparison:
    fg     make probability, logistic on kick distance (yards to goal + 17)
    conv   4th-down conversion probability, logistic on log(distance)
    punt   opponent's yards to goal after a punt, by the punting team's yards to goal

Refreshed weekly on full runs (models change slowly). Defaults are written if a
part can't be fitted, and the reason is recorded.
"""
from __future__ import annotations

import io
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from common import DATA, http_get, now_iso, r, read_json, season_year, write_json

BASIS = "podium-ep-v2"
KNOTS = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 99]

CFB_URL = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_model_pbp/model_pbp_{season}.parquet"
NFL_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"

# Used when a part can't be fitted from data (league-typical values)
DEFAULTS = {
    "nfl": {"fg": [6.5, -0.11], "conv": [0.75, -0.73], "punt_net": 41, "fg_miss": "spot_of_kick"},
    "cfb": {"fg": [4.7, -0.09], "conv": [0.70, -0.70], "punt_net": 38, "fg_miss": "line_of_scrimmage"},
}


# ---------------------------------------------------------------- basis (mirror in js/data/ep.js)
def basis(ytg, down, dist, secs, sd):
    """Feature matrix for arrays of yards to goal, down (1-4), distance, seconds left in the half, score difference."""
    ytg = np.clip(np.asarray(ytg, float), 1, 99)
    down = np.asarray(down, int)
    dist = np.clip(np.minimum(np.asarray(dist, float), ytg), 1, None)
    secs = np.clip(np.asarray(secs, float), 0, 1800)
    sd = np.clip(np.asarray(sd, float), -28, 28) / 14.0
    n = len(ytg)
    u = ytg / 100.0
    ld = np.log(dist)
    goal = (dist >= ytg).astype(float)
    t = secs / 1800.0
    late = np.clip(1 - secs / 180.0, 0, 1)
    vlate = np.clip(1 - secs / 40.0, 0, 1)

    # piecewise-linear "hat" weights over the knots
    k = np.asarray(KNOTS, float)
    hat = np.zeros((n, len(k)))
    j = np.clip(np.searchsorted(k, ytg, side="right") - 1, 0, len(k) - 2)
    w = (ytg - k[j]) / (k[j + 1] - k[j])
    hat[np.arange(n), j] = 1 - w
    hat[np.arange(n), j + 1] = w

    cols = []
    for d in (1, 2, 3, 4):
        m = (down == d).astype(float)
        cols.append(hat * m[:, None])
        dl = dist / 10.0
        cols.append(np.stack([ld * m, ld * u * m, goal * m, dl * m, dl * u * m], axis=1))
    cols.append(np.stack([late, late * u, late * u * u, vlate, vlate * u, t, t * u, sd, sd * late, sd * t], axis=1))
    return np.hstack(cols)


def n_features():
    return basis([50], [1], [10], [900], [0]).shape[1]


# ---------------------------------------------------------------- helpers
def fit_ep(df, log, league):
    """df columns: ytg, down, dist, secs, sd, ep. Returns coefficients and fit quality."""
    df = df.dropna(subset=["ytg", "down", "dist", "secs", "sd", "ep"])
    df = df[(df.down.between(1, 4)) & (df.ytg.between(1, 99)) & (df.dist >= 0) & df.ep.between(-7, 7)]
    if len(df) < 5000:
        raise ValueError(f"only {len(df)} usable plays")
    rng = np.random.default_rng(7)
    test = rng.random(len(df)) < 0.15
    X = basis(df.ytg.values, df.down.values.astype(int), df.dist.values, df.secs.values, df.sd.values)
    y = df.ep.values.astype(float)
    lam = 1e-2
    A = X[~test]
    beta = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ y[~test])
    pred = X[test] @ beta
    resid = y[test] - pred
    r2 = 1 - resid.var() / y[test].var()
    mae = float(np.abs(resid).mean())
    log(f"ep {league}: fitted on {(~test).sum():,} plays, held-out R² {r2:.3f}, MAE {mae:.3f}")
    return [float(b) for b in beta], {"r2": r(float(r2), 3), "mae": r(mae, 3), "n": int(len(df))}


def logistic(x, y, iters=50):
    """Two-parameter logistic regression by Newton's method: P(y=1) = 1/(1+exp(-(a+b x)))."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    X = np.stack([np.ones_like(x), x], axis=1)
    beta = np.zeros(2)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(X @ beta)))
        W = p * (1 - p) + 1e-9
        step = np.linalg.solve(X.T @ (X * W[:, None]) + 1e-6 * np.eye(2), X.T @ (y - p))
        beta += step
        if np.abs(step).max() < 1e-8:
            break
    return [r(float(beta[0]), 4), r(float(beta[1]), 4)]


def punt_table(punter_ytg, opp_ytg):
    """Mean opponent yards to goal after a punt, by the punting team's yards to goal (5-yard bins, 30..99)."""
    bins = list(range(30, 100, 5))
    s = pd.DataFrame({"y": punter_ytg, "o": opp_ytg}).dropna()
    s = s[s.o.between(1, 99)]
    out = []
    for b in bins:
        g = s[(s.y >= b - 2.5) & (s.y < b + 2.5)]
        out.append([b, r(float(g.o.mean()), 1) if len(g) >= 20 else None])
    return out


def pick(cols, *cands):
    for c in cands:
        if c in cols:
            return c
    return None


def read_parquet_url(url, wanted=None):
    import pyarrow.parquet as pq
    raw = http_get(url, timeout=240)
    names = pq.read_schema(io.BytesIO(raw)).names
    cols = [c for c in (wanted or names) if c in names]
    return pd.read_parquet(io.BytesIO(raw), columns=cols), names


# ---------------------------------------------------------------- NFL (nflverse)
def fit_nfl(log):
    cur = season_year("nfl")
    seasons = [cur - 2, cur - 1]
    want = ["season_type", "game_id", "play_id", "posteam", "down", "ydstogo", "yardline_100", "half_seconds_remaining",
            "score_differential", "ep", "play_type", "field_goal_result", "kick_distance", "fourth_down_converted",
            "fourth_down_failed", "punt_attempt", "touchback", "return_yards", "penalty"]
    frames = []
    for s in seasons:
        df, _ = read_parquet_url(NFL_URL.format(season=s), want)
        frames.append(df)
        log(f"ep nfl: {s} play-by-play, {len(df):,} rows")
    df = pd.concat(frames, ignore_index=True)
    status = {}

    run = df[df.play_type.isin(["pass", "run", "punt", "field_goal", "no_play", "qb_kneel", "qb_spike"])]
    beta, quality = fit_ep(pd.DataFrame({"ytg": run.yardline_100, "down": run.down, "dist": run.ydstogo,
                                         "secs": run.half_seconds_remaining, "sd": run.score_differential, "ep": run.ep}), log, "nfl")
    model = {"coef": beta, **quality, "source": "nflverse (nflfastR EP)", "seasons": seasons}

    fg = df[df.field_goal_result.isin(["made", "missed", "blocked"]) & df.kick_distance.notna()]
    model["fg"] = logistic(fg.kick_distance, fg.field_goal_result == "made") if len(fg) > 500 else DEFAULTS["nfl"]["fg"]
    status["fg"] = f"{len(fg)} attempts"

    go = df[(df.down == 4) & df.play_type.isin(["pass", "run"]) & (df.penalty != 1)
            & ((df.fourth_down_converted == 1) | (df.fourth_down_failed == 1)) & (df.ydstogo >= 1)]
    model["conv"] = logistic(np.log(go.ydstogo.clip(1, 30)), go.fourth_down_converted == 1) if len(go) > 300 else DEFAULTS["nfl"]["conv"]
    status["conv"] = f"{len(go)} attempts"

    p = df[(df.play_type == "punt") & df.kick_distance.notna() & (df.penalty != 1)].copy()
    land = p.yardline_100 - p.kick_distance + p.return_yards.fillna(0)
    opp = np.where(p.touchback == 1, 80, 100 - land)
    model["punt"] = punt_table(p.yardline_100.values, opp)
    status["punt"] = f"{len(p)} punts"
    model["fg_miss"] = DEFAULTS["nfl"]["fg_miss"]
    model["status"] = status
    return model


# ---------------------------------------------------------------- College (sportsdataverse / cfbfastR)
CFB_COLS = {
    "ytg": ("yards_to_goal", "start.yardsToEndzone", "start_yards_to_goal", "yardsToEndzone", "start.yards_to_goal"),
    "down": ("down", "start.down", "start_down"),
    "dist": ("distance", "start.distance", "start_distance"),
    "secs": ("TimeSecsRem", "start.TimeSecsRem", "time_secs_rem", "half_seconds_remaining", "start_time_secs_rem"),
    "sd": ("pos_score_diff_start", "score_diff_start", "pos_score_diff", "start.pos_score_diff"),
    "ep": ("ep_before", "EP_start", "ep_start"),
    "type": ("play_type", "type.text", "type_text", "play_type_text"),
    "gain": ("yards_gained", "statYardage", "yds_gained", "yards"),
}
CFB_CANDIDATES = [c for v in CFB_COLS.values() for c in v]


def fit_cfb(log):
    cur = season_year("cfb")
    frames, names = [], None
    seasons = []
    for s in (cur - 2, cur - 1):
        try:
            df, names = read_parquet_url(CFB_URL.format(season=s), CFB_CANDIDATES)
            seasons.append(s)
            frames.append(df)
            log(f"ep cfb: {s} model play-by-play, {len(df):,} rows, {len(names)} columns")
        except Exception as e:
            log(f"ep cfb: {s} not available ({e})")
    if not frames:
        raise ValueError("no sportsdataverse model_pbp files could be downloaded")
    df = pd.concat(frames, ignore_index=True)
    cols = set(df.columns)
    c = {k: pick(cols, *v) for k, v in CFB_COLS.items()}
    missing = [k for k in ("ytg", "down", "dist", "secs", "sd", "ep") if not c[k]]
    if missing:
        raise ValueError(f"columns not found for {missing}; file has {len(names)} columns, e.g. {sorted(names)[:250]}")
    status = {"columns": {k: v for k, v in c.items() if v}}
    beta, quality = fit_ep(pd.DataFrame({k: pd.to_numeric(df[c[k]], errors="coerce") for k in ("ytg", "down", "dist", "secs", "sd", "ep")}), log, "cfb")
    model = {"coef": beta, **quality, "source": "cfbfastR / sportsdataverse (ep_before)", "seasons": seasons}

    model["fg"] = DEFAULTS["cfb"]["fg"]
    model["conv"] = DEFAULTS["cfb"]["conv"]
    model["punt"] = None
    if c["type"]:
        typ = df[c["type"]].astype(str)
        ytg = pd.to_numeric(df[c["ytg"]], errors="coerce")
        down = pd.to_numeric(df[c["down"]], errors="coerce")
        dist = pd.to_numeric(df[c["dist"]], errors="coerce")
        fg = typ.str.contains("Field Goal", case=False) & ~typ.str.contains("Return|Penalty", case=False) & ytg.between(1, 60)
        if fg.sum() > 500:
            model["fg"] = logistic((ytg[fg] + 17).values, typ[fg].str.contains("Good", case=False).values)
        status["fg"] = f"{int(fg.sum())} attempts"
        if c["gain"]:
            gain = pd.to_numeric(df[c["gain"]], errors="coerce")
            go = (down == 4) & typ.str.contains("Rush|Pass|Sack|Interception|Fumble", case=False) \
                & ~typ.str.contains("Punt|Field Goal|Penalty|Kickoff", case=False) & dist.between(1, 30) & gain.notna()
            if go.sum() > 300:
                conv = (gain[go] >= dist[go]) | typ[go].str.contains("Touchdown", case=False)
                model["conv"] = logistic(np.log(dist[go].values), conv.values)
            status["conv"] = f"{int(go.sum())} attempts"
    model["fg_miss"] = DEFAULTS["cfb"]["fg_miss"]
    model["punt_net"] = DEFAULTS["cfb"]["punt_net"]
    model["status"] = status
    return model


# ---------------------------------------------------------------- entry point
FITTERS = {"nfl": fit_nfl, "cfb": fit_cfb}


def update(log, force=False):
    """Refit any league whose model is missing, outdated or over a week old. Returns status per league."""
    out = {}
    for lg, fitter in FITTERS.items():
        path = DATA / "ep" / f"{lg}.json"
        have = read_json(path)
        fresh = have and have.get("basis") == BASIS and have.get("fitted") and \
            datetime.now(timezone.utc) - datetime.fromisoformat(have["fitted"].replace("Z", "+00:00")) < timedelta(days=6)
        if fresh and not force:
            out[lg] = {"ok": True, "fitted": have["fitted"], "r2": have.get("r2"), "mae": have.get("mae"), "skipped": True}
            continue
        try:
            model = fitter(log)
            model.update({"league": lg, "basis": BASIS, "knots": KNOTS, "nFeatures": n_features(), "fitted": now_iso(),
                          "punt_net": model.get("punt_net", DEFAULTS[lg]["punt_net"])})
            model["coef"] = [round(b, 5) for b in model["coef"]]
            write_json(path, model)
            out[lg] = {"ok": True, "fitted": model["fitted"], "r2": model["r2"], "mae": model["mae"], "n": model["n"]}
        except Exception as e:
            log(f"ep {lg} ERROR {type(e).__name__}: {e}")
            out[lg] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:1500]}",
                       "fitted": have.get("fitted") if have else None}
    return out
