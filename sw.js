// GOAT MCH — Service Worker
// ⚠️ INCREMENT THIS NUMBER every time you upload a new index.html
const CACHE_VERSION = 'goat-mch-v34';

// Files to cache — app shell only
// localStorage data (mch_pts, mch_an, mch_pn etc.) is NEVER touched by the SW
const CACHE_FILES = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// ── INSTALL ──────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return Promise.allSettled(
        CACHE_FILES.map(function(url) {
          return cache.add(url).catch(function(e) {
            console.log('[SW] Could not pre-cache:', url, e);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────
// ONLY deletes old cache versions — NEVER touches localStorage
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) {
            // Only delete OLD cache versions — never current one
            return key.startsWith('goat-mch-') && key !== CACHE_VERSION;
          })
          .map(function(key) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(function() {
      // Take control of all open pages
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // NEVER intercept — let these go straight to network
  if (url.includes('script.google.com')) return;  // Apps Script sync
  if (url.includes('anthropic.com')) return;       // API calls
  if (event.request.method !== 'GET') return;      // POST requests (sync queue)

  // HTML pages — network first so updates always load
  // Falls back to cache if offline
  if (url.includes('.html') || url.endsWith('/') || url.endsWith('/goat-record-mch/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline — serve cached version
          return caches.match(event.request)
            .then(function(cached) {
              return cached || caches.match('./index.html');
            });
        })
    );
    return;
  }

  // CSS/JS/fonts — cache first, update in background
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() { return cached; });

      return cached || networkFetch;
    })
  );
});

// ── MESSAGE ───────────────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
