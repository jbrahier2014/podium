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

// ---------------------------------------------------------------- game detail
// The live feed is ~750 KB; asking only for the fields the screen uses brings it to ~80 KB.
const FEED_FIELDS = ['gameData', 'status', 'abstractGameState', 'detailedState', 'codedGameState', 'startTimeTBD', 'teams', 'away', 'home', 'id', 'name', 'teamName', 'abbreviation', 'venue', 'weather', 'condition', 'temp', 'wind', 'datetime', 'dateTime', 'officialDate', 'probablePitchers', 'game', 'type',
  'liveData', 'linescore', 'currentInning', 'currentInningOrdinal', 'inningState', 'scheduledInnings', 'innings', 'num', 'ordinalNum', 'runs', 'hits', 'errors', 'leftOnBase', 'outs', 'balls', 'strikes', 'offense', 'first', 'second', 'third', 'batter', 'pitcher', 'fullName', 'lastName',
  'boxscore', 'teamStats', 'batting', 'pitching', 'players', 'person', 'position', 'battingOrder', 'batters', 'pitchers', 'stats', 'seasonStats', 'atBats', 'rbi', 'baseOnBalls', 'strikeOuts', 'homeRuns', 'avg', 'obp', 'slg', 'ops', 'doubles', 'triples', 'stolenBases', 'inningsPitched', 'earnedRuns', 'pitchesThrown', 'numberOfPitches', 'era', 'note', 'summary', 'totalBases', 'plateAppearances', 'hitByPitch', 'whip', 'battersFaced',
  'plays', 'allPlays', 'result', 'description', 'event', 'awayScore', 'homeScore', 'about', 'inning', 'halfInning', 'isScoringPlay', 'atBatIndex', 'isComplete', 'scoringPlays', 'decisions', 'winner', 'loser', 'save'].join(',');

const halfLabel = (half, inning) => `${half === 'top' ? 'Top' : 'Bot'} ${ordinal(inning)}`;

