// Service worker — offline support and fast startup.
//
// - App files (this site): served from this version's saved copy, so the installed app
//   opens instantly, even offline. Publishing bumps VERSION; the new worker installs in
//   the background and the app reloads into it (js/app.js).
// - Nightly data (data/*.json): network first with a short timeout, then the saved copy.
// - Team logos (ESPN / MLB image hosts): cache first — they almost never change.
// - Live data APIs: not touched here; js/store/cache.js handles those in IndexedDB.

const VERSION = 'v20261026-104515';
const SHELL = `podium-shell-${VERSION}`;
const IMAGES = 'podium-images-v1';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'assets/fonts/inter-latin.woff2',
  'assets/fonts/space-grotesk-latin.woff2',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon.svg',
  'vendor/chart.umd.min.js',
  'js/app.js',
  'js/router.js',
  'js/leagues.js',
  'js/util/dom.js',
  'js/util/time.js',
  'js/util/poller.js',
  'js/ui/format.js',
  'js/ui/brand.js',
  'js/ui/icons.js',
  'js/ui/components.js',
  'js/ui/install.js',
  'js/store/settings.js',
  'js/store/cache.js',
  'js/data/index.js',
  'js/data/glossary.js',
  'js/data/statdefs.js',
  'js/data/mlb-colors.js',
  'js/data/providers/espn.js',
  'js/data/providers/mlb.js',
  'js/views/common.js',
  'js/views/home.js',
  'js/views/scores.js',
  'js/views/ratings.js',
  'js/views/explore.js',
  'js/views/game-ep.js',
  'js/data/ep.js',
  'js/data/polls.js',
  'js/views/polls.js',
  'js/views/more.js',
  'js/views/glossary.js',
  'js/views/settings.js',
  'js/views/sources.js',
  'js/views/team.js',
  'js/views/game.js',
  'js/views/standings.js',
];

const IMAGE_HOSTS = ['a.espncdn.com', 'www.mlbstatic.com', 'midfield.mlbstatic.com'];

// Each version's files are fetched with ?v=<version> so GitHub Pages' 10-minute CDN
// cache can't hand back the previous version's copy; they're stored under the plain path.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(PRECACHE.map(async (u) => {
        const res = await fetch(`${u}${u.includes('?') ? '&' : '?'}v=${VERSION}`, { cache: 'reload' });
        if (!res.ok) throw new Error(`${u}: ${res.status}`);
        await c.put(new URL(u, self.location).href, res);
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('podium-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () => caches.match(request, { ignoreSearch: request.mode === 'navigate' })
      .then((r) => r || (request.mode === 'navigate' ? caches.match('index.html') : undefined));

    const timer = setTimeout(async () => {
      const cached = await fromCache();
      if (cached && !settled) { settled = true; resolve(cached); }
    }, timeoutMs);

    fetch(new Request(request, { cache: 'no-cache' })).then((res) => {
      clearTimeout(timer);
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve((await fromCache()) || new Response('Offline', { status: 503, statusText: 'Offline' }));
    });
  });
}

async function shellFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = request.mode === 'navigate'
    ? (await cache.match(new URL('index.html', self.location).href)) || (await cache.match(new URL('./', self.location).href))
    : await cache.match(request, { ignoreSearch: true });
  return hit || networkFirst(request);
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // App files open instantly from this version's saved copy (a new version arrives as
    // a new service worker, and the app reloads into it). Nightly data stays network first.
    const isData = url.pathname.includes('/data/');
    event.respondWith(isData ? networkFirst(request) : shellFirst(request));
  } else if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirstImage(request));
  }
  // Everything else (live data APIs) goes straight to the network.
});
