# 🧪 Testing Guide for Offline-First System

## Prerequisites

Before testing, ensure you have:
1. ✅ Modern browser (Chrome, Firefox, or Edge recommended)
2. ✅ HTTPS or localhost (Service Workers require secure context)
3. ✅ Notification permissions enabled
4. ✅ Browser DevTools open (F12)

---

## Quick Start - Local Server Setup

### Option 1: Using Python (Recommended)

```powershell
# Navigate to frontend directory
cd "D:\Study Tracker App\study-streak-tracker\frontend"

# Python 3 (if installed)
python -m http.server 8080

# OR Python 2
python -m SimpleHTTPServer 8080
```

### Option 2: Using Node.js http-server

```powershell
# Install http-server globally (one-time)
npm install -g http-server

# Navigate to frontend directory
cd "D:\Study Tracker App\study-streak-tracker\frontend"

# Start server
http-server -p 8080 --cors
```

### Option 3: Using Live Server (VS Code Extension)

1. Install "Live Server" extension in VS Code
2. Right-click on `test-offline.html`
3. Select "Open with Live Server"

---

## 📋 Testing Steps

### Step 1: Start the Test Page

1. **Start local server** (use one of the options above)
2. **Open browser** and navigate to:
   ```
   http://localhost:8080/test-offline.html
   ```
3. **Open DevTools** (Press F12)
4. **Go to Console tab** to see logs

---

### Step 2: Test Service Worker Registration

#### What to do:
1. Click **"Check Service Worker"** button
2. Wait for result

#### Expected Results:
- ✅ Green success message: "✓ Service Worker active"
- ✅ Console shows: `[App] ✓ Service Worker registered`
- ✅ DevTools → Application → Service Workers shows "activated and running"

#### If it fails:
- ❌ Check if you're using http://localhost (not file://)
- ❌ Clear browser cache (Ctrl+Shift+Delete)
- ❌ Click "Force Update SW" button
- ❌ Check Console for errors

---

### Step 3: Test IndexedDB

#### What to do:
1. Click **"Check IndexedDB"** button
2. Verify stores are created

#### Expected Results:
- ✅ "✓ IndexedDB supported" message
- ✅ Shows 4 stores: syncQueue, streakActions, reminders, goalsCache
- ✅ Each store shows "0 items" (initially)

#### Verify in DevTools:
1. Go to **Application** tab
2. Expand **IndexedDB**
3. Look for **StudyStreakTrackerDB**
4. Verify 4 object stores exist

#### If it fails:
- ❌ Browser might not support IndexedDB (very rare)
- ❌ System will fallback to LocalStorage automatically
- ❌ Check Console for error messages

---

### Step 4: Test Notification Permission

#### What to do:
1. Click **"Check Permission"** button
2. If "default", click **"Request Permission"**
3. **Grant permission** in browser popup
4. Click **"Test Notification"** button

#### Expected Results:
- ✅ Permission status shows "granted"
- ✅ Test notification appears on screen
- ✅ Notification shows icon and message

#### If it fails:
- ❌ Check if notifications are blocked in browser settings
- ❌ Chrome: Settings → Privacy and security → Site Settings → Notifications
- ❌ Try in incognito/private mode
- ❌ Some browsers block notifications on localhost (use 127.0.0.1 instead)

---

### Step 5: Test Reminder System (CRITICAL TEST)

#### Test A: Check Active Reminders

1. Click **"Check Active Reminders"**
2. Initially should show "0 reminder(s) found"

#### Test B: Set 1-Minute Test Reminder

1. Click **"Test Reminder (1 min)"** button
2. Wait for success message
3. Click **"Check Active Reminders"** again
4. Verify reminder is stored with correct time

#### Expected Results:
- ✅ Success message: "✓ Reminder set for HH:MM"
- ✅ Shows reminder details:
  - Goal: Test Goal
  - Time: HH:MM (1 minute from now)
  - Enabled: Yes
  - Next Trigger: (timestamp)

#### Test C: Wait for Notification

