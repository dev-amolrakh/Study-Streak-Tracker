const API_BASE = (() => {
  // allow overriding via env-like global for easier local testing
  if (window.__API_BASE__) return window.__API_BASE__;
  // Default to the deployed backend URL (explicit /api prefix)
  return "https://study-streak-tracker-myz5.vercel.app/api";
})();

// Helper function to check if an ID is valid for backend API calls
function isValidBackendId(id) {
  return (
    id && typeof id === "string" && !id.startsWith("local-") && id.length === 24
  );
}

const goalSelect = document.getElementById("goalSelect");
const deleteGoalBtn = document.getElementById("deleteGoalBtn");
const goalInput = document.getElementById("goalInput");
const totalDaysInput = document.getElementById("totalDaysInput");
const saveGoalBtn = document.getElementById("saveGoalBtn");
const editGoalBtn = document.getElementById("editGoalBtn");
const calendarGrid = document.getElementById("calendarGrid");
const currentStreakEl = document.getElementById("currentStreak");
const bestStreakEl = document.getElementById("bestStreak");
const totalCompletedEl = document.getElementById("totalCompleted");
const remainingDaysEl = document.getElementById("remainingDays");
const quoteEl = document.getElementById("quote");
const resetBtn = document.getElementById("resetBtn");
const canvas = document.getElementById("progressCanvas");
const ctx = canvas.getContext("2d");

// Badges UI elements
const openBadgesBtn = document.getElementById("openBadgesBtn");
const badgesModal = document.getElementById("badgesModal");
const closeBadgesBtn = document.getElementById("closeBadgesBtn");
const badgesGrid = document.getElementById("badgesGrid");
const claimedBadgesContainer = document.getElementById(
  "claimedBadgesContainer"
);

let state = null;
let goals = [];
let cachedGoals = null; // in-memory cache
const SYNC_QUEUE_KEY = "sst_sync_queue";
const CACHE_KEY = "sst_cache";
let lastServerDate = null; // ISO string from server
let reminderIntervalId = null;

const QUOTES = [
  "Keep going — consistency beats intensity.",
  "Small steps every day lead to huge results.",
  "You're building a habit, one day at a time.",
  "Progress, not perfection.",
  "The hardest part is showing up — you're doing it.",
];

// VAPID public key for Push subscriptions. (Provided by user)
const VAPID_PUBLIC_KEY =
  "BN4Lxx-qlP5F9r13FQv_JXZAISKtwmsC28LrwpH5Dhy-A5luWaA_iPN8-xi4zuzKrUkcNqFMkgj4YSsUdT6QEHQ";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeUserToPush(registration) {
  if (!registration || !("pushManager" in registration)) return null;
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      console.log("Existing push subscription found");
      return existing;
    }
    if (
      !VAPID_PUBLIC_KEY ||
      VAPID_PUBLIC_KEY === "REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY"
    ) {
      console.warn("VAPID public key not set. Skipping push subscription.");
      return null;
    }
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    console.log("New push subscription", sub);
    // Try to send subscription to your backend so it can send pushes later.
    try {
      await fetch(`${API_BASE}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      console.log("Subscription sent to server");
    } catch (err) {
      console.warn(
        "Failed to send subscription to server. Save it locally and send later.",
        err
      );
      localStorage.setItem("sst_push_subscription", JSON.stringify(sub));
    }
    return sub;
  } catch (err) {
    console.warn("Push subscription failed", err);
    return null;
  }
}

function pickQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

// Badge definitions used by UI logic (keep in sync with backend BADGES)
const BADGE_DEFS = [
  { id: "day-1", days: 1 },
  { id: "7-day", days: 7 },
  { id: "15-day", days: 15 },
  { id: "30-day", days: 30 },
  { id: "60-day", days: 60 },
  { id: "100-day", days: 100 },
  { id: "goal-completion", days: 0 }, // Special case - goal completion badge
];

function updateBadgeIndicator() {
  if (!openBadgesBtn) return;
  const current =
    state && Number(state.currentStreak) ? Number(state.currentStreak) : 0;
  const totalDays =
    state && Number(state.totalDays) ? Number(state.totalDays) : 30;
  const completedDays =
    state && state.daysCompleted ? state.daysCompleted.length : 0;
  const claimedSet = new Set(
    state && state.claimedBadges ? state.claimedBadges : []
  );

  // determine if there is any badge the user is eligible for but hasn't claimed yet
  const hasNew = BADGE_DEFS.some((b) => {
    if (b.id === "goal-completion") {
      // For goal completion badge, check if all days are completed
      return completedDays >= totalDays && !claimedSet.has(b.id);
    } else {
      // For streak-based badges, check current streak
      return current >= b.days && !claimedSet.has(b.id);
    }
  });

  const existing = openBadgesBtn.querySelector(".badge-indicator");
  if (hasNew && !existing) {
    const dot = document.createElement("span");
    dot.className = "badge-indicator";
    dot.setAttribute("aria-hidden", "true");
    openBadgesBtn.appendChild(dot);
  } else if (!hasNew && existing) {
    existing.remove();
  }
}

function renderCalendar(totalDays, daysCompleted = []) {
  calendarGrid.innerHTML = "";
  // compute the current goal day index relative to startDate (if available)
  let todayIndex = 0;
  try {
    if (state && state.startDate) {
      // startDate is stored as YYYY-MM-DD in the model
      const start = new Date(state.startDate + "T00:00:00");
      const today = new Date();
      // normalize to midnight to avoid timezone hour issues
      const startMid = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
      );
      const todayMid = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const diff = Math.floor((todayMid - startMid) / 86400000) + 1; // day 1 is start date
      if (diff >= 1) todayIndex = Math.min(diff, totalDays || 30);
      else todayIndex = 0; // start date is in the future
    } else {
      // fallback: use current day-of-month (best-effort)
      todayIndex = Math.min(new Date().getDate(), totalDays || 30);
    }
  } catch (e) {
    todayIndex = Math.min(new Date().getDate(), totalDays || 30);
  }
  for (let i = 1; i <= totalDays; i++) {
    const d = document.createElement("div");
    d.className = "day" + (totalDays > 60 ? " small" : "");
    d.textContent = i;
    d.dataset.day = i;
    if (daysCompleted.includes(i)) d.classList.add("completed");
    // disable future days (relative to goal start)
    if (todayIndex === 0) {
      // if start is in future, disable all days
      d.classList.add("disabled");
    } else if (i > todayIndex) d.classList.add("disabled");
    d.addEventListener("click", () => toggleDay(i, d));
    calendarGrid.appendChild(d);
  }
}

// compute current goal day relative to startDate (1-based), or 0 if start is in future
function computeCurrentGoalDayForState(s) {
  if (!s) return 0;
  const totalDays = s.totalDays || 30;
  try {
    if (s.startDate) {
      const start = new Date(s.startDate + "T00:00:00");
      const today = new Date();
      const startMid = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
      );
      const todayMid = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const diff = Math.floor((todayMid - startMid) / 86400000) + 1;
      if (diff >= 1) return Math.min(diff, totalDays);
      return 0;
    }
    return Math.min(new Date().getDate(), totalDays);
  } catch (e) {
    return Math.min(new Date().getDate(), totalDays);
  }
}

async function fetchGoal() {
  // deprecated: keep for backward compatibility
  try {
    const res = await fetchWithTimeout(`${API_BASE}/get-goal`, {}, 8000);
    const data = await res.json();
    state = data;
    if (!data) {
      renderCalendar(30, []);
      remainingDaysEl.textContent = 30;
      return;
    }
    applyStateToUI(data);
  } catch (err) {
    console.error("fetchGoal error", err);
    showToast("Unable to fetch latest goal; using local data if available.");
    // try cache
    const cached = loadCache();
    if (cached) applyStateToUI(cached);
  }
}

function applyStateToUI(data) {
  state = data;
  // guard DOM updates in case elements are missing (prevents runtime errors)
  if (goalInput) goalInput.value = (data && data.goal) || "";
  if (totalDaysInput) totalDaysInput.value = (data && data.totalDays) || 30;
  if (currentStreakEl)
    currentStreakEl.textContent = (data && data.currentStreak) || 0;
  if (bestStreakEl) bestStreakEl.textContent = (data && data.bestStreak) || 0;
  if (totalCompletedEl)
    totalCompletedEl.textContent =
      (data && (data.daysCompleted || []).length) || 0;
  if (remainingDaysEl && data)
    remainingDaysEl.textContent =
      (data.totalDays || 30) - (data.daysCompleted || []).length;
  if (quoteEl) quoteEl.textContent = pickQuote();
  renderCalendar(
    (data && data.totalDays) || 30,
    (data && data.daysCompleted) || []
  );
  try {
    if (typeof updateCanvas === "function") {
      updateCanvas(
        ((data && (data.daysCompleted || []).length) /
          ((data && data.totalDays) || 30)) *
          100
      );
    }
  } catch (e) {
    console.warn("updateCanvas error", e);
  }
  // rewards UI (guarded)
  const pointsEl = document.getElementById("points");
  if (pointsEl) pointsEl.textContent = (data && data.points) || 0;
  const levelEl = document.getElementById("level");
  if (levelEl) levelEl.textContent = (data && data.level) || "Beginner";
  const badgesEl = document.getElementById("badgesList");
  if (badgesEl)
    badgesEl.textContent =
      data && data.badges && data.badges.length ? data.badges.join(", ") : "—";
  // render small claimed badges below the label
  updateClaimedBadgesUI((data && data.claimedBadges) || []);
  const startLabel = document.getElementById("startDateLabel");
  if (startLabel) startLabel.textContent = (data && data.startDate) || "—";
  const currentGoalDayEl = document.getElementById("currentGoalDay");
  if (currentGoalDayEl)
    currentGoalDayEl.textContent = computeCurrentGoalDayForState(data) || "—";
  // reminder UI: set hour/min/ampm selects and toggle
  const hourSel = document.getElementById("reminderHour");
  const minSel = document.getElementById("reminderMinute");
  const ampmSel = document.getElementById("reminderAmPm");
  const toggle = document.getElementById("reminderToggle");
  if (hourSel && minSel && ampmSel) {
    if (data && data.reminderTime) setInputsFrom24h(data.reminderTime);
  }
  if (toggle) {
    toggle.checked = !!data.remindersEnabled;
    updateReminderStateUI(!!data.remindersEnabled);
  }
  // (re)start reminder scheduler if enabled
  setupReminderScheduler();
  // update the badges indicator on the Show Badges button
  try {
    updateBadgeIndicator();
  } catch (e) {
    console.warn("badge indicator error", e);
  }
  // update mark as completed button visibility
  try {
    updateMarkCompletedButton(data);
  } catch (e) {
    console.warn("mark completed button error", e);
  }
  // load resources for the current goal
  try {
    if (typeof renderResources === "function") {
      renderResources().catch((err) =>
        console.warn("renderResources error", err)
      );
    }
  } catch (e) {
    console.warn("renderResources call error", e);
  }
}

// ----- Badges modal and interactions -----
function updateClaimedBadgesUI(claimed) {
  if (!claimedBadgesContainer) return;
  claimedBadgesContainer.innerHTML = "";
  if (!Array.isArray(claimed) || claimed.length === 0) return;
  // Local badge metadata (mirrors backend BADGES)
  const BADGES = [
    {
      id: "day-1",
      title: "Starting Badge",
      days: 1,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/day-1-badge-starting-badge_t8xdrn.png",
    },
    {
      id: "7-day",
      title: "7 Day Badge",
      days: 7,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/7-day-badge_ydr6g7.png",
    },
    {
      id: "15-day",
      title: "15 Days Badge",
      days: 15,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/15-days-badge_zuojgs.png",
    },
    {
      id: "30-day",
      title: "30 Days Badge",
      days: 30,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/30-days-badge_cpzjgt.png",
    },
    {
      id: "60-day",
      title: "60 Days Badge",
      days: 60,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/60-days-badge_pqv62a.png",
    },
    {
      id: "100-day",
      title: "100 Days Badge",
      days: 100,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/100-days-badge_tz1v54.png",
    },
    {
      id: "goal-completion",
      title: "Goal Completion Badge",
      days: 0,
      img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1762017561/goal-completetion-badge_bdcbxn.png",
    },
  ];
  const IMAGES = BADGES.reduce((acc, b) => {
    acc[b.id] = b.img;
    return acc;
  }, {});
  for (const id of claimed) {
    const img = document.createElement("img");
    img.src = IMAGES[id] || "";
    img.alt = id;
    img.width = 28;
    img.height = 28;
    img.loading = "lazy";
    // allow clicking small claimed badge to view the celebration popup
    img.style.cursor = "pointer";
    img.title = "View badge";
    const badgeMeta = BADGES.find((x) => x.id === id) || {
      id,
      img: IMAGES[id],
    };
    img.addEventListener("click", () => {
      try {
        showBadgeCelebrate(badgeMeta);
      } catch (e) {
        console.warn("celebrate error", e);
      }
    });
    claimedBadgesContainer.appendChild(img);
  }
}

async function fetchBadgesForGoal() {
  if (!state || !state._id) return showToast("Select a goal to view badges");

  // Check if it's a valid backend ID
  if (!isValidBackendId(state._id)) {
    showToast("Badges not available for local goals");
    return;
  }

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/badges`,
      {},
      8000
    );
    if (res.status === 404) {
      // goal does not exist on the server (may be a local/unsynced goal)
      // throw so we run the local fallback path below (build badges from local state)
      throw new Error("not-found");
    }
    if (!res.ok) throw new Error("failed");
    const js = await res.json();
    return js.badges || [];
  } catch (e) {
    console.warn("fetchBadgesForGoal failed", e);
    // fallback: construct badges locally from known metadata and local state
    try {
      const localBADGES = [
        {
          id: "day-1",
          title: "Starting Badge",
          days: 1,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/day-1-badge-starting-badge_t8xdrn.png",
        },
        {
          id: "7-day",
          title: "7 Day Badge",
          days: 7,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/7-day-badge_ydr6g7.png",
        },
        {
          id: "15-day",
          title: "15 Days Badge",
          days: 15,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/15-days-badge_zuojgs.png",
        },
        {
          id: "30-day",
          title: "30 Days Badge",
          days: 30,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/30-days-badge_cpzjgt.png",
        },
        {
          id: "60-day",
          title: "60 Days Badge",
          days: 60,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/60-days-badge_pqv62a.png",
        },
        {
          id: "100-day",
          title: "100 Days Badge",
          days: 100,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/100-days-badge_tz1v54.png",
        },
        {
          id: "goal-completion",
          title: "Goal Completion Badge",
          days: 0,
          img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1762017561/goal-completetion-badge_bdcbxn.png",
        },
      ];
      const current = state && state.currentStreak ? state.currentStreak : 0;
      const totalDays = state && state.totalDays ? state.totalDays : 30;
      const completedDays =
        state && state.daysCompleted ? state.daysCompleted.length : 0;
      const earnedSet = new Set(state && state.badges ? state.badges : []);
      const claimedSet = new Set(
        state && state.claimedBadges ? state.claimedBadges : []
      );
      const items = localBADGES.map((b) => {
        let eligible;
        if (b.id === "goal-completion") {
          eligible = completedDays >= totalDays;
        } else {
          eligible = current >= b.days;
        }

        return {
          id: b.id,
          title: b.title,
          days: b.days,
          img: b.img,
          earned: earnedSet.has(b.id),
          claimed: claimedSet.has(b.id),
          eligible: eligible,
        };
      });
      showToast("Using local badge data (offline)");
      return items;
    } catch (inner) {
      showToast("Unable to load badges right now");
      return [];
    }
  }
}

