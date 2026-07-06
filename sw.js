const CACHE_NAME = 'pos-pwa-v5';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './db.js',
  './manifest.json',
  './icon.svg',
  // CDN files for offline capability
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/html5-qrcode'
];

// Install Service Worker and cache resources
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all static assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy: Network First, fallback to Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then((networkResponse) => {
      // If response is valid, cache it and return
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          const url = e.request.url;
          if (url.startsWith(self.location.origin) || url.includes('tailwindcss.com') || url.includes('cdnjs.cloudflare.com') || url.includes('unpkg.com')) {
            cache.put(e.request, responseToCache);
          }
        });
      }
      return networkResponse;
    }).catch(() => {
      // If offline, fallback to cache
      return caches.match(e.request);
    })
  );
});