1. **Wait 1 minute** (don't close the page)
2. Notification should appear automatically
3. Check Console for Service Worker logs

#### Expected Console Logs:
```
[ReminderManager] Reminder saved: {...}
[SW] Checking reminders...
[SW] ⏰ Triggering reminder: "Test Goal"
[SW] Reminder updated, next trigger: ...
```

#### Test D: Close App and Test (ADVANCED)

1. Set reminder for 2 minutes from now
2. **Close the browser tab completely**
3. Wait for reminder time
4. **Notification should still appear!** 🎉

#### If reminder doesn't fire:
- ❌ Check if Service Worker is active (DevTools → Application)
- ❌ Verify notification permission is granted
- ❌ Check Service Worker console (DevTools → Application → Service Workers → click on service-worker.js)
- ❌ Browser might have terminated Service Worker (rare, try again)
- ❌ Check reminder time is in the future

---

### Step 6: Test Offline Queue System

#### Test A: Add Test Action

1. Click **"Check Queue"** button
2. Should show "Total: 0"
3. Click **"Add Test Action"** button
4. Click **"Check Queue"** again

#### Expected Results:
- ✅ Success: "✓ Test action added"
- ✅ Queue shows:
  - Streak Actions: 1
  - Total: 1

#### Test B: Verify in IndexedDB

1. DevTools → **Application** → **IndexedDB**
2. Expand **StudyStreakTrackerDB** → **streakActions**
3. Click on **streakActions** store
4. Verify entry exists with:
   - goalId: test-goal-123
   - day: 15
   - synced: false

#### Test C: Add Duplicate (Test Deduplication)

1. Click **"Add Test Action"** again (same day)
2. Should prevent duplicate

#### Expected Results:
- ✅ Console shows: `[DBManager] Duplicate entry detected, skipping`
- ✅ Queue still shows only 1 action

#### Test D: Sync Queue

1. Click **"Sync Now"** button
2. Watch Console logs

#### Expected Results:
- ✅ Console shows sync attempts
- ✅ If online: Syncs to server (may fail if test goalId doesn't exist)
- ✅ If offline: Logs error and keeps in queue

---

### Step 7: Test Main App Integration

1. **Navigate to main app**: `http://localhost:8080/index.html`
2. **Open DevTools Console**
3. **Look for initialization logs**:

#### Expected Console Output:
```
[App] Initializing offline-first system...
[DBManager] Database initialized successfully
[App] ✓ IndexedDB initialized
[App] ✓ Offline Queue Manager initialized
[App] ✓ Reminder Manager initialized
[App] ✓ Offline-first system ready
[App] ✓ Service Worker registered
[App] ✓ Service Worker is ready
```

#### If you see errors:
- ❌ Scripts not loading: Check file paths in index.html
- ❌ "dbManager not found": Scripts loaded in wrong order
- ❌ Service Worker errors: Check console for details

---

### Step 8: Test Offline Streak Marking

#### Setup:
1. Go to main app: `http://localhost:8080/index.html`
2. Create a goal or select existing one
3. Open DevTools → **Network tab**
4. Check **"Offline"** checkbox (simulates offline mode)

#### Test:
1. Try to mark today's streak
2. Watch Console and UI

#### Expected Results:
- ✅ Console: `[App] Device offline or sync failed, queuing streak action...`
- ✅ Console: `[OfflineQueue] Streak action queued for offline sync`
- ✅ UI updates optimistically (day marked as completed)
- ✅ Toast: "✓ Offline: Marked and queued for sync"

#### Go Back Online:
1. Uncheck **"Offline"** in Network tab
2. Wait a few seconds

#### Expected Results:
- ✅ Console: `[OfflineQueue] Network back online, initiating sync...`
- ✅ Console: `[OfflineQueue] ✓ Streak action synced successfully`
- ✅ Toast: "Synced X offline action(s)"

---

## 🔍 Debugging Tips

### Check Service Worker Console
1. DevTools → **Application** tab
2. Click **Service Workers**
3. Click on **service-worker.js** link
4. Separate console opens with SW-specific logs
5. Look for `[SW]` prefixed messages

### Check IndexedDB Data
1. DevTools → **Application** tab
2. **IndexedDB** → **StudyStreakTrackerDB**
3. Click each store to view contents
4. Verify data structure matches expected format

### Monitor Network Requests
1. DevTools → **Network** tab
2. Filter by "Fetch/XHR"
3. Watch for API calls when syncing
4. Check request/response payloads

### Check Console Logs
Look for these prefixes:
- `[App]` - Main application
- `[DBManager]` - IndexedDB operations
- `[OfflineQueue]` - Queue and sync
- `[ReminderManager]` - Reminder scheduling
- `[SW]` - Service Worker events

---

## ✅ Success Criteria Checklist

### Service Worker
- [ ] Service Worker registers successfully
- [ ] Shows as "activated and running" in DevTools
- [ ] Can update/refresh without errors

### IndexedDB
- [ ] All 4 stores created
- [ ] Can add/retrieve/delete data
- [ ] No errors in console

### Notifications
- [ ] Permission granted
- [ ] Test notification appears
- [ ] Notification has icon and message

### Reminders
- [ ] Can set reminder
- [ ] Reminder stored in IndexedDB
- [ ] Notification fires at correct time
- [ ] **Fires even when app is closed** ⭐
- [ ] Works offline ⭐

### Offline Queue
- [ ] Can add actions offline
- [ ] Duplicates prevented
- [ ] Auto-syncs when online
- [ ] Synced items removed from queue

### Main App
- [ ] All systems initialize without errors
- [ ] Can mark streak offline
- [ ] Optimistic UI updates
- [ ] Auto-syncs when back online

---

## 🐛 Common Issues & Solutions

### Issue 1: Service Worker Not Registering
**Solution:**
```powershell
# Use http://localhost NOT file://
# Clear cache: Ctrl+Shift+Delete
# Hard reload: Ctrl+Shift+R (Chrome) or Ctrl+F5 (Firefox)
```

### Issue 2: Notifications Not Appearing
**Solution:**
1. Check system notifications are enabled (Windows settings)
2. Check browser notification permissions
3. Try `http://127.0.0.1:8080` instead of `localhost`
4. Test in incognito mode

### Issue 3: Reminders Not Firing
**Solution:**
1. Verify Service Worker is active
2. Check Service Worker console for errors
3. Ensure reminder time is in future
4. Browser might sleep Service Worker (keep DevTools open for testing)

### Issue 4: "dbManager not found"
**Solution:**
1. Check scripts load order in HTML:
   ```html
   <script src="db-manager.js"></script>
   <script src="offline-queue.js"></script>
   <script src="reminder-manager.js"></script>
   <script src="script.js"></script>
   ```
2. Verify all files exist in frontend folder
3. Hard reload page (Ctrl+Shift+R)

### Issue 5: IndexedDB Quota Exceeded
**Solution:**
```javascript
// In test page, click "Clear All Data"
// Or in DevTools: Application → IndexedDB → Right-click → Delete database
```

---

## 📊 Performance Monitoring

### Check Queue Status Programmatically
Open Console and run:
```javascript
// Check queue status
await offlineQueue.getQueueStatus()

// Check reminders
await dbManager.getAll('reminders')

// Check streak actions
await dbManager.getAll('streakActions')
```

### Monitor Sync Performance
```javascript
// Watch sync events
offlineQueue.syncAll().then(() => console.log('Sync complete'))
```

---

## 🎯 Final Test Scenario (End-to-End)

### Complete Offline Flow Test

1. **Start with clean state** (clear IndexedDB)
2. **Set a reminder** for 2 minutes from now
3. **Go offline** (Network tab → Offline)
4. **Mark today's streak** (should queue)
5. **Close the app tab completely**
6. **Wait for reminder time** (notification should appear!)
7. **Click notification** (app opens)
8. **Verify UI** shows offline action queued
9. **Go back online** (uncheck Offline)
10. **Wait for auto-sync** (queue clears)
11. **Verify in IndexedDB** (streakActions empty)

### Expected Result:
✅ **Everything works seamlessly offline and syncs automatically!**

---

## 📞 Need Help?

If tests fail, export logs:
1. Click **"Export Logs"** button in test page
2. Share the JSON file
3. Also share:
   - Browser name and version
   - Console screenshot
   - DevTools → Application screenshot (Service Worker status)

---

## 🚀 Next Steps After Testing

Once all tests pass:
1. ✅ Deploy to production (Vercel/Netlify)
2. ✅ Test on real mobile devices
3. ✅ Test notification on Android/iOS
4. ✅ Monitor error logs in production
5. ✅ Gather user feedback

**Happy Testing! 🎉**
