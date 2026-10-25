// MLB Stats API (statsapi.mlb.com) — official, free, CORS-enabled.
// Everything MLB-API-specific stays in this file; it returns the same normalized
// shapes as the ESPN provider (see ../index.js).

import { cachedJSON } from '../../store/cache.js';
import { MLB_COLORS } from '../mlb-colors.js';
import { seasonYear } from '../../leagues.js';
import { etTime, etISODate } from '../../util/time.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const logoUrl = (id) => `https://www.mlbstatic.com/team-logos/${id}.svg`;

const DIVISIONS = {
  200: 'AL West', 201: 'AL East', 202: 'AL Central',
  203: 'NL West', 204: 'NL East', 205: 'NL Central',
};

function normalizeTeam(t) {
  const [color, altColor] = MLB_COLORS[t.id] || [null, null];
  return {
    league: 'mlb',
    id: String(t.id),
    name: t.name,
    short: t.teamName || t.clubName || t.name,
    abbr: t.abbreviation,
    location: t.locationName,
    nickname: t.teamName,
    color, altColor,
    logo: logoUrl(t.id),
    division: DIVISIONS[t.division?.id] || t.division?.name,
    leagueName: t.league?.name,
  };
}

export async function getTeams() {
  const season = seasonYear('mlb');
  const url = `${BASE}/teams?sportId=1&season=${season}`;
  const { data, stale, savedAt } = await cachedJSON(url, { ttlMs: 7 * DAY });
  const teams = (data?.teams ?? []).map(normalizeTeam).sort((a, b) => a.name.localeCompare(b.name));
  return { teams, stale, savedAt };
}

// ---------------------------------------------------------------- status
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;
const lastName = (p) => (p?.lastName || p?.fullName?.split(' ').slice(-1)[0] || '');

function normalizeStatus(g) {
  const s = g.status || {};
  const ls = g.linescore || {};
  const abstract = s.abstractGameState;
  if (abstract === 'Live' && s.detailedState !== 'Warmup' && s.detailedState !== 'Pre-Game') {
    const half = { Top: 'Top', Bottom: 'Bot', Middle: 'Mid', End: 'End' }[ls.inningState] || '';
    const detail = ls.currentInning ? `${half} ${ls.currentInningOrdinal || ordinal(ls.currentInning)}`.trim() : s.detailedState;
    return { state: 'in', detail, completed: false, inning: ls.currentInning, inningHalf: ls.inningState };
  }
  if (abstract === 'Final') {
    const special = /postponed|cancel|suspended/i.test(s.detailedState) ? s.detailedState.replace(/:.*$/, '') : null;
    const extra = ls.currentInning && ls.scheduledInnings && ls.currentInning > ls.scheduledInnings ? `/${ls.currentInning}` : '';
    return { state: 'post', detail: special || `Final${extra}`, completed: !special };
  }
  return { state: 'pre', detail: s.startTimeTBD ? 'TBD' : etTime(g.gameDate), completed: false };
}

// ---------------------------------------------------------------- games
function side(g, k, postseason) {
  const t = g.teams[k];
  const rec = t.leagueRecord;
  return {
    team: { ...normalizeTeam(t.team), rank: null },
    score: Number.isFinite(t.score) ? t.score : null,
    // In the postseason leagueRecord is the series record, which the note already says
    record: rec && !postseason ? `${rec.wins}-${rec.losses}` : null,
    winner: t.isWinner === true,
    probable: t.probablePitcher ? lastName(t.probablePitcher) : null,
  };
}

