// College football polls: the AP Top 25 (with others receiving votes) and the College
// Football Playoff committee rankings, for any week of a season.
//
// Source: ESPN's core API (CORS-friendly), one request per poll per week:
//   .../seasons/<y>/types/<t>/weeks/<w>/rankings        which polls exist that week
//   .../seasons/<y>/types/<t>/weeks/<w>/rankings/<id>   one poll (AP = 1, CFP = 21)
// Season type 1 = preseason, 2 = regular season, 3 = final (after the bowls).
// Week list comes from ESPN's site API (the same weeks ESPN shows).
// Past weeks never change, so they're cached for good.

import { cachedJSON } from '../store/cache.js';
import { getTeams, getRatings } from './index.js';

const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings';
const MIN = 60_000;
export const POLLS = { ap: { id: '1', label: 'AP Poll', name: 'AP Top 25' }, cfp: { id: '21', label: 'CFP', name: 'College Football Playoff rankings' } };

const https = (u) => String(u || '').replace(/^http:/, 'https:');
const teamIdOf = (t) => String(t?.id || (t?.$ref || '').match(/teams\/(\d+)/)?.[1] || '');

/**
 * Weeks with polls this season, oldest first: [{ key: '2-9', type: 2, week: 9, label: 'Week 9' }, ...].
 * Includes the preseason poll, and the final poll once it's out.
 */
export async function getPollWeeks(season) {
  const { data } = await cachedJSON(`${SITE}?seasons=${season}`, { ttlMs: 30 * MIN });
  const weeks = (data.weeks || []).map((w) => ({ type: Number(w.type), week: Number(w.week), label: w.display }));
  // Final rankings (season type 3) appear after the national championship
  try {
    const { data: fin } = await cachedJSON(`${CORE}/seasons/${season}/types/3/weeks/1/rankings`, { ttlMs: 6 * 60 * MIN });
    if (fin?.items?.length) weeks.push({ type: 3, week: 1, label: 'Final' });
  } catch { /* not out yet */ }
  const list = weeks.map((w) => ({ ...w, key: `${w.type}-${w.week}` }));
  return { season: Number(season), weeks: list, latestKey: list[list.length - 1]?.key || null };
}

/**
 * Polls for one week: { available: ['ap', 'cfp'], ap: Poll|null, cfp: Poll|null }.
 * Poll: { name, label, date, ranks: [Entry], others: [Entry], dropped: [Entry] }
 * Entry: { rank, previous, move ('up'|'down'|'same'|'new'), moveBy, team, record, points, firstPlace }
 */
export async function getPolls(season, type, week, { current = false } = {}) {
  const ttlMs = current ? 30 * MIN : 365 * 24 * 60 * MIN;
  const base = `${CORE}/seasons/${season}/types/${type}/weeks/${week}/rankings`;
  const { data: list } = await cachedJSON(base, { ttlMs, final: !current });
  const ids = new Set((list.items || []).map((it) => https(it.$ref).match(/rankings\/(\d+)/)?.[1]));
  const want = Object.entries(POLLS).filter(([, p]) => ids.has(p.id));
  const index = await teamIndex();
  // ESPN leaves records off unranked teams (0-0); for the latest poll, fill them from
  // the nightly stats. Older weeks keep only the records ESPN gives, as of that poll.
  const records = current ? await getRatings('cfb', season).then((d) => new Map(d.teams.map((t) => [String(t.id), t.record]))).catch(() => new Map()) : new Map();
  const out = { available: want.map(([k]) => k), ap: null, cfp: null };
  await Promise.all(want.map(async ([k, p]) => {
    const { data } = await cachedJSON(`${base}/${p.id}`, { ttlMs, final: !current });
    out[k] = await normalizePoll(data, p, index, records);
  }));
  return out;
}

async function teamIndex() {
  try {
    const { teams } = await getTeams('cfb');
    return new Map(teams.map((t) => [String(t.id), t]));
  } catch { return new Map(); }
}

// Teams outside the FBS list (an FCS team getting votes) are looked up once each.
async function teamFor(index, ref) {
  const id = teamIdOf(ref);
  if (index.has(id)) return index.get(id);
  try {
    const { data: t } = await cachedJSON(https(ref.$ref), { ttlMs: 30 * 24 * 60 * MIN });
    const team = { league: 'cfb', id, name: t.displayName, short: t.shortDisplayName || t.location, abbr: t.abbreviation, color: t.color ? `#${t.color}` : null, logo: t.logos?.[0]?.href || null };
    index.set(id, team);
    return team;
  } catch {
    return { league: 'cfb', id, name: `Team ${id}`, short: `Team ${id}`, abbr: '?' };
  }
}

async function normalizePoll(p, def, index, records) {
  const entry = async (r) => {
    const rank = Number(r.current) || 0;
    const previous = Number(r.previous) || 0;
    const move = !previous ? 'new' : previous === rank ? 'same' : previous > rank ? 'up' : 'down';
    return {
      rank, previous, move, moveBy: previous && rank ? Math.abs(previous - rank) : 0,
      team: await teamFor(index, r.team),
      record: [r.record?.summary, r.recordSummary].find((x) => x && x !== '0-0') || records.get(teamIdOf(r.team)) || null,
      points: Number(r.points) || 0,
      firstPlace: Number(r.firstPlaceVotes) || 0,
    };
  };
  const ranks = await Promise.all((p.ranks || []).map(entry));
  const others = (await Promise.all((p.others || []).map(entry))).sort((a, b) => b.points - a.points);
  const dropped = await Promise.all((p.droppedOut || []).map(entry));
  return {
    key: def.id === '1' ? 'ap' : 'cfp', name: p.name || def.name, label: def.label,
    week: p.occurrence?.displayValue || '', date: p.date || null,
    ranks: ranks.sort((a, b) => a.rank - b.rank), others, dropped,
  };
}
