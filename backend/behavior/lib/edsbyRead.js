// backend/behavior/lib/edsbyRead.js
//
// Read-side Edsby helpers for the honour-roll feature (/api/behavior/avgs).
//
// ⚠️ Edsby has NO public API (see EdsbyProvider.js). The only DevTools-verified
// request shape we have is `GET <base>/core/node.json/<nid>?xds=<View>` with the
// session cookie + jver/cver headers. WHICH view carries per-class grades for a
// student is not verified yet, so fetchStudentCourses() tries a small list of
// candidate views and extractCourses() scans whatever JSON comes back for
// course-shaped objects, recording diagnostics so the shape can be pinned down
// after the first real run against a live session.
//
// Everything below the fetch helpers is a pure function — testable without
// Mongo or a live Edsby session.

// Candidate per-student views, in order. Panorama is the student-overview page
// the app already uses as a broadcast Referer (/p/Panorama/<studentNid>), so its
// JSON twin is the best first guess. Override the list without a deploy via
// EDSBY_GRADE_VIEWS="ViewA,ViewB".
export const DEFAULT_STUDENT_VIEWS = (process.env.EDSBY_GRADE_VIEWS || "Panorama")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Candidate views for LISTING a school's students (to harvest their nids).
// ZoomMyStudents is a teacher's "My Students"; an admin account is often
// denied it (Edsby error 1030), so a few alternatives are tried in order.
// Pin the correct one for a school via EDSBY_STUDENT_VIEWS="View1,View2".
export const DEFAULT_STUDENT_LIST_VIEWS = (
  process.env.EDSBY_STUDENT_VIEWS || "ZoomMyStudents,SchoolStudents,Students,ClassStudents"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Authenticated GET of an Edsby JSON view. Returns { ok, status, json, text }. */
export async function edsbyGetJson(sess, nid, view, extraQuery = "") {
  const url = `${String(sess.baseUrl || "").replace(/\/+$/, "")}/core/node.json/${nid}?xds=${encodeURIComponent(view)}${extraQuery}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Cookie: sess.cookie,
        "x-xds-jver": sess.jver || "",
        "x-xds-cver": sess.cver || "",
        Accept: "application/json, text/plain, */*",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, json: null, text: err?.message || String(err) };
  }
  const text = await res.text().catch(() => "");
  if (/login/i.test(text) && /<form/i.test(text)) {
    return { ok: false, status: 401, json: null, text: "session-expired" };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { ok: res.status >= 200 && res.status < 300 && json !== null, status: res.status, json, text };
}

// ── Tolerant course/grade extraction ─────────────────────────────────────────

const NAME_KEYS = /^(name|coursename|course|class|classname|title|subject|text)$/i;
const GRADE_KEYS = /^(average|avg|grade|mark|score|value|percent|percentage|current|overall|currentaverage)$/i;
const SCHEDULE_KEYS = /(schedule|meet|period|days|frequency|occurrence)/i;

// Things that look like names but aren't courses.
const NAME_BLACKLIST = /^(home|mailbox|calendar|attendance|report|notification|message|panorama|profile|settings?)$/i;

function asPercent(v) {
  if (typeof v === "number" && v >= 0 && v <= 100) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function looksLikeClassName(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (!/[a-z]/i.test(s)) return false;
  if (NAME_BLACKLIST.test(s)) return false;
  return true;
}

/**
 * Recursively scan arbitrary Edsby JSON for objects that pair a class-name-ish
 * string with a 0–100 grade-ish value. Returns:
 *   { courses: [{ name, pct, gradeKey, nameKey }], scheduleHints: [...] }
 * scheduleHints collects any key/value whose key smells like scheduling data —
 * raw material for wiring up automatic times-per-week later.
 */
export function extractCourses(root) {
  const courses = [];
  const scheduleHints = [];
  const seen = new Set();

  function visit(node, depth) {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    let nameKey = null, gradeKey = null;
    for (const [k, v] of Object.entries(node)) {
      if (!nameKey && NAME_KEYS.test(k) && looksLikeClassName(v)) nameKey = k;
      if (!gradeKey && GRADE_KEYS.test(k) && asPercent(v) !== null) gradeKey = k;
      if (SCHEDULE_KEYS.test(k) && (typeof v === "string" || typeof v === "number")) {
        if (scheduleHints.length < 40) scheduleHints.push({ key: k, value: v });
      }
    }
    if (nameKey && gradeKey) {
      const name = String(node[nameKey]).trim();
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        courses.push({ name, pct: asPercent(node[gradeKey]), nameKey, gradeKey });
      }
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  }

  visit(root, 0);
  return { courses, scheduleHints };
}

/**
 * Map the structure of a JSON payload — cheap diagnostic when extraction finds
 * nothing. Descends into objects AND the first element of arrays (where Edsby
 * list rows live), so a single shape string reveals where the records are.
 */
export function describeShape(json, maxKeys = 40) {
  if (json === null || typeof json !== "object") return typeof json;
  const keys = [];
  function walk(node, prefix, depth) {
    if (keys.length >= maxKeys || depth > 5 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      keys.push(`${prefix}[${node.length}]`);
      if (node.length) walk(node[0], `${prefix}[0].`, depth + 1); // peek at the row shape
      return;
    }
    for (const k of Object.keys(node)) {
      if (keys.length >= maxKeys) break;
      const v = node[k];
      if (Array.isArray(v)) {
        keys.push(`${prefix}${k}[${v.length}]`);
        if (v.length && typeof v[0] === "object") walk(v[0], `${prefix}${k}[0].`, depth + 1);
      } else if (v && typeof v === "object") {
        keys.push(prefix + k);
        walk(v, prefix + k + ".", depth + 1);
      } else {
        keys.push(prefix + k);
      }
    }
  }
  walk(json, "", 0);
  return keys.join(", ");
}

/**
 * Fetch one student's courses+grades, trying each candidate view until one
 * yields courses. Returns { courses, view, diagnostics }.
 */
export async function fetchStudentCourses(sess, studentNid, views = DEFAULT_STUDENT_VIEWS) {
  const diagnostics = [];
  for (const view of views) {
    const r = await edsbyGetJson(sess, studentNid, view);
    if (r.status === 401) {
      return { courses: [], view: null, diagnostics, sessionExpired: true };
    }
    if (!r.ok) {
      diagnostics.push({ view, status: r.status, note: "non-JSON or error response" });
      continue;
    }
    const { courses, scheduleHints } = extractCourses(r.json);
    if (courses.length) {
      return { courses, scheduleHints, view, diagnostics };
    }
    diagnostics.push({ view, status: r.status, note: `JSON but no course-shaped data; keys: ${describeShape(r.json)}` });
  }
  return { courses: [], view: null, diagnostics };
}

// ── Student-nid harvesting ────────────────────────────────────────────────────

/**
 * Parse the Edsby Zoom "My Students" row table — verified shape (bcs.edsby.com,
 * 2026-06): the rows live at `…data.zoom.data.table.rec`, an object keyed by
 * "r<studentNid>", each value having FirstName/PrefName/LastName, Grade,
 * Average, SID, Classes. The rows only load when the request carries `stage=1`.
 * Finds the rec map wherever it sits, so it survives minor nesting changes.
 * Returns [{ nid, name, first, last, grade, average }].
 */
export function extractZoomStudents(root) {
  let rec = null;
  (function find(node, depth) {
    if (rec || !node || typeof node !== "object" || depth > 16) return;
    if (Array.isArray(node)) {
      for (const v of node) find(v, depth + 1);
      return;
    }
    const keys = Object.keys(node);
    // A rec map is mostly "r<digits>" keys pointing at row objects.
    if (keys.length >= 3 && keys.filter((k) => /^r\d+$/.test(k)).length >= keys.length * 0.8) {
      rec = node;
      return;
    }
    for (const k of keys) find(node[k], depth + 1);
  })(root, 0);

  if (!rec) return [];
  const out = [];
  for (const [key, r] of Object.entries(rec)) {
    if (!r || typeof r !== "object") continue;
    const nid = String(r.nid ?? key.replace(/^r/, "")).trim();
    const first = String(r.PrefName || r.FirstName || "").trim();
    const last = String(r.LastName || "").trim();
    const name = `${first} ${last}`.trim();
    if (!/^\d{3,}$/.test(nid) || !name) continue;
    out.push({
      nid,
      name,
      first,
      last,
      firstName: String(r.FirstName ?? "").trim(), // legal first (e.g. "Oluwatobiloba")
      prefName: String(r.PrefName ?? "").trim(),    // preferred (e.g. "Tobi" or "Oluwatobiloba(Tobi)")
      grade: String(r.Grade ?? "").trim(),
      average: typeof r.Average === "number" ? r.Average : null,
    });
  }
  return out;
}

const PERSON_NAME_KEYS = /^(name|fullname|studentname|displayname|text|title)$/i;
const FIRST_KEYS = /^(first|firstname|givenname|given)$/i;
const LAST_KEYS = /^(last|lastname|surname|familyname)$/i;
const NID_KEYS = /^(nid|id|userid|user_id|studentnid|studentid|student_nid)$/i;

function asNid(v) {
  const s = String(v ?? "").trim();
  return /^\d{3,}$/.test(s) ? s : null;
}

/**
 * Recursively scan Edsby JSON for person-shaped objects: an nid-ish numeric id
 * next to a name (either one "name" string — possibly "Last, First" — or
 * first/last fields). Returns [{ nid, name, first, last }] deduped by nid.
 */
export function extractPeople(root) {
  const people = [];
  const seen = new Set();

  function visit(node, depth) {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    let nid = null, name = "", first = "", last = "";
    for (const [k, v] of Object.entries(node)) {
      if (!nid && NID_KEYS.test(k)) nid = asNid(v);
      if (!name && PERSON_NAME_KEYS.test(k) && typeof v === "string" && /[a-z]/i.test(v)) name = v.trim();
      if (!first && FIRST_KEYS.test(k) && typeof v === "string") first = v.trim();
      if (!last && LAST_KEYS.test(k) && typeof v === "string") last = v.trim();
    }
    if (!name && (first || last)) name = `${first} ${last}`.trim();
    if (name && name.includes(",") && !first && !last) {
      const [l, f] = name.split(",", 2).map((s) => s.trim());
      last = l; first = f || "";
    }
    if (nid && name && !seen.has(nid)) {
      seen.add(nid);
      people.push({ nid, name, first, last });
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  }

  visit(root, 0);
  return people;
}

/**
 * Fetch the students listing via the ZoomMyStudents view (the one
 * DevTools-verified listing request in this codebase — see
 * EdsbyProvider.testConnection). Plain GET first; if that yields no people,
 * fall back to the formkey POST with _method=GET. Returns
 * { people, diagnostics, sessionExpired? }.
 */
/**
 * Fetch a fresh _formkey from an unauthenticated-CSRF bootstrap GET (mirrors
 * EdsbyProvider.testConnection step 1). Edsby formkeys expire quickly, so a
 * stored one usually 403s on POST — refresh right before use. Returns
 * { formkey } / { sessionExpired } / {}.
 */
export async function refreshFormkey(sess) {
  const base = String(sess.baseUrl || "").replace(/\/+$/, "");
  const urls = [
    `${base}/core/node.json/?xds=bootstrap`,
    sess.userNid ? `${base}/core/node.json/${sess.userNid}?xds=Home` : null,
    sess.userNid ? `${base}/core/node.json/${sess.userNid}` : null,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { Cookie: sess.cookie, "x-xds-jver": sess.jver || "", "x-xds-cver": sess.cver || "", Accept: "application/json, text/plain, */*" },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      const t = await r.text().catch(() => "");
      if (/login/i.test(t) && /<form/i.test(t)) return { sessionExpired: true };
      const m = t.match(/_formkey"?\s*[:=]\s*"([^"]+)"/);
      if (m) return { formkey: m[1] };
    } catch {
      /* try the next bootstrap endpoint */
    }
  }
  return {};
}

export async function fetchZoomStudents(sess, zoomId, formkey) {
  const diagnostics = [];
  const base = String(sess.baseUrl || "").replace(/\/+$/, "");

  // Refresh the formkey first — a stored one is usually stale and 403s the POST.
  const fresh = await refreshFormkey(sess);
  if (fresh.sessionExpired) return { people: [], diagnostics, sessionExpired: true };
  const fk = fresh.formkey || formkey || "";
  diagnostics.push({ step: "refreshFormkey", note: fresh.formkey ? "fetched a fresh formkey" : "could not refresh — using stored formkey" });

  // Which Edsby view lists this account's students is school/role-specific
  // (a teacher has ZoomMyStudents; an admin may not — Edsby returns
  // error 1030 "denied nodetype"). Try each candidate view, GET then formkey
  // POST, and report per-view diagnostics so the right one can be pinned via
  // EDSBY_STUDENT_VIEWS (no deploy needed).
  // The Zoom "My Students" rows only load when the request carries stage=1; the
  // bare view returns just the page shell. Prefer the verified rec-table parser,
  // fall back to the generic person scan.
  const parse = (j) => { const z = extractZoomStudents(j); return z.length ? z : extractPeople(j); };

  for (const view of DEFAULT_STUDENT_LIST_VIEWS) {
    // GET (with stage=1 so the row data is included)
    const g = await edsbyGetJson(sess, zoomId, view, "&stage=1");
    if (g.status === 401) return { people: [], diagnostics, sessionExpired: true, formkey: fk };
    if (g.ok) {
      const people = parse(g.json);
      if (people.length) return { people, diagnostics, view, formkey: fk };
      diagnostics.push({ step: `GET ${view}`, status: g.status, note: `JSON but no person-shaped data; shape: ${describeShape(g.json)}`, sample: JSON.stringify(g.json).slice(0, 1500) });
    } else {
      diagnostics.push({ step: `GET ${view}`, status: g.status, note: "non-JSON or error response" });
    }

    // formkey POST
    if (!fk) {
      diagnostics.push({ step: `POST ${view}`, note: "skipped — no formkey (refresh failed and none stored)" });
      continue;
    }
    const url = `${base}/core/node.json/${zoomId}?xds=${encodeURIComponent(view)}&stage=1&_method=GET`;
    const boundary = "----CurriculateHarvest";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="_formkey"\r\n\r\n${fk}\r\n--${boundary}--\r\n`;
    let res, text = "";
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Cookie: sess.cookie,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-xds-jver": sess.jver || "",
          "x-xds-cver": sess.cver || "",
          "x-edsby-client-request-queue": "net::post",
          Origin: base,
          Referer: `${base}/p/${view}/${zoomId}`,
        },
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      text = await res.text().catch(() => "");
    } catch (err) {
      diagnostics.push({ step: `POST ${view}`, note: err?.message || String(err) });
      continue;
    }
    if (/login/i.test(text) && /<form/i.test(text)) return { people: [], diagnostics, sessionExpired: true, formkey: fk };
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    if (!json) {
      diagnostics.push({ step: `POST ${view}`, status: res.status, note: `non-JSON: ${text.slice(0, 150)}` });
      continue;
    }
    const people = parse(json);
    if (people.length) return { people, diagnostics, view, formkey: fk };
    diagnostics.push({ step: `POST ${view}`, status: res.status, note: `JSON but no person-shaped data; shape: ${describeShape(json)}`, sample: JSON.stringify(json).slice(0, 1500) });
  }

  return { people: [], diagnostics, formkey: fk };
}

