const CACHE_NAME = "study-streak-cache-v1";
const ASSETS = ["/", "/index.html", "/style.css", "/script.js", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // network-first for API calls, cache-first for static assets
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith("/goals") ||
    url.pathname === "/server-date" ||
    url.pathname.startsWith("/goals/")
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches
      .match(event.request)
      .then(
        (resp) =>
          resp || fetch(event.request).catch(() => caches.match("/index.html"))
      )
  );
});
