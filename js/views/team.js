// Team page: schedule and results, roster, standings context, season stats, and
// an Advanced tab (advanced stats and the percentile fingerprint arrive with the
// nightly stats in phase 5).

import { pctLabel100 } from '../util/prob.js';
import { h, icon, ICONS, toast, clear } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { getTeams, getTeamSchedule, getRoster, getStandings, getTeamStats, getRatings, getRatingSeasons } from '../data/index.js';
import { STATS, fmt, percentiles, ordinal, SCOPE, VENUES, VENUE_LABEL, hasSplits, splitData } from '../data/statdefs.js';
import { LEAGUES, seasonYear } from '../leagues.js';
import { etDay, etTime, etISODate } from '../util/time.js';
import { crest, tabs, badge, chips, choice, emptyState, standingsTable, percentileRow } from '../ui/components.js';
import { resultLine } from '../ui/format.js';
import { navigate } from '../router.js';

const TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'roster', label: 'Roster' },
  { id: 'standings', label: 'Standings' },
  { id: 'stats', label: 'Stats' },
  { id: 'advanced', label: 'Advanced' },
];

async function findTeam(league, id) {
  const pinned = settings.get().featured.find((t) => t.league === league && t.id === String(id));
  try {
    const { teams } = await getTeams(league);
    return teams.find((t) => t.id === String(id)) || pinned;
  } catch {
    return pinned;
  }
}

export default {
  async render(ctx) {
    const { league, id } = ctx.params;
    if (!LEAGUES[league]) throw new Error('Unknown league');
    const team = (await findTeam(league, id)) || { league, id, name: `Team ${id}`, abbr: '?' };
    ctx.setTitle(team.short || team.name);

    // Feature / unfeature (star in the top bar)
    const followBtn = h('button', {});
    const drawFollow = () => {
      const on = settings.isFeatured(league, id);
      followBtn.replaceChildren(icon(on ? ICONS.starFilled : ICONS.star));
      followBtn.setAttribute('aria-label', on ? 'Remove from featured' : 'Feature this team');
      followBtn.setAttribute('aria-pressed', String(on));
    };
    followBtn.addEventListener('click', () => {
      if (settings.isFeatured(league, id)) { settings.removeFeatured(league, id); toast('Removed from Home'); }
      else { settings.addFeatured(team); toast('Pinned to Home'); }
      drawFollow();
    });
    drawFollow();
    ctx.setActions(followBtn);

    const meta = h('div', { class: 'meta t-overline muted' }, LEAGUES[league].longName);
    const body = h('div');
    const initial = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'schedule';
    ctx.el.append(
      h('div', { class: 'team-hero' },
        crest(team, 'lg'),
        h('div', { style: { minWidth: 0 } }, h('h1', { class: 'page-title', style: { margin: 0 } }, team.name), meta)),
      tabs(TABS, initial, (t) => drawTab(t), { label: 'Team sections' }),
      body,
    );

    // Loaded lazily and shared between tabs
    const cache = {};
    const load = (key, fn) => (cache[key] ||= fn().catch((err) => { delete cache[key]; throw err; }));
    const schedule = () => load('schedule', () => getTeamSchedule(league, id));

    // Header line: record and standing
    schedule().then((s) => {
      const conf = team.conference;
      meta.textContent = [s.record, league === 'cfb' ? conf : s.standing].filter(Boolean).join(' · ') || LEAGUES[league].longName;
    }).catch(() => {});

    let token = 0;
    async function drawTab(tab) {
      const my = ++token;
      clear(body);
      body.append(h('div', { class: 'skeleton', style: { height: '220px', margin: '0 var(--gutter)', borderRadius: 'var(--radius-md)' } }));
      try {
        const content = await TAB_RENDERERS[tab]({ league, id, team, schedule, load });
        if (my !== token || !ctx.isCurrent()) return;
        clear(body);
        body.append(...[].concat(content));
        if (tab === 'schedule') body.querySelector('[data-next]')?.scrollIntoView({ block: 'center' });
      } catch (err) {
        if (my !== token) return;
        clear(body);
        body.append(h('div', { class: 'notice strong' }, `Couldn’t load this right now: ${err.message}`));
      }
    }
    drawTab(initial);
  },
};

