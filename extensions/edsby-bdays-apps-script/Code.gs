/** @OnlyCurrentDoc */

/************************************************************
 * BDAYS POPULATOR — standalone Google Apps Script
 * Pulls students + parents from Edsby into this spreadsheet's Bdays tab.
 *
 * Edsby has NO public API. The request shape below mirrors the
 * DevTools-verified one used by the Curriculate backend
 * (backend/behavior/lib/edsbyRead.js): a session cookie PLUS the
 * x-xds-jver / x-xds-cver client-version headers. Requests missing those
 * headers are rejected with HTTP 403.
 *
 * ── SETUP (one-time, Project Settings → Script Properties) ──────────────
 *   EDSBY_SESSION_COOKIE  the WHOLE Cookie: header line from a logged-in
 *                         Edsby request — not just session_id_edsby.
 *   EDSBY_JVER            value of the x-xds-jver request header
 *   EDSBY_CVER            value of the x-xds-cver request header
 *   EDSBY_USER_NID        (optional) your Edsby user/teacher nid; lets the
 *                         script refresh a CSRF formkey for the POST retry
 *   EDSBY_BASE_URL        (optional) defaults to https://bcs.edsby.com
 *
 * To capture all four: sign in to Edsby → DevTools (F12) → Network → filter
 * "xds" → reload → click any `?xds=Panorama` request → Headers → Request
 * Headers. Copy everything after `Cookie:`, plus x-xds-jver and x-xds-cver.
 *
 * jver/cver change with each Edsby release, and the cookie expires every so
 * often. Run diagnoseEdsby() first — it tells you exactly which of the three
 * is stale instead of leaving you with a bare 403.
 *
 * Then: add a button on the Bdays sheet → Assign script → populateBdays.
 ************************************************************/

const CONFIG = {
  SHEET: "Bdays",
  ZOOM_NODE_ID: "21471167",      // /p/ZoomMyStudents/<this id>
  DATA_START_ROW: 4,             // first student row (rows 1-3 are headers/labels)
  // Merge mode (the default) matches existing rows by Edsby nid, updates them
  // in place, appends new students, and moves departed students to the archive
  // sheet. Set true only to force a full rebuild, which discards the archive
  // step and clears every imported column first.
  CLEAR_OLD_ROWS: false,
  ARCHIVE_SHEET: "Bdays Archive",

  // Roster CSV export (Edsby menu → Export roster CSV). Column headers are the
  // canonical ones from backend/behavior/lib/rosterImport.js, so the file
  // imports into Behaviours without editing.
  CSV: {
    FILENAME_PREFIX: "behaviours-roster",
    // The Bdays sheet has no House column and Edsby does not supply one. If you
    // keep houses in a column, put its number here and the export reads it;
    // left at 0 the House field is exported blank, and Behaviours simply leaves
    // each student's house unset. The import NEVER writes this column.
    HOUSE_COL: 0,
    // Optional Drive folder name for the generated file; blank = My Drive root.
    FOLDER: "",
  },
  FETCH_CHUNK_SIZE: 20,          // calls per fetchAll batch
  FETCH_SLEEP_MS: 1500,          // sleep between batches
  GRADE_FILTER: [],              // [] = all grades; or e.g. ["6","7","8"]

  // Column numbers (1-indexed) on the Bdays sheet:
  COLS: {
    lastName:    1,   // A
    formalFirst: 2,   // B
    commonName:  5,   // E
    gender:      6,   // F
    group:       7,   // G   (class designator like "8B" -- auto-derived from Classes)
    dob:         8,   // H
    momName:    14,   // N
    momEmail:   16,   // P
    dadName:    17,   // Q
    dadEmail:   19,   // S
    // T is "Greeting & Email" -- left untouched (it's your formula), and the
    // clear step no longer touches it.
    momEdsbyId: 22,   // V -- mother's Edsby nid, for the Behaviours roster CSV
                      //      ("Parent N Edsby ID" feeds EdsbyProvider so notices
                      //      post via Edsby rather than falling back to email).
    dadEdsbyId: 23,   // W -- father's Edsby nid, same purpose.
    edsbyNid:   21,   // U -- the student's Edsby nid. This is the key that lets
                      // a run recognise a row it wrote before, so manual notes
                      // survive and departed students can be told apart from
                      // new ones. Move it if U ever holds something.
  },

  // Optional: legacy fallback. The Group column is now auto-derived from each
  // student's Classes array in the ZoomMyStudents response (e.g. PrefName
  // "HR8B" -> "8B", or "MATH7A" -> "7A" for grades without an explicit
  // Homeroom entry). This map is only used as a last resort.
  TEACHER_TO_CLASS: {
    // "Ms. Nakesha McKenzie": "8B",
    // "Mr. Richard Sommer":   "8A",
  },
};

const DEFAULT_BASE_URL = "https://bcs.edsby.com";

// Which Edsby view lists an account's students is role-specific: a teacher has
// ZoomMyStudents, an admin is often denied it (Edsby error 1030). Tried in order.
const STUDENT_LIST_VIEWS = ["ZoomMyStudents", "SchoolStudents", "Students", "ClassStudents"];


/* ============================================================
 * MENU — the only thing you need to remember
 *
 * A "Edsby" menu appears in the spreadsheet's toolbar on open, so next year
 * there is nothing to pick out of a function list. "Update Roster" is the one
 * you want; the rest are only for when it stops working, in the order to try them.
 * ============================================================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Edsby")
    .addItem("Update Roster", "populateBdays")
    .addItem("Export roster CSV", "exportRosterCsv")
    .addSeparator()
    .addItem("Check connection", "menuCheckConnection")
    .addItem("Find my students list", "menuFindStudentsList")
    .addItem("Full diagnostics (when stuck)", "menuFullDiagnostics")
    .addSeparator()
    .addItem("Sort by grade", "SortByGrade")
    .addToUi();
}

/**
 * One answer to "is this going to work?". Reports the stored settings, tries
 * the real students call, and if it fails says which of the three causes it is
 * and what to do. This replaces having to choose between several checks.
 */
function menuCheckConnection() {
  diagnoseEdsby_();
  showLog_("Check connection");
}

function menuFindStudentsList() {
  discoverZoomNodes_();
  showLog_("Find my students list");
}

function menuFullDiagnostics() {
  dumpSession_();
  showLog_("Full diagnostics");
}

/**
 * Apps Script's Logger output is invisible when a function is run from a menu
 * rather than the editor, so mirror it into a dialog. Falls back silently when
 * there is no UI (a trigger, or the web app).
 */
function showLog_(title) {
  const text = Logger.getLog() || "(no output)";
  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(
        '<pre style="white-space:pre-wrap;font:12px/1.45 monospace;margin:0">' +
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>"
      ).setWidth(760).setHeight(560),
      title
    );
  } catch (err) {
    /* no UI available — the log is still in the execution transcript */
  }
}

/* ============================================================
 * DIAGNOSTICS — run this first when something 403s
 * ============================================================ */

/**
 * Preflight check. Reports which credential is missing or stale rather than
 * leaving you with a bare "HTTP 403". Run from the Apps Script editor and read
 * the Execution log.
 */
function diagnoseEdsby_() {
  const sess = getEdsbySession_();
  const lines = [];

  lines.push("Base URL: " + sess.baseUrl);
  lines.push("Cookie:   " + (sess.cookie
    ? sess.cookie.length + " chars, " + countCookies_(sess.cookie) + " cookie(s)" +
      (/session_id_edsby=/.test(sess.cookie) ? ", session_id_edsby present" : ", ⚠ NO session_id_edsby")
    : "⚠ MISSING — set EDSBY_SESSION_COOKIE"));
  lines.push("jver:     " + (sess.jver || "(not set — optional; only some calls need it)"));
  lines.push("cver:     " + (sess.cver || "(not set — optional; only some calls need it)"));
  lines.push("User nid: " + (sess.userNid || "(not set — formkey POST retry disabled)"));
  lines.push("Zoom node: " + (sess.zoomNodeId || "⚠ MISSING"));
  const synced = PropertiesService.getScriptProperties().getProperty("EDSBY_COOKIE_UPDATED_AT");
  lines.push("Cookie set: " + (synced
    ? synced + " (pushed by the Cookie Sync extension)"
    : "unknown — pasted by hand, or the extension has never pushed here"));

  if (sess.cookie && countCookies_(sess.cookie) === 1) {
    lines.push("Note: one cookie stored. That is normal for bcs.edsby.com — it sets");
    lines.push("only session_id_edsby — so this is not a problem in itself.");
  }

  if (!sess.cookie) {
    Logger.log(lines.join("\n"));
    return;
  }

  // Live probe: the bootstrap endpoint is the cheapest authenticated call.
  const boot = edsbyGetJson_(sess, "", "bootstrap");
  lines.push("");
  lines.push("Probe GET /core/node.json/?xds=bootstrap -> HTTP " + boot.status);
  lines.push("  " + explainStatus_(boot));

  // Live probe: the actual students call.
  const zoom = edsbyGetJson_(sess, sess.zoomNodeId, "ZoomMyStudents", "&stage=1");
  lines.push("");
  lines.push("Probe GET ZoomMyStudents/" + sess.zoomNodeId + " -> HTTP " + zoom.status);
  lines.push("  " + explainStatus_(zoom));
  if (zoom.json) {
    const recs = collectStudentRecords_(unwrapSlice_(zoom.json));
    lines.push("  Parsed " + recs.length + " student record(s).");
    if (recs.length === 0) {
      lines.push("  Response shape: " + describeShape_(zoom.json));
      lines.push("  Sample: " + JSON.stringify(zoom.json).slice(0, 600));
    }
  }

  // bootstrap answers WITHOUT a valid session (see edsbyRead.js: "unauthenticated
  // -CSRF bootstrap GET"), so its 200 says nothing about the cookie. The only
  // honest check is whether the app shell renders as you or as a login page.
  if (!zoom.ok) {
    lines.push("");
    const auth = checkAuthStatus_(sess);
    lines.push("Authentication check (bootstrap's 200 proves nothing — it answers");
    lines.push("unauthenticated): " + auth.verdict);
    for (let i = 0; i < auth.detail.length; i++) lines.push("  " + auth.detail[i]);
  }

  Logger.log(lines.join("\n"));
}

/** One-line status for list rows — the long explanation prints once, not per row. */
function explainStatusShort_(r) {
  if (r.sessionExpired) return "session expired (login page returned)";
  if (r.status === 0) return "network error: " + String(r.text || "").slice(0, 60);
  const code = edsbyErrorCode_(r.json);
  if (code) {
    const str = edsbyErrorStr_(r.json);
    return "HTTP " + r.status + " · Edsby " + code + (str ? ' "' + str + '"' : "");
  }
  if (!r.json && r.status >= 200 && r.status < 300) return "HTTP " + r.status + ", non-JSON body";
  return "HTTP " + r.status;
}