function openBadgesModalHandler() {
  if (!state || !state._id) return showToast("Select a goal first");
  badgesModal.setAttribute("aria-hidden", "false");
  badgesGrid.innerHTML =
    '<div style="padding:18px; color: var(--muted)">Loading...</div>';
  fetchBadgesForGoal().then(renderBadgesModal);
}

function closeBadgesModalHandler() {
  badgesModal.setAttribute("aria-hidden", "true");
  badgesGrid.innerHTML = "";
}

function renderBadgesModal(items) {
  badgesGrid.innerHTML = "";
  if (!items || items.length === 0) {
    badgesGrid.innerHTML =
      '<div style="padding:18px; color: var(--muted)">No badges available</div>';
    return;
  }
  for (const b of items) {
    const card = document.createElement("div");
    // Show badge as blurred (locked) until it's actually claimed.
    // Eligible-but-unclaimed badges remain blurred so user must claim to unlock.
    card.className = "badge-card" + (b.claimed ? "" : " locked");
    const status = document.createElement("div");
    status.className = "status-chip";
    status.textContent = b.claimed
      ? "Claimed"
      : b.eligible
      ? "Available"
      : `Locked`;
    card.appendChild(status);

    const img = document.createElement("img");
    img.src = b.img;
    img.alt = b.title;
    img.width = 96;
    img.height = 96;
    img.loading = "lazy";
    img.decoding = "async";
    card.appendChild(img);

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = b.title;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    // Don't show "0 days" for goal completion badge
    if (b.id === "goal-completion") {
      meta.textContent = "Complete all goal days";
    } else {
      meta.textContent = `${b.days} day${b.days > 1 ? "s" : ""}`;
    }
    card.appendChild(meta);

    if (!b.eligible) {
      const lock = document.createElement("div");
      lock.className = "lock-overlay";
      lock.textContent = "🔒";
      card.appendChild(lock);
    }

    if (b.eligible && !b.claimed) {
      const btn = document.createElement("button");
      btn.className = "claim-btn";
      btn.textContent = "Claim";
      btn.addEventListener("click", async () => {
        try {
          btn.disabled = true;
          const res = await fetchWithTimeout(
            `${API_BASE}/goals/${state._id}/claim-badge`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ badgeId: b.id }),
            },
            9000
          );
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            const errMsg = (j && j.error) || "claim failed";
            // If server doesn't expose the endpoint (404) or is unavailable, enqueue and optimistically update
            if (res.status === 404 || res.status === 503 || res.status === 0) {
              enqueueSync({
                type: "claim_badge",
                payload: { id: state && state._id, badgeId: b.id },
              });
              state.claimedBadges = Array.from(
                new Set([...(state.claimedBadges || []), b.id])
              );
              state.badges = Array.from(
                new Set([...(state.badges || []), b.id])
              );
              // reflect claimed state in UI and remove blur
              status.textContent = "Claimed";
              card.classList.remove("locked");
              try {
                showBadgeCelebrate(b);
              } catch (e) {
                console.warn("celebrate error", e);
              }
              btn.remove();
              updateClaimedBadgesUI(state.claimedBadges || []);
              try {
                updateBadgeIndicator();
              } catch (e) {
                console.warn("badge indicator error", e);
              }
              showToast("Claim queued — will sync when online");
              return;
            }
            // for other failures, raise to the catch block
            throw new Error(errMsg);
          }
          const js = await res.json();
          // update local state and UI
          state.claimedBadges = js.claimedBadges || state.claimedBadges || [];
          state.badges = js.badges || state.badges || [];
          status.textContent = "Claimed";
          // remove locked blur when server confirms claim
          card.classList.remove("locked");
          try {
            showBadgeCelebrate(b);
          } catch (e) {
            console.warn("celebrate error", e);
          }
          btn.remove();
          updateClaimedBadgesUI(state.claimedBadges || []);
          try {
            updateBadgeIndicator();
          } catch (e) {
            console.warn("badge indicator error", e);
          }
          showToast("Badge claimed!");
        } catch (err) {
          console.error("claim err", err);
          // Enqueue claim to be retried later (server may be unavailable or goal unsynced)
          enqueueSync({
            type: "claim_badge",
            payload: { id: state && state._id, badgeId: b.id },
          });
          // Optimistically update UI as claimed so user sees feedback
          state.claimedBadges = Array.from(
            new Set([...(state.claimedBadges || []), b.id])
          );
          state.badges = Array.from(new Set([...(state.badges || []), b.id]));
          status.textContent = "Claimed";
          // reflect claimed state immediately and remove locked styling
          card.classList.remove("locked");
          try {
            showBadgeCelebrate(b);
          } catch (e) {
            console.warn("celebrate error", e);
          }
          btn.remove();
          updateClaimedBadgesUI(state.claimedBadges || []);
          try {
            updateBadgeIndicator();
          } catch (e) {
            console.warn("badge indicator error", e);
          }
          showToast("Claim queued — will sync when online");
        }
      });
      card.appendChild(btn);
    }

    // Do not append 'Already claimed' text below the badge image; statusChip already indicates claimed state.

    // If this badge is already claimed, make the whole card interactive to view the celebration
    if (b.claimed) {
      card.classList.add("claimed");
      card.addEventListener("click", (e) => {
        // if the click originated from a button inside the card, ignore (safety)
        if (e.target && e.target.closest && e.target.closest("button")) return;
        try {
          showBadgeCelebrate(b);
        } catch (err) {
          console.warn("celebrate error", err);
        }
      });
    }

    badgesGrid.appendChild(card);
  }
}

