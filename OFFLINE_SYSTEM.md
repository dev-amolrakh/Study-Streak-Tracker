# Offline-First System Documentation

## Overview

The Study Streak Tracker now features a comprehensive **offline-first architecture** that ensures the app works seamlessly even without an internet connection. All user actions are preserved locally and automatically synchronized when the network becomes available.

---

## 🎯 Features Implemented

### 1. **IndexedDB Local Caching (with LocalStorage Fallback)**

The app uses **IndexedDB** as the primary storage mechanism for offline data persistence, with automatic fallback to **LocalStorage** if IndexedDB is not supported.

#### Object Stores Created:

- **`syncQueue`**: Stores pending API requests for offline sync
- **`goalsCache`**: Stores goal data for offline access
- **`reminders`**: Stores reminder configurations with trigger timestamps
- **`streakActions`**: Stores offline streak marks with automatic deduplication

#### Key Features:

- ✅ Automatic duplicate prevention for streak actions (one mark per day per goal)
- ✅ Automatic fallback to LocalStorage if IndexedDB fails
- ✅ Indexed queries for fast retrieval
- ✅ Transaction-based operations for data consistency

### 2. **Offline Streak Action Queue**

When a user marks today's streak and the device is offline:

1. **Action is stored locally** in IndexedDB `streakActions` store
2. **Duplicate prevention** ensures only one valid streak mark per day per goal
3. **Server date validation** prevents manipulation (when online)
4. **Optimistic UI updates** provide instant feedback
5. **Automatic sync** when network is restored

#### Console Logs for Debugging:

```
[OfflineQueue] Streak action queued for offline sync: { type, goalId, day, ... }
[OfflineQueue] ✓ Streak action synced successfully: <actionId>
[OfflineQueue] ✗ Streak sync failed: <reason>
```

### 3. **Background Sync & Auto-Retry**

The offline queue automatically syncs pending actions when:

- Network connection is restored (`online` event)
- App is loaded and online
- Service Worker background sync event fires

#### Sync Features:

- ✅ Automatic retry with exponential backoff (max 5 retries)
- ✅ Prevents duplicate syncs with in-progress tracking
- ✅ Batch processing of queued actions
- ✅ Detailed console logging for each sync attempt
- ✅ UI toast notifications for sync status

#### Console Logs:

```
[OfflineQueue] Network back online, initiating sync...
[OfflineQueue] ======= Starting full sync =======
[OfflineQueue] Found X pending streak actions
[OfflineQueue] ✓ Streak action synced successfully
[OfflineQueue] ======= Sync complete: X success, Y failed =======
```

### 4. **Persistent Reminders (Works Even When App is Closed)**

Reminders now persist and fire even if:

- The app is closed
- The app is killed from recents
- The device is offline
- The device is in sleep mode (on supported browsers)

#### How It Works:

1. **IndexedDB Storage**: Reminder configuration is saved to IndexedDB with:

   - `goalId`: The goal this reminder belongs to
   - `reminderTime`: Time in HH:MM format (24-hour)
   - `enabled`: Boolean flag
   - `nextTrigger`: Timestamp of next scheduled notification
   - `goalName`: For personalized notification text

2. **Service Worker Background Processing**:

   - Service Worker checks IndexedDB every 60 seconds
   - Compares current time with `nextTrigger` timestamp
   - Fires notification if trigger time has passed
   - Automatically updates next trigger time (next day)

3. **Notification API Integration**:

   - Uses Service Worker `showNotification()` for persistence
   - Notifications include action buttons:
     - **Mark Complete ✅**: Opens app and marks today's streak
     - **Remind in 1 hour ⏰**: Snoozes reminder
   - Requires user interaction to dismiss (`requireInteraction: true`)

4. **Periodic Background Sync** (Chrome/Edge):
   - Registers `periodicSync` for reminder checks (if supported)
   - Provides additional reliability for reminder triggers

#### Console Logs:

```
[ReminderManager] Reminder saved: { goalId, reminderTime, enabled, ... }
[ReminderManager] Starting reminder check loop
[ReminderManager] ⏰ Triggering reminder for goal: "Study Math"
[SW] Checking reminders...
[SW] ⏰ Triggering reminder: "Study Math"
[SW] Reminder updated, next trigger: <date>
```

