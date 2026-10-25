// Game detail: box score, scoring summary, play-by-play, team stat comparison,
// win-probability chart. (Phase 3.)

import { h } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { emptyState } from '../ui/components.js';

export default {
  async render(ctx) {
    const { league } = ctx.params;
    ctx.setTitle('Game');
    ctx.el.append(h('div', { class: 'card', style: { marginTop: 'var(--space-3)' } }, emptyState({
      iconName: 'scoreboard',
      title: `${LEAGUES[league]?.name || ''} game`,
      text: 'Box score, scoring summary, play-by-play, team stats and win probability.',
    })));
  },
};