function explainStatus_(r) {
  if (r.sessionExpired) {
    return "Session expired — Edsby returned its login page. Refresh EDSBY_SESSION_COOKIE.";
  }
  if (r.status === 0) return "Network error: " + r.text;

  // Edsby's own application error is far more specific than the HTTP status it
  // rides on (1030 arrives as a 403), so report it first.
  const code = edsbyErrorCode_(r.json);
  if (code) {
    const str = edsbyErrorStr_(r.json);
    let msg = "Edsby error " + code + (str ? ' "' + str + '"' : "") + ".";
    if (code === 1030) {
      const str2 = String(str || "");
      if (/xds not found/i.test(str2)) {
        msg += " That view does not exist on this Edsby deployment — wrong view name.";
      } else if (/denied nodetype/i.test(str2)) {
        msg += " The view exists and you ARE authenticated, but this account " +
               "lacks the role for it (ZoomMyStudents requires \"School Teacher\"). " +
               "You are signed in as the wrong account — an admin login cannot read " +
               "a teacher's My Students.";
      } else {
        msg += " CONFIRMED MEANING: your session cookie is stale. Edsby answers node " +
               "reads from an unauthenticated caller with this error rather than a 401 " +
               "or a login page, so nothing else detects it — and bootstrap keeps " +
               "returning 200 because it answers unauthenticated. Fix: copy a CURRENT " +
               "session_id_edsby from a browser where Edsby is open, into " +
               "EDSBY_SESSION_COOKIE.";
      }
    } else {
      msg += " Edsby refused the node or view for this account.";
    }
    return msg;
  }

  if (r.status === 401) return "Unauthorized — the session cookie is expired or wrong.";
  if (r.status === 403) {
    return "Forbidden with no Edsby error code. Check the node id first " +
           "(discoverZoomNodes()); if that is right, try setting EDSBY_JVER / " +
           "EDSBY_CVER from a live request's x-xds-jver / x-xds-cver headers.";
  }
  if (r.status >= 500) return "Edsby server error. Retry later.";
  if (r.status >= 400) return "Error body: " + String(r.text || "").slice(0, 300);
  if (!r.json)         return "HTTP OK but the body was not JSON: " + String(r.text || "").slice(0, 300);
  return "OK.";
}

function countCookies_(cookie) {
  return String(cookie).split(";").filter(function (p) { return p.indexOf("=") > 0; }).length;
}

function describeShape_(v) {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return "array[" + v.length + "]";
  if (typeof v !== "object") return typeof v;
  return "{" + Object.keys(v).slice(0, 12).join(",") + "}";
}

function edsbyErrorStr_(json) {
  if (!json || typeof json !== "object") return "";
  const slice = json.slices && json.slices[0];
  return String(json.errorstr || (slice && slice.errorstr) || "").trim();
}

function edsbyErrorCode_(json) {
  if (!json || typeof json !== "object") return null;
  const e = json.error || json.errno || (json.slices && json.slices[0] && json.slices[0].error);
  const n = parseInt(e, 10);
  return isNaN(n) ? null : n;
}


/* ============================================================
 * COOKIE INGEST (Web App endpoint)
 *
 * Receives a fresh cookie from the Edsby Cookie Sync extension so the session
 * never has to be pasted by hand. The extension already pushes to the
 * Curriculate backend; pointing it at this endpoint as an ADDITIONAL target
 * keeps this spreadsheet current too.
 *
 * ── SETUP ───────────────────────────────────────────────────────────────
 *  1. Script Properties → add EDSBY_INGEST_TOKEN with a long random value
 *     (Apps Script cannot read custom request headers, so the extension's
 *     x-ingest-token cannot reach us — the token travels in the query string
 *     instead, which is why it must be a value you generate, not reuse).
 *  2. Deploy → New deployment → type "Web app",
 *       Execute as: Me,  Who has access: Anyone.
 *     Copy the /exec URL.
 *  3. In the extension's options page, add to the Ingest URL field (one per
 *     line, keeping the existing backend URL):
 *       https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<TOKEN>
 *  4. Click the extension's toolbar button to push now, then use the Edsby menu → Check connection.
 *
 * Anyone holding that URL can write these Script Properties, so treat it like
 * a password: keep the token long, and redeploy with a new token to revoke.
 * ============================================================ */

function doPost(e) {
  const reply = function (code, obj) {
    return ContentService
      .createTextOutput(JSON.stringify(Object.assign({ ok: code === 200 }, obj)))
      .setMimeType(ContentService.MimeType.JSON);
  };

  const props = PropertiesService.getScriptProperties();
  const expected = String(props.getProperty("EDSBY_INGEST_TOKEN") || "").trim();
  if (!expected) return reply(403, { error: "EDSBY_INGEST_TOKEN is not set on this script." });

  const supplied = String((e && e.parameter && e.parameter.token) || "").trim();
  if (!constantTimeEquals_(supplied, expected)) return reply(403, { error: "bad token" });

  let body = null;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return reply(400, { error: "body is not JSON" });
  }

  const applied = applyIngest_(body, props);
  if (applied.error) return reply(400, { error: applied.error });
  return reply(200, applied);
}

/**
 * Pure-ish: validate an ingest payload and write the properties it carries.
 * Pass a plain object as `store` to test without PropertiesService.
 * Payload shape comes from the extension:
 *   { cookie, baseUrl, jver?, cver?, userNid?, formkey?, oneShot?, ttlMinutes? }
 */
function applyIngest_(body, store) {
  if (!body || typeof body !== "object") return { error: "empty payload" };

  const cookie = String(body.cookie || "").trim();
  if (!cookie) return { error: "no cookie in payload" };
  if (!/session_id_edsby=/.test(cookie)) return { error: "cookie has no session_id_edsby" };

  const updated = [];
  const set = function (key, value) {
    store.setProperty(key, value);
    updated.push(key);
  };

  set("EDSBY_SESSION_COOKIE", cookie);

  const base = String(body.baseUrl || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s\/]+$/.test(base)) set("EDSBY_BASE_URL", base);

  // jver/cver are optional for these reads but harmless to keep current.
  for (const key of ["jver", "cver"]) {
    const v = String(body[key] || "").trim();
    if (v) set("EDSBY_" + key.toUpperCase(), v);
  }

  // A user nid is only useful if it is plausible — the bootstrap bundle is full
  // of numbers that are not node ids.
  const userNid = String(body.userNid || "").trim();
  if (userNid && isPlausibleNid_(userNid)) set("EDSBY_USER_NID", userNid);

  store.setProperty("EDSBY_COOKIE_UPDATED_AT", new Date().toISOString());

  return {
    updated: updated,
    cookieChars: cookie.length,
    cookieCount: countCookies_(cookie),
  };
}

/** Length-independent compare, so a wrong token leaks nothing by timing. */
function constantTimeEquals_(a, b) {
  const x = String(a), y = String(b);
  if (x.length === 0 || y.length === 0) return false;
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** GET on the web-app URL: a liveness check that never reveals the cookie. */
function doGet() {
  const props = PropertiesService.getScriptProperties();
  const cookie = String(props.getProperty("EDSBY_SESSION_COOKIE") || "");
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: "edsby-bdays cookie ingest",
    tokenConfigured: !!String(props.getProperty("EDSBY_INGEST_TOKEN") || "").trim(),
    haveCookie: !!cookie,
    cookieChars: cookie.length,
    cookieCount: cookie ? countCookies_(cookie) : 0,
    // bcs.edsby.com sets a single cookie, so a refreshed session has the SAME
    // length as the stale one it replaced and cookieChars cannot show a change.
    // This fingerprint can: it moves whenever the session id does, and reveals
    // nothing about the id itself (this endpoint is reachable by anyone).
    cookieFingerprint: sidFingerprint_(sidOf_(cookie)),
    lastUpdated: props.getProperty("EDSBY_COOKIE_UPDATED_AT") || null,
  })).setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================
 * RAW SESSION DUMP
 *
 * When a 403 survives the other checks, stop inferring and collect evidence.
 * This prints the things that actually distinguish the possibilities:
 *
 *   - Set-Cookie on our responses. If Edsby hands back a session_id_edsby
 *     DIFFERENT from the one we sent, it rejected ours and started a fresh
 *     anonymous session — decisive proof the cookie is dead.
 *   - The full bootstrap body. Small, and if it names a user then the session
 *     is authenticated regardless of what the HTML shell looks like.
 *   - The same node read under several parameter sets, including the original
 *     script's noForm/facetSave combination, since which params Edsby requires
 *     is not documented anywhere.
 * ============================================================ */

function dumpSession_() {
  const sess = getEdsbySession_();
  if (!sess.cookie) { Logger.log("Set EDSBY_SESSION_COOKIE first."); return; }
  const lines = [];
  const ourSid = sidOf_(sess.cookie);
  lines.push("Our session_id_edsby: " + maskSid_(ourSid) + " (" + ourSid.length + " chars)");
  lines.push("");

  // 1. Did Edsby accept our cookie, or issue a replacement?
  lines.push("── Set-Cookie check ──");
  const shell = fetchRaw_(sess, sess.baseUrl + "/", true);
  lines.push("app shell: HTTP " + shell.status + ", " + shell.bytes + " bytes");
  reportSetCookie_(lines, shell, ourSid);
  const bootRaw = fetchRaw_(sess, sess.baseUrl + "/core/node.json/?xds=bootstrap", false);
  lines.push("bootstrap: HTTP " + bootRaw.status + ", " + bootRaw.bytes + " bytes");
  reportSetCookie_(lines, bootRaw, ourSid);
  lines.push("");

  // 2. Who does the bootstrap think we are? It is ~200 KB, so dumping it is
  //    useless — scan it for person-shaped objects instead.
  lines.push("── identity in the bootstrap ──");
  let bootJson = null;
  try { bootJson = JSON.parse(bootRaw.text); } catch (err) { bootJson = null; }
  const nidInText = findUserNidInText_(bootRaw.text);
  lines.push("nid-like key in raw text: " + (nidInText || "none that passes a plausibility check"));
  if (bootJson) {
    const cands = identityCandidates_(bootJson, 10);
    if (cands.length === 0) {
      lines.push("No person-shaped objects (nid + name) in the bootstrap →");
      lines.push("this looks like an ANONYMOUS bootstrap: app config only, no identity.");
    } else {
      lines.push("Person-shaped objects found (nid — name — role — under key):");
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        lines.push("  " + c.nid + " — " + c.name + " — " + c.role + " — ." + c.at);
      }
      lines.push("If one of these is YOU, the session is authenticated and that nid");
      lines.push("belongs in EDSBY_USER_NID.");
    }
  } else {
    lines.push("bootstrap body was not JSON (" + bootRaw.bytes + " bytes).");
  }
  lines.push("");

  // 3. The node read, under every parameter set worth trying.
  lines.push("── ZoomMyStudents/" + sess.zoomNodeId + " parameter variants ──");
  const variants = [
    { label: "stage=1 (current)",                  q: "&stage=1" },
    { label: "stage=1&noForm&facetSave (original)", q: "&stage=1&noForm=true&facetSave=true" },
    { label: "bare (no params)",                   q: "" },
    { label: "stage=2",                            q: "&stage=2" },
    { label: "_method=GET",                        q: "&stage=1&_method=GET" },
  ];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const url = sess.baseUrl + "/core/node.json/" + sess.zoomNodeId +
      "?xds=ZoomMyStudents" + v.q;
    const r = fetchRaw_(sess, url, false);
    lines.push("  " + v.label + " → HTTP " + r.status + ": " +
      String(r.text || "").slice(0, 160).replace(/\s+/g, " "));
  }
  lines.push("");

  // 4. Views that should work for ANY authenticated account.
  lines.push("── identity / generic views ──");
  const probes = [
    "/core/node.json/?xds=Home",
    "/core/node.json/",
    "/core/node.json/?xds=Me",
    "/core/node.json/?xds=Profile",
  ];
  for (let i = 0; i < probes.length; i++) {
    const r = fetchRaw_(sess, sess.baseUrl + probes[i], false);
    lines.push("  " + probes[i] + " → HTTP " + r.status + ": " +
      String(r.text || "").slice(0, 160).replace(/\s+/g, " "));
  }

  lines.push("");
  lines.push("── what to do with this ──");
  lines.push("If Set-Cookie handed back a DIFFERENT session_id_edsby, the cookie is");
  lines.push("dead: re-copy it and re-run. If a parameter variant returned students,");
  lines.push("tell me which one. If everything 403s with 1030 while the browser can");
  lines.push("open the page, copy the browser's own request:");
  lines.push("  DevTools → Network → filter 'xds' → open /p/ZoomMyStudents/" + sess.zoomNodeId);
  lines.push("  → right-click the ZoomMyStudents request → Copy → Copy as cURL");
  lines.push("That shows exactly which headers/params Edsby is requiring.");

  Logger.log(lines.join("\n"));
}

