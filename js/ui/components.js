// Podium components in plain JavaScript (the design system's React components,
// rebuilt without a framework so the app stays a no-build static site).
// Each returns a DOM element styled by css/app.css.

import { settings, resolvedTheme } from '../store/settings.js';
import { h, icon, ICONS } from '../util/dom.js';

// ---------------------------------------------------------------- color helpers
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** White or Podium ink (#111214), whichever reads better on a team color. */
export function inkFor(color) {
  const L = luminance(color);
  if (L == null) return null;
  return contrast(L, 1) >= contrast(L, luminance('#111214')) ? '#FFFFFF' : '#111214';
}

// ---------------------------------------------------------------- TeamCrest
/**
 * The team's real logo (Settings → Team marks → Logos, the default), or the Podium
 * crest: a team-color square with the short name. If a logo can't load (offline,
 * missing), the crest takes its place. size: '' | 'sm' | 'lg'
 */
export function crest(team, size = '') {
  const src = settings.get().logos !== false ? logoSrc(team.logo, resolvedTheme(), size) : null;
  if (!src) return plainCrest(team, size);
  const box = h('span', { class: `crest logo ${size}`.trim(), 'aria-hidden': 'true' });
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  img.addEventListener('error', () => box.replaceWith(plainCrest(team, size)), { once: true });
  box.append(img);
  return box;
}

function plainCrest(team, size) {
  const color = team.color || null;
  return h('span', {
    class: `crest ${size}`.trim(),
    style: { '--team': color, '--team-ink': team.ink || inkFor(color) },
    'aria-hidden': 'true',
  }, (team.abbr || team.short || '?').slice(0, 4));
}

/**
 * Logo URL for the theme and size. ESPN logos have a dark-background variant and
 * are resized by ESPN's image service (a 500px PNG for a 24px mark is wasteful);
 * MLB logos are SVG, with cap versions drawn for dark and light backgrounds.
 */
export function logoSrc(url, theme = 'dark', size = '') {
  if (!url) return null;
  const px = { sm: 48, '': 64, lg: 112 }[size] || 64;
  const espn = url.match(/^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[a-z]+)\/500(?:-dark)?\/(.+)$/);
  if (espn) return `https://a.espncdn.com/combiner/i?img=${espn[1]}/500${theme === 'dark' ? '-dark' : ''}/${espn[2].replace(/^scoreboard\//, '')}&w=${px}&h=${px}`;
  const mlb = url.match(/^https:\/\/www\.mlbstatic\.com\/team-logos\/(?:team-cap-on-(?:dark|light)\/)?(\d+)\.svg$/);
  if (mlb) return `https://www.mlbstatic.com/team-logos/team-cap-on-${theme === 'dark' ? 'dark' : 'light'}/${mlb[1]}.svg`;
  return url;
}

// ---------------------------------------------------------------- Badge
/** tone: '' (neutral) | 'live' | 'win' | 'podium' | 'strong'. Text is uppercased by CSS — pass sentence case. */
export function badge(text, tone = '') {
  return h('span', { class: `badge ${tone}`.trim() }, text);
}

/** RankBadge: gold/silver/bronze fills for 1–3, sunken for 4+. */
export function rankBadge(rank) {
  return h('span', { class: `rank${rank <= 3 ? ` r${rank}` : ''}`, 'aria-label': `Rank ${rank}` }, rank);
}

// ---------------------------------------------------------------- Button
/** variant: 'primary' (one per screen) | 'secondary' | 'ghost' */
export function button(label, { variant = 'primary', iconName, onclick, href, block = false } = {}) {
  const cls = ['btn', variant !== 'primary' ? variant : '', block ? 'block' : ''].filter(Boolean).join(' ');
  return h(href ? 'a' : 'button', { class: cls, href, onclick, type: href ? null : 'button' },
    iconName ? icon(ICONS[iconName]) : null, label);
}

// ---------------------------------------------------------------- SectionHeader
export function sectionHeader({ title, overline, action, href, onAction } = {}) {
  return h('div', { class: 'section-header' },
    h('div', {}, overline ? h('span', { class: 'overline' }, overline) : null, h('h2', {}, title)),
    action ? h(href ? 'a' : 'button', { class: 'action', href, onclick: onAction }, action) : null);
}

