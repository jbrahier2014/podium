// Team page: schedule and results, roster, standings context, season stats, and
// an Advanced tab (advanced stats and the percentile fingerprint arrive with the
// nightly stats in phase 5).

import { h, icon, ICONS, toast, clear } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { getTeams, getTeamSchedule, getRoster, getStandings, getTeamStats } from '../data/index.js';
import { LEAGUES, seasonYear } from '../leagues.js';
import { etDay, etTime, etISODate } from '../util/time.js';
import { crest, tabs, badge, emptyState, standingsTable } from '../ui/components.js';
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

// ---------------------------------------------------------------- tabs
const TAB_RENDERERS = {
  async schedule({ league, id, schedule }) {
    const { games } = await schedule();
    if (!games.length) return h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No games scheduled', text: '' }));
    const sorted = [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const next = sorted.find((g) => g.status.state !== 'post');
    // Group: by month for baseball, by season part for football
    const groupOf = (g) => (league === 'mlb'
      ? new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'America/New_York' }).format(new Date(g.start))
      : g.seasonType === 3 ? 'Postseason' : g.seasonType === 1 ? 'Preseason' : 'Regular season');
    const groups = [];
    for (const g of sorted) {
      const name = groupOf(g);
      if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, games: [] });
      groups[groups.length - 1].games.push(g);
    }
    return groups.flatMap((grp) => [
      h('div', { class: 'group-label' }, grp.name),
      h('div', { class: 'list' }, grp.games.map((g) => scheduleRow(g, id, g === next))),
    ]);
  },

  async roster({ league, id, load }) {
    const { groups } = await load('roster', () => getRoster(league, id));
    if (!groups.length) return h('div', { class: 'card' }, emptyState({ iconName: 'book', title: 'No roster available', text: '' }));
    return groups.flatMap((g) => [
      h('div', { class: 'group-label' }, `${g.name} · ${g.players.length}`),
      h('div', { class: 'list' }, g.players.map((p) => h('div', { class: 'list-item roster-row' },
        h('span', { class: 'jersey' }, p.jersey),
        h('span', { class: 'grow' }, h('div', { class: 'title' }, p.name), p.detail ? h('div', { class: 'sub' }, p.detail) : null),
        p.pos ? badge(p.pos) : null))),
    ]);
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
    // Scoring from completed games (all leagues)
    const done = (sched?.games || []).filter((g) => g.status.state === 'post' && g.status.completed);
    if (done.length) {
      let pf = 0; let pa = 0;
      for (const g of done) { const me = g.home.team.id === String(id) ? g.home : g.away; const opp = me === g.home ? g.away : g.home; pf += me.score || 0; pa += opp.score || 0; }
      const unit = league === 'mlb' ? 'Runs' : 'Points';
      out.push(h('div', { class: 'group-label' }, 'Scoring'), statCard([
        { label: `${unit} per game`, value: (pf / done.length).toFixed(1) },
        { label: `${unit} allowed per game`, value: (pa / done.length).toFixed(1) },
        { label: `${unit === 'Runs' ? 'Run' : 'Point'} differential`, value: `${pf - pa > 0 ? '+' : ''}${pf - pa}` },
        { label: 'Games played', value: String(done.length) },
      ]));
    }
    for (const g of st.groups) out.push(h('div', { class: 'group-label' }, g.name), statCard(g.rows));
    out.push(h('p', { class: 'footnote' }, st.ranked ? `${seasonYear(league)} regular season. Rank is among all 30 teams (1st is best).` : `${seasonYear(league)} regular season. League ranks and advanced stats arrive with the nightly stats.`));
    return out;
  },

  async advanced({ team }) {
    return h('div', { class: 'card' }, emptyState({
      iconName: 'scatter',
      title: 'Advanced stats',
      text: `${team.short || team.name}’s advanced numbers and a percentile fingerprint across 15 key stats arrive with the nightly stats (phase 5).`,
    }));
  },
};

// ---------------------------------------------------------------- pieces
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
