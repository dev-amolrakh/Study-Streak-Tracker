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
  if (mongoose.connections && mongoose.connections[0] && mongoose.connections[0].readyState === 1) {
    return;
  }
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
}

connectOnce().catch((err) => {
  if (process.env.NODE_ENV !== "production") console.error("Mongo connection error:", err);
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
    const data = await Streak.find({}).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

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

app.get('/server-date', (req, res) => {
  res.json({ serverDate: new Date().toISOString() });
});

app.post('/goals/:id/reminder', async (req, res) => {
  try {
    const { reminderTime, enabled } = req.body;
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'no goal found' });
    doc.reminderTime = reminderTime || null;
    doc.remindersEnabled = !!enabled;
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/goals/:id/reset', async (req, res) => {
  try {
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'no goal found' });
    doc.daysCompleted = [];
    doc.currentStreak = 0;
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/goals/:id/edit', async (req, res) => {
  try {
    const { goal, totalDays } = req.body;
    const doc = await Streak.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'no goal found' });
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
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/goals/:id', async (req, res) => {
  try {
    const doc = await Streak.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = app;
