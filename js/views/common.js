// Building blocks shared by several screens.

import { h } from '../util/dom.js';
import { LEAGUES, leaguesBySeason } from '../leagues.js';
import { tabs } from '../ui/components.js';

export { sectionHeader, emptyState, listRow } from '../ui/components.js';

/** Screen title in the headline style (the small title appears in the top bar once it scrolls away). */
export function pageTitle(text, subtitle) {
  const out = [h('h1', { class: 'page-title' }, text)];
  if (subtitle) out.push(h('p', { class: 'page-sub' }, subtitle));
  return out;
}

/** NFL / CFB / MLB tabs, in-season leagues first. onPick(leagueId) on change. */
export function leagueTabs(current, onPick) {
  return tabs(leaguesBySeason().map((id) => ({ id, label: LEAGUES[id].name })), current, onPick, { label: 'League' });
}

/** The league to show by default: the first in-season one. */
export const defaultLeague = () => leaguesBySeason()[0];
