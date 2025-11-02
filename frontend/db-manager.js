/**
 * IndexedDB Manager for Study Streak Tracker
 * Handles offline data persistence using IndexedDB with LocalStorage fallback
 */

const DB_NAME = "StudyStreakTrackerDB";
const DB_VERSION = 1;
const STORES = {
  SYNC_QUEUE: "syncQueue",
  GOALS_CACHE: "goalsCache",
  REMINDERS: "reminders",
  STREAK_ACTIONS: "streakActions",
};

class DBManager {
  constructor() {
    this.db = null;
    this.isSupported = this.checkIndexedDBSupport();
    this.initPromise = null;
  }

  /**
   * Check if IndexedDB is supported in the current browser
   */
  checkIndexedDBSupport() {
    try {
      return !!(
        window.indexedDB ||
        window.mozIndexedDB ||
        window.webkitIndexedDB ||
        window.msIndexedDB
      );
    } catch (e) {
      console.warn(
        "[DBManager] IndexedDB not supported, will use LocalStorage fallback"
      );
      return false;
    }
  }

  /**
   * Initialize IndexedDB database and object stores
   */
  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (!this.isSupported) {
        console.log("[DBManager] Using LocalStorage fallback");
        resolve(false);
        return;
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error("[DBManager] Database failed to open:", request.error);
          this.isSupported = false;
          resolve(false);
        };

