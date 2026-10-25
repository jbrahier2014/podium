// Scoreboard per league: date picker for MLB, week picker for football,
// Top 25 / conference filters for college football. (Phase 2.)

import { h } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { pageTitle, leagueTabs, defaultLeague, emptyState } from './common.js';
import { navigate } from '../router.js';

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : defaultLeague();
    ctx.setTitle('Scores');
    ctx.el.append(
      ...pageTitle('Scores'),
      leagueTabs(league, (id) => navigate(`scores/${id}`, { replace: true })),
      h('div', { class: 'card' }, emptyState({
        iconName: 'scoreboard',
        title: `${LEAGUES[league].name} scoreboard`,
        text: league === 'mlb'
          ? 'Any date, every game. Live scores update while games are on.'
          : `Any week, every game${league === 'cfb' ? '. Filter to the Top 25 or a conference' : ''}.`,
      })),
    );
  },
};