/** Full game detail (see GameDetail in ../index.js). */
export async function getGame(gamePk, { force = false } = {}) {
  const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live?fields=${FEED_FIELDS}`;
  const isFinal = (d) => d?.gameData?.status?.abstractGameState === 'Final';
  const { data: f, savedAt, stale } = await cachedJSON(feedUrl, { force, ttlMs: MIN, final: isFinal });
  const gd = f.gameData || {}; const ld = f.liveData || {};
  const ls = ld.linescore || {};
  const box = ld.boxscore?.teams || {};

  // Shape the feed like a schedule game so the shared normalizer can build the header.
  const asScheduleGame = {
    gamePk, gameDate: gd.datetime?.dateTime, officialDate: gd.datetime?.officialDate, gameType: gd.game?.type,
    status: gd.status, linescore: ls, venue: gd.venue, doubleHeader: 'N',
    teams: Object.fromEntries(['away', 'home'].map((k) => [k, {
      team: gd.teams?.[k] || {}, score: ls.teams?.[k]?.runs,
      isWinner: isFinal(f) && (ls.teams?.[k]?.runs ?? 0) > (ls.teams?.[k === 'home' ? 'away' : 'home']?.runs ?? 0),
      probablePitcher: gd.probablePitchers?.[k],
    }])),
    decisions: ld.decisions,
  };
  const game = normalizeGame(asScheduleGame);

  // Line score: innings, then R H E
  const n = Math.max(ls.scheduledInnings || 9, ls.innings?.length || 0);
  const inningVal = (i, k) => {
    const inn = ls.innings?.[i];
    if (!inn) return '';
    const v = inn[k]?.runs;
    if (v != null) return String(v);
    // Home team didn't need to bat in the last inning of a finished game
    return k === 'home' && isFinal(f) && i === ls.innings.length - 1 ? 'X' : '';
  };
  const linescore = game.status.state === 'pre' ? null : {
    labels: Array.from({ length: n }, (_, i) => String(i + 1)),
    away: Array.from({ length: n }, (_, i) => inningVal(i, 'away')),
    home: Array.from({ length: n }, (_, i) => inningVal(i, 'home')),
    totalLabels: ['R', 'H', 'E'],
    awayTotals: ['runs', 'hits', 'errors'].map((k) => ls.teams?.away?.[k] ?? 0),
    homeTotals: ['runs', 'hits', 'errors'].map((k) => ls.teams?.home?.[k] ?? 0),
  };

  // Plays, scoring plays
  const all = ld.plays?.allPlays || [];
  const teamIdFor = (half) => String(half === 'top' ? gd.teams?.away?.id : gd.teams?.home?.id);
  const scoring = (ld.plays?.scoringPlays || []).map((i) => all[i]).filter(Boolean).map((p) => ({
    period: halfLabel(p.about.halfInning, p.about.inning),
    clock: '',
    teamId: teamIdFor(p.about.halfInning),
    type: '',
    text: p.result?.description,
    away: p.result?.awayScore, home: p.result?.homeScore,
  }));
  const halves = [];
  for (const p of all) {
    if (!p.result?.description) continue;
    const key = `${p.about.halfInning}-${p.about.inning}`;
    let g = halves[halves.length - 1];
    if (!g || g.key !== key) { g = { key, teamId: teamIdFor(p.about.halfInning), title: halfLabel(p.about.halfInning, p.about.inning), items: [] }; halves.push(g); }
    g.items.push({ meta: `${p.result.event || ''}`, text: p.result.description, scoring: !!p.about.isScoringPlay, score: `${p.result.awayScore}–${p.result.homeScore}` });
  }
  const plays = halves.reverse().map((g) => {
    const lastItem = g.items[g.items.length - 1];
    return { teamId: g.teamId, title: g.title, sub: lastItem ? `${game.away.team.abbr} ${lastItem.score.replace('–', `, ${game.home.team.abbr} `)}` : '', scoring: g.items.some((x) => x.scoring), items: g.items.slice().reverse() };
  });

  // Win probability per plate appearance (separate small endpoint)
  let winProb = [];
  if (game.status.state !== 'pre') {
    try {
      const { data: wp } = await cachedJSON(`https://statsapi.mlb.com/api/v1/game/${gamePk}/winProbability?fields=homeTeamWinProbability,about,inning,halfInning,atBatIndex`, {
        force, ttlMs: MIN, final: () => isFinal(f),
      });
      const total = Math.max(n, ls.currentInning || 0);
      winProb = (Array.isArray(wp) ? wp : []).map((w, i, arr) => {
        // x = innings elapsed (top half = first half of the inning)
        const sameHalf = arr.filter((q) => q.about?.inning === w.about?.inning && q.about?.halfInning === w.about?.halfInning);
        const pos = sameHalf.indexOf(w) + 1;
        const x = (w.about.inning - 1) + (w.about.halfInning === 'top' ? 0 : 0.5) + 0.5 * (pos / sameHalf.length);
        return { x: Math.min(x, total), home: Math.round(w.homeTeamWinProbability * 10) / 10, label: halfLabel(w.about.halfInning, w.about.inning), i };
      });
    } catch { winProb = []; }
  }

  // Team stats comparison
  const tb = (k) => box[k]?.teamStats?.batting || {};
  const tp = (k) => box[k]?.teamStats?.pitching || {};
  const row = (label, a, h, lower = false, fmt) => ({ label, away: Number(a) || 0, home: Number(h) || 0, awayDisplay: fmt ? fmt(a) : String(a ?? 0), homeDisplay: fmt ? fmt(h) : String(h ?? 0), lowerIsBetter: lower });
  const teamStats = game.status.state === 'pre' ? [] : [
    row('Hits', tb('away').hits, tb('home').hits),
    row('Home runs', tb('away').homeRuns, tb('home').homeRuns),
    row('Walks', tb('away').baseOnBalls, tb('home').baseOnBalls),
    row('Strikeouts (batting)', tb('away').strikeOuts, tb('home').strikeOuts, true),
    row('Left on base', tb('away').leftOnBase, tb('home').leftOnBase, true),
    row('Stolen bases', tb('away').stolenBases, tb('home').stolenBases),
    row('Errors', ls.teams?.away?.errors, ls.teams?.home?.errors, true),
    row('Pitches thrown', tp('away').numberOfPitches, tp('home').numberOfPitches, true),
  ];

  // Box score: batters in order, then pitchers
  const boxFor = (k) => {
    const t = box[k]; if (!t) return [];
    const P = (id) => t.players?.[`ID${id}`] || {};
    const batters = (t.batters || []).map(P).filter((p) => p.battingOrder);
    const pitchers = (t.pitchers || []).map(P);
    return [
      { title: 'Batting', labels: ['AB', 'R', 'H', 'RBI', 'BB', 'K', 'AVG'],
        rows: batters.map((p) => {
          const b = p.stats?.batting || {};
          const sub = Number(p.battingOrder) % 100 !== 0;
          return { name: `${sub ? '  ' : ''}${p.person?.fullName?.split(' ').slice(-1)[0] || ''} ${p.position?.abbreviation || ''}`.trimEnd(), sub, values: [b.atBats, b.runs, b.hits, b.rbi, b.baseOnBalls, b.strikeOuts, p.seasonStats?.batting?.avg].map((v) => v ?? '') };
        }),
        totals: [tb(k).atBats, tb(k).runs, tb(k).hits, tb(k).rbi, tb(k).baseOnBalls, tb(k).strikeOuts, ''].map((v) => v ?? '') },
      { title: 'Pitching', labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC', 'ERA'],
        rows: pitchers.map((p) => {
          const s = p.stats?.pitching || {};
          return { name: `${p.person?.fullName?.split(' ').slice(-1)[0] || ''}${s.note ? ` ${s.note}` : ''}`, values: [s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts, s.homeRuns, s.numberOfPitches ?? s.pitchesThrown, p.seasonStats?.pitching?.era].map((v) => v ?? '') };
        }),
        totals: null },
    ];
  };
  const boxOut = game.status.state === 'pre' ? null : { away: boxFor('away'), home: boxFor('home') };

  const info = [
    ['Venue', gd.venue?.name],
    ['Broadcast', game.broadcast],
    ['Probable pitchers', game.status.state === 'pre' && (gd.probablePitchers?.away || gd.probablePitchers?.home)
      ? `${gd.probablePitchers?.away?.fullName || 'TBD'} vs ${gd.probablePitchers?.home?.fullName || 'TBD'}` : null],
    ['Weather', gd.weather?.temp ? `${gd.weather.temp}°F, ${gd.weather.condition}${gd.weather.wind && !/^0 mph/.test(gd.weather.wind) ? `, wind ${gd.weather.wind}` : ''}` : null],
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));

  return { game, linescore, scoring, plays, winProb, teamStats, box: boxOut, info, savedAt, stale };
}