### 5. **Service Worker Enhancements**

The Service Worker has been enhanced to support offline persistence:

#### New Features:

- **IndexedDB access from Service Worker**: Reads reminder data directly
- **Periodic reminder checks**: Runs every 60 seconds via `setInterval`
- **Background sync handlers**: Responds to `sync` and `periodicsync` events
- **Message passing**: Communicates with main app for sync requests
- **Offline queue sync**: Triggers sync when app is reopened

#### Event Listeners:

```javascript
// Periodic background sync (Chrome/Edge)
self.addEventListener('periodicsync', ...)

// Background sync (all modern browsers)
self.addEventListener('sync', ...)

// Message from main app
self.addEventListener('message', ...)

// Notification click handling
self.addEventListener('notificationclick', ...)
```

---

## 📁 New Files Added

### 1. **`frontend/db-manager.js`**

- IndexedDB abstraction layer
- LocalStorage fallback implementation
- CRUD operations for all stores
- Automatic error handling and retries

### 2. **`frontend/offline-queue.js`**

- Offline action queue manager
- Background sync orchestration
- Retry logic with exponential backoff
- Duplicate prevention for streak actions

### 3. **`frontend/reminder-manager.js`**

- Reminder configuration management
- Next trigger calculation
- Notification API integration
- Service Worker communication

---

## 🔧 Integration Points

### Modified Files:

#### **`frontend/index.html`**

- Added script imports for offline system:

```html
<script src="db-manager.js"></script>
<script src="offline-queue.js"></script>
<script src="reminder-manager.js"></script>
<script src="script.js"></script>
```

#### **`frontend/script.js`**

- Initialization of offline system on page load
- Updated `toggleDay()` to use offline queue
- Updated `saveReminderToServer()` to persist to IndexedDB
- Service Worker message listener for sync requests
- URL action parameter handling (notification click)

#### **`frontend/service-worker.js`**

- IndexedDB helper functions
- Reminder check and trigger logic
- Background sync event handlers
- Periodic check interval (60 seconds)
- Message handlers for app communication

---

## 🚀 How to Test Offline Features

### Test 1: Offline Streak Marking

1. Open DevTools → Network → Check "Offline"
2. Mark today's streak
3. Verify UI updates optimistically
4. Check console for: `[OfflineQueue] Streak action queued`
5. Uncheck "Offline"
6. Wait for sync to complete
7. Verify toast: "Synced X offline action(s)"

### Test 2: Duplicate Prevention

1. Go offline
2. Mark today's streak
3. Try marking again
4. Verify toast: "Day already marked (duplicate prevented)"
5. Check console: `[DBManager] Duplicate entry detected, skipping`

### Test 3: Persistent Reminders (Requires HTTPS or localhost)

1. Set a reminder for 1 minute from now
2. Grant notification permission
3. Save reminder
4. **Close the app completely** (close browser tab)
5. Wait for reminder time
6. Verify notification appears even with app closed
7. Click "Mark Complete" action
8. Verify app opens and marks today

### Test 4: Offline Reminder Persistence

1. Set a reminder
2. Go offline (airplane mode or DevTools)
3. Close and reopen app
4. Wait for reminder time
5. Verify notification still fires offline
6. Check Service Worker console logs

### Test 5: Background Sync

1. Go offline
2. Perform multiple actions (mark streak, claim badge, etc.)
3. Check IndexedDB in DevTools → Application → IndexedDB
4. Verify actions stored in `syncQueue` and `streakActions`
5. Go back online
6. Verify automatic sync
7. Check IndexedDB - queued items should be deleted

---

## 🐛 Debugging Tips

### Check IndexedDB Contents

1. Open DevTools → Application → IndexedDB
2. Expand `StudyStreakTrackerDB`
3. Inspect stores: `syncQueue`, `streakActions`, `reminders`, `goalsCache`

### Monitor Console Logs

All offline operations are logged with prefixes:

- `[DBManager]` - IndexedDB operations
- `[OfflineQueue]` - Queue management and sync
- `[ReminderManager]` - Reminder scheduling
- `[SW]` - Service Worker events
- `[App]` - Main app initialization

