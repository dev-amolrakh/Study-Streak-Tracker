Study Streak Tracker — Backend

This folder contains the backend API for the Study Streak Tracker app.

Quick notes for deploying to Vercel

- The Express app is exported from `app.js`. The Vercel function entrypoint is `api/index.js`, which forwards requests to the Express app.
- Environment variable to set on Vercel: `MONGO_URI` with your MongoDB connection string. If this is not set, the app falls back to a hard-coded connection string (not recommended).
- The project declares `engines.node: 18.x` in `package.json` to match Vercel's Node 18 runtime.

Local testing

1. Install dependencies in the `backend` folder:

   npm install

2. Start locally (for quick dev test):

   node server.js

   The server listens on port 5000 by default.

Testing with Vercel locally

- Install the Vercel CLI and run `vercel dev` in the project root. Ensure `MONGO_URI` is set in your environment or via a `.env` file (Vercel CLI will pick it up if you set it locally). Example:

  # PowerShell example
  $env:MONGO_URI = "<your-mongo-uri>"; vercel dev

Deployment notes

- Set `MONGO_URI` in the Vercel project settings (Environment Variables) to avoid using the fallback string.
- The API endpoints are reachable under `/api/*`.

If you want I can:
- Remove the hard-coded fallback connection string and fail fast when `MONGO_URI` is missing (recommended for security),
- Add automated tests or a small health-check endpoint for readiness monitoring.
