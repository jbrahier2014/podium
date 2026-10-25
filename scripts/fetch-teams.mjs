// Runs in the GitHub Action (not in the app).
// ESPN's team-list endpoints don't allow browser (CORS) access, so the Action
// fetches them here and saves data/teams/nfl.json and data/teams/cfb.json,
// which the app reads from this site.

import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const SOURCES = {
  nfl: `${BASE}/nfl/teams?limit=100`,
  // This returns every college program (the FBS filter is ignored), so the
  // list is trimmed to FBS using the standings below.
  cfb: `${BASE}/college-football/teams?limit=1000`,
};
// FBS standings (group 80): exactly the FBS teams, with their conferences.
const FBS_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80';
const UA = { headers: { 'User-Agent': 'podium-stats-app (personal use)' } };

async function fbsConferences() {
  const res = await fetch(FBS_STANDINGS, UA);
  if (!res.ok) throw new Error(`FBS standings: HTTP ${res.status}`);
  const root = await res.json();
  const map = new Map(); // team id -> { conference, conferenceAbbr, division }
  for (const conf of root.children ?? []) {
    const walk = (node) => {
      for (const e of node.standings?.entries ?? []) {
        map.set(String(e.team.id), {
          conference: conf.name,
          conferenceAbbr: conf.abbreviation || null,
          division: node !== conf ? node.name : null,
        });
      }
      (node.children ?? []).forEach(walk);
    };
    walk(conf);
  }
  return map;
}
const hex = (c) => (c ? `#${String(c).replace(/^#/, '')}` : null);

await mkdir('data/teams', { recursive: true });

const fbs = await fbsConferences();
console.log(`FBS standings: ${fbs.size} teams`);

for (const [league, url] of Object.entries(SOURCES)) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`${league}: HTTP ${res.status} from ${url}`);
  const json = await res.json();
  let raw = (json?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((r) => r.team);
  if (league === 'cfb') raw = raw.filter((t) => fbs.has(String(t.id)));
  const teams = raw.map((t) => ({
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
    ...(league === 'cfb' ? fbs.get(String(t.id)) : {}),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Sanity check so a bad response never wipes out a good saved list
  const [min, max] = league === 'nfl' ? [32, 32] : [120, 160];
  if (teams.length < min || teams.length > max) throw new Error(`${league}: ${teams.length} teams returned (expected ${min}–${max})`);

  await writeFile(`data/teams/${league}.json`, JSON.stringify({ league, source: url, teams }, null, 1) + '\n');
  console.log(`${league}: ${teams.length} teams`);
}
