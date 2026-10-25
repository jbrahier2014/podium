// Runs in the GitHub Action (not in the app).
// ESPN's team-list endpoints don't allow browser (CORS) access, so the Action
// fetches them here and saves data/teams/nfl.json and data/teams/cfb.json,
// which the app reads from this site.

import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const SOURCES = {
  nfl: `${BASE}/nfl/teams?limit=100`,
  cfb: `${BASE}/college-football/teams?groups=80&limit=1000`, // groups=80 → FBS only
};
const hex = (c) => (c ? `#${String(c).replace(/^#/, '')}` : null);

await mkdir('data/teams', { recursive: true });

for (const [league, url] of Object.entries(SOURCES)) {
  const res = await fetch(url, { headers: { 'User-Agent': 'podium-stats-app (personal use)' } });
  if (!res.ok) throw new Error(`${league}: HTTP ${res.status} from ${url}`);
  const json = await res.json();
  const teams = (json?.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: t }) => ({
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
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Sanity check so a bad response never wipes out a good saved list
  const min = league === 'nfl' ? 32 : 120;
  if (teams.length < min) throw new Error(`${league}: only ${teams.length} teams returned (expected at least ${min})`);

  await writeFile(`data/teams/${league}.json`, JSON.stringify({ league, source: url, teams }, null, 1) + '\n');
  console.log(`${league}: ${teams.length} teams`);
}
