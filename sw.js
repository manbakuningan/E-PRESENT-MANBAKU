/* ==========================================================================
   E-PRESENT MANBAKU — Service Worker
   Offline-first PWA caching strategy
   ==========================================================================
   - App shell (HTML/CSS/JS local): cache-first, fallback to network
   - CDN libraries (Tailwind, Chart.js, SweetAlert2, etc.): stale-while-revalidate
   - CDN fonts & icons: cache-first
   - Google Apps Script API (script.google.com): network-first, no caching of POST
     (but we transparently fall back to last successful GET cache if offline)
   - Cross-origin images (iili.io, ubuy.co.id, transparenttextures.com): cache at runtime
   ========================================================================== */

const SW_VERSION = 'v1.0.0';
const STATIC_CACHE = `epresent-static-${SW_VERSION}`;
const RUNTIME_CACHE = `epresent-runtime-${SW_VERSION}`;
const CDN_CACHE = `epresent-cdn-${SW_VERSION}`;

/* ---------- App shell: the local files we always pre-cache ---------- */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
  './assets/icons/favicon.ico'
];

/* ---------- CDN assets: pre-cache at install for offline use ---------- */
const CDN_PRECACHE = [
  // Tailwind CSS runtime
  'https://cdn.tailwindcss.com',
  // QR scanners
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  // Charts
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0',
  // XLSX & PDF
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  // SweetAlert2
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  // Font Awesome CSS + webfonts (we cache the CSS; webfonts cached at runtime)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  // Google Fonts CSS
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  // School logo
  'https://iili.io/CAoR6e2.png'
];

/* ---------- Install: pre-cache app shell + CDN libraries ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.addAll(APP_SHELL).catch(err => {
      console.warn('[SW] Some app-shell assets failed to pre-cache:', err);
    });

    const cdnCache = await caches.open(CDN_CACHE);
    // Use Promise.allSettled so one CDN failure doesn't abort install
    await Promise.allSettled(
      CDN_PRECACHE.map(async (url) => {
        try {
          const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (res && (res.ok || res.type === 'opaque' || res.type === 'cors')) {
            await cdnCache.put(url, res.clone());
          }
        } catch (e) {
          console.warn('[SW] CDN pre-cache failed for', url, e.message);
        }
      })
    );

    // Force activate immediately
    await self.skipWaiting();
  })());
});

/* ---------- Activate: clean up old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const validCaches = [STATIC_CACHE, RUNTIME_CACHE, CDN_CACHE];
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !validCaches.includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
    // Tell clients SW has been updated
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }));
  })());
});

/* ---------- Helper: is this a CDN cross-origin request? ---------- */
function isCdnUrl(url) {
  const u = new URL(url);
  return [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'cdn.sheetjs.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'iili.io',
    'images-cdn.ubuy.co.id',
    'www.transparenttextures.com'
  ].includes(u.hostname);
}

function isApiUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'script.google.com' && u.pathname.includes('/macros/s/');
  } catch {
    return false;
  }
}

/* ---------- Helper: is this same-origin navigation? ---------- */
function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

/* ---------- Stale-while-revalidate (for CDN assets) ---------- */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((networkRes) => {
    if (networkRes && (networkRes.ok || networkRes.type === 'opaque' || networkRes.type === 'cors')) {
      cache.put(request, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* ---------- Cache-first (for app shell + fonts/icons) ---------- */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const networkRes = await fetch(request);
    if (networkRes && (networkRes.ok || networkRes.type === 'opaque' || networkRes.type === 'cors')) {
      cache.put(request, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch (e) {
    // Last resort: try to find any matching partial in any cache
    const allCaches = await caches.keys();
    for (const c of allCaches) {
      const cc = await caches.open(c);
      const m = await cc.match(request);
      if (m) return m;
    }
    throw e;
  }
}

/* ---------- Network-first with cache fallback (for navigations) ---------- */
async function networkFirstNavigation(request) {
  try {
    const networkRes = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    if (networkRes && networkRes.ok) {
      cache.put(request, networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch (e) {
    // Offline — serve cached app shell
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request)
      || await cache.match('./index.html')
      || await cache.match('./');
    if (cached) return cached;
    throw e;
  }
}

/* ---------- API: network-only (POST) but allow cached GET to be served ---------- */
async function handleApiRequest(request) {
  // We don't cache API POST requests — they are mutations.
  // Just attempt network; if it fails, return a JSON error the app can handle.
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: 'OFFLINE',
        message: 'Anda sedang offline. Periksa koneksi internet lalu coba lagi.'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/* ---------- Main fetch handler ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET (and navigations); let POST/PUT pass through (except API handling below)
  if (request.method !== 'GET' && !isApiUrl(request.url)) {
    return;
  }

  // Skip chrome-extension & non-http(s) requests
  const url = request.url;
  if (!url.startsWith('http')) return;

  // 1. Google Apps Script API → network (with offline fallback)
  if (isApiUrl(url)) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // 2. Navigation → network-first (so updates are seen) with cache fallback
  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 3. CDN cross-origin assets → stale-while-revalidate
  if (isCdnUrl(url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // 4. Same-origin static assets → cache-first
  if (new URL(url).origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5. Other cross-origin (unknown images, etc.) → runtime cache, network-first
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      throw e;
    }
  })());
});

/* ---------- Message handler: skipWaiting on demand ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
