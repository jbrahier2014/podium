// Run value per pitch for baseball, computed in the app from MLB's live feed.
//
// Run expectancy RE(bases, outs, balls, strikes) = average runs the batting team
// scores from that point to the end of the half-inning (288 states). A pitch's run
// value = RE(after) - RE(before) + runs scored on it, for the batting team; the
// pitcher gets the negative. This is Statcast's per-pitch run value (delta_run_exp).
//
// The table comes from data/rv/mlb.json (fitted by the nightly job from Statcast,
// scripts/stats/rv.py). Until that exists, a standard table is used: base-out run
// expectancy plus count adjustments (typical recent MLB values).
//
// Exports
//   loadRV()                              the table (fitted or default)
//   reValue(m, bases, outs, balls, strikes)
//   annotate(m, pas)                      per-pitch (and baserunning event) run values
//   summarize(rows, game)                 team / pitcher / zone / swing-take totals
//   attackZone(e)                         'heart' | 'shadow' | 'chase' | 'waste' | null
//   isSwing(e)

import { getComputed } from './index.js';

const DAY = 24 * 3600 * 1000;
// Bases bitmask: 1B = 1, 2B = 2, 3B = 4.  Order matches scripts/stats/rv.py.
const idx = (b, o, ba, st) => ((b * 3 + o) * 4 + ba) * 3 + st;

// Default: RE24 (outs x base state) + count adjustments
const RE24 = [
  [0.50, 0.88, 1.12, 1.47, 1.35, 1.75, 1.96, 2.29],
  [0.27, 0.52, 0.68, 0.91, 0.95, 1.15, 1.36, 1.55],
  [0.10, 0.22, 0.32, 0.44, 0.36, 0.48, 0.58, 0.75],
];
// The bitmask order (empty, 1B, 2B, 1B2B, 3B, 1B3B, 2B3B, loaded) is the classic table's order
const COUNT_ADJ = [ // [balls][strikes], relative to 0-0
  [0.000, -0.040, -0.100],
  [0.040, -0.010, -0.075],
  [0.090, 0.035, -0.045],
  [0.170, 0.115, 0.040],
];
function defaultTable() {
  const re = new Array(288);
  for (let b = 0; b < 8; b++) for (let o = 0; o < 3; o++) for (let ba = 0; ba < 4; ba++) for (let st = 0; st < 3; st++) {
    re[idx(b, o, ba, st)] = Math.max(0, RE24[o][b] + COUNT_ADJ[ba][st] * (1 - o * 0.25));
  }
  return { re, fitted: null, isDefault: true };
}

let cached = null;
export function loadRV() {
  if (!cached) {
    cached = getComputed('rv/mlb.json', { ttlMs: DAY }).then((r) => {
      const m = r?.data || r;
      return Array.isArray(m?.re) && m.re.length === 288 ? m : defaultTable();
    }).catch(() => defaultTable());
  }
  return cached;
}

export function reValue(m, bases, outs, balls, strikes) {
  if (outs >= 3) return 0;
  return m.re[idx(bases & 7, Math.max(0, outs), Math.min(3, Math.max(0, balls)), Math.min(2, Math.max(0, strikes)))];
}

