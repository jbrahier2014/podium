// Home: featured-team cards, then today's scores across all three leagues,
// then a daily "Did you know?" outlier stat.
// Phase 1 shows the layout and your featured teams; live data fills in from phase 2.

import { h } from '../util/dom.js';
import { etLongDay } from '../util/time.js';
import { settings } from '../store/settings.js';
import { LEAGUES, leaguesBySeason, inSeason } from '../leagues.js';
import { crest } from '../ui/components.js';
import { pageTitle, sectionHeader, emptyState } from './common.js';

export function teamCard(team, body) {
  return h('a', { class: 'team-card', href: `#/team/${team.league}/${team.id}`, style: { '--team': team.color || null } },
    h('div', { class: 'tc-top' },
      crest(team),
      h('div', {},
        h('div', { class: 'tc-meta' }, LEAGUES[team.league].name + (inSeason(team.league) ? '' : ' · Off-season')),
        h('div', { class: 'tc-name' }, team.short || team.name))),
    body || h('div', { class: 'tc-body' }, 'Live score, last result and next game.'),
    h('div', { class: 'tc-stats' },
      h('div', { class: 'tc-stat' }, h('div', { class: 'k' }, 'Record'), h('div', { class: 'v' }, '–')),
      h('div', { class: 'tc-stat' }, h('div', { class: 'k' }, 'Standing'), h('div', { class: 'v' }, '–')),
      h('div', { class: 'tc-stat' }, h('div', { class: 'k' }, 'Power rank'), h('div', { class: 'v' }, '–'))));
}

export default {
  async render(ctx) {
    ctx.setTitle('Home');
    const { featured } = settings.get();
    // In-season teams first, keeping your chosen order within each group.
    const teams = [...featured].sort((a, b) => Number(inSeason(b.league)) - Number(inSeason(a.league)));
    const leagues = leaguesBySeason().filter((l) => inSeason(l));

    ctx.el.append(
      ...pageTitle('Home', etLongDay(new Date())),
      teams.length
        ? h('div', { class: 'featured-scroller' }, teams.map((t) => teamCard(t)))
        : h('div', { class: 'notice' }, 'No featured teams yet. ', h('a', { href: '#/settings' }, 'Add teams')),

      sectionHeader({ title: 'Today', action: 'Scoreboard', href: '#/scores' }),
      h('div', { class: 'card' }, emptyState({
        iconName: 'scoreboard',
        title: "Today's games",
        text: `Every ${leagues.map((l) => LEAGUES[l].name).join(', ')} game, live ones first.`,
      })),

      sectionHeader({ title: 'Did you know?' }),
      h('div', { class: 'card' }, emptyState({
        iconName: 'bulb',
        title: 'Daily outlier',
        text: 'One unusual number about your teams, each day, once the nightly stats run.',
      })),
    );
  },
};
