// GOAT MCH v2 — Service Worker
const CACHE = 'goat-mch-v2-r1';
const CACHE_FILES = [
  './', './index.html',
  './js/schema.js', './js/db.js', './js/sync.js', './js/crypto.js',
  './js/ui.js',
  './forms/an.js', './forms/pn.js', './forms/fp.js', './forms/rpt.js',
  './views/dashboard.js', './views/appointments.js', './views/patients.js', './views/search.js',
  './style/app.css',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(CACHE_FILES.map(f => c.add(f).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('goat-mch-') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('script.google.com')) return;
  if (e.request.method !== 'GET') return;

  // Network-first for HTML
  if (url.includes('.html') || url.endsWith('/') || url.includes('/goat-record-mch/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(r => { if (r?.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request)
        .then(r => { if (r?.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => cached);
      return cached || net;
    })
  );
});

// Background sync
self.addEventListener('sync', e => {
  if (e.tag === 'facility-bg-sync') e.waitUntil(bgSync());
});

async function bgSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length > 0) {
    clients.forEach(c => c.postMessage({ type: 'TRIGGER_FACILITY_SYNC' }));
    return;
  }
  // App closed — minimal sync: store pending IDs in IDB for app to pick up on next open
  try {
    const config = await idbGet('sw_config');
    if (!config?.ep || !config?.facility) return;
    const url  = `${config.ep}?action=getData&sheet=AN&hc=${encodeURIComponent(config.facility)}&since=${daysAgo(30)}&_t=${Date.now()}`;
    const resp = await fetch(url, { mode: 'cors', cache: 'no-store' });
    const data = await resp.json();
    if (data?.status === 'ok') {
      const ids = [...new Set((data.data || []).map(r => (r['National ID'] || '').trim()).filter(Boolean))];
      if (ids.length) await idbSet('pending_ids', { facility: config.facility, ids, ts: Date.now() });
    }
  } catch (e) {}
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}

function idbGet(key) {
  return new Promise(res => {
    const req = indexedDB.open('goat-mch-data', 2);
    req.onupgradeneeded = e => { try { e.target.result.createObjectStore('config'); } catch {} };
    req.onsuccess = e => {
      const r = e.target.result.transaction('config', 'readonly').objectStore('config').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror   = () => res(null);
    };
    req.onerror = () => res(null);
  });
}

function idbSet(key, val) {
  return new Promise(res => {
    const req = indexedDB.open('goat-mch-data', 2);
    req.onupgradeneeded = e => { try { e.target.result.createObjectStore('config'); } catch {} };
    req.onsuccess = e => {
      const tx = e.target.result.transaction('config', 'readwrite');
      tx.objectStore('config').put(val, key);
      tx.oncomplete = res; tx.onerror = res;
    };
    req.onerror = res;
  });
}

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
