// Expected points (EP) for football, computed in the app from ESPN's live play-by-play.
//
// The model is a compact fit (data/ep/<league>.json, refreshed weekly by the nightly job)
// to the published EP of cfbfastR (college) and nflfastR (NFL): "next score" models where
// EP = sum of P(outcome) x points over TD 7, FG 3, safety 2, none 0 and the opponent's
// negatives. basis() must match scripts/stats/ep.py exactly.
//
// Exports
//   loadEP(league)                         model (or null) — college falls back to the NFL model
//   epValue(model, state)                  EP for { ytg, down, dist, secs, sd } from the offense's view
//   fourthDown(model, state)               { go, fg, punt, best, ... } in expected points
//   annotate(model, pbp, game)             per-play EPA, team summaries, cumulative series
//   halfSeconds(period, clockSecs, league)

import { getComputed } from './index.js';

const DAY = 24 * 3600 * 1000;
const cache = new Map();

export async function loadEP(league) {
  if (league !== 'nfl' && league !== 'cfb') return null;
  if (cache.has(league)) return cache.get(league);
  const p = (async () => {
    const fits = (x) => x?.coef && x.knots && x.coef.length === basis(x, 50, 1, 10, 900, 0).length;
    // A cached copy from before a model update is refetched straight away
    const get = async (lg) => {
      const load = (force) => getComputed(`ep/${lg}.json`, { ttlMs: DAY, force }).then((r) => r?.data || r).catch(() => null);
      const x = await load(false);
      return x && !fits(x) ? load(true) : x;
    };
    let m = await get(league);
    if (!m?.coef && league === 'cfb') {
      const nfl = await get('nfl');
      if (nfl?.coef) m = { ...nfl, league: 'cfb', borrowed: true, fg: [4.7, -0.09], conv: [0.7, -0.7], punt: null, punt_net: 38, fg_miss: 'line_of_scrimmage' };
    }
    // A model fitted for a different basis (e.g. mid-update) is ignored rather than misread
    return fits(m) ? m : null;
  })();
  cache.set(league, p);
  return p;
}

// ---------------------------------------------------------------- basis (mirror of ep.py)
function basis(m, ytg, down, dist, secs, sd) {
  ytg = Math.min(99, Math.max(1, ytg));
  dist = Math.max(1, Math.min(dist, ytg));
  secs = Math.min(1800, Math.max(0, secs));
  sd = Math.min(28, Math.max(-28, sd)) / 14;
  const u = ytg / 100;
  const ld = Math.log(dist);
  const goal = dist >= ytg ? 1 : 0;
  const t = secs / 1800;
  const late = Math.min(1, Math.max(0, 1 - secs / 180));
  const vlate = Math.min(1, Math.max(0, 1 - secs / 40));
  const k = m.knots;
  let j = 0;
  while (j < k.length - 2 && ytg >= k[j + 1]) j++;
  const w = (ytg - k[j]) / (k[j + 1] - k[j]);
  const x = [];
  for (let d = 1; d <= 4; d++) {
    const on = down === d ? 1 : 0;
    for (let i = 0; i < k.length; i++) x.push(on * (i === j ? 1 - w : i === j + 1 ? w : 0));
    x.push(ld * on, ld * u * on, goal * on, (dist / 10) * on, (dist / 10) * u * on);
  }
  x.push(late, late * u, late * u * u, vlate, vlate * u, t, t * u, sd, sd * late, sd * t);
  return x;
}

