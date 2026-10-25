// MLB Stats API (statsapi.mlb.com) — official, free, CORS-enabled.
// Everything MLB-API-specific stays in this file.

import { cachedJSON } from '../../store/cache.js';
import { MLB_COLORS } from '../mlb-colors.js';
import { seasonYear } from '../../leagues.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const DAY = 24 * 60 * 60_000;

export const logoUrl = (id) => `https://www.mlbstatic.com/team-logos/${id}.svg`;

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
    division: t.division?.name,
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
