// Expected points on the game screen (football): the live situation card with a
// draggable what-if field, the 4th-down call, per-play EPA and the EPA tab.
// Math lives in ../data/ep.js; this file only draws.

import { pctLabel } from '../util/prob.js';
import { h, clear } from '../util/dom.js';
import { epValue, fourthDown, annotate, summarize, halfSeconds, scoreable } from '../data/ep.js';
import { crest, badge, statBar, edgeBar, emptyState } from '../ui/components.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  kids.flat().forEach((c) => c != null && el.append(c));
  return el;
};
const MINUS = '−';
export const fmtEP = (v) => (v == null ? '–' : `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1)}`);
export const fmtEPA = (v) => (v == null ? '' : `${v >= 0 ? '+' : MINUS}${Math.abs(v).toFixed(1)}`);
const ordinal = (d) => ['1st', '2nd', '3rd', '4th'][d - 1] || '';
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Annotated plays, cached per game-detail object (redraws reuse them)
const memo = new WeakMap();
export function epaRows(d, model) {
  if (!model || !d.pbp?.length) return [];
  if (!memo.has(d)) memo.set(d, annotate(model, d.pbp, d.game));
  return memo.get(d);
}
export function epaById(d, model) {
  return new Map(epaRows(d, model).filter((r) => r.epa != null).map((r) => [r.id, r]));
}

// ---------------------------------------------------------------- live state
/** Down, distance and field position right now, from the latest play's end. */
function liveState(d) {
  const g = d.game;
  if (g.status.state !== 'in' || !d.pbp?.length) return null;
  for (let i = d.pbp.length - 1; i >= 0; i--) {
    const p = d.pbp[i];
    if (/timeout|official|injury|end (of )?(period|quarter)|end period/i.test(p.type)) continue;
    const e = p.end;
    if (e && e.down >= 1 && e.down <= 4 && e.ytg >= 1 && e.ytg <= 99 && e.team) {
      return { offense: e.team, down: e.down, dist: e.distance || 10, ytg: e.ytg, period: p.period, clockSecs: Math.max(0, p.clockSecs - 5), text: e.text };
    }
    // Between a score and the kickoff: show the receiving team's next drive from a
    // typical start (NFL kickoffs now usually end near the 30; college touchbacks at the 25)
    if (p.scoring || /field goal|touchdown|extra point|two-point|safety/i.test(p.type)) {
      const scorer = /safety/i.test(p.type) ? null : p.offense;
      const receiver = scorer ? (scorer === g.home.team.id ? g.away.team.id : g.home.team.id) : p.offense;
      if (!receiver) return null;
      return { offense: receiver, down: 1, dist: 10, ytg: g.league === 'nfl' ? 70 : 75, period: p.period, clockSecs: Math.max(0, p.clockSecs - 5), next: true };
    }
    return null;
  }
  return null;
}

function teamById(g, id) { return id === g.home.team.id ? g.home.team : g.away.team; }
function otherTeam(g, id) { return id === g.home.team.id ? g.away.team : g.home.team; }
function scoreDiff(g, off) {
  const mine = off === g.home.team.id ? g.home.score : g.away.score;
  const theirs = off === g.home.team.id ? g.away.score : g.home.score;
  return (Number(mine) || 0) - (Number(theirs) || 0);
}

// ---------------------------------------------------------------- summary section
/**
 * The expected-points card (+ 4th-down card). state.whatIf holds the user's
 * what-if spot ({ offense, down, dist, ytg }) and survives live refreshes.
 */
