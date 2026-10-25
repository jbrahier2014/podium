// Home: featured-team cards (live score, or last result + next game, record,
// standing, power rank), then today's games across the in-season leagues, live
// first, then the daily "Did you know?" stat (phase 5).
// While any of today's games is live, everything refreshes on the Settings interval.

import { h, clear } from '../util/dom.js';
import { etFullDate } from '../util/time.js';
import { settings } from '../store/settings.js';
import { LEAGUES, inSeason } from '../leagues.js';
import { getTeamSchedule, getTodayGames, getTeams, getRatings, sortGames, needsLiveUpdates } from '../data/index.js';
import { STATS, fmt, percentiles, ordinal, SCOPE } from '../data/statdefs.js';
import { etISODate } from '../util/time.js';
import { livePoller } from '../util/poller.js';
import { crest, badge } from '../ui/components.js';
import { gameCard, resultLine, nextLine } from '../ui/format.js';
import { installTip } from '../ui/install.js';
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
    const dyk = h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '96px' } }));

    // Nightly ratings for each featured league: power rank on the cards + the daily outlier
    const ratings = {};
    const ratingLoads = Promise.all([...new Set(teams.map((t) => t.league))].map((l) =>
      getRatings(l).then((d) => { ratings[l] = d; }).catch(() => {})));

    ctx.el.append(
      ...pageTitle('Home', etFullDate()),
      ...[installTip()].filter(Boolean),
      teams.length
        ? h('div', { class: 'featured-scroller' }, cards.map((c) => c.el))
        : h('div', { class: 'notice' }, 'No featured teams yet. ', h('a', { href: '#/settings' }, 'Add teams')),
      sectionHeader({ title: 'Today', action: 'Scoreboard', href: '#/scores' }),
      today,
      sectionHeader({ title: 'Did you know?' }),
      dyk,
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
      cards.forEach((c) => drawCard(c.el, c.team, schedules.get(c.team), todayGames[c.team.league] || [], idx, powerRank(ratings[c.team.league], c.team)));
      drawToday(today, todayGames);
    };

    try { todayGames = await getTodayGames(); } catch { todayGames = {}; }
    await Promise.all([...scheduleLoads, ratingLoads]);
    await drawAll();
    drawDidYouKnow(dyk, teams, ratings);

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
function drawCard(el, team, sched, todays, cfbIdx, power) {
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
      stat(RANK_LABEL[team.league], power ? `#${power}` : '–')),
  );
}

// Which rating the Home card ranks on (see powerRank below)
const RANK_LABEL = { cfb: 'Predictor rank', nfl: 'SRS rank', mlb: 'Pythag rank' };

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

// ---------------------------------------------------------------- power rank
/** Rank on the league's primary rating: Predictor (CFB), SRS (NFL), Pythagorean win % (MLB). */
export function powerRank(data, team) {
  const me = data?.teams?.find((t) => t.id === String(team.id));
  if (!me) return null;
  if (team.league === 'cfb') return me.v.pred_rank ?? null;
  if (team.league === 'nfl') return me.v.srs_rank ?? null;
  const pp = (t) => { const g = (t.v.pyth_w ?? 0) + (t.v.pyth_l ?? 0); return g ? t.v.pyth_w / g : 0; };
  return [...data.teams].sort((a, b) => pp(b) - pp(a)).findIndex((t) => t.id === me.id) + 1;
}

// ---------------------------------------------------------------- did you know
/**
 * One outlier per day about a featured team: the stat where the team sits furthest
 * from the league median (top or bottom 10%), or a big luck gap. Rotates daily.
 */
function drawDidYouKnow(el, teams, ratings) {
  clear(el);
  const facts = [];
  for (const team of teams) {
    const data = ratings[team.league];
    const me = data?.teams?.find((t) => t.id === String(team.id));
    if (!me) continue;
    const name = team.short || team.name;
    const n = data.teams.length;
    for (const def of STATS[team.league]) {
      if (def.hib == null || me.v[def.key] == null) continue;
      const p = percentiles(data.teams, def).get(me.id);
      if (!p) continue;
      const extreme = p.rank <= Math.max(3, Math.round(n * 0.05)) || p.rank > p.n - Math.max(3, Math.round(n * 0.05));
      if (!extreme) continue;
      const best = p.rank <= p.n / 2;
      const where = p.rank === 1 ? `the best in ${SCOPE[team.league]}` : p.rank === p.n ? `the worst in ${SCOPE[team.league]}` : best ? `${ordinal(p.rank)} in ${SCOPE[team.league]}` : `${ordinal(p.n - p.rank + 1)}-worst in ${SCOPE[team.league]}`;
      const label = /^[A-Z]{2,}|^[A-Z]-|^x?wOBA|^ERA|^FIP|^WHIP|^OPS|^BABIP|^SP\+|^K-BB|^SRS|^EPA/.test(def.label) ? def.label : def.label.charAt(0).toLowerCase() + def.label.slice(1);
      facts.push({ team, score: Math.abs(p.pct - 50) + (def.fp ? 5 : 0), text: `${name}: ${fmt(me.v[def.key], def.fmt)} ${label}, ${where}.` });
    }
    const luck = me.v.luck;
    if (luck != null && Math.abs(luck) >= (team.league === 'mlb' ? 4 : 1.2)) {
      const unit = team.league === 'mlb' ? 'run differential' : 'point differential';
      const pyth = Math.round(me.v.pyth_w);
      facts.push({ team, score: 60 + Math.abs(luck), text: `${name} ${/s$/.test(name) ? 'have' : 'has'} ${me.v.wins} wins, but their ${unit} says ${pyth}. That ${Math.abs(luck).toFixed(1)}-win ${luck > 0 ? 'cushion usually shrinks' : 'shortfall usually corrects'} over time.` });
    }
  }
  if (!facts.length) {
    el.append(emptyState({ iconName: 'bulb', title: 'Daily outlier', text: 'One unusual number about your teams, each day, once the nightly stats run.' }));
    return;
  }
  // Best fact per team, then rotate through teams by day
  const perTeam = new Map();
  facts.sort((a, b) => b.score - a.score).forEach((f) => { if (!perTeam.has(f.team)) perTeam.set(f.team, []); perTeam.get(f.team).push(f); });
  const pool = [...perTeam.values()];
  const day = Math.floor(Date.parse(`${etISODate()}T12:00:00Z`) / 86400000);
  const list = pool[day % pool.length];
  const fact = list[Math.floor(day / pool.length) % Math.min(list.length, 3)];
  el.append(h('a', { class: 'dyk', href: `#/team/${fact.team.league}/${fact.team.id}?tab=advanced` },
    crest(fact.team),
    h('div', {}, h('div', { class: 'dyk-text' }, fact.text), h('div', { class: 't-caption', style: { marginTop: 'var(--space-1)' } }, 'See the full fingerprint'))));
}