// Celebration: 3D rotating badge + particle burst
function showBadgeCelebrate(b) {
  try {
    const overlay = document.createElement("div");
    overlay.className = "badge-celebrate-overlay";
    overlay.innerHTML = `
      <div class="celebrate-backdrop"></div>
      <div class="celebrate-panel" role="dialog" aria-label="Badge celebration">
        <button class="celebrate-close" aria-label="Close celebration">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="celebrate-badge">
          <div class="badge-surface" style="background-image: url('${b.img.replace(
            /'/g,
            "\\'"
          )}');"></div>
        </div>
        <canvas class="celebrate-canvas"></canvas>
      </div>`;
    document.body.appendChild(overlay);

    const panel = overlay.querySelector(".celebrate-panel");
    const canvasEl = overlay.querySelector("canvas");
    const ctx = canvasEl.getContext("2d");

    function resize() {
      const r = window.devicePixelRatio || 1;
      canvasEl.width = panel.clientWidth * r;
      canvasEl.height = panel.clientHeight * r;
      canvasEl.style.width = panel.clientWidth + "px";
      canvasEl.style.height = panel.clientHeight + "px";
      ctx.setTransform(r, 0, 0, r, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    const colors = ["#4f46e5", "#f59e0b", "#10b981", "#ec4899"];
    const particles = [];
    let last = performance.now();
    let running = true;
    let rafId = null;

    function spawnBurst(count = 36) {
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.6 - 0.3);
        particles.push({
          angle,
          speed: 120 + Math.random() * 180,
          life: 900 + Math.random() * 900,
          age: 0,
          color: colors[i % colors.length],
          size: 3 + Math.random() * 5,
        });
      }
    }

    // spawn initial burst and then repeat while running to keep animation visible
    spawnBurst(36);
    const burstTimer = setInterval(() => {
      if (!running) return;
      spawnBurst(18 + Math.floor(Math.random() * 18));
    }, 1200);
    function hexToRgba(hex, a) {
      const bigint = parseInt(hex.replace("#", ""), 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r},${g},${b},${a})`;
    }

    function frame(ts) {
      const dt = ts - last;
      last = ts;
      // update center in case panel resized
      const centerX = panel.clientWidth / 2;
      const centerY = panel.clientHeight / 2;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        const prog = p.age / p.life;
        const dist = p.speed * easeOutCubic(prog);
        const x = centerX + Math.cos(p.angle) * dist;
        const y = centerY + Math.sin(p.angle) * dist * 0.6; // elliptical arc
        const alpha = Math.max(0, 1 - prog);
        const rad = p.size * (1 + prog * 1.2);
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
        grd.addColorStop(0, hexToRgba(p.color, Math.min(1, alpha * 1.0)));
        grd.addColorStop(1, hexToRgba(p.color, 0));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // continue while running (producing bursts) or while particles remain
      if (running || particles.length > 0) {
        rafId = requestAnimationFrame(frame);
      }
    }

    rafId = requestAnimationFrame(frame);

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    // close button handling: stop spawning and remove overlay when clicked
    const closeBtn = overlay.querySelector(".celebrate-close");
    function cleanup() {
      running = false;
      clearInterval(burstTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      overlay.remove();
    }
    closeBtn.addEventListener("click", () => {
      try {
        // fade out then cleanup
        panel.classList.add("fade-out");
        setTimeout(cleanup, 420);
      } catch (e) {
        cleanup();
      }
    });
  } catch (e) {
    console.warn("showBadgeCelebrate error", e);
  }
}

// wire modal open/close events
if (openBadgesBtn)
  openBadgesBtn.addEventListener("click", openBadgesModalHandler);
if (closeBadgesBtn)
  closeBadgesBtn.addEventListener("click", closeBadgesModalHandler);
// backdrop click
document.addEventListener("click", (e) => {
  if (!badgesModal) return;
  const target = e.target;
  if (target && target.dataset && target.dataset.close === "true")
    closeBadgesModalHandler();
});
// close on Escape
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    badgesModal &&
    badgesModal.getAttribute("aria-hidden") === "false"
  )
    closeBadgesModalHandler();
});

// populate hour/min selectors (12-hour, India friendly)
function populateTimeSelectors() {
  const hourSel = document.getElementById("reminderHour");
  const minSel = document.getElementById("reminderMinute");
  if (hourSel && hourSel.children.length === 0) {
    for (let h = 1; h <= 12; h++) {
      const o = document.createElement("option");
      o.value = String(h).padStart(2, "0");
      o.textContent = String(h).padStart(2, "0");
      hourSel.appendChild(o);
    }
  }
  if (minSel && minSel.children.length === 0) {
    for (let m = 0; m < 60; m++) {
      const o = document.createElement("option");
      o.value = String(m).padStart(2, "0");
      o.textContent = String(m).padStart(2, "0");
      minSel.appendChild(o);
    }
  }
}

function setInputsFrom24h(time24) {
  if (!time24) return;
  const [hhStr, mm] = time24.split(":");
  let hh = Number(hhStr);
  const ampm = hh >= 12 ? "PM" : "AM";
  if (hh === 0) hh = 12;
  if (hh > 12) hh = hh - 12;
  const hourSel = document.getElementById("reminderHour");
  const minSel = document.getElementById("reminderMinute");
  const ampmSel = document.getElementById("reminderAmPm");
  if (hourSel)
    hourSel.value = String(
      hourSel.querySelector(`option[value="${String(hh).padStart(2, "0")}"]`)
        ? String(hh).padStart(2, "0")
        : String(hh)
    );
  if (minSel) minSel.value = mm || "00";
  if (ampmSel) ampmSel.value = ampm;
}

function build24hFromInputs() {
  const hourSel = document.getElementById("reminderHour");
  const minSel = document.getElementById("reminderMinute");
  const ampmSel = document.getElementById("reminderAmPm");
  if (!hourSel || !minSel || !ampmSel) return "";
  let hh = Number(hourSel.value);
  const mm = String(minSel.value).padStart(2, "0");
  const ampm = ampmSel.value;
  if (ampm === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh = hh + 12;
  }
  return String(hh).padStart(2, "0") + ":" + mm;
}

async function fetchGoals() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/goals`, {}, 8000);
    const data = await res.json();
    goals = data || [];
    populateGoalSelect();
    if (goals.length > 0) {
      // Try to find default goal in the fetched goals first
      let goalToSelect = null;

      // Check if any goal is marked as default in the fetched data
      const defaultGoal = goals.find((g) => g.isDefault === true);
      if (defaultGoal && defaultGoal._id) {
        goalToSelect = defaultGoal._id;
        console.log("Found default goal in fetched data:", defaultGoal.goal);
      } else {
        // If no default found in fetched data, try fetching default endpoint
        try {
          const defaultRes = await fetchWithTimeout(
            `${API_BASE}/goals/default`,
            {},
            8000
          );
          const defaultGoalData = await defaultRes.json();
          if (defaultGoalData && defaultGoalData._id) {
            goalToSelect = defaultGoalData._id;
            console.log(
              "Found default goal from endpoint:",
              defaultGoalData.goal
            );
            // Update the goals array to mark this as default
            goals.forEach((g) => {
              g.isDefault = g._id === defaultGoalData._id;
            });
          }
        } catch (defaultErr) {
          console.warn("Failed to fetch default goal, using first available");
        }
      }

      // If no default goal found, select the first one
      if (!goalToSelect) {
        goalToSelect = goals[0]._id;
        console.log("No default goal found, selecting first:", goals[0].goal);
      }

      selectGoal(goalToSelect);
    } else {
      // no goals yet
      state = null;
      renderCalendar(30, []);
      remainingDaysEl.textContent = 30;
      // auto-focus to assist entry
      goalInput.focus();
    }
    // cache fetched goals
    saveCache(state || null);
    // render compact goal cards in the right panel
    try {
      renderGoalCards();
    } catch (e) {
      /* noop if UI not ready */
    }
    // update completed goals count
    try {
      fetchCompletedGoalsCount();
    } catch (e) {
      /* noop if completed goals not ready */
    }
  } catch (err) {
    console.error("fetchGoals error", err);
    showToast("Failed to load goals from server; offline mode enabled.");
    // fallback to local cache
    const cached = loadCache();
    if (cached) {
      goals = [cached];
      populateGoalSelect();
      applyStateToUI(cached);
      try {
        renderGoalCards();
      } catch (e) {}
    }
  }
}

function populateGoalSelect() {
  if (!goalSelect) return;
  goalSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = goals.length ? "Select goal" : "No goals yet";
  goalSelect.appendChild(placeholder);
  goals.forEach((g) => {
    const o = document.createElement("option");
    o.value = g._id;
    o.textContent = `${g.goal} (${g.totalDays}d)`;
    goalSelect.appendChild(o);
  });
}

async function selectGoal(id) {
  if (!id) return;

  // Check if it's a valid backend ID
  if (!isValidBackendId(id)) {
    console.warn("Cannot select goal with invalid ID:", id);
    // For local goals, find them in the cached goals list instead
    const localGoal = goals.find((g) => g._id === id);
    if (localGoal) {
      applyStateToUI(localGoal);
    }
    return;
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/goals/${id}`, {}, 8000);
    const data = await res.json();
    applyStateToUI(data);
    // set select value
    if (goalSelect) goalSelect.value = id;
  } catch (err) {
    console.error("selectGoal error", err);
  }
}

async function saveGoal() {
  const goal = goalInput.value.trim();
  const totalDays = Number(totalDaysInput.value) || 30;
  if (!goal) {
    showToast("Please enter a goal name");
    return;
  }
  if (!Number.isFinite(totalDays) || totalDays < 1 || totalDays > 3650) {
    showToast("Please enter a reasonable goal duration (1 - 3650 days)");
    return;
  }
  // prevent duplicate local entry
  if (
    goals &&
    goals.some((g) => g.goal === goal && g.totalDays === totalDays)
  ) {
    showToast("A goal with the same name and duration already exists");
    return;
  }
  try {
    setButtonLoading(saveGoalBtn, true);
    const res = await fetchWithTimeout(
      `${API_BASE}/goals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, totalDays }),
      },
      9000
    );
    if (!res.ok) {
      const errorData = await res.json();
      if (res.status === 409) {
        throw new Error(
          errorData.error || "A goal with this name already exists"
        );
      }
      throw new Error(
        `Save failed ${res.status}: ${errorData.error || "Unknown error"}`
      );
    }
    const data = await res.json();
    // refresh list and select created goal
    await fetchGoals();
    if (data && data._id) selectGoal(data._id);
    setButtonSuccess(saveGoalBtn);
    showToast("Goal saved successfully");
    // clear success state after short delay
    setTimeout(() => setButtonLoading(saveGoalBtn, false), 900);
  } catch (err) {
    console.error(err);
    setButtonLoading(saveGoalBtn, false);

    // Handle different error types
    if (
      err.message.includes("already exists") ||
      err.message.includes("duplicate")
    ) {
      showToast(
        "A goal with this name already exists. Please choose a different name."
      );
      return; // Don't create local duplicate
    }

    showToast("Failed to save goal. Saved locally and will sync when online.");
    // fallback: store in local queue for sync
    enqueueSync({ type: "create_goal", payload: { goal, totalDays } });
    // create a local cached state so UI isn't empty
    const temp = {
      _id: `local-${Date.now()}`,
      goal,
      totalDays,
      daysCompleted: [],
      currentStreak: 0,
      bestStreak: 0,
    };
    goals.unshift(temp);
    populateGoalSelect();
    selectGoal(temp._id);
  }
}

