// Smart Mirror Service Worker — smart-mirror-v1
// Strategies:
//   • App shell / static assets  → Cache-First
//   • API calls (/api/*)         → Network-First (fall back to cache)

const CACHE_NAME = 'smart-mirror-v1';

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
  } else {
    // ── Cache-First for static assets (JS, CSS, fonts, images, HTML) ──
    event.respondWith(cacheFirst(request));
  }
});

// ─── Strategy helpers ────────────────────────────────────────────────────────

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
