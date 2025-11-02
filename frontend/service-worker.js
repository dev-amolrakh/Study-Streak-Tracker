const CACHE_NAME = "study-streak-cache-v3";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/db-manager.js",
  "/offline-queue.js",
  "/reminder-manager.js",
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
  "/icons/screenshot.jpg",
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
      .then(() => {
        console.log("[SW] Activated, checking reminders...");
        return checkAndTriggerReminders();
      })
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

// ===== OFFLINE REMINDER PERSISTENCE =====
// Store reminders data in service worker scope
let registeredReminders = [];

// Helper to open IndexedDB from service worker
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("StudyStreakTrackerDB", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get reminders from IndexedDB
async function getRemindersFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["reminders"], "readonly");
      const store = transaction.objectStore("reminders");
      const request = store.getAll();

      request.onsuccess = () => {
        const reminders = request.result.filter((r) => r.enabled);
        console.log("[SW] Loaded reminders from IndexedDB:", reminders.length);
        resolve(reminders);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("[SW] Error getting reminders from DB:", error);
    return [];
  }
}

// Check and trigger reminders
async function checkAndTriggerReminders() {
  try {
    console.log("[SW] Checking reminders...");
    const reminders = await getRemindersFromDB();
    const now = Date.now();

    for (const reminder of reminders) {
      if (reminder.nextTrigger && now >= reminder.nextTrigger) {
        console.log("[SW] ⏰ Triggering reminder:", reminder.goalName);

        const title = "Time to study! 📚";
        const body = reminder.goalName
          ? `Time to study "${reminder.goalName}"! Keep your streak alive 🔥`
          : "Mark your streak for today! Keep the momentum going 🔥";

        await self.registration.showNotification(title, {
          body: body,
          icon: "/icons/icon-192.svg",
          badge: "/icons/icon-72.svg",
          vibrate: [200, 100, 200, 100, 200],
          tag: `study-streak-reminder-${reminder.goalId}`,
          data: { url: "/", goalId: reminder.goalId },
          requireInteraction: true,
          actions: [
            { action: "mark-complete", title: "Mark Complete ✅" },
            { action: "snooze", title: "Remind in 1 hour ⏰" },
          ],
          silent: false,
          renotify: true,
        });

        // Update next trigger in IndexedDB
        const nextTriggerTime = calculateNextTrigger(reminder.reminderTime);
        reminder.nextTrigger = nextTriggerTime;
        reminder.lastTriggered = now;

        const db = await openDB();
        const transaction = db.transaction(["reminders"], "readwrite");
        const store = transaction.objectStore("reminders");
        store.put(reminder);

        console.log(
          "[SW] Reminder updated, next trigger:",
          new Date(nextTriggerTime).toLocaleString()
        );
      }
    }
  } catch (error) {
    console.error("[SW] Error checking reminders:", error);
  }
}

// Calculate next trigger time
function calculateNextTrigger(reminderTime) {
  if (!reminderTime) return null;

  const now = new Date();
  const [hours, minutes] = reminderTime.split(":").map(Number);

  const nextTrigger = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  // If time has passed, schedule for tomorrow
  if (nextTrigger <= now) {
    nextTrigger.setDate(nextTrigger.getDate() + 1);
  }

  return nextTrigger.getTime();
}

// Periodic background sync for reminders (if supported)
self.addEventListener("periodicsync", (event) => {
  console.log("[SW] Periodic sync event:", event.tag);
  if (event.tag === "check-reminders") {
    event.waitUntil(checkAndTriggerReminders());
  }
});

// Background sync for offline queue
self.addEventListener("sync", (event) => {
  console.log("[SW] Background sync event:", event.tag);

  if (event.tag === "sync-offline-queue") {
    event.waitUntil(syncOfflineQueue());
  }

  if (event.tag === "check-reminders") {
    event.waitUntil(checkAndTriggerReminders());
  }
});

// Sync offline queue when background sync triggers
async function syncOfflineQueue() {
  try {
    console.log("[SW] Syncing offline queue...");

    // Notify all clients to sync
    const allClients = await clients.matchAll({ includeUncontrolled: true });
    for (const client of allClients) {
      client.postMessage({ type: "SYNC_OFFLINE_QUEUE" });
    }

    console.log("[SW] Offline queue sync initiated");
  } catch (error) {
    console.error("[SW] Error syncing offline queue:", error);
  }
}

// Handle messages from main app (including reminder registration)
self.addEventListener("message", (event) => {
  console.log("[SW] Message received:", event.data);

  if (event.data && event.data.type === "REGISTER_REMINDER") {
    const reminderData = event.data.payload;
    console.log("[SW] Reminder registered:", reminderData);

    // Store in memory and start checking
    const existingIndex = registeredReminders.findIndex(
      (r) => r.goalId === reminderData.goalId
    );
    if (existingIndex >= 0) {
      registeredReminders[existingIndex] = reminderData;
    } else {
      registeredReminders.push(reminderData);
    }

    // Start periodic check
    checkAndTriggerReminders();
  }

  if (event.data && event.data.type === "CHECK_REMINDERS_NOW") {
    event.waitUntil(checkAndTriggerReminders());
  }

  if (event.data && event.data.type === "SYNC_NOW") {
    event.waitUntil(syncOfflineQueue());
  }
});

// Check reminders periodically even when app is closed
// Set up interval to check every minute
setInterval(() => {
  checkAndTriggerReminders().catch((err) => {
    console.error("[SW] Error in reminder interval check:", err);
  });
}, 60000); // Check every 60 seconds
