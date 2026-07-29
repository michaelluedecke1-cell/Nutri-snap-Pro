const CACHE_NAME = 'nutrisnap-cache-v16';

// Kritische Ressourcen, die sofort offline verfügbar sein müssen
const PRECACHE_ASSETS = [
  './',
  'index.html',
  'manifest.json'
];

// Externe CDN-Ressourcen, die wir dynamisch mitschreiben und cachen
const EXTERNAL_LIBS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline assets');
        // Wir fügen die lokalen Assets hinzu
        cache.addAll(PRECACHE_ASSETS);
        // Externe CDNs für Offline-Bereitschaft ebenfalls cachen
        EXTERNAL_LIBS.forEach(url => {
          fetch(new Request(url, { mode: 'no-cors' }))
            .then(res => cache.put(url, res))
            .catch(err => console.log('[Service Worker] CDN Cache-Fehler für:', url, err));
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Verhindert Probleme bei POST-Anfragen (wie z.B. API Aufrufen)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Falls im Cache, liefere es sofort aus und update den Cache im Hintergrund (Stale-While-Revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => { /* Offline-Fallback, falls Netzwerk fehlschlägt */ });
        return cachedResponse;
      }

      // Falls nicht im Cache, normal aus dem Web laden
      return fetch(event.request)
        .then((response) => {
          // Nur erfolgreiche Anfragen cachen (ausgenommen Third-Party-APIs)
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Spezielles Offline-Fallback für Navigationen (Seitenaufrufe)
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
    })
  );
});
