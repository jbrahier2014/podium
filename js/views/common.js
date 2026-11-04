// Building blocks shared by several screens.

import { h } from '../util/dom.js';
import { LEAGUES, leaguesBySeason } from '../leagues.js';
import { tabs } from '../ui/components.js';
import { navigate } from '../router.js';

export { sectionHeader, emptyState, listRow } from '../ui/components.js';

/** Screen title in the headline style (the small title appears in the top bar once it scrolls away). */
export function pageTitle(text, subtitle) {
  const out = [h('h1', { class: 'page-title' }, text)];
  if (subtitle) out.push(h('p', { class: 'page-sub' }, subtitle));
  return out;
}

/**
 * NFL / CFB / MLB tabs, in-season leagues first. onPick(leagueId) on change.
 * chsl: add a CHSL tab that opens the CHSL screen at that section ('scores',
 * 'standings' or 'ratings'); false leaves it out.
 */
export function leagueTabs(current, onPick, { chsl = false } = {}) {
  const items = leaguesBySeason().map((id) => ({ id, label: LEAGUES[id].name }));
  if (chsl || current === 'chsl') items.push({ id: 'chsl', label: 'CHSL' });
  return tabs(items, current, (id) => (id === 'chsl' && current !== 'chsl' ? navigate(`chsl?view=${chsl || 'scores'}`) : onPick(id)), { label: 'League' });
}

/** The league to show by default: the first in-season one. */
export const defaultLeague = () => leaguesBySeason()[0];
