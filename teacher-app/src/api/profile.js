// teacher-app/src/api/profile.js
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

// Try common token keys so you don't get stuck on "token" naming.
function getAuthToken() {
  if (typeof window === "undefined") return null;

  try {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("accessToken") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("idToken") ||
      localStorage.getItem("curriculateToken") ||
      null
    );
  } catch {
    return null;
  }
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // If server returns HTML/plaintext, keep a small snippet for debugging
    return { _nonJson: text.slice(0, 300) };
  }
}

function buildAuthHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", body = null } = {}) {
  const headers = {
    ...buildAuthHeaders(),
  };

  // Attach JSON only when sending a body
  const opts = {
    method,
    headers,
    credentials: "include", // safe to keep; doesn't hurt bearer auth
  };

  if (body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await readJsonSafe(res);

  if (!res.ok) {
    // Prefer structured error from backend
    const serverMsg =
      data?.error ||
      data?.message ||
      (typeof data?._nonJson === "string" ? data._nonJson : null);

    const hint =
      res.status === 401
        ? "Unauthorized (missing/invalid token). Check localStorage token key + login flow."
        : null;

    const msg = serverMsg || `Request failed (${res.status})`;
    const err = new Error(hint ? `${msg} — ${hint}` : msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// Public API
export function fetchMyProfile() {
  return request("/api/profile", { method: "GET" });
}

export function updateMyProfile(payload) {
  return request("/api/profile", { method: "PUT", body: payload || {} });
}

/**
 * Optional helper you can call right after login to standardize storage.
 * If your login currently stores under a different key, call:
 *   setAuthToken(tokenString)
 */
export function setAuthToken(token) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem("token", token);
  } catch {
    // ignore
  }
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("token");
    // (optional) also clear alternates if you want:
    // localStorage.removeItem("accessToken");
    // localStorage.removeItem("jwt");
  } catch {
    // ignore
  }
}
