// Hash router with iOS-style navigation.
//
// URLs look like  #/scores/nfl   #/team/mlb/116   #/game/cfb/401752
// Tab roots (home, scores, ratings, explore, more) switch tabs; anything else is
// "pushed" on top of the current tab with a back button, like a native app.

import { clear } from './util/dom.js';
import { markSVG } from './ui/brand.js';

const TABS = ['home', 'scores', 'ratings', 'explore', 'more'];

// pattern → lazy-loaded view module. ":name" segments become params.
const ROUTES = [
  ['home', () => import('./views/home.js')],
  ['scores', () => import('./views/scores.js')],
  ['scores/:league', () => import('./views/scores.js')],
  ['ratings', () => import('./views/ratings.js')],
  ['ratings/:league', () => import('./views/ratings.js')],
  ['explore', () => import('./views/explore.js')],
  ['explore/:league', () => import('./views/explore.js')],
  ['more', () => import('./views/more.js')],
  ['glossary', () => import('./views/glossary.js')],
  ['settings', () => import('./views/settings.js')],
  ['sources', () => import('./views/sources.js')],
  ['standings/:league', () => import('./views/standings.js')],
  ['team/:league/:id', () => import('./views/team.js')],
  ['game/:league/:id', () => import('./views/game.js')],
];

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, load] of ROUTES) {
    const pp = pattern.split('/');
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(parts[i])), true) : seg === parts[i]))) {
      return { pattern, load, params };
    }
  }
  return null;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)), hash: `#/${raw}` };
}

export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (replace) history.replaceState(null, '', hash), onHashChange();
  else location.hash = hash;
}

// --- navigation stack (for back button + transitions) ---
let stack = [];          // [{ hash, title, scrollY }]
let activeTab = 'home';
let cleanups = [];
let renderToken = 0;
let syntheticRoot = false; // true when the first screen shown was a pushed one

const els = {};

export function startRouter() {
  els.view = document.getElementById('view');
  els.navbar = document.getElementById('navbar');
  els.title = document.getElementById('nav-title');
  els.back = document.getElementById('nav-back');
  els.brand = document.getElementById('nav-brand');
  els.brand.innerHTML = markSVG();
  els.backLabel = document.getElementById('nav-back-label');
  els.actions = document.getElementById('nav-actions');
  els.tabs = [...document.querySelectorAll('#tabbar a')];

  els.back.addEventListener('click', () => {
    // Opened straight onto a pushed screen (e.g. a shared link)? Go to the tab root instead of leaving the app.
    if (syntheticRoot && stack.length === 2) navigate(stack[0].hash, { replace: true });
    else history.back();
  });
  // Tapping the active tab again pops to its root (and scrolls to top), like iOS.
  els.tabs.forEach((a) => a.addEventListener('click', (e) => {
    if (a.dataset.tab === activeTab) {
      e.preventDefault();
      if (stack.length > 1) navigate(stack[0].hash.replace(/^#\//, ''));
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }));
  addEventListener('hashchange', onHashChange);
  addEventListener('scroll', onScroll, { passive: true });
  onHashChange();
}

function onScroll() {
  els.navbar.classList.toggle('scrolled', window.scrollY > 4);
}

async function onHashChange() {
  const { path, query, hash } = parseHash();
  const m = match(path);
  if (!m) return navigate('home', { replace: true });

  const root = path.split('/')[0];
  const isTabRoot = TABS.includes(root);

  // Work out the transition: tab switch, push, or pop.
  if (stack.length) stack[stack.length - 1].scrollY = window.scrollY;
  let kind;
  if (isTabRoot) {
    kind = root === activeTab && stack.length > 1 ? 'pop' : 'tab';
    const keepScroll = kind === 'pop' && stack[0]?.hash === hash ? stack[0].scrollY : 0;
    activeTab = root;
    syntheticRoot = false;
    stack = [{ hash, title: '', scrollY: keepScroll }];
  } else if (stack.length > 1 && stack[stack.length - 2].hash === hash) {
    kind = 'pop';
    stack.pop();
  } else if (stack.length && stack[stack.length - 1].hash === hash) {
    kind = 'none';
  } else {
    kind = 'push';
    if (!stack.length) { stack = [{ hash: `#/${activeTab}`, title: titleForTab(activeTab) }]; syntheticRoot = true; }
    stack.push({ hash, title: '' });
  }

  els.tabs.forEach((a) => a.classList.toggle('active', a.dataset.tab === activeTab));

  // Tear down the previous view (timers, pollers).
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanups = [];

  const token = ++renderToken;
  const mod = await m.load();
  if (token !== renderToken) return; // a newer navigation happened meanwhile

  const entry = stack[stack.length - 1];
  clear(els.view);
  clear(els.actions);
  els.view.className = 'view';
  void els.view.offsetWidth; // restart CSS animation
  els.view.classList.add(kind === 'push' ? 'enter-push' : kind === 'pop' ? 'enter-pop' : 'enter-tab');

  // Back button
  const prev = stack[stack.length - 2];
  els.back.hidden = !prev;
  els.brand.hidden = !!prev; // the mark sits top-left on tab roots
  if (prev) els.backLabel.textContent = prev.title || 'Back';

  const ctx = {
    params: m.params,
    query,
    el: els.view,
    setTitle(t) {
      entry.title = t;
      els.title.textContent = t;
      document.title = t ? `${t} · Podium` : 'Podium';
    },
    setActions(...nodes) { clear(els.actions); els.actions.append(...nodes); },
    onCleanup(fn) { cleanups.push(fn); },
    isCurrent: () => token === renderToken,
  };

  try {
    await mod.default.render(ctx);
  } catch (err) {
    console.error(err);
    els.view.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'notice error';
    p.style.marginTop = '16px';
    p.textContent = `Something went wrong showing this screen: ${err.message}`;
    els.view.append(p);
  }

  watchLargeTitle();
  window.scrollTo(0, kind === 'pop' ? entry.scrollY || 0 : 0);
  onScroll();
}

function titleForTab(tab) {
  return { home: 'Home', scores: 'Scores', ratings: 'Ratings', explore: 'Explore', more: 'More' }[tab] || 'Back';
}

// Show the small centered title only after the page title scrolls under the bar.
let titleObserver;
function watchLargeTitle() {
  titleObserver?.disconnect();
  const lt = els.view.querySelector('.page-title');
  if (!lt) { els.navbar.classList.add('show-title'); return; }
  els.navbar.classList.remove('show-title');
  titleObserver = new IntersectionObserver(([e]) => {
    els.navbar.classList.toggle('show-title', !e.isIntersecting);
  }, { rootMargin: `-${els.navbar.offsetHeight}px 0px 0px 0px`, threshold: 0 });
  titleObserver.observe(lt);
}
