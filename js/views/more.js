// More: Glossary, Settings, data-source status.

import { h } from '../util/dom.js';
import { pageTitle, listRow } from './common.js';

export const APP_VERSION = '0.3 · Phase 3';

export default {
  async render(ctx) {
    ctx.setTitle('More');
    ctx.el.append(
      ...pageTitle('More'),
      h('div', { class: 'list' },
        listRow({ href: '#/glossary', iconName: 'book', title: 'Glossary', sub: 'Every stat, with its formula' }),
        listRow({ href: '#/settings', iconName: 'settings', title: 'Settings' }),
        listRow({ href: '#/sources', iconName: 'signal', title: 'Data sources', sub: 'Live status check' }),
      ),
      h('div', { class: 'group-label' }, 'Elsewhere'),
      h('div', { class: 'list' },
        listRow({ href: 'https://sagarin.com/sports/cfsend.htm', iconName: 'link', title: 'Sagarin college football ratings', chevron: false }),
      ),
      h('p', { class: 'footnote', style: { textAlign: 'center', marginTop: 'var(--space-6)' } }, `Podium ${APP_VERSION}`),
    );
    ctx.el.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  },
};