// ---------------------------------------------------------------- standings
const LEAGUE_NAME = { 103: 'American League', 104: 'National League' };
const SPLIT_LABELS = [['home', 'Home'], ['away', 'Away'], ['lastTen', 'Last 10'], ['oneRun', 'One-run games'], ['extraInning', 'Extra innings'], ['winners', 'vs winning teams'], ['left', 'vs left-handed starters'], ['right', 'vs right-handed starters']];

/** Standings by division and wild card. Same shape as the ESPN provider's getStandings. */
export async function getStandings({ force = false } = {}) {
  const season = seasonYear('mlb');
  const url = `${BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team`;
  const { data } = await cachedJSON(url, { ttlMs: 10 * MIN, force });
  const records = new Map();
  const cols = [{ key: 'w', label: 'W' }, { key: 'l', label: 'L' }, { key: 'pct', label: 'Pct' }, { key: 'gb', label: 'GB' }, { key: 'l10', label: 'L10' }, { key: 'strk', label: 'Strk' }, { key: 'rd', label: 'RD' }];
  const division = []; const byLeague = { 103: [], 104: [] };

  for (const rec of data.records || []) {
    const rows = (rec.teamRecords || []).map((tr) => {
      const split = Object.fromEntries((tr.records?.splitRecords || []).map((s) => [s.type, `${s.wins}-${s.losses}`]));
      const team = { ...normalizeTeam({ ...tr.team, id: tr.team.id }), rank: null };
      records.set(team.id, [
        { label: 'Overall', value: `${tr.wins}-${tr.losses}` },
        ...SPLIT_LABELS.filter(([k]) => split[k]).map(([k, label]) => ({ label, value: split[k] })),
        { label: 'Run differential', value: tr.runDifferential > 0 ? `+${tr.runDifferential}` : String(tr.runDifferential) },
        { label: 'Runs scored / allowed', value: `${tr.runsScored} / ${tr.runsAllowed}` },
      ]);
      const row = {
        team,
        rank: Number(tr.divisionRank),
        wcRank: Number(tr.wildCardRank) || null,
        divisionLeader: !!tr.divisionLeader,
        clinch: tr.clinchIndicator || null,
        values: {
          w: tr.wins, l: tr.losses, pct: tr.winningPercentage, gb: tr.gamesBack, wcgb: tr.wildCardGamesBack,
          l10: split.lastTen || '', strk: tr.streak?.streakCode || '', rd: tr.runDifferential > 0 ? `+${tr.runDifferential}` : String(tr.runDifferential),
        },
      };
      byLeague[rec.league?.id]?.push(row);
      return row;
    }).sort((a, b) => a.rank - b.rank);
    division.push({ name: DIVISIONS[rec.division?.id] || 'Division', columns: cols, rows });
  }
  // Show AL divisions then NL, East / Central / West
  const order = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
  division.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  const wcCols = [{ key: 'w', label: 'W' }, { key: 'l', label: 'L' }, { key: 'pct', label: 'Pct' }, { key: 'wcgb', label: 'WCGB' }, { key: 'l10', label: 'L10' }, { key: 'strk', label: 'Strk' }];
  const wildcard = [103, 104].map((lg) => {
    const rows = byLeague[lg].filter((r) => !r.divisionLeader).sort((a, b) => (a.wcRank || 99) - (b.wcRank || 99)).map((r, i) => ({ ...r, rank: i + 1 }));
    return { name: `${LEAGUE_NAME[lg]} wild card`, columns: wcCols, rows, cutAfter: 3 };
  });
  return { views: { division: { label: 'Division', groups: division }, wildcard: { label: 'Wild card', groups: wildcard } }, records };
}

