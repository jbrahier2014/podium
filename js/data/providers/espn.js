// ESPN public endpoints (unofficial) for the NFL and college football.
// Everything ESPN-specific stays in this file: if ESPN changes or breaks, only this
// provider needs replacing — the rest of the app talks to ../index.js and gets the
// normalized shapes documented there.

import { cachedJSON } from '../../store/cache.js';
import { etTime, etISODate, etDay } from '../../util/time.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const PATH = { nfl: 'nfl', cfb: 'college-football' };

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const hex = (c) => (c ? `#${String(c).replace(/^#/, '')}` : null);

function normalizeTeam(league, t) {
  return {
    league,
    id: String(t.id),
    name: t.displayName,
    short: t.shortDisplayName || t.name || t.displayName,
    abbr: t.abbreviation,
    location: t.location,
    nickname: t.name,
    color: hex(t.color),
    altColor: hex(t.alternateColor),
    logo: t.logos?.[0]?.href || t.logo || null,
  };
}

// ---------------------------------------------------------------- team lists
// ESPN's team-list endpoints block browser (CORS) requests, so the GitHub Action
// saves them to data/teams/<league>.json on this site (see scripts/fetch-teams.mjs).
// The direct ESPN request stays as a fallback in case that ever changes.
export async function getTeams(league) {
  try {
    const { data, stale, savedAt } = await cachedJSON(`data/teams/${league}.json`, { ttlMs: DAY });
    if (data?.teams?.length) return { teams: data.teams, stale, savedAt };
  } catch { /* not generated yet: fall through */ }

  const url = league === 'cfb'
    ? `${BASE}/${PATH.cfb}/teams?groups=80&limit=1000`
    : `${BASE}/${PATH.nfl}/teams?limit=100`;
  const { data, stale, savedAt } = await cachedJSON(url, { ttlMs: 7 * DAY });
  const raw = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams = raw.map((r) => normalizeTeam(league, r.team)).sort((a, b) => a.name.localeCompare(b.name));
  return { teams, stale, savedAt };
}

/** Map of team id → team (from the saved lists), for colors and conferences. */
const indexCache = {};
export async function teamIndex(league) {
  if (!indexCache[league]) {
    indexCache[league] = getTeams(league)
      .then(({ teams }) => new Map(teams.map((t) => [t.id, t])))
      .catch(() => { delete indexCache[league]; return new Map(); });
  }
  return indexCache[league];
}

// ---------------------------------------------------------------- status
function periodLabel(p) {
  if (p <= 4) return `Q${p}`;
  return p === 5 ? 'OT' : `${p - 4}OT`;
}

function normalizeStatus(st, start) {
  const t = st?.type || {};
  const state = t.state === 'in' ? 'in' : t.state === 'post' ? 'post' : 'pre';
  let detail;
  if (state === 'in') {
    if (t.name === 'STATUS_HALFTIME') detail = 'Half';
    else if (t.name === 'STATUS_END_PERIOD') detail = `End ${periodLabel(st.period)}`;
    else detail = `${periodLabel(st.period)} ${st.displayClock}`;
  } else if (state === 'post') {
    detail = /postponed/i.test(t.description) ? 'Postponed' : /cancel/i.test(t.description) ? 'Canceled' : (t.shortDetail || 'Final');
  } else {
    detail = /TBD/i.test(t.detail || '') ? 'TBD' : etTime(start);
  }
  return { state, detail, completed: !!t.completed, period: st?.period, clock: st?.displayClock };
}

// ---------------------------------------------------------------- games
function scoreOf(c) {
  if (c.score == null) return null;
  const v = typeof c.score === 'object' ? c.score.value : Number(c.score);
  return Number.isFinite(v) ? v : null;
}

function recordOf(c) {
  const total = c.records?.find((r) => r.type === 'total' || r.name === 'overall') || c.records?.[0];
  return total?.summary || c.record?.[0]?.displayValue || null;
}

function side(league, c, idx) {
  const known = idx?.get(String(c.team.id));
  const base = normalizeTeam(league, c.team);
  const rank = c.curatedRank?.current;
  return {
    team: {
      ...base,
      color: base.color || known?.color || null,
      altColor: base.altColor || known?.altColor || null,
      conference: known?.conference || null,
      rank: rank && rank <= 25 ? rank : null,
    },
    score: scoreOf(c),
    record: recordOf(c),
    winner: c.winner === true,
  };
}

