// Podium entry point: theme, service worker, router.

import { startRouter } from './router.js';
import { settings, applyTheme } from './store/settings.js';
import { toast } from './util/dom.js';

applyTheme();
settings.onChange((s) => applyTheme(s.theme));
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());

// Installed on the home screen? (Used to tweak a few things, e.g. hiding install tips.)
export const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
document.documentElement.classList.toggle('standalone', isStandalone);

// Keep the top and tab bars on the visible edges of the screen. iPhone home-screen
// apps sometimes shift the area pinned bars attach to (seen after the app resumed),
// leaving the tab bar floating mid-screen. The visual viewport says where the
// visible part really is; once everything has settled, nudge the bars back onto it.
// Never during scrolling: the rubber-band bounce moves the viewport on purpose.
const standalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
// The phone's real screen height (portrait or landscape), which iOS can't get wrong
const screenHeight = () => (window.matchMedia('(orientation: portrait)').matches
  ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height));
let nudged = false;

// Current translateY on a bar (what we added last time), to measure where it would
// sit without it
const shiftOf = (el) => Number((el.style.transform.match(/translateY\((-?[\d.]+)px\)/) || [])[1] || 0);

function anchorBars() {
  const vv = window.visualViewport;
  const nav = document.getElementById('navbar');
  const tab = document.getElementById('tabbar');
  if (!vv || !nav || !tab) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const bouncing = window.scrollY < 0 || window.scrollY > max + 1;
  const zoomed = vv.scale && Math.abs(vv.scale - 1) > 0.01;
  if (bouncing || zoomed || typing()) return;
  // Measure where the bars really are, not where iOS says the window is: after a
  // screenshot iOS can report the right window size yet still draw pinned bars
  // against a stale, shorter screen (tab bar floating mid-screen). The visible area
  // runs from vv.offsetTop to vv.offsetTop + vv.height; put the bars on its edges.
  const visTop = vv.offsetTop;
  let visBottom = vv.offsetTop + vv.height;
  // And if iOS does report a window well short of the real screen (home-screen
  // app), the visible bottom is the screen's bottom
  const short = standalone() ? screenHeight() - window.innerHeight : 0;
  if (short > 80) {
    if (!nudged) {
      nudged = true;
      const y = window.scrollY;
      window.scrollTo(0, y + 1); window.scrollTo(0, y);
      setTimeout(anchorBars, 150);
      return;
    }
    visBottom = window.innerHeight + short;
  } else nudged = false;
  const navTop = nav.getBoundingClientRect().top - shiftOf(nav);
  const tabBottom = tab.getBoundingClientRect().bottom - shiftOf(tab);
  const dTop = Math.round(visTop - navTop);
  const dBottom = Math.round(visBottom - tabBottom);
  nav.style.transform = Math.abs(dTop) > 1 ? `translateY(${dTop}px)` : '';
  tab.style.transform = Math.abs(dBottom) > 1 ? `translateY(${dBottom}px)` : '';
}
let settle;
const anchorSoon = (ms = 400) => { clearTimeout(settle); settle = setTimeout(anchorBars, ms); };
// While a finger is down or the page is moving, wait; check once it's still
addEventListener('scroll', () => clearTimeout(settle), { passive: true });
addEventListener('touchend', () => {
  clearTimeout(settle);
  const wait = () => { const y = window.scrollY; settle = setTimeout(() => (window.scrollY === y ? anchorBars() : wait()), 250); };
  wait();
}, { passive: true });
window.visualViewport?.addEventListener('resize', () => anchorSoon());
addEventListener('resize', () => anchorSoon());
// A screenshot doesn't always send any event, so also check every couple of
// seconds while the app is on screen (cheap: it only moves bars that are off)
setInterval(() => { if (!document.hidden) anchorBars(); }, 2000);
addEventListener('orientationchange', () => anchorSoon(500));
addEventListener('pageshow', () => anchorSoon(300));
document.addEventListener('visibilitychange', () => { if (!document.hidden) anchorSoon(300); });

startRouter();

// An installed app has no reload button: coming back after 5+ minutes away
// redraws the current screen with fresh data.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) dispatchEvent(new HashChangeEvent('hashchange'));
});

// Service worker: makes the app open instantly and work offline.
// When a new version is published, it installs in the background and the app
// reloads itself once the new version takes over.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Service worker registration failed', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    toast('Updating to the latest version', 1200);
    setTimeout(() => location.reload(), 600);
  });
}
