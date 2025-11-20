// student-app/src/config.js

// Decide backend URL based on where the app is running.
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const API_BASE_URL = isLocalHost
  ? "http://localhost:10001"          // local dev backend
  : "https://api.curriculate.net";    // Render backend in production
