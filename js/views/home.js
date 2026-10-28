// Home: featured-team cards (live score, or last result + next game, record,
// standing, rank; teams with a game soon first), "Worth watching" (see
// ../data/watch.js), today's games across the in-season leagues, live first, then
// "Did you know?", a different stat each time Home is shown.
// While any of today's games is live, everything refreshes on the Settings interval.

import { h, clear } from '../util/dom.js';
import { etFullDate, etDay } from '../util/time.js';
import { settings } from '../store/settings.js';
import { LEAGUES, inSeason } from '../leagues.js';
import { getTeamSchedule, getTodayGames, getTeams, getRatings, sortGames, needsLiveUpdates } from '../data/index.js';
import { STATS, fmt, percentiles, ordinal, SCOPE } from '../data/statdefs.js';
import { etISODate } from '../util/time.js';
import { livePoller } from '../util/poller.js';
import { crest, badge } from '../ui/components.js';
import { gameCard, resultLine, nextLine } from '../ui/format.js';
import { installTip } from '../ui/install.js';
import { worthWatching } from '../data/watch.js';
import { pageTitle, sectionHeader, emptyState } from './common.js';

export default {
  async render(ctx) {
    ctx.setTitle('Home');
    const { featured } = settings.get();
    // In-season teams first, keeping your chosen order within each group.
    const teams = [...featured].sort((a, b) => Number(inSeason(b.league)) - Number(inSeason(a.league)));

    const cards = teams.map((t) => ({ team: t, el: h('a', { class: 'team-card', href: `#/team/${t.league}/${t.id}`, style: { '--team': t.color || null } }) }));
    const scroller = h('div', { class: 'featured-scroller' }, cards.map((c) => c.el));
    cards.forEach((c) => drawCard(c.el, c.team, null, null));

    const today = h('div', {}, h('div', { class: 'game-list' }, h('div', { class: 'skeleton', style: { height: '112px', borderRadius: 'var(--radius-md)' } })));
    const watch = h('div', {}, h('div', { class: 'game-list' }, h('div', { class: 'skeleton', style: { height: '112px', borderRadius: 'var(--radius-md)' } })));
    const watchHeader = sectionHeader({ title: 'Worth watching' });
    const dyk = h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '96px' } }));

    // Nightly ratings for each featured league: power rank on the cards + the daily outlier
    const ratings = {};
    const ratingLoads = Promise.all([...new Set(teams.map((t) => t.league))].map((l) =>
      getRatings(l).then((d) => { ratings[l] = d; }).catch(() => {})));

    ctx.el.append(
      ...pageTitle('Home', etFullDate()),
      ...[installTip()].filter(Boolean),
      teams.length
        ? scroller
        : h('div', { class: 'notice' }, 'No featured teams yet. ', h('a', { href: '#/settings' }, 'Add teams')),
      watchHeader,
      watch,
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
      // Teams with a game live or in the next 10 days first (your order otherwise);
      // a team whose season is over, like a club out of the playoffs, moves to the end.
      const ranked = cards.map((c, i) => ({ c, i, active: isActive(schedules.get(c.team), todayGames[c.team.league], c.team) }))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.i - b.i);
      if (ranked.some((r, n) => scroller.children[n] !== r.c.el)) scroller.append(...ranked.map((r) => r.c.el));
      drawToday(today, todayGames);
      drawWatch();
    };

    const featuredIds = new Set(teams.map((t) => `${t.league}:${t.id}`));
    let watchToken = 0;
    const drawWatch = async () => {
      const my = ++watchToken;
      let picks;
      try { picks = await worthWatching({ today: todayGames, featuredIds, limit: 5 }); } catch { picks = []; }
      if (my !== watchToken || !ctx.isCurrent()) return;
      clear(watch);
      if (!picks.length) {
        watch.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'Nothing standout in the next 24 hours', text: 'Live close games, upsets, ranked matchups and toss-ups show up here.' })));
        return;
      }
      watch.append(h('div', { class: 'game-list' }, picks.map(watchCard)));
    };

    try { todayGames = await getTodayGames(); } catch { todayGames = {}; }
    await Promise.all([...scheduleLoads, ratingLoads]);
    await drawAll();
    // A different fact every time Home is shown, and every time the app comes back to the front
    const info = {};
    await Promise.all(Object.keys(ratings).map((l) => getTeams(l).then(({ teams: list }) => { info[l] = new Map(list.map((t) => [String(t.id), t])); }).catch(() => {})));
    if (!ctx.isCurrent()) return;
    const facts = buildFacts(teams, ratings, info);
    drawDidYouKnow(dyk, facts);
    const onVisible = () => { if (document.visibilityState === 'visible' && ctx.isCurrent()) drawDidYouKnow(dyk, facts); };
    document.addEventListener('visibilitychange', onVisible);
    ctx.onCleanup(() => document.removeEventListener('visibilitychange', onVisible));

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
 * The pool of facts: for your teams, every stat where they're in the top or bottom
 * 10% of the league and any big gap between record and scoring margin; plus, for the
 * in-season leagues, the league leader and laggard on each key stat and the luckiest
 * and unluckiest teams. Home shows a random one each time, never the same twice in a row.
 */