/** A fetch that keeps the response object, so headers stay readable. */
function fetchRaw_(sess, url, followRedirects) {
  try {
    const resp = UrlFetchApp.fetchAll([req_(sess, url, {
      followRedirects: followRedirects === true,
      extraHeaders: followRedirects
        ? { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0" }
        : null,
    })])[0];
    let text = "";
    try { text = resp.getContentText(); } catch (err) { text = ""; }
    let headers = {};
    try { headers = resp.getAllHeaders() || {}; } catch (err) { headers = {}; }
    return { status: resp.getResponseCode(), text: text, bytes: text.length, headers: headers };
  } catch (err) {
    return { status: 0, text: String(err && err.message || err), bytes: 0, headers: {} };
  }
}

/** Pure: the session_id_edsby value out of a Cookie header. */
function sidOf_(cookie) {
  const m = String(cookie || "").match(/session_id_edsby=([^;\s]+)/);
  return m ? m[1] : "";
}

/** Pure: every session_id_edsby value in a Set-Cookie header (string or array). */
function sidsInSetCookie_(headers) {
  const raw = headers && (headers["Set-Cookie"] || headers["set-cookie"]);
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = String(list[i]).match(/session_id_edsby=([^;\s]+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Pure: decide what a Set-Cookie means for our session. */
function classifySetCookie_(headers, ourSid) {
  const sids = sidsInSetCookie_(headers);
  if (sids.length === 0) return { kind: "none", note: "no session_id_edsby in Set-Cookie (normal)." };
  for (let i = 0; i < sids.length; i++) {
    if (ourSid && sids[i] === ourSid) {
      return { kind: "same", note: "Edsby re-sent the SAME session id — our cookie was accepted." };
    }
  }
  return {
    kind: "replaced",
    note: "Edsby returned a DIFFERENT session_id_edsby (" + maskSid_(sids[0]) +
          ") — it rejected ours and started a new session. The cookie is dead; re-copy it.",
  };
}

function reportSetCookie_(lines, r, ourSid) {
  const c = classifySetCookie_(r.headers, ourSid);
  lines.push("  " + c.note);
}

/**
 * Short, non-reversible fingerprint of a session id: 8 hex chars of SHA-256.
 * Enough to see that a value changed, useless for reconstructing it.
 */
function sidFingerprint_(sid) {
  const s = String(sid || "");
  if (!s) return null;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

function maskSid_(sid) {
  const s = String(sid || "");
  if (s.length <= 8) return s || "(none)";
  return s.slice(0, 4) + "…" + s.slice(-4);
}


/* ============================================================
 * AUTHENTICATION CHECK
 *
 * The /core/node.json/?xds=bootstrap endpoint answers WITHOUT a valid session
 * (edsbyRead.js calls it an "unauthenticated-CSRF bootstrap GET"), so a 200
 * from it is not evidence the cookie works. An unauthenticated caller has no
 * relationship to any node, so Edsby answers node reads with 403 error 1030
 * "no links to node" — the same error a genuinely stale node id produces.
 *
 * The one reliable signal is whether the app shell renders as the signed-in
 * user or as a login page.
 * ============================================================ */

/** Reports whether this cookie is actually signed in. Run from the editor. */
function checkAuth_() {
  const sess = getEdsbySession_();
  if (!sess.cookie) { Logger.log("Set EDSBY_SESSION_COOKIE first."); return; }
  const a = checkAuthStatus_(sess);
  const lines = ["Verdict: " + a.verdict];
  for (let i = 0; i < a.detail.length; i++) lines.push("  " + a.detail[i]);
  if (!a.authenticated) {
    lines.push("");
    lines.push("Fix: re-copy the WHOLE Cookie header, not just session_id_edsby.");
    lines.push("  1. Sign in to Edsby, open DevTools (F12) -> Network.");
    lines.push("  2. Filter on 'xds' and reload the page.");
    lines.push("  3. Click any ?xds= request -> Headers -> Request Headers.");
    lines.push("  4. Copy EVERYTHING after 'Cookie:' — usually several hundred");
    lines.push("     characters across several cookies — into EDSBY_SESSION_COOKIE.");
    lines.push("  5. Re-use the Edsby menu → Check connection. Once it says signed in, run populateBdays().");
  }
  Logger.log(lines.join("\n"));
}

/** Returns { authenticated, verdict, detail[] }. */
function checkAuthStatus_(sess) {
  const detail = [];
  // A single session_id_edsby is normal: bcs.edsby.com sets only that one, and
  // the Cookie Sync extension pushes the whole Cookie header, which is just it.
  // Cookie COUNT says nothing about validity — only a live request does.
  detail.push("Cookie: " + sess.cookie.length + " chars, " +
    countCookies_(sess.cookie) + " cookie(s).");

  let resp;
  try {
    resp = UrlFetchApp.fetchAll([req_(sess, sess.baseUrl + "/", {
      followRedirects: true,
      extraHeaders: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0" },
    })])[0];
  } catch (err) {
    detail.push("Could not fetch the app shell: " + (err && err.message || err));
    return { authenticated: false, verdict: "UNKNOWN — the app shell fetch failed.", detail: detail };
  }

  const status = resp.getResponseCode();
  const html = resp.getContentText() || "";
  detail.push("App shell: HTTP " + status + ", " + html.length + " bytes.");

  const looksLikeLogin = /<form/i.test(html) &&
    (/password/i.test(html) || /sign\s*in/i.test(html) || /login/i.test(html));
  const userNid = findUserNidInText_(html);

  if (looksLikeLogin && !userNid) {
    detail.push("The shell rendered a LOGIN FORM — this cookie is not signed in.");
    return {
      authenticated: false,
      verdict: "NOT AUTHENTICATED. The cookie is expired or incomplete.",
      detail: detail,
    };
  }

  if (userNid) {
    detail.push("Signed in — found user nid " + userNid + " in the shell.");
    if (!sess.userNid) {
      detail.push("Tip: store " + userNid + " as EDSBY_USER_NID to enable the " +
        "formkey POST retry and the Home-view search.");
    }
    return { authenticated: true, verdict: "AUTHENTICATED as user nid " + userNid + ".", detail: detail };
  }

  detail.push("No login form, but no user nid either. Edsby's shell is a thin JS");
  detail.push("bootstrap that looks the same signed in or out, so this test cannot");
  detail.push("decide it. Full diagnostics checks Set-Cookie, which can.");
  return {
    authenticated: false,
    verdict: "INCONCLUSIVE — could not confirm the session is signed in.",
    detail: detail,
  };
}


/* ============================================================
 * NODE-ID DISCOVERY
 *
 * Edsby error 1030 "no links to node" means the account has no relationship to
 * the requested node — the /p/ZoomMyStudents/<id> in CONFIG is stale (ids are
 * per-account and change across school years). These helpers harvest the nav
 * links the live session exposes and verify each by asking it for students.
 * ============================================================ */

// Views that can list students, best first. An admin account often has no
// ZoomMyStudents at all and reaches students through one of the others.
const STUDENT_VIEW_RE = /^(Zoom)?(My)?Students$|^(School|Class|Course|Section)Students$/i;

/**
 * Pure: pull every nav link of the form /p/<View>/<nid> out of a blob of HTML
 * or JSON, in the shapes Edsby actually emits. Returns [{ view, nid }].
 * Exported for tests — no network, no spreadsheet.
 */
function harvestNavLinksFromText_(text) {
  const out = [];
  const seen = {};
  const add = function (view, nid) {
    const key = view + "/" + nid;
    if (seen[key]) return;
    seen[key] = true;
    out.push({ view: view, nid: nid });
  };
  if (!text) return out;

  const V = "([A-Za-z][A-Za-z0-9_]{2,40})";
  const N = "(\\d{4,})";
  const PATTERNS = [
    // /p/ZoomMyStudents/21471167, and the \/-escaped JSON variant, where each
    // slash is preceded by a literal backslash.
    new RegExp("\\\\?/p\\\\?/" + V + "\\\\?/" + N, "g"),
    // {"xds":"ZoomMyStudents", … "nid":21471167}
    new RegExp("[\"']xds[\"']\\s*:\\s*[\"']" + V + "[\"'][^{}]{0,80}?[\"']?nid[\"']?\\s*[:=]\\s*[\"']?" + N, "g"),
    // {"nid":21471167, … "xds":"ZoomMyStudents"}   (view/nid captured reversed)
    new RegExp("[\"']?nid[\"']?\\s*[:=]\\s*[\"']?" + N + "[\"']?[^{}]{0,80}?[\"']xds[\"']\\s*:\\s*[\"']" + V + "[\"']", "g"),
  ];

  for (let i = 0; i < PATTERNS.length; i++) {
    const re = PATTERNS[i];
    let m;
    while ((m = re.exec(text)) !== null) {
      // The third pattern captures (nid, view); the others (view, nid).
      if (i === 2) add(m[2], m[1]);
      else add(m[1], m[2]);
    }
  }
  return out;
}

/**
 * Pure: is this a plausible Edsby node id? Real ones are 6-10 digits with no
 * leading zero (e.g. 21471167). Rejecting leading zeros matters: a bare
 * /\d{4,}/ happily matches a timestamp like 054748 out of a 200 KB bundle,
 * which then makes every request for that "nid" fail with error 1030.
 */
function isPlausibleNid_(v) {
  return /^[1-9]\d{5,9}$/.test(String(v == null ? "" : v).trim());
}

/** Pure: find a plausible signed-in user nid in raw text. */
function findUserNidInText_(text) {
  if (!text) return "";
  const re = /["']?(?:userid|usernid|user_id|mynid|myid|uid)["']?\s*[:=]\s*["']?(\d{4,10})/gi;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    if (isPlausibleNid_(m[1])) return m[1];
  }
  return "";
}

/**
 * Pure: walk a parsed bootstrap payload for objects that look like a person —
 * a plausible nid paired with a name. Returns up to `limit` candidates so the
 * signed-in identity can be read off the log instead of guessed at.
 */
function identityCandidates_(json, limit) {
  const max = limit || 10;
  const out = [];
  const seen = {};
  const stack = [{ node: json, depth: 0, key: "$" }];
  while (stack.length > 0 && out.length < max) {
    const cur = stack.pop();
    const node = cur.node;
    if (!node || typeof node !== "object" || cur.depth > 10) continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push({ node: node[i], depth: cur.depth + 1, key: cur.key });
      continue;
    }
    const nid = node.nid != null ? String(node.nid) : "";
    const name = node.name || node.fullname || node.displayname || "";
    if (isPlausibleNid_(nid) && typeof name === "string" && name.length > 1 && !seen[nid]) {
      seen[nid] = true;
      out.push({
        nid: nid,
        name: String(name).slice(0, 60),
        role: String(node.role || node.nodetype || "").slice(0, 30),
        at: cur.key,
      });
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const v = node[keys[i]];
      if (v && typeof v === "object") stack.push({ node: v, depth: cur.depth + 1, key: keys[i] });
    }
  }
  return out;
}

/**
 * Prints every nav link this session exposes, marks the ones that actually
 * return students, and tells you which id to store. Run from the editor.
 */
function discoverZoomNodes_() {
  const sess = getEdsbySession_();
  if (!sess.cookie) { Logger.log("Set EDSBY_SESSION_COOKIE first."); return; }

  const found = harvestNavLinks_(sess);
  const lines = [];

  lines.push("Sources read:");
  for (let i = 0; i < found.sources.length; i++) {
    const src = found.sources[i];
    lines.push("  " + src.name + " — " + (src.bytes > 0 ? src.bytes + " bytes" : "EMPTY") +
      (src.note ? " (" + src.note + ")" : ""));
  }
  lines.push("User nid: " + (found.userNid || "not found"));
  lines.push("");

  if (found.links.length === 0) {
    lines.push("No /p/<View>/<nid> nav links found anywhere in this session.");
    lines.push("");
    lines.push("Read the id by hand instead — it takes 20 seconds:");
    lines.push("  1. Open Edsby in a browser and sign in.");
    lines.push("  2. Click the page that lists your students (\"My Students\").");
    lines.push("  3. The URL looks like  .../p/ZoomMyStudents/12345678");
    lines.push("  4. Put that number in the EDSBY_ZOOM_NODE_ID script property.");
    lines.push("  5. Then use the Edsby menu → Import students.");
    lines.push("");
    lines.push("If the URL shows a different view name, that is fine — probeNode()");
    lines.push("tries every student-listing view against the id.");
    Logger.log(lines.join("\n"));
    return;
  }

  // Report everything found, so a differently-named view is visible even when
  // no ZoomMyStudents link exists.
  lines.push("All nav links found (" + found.links.length + "):");
  const studentish = [];
  for (let i = 0; i < found.links.length; i++) {
    const L = found.links[i];
    const isStudent = STUDENT_VIEW_RE.test(L.view);
    lines.push("  " + (isStudent ? "*" : " ") + " /p/" + L.view + "/" + L.nid + "   [" + L.source + "]");
    if (isStudent) studentish.push(L);
  }
  lines.push("");

  // Probe the student-ish ones, plus the configured id, plus any bare nid we
  // can reach — a nid seen under ANY view may still answer a students view.
  const toProbe = studentish.slice();
  const already = {};
  for (let i = 0; i < toProbe.length; i++) already[toProbe[i].nid] = true;
  if (sess.zoomNodeId && !already[String(sess.zoomNodeId)]) {
    toProbe.push({ view: "ZoomMyStudents", nid: String(sess.zoomNodeId), source: "script property" });
    already[String(sess.zoomNodeId)] = true;
  }
  for (let i = 0; i < found.links.length && toProbe.length < 25; i++) {
    const L = found.links[i];
    if (already[L.nid]) continue;
    already[L.nid] = true;
    toProbe.push({ view: "ZoomMyStudents", nid: L.nid, source: "seen under /p/" + L.view });
  }

  lines.push("Probing " + toProbe.length + " node id(s) for students:");
  const working = [];
  for (let i = 0; i < toProbe.length; i++) {
    const nid = toProbe[i].nid;
    const r = probeNodeAllViews_(sess, nid);
    if (r.best) {
      lines.push("  ✓ " + nid + " via " + r.best.view + " — " + r.best.count + " students   [" + toProbe[i].source + "]");
      working.push({ nid: nid, view: r.best.view, count: r.best.count });
    } else {
      lines.push("  ✗ " + nid + " — " + r.note + "   [" + toProbe[i].source + "]");
    }
  }

  lines.push("");
  if (working.length > 0) {
    working.sort(function (a, b) { return b.count - a.count; });
    const w = working[0];
    lines.push("Set script property EDSBY_ZOOM_NODE_ID = " + w.nid +
      "  (" + w.count + " students via " + w.view + "), then run populateBdays().");
    if (String(sess.zoomNodeId) !== String(w.nid)) {
      lines.push("Currently configured " + sess.zoomNodeId + " is stale.");
    }
  } else {
    lines.push("Nothing returned students. Read the id from the browser URL bar:");
    lines.push("  Edsby → the page listing your students → URL is .../p/<View>/<NUMBER>");
    lines.push("Put NUMBER in EDSBY_ZOOM_NODE_ID, then re-run Check connection.");
  }
  Logger.log(lines.join("\n"));
}

/**
 * Test one node id against every student-listing view. Reads
 * EDSBY_ZOOM_NODE_ID unless you pass an id. Use this to confirm an id you
 * copied out of the browser URL bar.
 */
function probeNode_(nid) {
  const sess = getEdsbySession_();
  const target = String(nid || sess.zoomNodeId || "").trim();
  if (!target) { Logger.log("No node id. Set EDSBY_ZOOM_NODE_ID or call probeNode(12345678)."); return; }

  const lines = ["Probing node " + target + " — every student-listing view, by GET and by formkey POST:"];
  const r = probeNodeAllViews_(sess, target);
  for (let i = 0; i < r.tried.length; i++) {
    const t = r.tried[i];
    const mark = t.view === "(formkey)" ? " " : (t.count > 0 ? "✓" : "✗");
    lines.push("  " + mark + " " + t.view + " — " +
      (t.count > 0 ? t.count + " students" : t.note));
  }
  lines.push("");
  if (!r.best && r.full) {
    lines.push("What that error means:");
    lines.push("  " + r.full);
    lines.push("");
  }
  lines.push(r.best
    ? "Works via " + r.best.view + " [" + r.best.method + "]. Set EDSBY_ZOOM_NODE_ID = " +
      target + " and run populateBdays()."
    : "This id returns no students for this account, by GET or by formkey POST.");
  Logger.log(lines.join("\n"));
}

/**
 * Try every student-listing view against one nid, by BOTH methods: the plain
 * GET and the formkey POST. Edsby's CSRF path means a view can 403 on GET and
 * still answer the POST, so a GET-only probe proves nothing.
 */
function probeNodeAllViews_(sess, nid) {
  const tried = [];
  let best = null;

  const fresh = refreshFormkey_(sess);
  const formkey = fresh.formkey || "";
  tried.push({
    view: "(formkey)",
    count: 0,
    note: formkey ? "refreshed — POST attempts enabled" : "could not obtain one — POST attempts SKIPPED",
  });

  let lastFull = "";
  const consider = function (view, method, r) {
    let count = 0, note = "";
    if (r.ok) {
      count = collectStudentRecords_(unwrapSlice_(r.json)).length;
      if (count === 0) note = "HTTP 200, no student rows (" + describeShape_(r.json) + ")";
    } else {
      note = explainStatusShort_(r);
      lastFull = explainStatus_(r);
    }
    tried.push({ view: view + " [" + method + "]", count: count, note: note });
    if (count > 0 && (!best || count > best.count)) best = { view: view, method: method, count: count };
    return count;
  };

  for (let i = 0; i < STUDENT_LIST_VIEWS.length; i++) {
    const view = STUDENT_LIST_VIEWS[i];
    if (consider(view, "GET", edsbyGetJson_(sess, nid, view, "&stage=1")) > 0) continue;
    if (formkey) consider(view, "POST", zoomPost_(sess, nid, view, formkey));
  }

  const firstFail = tried.filter(function (t) { return t.count === 0 && t.view !== "(formkey)"; })[0];
  return {
    tried: tried, best: best,
    note: (firstFail && firstFail.note) || "no students",
    full: lastFull,
  };
}

/** Back-compat single-view check used by resolveZoomNodeId_. */
function verifyZoomNode_(sess, nid) {
  const r = probeNodeAllViews_(sess, nid);
  return r.best ? { count: r.best.count, note: "" } : { count: 0, note: r.note };
}

/**
 * Read every source this session will give us and harvest nav links from each.
 * Reports per-source byte counts so an empty source is visible instead of
 * silently contributing nothing.
 */
function harvestNavLinks_(sess) {
  const links = [];
  const seen = {};
  const sources = [];

  const scan = function (text, name, note) {
    sources.push({ name: name, bytes: text ? String(text).length : 0, note: note || "" });
    const got = harvestNavLinksFromText_(text);
    for (let i = 0; i < got.length; i++) {
      const key = got[i].view + "/" + got[i].nid;
      if (seen[key]) continue;
      seen[key] = true;
      links.push({ view: got[i].view, nid: got[i].nid, source: name });
    }
    return text || "";
  };

  // 1. The authenticated HTML app shell — nav links live here verbatim.
  //    MUST follow redirects: "/" 302s to the app and a non-followed redirect
  //    has an empty body.
  let html = "";
  try {
    const resp = UrlFetchApp.fetchAll([req_(sess, sess.baseUrl + "/", {
      followRedirects: true,
      extraHeaders: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0" },
    })])[0];
    html = resp.getContentText();
    scan(html, "landing page HTML", "HTTP " + resp.getResponseCode());
  } catch (err) {
    sources.push({ name: "landing page HTML", bytes: 0, note: String(err && err.message || err) });
  }

  // 2. bootstrap.
  const boot = edsbyGetJson_(sess, "", "bootstrap");
  scan(boot.text, "bootstrap", "HTTP " + boot.status);

  // 3. The user's Home view — their personal nav. Needs a user nid, so find one
  //    if it was never configured (this is why Home used to be skipped).
  let userNid = sess.userNid ||
                findUserNid_(boot.json) ||
                findUserNidInText_(boot.text) ||
                findUserNidInText_(html);
  if (userNid && !isPlausibleNid_(userNid)) {
    sources.push({ name: "user nid", bytes: 0, note: "rejected implausible nid " + userNid });
    userNid = "";
  }
  if (!userNid && boot.json) {
    const cands = identityCandidates_(boot.json, 1);
    if (cands.length) userNid = cands[0].nid;
  }
  if (userNid) {
    const home = edsbyGetJson_(sess, userNid, "Home");
    scan(home.text, "Home/" + userNid, "HTTP " + home.status);
    const bare = edsbyGetJson_(sess, userNid, "Panorama");
    scan(bare.text, "Panorama/" + userNid, "HTTP " + bare.status);
  } else {
    sources.push({ name: "Home", bytes: 0, note: "skipped — no user nid; set EDSBY_USER_NID" });
  }

  return { links: links, userNid: userNid, sources: sources };
}

/** Deep-walk a bootstrap payload for the signed-in user's nid. */
function findUserNid_(json) {
  if (!json) return "";
  const stack = [{ node: json, depth: 0 }];
  while (stack.length > 0) {
    const cur = stack.pop();
    const node = cur.node;
    if (!node || typeof node !== "object" || cur.depth > 12) continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push({ node: node[i], depth: cur.depth + 1 });
      continue;
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], v = node[k];
      if (/^(usernid|userid|user_id|mynid|myid|meid|uid)$/i.test(k) && isPlausibleNid_(v)) {
        return String(v);
      }
      if (v && typeof v === "object") stack.push({ node: v, depth: cur.depth + 1 });
    }
  }
  return "";
}

/**
 * The node id to use: the configured one if it works, otherwise the best
 * discovered one. Keeps populateBdays() working across a school-year rollover
 * without an edit.
 */
function resolveZoomNodeId_(sess) {
  const configured = String(sess.zoomNodeId || "");
  if (configured) {
    const v = verifyZoomNode_(sess, configured);
    if (v.count > 0) return { nid: configured, count: v.count };
    Logger.log("Configured node " + configured + " returned no students — " + v.note);
    Logger.log("Searching for the current node id…");
  }

  const found = harvestNavLinks_(sess);
  let best = null;
  const tried = {};
  tried[configured] = true;
  for (let i = 0; i < found.links.length; i++) {
    const nid = found.links[i].nid;
    if (tried[nid]) continue;
    tried[nid] = true;
    const v = verifyZoomNode_(sess, nid);
    if (v.count > 0 && (!best || v.count > best.count)) best = { nid: nid, count: v.count };
  }
  if (best) {
    Logger.log("Found node " + best.nid + " with " + best.count + " students. " +
      "Store it as EDSBY_ZOOM_NODE_ID to skip this search next run.");
    return best;
  }
  Logger.log("Could not find a working node id. Use the Edsby menu → " +
    "Find my students list for the full report.");
  return { nid: configured, count: 0 };
}

/* ============================================================
 * MAIN ENTRY POINT (assign this to your button)
 * ============================================================ */

function populateBdays() {
  const sess = getEdsbySession_();
  if (!sess.cookie) {
    Logger.log("Skipped: no EDSBY_SESSION_COOKIE in Script Properties. Run diagnoseEdsby().");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET + '" not found.');

  // 1. Get all student records (nid + Classes) from the students listing.
  //    Node ids are per-account and change across school years, so a stale id
  //    is resolved rather than fatal (Edsby error 1030 "no links to node").
  const resolved = resolveZoomNodeId_(sess);
  const studentRecords = fetchZoomMyStudents_(sess, resolved.nid);
  if (studentRecords.length === 0) {
    const auth = checkAuthStatus_(sess);
    if (!auth.authenticated) {
      Logger.log("No students returned, and the session is not signed in: " + auth.verdict);
      Logger.log("Use the Edsby menu → Check connection for the fix.");
    } else {
      Logger.log("No students returned even though the session is signed in. " +
        "the Edsby menu → Find my students list to check the node id.");
    }
    return;
  }
  Logger.log("Students listing: " + studentRecords.length + " students.");

  // 2. Fetch each student's Panorama (chunked).
  const studentReqs = studentRecords.map(function (r) {
    return req_(sess, sess.baseUrl + "/core/node.json/" + r.nid + "?xds=Panorama",
                { referer: sess.baseUrl + "/p/Panorama/" + r.nid });
  });
  const studentResps = chunkedFetchAll_(studentReqs, CONFIG.FETCH_CHUNK_SIZE, CONFIG.FETCH_SLEEP_MS);

  const grades = CONFIG.GRADE_FILTER || [];
  const students = [];
  const parentNidsToFetch = {};

  for (let i = 0; i < studentResps.length; i++) {
    const data = parse_(studentResps[i], "Panorama/" + studentRecords[i].nid);
    if (!data) continue;
    const s = extractStudent_(data);
    if (!s) continue;
    if (grades.length > 0 && grades.indexOf(String(s.grade)) < 0) continue;
    // Group (section) resolution, in order of trust. Steps 1 and 2 are per
    // student; the homeroom-teacher pass runs after the loop, once there are
    // resolved students to learn from.
    s.zoomClasses = studentRecords[i] && studentRecords[i].classes || [];
    s.group = extractGroupFromClasses_(s.zoomClasses, s.grade);
    s.groupSource = s.group ? "own classes" : "";
    if (!s.group) {
      // The zoom lists only classes shared with the signed-in teacher, so a
      // student whose one shared class carries no section resolves nothing
      // above. Their Panorama — already fetched for DOB and parents — is their
      // own page and carries their real homeroom.
      s.group = extractGroupFromPanorama_(data, s.grade);
      if (s.group) s.groupSource = "panorama";
    }
    students.push(s);
    if (s.dadNid) parentNidsToFetch[s.dadNid] = true;
    if (s.momNid) parentNidsToFetch[s.momNid] = true;
  }
  Logger.log("After grade filter: " + students.length + " students kept.");

  // 2b. Fill any remaining sections from the homeroom teacher, learned from the
  //     students who did resolve. TEACHER_TO_CLASS still wins if it names them.
  for (let i = 0; i < students.length; i++) {
    const manual = CONFIG.TEACHER_TO_CLASS[students[i].firstHomeroomTeacher];
    if (manual) { students[i].group = manual; students[i].groupSource = "TEACHER_TO_CLASS"; }
  }
  const inferred = inferSectionsByTeacher_(students);
  const bySource = {};
  for (let i = 0; i < students.length; i++) {
    const k = students[i].groupSource || "grade only";
    bySource[k] = (bySource[k] || 0) + 1;
  }
  Logger.log("Sections resolved from: " + JSON.stringify(bySource));
  if (Object.keys(inferred.map).length) {
    Logger.log("Homeroom teacher → section (learned): " + JSON.stringify(inferred.map));
  }
  if (inferred.unresolved.length) {
    Logger.log("No section for " + inferred.unresolved.length + " student(s) — Group " +
      "falls back to their grade. Add their homeroom teacher to " +
      "CONFIG.TEACHER_TO_CLASS to fix:\n  " + inferred.unresolved.join("\n  "));
  }

  // 3. Fetch parent ParentDetails (chunked).
  const parentNids = Object.keys(parentNidsToFetch);
  const parentEmails = {};
  if (parentNids.length > 0) {
    const parentReqs = parentNids.map(function (nid) {
      return req_(sess, sess.baseUrl + "/core/node.json/" + nid + "?xds=ParentDetails",
                  { referer: sess.baseUrl + "/p/Panorama/" + nid });
    });
    const parentResps = chunkedFetchAll_(parentReqs, CONFIG.FETCH_CHUNK_SIZE, CONFIG.FETCH_SLEEP_MS);
    for (let i = 0; i < parentResps.length; i++) {
      const data = parse_(parentResps[i], "ParentDetails/" + parentNids[i]);
      if (!data) continue;
      const email = extractParentEmail_(data);
      if (email) parentEmails[parentNids[i]] = email;
    }
  }

  // 4. Sort by last name, then first.
  students.sort(function (a, b) {
    const al = (a.lastName || "").toLowerCase();
    const bl = (b.lastName || "").toLowerCase();
    if (al !== bl) return al < bl ? -1 : 1;
    const af = (a.prefFirst || a.firstName || "").toLowerCase();
    const bf = (b.prefFirst || b.firstName || "").toLowerCase();
    return af < bf ? -1 : (af > bf ? 1 : 0);
  });

  // 5. Write. Merge is the default: rows are matched on the Edsby nid in
  //    column U, so students who left are archived rather than silently
  //    dropped, and manual columns survive.
  let summary;
  if (CONFIG.CLEAR_OLD_ROWS) {
    clearImportedColumns_(sheet);
    writeStudents_(sheet, students, parentEmails);
    summary = { updated: 0, added: students.length, archived: 0 };
  } else {
    summary = syncStudents_(sheet, students, parentEmails);
  }

  Logger.log("Bdays synced: " + summary.updated + " updated, " + summary.added +
    " added, " + summary.archived + " archived to \"" + CONFIG.ARCHIVE_SHEET + "\" — " +
    students.length + " students in Edsby, " +
    Object.keys(parentEmails).length + " parent emails.");
}

/**
 * Clear ONLY the columns this import owns.
 *
 * The original version cleared row 4 → lastRow across 1 → getLastColumn(),
 * which wipes every column the import never rewrites — on the current mapping
 * that is C, D, I, J, K, L, M, O, R and T. Column T is the "Greeting & Email"
 * formula the config comment promises is left untouched, so each run silently
 * destroyed it along with any hand-kept notes in the other nine.
 */
function clearImportedColumns_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return;
  const rows = lastRow - CONFIG.DATA_START_ROW + 1;

  const owned = ownedColumns_();
  for (let i = 0; i < owned.length; i++) {
    sheet.getRange(CONFIG.DATA_START_ROW, owned[i], rows, 1).clearContent();
  }
}

