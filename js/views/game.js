// Game detail: header with the score, then tabs for the summary (line score,
// win probability, scoring summary, game info), box score, play-by-play and
// team stat comparison. Refreshes on the Settings interval while the game is live.

import { pctLabel100 } from '../util/prob.js';
import { h, clear, icon, ICONS } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { settings } from '../store/settings.js';
import { getGame } from '../data/index.js';
import { etDay, etTime } from '../util/time.js';
import { livePoller } from '../util/poller.js';
import { crest, badge, tabs, chips, statBar, emptyState } from '../ui/components.js';
import { footText } from '../ui/format.js';
import { loadEP } from '../data/ep.js';
import { epSection, drawEPA, epaById, epaChip } from './game-ep.js';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'box', label: 'Box score' },
  { id: 'plays', label: 'Plays' },
  { id: 'epa', label: 'EPA', football: true },
  { id: 'stats', label: 'Team stats' },
];

export default {
  async render(ctx) {
    const { league, id } = ctx.params;
    if (!LEAGUES[league]) throw new Error('Unknown league');
    ctx.setTitle('Game');

    const hero = h('div', { class: 'game-hero' }, h('div', { class: 'skeleton', style: { height: '150px' } }));
    const body = h('div');
    const football = league !== 'mlb';
    const tabList = TABS.filter((t) => !t.football || football);
    const state = { tab: ctx.query.tab && tabList.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'summary', boxSide: 'away', open: new Set(), whatIf: null };
    const modelLoad = football ? loadEP(league).catch(() => null) : Promise.resolve(null);
    const tabBar = tabs(tabList, state.tab, (t) => { state.tab = t; drawBody(); }, { label: 'Game sections' });
    ctx.el.append(hero, tabBar, body);

    let detail;
    try {
      detail = await getGame(league, id);
    } catch (err) {
      clear(hero); tabBar.remove();
      body.append(h('div', { class: 'notice strong' }, `Couldn’t load this game: ${err.message}`));
      return;
    }
    const model = await modelLoad;
    if (!ctx.isCurrent()) return;

    const g0 = detail.game;
    ctx.setTitle(`${g0.away.team.abbr} @ ${g0.home.team.abbr}`);
    state.boxSide = g0.away.team.id;

    let chart;
    function drawAll() {
      drawHero(hero, detail);
      drawBody();
    }
    function drawBody() {
      chart?.destroy(); chart = null;
      clear(body);
      const d = detail;
      if (state.tab === 'summary') chart = drawSummary(body, d, model, state);
      else if (state.tab === 'box') drawBox(body, d, state, drawBody);
      else if (state.tab === 'plays') drawPlays(body, d, state, model);
      else if (state.tab === 'epa') chart = drawEPA(body, d, model);
      else drawStats(body, d);
    }
    drawAll();
    ctx.onCleanup(() => chart?.destroy());

    const poller = livePoller({
      initial: detail,
      isLive: (d) => d.game.status.state === 'in' || (d.game.status.state === 'pre' && Date.parse(d.game.start) <= Date.now() + 120_000 && Date.parse(d.game.start) > Date.now() - 6 * 3600_000),
      intervalMs: () => settings.get().refreshSeconds * 1000,
      tick: async () => {
        const d = await getGame(league, id, { force: true });
        if (ctx.isCurrent()) { detail = d; drawAll(); }
        return d;
      },
    });
    ctx.onCleanup(() => poller.stop());
  },
};

// ---------------------------------------------------------------- header
function drawHero(el, d) {
  clear(el);
  const g = d.game;
  const final = g.status.state === 'post';
  const loser = final && g.home.score !== g.away.score ? (g.home.score < g.away.score ? 'home' : 'away') : null;
  const teamBlock = (s) => h('a', { class: 'gh-team', href: `#/team/${g.league}/${s.team.id}` },
    crest(s.team, 'lg'),
    h('span', { class: 'nm' }, s.team.rank ? h('span', { class: 'rk' }, s.team.rank) : null, s.team.short || s.team.name),
    s.record ? h('span', { class: 'rec' }, s.record) : null);
  const scores = g.status.state === 'pre'
    ? h('div', { class: 'gh-mid' }, h('span', { class: 'gh-dash' }, 'vs'))
    : h('div', { class: 'gh-mid' },
      h('span', { class: `gh-score${loser === 'away' ? ' loser' : ''}` }, g.away.score ?? 0),
      h('span', { class: 'gh-dash' }, '–'),
      h('span', { class: `gh-score${loser === 'home' ? ' loser' : ''}` }, g.home.score ?? 0));

  const statusBadge = g.status.state === 'in' ? badge(`Live · ${g.status.detail}`, 'live')
    : final ? badge(g.status.detail, 'strong') : badge(`${etDay(g.start)} · ${g.status.detail === 'TBD' ? 'TBD' : etTime(g.start)}`);
  const foot = footText(g);

  el.append(
    h('div', { class: 'gh-context' }, [LEAGUES[g.league].name, g.note].filter(Boolean).join(' · ')),
    h('div', { class: 'gh-row' }, teamBlock(g.away), scores, teamBlock(g.home)),
    h('div', { class: 'gh-status' }, statusBadge,
      final || g.status.state === 'in' ? null : h('div', { class: 'gh-sub' }, 'Eastern time'),
      foot ? h('div', { class: 'gh-sub' }, foot) : null),
  );
}

