// student-app/src/utils/reportImageFailure.js
//
// Fire-and-forget telemetry: when an image task's primary image (AI/S3/external)
// fails to load and we fall back, tell the backend so the failure lands in the
// feedback report (feedback-curriculate) and a real fix can be initiated —
// instead of silently degrading and waiting for a human to notice.
//
// Best-effort, deduped per page load, never throws.

import { API_BASE_URL } from "../config.js";

const _seen = new Set();

export function reportImageFailure({ taskType, url, source = "" }) {
  try {
    const tt = String(taskType || "").trim();
    if (!tt) return;
    const u = String(url || "").slice(0, 300);
    const key = `${tt}|${u}`;
    if (_seen.has(key)) return; // one ping per distinct failure per session
    _seen.add(key);

    const practice = (typeof window !== "undefined" && window.__CURRICULATE_PRACTICE__) || {};
    const build = (typeof window !== "undefined" && window.__CURRICULATE_BUILD__ && window.__CURRICULATE_BUILD__.commit) || "";

    fetch(`${API_BASE_URL}/api/conference/image-failure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        email: practice.email || "",
        conference: practice.conference || "general",
        taskType: tt,
        url: u,
        source: String(source || "").slice(0, 40),
        build,
      }),
    }).catch(() => {});
  } catch {
    /* never let telemetry break the task */
  }
}

export default reportImageFailure;
