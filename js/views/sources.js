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

const JOB_SOURCES = {
  cfb: { name: 'College football (CollegeFootballData)', keys: { advanced: 'Advanced stats', sp: 'SP+', season_stats: 'Season stats', drives: 'Drives', talent: 'Talent', returning: 'Returning production' } },
  nfl: { name: 'NFL (nflverse play-by-play)', keys: { pbp: 'Play-by-play' } },
  mlb: { name: 'MLB (Stats API + Baseball Savant)', keys: { statsapi: 'MLB Stats API', savant: 'Baseball Savant Statcast' } },
};

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
    const job = h('div');
    fetch(`data/meta.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((meta) => {
      const rows = [];
      for (const [lg, src] of Object.entries(JOB_SOURCES)) {
        const m = meta.leagues?.[lg];
        if (!m) continue;
        const problems = [...(m.errors || []), ...Object.entries(m.status || {}).filter(([k, v]) => src.keys[k] && v !== 'ok').map(([k, v]) => `${src.keys[k]}: ${v}`)];
        rows.push(h('div', { class: 'list-item' },
          h('span', { class: 'grow' }, h('div', { class: 'title' }, src.name),
            h('div', { class: 'sub' }, problems.length ? problems.join(' \u00b7 ') : `Through ${m.asOf || '\u2013'} \u00b7 seasons ${(m.seasons || []).join(', ')}`)),
          problems.length ? badge('Problem', 'strong') : badge('OK', 'win')));
      }
      for (const [lg, name] of [['nfl', 'Expected points model, NFL (nflverse)'], ['cfb', 'Expected points model, college (cfbfastR)']]) {
        const e = meta.ep?.[lg];
        if (!e) continue;
        rows.push(h('div', { class: 'list-item' },
          h('span', { class: 'grow' }, h('div', { class: 'title' }, name),
            h('div', { class: 'sub' }, e.ok ? `Fitted ${String(e.fitted || '').slice(0, 10)} \u00b7 R\u00b2 ${e.r2 ?? '\u2013'} \u00b7 off by ${e.mae ?? '\u2013'} points on average` : `${e.error || 'Not fitted'}`.slice(0, 300))),
          e.ok ? badge('OK', 'win') : badge('Problem', 'strong')));
      }
      if (rows.length) job.append(h('div', { class: 'group-label' }, 'Nightly job sources'), h('div', { class: 'list' }, rows));
    }).catch(() => {});
    ctx.el.append(
      ...pageTitle('Data sources', 'A live check from this device'),
      list,
      job,
      h('div', { style: { margin: 'var(--space-4) var(--gutter) 0' } }, button('Check again', { variant: 'secondary', onclick: run })),
      h('p', { class: 'footnote' }, 'Advanced stats (CollegeFootballData, nflverse, Baseball Savant) are fetched by the nightly GitHub Action, not your phone. They show up under Nightly stats.'),
    );
    run();
  },
};
