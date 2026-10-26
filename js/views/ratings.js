// Power ratings per league: a sortable table with rating-movement sparklines, a
// matchup predictor, and (college) a link to Sagarin for comparison.
// Numbers come from the nightly job (data/<league>/<season>.json).

import { h, clear } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { settings } from '../store/settings.js';
import { getRatings, getRatingSeasons, getTeams } from '../data/index.js';
import { fmt } from '../data/statdefs.js';
import { crest, chips, sparkline, emptyState } from '../ui/components.js';
import { pageTitle, leagueTabs, defaultLeague } from './common.js';
import { navigate } from '../router.js';
import { etTime, etDay } from '../util/time.js';

// Columns per league. get(team) returns the value; sort uses the number (or the text).
const pct = (t) => (t.v.wins + t.v.losses ? t.v.wins / (t.v.wins + t.v.losses) : 0);
const COLUMNS = {
  cfb: [
    { key: 'pred', label: 'Pred', get: (t) => t.v.pred, f: 'dec1', hib: true, default: true },
    { key: 'pred_chg', label: 'Wk ±', get: (t) => t.v.pred_chg, f: 'signed1', hib: true, tone: true },
    { key: 'trend', label: 'Trend', spark: 0 },
    { key: 'record', label: 'W-L', get: (t) => t.record, sortBy: pct, hib: true },
    { key: 'sos_rank', label: 'SOS rk', get: (t) => t.v.sos_rank, f: 'int', hib: false },
    { key: 'top25', label: 'vs T25', get: (t) => t.v.top25, sortBy: (t) => recPct(t.v.top25), hib: true },
    { key: 'top50', label: 'vs T50', get: (t) => t.v.top50, sortBy: (t) => recPct(t.v.top50), hib: true },
    { key: 'elo', label: 'Elo', get: (t) => t.v.elo, f: 'int', hib: true },
    { key: 'srs', label: 'SRS', get: (t) => t.v.srs, f: 'dec1', hib: true },
    { key: 'sp', label: 'SP+', get: (t) => t.v.sp, f: 'dec1', hib: true },
  ],
  nfl: [
    { key: 'srs', label: 'SRS', get: (t) => t.v.srs, f: 'dec1', hib: true, default: true },
    { key: 'srs_chg', label: 'Wk ±', get: (t) => t.v.srs_chg, f: 'signed1', hib: true, tone: true },
    { key: 'trend', label: 'Trend', spark: 0 },
    { key: 'record', label: 'W-L', get: (t) => t.record, sortBy: pct, hib: true },
    { key: 'pyth_w', label: 'Pyth W', get: (t) => t.v.pyth_w, f: 'dec1', hib: true },
    { key: 'luck', label: 'Luck', get: (t) => t.v.luck, f: 'signed1', hib: true },
    { key: 'pd', label: 'Diff', get: (t) => t.v.pd, f: 'signed0', hib: true },
    { key: 'elo', label: 'Elo', get: (t) => t.v.elo, f: 'int', hib: true },
    { key: 'po', label: 'Playoff', get: (t) => t.v.po, f: 'odds', hib: true },
    { key: 'div', label: 'Div', get: (t) => t.v.div, f: 'odds', hib: true },
    { key: 'bye', label: '#1 seed', get: (t) => t.v.bye, f: 'odds', hib: true },
  ],
  mlb: [
    { key: 'pyth', label: 'Pyth %', get: (t) => pythPct(t), f: 'avg', hib: true, default: true },
    { key: 'record', label: 'W-L', get: (t) => t.record, sortBy: pct, hib: true },
    { key: 'pyth_rec', label: 'Pyth W-L', get: (t) => (t.v.pyth_w != null ? `${Math.round(t.v.pyth_w)}-${Math.round(t.v.pyth_l)}` : null), sortBy: (t) => t.v.pyth_w, hib: true },
    { key: 'luck', label: 'Luck', get: (t) => t.v.luck, f: 'signed1', hib: true },
    { key: 'rd', label: 'RD', get: (t) => t.v.rd, f: 'signed0', hib: true },
    { key: 'trend', label: 'Trend', spark: 0 },
    { key: 'one_run', label: '1-run', get: (t) => t.v.one_run, sortBy: (t) => recPct(t.v.one_run), hib: true },
    { key: 'extra', label: 'Extras', get: (t) => t.v.extra, sortBy: (t) => recPct(t.v.extra), hib: true },
    { key: 'po', label: 'Playoff', get: (t) => t.v.po, f: 'odds', hib: true },
    { key: 'div', label: 'Div', get: (t) => t.v.div, f: 'odds', hib: true },
    { key: 'bye', label: 'Bye', get: (t) => t.v.bye, f: 'odds', hib: true },
  ],
};
const PRIMARY = { cfb: 'Predictor', nfl: 'SRS', mlb: 'Pythagorean win %' };

