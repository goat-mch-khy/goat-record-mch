// GOAT Record MCH — Service Worker
// INCREMENT THIS NUMBER every time you upload a new index.html
const CACHE_VERSION = 'goat-mch-v12';

const CACHE_FILES = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// INSTALL — cache all files
self.addEventListener('install', function(event) {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return Promise.allSettled(
        CACHE_FILES.map(function(url) {
          return cache.add(url).catch(function(e) {
            console.log('[SW] Could not cache:', url, e);
          });
        })
      );
    }).then(function() {
      // Take control immediately
      return self.skipWaiting();
    })
  );
});

// ACTIVATE — delete ALL old caches
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_VERSION;
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// FETCH — network first for HTML, cache first for assets
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Never intercept Apps Script requests
  if (url.includes('script.google.com')) return;

  // Never intercept POST requests
  if (event.request.method !== 'GET') return;

  // For the main HTML page — always try network first
  // so updates are picked up immediately
  if (url.includes('index.html') || url.endsWith('/') || url.endsWith('/goat-record-mch/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Network failed — serve from cache
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // For all other files — cache first, then network
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});

// MESSAGE — force update from app
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
