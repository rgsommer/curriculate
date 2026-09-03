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
  CLEAR_OLD_ROWS: true,
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
    // T is "Greeting & Email" -- left untouched (it's your formula).
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
 * DIAGNOSTICS — run this first when something 403s
 * ============================================================ */

/**
 * Preflight check. Reports which credential is missing or stale rather than
 * leaving you with a bare "HTTP 403". Run from the Apps Script editor and read
 * the Execution log.
 */
function diagnoseEdsby() {
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

  if (sess.cookie && countCookies_(sess.cookie) === 1) {
    lines.push("Note: only one cookie is stored. Edsby usually needs the whole " +
      "Cookie: header line, not just session_id_edsby.");
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
      msg += " The *caller* has no link to that node. Two causes, in order of " +
             "likelihood: (1) this request is not authenticated as you — an " +
             "incomplete or expired cookie leaves Edsby treating you as a " +
             "stranger to the node, and a bootstrap HTTP 200 does NOT rule this " +
             "out because bootstrap answers unauthenticated; run checkAuth(). " +
             "(2) the node id really is stale — but if you can open " +
             "/p/ZoomMyStudents/<id> in your browser, it is not.";
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

function dumpSession() {
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
function checkAuth() {
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
    lines.push("  5. Re-run checkAuth(). Once it says signed in, run populateBdays().");
  }
  Logger.log(lines.join("\n"));
}

/** Returns { authenticated, verdict, detail[] }. */
function checkAuthStatus_(sess) {
  const detail = [];
  detail.push("Cookie: " + sess.cookie.length + " chars, " +
    countCookies_(sess.cookie) + " cookie(s)" +
    (countCookies_(sess.cookie) === 1
      ? " — only one. Edsby normally sets several; a lone session_id_edsby is " +
        "often not enough to authenticate."
      : ""));

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
  detail.push("decide it. Run dumpSession() — it checks Set-Cookie, which can.");
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
function discoverZoomNodes() {
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
    lines.push("  5. Run probeNode() to confirm it works, then populateBdays().");
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
    lines.push("Put NUMBER in EDSBY_ZOOM_NODE_ID, then run probeNode() to confirm.");
  }
  Logger.log(lines.join("\n"));
}

/**
 * Test one node id against every student-listing view. Reads
 * EDSBY_ZOOM_NODE_ID unless you pass an id. Use this to confirm an id you
 * copied out of the browser URL bar.
 */
function probeNode(nid) {
  const sess = getEdsbySession_();
  const target = String(nid || sess.zoomNodeId || "").trim();
  if (!target) { Logger.log("No node id. Set EDSBY_ZOOM_NODE_ID or call probeNode(12345678)."); return; }

  const lines = ["Probing node " + target + " — every student-listing view, by GET and by formkey POST:"];
  const r = probeNodeAllViews_(sess, target);
  for (let i = 0; i < r.tried.length; i++) {
    const t = r.tried[i];
    lines.push("  " + (t.count > 0 ? "✓" : "✗") + " " + t.view + " — " +
      (t.count > 0 ? t.count + " students" : t.note));
  }
  lines.push("");
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

  const consider = function (view, method, r) {
    let count = 0, note = "";
    if (r.ok) {
      count = collectStudentRecords_(unwrapSlice_(r.json)).length;
      if (count === 0) note = "HTTP 200, no student rows (" + describeShape_(r.json) + ")";
    } else {
      note = "HTTP " + r.status + ": " + explainStatus_(r);
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
  return { tried: tried, best: best, note: (firstFail && firstFail.note) || "no students" };
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
  Logger.log("Could not find a working node id. Run discoverZoomNodes() for the full report.");
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
      Logger.log("Run checkAuth() for the fix (usually: paste the whole Cookie header).");
    } else {
      Logger.log("No students returned even though the session is signed in. " +
        "Run discoverZoomNodes() to check the node id.");
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
    // Carry the Classes array from the listing through so we can derive Group.
    s.zoomClasses = studentRecords[i] && studentRecords[i].classes || [];
    s.group = extractGroupFromClasses_(s.zoomClasses);
    students.push(s);
    if (s.dadNid) parentNidsToFetch[s.dadNid] = true;
    if (s.momNid) parentNidsToFetch[s.momNid] = true;
  }
  Logger.log("After grade filter: " + students.length + " students kept.");

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

  // 5. Optionally clear old rows before writing.
  if (CONFIG.CLEAR_OLD_ROWS) {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow >= CONFIG.DATA_START_ROW && lastCol > 0) {
      sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).clearContent();
    }
  }

  // 6. Write rows. Build one 2-D block per column run and write it in a single
  //    setValues() call — the old per-cell setValue() loop made ~10 spreadsheet
  //    round-trips per student and was the slowest part of the run.
  writeStudents_(sheet, students, parentEmails);

  Logger.log("Bdays populated: " + students.length + " students, " +
    Object.keys(parentEmails).length + " parent emails.");
}

function writeStudents_(sheet, students, parentEmails) {
  const cols = CONFIG.COLS;
  if (students.length === 0) return;

  const values = {};
  const put = function (col, i, v) {
    if (!col) return;
    if (!values[col]) values[col] = [];
    values[col][i] = [v];
  };

  for (let i = 0; i < students.length; i++) {
    const s = students[i];

    // Determine "Group" (class designator).
    // Priority: auto-derived from Classes -> teacher map fallback -> grade.
    const cls = s.group ||
                CONFIG.TEACHER_TO_CLASS[s.firstHomeroomTeacher] ||
                s.grade || "";

    put(cols.lastName,    i, s.lastName || "");
    put(cols.formalFirst, i, s.prefFirst || s.firstName || "");
    put(cols.commonName,  i, s.fullName || "");
    put(cols.gender,      i, s.gender || "");
    put(cols.group,       i, cls);
    put(cols.dob,         i, s.dob || "");
    put(cols.momName,     i, s.momName || "");
    put(cols.momEmail,    i, s.momNid ? (parentEmails[s.momNid] || "") : "");
    put(cols.dadName,     i, s.dadName || "");
    put(cols.dadEmail,    i, s.dadNid ? (parentEmails[s.dadNid] || "") : "");
  }

  Object.keys(values).forEach(function (col) {
    const block = values[col];
    for (let i = 0; i < students.length; i++) if (!block[i]) block[i] = [""];
    sheet.getRange(CONFIG.DATA_START_ROW, parseInt(col, 10), students.length, 1).setValues(block);
  });
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
function extractGroupFromClasses_(classes) {
  if (!classes) return "";
  const list = Array.isArray(classes)
    ? classes
    : (typeof classes === "object" ? Object.keys(classes).map(function (k) { return classes[k]; }) : []);
  if (list.length === 0) return "";

  const labelOf = function (c) {
    return String(c.LastName || c.lastname || c.name || c.Name || c.label || "");
  };
  const prefOf = function (c) {
    return String(c.PrefName || c.prefname || c.shortname || c.ShortName || "");
  };

  // 1. Homeroom-first pass.
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c) continue;
    const label = labelOf(c);
    const pref = prefOf(c);
    if (/^homeroom\b/i.test(label) || /^HR\d/i.test(pref)) {
      let m = pref.match(/(\d+)\s*([A-Z])/i);
      if (m) return m[1] + m[2].toUpperCase();
      m = label.match(/(\d+)\s*([A-Z])/);
      if (m) return m[1] + m[2].toUpperCase();
    }
  }

  // 2. Any-class-PrefName fallback (MATH7A, HIST7C, GEO8A, ...).
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c) continue;
    const pref = prefOf(c);
    const m = pref.match(/(\d+)([A-Z])\b/);
    if (m) return m[1] + m[2].toUpperCase();
  }

  return "";
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
