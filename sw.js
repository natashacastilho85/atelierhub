// sw.js — Service Worker do Atelier Hub
// Gerencia recebimento de push notifications e cliques nas notificações

const ICON_AHR = 'data:image/png;base64,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';

self.addEventListener('push', function(event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Atelier Hub', body: event.data.text() };
  }

  const title   = data.title || 'Atelier Hub';
  const options = {
    body:    data.body || '',
    icon:    ICON_AHR,
    badge:   ICON_AHR,
    tag:     data.tag || 'atelierhub',
    data:    { contratoId: data.contratoId || null },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const contratoId = event.notification.data && event.notification.data.contratoId;
  const base = self.registration.scope;
  const url  = contratoId ? `${base}?contrato=${contratoId}` : base;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if (contratoId) client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', function(event) {
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
