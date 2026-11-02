// "Worth watching": on busy days, your teams' games, close finishes, and ranked or
// relevant teams in close games. Home shows them at the top of Today and leaves
// them out of the league lists below, so no game appears twice.
//
// Live games score on how close they are (ESPN's live win probability when it has
// it, otherwise the margin) weighted by how late it is, plus upsets in progress.
// Upcoming games score on how close they're expected to be (the betting line, or
// Podium's ratings when there's no line) and how good the teams are (AP ranks in
// college, rating percentiles in the NFL). Postseason baseball always qualifies.
// Games involving your featured teams are always included and flagged.

import { getRatings } from './index.js';
import { pctLabel } from '../util/prob.js';

function ratingsIndex(data, league) {
  if (!data?.teams) return null;
  const key = league === 'cfb' ? 'pred' : 'srs';
  const vals = data.teams.map((t) => t.v[key]).filter((v) => v != null).sort((a, b) => a - b);
  const pctOf = (v) => (vals.length > 1 ? vals.filter((x) => x < v).length / (vals.length - 1) : 0.5);
  const map = new Map(data.teams.map((t) => [String(t.id), t]));
  return { key, map, pctOf, hfa: data.hfa ?? (league === 'cfb' ? 2.5 : 1.8) };
}

const shortName = (s) => `${s.team.rank && s.team.rank <= 25 ? `#${s.team.rank} ` : ''}${s.team.short || s.team.name}`;

/** { score, reasons: [string] } for one game. */
export function interest(g, rx) {
  const reasons = [];
  const H = g.home; const A = g.away;
  if (!H || !A) return { score: 0, reasons };
  const ranked = (s) => s.team.rank && s.team.rank <= 25;

  if (g.league === 'mlb') {
    let score = g.postseason ? 60 : 10;
    if (g.postseason && g.note) reasons.push(g.note.replace(/\s*·.*$/, ''));
    if (g.status.state === 'in') {
      const margin = Math.abs((H.score ?? 0) - (A.score ?? 0)); const inn = g.inning || 1;
      if (margin <= 2) { score += 15 + (inn >= 7 ? 20 : 0); reasons.push(margin === 0 ? `Tied${inn >= 7 ? `, ${ordinalInning(inn)}` : ''}` : `${margin}-run game${inn >= 7 ? `, ${ordinalInning(inn)}` : ''}`); }
      if (inn > 9) { score += 15; reasons.unshift('Extra innings'); }
    }
    return { score, reasons };
  }

  // Football
  const fav = g.odds?.favorite;
  if (g.status.state === 'in') {
    const margin = Math.abs((H.score ?? 0) - (A.score ?? 0));
    const p = g.status.period || 1;
    const wp = g.winProbHome;
    const close = wp != null ? 1 - Math.abs(wp - 0.5) * 2 : Math.max(0, 1 - margin / 17);
    const late = ({ 1: 0.35, 2: 0.5, 3: 0.7, 4: 1 })[p] ?? 1.15;
    let score = 45 + 45 * close * late;
    if (p > 4) reasons.push('Overtime');
    else if (margin <= 8) reasons.push(p >= 4 ? 'One-score game, 4th quarter' : 'One-score game');
    if (wp != null && close >= 0.5) reasons.push(`Win chance ${pctLabel(Math.max(wp, 1 - wp))} for ${wp >= 0.5 ? H.team.abbr : A.team.abbr}`);
    // Upset in progress: the betting favorite (by a touchdown or more) is behind
    if (fav && g.odds.line >= 7) {
      const favSide = fav === H.team.id ? H : A; const dog = favSide === H ? A : H;
      if ((dog.score ?? 0) > (favSide.score ?? 0)) { score += 15; reasons.unshift(`Upset alert: ${shortName(dog)} leads ${shortName(favSide)}`); }
    }
    if (ranked(H) && ranked(A)) { score += 8; reasons.push(`#${Math.min(H.team.rank, A.team.rank)} vs #${Math.max(H.team.rank, A.team.rank)}`); }
    return { score, reasons: [...new Set(reasons)].slice(0, 2) };
  }

  // Upcoming: expected closeness + quality
  let line = g.odds?.line;
  let lineText = g.odds?.text || null;
  if (line == null && rx) {
    const h = rx.map.get(H.team.id); const a = rx.map.get(A.team.id);
    if (h && a && h.v[rx.key] != null && a.v[rx.key] != null) {
      const m = h.v[rx.key] - a.v[rx.key] + (g.neutral ? 0 : rx.hfa);
      line = Math.abs(m); lineText = `Podium line: ${m >= 0 ? H.team.abbr : A.team.abbr} by ${Math.max(0.5, Math.round(Math.abs(m) * 2) / 2)}`;
    }
  }
  const close = line != null ? Math.max(0, 1 - line / 14) : 0.3;
  let score = 35 * close;
  if (g.league === 'cfb') {
    const rh = ranked(H) ? H.team.rank : null; const ra = ranked(A) ? A.team.rank : null;
    if (rh && ra) { score += 25 + (rh <= 10 && ra <= 10 ? 15 : 0); reasons.push(`#${Math.min(rh, ra)} vs #${Math.max(rh, ra)}`); }
    else if (rh || ra) score += (Math.min(rh || 99, ra || 99) <= 10 ? 10 : 5);
  }
  if (rx) {
    const ph = rx.map.has(H.team.id) ? rx.pctOf(rx.map.get(H.team.id).v[rx.key]) : 0.5;
    const pa = rx.map.has(A.team.id) ? rx.pctOf(rx.map.get(A.team.id).v[rx.key]) : 0.5;
    score += 20 * Math.min(ph, pa); // both teams good
    if (g.league === 'nfl' && ph >= 0.7 && pa >= 0.7) reasons.push('Two top-10 teams by SRS');
  }
  if (line != null && line <= 3) reasons.push(line === 0 ? 'Pick’em' : `Toss-up: ${lineText}`);
  else if (line != null && line <= 7 && reasons.length < 2) reasons.push(lineText);
  return { score, reasons: reasons.filter(Boolean).slice(0, 2) };
}