// ---------------------------------------------------------------- pitch helpers
const SWING = /swinging|foul|in play|bunt|missed/i;
const SHORT = { FF: '4-seam', FA: 'Fastball', SI: 'Sinker', FT: '2-seam', FC: 'Cutter', SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', CU: 'Curve',
  KC: 'Knuckle curve', CS: 'Slow curve', CH: 'Change', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball', KN: 'Knuckleball', EP: 'Eephus' };
/** "4-seam", "Sweeper"... (falls back to the feed's name) */
export const pitchShort = (code, name) => SHORT[code] || name || code || '';
export const isSwing = (e) => e.isPitch && SWING.test(e.call);

/**
 * Statcast-style attack regions from plate location, measured against the batter's
 * strike zone (plate half-width 0.83 ft incl. the ball): Heart = inside 67% of the
 * zone, Shadow = 67-133% (the edges, in or out), Chase = 133-200%, Waste = beyond.
 */
export function attackZone(e) {
  if (e.px == null || e.pz == null || !e.szTop || !e.szBot) return null;
  const halfW = 0.83; const halfH = (e.szTop - e.szBot) / 2 + 0.12; const cz = (e.szTop + e.szBot) / 2;
  const m = Math.max(Math.abs(e.px) / halfW, Math.abs(e.pz - cz) / halfH);
  return m <= 0.67 ? 'heart' : m <= 1.33 ? 'shadow' : m <= 2 ? 'chase' : 'waste';
}
export const ZONES = ['heart', 'shadow', 'chase', 'waste'];

// ---------------------------------------------------------------- annotate
/**
 * Walks every plate appearance, rebuilding bases / outs / count before and after each
 * event. Returns rows for every pitch, plus non-pitch events that changed the state
 * (steals, pickoffs, balks), each with { rv, reBefore, reAfter, runs, ... }.
 */
export function annotate(m, pas, { postseason = false } = {}) {
  const rows = [];
  let half = null; let bases = 0; let outs = 0;
  for (const pa of pas) {
    const key = `${pa.inning}-${pa.half}`;
    if (key !== half) {
      half = key; outs = 0;
      // Regular-season extra innings start with a runner on second
      bases = !postseason && pa.inning >= 10 ? 2 : 0;
    }
    let balls = 0; let strikes = 0;
    const pitches = pa.events.filter((e) => e.isPitch);
    const lastPitch = pitches[pitches.length - 1];
    const evs = pa.events;
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k];
      const before = { bases, outs, balls, strikes };
      const terminal = pa.complete && e === lastPitch;
      // Runner movements caused by this event (and, on the final pitch, any stragglers)
      const moves = pa.runners.filter((r) => r.playIndex === e.index || (terminal && (r.playIndex == null || r.playIndex > e.index)));
      let runs = 0;
      const byRunner = new Map();
      moves.forEach((mv, i) => {
        const key2 = mv.id ?? `x${i}`;
        const prev = byRunner.get(key2);
        byRunner.set(key2, prev ? { ...mv, start: prev.start } : mv); // collapse 1B->2B->3B on one play
      });
      let b2 = bases;
      for (const mv of byRunner.values()) if (mv.start) b2 &= ~mv.start;
      for (const mv of byRunner.values()) {
        if (mv.isOut) continue;
        if (mv.end === 'score') runs += 1;
        else if (mv.end) b2 |= mv.end;
      }
      let outsAfter = e.outs;
      let ballsAfter = Math.min(3, e.balls); let strikesAfter = Math.min(2, e.strikes);
      let mismatch = false;
      if (terminal) {
        ballsAfter = 0; strikesAfter = 0;
        if (pa.outsEnd != null) outsAfter = pa.outsEnd;
        if (outsAfter < 3) { mismatch = b2 !== pa.postBits; b2 = pa.postBits; } // trust the feed's end-of-play bases
      }
      const reBefore = reValue(m, before.bases, before.outs, before.balls, before.strikes);
      const reAfter = outsAfter >= 3 ? 0 : reValue(m, b2, outsAfter, ballsAfter, strikesAfter);
      const rv = reAfter - reBefore + runs;
      if (e.isPitch || Math.abs(rv) > 1e-9) {
        rows.push({
          paId: pa.id, inning: pa.inning, half: pa.half, battingTeamId: pa.battingTeamId,
          batter: pa.batter, pitcher: pa.pitcher, batSide: pa.batSide, pitchHand: pa.pitchHand,
          isPitch: e.isPitch, call: e.call, text: e.text, pitchType: e.pitchType, pitchName: e.isPitch ? pitchShort(e.pitchType, e.pitchName) : null, speed: e.speed,
          countBefore: `${before.balls}-${before.strikes}`, outsBefore: before.outs, basesBefore: before.bases,
          zone: e.isPitch ? attackZone(e) : null, swing: e.isPitch ? SWING.test(e.call) : null,
          terminal, event: terminal ? pa.event : null,
          reBefore, reAfter, runs, rv,
          basesAfter: b2, outsAfter, ballsAfter, strikesAfter, mismatch,
        });
      }
      bases = b2; outs = outsAfter; balls = ballsAfter; strikes = strikesAfter;
      if (outs >= 3) break;
    }
    if (pa.complete && pa.outsEnd != null) { outs = pa.outsEnd; if (outs < 3) bases = pa.postBits; }
  }
  return rows;
}