// ---------------------------------------------------------------- Tabs
/**
 * Tabs with the podium bar under the active item.
 * items: [{ id, label }]; onChange(id)
 */
export function tabs(items, value, onChange, { label = 'Sections' } = {}) {
  const el = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const set = (id) => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  for (const it of items) {
    el.append(h('button', {
      role: 'tab', dataset: { id: it.id }, 'aria-pressed': String(it.id === value),
      onclick: () => { set(it.id); onChange(it.id); },
    }, it.label));
  }
  return el;
}

/** Choice control for settings (no violet). items: [{ id, label }] */
export function choice(items, value, onChange, { label } = {}) {
  const el = h('div', { class: 'choice', role: 'group', 'aria-label': label });
  for (const it of items) {
    const btn = h('button', {
      'aria-pressed': String(it.id === value),
      onclick: () => {
        el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        onChange(it.id);
      },
    }, it.label);
    el.append(btn);
  }
  return el;
}

// ---------------------------------------------------------------- ScoreCard
/**
 * status: 'live' | 'final' | 'upcoming'
 * home/away: { name, short, abbr, color, ink, score, record }
 * In a final, the losing side goes ink-muted.
 */
export function scoreCard({ competition, status, clock, home, away, href, foot }) {
  const final = status === 'final';
  const loser = final && home.score !== away.score ? (home.score < away.score ? 'home' : 'away') : null;
  const statusBadge = status === 'live'
    ? badge(clock ? `Live · ${clock}` : 'Live', 'live')
    : final ? badge(clock || 'FT', 'strong') : badge(clock || 'Upcoming');
  const row = (t, side) => h('div', { class: `sc-row${loser === side ? ' loser' : ''}` },
    crest(t),
    h('span', { class: 'sc-team' }, t.rank ? h('span', { class: 'sc-rank' }, t.rank) : null, t.name, t.record ? h('span', { class: 'rec' }, t.record) : null),
    status !== 'upcoming' ? h('span', { class: 'sc-score' }, t.score ?? '') : null);
  return h(href ? 'a' : 'div', { class: 'scorecard', href },
    h('div', { class: 'sc-head' }, h('span', { class: 'sc-comp' }, competition || ''), statusBadge),
    row(away, 'away'),
    row(home, 'home'),
    foot ? h('div', { class: 'sc-foot' }, foot) : null);
}

// ---------------------------------------------------------------- PeriodPicker
/**
 * ‹ label › control for stepping through weeks or dates.
 *   onPrev / onNext: null disables that arrow
 *   onLabel: tap the label (opens a picker); or pass `labelEl` to supply your own
 */
export function periodPicker({ label, sub, onPrev, onNext, onLabel, labelEl }) {
  const arrow = (dir, fn) => h('button', {
    class: 'icon-btn pp-arrow', 'aria-label': dir === 'prev' ? 'Previous' : 'Next', disabled: !fn, onclick: fn || null,
  }, icon(dir === 'prev' ? ICONS.back : ICONS.chevron));
  const center = labelEl || h(onLabel ? 'button' : 'div', { class: 'pp-label', onclick: onLabel || null },
    h('span', { class: 'pp-main' }, label), sub ? h('span', { class: 'pp-sub' }, sub) : null);
  return h('div', { class: 'period-picker' }, arrow('prev', onPrev), center, arrow('next', onNext));
}

// ---------------------------------------------------------------- Chips (filters)
/** Single-select filter chips. items: [{ id, label }] */
export function chips(items, value, onChange, { label = 'Filter' } = {}) {
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': label });
  for (const it of items) {
    el.append(h('button', {
      class: 'chip', 'aria-pressed': String(it.id === value),
      onclick: () => onChange(it.id),
    }, it.label));
  }
  return el;
}

// ---------------------------------------------------------------- StatBar
/**
 * Two-sided comparison. The leading side's segment is podium; the other is line-strong.
 * lowerIsBetter flips which side leads (e.g. turnovers).
 */