// ---------------------------------------------------------------- roster
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** Last name for sorting: "Jerome Bettis Jr." -> "bettis" */
function lastName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return (parts[parts.length - 1] || '').toLowerCase();
}

/**
 * Roster with a search box (name or number), position chips and a sort choice.
 * Units (Offense / Defense / Special teams, or Pitchers / Catchers...) stay as groups.
 */
function rosterView(groups) {
  const positions = [...new Set(groups.flatMap((g) => g.players.map((p) => p.pos).filter(Boolean)))];
  const st = { q: '', pos: 'all', sort: 'name' };
  const list = h('div');
  const input = h('input', { type: 'search', class: 'roster-search', placeholder: 'Search name or number', 'aria-label': 'Search the roster by name or number', autocomplete: 'off', inputmode: 'search' });
  input.addEventListener('input', () => { st.q = input.value.trim().toLowerCase(); draw(); });
  const posBar = h('div');
  const sortBar = h('div');
  const drawControls = () => {
    clear(posBar); clear(sortBar);
    posBar.append(chips([{ id: 'all', label: 'All' }, ...positions.map((p) => ({ id: p, label: p }))], st.pos, (v) => { st.pos = v; drawControls(); draw(); }, { label: 'Position' }));
    sortBar.append(h('div', { class: 'roster-sort' }, h('span', { class: 't-caption' }, 'Sort'),
      choice([{ id: 'name', label: 'Last name' }, { id: 'number', label: 'Number' }, { id: 'pos', label: 'Position' }], st.sort, (v) => { st.sort = v; drawControls(); draw(); }, { label: 'Sort by' })));
  };
  const posRank = (p) => { const i = positions.indexOf(p); return i < 0 ? 99 : i; };
  const num = (p) => (p.jersey === '' || p.jersey == null ? 1e3 : Number(p.jersey));
  const cmp = {
    name: (a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name),
    number: (a, b) => num(a) - num(b) || lastName(a.name).localeCompare(lastName(b.name)),
    pos: (a, b) => posRank(a.pos) - posRank(b.pos) || lastName(a.name).localeCompare(lastName(b.name)),
  };
  const matches = (p) => {
    if (st.pos !== 'all' && p.pos !== st.pos) return false;
    if (!st.q) return true;
    if (/^\d+$/.test(st.q)) return String(p.jersey) === st.q;
    return p.name.toLowerCase().includes(st.q);
  };
  const draw = () => {
    clear(list);
    let shown = 0;
    for (const g of groups) {
      const players = g.players.filter(matches).sort(cmp[st.sort]);
      if (!players.length) continue;
      shown += players.length;
      list.append(
        h('div', { class: 'group-label' }, `${g.name} \u00b7 ${players.length}`),
        h('div', { class: 'list' }, players.map((p) => h('div', { class: 'list-item roster-row' },
          h('span', { class: 'jersey' }, p.jersey),
          h('span', { class: 'grow' }, h('div', { class: 'title' }, p.name), p.detail ? h('div', { class: 'sub' }, p.detail) : null),
          p.pos ? badge(p.pos) : null))));
    }
    if (!shown) list.append(h('div', { class: 'card' }, emptyState({ iconName: 'search', title: 'No players match', text: 'Try another name, number or position.' })));
  };
  drawControls(); draw();
  return [h('div', { class: 'roster-controls' }, input), posBar, sortBar, list];
}