const ordinalInning = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'} inning`;

/**
 * On busy days, the games for Home's "Worth watching" group. Strict: a game gets in
 * only one of three ways, and everything else stays in the league lists.
 *   1. Your teams' games (always).
 *   2. Close finishes, any teams: 4th quarter / OT within one score (8 points), or
 *      the 8th inning on within 2 runs.
 *   3. Ranked or relevant teams in a close game. Relevant = AP Top 25 (college),
 *      top 10 by SRS (NFL), postseason (MLB). Live: within one score / 2 runs, or a
 *      win chance between 30% and 70%. Upcoming: two relevant teams meeting, or a
 *      relevant team with a line of 3 or less.
 * Returns [{ game, tier, reasons, mine }]: yours, then close finishes, then the rest
 * (live before upcoming, then by start time).
 */
export async function pickFromGames(games, { featuredIds = new Set(), limit = 5 } = {}) {
  const open = games.filter((g) => g.status.state === 'in' || g.status.state === 'pre');
  const leagues = [...new Set(open.map((g) => g.league))].filter((l) => l !== 'mlb');
  const rxs = {};
  await Promise.all(leagues.map((l) => getRatings(l).then((d) => { rxs[l] = ratingsIndex(d, l); }).catch(() => {})));
  const picks = [];
  for (const g of open) {
    const H = g.home; const A = g.away;
    if (!H || !A) continue;
    const mine = featuredIds.has(`${g.league}:${H.team.id}`) || featuredIds.has(`${g.league}:${A.team.id}`);
    const c = classify(g, rxs[g.league]);
    if (mine) picks.push({ game: g, tier: 0, mine, reasons: ['Your team', ...(c?.reasons || [])].slice(0, 2) });
    else if (c) picks.push({ game: g, tier: c.tier, mine, reasons: c.reasons });
  }
  const live = (x) => (x.game.status.state === 'in' ? 0 : 1);
  picks.sort((a, b) => a.tier - b.tier || live(a) - live(b) || Date.parse(a.game.start) - Date.parse(b.game.start));
  const yours = picks.filter((x) => x.mine);
  return [...yours, ...picks.filter((x) => !x.mine).slice(0, Math.max(0, limit - yours.length))];
}

