// Fonctionnement hors ligne : on répond depuis le cache, puis on le met à jour en arrière-plan
// Les fichiers de lecture des photos (vendor/tesseract, ~11 Mo) ne sont pas préchargés :
// ils entrent dans le cache au premier scan, puis marchent hors ligne.
const CACHE = 'loto-v23';
const FICHIERS = [
  './', 'index.html', 'styles.css', 'app.js', 'scan.js', 'multi.js', 'manifest.webmanifest', 'icon.svg',
  'fonts/alfa-slab-one.woff2', 'fonts/atkinson-400.woff2', 'fonts/atkinson-700.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles =>
    Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const enCache = await cache.match(e.request, { ignoreSearch: true });
    const reseau = fetch(e.request)
      .then(rep => { if (rep.ok) cache.put(e.request, rep.clone()); return rep; })
      .catch(() => enCache);
    return enCache || reseau;
  }));
});
