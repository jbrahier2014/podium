// Catholic High School League: scores, standings and power ratings for football and
// boys basketball (shown inside the Scores, Standings and Ratings screens, see
// chslSection), plus team pages (schedule, records, Home/Away).
//
// Routes
//   #/chsl/team/<id>            team page, current sport
//   #/chsl/<fb|bb>/team/<id>    team page for one sport
//   #/chsl[/<fb|bb>]?view=...   old links: forward to Scores / Standings / Ratings

import { h, clear, icon, ICONS, toast } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { chslSeasons, loadChsl, currentSport, SPORT_NAME, weekOf, defaultWeek } from '../data/chsl.js';
import { crest, chips, choice, emptyState, standingsTable, periodPicker } from '../ui/components.js';
import { gameCard } from '../ui/format.js';
import { scheduleRow } from './team.js';
import { pageTitle } from './common.js';
import { navigate } from '../router.js';
import { etDay, etLongDay } from '../util/time.js';
import { pctLabel } from '../util/prob.js';

const featuredIds = () => new Set(settings.get().featured.filter((t) => t.league === 'chsl').map((t) => String(t.id)));

export default {
  async render(ctx) {
    const seasons = await chslSeasons();
    if (!ctx.isCurrent()) return;
    if (!seasons.length) {
      ctx.setTitle('CHSL');
      ctx.el.append(...pageTitle('CHSL', 'Catholic High School League'),
        h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No CHSL data yet', text: 'Scores and standings appear after the first nightly update with high school data.' })));
      return;
    }
    const sport = SPORT_NAME[ctx.params.sport] ? ctx.params.sport : currentSport(seasons);
    if (ctx.params.id) return renderTeam(ctx, sport, seasons);
    return forwardLeague(ctx, sport);
  },
};

// ---------------------------------------------------------------- league sections
// CHSL lives inside the regular screens, like the other leagues: Scores (with a
// Standings tile), Standings, and Ratings, each with the CHSL league tab selected.
//   #/scores/chsl[?sport=fb|bb&year=2026&week=...]
//   #/standings/chsl[?sport=&year=]
//   #/ratings/chsl[?sport=&year=]
// The old #/chsl?view=... links forward to these.

/**
 * Append the CHSL part of a screen (sport and season pickers, then the section) to
 * ctx.el, under the page title and league tabs the screen already drew.
 * section: 'scores' | 'standings' | 'ratings'
 */
export async function chslSection(ctx, section) {
  const seasons = await chslSeasons();
  if (!ctx.isCurrent()) return;
  if (!seasons.length) {
    ctx.el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No CHSL data yet', text: 'Scores and standings appear after the first nightly update with high school data.' })));
    return;
  }
  const q = { ...ctx.query };
  const sport = SPORT_NAME[q.sport] ? q.sport : currentSport(seasons);
  const years = seasons.filter((s) => s.sport === sport).map((s) => s.year);
  const year = years.includes(Number(q.year)) ? Number(q.year) : years[0];
  const hrefFor = (sec, patch = {}) => {
    const next = { sport, year: year === years[0] ? '' : year, week: q.week, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v != null && v !== '')).toString();
    return `${sec}/chsl${qs ? `?${qs}` : ''}`;
  };
  const go = (patch) => navigate(hrefFor(section, patch), { replace: true });

  const sportBar = h('div', { class: 'chsl-bar' },
    choice([{ id: 'fb', label: 'Football' }, { id: 'bb', label: 'Basketball' }].filter((s) => seasons.some((x) => x.sport === s.id)), sport,
      (s) => go({ sport: s, year: '', week: '' }), { label: 'Sport' }));
  const yearBar = years.length > 1
    ? chips(years.map((y) => ({ id: y, label: label(sport, y) })), year, (y) => go({ year: y, week: '' }), { label: 'Season' })
    : null;
  // Scores: a Standings tile, like the other leagues
  const jumps = section === 'scores'
    ? h('div', { class: 'jump-tiles' }, h('a', { href: `#/${hrefFor('standings', { week: '' })}`, class: 'jump-tile' },
      h('span', { class: 'jt-icon' }, icon(ICONS.standings)),
      h('span', { class: 'jt-text' }, h('span', { class: 'jt-title' }, 'Standings'), h('span', { class: 'jt-sub' }, 'By division')),
      h('span', { class: 'jt-chev' }, icon(ICONS.chevron))))
    : null;
  const body = h('div', {}, h('div', { class: 'skeleton', style: { height: '240px', margin: '0 var(--gutter)', borderRadius: 'var(--radius-md)' } }));
  ctx.el.append(...(jumps ? [jumps] : []), sportBar, ...(yearBar ? [yearBar] : []), body);

  let data;
  try { data = await loadChsl(sport, year); } catch (err) {
    clear(body); body.append(h('div', { class: 'notice strong' }, `Couldn’t load CHSL ${SPORT_NAME[sport].toLowerCase()}: ${err.message}`));
    return;
  }
  if (!ctx.isCurrent()) return;
  clear(body);
  const mine = featuredIds();
  if (section === 'standings') body.append(...standingsView(data, mine));
  else if (section === 'ratings') body.append(...ratingsView(data, mine));
  else body.append(...scoresView(data, q.week, (w) => go({ week: w })));
  body.append(sourceNote(data));
}

