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
    odds: parseOdds(comp.odds?.[0], home, away),
    // Live win probability for the home team (0..1), when ESPN has it
    winProbHome: status.state === 'in' && sit?.lastPlay?.probability?.homeWinPercentage != null ? Number(sit.lastPlay.probability.homeWinPercentage) : null,
    postseason: Number(ev.season?.type ?? ev.seasonType?.type) === 3,
    situation: status.state === 'in' && sit ? {
      possession: sit.possession ? String(sit.possession) : null,
      downDistance: sit.downDistanceText || null,
      redZone: !!sit.isRedZone,
      lastPlay: sit.lastPlay?.text || null,
    } : null,
  };
}

/**
 * Betting line from ESPN's scoreboard ("MIA -7.5", "EVEN"):
 * { favorite: teamId|null, line: points (>= 0), total, text }.
 */
function parseOdds(o, home, away) {
  if (!o?.details) return null;
  const text = String(o.details).trim();
  if (/^even|pk|pick/i.test(text)) return { favorite: null, line: 0, total: o.overUnder ?? null, text: 'Pick\u2019em' };
  const m = text.match(/^([A-Z0-9&]+)\s+(-?\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const byAbbr = [home, away].find((c) => c?.team?.abbreviation === m[1]);
  return { favorite: byAbbr ? String(byAbbr.team.id) : null, line: Math.abs(Number(m[2])), total: o.overUnder ?? null, text };
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
  const live = comp.status?.type?.state === 'in';
  const plays = uniqueDrives.slice().reverse().map((d, i) => {
    const teamId = String(d.team?.id || abbrToId.get(d.team?.abbreviation) || '');
    return {
      teamId,
      title: d.displayResult || d.result || (live && i === 0 ? 'Current drive' : 'Drive'),
      sub: d.description || '',
      scoring: !!d.isScore,
      items: (d.plays || []).slice().reverse().map((p) => ({
        id: String(p.id),
        meta: `${periodLabel(p.period?.number || 1)} ${p.clock?.displayValue || ''}${p.start?.downDistanceText ? ` · ${p.start.downDistanceText}` : ''}`,
        text: p.text,
        scoring: !!p.scoringPlay,
      })),
    };
  });

  // Chronological plays with field position, for expected points (js/data/ep.js)
  const toSecs = (c) => { const m = String(c?.displayValue || '').match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : Number(c?.value) || 0; };
  const spot = (x) => (x ? { down: x.down, distance: x.distance, ytg: x.yardsToEndzone, team: x.team?.id != null ? String(x.team.id) : null, text: x.downDistanceText || '' } : null);
  const pbp = [];
  uniqueDrives.forEach((d) => (d.plays || []).forEach((p) => pbp.push({
    id: String(p.id), seq: Number(p.sequenceNumber) || 0,
    period: p.period?.number || 1, clockSecs: toSecs(p.clock), clock: p.clock?.displayValue || '',
    type: p.type?.text || '', text: p.text || '',
    offense: String(p.start?.team?.id || d.team?.id || abbrToId.get(d.team?.abbreviation) || ''),
    start: spot(p.start), end: spot(p.end),
    homeScore: p.homeScore, awayScore: p.awayScore, scoring: !!p.scoringPlay,
  })));
  if (pbp.every((p) => p.seq)) pbp.sort((a, b) => a.seq - b.seq);

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

  return { game, linescore, scoring, plays, pbp, winProb, teamStats, box, info, savedAt, stale, sideOf };
}

// ---------------------------------------------------------------- standings
const STANDINGS_BASE = 'https://site.api.espn.com/apis/v2/sports/football';

function entryStats(e) {
  const by = {};
  for (const s of e.stats || []) {
    const key = s.type && s.type !== s.name.toLowerCase() ? s.type : s.name;
    if (!(key in by)) by[key] = s;
  }
  return by;
}

/**
 * Standings. Resolves to { views: { [viewId]: { label, groups: [{ name, columns, rows, cutAfter? }] } }, records }.
 * records: Map teamId -> [{ label, value }] (home, road, division, conference...)
 */
export async function getStandings(league, { force = false } = {}) {
  const url = league === 'nfl' ? `${STANDINGS_BASE}/nfl/standings?level=3` : `${STANDINGS_BASE}/college-football/standings?group=80`;
  const { data } = await cachedJSON(url, { ttlMs: 10 * MIN, force });
  const idx = await teamIndex(league);
  const teamOf = (t) => ({ ...(idx.get(String(t.id)) || normalizeTeam(league, t)), id: String(t.id) });
  const records = new Map();

  const toRow = (e) => {
    const s = entryStats(e);
    const v = (k) => s[k]?.displayValue ?? '';
    const team = teamOf(e.team);
    records.set(team.id, [
      ['Overall', v('total') || v('overall')], ['Home', v('home') || v('homerecord') || v('Home')], ['Road', v('road') || v('awayrecord') || v('Road')],
      ['Division', v('vsdiv') || v('vsdivision') || v('divisionRecord') || v('vs. Div.')], ['Conference', v('vsconf') || v('vs. Conf.')], ['vs AP Top 25', v('vsaprankedteams')],
      ['Streak', v('streak')], ['Points for', v('pointsFor') || v('pointsfor')], ['Points against', v('pointsAgainst') || v('pointsagainst')],
    ].filter(([label, value]) => value && value !== '0-0' && !(label === 'Division' && league === 'cfb')).map(([label, value]) => ({ label, value })));
    return {
      team,
      seed: Number(v('playoffSeed') || v('playoffseed')) || null,
      wins: Number(v('wins')) || 0,
      values: {
        w: v('wins'), l: v('losses'), t: v('ties'), pct: v('winPercent'),
        pf: v('pointsFor') || v('pointsfor'), pa: v('pointsAgainst') || v('pointsagainst'),
        diff: v('pointDifferential') || v('differential') || v('pointdifferential'), strk: v('streak'),
        div: v('divisionRecord') || v('vsdiv') || v('vs. Div.'), conf: v('vsconf') || v('vs. Conf.'), ovr: v('total') || v('overall'),
      },
    };
  };

  if (league === 'nfl') {
    const cols = [{ key: 'w', label: 'W' }, { key: 'l', label: 'L' }, { key: 'pct', label: 'Pct' }, { key: 'pf', label: 'PF' }, { key: 'pa', label: 'PA' }, { key: 'diff', label: 'Diff' }, { key: 'strk', label: 'Strk' }, { key: 'div', label: 'Div' }];
    const anyTies = (rows) => rows.some((r) => Number(r.values.t) > 0);
    const withTies = (rows) => (anyTies(rows) ? [cols[0], cols[1], { key: 't', label: 'T' }, ...cols.slice(2)] : cols);
    const division = []; const conference = [];
    for (const conf of data.children || []) {
      const confRows = [];
      for (const div of conf.children || []) {
        const rows = (div.standings?.entries || []).map(toRow);
        confRows.push(...rows);
        division.push({ name: div.name, columns: withTies(rows), rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
      }
      const seeded = confRows.filter((r) => r.seed).sort((a, b) => a.seed - b.seed);
      const rest = confRows.filter((r) => !r.seed);
      const all = [...seeded, ...rest];
      conference.push({ name: conf.abbreviation || conf.name, columns: withTies(all), rows: all.map((r, i) => ({ ...r, rank: r.seed || i + 1 })), cutAfter: 7 });
    }
    return { views: { division: { label: 'Division', groups: division }, conference: { label: 'Conference', groups: conference } }, records };
  }

  // College: one table per conference (Sun Belt shows its two divisions)
  const cols = [{ key: 'conf', label: 'Conf' }, { key: 'ovr', label: 'Ovr' }, { key: 'pf', label: 'PF' }, { key: 'pa', label: 'PA' }, { key: 'strk', label: 'Strk' }];
  const groups = [];
  for (const conf of data.children || []) {
    const parts = conf.children?.length ? conf.children.map((d) => ({ name: d.name, entries: d.standings?.entries || [] })) : [{ name: conf.name, entries: conf.standings?.entries || [] }];
    for (const part of parts) {
      const rows = part.entries.map(toRow);
      // Independents have no conference record
      const columns = /Independent/i.test(conf.name) ? cols.filter((c) => c.key !== 'conf') : cols;
      groups.push({ name: part.name, conference: conf.name, columns, rows: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
    }
  }
  return { views: { conference: { label: 'Conference', groups } }, records };
}

// ---------------------------------------------------------------- roster
const ROSTER_GROUPS = { offense: 'Offense', defense: 'Defense', specialTeam: 'Special teams', injuredReserveOrOut: 'Injured reserve / out', suspended: 'Suspended', practiceSquad: 'Practice squad' };

/** Roster. Resolves to { groups: [{ name, players: [{ name, jersey, pos, detail }] }] }. */
export async function getRoster(league, teamId) {
  const { data } = await cachedJSON(`${BASE}/${PATH[league]}/teams/${teamId}/roster`, { ttlMs: 12 * 60 * MIN });
  const groups = (data.athletes || []).filter((g) => g.items?.length).map((g) => ({
    name: ROSTER_GROUPS[g.position] || g.position,
    players: g.items.map((a) => ({
      name: a.fullName || a.displayName,
      jersey: a.jersey || '',
      pos: a.position?.abbreviation || '',
      detail: [
        league === 'cfb' ? a.experience?.displayValue : (a.age ? `${a.age} yrs` : null),
        a.displayHeight, a.displayWeight,
        league === 'nfl' ? a.college?.name : a.birthPlace?.displayText,
      ].filter(Boolean).join(' · '),
    })),
  }));
  return { groups };
}

// ---------------------------------------------------------------- team season stats
// [category, ESPN stat name, label, format]
const TEAM_STAT_GROUPS = [
  ['Offense', [
    ['passing', 'yardsPerGame', 'Yards per game', 1],
    ['passing', 'netPassingYardsPerGame', 'Passing yards per game', 1],
    ['rushing', 'rushingYardsPerGame', 'Rushing yards per game', 1],
    ['__ypp', null, 'Yards per play', 2],
    ['passing', 'completionPct', 'Completion %', 1],
    ['passing', 'QBRating', 'Passer rating', 1],
    ['rushing', 'yardsPerRushAttempt', 'Yards per rush', 1],
    ['miscellaneous', 'firstDownsPerGame', 'First downs per game', 1],
    ['miscellaneous', 'thirdDownConvPct', 'Third-down %', 1],
    ['miscellaneous', 'fourthDownConvPct', 'Fourth-down %', 1],
    ['miscellaneous', 'redzoneTouchdownPct', 'Red-zone TD %', 1],
  ]],
  ['Turnovers & pressure', [
    ['miscellaneous', 'turnOverDifferential', 'Turnover margin', 0],
    ['miscellaneous', 'totalTakeaways', 'Takeaways', 0],
    ['miscellaneous', 'totalGiveaways', 'Giveaways', 0],
    ['defensive', 'sacks', 'Sacks', 0],
    ['passing', 'sacks', 'Sacks allowed', 0],
    ['defensive', 'tacklesForLoss', 'Tackles for loss', 0],
  ]],
  ['Special teams & discipline', [
    ['kicking', 'fieldGoalPct', 'Field goal %', 1],
    ['punting', 'netAvgPuntYards', 'Net punt average', 1],
    ['__pen', null, 'Penalties per game', 1],
  ]],
];

/** Season team stats. Resolves to { groups: [{ name, rows: [{ label, value }] }] }. */
export async function getTeamStats(league, teamId, season) {
  const lg = league === 'nfl' ? 'nfl' : 'college-football';
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/${lg}/seasons/${season}/types/2/teams/${teamId}/statistics`;
  const { data } = await cachedJSON(url, { ttlMs: 60 * MIN });
  const cats = Object.fromEntries((data.splits?.categories || []).map((c) => [c.name, Object.fromEntries(c.stats.map((s) => [s.name, s]))]));
  const val = (c, n) => cats[c]?.[n]?.value;
  const games = val('general', 'gamesPlayed') || val('passing', 'teamGamesPlayed') || 0;
  const fmt = (v, d) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
  const groups = TEAM_STAT_GROUPS.map(([name, rows]) => ({
    name,
    rows: rows.map(([c, n, label, d]) => {
      let v;
      if (c === '__ypp') { const plays = val('passing', 'totalOffensivePlays'); v = plays ? val('passing', 'totalYards') / plays : null; }
      else if (c === '__pen') v = games ? val('miscellaneous', 'totalPenalties') / games : null;
      else v = val(c, n);
      return { label, value: fmt(v, d), raw: v ?? null };
    }).filter((r) => r.raw != null),
  })).filter((g) => g.rows.length);
  return { groups, games };
}
