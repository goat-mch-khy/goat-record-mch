// GOAT MCH v4 — Service Worker
var CACHE = 'goat-mch-v4-r5';
var FILES = [
  './', './index.html', './manifest.json',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.allSettled(FILES.map(function(f){return c.add(f).catch(function(){});}));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  if(e.request.method!=='GET') return;
  if(e.request.url.indexOf('script.google.com')>=0) return;
  if(e.request.url.indexOf('docs.google.com')>=0) return;
  e.respondWith(caches.match(e.request).then(function(cached){
    var net=fetch(e.request).then(function(r){if(r&&r.ok) caches.open(CACHE).then(function(c){c.put(e.request,r.clone());});return r;}).catch(function(){return cached;});
    return cached||net;
  }));
});
self.addEventListener('message', function(e){ if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting(); });