### Check Service Worker Status

1. DevTools → Application → Service Workers
2. Verify service worker is "activated and running"
3. Click "Update" to reload service worker
4. Check console for service worker logs

### Force Sync

In DevTools Console:

```javascript
// Trigger sync manually
await offlineQueue.syncAll();

// Check queue status
await offlineQueue.getQueueStatus();

// Check reminders
await reminderManager.getEnabledReminders();
```

---

## ⚠️ Important Notes

### Browser Support

- **IndexedDB**: All modern browsers (Chrome, Firefox, Safari, Edge)
- **Background Sync**: Chrome, Edge, Opera
- **Periodic Background Sync**: Chrome, Edge (limited)
- **Service Worker**: All modern browsers (requires HTTPS or localhost)

### Notification Permissions

- Must request and grant notification permission for reminders
- Reminders will not fire if permission is denied
- Check with: `Notification.permission === 'granted'`

### HTTPS Requirement

- Service Workers require HTTPS in production
- `localhost` works for development
- Reminders and background sync need Service Worker

### Storage Limits

- IndexedDB: ~50MB minimum (varies by browser)
- LocalStorage fallback: ~5-10MB
- Service Worker cache: Separate quota

---

## 📊 Queue Status API

Check offline queue status programmatically:

```javascript
const status = await offlineQueue.getQueueStatus();
console.log(status);
// Output:
// {
//   streakActions: 2,
//   syncActions: 1,
//   total: 3,
//   isOnline: true,
//   isSyncing: false
// }
```

---

## 🔄 Automatic Cleanup

The system automatically:

- Deletes synced actions from IndexedDB
- Prevents queue growth with max retry limits
- Updates reminder next trigger after each notification
- Clears duplicate entries before insertion

---

## 🎉 Benefits

1. **Zero Data Loss**: All user actions preserved offline
2. **Instant Feedback**: Optimistic UI updates
3. **Reliable Reminders**: Work even when app is closed
4. **Duplicate Prevention**: Server-enforced date validation
5. **Automatic Sync**: No manual intervention needed
6. **Progressive Enhancement**: Graceful fallback to LocalStorage
7. **Developer Friendly**: Extensive console logging for debugging

---

## 📝 Future Enhancements

Potential improvements:

- Conflict resolution for concurrent edits
- Offline goal creation and editing
- Bulk sync optimization
- Push notification integration for cross-device reminders
- Sync status indicator in UI
- Manual sync trigger button

---

## 🆘 Troubleshooting

### Reminders not firing when app is closed

- Verify Service Worker is active: DevTools → Application → Service Workers
- Check notification permission: `Notification.permission`
- Ensure reminder is saved to IndexedDB
- Check Service Worker console for errors
- Try registering periodic sync (Chrome/Edge only)

### Offline actions not syncing

- Check network connection
- Verify `online` event listener is working
- Check for errors in console
- Inspect IndexedDB for queued actions
- Try manual sync: `offlineQueue.syncAll()`

### Duplicate streak marks

- Verify date validation is working
- Check IndexedDB for multiple entries with same day/date
- Ensure unique index is created on `goalDayDate`
- Review console logs for constraint errors

---

## 📚 Technical Architecture

```
┌─────────────────────────────────────────────────┐
│                 Main App (script.js)            │
│  - UI interaction                               │
│  - State management                             │
│  - API calls                                    │
└────────┬────────────────────────────────────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────┐                  ┌──────────────────┐
│  DBManager      │                  │ OfflineQueue     │
│  - IndexedDB    │◄─────────────────┤  - Sync queue    │
│  - LocalStorage │                  │  - Retry logic   │
│  - CRUD ops     │                  │  - Deduplication │
└────────┬────────┘                  └────────┬─────────┘
         │                                    │
         │                                    │
         ▼                                    ▼
┌─────────────────┐                  ┌──────────────────┐
│ ReminderManager │                  │  Service Worker  │
│  - Scheduling   │◄─────────────────┤  - Background    │
│  - Notifications│                  │  - Reminders     │
│  - Persistence  │                  │  - Sync events   │
└─────────────────┘                  └──────────────────┘
```

---

**✨ The offline-first system is now fully integrated and ready for production use!**
