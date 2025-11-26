import axios from "axios";

// Decide base URL: env override first, then localhost in dev, otherwise production API
let fallbackBase;
if (typeof window !== "undefined" && window.location.hostname === "localhost") {
  fallbackBase = "http://localhost:10000";
} else {
  fallbackBase = "https://api.curriculate.net";
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || fallbackBase,
});

// Attach auth token automatically (supports both old and new keys)
api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("curriculate_token") ||
    localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
