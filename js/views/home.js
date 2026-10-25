// Home: featured-team cards (live score, or last result + next game, record,
// standing, power rank), then today's games across the in-season leagues, live
// first, then the daily "Did you know?" stat (phase 5).
// While any of today's games is live, everything refreshes on the Settings interval.

import { h, clear } from '../util/dom.js';
import { etLongDay } from '../util/time.js';
import { settings } from '../store/settings.js';
import { LEAGUES, inSeason } from '../leagues.js';
import { getTeamSchedule, getTodayGames, getTeams, sortGames, needsLiveUpdates } from '../data/index.js';
import { livePoller } from '../util/poller.js';
import { crest, badge } from '../ui/components.js';
import { gameCard, resultLine, nextLine } from '../ui/format.js';
import { pageTitle, sectionHeader, emptyState } from './common.js';

export default {
  async render(ctx) {
    ctx.setTitle('Home');
    const { featured } = settings.get();
    // In-season teams first, keeping your chosen order within each group.
    const teams = [...featured].sort((a, b) => Number(inSeason(b.league)) - Number(inSeason(a.league)));

    const cards = teams.map((t) => ({ team: t, el: h('a', { class: 'team-card', href: `#/team/${t.league}/${t.id}`, style: { '--team': t.color || null } }) }));
    cards.forEach((c) => drawCard(c.el, c.team, null, null));

    const today = h('div', {}, h('div', { class: 'game-list' }, h('div', { class: 'skeleton', style: { height: '112px', borderRadius: 'var(--radius-md)' } })));

    ctx.el.append(
      ...pageTitle('Home', etLongDay(new Date())),
      teams.length
        ? h('div', { class: 'featured-scroller' }, cards.map((c) => c.el))
        : h('div', { class: 'notice' }, 'No featured teams yet. ', h('a', { href: '#/settings' }, 'Add teams')),
      sectionHeader({ title: 'Today', action: 'Scoreboard', href: '#/scores' }),
      today,
      sectionHeader({ title: 'Did you know?' }),
      h('div', { class: 'card' }, emptyState({
        iconName: 'bulb',
        title: 'Daily outlier',
        text: 'One unusual number about your teams, each day, once the nightly stats run.',
      })),
    );

    // Team schedules (cached ~10 min) and today's games load in parallel.
    const schedules = new Map();
    const cfbIdx = getTeams('cfb').then(({ teams: list }) => new Map(list.map((t) => [t.id, t]))).catch(() => new Map());
    const scheduleLoads = cards.map(async (c) => {
      try {
        schedules.set(c.team, await getTeamSchedule(c.team.league, c.team.id));
      } catch (err) {
        schedules.set(c.team, { error: err });
      }
    });

    let todayGames = {};
    const drawAll = async () => {
      const idx = await cfbIdx;
      if (!ctx.isCurrent()) return;
      cards.forEach((c) => drawCard(c.el, c.team, schedules.get(c.team), todayGames[c.team.league] || [], idx));
      drawToday(today, todayGames);
    };

    try { todayGames = await getTodayGames(); } catch { todayGames = {}; }
    await Promise.all(scheduleLoads);
    await drawAll();

    const all = () => Object.values(todayGames).flat();
    const poller = livePoller({
      initial: all(),
      isLive: needsLiveUpdates,
      intervalMs: () => settings.get().refreshSeconds * 1000,
      tick: async () => {
        todayGames = await getTodayGames({ force: true });
        await drawAll();
        return all();
      },
    });
    ctx.onCleanup(() => poller.stop());
  },
};

// ---------------------------------------------------------------- featured card
function drawCard(el, team, sched, todays, cfbIdx) {
  clear(el);
  const league = LEAGUES[team.league];

  // Merge the schedule with today's (fresher, possibly live) games.
  let games = sched?.games || [];
  if (todays?.length) {
    const fresh = new Map(todays.map((g) => [g.id, g]));
    games = games.map((g) => fresh.get(g.id) || g);
    todays.forEach((g) => {
      const mine = g.home.team.id === team.id || g.away.team.id === team.id;
      if (mine && !games.some((x) => x.id === g.id)) games.push(g);
    });
  }
  games = [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const live = games.find((g) => g.status.state === 'in');
  const last = [...games].reverse().find((g) => g.status.state === 'post' && g.status.completed);
  const next = games.find((g) => g.status.state === 'pre' && g !== live);

  // Standing line and the middle stat differ by league.
  const info = cfbIdx?.get(team.id);
  const latest = live || next || last;
  const mySide = latest && (latest.home.team.id === team.id ? latest.home : latest.away);
  const rank = mySide?.team.rank;
  const standing = team.league === 'cfb'
    ? (info?.conference || null)
    : sched?.standing || null;

  el.append(
    h('div', { class: 'tc-top' },
      crest(team),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'tc-meta' }, [league.name, standing].filter(Boolean).join(' · ')),
        h('div', { class: 'tc-name' }, team.short || team.name))),
    body(team, sched, live, last, next),
    h('div', { class: 'tc-stats' },
      stat('Record', sched?.record || '–'),
      team.league === 'cfb' ? stat('AP rank', sched ? (rank ? `#${rank}` : 'NR') : '–') : null,
      stat('Power rank', '–')),
  );
}

const stat = (k, v) => h('div', { class: 'tc-stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));

function body(team, sched, live, last, next) {
  if (!sched) return h('div', { class: 'tc-lines' }, h('div', { class: 'skeleton tc-loading' }));
  if (sched.error) return h('div', { class: 'tc-body' }, 'Schedule unavailable right now.');

  if (live) {
    const me = live.home.team.id === team.id ? live.home : live.away;
    const opp = me === live.home ? live.away : live.home;
    return h('div', { class: 'tc-live' },
      h('span', { class: 'sc' }, `${me.score ?? 0}`, h('span', { class: 'opp' }, `–${opp.score ?? 0} ${opp.team.abbr}`)),
      badge(`Live · ${live.status.detail}`, 'live'));
  }

  const lines = [];
  const r = last && resultLine(last, team.id);
  if (r) {
    lines.push(h('div', { class: 'tc-line' }, h('span', { class: 'k' }, 'Last'),
      r.outcome === 'W' ? badge('W', 'win') : badge(r.outcome),
      h('span', { class: `txt${r.outcome === 'L' ? ' loss' : ''}` }, r.text)));
  }
  lines.push(h('div', { class: 'tc-line' }, h('span', { class: 'k' }, 'Next'),
    h('span', { class: 'txt' }, next ? nextLine(next, team.id) : (inSeason(team.league) ? 'Season over' : 'Off-season'))));
  return h('div', { class: 'tc-lines' }, lines);
}

// ---------------------------------------------------------------- today's games
function drawToday(el, todayGames) {
  clear(el);
  const leagues = Object.keys(todayGames).filter((l) => todayGames[l].length);
  if (!leagues.length) {
    el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No games today', text: 'The scoreboard has the rest of the week.' })));
    return;
  }
  // Leagues with a live game first
  leagues.sort((a, b) => Number(todayGames[b].some((g) => g.status.state === 'in')) - Number(todayGames[a].some((g) => g.status.state === 'in')));
  for (const l of leagues) {
    el.append(
      h('div', { class: 'group-label' }, LEAGUES[l].name),
      h('div', { class: 'game-list' }, sortGames(todayGames[l]).map((g) => gameCard(g))));
  }
}
