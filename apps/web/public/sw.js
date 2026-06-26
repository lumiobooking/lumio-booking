/* Lumio Booking service worker — installable PWA + auto-updating cache.
 *
 * Strategy:
 *  - Navigations (HTML pages): NETWORK-ONLY, falling back to cache only when
 *    truly offline. This guarantees a fresh app shell after every deploy.
 *  - Static assets (_next, images, icons): network-first, cached for offline.
 *  - skipWaiting + clients.claim so a new version takes over immediately, and
 *    old caches are purged on activate.
 *
 * Bump CACHE on every meaningful change to force old caches out. */
const CACHE = 'lumio-cache-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Page navigations: always fetch fresh HTML so updates show up immediately.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Other GETs (JS/CSS/images): network-first, fall back to cache offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
