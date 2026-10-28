// Run value on the baseball game screen: the live run-expectancy card with a what-if
// diamond, run value on every plate appearance and pitch (Plays), and the Run value tab.
// Math lives in ../data/rv.js; this file only draws.

import { h, clear } from '../util/dom.js';
import { annotate, summarize, byPlateAppearance, reValue, ZONES } from '../data/rv.js';
import { crest, badge, chips, statBar, emptyState } from '../ui/components.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  kids.flat().forEach((c) => c != null && el.append(c));
  return el;
};
const MINUS = '−';
export const fmtRV = (v, d = 2) => (v == null ? '' : `${v >= 0 ? '+' : MINUS}${Math.abs(v).toFixed(d)}`);
const fmtRE = (v) => v.toFixed(2);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ZONE_LABEL = { heart: 'Heart', shadow: 'Shadow', chase: 'Chase', waste: 'Waste' };
const BASE_NAMES = ['1st', '2nd', '3rd'];

const memo = new WeakMap();
export function rvRows(d, m) {
  if (!m || !d.pas?.length) return [];
  if (!memo.has(d)) memo.set(d, annotate(m, d.pas, { postseason: !!d.game.postseason }));
  return memo.get(d);
}
export function rvByPA(d, m) { return byPlateAppearance(rvRows(d, m)); }

const teamOf = (g, id) => (id === g.home.team.id ? g.home.team : g.away.team);
const otherId = (g, id) => (id === g.home.team.id ? g.away.team.id : g.home.team.id);
const basesText = (b) => {
  const on = [1, 2, 4].map((bit, i) => (b & bit ? BASE_NAMES[i] : null)).filter(Boolean);
  return !on.length ? 'bases empty' : on.length === 3 ? 'bases loaded' : `runner${on.length > 1 ? 's' : ''} on ${on.join(' and ')}`;
};

// ---------------------------------------------------------------- live card
function liveState(d, rows) {
  const g = d.game;
  if (g.status.state !== 'in' || !rows.length) return null;
  const last = rows[rows.length - 1];
  if (last.outsAfter >= 3) {
    return { battingTeamId: otherId(g, last.battingTeamId), bases: 0, outs: 0, balls: 0, strikes: 0, between: true };
  }
  return { battingTeamId: last.battingTeamId, bases: last.basesAfter, outs: last.outsAfter, balls: last.ballsAfter, strikes: last.strikesAfter, last };
}

