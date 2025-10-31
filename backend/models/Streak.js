const mongoose = require("mongoose");

const StreakSchema = new mongoose.Schema(
  {
    goal: { type: String, required: true },
    daysCompleted: { type: [Number], default: [] },
    points: { type: Number, default: 0 },
    level: { type: String, default: "Beginner" },
    badges: { type: [String], default: [] },
    currentStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    totalDays: { type: Number, default: 30 },
    startDate: {
      type: String,
      default: () => new Date().toISOString().split("T")[0],
    },
    // reminder settings (optional)
    reminderTime: { type: String, default: null }, // HH:MM (24h)
    remindersEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Streak", StreakSchema);