export function statBar({ label, home, away, format = (v) => v, lowerIsBetter = false, display }) {
  const total = Math.abs(home) + Math.abs(away) || 1;
  const homeLeads = lowerIsBetter ? home < away : home > away;
  const awayLeads = lowerIsBetter ? away < home : away > home;
  return h('div', { class: 'statbar' },
    h('div', { class: 'sb-labels' },
      h('span', { class: `sb-val${homeLeads ? '' : ' trail'}` }, display ? display[0] : format(home)),
      h('span', { class: 'sb-name' }, label),
      h('span', { class: `sb-val${awayLeads ? '' : ' trail'}` }, display ? display[1] : format(away))),
    h('div', { class: 'sb-track' },
      h('span', { class: `sb-seg${homeLeads ? ' lead' : ''}`, style: { flex: String(Math.abs(home) / total || 0.5) } }),
      h('span', { class: `sb-seg${awayLeads ? ' lead' : ''}`, style: { flex: String(Math.abs(away) / total || 0.5) } })));
}

// ---------------------------------------------------------------- StandingsTable
/**
 * columns: [{ key, label, format? }]
 * rows: [{ rank, team: { name, abbr, color }, followed?, ...values }]
 * cutAfter: draw a strong line under this rank (playoff line)
 */
export function standingsTable({ columns, rows, cutAfter, onRowClick }) {
  return h('div', { class: 'card table-wrap' },
    h('table', { class: 'stats' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Team'), columns.map((c) => h('th', {}, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {
        class: [r.followed ? 'followed' : '', cutAfter && r.rank === cutAfter ? 'cut' : ''].filter(Boolean).join(' ') || null,
        onclick: onRowClick ? () => onRowClick(r) : null,
        style: onRowClick ? { cursor: 'pointer' } : null,
      },
      h('td', { class: 'team' }, h('span', { class: 'st-team' }, rankBadge(r.rank), crest(r.team, 'sm'), h('span', { class: 'st-name' }, r.team.short || r.team.name))),
      columns.map((c) => h('td', {}, c.format ? c.format(r[c.key], r) : r[c.key])))))));
}

// ---------------------------------------------------------------- Empty state
export function emptyState({ iconName = 'scoreboard', title, text }) {
  return h('div', { class: 'empty' }, icon(ICONS[iconName]), h('h3', {}, title), h('div', {}, text));
}

// ---------------------------------------------------------------- List row
export function listRow({ href, onclick, iconName, leading, title, sub, detail, chevron = true }) {
  const tag = href ? 'a' : 'button';
  return h(tag, { class: 'list-item', href, onclick, type: href ? null : 'button' },
    iconName ? h('span', { class: 'list-icon' }, icon(ICONS[iconName])) : null,
    leading || null,
    h('span', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null),
    detail != null ? h('span', { class: 'detail' }, detail) : null,
    chevron ? icon(ICONS.chevron) : null);
}

// ---------------------------------------------------------------- Sparkline
/** Tiny trend line (inline SVG). values: numbers (nulls skipped). Ink-colored, last point marked. */
export function sparkline(values, { width = 64, height = 20, label } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => typeof v === 'number');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  if (pts.length < 2) return svg;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 2;
  const X = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const Y = (y) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - 2 * pad);
  const line = document.createElementNS(svgNS, 'polyline');
  line.setAttribute('points', pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'spark-line');
  const dot = document.createElementNS(svgNS, 'circle');
  const [lx, ly] = pts[pts.length - 1];
  dot.setAttribute('cx', X(lx)); dot.setAttribute('cy', Y(ly)); dot.setAttribute('r', 2);
  dot.setAttribute('class', 'spark-dot');
  svg.append(line, dot);
  return svg;
}

// ---------------------------------------------------------------- Percentile bar (fingerprint row)
/** One fingerprint row: label, bar to the percentile (100 = best), value and rank. */
export function percentileRow({ label, pct, value, rank, n }) {
  return h('div', { class: 'pctl-row' },
    h('div', { class: 'pctl-top' }, h('span', { class: 'pctl-label' }, label), h('span', { class: 'pctl-val' }, value, rank ? h('span', { class: 'pctl-rank' }, `${rank}/${n}`) : null)),
    h('div', { class: 'pctl-track', role: 'img', 'aria-label': `${label}: ${pct ?? 'no'} percentile` },
      h('span', { class: 'pctl-fill', style: { width: `${pct ?? 0}%` } }),
      h('span', { class: 'pctl-mid' }),
      h('span', { class: 'pctl-num' }, pct == null ? '–' : String(pct))));
}