export function epValue(m, { ytg, down, dist, secs = 900, sd = 0 }) {
  const x = basis(m, ytg, down, dist, secs, sd);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * m.coef[i];
  return Math.max(-7, Math.min(7, s));
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const fgProb = (m, ytg) => sigmoid(m.fg[0] + m.fg[1] * (ytg + 17));
export const convProb = (m, dist) => sigmoid(m.conv[0] + m.conv[1] * Math.log(Math.max(1, Math.min(30, dist))));

/** Opponent's yards to goal after a punt from ytg. Fitted table where available. */
function puntResult(m, ytg) {
  const tbl = (m.punt || []).filter((p) => p[1] != null);
  if (tbl.length >= 3) {
    if (ytg <= tbl[0][0]) return tbl[0][1];
    if (ytg >= tbl[tbl.length - 1][0]) return tbl[tbl.length - 1][1];
    for (let i = 0; i < tbl.length - 1; i++) {
      const [a, va] = tbl[i]; const [b, vb] = tbl[i + 1];
      if (ytg >= a && ytg <= b) return va + (vb - va) * ((ytg - a) / (b - a));
    }
  }
  const land = ytg - (m.punt_net || 40);
  return land < 8 ? 80 : 100 - land;
}

/**
 * 4th-down comparison in expected points (next-score units, offense's view).
 *   go    p(convert) x EP(1st down past the marker, or 7 if goal to go) + (1-p) x -EP(opponent at the spot)
 *   fg    p(make) x 3 + (1-p) x -EP(opponent after a miss)
 *   punt  -EP(opponent after the punt)
 */
export function fourthDown(m, { ytg, dist, secs = 900, sd = 0 }) {
  const next = Math.max(0, secs - 6);
  const opp = (oppYtg) => -epValue(m, { ytg: oppYtg, down: 1, dist: 10, secs: next, sd: -sd });
  const p = convProb(m, dist);
  const gainTo = ytg - dist;
  const success = dist >= ytg ? 7 : epValue(m, { ytg: Math.max(1, gainTo), down: 1, dist: Math.min(10, Math.max(1, gainTo)), secs: next, sd });
  const fail = opp(Math.min(99, 100 - ytg));
  const go = { ev: p * success + (1 - p) * fail, p, success, fail };

  const kick = ytg + 17;
  let fg = null;
  if (kick <= 68) {
    const pm = fgProb(m, ytg);
    const spot = m.fg_miss === 'spot_of_kick' ? ytg + 7 : ytg;
    const miss = opp(spot <= 20 ? 80 : 100 - spot);
    fg = { ev: pm * 3 + (1 - pm) * miss, p: pm, distance: kick, miss };
  }
  const punt = ytg >= 35 ? { ev: opp(Math.min(99, Math.max(1, puntResult(m, ytg)))) } : null;

  const options = [['go', go], ['fg', fg], ['punt', punt]].filter(([, o]) => o);
  options.sort((a, b) => b[1].ev - a[1].ev);
  const best = options[0][0];
  const alt = options.find(([k]) => k !== 'go');
  // Conversion rate at which going for it equals the best kick
  const breakEven = alt && success !== fail ? (alt[1].ev - fail) / (success - fail) : null;
  return { go, fg, punt, best, margin: options.length > 1 ? options[0][1].ev - options[1][1].ev : 0, breakEven };
}

// ---------------------------------------------------------------- play-by-play
export function halfSeconds(period, clock, league) {
  if (period === 1 || period === 3) return 900 + clock;
  if (period === 2 || period === 4) return clock;
  return league === 'nfl' ? Math.min(900, clock + 300) : 900; // overtime
}
const halfOf = (period) => (period <= 2 ? 1 : period <= 4 ? 2 : 3);
const SKIP = /kickoff|extra point|two-point|2pt|timeout|end (of )?(period|half|game|quarter)|end period|coin toss|official|injury/i;
const isPass = (t) => /pass|sack|interception/i.test(t);
const isRush = (t) => /rush|run/i.test(t);

/** Is this play a scrimmage-down play the model can score? */
export const scoreable = (p) => p.start && p.start.down >= 1 && p.start.down <= 4 && p.start.ytg >= 1 && p.start.ytg <= 99 && !SKIP.test(p.type || '');

/**
 * Adds EP before/after and EPA to each scoreable play. pbp is chronological (see
 * espn.js getGame). Scores on each play are after it, so "before" scores come from
 * the previous play.
 */
export function annotate(m, pbp, game) {
  const league = game.league;
  const homeId = game.home.team.id;
  const scoreOf = (p, team) => (team === homeId ? p.homeScore : p.awayScore) ?? 0;
  const out = [];
  let prev = { homeScore: 0, awayScore: 0 };
  const plays = pbp.map((p) => { const b = prev; if (p.homeScore != null) prev = p; return { ...p, before: b }; });

  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    if (!scoreable(p) || !p.offense) continue;
    const off = p.offense;
    const defId = off === homeId ? game.away.team.id : homeId;
    const sdBefore = scoreOf(p.before, off) - scoreOf(p.before, defId);
    const secs = halfSeconds(p.period, p.clockSecs, league);
    const epBefore = epValue(m, { ytg: p.start.ytg, down: p.start.down, dist: p.start.distance, secs, sd: sdBefore });

    const dOff = scoreOf(p, off) - scoreOf(p.before, off);
    const dDef = scoreOf(p, defId) - scoreOf(p.before, defId);
    let epAfter = null;
    if (dOff >= 6) epAfter = 7;
    else if (dOff === 3) epAfter = 3;
    else if (dDef >= 6) epAfter = -7;
    else if (dDef === 2) epAfter = -2;
    else {
      const nx = plays.slice(i + 1).find((q) => scoreable(q) && q.offense);
      const sdNow = scoreOf(p, off) - scoreOf(p, defId);
      if (nx && halfOf(nx.period) !== halfOf(p.period)) epAfter = 0;
      else if (nx) {
        const v = epValue(m, { ytg: nx.start.ytg, down: nx.start.down, dist: nx.start.distance, secs: halfSeconds(nx.period, nx.clockSecs, league), sd: nx.offense === off ? sdNow : -sdNow });
        epAfter = nx.offense === off ? v : -v;
      } else if (p.end && p.end.down >= 1 && p.end.ytg >= 1 && p.end.ytg <= 99 && p.end.team) {
        // Latest play of a live game: use where it ended
        const v = epValue(m, { ytg: p.end.ytg, down: p.end.down, dist: p.end.distance || 10, secs: Math.max(0, secs - 6), sd: p.end.team === off ? sdNow : -sdNow });
        epAfter = p.end.team === off ? v : -v;
      } else if (game.status.state === 'post' || /punt|field goal|turnover|fumble|interception/i.test(p.type)) {
        epAfter = null; // unknown: leave unscored rather than guess
      }
    }
    const epa = epAfter == null ? null : epAfter - epBefore;
    const kind = /punt/i.test(p.type) ? 'punt' : /field goal/i.test(p.type) ? 'fg' : isPass(p.type) ? 'pass' : isRush(p.type) ? 'rush' : /penalty/i.test(p.type) ? 'penalty' : 'other';
    out.push({ ...p, secs, sd: sdBefore, epBefore, epAfter, epa, kind, success: epa != null ? epa > 0 : null });
  }
  return out;
}

