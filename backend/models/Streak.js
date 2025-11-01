const mongoose = require("mongoose");

const StreakSchema = new mongoose.Schema(
  {
    goal: { type: String, required: true },
    daysCompleted: { type: [Number], default: [] },
    points: { type: Number, default: 0 },
    level: { type: String, default: "Beginner" },
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
    // badges the user has earned (system-detected based on streaks)
    badges: { type: [String], default: [] },
    // badges the user has claimed (explicit user action)
    claimedBadges: { type: [String], default: [] },
    // study resources linked to this goal
    resources: {
      type: [
        {
          url: { type: String, default: "" },
          note: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    // flag to mark this goal as the default one to display on app load
    isDefault: { type: Boolean, default: false },
    // flag to mark this goal as completed
    completed: { type: Boolean, default: false },
    // date when the goal was completed
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Streak", StreakSchema);
