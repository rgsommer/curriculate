// backend/behavior/lib/providers/EdsbyProvider.js
//
// Edsby implementation of NotificationProvider (brief §4), ported from the
// school's working Apps Script (missing-work-complete.gs) — the request shape is
// DevTools-verified, not a guess.
//
// ⚠️ Edsby has NO public API. Delivery is an authenticated "broadcast" POST:
//   POST <base>/core/create/<userNid>?xds=broadcastNewFanOutTeacher&nodetype=4.19
//   multipart/form-data: _formkey, to (recipient nids CSV), body-body-body (msg),
//   _nids (recipient nids dot-joined), + empty addresources fields.
//   Headers: Cookie (session), x-xds-jver, x-xds-cver,
//            x-edsby-client-request-queue: net::post, Referer /p/Panorama/<studentNid>.
//
// ALL Edsby specifics live here. Secrets (cookie, formkey) are held only in
// memory, decrypted by the caller from BehaviorConfig — never logged or
// returned to a client.
//
// The orchestrator (notify.js) calls send() ONCE PER RECIPIENT, so each parent
// is broadcast to separately, addressed by their own Edsby nid (edsbyParentId).

import { NotificationProvider } from "./NotificationProvider.js";

export class EdsbyProvider extends NotificationProvider {
  constructor({ baseUrl = "", cookie = "", formkey = "", jver = "", cver = "", userNid = "", studentNid = "" } = {}) {
    super();
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.cookie = cookie || "";
    this.formkey = formkey || "";
    this.jver = jver || "";
    this.cver = cver || "";
    this.userNid = String(userNid || "").trim();
    this.studentNid = String(studentNid || "").trim(); // for the Panorama Referer
  }

  get key() {
    return "edsby";
  }

  /**
   * Verify the session works: do an authenticated request that returns a fresh
   * _formkey (mirrors the school's refreshEdsbyFormkey_). Confirms the cookie is
   * valid and the post path will authenticate — without messaging a parent.
   * Returns { ok, message?, error?, formkey? }.
   */
  async testConnection(zoomId) {
    if (!this.baseUrl || !this.cookie) return { ok: false, error: "Edsby not connected — set base URL + session cookie." };
    if (!this.userNid) return { ok: false, error: "Edsby user nid not set." };
    const zid = String(zoomId || "").trim();
    if (!zid) return { ok: false, error: "A Zoom/class id is needed for the connection test — set it in the Edsby connection." };

    const url = `${this.baseUrl}/core/node.json/${zid}?xds=ZoomMyStudents&_method=GET`;
    const boundary = "----CurriculateTest" + Date.now();
    const payload =
      `--${boundary}\r\nContent-Disposition: form-data; name="_formkey"\r\n\r\n${this.formkey || ""}\r\n--${boundary}--\r\n`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: this.cookie,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-xds-jver": this.jver,
        "x-xds-cver": this.cver,
        "x-edsby-client-request-queue": "net::post",
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/p/ZoomMyStudents/${zid}`,
      },
      body: payload,
      redirect: "manual",
    });
    const text = await res.text().catch(() => "");
    if (/login/i.test(text) && /<form/i.test(text)) {
      return { ok: false, error: "Edsby session cookie has expired — re-paste it in Setup." };
    }
    const m = text.match(/"_formkey"\s*:\s*"([^"]+)"/);
    if (m) return { ok: true, message: "Edsby session is valid — authenticated and refreshed the formkey.", formkey: m[1] };
    return { ok: false, error: `Edsby responded ${res.status}; could not read a formkey (check user nid / Zoom id / jver / cver / cookie).` };
  }

  async send({ recipient, body }) {
    if (!this.baseUrl || !this.cookie) {
      return { ok: false, error: "Edsby not connected (set base URL + session cookie in Setup)", channel: this.key };
    }
    if (!this.userNid || !this.formkey) {
      return { ok: false, error: "Edsby user nid / formkey not set (refresh from a logged-in Edsby page)", channel: this.key };
    }
    const parentNid = recipient?.edsbyParentId;
    if (!parentNid) {
      return { ok: false, error: "recipient has no Edsby parent nid (harvest parent nids first)", channel: this.key };
    }
    try {
      const r = await postBroadcast(this, parentNid, body);
      return r.ok ? { ok: true, channel: this.key } : { ok: false, error: r.error, channel: this.key };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), channel: this.key };
    }
  }
}

/** POST one broadcast to a single parent nid. Mirrors edsbyPostBroadcast_. */
async function postBroadcast(p, parentNid, body) {
  const url =
    `${p.baseUrl}/core/create/${p.userNid}` +
    `?xds=broadcastNewFanOutTeacher&nodetype=${encodeURIComponent("4.19")}`;

  const recipients = [String(parentNid)]; // one parent per broadcast
  const boundary = "----CurriculateBoundary" + Date.now();
  const fields = [
    ["_formkey", p.formkey],
    ["to", recipients.join(",")],
    ["body-nodetype", "4"],
    ["body-nodesubtype", "0"],
    ["body-body-body", String(body || "")],
    ["body-url", ""],
    ["body-addresources-integrations-integrationfiledata", ""],
    ["body-addresources-integrations-integrationfiles", ""],
    ["body-addresources-linkFiles", ""],
    ["body-addresources-linkRich", ""],
    ["_nids", recipients.join(".")],
  ];
  let payload = "";
  for (const [name, value] of fields) {
    payload += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`;
  }
  payload += `--${boundary}--\r\n`;

  const headers = {
    Cookie: p.cookie,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "x-edsby-client-request-queue": "net::post",
    "x-xds-jver": p.jver,
    "x-xds-cver": p.cver,
    Origin: p.baseUrl,
  };
  if (p.studentNid) headers.Referer = `${p.baseUrl}/p/Panorama/${p.studentNid}`;

  const res = await fetch(url, { method: "POST", headers, body: payload, redirect: "manual" });
  const text = await res.text().catch(() => "");

  if (res.status >= 200 && res.status < 300 && !/<form[^>]*login/i.test(text)) {
    return { ok: true };
  }
  if (/"error"\s*:\s*1011\b/.test(text)) {
    return { ok: false, error: "Edsby formkey expired (error 1011) — refresh the formkey in Setup" };
  }
  if (/login/i.test(text) && /<form/i.test(text)) {
    return { ok: false, error: "Edsby session cookie expired — re-paste it in Setup" };
  }
  return { ok: false, error: `Edsby responded ${res.status} ${res.statusText}` };
}

export default EdsbyProvider;
