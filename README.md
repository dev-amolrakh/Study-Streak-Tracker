# Study Streak Tracker

Minimal Study Streak Tracker web app (Frontend: HTML/CSS/JS, Backend: Node/Express, MongoDB) to persist a 30-day study streak.

Quick start

1. Backend

   - Open a terminal and change to the backend folder:

     ```powershell
     cd "D:/Study Tracker App/study-streak-tracker/backend"
     npm install
     npm run start
     ```

   - Server will start on port 5000. It connects to the MongoDB cluster using the connection string already embedded in `server.js` and uses database `studyTracker` and collection `streaks`.

2. Frontend

   - Open `frontend/index.html` in your browser (or serve the `frontend/` folder with a static server). The UI will talk to `http://localhost:5000`.

Notes

- Endpoints implemented:

  - `POST /add-goal` — create or replace a goal (body: { goal, totalDays })
  - `GET /get-goal` — fetch saved goal/streak
  - `POST /update-streak` — toggle a day or update days (body: { day, mark } or { daysCompleted: [...] })
  - `POST /reset` — clear completed days
  - `POST /edit-goal` — edit goal text or totalDays

- Schema: see `backend/models/Streak.js`.
- The connection string in `server.js` uses the provided credentials and DB `studyTracker`.

Security

This project contains a MongoDB connection string in source for demonstration as requested. For production, move credentials to environment variables.