async function setDefaultGoal(goalId) {
  // Check if it's a valid backend ID
  if (!isValidBackendId(goalId)) {
    showToast("Cannot set local goals as default. Please save the goal first.");
    return;
  }

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/set-default`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      8000
    );

    if (!res.ok) throw new Error(`Failed to set default goal: ${res.status}`);

    // Update local goals array to reflect the change
    goals.forEach((g) => {
      g.isDefault = g._id === goalId;
    });

    // Select the default goal in the main UI and update dropdown
    await selectGoal(goalId);

    // Re-render goal cards to update radio buttons and styling
    renderGoalCards();

    const goalName = goals.find((g) => g._id === goalId)?.goal || "goal";
    showToast(`"${goalName}" set as default goal`);
  } catch (err) {
    console.error("setDefaultGoal error", err);
    showToast("Failed to set default goal. Will retry when online.");
    // Fallback: store in local queue for sync
    enqueueSync({ type: "set_default_goal", payload: { goalId } });

    // Even in offline mode, update the UI to show the selected goal
    try {
      goals.forEach((g) => {
        g.isDefault = g._id === goalId;
      });
      await selectGoal(goalId);
      renderGoalCards();

      const goalName = goals.find((g) => g._id === goalId)?.goal || "goal";
      showToast(`"${goalName}" set as default (will sync when online)`);
    } catch (localErr) {
      console.warn("Failed to update UI locally:", localErr);
    }
  }
}

async function toggleDay(day, node) {
  const completed = node.classList.contains("completed");
  try {
    if (!state || !state._id) throw new Error("No goal selected");

    // Check if it's a valid backend ID
    if (!isValidBackendId(state._id)) {
      showToast(
        "Cannot update streak for local goal. Please save the goal first."
      );
      return;
    }
    // verify server date to avoid system-clock manipulation
    try {
      const svr = await fetchWithTimeout(`${API_BASE}/server-date`, {}, 5000);
      const js = await svr.json();
      const serverDateStr = (js && js.serverDate) || lastServerDate;
      if (serverDateStr) {
        const serverDay = serverDateStr.split("T")[0];
        const localDay = new Date().toISOString().split("T")[0];
        if (serverDay !== localDay) {
          showToast("Date mismatch detected. Please check your system clock.");
          return;
        }
      }
    } catch (e) {
      // if server date check fails, proceed but log (conservative approach)
      console.warn("server-date check failed", e);
    }
    // restriction: allow only marking the current goal day (computed from startDate)
    const totalDays = state.totalDays || 30;
    let todayIndex = 0;
    if (state && state.startDate) {
      const start = new Date(state.startDate + "T00:00:00");
      const today = new Date();
      const startMid = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
      );
      const todayMid = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const diff = Math.floor((todayMid - startMid) / 86400000) + 1;
      if (diff >= 1) todayIndex = Math.min(diff, totalDays);
      else todayIndex = 0;
    } else {
      todayIndex = Math.min(new Date().getDate(), totalDays);
    }
    if (todayIndex === 0) {
      showToast(
        "Goal hasn't started yet — marking will be available when the goal starts."
      );
      return;
    }
    if (day > todayIndex) {
      showToast("You can only mark today; future days are disabled.");
      return;
    }
    if (day !== todayIndex) {
      showToast("You can only mark the current goal day.");
      return;
    }
    if (completed) {
      // prevent un-marking today's done status
      showToast("Today's completion is already recorded.");
      return;
    }
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/update-streak`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, mark: !completed }),
      },
      9000
    );
    const data = await res.json();
    state = data;
    // re-render
    renderCalendar(data.totalDays || 30, data.daysCompleted || []);
    currentStreakEl.textContent = data.currentStreak || 0;
    bestStreakEl.textContent = data.bestStreak || 0;
    totalCompletedEl.textContent = (data.daysCompleted || []).length;
    remainingDaysEl.textContent =
      (data.totalDays || 30) - (data.daysCompleted || []).length;
    updateCanvas(
      ((data.daysCompleted || []).length / (data.totalDays || 30)) * 100
    );
    try {
      updateBadgeIndicator();
    } catch (e) {
      console.warn("badge indicator error", e);
    }
    try {
      updateMarkCompletedButton(data);
    } catch (e) {
      console.warn("mark completed button error", e);
    }
    flashSyncIcon();
  } catch (err) {
    console.error(err);
    showToast("Failed to mark day. Action stored locally and will sync.");
    enqueueSync({
      type: "toggle_day",
      payload: { id: state && state._id, day, mark: true },
    });
  }
}

async function resetStreak() {
  if (!confirm("Reset streak? This will uncheck all days but keep the goal."))
    return;
  try {
    setButtonLoading(resetBtn, true);
    if (!state || !state._id) {
      alert("No goal selected");
      setButtonLoading(resetBtn, false);
      return;
    }
    const res = await fetch(`${API_BASE}/goals/${state._id}/reset`, {
      method: "POST",
    });
    const data = await res.json();
    state = data;
    await fetchGoals();
    selectGoal(state._id);
    showToast("Streak reset successfully");
    setButtonLoading(resetBtn, false);
  } catch (err) {
    console.error(err);
    showToast("Failed to reset streak. Will attempt to sync later.");
    enqueueSync({ type: "reset", payload: { id: state && state._id } });
    setButtonLoading(resetBtn, false);
  }
}

async function editGoal() {
  const goal = goalInput.value.trim();
  const totalDays = Number(totalDaysInput.value) || 30;
  if (!state) {
    alert("Save a goal first");
    return;
  }
  try {
    setButtonLoading(editGoalBtn, true);
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/edit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, totalDays }),
      },
      9000
    );
    if (!res.ok) throw new Error("Edit failed");
    const data = await res.json();
    state = data;
    await fetchGoals();
    selectGoal(state._id);
    setButtonSuccess(editGoalBtn);
    setTimeout(() => setButtonLoading(editGoalBtn, false), 700);
  } catch (err) {
    console.error(err);
    setButtonLoading(editGoalBtn, false);
    showToast("Failed to edit goal; will sync later.");
    enqueueSync({ type: "edit", payload: { id: state._id, goal, totalDays } });
  }
}

async function deleteGoal() {
  if (!state || !state._id) return alert("No goal selected");
  if (!confirm("Delete this goal? This cannot be undone.")) return;
  try {
    setButtonLoading(deleteGoalBtn, true);
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}`,
      { method: "DELETE" },
      9000
    );
    const data = await res.json();
    await fetchGoals();
    showToast("Goal deleted");
    setButtonLoading(deleteGoalBtn, false);
  } catch (err) {
    console.error(err);
    showToast(
      "Failed to delete goal; will remove locally and attempt to sync later."
    );
    enqueueSync({ type: "delete", payload: { id: state._id } });
    setButtonLoading(deleteGoalBtn, false);
  }
}

// Canvas progress ring
function updateCanvas(percent) {
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 12;
  // optimized animation: only one animation frame loop at a time
  const target = Math.max(0, Math.min(100, percent || 0));
  if (canvas._animFrame) cancelAnimationFrame(canvas._animFrame);
  const startTime = performance.now();
  const startPercent = canvas._lastPercent || 0;
  const duration = 700;

  function drawFrame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const p = startPercent + (target - startPercent) * eased;
    ctx.clearRect(0, 0, size, size);
    // background
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#eef2ff";
    ctx.lineWidth = 12;
    ctx.stroke();
    // arc
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * (p / 100);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#1e90ff");
    grad.addColorStop(1, "#22c55e");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.stroke();
    // text
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 18px Poppins, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(p) + "%", cx, cy);
    if (t < 1) {
      canvas._animFrame = requestAnimationFrame(drawFrame);
    } else {
      canvas._lastPercent = target;
      canvas._animFrame = null;
    }
  }
  canvas._animFrame = requestAnimationFrame(drawFrame);
}

// events
saveGoalBtn.addEventListener("click", saveGoal);
resetBtn.addEventListener("click", resetStreak);
editGoalBtn.addEventListener("click", editGoal);
goalSelect.addEventListener("change", (e) => selectGoal(e.target.value));
deleteGoalBtn.addEventListener("click", deleteGoal);

// === Study Resources Functionality ===
const resourceUrlInput = document.getElementById("resourceUrlInput");
const resourceNoteInput = document.getElementById("resourceNoteInput");
const addResourceBtn = document.getElementById("addResourceBtn");
const resourcesList = document.getElementById("resourcesList");

// Extract domain from URL for favicon
function getFaviconUrl(url) {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
  } catch (e) {
    return "https://www.google.com/s2/favicons?domain=example.com&sz=64";
  }
}

// Validate URL format
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Get display title from URL
function getUrlTitle(url) {
  try {
    const urlObj = new URL(url);
    // Remove www. and get hostname
    let hostname = urlObj.hostname.replace(/^www\./, "");
    // Get pathname without trailing slash
    let path = urlObj.pathname.replace(/\/$/, "");

    if (path && path !== "/") {
      // If there's a meaningful path, combine hostname with path
      return hostname + path;
    }
    return hostname;
  } catch (e) {
    return url;
  }
}

// Render resources list
async function renderResources() {
  if (!resourcesList) return;
  if (!state || !state._id) {
    resourcesList.innerHTML =
      '<div class="resources-empty">Select a goal to manage resources</div>';
    return;
  }

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/resources`,
      {},
      8000
    );
    const data = await res.json();
    const resources = data.resources || [];

    if (resources.length === 0) {
      resourcesList.innerHTML =
        '<div class="resources-empty">No resources added yet</div>';
      return;
    }

    resourcesList.innerHTML = "";
    resources.forEach((resource) => {
      const card = document.createElement("div");
      card.className = "resource-card";
      card.dataset.id = resource._id;

      // Top row: favicon + content
      const topRow = document.createElement("div");
      topRow.className = "resource-card-top";

      // Favicon
      const faviconDiv = document.createElement("div");
      faviconDiv.className = "resource-favicon";
      if (resource.url && resource.url.trim()) {
        const img = document.createElement("img");
        img.src = getFaviconUrl(resource.url);
        img.alt = "";
        img.onerror = () => {
          faviconDiv.innerHTML = "🔗";
        };
        faviconDiv.appendChild(img);
      } else {
        faviconDiv.innerHTML = "📝";
      }

      // Content
      const contentDiv = document.createElement("div");
      contentDiv.className = "resource-content";

      if (resource.url && resource.url.trim()) {
        const urlLink = document.createElement("a");
        urlLink.href = resource.url;
        urlLink.target = "_blank";
        urlLink.rel = "noopener noreferrer";
        urlLink.className = "resource-url-text";
        urlLink.textContent = getUrlTitle(resource.url);
        urlLink.title = resource.url;
        contentDiv.appendChild(urlLink);
      }

      topRow.appendChild(faviconDiv);
      topRow.appendChild(contentDiv);
      card.appendChild(topRow);

      // Note (if exists)
      if (resource.note && resource.note.trim()) {
        const noteP = document.createElement("p");
        noteP.className = "resource-note-text";
        noteP.textContent = resource.note;
        card.appendChild(noteP);
      }

      // Actions
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "resource-actions";

      if (resource.url && resource.url.trim()) {
        const openBtn = document.createElement("button");
        openBtn.className = "resource-open-btn";
        openBtn.textContent = "Open";
        openBtn.onclick = () =>
          window.open(resource.url, "_blank", "noopener,noreferrer");
        actionsDiv.appendChild(openBtn);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "resource-delete-btn";
      deleteBtn.innerHTML = "×";
      deleteBtn.title = "Delete resource";
      deleteBtn.onclick = () => deleteResource(resource._id);
      actionsDiv.appendChild(deleteBtn);

      card.appendChild(actionsDiv);
      resourcesList.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load resources", err);
    resourcesList.innerHTML =
      '<div class="resources-empty">Failed to load resources</div>';
  }
}

// --- Resources modal: fetch and render resources for a specific goal ---
async function fetchResourcesForGoal(goalId) {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/resources`,
      {},
      8000
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.resources || [];
  } catch (e) {
    console.warn("fetchResourcesForGoal error", e);
    return [];
  }
}

function openResourcesModal(goalId) {
  const modal = document.getElementById("resourcesModal");
  const list = document.getElementById("resourcesModalList");
  const title = document.getElementById("resourcesModalTitle");
  if (!modal || !list) return;
  // find goal title if available
  let goalTitle = "Resources";
  try {
    const g = goals.find((x) => x._id === goalId);
    if (g && g.goal) goalTitle = `Resources — ${g.goal}`;
  } catch (e) {}
  if (title) title.textContent = goalTitle;
  modal.setAttribute("aria-hidden", "false");
  modal.style.display = "flex";
  // lock background scrolling while modal is open
  try {
    document.body.style.overflow = "hidden";
  } catch (e) {}
  list.innerHTML = '<div class="resources-empty">Loading…</div>';
  // focus close button for keyboard users (delay to ensure element exists)
  setTimeout(() => {
    const cb = document.getElementById("closeResourcesModalBtn");
    if (cb) cb.focus();
  }, 60);
  // attach Escape handler to close modal
  const esc = (ev) => {
    if (ev.key === "Escape") closeResourcesModal();
  };
  modal._esc = esc;
  document.addEventListener("keydown", esc);
  // fetch and render
  fetchResourcesForGoal(goalId).then((resources) => {
    renderResourcesInModal(resources, goalId);
  });
}

function closeResourcesModal() {
  const modal = document.getElementById("resourcesModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  modal.style.display = "none";
  try {
    document.body.style.overflow = "";
  } catch (e) {}
  if (modal._esc) {
    document.removeEventListener("keydown", modal._esc);
    modal._esc = null;
  }
}

async function deleteResourceForGoal(goalId, resourceId) {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/resource/${resourceId}`,
      { method: "DELETE" },
      8000
    );
    return res.ok;
  } catch (e) {
    console.warn("deleteResourceForGoal error", e);
    return false;
  }
}

