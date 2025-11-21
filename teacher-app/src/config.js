// src/config.js

const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:10000"
    : "https://api.curriculate.net";

