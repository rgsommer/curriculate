// teacher-app/src/api/apiFetch.js
//
// Two helpers:
// - apiFetch(): returns the native fetch Response (so callers can handle blobs/streams/etc).
// - apiFetchJson(): returns parsed JSON (and throws on non-2xx unless you pass { okOnNon2xx: true }).
//

export function apiFetch(path, options = {}) {
  const token =
    (typeof window !== "undefined" &&
      (localStorage.getItem("curriculate_token") || localStorage.getItem("token"))) ||
    "";

  const headers = {
    ...(options.headers || {}),
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const API_BASE =
    (import.meta?.env?.VITE_API_BASE_URL) || "https://api.curriculate.net";

  return fetch(`${API_BASE}${path}`, {
    credentials: options.credentials ?? "include",
    ...options,
    headers,
  });
}

export async function apiFetchJson(path, options = {}, { okOnNon2xx = false } = {}) {
  const res = await apiFetch(path, options);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok && !okOnNon2xx) {
    const msg =
      (data && (data.error || data.message)) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}
