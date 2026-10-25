// Data sources: a live check that every source the app relies on is reachable
// from this device. If one fails, this screen says so.

import { h, clear } from '../util/dom.js';
import { etISODate } from '../util/time.js';
import { badge, button } from '../ui/components.js';
import { pageTitle } from './common.js';

const CHECKS = [
  { name: 'ESPN · NFL scoreboard', url: () => 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    read: (j) => `${j.events?.length ?? 0} games this week` },
  { name: 'ESPN · College football scoreboard', url: () => 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80',
    read: (j) => `${j.events?.length ?? 0} FBS games this week` },
  { name: 'MLB Stats API · schedule', url: () => `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${etISODate()}`,
    read: (j) => `${j.totalGames ?? 0} games today` },
  { name: 'Team lists (this site)', url: () => 'data/teams/cfb.json',
    read: (j) => `${j.teams?.length ?? 0} FBS teams saved by the GitHub Action` },
  { name: 'Nightly stats (this site)', url: () => 'data/meta.json',
    read: (j) => (j.generatedAt ? `Last run ${new Date(j.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` : 'Not generated yet') },
];

export default {
  async render(ctx) {
    ctx.setTitle('Data sources');
    const list = h('div', { class: 'list' });
    const run = () => {
      clear(list);
      for (const c of CHECKS) {
        const slot = h('span', {}, badge('Checking'));
        const detail = h('div', { class: 'sub' }, '');
        list.append(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, h('div', { class: 'title' }, c.name), detail), slot));
        const t0 = performance.now();
        fetch(c.url(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((j) => {
            slot.replaceChildren(badge('OK', 'win'));
            detail.textContent = `${c.read(j)} · ${Math.round(performance.now() - t0)} ms`;
          })
          .catch((err) => {
            slot.replaceChildren(badge('Failed', 'strong'));
            detail.textContent = err.name === 'TypeError' ? 'Blocked or unreachable (network or CORS)' : err.message;
          });
      }
    };
    ctx.el.append(
      ...pageTitle('Data sources', 'A live check from this device'),
      list,
      h('div', { style: { margin: 'var(--space-4) var(--gutter) 0' } }, button('Check again', { variant: 'secondary', onclick: run })),
      h('p', { class: 'footnote' }, 'Advanced stats (CollegeFootballData, nflverse, Baseball Savant) are fetched by the nightly GitHub Action, not your phone. They show up under Nightly stats.'),
    );
    run();
  },
};