// ---------------------------------------------------------------- tabs
const TAB_RENDERERS = {
  async schedule({ league, id, schedule }) {
    const { games } = await schedule();
    if (!games.length) return h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No games scheduled', text: '' }));
    const all = [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const next = all.find((g) => g.status.state !== 'post');
    const opts = [...VENUES];
    if (all.some((g) => g.neutral)) opts.push({ id: 'neutral', label: 'Neutral' });
    if (!opts.some((o) => o.id === view.venue)) view.venue = 'all';
    const bar = h('div'); const summary = h('div'); const list = h('div');
    const draw = () => {
      clear(bar); clear(summary); clear(list);
      bar.append(h('div', { class: 'venue-bar' }, choice(opts, view.venue, (v) => { view.venue = v; draw(); }, { label: 'Home or away' })));
      const shown = all.filter((g) => view.venue === 'all' || venueOf(g, id) === view.venue);
      if (view.venue !== 'all') summary.append(venueSummary(league, id, shown, view.venue));
      if (!shown.length) { list.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: `No ${opts.find((o) => o.id === view.venue).label.toLowerCase()} games`, text: '' }))); return; }
      list.append(...scheduleGroups(league, id, shown, next));
    };
    draw();
    return [bar, summary, list];
  },

  async roster({ league, id, load }) {
    const { groups } = await load('roster', () => getRoster(league, id));
    if (!groups.length) return h('div', { class: 'card' }, emptyState({ iconName: 'book', title: 'No roster available', text: '' }));
    return rosterView(groups);
  },

  async standings({ league, id, load }) {
    const st = await load('standings', () => getStandings(league));
    const featured = new Set(settings.get().featured.filter((t) => t.league === league).map((t) => t.id));
    const view = st.views.division || st.views.conference;
    const group = view.groups.find((g) => g.rows.some((r) => r.team.id === String(id)));
    const out = [];
    if (group) out.push(h('div', { class: 'group-label' }, group.name), standings(group, id, featured));
    if (league === 'mlb') {
      const wc = st.views.wildcard.groups.find((g) => g.rows.some((r) => r.team.id === String(id)));
      if (wc) out.push(h('div', { class: 'group-label' }, wc.name), standings(wc, id, featured));
    }
    if (league === 'nfl') {
      const conf = st.views.conference.groups.find((g) => g.rows.some((r) => r.team.id === String(id)));
      if (conf) out.push(h('div', { class: 'group-label' }, `${conf.name} playoff picture`), standings(conf, id, featured));
    }
    const rec = st.records.get(String(id));
    if (rec?.length) {
      out.push(h('div', { class: 'group-label' }, 'Records'), h('div', { class: 'card' }, rec.map((r) =>
        h('div', { class: 'info-row' }, h('span', { class: 'k' }, r.label), h('span', { class: 'v num' }, r.value)))));
    }
    out.push(h('p', { class: 'footnote' }, h('a', { href: `#/standings/${league}` }, `Full ${LEAGUES[league].name} standings`)));
    if (!group) out.unshift(h('div', { class: 'notice' }, 'This team isn’t in the current standings.'));
    return out;
  },

  async stats({ league, id, schedule, load }) {
    const [st, sched] = await Promise.all([load('stats', () => getTeamStats(league, id)), schedule().catch(() => null)]);
    const out = [];
    // Scoring from completed games (all leagues), with a Home / Away toggle
    const done = (sched?.games || []).filter((g) => g.status.state === 'post' && g.status.completed);
    if (done.length) {
      const unit = league === 'mlb' ? 'Runs' : 'Points';
      const card = h('div');
      const drawScoring = () => {
        clear(card);
        const games = done.filter((g) => view.venue === 'all' || venueOf(g, id) === view.venue);
        // Same full-width toggle as the Schedule tab, above the Scoring heading
        card.append(h('div', { class: 'venue-bar' }, choice(VENUES, VENUES.some((v) => v.id === view.venue) ? view.venue : 'all', (v) => { view.venue = v; drawScoring(); }, { label: 'Home or away' })),
          h('div', { class: 'group-label' }, 'Scoring'));
        if (!games.length) { card.append(h('div', { class: 'card card-pad muted' }, `No completed games ${VENUE_LABEL[view.venue] || ''} yet.`)); return; }
        const s = scoring(games, id);
        card.append(statCard([
          { label: 'Record', value: s.record },
          { label: `${unit} per game`, value: s.pf.toFixed(1) },
          { label: `${unit} allowed per game`, value: s.pa.toFixed(1) },
          { label: `${unit === 'Runs' ? 'Run' : 'Point'} differential`, value: `${s.diff > 0 ? '+' : ''}${s.diff}` },
          { label: 'Games played', value: String(s.n) },
        ]));
      };
      drawScoring();
      out.push(card);
    }
    for (const g of st.groups) out.push(h('div', { class: 'group-label' }, g.name), statCard(g.rows));
    out.push(h('p', { class: 'footnote' }, st.ranked ? `${seasonYear(league)} regular season. Rank is among all 30 teams (1st is best).` : `${seasonYear(league)} regular season. League ranks and advanced stats arrive with the nightly stats.`));
    return out;
  },

  async advanced({ league, id, team, load }) {
    const seasons = await load('seasons', () => getRatingSeasons(league));
    const out = h('div');
    const draw = async (season) => {
      clear(out);
      out.append(h('div', { class: 'skeleton', style: { height: '300px', margin: '0 var(--gutter)', borderRadius: 'var(--radius-md)' } }));
      let data;
      try { data = await load(`ratings-${season}`, () => getRatings(league, season)); } catch (err) {
        clear(out);
        out.append(h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'Advanced stats not available yet', text: `The nightly stats haven\u2019t run for this season. (${err.message})` })));
        return;
      }
      clear(out);
      const split = hasSplits(data);
      const venue = split && VENUES.some((v) => v.id === view.venue) ? view.venue : 'all';
      if (split) {
        out.append(h('div', { class: 'venue-bar' }, choice(VENUES, venue, (v) => { view.venue = v; draw(season); }, { label: 'Home or away' })));
      }
      out.append(...advancedContent(league, id, team, splitData(data, venue), venue));
    };
    const wrap = [];
    if (seasons.length > 1) wrap.push(chips(seasons.map((x) => ({ id: x, label: String(x) })), seasons[0], (x) => { wrap[0].querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === String(x)))); draw(x); }, { label: 'Season' }));
    wrap.push(out);
    draw(seasons[0]);
    return wrap;
  },
};