// ── Weights, averages, honours ────────────────────────────────────────────────

/**
 * Guess days/week + weight from a class name, mirroring the /avgs PDF rules:
 * core academics 4×→0.8, arts 2×→0.4, PE 1×→0.2, CE daily-but-half→0.5,
 * unknown 2×→0.4.
 */
export function guessWeight(className) {
  const n = String(className || "").toLowerCase();
  if (/career|\bce\b|^ce\d|planning/.test(n)) return { daysPerWeek: 5, weight: 0.5, note: "daily, counted at half value" };
  if (/math/.test(n)) return { daysPerWeek: 4, weight: 0.8 };
  if (/engl|language arts|\bela\b|liter/.test(n)) return { daysPerWeek: 4, weight: 0.8 };
  if (/scien/.test(n)) return { daysPerWeek: 4, weight: 0.8 };
  if (/social|humanit|histor|geograph/.test(n)) return { daysPerWeek: 4, weight: 0.8 };
  if (/french|francais|español|spanish|language\b/.test(n)) return { daysPerWeek: 4, weight: 0.8 };
  if (/\bp\.?e\.?\b|phys\.? ?ed|physical educ|gym/.test(n)) return { daysPerWeek: 1, weight: 0.2 };
  if (/art|music|band|drama|choir|dance/.test(n)) return { daysPerWeek: 2, weight: 0.4 };
  return { daysPerWeek: 2, weight: 0.4, note: "unrecognized — review" };
}

