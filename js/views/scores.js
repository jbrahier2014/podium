// Scoreboard per league: week picker for football, date picker for MLB,
// Top 25 and conference filters for college football. Your teams come first.
// While any game is live, scores refresh on the interval set in Settings.
//
// The URL holds the selection so the back button and reloads keep it:
//   #/scores/nfl?w=2-7          season type 2 (regular), week 7
//   #/scores/cfb?w=2-8&f=top25  or f=<conference name>
//   #/scores/mlb?d=2026-10-24

import { h, clear, openSheet } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { settings } from '../store/settings.js';
import { getScoreboard, getTeams, sortGames, needsLiveUpdates, nearbyMlbDates } from '../data/index.js';
import { etISODate, etTime, addDays, relativeDayLabel } from '../util/time.js';
import { livePoller } from '../util/poller.js';
import { periodPicker, chips, button } from '../ui/components.js';
import { gameCard } from '../ui/format.js';
import { pageTitle, leagueTabs, defaultLeague, emptyState } from './common.js';
import { navigate } from '../router.js';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

function urlFor(league, q) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString();
  return `scores/${league}${qs ? `?${qs}` : ''}`;
}

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : defaultLeague();
    const q = ctx.query;
    ctx.setTitle('Scores');

    const controls = h('div');
    const body = h('div', {}, skeletonList());
    ctx.el.append(
      ...pageTitle('Scores'),
      leagueTabs(league, (id) => navigate(`scores/${id}`, { replace: true })),
      controls,
      body,
    );

    // ---- what to load ----
    let opts;
    if (league === 'mlb') {
      opts = { date: /^\d{4}-\d{2}-\d{2}$/.test(q.d || '') ? q.d : etISODate() };
    } else if (/^\d+-\d+$/.test(q.w || '')) {
      const [st, wk] = q.w.split('-').map(Number);
      opts = { seasonType: st, week: wk };
    } else {
      opts = {};
    }
    const filter = league === 'cfb' ? (q.f || 'all') : 'all';
    const load = (force = false) => getScoreboard(league, { ...opts, force });

    let result;
    try {
      result = await load();
    } catch (err) {
      clear(body);
      body.append(h('div', { class: 'notice strong' }, `Couldn’t load ${LEAGUES[league].name} scores: ${err.message}`));
      return;
    }
    if (!ctx.isCurrent()) return;

    const teamIdx = league === 'cfb' ? new Map((await getTeams('cfb').catch(() => ({ teams: [] }))).teams.map((t) => [t.id, t])) : null;

    renderControls(controls, league, opts, result, filter, teamIdx);
    renderGames(body, league, result, filter, teamIdx);

    // ---- live polling ----
    const poller = livePoller({
      initial: result.games,
      isLive: needsLiveUpdates,
      intervalMs: () => settings.get().refreshSeconds * 1000,
      tick: async () => {
        const r = await load(true);
        if (ctx.isCurrent()) { result = r; renderGames(body, league, r, filter, teamIdx); }
        return r.games;
      },
    });
    ctx.onCleanup(() => poller.stop());
  },
};

// ---------------------------------------------------------------- controls
function renderControls(el, league, opts, result, filter, teamIdx) {
  clear(el);
  if (league === 'mlb') {
    const date = opts.date;
    const go = (d) => navigate(urlFor('mlb', { d: d === etISODate() ? null : d }), { replace: true });
    const input = h('input', { type: 'date', value: date, 'aria-label': 'Pick a date', onchange: (e) => e.target.value && go(e.target.value) });
    const labelEl = h('label', { class: 'pp-label' },
      h('span', { class: 'pp-main' }, relativeDayLabel(date)),
      h('span', { class: 'pp-sub' }, `${plural(result.games.length, 'game')} · Eastern time`),
      input);
    el.append(periodPicker({ labelEl, onPrev: () => go(addDays(date, -1)), onNext: () => go(addDays(date, 1)) }));
    return;
  }

  // Football: week picker from ESPN's season calendar
  const weeks = result.calendar.flatMap((s) => s.weeks);
  const i = weeks.findIndex((w) => w.seasonType === result.seasonType && w.week === result.week);
  const cur = weeks[i];
  const keep = league === 'cfb' && filter !== 'all' ? { f: filter } : {};
  const goWeek = (w) => navigate(urlFor(league, { w: `${w.seasonType}-${w.week}`, ...keep }), { replace: true });
  el.append(periodPicker({
    label: cur ? cur.label : `Week ${result.week ?? ''}`,
    sub: [cur?.detail, 'Eastern time'].filter(Boolean).join(' · '),
    onPrev: i > 0 ? () => goWeek(weeks[i - 1]) : null,
    onNext: i >= 0 && i < weeks.length - 1 ? () => goWeek(weeks[i + 1]) : null,
    onLabel: () => openWeekSheet(result.calendar, cur, goWeek),
  }));

  if (league === 'cfb') {
    const confs = [...new Set([...teamIdx.values()].map((t) => t.conference).filter(Boolean))].sort();
    const isConf = filter !== 'all' && filter !== 'top25';
    const setFilter = (f) => navigate(urlFor('cfb', { w: cur ? `${cur.seasonType}-${cur.week}` : null, f: f === 'all' ? null : f }), { replace: true });
    const items = [
      { id: 'all', label: 'All FBS' },
      { id: 'top25', label: 'Top 25' },
      { id: isConf ? filter : '__conf', label: isConf ? shortConf(filter) : 'Conference' },
    ];
    el.append(chips(items, isConf ? filter : filter, (id) => {
      if (id === '__conf' || (isConf && id === filter)) openConferenceSheet(confs, filter, setFilter);
      else setFilter(id);
    }, { label: 'College filter' }));
  }
}

