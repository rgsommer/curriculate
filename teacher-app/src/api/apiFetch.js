// teacher-app/src/api/apiFetch.js

const DEFAULT_API_BASE =
  (import.meta?.env?.VITE_API_BASE || "").trim() || "https://api.curriculate.net";

// EXACT same logic as TeacherApp.jsx
export function getStoredAuthToken() {
  const candidates = [
    "curriculateToken",
    "curriculate_token",
    "token",
    "authToken",
    "accessToken",
    "jwt",
  ];

  for (const k of candidates) {
    try {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (typeof v === "string" && v.trim().length > 40) return v.trim();
    } catch {}
  }
  return "";
}

function isAbsoluteUrl(path) {
  return /^https?:\/\//i.test(String(path || ""));
}

function normalizeUrl(path) {
  const p = String(path || "").trim();
  if (!p) return DEFAULT_API_BASE;
  if (isAbsoluteUrl(p)) return p;
  if (p.startsWith("/")) return `${DEFAULT_API_BASE}${p}`;
  return `${DEFAULT_API_BASE}/${p}`;
}

function mergeHeaders(base, extra) {
  const h = new Headers(base || {});
  const e = new Headers(extra || {});
  e.forEach((v, k) => h.set(k, v));
  return h;
}

/**
 * Low-level fetch wrapper.
 * - Auto-attaches Bearer token when present (unless caller already set Authorization).
 * - Leaves credential mode to you (default: "omit") — see note below.
 */
export async function apiFetch(path, options = {}) {
  const url = normalizeUrl(path);

  const method = (options.method || "GET").toUpperCase();

  const headers = mergeHeaders(
    // base defaults
    {
      Accept: "application/json",
    },
    options.headers
  );

  // Attach token if caller didn't already set Authorization
  if (!headers.has("Authorization")) {
    const token = getStoredAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  // If sending JSON and caller didn't specify content-type, set it.
  const hasBody = options.body != null && method !== "GET" && method !== "HEAD";
  if (hasBody && !headers.has("Content-Type") && typeof options.body === "string") {
    // If they passed a string, we can't reliably infer; leave as-is.
  }

  const fetchOptions = {
    ...options,
    method,
    headers,
    // IMPORTANT: If your backend auth is cookie-based instead of Bearer,
    // change this to "include" (and ensure CORS allows credentials).
    credentials: options.credentials || "omit",
  };

  return fetch(url, fetchOptions);
}

/**
 * JSON helper:
 * - JSON.stringify body objects automatically (unless body is already FormData/string/etc).
 * - Throws on non-2xx with a helpful message.
 */
export async function apiFetchJson(path, options = {}) {
  const opts = { ...options };

  // Auto-JSON encode plain objects/arrays
  if (
    opts.body != null &&
    typeof opts.body === "object" &&
    !(opts.body instanceof FormData) &&
    !(opts.body instanceof Blob) &&
    !(opts.body instanceof ArrayBuffer)
  ) {
    // if it's already a ReadableStream etc, skip
    try {
      opts.body = JSON.stringify(opts.body);
      opts.headers = mergeHeaders(opts.headers, { "Content-Type": "application/json" });
    } catch {
      // fall through
    }
  }

  const res = await apiFetch(path, opts);

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let payload = null;
  try {
    payload = isJson ? await res.json() : await res.text();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const msg =
      (payload && typeof payload === "object" && (payload.error || payload.message)) ||
      (typeof payload === "string" ? payload : "") ||
      `Request failed (${res.status})`;

    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}
