/*
 * Castimofx service worker.
 *
 * It does NOT cache the site, the sign-in or any account data: balances, invoices and payments must always be live,
 * and a cached copy could show old money figures. Its only job is to keep one small offline page, so a dropped
 * connection shows a friendly message instead of the browser's error screen. Everything else goes straight to
 * the network.
 */
const CACHE = 'castimofx-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only page loads are handled. API calls, scripts, images and payments are never touched.
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || new Response('You are offline. Please check your connection and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
