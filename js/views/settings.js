// Settings: featured teams, live refresh interval, theme, clear cache.

import { h, icon, ICONS, openSheet, toast, clear } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { cache } from '../store/cache.js';
import { getTeams } from '../data/index.js';
import { LEAGUES, LEAGUE_IDS } from '../leagues.js';
import { crest, choice, tabs, badge } from '../ui/components.js';
import { pageTitle } from './common.js';

const REFRESH_CHOICES = [15, 30, 60, 120];

export default {
  async render(ctx) {
    ctx.setTitle('Settings');
    const root = h('div');
    ctx.el.append(...pageTitle('Settings'), root);
    const draw = () => { clear(root); root.append(...build()); };
    ctx.onCleanup(settings.onChange(draw));
    draw();
  },
};

function build() {
  const s = settings.get();

  // ---- Featured teams ----
  const featuredList = h('div', { class: 'list' },
    s.featured.length ? s.featured.map((t, i) =>
      h('div', { class: 'list-item' },
        crest(t),
        h('span', { class: 'grow' }, h('div', { class: 'title' }, t.name), h('div', { class: 'sub' }, LEAGUES[t.league].name)),
        h('button', { class: 'icon-btn', 'aria-label': `Move ${t.short || t.name} up`, disabled: i === 0, onclick: () => settings.moveFeatured(i, -1) }, icon(ICONS.up)),
        h('button', { class: 'icon-btn', 'aria-label': `Remove ${t.short || t.name}`, onclick: () => settings.removeFeatured(t.league, t.id) }, icon(ICONS.minus)),
      ))
      : h('div', { class: 'list-item' }, h('span', { class: 'sub' }, 'No featured teams')),
    h('button', { class: 'list-item action', onclick: openTeamPicker },
      h('span', { class: 'list-icon' }, icon(ICONS.plus)),
      h('span', { class: 'grow' }, 'Add team')),
  );

  // ---- Cache ----
  const cacheDetail = h('span', { class: 'detail' }, '…');
  cache.count().then((n) => { cacheDetail.textContent = `${n} item${n === 1 ? '' : 's'}`; });

  return [
    h('div', { class: 'group-label' }, 'Featured teams'),
    featuredList,
    h('p', { class: 'footnote' }, 'Pinned on Home with the deepest default views. Every team stays browsable.'),

    h('div', { class: 'group-label' }, 'Live score refresh'),
    choice(REFRESH_CHOICES.map((sec) => ({ id: sec, label: sec < 60 ? `${sec}s` : `${sec / 60} min` })), s.refreshSeconds,
      (v) => settings.set({ refreshSeconds: v }), { label: 'Refresh interval' }),
    h('p', { class: 'footnote' }, 'While a game is live. Nothing refreshes when no games are on.'),

    h('div', { class: 'group-label' }, 'Team marks'),
    choice([{ id: true, label: 'Logos' }, { id: false, label: 'Color crests' }], s.logos !== false,
      (v) => settings.set({ logos: v }), { label: 'Team marks' }),
    h('p', { class: 'footnote' }, 'Logos load from ESPN and MLB. Crests are Podium\u2019s team-color squares and work offline.'),

    h('div', { class: 'group-label' }, 'Theme'),
    choice([{ id: 'dark', label: 'Arena' }, { id: 'light', label: 'Daylight' }, { id: 'system', label: 'Automatic' }], s.theme,
      (v) => settings.set({ theme: v }), { label: 'Theme' }),
    h('p', { class: 'footnote' }, 'Arena is dark, Daylight is light. Automatic follows your iPhone.'),

    h('div', { class: 'group-label' }, 'Storage'),
    h('div', { class: 'list' },
      h('div', { class: 'list-item' }, h('span', { class: 'grow title' }, 'Saved data'), cacheDetail),
      h('button', {
        class: 'list-item action',
        onclick: async () => {
          if (!confirm('Clear all saved scores and stats? They download again as you use the app.')) return;
          await cache.clear();
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith('podium-images')).map((k) => caches.delete(k)));
          }
          toast('Cache cleared');
          settings.set({}); // redraw
        },
      }, 'Clear cache'),
      h('button', {
        class: 'list-item action',
        onclick: () => { if (confirm('Reset featured teams to Notre Dame, Tigers, Lions and Broncos?')) settings.resetFeatured(); },
      }, 'Reset featured teams'),
    ),
  ];
}

// ---- Team picker sheet ----
function openTeamPicker() {
  const { body } = openSheet('Add team');
  let league = 'nfl';
  let query = '';
  let teams = [];
  const listEl = h('div', { class: 'list' });
  const statusEl = h('p', { class: 'footnote' });

  const leagueTabs = tabs(LEAGUE_IDS.map((id) => ({ id, label: LEAGUES[id].name })), league, (id) => { league = id; load(); }, { label: 'League' });
  const input = h('input', { type: 'search', placeholder: 'Search teams', autocapitalize: 'off', autocomplete: 'off', oninput: (e) => { query = e.target.value.trim().toLowerCase(); drawList(); } });
  const search = h('label', { class: 'search-field' }, icon(ICONS.search), input);

  body.append(leagueTabs, search, listEl, statusEl);

  function drawList() {
    clear(listEl);
    const shown = teams.filter((t) => !query || `${t.name} ${t.abbr} ${t.short}`.toLowerCase().includes(query));
    if (!shown.length) { listEl.append(h('div', { class: 'list-item' }, h('span', { class: 'sub' }, teams.length ? 'No matches' : 'Loading teams'))); return; }
    for (const t of shown) {
      const featured = settings.isFeatured(t.league, t.id);
      listEl.append(h('button', {
        class: 'list-item', disabled: featured,
        onclick: () => { settings.addFeatured(t); toast(`${t.short || t.name} added to Home`); drawList(); },
      },
      crest(t),
      h('span', { class: 'grow' }, h('div', { class: 'title' }, t.name)),
      featured ? badge('Featured') : h('span', { class: 'list-icon' }, icon(ICONS.plus))));
    }
  }

  async function load() {
    teams = [];
    drawList();
    statusEl.textContent = '';
    const want = league;
    try {
      const r = await getTeams(want);
      if (want !== league) return;
      teams = r.teams;
      statusEl.textContent = r.stale ? 'Saved list. The data source didn’t respond.' : `${teams.length} teams`;
    } catch (err) {
      statusEl.textContent = `Couldn’t load teams: ${err.message}`;
      clear(listEl);
    }
    drawList();
  }
  load();
}
