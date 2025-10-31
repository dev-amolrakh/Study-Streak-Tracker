// Keep a small server script for local development that imports the app
// Only call listen when this file is executed directly. This prevents
// accidental server startup in serverless environments (where we `require` the app).
const app = require("./app");

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
}
