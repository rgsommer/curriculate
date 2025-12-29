/**
 * teacher-app/src/utils/apiFetch.js
 * apiFetch: fetch wrapper that:
 * - adds Bearer token from localStorage (if present)
 * - detects plan-gate 403 responses and dispatches a global event:
 *     window.dispatchEvent(new CustomEvent("plan:upgradeRequired", { detail: {...} }))
 *
 * Use this anywhere TeacherApp calls gated endpoints (PDF export, student detail, etc.)
 */

export async function apiFetch(url, options = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...options, headers });

  // Try to parse json for richer errors
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    // Plan gate pattern from backend middleware
    if (
      res.status === 403 &&
      (json?.error === "Plan upgrade required" || json?.feature)
    ) {
      try {
        window.dispatchEvent(
          new CustomEvent("plan:upgradeRequired", {
            detail: {
              feature: json?.feature,
              planTier: json?.planTier,
              message: json?.error || "Plan upgrade required",
            },
          })
        );
      } catch {}
    }

    const msg = json?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = json;
    throw err;
  }

  return json;
}
