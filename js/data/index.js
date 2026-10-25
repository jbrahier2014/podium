// The one place views get data from.
//
// Views call these functions and receive normalized objects (same shape for every
// league), so swapping a provider — say, replacing ESPN — never touches the UI.
//
// Interface (filled in phase by phase):
//   getTeams(league)                    → { teams: Team[] }                          [phase 1]
//   getScoreboard(league, opts)         → { games: GameSummary[], ... }              [phase 2]
//   getTeamSchedule(league, teamId)     → { record, standing, games: GameSummary[] } [phase 2]
//   getTodayGames()                     → { [league]: GameSummary[] }                [phase 2]
//   getGame(league, gameId)             → GameDetail (box, plays, win prob)          [phase 3]
//   getStandings(league)                → { views: { id: { label, groups } }, records } [phase 4]
//   getRoster(league, teamId)           → { groups: [{ name, players }] }             [phase 4]
//   getTeamStats(league, teamId)        → { groups: [{ name, rows: [{ label, value, rank? }] }] } [phase 4]
//   getComputed(name)                   → JSON written by the GitHub Action          [phase 5]
//
// Team:  { league, id, name, short, abbr, color, altColor, logo, conference?, rank? }
//
// GameSummary:
//   { league, id, start (ISO), day (Eastern YYYY-MM-DD),
//     status: { state: 'pre'|'in'|'post', detail, completed },
//     home, away: { team: Team, score, record, winner, probable? },
//     venue, broadcast, note, neutral,
//     week?, seasonType?,                                  (football)
//     situation?: football { possession, downDistance, redZone, lastPlay }
//                 baseball { outs, bases[], balls, strikes },
//     decisions?: { winner, loser, save }                 (baseball, final) }
//
// Player stats are a later add-on: they'll get their own functions here
// (getPlayer, getPlayerStats) and their own normalized shape — nothing in the
// team-level code needs to change for that.

import * as espn from './providers/espn.js';
import * as mlb from './providers/mlb.js';
import { cachedJSON } from '../store/cache.js';
import { inSeason, seasonYear } from '../leagues.js';
import { etISODate } from '../util/time.js';

const PROVIDERS = { nfl: espn, cfb: espn, mlb };

// --- Source health: lets the app tell you when a data source is failing ---
export const SOURCES = {
  espn: { name: 'ESPN (NFL & CFB scores)', host: 'site.api.espn.com' },
  mlb: { name: 'MLB Stats API', host: 'statsapi.mlb.com' },
  computed: { name: 'Nightly stats (GitHub Action)', host: 'this site /data' },
};
const health = {}; // sourceId -> { ok, at, error }
const sourceFor = (league) => (league === 'mlb' ? 'mlb' : 'espn');

async function track(sourceId, promise) {
  try {
    const r = await promise;
    health[sourceId] = { ok: !r?.stale, at: Date.now(), error: r?.stale ? String(r.error?.message || 'Using saved copy') : null };
    return r;
  } catch (err) {
    health[sourceId] = { ok: false, at: Date.now(), error: String(err?.message || err) };
    throw err;
  }
}
export const sourceHealth = () => ({ ...health });

// --- Teams ---
export function getTeams(league) {
  return track(sourceFor(league), PROVIDERS[league].getTeams(league));
}

/** All teams across the three leagues, keyed "league:id". */
export async function getAllTeams() {
  const results = await Promise.allSettled(['nfl', 'cfb', 'mlb'].map((l) => getTeams(l)));
  const map = new Map();
  results.forEach((r) => r.status === 'fulfilled' && r.value.teams.forEach((t) => map.set(`${t.league}:${t.id}`, t)));
  return map;
}

// --- Scores ---
/**
 * Football: opts { week, seasonType, year } (omit for the current week).
 * MLB:      opts { date: 'YYYY-MM-DD' } (Eastern; defaults to today).
 * Both:     opts.force skips the cache (live polling).
 */
export function getScoreboard(league, opts = {}) {
  const p = league === 'mlb' ? mlb.getScoreboard(opts) : espn.getScoreboard(league, opts);
  return track(sourceFor(league), p);
}

export function getTeamSchedule(league, teamId, opts = {}) {
  const p = league === 'mlb' ? mlb.getTeamSchedule(teamId, opts) : espn.getTeamSchedule(league, teamId, opts);
  return track(sourceFor(league), p);
}

export const nearbyMlbDates = (date) => mlb.nearbyGameDates(date);

export function getStandings(league, opts = {}) {
  return track(sourceFor(league), league === 'mlb' ? mlb.getStandings(opts) : espn.getStandings(league, opts));
}

export function getRoster(league, teamId) {
  return track(sourceFor(league), league === 'mlb' ? mlb.getRoster(teamId) : espn.getRoster(league, teamId));
}

export function getTeamStats(league, teamId) {
  return track(sourceFor(league), league === 'mlb' ? mlb.getTeamStats(teamId) : espn.getTeamStats(league, teamId, seasonYear(league)));
}

/** Full detail for one game (box score, plays, win probability...). opts.force skips the cache. */
export function getGame(league, gameId, opts = {}) {
  const p = league === 'mlb' ? mlb.getGame(gameId, opts) : espn.getGame(league, gameId, opts);
  return track(sourceFor(league), p);
}

/** Today's games (Eastern date) for every in-season league. */
export async function getTodayGames({ force = false } = {}) {
  const today = etISODate();
  const leagues = ['nfl', 'cfb', 'mlb'].filter((l) => inSeason(l));
  const results = await Promise.allSettled(leagues.map((l) =>
    getScoreboard(l, l === 'mlb' ? { date: today, force } : { force })));
  const out = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out[leagues[i]] = r.value.games.filter((g) => g.day === today);
  });
  return out;
}

// --- Helpers shared by screens ---
const STATE_ORDER = { in: 0, pre: 1, post: 2 };

/** Live first, then upcoming by start time, then finished (most recent first). */
export function sortGames(games) {
  return [...games].sort((a, b) => {
    const s = STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state];
    if (s) return s;
    const t = Date.parse(a.start) - Date.parse(b.start);
    return a.status.state === 'post' ? -t : t;
  });
}

/** Should the screen keep polling? True while a game is live or due to start. */
export function needsLiveUpdates(games) {
  const soon = Date.now() + 2 * 60_000;
  return games.some((g) => g.status.state === 'in' ||
    (g.status.state === 'pre' && g.status.detail !== 'TBD' && Date.parse(g.start) <= soon && Date.parse(g.start) > Date.now() - 6 * 3600_000));
}

/** JSON files produced by the scheduled GitHub Action (relative to the site). */
export function getComputed(path, { ttlMs = 30 * 60_000 } = {}) {
  return track('computed', cachedJSON(`data/${path}`, { ttlMs }));
}