/** null, or { tier: 1 (close finish) | 2 (relevant + close), reasons } */
export function classify(g, rx) {
  const H = g.home; const A = g.away;
  const margin = Math.abs((H.score ?? 0) - (A.score ?? 0));
  const live = g.status.state === 'in';

  if (g.league === 'mlb') {
    const inn = g.inning || 1;
    const series = g.postseason && g.note ? g.note.replace(/\s*·.*$/, '') : null;
    const closeNote = margin === 0 ? `Tied, ${ordinalInning(inn)}` : `${margin}-run game, ${ordinalInning(inn)}`;
    if (live && inn >= 8 && margin <= 2) return { tier: 1, reasons: [inn > 9 ? `Extra innings, ${margin === 0 ? 'tied' : `${margin}-run game`}` : `Close finish: ${closeNote}`, series].filter(Boolean) };
    if (!g.postseason) return null;
    if (live) return margin <= 2 ? { tier: 2, reasons: [series || 'Postseason', closeNote] } : null;
    return { tier: 2, reasons: [series || 'Postseason'] };
  }

  // Football
  const rank = (s) => (s.team.rank && s.team.rank <= 25 ? s.team.rank : null);
  const pct = (s) => { const t = rx?.map.get(String(s.team.id)); return t && t.v[rx.key] != null ? rx.pctOf(t.v[rx.key]) : null; };
  const relevant = (s) => (g.league === 'cfb' ? rank(s) != null : (pct(s) ?? 0) >= 0.69);
  const tag = (s) => (g.league === 'cfb' && rank(s) ? `#${rank(s)} ${s.team.short || s.team.name}` : s.team.short || s.team.name);
  const relH = relevant(H); const relA = relevant(A);

  if (live) {
    const p = g.status.period || 1;
    const wp = g.winProbHome;
    const wpNote = wp != null ? `Win chance ${pctLabel(Math.max(wp, 1 - wp))} for ${wp >= 0.5 ? H.team.abbr : A.team.abbr}` : null;
    if (p > 4 || (p === 4 && margin <= 8)) {
      return { tier: 1, reasons: [p > 4 ? 'Overtime' : margin === 0 ? 'Close finish: tied in the 4th' : `Close finish: ${margin}-point game in the 4th`, wpNote].filter(Boolean).slice(0, 2) };
    }
    if (!(relH || relA)) return null;
    const tight = margin <= 8 || (wp != null && wp >= 0.3 && wp <= 0.7);
    if (!tight) return null;
    const who = relH && relA ? (g.league === 'cfb' ? `${tag(A)} vs ${tag(H)}` : 'Two top-10 teams by SRS') : `${tag(relH ? H : A)} in a close one`;
    return { tier: 2, reasons: [who, margin <= 8 ? (margin === 0 ? 'Tied' : `${margin}-point game`) : wpNote].filter(Boolean) };
  }

  // Upcoming
  let line = g.odds?.line; let lineText = g.odds?.text || null;
  if (line == null && rx) {
    const h = rx.map.get(String(H.team.id)); const a = rx.map.get(String(A.team.id));
    if (h && a && h.v[rx.key] != null && a.v[rx.key] != null) {
      const m = h.v[rx.key] - a.v[rx.key] + (g.neutral ? 0 : rx.hfa);
      line = Math.abs(m); lineText = `Podium line: ${m >= 0 ? H.team.abbr : A.team.abbr} by ${Math.max(0.5, Math.round(Math.abs(m) * 2) / 2)}`;
    }
  }
  const lineNote = line == null ? null : line === 0 ? 'Pick’em' : lineText;
  if (relH && relA) {
    return { tier: 2, reasons: [g.league === 'cfb' ? `#${Math.min(rank(H), rank(A))} vs #${Math.max(rank(H), rank(A))}` : 'Two top-10 teams by SRS', lineNote].filter(Boolean) };
  }
  if ((relH || relA) && line != null && line <= 3) {
    return { tier: 2, reasons: [`${tag(relH ? H : A)}, toss-up`, lineNote].filter(Boolean) };
  }
  return null;
}