// ---------------------------------------------------------------- pieces
// Remembered while the app is open: the Home/Away choice carries across teams and tabs
const view = { venue: 'all' };
/** 'home' | 'away' | 'neutral' for this team in game g */
const venueOf = (g, teamId) => (g.neutral ? 'neutral' : g.home.team.id === String(teamId) ? 'home' : 'away');

function scheduleGroups(league, id, games, next) {
    // Group: by month for baseball, by season part for football
    const groupOf = (g) => (league === 'mlb'
      ? new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'America/New_York' }).format(new Date(g.start))
      : g.seasonType === 3 ? 'Postseason' : g.seasonType === 1 ? 'Preseason' : 'Regular season');
    const groups = [];
    for (const g of games) {
      const name = groupOf(g);
      if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, games: [] });
      groups[groups.length - 1].games.push(g);
    }
    return groups.flatMap((grp) => [
      h('div', { class: 'group-label' }, grp.name),
      h('div', { class: 'list' }, grp.games.map((g) => scheduleRow(g, id, g === next))),
    ]);
}

/** Record and scoring for the filtered games: "4-1 at home · 31.2 points per game · 17.0 allowed" */
function venueSummary(league, id, games, venue) {
  const done = games.filter((g) => g.status.state === 'post' && g.status.completed);
  const where = venue === 'neutral' ? 'at neutral sites' : VENUE_LABEL[venue];
  if (!done.length) return h('p', { class: 'venue-summary' }, `No completed games ${where} yet.`);
  const s = scoring(done, id);
  const unit = league === 'mlb' ? 'runs' : 'points';
  return h('p', { class: 'venue-summary' }, h('strong', {}, `${s.record} ${where}`),
    ` \u00b7 ${s.pf.toFixed(1)} ${unit} per game \u00b7 ${s.pa.toFixed(1)} allowed \u00b7 ${s.diff > 0 ? '+' : ''}${s.diff} differential`);
}