// ---------------------------------------------------------------- summary
function drawSummary(el, d, model, state) {
  const g = d.game;
  let chart = null;
  if (d.linescore) el.append(lineScore(d));
  // Live: expected points right under the score. Finished: a what-if tool, after the story of the game.
  if (g.league !== 'mlb' && g.status.state === 'in') el.append(epSection(d, model, state));

  if (d.winProb?.length > 1) {
    const r = winProbCard(d);
    el.append(sectionLabel('Win probability'), r.el);
    chart = r.chart;
  }

  if (d.scoring?.length) {
    el.append(sectionLabel('Scoring'), h('div', { class: 'card' }, d.scoring.map((p) => {
      const team = p.teamId === g.home.team.id ? g.home.team : g.away.team;
      return h('div', { class: 'score-row' },
        h('div', { class: 'lead' }, crest(team, 'sm'), h('span', { class: 'when' }, [p.period, p.clock].filter(Boolean).join(' '))),
        h('div', { class: 'txt' }, p.type ? h('span', { class: 'badge', style: { marginRight: 'var(--space-2)' } }, p.type) : null, p.text),
        h('div', { class: 'sc' }, `${p.away}–${p.home}`));
    })));
  }

  if (g.league !== 'mlb' && g.status.state === 'post') el.append(epSection(d, model, state));

  if (g.status.state === 'pre') {
    el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'Not started', text: 'Box score, plays and win probability appear once the game starts.' })));
  }

  if (d.info?.length) {
    el.append(sectionLabel('Game info'), h('div', { class: 'card' }, d.info.map((i) =>
      h('div', { class: 'info-row' }, h('span', { class: 'k' }, i.label), h('span', { class: 'v' }, i.value)))));
  }
  return chart;
}

const sectionLabel = (t) => h('div', { class: 'group-label' }, t);

function lineScore(d) {
  const g = d.game; const ls = d.linescore;
  const row = (side, vals, totals) => h('tr', {},
    h('td', {}, h('span', { class: 'ls-team' }, crest(g[side].team, 'sm'), g[side].team.abbr)),
    vals.map((v) => h('td', {}, v)),
    totals.map((v) => h('td', { class: 'tot' }, v)));
  return h('div', { class: 'card table-wrap linescore' },
    h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), ls.labels.map((l) => h('th', {}, l)), ls.totalLabels.map((l) => h('th', { class: 'tot' }, l)))),
      h('tbody', {}, row('away', ls.away, ls.awayTotals), row('home', ls.home, ls.homeTotals))));
}

// Win probability: one line (home team's chance), 50% midline, crosshair tooltip.
function winProbCard(d) {
  const g = d.game;
  const pts = d.winProb;
  const last = pts[pts.length - 1];
  const homeLeads = last.home >= 50;
  const leader = homeLeads ? g.home.team : g.away.team;
  const pct = pctLabel100(homeLeads ? last.home : 100 - last.home);
  const final = g.status.state === 'post';

  const canvas = h('canvas', { role: 'img', 'aria-label': `Win probability chart. ${leader.short || leader.name} ${final ? 'won' : `${pct} to win`}.` });
  const el = h('div', { class: 'card wp-card' },
    h('div', { class: 'wp-head' },
      h('span', { class: 'wp-now' }, final ? leader.abbr : pct, h('span', { class: 'who' }, final ? 'won' : `${leader.short || leader.name} to win`)),
      h('span', { class: 't-caption' }, `Top: ${g.home.team.abbr} · Bottom: ${g.away.team.abbr}`)),
    h('div', { class: 'wp-canvas' }, canvas));

  if (!window.Chart) return { el, chart: null };
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const football = g.league !== 'mlb';
  const maxX = football ? Math.max(60, Math.ceil(Math.max(...pts.map((p) => p.x)))) : Math.max(9, Math.ceil(Math.max(...pts.map((p) => p.x))));

  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(c) {
      const a = c.tooltip?.getActiveElements?.();
      if (!a?.length) return;
      const x = a[0].element.x;
      const { top, bottom } = c.chartArea;
      c.ctx.save(); c.ctx.strokeStyle = v('--line-strong'); c.ctx.lineWidth = 1;
      c.ctx.beginPath(); c.ctx.moveTo(x, top); c.ctx.lineTo(x, bottom); c.ctx.stroke(); c.ctx.restore();
    },
  };

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: { datasets: [{ data: pts.map((p) => ({ x: p.x, y: p.home, label: p.label })), borderColor: v('--podium'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: v('--podium'), pointHoverBorderColor: v('--surface'), pointHoverBorderWidth: 2, tension: 0, fill: false }] },
    plugins: [crosshair],
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 4 } },
      scales: {
        x: {
          type: 'linear', min: 0, max: maxX,
          grid: { color: v('--line'), drawTicks: false }, border: { display: false },
          ticks: {
            stepSize: football ? 15 : 1, color: v('--ink-muted'), font: { family: 'Inter', size: 11 }, padding: 6,
            callback: (val) => (football ? ({ 0: 'Q1', 15: 'Q2', 30: 'Q3', 45: 'Q4', 60: 'OT' })[val] ?? '' : (val < maxX ? String(val + 1) : '')),
          },
        },
        y: {
          min: 0, max: 100,
          grid: { color: (c) => (c.tick.value === 50 ? v('--line-strong') : 'transparent'), drawTicks: false }, border: { display: false },
          ticks: { stepSize: 50, color: v('--ink-muted'), font: { family: 'Inter', size: 11 }, padding: 6, callback: (val) => (val === 100 ? g.home.team.abbr : val === 0 ? g.away.team.abbr : '50%') },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: v('--surface'), borderColor: v('--line'), borderWidth: 1, titleColor: v('--ink-muted'), bodyColor: v('--ink'),
          titleFont: { family: 'Inter', size: 11, weight: '500' }, bodyFont: { family: 'Space Grotesk', size: 13, weight: '700' },
          displayColors: false, padding: 8, cornerRadius: 4,
          callbacks: {
            title: (items) => items[0]?.raw?.label || '',
            label: (item) => { const y = item.raw.y; return y >= 50 ? `${g.home.team.abbr} ${pctLabel100(y)}` : `${g.away.team.abbr} ${pctLabel100(100 - y)}`; },
          },
        },
      },
    },
  });
  return { el, chart };
}