/** Pure: the sheet columns this import writes, ascending and de-duplicated. */
function ownedColumns_() {
  const seen = {};
  const out = [];
  Object.keys(CONFIG.COLS).forEach(function (k) {
    const c = CONFIG.COLS[k];
    if (typeof c === "number" && c > 0 && !seen[c]) { seen[c] = true; out.push(c); }
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

/** Pure: the values this import owns for one student, as {column: value}. */
function rowValuesFor_(s, parentEmails) {
  const cols = CONFIG.COLS;
  const emails = parentEmails || {};
  // Group: auto-derived from Classes -> teacher-map fallback -> grade.
  const cls = s.group || CONFIG.TEACHER_TO_CLASS[s.firstHomeroomTeacher] || s.grade || "";
  const out = {};
  const put = function (col, v) { if (col) out[col] = v; };
  put(cols.lastName, s.lastName || "");
  put(cols.formalFirst, s.prefFirst || s.firstName || "");
  put(cols.commonName, s.fullName || "");
  put(cols.gender, s.gender || "");
  put(cols.group, cls);
  put(cols.dob, s.dob || "");
  put(cols.momName, s.momName || "");
  put(cols.momEmail, s.momNid ? (emails[s.momNid] || "") : "");
  put(cols.dadName, s.dadName || "");
  put(cols.dadEmail, s.dadNid ? (emails[s.dadNid] || "") : "");
  put(cols.momEdsbyId, s.momNid || "");
  put(cols.dadEdsbyId, s.dadNid || "");
  put(cols.edsbyNid, s.nid || "");
  return out;
}

/**
 * Merge Edsby's roster into the sheet: update rows we already have, append new
 * students, archive the rest. Only the columns in CONFIG.COLS are written, so
 * hand-kept notes and the column-T formula are left alone.
 */
function syncStudents_(sheet, students, parentEmails) {
  const existing = readExistingRows_(sheet);
  const plan = planSync_(existing, students);

  // 1. Departed students leave first, so the appends below land on a compact
  //    block and row numbers stop moving afterwards.
  const archived = archiveRows_(sheet, plan.archives);

  // Deleting rows shifts everything below, so the update targets are stale.
  // Re-read and re-plan against the compacted sheet rather than trying to
  // arithmetic our way to the new row numbers.
  const plan2 = archived > 0 ? planSync_(readExistingRows_(sheet), students) : plan;

  // 2. Update matched rows, batched per column over the contiguous block.
  writeRowValues_(sheet, plan2.updates.map(function (u) {
    return { row: u.row, values: rowValuesFor_(u.student, parentEmails) };
  }));

  // 3. Append new students below the last row.
  const startRow = Math.max(sheet.getLastRow() + 1, CONFIG.DATA_START_ROW);
  writeRowValues_(sheet, plan2.appends.map(function (st, i) {
    return { row: startRow + i, values: rowValuesFor_(st, parentEmails) };
  }));

  // 4. Sort by last name then first. Range.sort moves whole cells, so formulas
  //    in unowned columns travel with their row.
  sortDataRows_(sheet);

  return { updated: plan2.updates.length, added: plan2.appends.length, archived: archived };
}

/**
 * Write {row, values:{column: value}} entries with one setValues call per
 * column per contiguous run, instead of one call per cell.
 */
function writeRowValues_(sheet, entries) {
  if (!entries || !entries.length) return;
  const byCol = {};
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    Object.keys(e.values).forEach(function (col) {
      if (!byCol[col]) byCol[col] = [];
      byCol[col].push({ row: e.row, value: e.values[col] });
    });
  }
  Object.keys(byCol).forEach(function (col) {
    const cells = byCol[col].sort(function (a, b) { return a.row - b.row; });
    let i = 0;
    while (i < cells.length) {
      let j = i;
      while (j + 1 < cells.length && cells[j + 1].row === cells[j].row + 1) j++;
      const block = cells.slice(i, j + 1).map(function (c) { return [c.value]; });
      sheet.getRange(cells[i].row, parseInt(col, 10), block.length, 1).setValues(block);
      i = j + 1;
    }
  });
}

function sortDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.DATA_START_ROW) return;
  const width = Math.max(sheet.getLastColumn(), CONFIG.COLS.edsbyNid || 1);
  sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, width)
       .sort([{ column: CONFIG.COLS.lastName, ascending: true },
              { column: CONFIG.COLS.formalFirst, ascending: true }]);
}

