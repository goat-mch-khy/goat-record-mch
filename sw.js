// GOAT Record MCH — Service Worker
// Guarantees full offline capability on all devices

const CACHE_NAME = 'goat-mch-v1';
const CACHE_VERSION = '2026-06-01';

// Files to cache on install
const PRECACHE = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// ── INSTALL: cache all core files ──────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Installing GOAT MCH v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Pre-caching app files');
      // Cache each file, but don't fail install if CDN is unavailable
      return Promise.allSettled(
        PRECACHE.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.log('[SW] Could not cache:', url, err);
          });
        })
      );
    }).then(function() {
      // Take control immediately without waiting for old SW to die
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      // Take control of all open pages immediately
      return self.clients.claim();
    })
  );
});

// ── FETCH: serve from cache, fall back to network ──────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Never intercept Apps Script sync requests — always go to network
  if (url.includes('script.google.com')) {
    return; // Let it pass through normally
  }

  // Never intercept POST requests (sync queue)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Serve from cache immediately
        // Also update cache in background (stale-while-revalidate)
        var fetchPromise = fetch(event.request).then(function(networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            var responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(function() {
          // Network failed — cached version is fine
        });
        return cachedResponse;
      }

      // Not in cache — fetch from network and cache it
      return fetch(event.request).then(function(networkResponse) {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        var responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      }).catch(function() {
        // Both cache and network failed
        // Return a simple offline message for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── MESSAGE: force update from app ─────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
