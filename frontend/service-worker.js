const CACHE_NAME = "study-streak-cache-v2";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/icons/icon-72.svg",
  "/icons/icon-96.svg",
  "/icons/icon-128.svg",
  "/icons/icon-144.svg",
  "/icons/icon-152.svg",
  "/icons/icon-192.svg",
  "/icons/icon-384.svg",
  "/icons/icon-512.svg",
  "/icons/check-icon.svg",
  "/icons/screenshot.svg",
  "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
];

self.addEventListener("install", (event) => {
  console.log("[SW] install");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] activate");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          // store a copy in the cache for future
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => {
          // if request is navigation, try cached index.html
          if (event.request.mode === "navigate")
            return caches.match("/index.html");
          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        });
    })
  );
});

// Handle push messages: show notifications
self.addEventListener("push", (event) => {
  console.log("[SW] push received", event);
  let data = {
    title: "Time to study! 📚",
    body: "Mark your streak for today! Keep the momentum going 🔥",
    icon: "/icons/icon-192.svg",
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // If JSON parsing fails, try to get text or use defaults
    data = {
      title: "Time to study! 📚",
      body: event.data
        ? event.data.text()
        : "Mark your streak for today! Keep the momentum going 🔥",
      icon: "/icons/icon-192.svg",
    };
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icons/icon-192.svg",
    badge: data.badge || "/icons/icon-72.svg",
    vibrate: [200, 100, 200, 100, 200], // More noticeable vibration pattern
    tag: data.tag || "study-streak-reminder",
    data: data.url || "/",
    requireInteraction: true, // Keep notification visible until user interacts
    actions: [
      {
        action: "mark-complete",
        title: "Mark Complete ✅",
      },
      {
        action: "snooze",
        title: "Remind in 1 hour ⏰",
      },
    ],
    silent: false, // Allow notification sound
    timestamp: Date.now(),
    renotify: true, // Allow re-notification with same tag
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle messages from the main app
self.addEventListener("message", (event) => {
  console.log("[SW] Message received:", event.data);

  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    const { title, body, icon, actions } = event.data.payload;
    self.registration.showNotification(title || "Study Streak Tracker", {
      body: body || "Time to study!",
      icon: icon || "/icons/icon-192.svg",
      badge: "/icons/icon-72.svg",
      vibrate: [200, 100, 200],
      tag: "study-streak-manual",
      requireInteraction: true,
      actions: actions || [],
    });
  }

  // Respond to the client
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({ success: true });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Handle notification action buttons
  if (event.action === "mark-complete") {
    // Send message to app to mark today as complete
    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windowClients) => {
          // Try to send message to existing window first
          if (windowClients.length > 0) {
            windowClients[0].postMessage({ action: "mark-today-complete" });
            return windowClients[0].focus();
          } else {
            // Open app with action parameter
            return clients.openWindow("/?action=mark-today");
          }
        })
    );
    return;
  }

  if (event.action === "snooze") {
    // Schedule another notification in 1 hour
    const oneHour = 60 * 60 * 1000;
    setTimeout(() => {
      self.registration.showNotification("Study reminder (snoozed) 📚", {
        body: "Time to complete your study streak! ⏰",
        icon: "/icons/icon-192.svg",
        badge: "/icons/icon-72.svg",
        vibrate: [200, 100, 200],
        tag: "study-streak-reminder-snooze",
        data: "/",
        requireInteraction: true,
      });
    }, oneHour);
    return;
  }

  // Default action: open app
  const urlToOpen = event.notification.data || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Check if app is already open
        for (let client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        // Open new window if not found
        if (clients.openWindow) return clients.openWindow(urlToOpen);
      })
  );
});
