// Offline support. Every file the app needs is cached on install, so it opens
// in a gym basement with no signal. Requests are answered from the cache
// straight away and refreshed in the background, so a new version shows up on
// the launch after it is published.
//
// Bump VERSION whenever the file list changes.

const VERSION = 'workouts-v2'
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'store.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // Any page load is the app shell; there is only one page.
      const key = req.mode === 'navigate' ? './' : req
      const hit = await cache.match(key, { ignoreSearch: true })
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone())
          return res
        })
        .catch(() => hit)
      if (hit) {
        e.waitUntil(fresh)
        return hit
      }
      return fresh
    }),
  )
})