/** Full-rebuild path: clear the imported columns and write every student. */
function writeStudents_(sheet, students, parentEmails) {
  if (students.length === 0) return;
  writeRowValues_(sheet, students.map(function (st, i) {
    return { row: CONFIG.DATA_START_ROW + i, values: rowValuesFor_(st, parentEmails) };
  }));
}


/* ============================================================
 * EDSBY FETCH HELPERS
 *
 * Request shape ported from backend/behavior/lib/edsbyRead.js — the only
 * DevTools-verified shape we have. Two things matter and were the cause of
 * the HTTP 403:
 *   1. x-xds-jver / x-xds-cver MUST be present.
 *   2. Do NOT send Origin / X-Requested-With on these GETs; Edsby treats a
 *      cross-origin-looking GET as a CSRF attempt and rejects it.
 * ============================================================ */

function getEdsbySession_() {
  const p = PropertiesService.getScriptProperties();
  const get = function (k) { const v = p.getProperty(k); return v ? v.trim() : ""; };
  return {
    baseUrl: (get("EDSBY_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    cookie:  get("EDSBY_SESSION_COOKIE"),
    jver:    get("EDSBY_JVER"),
    cver:    get("EDSBY_CVER"),
    userNid: get("EDSBY_USER_NID"),
    zoomNodeId: get("EDSBY_ZOOM_NODE_ID") || CONFIG.ZOOM_NODE_ID,
  };
}

/** Build a UrlFetchApp request with the verified Edsby header set. */
function req_(sess, url, opts) {
  const o = opts || {};
  const headers = {
    "Cookie": sess.cookie,
    "x-xds-jver": sess.jver || "",
    "x-xds-cver": sess.cver || "",
    "Accept": "application/json, text/plain, */*",
  };
  if (o.referer) headers["Referer"] = o.referer;
  if (o.extraHeaders) {
    Object.keys(o.extraHeaders).forEach(function (k) { headers[k] = o.extraHeaders[k]; });
  }
  const r = {
    url: url,
    method: o.method || "get",
    headers: headers,
    muteHttpExceptions: true,
    // Default off so an expired session's 302-to-login is visible rather than
    // silently followed. The HTML page fetch overrides it — that one redirects
    // to the app shell, and not following it yields an empty body.
    followRedirects: o.followRedirects === true,
  };
  if (o.payload) r.payload = o.payload;
  if (o.contentType) r.contentType = o.contentType;
  return r;
}

/** Authenticated GET of an Edsby JSON view. Returns { ok, status, json, text }. */
function edsbyGetJson_(sess, nid, view, extraQuery) {
  const url = sess.baseUrl + "/core/node.json/" + (nid || "") +
    "?xds=" + encodeURIComponent(view) + (extraQuery || "");
  let resp;
  try {
    resp = UrlFetchApp.fetchAll([req_(sess, url, { referer: sess.baseUrl + "/p/" + view + "/" + (nid || "") })])[0];
  } catch (err) {
    return { ok: false, status: 0, json: null, text: err && err.message || String(err) };
  }
  return readResponse_(resp);
}

function readResponse_(resp) {
  if (!resp) return { ok: false, status: 0, json: null, text: "no response" };
  const status = resp.getResponseCode();
  let text = "";
  try { text = resp.getContentText(); } catch (err) { text = ""; }
  // Edsby answers an expired session with its HTML login page, often at HTTP 200.
  if (/login/i.test(text) && /<form/i.test(text)) {
    return { ok: false, status: 401, json: null, text: "session-expired", sessionExpired: true };
  }
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* non-JSON */ }
  return { ok: status >= 200 && status < 300 && json !== null, status: status, json: json, text: text };
}

/**
 * The formkey POST that Edsby's CSRF path wants: POST with _method=GET and the
 * formkey in a multipart body, plus Origin and the client-request-queue header.
 * Mirrors fetchZoomStudents() in backend/behavior/lib/edsbyRead.js. Kept
 * separate so the diagnostics exercise the same path populateBdays() does —
 * probing with GET alone tests only half the code.
 */
function zoomPost_(sess, nodeId, view, formkey) {
  const url = sess.baseUrl + "/core/node.json/" + nodeId +
    "?xds=" + encodeURIComponent(view) + "&stage=1&_method=GET";
  const boundary = "----CurriculateBdays";
  const payload = "--" + boundary + "\r\n" +
    'Content-Disposition: form-data; name="_formkey"\r\n\r\n' +
    formkey + "\r\n--" + boundary + "--\r\n";
  let resp;
  try {
    resp = UrlFetchApp.fetchAll([req_(sess, url, {
      method: "post",
      contentType: "multipart/form-data; boundary=" + boundary,
      payload: payload,
      referer: sess.baseUrl + "/p/" + view + "/" + nodeId,
      extraHeaders: {
        "Origin": sess.baseUrl,
        "x-edsby-client-request-queue": "net::post",
      },
    })])[0];
  } catch (err) {
    return { ok: false, threw: true, status: 0, json: null, text: String(err && err.message || err) };
  }
  return readResponse_(resp);
}

/**
 * Fetch a fresh CSRF _formkey from a bootstrap GET. Edsby formkeys expire
 * quickly, so one is fetched right before the POST retry that needs it.
 */
function refreshFormkey_(sess) {
  const urls = [sess.baseUrl + "/core/node.json/?xds=bootstrap"];
  if (sess.userNid) {
    urls.push(sess.baseUrl + "/core/node.json/" + sess.userNid + "?xds=Home");
    urls.push(sess.baseUrl + "/core/node.json/" + sess.userNid);
  }
  for (let i = 0; i < urls.length; i++) {
    let resp;
    try {
      resp = UrlFetchApp.fetchAll([req_(sess, urls[i], { referer: sess.baseUrl + "/" })])[0];
    } catch (err) {
      continue;
    }
    const r = readResponse_(resp);
    if (r.sessionExpired) return { sessionExpired: true };
    const m = String(r.text || "").match(/_formkey"?\s*[:=]\s*"([^"]+)"/);
    if (m) return { formkey: m[1] };
  }
  return {};
}

/**
 * Returns an array of { nid, classes } objects.
 *
 * Tries each candidate listing view: plain GET with stage=1 first (the row data
 * only loads with stage=1), then a formkey POST with _method=GET as the CSRF
 * fallback. Logs a per-view diagnostic so a failure says which step failed.
 */
function fetchZoomMyStudents_(sess, zoomId) {
  const nodeId = zoomId || sess.zoomNodeId;
  let formkey = "";
  const fresh = refreshFormkey_(sess);
  if (fresh.sessionExpired) {
    Logger.log("Session expired — Edsby returned its login page. Refresh EDSBY_SESSION_COOKIE.");
    return [];
  }
  formkey = fresh.formkey || "";
  Logger.log("Formkey: " + (formkey ? "refreshed" : "not obtained (POST fallback will be skipped)"));

  for (let v = 0; v < STUDENT_LIST_VIEWS.length; v++) {
    const view = STUDENT_LIST_VIEWS[v];

    // --- Attempt 1: plain GET with stage=1 ---
    const g = edsbyGetJson_(sess, nodeId, view, "&stage=1");
    if (g.sessionExpired) {
      Logger.log("Session expired during GET " + view + ". Refresh EDSBY_SESSION_COOKIE.");
      return [];
    }
    if (g.ok) {
      const recs = collectStudentRecords_(unwrapSlice_(g.json));
      if (recs.length) {
        Logger.log("GET " + view + ": " + recs.length + " students.");
        return recs;
      }
      Logger.log("GET " + view + " HTTP " + g.status + ": JSON but no students. " +
        explainStatus_(g) + " Shape: " + describeShape_(g.json));
    } else {
      Logger.log("GET " + view + " HTTP " + g.status + ": " + explainStatus_(g));
    }

    // --- Attempt 2: formkey POST with _method=GET (Edsby's CSRF path) ---
    if (!formkey) continue;
    const r = zoomPost_(sess, nodeId, view, formkey);
    if (r.threw) {
      Logger.log("POST " + view + " threw: " + r.text);
      continue;
    }
    if (r.sessionExpired) {
      Logger.log("Session expired during POST " + view + ". Refresh EDSBY_SESSION_COOKIE.");
      return [];
    }
    if (r.ok) {
      const recs = collectStudentRecords_(unwrapSlice_(r.json));
      if (recs.length) {
        Logger.log("POST " + view + ": " + recs.length + " students.");
        return recs;
      }
      Logger.log("POST " + view + " HTTP " + r.status + ": JSON but no students. " +
        explainStatus_(r) + " Shape: " + describeShape_(r.json));
    } else {
      Logger.log("POST " + view + " HTTP " + r.status + ": " + explainStatus_(r));
    }
  }

  return [];
}

/** slices[0].data is where Edsby puts a view's payload. */
function unwrapSlice_(json) {
  if (!json) return null;
  return (json.slices && json.slices[0] && json.slices[0].data) || json;
}

/**
 * Returns an array of { nid, classes } objects, where `classes` is the
 * student's Classes array (used to derive their Group).
 *
 * The rows live at `…data.zoom.data.table.rec`, an object keyed by
 * "r<studentNid>". The rec map is located wherever it sits in the tree, so
 * this survives minor nesting changes between Edsby releases.
 */
function collectStudentRecords_(data) {
  const out = [];
  const seen = {};
  if (!data) return out;

  // Locate the rec map: an object whose keys are mostly "r<digits>".
  let rec = null;
  const stack = [{ node: data, depth: 0 }];
  while (stack.length > 0 && !rec) {
    const cur = stack.pop();
    const node = cur.node;
    if (!node || typeof node !== "object" || cur.depth > 16) continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push({ node: node[i], depth: cur.depth + 1 });
      continue;
    }
    const keys = Object.keys(node);
    const rKeys = keys.filter(function (k) { return /^r\d+$/.test(k); });
    if (keys.length >= 3 && rKeys.length >= keys.length * 0.8) { rec = node; break; }
    for (let i = 0; i < keys.length; i++) stack.push({ node: node[keys[i]], depth: cur.depth + 1 });
  }

  if (rec) {
    Object.keys(rec).forEach(function (key) {
      const r = rec[key];
      if (!r || typeof r !== "object") return;
      const nid = parseInt(String(r.nid != null ? r.nid : key.replace(/^r/, "")), 10);
      if (!nid || seen[nid]) return;
      seen[nid] = true;
      out.push({ nid: nid, classes: r.Classes || r.classes || [] });
    });
  }

  // Fallback: deep-walk for student-like nodes if the rec map wasn't found.
  if (out.length === 0) {
    const stack2 = [data];
    while (stack2.length > 0) {
      const cur = stack2.pop();
      if (!cur || typeof cur !== "object") continue;
      const isStudentNode =
        (cur.nid && cur.nodetype === 1 && (cur.nodesubtype === 5 || cur.nodesubtype === "5")) ||
        (cur.nid && cur.role === "Student");
      if (isStudentNode) {
        const nid = parseInt(cur.nid, 10);
        if (nid && !seen[nid]) {
          seen[nid] = true;
          out.push({ nid: nid, classes: cur.Classes || cur.classes || [] });
        }
      }
      for (const k in cur) {
        if (cur.hasOwnProperty(k)) {
          const v = cur[k];
          if (v && typeof v === "object") stack2.push(v);
        }
      }
    }
  }

  return out;
}

/**
 * Given a student's Classes array, return a "Group" designation like "8B".
 *   1. If any class is the Homeroom (label starts with "Homeroom" or PrefName
 *      starts with "HR"), pull the digit+letter from PrefName (HR8B -> 8B).
 *      Falls back to the label ("Homeroom - 8B" -> 8B).
 *   2. Otherwise scan every class's PrefName for a digit+letter token
 *      (MATH7A -> 7A, HIST7C -> 7C, GEO8A -> 8A).
 */
function isHomeroomClass_(c) {
  const pref = String(c.PrefName || c.prefname || c.shortname || c.ShortName || "");
  const label = String(c.LastName || c.lastname || c.name || c.Name || c.label || "");
  return /^HR\s*\d/i.test(pref) || /^homeroom\b/i.test(label);
}

/**
 * Pure: the "8A"-style token in one class entry, or "".
 * Real PrefName values from bcs.edsby.com: HR8A, GEO8B, MATH7B, HIST7C, CED8A,
 * MLS68Sommer. The trailing \b matters — it stops "MLS68Sommer" yielding "68S".
 */
function groupTokenOf_(c) {
  if (!c) return "";
  const pref = String(c.PrefName || c.prefname || c.shortname || c.ShortName || "");
  const label = String(c.LastName || c.lastname || c.name || c.Name || c.label || "");
  let m = pref.match(/^HR\s*(\d+)\s*([A-Z])/i);
  if (m) return m[1] + m[2].toUpperCase();
  m = pref.match(/(\d+)\s*([A-Z])\b/);
  if (m) return m[1] + m[2].toUpperCase();
  m = label.match(/(\d+)\s*([A-Z])\b/);
  if (m) return m[1] + m[2].toUpperCase();
  return "";
}

/**
 * Given a student's Classes array (and their Grade), return a "Group" like "8B".
 *
 * The student's grade breaks ties, because Classes carries historical
 * enrolments. A real grade-8 student in the live data has classes
 * [GEO8B, HR7B, MATH7B]: taking the homeroom first would label her "7B". The
 * grade-matching pass gives "8B", which is right.
 *
 * Order: homeroom matching the grade → any class matching the grade →
 * any homeroom → any class.
 */
function extractGroupFromClasses_(classes, grade) {
  if (!classes) return "";
  const list = Array.isArray(classes)
    ? classes
    : (typeof classes === "object" ? Object.keys(classes).map(function (k) { return classes[k]; }) : []);
  if (list.length === 0) return "";

  const gradeDigits = String(grade == null ? "" : grade).replace(/\D+/g, "");
  const tokens = list.map(function (c) {
    return { token: groupTokenOf_(c), homeroom: c ? isHomeroomClass_(c) : false };
  });

  const pick = function (test) {
    for (let i = 0; i < tokens.length; i++) if (tokens[i].token && test(tokens[i])) return tokens[i].token;
    return "";
  };

  if (gradeDigits) {
    // A token from another grade is a historical enrolment (a grade-8 student
    // still listing last year's HR7B). Returning "" lets Panorama or the
    // homeroom-teacher pass answer instead, which beats last year's section.
    const matchesGrade = function (t) { return t.token.indexOf(gradeDigits) === 0; };
    return pick(function (t) { return t.homeroom && matchesGrade(t); }) ||
           pick(matchesGrade) ||
           "";
  }
  return pick(function (t) { return t.homeroom; }) || pick(function () { return true; });
}

function extractStudent_(data) {
  const fullName = data.name || "";
  const info = (data.col3 && data.col3.info) || {};
  const lastName = info.lastname || "";
  const prefFirst = info.prefname || "";
  const grade = info.grade || "";
  const gender = info.gender || "";
  const dob = info.birthday || "";

  let firstName = prefFirst;
  if (!firstName && fullName && lastName) {
    firstName = fullName.replace(new RegExp("\\s*" + escapeRegex_(lastName) + "\\s*$"), "").trim();
  }

  // Homeroom teachers (first one is usually THE homeroom teacher)
  const teachers = (info.homeroom && info.homeroom.data && info.homeroom.data.teacher) || [];
  const firstHomeroomTeacher = (teachers[0] && teachers[0].name) || "";

  // Parents
  const parents = (data.col1 && data.col1.parents && data.col1.parents.parents) || {};
  let dadNid = null, dadName = "", momNid = null, momName = "";
  Object.keys(parents).forEach(function (k) {
    const p = parents[k];
    if (!p || !p.nid) return;
    const ppn = p.profpicname || {};
    const nameObj = ppn.name || {};
    const role = nameObj.role || "";
    const name = nameObj.name || "";
    if (/Father/i.test(role) || /Stepfather/i.test(role)) {
      if (!dadNid) { dadNid = p.nid; dadName = name; }
    } else if (/Mother/i.test(role) || /Stepmother/i.test(role)) {
      if (!momNid) { momNid = p.nid; momName = name; }
    } else {
      if (!dadNid && !momNid) { dadNid = p.nid; dadName = name; }
    }
  });

  return {
    fullName: fullName,
    lastName: lastName,
    firstName: firstName,
    prefFirst: prefFirst,
    gender: gender,
    grade: grade,
    dob: dob,
    firstHomeroomTeacher: firstHomeroomTeacher,
    dadNid: dadNid, dadName: dadName,
    momNid: momNid, momName: momName,
  };
}

function extractParentEmail_(data) {
  const a = data.col1 && data.col1.col1 && data.col1.col1.account && data.col1.col1.account.email;
  if (a) return String(a).trim();
  const b = data.col2 && data.col2.info && data.col2.info.email;
  if (b) return String(b).trim();
  return "";
}


/* ============================================================
 * UTILITIES
 * ============================================================ */

function chunkedFetchAll_(requests, chunkSize, sleepMs) {
  const responses = [];
  for (let i = 0; i < requests.length; i += chunkSize) {
    const batch = requests.slice(i, i + chunkSize);
    let batchResps;
    try {
      batchResps = UrlFetchApp.fetchAll(batch);
    } catch (err) {
      Logger.log("Batch " + i + " threw: " + err.message + " -- skipping.");
      batchResps = batch.map(function () { return null; });
    }
    for (let j = 0; j < batchResps.length; j++) responses.push(batchResps[j]);
    if (i + chunkSize < requests.length) Utilities.sleep(sleepMs);
  }
  return responses;
}

/**
 * Unwrap a per-student/per-parent response into slices[0].data.
 * Logs the reason on failure instead of a bare status code.
 */
function parse_(resp, label) {
  const r = readResponse_(resp);
  if (r.sessionExpired) {
    Logger.log((label || "fetch") + ": session expired — refresh EDSBY_SESSION_COOKIE.");
    return null;
  }
  if (!r.ok) {
    Logger.log((label || "fetch") + " HTTP " + r.status + ": " + explainStatus_(r));
    return null;
  }
  return (r.json && r.json.slices && r.json.slices[0] && r.json.slices[0].data) || null;
}

function escapeRegex_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/* ============================================================
 * SECTION (HOMEROOM) RESOLUTION
 *
 * The Group column wants "8A", not "8". Three sources, in order of trust:
 *
 *  1. The student's own classes in the ZoomMyStudents row. Reliable when the
 *     section is in a PrefName (HR8A, GEO8B, MATH7B) AND its grade digits
 *     match the student's Grade. Classes carries HISTORICAL enrolments — a
 *     grade-8 student can still list last year's HR7B — so a token whose grade
 *     disagrees is discarded rather than used, which is why this alone leaves
 *     some students unresolved.
 *
 *  2. The student's Panorama. The zoom lists only classes shared with the
 *     signed-in teacher, so a student whose one shared class is section-less
 *     ("Learning Skills" / MLS68Sommer, id 34944663 — last year's) yields
 *     nothing at step 1. Panorama is the student's OWN page and carries their
 *     real homeroom.
 *
 *  3. Their homeroom teacher. Every zoom row has hrTeacher, and a homeroom
 *     teacher maps to one section, so the mapping is learned from the students
 *     who DID resolve and applied to those who did not. This is the automatic
 *     version of CONFIG.TEACHER_TO_CLASS, which stays as a manual override.
 *
 * Only then does it fall back to the bare grade.
 * ============================================================ */

// "Homeroom - 8A" / "Homeroom 8A"
const RE_HOMEROOM_LABEL = /homeroom\s*[-–—:]?\s*(\d{1,2})\s*([A-Za-z])\b/gi;
// "HR8A"
const RE_HR_CODE = /\bHR\s*(\d{1,2})\s*([A-Za-z])\b/gi;
// "GEO8A", "MATH7B", "HIST7C" — a subject prefix, then grade+section.
const RE_COURSE_CODE = /\b[A-Z]{2,6}(\d{1,2})([A-Z])\b/g;

/**
 * Pure: every section token in a blob of text, each flagged for whether it came
 * from a homeroom-shaped string. Returns [{ token, homeroom }].
 */
function sectionTokensFromText_(text) {
  const out = [];
  const index = {};
  const str = String(text == null ? "" : text);
  // One entry per token. The course-code pattern also matches "HR8A" (HR is
  // two uppercase letters), so a token can be seen twice; if either sighting
  // was homeroom-shaped, the token is a homeroom.
  const add = function (grade, letter, homeroom) {
    const token = String(parseInt(grade, 10)) + String(letter).toUpperCase();
    if (index[token]) {
      if (homeroom) index[token].homeroom = true;
      return;
    }
    index[token] = { token: token, homeroom: !!homeroom };
    out.push(index[token]);
  };

  let m;
  const hrLabel = new RegExp(RE_HOMEROOM_LABEL.source, "gi");
  while ((m = hrLabel.exec(str)) !== null) add(m[1], m[2], true);
  const hrCode = new RegExp(RE_HR_CODE.source, "gi");
  while ((m = hrCode.exec(str)) !== null) add(m[1], m[2], true);
  const course = new RegExp(RE_COURSE_CODE.source, "g");
  while ((m = course.exec(str)) !== null) add(m[1], m[2], false);

  return out;
}

/**
 * Pure: choose a section from candidate tokens for a student in `grade`.
 * A token whose grade digits disagree with the student's grade is a stale
 * enrolment and is never used — returning "" is better than returning last
 * year's section.
 */
function pickSection_(tokens, grade) {
  const list = tokens || [];
  const g = String(grade == null ? "" : grade).replace(/\D+/g, "");
  if (!g) {
    const hr = list.filter(function (t) { return t.homeroom; })[0];
    return (hr || list[0] || {}).token || "";
  }
  const matching = list.filter(function (t) { return t.token.indexOf(g) === 0; });
  const hr = matching.filter(function (t) { return t.homeroom; })[0];
  return (hr || matching[0] || {}).token || "";
}

/** Pure: section from the Panorama payload, honouring the student's grade. */
function extractGroupFromPanorama_(data, grade) {
  if (!data) return "";
  // The homeroom sub-object is the most trustworthy part of the page, so try it
  // alone before falling back to scanning everything.
  const info = (data.col3 && data.col3.info) || {};
  if (info.homeroom) {
    const picked = pickSection_(sectionTokensFromText_(JSON.stringify(info.homeroom)), grade);
    if (picked) return picked;
  }
  let whole = "";
  try { whole = JSON.stringify(data); } catch (err) { return ""; }
  return pickSection_(sectionTokensFromText_(whole), grade);
}

/**
 * Pure: learn homeroom-teacher → section from the students who resolved, then
 * fill in the ones who did not. Mutates each student's `group`, and returns
 * { map, filled, unresolved } for the log.
 */
function inferSectionsByTeacher_(students) {
  const list = students || [];
  const votes = {};
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const teacher = String(s.firstHomeroomTeacher || "").trim();
    if (!teacher || !s.group) continue;
    if (!votes[teacher]) votes[teacher] = {};
    votes[teacher][s.group] = (votes[teacher][s.group] || 0) + 1;
  }

  const map = {};
  Object.keys(votes).forEach(function (teacher) {
    const tally = votes[teacher];
    const best = Object.keys(tally).sort(function (a, b) {
      return tally[b] - tally[a] || (a < b ? -1 : 1);
    })[0];
    if (best) map[teacher] = best;
  });

  let filled = 0;
  const unresolved = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.group) continue;
    const teacher = String(s.firstHomeroomTeacher || "").trim();
    const guess = map[teacher];
    // Only accept a teacher's section if its grade matches this student's, so a
    // teacher who runs homerooms in two grades cannot mislabel anyone.
    const g = String(s.grade == null ? "" : s.grade).replace(/\D+/g, "");
    if (guess && (!g || guess.indexOf(g) === 0)) {
      s.group = guess;
      s.groupSource = "homeroom teacher";
      filled++;
    } else {
      unresolved.push((s.lastName || "?") + ", " + (s.prefFirst || s.firstName || "?") +
        (teacher ? " (" + teacher + ")" : " (no homeroom teacher)"));
    }
  }
  return { map: map, filled: filled, unresolved: unresolved };
}

