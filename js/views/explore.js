// Stat Explorer: five tools over the nightly stats files.
//   Leaders       every team on one stat, sorted, with percentile bars
//   Head-to-head  any two teams, stat by stat (bars show league percentile)
//   Scatter       pick any two stats; tap a dot to open the team; your teams highlighted
//   Trends        rolling game-by-game (NFL EPA, MLB runs) or week-by-week ratings
//   Seasons       one team across the current and three previous seasons
//
// URL keeps the choices:  #/explore/nfl?tool=scatter&x=o_epa&y=d_epa&season=2026

import { h, clear } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { settings } from '../store/settings.js';
import { getRatings, getRatingSeasons, getTeams } from '../data/index.js';
import { STATS, fmt, percentiles, ordinal, SCOPE } from '../data/statdefs.js';
import { crest, tabs, chips, statBar, percentileRow, sparkline, emptyState } from '../ui/components.js';
import { pageTitle, leagueTabs, defaultLeague } from './common.js';
import { navigate } from '../router.js';
import { monthDay } from '../util/time.js';

const TOOLS = [
  { id: 'leaders', label: 'Leaders' },
  { id: 'h2h', label: 'Versus' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'trends', label: 'Trends' },
  { id: 'seasons', label: 'Seasons' },
];

const DEFAULTS = {
  cfb: { stat: 'pred', x: 'o_epa', y: 'd_epa' },
  nfl: { stat: 'o_epa', x: 'o_epa', y: 'd_epa' },
  mlb: { stat: 'rd', x: 'woba', y: 'fip' },
};

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : defaultLeague();
    ctx.setTitle('Explore');
    const q = { ...DEFAULTS[league], tool: 'leaders', ...ctx.query };
    const setQuery = (patch) => {
      Object.assign(q, patch);
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString();
      history.replaceState(null, '', `#/explore/${league}?${qs}`);
    };

    const seasonBar = h('div');
    const body = h('div');
    ctx.el.append(
      ...pageTitle('Explore'),
      leagueTabs(league, (id) => navigate(`explore/${id}`, { replace: true })),
      seasonBar,
      tabs(TOOLS, q.tool, (t) => { setQuery({ tool: t }); draw(); }, { label: 'Tools' }),
      body,
    );

    let seasons; let data; let info;
    const charts = new Set();
    ctx.onCleanup(() => charts.forEach((c) => c.destroy()));
    try {
      [seasons, info] = await Promise.all([
        getRatingSeasons(league),
        getTeams(league).then((r) => new Map(r.teams.map((t) => [t.id, t]))).catch(() => new Map()),
      ]);
      q.season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
      data = await getRatings(league, q.season);
    } catch (err) {
      body.append(h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'Stats not available yet', text: err.message })));
      return;
    }
    if (!ctx.isCurrent()) return;

    const ident = (t) => {
      const i = info.get(t.id) || {};
      return { id: t.id, league, abbr: i.abbr || t.abbr || '?', short: i.short || t.name || t.abbr, name: i.name || t.name, color: i.color || null, logo: i.logo || null };
    };
    const featured = () => new Set(settings.get().featured.filter((t) => t.league === league).map((t) => t.id));

    const drawSeasons = () => {
      clear(seasonBar);
      if (seasons.length > 1 && q.tool !== 'seasons') {
        seasonBar.append(chips(seasons.map((s) => ({ id: s, label: String(s) })), q.season, async (s) => {
          setQuery({ season: s });
          data = await getRatings(league, s);
          if (ctx.isCurrent()) draw();
        }, { label: 'Season' }));
      }
    };

    async function draw() {
      charts.forEach((c) => c.destroy()); charts.clear();
      drawSeasons();
      clear(body);
      const env = { league, data, q, setQuery, ident, featured: featured(), charts, seasons, redraw: draw };
      try {
        const content = await TOOL_RENDER[q.tool](env);
        if (ctx.isCurrent()) body.append(...[].concat(content));
      } catch (err) {
        console.error(err);
        body.append(h('div', { class: 'notice strong' }, `Couldn’t draw this: ${err.message}`));
      }
    }
    draw();
  },
};

