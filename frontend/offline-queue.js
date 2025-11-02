/**
 * Offline Queue Manager for Study Streak Tracker
 * Manages offline action queue with automatic sync when online
 */

class OfflineQueueManager {
  constructor(dbManager, apiBase) {
    this.db = dbManager;
    this.apiBase = apiBase;
    this.isSyncing = false;
    this.syncInProgress = new Set(); // Track items currently being synced
    this.setupOnlineListener();
  }

  /**
   * Setup listener for online/offline events
   */
  setupOnlineListener() {
    window.addEventListener("online", () => {
      console.log("[OfflineQueue] Network back online, initiating sync...");
      this.syncAll();
    });

    window.addEventListener("offline", () => {
      console.log("[OfflineQueue] Network offline, queuing enabled");
    });

    // Also attempt sync on page load if online
    if (navigator.onLine) {
      setTimeout(() => this.syncAll(), 2000); // Delayed initial sync
    }
  }

  /**
   * Add a streak action to the offline queue with duplicate prevention
   */
  async addStreakAction(goalId, day, mark = true) {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const action = {
      type: "mark_streak",
      goalId: goalId,
      day: day,
      mark: mark,
      date: today,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    };

    try {
      const result = await this.db.add("streakActions", action);

      if (result === null) {
        console.log(
          "[OfflineQueue] Duplicate streak action prevented for day:",
          day
        );
        return { success: false, reason: "duplicate" };
      }

      console.log(
        "[OfflineQueue] Streak action queued for offline sync:",
        action
      );
      return { success: true, id: result };
    } catch (error) {
      console.error("[OfflineQueue] Error adding streak action:", error);
      throw error;
    }
  }

  /**
   * Add a general sync action to the queue
   */
  async addSyncAction(type, payload) {
    const action = {
      type: type,
      payload: payload,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0,
    };

    try {
      const result = await this.db.add("syncQueue", action);
      console.log(`[OfflineQueue] Sync action queued: ${type}`, payload);
      return result;
    } catch (error) {
      console.error("[OfflineQueue] Error adding sync action:", error);
      throw error;
    }
  }

  /**
   * Get all pending (unsynced) streak actions
   */
  async getPendingStreakActions() {
    try {
      const allActions = await this.db.getAll("streakActions");
      return allActions.filter((action) => !action.synced);
    } catch (error) {
      console.error(
        "[OfflineQueue] Error getting pending streak actions:",
        error
      );
      return [];
    }
  }

  /**
   * Get all pending sync actions
   */
  async getPendingSyncActions() {
    try {
      const allActions = await this.db.getAll("syncQueue");
      return allActions.filter((action) => !action.synced);
    } catch (error) {
      console.error(
        "[OfflineQueue] Error getting pending sync actions:",
        error
      );
      return [];
    }
  }

  /**
   * Mark a streak action as synced
   */
  async markStreakActionSynced(actionId) {
    try {
      const action = await this.db.get("streakActions", actionId);
      if (action) {
        action.synced = true;
        action.syncedAt = Date.now();
        await this.db.put("streakActions", action);
        console.log("[OfflineQueue] Streak action marked as synced:", actionId);
      }
    } catch (error) {
      console.error(
        "[OfflineQueue] Error marking streak action as synced:",
        error
      );
    }
  }

  /**
   * Mark a sync action as synced
   */
  async markSyncActionSynced(actionId) {
    try {
      const action = await this.db.get("syncQueue", actionId);
      if (action) {
        action.synced = true;
        action.syncedAt = Date.now();
        await this.db.put("syncQueue", action);
        console.log("[OfflineQueue] Sync action marked as synced:", actionId);
      }
    } catch (error) {
      console.error(
        "[OfflineQueue] Error marking sync action as synced:",
        error
      );
    }
  }

  /**
   * Delete a synced streak action
   */
  async deleteStreakAction(actionId) {
    try {
      await this.db.delete("streakActions", actionId);
      console.log("[OfflineQueue] Deleted streak action:", actionId);
    } catch (error) {
      console.error("[OfflineQueue] Error deleting streak action:", error);
    }
  }

  /**
   * Delete a synced sync action
   */
  async deleteSyncAction(actionId) {
    try {
      await this.db.delete("syncQueue", actionId);
      console.log("[OfflineQueue] Deleted sync action:", actionId);
    } catch (error) {
      console.error("[OfflineQueue] Error deleting sync action:", error);
    }
  }

