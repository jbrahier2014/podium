// "Worth watching": the games most likely to be close, competitive or dramatic,
// live now or coming up in the next week, across the in-season leagues.
//
// Live games score on how close they are (ESPN's live win probability when it has
// it, otherwise the margin) weighted by how late it is, plus upsets in progress.
// Upcoming games score on how close they're expected to be (the betting line, or
// Podium's ratings when there's no line) and how good the teams are (AP ranks in
// college, rating percentiles in the NFL). Postseason baseball always qualifies.
// Games involving your featured teams are always included and flagged.

import { getScoreboard, getRatings } from './index.js';
import { inSeason } from '../leagues.js';
import { pctLabel } from '../util/prob.js';

const DAY = 24 * 3600 * 1000;

/** Live and upcoming (next `days` days) games for NFL and college football. */
async function footballSlate(league, days) {
  const now = Date.now();
  const cur = await getScoreboard(league);
  let games = cur.games;
  // Early in the week ESPN's "current" week can still be the one just played
  if (!games.some((g) => g.status.state !== 'post')) {
    const weeks = cur.calendar.flatMap((s) => s.weeks);
    const next = weeks.find((w) => Date.parse(w.start) > now - DAY && !(w.week === cur.week && w.seasonType === cur.seasonType));
    if (next) games = (await getScoreboard(league, { week: next.week, seasonType: next.seasonType })).games;
  }
  return games.filter((g) => g.status.state === 'in' || (g.status.state === 'pre' && Date.parse(g.start) < now + days * DAY && Date.parse(g.start) > now - 6 * 3600_000));
}

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
 * Picks for Home. today: { league: [games] } already loaded by Home (live/today).
 * Returns [{ game, score, reasons, mine }], live first then by start time.
 */
export async function worthWatching({ today = {}, featuredIds = new Set(), limit = 6, days = 7 } = {}) {
  const leagues = ['nfl', 'cfb', 'mlb'].filter((l) => inSeason(l));
  const byId = new Map();
  const add = (g) => { if (g && (g.status.state === 'in' || g.status.state === 'pre')) byId.set(`${g.league}-${g.id}`, g); };
  Object.values(today).flat().forEach(add);
  await Promise.all(leagues.filter((l) => l !== 'mlb').map((l) => footballSlate(l, days).then((gs) => gs.forEach(add)).catch(() => {})));
  // Live games from today's scoreboard are fresher than the weekly one
  Object.values(today).flat().forEach(add);

  const rxs = {};
  await Promise.all(['nfl', 'cfb'].filter((l) => leagues.includes(l)).map((l) => getRatings(l).then((d) => { rxs[l] = ratingsIndex(d, l); }).catch(() => {})));

  const scored = [...byId.values()].map((g) => {
    const { score, reasons } = interest(g, rxs[g.league]);
    const mine = featuredIds.has(`${g.league}:${g.home?.team.id}`) || featuredIds.has(`${g.league}:${g.away?.team.id}`);
    return { game: g, score: score + (g.status.state === 'in' ? 20 : 0), reasons, mine };
  });
  // Your teams' games always make the list; the rest by score
  const mine = scored.filter((s) => s.mine);
  const rest = scored.filter((s) => !s.mine && s.score >= 35 && s.reasons.length).sort((a, b) => b.score - a.score);
  const picks = [...mine, ...rest.slice(0, Math.max(3, limit - mine.length))];
  return picks.sort((a, b) => (a.game.status.state === 'in' ? 0 : 1) - (b.game.status.state === 'in' ? 0 : 1) || Date.parse(a.game.start) - Date.parse(b.game.start));
}
