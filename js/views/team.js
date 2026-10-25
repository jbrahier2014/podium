// Team page: schedule/results, roster, standings context, season stats, Advanced tab,
// and the percentile fingerprint chart. (Phase 4; the header works now.)

import { h, icon, ICONS, toast } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { getTeams } from '../data/index.js';
import { LEAGUES } from '../leagues.js';
import { crest, tabs, emptyState } from '../ui/components.js';

const TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'roster', label: 'Roster' },
  { id: 'standings', label: 'Standings' },
  { id: 'stats', label: 'Stats' },
  { id: 'advanced', label: 'Advanced' },
];

async function findTeam(league, id) {
  const pinned = settings.get().featured.find((t) => t.league === league && t.id === String(id));
  try {
    const { teams } = await getTeams(league);
    return teams.find((t) => t.id === String(id)) || pinned;
  } catch {
    return pinned;
  }
}

export default {
  async render(ctx) {
    const { league, id } = ctx.params;
    if (!LEAGUES[league]) throw new Error('Unknown league');
    const team = (await findTeam(league, id)) || { league, id, name: `Team ${id}`, abbr: '?' };
    ctx.setTitle(team.short || team.name);

    const followBtn = h('button', {});
    const drawFollow = () => {
      const on = settings.isFeatured(league, id);
      followBtn.replaceChildren(icon(on ? ICONS.starFilled : ICONS.star));
      followBtn.setAttribute('aria-label', on ? 'Remove from featured' : 'Feature this team');
      followBtn.setAttribute('aria-pressed', String(on));
    };
    followBtn.addEventListener('click', () => {
      if (settings.isFeatured(league, id)) { settings.removeFeatured(league, id); toast('Removed from Home'); }
      else { settings.addFeatured(team); toast('Pinned to Home'); }
      drawFollow();
    });
    drawFollow();
    ctx.setActions(followBtn);

    const body = h('div', { class: 'card' });
    const drawTab = (tabId) => {
      const t = TABS.find((x) => x.id === tabId);
      body.replaceChildren(emptyState({ iconName: 'standings', title: t.label, text: `${team.short || team.name} ${t.label.toLowerCase()} arrive in a later phase.` }));
    };
    drawTab('schedule');

    ctx.el.append(
      h('div', { class: 'team-hero' },
        crest(team, 'lg'),
        h('div', {}, h('h1', { class: 'page-title', style: { margin: 0 } }, team.name), h('div', { class: 'meta t-overline muted' }, LEAGUES[league].longName))),
      tabs(TABS, 'schedule', drawTab, { label: 'Team sections' }),
      body,
    );
  },
};