/** Totals for the Run value tab. */
export function summarize(rows, game) {
  const teamIds = [game.away.team.id, game.home.team.id];
  const pitches = rows.filter((r) => r.isPitch);
  const sum = (a) => a.reduce((s, r) => s + r.rv, 0);
  const batting = {};
  for (const id of teamIds) {
    const mine = pitches.filter((r) => r.battingTeamId === id);
    const zones = {};
    for (const z of ZONES) {
      const inZ = mine.filter((r) => r.zone === z);
      const sw = inZ.filter((r) => r.swing); const tk = inZ.filter((r) => !r.swing);
      zones[z] = { n: inZ.length, swings: sw.length, swingRV: sum(sw), takeRV: sum(tk) };
    }
    batting[id] = {
      pitches: mine.length, rv: sum(mine), per100: mine.length ? (100 * sum(mine)) / mine.length : null,
      swingRV: sum(mine.filter((r) => r.swing)), takeRV: sum(mine.filter((r) => !r.swing)),
      running: sum(rows.filter((r) => !r.isPitch && r.battingTeamId === id)),
      zones,
    };
  }
  // Pitchers: run value prevented (= minus the batting side's)
  const byPitcher = new Map();
  for (const r of pitches) {
    const id = r.pitcher?.id; if (!id) continue;
    if (!byPitcher.has(id)) byPitcher.set(id, { id, name: r.pitcher.name, teamId: teamIds.find((t) => t !== r.battingTeamId), pitches: 0, rv: 0, types: new Map() });
    const p = byPitcher.get(id); p.pitches += 1; p.rv -= r.rv;
    const t = r.pitchName || r.pitchType || 'Unknown';
    const ty = p.types.get(t) || { name: t, n: 0, rv: 0, speed: 0 };
    ty.n += 1; ty.rv -= r.rv; ty.speed += r.speed || 0; p.types.set(t, ty);
  }
  const pitchers = [...byPitcher.values()].map((p) => ({ ...p, per100: (100 * p.rv) / p.pitches, types: [...p.types.values()].map((t) => ({ ...t, speed: t.n ? t.speed / t.n : null })).sort((a, b) => b.n - a.n) }));
  // Running total by half-inning for each batting team
  const series = Object.fromEntries(teamIds.map((id) => [id, [{ x: 0, y: 0 }]]));
  const run = Object.fromEntries(teamIds.map((id) => [id, 0]));
  for (const r of rows) {
    if (!(r.battingTeamId in run)) continue;
    run[r.battingTeamId] += r.rv;
    series[r.battingTeamId].push({ x: r.inning - 1 + (r.half === 'top' ? 0.25 : 0.75), y: Math.round(run[r.battingTeamId] * 100) / 100 });
  }
  const biggest = [...rows].sort((a, b) => Math.abs(b.rv) - Math.abs(a.rv)).slice(0, 5);
  return { batting, pitchers, series, biggest };
}

/** Sum of run values per plate appearance (batting team's view). */
export function byPlateAppearance(rows) {
  const out = new Map();
  for (const r of rows) {
    const x = out.get(r.paId) || { rv: 0, pitches: [] };
    x.rv += r.rv; x.pitches.push(r); out.set(r.paId, x);
  }
  return out;
}