/* ============================================================
 * ROSTER CSV EXPORT
 *
 * Produces the CSV that backend/behavior/lib/rosterImport.js expects, using
 * that file's canonical header names so the upload needs no editing:
 *
 *   Student ID, Last Name, First Name, Common/Preferred Name, Gender,
 *   Class/Group, Grade, House, DOB,
 *   Parent 1 Name, Parent 1 Email, Parent 1 Edsby ID,
 *   Parent 2 Name, Parent 2 Email, Parent 2 Edsby ID
 *
 * Only Last Name and First Name are required; a row with neither is skipped.
 * House matches an existing house by name or creates one on import. Ethnicity
 * is never exported — there is no such column, and bracketed tags such as
 * "Smith [White]" are stripped from names here as well as on import, so a tag
 * pasted into this sheet cannot travel.
 *
 * Exports what is IN THE SHEET, not a fresh Edsby pull, so manual corrections
 * and the House column are included. Run "Update Roster" first for fresh data.
 * ============================================================ */

// Canonical headers, in order. Field names match rowFieldsFor_ below.
const CSV_COLUMNS = [
  { header: "Student ID",             field: "externalId" },
  { header: "Last Name",              field: "lastName" },
  { header: "First Name",             field: "firstName" },
  { header: "Common/Preferred Name",  field: "preferredName" },
  { header: "Gender",                 field: "gender" },
  { header: "Class/Group",            field: "classGroup" },
  { header: "Grade",                  field: "grade" },
  { header: "House",                  field: "house" },
  { header: "DOB",                    field: "dob" },
  { header: "Parent 1 Name",          field: "parent1Name" },
  { header: "Parent 1 Email",         field: "parent1Email" },
  { header: "Parent 1 Edsby ID",      field: "parent1EdsbyId" },
  { header: "Parent 2 Name",          field: "parent2Name" },
  { header: "Parent 2 Email",         field: "parent2Email" },
  { header: "Parent 2 Edsby ID",      field: "parent2EdsbyId" },
];

