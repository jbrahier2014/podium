// Full league standings: NFL by division or conference (playoff seeds),
// college football by conference, MLB by division or wild card.
// Your featured teams are highlighted; tap any team to open it.

import { h, clear } from '../util/dom.js';
import { LEAGUES } from '../leagues.js';
import { settings } from '../store/settings.js';
import { getStandings } from '../data/index.js';
import { chips, standingsTable } from '../ui/components.js';
import { pageTitle, leagueTabs } from './common.js';
import { navigate } from '../router.js';

export default {
  async render(ctx) {
    const league = LEAGUES[ctx.params.league] ? ctx.params.league : 'nfl';
    ctx.setTitle('Standings');
    const controls = h('div');
    const body = h('div', {}, h('div', { class: 'skeleton', style: { height: '300px', margin: '0 var(--gutter)', borderRadius: 'var(--radius-md)' } }));
    ctx.el.append(...pageTitle('Standings'), leagueTabs(league, (id) => navigate(`standings/${id}`, { replace: true })), controls, body);

    let st;
    try { st = await getStandings(league); } catch (err) {
      clear(body); body.append(h('div', { class: 'notice strong' }, `Couldn’t load standings: ${err.message}`)); return;
    }
    if (!ctx.isCurrent()) return;
    const featured = new Set(settings.get().featured.filter((t) => t.league === league).map((t) => t.id));
    const viewIds = Object.keys(st.views);
    let view = viewIds.includes(ctx.query.view) ? ctx.query.view : viewIds[0];

    const draw = () => {
      clear(controls); clear(body);
      if (viewIds.length > 1) {
        controls.append(chips(viewIds.map((v) => ({ id: v, label: st.views[v].label })), view, (v) => { view = v; draw(); }, { label: 'View' }));
      }
      for (const g of st.views[view].groups) {
        body.append(h('div', { class: 'group-label' }, g.name), standingsTable({
          columns: g.columns,
          rows: g.rows.map((r) => ({ ...r.values, rank: r.rank, team: r.team, followed: featured.has(r.team.id) })),
          cutAfter: g.cutAfter,
          onRowClick: (r) => navigate(`team/${league}/${r.team.id}`),
        }));
      }
      const cutNote = { conference: 'The line marks the 7 playoff spots in each conference.', wildcard: 'The line marks the 3 wild-card spots in each league.' }[view];
      if (cutNote && league !== 'cfb') body.append(h('p', { class: 'footnote' }, cutNote));
    };
    draw();
  },
};
