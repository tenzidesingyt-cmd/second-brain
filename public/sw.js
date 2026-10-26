const VERSION = 'brain-v2'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

function isCacheableAsset(url) {
  return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest'
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put('/', response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const cached = (await cache.match('/')) || (await cache.match(request))
    if (cached) return cached
    return new Response(
      '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Нет соединения</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f1e8;color:#26241f;font-family:system-ui,sans-serif"><div style="text-align:center;padding:24px"><div style="font-size:40px;margin-bottom:12px">◌</div><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Нет соединения</h1><p style="margin:0;color:#6b675e">Второй мозг откроется, когда вернётся сеть.</p></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirstAsset(request))
  }
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'Второй мозг'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'brain-reminder',
      renotify: true,
      data: { url: data.url || '/inbox' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/inbox', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(target)
            } catch {
              // focus is enough when navigation is not allowed
            }
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