/** One ESPN event → normalized GameSummary (see ../index.js). */
export function normalizeEvent(league, ev, idx) {
  const comp = ev.competitions?.[0] || {};
  const start = ev.date || comp.date;
  const status = normalizeStatus(comp.status || ev.status, start);
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  const sit = comp.situation;
  const broadcast = comp.broadcasts?.flatMap((b) => b.names || []).join(', ')
    || comp.geoBroadcasts?.map((g) => g.media?.shortName).filter(Boolean).join(', ') || null;
  return {
    league,
    id: String(ev.id),
    start,
    day: etISODate(start),
    status,
    home: home ? side(league, home, idx) : null,
    away: away ? side(league, away, idx) : null,
    neutral: !!comp.neutralSite,
    conferenceGame: !!comp.conferenceCompetition,
    venue: comp.venue?.fullName || null,
    broadcast,
    note: comp.notes?.[0]?.headline || null,
    week: ev.week?.number ?? null,
    seasonType: ev.season?.type ?? ev.seasonType?.type ?? null,
    situation: status.state === 'in' && sit ? {
      possession: sit.possession ? String(sit.possession) : null,
      downDistance: sit.downDistanceText || null,
      redZone: !!sit.isRedZone,
      lastPlay: sit.lastPlay?.text || null,
    } : null,
  };
}

// ---------------------------------------------------------------- scoreboard
function weekCalendar(league) {
  return (league.calendar || []).filter((s) => (s.entries || []).length).map((s) => ({
    seasonType: Number(s.value),
    label: s.label,
    weeks: s.entries.map((e) => ({
      seasonType: Number(s.value),
      week: Number(e.value),
      label: e.label,
      short: e.alternateLabel || e.label,
      detail: e.detail,
      start: e.startDate,
      end: e.endDate,
    })),
  }));
}

/**
 * Scoreboard for one week.
 *   opts.week, opts.seasonType: omit both for ESPN's current week
 *   opts.force: skip the cache (live polling)
 * Resolves to { games, week, seasonType, year, calendar, savedAt, stale }.
 */
export async function getScoreboard(league, { week, seasonType, year, force = false } = {}) {
  const params = new URLSearchParams();
  if (league === 'cfb') { params.set('groups', '80'); params.set('limit', '300'); }
  if (week != null) { params.set('week', week); params.set('seasontype', seasonType ?? 2); }
  if (year) params.set('dates', year);
  const url = `${BASE}/${PATH[league]}/scoreboard?${params}`;

  const current = week == null;
  const { data, savedAt, stale } = await cachedJSON(url, {
    force,
    ttlMs: current ? MIN : 10 * MIN,
    // A past week where every game is over never changes again: keep it forever.
    final: (j) => !current && (j.events || []).length > 0 && j.events.every((e) => e.status?.type?.completed),
  });

  const idx = await teamIndex(league);
  const games = (data.events || []).map((ev) => normalizeEvent(league, ev, idx));
  return {
    games,
    week: data.week?.number ?? week ?? null,
    seasonType: data.season?.type ?? seasonType ?? null,
    year: data.season?.year ?? year ?? null,
    calendar: weekCalendar(data.leagues?.[0] || {}),
    savedAt,
    stale,
  };
}

// ---------------------------------------------------------------- team schedule
/**
 * A team's season schedule plus record and standing.
 * Resolves to { record, standing, games }.
 */
export async function getTeamSchedule(league, teamId, { force = false } = {}) {
  const url = `${BASE}/${PATH[league]}/teams/${teamId}/schedule`;
  const { data } = await cachedJSON(url, { ttlMs: 10 * MIN, force });
  const idx = await teamIndex(league);
  return {
    record: data.team?.recordSummary || null,
    standing: data.team?.standingSummary || null,
    games: (data.events || []).map((ev) => normalizeEvent(league, ev, idx)),
  };
}

export const describeWeek = (w) => (w ? `${w.label}${w.detail ? ` · ${w.detail}` : ''}` : '');
export const dayLabel = (iso) => etDay(`${iso}T16:00:00Z`);