export function epSection(d, model, state) {
  const g = d.game;
  const live = liveState(d);
  const wrap = h('div', { class: 'ep-section' });

  if (!model) {
    if (g.status.state === 'in') wrap.append(h('div', { class: 'notice' }, 'Expected points start once the nightly job has fitted the model.'));
    return wrap;
  }

  const draw = () => {
    clear(wrap);
    const base = live || { offense: g.away.team.id, down: 1, dist: 10, ytg: 75, period: 1, clockSecs: 900 };
    const s = state.whatIf ? { ...base, ...state.whatIf } : base;
    const whatIf = !!state.whatIf || !live;
    const secs = halfSeconds(s.period, s.clockSecs, g.league);
    const sd = live ? scoreDiff(g, s.offense) : 0;
    const off = teamById(g, s.offense); const def = otherTeam(g, s.offense);
    const dist = Math.min(s.dist, s.ytg);
    const ep = epValue(model, { ytg: s.ytg, down: s.down, dist, secs, sd });

    const set = (patch) => { state.whatIf = { offense: s.offense, down: s.down, dist: s.dist, ytg: s.ytg, ...patch }; draw(); };
    const field = fieldChart(model, { ...s, dist, secs, sd }, off, def, (ytg) => set({ ytg }));

    const spotText = (ytg) => (ytg === 50 ? 'midfield' : ytg > 50 ? `own ${100 - ytg}` : `${def.abbr} ${ytg}`);
    const ddText = `${ordinal(s.down)} & ${dist >= s.ytg ? 'Goal' : dist}`;
    const head = h('div', { class: 'ep-head' },
      h('div', { class: 'ep-who' }, crest(off, 'sm'),
        h('div', {},
          h('div', { class: 'ep-dd' }, `${off.abbr} ball · ${ddText}`, h('span', { class: 'muted' }, ` at ${spotText(s.ytg)}`)),
          h('div', { class: 't-caption' }, state.whatIf ? (live ? 'What-if · same clock and score' : 'What-if · neutral clock and score')
            : live?.next ? 'Next drive · after the kickoff, from a typical start' : live ? 'Live' : 'What-if · neutral clock and score'))),
      h('div', { class: 'ep-big' }, h('span', { class: 'v' }, fmtEP(ep)), h('span', { class: 'k' }, 'expected points')));

    const downChips = h('div', { class: 'ep-downs', role: 'group', 'aria-label': 'Down' },
      [1, 2, 3, 4].map((dn) => h('button', { class: 'chip', 'aria-pressed': String(s.down === dn), onclick: () => set(dn === 1 ? { down: 1, dist: Math.min(10, s.ytg) } : { down: dn }) }, ordinal(dn))));
    const distCtl = h('div', { class: 'ep-dist', role: 'group', 'aria-label': 'Yards to go' },
      h('button', { class: 'icon-btn', 'aria-label': 'Fewer yards to go', disabled: dist <= 1, onclick: () => set({ dist: Math.max(1, dist - 1) }) }, MINUS),
      h('span', { class: 'v' }, dist >= s.ytg ? 'Goal' : `${dist} to go`),
      h('button', { class: 'icon-btn', 'aria-label': 'More yards to go', disabled: dist >= Math.min(30, s.ytg), onclick: () => set({ dist: Math.min(30, s.ytg, dist + 1) }) }, '+'));
    const flip = h('button', { class: 'btn ghost ep-flip', onclick: () => set({ offense: def.id, ytg: 100 - s.ytg }) }, `Give ${def.abbr} the ball`);
    const reset = state.whatIf ? h('button', { class: 'btn ghost ep-reset', onclick: () => { state.whatIf = null; draw(); } }, live ? 'Back to live' : 'Reset') : null;

    const card = h('div', { class: 'card ep-card' }, head, field,
      h('div', { class: 'ep-controls' }, downChips, distCtl),
      h('div', { class: 'ep-actions' }, flip, reset),
      h('p', { class: 'footnote ep-hint' }, 'Drag along the field, or change the down and distance. The line is expected points from every spot in this situation.'));
    wrap.append(h('div', { class: 'group-label' }, 'Expected points'), card);

    if (s.down === 4) wrap.append(fourthCard(model, { ytg: s.ytg, dist, secs, sd }, off));
  };
  draw();
  return wrap;
}

