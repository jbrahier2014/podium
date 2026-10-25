// League definitions: names, season windows, and which season "year" a date belongs to.
// Season windows include the postseason, with a little padding on each side.

import { etISODate } from './util/time.js';

export const LEAGUES = {
  nfl: {
    id: 'nfl', name: 'NFL', longName: 'National Football League', sport: 'football',
    // Sep 1 – Feb 15 (regular season + playoffs + Super Bowl)
    window: { start: '09-01', end: '02-15' },
    periodUnit: 'week',
  },
  cfb: {
    id: 'cfb', name: 'CFB', longName: 'College Football (FBS)', sport: 'football',
    // Aug 20 – Jan 25 (Week 0 through the national championship)
    window: { start: '08-20', end: '01-25' },
    periodUnit: 'week',
  },
  mlb: {
    id: 'mlb', name: 'MLB', longName: 'Major League Baseball', sport: 'baseball',
    // Mar 18 – Nov 8 (opening day through the World Series)
    window: { start: '03-18', end: '11-08' },
    periodUnit: 'day',
  },
};

export const LEAGUE_IDS = ['nfl', 'cfb', 'mlb'];

/** Is the league in season on this date (Eastern)? */
export function inSeason(leagueId, date = new Date()) {
  const { start, end } = LEAGUES[leagueId].window;
  const md = etISODate(date).slice(5);
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

/**
 * The season label a date belongs to. Football seasons are named for the year
 * they start (the 2026 NFL season ends in Feb 2027); MLB uses the calendar year.
 */
export function seasonYear(leagueId, date = new Date()) {
  const [y, m] = etISODate(date).split('-').map(Number);
  if (leagueId === 'mlb') return y;
  return m <= 7 ? y - 1 : y;
}

/** The current season plus the three before it, newest first. */
export function storedSeasons(leagueId, date = new Date()) {
  const s = seasonYear(leagueId, date);
  return [s, s - 1, s - 2, s - 3];
}

/** League ids ordered with in-season leagues first (stable within each group). */
export function leaguesBySeason(date = new Date()) {
  return [...LEAGUE_IDS].sort((a, b) => Number(inSeason(b, date)) - Number(inSeason(a, date)));
}