/** One MLB game → normalized GameSummary (see ../index.js). */
export function normalizeGame(g) {
  const status = normalizeStatus(g);
  const postseason = !['R', 'S', 'E'].includes(g.gameType);
  const ls = g.linescore || {};
  const off = ls.offense || {};
  const bases = ['first', 'second', 'third'].filter((b) => off[b]).map((b) => ({ first: '1st', second: '2nd', third: '3rd' })[b]);
  const dec = g.decisions || {};
  const tv = (g.broadcasts || []).filter((b) => b.type === 'TV' && b.language !== 'es').map((b) => b.name.split(' / ')[0]);
  const series = g.seriesStatus;
  return {
    league: 'mlb',
    id: String(g.gamePk),
    start: g.gameDate,
    day: g.officialDate || etISODate(g.gameDate),
    status,
    home: side(g, 'home', postseason),
    away: side(g, 'away', postseason),
    neutral: false,
    venue: g.venue?.name || null,
    broadcast: [...new Set(tv)].join(', ') || null,
    note: postseason && series ? `${series.shortDescription}${series.result ? ` · ${series.result}` : ''}` : (g.doubleHeader !== 'N' ? `Game ${g.gameNumber} of doubleheader` : null),
    situation: status.state === 'in' ? {
      outs: ls.outs ?? 0,
      bases,
      balls: ls.balls, strikes: ls.strikes,
    } : null,
    decisions: status.state === 'post' && dec.winner ? {
      winner: lastName(dec.winner), loser: lastName(dec.loser), save: dec.save ? lastName(dec.save) : null,
    } : null,
  };
}

const HYDRATE = 'linescore,team,probablePitcher,decisions,seriesStatus,broadcasts(all)';

/**
 * Every game on one date (Eastern, YYYY-MM-DD).
 * Resolves to { games, date, savedAt, stale }.
 */
export async function getScoreboard({ date = etISODate(), force = false } = {}) {
  const url = `${BASE}/schedule?sportId=1&date=${date}&hydrate=${HYDRATE}`;
  const past = date < etISODate();
  const { data, savedAt, stale } = await cachedJSON(url, {
    force,
    ttlMs: past ? 10 * MIN : MIN,
    // A past date where every game is final never changes: keep it forever.
    final: (j) => past && (j.dates?.[0]?.games || []).every((g) => g.status?.abstractGameState === 'Final'),
  });
  const games = (data.dates || []).flatMap((d) => d.games).map(normalizeGame);
  return { games, date, savedAt, stale };
}

/** The nearest dates with games before and after a date (for "no games" jumps). */
export async function nearbyGameDates(date) {
  const shift = (n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const url = `${BASE}/schedule?sportId=1&startDate=${shift(-14)}&endDate=${shift(14)}&fields=dates,date,totalGames`;
  const { data } = await cachedJSON(url, { ttlMs: 30 * MIN });
  const dates = (data.dates || []).filter((d) => d.totalGames > 0).map((d) => d.date);
  return { prev: dates.filter((d) => d < date).pop() || null, next: dates.find((d) => d > date) || null };
}

// ---------------------------------------------------------------- team schedule & standings
const SCHEDULE_FIELDS = 'dates,date,games,gamePk,gameDate,officialDate,gameType,doubleHeader,gameNumber,status,abstractGameState,detailedState,startTimeTBD,teams,away,home,team,id,name,teamName,abbreviation,score,isWinner,leagueRecord,wins,losses,linescore,currentInning,currentInningOrdinal,inningState,scheduledInnings,seriesStatus,shortDescription,result,venue';

async function standingsIndex(season) {
  const url = `${BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`;
  const { data } = await cachedJSON(url, { ttlMs: 30 * MIN });
  const map = new Map();
  for (const rec of data.records || []) {
    for (const tr of rec.teamRecords || []) {
      map.set(String(tr.team.id), {
        divisionRank: Number(tr.divisionRank),
        division: DIVISIONS[rec.division?.id] || '',
        wins: tr.wins, losses: tr.losses,
        gamesBack: tr.gamesBack,
      });
    }
  }
  return map;
}

/** A team's season schedule plus record and standing. Resolves to { record, standing, games }. */
export async function getTeamSchedule(teamId, { force = false } = {}) {
  const season = seasonYear('mlb');
  const url = `${BASE}/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R,F,D,L,W&hydrate=linescore,team,seriesStatus&fields=${SCHEDULE_FIELDS}`;
  const [{ data }, standings] = await Promise.all([
    cachedJSON(url, { ttlMs: 10 * MIN, force }),
    standingsIndex(season).catch(() => new Map()),
  ]);
  const st = standings.get(String(teamId));
  return {
    record: st ? `${st.wins}-${st.losses}` : null,
    standing: st ? `${ordinal(st.divisionRank)} in ${st.division}` : null,
    games: (data.dates || []).flatMap((d) => d.games).map(normalizeGame),
  };
}
