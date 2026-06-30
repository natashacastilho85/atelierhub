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
      // Se o app já está aberto, foca e navega
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if (contratoId) client.navigate(url);
          return;
        }
      }
      // Senão abre nova aba
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Mantém o service worker atualizado imediatamente
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Estratégia network-first para satisfazer critério PWABuilder
self.addEventListener('fetch', function(event) {
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
