// sw.js — Service Worker do Atelier Hub
// Gerencia recebimento de push notifications e cliques nas notificações

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
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
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
