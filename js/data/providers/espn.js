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

// ---------------------------------------------------------------- game detail
const STAT_ROWS = [
  // [ESPN stat name, label, how to compare, lower is better?]
  ['totalYards', 'Total yards'],
  ['netPassingYards', 'Passing yards'],
  ['rushingYards', 'Rushing yards'],
  ['yardsPerPlay', 'Yards per play'],
  ['firstDowns', 'First downs'],
  ['thirdDownEff', '3rd down', 'ratio'],
  ['fourthDownEff', '4th down', 'ratio'],
  ['redZoneAttempts', 'Red zone (made-att)', 'ratio'],
  ['completionAttempts', 'Comp/att', 'ratio', false, '/'],
  ['sacksYardsLost', 'Sacks allowed', 'first', true],
  ['turnovers', 'Turnovers', 'num', true],
  ['totalPenaltiesYards', 'Penalties', 'first', true],
  ['possessionTime', 'Possession', 'time'],
];

function statValue(display, kind, sep = '-') {
  const s = String(display ?? '').trim();
  if (kind === 'time') { const [m, sec] = s.split(':').map(Number); return (m || 0) * 60 + (sec || 0); }
  if (kind === 'ratio') { const [a, b] = s.split(sep).map(Number); return b ? a / b : 0; }
  if (kind === 'first') return Number(s.split('-')[0]) || 0;
  return Number(s) || 0;
}

