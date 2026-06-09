// backend/behavior/lib/providers/EdsbyProvider.js
//
// Edsby implementation of NotificationProvider (brief §4).
//
// ⚠️ RISK (flagged to the school): Edsby has NO official public API. Delivery is
// authenticated cookie/session posting. ALL Edsby-specific logic lives in THIS
// module so the fragility is quarantined. The session cookie is held only in
// memory here (decrypted from BehaviorConfig.edsby.cookieEnc by the caller) —
// never logged, never returned to a client.
//
// The orchestrator (notify.js) calls send() ONCE PER RECIPIENT, so each parent
// is posted to separately — using their own edsbyParentId.
//
// The one Edsby-specific unknown is the exact send request (URL + payload +
// CSRF/nonce handling), which differs per Edsby deployment and isn't publicly
// documented. It's isolated in postEdsbyMessage() and driven by env so it can be
// filled in from the school's existing login/post script without touching the
// rest of the app:
//   BEHAVIOR_EDSBY_SEND_PATH  — path appended to baseUrl for the send request
//   BEHAVIOR_EDSBY_CSRF_PATH  — (optional) path to GET a CSRF/nonce token first
//   BEHAVIOR_EDSBY_CSRF_FIELD — (optional) form/JSON field name for that token

import { NotificationProvider } from "./NotificationProvider.js";

export class EdsbyProvider extends NotificationProvider {
  constructor({ baseUrl = "", cookie = "" } = {}) {
    super();
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.cookie = cookie || "";
  }

  get key() {
    return "edsby";
  }

  async send({ recipient, subject, body }) {
    if (!this.baseUrl || !this.cookie) {
      return { ok: false, error: "Edsby not connected (set base URL + session cookie in Setup)", channel: this.key };
    }
    const target = recipient?.edsbyParentId;
    if (!target) {
      return { ok: false, error: "recipient has no Edsby parent id", channel: this.key };
    }
    try {
      const r = await postEdsbyMessage({
        baseUrl: this.baseUrl,
        cookie: this.cookie,
        edsbyParentId: target,
        subject,
        body,
      });
      return r.ok ? { ok: true, channel: this.key } : { ok: false, error: r.error, channel: this.key };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), channel: this.key };
    }
  }
}

/**
 * Post a single message to one parent in Edsby using the session cookie.
 *
 * The structure (optional CSRF fetch → authenticated POST) is real; the exact
 * endpoint + payload come from the school's existing Edsby script via env. Until
 * BEHAVIOR_EDSBY_SEND_PATH is provided we return a clear not-configured error so
 * the orchestrator fails over to email — we never silently "succeed".
 */
async function postEdsbyMessage({ baseUrl, cookie, edsbyParentId, subject, body }) {
  const sendPath = process.env.BEHAVIOR_EDSBY_SEND_PATH;
  if (!sendPath) {
    return {
      ok: false,
      error:
        "Edsby send endpoint not configured — provide the send request from your Edsby script (set BEHAVIOR_EDSBY_SEND_PATH).",
    };
  }

  const headers = {
    Cookie: cookie,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
  };

  // Optional: fetch a CSRF/nonce token first (many Edsby actions require one).
  let csrf = "";
  const csrfPath = process.env.BEHAVIOR_EDSBY_CSRF_PATH;
  if (csrfPath) {
    const cr = await fetch(`${baseUrl}${csrfPath}`, { headers: { Cookie: cookie } });
    const ct = cr.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await cr.json().catch(() => ({}));
      csrf = j.csrf || j.token || j.nonce || "";
    } else {
      const txt = await cr.text();
      const m = txt.match(/name=["']?(?:csrf|_token|nonce)["']?[^>]*value=["']([^"']+)["']/i);
      csrf = m ? m[1] : "";
    }
  }

  const payload = { to: edsbyParentId, subject, body };
  const csrfField = process.env.BEHAVIOR_EDSBY_CSRF_FIELD;
  if (csrf && csrfField) payload[csrfField] = csrf;
  if (csrf && csrfField) headers["X-CSRF-Token"] = csrf;

  const res = await fetch(`${baseUrl}${sendPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    return { ok: false, error: `Edsby responded ${res.status} ${res.statusText}` };
  }
  return { ok: true };
}

export default EdsbyProvider;
