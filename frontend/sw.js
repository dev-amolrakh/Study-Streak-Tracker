const CACHE_NAME = "study-streak-cache-v1";
const ASSETS = ["/", "/index.html", "/style.css", "/script.js", "/favicon.ico"];

self.addEventListener("install", (event) => {
  // Attempt to cache assets but don't fail installation if some resources are unavailable
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll will reject on any failed request; instead fetch each and cache successful ones.
      const results = await Promise.allSettled(
        ASSETS.map(async (asset) => {
          try {
            const req = new Request(asset, { cache: "no-cache" });
            const res = await fetch(req);
            if (!res || !res.ok)
              throw new Error(`Fetch failed ${asset} ${res && res.status}`);
            await cache.put(asset, res.clone());
            return { asset, ok: true };
          } catch (e) {
            // ignore individual failures but report them
            return { asset, ok: false, error: String(e) };
          }
        })
      );
      // optional: log failures for debugging
      const failed = results.filter(
        (r) => r.status === "fulfilled" && r.value && r.value.ok === false
      );
      if (failed.length)
        console.warn(
          "SW: some assets failed to cache",
          failed.map((f) => f.value)
        );
    })()
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
