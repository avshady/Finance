// WealthWise service worker — hand-written, no dependencies.
//
// Strategy (see docs/ARCHITECTURE.md §4):
//   1. App shell (the pages/assets below) is precached on install, under a
//      versioned cache name, so the app boots offline.
//   2. Static assets (scripts, styles, fonts, images) use stale-while-revalidate:
//      serve from cache instantly, refresh in the background.
//   3. Anything under /api/ is network-only and is NEVER written to any cache.
//      This is financial data — a stale balance or transaction list served from
//      disk cache is worse than a network error.
//   4. Navigations that fail offline fall back to the cached app shell so the
//      client-side router can still render (client-side routes, offline banner).
//   5. `activate` deletes every cache that isn't the current version.

// The build id from the registration URL (`/sw.js?v=...`). A worker's self.location
// includes the query string it was registered with, so each deploy gets its own cache
// namespace without needing a build step to rewrite this file. Falls back to a constant
// when registered without one, which keeps the worker usable if opened directly.
const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_VERSION = `wealthwise-${BUILD_ID}`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Minimal app shell. Kept small and stable so precache never fails on a
// missing/renamed route owned by another part of the app.
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `cache: 'reload'` so the precache is fetched from the network rather than from
      // the HTTP cache or the outgoing worker. Precaching a stale copy of the shell is
      // the exact failure this versioning is meant to end.
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('wealthwise-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// Stale-while-revalidate: return cache immediately if present, and always
// refresh the cache from the network in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkFetch) || Response.error();
}

// Web Share Target (see public/manifest.webmanifest `share_target`): the OS share
// sheet issues a real navigation POST with multipart/form-data straight to
// `/share`. A Next.js page can only ever respond to GET, so the service worker
// intercepts that one POST, pulls the shared text out of the form data, and
// redirects to the same page as a GET with `?text=...` — the page itself (and the
// pipeline it calls) doesn't need to know whether the text arrived this way or
// was typed into `?text=` directly, which is why /share supports both.
function isShareTargetPost(request, url) {
  return request.method === 'POST' && url.pathname === '/share';
}

async function handleShareTarget(request) {
  const target = new URL('/share', self.location.origin);
  try {
    const formData = await request.formData();
    const text = formData.get('text') || formData.get('url') || formData.get('title') || '';
    if (text) target.searchParams.set('text', String(text));
  } catch {
    // Malformed share payload — fall through to a bare redirect; the /share page
    // shows its own "nothing to parse" state for an empty `text`.
  }
  return Response.redirect(target.toString(), 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && isShareTargetPost(request, url)) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  // Only handle same-origin GET requests; let everything else pass through.
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  // Financial API responses: always hit the network, never touch any cache.
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Page navigations: try the network first, fall back to the cached shell
  // when offline so the SPA router can still render.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || Response.error();
      })
    );
    return;
  }

  // Everything else (scripts, styles, fonts, images): stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});
