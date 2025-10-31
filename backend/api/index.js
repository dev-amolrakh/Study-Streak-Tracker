// Vercel serverless wrapper that forwards all requests to the exported Express app
// This file is intended to be the single entrypoint for the project when deploying
// the backend to Vercel. It normalizes the request URL so express routes match.
const app = require("../app");

module.exports = (req, res) => {
  try {
    // If the incoming URL contains an /api prefix (depends on Vercel route config),
    // strip it so Express sees clean routes like /goals, /server-date, etc.
    if (req.url && req.url.startsWith("/api")) {
      req.url = req.url.replace(/^\/api/, "") || "/";
    }
  } catch (e) {
    // ignore and forward
  }
  return app(req, res);
};