function buildFacts(teams, ratings, info) {
  const facts = [];
  const lower = (def) => (/^[A-Z]{2,}|^[A-Z]-|^x?wOBA|^ERA|^FIP|^WHIP|^OPS|^BABIP|^SP\+|^K-BB|^SRS|^EPA/.test(def.label) ? def.label : def.label.charAt(0).toLowerCase() + def.label.slice(1));
  const luckText = (name, t, league) => {
    const unit = league === 'mlb' ? 'run differential' : 'point differential';
    return `${name} ${/s$/.test(name) ? 'have' : 'has'} ${t.v.wins} wins, but their ${unit} says ${Math.round(t.v.pyth_w)}. That ${Math.abs(t.v.luck).toFixed(1)}-win ${t.v.luck > 0 ? 'cushion usually shrinks' : 'shortfall usually corrects'} over time.`;
  };
  const teamOf = (league, t) => ({ league, id: String(t.id), ...(info[league]?.get(String(t.id)) || {}), short: info[league]?.get(String(t.id))?.short || t.name || t.abbr, abbr: info[league]?.get(String(t.id))?.abbr || t.abbr });

  // Your teams
  for (const team of teams) {
    const data = ratings[team.league];
    const me = data?.teams?.find((t) => t.id === String(team.id));
    if (!me) continue;
    const name = team.short || team.name;
    const n = data.teams.length;
    const edge = Math.max(3, Math.round(n * 0.1));
    for (const def of STATS[team.league]) {
      if (def.hib == null || me.v[def.key] == null) continue;
      const p = percentiles(data.teams, def).get(me.id);
      if (!p || !(p.rank <= edge || p.rank > p.n - edge)) continue;
      const best = p.rank <= p.n / 2;
      const where = p.rank === 1 ? `the best in ${SCOPE[team.league]}` : p.rank === p.n ? `the worst in ${SCOPE[team.league]}` : best ? `${ordinal(p.rank)} in ${SCOPE[team.league]}` : `${ordinal(p.n - p.rank + 1)}-worst in ${SCOPE[team.league]}`;
      facts.push({ team, mine: true, key: `${team.league}:${team.id}:${def.key}`, text: `${name}: ${fmt(me.v[def.key], def.fmt)} ${lower(def)}, ${where}.` });
    }
    if (me.v.luck != null && Math.abs(me.v.luck) >= (team.league === 'mlb' ? 4 : 1.2)) {
      facts.push({ team, mine: true, key: `${team.league}:${team.id}:luck`, text: luckText(name, me, team.league) });
    }
  }

  // Around the league (in-season leagues only)
  for (const [league, data] of Object.entries(ratings)) {
    if (!data?.teams?.length || !inSeason(league)) continue;
    for (const def of STATS[league].filter((d) => d.fp && d.hib != null)) {
      const ok = data.teams.filter((t) => t.v[def.key] != null);
      if (ok.length < 8) continue;
      const sorted = [...ok].sort((a, b) => (def.hib ? b.v[def.key] - a.v[def.key] : a.v[def.key] - b.v[def.key]));
      const top = teamOf(league, sorted[0]); const bottom = teamOf(league, sorted[sorted.length - 1]);
      facts.push({ team: top, key: `${league}:top:${def.key}`, text: `Best ${lower(def)} in ${SCOPE[league]}: ${top.short}, ${fmt(sorted[0].v[def.key], def.fmt)}.` });
      facts.push({ team: bottom, key: `${league}:bottom:${def.key}`, text: `Worst ${lower(def)} in ${SCOPE[league]}: ${bottom.short}, ${fmt(sorted[sorted.length - 1].v[def.key], def.fmt)}.` });
    }
    const lucky = data.teams.filter((t) => t.v.luck != null && t.v.wins != null).sort((a, b) => b.v.luck - a.v.luck);
    if (lucky.length > 4) {
      const [hi, lo] = [lucky[0], lucky[lucky.length - 1]];
      const tHi = teamOf(league, hi); const tLo = teamOf(league, lo);
      if (hi.v.luck > 0.5) facts.push({ team: tHi, key: `${league}:luckiest`, text: `Luckiest team in ${SCOPE[league]}: ${luckText(tHi.short, hi, league)}` });
      if (lo.v.luck < -0.5) facts.push({ team: tLo, key: `${league}:unluckiest`, text: `Unluckiest team in ${SCOPE[league]}: ${luckText(tLo.short, lo, league)}` });
    }
  }
  return facts;
}