// EP curve over the field, with the ball. Offense always moves left to right.
function fieldChart(model, s, off, def, onSpot) {
  const W = 360; const H = 150; const ez = 18; const fx0 = ez; const fx1 = W - ez; const fy0 = 108; const fy1 = 132;
  const xOf = (ytg) => fx0 + ((100 - ytg) / 100) * (fx1 - fx0);
  const lo = -3; const hi = 7; const cy0 = 10; const cy1 = 96;
  const yOf = (v) => cy1 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (cy1 - cy0);
  const pts = [];
  for (let y = 99; y >= 1; y--) pts.push([xOf(y), yOf(epValue(model, { ytg: y, down: s.down, dist: Math.min(s.dist, y), secs: s.secs, sd: s.sd }))]);
  const path = `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`;
  const bx = xOf(s.ytg); const ep = epValue(model, { ytg: s.ytg, down: s.down, dist: s.dist, secs: s.secs, sd: s.sd });

  const lines = [];
  for (let yd = 10; yd <= 90; yd += 10) {
    const x = fx0 + (yd / 100) * (fx1 - fx0);
    lines.push(svg('line', { x1: x, x2: x, y1: fy0, y2: fy1, class: 'ep-yard' }));
    lines.push(svg('text', { x, y: fy1 + 12, class: 'ep-num', 'text-anchor': 'middle' }, String(yd <= 50 ? yd : 100 - yd)));
  }
  const firstDown = s.dist < s.ytg ? xOf(s.ytg - s.dist) : null;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H + 6}`, class: 'ep-svg', role: 'img', 'aria-label': `Expected points by field position. Ball at ${s.ytg} yards to go to the end zone: ${fmtEP(ep)} points.` },
    svg('line', { x1: fx0, x2: fx1, y1: yOf(0), y2: yOf(0), class: 'ep-zero' }),
    svg('text', { x: fx0, y: yOf(0) - 4, class: 'ep-axis' }, '0'),
    svg('text', { x: fx0, y: yOf(hi) + 8, class: 'ep-axis' }, `${hi}`),
    svg('path', { d: path, class: 'ep-curve' }),
    svg('rect', { x: fx0, y: fy0, width: fx1 - fx0, height: fy1 - fy0, class: 'ep-turf' }),
    svg('rect', { x: 0, y: fy0, width: ez, height: fy1 - fy0, class: 'ep-ez', style: off.color ? `fill:${off.color}` : null }),
    svg('rect', { x: fx1, y: fy0, width: ez, height: fy1 - fy0, class: 'ep-ez', style: def.color ? `fill:${def.color}` : null }),
    svg('text', { x: ez / 2, y: (fy0 + fy1) / 2 + 3, class: 'ep-ezt', 'text-anchor': 'middle', transform: `rotate(-90 ${ez / 2} ${(fy0 + fy1) / 2})` }, off.abbr),
    svg('text', { x: fx1 + ez / 2, y: (fy0 + fy1) / 2 + 3, class: 'ep-ezt', 'text-anchor': 'middle', transform: `rotate(90 ${fx1 + ez / 2} ${(fy0 + fy1) / 2})` }, def.abbr),
    lines,
    firstDown ? svg('line', { x1: firstDown, x2: firstDown, y1: fy0 - 2, y2: fy1 + 2, class: 'ep-first' }) : null,
    svg('line', { x1: bx, x2: bx, y1: yOf(ep), y2: fy0, class: 'ep-guide' }),
    svg('circle', { cx: bx, cy: yOf(ep), r: 4, class: 'ep-dot' }),
    svg('text', { x: Math.min(fx1 - 4, Math.max(fx0 + 4, bx)), y: yOf(ep) - 9, class: 'ep-val', 'text-anchor': bx > fx1 - 30 ? 'end' : bx < fx0 + 30 ? 'start' : 'middle' }, fmtEP(ep)),
    svg('circle', { cx: bx, cy: (fy0 + fy1) / 2, r: 7, class: 'ep-ball' }),
  );

  // Drag (or tap) to move the ball. Each move redraws the card, so the drag is
  // tracked on the window with the rectangle measured when it started.
  root.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const rect = root.getBoundingClientRect();
    const toYtg = (e) => {
      const x = ((e.clientX - rect.left) / rect.width) * W;
      return Math.round(Math.min(99, Math.max(1, 100 - ((x - fx0) / (fx1 - fx0)) * 100)));
    };
    let last = s.ytg; let pending = null;
    const move = (e) => {
      const y = toYtg(e);
      if (y === last) return;
      last = y;
      if (pending == null) requestAnimationFrame(() => { const v = pending; pending = null; onSpot(v); });
      pending = y;
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    move(ev);
  });
  return h('div', { class: 'ep-field' }, root);
}

// ---------------------------------------------------------------- 4th down
function fourthCard(model, s, off) {
  const r = fourthDown(model, s);
  const label = { go: 'Go for it', fg: 'Field goal', punt: 'Punt' };
  const opts = [['go', r.go], ['fg', r.fg], ['punt', r.punt]].filter(([, o]) => o);
  const vals = opts.map(([, o]) => o.ev);
  const lo = Math.min(0, ...vals); const hi = Math.max(0.5, ...vals);
  const pct = (v) => pctLabel(v);
  const detail = (k, o) => (k === 'go' ? `${pct(o.p)} to convert` : k === 'fg' ? `${pct(o.p)} from ${o.distance} yards` : 'Opponent takes over');
  const rows = opts.map(([k, o]) => h('div', { class: `fd-row${k === r.best ? ' best' : ''}` },
    h('div', { class: 'fd-name' }, h('div', {}, label[k]), h('div', { class: 't-caption' }, detail(k, o))),
    h('div', { class: 'fd-bar' }, h('span', { class: 'fd-zero', style: { left: `${((0 - lo) / (hi - lo)) * 100}%` } }),
      h('span', { class: 'fd-fill', style: { left: `${((Math.min(0, o.ev) - lo) / (hi - lo)) * 100}%`, width: `${(Math.abs(o.ev) / (hi - lo)) * 100}%` } })),
    h('div', { class: 'fd-val' }, fmtEP(o.ev))));
  const second = opts.filter(([k]) => k !== r.best).sort((a, b) => b[1].ev - a[1].ev)[0];
  const verdict = second
    ? `${label[r.best]} is worth ${r.margin.toFixed(1)} more expected points than ${label[second[0]].toLowerCase()}.`
    : `${label[r.best]}.`;
  const be = r.breakEven != null && r.breakEven > 0 && r.breakEven < 1
    ? ` Going for it pays off if ${off.abbr} converts at least ${pct(r.breakEven)} of the time; the model gives ${pct(r.go.p)}.` : '';
  return h('div', { class: 'card fd-card' },
    h('div', { class: 'fd-head' }, h('span', { class: 'fd-title' }, '4th-down call'), badge(label[r.best], 'podium')),
    rows,
    h('p', { class: 'fd-verdict' }, verdict + be),
    h('p', { class: 'footnote', style: { margin: 0 } }, 'Expected points of each choice. Uses league conversion, kicking and punting rates, not this team’s.'));
}

// ---------------------------------------------------------------- EPA tab
export function drawEPA(el, d, model) {
  const g = d.game;
  if (!model) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'EPA model not ready', text: 'The nightly job fits it; check back after the next run.' }))); return null; }
  const rows = epaRows(d, model);
  if (!rows.some((r) => r.epa != null)) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No plays yet', text: 'EPA fills in once the game starts.' }))); return null; }
  const sum = summarize(rows, g);
  const A = sum.teams[g.away.team.id]; const B = sum.teams[g.home.team.id];
  const n2 = (v) => (v == null ? '–' : `${v >= 0 ? '' : MINUS}${Math.abs(v).toFixed(2)}`);
  const p0 = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
  // statBar shows shares: put both on a common non-negative scale
  const bar = (label, a, b, scale, f) => edgeBar({ label, a, b, scale, display: [f(a), f(b)] });

  el.append(h('div', { class: 'card stat-compare' },
    h('div', { class: 'sc-teams' }, h('span', {}, crest(g.away.team, 'sm'), g.away.team.abbr), h('span', {}, g.home.team.abbr, crest(g.home.team, 'sm'))),
    bar('EPA per play', A.perPlay, B.perPlay, 0.3, n2),
    bar('Pass EPA per play', A.pass, B.pass, 0.4, n2),
    bar('Rush EPA per play', A.rush, B.rush, 0.3, n2),
    statBar({ label: 'Success rate', home: A.success ?? 0, away: B.success ?? 0, display: [p0(A.success), p0(B.success)] }),
    statBar({ label: 'Big plays (EPA 2+)', home: A.explosive ?? 0, away: B.explosive ?? 0, display: [String(A.explosive ?? 0), String(B.explosive ?? 0)] }),
    bar('Total EPA', A.total, B.total, 15, (v) => fmtEPA(v) || '0.0')));

  // Running total
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Running total of expected points added by each offense' });
  el.append(h('div', { class: 'group-label' }, 'Running EPA'), h('div', { class: 'card card-pad' }, h('div', { class: 'trend-wrap' }, canvas)));
  let chart = null;
  if (window.Chart) {
    const maxX = Math.max(60, ...Object.values(sum.series).flat().map((p) => Math.ceil(p.x)));
    const ds = (team, i) => ({ label: team.abbr, data: sum.series[team.id], borderColor: i ? cssVar('--podium') : cssVar('--ink-muted'), borderDash: i ? [] : [5, 3], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, stepped: false, tension: 0 });
    chart = new window.Chart(canvas, {
      type: 'line',
      data: { datasets: [ds(g.away.team, 0), ds(g.home.team, 1)] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: maxX, grid: { color: cssVar('--line'), drawTicks: false }, border: { display: false },
            ticks: { stepSize: 15, color: cssVar('--ink-muted'), font: { family: 'Inter', size: 11 }, callback: (v) => ({ 0: 'Q1', 15: 'Q2', 30: 'Q3', 45: 'Q4', 60: 'OT' })[v] ?? '' } },
          y: { grid: { color: (c) => (c.tick.value === 0 ? cssVar('--line-strong') : cssVar('--line')) }, border: { display: false }, ticks: { color: cssVar('--ink-muted'), font: { family: 'Inter', size: 10 }, maxTicksLimit: 5 } },
        },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: cssVar('--ink'), font: { family: 'Inter', size: 12, weight: '600' }, boxWidth: 14, boxHeight: 2 } },
          tooltip: { backgroundColor: cssVar('--surface'), borderColor: cssVar('--line'), borderWidth: 1, titleColor: cssVar('--ink-muted'), bodyColor: cssVar('--ink'), padding: 8, cornerRadius: 4, displayColors: false,
            callbacks: { title: () => '', label: (it) => `${it.dataset.label}: ${fmtEPA(it.raw.y)} total` } },
        },
      },
    });
  }

  el.append(h('div', { class: 'group-label' }, 'Biggest plays'), h('div', { class: 'card' }, sum.biggest.map((r) => {
    const team = teamById(g, r.offense);
    return h('div', { class: 'big-play' },
      crest(team, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 't-caption' }, `Q${r.period > 4 ? 'OT' : r.period} ${r.clock} · ${r.start?.text || ''} · EP ${fmtEP(r.epBefore)} → ${fmtEP(r.epAfter)}`), h('div', { class: 'bp-text' }, r.text)),
      epaChip(r.epa));
  })));
  el.append(h('p', { class: 'footnote' }, `EPA = expected points after the play minus before. Success = positive EPA. ${modelNote(model)}`));
  return chart;
}

export function epaChip(v) {
  if (v == null) return null;
  return h('span', { class: `epa-chip${v >= 0 ? ' pos' : ' neg'}${Math.abs(v) >= 2 ? ' big' : ''}`, title: 'Expected points added' }, fmtEPA(v));
}

export function modelNote(m) {
  if (!m) return '';
  const src = m.league === 'cfb' ? 'cfbfastR' : 'nflfastR';
  if (m.borrowed) return 'College model not fitted yet; using the NFL model for now.';
  return `EP model: a compact fit to ${src}’s expected points${m.r2 != null ? ` (R² ${m.r2.toFixed(2)} on held-out plays)` : ''}.`;
}

export { scoreable };
