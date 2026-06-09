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

async function pushNow() {
  const cfg = await getConfig();
  if (!cfg.edsbyHost) return setLast({ ok: false, error: "Set your Edsby host on the options page." });
  if (!cfg.ingestToken) return setLast({ ok: false, error: "Set your Behaviours ingest token on the options page." });

  const cookieHeader = await readCookieHeader(cfg.edsbyHost);
  if (!cookieHeader || !cookieHeader.includes(COOKIE_NAME + "=")) {
    return setLast({ ok: false, error: "No Edsby session cookie found — open https://" + cfg.edsbyHost + "/ and sign in." });
  }

  try {
    const resp = await fetch(cfg.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-token": cfg.ingestToken },
      body: JSON.stringify({ cookie: cookieHeader, baseUrl: "https://" + cfg.edsbyHost }),
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
    pushNow().then(sendResponse);
    return true; // async response
  }
});
