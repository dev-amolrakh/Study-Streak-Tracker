/**
 * Reminder Manager for Study Streak Tracker
 * Handles persistent reminders using IndexedDB + Service Worker
 * Ensures reminders fire even when app is closed or offline
 */

class ReminderManager {
  constructor(dbManager) {
    this.db = dbManager;
    this.checkIntervalId = null;
    this.CHECK_INTERVAL = 60000; // Check every minute
  }

  /**
   * Save a reminder configuration
   */
  async saveReminder(goalId, reminderTime, enabled, goalName = "") {
    try {
      const nextTrigger = this.calculateNextTrigger(reminderTime);

      const reminderData = {
        goalId: goalId,
        reminderTime: reminderTime, // HH:MM format (24-hour)
        enabled: enabled,
        goalName: goalName,
        nextTrigger: nextTrigger,
        lastTriggered: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.db.put("reminders", reminderData);
      console.log("[ReminderManager] Reminder saved:", reminderData);

      // Restart the reminder check loop
      if (enabled) {
        this.startReminderCheck();

        // Also register with service worker for background sync
        this.registerWithServiceWorker(reminderData);
      } else {
        this.stopReminderCheck();
      }

      return reminderData;
    } catch (error) {
      console.error("[ReminderManager] Error saving reminder:", error);
      throw error;
    }
  }

  /**
   * Get reminder for a specific goal
   */
  async getReminder(goalId) {
    try {
      return await this.db.get("reminders", goalId);
    } catch (error) {
      console.error("[ReminderManager] Error getting reminder:", error);
      return null;
    }
  }

  /**
   * Get all enabled reminders
   */
  async getEnabledReminders() {
    try {
      const allReminders = await this.db.getAll("reminders");
      return allReminders.filter((r) => r.enabled);
    } catch (error) {
      console.error(
        "[ReminderManager] Error getting enabled reminders:",
        error
      );
      return [];
    }
  }

  /**
   * Delete a reminder
   */
  async deleteReminder(goalId) {
    try {
      await this.db.delete("reminders", goalId);
      console.log("[ReminderManager] Reminder deleted for goal:", goalId);
    } catch (error) {
      console.error("[ReminderManager] Error deleting reminder:", error);
    }
  }

  /**
   * Calculate next trigger time based on reminder time
   */
  calculateNextTrigger(reminderTime) {
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

    // If the time has already passed today, schedule for tomorrow
    if (nextTrigger <= now) {
      nextTrigger.setDate(nextTrigger.getDate() + 1);
    }

    return nextTrigger.getTime();
  }

  /**
   * Start the reminder check loop
   */
  startReminderCheck() {
    // Stop existing check if running
    this.stopReminderCheck();

    console.log("[ReminderManager] Starting reminder check loop");

    // Check immediately
    this.checkReminders();

    // Then check every minute
    this.checkIntervalId = setInterval(() => {
      this.checkReminders();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Stop the reminder check loop
   */
  stopReminderCheck() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log("[ReminderManager] Stopped reminder check loop");
    }
  }

  /**
   * Check all reminders and trigger if needed
   */
  async checkReminders() {
    try {
      const enabledReminders = await this.getEnabledReminders();
      const now = Date.now();

      console.log(
        `[ReminderManager] Checking ${enabledReminders.length} reminder(s)...`
      );

      for (const reminder of enabledReminders) {
        // Check if it's time to trigger
        if (reminder.nextTrigger && now >= reminder.nextTrigger) {
          console.log(
            "[ReminderManager] ⏰ Triggering reminder for goal:",
            reminder.goalName
          );

          // Trigger the notification
          await this.triggerNotification(reminder);

          // Update next trigger time
          reminder.lastTriggered = now;
          reminder.nextTrigger = this.calculateNextTrigger(
            reminder.reminderTime
          );
          await this.db.put("reminders", reminder);

          console.log(
            "[ReminderManager] Next trigger scheduled for:",
            new Date(reminder.nextTrigger).toLocaleString()
          );
        }
      }
    } catch (error) {
      console.error("[ReminderManager] Error checking reminders:", error);
    }
  }

  /**
   * Trigger a notification
   */
  async triggerNotification(reminder) {
    try {
      // Check if notifications are supported and permitted
      if (!("Notification" in window)) {
        console.warn("[ReminderManager] Notifications not supported");
        return;
      }

      if (Notification.permission !== "granted") {
        console.warn("[ReminderManager] Notification permission not granted");
        return;
      }

      const title = "Time to study! 📚";
      const body = reminder.goalName
        ? `Time to study "${reminder.goalName}"! Keep your streak alive 🔥`
        : "Mark your streak for today! Keep the momentum going 🔥";

      const options = {
        body: body,
        icon: "/icons/icon-192.svg",
        badge: "/icons/icon-72.svg",
        vibrate: [200, 100, 200, 100, 200],
        tag: `study-streak-reminder-${reminder.goalId}`,
        data: {
          url: "/",
          goalId: reminder.goalId,
        },
        requireInteraction: true,
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
        silent: false,
        renotify: true,
      };

      // Try to use service worker registration for better persistence
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, options);
          console.log(
            "[ReminderManager] Notification shown via Service Worker"
          );
          return;
        }
      }

      // Fallback to regular notification
      new Notification(title, options);
      console.log("[ReminderManager] Notification shown via Notification API");
    } catch (error) {
      console.error("[ReminderManager] Error triggering notification:", error);
    }
  }

  /**
   * Register reminder with service worker for background sync
   */
  async registerWithServiceWorker(reminderData) {
    try {
      if (!("serviceWorker" in navigator)) {
        console.warn("[ReminderManager] Service Worker not supported");
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // Send reminder data to service worker
      if (registration.active) {
        registration.active.postMessage({
          type: "REGISTER_REMINDER",
          payload: reminderData,
        });
        console.log(
          "[ReminderManager] Reminder registered with Service Worker"
        );
      }

      // Try to register periodic background sync (if supported)
      if ("periodicSync" in registration) {
        try {
          await registration.periodicSync.register("check-reminders", {
            minInterval: 60 * 1000, // 1 minute
          });
          console.log("[ReminderManager] Periodic background sync registered");
        } catch (error) {
          console.warn("[ReminderManager] Periodic sync not supported:", error);
        }
      }
    } catch (error) {
      console.error(
        "[ReminderManager] Error registering with Service Worker:",
        error
      );
    }
  }

  /**
   * Request notification permission
   */
  async requestPermission() {
    try {
      if (!("Notification" in window)) {
        console.warn("[ReminderManager] Notifications not supported");
        return false;
      }

      if (Notification.permission === "granted") {
        return true;
      }

      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (error) {
      console.error("[ReminderManager] Error requesting permission:", error);
      return false;
    }
  }

  /**
   * Initialize reminder system
   */
  async init() {
    try {
      console.log("[ReminderManager] Initializing...");

      // Check if there are any enabled reminders
      const enabledReminders = await this.getEnabledReminders();

      if (enabledReminders.length > 0) {
        console.log(
          `[ReminderManager] Found ${enabledReminders.length} enabled reminder(s)`
        );
        this.startReminderCheck();
      } else {
        console.log("[ReminderManager] No enabled reminders found");
      }

      return true;
    } catch (error) {
      console.error("[ReminderManager] Error initializing:", error);
      return false;
    }
  }
}

// Export (will be initialized in main script)
window.ReminderManager = ReminderManager;