/** Run expectancy card. state.rvWhatIf holds the what-if situation across refreshes. */
export function rvSection(d, m, state) {
  const g = d.game;
  const wrap = h('div', { class: 'ep-section' });
  if (!m) return wrap;
  const rows = rvRows(d, m);
  const live = liveState(d, rows);

  const draw = () => {
    clear(wrap);
    const base = live || { battingTeamId: g.away.team.id, bases: 0, outs: 0, balls: 0, strikes: 0 };
    const s = state.rvWhatIf ? { ...base, ...state.rvWhatIf } : base;
    const set = (patch) => { state.rvWhatIf = { battingTeamId: s.battingTeamId, bases: s.bases, outs: s.outs, balls: s.balls, strikes: s.strikes, ...patch }; draw(); };
    const bat = teamOf(g, s.battingTeamId);
    const re = reValue(m, s.bases, s.outs, s.balls, s.strikes);

    const caption = state.rvWhatIf ? 'What-if' : live?.between ? 'Next half-inning' : live ? 'Live' : 'What-if';
    const head = h('div', { class: 'ep-head' },
      h('div', { class: 'ep-who' }, crest(bat, 'sm'),
        h('div', {},
          h('div', { class: 'ep-dd' }, `${bat.abbr} batting · ${s.outs} out${s.outs === 1 ? '' : 's'}`, h('span', { class: 'muted' }, ` · ${s.balls}-${s.strikes}`)),
          h('div', { class: 't-caption' }, `${basesText(s.bases)[0].toUpperCase()}${basesText(s.bases).slice(1)} · ${caption}`))),
      h('div', { class: 'ep-big' }, h('span', { class: 'v' }, fmtRE(re)), h('span', { class: 'k' }, 'expected runs')));

    // Diamond: tap a base to put a runner on or take him off
    const pos = [[78, 50], [50, 22], [22, 50]]; // 1st, 2nd, 3rd (home at bottom)
    const diamond = svg('svg', { viewBox: '0 0 100 92', class: 'rv-diamond', role: 'group', 'aria-label': 'Bases' },
      svg('path', { d: 'M50 84 L78 50 L50 22 L22 50 Z', class: 'rv-lines' }),
      svg('rect', { x: 45, y: 79, width: 10, height: 10, class: 'rv-home', transform: 'rotate(45 50 84)' }),
      pos.map(([x, y], i) => {
        const bit = [1, 2, 4][i]; const on = !!(s.bases & bit);
        const r = svg('rect', { x: x - 9, y: y - 9, width: 18, height: 18, class: `rv-base${on ? ' on' : ''}`, transform: `rotate(45 ${x} ${y})`, role: 'button', tabindex: 0, 'aria-label': `${BASE_NAMES[i]} base, ${on ? 'occupied' : 'empty'}` });
        r.addEventListener('click', () => set({ bases: s.bases ^ bit }));
        return r;
      }));
    const dots = (n, total, label, onPick) => h('div', { class: 'rv-dots', role: 'group', 'aria-label': label },
      h('span', { class: 'k' }, label),
      Array.from({ length: total }, (_, i) => h('button', { class: `rv-dot${i < n ? ' on' : ''}`, 'aria-label': `${label} ${i + 1}`, onclick: () => onPick(i < n && i === n - 1 ? i : i + 1) })));
    const counts = h('div', { class: 'rv-counts' },
      dots(s.balls, 3, 'Balls', (v) => set({ balls: v })),
      dots(s.strikes, 2, 'Strikes', (v) => set({ strikes: v })),
      dots(s.outs, 2, 'Outs', (v) => set({ outs: v })));
    const flip = h('button', { class: 'btn ghost ep-flip', onclick: () => set({ battingTeamId: otherId(g, s.battingTeamId) }) }, `${teamOf(g, otherId(g, s.battingTeamId)).abbr} batting`);
    const reset = state.rvWhatIf ? h('button', { class: 'btn ghost ep-reset', onclick: () => { state.rvWhatIf = null; draw(); } }, live ? 'Back to live' : 'Reset') : null;
    const lastPitch = live?.last && !state.rvWhatIf ? h('p', { class: 'rv-last' },
      h('span', { class: 'k' }, 'Last pitch '), [live.last.pitchName, live.last.speed ? `${Math.round(live.last.speed)} mph` : null, live.last.call].filter(Boolean).join(' · '), ' ', rvChip(live.last.rv)) : null;

    wrap.append(h('div', { class: 'group-label' }, 'Run expectancy'),
      h('div', { class: 'card ep-card' }, head,
        h('div', { class: 'rv-board' }, diamond, counts),
        lastPitch,
        h('div', { class: 'ep-actions' }, flip, reset),
        h('p', { class: 'footnote ep-hint' }, 'Runs the batting team can expect from here to the end of the inning. Tap the bases, balls, strikes and outs to try other situations.')));
  };
  draw();
  return wrap;
}

export function rvChip(v) {
  if (v == null) return null;
  return h('span', { class: `epa-chip${v >= 0 ? ' pos' : ' neg'}${Math.abs(v) >= 0.5 ? ' big' : ''}`, title: 'Run value (batting team)' }, fmtRV(v));
}

