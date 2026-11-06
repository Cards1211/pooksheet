// Keeps a complete copy of PookSheet on the phone, so it opens with no signal.
// The two placeholders are filled in when the app is published (.github/stamp_sw.py).
const VERSION = '__VERSION__';
const FILES = /*__FILES__*/[];
const CACHE = `pooksheet-${VERSION}`;
const MATCH = { ignoreSearch: true, ignoreVary: true };

// All or nothing: a bad connection can't leave a half-updated app, because a failed
// download just keeps the version already on the phone. The app asks for another try.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('pooksheet-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// The saved copy always answers first, so a weak gym signal never slows the app down.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(request, MATCH);
    if (saved) return saved;
    if (request.mode === 'navigate') {
      const home = await cache.match('./', MATCH);
      if (home) return home;
    }
    return fetch(request);
  })());
});