function renderResourcesInModal(resources, goalId) {
  const list = document.getElementById("resourcesModalList");
  if (!list) return;
  if (!Array.isArray(resources) || resources.length === 0) {
    list.innerHTML =
      '<div class="resources-empty">No resources for this goal</div>';
    return;
  }
  list.innerHTML = "";
  resources.forEach((resource) => {
    const card = document.createElement("div");
    card.className = "resource-card";
    card.dataset.id = resource._id;

    const topRow = document.createElement("div");
    topRow.className = "resource-card-top";

    const faviconDiv = document.createElement("div");
    faviconDiv.className = "resource-favicon";
    if (resource.url && resource.url.trim()) {
      const img = document.createElement("img");
      img.src = getFaviconUrl(resource.url);
      img.alt = "";
      img.onerror = () => (faviconDiv.innerHTML = "🔗");
      faviconDiv.appendChild(img);
    } else {
      faviconDiv.innerHTML = "📝";
    }

    const contentDiv = document.createElement("div");
    contentDiv.className = "resource-content";
    if (resource.url && resource.url.trim()) {
      const a = document.createElement("a");
      a.href = resource.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "resource-url-text";
      a.textContent = getUrlTitle(resource.url);
      a.title = resource.url;
      contentDiv.appendChild(a);
    }
    if (resource.note && resource.note.trim()) {
      const p = document.createElement("p");
      p.className = "resource-note-text";
      p.textContent = resource.note;
      contentDiv.appendChild(p);
    }

    topRow.appendChild(faviconDiv);
    topRow.appendChild(contentDiv);
    card.appendChild(topRow);

    const actions = document.createElement("div");
    actions.className = "resource-actions";
    if (resource.url && resource.url.trim()) {
      const openBtn = document.createElement("button");
      openBtn.className = "resource-open-btn";
      openBtn.textContent = "Open";
      openBtn.onclick = () =>
        window.open(resource.url, "_blank", "noopener,noreferrer");
      actions.appendChild(openBtn);
    }
    const delBtn = document.createElement("button");
    delBtn.className = "resource-delete-btn";
    delBtn.innerHTML = "×";
    delBtn.title = "Delete resource";
    delBtn.onclick = async () => {
      if (!confirm("Delete this resource?")) return;
      delBtn.disabled = true;
      const ok = await deleteResourceForGoal(goalId, resource._id);
      if (ok) {
        // refresh list
        const resources2 = await fetchResourcesForGoal(goalId);
        renderResourcesInModal(resources2, goalId);
        showToast("Resource deleted");
      } else {
        showToast("Failed to delete resource");
        delBtn.disabled = false;
      }
    };
    actions.appendChild(delBtn);

    card.appendChild(actions);
    list.appendChild(card);
  });
}

// Add resource
async function addResource() {
  if (!state || !state._id) {
    showToast("Please select a goal first");
    return;
  }

  const rawUrl = resourceUrlInput.value.trim();
  const note = resourceNoteInput.value.trim();

  // Validate: at least one field required
  if (!rawUrl && !note) {
    showToast("Please enter a URL or a note");
    return;
  }

  // Normalize URL if provided: allow users to paste example.com and auto-prepend https://
  let normalizedUrl = rawUrl || "";
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  // Validate normalized URL (if provided)
  if (normalizedUrl && !isValidUrl(normalizedUrl)) {
    showToast("Please enter a valid URL (e.g. https://example.com)");
    return;
  }

  try {
    addResourceBtn.disabled = true;
    addResourceBtn.textContent = "Adding...";

    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/add-resource`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl, note }),
      },
      8000
    );

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to add resource");
    }

    // Clear inputs
    resourceUrlInput.value = "";
    resourceNoteInput.value = "";

    // Refresh resources list
    await renderResources();
    showToast("Resource added successfully");
  } catch (err) {
    console.error("Add resource error", err);
    if (err.message.includes("already exists")) {
      showToast("This URL is already saved for this goal");
    } else {
      showToast(err.message || "Failed to add resource");
    }
  } finally {
    addResourceBtn.disabled = false;
    addResourceBtn.textContent = "Add";
  }
}

// Delete resource
async function deleteResource(resourceId) {
  if (!state || !state._id) return;
  if (!confirm("Delete this resource?")) return;

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/resource/${resourceId}`,
      { method: "DELETE" },
      8000
    );

    if (!res.ok) {
      throw new Error("Failed to delete resource");
    }

    await renderResources();
    showToast("Resource deleted");
  } catch (err) {
    console.error("Delete resource error", err);
    showToast("Failed to delete resource");
  }
}

// Add event listener for add resource button
if (addResourceBtn) {
  addResourceBtn.addEventListener("click", addResource);
}

// Add enter key support for URL input
if (resourceUrlInput) {
  resourceUrlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addResource();
    }
  });
}

// init
// resources modal event wiring
const _resourcesModal = document.getElementById("resourcesModal");
const _closeResourcesModalBtn = document.getElementById(
  "closeResourcesModalBtn"
);
if (_closeResourcesModalBtn)
  _closeResourcesModalBtn.addEventListener("click", closeResourcesModal);
if (_resourcesModal) {
  _resourcesModal.addEventListener("click", (e) => {
    // close when clicking on backdrop (has data-close)
    if (e.target && e.target.dataset && e.target.dataset.close)
      closeResourcesModal();
  });
}
// helper utilities: fetch timeout, toast, button states, local cache and sync queue
function fetchWithTimeout(url, opts = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const merged = { ...opts, signal: controller.signal };
  return fetch(url, merged)
    .then((res) => {
      try {
        const sd = res.headers.get("X-Server-Date");
        if (sd) lastServerDate = sd;
      } catch (e) {}
      return res;
    })
    .finally(() => clearTimeout(id))
    .catch((err) => {
      // Normalize AbortError (which some browsers surface as "signal is aborted without reason")
      if (
        err &&
        (err.name === "AbortError" ||
          err.message === "signal is aborted without reason")
      ) {
        const e = new Error("request timeout");
        e.name = "TimeoutError";
        throw e;
      }
      throw err;
    });
}

function showToast(msg, ms = 3500) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove("show"), ms);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.classList.add("btn--loading");
    if (!btn.querySelector(".spinner")) {
      const s = document.createElement("span");
      s.className = "spinner";
      // use muted spinner on light background buttons
      if (btn.classList.contains("muted") || btn.classList.contains("muted")) {
        s.classList.add("spinner--muted");
      }
      btn.prepend(s);
    }
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.classList.remove("btn--loading");
    const s = btn.querySelector(".spinner");
    if (s) s.remove();
    btn.classList.remove("btn--success");
  }
}

function setButtonSuccess(btn) {
  if (!btn) return;
  btn.classList.add("btn--success");
}

function saveCache(obj) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch (e) {}
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch (e) {
    return null;
  }
}

function enqueueSync(item) {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
    q.push(item);
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
  } catch (e) {
    console.error("enqueue error", e);
  }
}

async function flushSyncQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
    if (!q.length) return;
    for (const item of q.slice()) {
      try {
        if (item.type === "create_goal") {
          await fetchWithTimeout(
            `${API_BASE}/goals`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item.payload),
            },
            9000
          );
        } else if (item.type === "toggle_day") {
          const { id, day, mark } = item.payload;
          await fetchWithTimeout(
            `${API_BASE}/goals/${id}/update-streak`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ day, mark }),
            },
            9000
          );
        } else if (item.type === "reset") {
          await fetchWithTimeout(
            `${API_BASE}/goals/${item.payload.id}/reset`,
            { method: "POST" },
            9000
          );
        } else if (item.type === "edit") {
          const p = item.payload;
          await fetchWithTimeout(
            `${API_BASE}/goals/${p.id}/edit`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goal: p.goal, totalDays: p.totalDays }),
            },
            9000
          );
        } else if (item.type === "reminder") {
          const p = item.payload;
          await fetchWithTimeout(
            `${API_BASE}/goals/${p.id}/reminder`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reminderTime: p.reminderTime,
                enabled: p.enabled,
              }),
            },
            9000
          );
        } else if (item.type === "delete") {
          await fetchWithTimeout(
            `${API_BASE}/goals/${item.payload.id}`,
            { method: "DELETE" },
            9000
          );
        } else if (item.type === "claim_badge") {
          const p = item.payload;
          await fetchWithTimeout(
            `${API_BASE}/goals/${p.id}/claim-badge`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ badgeId: p.badgeId }),
            },
            9000
          );
        } else if (item.type === "set_default_goal") {
          const p = item.payload;
          await fetchWithTimeout(
            `${API_BASE}/goals/${p.goalId}/set-default`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            },
            9000
          );
        }
        // remove processed item
        const current = JSON.parse(
          localStorage.getItem(SYNC_QUEUE_KEY) || "[]"
        );
        current.shift();
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(current));
      } catch (innerErr) {
        console.warn("sync item failed", innerErr);
        // stop processing further to avoid tight loop
        break;
      }
    }
    // refresh after sync
    await fetchGoals();
  } catch (e) {
    console.error("flushSyncQueue", e);
  }
}

function flashSyncIcon() {
  const icon = document.getElementById("syncIcon");
  if (!icon) return;
  icon.classList.add("spin");
  setTimeout(() => icon.classList.remove("spin"), 900);
}

// attempt to flush queue when back online
window.addEventListener("online", () => {
  showToast("Back online — syncing...");
  flushSyncQueue();
});

