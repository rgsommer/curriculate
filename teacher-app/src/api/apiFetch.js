// teacher-app/src/api/apiFetch.js

// Safe helper: no React hooks used here.
export function apiFetch(path, options = {}) {
  const token = localStorage.getItem("curriculate_token") || "";

  const headers = {
    ...(options.headers || {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(`https://api.curriculate.net${path}`, {
    ...options,
    headers,
  });
}
