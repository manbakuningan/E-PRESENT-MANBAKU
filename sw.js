/* ==========================================================================
   E-PRESENT MANBAKU v4 — Service Worker (offline-first, ringan & cepat)
   ==========================================================================
   Versi aplikasi baru: tanpa scan QR, tanpa kartu pelajar, tanpa absensi
   guru, tanpa pengaturan jam. Absensi siswa manual (Tanggal, NISN, Status).

   Strategi cache (sederhana & terbukti):
   - App shell lokal (HTML/ikon)   : cache-first
   - Navigasi halaman              : network-first (pembaruan terlihat),
                                     fallback ke cache saat offline
   - Library CDN (XLSX & jsPDF,    : stale-while-revalidate saat dipakai
     dimuat malas saja — TIDAK di pre-cache)
   - Google Apps Script API        : selalu network (POST tidak di-cache),
                                     balas JSON error rapi saat offline
   ========================================================================== */

const SW_VERSION = 'v4.0.0';
const STATIC_CACHE = 'epresent-static-' + SW_VERSION;
const CDN_CACHE = 'epresent-cdn-' + SW_VERSION;
const RUNTIME_CACHE = 'epresent-runtime-' + SW_VERSION;

/* App shell: file lokal minimum agar aplikasi terbuka instan saat offline */
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

/* CDN yang dipakai: hanya library ekspor (dimuat malas saat ekspor) */
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.sheetjs.com'
];

/* ---------- Install: pre-cache app shell saja (cepat) ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(APP_SHELL).catch(err => {
      console.warn('[SW] Sebagian app shell gagal di-cache:', err);
    });
    await self.skipWaiting();
  })());
});

/* ---------- Activate: bersihkan semua cache versi lama ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const valid = [STATIC_CACHE, CDN_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => valid.indexOf(k) === -1).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- Helper ---------- */
function isCdnUrl(url) {
  try { return CDN_HOSTS.indexOf(new URL(url).hostname) !== -1; } catch (e) { return false; }
}
function isApiUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'script.google.com' && u.pathname.indexOf('/macros/s/') !== -1;
  } catch (e) { return false; }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque' || res.type === 'cors')) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque' || res.type === 'cors')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request)
      || await cache.match('./index.html')
      || await cache.match('./');
    if (cached) return cached;
    return new Response(
      '<h3 style="font-family:sans-serif">Offline</h3><p style="font-family:sans-serif">Buka kembali aplikasi setelah tersambung ke internet.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* API: network-only — POST tidak pernah di-cache */
async function handleApi(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'OFFLINE', message: 'Anda sedang offline. Periksa koneksi lalu coba lagi.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/* ---------- Fetch utama ---------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    // POST ke API tetap dihandle agar pesan offline rapi
    if (isApiUrl(request.url)) event.respondWith(handleApi(request));
    return;
  }
  if (!request.url || request.url.indexOf('http') !== 0) return;

  if (isApiUrl(request.url)) { event.respondWith(handleApi(request)); return; }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCdnUrl(request.url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  if (new URL(request.url).origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // asal lain (jarang): network-first + cache runtime
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

/* ---------- Pesan: aktifkan SW baru langsung ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