// Old links (#/chsl?view=..., #/chsl/fb?view=...) forward to the regular screens
function forwardLeague(ctx, sport) {
  const sec = ['standings', 'ratings'].includes(ctx.query.view) ? ctx.query.view : 'scores';
  const next = { sport: ctx.params.sport ? sport : '', year: ctx.query.year, week: ctx.query.week };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
  navigate(`${sec}/chsl${qs ? `?${qs}` : ''}`, { replace: true });
}

const label = (sport, y) => (sport === 'fb' ? String(y) : `${y}–${String(y + 1).slice(2)}`);

function scoresView(data, wantWeek, setWeek) {
  const games = data.games.filter((g) => !g.scrimmage && (g.home.team.id || g.away.team.id));
  const weeks = [...new Set(games.map((g) => weekOf(g.day)))].sort();
  if (!weeks.length) return [h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No games yet', text: 'The schedule shows up once schools post it.' }))];
  const week = weeks.includes(wantWeek) ? wantWeek : defaultWeek(games);
  const i = weeks.indexOf(week);
  const inWeek = games.filter((g) => weekOf(g.day) === week);
  // CHSL-vs-CHSL games first within each day, then everything else
  const days = [...new Set(inWeek.map((g) => g.day))].sort();
  const out = [periodPicker({
    label: `Week of ${etDay(`${week}T16:00:00Z`).replace(/^\w+, /, '')}`,
    sub: `${inWeek.length} game${inWeek.length === 1 ? '' : 's'}`,
    onPrev: i > 0 ? () => setWeek(weeks[i - 1]) : null,
    onNext: i < weeks.length - 1 ? () => setWeek(weeks[i + 1]) : null,
  })];
  for (const day of days) {
    const list = inWeek.filter((g) => g.day === day)
      .sort((a, b) => Number(both(b)) - Number(both(a)) || Date.parse(a.start) - Date.parse(b.start));
    out.push(h('div', { class: 'group-label' }, etLongDay(`${day}T16:00:00Z`)),
      h('div', { class: 'game-list' }, list.map((g) => gameCard(g))));
  }
  return out;
}
const both = (g) => !!(g.home.team.id && g.away.team.id);

function standingsView(data, mine) {
  const out = [];
  for (const d of data.divisions) {
    const rows = d.teams.map((id, i) => {
      const t = data.teams.get(id);
      return { rank: i + 1, team: t, conf: t.conf || '–', overall: t.record, rk: t.rank, followed: mine.has(id) };
    });
    const table = standingsTable({
        columns: [{ key: 'conf', label: 'CHSL' }, { key: 'overall', label: 'Overall' }],
        rows, onRowClick: (r) => navigate(`chsl/${data.sport}/team/${r.team.id}`),
      });
    table.classList.add('chsl-standings');
    out.push(h('div', { class: 'group-label' }, d.name), table);
  }
  out.push(h('p', { class: 'footnote' }, 'Division order and league records as MHSAA lists them. Tap a team for its schedule; Ratings ranks the whole league.'));
  return out;
}

function ratingsView(data, mine) {
  const rated = data.teamList.filter((t) => t.rank);
  if (!rated.length) return [h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'No ratings yet', text: 'Ratings start after the first week of games.' }))];
  const max = Math.max(...rated.map((t) => Math.abs(t.rating)), 1);
  const list = h('div', { class: 'card' }, rated.map((t) => h('a', { class: `leader-row${mine.has(t.id) ? ' followed' : ''}`, href: `#/chsl/${data.sport}/team/${t.id}` },
    h('span', { class: 'rank' }, t.rank),
    crest(t, 'sm'),
    h('span', { class: 'lr-name' }, t.short, h('span', { class: 'lr-sub' }, `${t.record} · ${t.division}`)),
    h('span', { class: 'lr-bar' }, h('span', { class: 'lr-fill', style: { width: `${Math.round(50 + (50 * t.rating) / max)}%` } })),
    h('span', { class: 'lr-val' }, fmtSigned(t.rating)))));
  const unit = 'points';
  return [
    list,
    h('p', { class: 'footnote' }, `Power rating: how many ${unit} better than an average CHSL team on a neutral field, from every score this season (margins capped at ${data.sport === 'fb' ? 28 : 25}, home edge ${data.hfa} ${unit}). Non-league opponents count too. Early in the season ratings move a lot.`),
  ];
}

