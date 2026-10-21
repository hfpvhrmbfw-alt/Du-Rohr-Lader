// Service Worker: hält die Oberfläche offline verfügbar. Die API (/api/…) geht immer ans Netz.
const VERSION = 'ytd-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'layout.css', 'icons/apple-touch-icon.png', 'icons/icon-192.png',
  'src/main.js', 'src/ui.js', 'src/api.js', 'src/texts.js', 'src/qr.js',
  '/core/model.js', '/core/logic.js',
];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // Netz zuerst, damit Updates sofort ankommen; Cache nur, wenn der Server nicht läuft.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
