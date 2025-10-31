const CACHE_NAME = 'study-streak-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  'https://via.placeholder.com/192.png?text=Streak',
  'https://via.placeholder.com/512.png?text=Streak'
];

self.addEventListener('install', (event) => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          // store a copy in the cache for future
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => {
          // if request is navigation, try cached index.html
          if (event.request.mode === 'navigate') return caches.match('/index.html');
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

// Handle push messages: show notifications
self.addEventListener('push', (event) => {
  console.log('[SW] push received', event);
  let data = { title: 'Study Streak Reminder', body: 'Keep your streak going today!', icon: '/icons/icon-192.png' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // ignore
    data = { title: 'Study Streak Reminder', body: event.data ? event.data.text() : 'Keep your streak going today!', icon: '/icons/icon-192.png' };
  }
  const options = {
    body: data.body,
    icon: data.icon || 'https://via.placeholder.com/192.png?text=Streak',
    badge: data.badge || 'https://via.placeholder.com/192.png?text=Streak',
    vibrate: [100, 50, 100],
    tag: data.tag || 'study-streak-reminder',
    data: data.url || '/',
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});
