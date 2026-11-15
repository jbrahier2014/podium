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

// iPhone home-screen app with the see-through status bar: iOS reports a window one
// status bar shorter than the screen, which left a band under the tab bar. Size the
// app frame to the real screen height instead (everywhere else, the window's).
function fitFrame() {
  let h = window.innerHeight;
  if (navigator.standalone) {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    if (screenH > h && screenH - h <= 80) h = screenH; // only the status-bar shortfall
  }
  document.documentElement.style.setProperty('--app-h', `${h}px`);
}
fitFrame();
addEventListener('resize', fitFrame);
addEventListener('orientationchange', () => setTimeout(fitFrame, 300));

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
