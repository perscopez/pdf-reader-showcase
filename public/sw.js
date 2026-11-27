const CACHE_VERSION = 'pdf-reader-v4'
const OFFLINE_URLS = ['/', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  if (request.method === 'GET' && new URL(request.url).origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
  } else {
    // Explicitly pass through non-GET (like POST/PUT) and cross-origin requests
    // to prevent Safari/WebKit bugs where not calling event.respondWith hangs requests.
    event.respondWith(fetch(request))
  }
})
