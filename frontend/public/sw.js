// Smart Mirror Service Worker — smart-mirror-v2
// Strategies:
//   • HTML / navigations         → Network-First (cache is offline fallback)
//   • Hashed static assets       → Cache-First
//   • API calls (/api/*)         → Network-First (fall back to cache)
//
// HTML must NOT be cache-first. index.html is the one file whose name never
// changes, and it is what points at the content-hashed bundle. Served from
// cache it pins the app to whichever build was installed first: an update
// would rebuild, restart and report success while every reload kept handing
// back the old shell and the old bundle it referenced. Only a hard reload
// (which bypasses the worker entirely) appeared to fix it, which made the
// staleness look intermittent rather than permanent.
//
// Bumping CACHE_NAME is load-bearing on top of that fix: `activate` deletes
// every cache whose key differs, so the rename is what evicts the v1 entry
// still holding a stale index.html on machines that already installed it.
const CACHE_NAME = 'smart-mirror-v2';

// Resources to pre-cache on install (app shell)
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests; let cross-origin pass through
  if (url.origin !== self.location.origin) return;

  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (request.method !== 'GET') return;

  // Skip socket.io — never cache WebSocket upgrade requests
  if (url.pathname.startsWith('/socket.io')) return;

  if (url.pathname.startsWith('/api/')) {
    // ── Network-First for API calls ──
    event.respondWith(networkFirst(request));
  } else if (isHtml(request, url)) {
    // ── Network-First for the app shell, so an update is picked up ──
    event.respondWith(networkFirst(request));
  } else {
    // ── Cache-First for static assets (JS, CSS, fonts, images) ──
    // Safe precisely because these filenames carry a content hash: a new
    // build produces new names, so a cached entry can never be stale.
    event.respondWith(cacheFirst(request));
  }
});

// ─── Strategy helpers ────────────────────────────────────────────────────────

/**
 * Navigations and any bare/extensionless path -- i.e. whatever resolves to
 * index.html. Checked by request mode first, since that is what a reload of
 * the kiosk actually sends.
 */
function isHtml(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // Cache a clone of the successful response for offline fallback
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network failed — try cache
    const cached = await cache.match(request);
    if (cached) return cached;
    // A navigation now comes through here too, and must not be answered with
    // a JSON body the browser would render as text. Fall back to the shell.
    if (request.mode === 'navigate') {
      const index = await cache.match('/');
      if (index) return index;
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
    // Nothing in cache either — return a minimal offline JSON response
    return new Response(JSON.stringify({ offline: true, error: 'You are offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // For navigation requests fall back to the cached index
    if (request.mode === 'navigate') {
      const index = await cache.match('/');
      if (index) return index;
    }
    return new Response('Offline', { status: 503 });
  }
}