// Reminder scheduling and Notification API
function setupReminderScheduler() {
  // clear existing
  if (reminderIntervalId) {
    clearTimeout(reminderIntervalId);
    reminderIntervalId = null;
  }
  if (!state) return;
  if (!state.remindersEnabled || !state.reminderTime) return;
  // ensure permission
  if (!("Notification" in window)) {
    console.warn("Notifications are not supported in this browser");
    return;
  }

  // Request permission and only schedule reminders if granted. Use the
  // promise result so we don't silently fail when permission is denied.
  const ensurePermission = () => {
    return new Promise((resolve) => {
      try {
        if (Notification.permission === "granted") return resolve(true);
        Notification.requestPermission()
          .then((perm) => {
            resolve(perm === "granted");
          })
          .catch(() => resolve(false));
      } catch (e) {
        resolve(false);
      }
    });
  };

  const checkReminder = () => {
    try {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const hhmm = `${hh}:${mm}`; // 'HH:MM'
      // debug log (useful during development)
      // console.debug('reminder check', hhmm, state.reminderTime);
      if (hhmm === state.reminderTime) {
        showNotification(
          `Time to study ${state.goal}! Keep your streak alive 🔥`
        );
      }
    } catch (e) {
      console.error("reminder tick", e);
    }
  };

  ensurePermission().then((granted) => {
    if (!granted) {
      console.warn("Notification permission not granted; reminders disabled");
      return;
    }

    // Schedule the next occurrence precisely using setTimeout. This computes
    // the milliseconds until the target HH:MM (today or tomorrow) and sets a
    // single timeout that fires exactly at that time, then reschedules for the
    // next day. This avoids the latency introduced by minute polling.
    const scheduleNext = () => {
      try {
        if (!state || !state.remindersEnabled || !state.reminderTime) return;
        const now = new Date();
        const parts = String(state.reminderTime).split(":");
        const targetHour = Number(parts[0]);
        const targetMin = Number(parts[1]);
        if (!Number.isFinite(targetHour) || !Number.isFinite(targetMin)) return;
        let target = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          targetHour,
          targetMin,
          0,
          0
        );
        if (target <= now) {
          // schedule for next day
          target.setDate(target.getDate() + 1);
        }
        const ms = target.getTime() - now.getTime();
        // clear existing just in case
        if (reminderIntervalId) {
          clearTimeout(reminderIntervalId);
          reminderIntervalId = null;
        }
        reminderIntervalId = setTimeout(() => {
          try {
            // re-check state before firing
            if (state && state.remindersEnabled && state.reminderTime) {
              // Show the notification
              showNotification(
                `Time to study ${state.goal}! Keep your streak alive 🔥`
              );
            }
          } catch (e) {
            console.error("reminder fire error", e);
          }
          // schedule next occurrence (next day)
          scheduleNext();
        }, ms);
      } catch (e) {
        console.error("scheduleNext error", e);
      }
    };

    // kick off
    scheduleNext();
  });
}

function showNotification(text) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    const notificationOptions = {
      body: text,
      icon: "/icons/icon-192.svg",
      badge: "/icons/icon-72.svg",
      tag: "study-streak-reminder",
      vibrate: [200, 100, 200],
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
    };

    // Prefer showing notifications via the service worker registration when
    // available. This tends to work better when the page is backgrounded.
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => {
            if (reg && reg.showNotification) {
              reg.showNotification("Time to study! 📚", notificationOptions);
              return;
            }
            // fallback to window Notification (limited features)
            new Notification("Time to study! 📚", {
              body: text,
              icon: notificationOptions.icon,
            });
          })
          .catch(() => {
            // on error fallback to window Notification
            new Notification("Time to study! 📚", {
              body: text,
              icon: notificationOptions.icon,
            });
          });
        return;
      }
    } catch (e) {
      // best-effort: continue to fallback
    }
    new Notification("Time to study! 📚", {
      body: text,
      icon: notificationOptions.icon,
    });
  }
}

async function saveReminderToServer(time, enabled) {
  if (!state || !state._id) return;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${state._id}/reminder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminderTime: time, enabled }),
      },
      8000
    );
    if (res.ok) {
      const data = await res.json();
      state = data;
      applyStateToUI(data);
      showToast("Reminder saved");
    } else {
      throw new Error("save failed");
    }
  } catch (e) {
    console.warn("saveReminderToServer failed", e);
    // enqueue a reminder-specific sync item so the reminderTime and enabled flag
    // are preserved and can be replayed when online.
    enqueueSync({
      type: "reminder",
      payload: { id: state._id, reminderTime: time, enabled: enabled },
    });
    showToast("Saved reminder locally; will sync when online");
  }
}

// wire reminder UI (inline controls)
const reminderHour = document.getElementById("reminderHour");
const reminderMinute = document.getElementById("reminderMinute");
const reminderAmPm = document.getElementById("reminderAmPm");
const reminderToggle = document.getElementById("reminderToggle");
const reminderStateLabel = document.getElementById("reminderState");
const previewReminderBtn = document.getElementById("previewReminderBtn");
const saveReminderBtn = document.getElementById("saveReminderBtn");

function updateReminderStateUI(enabled) {
  if (reminderStateLabel)
    reminderStateLabel.textContent = enabled ? "Enabled" : "Disabled";
  if (reminderToggle)
    reminderToggle.setAttribute("aria-checked", enabled ? "true" : "false");
}

function showNotificationPreview() {
  if (!state) return showToast("Select a goal first");
  if (Notification && Notification.permission !== "granted") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted")
        showNotification(
          `Time to study ${state.goal}! Keep your streak alive 🔥`
        );
      else showToast("Notification permission denied");
    });
  } else {
    showNotification(`Time to study ${state.goal}! Keep your streak alive 🔥`);
  }
}

if (reminderHour && reminderMinute && reminderAmPm) {
  [reminderHour, reminderMinute, reminderAmPm].forEach((el) => {
    el.addEventListener("change", () => {
      if (!state) return showToast("Select a goal first");
      const t = build24hFromInputs();
      const display = `${reminderHour.value}:${reminderMinute.value} ${reminderAmPm.value}`;
      showToast(`Reminder time set to ${display}. Click Save to persist.`);
    });
  });
}

if (reminderToggle) {
  reminderToggle.addEventListener("change", (e) => {
    const enabled = !!e.target.checked;
    if (!state) {
      reminderToggle.checked = !enabled;
      return showToast("Select a goal first");
    }
    updateReminderStateUI(enabled);
    showToast(
      enabled
        ? "Reminders enabled (click Save)"
        : "Reminders disabled (click Save)"
    );
  });
}

if (previewReminderBtn) {
  previewReminderBtn.addEventListener("click", (e) => {
    e.preventDefault();
    showNotificationPreview();
  });
}

if (saveReminderBtn) {
  saveReminderBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!state) return showToast("Select a goal first");
    const time = build24hFromInputs();
    const enabled = reminderToggle ? !!reminderToggle.checked : false;
    if (enabled && Notification && Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted")
        return showToast(
          "Notification permission is required to enable reminders"
        );
    }
    setButtonLoading(saveReminderBtn, true);
    await saveReminderToServer(time, enabled);
    setButtonLoading(saveReminderBtn, false);
    updateReminderStateUI(enabled);
  });
}

// call init
// --- Right-side panel rendering & interactions ---
function renderGoalCards() {
  const container = document.getElementById("rightPanelCards");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(goals) || goals.length === 0) {
    container.innerHTML =
      '<div style="color: var(--muted); padding:12px;">No goals yet</div>';
    return;
  }
  for (const g of goals) {
    const card = document.createElement("div");
    card.className = g.isDefault ? "goal-card is-default" : "goal-card";
    card.dataset.id = g._id || "";

    // Title (top)
    const title = document.createElement("div");
    title.className = "goal-title";
    title.textContent = g.goal || "Untitled";

    // Big streak number (center)
    const streakWrap = document.createElement("div");
    streakWrap.className = "streak-big";
    const sicon = document.createElement("span");
    sicon.className = "streak-icon";
    sicon.textContent = "🔥";
    const sNum = document.createElement("span");
    sNum.textContent = String(g.currentStreak || 0);
    streakWrap.appendChild(sicon);
    streakWrap.appendChild(sNum);

    // small progress text
    const progress = document.createElement("div");
    progress.className = "goal-progress";
    progress.textContent = `${(g.daysCompleted || []).length}/${
      g.totalDays || 30
    } days`;

    // Default goal radio button (above action row)
    const defaultRow = document.createElement("div");
    defaultRow.className = "goal-default-row";

    const defaultLabel = document.createElement("label");
    defaultLabel.className = g.isDefault
      ? "default-goal-label is-default"
      : "default-goal-label";

    const defaultRadio = document.createElement("input");
    defaultRadio.type = "radio";
    defaultRadio.name = "defaultGoal";
    defaultRadio.value = g._id;
    defaultRadio.className = "default-goal-radio";
    defaultRadio.checked = g.isDefault || false;
    defaultRadio.addEventListener("change", (e) => {
      if (e.target.checked) {
        setDefaultGoal(g._id);
      }
    });

    const defaultText = document.createElement("span");
    defaultText.textContent = "Default";
    defaultText.className = "default-goal-text";

    defaultLabel.appendChild(defaultRadio);
    defaultLabel.appendChild(defaultText);
    defaultRow.appendChild(defaultLabel);

    // bottom action row
    const actionRow = document.createElement("div");
    actionRow.className = "goal-card-right";

    const todayIdx = computeCurrentGoalDayForState(g);
    const isMarkedToday =
      (g.daysCompleted || []).includes(todayIdx) && todayIdx !== 0;

    const btn = document.createElement("button");
    btn.className = "mark-today-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Mark today as completed");
    if (isMarkedToday || todayIdx === 0) {
      const chk = document.createElement("span");
      chk.className = "checkmark";
      chk.textContent = "✓";
      btn.appendChild(chk);
      btn.disabled = true;
      if (todayIdx === 0) btn.title = "Goal hasn't started yet";
    } else {
      btn.textContent = "Mark"; // shorter label to keep button compact
      btn.addEventListener("click", () => markTodayForGoal(g._id, btn, g));
    }

    actionRow.appendChild(btn);

    // Resource button (opens modal showing resources for this goal)
    const resBtn = document.createElement("button");
    resBtn.className = "open-res-btn";
    resBtn.type = "button";
    resBtn.setAttribute("aria-label", "Open resources for this goal");
    resBtn.textContent = "Resources";
    resBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openResourcesModal(g._id);
    });
    actionRow.appendChild(resBtn);

    card.appendChild(title);
    card.appendChild(streakWrap);
    card.appendChild(progress);
    card.appendChild(defaultRow);
    card.appendChild(actionRow);

    container.appendChild(card);
  }
}