// ---------------------------------------------------------------- shared controls
function statSelect(league, value, onChange, { label = 'Stat', filter = () => true } = {}) {
  const groups = [...new Set(STATS[league].map((d) => d.group))];
  const sel = h('select', { class: 'ex-select', 'aria-label': label },
    groups.map((g) => h('optgroup', { label: g }, STATS[league].filter((d) => d.group === g && filter(d)).map((d) =>
      h('option', { value: d.key, selected: d.key === value }, d.label)))));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function teamSelect(teams, value, onChange, label = 'Team') {
  const sorted = [...teams].sort((a, b) => a.short.localeCompare(b.short));
  const sel = h('select', { class: 'ex-select', 'aria-label': label }, sorted.map((t) => h('option', { value: t.id, selected: t.id === value }, t.short)));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const field = (label, control) => h('label', { class: 'ex-field' }, h('span', { class: 't-overline muted' }, label), control);
const defOf = (league, key) => STATS[league].find((d) => d.key === key) || STATS[league][0];
const firstFeatured = (env) => settings.get().featured.filter((f) => f.league === env.league).map((f) => String(f.id)).find((id) => env.data.teams.some((t) => t.id === id)) || env.data.teams[0].id;
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------------------------------------------------------------- tools
const TOOL_RENDER = {
  // ---- Leaders
  leaders(env) {
    const { league, data, q, setQuery, ident, featured } = env;
    const def = defOf(league, q.stat);
    const pcts = percentiles(data.teams, def);
    const rows = data.teams.filter((t) => t.v[def.key] != null).sort((a, b) => {
      const s = def.hib === false ? 1 : -1;
      return s * (a.v[def.key] - b.v[def.key]);
    });
    const list = h('div', { class: 'card' }, rows.map((t, i) => {
      const p = pcts.get(t.id);
      const id = ident(t);
      return h('a', { class: `leader-row${featured.has(t.id) ? ' followed' : ''}`, href: `#/team/${league}/${t.id}?tab=advanced` },
        h('span', { class: 'rank' }, i + 1),
        crest(id, 'sm'),
        h('span', { class: 'lr-name' }, id.short),
        h('span', { class: 'lr-bar' }, h('span', { class: 'lr-fill', style: { width: `${p ? p.pct : 0}%` } })),
        h('span', { class: 'lr-val' }, fmt(t.v[def.key], def.fmt)));
    }));
    return [
      h('div', { class: 'ex-controls' }, field('Stat', statSelect(league, def.key, (k) => { setQuery({ stat: k }); env.redraw(); }))),
      def.hib == null ? h('p', { class: 'footnote', style: { marginTop: 0, marginBottom: 'var(--space-3)' } }, 'A style stat: neither high nor low is better. Sorted high to low.') : null,
      list,
      h('p', { class: 'footnote' }, `${rows.length} teams · ${data.final ? `final ${data.season}` : `through ${data.asOf}`}. Bars show league percentile (full = best). Tap a team for its fingerprint.`),
    ].filter(Boolean);
  },

  // ---- Head-to-head
  h2h(env) {
    const { league, data, q, setQuery, ident } = env;
    const teams = data.teams.map((t) => ({ ...t, ...ident(t), v: t.v }));
    const aId = teams.some((t) => t.id === q.a) ? q.a : firstFeatured(env);
    const bId = teams.some((t) => t.id === q.b) && q.b !== aId ? q.b : teams.find((t) => t.id !== aId && !env.featured.has(t.id))?.id;
    const A = teams.find((t) => t.id === aId); const B = teams.find((t) => t.id === bId);
    const defs = [...STATS[league].filter((d) => d.fp), ...STATS[league].filter((d) => !d.fp)].filter((d) => d.hib != null && A.v[d.key] != null && B.v[d.key] != null);
    const groups = [{ name: 'Key stats', defs: defs.filter((d) => d.fp) }, ...[...new Set(defs.filter((d) => !d.fp).map((d) => d.group))].map((g) => ({ name: g, defs: defs.filter((d) => !d.fp && d.group === g) }))];
    let aWins = 0; let bWins = 0;
    const blocks = groups.filter((g) => g.defs.length).map((g) => [
      h('div', { class: 'group-label' }, g.name),
      h('div', { class: 'card stat-compare' }, g.defs.map((d) => {
        const p = percentiles(data.teams, d);
        const pa = p.get(A.id)?.pct ?? 0; const pb = p.get(B.id)?.pct ?? 0;
        if (g.name === 'Key stats') { if (pa > pb) aWins++; else if (pb > pa) bWins++; }
        return statBar({ label: d.label, home: pa, away: pb, display: [fmt(A.v[d.key], d.fmt), fmt(B.v[d.key], d.fmt)] });
      })),
    ]).flat();
    return [
      h('div', { class: 'ex-controls two' },
        field('Team', teamSelect(teams, A.id, (id) => { setQuery({ a: id }); env.redraw(); })),
        field('vs', teamSelect(teams, B.id, (id) => { setQuery({ b: id }); env.redraw(); }))),
      h('div', { class: 'card h2h-head' },
        h('div', { class: 'h2h-side' }, crest(A, 'lg'), h('div', { class: 'h2h-name' }, A.short), h('div', { class: 't-caption' }, A.record || '')),
        h('div', { class: 'h2h-score' }, h('span', {}, aWins), h('span', { class: 'muted' }, '–'), h('span', {}, bWins)),
        h('div', { class: 'h2h-side' }, crest(B, 'lg'), h('div', { class: 'h2h-name' }, B.short), h('div', { class: 't-caption' }, B.record || ''))),
      h('p', { class: 'footnote', style: { marginTop: 0, marginBottom: 'var(--space-2)', textAlign: 'center' } }, 'Key stats won. Bars compare league percentiles; the better side is highlighted.'),
      ...blocks,
    ];
  },

  // ---- Scatter
  scatter(env) {
    const { league, data, q, setQuery, ident, featured, charts } = env;
    const dx = defOf(league, q.x); const dy = defOf(league, q.y);
    const pts = data.teams.filter((t) => t.v[dx.key] != null && t.v[dy.key] != null).map((t) => ({ x: t.v[dx.key], y: t.v[dy.key], t, id: ident(t) }));
    const canvas = h('canvas', { role: 'img', 'aria-label': `Scatter plot of ${dy.label} against ${dx.label} for ${pts.length} teams` });
    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const mx = median(pts.map((p) => p.x)); const my = median(pts.map((p) => p.y));
    const flipped = [dx.hib === false ? 'x' : null, dy.hib === false ? 'y' : null].filter(Boolean);

    // Tap a dot to select it (ring + details below); the details link opens the team.
    let selected = null;
    const pctX = percentiles(data.teams, dx); const pctY = percentiles(data.teams, dy);
    const panel = h('div', { class: 'scatter-pick', 'aria-live': 'polite' });
    const drawPanel = () => {
      clear(panel);
      if (!selected) { panel.append(h('span', { class: 't-caption' }, 'Tap a dot to see the team.')); return; }
      const p = selected; const rx = pctX.get(p.t.id); const ry = pctY.get(p.t.id);
      const name = (d) => (dx.short === dy.short ? d.label : d.short);
      const val = (d, v, r) => h('div', { class: 'sp-val' }, h('span', { class: 'k' }, name(d)), h('span', { class: 'v' }, fmt(v, d.fmt)), r && d.hib != null ? h('span', { class: 'r' }, ordinal(r.rank)) : null);
      panel.append(
        crest(p.id, 'sm'),
        h('div', { class: 'sp-name' }, h('div', { class: 'nm' }, p.id.short), p.t.record ? h('div', { class: 't-caption' }, p.t.record) : null),
        val(dx, p.x, rx), val(dy, p.y, ry),
        h('a', { class: 'btn ghost sp-open', href: `#/team/${league}/${p.t.id}?tab=advanced` }, 'Open'));
    };
    drawPanel();

    requestAnimationFrame(() => {
      if (!canvas.isConnected || !window.Chart) return;
      const ink = cssVar('--ink'); const muted = cssVar('--ink-muted'); const line = cssVar('--line'); const strong = cssVar('--line-strong');
      const podium = cssVar('--podium'); const surface = cssVar('--surface');
      const mine = pts.filter((p) => featured.has(p.t.id)); const rest = pts.filter((p) => !featured.has(p.t.id));
      const medianLines = {
        id: 'medians',
        beforeDatasetsDraw(c) {
          const { ctx: g, chartArea: a, scales } = c;
          g.save(); g.strokeStyle = strong; g.setLineDash([3, 3]); g.lineWidth = 1;
          const X = scales.x.getPixelForValue(mx); const Y = scales.y.getPixelForValue(my);
          g.beginPath(); g.moveTo(X, a.top); g.lineTo(X, a.bottom); g.moveTo(a.left, Y); g.lineTo(a.right, Y); g.stroke(); g.restore();
        },
        afterDatasetsDraw(c) {
          // Direct labels for your teams
          const meta = c.getDatasetMeta(1); const g = c.ctx;
          g.save(); g.font = '600 11px Inter'; g.fillStyle = ink; g.textBaseline = 'middle';
          meta.data.forEach((el, i) => { const p = mine[i]; if (p) g.fillText(p.id.abbr, el.x + 7, el.y); });
          // The selected dot: ring and name
          if (selected) {
            const ds = featured.has(selected.t.id) ? 1 : 0;
            const el = c.getDatasetMeta(ds).data[(ds ? mine : rest).indexOf(selected)];
            if (el) {
              g.strokeStyle = podium; g.lineWidth = 2; g.beginPath(); g.arc(el.x, el.y, 10, 0, Math.PI * 2); g.stroke();
              g.font = '700 12px Inter'; g.fillStyle = ink;
              const w = g.measureText(selected.id.abbr).width;
              const tx = el.x + 14 + w > c.chartArea.right ? el.x - 14 - w : el.x + 14;
              g.fillText(selected.id.abbr, tx, el.y - 12);
            }
          }
          g.restore();
        },
      };
      const chart = new window.Chart(canvas, {
        type: 'scatter',
        data: { datasets: [
          { data: rest, pointRadius: 4, pointHoverRadius: 6, backgroundColor: muted, borderColor: surface, borderWidth: 1 },
          { data: mine, pointRadius: 6, pointHoverRadius: 8, backgroundColor: podium, borderColor: surface, borderWidth: 2 },
        ] },
        plugins: [medianLines],
        options: {
          animation: false, responsive: true, maintainAspectRatio: false,
          parsing: { xAxisKey: 'x', yAxisKey: 'y' },
          scales: {
            x: { reverse: dx.hib === false, title: { display: true, text: dx.label, color: muted, font: { family: 'Inter', size: 11, weight: '600' } }, grid: { color: line }, border: { display: false }, ticks: { color: muted, font: { family: 'Inter', size: 10 }, maxTicksLimit: 6, callback: (v) => fmt(v, dx.fmt) } },
            y: { reverse: dy.hib === false, title: { display: true, text: dy.label, color: muted, font: { family: 'Inter', size: 11, weight: '600' } }, grid: { color: line }, border: { display: false }, ticks: { color: muted, font: { family: 'Inter', size: 10 }, maxTicksLimit: 6, callback: (v) => fmt(v, dy.fmt) } },
          },
          plugins: {
            legend: { display: false },
            // Hover tooltips with a mouse; on a phone the tap selection does the job
            tooltip: { enabled: matchMedia('(hover: hover)').matches, backgroundColor: surface, borderColor: line, borderWidth: 1, titleColor: ink, bodyColor: muted, displayColors: false, padding: 8, cornerRadius: 4,
              titleFont: { family: 'Inter', size: 12, weight: '600' }, bodyFont: { family: 'Inter', size: 11 },
              callbacks: { title: (items) => items[0].raw.id.short, label: (it) => [`${dx.short}: ${fmt(it.raw.x, dx.fmt)}`, `${dy.short}: ${fmt(it.raw.y, dy.fmt)}`] } },
          },
          onClick: (evt, _, c) => {
            // Nearest dot within a fingertip (24px); tapping empty space clears
            const near = c.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, false)[0];
            let pick = null;
            if (near) {
              const dist = Math.hypot(near.element.x - evt.x, near.element.y - evt.y);
              if (dist <= 24) pick = (near.datasetIndex === 1 ? mine : rest)[near.index];
            }
            selected = pick && pick !== selected ? pick : null;
            drawPanel(); c.draw();
          },
        },
      });
      charts.add(chart);
    });

    const swap = h('button', { class: 'btn ghost ex-swap', 'aria-label': 'Swap axes', onclick: () => { setQuery({ x: dy.key, y: dx.key }); env.redraw(); } }, '⇅ Swap');
    return [
      h('div', { class: 'ex-controls two' },
        field('X axis', statSelect(league, dx.key, (k) => { setQuery({ x: k }); env.redraw(); }, { label: 'X axis' })),
        field('Y axis', statSelect(league, dy.key, (k) => { setQuery({ y: k }); env.redraw(); }, { label: 'Y axis' }))),
      h('div', { class: 'card card-pad' },
        h('div', { class: 'scatter-wrap' }, canvas),
        panel,
        h('div', { class: 'scatter-legend' },
          h('span', {}, h('i', { class: 'sw sw-mine' }), 'Your teams'),
          h('span', {}, h('i', { class: 'sw sw-rest' }), 'Others'),
          h('span', {}, h('i', { class: 'sw sw-med' }), 'League median'),
          swap)),
      h('p', { class: 'footnote' }, `${pts.length} teams. Tap a dot to see who it is; tap Open for the team page.${flipped.length ? ` ${flipped.map((a) => a.toUpperCase()).join(' and ')} axis flipped so up and right are better.` : ''}`),
    ];
  },

  // ---- Trends
  trends(env) {
    const { league, data, q, setQuery, ident, charts } = env;
    const teams = data.teams.map((t) => ({ ...t, ...ident(t), v: t.v }));
    const aId = teams.some((t) => t.id === q.a) ? q.a : firstFeatured(env);
    const bId = q.b && q.b !== 'none' && q.b !== aId && teams.some((t) => t.id === q.b) ? q.b : null;
    const metrics = TREND_METRICS[league].filter((m) => m.available(data));
    const metric = metrics.find((m) => m.id === q.metric) || metrics[0];
    if (!metric) return h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'No trend data yet', text: '' }));
    const win = metric.windows ? Number(q.win) || metric.windows[0] : null;
    const series = [aId, bId].filter(Boolean).map((id) => {
      const t = teams.find((x) => x.id === id);
      return { t, points: metric.points(t, data, win) };
    });
    const canvas = h('canvas', { role: 'img', 'aria-label': `${metric.label} trend` });
    requestAnimationFrame(() => {
      if (!canvas.isConnected || !window.Chart) return;
      const colors = [cssVar('--podium'), cssVar('--ink-muted')];
      const labels = series[0].points.map((p) => p.label);
      const chart = new window.Chart(canvas, {
        type: 'line',
        data: { labels, datasets: series.map((s, i) => ({ label: s.t.short, data: s.points.map((p) => p.y), borderColor: colors[i], borderWidth: 2, borderDash: i ? [5, 3] : [], pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: colors[i], tension: 0, spanGaps: true })) },
        options: {
          animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { display: false }, border: { color: cssVar('--line') }, ticks: { color: cssVar('--ink-muted'), font: { family: 'Inter', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
            y: { reverse: metric.lowerIsBetter, grid: { color: cssVar('--line') }, border: { display: false }, ticks: { color: cssVar('--ink-muted'), font: { family: 'Inter', size: 10 }, maxTicksLimit: 5, callback: (v) => metric.format(v) } },
          },
          plugins: {
            legend: { display: series.length > 1, position: 'top', align: 'start', labels: { color: cssVar('--ink'), font: { family: 'Inter', size: 12, weight: '600' }, boxWidth: 14, boxHeight: 2 } },
            tooltip: { backgroundColor: cssVar('--surface'), borderColor: cssVar('--line'), borderWidth: 1, titleColor: cssVar('--ink-muted'), bodyColor: cssVar('--ink'), padding: 8, cornerRadius: 4, boxWidth: 8, boxHeight: 2,
              callbacks: { label: (it) => `${it.dataset.label}: ${metric.format(it.raw)}` } },
          },
        },
      });
      charts.add(chart);
    });
    const metricSel = h('select', { class: 'ex-select', 'aria-label': 'Metric' }, metrics.map((m) => h('option', { value: m.id, selected: m === metric }, m.label)));
    metricSel.addEventListener('change', () => { setQuery({ metric: metricSel.value, win: null }); env.redraw(); });
    const controls = [
      field('Team', teamSelect(teams, aId, (id) => { setQuery({ a: id }); env.redraw(); })),
      field('Compare with', (() => {
        const sel = teamSelect(teams.filter((t) => t.id !== aId), bId, (id) => { setQuery({ b: id }); env.redraw(); }, 'Compare with');
        sel.prepend(h('option', { value: 'none', selected: !bId }, 'Nobody'));
        if (!bId) sel.value = 'none';
        return sel;
      })()),
      field('Metric', metricSel),
    ];
    if (metric.windows) {
      const ws = h('select', { class: 'ex-select', 'aria-label': 'Rolling window' }, metric.windows.map((w) => h('option', { value: w, selected: w === win }, `Last ${w} ${metric.unit}`)));
      ws.addEventListener('change', () => { setQuery({ win: ws.value }); env.redraw(); });
      controls.push(field('Rolling', ws));
    }
    return [
      h('div', { class: 'ex-controls two' }, controls),
      h('div', { class: 'card card-pad' }, h('div', { class: 'trend-wrap' }, canvas)),
      h('p', { class: 'footnote' }, metric.note(win)),
    ];
  },

  // ---- Seasons
  async seasons(env) {
    const { league, seasons, q, setQuery, ident } = env;
    const all = (await Promise.all(seasons.map((s) => getRatings(league, s).catch(() => null)))).filter(Boolean).sort((a, b) => a.season - b.season);
    const latest = all[all.length - 1];
    const teams = latest.teams.map((t) => ({ ...t, ...ident(t), v: t.v }));
    const aId = teams.some((t) => t.id === q.a) ? q.a : firstFeatured(env);
    const A = teams.find((t) => t.id === aId);
    const defs = STATS[league].filter((d) => d.fp || ['pred', 'srs', 'elo', 'rd', 'pyth_w', 'wins'].includes(d.key));
    const head = h('tr', {}, h('th', {}, 'Stat'), all.map((d) => h('th', {}, `’${String(d.season).slice(2)}${d.final ? '' : '*'}`)));
    const rows = defs.map((d) => {
      const cells = all.map((ds) => {
        const me = ds.teams.find((t) => t.id === aId);
        const v = me?.v[d.key];
        const p = v != null && d.hib != null ? percentiles(ds.teams, d).get(aId) : null;
        return { v, p };
      });
      return h('tr', {},
        h('td', {}, h('div', {}, d.label), d.hib != null ? sparkline(cells.map((c) => c.p?.pct ?? null), { width: 48, height: 14, label: `${d.label} percentile by season` }) : null),
        cells.map((c) => h('td', {}, h('div', { class: 'ss-val' }, fmt(c.v, d.fmt)), c.p ? h('div', { class: 'ss-rank' }, ordinal(c.p.rank)) : null)));
    });
    const recRow = h('tr', {}, h('td', {}, 'Record'), all.map((ds) => h('td', {}, ds.teams.find((t) => t.id === aId)?.record || '–')));
    return [
      h('div', { class: 'ex-controls' }, field('Team', teamSelect(teams, aId, (id) => { setQuery({ a: id }); env.redraw(); }))),
      h('div', { class: 'card table-wrap seasons-table' }, h('table', { class: 'stats' }, h('thead', {}, head), h('tbody', {}, recRow, rows))),
      h('p', { class: 'footnote' }, `${A.short} across ${all.length} seasons. Rank is within that season (1st is best in ${SCOPE[league]}); the line tracks the league percentile. * = season in progress.`),
    ];
  },
};

