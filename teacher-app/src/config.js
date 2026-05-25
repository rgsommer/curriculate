// teacher-app/src/config.js

export const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:10000"   // dev backend
    : "https://api.curriculate.net";   // 👈 NO /api here

// Where the student app lives (for "Test run" / preview links). Student dev
// server runs on :5174 (see student-app/vite.config.js); prod is play.curriculate.net.
export const STUDENT_APP_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:5174"
    : "https://play.curriculate.net";
