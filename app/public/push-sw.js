// Runs inside the installed app even when Compass is closed. Shows alerts the moment they arrive.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Compass', body: event.data ? event.data.text() : '' }; }
  const urgent = !!d.urgent;
  event.waitUntil(self.registration.showNotification(d.title || 'Compass', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'compass',
    renotify: true,
    requireInteraction: urgent,
    vibrate: urgent ? [600, 200, 600, 200, 600, 200, 600] : [200, 100, 200],
    silent: false,
    data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => undefined); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
