// teacher-app/src/api/apiFetch.js

const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL || "https://api.curriculate.net";

function getToken() {
  try {
    return (
      localStorage.getItem("curriculate_token") ||
      localStorage.getItem("token") ||
      ""
    );
  } catch {
    return "";
  }
}

async function readBodySafe(res) {
  const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const token = getToken();

  const headers = {
    ...(options.headers || {}),
  };

  // Add JSON header only when sending a body (and caller didn't override)
  if (options.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }

  // Attach Bearer token if present (backend authRequired expects this)
  if (token && headers.Authorization == null) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });

  const body = await readBodySafe(res);

  // Normalize non-OK into a consistent JSON shape
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && (body.error || body.message)) ||
      (typeof body === "string" ? body : null) ||
      `Request failed: ${res.status}`;

    return { ok: false, status: res.status, error: msg };
  }

  // If server returned JSON, keep it; otherwise wrap text
  if (body && typeof body === "object") return body;
  return { ok: true, data: body };
}