async function markTodayForGoal(goalId, btn, goalObj) {
  try {
    if (!goalId) return showToast("No goal id");
    // compute day to mark
    const day = computeCurrentGoalDayForState(
      goalObj || goals.find((x) => x._id === goalId)
    );
    if (!day || day === 0) return showToast("Goal hasn't started yet");
    // show spinner
    btn.disabled = true;
    btn.innerHTML = "";
    const spinner = document.createElement("span");
    spinner.className = "card-spinner";
    btn.appendChild(spinner);

    // Attempt server call
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/update-streak`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, mark: true }),
      },
      9000
    );
    if (!res.ok) {
      // offline or server error -> enqueue and optimistic update
      enqueueSync({
        type: "toggle_day",
        payload: { id: goalId, day, mark: true },
      });
      showToast("Queued — will sync when online");
      // optimistic: swap to checkmark
      btn.innerHTML = "";
      const chk = document.createElement("span");
      chk.className = "checkmark";
      chk.textContent = "✓";
      btn.appendChild(chk);
      // refresh local list after a brief delay
      setTimeout(() => fetchGoals().catch(() => {}), 600);
      return;
    }
    // success
    const js = await res.json().catch(() => null);
    // visual success: replace spinner with checkmark
    btn.innerHTML = "";
    const chk = document.createElement("span");
    chk.className = "checkmark";
    chk.textContent = "✓";
    btn.appendChild(chk);
    // refresh goals from server to reflect updated counts
    setTimeout(() => fetchGoals().catch(() => {}), 450);
  } catch (err) {
    console.error("markToday error", err);
    enqueueSync({
      type: "toggle_day",
      payload: {
        id: goalId,
        day: computeCurrentGoalDayForState(goalObj || {}),
        mark: true,
      },
    });
    btn.innerHTML = "";
    const chk = document.createElement("span");
    chk.className = "checkmark";
    chk.textContent = "✓";
    btn.appendChild(chk);
    showToast("Action queued — will sync when online");
    setTimeout(() => fetchGoals().catch(() => {}), 500);
  }
}

// Listen for messages from service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    console.log("Message from SW:", event.data);

    if (event.data && event.data.action === "mark-today-complete") {
      // Mark today's study as complete
      if (state && state.goal) {
        markDay(new Date(), true);
        showToast("Study marked as complete! 🔥");
      }
    }
  });
}

// Handle URL parameters for actions (like from notification shortcuts)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("action") === "mark-today") {
  // Delay to ensure DOM is loaded
  setTimeout(() => {
    if (state && state.goal) {
      markDay(new Date(), true);
      showToast("Study marked as complete from shortcut! 🔥");
    }
  }, 500);
}

populateTimeSelectors();
fetchGoals();
// Initialize completed goals functionality
initCompletedGoals();

// --- Service worker, Notifications and Add to Home Screen (A2HS) ---
let _deferredInstallPrompt = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/service-worker.js")
    .then((registration) => {
      console.log("Service worker registered", registration);

      // Request Notification permission and show a confirmation notification
      if ("Notification" in window) {
        Notification.requestPermission().then(async (permission) => {
          if (permission === "granted") {
            const icon = "/icons/icon-192.svg";

            // Set default 8 PM reminder if not already set
            const currentState = localStorage.getItem("sst_state");
            if (currentState) {
              const parsedState = JSON.parse(currentState);
              if (!parsedState.reminderTime) {
                parsedState.reminderTime = "20:00"; // 8 PM default
                parsedState.remindersEnabled = true;
                localStorage.setItem("sst_state", JSON.stringify(parsedState));
                console.log("Set default 8 PM reminder");
              }
            }

            // Prefer showing via service worker when available (more reliable)
            try {
              if (registration && registration.showNotification) {
                registration.showNotification(
                  "Study notifications enabled! 🔥",
                  {
                    body: "You'll get daily reminders to keep your streak going. Default time: 8 PM",
                    icon,
                    badge: "/icons/icon-72.svg",
                    tag: "setup-complete",
                    requireInteraction: false,
                    actions: [
                      {
                        action: "view-settings",
                        title: "Change Time ⚙️",
                      },
                    ],
                  }
                );
              } else {
                // Fallback: use the Notification constructor in-page
                new Notification("Study notifications enabled! 🔥", {
                  body: "You'll get daily reminders to keep your streak going. Default time: 8 PM",
                  icon,
                });
              }
            } catch (e) {
              console.warn("Notification display failed", e);
            }

            // Attempt to subscribe the user to Push so the server can send background notifications
            try {
              // Wait for the service worker to be ready
              const reg = await navigator.serviceWorker.ready;
              subscribeUserToPush(reg).catch((err) =>
                console.warn("subscribeUserToPush error", err)
              );
            } catch (err) {
              console.warn(
                "Service worker not ready for push subscription",
                err
              );
            }
          }
        });
      }
    })
    .catch((err) => console.warn("SW register failed", err));
}

// Handle beforeinstallprompt to show custom "Add to Home Screen" UI
window.addEventListener("beforeinstallprompt", (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  _deferredInstallPrompt = e;

  const btn = document.getElementById("installBtn");
  const prompt = document.getElementById("installPrompt");

  if (btn) {
    btn.classList.add("show");
    btn.setAttribute("aria-hidden", "false");

    // Show install prompt after a delay
    setTimeout(() => {
      if (prompt && !localStorage.getItem("sst_install_prompt_dismissed")) {
        prompt.classList.add("show");
        prompt.setAttribute("aria-hidden", "false");

        // Auto-hide prompt after 5 seconds
        setTimeout(() => {
          prompt.classList.remove("show");
          prompt.setAttribute("aria-hidden", "true");
          localStorage.setItem("sst_install_prompt_dismissed", "true");
        }, 5000);
      }
    }, 3000);

    const onClick = async () => {
      btn.disabled = true;
      btn.textContent = "Installing...";

      try {
        await _deferredInstallPrompt.prompt();
        const choice = await _deferredInstallPrompt.userChoice;

        if (choice && choice.outcome === "accepted") {
          console.log("User accepted the A2HS prompt");
          btn.classList.remove("show");
          btn.setAttribute("aria-hidden", "true");
          if (prompt) {
            prompt.classList.remove("show");
            prompt.setAttribute("aria-hidden", "true");
          }
          showToast("App installed successfully! 📱");
        } else {
          console.log("User dismissed the A2HS prompt");
          btn.disabled = false;
          btn.textContent = "Install App";
          showToast("You can install the app anytime using the button ↘️");
        }
      } catch (err) {
        console.warn("A2HS prompt error", err);
        btn.disabled = false;
        btn.textContent = "Install App";
      }
      _deferredInstallPrompt = null;
    };

    btn.addEventListener("click", onClick, { once: true });
  }
});

window.addEventListener("appinstalled", () => {
  // Hide the install UI, app is installed
  const btn = document.getElementById("installBtn");
  const prompt = document.getElementById("installPrompt");

  if (btn) {
    btn.classList.remove("show");
    btn.setAttribute("aria-hidden", "true");
  }

  if (prompt) {
    prompt.classList.remove("show");
    prompt.setAttribute("aria-hidden", "true");
  }

  console.log("PWA was installed");

  // Show success message and set installed flag
  localStorage.setItem("sst_app_installed", "true");
  showToast(
    "🎉 Study Streak Tracker installed! Open from your home screen anytime."
  );

  // Log analytics event (if you add analytics later)
  console.log("PWA_INSTALLED", { timestamp: Date.now() });
});

/* 
================================================================================
FUTURE BACKEND PUSH NOTIFICATION INTEGRATION EXAMPLES
================================================================================

1. FIREBASE CLOUD MESSAGING (FCM) SETUP:
   
   // Add to <head> in index.html:
   <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js"></script>
   
   // Initialize Firebase (add your config):
   const firebaseConfig = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com", 
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "your-app-id"
   };
   
   firebase.initializeApp(firebaseConfig);
   const messaging = firebase.messaging();
   
   // Get FCM token for this device:
   async function getFCMToken() {
     try {
       const token = await messaging.getToken({
         vapidKey: "your-vapid-key"
       });
       console.log('FCM Token:', token);
       // Send this token to your server
       return token;
     } catch (error) {
       console.error('Error getting FCM token:', error);
     }
   }
   
   // Handle foreground messages:
   messaging.onMessage((payload) => {
     console.log('Foreground message:', payload);
     // Show custom notification
   });

2. NODE.JS WEB-PUSH SERVER SETUP:
   
   // Install: npm install web-push
   const webpush = require('web-push');
   
   // Generate VAPID keys (run once):
   const vapidKeys = webpush.generateVAPIDKeys();
   console.log('Public Key:', vapidKeys.publicKey);
   console.log('Private Key:', vapidKeys.privateKey);
   
   // Set VAPID details:
   webpush.setVapidDetails(
     'mailto:your-email@example.com',
     vapidKeys.publicKey,
     vapidKeys.privateKey
   );
   
   // Send notification:
   async function sendNotification(subscription, payload) {
     try {
       await webpush.sendNotification(subscription, JSON.stringify(payload));
       console.log('Notification sent successfully');
     } catch (error) {
       console.error('Error sending notification:', error);
     }
   }
   
   // Example payload:
   const notificationPayload = {
     title: "Study Reminder 📚",
     body: "Time to continue your streak!",
     icon: "/icons/icon-192x192.png",
     badge: "/icons/badge-72x72.png",
     data: {
       url: "/",
       timestamp: Date.now()
     }
   };
   
   // Schedule daily reminders (using node-cron):
   const cron = require('node-cron');
   
   // Send at 8 PM every day
   cron.schedule('0 20 * * *', () => {
     // Get all user subscriptions from your database
     // Send notifications to each user
   });

3. ENHANCED PUSH SUBSCRIPTION MANAGEMENT:
   
   // Store subscription in your database:
   async function saveSubscription(subscription) {
     try {
       const response = await fetch('/api/subscribe', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           subscription: subscription,
           userId: getCurrentUserId(), // Your user identification
           preferences: {
             reminderTime: '20:00',
             timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
           }
         })
       });
       
       if (response.ok) {
         console.log('Subscription saved to server');
         localStorage.setItem('push_subscription_saved', 'true');
       }
     } catch (error) {
       console.error('Failed to save subscription:', error);
     }
   }
   
   // Unsubscribe from push notifications:
   async function unsubscribeFromPush() {
     try {
       const registration = await navigator.serviceWorker.ready;
       const subscription = await registration.pushManager.getSubscription();
       
       if (subscription) {
         await subscription.unsubscribe();
         
         // Remove from server
         await fetch('/api/unsubscribe', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ subscription })
         });
         
         console.log('Successfully unsubscribed from push notifications');
       }
     } catch (error) {
       console.error('Error unsubscribing:', error);
     }
   }

4. ADVANCED SERVICE WORKER PUSH HANDLING:
   
   // Add to service-worker.js:
   self.addEventListener('push', (event) => {
     if (!event.data) return;
     
     const data = event.data.json();
     const options = {
       body: data.body,
       icon: data.icon || '/icons/icon-192x192.png',
       badge: data.badge || '/icons/badge-72x72.png',
       vibrate: [200, 100, 200],
       data: data.data || {},
       actions: [
         {
           action: 'mark-complete',
           title: 'Mark Complete',
           icon: '/icons/check.png'
         },
         {
           action: 'view-app',
           title: 'Open App',
           icon: '/icons/open.png'
         }
       ],
       requireInteraction: true,
       tag: data.tag || 'default'
     };
     
     event.waitUntil(
       self.registration.showNotification(data.title, options)
     );
   });

5. BACKGROUND SYNC FOR OFFLINE ACTIONS:
   
   // Register background sync:
   if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
     navigator.serviceWorker.ready.then((registration) => {
       return registration.sync.register('background-sync');
     });
   }
   
   // In service worker:
   self.addEventListener('sync', (event) => {
     if (event.tag === 'background-sync') {
       event.waitUntil(syncOfflineActions());
     }
   });
   
   async function syncOfflineActions() {
     const offlineActions = getOfflineActions(); // Your implementation
     for (const action of offlineActions) {
       try {
         await sendToServer(action);
         removeOfflineAction(action);
       } catch (error) {
         console.error('Sync failed for action:', action, error);
       }
     }
   }

6. TESTING PUSH NOTIFICATIONS:
   
   // Test notification from browser console:
   function testNotification() {
     if ('serviceWorker' in navigator && 'Notification' in window) {
       navigator.serviceWorker.ready.then((registration) => {
         registration.showNotification('Test Notification', {
           body: 'This is a test notification',
           icon: '/icons/icon-192x192.png',
           badge: '/icons/badge-72x72.png',
           vibrate: [200, 100, 200],
           tag: 'test-notification'
         });
       });
     }
   }
   
   // Call testNotification() in console to test

================================================================================
*/

// --- Completed Goals functionality ---
let completedGoalsCount = 0;

// Fetch completed goals count and update button
async function fetchCompletedGoalsCount() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/goals/completed`, {}, 8000);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch completed goals: ${res.status} ${res.statusText}`
      );
    }

    const completedGoals = await res.json();
    // Ensure completedGoals is an array
    const goalsArray = Array.isArray(completedGoals) ? completedGoals : [];
    completedGoalsCount = goalsArray.length;
    updateCompletedGoalsButton();
  } catch (err) {
    console.warn("Failed to fetch completed goals count:", err);
    // Set count to 0 on error and still update button
    completedGoalsCount = 0;
    updateCompletedGoalsButton();
  }
}

// Update completed goals button visibility and text
function updateCompletedGoalsButton() {
  const button = document.getElementById("completedGoalsBtn");
  if (!button) return;

  // Always show the button, just update the count
  button.style.display = "block";
  button.textContent = `Completed (${completedGoalsCount})`;
}

// Show completed goals modal
async function showCompletedGoalsModal() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/goals/completed`, {}, 8000);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch completed goals: ${res.status} ${res.statusText}`
      );
    }

    const completedGoals = await res.json();

    const modal = document.getElementById("completedGoalsModal");
    const goalsList = document.getElementById("completedGoalsList");

    if (!modal || !goalsList) return;

    // Clear previous content
    goalsList.innerHTML = "";

    // Ensure completedGoals is an array
    const goalsArray = Array.isArray(completedGoals) ? completedGoals : [];

    if (goalsArray.length === 0) {
      goalsList.innerHTML =
        '<div style="text-align: center; color: var(--muted); padding: 40px;">No completed goals yet!</div>';
    } else {
      // Render each completed goal
      for (const goal of goalsArray) {
        const goalCard = createCompletedGoalCard(goal);
        goalsList.appendChild(goalCard);
      }
    }

    // Show modal
    modal.setAttribute("aria-hidden", "false");
  } catch (err) {
    console.error("Failed to load completed goals:", err);
    showToast("Failed to load completed goals");
  }
}

// Create a completed goal card
function createCompletedGoalCard(goal) {
  const card = document.createElement("div");
  card.className = "completed-goal-card";

  // Goal header with title and completion date
  const header = document.createElement("div");
  header.className = "completed-goal-header";

  const title = document.createElement("h3");
  title.className = "completed-goal-title";
  title.textContent = goal.goal || "Untitled Goal";

  const completedDate = document.createElement("div");
  completedDate.className = "completed-goal-date";
  if (goal.completedAt) {
    const date = new Date(goal.completedAt);
    completedDate.textContent = `Completed on ${date.toLocaleDateString()}`;
  } else {
    completedDate.textContent = "Completed";
  }

  header.appendChild(title);
  header.appendChild(completedDate);

  // Goal statistics
  const stats = document.createElement("div");
  stats.className = "completed-goal-stats";

  const totalDaysStat = createStatCard(
    (goal.daysCompleted || []).length,
    "Days Completed"
  );
  const totalTargetStat = createStatCard(goal.totalDays || 30, "Total Target");
  const bestStreakStat = createStatCard(goal.bestStreak || 0, "Best Streak");
  const pointsStat = createStatCard(goal.points || 0, "Points Earned");

  stats.appendChild(totalDaysStat);
  stats.appendChild(totalTargetStat);
  stats.appendChild(bestStreakStat);
  stats.appendChild(pointsStat);

  // Badges section
  const badgesSection = document.createElement("div");
  badgesSection.className = "completed-goal-badges";

  const badgesTitle = document.createElement("h4");
  badgesTitle.textContent = "🏆 Badges Earned";
  badgesSection.appendChild(badgesTitle);

  const badgesList = document.createElement("div");
  badgesList.className = "completed-goal-badges-list";

  if (goal.claimedBadges && goal.claimedBadges.length > 0) {
    // Badge metadata (should match backend)
    const badgeImages = {
      "day-1":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/day-1-badge-starting-badge_t8xdrn.png",
      "7-day":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/7-day-badge_ydr6g7.png",
      "15-day":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/15-days-badge_zuojgs.png",
      "30-day":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/30-days-badge_cpzjgt.png",
      "60-day":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925155/60-days-badge_pqv62a.png",
      "100-day":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1761925156/100-days-badge_tz1v54.png",
      "goal-completion":
        "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1762017561/goal-completetion-badge_bdcbxn.png",
    };

    for (const badgeId of goal.claimedBadges) {
      const img = document.createElement("img");
      img.src = badgeImages[badgeId] || "";
      img.alt = badgeId;
      img.title = badgeId
        .replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
      badgesList.appendChild(img);
    }
  } else {
    badgesList.innerHTML =
      '<div style="color: var(--muted); font-size: 12px;">No badges claimed</div>';
  }

  badgesSection.appendChild(badgesList);

  // Resources section
  const resourcesSection = document.createElement("div");
  resourcesSection.className = "completed-goal-resources";

  const resourcesTitle = document.createElement("h4");
  resourcesTitle.textContent = "📚 Resources Used";
  resourcesSection.appendChild(resourcesTitle);

  if (goal.resources && goal.resources.length > 0) {
    const resourcesList = document.createElement("div");
    for (const resource of goal.resources) {
      const resourceItem = document.createElement("div");
      resourceItem.style.cssText =
        "margin-bottom: 6px; padding: 6px; background: white; border-radius: 6px; font-size: 12px;";

      if (resource.url) {
        const link = document.createElement("a");
        link.href = resource.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.cssText =
          "color: #22c55e; text-decoration: none; font-weight: 500;";
        link.textContent = resource.url;
        resourceItem.appendChild(link);
      }

      if (resource.note) {
        const note = document.createElement("div");
        note.style.cssText = "color: #6b7280; margin-top: 2px;";
        note.textContent = resource.note;
        resourceItem.appendChild(note);
      }

      resourcesList.appendChild(resourceItem);
    }
    resourcesSection.appendChild(resourcesList);
  } else {
    const noResources = document.createElement("div");
    noResources.style.cssText = "color: var(--muted); font-size: 12px;";
    noResources.textContent = "No resources added";
    resourcesSection.appendChild(noResources);
  }

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "completed-goal-actions";

  const reopenBtn = document.createElement("button");
  reopenBtn.className = "reopen-goal-btn";
  reopenBtn.textContent = "Reopen Goal";
  reopenBtn.addEventListener("click", () => reopenGoal(goal._id));

  actions.appendChild(reopenBtn);

  // Assemble the card
  card.appendChild(header);
  card.appendChild(stats);
  card.appendChild(badgesSection);
  card.appendChild(resourcesSection);
  card.appendChild(actions);

  return card;
}

// Create a statistic card for completed goals
function createStatCard(value, label) {
  const stat = document.createElement("div");
  stat.className = "completed-goal-stat";

  const valueEl = document.createElement("div");
  valueEl.className = "completed-goal-stat-value";
  valueEl.textContent = String(value);

  const labelEl = document.createElement("div");
  labelEl.className = "completed-goal-stat-label";
  labelEl.textContent = label;

  stat.appendChild(valueEl);
  stat.appendChild(labelEl);

  return stat;
}

// Reopen a completed goal
async function reopenGoal(goalId) {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/uncomplete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      8000
    );

    if (res.ok) {
      showToast("Goal reopened successfully!");
      hideCompletedGoalsModal();
      // Refresh the goals and completed goals
      await fetchGoals();
      await fetchCompletedGoalsCount();
    } else {
      throw new Error("Failed to reopen goal");
    }
  } catch (err) {
    console.error("Failed to reopen goal:", err);
    showToast("Failed to reopen goal");
  }
}

// Hide completed goals modal
function hideCompletedGoalsModal() {
  const modal = document.getElementById("completedGoalsModal");
  if (modal) {
    modal.setAttribute("aria-hidden", "true");
  }
}

// Initialize completed goals functionality
function initCompletedGoals() {
  const completedGoalsBtn = document.getElementById("completedGoalsBtn");
  const closeCompletedGoalsBtn = document.getElementById(
    "closeCompletedGoalsBtn"
  );
  const modal = document.getElementById("completedGoalsModal");

  // Button click handler
  if (completedGoalsBtn) {
    completedGoalsBtn.addEventListener("click", showCompletedGoalsModal);
  }

  // Close button handler
  if (closeCompletedGoalsBtn) {
    closeCompletedGoalsBtn.addEventListener("click", hideCompletedGoalsModal);
  }

  // Backdrop click handler
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target.dataset.close === "true") {
        hideCompletedGoalsModal();
      }
    });

    // Escape key handler
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") {
        hideCompletedGoalsModal();
      }
    });
  }

  // Fetch initial completed goals count
  fetchCompletedGoalsCount();
}

// Update Mark as Completed button visibility and functionality
function updateMarkCompletedButton(data) {
  const markCompletedBtn = document.getElementById("markCompletedBtn");
  if (!markCompletedBtn || !data) return;

  const totalDays = data.totalDays || 30;
  const completedDays = (data.daysCompleted || []).length;
  const isGoalFullyCompleted = completedDays >= totalDays;
  const isAlreadyMarkedCompleted = data.completed === true;

  // Show button only if all days are completed but goal is not yet marked as completed
  if (isGoalFullyCompleted && !isAlreadyMarkedCompleted) {
    markCompletedBtn.style.display = "inline-block";
    markCompletedBtn.onclick = () => markGoalAsCompleted(data._id);
  } else {
    markCompletedBtn.style.display = "none";
  }
}

// Mark goal as completed
async function markGoalAsCompleted(goalId) {
  if (!isValidBackendId(goalId)) {
    showToast("Cannot complete local goals. Please save the goal first.");
    return;
  }

  try {
    const markCompletedBtn = document.getElementById("markCompletedBtn");
    if (markCompletedBtn) {
      setButtonLoading(markCompletedBtn, true);
    }

    const res = await fetchWithTimeout(
      `${API_BASE}/goals/${goalId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      8000
    );

    if (!res.ok) {
      throw new Error(`Failed to complete goal: ${res.status}`);
    }

    const result = await res.json();
    showToast(result.message || "Goal completed successfully! 🎉");

    // Refresh goals list and switch to another goal if available
    await fetchGoals();

    // Update completed goals count
    fetchCompletedGoalsCount();

    // If this was the current goal, switch to another one
    if (state && state._id === goalId) {
      const activeGoals = goals.filter((g) => !g.completed);
      if (activeGoals.length > 0) {
        selectGoal(activeGoals[0]._id);
      } else {
        // No more active goals, clear the UI
        state = null;
        applyStateToUI(null);
      }
    }
  } catch (err) {
    console.error("Failed to mark goal as completed:", err);
    showToast("Failed to complete goal. Please try again.");
  } finally {
    const markCompletedBtn = document.getElementById("markCompletedBtn");
    if (markCompletedBtn) {
      setButtonLoading(markCompletedBtn, false);
    }
  }
}
