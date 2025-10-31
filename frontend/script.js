const API_BASE = (() => {
  // allow overriding via env-like global for easier local testing
  if (window.__API_BASE__) return window.__API_BASE__;
  // Default to the deployed backend URL (explicit /api prefix)
  return "https://study-streak-tracker-myz5.vercel.app/api";
})();

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

// VAPID public key for Push subscriptions.
// Replace this with your actual base64 (URL-safe) VAPID public key from your server.
const VAPID_PUBLIC_KEY = "REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY";

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
];

function updateBadgeIndicator() {
  if (!openBadgesBtn) return;
  const current =
    state && Number(state.currentStreak) ? Number(state.currentStreak) : 0;
  const claimedSet = new Set(
    state && state.claimedBadges ? state.claimedBadges : []
  );
  // determine if there is any badge the user is eligible for but hasn't claimed yet
  const hasNew = BADGE_DEFS.some(
    (b) => current >= b.days && !claimedSet.has(b.id)
  );
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
  goalInput.value = data.goal || "";
  totalDaysInput.value = data.totalDays || 30;
  currentStreakEl.textContent = data.currentStreak || 0;
  bestStreakEl.textContent = data.bestStreak || 0;
  totalCompletedEl.textContent = (data.daysCompleted || []).length;
  remainingDaysEl.textContent =
    (data.totalDays || 30) - (data.daysCompleted || []).length;
  quoteEl.textContent = pickQuote();
  renderCalendar(data.totalDays || 30, data.daysCompleted || []);
  updateCanvas(
    ((data.daysCompleted || []).length / (data.totalDays || 30)) * 100
  );
  // rewards UI
  document.getElementById("points").textContent = data.points || 0;
  document.getElementById("level").textContent = data.level || "Beginner";
  const badgesEl = document.getElementById("badgesList");
  badgesEl.textContent =
    data.badges && data.badges.length ? data.badges.join(", ") : "—";
  // render small claimed badges below the label
  updateClaimedBadgesUI(data.claimedBadges || []);
  document.getElementById("startDateLabel").textContent = data.startDate || "—";
  document.getElementById("currentGoalDay").textContent =
    computeCurrentGoalDayForState(data) || "—";
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
      ];
      const current = state && state.currentStreak ? state.currentStreak : 0;
      const earnedSet = new Set(state && state.badges ? state.badges : []);
      const claimedSet = new Set(
        state && state.claimedBadges ? state.claimedBadges : []
      );
      const items = localBADGES.map((b) => ({
        id: b.id,
        title: b.title,
        days: b.days,
        img: b.img,
        earned: earnedSet.has(b.id),
        claimed: claimedSet.has(b.id),
        eligible: current >= b.days,
      }));
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
    meta.textContent = `${b.days} day${b.days > 1 ? "s" : ""}`;
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
      const first = goals[0];
      selectGoal(first._id);
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
  try {
    const res = await fetchWithTimeout(`${API_BASE}/goals/${id}`, {}, 8000);
    const data = await res.json();
    applyStateToUI(data);
    // set select value
    goalSelect.value = id;
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
    if (!res.ok) throw new Error(`Save failed ${res.status}`);
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

async function toggleDay(day, node) {
  const completed = node.classList.contains("completed");
  try {
    if (!state || !state._id) throw new Error("No goal selected");
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

// init
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
    .finally(() => clearTimeout(id));
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
    // Prefer showing notifications via the service worker registration when
    // available. This tends to work better when the page is backgrounded.
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => {
            if (reg && reg.showNotification) {
              reg.showNotification("Study Reminder", { body: text, icon: "" });
              return;
            }
            // fallback to window Notification
            new Notification("Study Reminder", { body: text, icon: "" });
          })
          .catch(() => {
            // on error fallback to window Notification
            new Notification("Study Reminder", { body: text, icon: "" });
          });
        return;
      }
    } catch (e) {
      // best-effort: continue to fallback
    }
    new Notification("Study Reminder", { body: text, icon: "" });
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
    card.className = "goal-card";
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
      btn.textContent = "Mark Today";
      btn.addEventListener("click", () => markTodayForGoal(g._id, btn, g));
    }

    actionRow.appendChild(btn);

    card.appendChild(title);
    card.appendChild(streakWrap);
    card.appendChild(progress);
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

populateTimeSelectors();
fetchGoals();

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
            const icon = "https://via.placeholder.com/192.png?text=Streak";
            // Prefer showing via service worker when available (more reliable)
            try {
              if (registration && registration.showNotification) {
                registration.showNotification("Notifications enabled!", {
                  body: "Daily reminders are enabled. You will receive notifications.",
                  icon,
                });
              } else {
                // Fallback: use the Notification constructor in-page
                new Notification("Notifications enabled!", {
                  body: "Daily reminders are enabled. You will receive notifications.",
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
  if (btn) {
    btn.classList.add("show");
    btn.setAttribute("aria-hidden", "false");
    const onClick = async () => {
      btn.disabled = true;
      try {
        await _deferredInstallPrompt.prompt();
        const choice = await _deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === "accepted") {
          console.log("User accepted the A2HS prompt");
          btn.classList.remove("show");
          btn.setAttribute("aria-hidden", "true");
        } else {
          console.log("User dismissed the A2HS prompt");
          btn.disabled = false;
        }
      } catch (err) {
        console.warn("A2HS prompt error", err);
        btn.disabled = false;
      }
      _deferredInstallPrompt = null;
    };
    btn.addEventListener("click", onClick, { once: true });
  }
});

window.addEventListener("appinstalled", () => {
  // Hide the install UI, app is installed
  const btn = document.getElementById("installBtn");
  if (btn) {
    btn.classList.remove("show");
    btn.setAttribute("aria-hidden", "true");
  }
  console.log("PWA was installed");
});
