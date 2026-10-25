// Stat Explorer: leaderboards, head-to-head, scatter-plot builder, rolling trends,
// season-over-season comparisons. (Phase 6.)

import { h } from '../util/dom.js';
import { pageTitle, emptyState } from './common.js';

const TOOLS = [
  ['Leaderboards', 'Sort any stat, with percentile bars'],
  ['Head-to-head', 'Any two teams, side by side'],
  ['Scatter plot', 'Any two stats; tap a dot to open the team'],
  ['Rolling trends', 'How a stat moves game by game'],
  ['Season over season', 'This season against the three before it'],
];

export default {
  async render(ctx) {
    ctx.setTitle('Explore');
    ctx.el.append(
      ...pageTitle('Explore'),
      h('div', { class: 'card' }, emptyState({ iconName: 'scatter', title: 'Stat Explorer', text: 'Opens once the nightly stats are running.' })),
      h('div', { class: 'group-label' }, 'Tools'),
      h('div', { class: 'list' }, TOOLS.map(([t, d]) =>
        h('div', { class: 'list-item' }, h('span', { class: 'grow' }, h('div', { class: 'title' }, t), h('div', { class: 'sub' }, d))))),
    );
  },
};