// ---------------------------------------------------------------- box score
function drawBox(el, d, state, redraw) {
  const g = d.game;
  if (!d.box) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No box score yet', text: 'It fills in once the game starts.' }))); return; }
  el.append(chips([
    { id: g.away.team.id, label: g.away.team.short || g.away.team.abbr },
    { id: g.home.team.id, label: g.home.team.short || g.home.team.abbr },
  ], state.boxSide, (id) => { state.boxSide = id; redraw(); }, { label: 'Team' }));
  const sections = state.boxSide === g.home.team.id ? d.box.home : d.box.away;
  if (!sections.length) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No player stats yet', text: '' }))); return; }
  for (const s of sections) {
    el.append(h('div', { class: 'card box-section' },
      h('div', { class: 'bs-title' }, s.title),
      h('div', { class: 'table-wrap' }, h('table', { class: 'stats' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), s.labels.map((l) => h('th', {}, l)))),
        h('tbody', {},
          s.rows.map((r) => h('tr', {}, h('td', { class: r.sub ? 'sub' : null }, r.name.trim()), r.values.map((v) => h('td', {}, v)))),
          s.totals ? h('tr', { class: 'totals' }, h('td', {}, 'Team'), s.totals.map((v) => h('td', {}, v))) : null)))));
  }
}

// ---------------------------------------------------------------- plays
function drawPlays(el, d, state, model) {
  const g = d.game;
  const epa = g.league !== 'mlb' ? epaById(d, model) : new Map();
  if (!d.plays?.length) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No plays yet', text: 'Play-by-play fills in once the game starts.' }))); return; }
  el.append(h('div', { class: 'card' }, d.plays.map((grp, i) => {
    const key = `${grp.title}-${grp.sub}-${d.plays.length - i}`;
    const team = grp.teamId === g.home.team.id ? g.home.team : g.away.team;
    const det = h('details', { class: 'play-group', open: i === 0 || state.open.has(key) },
      h('summary', {}, crest(team, 'sm'),
        h('span', { class: 'grow' }, h('div', { class: 'title' }, grp.title, grp.scoring ? h('span', { class: 'badge strong', style: { marginLeft: 'var(--space-2)' } }, 'Score') : null), grp.sub ? h('div', { class: 'sub' }, grp.sub) : null),
        icon(ICONS.chevron)),
      h('div', { class: 'pg-body' }, grp.items.map((p) => h('div', { class: `play-item${p.scoring ? ' scoring' : ''}` },
        p.meta || epa.has(p.id) ? h('div', { class: 'meta' }, h('span', {}, p.meta), epaChip(epa.get(p.id)?.epa)) : null, h('div', { class: 'txt' }, p.text)))));
    det.addEventListener('toggle', () => { if (det.open) state.open.add(key); else state.open.delete(key); });
    return det;
  })));
}

// ---------------------------------------------------------------- team stats
function drawStats(el, d) {
  const g = d.game;
  if (!d.teamStats?.length) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No team stats yet', text: 'They fill in once the game starts.' }))); return; }
  el.append(h('div', { class: 'card stat-compare' },
    h('div', { class: 'sc-teams' }, h('span', {}, crest(g.away.team, 'sm'), g.away.team.abbr), h('span', {}, g.home.team.abbr, crest(g.home.team, 'sm'))),
    d.teamStats.map((s) => statBar({ label: s.label, home: s.away, away: s.home, lowerIsBetter: s.lowerIsBetter, display: [s.awayDisplay, s.homeDisplay] }))));
}
