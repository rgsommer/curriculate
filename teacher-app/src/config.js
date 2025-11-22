// teacher-app/src/config.js

export const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:10000"   // dev backend
    : "https://api.curriculate.net";   // 👈 NO /api here
