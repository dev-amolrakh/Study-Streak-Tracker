// Root serverless wrapper (repository root) for Vercel deployments.
// This file forwards requests to the backend app located in ./backend.
try {
  module.exports = require("../backend/api/index");
} catch (e) {
  // If backend wrapper is not available, expose a fallback that returns 500.
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.end("Backend wrapper not found. Ensure backend/api/index.js exists.");
  };
}