function recPct(s) {
  if (!s) return null;
  const [w, l] = String(s).split('-').map(Number);
  return w + l ? w / (w + l) : null;
}
export function pythPct(t) {
  const g = (t.v.pyth_w ?? 0) + (t.v.pyth_l ?? 0);
  return g ? t.v.pyth_w / g : null;
}
const show = (v, f) => (f === 'odds' ? (v == null ? '–' : v >= 99.95 ? '>99.9%' : v > 0 && v < 0.1 ? '<0.1%' : `${v.toFixed(1)}%`) : fmt(v, f));

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : defaultLeague();
    ctx.setTitle('Ratings');
    const controls = h('div');
    const body = h('div', {}, h('div', { class: 'skeleton', style: { height: '320px', margin: '0 var(--gutter)', borderRadius: 'var(--radius-md)' } }));
    ctx.el.append(...pageTitle('Ratings'), leagueTabs(league, (id) => navigate(`ratings/${id}`, { replace: true })), controls, body);

    let seasons; let data; let teamInfo;
    try {
      seasons = await getRatingSeasons(league);
      const season = seasons.includes(Number(ctx.query.season)) ? Number(ctx.query.season) : seasons[0];
      [data, teamInfo] = await Promise.all([
        getRatings(league, season),
        getTeams(league).then((r) => new Map(r.teams.map((t) => [t.id, t]))).catch(() => new Map()),
      ]);
    } catch (err) {
      clear(body);
      body.append(h('div', { class: 'card' }, emptyState({ iconName: 'standings', title: 'Ratings not available yet', text: `The nightly stats haven’t produced ${LEAGUES[league].name} ratings yet. (${err.message})` })));
      return;
    }
    if (!ctx.isCurrent()) return;

    // Season picker
    if (seasons.length > 1) {
      controls.append(chips(seasons.map((s) => ({ id: s, label: league === 'mlb' ? String(s) : `${s}` })), data.season,
        (s) => navigate(`ratings/${league}${s === seasons[0] ? '' : `?season=${s}`}`, { replace: true }), { label: 'Season' }));
    }
    const updated = data.generatedAt ? `Updated ${etDay(data.generatedAt)}, ${etTime(data.generatedAt)} ET` : '';
    controls.append(h('p', { class: 'ratings-meta t-caption' }, [data.final ? `Final ${data.season}` : `Through ${data.asOf}`, updated].filter(Boolean).join(' · ')));

    const featured = new Set(settings.get().featured.filter((t) => t.league === league).map((t) => t.id));
    const teams = data.teams.map((t) => {
      const info = teamInfo.get(t.id) || {};
      return { ...t, info: { ...info, id: t.id, league, abbr: info.abbr || t.abbr || '?', short: info.short || t.name || t.abbr, name: info.name || t.name, color: info.color || null, logo: info.logo || null } };
    });

    clear(body);
    if (!data.final) body.append(matchupCard(league, data, teams, featured));
    body.append(ratingsTable(league, data, teams, featured));
    body.append(h('p', { class: 'footnote' },
      `Sorted by ${PRIMARY[league]} by default; tap a column to re-sort. `,
      h('a', { href: '#/glossary' }, 'How each rating works'), '.'));
    if (league === 'cfb') {
      body.append(h('p', { class: 'footnote' }, 'Compare with Jeff Sagarin’s ratings at ',
        h('a', { href: 'https://sagarin.com/sports/cfsend.htm', target: '_blank', rel: 'noopener' }, 'sagarin.com'), ', or with the ',
        h('a', { href: '#/polls' }, 'AP poll and CFP rankings'), '.'));
    }
  },
};