  /**
   * Sync a single streak action to the server
   */
  async syncStreakAction(action) {
    if (this.syncInProgress.has(action.id)) {
      console.log(
        "[OfflineQueue] Sync already in progress for action:",
        action.id
      );
      return false;
    }

    this.syncInProgress.add(action.id);

    try {
      console.log("[OfflineQueue] Syncing streak action:", action);

      const response = await fetch(
        `${this.apiBase}/goals/${action.goalId}/update-streak`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day: action.day,
            mark: action.mark,
          }),
        }
      );

      if (response.ok) {
        console.log(
          "[OfflineQueue] ✓ Streak action synced successfully:",
          action.id
        );
        await this.deleteStreakAction(action.id);
        this.syncInProgress.delete(action.id);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          "[OfflineQueue] ✗ Streak sync failed:",
          response.status,
          errorData
        );

        // Update retry count
        action.retryCount = (action.retryCount || 0) + 1;
        action.lastError = errorData.error || `HTTP ${response.status}`;
        await this.db.put("streakActions", action);

        this.syncInProgress.delete(action.id);
        return false;
      }
    } catch (error) {
      console.error("[OfflineQueue] ✗ Error syncing streak action:", error);

      // Update retry count
      action.retryCount = (action.retryCount || 0) + 1;
      action.lastError = error.message;
      await this.db.put("streakActions", action);

      this.syncInProgress.delete(action.id);
      return false;
    }
  }

  /**
   * Sync a general action to the server
   */
  async syncGeneralAction(action) {
    if (this.syncInProgress.has(action.id)) {
      console.log(
        "[OfflineQueue] Sync already in progress for action:",
        action.id
      );
      return false;
    }

    this.syncInProgress.add(action.id);

    try {
      console.log("[OfflineQueue] Syncing general action:", action.type);

      let response;
      const { type, payload } = action;

      switch (type) {
        case "create_goal":
          response = await fetch(`${this.apiBase}/goals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          break;

        case "edit_goal":
          response = await fetch(`${this.apiBase}/goals/${payload.id}/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              goal: payload.goal,
              totalDays: payload.totalDays,
            }),
          });
          break;

        case "delete_goal":
          response = await fetch(`${this.apiBase}/goals/${payload.id}`, {
            method: "DELETE",
          });
          break;

        case "reset_streak":
          response = await fetch(`${this.apiBase}/goals/${payload.id}/reset`, {
            method: "POST",
          });
          break;

        case "claim_badge":
          response = await fetch(
            `${this.apiBase}/goals/${payload.id}/claim-badge`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ badgeId: payload.badgeId }),
            }
          );
          break;

        case "set_default_goal":
          response = await fetch(
            `${this.apiBase}/goals/${payload.goalId}/set-default`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            }
          );
          break;

        case "save_reminder":
          response = await fetch(
            `${this.apiBase}/goals/${payload.id}/reminder`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reminderTime: payload.reminderTime,
                enabled: payload.enabled,
              }),
            }
          );
          break;

        default:
          console.warn("[OfflineQueue] Unknown action type:", type);
          this.syncInProgress.delete(action.id);
          return false;
      }

      if (response && response.ok) {
        console.log(`[OfflineQueue] ✓ ${type} synced successfully:`, action.id);
        await this.deleteSyncAction(action.id);
        this.syncInProgress.delete(action.id);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `[OfflineQueue] ✗ ${type} sync failed:`,
          response.status,
          errorData
        );

        // Update retry count
        action.retryCount = (action.retryCount || 0) + 1;
        action.lastError = errorData.error || `HTTP ${response.status}`;
        await this.db.put("syncQueue", action);

        this.syncInProgress.delete(action.id);
        return false;
      }
    } catch (error) {
      console.error("[OfflineQueue] ✗ Error syncing general action:", error);

      // Update retry count
      action.retryCount = (action.retryCount || 0) + 1;
      action.lastError = error.message;
      await this.db.put("syncQueue", action);

      this.syncInProgress.delete(action.id);
      return false;
    }
  }

  /**
   * Sync all pending actions
   */
  async syncAll() {
    if (this.isSyncing) {
      console.log("[OfflineQueue] Sync already in progress, skipping...");
      return;
    }

    if (!navigator.onLine) {
      console.log("[OfflineQueue] Device is offline, skipping sync");
      return;
    }

    this.isSyncing = true;
    console.log("[OfflineQueue] ======= Starting full sync =======");

    try {
      // Sync streak actions first (higher priority)
      const streakActions = await this.getPendingStreakActions();
      console.log(
        `[OfflineQueue] Found ${streakActions.length} pending streak actions`
      );

      let successCount = 0;
      let failCount = 0;

      for (const action of streakActions) {
        // Skip if too many retries (max 5)
        if (action.retryCount >= 5) {
          console.warn(
            "[OfflineQueue] Max retries reached for streak action, skipping:",
            action.id
          );
          continue;
        }

        const success = await this.syncStreakAction(action);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }

        // Small delay between requests to avoid overwhelming server
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Sync general actions
      const syncActions = await this.getPendingSyncActions();
      console.log(
        `[OfflineQueue] Found ${syncActions.length} pending general actions`
      );

      for (const action of syncActions) {
        // Skip if too many retries (max 5)
        if (action.retryCount >= 5) {
          console.warn(
            "[OfflineQueue] Max retries reached for action, skipping:",
            action.id
          );
          continue;
        }

        const success = await this.syncGeneralAction(action);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      console.log(
        `[OfflineQueue] ======= Sync complete: ${successCount} success, ${failCount} failed =======`
      );

      // Notify UI if there were successful syncs
      if (successCount > 0 && typeof window.showToast === "function") {
        window.showToast(`Synced ${successCount} offline action(s)`);
      }

      if (failCount > 0 && typeof window.showToast === "function") {
        window.showToast(
          `${failCount} action(s) failed to sync, will retry later`
        );
      }
    } catch (error) {
      console.error("[OfflineQueue] Error during sync:", error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get sync queue status for debugging
   */
  async getQueueStatus() {
    try {
      const streakActions = await this.getPendingStreakActions();
      const syncActions = await this.getPendingSyncActions();

      return {
        streakActions: streakActions.length,
        syncActions: syncActions.length,
        total: streakActions.length + syncActions.length,
        isOnline: navigator.onLine,
        isSyncing: this.isSyncing,
      };
    } catch (error) {
      console.error("[OfflineQueue] Error getting queue status:", error);
      return { error: error.message };
    }
  }
}

// Export (will be initialized in main script)
window.OfflineQueueManager = OfflineQueueManager;
