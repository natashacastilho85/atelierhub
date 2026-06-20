// Atelier Hub — Service Worker
const CACHE_NAME = 'atelier-hub-v1';

// Instala o SW sem cache agressivo (app depende de dados online)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: network first, sem cache de dados
self.addEventListener('fetch', (event) => {
  // Ignora requisições do Supabase e APIs externas
  if (
    event.request.url.includes('supabase.co') ||
    event.request.url.includes('googleapis') ||
    event.request.url.includes('anthropic')
  ) {
    return;
  }

  // Para o index.html: sempre busca da rede, fallback para cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Ícones e assets estáticos: cache first
  if (
    event.request.url.includes('.png') ||
    event.request.url.includes('.jpg') ||
    event.request.url.includes('.svg') ||
    event.request.url.includes('.ico')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        });
      })
    );
  }
});
