// ESPN public endpoints (unofficial) for the NFL and college football.
// Everything ESPN-specific stays in this file: if ESPN changes or breaks, only this
// provider needs replacing — the rest of the app talks to ../index.js.

import { cachedJSON } from '../../store/cache.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const PATH = { nfl: 'nfl', cfb: 'college-football' };

const DAY = 24 * 60 * 60_000;

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
    logo: t.logos?.[0]?.href || null,
  };
}

export async function getTeams(league) {
  const url = league === 'cfb'
    ? `${BASE}/${PATH.cfb}/teams?groups=80&limit=1000` // groups=80 → FBS only
    : `${BASE}/${PATH.nfl}/teams?limit=100`;
  const { data, stale, savedAt } = await cachedJSON(url, { ttlMs: 7 * DAY });
  const raw = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams = raw.map((r) => normalizeTeam(league, r.team)).sort((a, b) => a.name.localeCompare(b.name));
  return { teams, stale, savedAt };
}
