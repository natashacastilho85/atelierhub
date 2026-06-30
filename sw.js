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