// ---------------------------------------------------------------- table
function ratingsTable(league, data, teams, featured) {
  const cols = COLUMNS[league].filter((c) => (c.spark != null || teams.some((t) => c.get(t) != null)) && !(data.final && c.tone));
  let sortCol = cols.find((c) => c.default);
  let asc = false;
  const wrap = h('div', { class: 'card table-wrap ratings-table' });

  const draw = () => {
    const key = (t) => { const v = sortCol.sortBy ? sortCol.sortBy(t) : sortCol.get(t); return v == null ? null : v; };
    const sorted = [...teams].sort((a, b) => {
      const va = key(a); const vb = key(b);
      if (va == null) return 1; if (vb == null) return -1;
      const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return asc ? d : -d;
    });
    const head = h('tr', {}, h('th', {}, 'Team'), cols.map((c) => h('th', {
      class: [c === sortCol ? 'sorted' : '', c === sortCol && asc ? 'asc' : ''].join(' ').trim() || null,
      onclick: c.spark != null ? null : () => {
        if (sortCol === c) asc = !asc; else { sortCol = c; asc = c.hib === false; }
        draw();
      },
    }, c.label)));
    const rows = sorted.map((t, i) => h('tr', { class: featured.has(t.id) ? 'followed' : null, onclick: () => navigate(`team/${league}/${t.id}?tab=advanced`) },
      h('td', { class: 'team' }, h('span', { class: 'st-team' }, h('span', { class: 'rank' }, i + 1), crest(t.info, 'sm'), h('span', { class: 'st-name' }, t.info.short))),
      cols.map((c) => {
        if (c.spark != null) return h('td', {}, sparkline(t.hist.map((p) => p[c.spark]), { label: `${t.info.short} ${PRIMARY[league]} trend` }));
        const v = c.get(t);
        const tone = c.tone && typeof v === 'number' ? (v > 0.05 ? 'up' : v < -0.05 ? 'down' : null) : null;
        return h('td', { class: tone }, typeof v === 'number' || c.f ? show(v, c.f) : (v ?? '–'));
      })));
    clear(wrap);
    wrap.append(h('table', { class: 'stats' }, h('thead', {}, head), h('tbody', {}, rows)));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------- matchup predictor
function normCdf(x) {
  // Abramowitz-Stegun approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function predictMatchup(league, data, a, b, venue) {
  // venue: 'a' (A at home), 'b' (B at home), 'n' (neutral)
  if (league === 'mlb') {
    const pa = pythPct(a) ?? 0.5; const pb = pythPct(b) ?? 0.5;
    let p = (pa - pa * pb) / (pa + pb - 2 * pa * pb || 1);
    const edge = venue === 'a' ? 0.16 : venue === 'b' ? -0.16 : 0;
    p = 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + edge)));
    return { prob: p, line: null };
  }
  const key = league === 'cfb' ? 'pred' : 'srs';
  const hfa = data.hfa ?? (league === 'cfb' ? 2.5 : 1.8);
  const line = (a.v[key] ?? 0) - (b.v[key] ?? 0) + (venue === 'a' ? hfa : venue === 'b' ? -hfa : 0);
  return { line, prob: normCdf(line / (data.sigma || 14)) };
}

function matchupCard(league, data, teams, featured) {
  const byName = [...teams].sort((x, y) => x.info.short.localeCompare(y.info.short));
  const first = teams.find((t) => featured.has(t.id)) || teams[0];
  const second = teams.find((t) => t.id !== first.id && !featured.has(t.id)) || teams[1];
  const select = (selected) => h('select', { 'aria-label': 'Team' }, byName.map((t) => h('option', { value: t.id, selected: t.id === selected.id }, t.info.short)));
  const selA = select(first); const selB = select(second);
  const venue = h('select', { 'aria-label': 'Where the game is played', class: 'mu-venue' },
    h('option', { value: 'b' }, 'at'), h('option', { value: 'n' }, 'vs'), h('option', { value: 'a' }, 'hosts'));
  const out = h('div', { class: 'mu-result' });
  const update = () => {
    const a = teams.find((t) => t.id === selA.value); const b = teams.find((t) => t.id === selB.value);
    const { line, prob } = predictMatchup(league, data, a, b, venue.value);
    const fav = prob >= 0.5 ? a : b;
    const p = prob >= 0.5 ? prob : 1 - prob;
    const half = line == null ? null : Math.round(Math.abs(line) * 2) / 2;
    clear(out);
    out.append(
      h('span', { class: 'mu-line' }, line == null ? `${fav.info.short} ${Math.round(p * 100)}%` : half === 0 ? 'Pick’em' : `${fav.info.short} by ${half}`),
      h('span', { class: 'mu-prob' }, line == null ? 'to win' : `${Math.round(p * 100)}% to win`));
  };
  [selA, selB, venue].forEach((s) => s.addEventListener('change', update));
  update();
  return h('div', { class: 'card matchup' },
    h('div', { class: 't-overline muted' }, 'Predict a matchup'),
    h('div', { class: 'mu-row' }, selA, venue, selB),
    out,
    h('div', { class: 't-caption' }, `"vs" means a neutral site. `, league === 'mlb' ? 'Log5 on Pythagorean win %, with home field.' : `From ${league === 'cfb' ? 'Predictor' : 'SRS'} ratings, with ${data.hfa ?? ''} points of home field.`));
}
