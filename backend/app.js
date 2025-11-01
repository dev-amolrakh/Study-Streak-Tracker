const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const Streak = require("./models/Streak");

const app = express();
app.use(cors());
app.use(express.json());

// Add server date header to every response to allow client-side verification
app.use((req, res, next) => {
  res.setHeader("X-Server-Date", new Date().toISOString());
  next();
});

// MongoDB connection: prefer env var for security. Provide fallback for local dev.
const MONGO =
  process.env.MONGO_URI ||
  "mongodb+srv://amolrakh22:TmSWLisIvmVWPNfG@cluster0.zmsmm.mongodb.net/studyTracker?retryWrites=true&w=majority";

// avoid creating multiple connections in serverless environments
async function connectOnce() {
  if (
    mongoose.connections &&
    mongoose.connections[0] &&
    mongoose.connections[0].readyState === 1
  ) {
    return;
  }
  await mongoose.connect(MONGO, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

connectOnce().catch((err) => {
  if (process.env.NODE_ENV !== "production")
    console.error("Mongo connection error:", err);
});

function computeStreaks(daysArr) {
  if (!Array.isArray(daysArr)) daysArr = [];
  const days = Array.from(new Set(daysArr)).sort((a, b) => a - b);
  let best = 0;
  let current = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0 || days[i] === days[i - 1] + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
  }
  if (days.length === 0) current = 0;
  else {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (days[i] === days[i - 1] + 1) current += 1;
      else break;
    }
  }
  return { currentStreak: current, bestStreak: best };
}

// Badge metadata (IDs must be stable). Images hosted on Cloudinary.
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
    days: 0, // Special case - not streak-based
    img: "https://res.cloudinary.com/dqj2nmhkg/image/upload/v1762017561/goal-completetion-badge_bdcbxn.png",
  },
];

const fs = require("fs");
const path = require("path");
const SUBS_FILE = path.join(__dirname, "subscriptions.json");

// Endpoint to receive Push subscriptions from clients
app.post("/subscribe", async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint)
      return res.status(400).json({ error: "invalid subscription" });
    let subs = [];
    try {
      if (fs.existsSync(SUBS_FILE)) {
        subs = JSON.parse(fs.readFileSync(SUBS_FILE, "utf8")) || [];
      }
    } catch (e) {
      console.warn("Unable to read existing subscriptions", e);
      subs = [];
    }
    // avoid duplicates by endpoint
    if (!subs.find((s) => s.endpoint === sub.endpoint)) {
      subs.push(sub);
      try {
        fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), "utf8");
      } catch (e) {
        console.warn("Failed to persist subscription", e);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("subscribe error", err);
    res.status(500).json({ error: "server error" });
  }
});

// Admin helper: list stored subscriptions (useful for local testing)
app.get("/subscriptions", (req, res) => {
  try {
    let subs = [];
    if (fs.existsSync(SUBS_FILE))
      subs = JSON.parse(fs.readFileSync(SUBS_FILE, "utf8")) || [];
    res.json({ subscriptions: subs });
  } catch (e) {
    console.warn("Failed to read subscriptions", e);
    res.json({ subscriptions: [] });
  }
});

// Return badge definitions
app.get("/badges", (req, res) => {
  res.json(BADGES);
});

