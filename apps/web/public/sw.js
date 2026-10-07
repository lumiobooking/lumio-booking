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
const CACHE = 'lumio-cache-v10'; // v10: app-icon badge count (see Web Push below)

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== BADGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // The open app says how many things are really unread (lib/app-badge.ts).
  if (event.data && event.data.type === 'BADGE') event.waitUntil(setBadge(Number(event.data.count) || 0));
});

// ---- The red number on the app icon --------------------------------------
// Kept in its own cache (a worker has no lasting memory): each push adds one,
// the open app resets it to the real unread count. iOS 16.4+ home-screen apps
// and Chrome/Edge support it; elsewhere this is a no-op.
const BADGE_CACHE = 'lumio-badge';
const BADGE_KEY = '/__lumio_badge__';
async function readBadge() {
  try { const c = await caches.open(BADGE_CACHE); const r = await c.match(BADGE_KEY); return r ? (Number(await r.text()) || 0) : 0; } catch (e) { return 0; }
}
async function setBadge(n) {
  try { const c = await caches.open(BADGE_CACHE); await c.put(BADGE_KEY, new Response(String(n))); } catch (e) { /* storage refused */ }
  try {
    if (n > 0 && self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
    else if (self.navigator && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (e) { /* not supported */ }
}

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

  // Only this site's own files. The worker used to sit in front of EVERY
  // GET — the API on another origin included — which added a hop to each
  // call and copied private JSON (bookings, customers) into Cache Storage
  // on the device. API traffic now goes straight to the network.
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // Next's hashed build files never change under their name: cache-first,
  // so a repeat visit paints from disk.
  // ---- only a GOOD response is ever kept ----
  // This used to cache whatever came back. During a deploy the old server
  // answers 404/502 for a chunk for a few seconds; that answer was stored
  // under the chunk's name, and because the NEW build often keeps the same
  // name for an unchanged file (the name is a content hash), every later
  // load of that chunk was served the cached failure — the "Lumio was just
  // updated" screen that a reload could not clear, until the cache version
  // was bumped. A failure is never cached now, in either branch.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then((hit) => (hit && hit.ok ? hit : fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))),
    );
    return;
  }

  // Other GETs (JS/CSS/images): network-first, fall back to cache offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});

// ---- Web Push: show the notification, and focus/open the app on tap ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Lumio';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // The sender decides what replaces what: bookings and inbox messages are
    // different queues and should not overwrite each other on a lock screen.
    tag: data.tag || 'lumio-booking',
    renotify: true,
    data: { url: data.url || '/salon/activity' },
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    readBadge().then((n) => setBadge(n + 1)),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/salon/activity';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { try { c.navigate(url); } catch (e) {} return c.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
