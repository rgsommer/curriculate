// Behaviours — Edsby Cookie Sync (MV3 service worker).
//
// Watches your Edsby session cookie. Whenever it changes (login, server-side
// refresh, expiry-then-renew) it POSTs the full cookie header to the Behaviours
// ingest endpoint, authenticated by your per-school ingest token. The app then
// always has a fresh cookie, so parent notices keep posting via Edsby without a
// manual DevTools paste.
//
// This is school-agnostic: every school on the hosted app uses the SAME ingest
// endpoint (api.curriculate.net) — only the Edsby subdomain and the token differ,
// and both are set on the options page. Cookies are sent ONLY to the configured
// ingest URL; nothing is sent anywhere else.

const COOKIE_NAME = "session_id_edsby";
const ALARM_NAME = "edsby-cookie-periodic-push";
const DEFAULT_INGEST_URL = "https://api.curriculate.net/api/behavior/edsby/ingest";

// ---- config ----------------------------------------------------------------

async function getConfig() {
  const { edsbyHost, ingestToken, ingestUrl } = await chrome.storage.local.get([
    "edsbyHost",
    "ingestToken",
    "ingestUrl",
  ]);
  return {
    edsbyHost: (edsbyHost || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    ingestToken: (ingestToken || "").trim(),
    ingestUrl: (ingestUrl || "").trim() || DEFAULT_INGEST_URL,
  };
}

// ---- cookie reading --------------------------------------------------------

// Build the full Cookie header (all cookies sent to the Edsby host), matching
// what a manual DevTools copy would give — more robust than the session cookie
// alone.
async function readCookieHeader(host) {
  if (!host) return "";
  const url = "https://" + host + "/";
  const all = await chrome.cookies.getAll({ url });
  if (!all || !all.length) return "";
  return all.map((c) => c.name + "=" + c.value).join("; ");
}

// ---- push ------------------------------------------------------------------

// oneShot=true pushes the cookie into a short-lived, single-run slot (for an
// honour-roll run) instead of the persistent session — so it isn't stored warm.
async function pushNow(oneShot = false) {
  const cfg = await getConfig();
  if (!cfg.edsbyHost) return setLast({ ok: false, error: "Set your Edsby host on the options page." });
  if (!cfg.ingestToken) return setLast({ ok: false, error: "Set your Behaviours ingest token on the options page." });

  const cookieHeader = await readCookieHeader(cfg.edsbyHost);
  if (!cookieHeader || !cookieHeader.includes(COOKIE_NAME + "=")) {
    return setLast({ ok: false, error: "No Edsby session cookie found — open https://" + cfg.edsbyHost + "/ and sign in." });
  }

  // Merge in any page identifiers the content script captured (jver/cver/
  // userNid/formkey from window._cf) so the app gets everything in one push.
  const { pageCreds } = await chrome.storage.local.get("pageCreds");
  const payload = { cookie: cookieHeader, baseUrl: "https://" + cfg.edsbyHost };
  for (const k of ["jver", "cver", "userNid", "formkey"]) {
    if (pageCreds && pageCreds[k]) payload[k] = pageCreds[k];
  }
  if (oneShot) { payload.oneShot = true; payload.ttlMinutes = 10; }

  try {
    const resp = await fetch(cfg.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-token": cfg.ingestToken },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    return setLast({ ok: resp.ok, status: resp.status, body: text.slice(0, 200) });
  } catch (e) {
    return setLast({ ok: false, error: String(e) });
  }
}

async function setLast(result) {
  await chrome.storage.local.set({ lastPush: { at: new Date().toISOString(), ...result } });
  return result;
}

// ---- jver/cver capture -----------------------------------------------------
//
// Edsby keeps the bundle version inside its engine and never exposes it on the
// page, but it stamps every XHR with x-xds-jver / x-xds-cver request headers.
// We observe those (read-only) and remember them, pushing when they change so
// the app's stored versions stay current across Edsby releases. Opportunistically
// we also grab the _formkey from broadcast/form POST bodies.

async function remember(fields) {
  const { pageCreds } = await chrome.storage.local.get("pageCreds");
  const cur = pageCreds || {};
  let changed = false;
  const merged = { ...cur };
  for (const k of Object.keys(fields)) {
    if (fields[k] && fields[k] !== cur[k]) { merged[k] = fields[k]; changed = true; }
  }
  if (changed) {
    await chrome.storage.local.set({ pageCreds: merged });
    pushNow(); // get the fresh values to the app promptly (deduped, so rare)
  }
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    let jver = "", cver = "";
    for (const h of details.requestHeaders || []) {
      const n = h.name.toLowerCase();
      if (n === "x-xds-jver") jver = h.value;
      else if (n === "x-xds-cver") cver = h.value;
    }
    if (jver || cver) remember({ jver, cver });
  },
  { urls: ["*://*.edsby.com/*"] },
  ["requestHeaders"]
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const fd = details.requestBody && details.requestBody.formData;
      const fk = fd && fd._formkey && fd._formkey[0];
      if (fk) remember({ formkey: fk });
    } catch (e) {
      /* ignore */
    }
  },
  { urls: ["*://*.edsby.com/*"], types: ["xmlhttprequest"] },
  ["requestBody"]
);

// ---- listeners -------------------------------------------------------------

// Push immediately when the Edsby session cookie changes.
chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed) return;
  if (cookie.name !== COOKIE_NAME) return;
  const { edsbyHost } = await getConfig();
  if (!edsbyHost) return;
  // cookie.domain may be ".edsby.com" (parent) or "bcs.edsby.com" (host).
  const dom = cookie.domain.replace(/^\./, "");
  if (edsbyHost === dom || edsbyHost.endsWith("." + dom) || dom.endsWith("." + edsbyHost)) {
    pushNow();
  }
});

// Periodic safety re-push (covers a still-live cookie after the app's store was
// cleared, and keeps a long-lived session warm).
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pushNow();
});

// Toolbar click → push now, show the result on the badge.
chrome.action.onClicked.addListener(async () => {
  const r = await pushNow();
  chrome.action.setBadgeText({ text: r.ok ? "OK" : "ERR" });
  chrome.action.setBadgeBackgroundColor({ color: r.ok ? "#1a7f37" : "#cf222e" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
});

// Options page → manual push for testing.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "pushNow") {
    pushNow(false).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === "pushOneShot") {
    pushNow(true).then(sendResponse);
    return true; // async response
  }
});
