const CACHE = 'daianalife-v3';
const ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-32.png'
];

// Arquivos que MUDAM (HTML e dados) usam network-first: sempre busca a
// versão mais nova primeiro, e só cai no cache se estiver offline.
// A v1/v2 deste service worker fazia cache-first pra tudo, inclusive
// o index.html — isso fazia o app "travar" numa versão antiga pra
// sempre, mesmo depois de eu subir atualizações no GitHub. Ícones não
// mudam, então esses continuam cache-first (mais rápido, menos dados).
const NETWORK_FIRST = ['index.html', 'messages.json', 'subscription.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const isNetworkFirst = NETWORK_FIRST.some(name => e.request.url.includes(name)) || e.request.mode === 'navigate';

  if(isNetworkFirst){
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});

// PUSH DE VERDADE
// Disparado pelo GitHub Actions (ver .github/workflows/push-reminder.yml),
// que manda uma notificação via protocolo Web Push mesmo com o app
// fechado. Isso é diferente da notificação local que o próprio app
// dispara quando está aberto (ver fireReminder() no index.html).
self.addEventListener('push', (e) => {
  let data = { title: 'Lembrete', body: 'oi, linda. bora beber uma água?' };
  try { if(e.data) data = { ...data, ...e.data.json() }; } catch(err){}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find(c => c.url.includes(self.registration.scope));
      if(existing) return existing.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
