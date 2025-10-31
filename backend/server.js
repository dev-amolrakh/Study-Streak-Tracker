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

mongoose
  .connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    if (process.env.NODE_ENV !== "production") console.log("MongoDB connected");
  })
  .catch((err) => console.error("Mongo connection error:", err));

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
    // current streak is run that ends at the last completed day
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (days[i] === days[i - 1] + 1) current += 1;
      else break;
    }
    // if last element isn't consecutive with previous, current is 1 (the last day itself)
  }
  return { currentStreak: current, bestStreak: best };
}

// Add or replace goal
// Create a new goal
app.post("/goals", async (req, res) => {
  try {
    const { goal, totalDays } = req.body;
    if (!goal) return res.status(400).json({ error: "goal is required" });
    // validate totalDays
    const td = Number(totalDays) || 30;
    if (!Number.isFinite(td) || td < 1 || td > 3650)
      return res.status(400).json({ error: "invalid totalDays" });
    // prevent duplicate goal name for the same user/app
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

// List goals
app.get("/goals", async (req, res) => {
  try {
    const data = await Streak.find({}).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get single goal
app.get("/goals/:id", async (req, res) => {
  try {
    const data = await Streak.findById(req.params.id);
    if (!data) return res.status(404).json({ error: "not found" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get the saved goal (single doc)
// (old single-goal endpoint kept for backward compatibility)
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

// Update streak - accepts { day, mark } or { daysCompleted: [...] }
// Update streak for a specific goal
app.post("/goals/:id/update-streak", async (req, res) => {
  try {
    const body = req.body;
    const doc = await Streak.findById(req.params.id);
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
    // determine newly added days to award points
    const oldSet = new Set(doc.daysCompleted || []);
    const newSet = new Set(days);
    let added = 0;
    for (const d of newSet) if (!oldSet.has(d)) added += 1;

    doc.daysCompleted = Array.from(newSet).sort((a, b) => a - b);
    doc.currentStreak = currentStreak;
    doc.bestStreak = Math.max(doc.bestStreak || 0, bestStreak);
    // award points: 10 per newly completed day
    if (added > 0) {
      doc.points = (doc.points || 0) + added * 10;
    }
    // compute level from points
    const pts = doc.points || 0;
    let level = "Beginner";
    if (pts >= 300) level = "Master";
    else if (pts >= 150) level = "Advanced";
    else if (pts >= 70) level = "Intermediate";
    doc.level = level;
    // award badges based on streaks
    const badges = new Set(doc.badges || []);
    if (doc.currentStreak >= 7) badges.add("bronze-7");
    if (doc.currentStreak >= 15) badges.add("silver-15");
    if (doc.currentStreak >= 30) badges.add("gold-30");
    doc.badges = Array.from(badges);

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Get server date directly (explicit endpoint for verification)
app.get("/server-date", (req, res) => {
  res.json({ serverDate: new Date().toISOString() });
});

// Set reminder time for a goal
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

// Reset streak
// Reset a specific goal
app.post("/goals/:id/reset", async (req, res) => {
  try {
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "no goal found" });
    doc.daysCompleted = [];
    doc.currentStreak = 0;
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Edit goal text or totalDays
// Edit a specific goal
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
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete a goal
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