// Return badges status for a specific goal
app.get("/goals/:id/badges", async (req, res) => {
  try {
    const goalId = req.params.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    // compute eligibility and claim state
    const current = doc.currentStreak || 0;
    const totalDays = doc.totalDays || 30;
    const completedDays = doc.daysCompleted.length;
    const earnedSet = new Set(doc.badges || []);
    const claimedSet = new Set(doc.claimedBadges || []);

    const items = BADGES.map((b) => {
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
    res.json({
      badges: items,
      currentStreak: current,
      claimedBadges: doc.claimedBadges || [],
      earnedBadges: doc.badges || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Claim a badge for a specific goal
app.post("/goals/:id/claim-badge", async (req, res) => {
  try {
    const goalId = req.params.id;
    const { badgeId } = req.body || {};
    if (!badgeId) return res.status(400).json({ error: "badgeId required" });

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    const badgeDef = BADGES.find((b) => b.id === badgeId);
    if (!badgeDef) return res.status(400).json({ error: "unknown badge" });

    const current = doc.currentStreak || 0;
    const totalDays = doc.totalDays || 30;
    const completedDays = doc.daysCompleted.length;

    // Check eligibility based on badge type
    let eligible = false;
    if (badgeDef.id === "goal-completion") {
      eligible = completedDays >= totalDays;
    } else {
      eligible = current >= badgeDef.days;
    }

    if (!eligible) return res.status(403).json({ error: "not eligible yet" });

    doc.claimedBadges = Array.from(
      new Set([...(doc.claimedBadges || []), badgeId])
    );
    // ensure it's also present in earned badges set so server reflects earned state
    doc.badges = Array.from(new Set([...(doc.badges || []), badgeId]));
    await doc.save();
    res.json({
      success: true,
      claimedBadges: doc.claimedBadges,
      badges: doc.badges,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Routes (same as before)
app.post("/goals", async (req, res) => {
  try {
    const { goal, totalDays } = req.body;
    if (!goal) return res.status(400).json({ error: "goal is required" });
    const td = Number(totalDays) || 30;
    if (!Number.isFinite(td) || td < 1 || td > 3650)
      return res.status(400).json({ error: "invalid totalDays" });
    const exists = await Streak.findOne({ goal: goal.trim() });
    if (exists) return res.status(409).json({ error: "duplicate goal" });

    const doc = new Streak({
      goal: goal.trim(),
      totalDays: td,
      daysCompleted: [],
    });
    const saved = await doc.save();
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/goals", async (req, res) => {
  try {
    // Only return active (non-completed) goals by default
    const data = await Streak.find({ completed: { $ne: true } }).sort({
      createdAt: -1,
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get all completed goals (must come before /goals/:id to avoid conflicts)
app.get("/goals/completed", async (req, res) => {
  try {
    const completedGoals = await Streak.find({ completed: true }).sort({
      completedAt: -1,
    });
    res.json(completedGoals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/goals/:id", async (req, res) => {
  try {
    const goalId = req.params.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const data = await Streak.findById(goalId);
    if (!data) return res.status(404).json({ error: "not found" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/get-goal", async (req, res) => {
  try {
    const data = await Streak.findOne({});
    if (!data) return res.json(null);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/goals/:id/update-streak", async (req, res) => {
  try {
    const goalId = req.params.id;
    const body = req.body;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    let days = Array.from(new Set(doc.daysCompleted || []));
    if (Array.isArray(body.daysCompleted)) {
      days = Array.from(new Set(body.daysCompleted.map(Number)));
    } else if (typeof body.day === "number") {
      const day = Number(body.day);
      if (body.mark) {
        if (!days.includes(day)) days.push(day);
      } else {
        days = days.filter((d) => d !== day);
      }
    }

    days = days.filter((d) => d >= 1 && d <= (doc.totalDays || 30));

    const { currentStreak, bestStreak } = computeStreaks(days);
    const oldSet = new Set(doc.daysCompleted || []);
    const newSet = new Set(days);
    let added = 0;
    for (const d of newSet) if (!oldSet.has(d)) added += 1;

    doc.daysCompleted = Array.from(newSet).sort((a, b) => a - b);
    doc.currentStreak = currentStreak;
    doc.bestStreak = Math.max(doc.bestStreak || 0, bestStreak);
    if (added > 0) {
      doc.points = (doc.points || 0) + added * 10;
    }
    const pts = doc.points || 0;
    let level = "Beginner";
    if (pts >= 300) level = "Master";
    else if (pts >= 150) level = "Advanced";
    else if (pts >= 70) level = "Intermediate";
    doc.level = level;
    // award badges using stable IDs that match BADGES metadata
    const badges = new Set(doc.badges || []);
    if (doc.currentStreak >= 1) badges.add("day-1");
    if (doc.currentStreak >= 7) badges.add("7-day");
    if (doc.currentStreak >= 15) badges.add("15-day");
    if (doc.currentStreak >= 30) badges.add("30-day");
    if (doc.currentStreak >= 60) badges.add("60-day");
    if (doc.currentStreak >= 100) badges.add("100-day");

    // Check for goal completion badge (but don't auto-complete)
    const totalDays = doc.totalDays || 30;
    const completedDays = doc.daysCompleted.length;
    if (completedDays >= totalDays) {
      badges.add("goal-completion");
    }

    doc.badges = Array.from(badges);

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Set a goal as default (unsets any other default goal)
app.post("/goals/:id/set-default", async (req, res) => {
  try {
    const goalId = req.params.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    // First, unset any existing default goal
    await Streak.updateMany({ isDefault: true }, { isDefault: false });

    // Then set the specified goal as default
    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "goal not found" });

    doc.isDefault = true;
    await doc.save();

    res.json({ success: true, message: "Default goal set successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get the default goal
app.get("/goals/default", async (req, res) => {
  try {
    const defaultGoal = await Streak.findOne({ isDefault: true });
    if (!defaultGoal) return res.json(null);
    res.json(defaultGoal);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/server-date", (req, res) => {
  res.json({ serverDate: new Date().toISOString() });
});

// Helpful root endpoint so visiting the deployment URL shows useful info
app.get("/", (req, res) => {
  // If the client prefers HTML, send a tiny info page. Otherwise return JSON
  const accept = req.headers && req.headers.accept ? req.headers.accept : "";
  const info = {
    name: "Study Streak Tracker - Backend",
    message:
      "This endpoint serves the API. For API calls use /api/... routes (e.g. /api/server-date, /api/goals).",
    endpoints: {
      serverDate: "/api/server-date",
      goals: "/api/goals",
      getGoal: "/api/get-goal",
    },
  };
  if (accept.indexOf("text/html") !== -1) {
    return res.send(`
      <html>
        <head><title>Study Streak Tracker API</title></head>
        <body style="font-family:system-ui,Segoe UI,Arial;line-height:1.6;padding:24px">
          <h1>Study Streak Tracker — Backend</h1>
          <p>This deployment contains only the backend API. Use the following endpoints:</p>
          <ul>
            <li><a href="/api/server-date">/api/server-date</a></li>
            <li><a href="/api/get-goal">/api/get-goal</a></li>
            <li><a href="/api/goals">/api/goals</a></li>
          </ul>
          <p>To run the full app, deploy the frontend (the <code>/frontend</code> folder) or configure your Vercel routes to serve static files from it.</p>
        </body>
      </html>
    `);
  }
  return res.json(info);
});

// Return 204 for favicon requests to avoid 404 noise in logs when frontend isn't deployed here
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

app.post("/goals/:id/reminder", async (req, res) => {
  try {
    const { reminderTime, enabled } = req.body;
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    doc.reminderTime = reminderTime || null;
    doc.remindersEnabled = !!enabled;
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/goals/:id/reset", async (req, res) => {
  try {
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    // reset progress and badges for this goal
    doc.daysCompleted = [];
    doc.currentStreak = 0;
    // also clear earned and claimed badges when resetting a streak
    doc.badges = [];
    doc.claimedBadges = [];
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/goals/:id/edit", async (req, res) => {
  try {
    const { goal, totalDays } = req.body;
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    if (goal) doc.goal = goal;
    if (totalDays) doc.totalDays = Number(totalDays) || doc.totalDays;
    doc.daysCompleted = (doc.daysCompleted || []).filter(
      (d) => d >= 1 && d <= doc.totalDays
    );
    const { currentStreak, bestStreak } = computeStreaks(doc.daysCompleted);
    doc.currentStreak = currentStreak;
    doc.bestStreak = Math.max(doc.bestStreak || 0, bestStreak);

    // Re-evaluate badges including goal completion badge
    const badges = new Set(doc.badges || []);
    if (doc.currentStreak >= 1) badges.add("day-1");
    if (doc.currentStreak >= 7) badges.add("7-day");
    if (doc.currentStreak >= 15) badges.add("15-day");
    if (doc.currentStreak >= 30) badges.add("30-day");
    if (doc.currentStreak >= 60) badges.add("60-day");
    if (doc.currentStreak >= 100) badges.add("100-day");

    // Check for goal completion badge
    const completedDays = doc.daysCompleted.length;
    if (completedDays >= doc.totalDays) {
      badges.add("goal-completion");
    } else {
      badges.delete("goal-completion"); // Remove if no longer eligible
    }

    doc.badges = Array.from(badges);

    // Also remove from claimed badges if no longer eligible
    if (completedDays < doc.totalDays) {
      doc.claimedBadges = (doc.claimedBadges || []).filter(
        (b) => b !== "goal-completion"
      );
    }

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.delete("/goals/:id", async (req, res) => {
  try {
    const doc = await Streak.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Add resource to a goal
app.post("/goals/:id/add-resource", async (req, res) => {
  try {
    const { url, note } = req.body;
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    // Ensure at least one of url or note is present
    if (!url?.trim() && !note?.trim()) {
      return res.status(400).json({ error: "url or note required" });
    }

    // Normalize and validate URL if provided
    let normalizedUrl = url?.trim() || "";
    if (normalizedUrl) {
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = "https://" + normalizedUrl;
      }
      // remove trailing slashes
      normalizedUrl = normalizedUrl.replace(/\/+$|\s+/g, "");

      // validate via URL constructor
      try {
        new URL(normalizedUrl);
      } catch (e) {
        return res.status(400).json({ error: "invalid URL format" });
      }

      // Check for duplicate URL (compare normalized, case-insensitive)
      const existingResource = (doc.resources || []).find(
        (r) => r.url && r.url.toLowerCase() === normalizedUrl.toLowerCase()
      );
      if (existingResource) {
        return res.status(409).json({ error: "resource URL already exists" });
      }
    }

    const newResource = {
      url: normalizedUrl || "",
      note: note?.trim() || "",
      createdAt: new Date(),
    };

    doc.resources = doc.resources || [];
    doc.resources.push(newResource);
    await doc.save();

    res.json({
      success: true,
      resource: doc.resources[doc.resources.length - 1],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get all resources for a goal
app.get("/goals/:id/resources", async (req, res) => {
  try {
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    res.json({ resources: doc.resources || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete a specific resource
app.delete("/goals/:id/resource/:rid", async (req, res) => {
  try {
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    const resourceId = req.params.rid;
    const initialLength = (doc.resources || []).length;

    doc.resources = (doc.resources || []).filter(
      (r) => r._id.toString() !== resourceId
    );

    if (doc.resources.length === initialLength) {
      return res.status(404).json({ error: "resource not found" });
    }

    await doc.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Complete a goal
app.post("/goals/:id/complete", async (req, res) => {
  try {
    const goalId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    // Mark as completed
    doc.completed = true;
    doc.completedAt = new Date();

    // Award goal completion badge if not already earned
    if (!doc.badges.includes("goal-completion")) {
      doc.badges.push("goal-completion");
    }

    await doc.save();
    res.json({ success: true, message: "Goal completed successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Uncomplete a goal (optional - allows users to reopen completed goals)
app.post("/goals/:id/uncomplete", async (req, res) => {
  try {
    const goalId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(goalId)) {
      return res.status(400).json({ error: "invalid goal id format" });
    }

    const doc = await Streak.findById(goalId);
    if (!doc) return res.status(404).json({ error: "no goal found" });

    // Unmark as completed
    doc.completed = false;
    doc.completedAt = null;

    await doc.save();
    res.json({ success: true, message: "Goal reopened successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = app;
