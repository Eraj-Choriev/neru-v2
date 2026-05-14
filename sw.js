// NŪR — Service Worker
// Strategy:
//  - App shell (HTML/CSS/JS/logo): cache-first, updated in background
//  - Map tiles + API: network-first (always fresh when online)
//  - Everything else: network-first with cache fallback

const CACHE = 'nur-shell-v2';
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
  '/js/calculator.js',
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

  // App shell: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Cross-origin (fonts, leaflet CDN): network, fall back to cache
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
