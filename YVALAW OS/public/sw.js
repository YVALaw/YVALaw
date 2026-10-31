// YVA OS service worker — only for notifications (push + tapping them).
// It does not cache pages, so the app is always the latest version.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'YVA OS', body: event.data ? event.data.text() : '' } }
  const title = data.title || 'YVA OS'
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/os/icons/icon-192.png',
      badge: '/os/icons/badge-96.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    }),
    // App icon badge (iPhone home-screen app / Android / desktop) — the app sets the exact count when opened
    self.navigator && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
  ]))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/'
  const target = new URL('/os' + (path.startsWith('/') ? path : '/' + path), self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin + '/os')) {
        await w.focus()
        if ('navigate' in w) return w.navigate(target).catch(() => self.clients.openWindow(target))
        return
      }
    }
    return self.clients.openWindow(target)
  })())
})
