// Turning normalized games into Podium components and short, specific text.
// Voice rules applied here: lead with the result, numerals, en dash in scores,
// sentence case (badges are uppercased by CSS).

import { scoreCard } from './components.js';
import { LEAGUES } from '../leagues.js';
import { etDay, etTime, etISODate, relativeDayLabel } from '../util/time.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Q3 4:12" (the badge adds "Live · "), "Final/OT", "Tomorrow · 4:25 PM" — the status badge text. */
export function statusText(g, { showDay = false } = {}) {
  if (g.status.state === 'in') return g.status.detail;
  if (g.status.state === 'post') return g.status.detail;
  if (!showDay || g.day === etISODate()) return g.status.detail;
  return `${relativeDayLabel(g.day)} · ${g.status.detail}`;
}

/** One line of context under the teams. */
export function footText(g) {
  const s = g.situation;
  if (g.league === 'mlb') {
    if (g.status.state === 'in' && s) {
      const outs = plural(s.outs, 'out');
      const bases = s.bases?.length ? `On ${s.bases.join(', ')}` : 'Bases empty';
      return `${outs} · ${bases}`;
    }
    if (g.status.state === 'pre' && (g.away.probable || g.home.probable)) {
      return `${g.away.probable || 'TBD'} vs ${g.home.probable || 'TBD'}`;
    }
    if (g.status.state === 'post' && g.decisions) {
      const d = g.decisions;
      return `W ${d.winner} · L ${d.loser}${d.save ? ` · S ${d.save}` : ''}`;
    }
    return null;
  }
  if (g.status.state === 'in' && s) {
    const poss = s.possession ? [g.home, g.away].find((x) => x.team.id === s.possession)?.team.abbr : null;
    const parts = [poss ? `${poss} ball` : null, s.downDistance, s.redZone ? 'Red zone' : null].filter(Boolean);
    return parts.join(' · ') || null;
  }
  if (g.status.state === 'pre' && g.neutral && g.venue) return g.venue;
  return null;
}

const cardSide = (s) => ({
  name: s.team.short || s.team.name,
  abbr: s.team.abbr,
  color: s.team.color,
  logo: s.team.logo,
  score: s.score,
  record: s.record,
  rank: s.team.rank,
});

/**
 * A ScoreCard for a game.
 *   showLeague: prefix the overline with NFL / CFB / MLB (mixed lists)
 *   showDay:    include the day for upcoming games that aren't today
 */
export function gameCard(g, { showLeague = false, showDay = false } = {}) {
  const context = [showLeague ? LEAGUES[g.league].name : null, g.note || g.broadcast]
    .filter(Boolean).join(' · ');
  const state = g.status.state === 'in' ? 'live' : g.status.state === 'post' ? 'final' : 'upcoming';
  return scoreCard({
    competition: context,
    status: state,
    clock: statusText(g, { showDay }),
    home: cardSide(g.home),
    away: cardSide(g.away),
    href: `#/game/${g.league}/${g.id}`,
    foot: footText(g),
  });
}

/** "W 45–21 at Cardinals" from one team's point of view (null if not final). */
export function resultLine(g, teamId) {
  if (g.status.state !== 'post' || !g.status.completed) return null;
  const me = g.home.team.id === String(teamId) ? g.home : g.away;
  const opp = me === g.home ? g.away : g.home;
  const outcome = me.score > opp.score ? 'W' : me.score < opp.score ? 'L' : 'T';
  const where = g.neutral ? 'vs' : me === g.home ? 'vs' : 'at';
  return { outcome, text: `${me.score}–${opp.score} ${where} ${opp.team.short || opp.team.name}` };
}

/** "Today 4:25 PM vs Packers" / "Sat 31 Oct 12:00 PM at Navy". */
export function nextLine(g, teamId) {
  const me = g.home.team.id === String(teamId) ? g.home : g.away;
  const opp = me === g.home ? g.away : g.home;
  const where = g.neutral ? 'vs' : me === g.home ? 'vs' : 'at';
  const when = g.day === etISODate() ? 'Today' : etDay(g.start);
  const time = g.status.detail === 'TBD' ? 'TBD' : etTime(g.start);
  return `${when} ${time} ${where} ${opp.team.short || opp.team.name}`;
}