// ---------------------------------------------------------------- trend metrics
function rolling(values, n) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null);
    out.push(w.length ? w.reduce((a, b) => a + b, 0) / w.length : null);
  }
  return out;
}
const histMetric = (id, label, idx, f, note) => ({
  id, label, available: (d) => d.histKeys?.length > idx && d.teams.some((t) => t.hist?.length > 1),
  points: (t, d) => (t.hist || []).map((p, i) => ({ label: d.histLabels[i] || '', y: p[idx] })),
  format: f, note: () => note,
});
const TREND_METRICS = {
  cfb: [
    histMetric('pred', 'Predictor rating', 0, (v) => Number(v).toFixed(1), 'Predictor recomputed after each week, using only games played to that point.'),
    histMetric('elo', 'Elo rating', 1, (v) => Math.round(v), 'Elo after each week.'),
    histMetric('srs', 'SRS', 2, (v) => Number(v).toFixed(1), 'SRS recomputed after each week.'),
  ],
  nfl: [
    { id: 'o_epa', label: 'Offensive EPA/play', unit: 'games', windows: [3, 4, 1], available: (d) => d.teams.some((t) => t.log?.length),
      points: (t, d, n) => { const g = [...(t.log || [])].sort((a, b) => a[0] - b[0]); const r = rolling(g.map((x) => x[2]), n); return g.map((x, i) => ({ label: `Wk ${x[0]} ${x[1]}`, y: r[i] })); },
      format: (v) => Number(v).toFixed(2), note: (n) => `Offensive EPA per play, averaged over the last ${n} game${n > 1 ? 's' : ''} at each point. Regular season.` },
    { id: 'd_epa', label: 'Defensive EPA/play', unit: 'games', windows: [3, 4, 1], lowerIsBetter: true, available: (d) => d.teams.some((t) => t.log?.length),
      points: (t, d, n) => { const g = [...(t.log || [])].sort((a, b) => a[0] - b[0]); const r = rolling(g.map((x) => x[3]), n); return g.map((x, i) => ({ label: `Wk ${x[0]} ${x[1]}`, y: r[i] })); },
      format: (v) => Number(v).toFixed(2), note: (n) => `EPA per play allowed, last ${n} game${n > 1 ? 's' : ''}. Axis flipped so up is better.` },
    histMetric('srs', 'SRS', 0, (v) => Number(v).toFixed(1), 'SRS recomputed after each week.'),
    histMetric('elo', 'Elo rating', 1, (v) => Math.round(v), 'Elo after each week.'),
  ],
  mlb: [
    { id: 'rd', label: 'Run differential per game', unit: 'games', windows: [10, 20, 30], available: (d) => d.teams.some((t) => t.log?.length),
      points: (t, d, n) => { const g = t.log || []; const r = rolling(g.map((x) => x[2] - x[3]), n); return g.map((x, i) => ({ label: monthDay(x[0]), y: r[i] })); },
      format: (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`, note: (n) => `Runs scored minus allowed per game, rolling ${n} games.` },
    { id: 'rs', label: 'Runs scored per game', unit: 'games', windows: [10, 20, 30], available: (d) => d.teams.some((t) => t.log?.length),
      points: (t, d, n) => { const g = t.log || []; const r = rolling(g.map((x) => x[2]), n); return g.map((x, i) => ({ label: monthDay(x[0]), y: r[i] })); },
      format: (v) => Number(v).toFixed(1), note: (n) => `Runs per game, rolling ${n} games.` },
    { id: 'ra', label: 'Runs allowed per game', unit: 'games', windows: [10, 20, 30], lowerIsBetter: true, available: (d) => d.teams.some((t) => t.log?.length),
      points: (t, d, n) => { const g = t.log || []; const r = rolling(g.map((x) => x[3]), n); return g.map((x, i) => ({ label: monthDay(x[0]), y: r[i] })); },
      format: (v) => Number(v).toFixed(1), note: (n) => `Runs allowed per game, rolling ${n} games. Axis flipped so up is better.` },
    histMetric('pyth', 'Pythagorean win % (season to date)', 0, (v) => Number(v).toFixed(3).replace(/^0/, ''), 'Pythagorean win % from runs scored and allowed to date, weekly.'),
  ],
};
