// User settings, saved in localStorage (small, synchronous, survives app restarts).
// Anything bigger (API responses, computed stats) lives in IndexedDB via cache.js.

const KEY = 'podium.settings';

// Featured teams pinned on Home. IDs are the data provider's team ids:
// ESPN ids for NFL and college football, statsapi.mlb.com ids for MLB.
export const DEFAULT_FEATURED = [
  { league: 'cfb', id: '87', name: 'Notre Dame Fighting Irish', short: 'Notre Dame', abbr: 'ND', color: '#0c2340', altColor: '#c99700', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/87.png' },
  { league: 'mlb', id: '116', name: 'Detroit Tigers', short: 'Tigers', abbr: 'DET', color: '#0c2340', altColor: '#fa4616', logo: 'https://www.mlbstatic.com/team-logos/116.svg' },
  { league: 'nfl', id: '8', name: 'Detroit Lions', short: 'Lions', abbr: 'DET', color: '#0076b6', altColor: '#b0b7bc', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  { league: 'nfl', id: '7', name: 'Denver Broncos', short: 'Broncos', abbr: 'DEN', color: '#fb4f14', altColor: '#002244', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png' },
];

// High school teams (Catholic High School League). IDs are MHSAA school page names.
export const CHSL_FEATURED = [
  { league: 'chsl', id: 'toledo-st-johns-jesuit-oh', name: "St. John's Jesuit", short: "St. John's Jesuit", abbr: 'SJJ' },
  { league: 'chsl', id: 'divinechild', name: 'Divine Child', short: 'Divine Child', abbr: 'DC' },
];

const DEFAULTS = {
  featured: [...DEFAULT_FEATURED, ...CHSL_FEATURED],
  refreshSeconds: 30,  // live-score polling interval while games are in progress
  logos: true,        // real team logos (false = Podium color crests)
  theme: 'dark',       // 'dark' (Arena, the default) | 'light' (Daylight) | 'system'
  leagueOrder: ['cfb', 'nfl', 'chsl', 'mlb'], // league tabs, left to right; the first in season opens by default
};

export const DEFAULT_LEAGUE_ORDER = DEFAULTS.leagueOrder;

let state = load();
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS, ...saved };
    // One-time: add the CHSL teams to a saved list from before high school support
    if (saved.featured && !saved.chslSeeded) {
      out.featured = [...saved.featured, ...CHSL_FEATURED.filter((c) => !saved.featured.some((t) => t.league === 'chsl' && t.id === c.id))];
      out.chslSeeded = true;
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* private mode */ }
    }
    // One-time: league order saved under the old default (NFL first) moves to the new
    // one, CFB, NFL, CHSL, MLB. Changes made in Settings after this are kept.
    if (saved.leagueOrder && !saved.orderV2) {
      out.leagueOrder = [...DEFAULTS.leagueOrder];
      out.orderV2 = true;
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* private mode */ }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  listeners.forEach((fn) => fn(state));
}

export const settings = {
  get: () => state,
  set(patch) { state = { ...state, ...patch }; save(); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  isFeatured: (league, id) => state.featured.some((t) => t.league === league && String(t.id) === String(id)),
  addFeatured(team) {
    if (settings.isFeatured(team.league, team.id)) return;
    const { league, id, name, short, abbr, color, altColor, logo } = team;
    settings.set({ featured: [...state.featured, { league, id: String(id), name, short, abbr, color, altColor, logo }] });
  },
  removeFeatured(league, id) {
    settings.set({ featured: state.featured.filter((t) => !(t.league === league && String(t.id) === String(id))) });
  },
  moveFeatured(index, delta) {
    const list = [...state.featured];
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    settings.set({ featured: list });
  },
  moveLeague(index, delta) {
    const list = leagueOrder();
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    settings.set({ leagueOrder: list });
  },
  resetFeatured() { settings.set({ featured: [...DEFAULT_FEATURED, ...CHSL_FEATURED] }); },
};

/** Apply the theme: Arena (dark) by default, Daylight (light), or follow the phone. */
export function resolvedTheme(theme = state.theme) {
  if (theme === 'light') return 'light';
  if (theme === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return 'dark';
}
export function applyTheme(theme = state.theme) {
  const t = resolvedTheme(theme);
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F5F5F2' : '#111214');
}

/** The saved league order, repaired if a league was added or removed since it was saved. */
export function leagueOrder() {
  const saved = Array.isArray(state.leagueOrder) ? state.leagueOrder.filter((id) => DEFAULT_LEAGUE_ORDER.includes(id)) : [];
  return [...new Set([...saved, ...DEFAULT_LEAGUE_ORDER])];
}