/** Record and per-game scoring from completed games */
function scoring(done, id) {
  let pf = 0; let pa = 0; let w = 0; let l = 0; let t = 0;
  for (const g of done) {
    const me = g.home.team.id === String(id) ? g.home : g.away; const opp = me === g.home ? g.away : g.home;
    pf += me.score || 0; pa += opp.score || 0;
    if ((me.score || 0) > (opp.score || 0)) w += 1; else if ((me.score || 0) < (opp.score || 0)) l += 1; else t += 1;
  }
  const n = done.length;
  return { n, w, l, t, record: `${w}-${l}${t ? `-${t}` : ''}`, pf: pf / n, pa: pa / n, diff: pf - pa };
}

function scheduleRow(g, teamId, isNext) {
  const me = g.home.team.id === String(teamId) ? g.home : g.away;
  const opp = me === g.home ? g.away : g.home;
  const where = g.neutral ? 'vs' : me === g.home ? 'vs' : 'at';
  let right;
  if (g.status.state === 'in') right = badge(`Live · ${g.status.detail}`, 'live');
  else if (g.status.state === 'post') {
    const r = resultLine(g, teamId);
    right = r ? h('span', { class: 'sched-result' }, r.outcome === 'W' ? badge('W', 'win') : badge(r.outcome), h('span', { class: `num${r.outcome === 'L' ? ' muted' : ''}` }, r.text.split(' ')[0]))
      : h('span', { class: 'detail' }, g.status.detail);
  } else right = h('span', { class: 'detail' }, g.status.detail === 'TBD' ? 'TBD' : etTime(g.start));
  return h('a', { class: 'list-item sched-row', href: `#/game/${g.league}/${g.id}`, dataset: isNext ? { next: '1' } : {} },
    h('span', { class: 'sched-date' }, h('span', {}, etDay(g.start)), g.week && g.league !== 'mlb' ? h('span', { class: 'muted' }, g.seasonType === 3 ? (g.note || 'Playoffs') : `Week ${g.week}`) : null),
    crest(opp.team, 'sm'),
    h('span', { class: 'grow' }, h('div', { class: 'title' }, `${where} `, opp.team.rank ? h('span', { class: 'muted' }, `${opp.team.rank} `) : null, opp.team.short || opp.team.name),
      g.status.state !== 'post' && g.day === etISODate() ? h('div', { class: 'sub' }, 'Today') : null),
    right);
}

function statCard(rows) {
  return h('div', { class: 'card' }, rows.map((r) => h('div', { class: 'info-row' },
    h('span', { class: 'k' }, r.label),
    h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, r.value), r.rank ? h('span', { class: 'stat-rank' }, r.rank) : null))));
}

function standings(group, teamId, featured) {
  const cols = group.columns.map((c) => ({ key: c.key, label: c.label }));
  const rows = group.rows.map((r) => ({ ...r.values, rank: r.rank, team: r.team, followed: r.team.id === String(teamId) || featured.has(r.team.id) }));
  return standingsTable({ columns: cols, rows, cutAfter: group.cutAfter, onRowClick: (r) => navigate(`team/${r.team.league}/${r.team.id}`) });
}

