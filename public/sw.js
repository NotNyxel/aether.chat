// aether.chat service worker: shows push notifications for DMs and mentions (web app only),
// and opens or focuses the app at that message when you tap one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'aether.chat', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // Already looking at the app? It plays its own sound and badge, so skip the banner.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return;
      await self.registration.showNotification(data.title || 'aether.chat', {
        body: data.body || '',
        tag: data.tag,
        renotify: true,
        icon: '/icon-256.png',
        badge: '/icon-256.png',
        data: data.data || {},
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const hash = d.scopeId ? `#goto=${d.serverId || ''}:${d.scopeId}:${d.messageId || ''}` : '';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: 'aether-goto', ...d });
        return;
      }
      await self.clients.openWindow(`/${hash}`);
    })(),
  );
});
