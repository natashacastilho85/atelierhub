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
    icon:    '/icon-notific.png',
    badge:   '/icon-notific.png',
    tag:     data.tag || 'atelierhub',
    data:    { contratoId: data.contratoId || null, tag: data.tag || null },
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
  const tag = (event.notification.data && event.notification.data.tag) || '';
  // Casamento e lembrete de saldo têm mensagem pronta pra cliente — abrem o botão de WhatsApp.
  // Qualquer outro tipo de aviso (produção, buquê, etc.) continua abrindo o contrato, como sempre.
  const ehCasamento = tag.startsWith('casamento-');
  const ehSaldo = tag.startsWith('reserva-') || tag.startsWith('entregaprazo-');
  const base = self.registration.scope;
  let url;
  if (contratoId && (ehCasamento || ehSaldo)) {
    url = `${base}?wa=${contratoId}&waTipo=${ehCasamento ? 'casamento' : 'saldo'}`;
  } else if (contratoId) {
    url = `${base}?contrato=${contratoId}`;
  } else {
    url = base;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(list) {
        for (const client of list) {
          if ('focus' in client) {
            client.focus();
            if (contratoId) return client.navigate(url);
            return;
          }
        }
        return clients.openWindow(url);
      })
      .catch(function() {
        // Se qualquer parte acima falhar (matchAll, focus, navigate — há restrições conhecidas
        // de navigate() dentro de TWA), garante que ao menos uma janela nova abre. Nunca pode
        // ficar em silêncio total, sem nada acontecer quando a pessoa toca na notificação.
        return clients.openWindow(url);
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
