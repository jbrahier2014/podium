"""Run expectancy for live baseball run value -> data/rv/mlb.json

The app scores every pitch of a live game itself (MLB's feed has the count, outs and
runners for every pitch, but no run values). This builds the table it uses.

Method (the Statcast approach)
  Run expectancy RE(state) = average runs the batting team scores from that point to
  the end of the half-inning, for each of the 288 states: 8 base states x 3 outs x
  12 counts. A pitch's run value = RE(after) - RE(before) + runs scored on the pitch,
  for the batting team (the pitcher gets the negative): the classic Statcast
  definition. Savant's current delta_run_exp column uses a different, unpublished
  formula (it doesn't sum to runs scored), so the job logs agreement with it only
  as a diagnostic.

  Data: Statcast pitch-by-pitch from Baseball Savant's search CSV, for a sample of
  regular-season dates (12 three-day windows across the season, about 150,000
  pitches). Half-innings that can end early (bottom of the 9th and later) and extra
  innings (runner starts on 2nd) are left out. Thin cells are shrunk toward an
  additive base-out + count model.

Refit when missing, when the season changes, or every 30 days on full runs.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

from common import DATA, http_get, now_iso, r, read_json, season_year, write_json

BASIS = "podium-re288-v1"
SAVANT = "https://baseballsavant.mlb.com/statcast_search/csv"
COLS = ["game_pk", "game_date", "inning", "inning_topbot", "at_bat_number", "pitch_number", "balls", "strikes",
        "outs_when_up", "on_1b", "on_2b", "on_3b", "bat_score", "post_bat_score", "delta_run_exp"]


def windows(season: int):
    """Twelve 3-day windows, roughly every two weeks from mid-April to late September."""
    start = date(season, 4, 12)
    return [(start + timedelta(days=14 * i), start + timedelta(days=14 * i + 2)) for i in range(12)]


def download(season: int, log):
    frames = []
    for a, b in windows(season):
        url = (f"{SAVANT}?all=true&hfGT=R%7C&hfSea={season}%7C&player_type=pitcher"
               f"&game_date_gt={a.isoformat()}&game_date_lt={b.isoformat()}&type=details")
        try:
            raw = http_get(url, timeout=180)
            df = pd.read_csv(io.BytesIO(raw), usecols=lambda c: c in COLS, low_memory=False)
            frames.append(df)
            log(f"rv: {a}..{b}: {len(df):,} pitches")
        except Exception as e:  # one bad window shouldn't sink the fit
            log(f"rv: {a}..{b} failed ({e})")
    if not frames:
        raise ValueError("no Statcast data downloaded")
    return pd.concat(frames, ignore_index=True)


def state_index(bases, outs, balls, strikes):
    return ((bases * 3 + outs) * 4 + balls) * 3 + strikes


def fit(df: pd.DataFrame, log):
    df = df.dropna(subset=["balls", "strikes", "outs_when_up", "bat_score", "post_bat_score"]).copy()
    df = df[(df.balls <= 3) & (df.strikes <= 2) & (df.outs_when_up <= 2)]
    df["bases"] = df.on_1b.notna().astype(int) + 2 * df.on_2b.notna().astype(int) + 4 * df.on_3b.notna().astype(int)
    df = df.sort_values(["game_pk", "at_bat_number", "pitch_number"])
    half = ["game_pk", "inning", "inning_topbot"]
    df["half_end"] = df.groupby(half).post_bat_score.transform("max")
    df["runs_rest"] = df.half_end - df.bat_score
    keep = ~((df.inning >= 9) & (df.inning_topbot == "Bot")) & (df.inning <= 9)
    d = df[keep]
    log(f"rv: {len(d):,} pitches in complete half-innings")

    idx = state_index(d.bases.values, d.outs_when_up.astype(int).values, d.balls.astype(int).values, d.strikes.astype(int).values)
    sums = np.bincount(idx, weights=d.runs_rest.values, minlength=288)
    cnt = np.bincount(idx, minlength=288)
    # Additive prior: base-out mean + count effect, for thin cells
    bo = d.bases * 3 + d.outs_when_up.astype(int)
    bo_mean = d.groupby(bo).runs_rest.mean()
    d2 = d.assign(bo=bo, resid=d.runs_rest - bo.map(bo_mean))
    cnt_eff = d2.groupby([d2.balls.astype(int), d2.strikes.astype(int)]).resid.mean()
    prior = np.zeros(288)
    for b in range(8):
        for o in range(3):
            for ba in range(4):
                for st in range(3):
                    prior[state_index(b, o, ba, st)] = bo_mean.get(b * 3 + o, 0) + cnt_eff.get((ba, st), 0)
    k = 40.0
    re = (sums + k * prior) / (cnt + k)

    # Check against Savant's per-pitch run values (delta_run_exp)
    q = df[keep].copy()
    q["i"] = state_index(q.bases.values, q.outs_when_up.astype(int).values, q.balls.astype(int).values, q.strikes.astype(int).values)
    q["re"] = re[q.i.values]
    nxt = q.groupby(half).re.shift(-1)
    q["re_after"] = nxt.fillna(0.0)  # last pitch of the half-inning: inning over
    q["mine"] = q.re_after - q.re + (q.post_bat_score - q.bat_score)
    v = q.dropna(subset=["delta_run_exp"])
    resid = v.delta_run_exp - v.mine
    r2 = 1 - resid.var() / v.delta_run_exp.var() if len(v) > 1000 else None
    mae = float(resid.abs().mean()) if len(v) else None
    log(f"rv: agreement with Savant delta_run_exp (different formula) R² {r2:.3f}, MAE {mae:.4f}" if r2 is not None else "rv: no Savant values to check against")
    return re, cnt, r2, mae, int(len(d))


def update(log, force=False):
    path = DATA / "rv" / "mlb.json"
    have = read_json(path)
    today = datetime.now(timezone.utc)
    # The most recent regular season with data: this year once it's under way, else last year
    season = season_year("mlb")
    if today.month < 5:
        season -= 1
    fresh = have and have.get("basis") == BASIS and have.get("season") == season and have.get("fitted") and \
        today - datetime.fromisoformat(have["fitted"].replace("Z", "+00:00")) < timedelta(days=30)
    if fresh and not force:
        return {"ok": True, "fitted": have["fitted"], "r2": have.get("r2"), "skipped": True}
    try:
        df = download(season, log)
        re, cnt, r2, mae, n = fit(df, log)
        out = {
            "basis": BASIS, "season": season, "fitted": now_iso(), "n": n,
            "r2": r(r2, 3) if r2 is not None else None, "mae": r(mae, 4) if mae is not None else None,
            "order": "index = ((bases*3 + outs)*4 + balls)*3 + strikes; bases: 1B=1, 2B=2, 3B=4",
            "re": [round(float(x), 4) for x in re], "cells": [int(c) for c in cnt],
            "source": "Baseball Savant Statcast search (sampled regular-season dates)",
        }
        write_json(path, out)
        return {"ok": True, "fitted": out["fitted"], "r2": out["r2"], "mae": out["mae"], "n": n, "season": season}
    except Exception as e:
        log(f"rv ERROR {type(e).__name__}: {e}")
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:500]}", "fitted": have.get("fitted") if have else None}
