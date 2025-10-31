const app = require('../app');

module.exports = (req, res) => {
  // Vercel functions are mounted under /api — strip that so Express routes match
  try {
    // ensure the URL path passed to Express does not contain the /api prefix
    if (req.url && req.url.startsWith('/api')) req.url = req.url.replace(/^\/api/, '') || '/';
  } catch (e) {}
  return app(req, res);
};