const clockSeconds = (c) => { const [m, s] = String(c || '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

/** Minutes of game time elapsed at a play (regulation quarters are 15 min). */
function elapsedMinutes(play) {
  const p = play?.period?.number || 1;
  const len = p <= 4 ? 15 : 10;
  const base = p <= 4 ? (p - 1) * 15 : 60 + (p - 5) * 10;
  return base + (len - clockSeconds(play?.clock?.displayValue) / 60);
}

/**
 * Full game detail (see GameDetail in ../index.js).
 */
export async function getGame(league, gameId, { force = false } = {}) {
  const url = `${BASE}/${PATH[league]}/summary?event=${gameId}`;
  const { data: j, savedAt, stale } = await cachedJSON(url, {
    force,
    ttlMs: MIN,
    final: (d) => !!d.header?.competitions?.[0]?.status?.type?.completed,
  });
  const idx = await teamIndex(league);
  const comp = j.header?.competitions?.[0] || {};
  // Live situation: who has the ball and the down/distance after the last play
  const cur = j.drives?.current;
  const lastPlay = cur?.plays?.[cur.plays.length - 1];
  const possessor = comp.competitors?.find((c) => c.possession);
  const situation = j.situation || (cur ? {
    possession: possessor?.team?.id || cur.team?.id,
    downDistanceText: lastPlay?.end?.downDistanceText,
    isRedZone: lastPlay?.end?.yardsToEndzone != null && lastPlay.end.yardsToEndzone <= 20,
    lastPlay: { text: lastPlay?.text },
  } : undefined);
  const ev = { id: gameId, date: comp.date, season: j.header?.season, week: j.header?.week, competitions: [{
    ...comp,
    venue: j.gameInfo?.venue,
    situation,
    competitors: (comp.competitors || []).map((c) => ({ ...c, curatedRank: c.rank ? { current: c.rank } : c.curatedRank, records: Array.isArray(c.record) ? c.record : c.records })),
  }] };
  const game = normalizeEvent(league, ev, idx);
  const abbrToId = new Map((comp.competitors || []).map((c) => [c.team?.abbreviation, String(c.team?.id)]));
  const sideOf = (teamId) => (teamId === game.home?.team.id ? 'home' : 'away');

  // Line score
  const n = Math.max(4, ...(comp.competitors || []).map((c) => c.linescores?.length || 0));
  const per = (s) => Array.from({ length: n }, (_, i) => s?.linescores?.[i]?.displayValue ?? '');
  const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
  const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
  const linescore = game.status.state === 'pre' ? null : {
    labels: Array.from({ length: n }, (_, i) => (i < 4 ? String(i + 1) : i === 4 ? 'OT' : `${i - 3}OT`)),
    away: per(awayC), home: per(homeC),
    totalLabels: ['T'], awayTotals: [game.away?.score ?? ''], homeTotals: [game.home?.score ?? ''],
  };

  // Scoring summary
  const scoring = (j.scoringPlays || []).map((p) => ({
    period: periodLabel(p.period?.number || 1),
    clock: p.clock?.displayValue || '',
    teamId: abbrToId.get(p.team?.abbreviation) || String(p.team?.id || ''),
    type: p.type?.abbreviation || '',
    text: p.text,
    away: p.awayScore, home: p.homeScore,
  }));

  // Drives and plays (newest first)
  const drives = [...(j.drives?.previous || []), ...(j.drives?.current ? [j.drives.current] : [])];
  const uniqueDrives = drives.filter((d, i) => drives.findIndex((x) => x.id === d.id) === i);
  const playById = new Map();
  uniqueDrives.forEach((d) => (d.plays || []).forEach((p) => playById.set(String(p.id), p)));
  const plays = uniqueDrives.slice().reverse().map((d) => {
    const teamId = String(d.team?.id || abbrToId.get(d.team?.abbreviation) || '');
    return {
      teamId,
      title: d.displayResult || d.result || (d === j.drives?.current ? 'In progress' : 'Drive'),
      sub: d.description || '',
      scoring: !!d.isScore,
      items: (d.plays || []).slice().reverse().map((p) => ({
        meta: `${periodLabel(p.period?.number || 1)} ${p.clock?.displayValue || ''}${p.start?.downDistanceText ? ` · ${p.start.downDistanceText}` : ''}`,
        text: p.text,
        scoring: !!p.scoringPlay,
      })),
    };
  });

  // Win probability (home team, 0-100) against game minutes
  const wpRaw = j.winprobability || [];
  const winProb = wpRaw.map((w, i) => {
    const play = playById.get(String(w.playId));
    return {
      x: play ? elapsedMinutes(play) : null,
      home: Math.round((w.homeWinPercentage ?? 0.5) * 1000) / 10,
      label: play ? `${periodLabel(play.period?.number || 1)} ${play.clock?.displayValue || ''}` : '',
      i,
    };
  });
  // Fill any points without a matching play by interpolating between neighbors.
  winProb.forEach((pt, i) => {
    if (pt.x != null) return;
    const prev = winProb.slice(0, i).reverse().find((q) => q.x != null);
    const next = winProb.slice(i + 1).find((q) => q.x != null);
    pt.x = prev && next ? (prev.x + next.x) / 2 : prev ? prev.x : next ? next.x : 0;
  });

  // Team stats comparison
  const boxTeams = j.boxscore?.teams || [];
  const statsFor = (side) => boxTeams.find((t) => t.homeAway === side) || boxTeams.find((t) => String(t.team?.id) === game[side]?.team.id);
  const awayStats = statsFor('away'); const homeStats = statsFor('home');
  const pick = (t, name) => t?.statistics?.find((s) => s.name === name)?.displayValue;
  const teamStats = (awayStats && homeStats) ? STAT_ROWS.filter(([name]) => pick(awayStats, name) != null).map(([name, label, kind = 'num', lower = false, sep]) => ({
    label,
    away: statValue(pick(awayStats, name), kind, sep), home: statValue(pick(homeStats, name), kind, sep),
    awayDisplay: String(pick(awayStats, name)).trim(), homeDisplay: String(pick(homeStats, name)).trim(),
    lowerIsBetter: lower,
  })) : [];

  // Box score: player lines by category
  const WANT = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'punting'];
  const TITLES = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', defensive: 'Defense', interceptions: 'Interceptions', kicking: 'Kicking', punting: 'Punting' };
  const boxFor = (teamId) => {
    const t = (j.boxscore?.players || []).find((p) => String(p.team?.id) === teamId);
    if (!t) return [];
    return WANT.map((cat) => t.statistics?.find((s) => s.name === cat)).filter((s) => s && s.athletes?.length).map((s) => ({
      title: TITLES[s.name] || s.name,
      labels: s.labels || [],
      rows: s.athletes.slice(0, s.name === 'defensive' ? 8 : 6).map((a) => ({ name: a.athlete?.shortName || a.athlete?.displayName, values: a.stats || [] })),
      totals: s.totals || null,
    }));
  };
  const box = game.status.state === 'pre' ? null : { away: boxFor(game.away.team.id), home: boxFor(game.home.team.id) };

  // Game info
  const pc = j.pickcenter?.[0];
  const w = j.gameInfo?.weather;
  const info = [
    ['Venue', [j.gameInfo?.venue?.fullName, j.gameInfo?.venue?.address?.city].filter(Boolean).join(', ')],
    ['Broadcast', game.broadcast],
    ['Line', pc?.details ? `${pc.details}${pc.overUnder ? ` · O/U ${pc.overUnder}` : ''}` : null],
    ['Weather', w?.temperature != null ? `${w.temperature}°F${w.conditionId && !/^\d+$/.test(w.conditionId) ? `, ${w.conditionId}` : ''}` : null],
    ['Attendance', j.gameInfo?.attendance ? Number(j.gameInfo.attendance).toLocaleString('en-US') : null],
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));

  return { game, linescore, scoring, plays, winProb, teamStats, box, info, savedAt, stale, sideOf };
}
