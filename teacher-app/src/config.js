// src/config.js

export const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:10000"
    : "https://api.curriculate.net";
