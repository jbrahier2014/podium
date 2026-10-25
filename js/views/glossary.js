// Glossary: every stat defined, with its formula. Searchable.

import { h, icon, ICONS, clear } from '../util/dom.js';
import { GLOSSARY, GLOSSARY_GROUPS } from '../data/glossary.js';
import { LEAGUES } from '../leagues.js';
import { pageTitle } from './common.js';

export default {
  async render(ctx) {
    ctx.setTitle('Glossary');
    const results = h('div');
    const input = h('input', { type: 'search', placeholder: 'Search stats', autocapitalize: 'off', autocomplete: 'off' });
    input.addEventListener('input', () => draw(input.value.trim().toLowerCase()));

    ctx.el.append(...pageTitle('Glossary'), h('label', { class: 'search-field' }, icon(ICONS.search), input), results);

    function draw(q) {
      clear(results);
      let any = false;
      for (const group of GLOSSARY_GROUPS) {
        const items = GLOSSARY.filter((g) => g.group === group &&
          (!q || `${g.term} ${g.abbr || ''} ${g.def}`.toLowerCase().includes(q)));
        if (!items.length) continue;
        any = true;
        results.append(
          h('div', { class: 'group-label' }, group),
          h('div', { class: 'list' }, items.map((g) => h('details', { class: 'gloss', open: !!q && items.length <= 3 },
            h('summary', { class: 'list-item' },
              h('span', { class: 'grow' }, h('div', { class: 'title' }, g.abbr ? `${g.abbr} · ${g.term}` : g.term)),
              h('span', { class: 'detail' }, g.leagues.map((l) => LEAGUES[l].name).join(' · ')),
              icon(ICONS.chevron)),
            h('div', { class: 'gloss-body' },
              h('p', {}, g.def),
              h('div', { class: 'formula' }, g.formula))))));
      }
      if (!any) results.append(h('div', { class: 'empty' }, 'No stats match that search'));
    }
    draw('');
  },
};
