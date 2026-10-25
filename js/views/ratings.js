// Power ratings per league: sortable tables with rating-movement sparklines. (Phase 5.)

import { h } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { pageTitle, leagueTabs, defaultLeague, emptyState } from './common.js';
import { navigate } from '../router.js';

const BLURB = {
  cfb: 'Predictor, Elo and SRS for every FBS team, with SP+ alongside. Strength of schedule, records vs. the Top 25 and 50, and a line for any matchup.',
  nfl: 'SRS, Elo and Pythagorean wins for all 32 teams, plus playoff odds from 10,000 simulated seasons.',
  mlb: 'Run differential, Pythagorean record and the luck gap, plus playoff odds from 10,000 simulated seasons.',
};

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : defaultLeague();
    ctx.setTitle('Ratings');
    ctx.el.append(
      ...pageTitle('Ratings'),
      leagueTabs(league, (id) => navigate(`ratings/${id}`, { replace: true })),
      h('div', { class: 'card' }, emptyState({ iconName: 'standings', title: `${LEAGUES[league].name} power ratings`, text: BLURB[league] })),
      ...(league !== 'cfb' ? [] : [h('p', { class: 'footnote' }, 'Compare with Jeff Sagarin’s ratings at ',
        h('a', { href: 'https://sagarin.com/sports/cfsend.htm', target: '_blank', rel: 'noopener' }, 'sagarin.com'), '.')]),
    );
  },
};