const fmtSigned = (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`);

function sourceNote(data) {
  const when = data.generatedAt ? new Date(data.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return h('p', { class: 'footnote' }, `Scores from MHSAA team schedules${data.sources?.sjj === 'ok' ? ' and St. John’s Jesuit’s athletics site' : ''}, as schools report them.${when ? ` Updated ${when}.` : ''}`);
}

// ---------------------------------------------------------------- team page
const VENUES = [{ id: 'all', label: 'All games' }, { id: 'home', label: 'Home' }, { id: 'away', label: 'Away' }];
const view = { venue: 'all' };

async function renderTeam(ctx, sport, seasons) {
  const id = String(ctx.params.id);
  const years = seasons.filter((s) => s.sport === sport).map((s) => s.year);
  const year = years.includes(Number(ctx.query.year)) ? Number(ctx.query.year) : years[0];
  let data;
  try { data = await loadChsl(sport, year); } catch (err) {
    ctx.el.append(h('div', { class: 'notice strong' }, `Couldn’t load this team: ${err.message}`));
    return;
  }
  if (!ctx.isCurrent()) return;
  const t = data.teams.get(id);
  if (!t) {
    // Not in this sport's league: try the other sport before giving up
    const other = sport === 'fb' ? 'bb' : 'fb';
    if (!ctx.params.sport && seasons.some((s) => s.sport === other)) return navigate(`chsl/${other}/team/${id}`, { replace: true });
    ctx.setTitle('CHSL');
    ctx.el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: `Not in CHSL ${SPORT_NAME[sport].toLowerCase()} this season`, text: '' })));
    return;
  }
  ctx.setTitle(t.short);

  // Feature / unfeature (star in the top bar)
  const followBtn = h('button', {});
  const drawFollow = () => {
    const on = settings.isFeatured('chsl', id);
    followBtn.replaceChildren(icon(on ? ICONS.starFilled : ICONS.star));
    followBtn.setAttribute('aria-label', on ? 'Remove from featured' : 'Feature this team');
    followBtn.setAttribute('aria-pressed', String(on));
  };
  followBtn.addEventListener('click', () => {
    if (settings.isFeatured('chsl', id)) { settings.removeFeatured('chsl', id); toast('Removed from Home'); }
    else { settings.addFeatured({ league: 'chsl', id, name: t.name, short: t.short, abbr: t.abbr }); toast('Pinned to Home'); }
    drawFollow();
  });
  drawFollow();
  ctx.setActions(followBtn);

  const otherSport = sport === 'fb' ? 'bb' : 'fb';
  const sportBar = seasons.some((s) => s.sport === otherSport)
    ? h('div', { class: 'chsl-bar' }, choice([{ id: 'fb', label: 'Football' }, { id: 'bb', label: 'Basketball' }], sport,
      (s) => navigate(`chsl/${s}/team/${id}`, { replace: true }), { label: 'Sport' }))
    : null;

  const games = data.games.filter((g) => !g.scrimmage && (g.home.team.id === id || g.away.team.id === id))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const next = games.find((g) => g.status.state !== 'post' && g.status.detail !== 'No score yet');
  const division = data.divisions.find((d) => d.teams.includes(id));
  const place = division ? division.teams.indexOf(id) + 1 : null;

  const summary = h('div', { class: 'card' }, [
    info('Record', t.record),
    info('CHSL', `${t.conf || '–'}${place ? ` · ${ordinal(place)} in ${division.name}` : ''}`),
    info('Home / Away', `${t.home} · ${t.away}${t.neutral !== '0-0' ? ` · Neutral ${t.neutral}` : ''}`),
    info(sport === 'fb' ? 'Points per game' : 'Points per game', t.ppg != null ? `${t.ppg.toFixed(1)} for · ${t.papg.toFixed(1)} against` : '–'),
    info('Power rating', t.rank ? `${fmtSigned(t.rating)} · #${t.rank} of ${data.teamList.filter((x) => x.rank).length}` : '–'),
    t.streak ? info('Streak', t.streak.replace('W', 'Won ').replace('L', 'Lost ').replace('T', 'Tied ')) : null,
  ].filter(Boolean));

  const nextCard = next?.pred ? h('div', { class: 'notice' }, predLine(next, id)) : null;

  const list = h('div');
  const drawList = () => {
    clear(list);
    list.append(h('div', { class: 'venue-bar' }, choice(VENUES, view.venue, (v) => { view.venue = v; drawList(); }, { label: 'Home or away' })));
    const shown = games.filter((g) => view.venue === 'all' || (!g.neutral && (view.venue === 'home' ? g.home.team.id === id : g.away.team.id === id)));
    if (view.venue !== 'all') {
      const s = t[view.venue];
      list.append(h('p', { class: 'venue-summary' }, h('strong', {}, `${s} ${view.venue === 'home' ? 'at home' : 'on the road'}`)));
    }
    if (!shown.length) { list.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No games', text: '' }))); return; }
    const groups = [['Regular season', shown.filter((g) => !isPost(g))], ['Postseason', shown.filter(isPost)]];
    for (const [name, gs] of groups) {
      if (!gs.length) continue;
      list.append(h('div', { class: 'group-label' }, name), h('div', { class: 'list' }, gs.map((g) => {
        const row = scheduleRow({ ...g, href: null }, id, g === next);
        if (g.isLeague) row.querySelector('.sched-date')?.append(h('span', { class: 'chsl-tag' }, 'CHSL'));
        if (g.status.detail === 'No score yet') row.querySelector('.detail')?.replaceWith(h('span', { class: 'detail' }, 'No score yet'));
        return row;
      })));
    }
  };
  drawList();

  ctx.el.append(
    h('div', { class: 'team-hero' }, crest(t, 'lg'),
      h('div', { style: { minWidth: 0 } }, h('h1', { class: 'page-title', style: { margin: 0 } }, t.short),
        h('div', { class: 'meta t-overline muted' }, `CHSL ${t.division} · ${SPORT_NAME[sport]} ${label(sport, year)}`))),
    ...(sportBar ? [sportBar] : []),
    h('div', { class: 'group-label' }, 'Season'), summary,
    ...(nextCard ? [nextCard] : []),
    list,
    h('p', { class: 'footnote' }, 'CHSL marks league games. ',
      h('a', { href: t.page, target: '_blank', rel: 'noopener' }, 'MHSAA team page'),
      id === 'toledo-st-johns-jesuit-oh' ? [' · ', h('a', { href: 'https://sjjtitans.com', target: '_blank', rel: 'noopener' }, 'St. John’s Jesuit athletics')] : null,
      ' · ', h('a', { href: `#/standings/chsl?sport=${sport}` }, 'CHSL standings')),
  );
}

const isPost = (g) => g.post || /district|regional|semifinal|final|playoff|tournament|ohsaa|pre-district/i.test(g.note || '') && !/crossover/i.test(g.note || '');
const info = (k, v) => h('div', { class: 'info-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, v)));
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;

function predLine(g, id) {
  const meHome = g.home.team.id === id;
  const me = meHome ? g.home : g.away; const opp = meHome ? g.away : g.home;
  const margin = (meHome ? 1 : -1) * g.pred.margin;
  const p = meHome ? g.pred.homeWin : 1 - g.pred.homeWin;
  const when = etDay(g.start);
  return [h('strong', {}, `Next: ${when} ${meHome ? 'vs' : 'at'} ${opp.team.short}. `),
    `Podium has ${margin >= 0 ? me.team.short : opp.team.short} by ${Math.max(0.5, Math.round(Math.abs(margin) * 2) / 2)}, `,
    `${pctLabel(p)} win chance for ${me.team.short}.`];
}
