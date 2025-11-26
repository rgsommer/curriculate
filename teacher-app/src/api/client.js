// teacher-app/src/api/client.js
import axios from "axios";

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    "https://api.curriculate.net" || 
    "http://localhost:10000", // fallback for local dev
});

// Attach auth token automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("curriculate_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
