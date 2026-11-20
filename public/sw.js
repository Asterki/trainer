/*
 * Trainer service worker.
 *
 * Owns the offline-first cache so the app shell boots with no network at all.
 * It is intentionally dependency-free and versioned by BUILD_ID.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'trainer-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${BUILD_ID}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD_ID}`;

/** Core files that make the app bootable offline. */
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/trainer-192.png',
  '/icons/trainer-512.png',
];

/**
 * Reads the built `index.html` and caches every asset it references. Vite
 * hashes asset filenames, so this is the only reliable way to precache the
 * JavaScript and CSS of the current build on a first visit.
 */
async function precacheBuildAssets() {
  try {
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) return;

    const html = await response.clone().text();
    const shell = await caches.open(SHELL_CACHE);
    await shell.put('/index.html', response.clone());

    const urls = new Set();
    const pattern = /(?:src|href)="(\/[^"?#]+)"/g;
    let match = pattern.exec(html);
    while (match) {
      urls.add(match[1]);
      match = pattern.exec(html);
    }

    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all([...urls].map((url) => runtime.add(url).catch(() => undefined)));
  } catch {
    // Offline or a cold build — the runtime cache will fill in on the next visit.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Remove only this app's caches: current and previous Trainer builds plus
      // the legacy Tasker names. Other caches on the origin are left alone.
      await Promise.all(
        keys
          .filter(
            (key) =>
              key !== SHELL_CACHE &&
              key !== RUNTIME_CACHE &&
              (key.startsWith(CACHE_PREFIX) || key.startsWith('tasker-')),
          )
          .map((key) => caches.delete(key)),
      );
      await precacheBuildAssets();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so updates land, falling back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(
          async () =>
            (await caches.match('/index.html', { ignoreVary: true })) ??
            (await caches.match('/', { ignoreVary: true })) ??
            Response.error(),
        ),
    );
    return;
  }

  // Everything else: cache-first with a background refresh.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