// ---------------------------------------------------------------- Advanced tab
const SUMMARY = {
  cfb: [['pred', 'Predictor', 'dec1', 'pred_rank'], ['elo', 'Elo', 'int'], ['srs', 'SRS', 'dec1'], ['sp', 'SP+', 'dec1'], ['sos_rank', 'Schedule rank', 'int'], ['top25', 'vs Top 25', 'rec'], ['top50', 'vs Top 50', 'rec']],
  nfl: [['srs', 'SRS', 'dec1', 'srs_rank'], ['elo', 'Elo', 'int'], ['pyth_w', 'Pythagorean wins', 'dec1'], ['luck', 'Luck', 'signed1'], ['po', 'Playoff odds', 'odds'], ['div', 'Division odds', 'odds'], ['bye', '#1 seed odds', 'odds']],
  mlb: [['rd', 'Run differential', 'signed0', 'rd_rank'], ['pyth_w', 'Pythagorean wins', 'dec1'], ['luck', 'Luck', 'signed1'], ['one_run', 'One-run games', 'rec'], ['extra', 'Extra innings', 'rec'], ['po', 'Playoff odds', 'odds'], ['div', 'Division odds', 'odds']],
};
const HIST_NAMES = { pred: 'Predictor', srs: 'SRS', elo: 'Elo', pyth_pct: 'Pythagorean win %', win_pct: 'Win %' };

function advancedContent(league, id, team, data, venue = 'all') {
  const me = data.teams.find((t) => t.id === String(id));
  if (!me) return [h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'No advanced stats for this team', text: `Not in the ${data.season} ${LEAGUES[league].name} data.` }))];
  if (venue !== 'all') return splitContent(league, me, data, venue);
  const defs = STATS[league];
  const out = [];
  const showOdds = (v) => (v == null ? null : pctLabel100(v, 1));

  // Summary
  const rows = SUMMARY[league].map(([k, label, f, rankKey]) => {
    const v = me.v[k];
    if (v == null) return null;
    const val = f === 'odds' ? showOdds(v) : fmt(v, f);
    return h('div', { class: 'info-row' }, h('span', { class: 'k' }, label),
      h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, val), rankKey && me.v[rankKey] ? h('span', { class: 'stat-rank' }, `#${me.v[rankKey]}`) : null));
  }).filter(Boolean);
  out.push(h('div', { class: 'group-label' }, `${data.final ? `Final ${data.season}` : `Through ${data.asOf}`}`), h('div', { class: 'card' }, rows));

  // Rating history
  if (me.hist?.length > 1 && window.Chart) {
    const canvas = h('canvas', { role: 'img', 'aria-label': `${HIST_NAMES[data.histKeys[0]]} by week` });
    out.push(h('div', { class: 'group-label' }, `${HIST_NAMES[data.histKeys[0]] || 'Rating'} over the season`), h('div', { class: 'card card-pad' }, h('div', { class: 'rating-chart' }, canvas)));
    requestAnimationFrame(() => historyChart(canvas, data, me, league));
  }

  // Fingerprint
  const fpDefs = defs.filter((d) => d.fp && me.v[d.key] != null);
  if (fpDefs.length) {
    out.push(h('div', { class: 'group-label' }, 'Percentile fingerprint'),
      h('div', { class: 'card fingerprint' }, fpDefs.map((d) => {
        const p = percentiles(data.teams, d).get(me.id);
        return percentileRow({ label: d.label, pct: p?.pct, value: fmt(me.v[d.key], d.fmt), rank: p?.rank, n: p?.n });
      })),
      h('p', { class: 'footnote' }, `League percentile on key stats: 100 is best in ${SCOPE[league]}, 50 is the median. Lower-is-better stats (like ${league === 'mlb' ? 'ERA' : 'EPA allowed'}) are flipped so longer bars are always better.`));
  }

  // Everything, grouped
  const groups = [...new Set(defs.map((d) => d.group))];
  for (const gname of groups) {
    const items = defs.filter((d) => d.group === gname && me.v[d.key] != null && !d.fp);
    if (!items.length) continue;
    out.push(h('div', { class: 'group-label' }, gname), h('div', { class: 'card' }, items.map((d) => {
      const p = d.hib == null ? null : percentiles(data.teams, d).get(me.id);
      return h('div', { class: 'info-row' }, h('span', { class: 'k' }, d.label),
        h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, fmt(me.v[d.key], d.fmt)), p ? h('span', { class: 'stat-rank' }, ordinal(p.rank)) : null));
    })));
  }

  if (league === 'mlb' && me.months?.length) {
    out.push(h('div', { class: 'group-label' }, 'Record by month'), h('div', { class: 'card' }, me.months.map(([m, rec]) =>
      h('div', { class: 'info-row' }, h('span', { class: 'k' }, m), h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, rec))))));
  }
  out.push(h('p', { class: 'footnote' }, `Ranks are among all ${data.teams.length} teams. Definitions and formulas are in the `, h('a', { href: '#/glossary' }, 'Glossary'), '.'));
  return out;
}