/** Menu action: build the CSV, save it to Drive, show a link. */
function exportRosterCsv() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET + '" not found.');

  const built = buildRosterCsv_(readSheetRows_(sheet));
  if (built.rows === 0) {
    SpreadsheetApp.getUi().alert(
      "Nothing to export — no rows with a name were found on \"" + CONFIG.SHEET + "\".");
    return;
  }

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const name = CONFIG.CSV.FILENAME_PREFIX + "-" + stamp + ".csv";
  const blob = Utilities.newBlob(built.csv, "text/csv", name);
  const folder = CONFIG.CSV.FOLDER ? getFolderByName_(CONFIG.CSV.FOLDER) : DriveApp.getRootFolder();
  const file = folder.createFile(blob);

  const skipped = built.skipped.length
    ? "<p>Skipped " + built.skipped.length + " row(s) with no name: " +
      built.skipped.slice(0, 20).join(", ") + (built.skipped.length > 20 ? "…" : "") + "</p>"
    : "";
  const houseNote = CONFIG.CSV.HOUSE_COL
    ? ""
    : "<p><b>House is blank.</b> This sheet has no House column, so Behaviours will " +
      "leave houses unset. To include them, put the column number in " +
      "<code>CONFIG.CSV.HOUSE_COL</code>.</p>";

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      "<div style=\"font:13px/1.5 system-ui,sans-serif\">" +
      "<p><b>" + built.rows + " students</b> exported.</p>" + skipped + houseNote +
      '<p><a href="' + file.getUrl() + '" target="_blank">Open ' + escapeHtml_(name) + "</a></p>" +
      "<p style=\"color:#666\">Upload it in Behaviours → Students → Import roster.</p></div>"
    ).setWidth(520).setHeight(300),
    "Roster CSV"
  );
}

