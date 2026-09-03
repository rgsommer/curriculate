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
  lines.push("jver:     " + (sess.jver || "⚠ MISSING — set EDSBY_JVER (403s without it)"));
  lines.push("cver:     " + (sess.cver || "⚠ MISSING — set EDSBY_CVER (403s without it)"));
  lines.push("User nid: " + (sess.userNid || "(not set — formkey POST retry disabled)"));

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
  const zoom = edsbyGetJson_(sess, CONFIG.ZOOM_NODE_ID, "ZoomMyStudents", "&stage=1");
  lines.push("");
  lines.push("Probe GET ZoomMyStudents/" + CONFIG.ZOOM_NODE_ID + " -> HTTP " + zoom.status);
  lines.push("  " + explainStatus_(zoom));
  if (zoom.json) {
    const recs = collectStudentRecords_(unwrapSlice_(zoom.json));
    lines.push("  Parsed " + recs.length + " student record(s).");
    if (recs.length === 0) {
      lines.push("  Response shape: " + describeShape_(zoom.json));
      lines.push("  Sample: " + JSON.stringify(zoom.json).slice(0, 600));
    }
  }

  Logger.log(lines.join("\n"));
}

function explainStatus_(r) {
  if (r.sessionExpired) {
    return "Session expired — Edsby returned its login page. Refresh EDSBY_SESSION_COOKIE.";
  }
  if (r.status === 403) {
    return "Forbidden. Almost always stale/missing x-xds-jver or x-xds-cver " +
           "(they change with every Edsby release), or a cookie missing values " +
           "beyond session_id_edsby. Re-copy all three from a live request.";
  }
  if (r.status === 401) return "Unauthorized — the session cookie is expired or wrong.";
  if (r.status === 0)   return "Network error: " + r.text;
  if (r.status >= 500)  return "Edsby server error. Retry later.";
  if (r.status >= 400)  return "Error body: " + String(r.text || "").slice(0, 300);
  if (!r.json)          return "HTTP OK but the body was not JSON: " + String(r.text || "").slice(0, 300);
  if (edsbyErrorCode_(r.json)) {
    return "Edsby application error " + edsbyErrorCode_(r.json) +
           (edsbyErrorCode_(r.json) === 1030
             ? " (denied nodetype — this account may not have a \"My Students\" view)."
             : ".");
  }
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

function edsbyErrorCode_(json) {
  if (!json || typeof json !== "object") return null;
  const e = json.error || json.errno || (json.slices && json.slices[0] && json.slices[0].error);
  const n = parseInt(e, 10);
  return isNaN(n) ? null : n;
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
  if (!sess.jver || !sess.cver) {
    Logger.log("Warning: EDSBY_JVER / EDSBY_CVER are not set. Edsby returns HTTP 403 " +
      "without the x-xds-jver and x-xds-cver headers. Run diagnoseEdsby() for details.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET + '" not found.');

  // 1. Get all student records (nid + Classes) from the students listing.
  const studentRecords = fetchZoomMyStudents_(sess);
  if (studentRecords.length === 0) {
    Logger.log("No students returned. Run diagnoseEdsby() — it reports which of " +
      "cookie / jver / cver is stale.");
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
    followRedirects: false,
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
function fetchZoomMyStudents_(sess) {
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
    const g = edsbyGetJson_(sess, CONFIG.ZOOM_NODE_ID, view, "&stage=1");
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
    const url = sess.baseUrl + "/core/node.json/" + CONFIG.ZOOM_NODE_ID +
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
        referer: sess.baseUrl + "/p/" + view + "/" + CONFIG.ZOOM_NODE_ID,
        extraHeaders: {
          "Origin": sess.baseUrl,
          "x-edsby-client-request-queue": "net::post",
        },
      })])[0];
    } catch (err) {
      Logger.log("POST " + view + " threw: " + (err && err.message || err));
      continue;
    }
    const r = readResponse_(resp);
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
