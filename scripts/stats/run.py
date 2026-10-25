"""Nightly stats job: computes ratings and advanced stats and writes JSON into data/.

Run by .github/workflows/stats.yml. Locally:  python scripts/stats/run.py [--leagues cfb,nfl,mlb] [--full]

Writes
  data/<league>/<season>.json   one file per league and season (current + previous three)
  data/meta.json                when it ran, which sources worked, and any errors

Finished seasons are computed once and then left alone. A source that fails is
reported in meta.json (and on the app's Data sources screen); the last good numbers stay.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import cfb  # noqa: E402
import mlb  # noqa: E402
import nfl  # noqa: E402
from common import DATA, in_season, now_iso, read_json, season_file, season_year, write_json  # noqa: E402

MODULES = {"cfb": cfb, "nfl": nfl, "mlb": mlb}


def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", default="cfb,nfl,mlb")
    ap.add_argument("--full", action="store_true", help="refresh everything (nightly run)")
    args = ap.parse_args()
    full = args.full or os.environ.get("FULL_RUN") == "1"
    weekday_utc = datetime.now(timezone.utc).weekday()  # Mon=0 .. Sun=6

    meta = read_json(DATA / "meta.json", {}) or {}
    meta.setdefault("leagues", {})
    run_leagues = []
    for lg in args.leagues.split(","):
        cur = season_year(lg)
        have_current = season_file(lg, cur).exists()
        if not full and not in_season(lg) and have_current:
            log(f"{lg}: off-season and not a nightly run, skipping")
            continue
        # College games are on Saturdays; keep CFBD calls inside the free tier
        if lg == "cfb" and not full and weekday_utc not in (5, 6) and have_current:
            log("cfb: not a Saturday game-day run, skipping")
            continue
        run_leagues.append(lg)

    for lg in run_leagues:
        mod = MODULES[lg]
        cur = season_year(lg)
        entry = meta["leagues"].get(lg, {})
        errors = []
        t0 = time.time()
        for season in range(cur - 3, cur + 1):  # oldest first: each season seeds the next
            path = season_file(lg, season)
            existing = read_json(path)
            if existing and existing.get("final") and season < cur:
                continue
            try:
                out = mod.compute(season, full or season < cur, log)
                write_json(path, out)
                log(f"{lg} {season}: wrote {len(out['teams'])} teams")
            except Exception as e:  # keep going: other seasons and leagues still update
                msg = f"{season}: {type(e).__name__}: {e}"
                errors.append(msg)
                log(f"{lg} ERROR {msg}")
                traceback.print_exc()
        seasons = sorted((int(p.stem) for p in (DATA / lg).glob("*.json") if p.stem.isdigit()), reverse=True)
        current_file = read_json(season_file(lg, cur), {}) or {}
        entry.update({
            "current": cur,
            "seasons": [s for s in seasons if s >= cur - 3],
            "updatedAt": now_iso() if not errors else entry.get("updatedAt"),
            "lastRunAt": now_iso(),
            "ok": not errors,
            "errors": errors,
            "status": current_file.get("status", {}),
            "asOf": current_file.get("asOf"),
            "seconds": round(time.time() - t0, 1),
        })
        meta["leagues"][lg] = entry

    meta["generatedAt"] = now_iso()
    meta["fullRun"] = full
    meta["cfbdCalls"] = cfb.calls["n"]
    write_json(DATA / "meta.json", meta)
    log(f"done: {', '.join(run_leagues) or 'nothing to do'}; CFBD calls this run: {cfb.calls['n']}")


if __name__ == "__main__":
    main()