/** Read every data row as a full value array, plus its row number. */
function readSheetRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return [];
  const width = Math.max(sheet.getLastColumn(), CONFIG.COLS.dadEdsbyId || 1, CONFIG.CSV.HOUSE_COL || 1);
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, width).getValues();
  return values.map(function (v, i) { return { row: CONFIG.DATA_START_ROW + i, values: v }; });
}

/**
 * Pure: sheet rows → { csv, rows, skipped }.
 * `skipped` lists the row numbers dropped for having neither name.
 */
function buildRosterCsv_(sheetRows) {
  const out = [CSV_COLUMNS.map(function (c) { return c.header; })];
  const skipped = [];

  for (let i = 0; i < (sheetRows || []).length; i++) {
    const r = sheetRows[i];
    const f = rowFieldsFor_(r.values);
    // Last Name and First Name are the only required fields.
    if (!f.lastName && !f.firstName) {
      // A blank row is padding, not a dropped student — don't report it.
      if (CSV_COLUMNS.some(function (c) { return String(f[c.field] || "").trim(); })) skipped.push(r.row);
      continue;
    }
    out.push(CSV_COLUMNS.map(function (c) { return f[c.field]; }));
  }

  return {
    csv: out.map(function (row) { return row.map(csvCell_).join(","); }).join("\r\n") + "\r\n",
    rows: out.length - 1,
    skipped: skipped,
  };
}

/** Pure: one sheet row's values → the canonical CSV fields. */
function rowFieldsFor_(values) {
  const cols = CONFIG.COLS;
  const at = function (c) {
    if (!c || c < 1) return "";
    const v = values[c - 1];
    return v == null ? "" : v;
  };
  // stripTags_ mirrors rosterImport.js: bracketed tags like "[White]" are
  // ethnicity markers in the source data and must never leave the sheet.
  return {
    externalId: String(at(cols.edsbyNid) || "").trim(),
    lastName: stripTags_(at(cols.lastName)),
    firstName: stripTags_(at(cols.formalFirst)),
    preferredName: stripTags_(at(cols.commonName)),
    gender: String(at(cols.gender) || "").trim(),
    classGroup: String(at(cols.group) || "").trim(),
    grade: String(at(cols.grade || 0) || "").trim() || gradeFromGroup_(String(at(cols.group) || "")),
    house: String(at(CONFIG.CSV.HOUSE_COL) || "").trim(),
    dob: csvDate_(at(cols.dob)),
    parent1Name: stripTags_(at(cols.momName)),
    parent1Email: String(at(cols.momEmail) || "").trim(),
    parent1EdsbyId: String(at(cols.momEdsbyId) || "").trim(),
    parent2Name: stripTags_(at(cols.dadName)),
    parent2Email: String(at(cols.dadEmail) || "").trim(),
    parent2EdsbyId: String(at(cols.dadEdsbyId) || "").trim(),
  };
}

/**
 * Pure: the sheet has no Grade column of its own — the Group cell holds "8A" —
 * so derive the grade from it rather than exporting it blank.
 */
function gradeFromGroup_(group) {
  const m = String(group || "").trim().match(/^(\d{1,2})/);
  return m ? m[1] : "";
}

/** Pure: strip bracketed tags, matching rosterImport.js stripTags(). */
function stripTags_(v) {
  return String(v == null ? "" : v).replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

/** Pure: a Date or a string → yyyy-MM-dd, or "" when unparseable. */
function csvDate_(v) {
  if (v instanceof Date) {
    // An unparseable Date stringifies to "Invalid Date", which would otherwise
    // be exported verbatim as a birthday.
    if (isNaN(v.getTime())) return "";
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return v.getFullYear() + "-" + p(v.getMonth() + 1) + "-" + p(v.getDate());
  }
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    const p = function (n) { return (n.length < 2 ? "0" : "") + n; };
    return m[1] + "-" + p(m[2]) + "-" + p(m[3]);
  }
  // Leave anything else as typed: rosterImport.js parses dates tolerantly, and
  // guessing between d/m/y and m/d/y here would silently corrupt birthdays.
  return s;
}

/** Pure: RFC 4180 cell — quote when needed, double any inner quotes. */
function csvCell_(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Find or create a Drive folder by name. */
function getFolderByName_(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/* ============================================================
 * SYNC PLANNING
 *
 * Without a stable key the import could only wipe and rewrite, so a student
 * who left simply vanished — indistinguishable from one who was never there,
 * and taking any hand-kept notes with them. Rows now carry the Edsby nid
 * (column U), which makes three cases separable: still enrolled, newly
 * arrived, and gone.
 * ============================================================ */

/** Pure: normalise a name for fallback matching. */
function nameKey_(last, first) {
  const n = function (v) { return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " "); };
  const l = n(last), f = n(first);
  return l || f ? l + "|" + f : "";
}

/**
 * Pure: decide what to do with each row and each Edsby student.
 *
 * existing: [{ row, nid, lastName, firstName }]  — one per sheet data row
 * students: [{ nid, lastName, prefFirst, firstName, ... }] — from Edsby
 *
 * Returns { updates: [{row, student}], appends: [student], archives: [{row, reason}] }.
 * Matching is by nid first; a row with no nid yet (every row, before the first
 * merge run) falls back to last+first name so an existing sheet adopts its
 * nids instead of being archived wholesale.
 */
function planSync_(existing, students) {
  const rows = existing || [];
  const list = students || [];

  const byNid = {};
  const byName = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nid = String(r.nid == null ? "" : r.nid).trim();
    if (nid) {
      if (!byNid[nid]) byNid[nid] = r;
    } else {
      const key = nameKey_(r.lastName, r.firstName);
      if (key && !byName[key]) byName[key] = r;
    }
  }

  const updates = [];
  const appends = [];
  const claimed = {};

  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    const nid = String(st.nid == null ? "" : st.nid).trim();
    let hit = nid && byNid[nid] ? byNid[nid] : null;
    if (!hit) {
      const key = nameKey_(st.lastName, st.prefFirst || st.firstName);
      if (key && byName[key]) hit = byName[key];
    }
    if (hit && !claimed[hit.row]) {
      claimed[hit.row] = true;
      updates.push({ row: hit.row, student: st });
    } else {
      appends.push(st);
    }
  }

  const archives = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (claimed[r.row]) continue;
    // An entirely blank row is padding, not a departed student.
    if (!String(r.nid || "").trim() && !nameKey_(r.lastName, r.firstName)) continue;
    archives.push({ row: r.row, reason: "not in Edsby" });
  }

  return { updates: updates, appends: appends, archives: archives };
}

/** Read the sheet's data rows down to the key/name columns planSync_ needs. */
function readExistingRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return [];
  const rows = lastRow - CONFIG.DATA_START_ROW + 1;
  const width = Math.max(sheet.getLastColumn(), CONFIG.COLS.edsbyNid || 1);
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, rows, width).getValues();
  const cols = CONFIG.COLS;
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const at = function (c) { return c && v[c - 1] != null ? v[c - 1] : ""; };
    out.push({
      row: CONFIG.DATA_START_ROW + i,
      nid: String(at(cols.edsbyNid) || "").trim(),
      lastName: at(cols.lastName),
      firstName: at(cols.formalFirst),
    });
  }
  return out;
}

/** Move departed rows to the archive sheet, then delete them bottom-up. */
function archiveRows_(sheet, archives) {
  if (!archives.length) return 0;
  const ss = sheet.getParent();
  let archive = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);
  const width = Math.max(sheet.getLastColumn(), CONFIG.COLS.edsbyNid || 1);
  if (!archive) {
    archive = ss.insertSheet(CONFIG.ARCHIVE_SHEET);
    const header = new Array(width + 1).fill("");
    header[0] = "Archived from " + CONFIG.SHEET;
    header[width] = "Left (detected)";
    archive.getRange(1, 1, 1, width + 1).setValues([header]);
    archive.setFrozenRows(1);
  }

  // Descending, so deleting a row never shifts one still to be read.
  const rowsDesc = archives.map(function (a) { return a.row; }).sort(function (a, b) { return b - a; });
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const batch = [];
  for (let i = 0; i < rowsDesc.length; i++) {
    const vals = sheet.getRange(rowsDesc[i], 1, 1, width).getValues()[0];
    batch.push(vals.concat([stamp]));
  }
  if (batch.length) {
    archive.getRange(archive.getLastRow() + 1, 1, batch.length, width + 1).setValues(batch);
  }
  for (let i = 0; i < rowsDesc.length; i++) sheet.deleteRow(rowsDesc[i]);
  return rowsDesc.length;
}

/* ============================================================
 * SHEET HELPERS
 * ============================================================ */

function SortByGrade() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET) ||
                SpreadsheetApp.getActive().getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const startRow = 5; // data rows for the sort, per the original macro
  if (lastRow < startRow || lastCol < 3) return;
  sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol)
       .sort([{ column: 3, ascending: true },
              { column: 2, ascending: true },
              { column: 1, ascending: true }]);
}
