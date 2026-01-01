const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL || "https://api.curriculate.net";

export async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const token =
    localStorage.getItem("curriculate_token") ||
    localStorage.getItem("token") ||
    "";

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Only set JSON header when sending a body and caller didn't override it
  const hasBody = options.body != null;
  if (hasBody && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });
}
