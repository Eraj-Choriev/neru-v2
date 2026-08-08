// NŪR — Service Worker
// Strategy:
//  - HTML / CSS / JS: network-first with cache fallback. Because these files
//    are NOT fingerprinted (plain /css/style.css, /js/app.js), a cache-first
//    strategy could serve a stale stylesheet against fresh HTML — which broke
//    the layout on returning mobile clients. Network-first keeps the shell in
//    lockstep online, and still works offline via the cache fallback.
//  - Images / fonts: cache-first (effectively immutable).
//  - Map tiles + API + analytics: never cached, always straight to network.

const CACHE = 'nur-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/i18n.js',
  '/js/api.js',
  '/js/geolocation.js',
  '/js/finder.js',
  '/js/map.js',
  '/js/ui.js',
  '/js/notifications.js',
  '/js/router.js',
  '/js/pwa.js',
  '/js/app.js',
  '/logo.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't cache API / analytics / tiles — always network
  const networkOnly =
    url.hostname.includes('parking.dc.tj') ||
    url.hostname.includes('corsproxy.io') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('router.project-osrm.org') ||
    url.hostname.includes('cloudflareinsights.com') ||
    url.hostname.includes('basemaps.cartocdn.com');

  if (networkOnly) return;

  const cacheable = (res) =>
    res && res.status === 200 && (res.type === 'basic' || res.type === 'cors');

  // Images / fonts are effectively immutable → cache-first
  if (/\.(png|jpe?g|svg|webp|ico|gif|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // HTML / CSS / JS (and font CSS): network-first, cache fallback offline.
  // Guarantees online users always get matching, current shell files.
  event.respondWith(
    fetch(req).then((res) => {
      if (cacheable(res)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
