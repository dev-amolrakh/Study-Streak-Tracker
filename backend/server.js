// Keep a small server script for local development that imports the app
const app = require("./app");

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
