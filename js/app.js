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
function anchorBars() {
  const vv = window.visualViewport;
  const nav = document.getElementById('navbar');
  const tab = document.getElementById('tabbar');
  if (!vv || !nav || !tab) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const bouncing = window.scrollY < 0 || window.scrollY > max + 1;
  const zoomed = vv.scale && Math.abs(vv.scale - 1) > 0.01;
  if (bouncing || zoomed) return;
  const top = Math.round(vv.offsetTop);
  const bottom = Math.round(vv.offsetTop + vv.height - window.innerHeight);
  nav.style.transform = top ? `translateY(${top}px)` : '';
  tab.style.transform = bottom ? `translateY(${bottom}px)` : '';
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