/** Per-team totals and the running EPA series for the chart. */
export function summarize(rows, game) {
  const ids = [game.away.team.id, game.home.team.id];
  const teams = {};
  for (const id of ids) {
    const mine = rows.filter((r) => r.offense === id && r.epa != null && (r.kind === 'pass' || r.kind === 'rush'));
    const pass = mine.filter((r) => r.kind === 'pass'); const rush = mine.filter((r) => r.kind === 'rush');
    const avg = (a) => (a.length ? a.reduce((s, r) => s + r.epa, 0) / a.length : null);
    teams[id] = {
      plays: mine.length,
      total: rows.filter((r) => r.offense === id && r.epa != null).reduce((s, r) => s + r.epa, 0),
      perPlay: avg(mine), pass: avg(pass), rush: avg(rush),
      success: mine.length ? mine.filter((r) => r.epa > 0).length / mine.length : null,
      explosive: mine.filter((r) => r.epa >= 2).length,
    };
  }
  // Running net EPA for each offense, against game minutes
  const series = { [ids[0]]: [{ x: 0, y: 0 }], [ids[1]]: [{ x: 0, y: 0 }] };
  const run = { [ids[0]]: 0, [ids[1]]: 0 };
  const minuteOf = (r) => (r.period <= 4 ? (r.period - 1) * 15 + (15 - r.clockSecs / 60) : 60 + (r.period - 5) * 10 + (10 - Math.min(600, r.clockSecs) / 60));
  for (const r of rows) {
    if (r.epa == null || !series[r.offense]) continue;
    run[r.offense] += r.epa;
    series[r.offense].push({ x: Math.round(minuteOf(r) * 10) / 10, y: Math.round(run[r.offense] * 100) / 100, label: r.text });
  }
  const biggest = rows.filter((r) => r.epa != null).sort((a, b) => Math.abs(b.epa) - Math.abs(a.epa)).slice(0, 5);
  return { teams, series, biggest };
}