const shortConf = (name) => name.replace(/ Conference$/, '').replace('Atlantic Coast', 'ACC').replace('Southeastern', 'SEC').replace('Mid-American', 'MAC');

function openWeekSheet(calendar, cur, goWeek) {
  const { body, close } = openSheet('Pick a week');
  for (const season of calendar) {
    body.append(h('div', { class: 'group-label' }, season.label),
      h('div', { class: 'list' }, season.weeks.map((w) => {
        const selected = cur && w.seasonType === cur.seasonType && w.week === cur.week;
        return h('button', { class: 'list-item', dataset: selected ? { selected: '1' } : {}, onclick: () => { close(); goWeek(w); } },
          h('span', { class: 'grow' }, h('div', { class: 'title' }, w.label), h('div', { class: 'sub' }, w.detail || '')),
          selected ? h('span', { class: 'badge strong' }, 'Showing') : null);
      })));
  }
  requestAnimationFrame(() => body.querySelector('[data-selected]')?.scrollIntoView({ block: 'center' }));
}

function openConferenceSheet(confs, current, setFilter) {
  const { body, close } = openSheet('Conference');
  body.append(h('div', { class: 'list', style: { marginTop: 'var(--space-2)' } }, confs.map((c) =>
    h('button', { class: 'list-item', onclick: () => { close(); setFilter(c); } },
      h('span', { class: 'grow title' }, c),
      c === current ? h('span', { class: 'badge strong' }, 'Showing') : null))));
}

// ---------------------------------------------------------------- games
function applyFilter(games, filter, teamIdx) {
  if (filter === 'top25') return games.filter((g) => g.home.team.rank || g.away.team.rank);
  if (filter !== 'all' && teamIdx) {
    return games.filter((g) => [g.home, g.away].some((s) => (teamIdx.get(s.team.id)?.conference || s.team.conference) === filter));
  }
  return games;
}

function renderGames(el, league, result, filter, teamIdx) {
  clear(el);
  const games = applyFilter(result.games, filter, teamIdx);

  if (!games.length) {
    el.append(h('div', { class: 'card' }, emptyState({
      iconName: 'scoreboard',
      title: 'No games',
      text: league === 'mlb' ? `Nothing scheduled ${relativeDayLabel(result.date) === 'Today' ? 'today' : `on ${relativeDayLabel(result.date)}`}.` : filter !== 'all' ? 'No games match this filter this week.' : 'No games this week.',
    })));
    if (league === 'mlb') addJumps(el, result.date);
    return;
  }

  const featured = settings.get().featured.filter((t) => t.league === league).map((t) => t.id);
  const mine = games.filter((g) => featured.includes(g.home.team.id) || featured.includes(g.away.team.id));
  const rest = games.filter((g) => !mine.includes(g));

  const section = (label, list, showDay) => [
    ...(label ? [h('div', { class: 'group-label' }, label)] : []),
    h('div', { class: 'game-list' }, sortGames(list).map((g) => gameCard(g, { showDay }))),
  ];

  if (mine.length) el.append(...section('Your teams', mine, league !== 'mlb'));

  if (league === 'mlb') {
    el.append(...section(mine.length ? 'All games' : null, rest, false));
  } else {
    // Group the week's games by day (Eastern), in date order; live games stay first within each day.
    const days = [...new Set(rest.map((g) => g.day))].sort();
    for (const d of days) el.append(...section(relativeDayLabel(d), rest.filter((g) => g.day === d), false));
  }

  el.append(h('p', { class: 'updated' },
    result.stale ? `Saved copy from ${etTime(result.savedAt)}. The data source didn’t respond.` : `Updated ${etTime(result.savedAt || Date.now())}`));
}

async function addJumps(el, date) {
  try {
    const { prev, next } = await nearbyMlbDates(date);
    if (!prev && !next) return;
    const go = (d) => navigate(urlFor('mlb', { d: d === etISODate() ? null : d }), { replace: true });
    el.append(h('div', { style: { display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)' } },
      prev ? button(`‹ ${relativeDayLabel(prev)}`, { variant: 'secondary', onclick: () => go(prev) }) : null,
      next ? button(`${relativeDayLabel(next)} ›`, { variant: 'secondary', onclick: () => go(next) }) : null));
  } catch { /* offline: skip the jump buttons */ }
}

function skeletonList() {
  return h('div', { class: 'game-list' }, [0, 1, 2].map(() => h('div', { class: 'skeleton', style: { height: '112px', borderRadius: 'var(--radius-md)' } })));
}
