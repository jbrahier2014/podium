// Building blocks shared by several screens.

import { h } from '../util/dom.js';
import { LEAGUES, inSeason } from '../leagues.js';
import { leagueOrder } from '../store/settings.js';
import { tabs } from '../ui/components.js';
import { navigate } from '../router.js';

export { sectionHeader, emptyState, listRow } from '../ui/components.js';

/** Screen title in the headline style (the small title appears in the top bar once it scrolls away). */
export function pageTitle(text, subtitle) {
  const out = [h('h1', { class: 'page-title' }, text)];
  if (subtitle) out.push(h('p', { class: 'page-sub' }, subtitle));
  return out;
}

// The league you're looking at carries over between Scores, Ratings, Standings and
// Explore, and across app launches (iPhone closes home-screen apps in the background
// often, which used to reset it to the first league), so picking CFB keeps CFB.
const LAST_KEY = 'podium.lastLeague';
let lastLeague = null;
try { lastLeague = localStorage.getItem(LAST_KEY); } catch { /* blocked */ }
export function rememberLeague(id) {
  lastLeague = id;
  try { localStorage.setItem(LAST_KEY, id); } catch { /* blocked */ }
}

/**
 * League tabs in your order (Settings › League order). onPick(leagueId) on change.
 * chsl: include the CHSL tab (Scores, Standings and Ratings show CHSL in place);
 * false leaves it out (Explore).
 */
export function leagueTabs(current, onPick, { chsl = false } = {}) {
  rememberLeague(current);
  const items = leagueOrder()
    .filter((id) => id !== 'chsl' || chsl || current === 'chsl')
    .map((id) => ({ id, label: LEAGUES[id].name }));
  return tabs(items, current, (id) => {
    rememberLeague(id);
    onPick(id);
  }, { label: 'League' });
}

/**
 * The league a screen opens on: the one you were last looking at, else the first
 * in-season league in your order. withChsl: whether this screen has a CHSL tab.
 */
export function defaultLeague({ withChsl = false } = {}) {
  const ok = (id) => id && LEAGUES[id] && (id !== 'chsl' || withChsl);
  if (ok(lastLeague)) return lastLeague;
  const order = leagueOrder().filter(ok);
  return order.find((id) => inSeason(id)) || order[0];
}
