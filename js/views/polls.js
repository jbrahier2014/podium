// College football polls: AP Top 25 (plus others receiving votes and teams that dropped
// out) and, once the committee starts releasing them, the CFP rankings. Any week, any of
// the last four seasons.   #/polls?poll=ap&season=2026&week=2-9

import { h, clear } from '../util/dom.js';
import { settings } from '../store/settings.js';
import { seasonYear } from '../leagues.js';
import { getPollWeeks, getPolls, POLLS } from '../data/polls.js';
import { crest, chips, periodPicker, emptyState } from '../ui/components.js';
import { pageTitle } from './common.js';
import { etDay } from '../util/time.js';

export default {
  async render(ctx) {
    ctx.setTitle('Polls');
    const cur = seasonYear('cfb');
    const q = { poll: ctx.query.poll === 'cfp' ? 'cfp' : 'ap', season: Number(ctx.query.season) || cur, week: ctx.query.week || null };
    const save = () => history.replaceState(null, '', `#/polls?${new URLSearchParams({ poll: q.poll, season: q.season, ...(q.week ? { week: q.week } : {}) })}`);

    const seasonBar = h('div'); const pollBar = h('div'); const weekBar = h('div'); const body = h('div');
    ctx.el.append(...pageTitle('College polls', 'AP Top 25 and College Football Playoff rankings'), seasonBar, pollBar, weekBar, body);

    let weeks = []; let token = 0;
    const featured = new Set(settings.get().featured.filter((t) => t.league === 'cfb').map((t) => String(t.id)));

    async function loadSeason() {
      clear(seasonBar); seasonBar.append(chips([cur, cur - 1, cur - 2, cur - 3].map((s) => ({ id: s, label: String(s) })), q.season,
        (s) => { q.season = s; q.week = null; loadSeason(); }, { label: 'Season' }));
      clear(body); body.append(h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '320px' } })));
      try {
        const r = await getPollWeeks(q.season);
        weeks = r.weeks;
        if (!weeks.some((w) => w.key === q.week)) q.week = r.latestKey;
      } catch (err) {
        clear(body); body.append(h('div', { class: 'notice strong' }, `Couldn’t load the polls: ${err.message}`));
        return;
      }
      loadWeek();
    }

    async function loadWeek() {
      const my = ++token;
      save();
      const i = weeks.findIndex((w) => w.key === q.week);
      const w = weeks[i];
      clear(weekBar);
      if (!w) { clear(body); body.append(h('div', { class: 'card' }, emptyState({ iconName: 'standings', title: 'No polls yet', text: 'The AP preseason poll comes out in August.' }))); return; }
      weekBar.append(periodPicker({
        label: w.label, sub: `${q.season} season`,
        onPrev: i > 0 ? () => { q.week = weeks[i - 1].key; loadWeek(); } : null,
        onNext: i < weeks.length - 1 ? () => { q.week = weeks[i + 1].key; loadWeek(); } : null,
      }));
      clear(body); body.append(h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '320px' } })));
      let polls;
      try {
        polls = await getPolls(q.season, w.type, w.week, { current: q.season === cur && i === weeks.length - 1 });
      } catch (err) {
        if (my !== token || !ctx.isCurrent()) return;
        clear(body); body.append(h('div', { class: 'notice strong' }, `Couldn’t load this week: ${err.message}`));
        return;
      }
      if (my !== token || !ctx.isCurrent()) return;

      // Poll choice: CFP is only selectable in weeks the committee released rankings
      const avail = polls.available;
      if (!avail.includes(q.poll)) q.poll = avail[0] || 'ap';
      save();
      const drawPollBar = () => {
        clear(pollBar);
        const bar = chips(Object.entries(POLLS).map(([k, p]) => ({ id: k, label: p.label })), q.poll,
          (k) => { if (!avail.includes(k)) return; q.poll = k; save(); drawPollBar(); draw(polls); }, { label: 'Poll' });
        bar.querySelectorAll('.chip').forEach((b, n) => {
          if (!avail.includes(Object.keys(POLLS)[n])) { b.disabled = true; b.title = 'No committee rankings this week'; }
        });
        pollBar.append(bar);
      };
      drawPollBar();
      draw(polls);
    }

    function draw(polls) {
      clear(body);
      const p = polls[q.poll];
      if (!p) {
        body.append(h('div', { class: 'card' }, emptyState({ iconName: 'standings', title: q.poll === 'cfp' ? 'No CFP rankings this week' : 'No AP poll this week',
          text: q.poll === 'cfp' ? 'The committee releases its first rankings in early November, then weekly through selection day.' : '' })));
        return;
      }
      const isAP = p.key === 'ap';
      const row = (e, i, list) => {
        const move = e.move === 'new' ? h('span', { class: 'pm new' }, 'New')
          : e.move === 'same' ? h('span', { class: 'pm same' }, '–')
            : h('span', { class: `pm ${e.move}` }, `${e.move === 'up' ? '▲' : '▼'}${e.moveBy}`);
        return h('a', { class: `poll-row${isAP ? '' : ' no-pts'}${featured.has(e.team.id) ? ' followed' : ''}${!isAP && e.rank === 12 && list.length > 12 ? ' cut' : ''}`, href: `#/team/cfb/${e.team.id}` },
          h('span', { class: `rank${e.rank <= 3 ? ` r${e.rank}` : ''}` }, e.rank),
          crest(e.team, 'sm'),
          h('span', { class: 'pr-team' }, h('span', { class: 'nm' }, e.team.short || e.team.name), e.record ? h('span', { class: 'rec' }, e.record) : null),
          isAP ? h('span', { class: 'pr-pts' }, e.points.toLocaleString(), e.firstPlace ? h('span', { class: 'fpv' }, ` (${e.firstPlace})`) : null) : null,
          move);
      };
      const head = h('div', { class: 'poll-head' },
        h('span', {}, p.name), p.date ? h('span', { class: 't-caption' }, `Released ${etDay(p.date)}`) : null);
      body.append(h('div', { class: 'card poll-card' }, head,
        h('div', { class: `poll-cols${isAP ? '' : ' no-pts'}` }, h('span', {}, 'Rk'), h('span', {}), h('span', {}, 'Team'), isAP ? h('span', { class: 'r' }, 'Pts') : null, h('span', { class: 'r' }, 'Move')),
        p.ranks.map((e, i, a) => row(e, i, a))));
      if (!isAP) body.append(h('p', { class: 'footnote' }, 'The line after 12 marks the size of the playoff field. Seeding also depends on conference champions, so the bracket isn’t simply the top 12.'));

      if (isAP && p.others.length) {
        body.append(h('div', { class: 'group-label' }, 'Others receiving votes'),
          h('div', { class: 'card others' }, p.others.map((e) => h('a', { class: `other-row${featured.has(e.team.id) ? ' followed' : ''}`, href: `#/team/cfb/${e.team.id}` },
            crest(e.team, 'sm'), h('span', { class: 'pr-team' }, h('span', { class: 'nm' }, e.team.short || e.team.name), e.record ? h('span', { class: 'rec' }, e.record) : null),
            h('span', { class: 'pr-pts' }, e.points.toLocaleString())))));
      }
      if (p.dropped.length) {
        body.append(h('p', { class: 'footnote dropped' }, h('strong', {}, 'Dropped out: '),
          p.dropped.map((e) => `${e.team.short || e.team.name}${e.previous ? ` (${e.previous})` : ''}`).join(', ')));
      }
      if (isAP) body.append(h('p', { class: 'footnote' }, 'Points: 25 for a first-place vote down to 1 for 25th; first-place votes in parentheses. Records are as of the poll.'));
    }

    loadSeason();
  },
};
