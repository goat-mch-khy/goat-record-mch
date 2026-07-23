// GOAT MCH — Service Worker v63
// ⚠️ INCREMENT THIS NUMBER every time you upload a new index.html
const CACHE_VERSION = 'goat-mch-v86';

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
    }).then(function() { return self.skipWaiting(); })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) { return key.startsWith('goat-mch-') && key !== CACHE_VERSION; })
          .map(function(key) { return caches.delete(key); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (url.includes('script.google.com')) return;
  if (url.includes('anthropic.com')) return;
  if (event.request.method !== 'GET') return;

  if (url.includes('.html') || url.endsWith('/') || url.endsWith('/goat-record-mch/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        })
        .catch(function() {
          return caches.match(event.request)
            .then(function(cached) { return cached || caches.match('./index.html'); });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() { return cached; });
      return cached || networkFetch;
    })
  );
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────
// Fires when the device gets internet — even if the app is closed (Android only)
self.addEventListener('sync', function(event) {
  if (event.tag === 'facility-bg-sync') {
    console.log('[SW] Background sync: facility-bg-sync');
    event.waitUntil(doBackgroundFacilitySync());
  }
});

async function doBackgroundFacilitySync() {
  // Read config from localStorage via IndexedDB proxy
  // SW cannot access localStorage directly — we read it via a client message
  // If the app is open, ask it to do the sync
  var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (clients.length > 0) {
    // App is open — ask it to run facilityAutoSync
    clients.forEach(function(client) {
      client.postMessage({ type: 'TRIGGER_FACILITY_SYNC' });
    });
    console.log('[SW] App is open — asked it to sync');
    return;
  }

  // App is closed — do a minimal silent sync ourselves
  // Read EP and user from IndexedDB (where the app stores a copy for SW use)
  try {
    var config = await readSWConfig();
    if (!config || !config.ep || !config.facility) {
      console.log('[SW] No config found — skipping background sync');
      return;
    }

    console.log('[SW] App closed — doing silent sync for', config.facility);
    var added = await swFacilitySync(config.ep, config.facility);
    console.log('[SW] Background sync done: +' + added + ' records');

  } catch(e) {
    console.log('[SW] Background sync error:', e.message);
  }
}

// Read SW config from IndexedDB (written by the app when user logs in)
function readSWConfig() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('goat-mch-sw', 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore('config');
    };
    req.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('config', 'readonly');
      var store = tx.objectStore('config');
      var get = store.get('sw_config');
      get.onsuccess = function() { resolve(get.result); };
      get.onerror = function() { resolve(null); };
    };
    req.onerror = function() { resolve(null); };
  });
}

// Minimal facility sync that runs in SW context (no DOM, no localStorage)
// Fetches patient IDs for the facility, then stores them so the app can
// pull full records next time it opens
async function swFacilitySync(ep, facility) {
  var TIMEOUT = 20000;
  var added = 0;

  async function fetchJSON(url) {
    var ctrl = new AbortController();
    var tid = setTimeout(function() { ctrl.abort(); }, TIMEOUT);
    try {
      var resp = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(tid);
      return resp.json();
    } catch(e) {
      clearTimeout(tid);
      throw e;
    }
  }

  // Fetch list of patient IDs for this facility (last 30 days — minimal)
  var sinceD = new Date(); sinceD.setDate(sinceD.getDate() - 30);
  var sinceStr = sinceD.toISOString().slice(0, 10);

  var url = ep + (ep.includes('?') ? '&' : '?')
    + 'action=getData&sheet=AN'
    + '&hc=' + encodeURIComponent(facility)
    + '&since=' + sinceStr
    + '&_t=' + Date.now();

  var data = await fetchJSON(url);
  if (!data || data.status !== 'ok') return 0;

  // Store the IDs in IndexedDB so the app can pull them when next opened
  var ids = data.data.map(function(r) {
    return (r['National ID'] || '').toString().trim();
  }).filter(Boolean);
  ids = Array.from(new Set(ids));

  if (ids.length > 0) {
    await storePendingIDs(facility, ids);
    added = ids.length;
    // Notify any open clients
    var clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(function(c) {
      c.postMessage({ type: 'BG_SYNC_DONE', added: added, facility: facility });
    });
  }

  return added;
}

// Store pending patient IDs in IndexedDB for app to pick up
function storePendingIDs(facility, ids) {
  return new Promise(function(resolve) {
    var req = indexedDB.open('goat-mch-sw', 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore('config');
    };
    req.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('config', 'readwrite');
      tx.objectStore('config').put({ facility: facility, ids: ids, ts: Date.now() }, 'pending_ids');
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    };
    req.onerror = resolve;
  });
}

// ── MESSAGE ───────────────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'TRIGGER_FACILITY_SYNC') {
    // App asked SW to confirm — reply so app knows SW is alive
    if (event.source) {
      event.source.postMessage({ type: 'SW_ACK' });
    }
  }
});