// ---------------------------------------------------------------- roster
const POS_GROUP = (p) => (p === 'P' || p === 'TWP' ? 'Pitchers' : p === 'C' ? 'Catchers' : ['1B', '2B', '3B', 'SS', 'IF'].includes(p) ? 'Infielders' : ['LF', 'CF', 'RF', 'OF'].includes(p) ? 'Outfielders' : 'Designated hitters');

/** Active roster grouped by position. Same shape as the ESPN provider's getRoster. */
export async function getRoster(teamId) {
  const { data } = await cachedJSON(`${BASE}/teams/${teamId}/roster?rosterType=active&hydrate=person`, { ttlMs: 6 * 60 * MIN });
  const groups = new Map(['Pitchers', 'Catchers', 'Infielders', 'Outfielders', 'Designated hitters'].map((g) => [g, []]));
  for (const r of data.roster || []) {
    const p = r.person || {};
    const pos = r.position?.abbreviation || p.primaryPosition?.abbreviation || '';
    groups.get(POS_GROUP(pos)).push({
      name: p.fullName,
      jersey: r.jerseyNumber || '',
      pos,
      detail: [p.batSide && p.pitchHand ? `B/T ${p.batSide.code}/${p.pitchHand.code}` : null, p.currentAge ? `${p.currentAge} yrs` : null, p.height, p.weight ? `${p.weight} lbs` : null].filter(Boolean).join(' · '),
    });
  }
  return { groups: [...groups].filter(([, players]) => players.length).map(([name, players]) => ({ name, players: players.sort((a, b) => Number(a.jersey) - Number(b.jersey)) })) };
}

// ---------------------------------------------------------------- team season stats (with league ranks)
const HIT_ROWS = [
  ['avg', 'Batting average', true], ['obp', 'On-base %', true], ['slg', 'Slugging %', true], ['ops', 'OPS', true],
  ['runs', 'Runs', true], ['homeRuns', 'Home runs', true], ['stolenBases', 'Stolen bases', true],
  ['__k', 'Strikeout rate', false], ['__bb', 'Walk rate', true], ['babip', 'BABIP', true],
];
const PIT_ROWS = [
  ['era', 'ERA', false], ['whip', 'WHIP', false], ['__pk', 'Strikeout rate', true], ['__pbb', 'Walk rate', false],
  ['homeRuns', 'Home runs allowed', false], ['avg', 'Opponent average', false], ['saves', 'Saves', true], ['blownSaves', 'Blown saves', false],
];

function derive(stat, key) {
  const pa = stat.plateAppearances || stat.battersFaced;
  if (key === '__k' || key === '__pk') return pa ? (stat.strikeOuts / pa) * 100 : null;
  if (key === '__bb' || key === '__pbb') return pa ? (stat.baseOnBalls / pa) * 100 : null;
  const v = stat[key];
  return v == null ? null : Number(v);
}
const display = (key, v) => (v == null ? '–' : key.startsWith('__') ? `${v.toFixed(1)}%` : ['avg', 'obp', 'slg', 'ops', 'babip'].includes(key) ? v.toFixed(3).replace(/^0/, '') : ['era', 'whip'].includes(key) ? v.toFixed(2) : String(Math.round(v)));
const ord = (n) => ordinal(n);

/** Season stats with league ranks (1 = best of 30). Resolves to { groups: [{ name, rows: [{ label, value, rank }] }] }. */
export async function getTeamStats(teamId) {
  const season = seasonYear('mlb');
  const league = (group) => cachedJSON(`${BASE}/teams/stats?season=${season}&group=${group}&stats=season&sportIds=1`, { ttlMs: 60 * MIN }).then((r) => r.data.stats?.[0]?.splits || []);
  const [hit, pit] = await Promise.all([league('hitting'), league('pitching')]);
  const build = (splits, rows) => {
    const mine = splits.find((s) => String(s.team?.id) === String(teamId));
    if (!mine) return [];
    return rows.map(([key, label, higherBetter]) => {
      const v = derive(mine.stat, key);
      const all = splits.map((s) => derive(s.stat, key)).filter((x) => x != null);
      const better = all.filter((x) => (higherBetter ? x > v : x < v)).length;
      return { label, value: display(key, v), rank: v == null ? null : `${ord(better + 1)}` };
    });
  };
  return { groups: [{ name: 'Hitting', rows: build(hit, HIT_ROWS) }, { name: 'Pitching', rows: build(pit, PIT_ROWS) }].filter((g) => g.rows.length), ranked: true };
}
