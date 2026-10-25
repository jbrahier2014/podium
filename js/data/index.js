// The one place views get data from.
//
// Views call these functions and receive normalized objects (same shape for every
// league), so swapping a provider — say, replacing ESPN — never touches the UI.
//
// Planned interface (filled in phase by phase):
//   getTeams(league)                    → { teams: Team[] }                   [phase 1]
//   getScoreboard(league, dateOrWeek)   → { games: GameSummary[] }            [phase 2]
//   getGame(league, gameId)             → GameDetail (box, plays, win prob)   [phase 3]
//   getTeam(league, teamId)             → TeamDetail (schedule, roster, ...)  [phase 4]
//   getStandings(league)                → Standings                           [phase 4]
//   getComputed(name)                   → JSON written by the GitHub Action   [phase 5]
//
// Team shape: { league, id, name, short, abbr, color, altColor, logo }
//
// Player stats are a later add-on: they'll get their own functions here
// (getPlayer, getPlayerStats) and their own normalized shape — nothing in the
// team-level code needs to change for that.

import * as espn from './providers/espn.js';
import * as mlb from './providers/mlb.js';
import { cachedJSON } from '../store/cache.js';

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

// --- Public API ---
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

/** JSON files produced by the scheduled GitHub Action (relative to the site). */
export function getComputed(path, { ttlMs = 30 * 60_000 } = {}) {
  return track('computed', cachedJSON(`data/${path}`, { ttlMs }));
}