const LAST_FACT = 'podium.lastFact';
function drawDidYouKnow(el, facts) {
  clear(el);
  if (!facts.length) {
    el.append(emptyState({ iconName: 'bulb', title: 'Did you know?', text: 'Unusual numbers about your teams and the league, once the nightly stats run.' }));
    return;
  }
  let last = null;
  try { last = localStorage.getItem(LAST_FACT); } catch { /* ignore */ }
  // Your teams' facts come up about 60% of the time
  const mine = facts.filter((f) => f.mine && f.key !== last); const other = facts.filter((f) => !f.mine && f.key !== last);
  const pool = (mine.length && (!other.length || Math.random() < 0.6)) ? mine : (other.length ? other : facts);
  const fact = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(LAST_FACT, fact.key); } catch { /* ignore */ }
  el.append(h('a', { class: 'dyk', href: `#/team/${fact.team.league}/${fact.team.id}?tab=advanced` },
    crest(fact.team),
    h('div', {}, h('div', { class: 'dyk-text' }, fact.text), h('div', { class: 't-caption', style: { marginTop: 'var(--space-1)' } }, 'See the full fingerprint'))));
}

// ---------------------------------------------------------------- worth watching
function watchCard(pick) {
  const card = gameCard(pick.game);
  const why = h('div', { class: 'watch-why' },
    h('span', { class: 'lg' }, LEAGUES[pick.game.league].name),
    pick.mine ? badge('Your team', 'podium') : null,
    pick.reasons.length ? h('span', { class: 'why' }, pick.reasons.join(' \u00b7 ')) : null);
  // Upcoming games beyond today: show the day too
  if (pick.game.status.state === 'pre' && pick.game.day !== etISODate()) {
    const b = card.querySelector('.sc-head .badge');
    if (b) b.textContent = `${etDay(pick.game.start)} \u00b7 ${pick.game.status.detail}`;
  }
  card.append(why);
  return card;
}

/** Live now, or a game in the next 10 days (or still today). */
function isActive(sched, todays, team) {
  const now = Date.now();
  const games = [...(sched?.games || []), ...(todays || []).filter((g) => g.home?.team.id === String(team.id) || g.away?.team.id === String(team.id))];
  return games.some((g) => g.status.state === 'in' || (g.status.state === 'pre' && Date.parse(g.start) < now + 10 * 864e5 && Date.parse(g.start) > now - 6 * 3600e3));
}