        request.onsuccess = () => {
          this.db = request.result;
          console.log("[DBManager] Database initialized successfully");
          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          console.log(
            "[DBManager] Database upgrade needed, creating object stores..."
          );
          const db = event.target.result;

          // Sync Queue Store: stores pending API requests for offline sync
          if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
            const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, {
              keyPath: "id",
              autoIncrement: true,
            });
            syncStore.createIndex("timestamp", "timestamp", { unique: false });
            syncStore.createIndex("type", "type", { unique: false });
            console.log("[DBManager] Created syncQueue store");
          }

          // Goals Cache Store: stores goal data for offline access
          if (!db.objectStoreNames.contains(STORES.GOALS_CACHE)) {
            const goalsStore = db.createObjectStore(STORES.GOALS_CACHE, {
              keyPath: "_id",
            });
            goalsStore.createIndex("lastUpdated", "lastUpdated", {
              unique: false,
            });
            console.log("[DBManager] Created goalsCache store");
          }

          // Reminders Store: stores reminder configurations
          if (!db.objectStoreNames.contains(STORES.REMINDERS)) {
            const remindersStore = db.createObjectStore(STORES.REMINDERS, {
              keyPath: "goalId",
            });
            remindersStore.createIndex("nextTrigger", "nextTrigger", {
              unique: false,
            });
            remindersStore.createIndex("enabled", "enabled", { unique: false });
            console.log("[DBManager] Created reminders store");
          }

          // Streak Actions Store: stores offline streak marks with deduplication
          if (!db.objectStoreNames.contains(STORES.STREAK_ACTIONS)) {
            const streakStore = db.createObjectStore(STORES.STREAK_ACTIONS, {
              keyPath: "id",
              autoIncrement: true,
            });
            // Composite index for deduplication: goalId + date + day
            streakStore.createIndex("goalDayDate", ["goalId", "day", "date"], {
              unique: true,
            });
            streakStore.createIndex("synced", "synced", { unique: false });
            streakStore.createIndex("timestamp", "timestamp", {
              unique: false,
            });
            console.log("[DBManager] Created streakActions store");
          }
        };
      } catch (error) {
        console.error("[DBManager] Error initializing IndexedDB:", error);
        this.isSupported = false;
        resolve(false);
      }
    });

    return this.initPromise;
  }

  /**
   * Generic method to add data to a store (IndexedDB or LocalStorage fallback)
   */
  async add(storeName, data) {
    console.log(`[DBManager] Adding to ${storeName}:`, data);

    if (!this.isSupported) {
      return this._addToLocalStorage(storeName, data);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.add(data);

        request.onsuccess = () => {
          console.log(
            `[DBManager] Successfully added to ${storeName}, key:`,
            request.result
          );
          resolve(request.result);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error adding to ${storeName}:`,
            request.error
          );
          // If IndexedDB fails, fallback to LocalStorage
          if (request.error.name === "ConstraintError") {
            console.log(
              `[DBManager] Duplicate entry detected for ${storeName}, skipping`
            );
            resolve(null); // Duplicate, return null
          } else {
            this._addToLocalStorage(storeName, data)
              .then(resolve)
              .catch(reject);
          }
        };
      } catch (error) {
        console.error(`[DBManager] Exception in add to ${storeName}:`, error);
        this._addToLocalStorage(storeName, data).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Generic method to get all data from a store
   */
  async getAll(storeName) {
    if (!this.isSupported) {
      return this._getAllFromLocalStorage(storeName);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          console.log(
            `[DBManager] Retrieved ${request.result.length} items from ${storeName}`
          );
          resolve(request.result);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error getting all from ${storeName}:`,
            request.error
          );
          this._getAllFromLocalStorage(storeName).then(resolve).catch(reject);
        };
      } catch (error) {
        console.error(
          `[DBManager] Exception in getAll from ${storeName}:`,
          error
        );
        this._getAllFromLocalStorage(storeName).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Get a single item by key
   */
  async get(storeName, key) {
    if (!this.isSupported) {
      return this._getFromLocalStorage(storeName, key);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error getting from ${storeName}:`,
            request.error
          );
          this._getFromLocalStorage(storeName, key).then(resolve).catch(reject);
        };
      } catch (error) {
        console.error(`[DBManager] Exception in get from ${storeName}:`, error);
        this._getFromLocalStorage(storeName, key).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Update or put data in a store
   */
  async put(storeName, data) {
    console.log(`[DBManager] Updating ${storeName}:`, data);

    if (!this.isSupported) {
      return this._putToLocalStorage(storeName, data);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => {
          console.log(`[DBManager] Successfully updated ${storeName}`);
          resolve(request.result);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error updating ${storeName}:`,
            request.error
          );
          this._putToLocalStorage(storeName, data).then(resolve).catch(reject);
        };
      } catch (error) {
        console.error(`[DBManager] Exception in put to ${storeName}:`, error);
        this._putToLocalStorage(storeName, data).then(resolve).catch(reject);
      }
    });
  }

  /**
   * Delete an item from a store
   */
  async delete(storeName, key) {
    console.log(`[DBManager] Deleting from ${storeName}, key:`, key);

    if (!this.isSupported) {
      return this._deleteFromLocalStorage(storeName, key);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => {
          console.log(`[DBManager] Successfully deleted from ${storeName}`);
          resolve(true);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error deleting from ${storeName}:`,
            request.error
          );
          this._deleteFromLocalStorage(storeName, key)
            .then(resolve)
            .catch(reject);
        };
      } catch (error) {
        console.error(
          `[DBManager] Exception in delete from ${storeName}:`,
          error
        );
        this._deleteFromLocalStorage(storeName, key)
          .then(resolve)
          .catch(reject);
      }
    });
  }

  /**
   * Clear all data from a store
   */
  async clear(storeName) {
    console.log(`[DBManager] Clearing ${storeName}`);

    if (!this.isSupported) {
      return this._clearLocalStorage(storeName);
    }

    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => {
          console.log(`[DBManager] Successfully cleared ${storeName}`);
          resolve(true);
        };

        request.onerror = () => {
          console.error(
            `[DBManager] Error clearing ${storeName}:`,
            request.error
          );
          this._clearLocalStorage(storeName).then(resolve).catch(reject);
        };
      } catch (error) {
        console.error(`[DBManager] Exception in clear ${storeName}:`, error);
        this._clearLocalStorage(storeName).then(resolve).catch(reject);
      }
    });
  }

  // ===== LocalStorage Fallback Methods =====

  _getLocalStorageKey(storeName, key = null) {
    return key ? `sst_${storeName}_${key}` : `sst_${storeName}`;
  }

  async _addToLocalStorage(storeName, data) {
    try {
      const key = this._getLocalStorageKey(storeName);
      const existing = JSON.parse(localStorage.getItem(key) || "[]");

      // For streak actions, check for duplicates
      if (storeName === STORES.STREAK_ACTIONS) {
        const isDuplicate = existing.some(
          (item) =>
            item.goalId === data.goalId &&
            item.day === data.day &&
            item.date === data.date
        );
        if (isDuplicate) {
          console.log(
            "[DBManager] Duplicate streak action detected in LocalStorage, skipping"
          );
          return null;
        }
      }

      existing.push(data);
      localStorage.setItem(key, JSON.stringify(existing));
      console.log(`[DBManager] Added to LocalStorage ${storeName}`);
      return existing.length - 1;
    } catch (error) {
      console.error("[DBManager] LocalStorage add error:", error);
      throw error;
    }
  }

  async _getAllFromLocalStorage(storeName) {
    try {
      const key = this._getLocalStorageKey(storeName);
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch (error) {
      console.error("[DBManager] LocalStorage getAll error:", error);
      return [];
    }
  }

  async _getFromLocalStorage(storeName, itemKey) {
    try {
      const key = this._getLocalStorageKey(storeName, itemKey);
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (error) {
      console.error("[DBManager] LocalStorage get error:", error);
      return null;
    }
  }

  async _putToLocalStorage(storeName, data) {
    try {
      const key = this._getLocalStorageKey(
        storeName,
        data._id || data.goalId || data.id
      );
      localStorage.setItem(key, JSON.stringify(data));
      console.log(`[DBManager] Updated LocalStorage ${storeName}`);
      return true;
    } catch (error) {
      console.error("[DBManager] LocalStorage put error:", error);
      throw error;
    }
  }

  async _deleteFromLocalStorage(storeName, itemKey) {
    try {
      const key = this._getLocalStorageKey(storeName, itemKey);
      localStorage.removeItem(key);
      console.log(`[DBManager] Deleted from LocalStorage ${storeName}`);
      return true;
    } catch (error) {
      console.error("[DBManager] LocalStorage delete error:", error);
      return false;
    }
  }

  async _clearLocalStorage(storeName) {
    try {
      const key = this._getLocalStorageKey(storeName);
      localStorage.removeItem(key);
      console.log(`[DBManager] Cleared LocalStorage ${storeName}`);
      return true;
    } catch (error) {
      console.error("[DBManager] LocalStorage clear error:", error);
      return false;
    }
  }
}

// Export singleton instance
const dbManager = new DBManager();
window.dbManager = dbManager; // Make available globally