export const normalizeClassKey = (name) =>
  String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Resolve a course against the configured class list (exact normalized match,
 * then containment either way). Returns the config entry or null.
 */
export function matchConfigClass(courseName, classes) {
  const key = normalizeClassKey(courseName);
  if (!key) return null;
  let hit = classes.find((c) => normalizeClassKey(c.name) === key);
  if (hit) return hit;
  hit = classes.find((c) => {
    const ck = normalizeClassKey(c.name);
    return ck && (key.includes(ck) || ck.includes(key));
  });
  return hit || null;
}

/**
 * Weighted average + tier for one student's courses.
 * classes: configured [{ name, weight, include }] — a matched excluded class is
 * skipped; an unmatched course falls back to guessWeight().
 * Returns { weightedAvg, tier, courses: [...] } with per-course weights used.
 */
export function computeStudent(courses, classes, thresholds) {
  const used = [];
  let num = 0, den = 0;
  for (const c of courses) {
    const cfg = matchConfigClass(c.name, classes);
    if (cfg && cfg.include === false) continue;
    const weight = cfg ? Number(cfg.weight) : guessWeight(c.name).weight;
    const pct = asPercent(c.pct);
    used.push({ name: c.name, pct, weight, matched: !!cfg });
    if (pct === null || !(weight > 0)) continue;
    num += pct * weight;
    den += weight;
  }
  const weightedAvg = den > 0 ? num / den : null;
  let tier = "";
  if (weightedAvg !== null) {
    if (weightedAvg >= thresholds.highHonours) tier = "high-honours";
    else if (weightedAvg >= thresholds.honours) tier = "honours";
  }
  return { weightedAvg, tier, courses: used };
}

/** Run an async fn over items with bounded concurrency, preserving order. */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
