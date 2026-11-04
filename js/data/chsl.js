// Catholic High School League (Detroit area + Toledo): football and boys basketball.
//
// Reads the files the nightly job writes (data/chsl/<sport>-<year>.json, see
// scripts/stats/chsl.py) and turns games into the same GameSummary shape the other
// leagues use, so score cards and schedule rows work unchanged.
//
//   chslSeasons()               → [{ sport, year, key }] that exist, newest first
//   loadChsl(sport, year?)      → the season file plus helpers (team map, games)
//   currentSport(seasons)       → 'fb' | 'bb', whichever is in season now
//   getTeamSchedule(id)         → { record, standing, rank, sport, games } for Home cards

import { getComputed, getMeta } from './index.js';
import { etISODate, etTime } from '../util/time.js';

export const SPORT_NAME = { fb: 'Football', bb: 'Basketball' };
const DAY = 24 * 3600 * 1000;

/** Seasons with a file, newest first: [{ sport, year, key: 'fb-2026' }]. */
export async function chslSeasons() {
  const meta = await getMeta().catch(() => null);
  return (meta?.chsl?.seasons || [])
    .map((k) => { const [sport, y] = k.split('-'); return { sport, year: Number(y), key: k }; })
    .filter((s) => SPORT_NAME[s.sport] && s.year)
    .sort((a, b) => b.year - a.year);
}

/**
 * The sport to show by default: football from August until its last game
 * (playoffs included), then basketball. Falls back to whatever has data.
 */
export function currentSport(seasons, date = new Date()) {
  const m = date.getMonth() + 1; const d = date.getDate();
  const want = m >= 7 && (m < 11 || (m === 11 && d < 25)) ? 'fb' : 'bb';
  return seasons.some((s) => s.sport === want) ? want : seasons[0]?.sport || want;
}

const cache = new Map();
/** One season, normalized. year defaults to the newest file for that sport. */
export async function loadChsl(sport, year) {
  const seasons = await chslSeasons();
  const pick = seasons.find((s) => s.sport === sport && (!year || s.year === Number(year)));
  if (!pick) throw new Error('No CHSL data yet');
  if (!cache.has(pick.key)) {
    cache.set(pick.key, getComputed(`chsl/${pick.key}.json`, { ttlMs: 30 * 60_000, final: (x) => !!x?.final })
      .then((r) => normalize(r.data))
      .catch((err) => { cache.delete(pick.key); throw err; }));
  }
  return cache.get(pick.key);
}

function normalize(data) {
  // High school logos come from many places, often on white with their own margins:
  // shown on a light plate, trimmed to the visible part (logoBox) so spacing is even
  const boxOf = (url) => (url && data.logoBoxes?.[url]) || null;
  const teams = new Map(data.teams.map((t) => [t.id, { ...t, league: 'chsl', plate: true, logoBox: boxOf(t.logo) }]));
  const teamOf = (s) => {
    const t = s.id && teams.get(s.id);
    if (t) { const logo = t.logo || s.logo || null; return { league: 'chsl', id: t.id, name: t.name, short: t.short, abbr: t.abbr, color: null, logo, logoBox: boxOf(logo), plate: true }; }
    const name = s.name || 'TBA';
    return { league: 'chsl', id: null, name, short: name, abbr: initials(name), color: null, logo: s.logo || null, logoBox: boxOf(s.logo), plate: true };
  };
  const games = data.games.map((g) => toGame(g, data, teamOf));
  return { ...data, teams, teamList: data.teams.map((t) => teams.get(t.id)), games, teamOf };
}

const initials = (name) => (name.match(/[A-Z]/g) || [name[0] || '?']).join('').slice(0, 4);

function toGame(g, data, teamOf) {
  const done = g.state === 'post';
  const side = (s) => ({ team: teamOf(s), score: s.score, winner: false });
  const home = side(g.home); const away = side(g.away);
  if (done) { home.winner = g.home.score > g.away.score; away.winner = g.away.score > g.home.score; }
  const detail = done
    ? (g.forfeit ? 'Final · Forfeit' : g.ot ? `Final/${g.ot}` : 'Final')
    : g.state === 'noscore' ? 'No score yet' : (g.tbd ? 'TBD' : etTime(g.start));
  const tags = [g.post ? (g.note || 'Playoffs') : g.note, g.league ? 'CHSL game' : null, g.scrimmage ? 'Scrimmage' : null].filter(Boolean);
  let foot = null;
  if (g.pred && !done) {
    const fav = g.pred.margin >= 0 ? home : away;
    const p = g.pred.margin >= 0 ? g.pred.homeWin : 1 - g.pred.homeWin;
    foot = `Podium line: ${fav.team.abbr} by ${Math.max(0.5, Math.round(Math.abs(g.pred.margin) * 2) / 2)} · ${Math.round(p * 100)}% to win`;
  }
  // Link to the CHSL team page of the home side (or the away side when home isn't in the league)
  const linkTeam = g.home.id || g.away.id;
  return {
    league: 'chsl', sport: data.sport, id: g.id, start: g.start, day: g.day,
    status: { state: done ? 'post' : 'pre', detail, completed: done },
    home, away, neutral: !!g.neutral, venue: null, broadcast: null,
    note: tags.join(' · ') || null, isLeague: !!g.league, post: !!g.post, scrimmage: !!g.scrimmage, pred: g.pred || null,
    href: linkTeam ? `#/chsl/${data.sport}/team/${linkTeam}` : null,
    foot,
  };
}

/** Home's featured card: the in-season sport's schedule for one CHSL team. */
export async function getTeamSchedule(id) {
  const seasons = await chslSeasons();
  if (!seasons.length) throw new Error('No CHSL data yet');
  const data = await loadChsl(currentSport(seasons));
  const t = data.teams.get(String(id));
  if (!t) throw new Error('Not in this CHSL season');
  return {
    sport: data.sport,
    record: t.record,
    standing: [SPORT_NAME[data.sport], t.division].filter(Boolean).join(' · '),
    rank: t.rank,
    logo: t.logo || null,
    logoBox: t.logoBox || null,
    games: data.games.filter((g) => !g.scrimmage && (g.home.team.id === t.id || g.away.team.id === t.id)),
  };
}

/** Football weeks run Monday to Sunday; basketball is grouped by week too. */
export function weekOf(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
  return monday.toISOString().slice(0, 10);
}

/** The week to open on: this week if it has games, else the nearest one with games. */
export function defaultWeek(games) {
  const weeks = [...new Set(games.map((g) => weekOf(g.day)))].sort();
  if (!weeks.length) return null;
  const now = weekOf(etISODate());
  if (weeks.includes(now)) return now;
  const past = weeks.filter((w) => w < now);
  return past.length ? past[past.length - 1] : weeks[0];
}