/** Pitch list for one plate appearance (Plays tab). */
export function pitchList(pa) {
  if (!pa?.pitches?.length) return null;
  const n = pa.pitches.filter((r) => r.isPitch).length;
  return h('details', { class: 'pitch-list' },
    h('summary', {}, `${n} pitch${n === 1 ? '' : 'es'}`),
    pa.pitches.map((r, i) => h('div', { class: 'pitch-row' },
      h('span', { class: 'pn' }, r.isPitch ? r.countBefore : ''),
      h('span', { class: 'pd' }, r.isPitch ? [r.pitchName, r.speed ? `${Math.round(r.speed)}` : null].filter(Boolean).join(' ') : 'Running'),
      h('span', { class: 'pc' }, r.isPitch ? r.call : r.text),
      rvChip(r.rv))));
}

// ---------------------------------------------------------------- Run value tab
export function drawRV(el, d, m, state) {
  const g = d.game;
  const rows = rvRows(d, m);
  if (!rows.length) { el.append(h('div', { class: 'card' }, emptyState({ iconName: 'scoreboard', title: 'No pitches yet', text: 'Run value fills in once the game starts.' }))); return null; }
  const sum = summarize(rows, g);
  const A = sum.batting[g.away.team.id]; const B = sum.batting[g.home.team.id];
  const n2 = (v) => fmtRV(v ?? 0);
  const share = (a, b) => { const lo = Math.min(a ?? 0, b ?? 0, 0); return [(a ?? 0) - lo + 0.001, (b ?? 0) - lo + 0.001]; };
  const bar = (label, a, b, f = n2) => { const [x, y] = share(a, b); return statBar({ label, home: x, away: y, display: [f(a), f(b)] }); };
  el.append(h('div', { class: 'group-label' }, 'At the plate'), h('div', { class: 'card stat-compare' },
    h('div', { class: 'sc-teams' }, h('span', {}, crest(g.away.team, 'sm'), g.away.team.abbr), h('span', {}, g.home.team.abbr, crest(g.home.team, 'sm'))),
    bar('Batting run value', A.rv, B.rv),
    bar('Per 100 pitches', A.per100, B.per100, (v) => fmtRV(v ?? 0, 1)),
    bar('On swings', A.swingRV, B.swingRV),
    bar('On takes', A.takeRV, B.takeRV),
    bar('Baserunning (steals, pickoffs)', A.running, B.running)));

  // Swing / take by attack region, one team at a time
  const side = state.rvSide && sum.batting[state.rvSide] ? state.rvSide : g.away.team.id;
  const z = sum.batting[side].zones;
  const zoneTable = h('div', { class: 'card table-wrap rv-zones' }, h('table', { class: 'stats' },
    h('thead', {}, h('tr', {}, ['Region', 'N', 'Swing %', 'Swings', 'Takes', 'Net'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ZONES.map((k) => {
      const x = z[k];
      return h('tr', {}, h('td', {}, ZONE_LABEL[k]), h('td', {}, x.n), h('td', {}, x.n ? `${Math.round((100 * x.swings) / x.n)}%` : '–'),
        h('td', {}, x.n ? fmtRV(x.swingRV) : '–'), h('td', {}, x.n ? fmtRV(x.takeRV) : '–'), h('td', { class: 'tot' }, x.n ? fmtRV(x.swingRV + x.takeRV) : '–'));
    }))));
  const pick = chips([{ id: g.away.team.id, label: g.away.team.short || g.away.team.abbr }, { id: g.home.team.id, label: g.home.team.short || g.home.team.abbr }], side,
    (id) => { state.rvSide = id; clear(el); drawRV(el, d, m, state); }, { label: 'Team' });
  el.append(h('div', { class: 'group-label' }, 'Swing and take, by region'), pick, zoneTable,
    h('p', { class: 'footnote' }, 'N = pitches seen. Swings, Takes, Net: the batting team’s run value on swings, on takes, and both. Heart: the middle of the zone. Shadow: its edges, just in or out. Chase: off the plate. Waste: well off it. Swinging at Heart pitches and taking Chase and Waste usually pays.'));

  // Pitchers
  const pitchers = [...sum.pitchers].sort((a, b) => (a.teamId === b.teamId ? 0 : a.teamId === g.away.team.id ? -1 : 1));
  el.append(h('div', { class: 'group-label' }, 'Pitchers'), h('div', { class: 'card' }, pitchers.map((p) => h('div', { class: 'rv-pitcher' },
    crest(teamOf(g, p.teamId), 'sm'),
    h('div', { class: 'grow' },
      h('div', { class: 'nm' }, p.name),
      h('div', { class: 't-caption' }, `${p.pitches} pitches · ${p.types.slice(0, 3).map((t) => `${t.name} ${fmtRV(t.rv, 1)}`).join(', ')}`)),
    h('div', { class: 'rv-pv' }, h('div', { class: 'v' }, fmtRV(p.rv, 1)), h('div', { class: 't-caption' }, `${fmtRV(p.per100, 1)}/100`))))),
  h('p', { class: 'footnote' }, 'Pitcher run value is runs saved: positive is good for the pitcher.'));

  // Running total
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Running batting run value for each team' });
  el.append(h('div', { class: 'group-label' }, 'Running total'), h('div', { class: 'card card-pad' }, h('div', { class: 'trend-wrap' }, canvas)));
  let chart = null;
  if (window.Chart) {
    const maxX = Math.max(9, ...Object.values(sum.series).flat().map((p) => Math.ceil(p.x)));
    const ds = (team, i) => ({ label: team.abbr, data: sum.series[team.id], borderColor: i ? cssVar('--podium') : cssVar('--ink-muted'), borderDash: i ? [] : [5, 3], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, stepped: 'after' });
    chart = new window.Chart(canvas, {
      type: 'line', data: { datasets: [ds(g.away.team, 0), ds(g.home.team, 1)] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, parsing: { xAxisKey: 'x', yAxisKey: 'y' }, interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: maxX, grid: { color: cssVar('--line'), drawTicks: false }, border: { display: false }, ticks: { stepSize: 1, color: cssVar('--ink-muted'), font: { family: 'Inter', size: 10 }, callback: (v) => (v < maxX ? String(v + 1) : '') } },
          y: { grid: { color: (c) => (c.tick.value === 0 ? cssVar('--line-strong') : cssVar('--line')) }, border: { display: false }, ticks: { color: cssVar('--ink-muted'), font: { family: 'Inter', size: 10 }, maxTicksLimit: 5 } },
        },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: cssVar('--ink'), font: { family: 'Inter', size: 12, weight: '600' }, boxWidth: 14, boxHeight: 2 } },
          tooltip: { backgroundColor: cssVar('--surface'), borderColor: cssVar('--line'), borderWidth: 1, titleColor: cssVar('--ink-muted'), bodyColor: cssVar('--ink'), padding: 8, cornerRadius: 4, displayColors: false,
            callbacks: { title: () => '', label: (it) => `${it.dataset.label}: ${fmtRV(it.raw.y)} runs` } },
        },
      },
    });
  }

  // Biggest moments
  el.append(h('div', { class: 'group-label' }, 'Biggest pitches'), h('div', { class: 'card' }, sum.biggest.map((r) => h('div', { class: 'big-play' },
    crest(teamOf(g, r.battingTeamId), 'sm'),
    h('div', { class: 'grow' },
      h('div', { class: 't-caption' }, `${r.half === 'top' ? 'Top' : 'Bot'} ${r.inning} · ${r.outsBefore} out · ${r.countBefore} · ${r.batter.name} vs ${r.pitcher.name}`),
      h('div', { class: 'bp-text' }, [r.pitchName, r.speed ? `${Math.round(r.speed)} mph` : null, r.event || r.call].filter(Boolean).join(' · '))),
    rvChip(r.rv)))));
  el.append(h('p', { class: 'footnote' }, `Run value = change in run expectancy (bases, outs and count) plus runs scored, for the batting team: Statcast’s per-pitch run value. ${m.isDefault ? 'Using a standard run-expectancy table until the nightly job builds one from Statcast.' : `Run expectancy from ${m.season} Statcast${m.r2 != null ? ` (matches Savant’s per-pitch values, R² ${Number(m.r2).toFixed(2)})` : ''}.`}`));
  return chart;
}