/** Advanced tab for home or road games only: every stat with a split, ranked among all teams' same split. */
function splitContent(league, me, data, venue) {
  const where = VENUE_LABEL[venue];
  if (!Object.keys(me.v).length) return [h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: `No games ${where} yet`, text: '' }))];
  const defs = STATS[league].filter((d) => me.v[d.key] != null && d.fmt !== 'rec');
  const out = [h('div', { class: 'group-label' }, `${me.record || ''} ${where} \u00b7 ${data.final ? `final ${data.season}` : `through ${data.asOf}`}`)];
  for (const gname of [...new Set(defs.map((d) => d.group))]) {
    const items = defs.filter((d) => d.group === gname);
    out.push(h('div', { class: 'group-label' }, gname), h('div', { class: 'card' }, items.map((d) => {
      const p = d.hib == null ? null : percentiles(data.teams, d).get(me.id);
      const all = me.vAll?.[d.key];
      return h('div', { class: 'info-row' }, h('span', { class: 'k' }, d.label, all != null ? h('span', { class: 'stat-all' }, `All games ${fmt(all, d.fmt)}`) : null),
        h('span', { class: 'v num' }, h('strong', { class: 'stat-val' }, fmt(me.v[d.key], d.fmt)), p ? h('span', { class: 'stat-rank' }, ordinal(p.rank)) : null));
    })));
  }
  out.push(h('p', { class: 'footnote' }, `Games ${where} only${league === 'mlb' ? '' : ' (neutral-site games are left out)'}. Ranks compare every team\u2019s games ${where} (1st is best). Ratings like ${league === 'cfb' ? 'Predictor and SRS' : league === 'nfl' ? 'SRS and Elo' : 'Pythagorean wins'} use all games, so they\u2019re under All games.`));
  return out;
}

function historyChart(canvas, data, me, league) {
  if (!canvas.isConnected) return;
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const idx = 0;
  const values = me.hist.map((p) => p[idx]);
  const isPct = data.histKeys[idx] === 'pyth_pct';
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: { labels: data.histLabels.slice(-values.length), datasets: [{ data: values, borderColor: v('--podium'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: v('--podium'), tension: 0, spanGaps: true }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: v('--line') }, ticks: { color: v('--ink-muted'), font: { family: 'Inter', size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { grid: { color: v('--line') }, border: { display: false }, ticks: { color: v('--ink-muted'), font: { family: 'Inter', size: 11 }, maxTicksLimit: 5, callback: (x) => (isPct ? x.toFixed(3).replace(/^0/, '') : x) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: v('--surface'), borderColor: v('--line'), borderWidth: 1, titleColor: v('--ink-muted'), bodyColor: v('--ink'), displayColors: false, padding: 8, cornerRadius: 4,
          titleFont: { family: 'Inter', size: 11 }, bodyFont: { family: 'Space Grotesk', size: 13, weight: '700' },
          callbacks: { label: (it) => `${HIST_NAMES[data.histKeys[idx]]} ${isPct ? Number(it.raw).toFixed(3).replace(/^0/, '') : it.raw}` } },
      },
    },
  });
  const stop = new MutationObserver(() => { if (!canvas.isConnected) { chart.destroy(); stop.disconnect(); } });
  stop.observe(document.getElementById('view'), { childList: true, subtree: true });
}
