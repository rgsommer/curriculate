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

/** Authenticated GET of an Edsby JSON view. Returns { ok, status, json, text }. */
export async function edsbyGetJson(sess, nid, view) {
  const url = `${String(sess.baseUrl || "").replace(/\/+$/, "")}/core/node.json/${nid}?xds=${encodeURIComponent(view)}`;
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

/** Top-level keys of a JSON payload — cheap diagnostic when extraction finds nothing. */
export function describeShape(json, maxKeys = 25) {
  if (json === null || typeof json !== "object") return typeof json;
  const keys = [];
  function walk(node, prefix, depth) {
    if (keys.length >= maxKeys || depth > 3 || !node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      if (keys.length >= maxKeys) break;
      keys.push(prefix + k + (Array.isArray(node[k]) ? `[${node[k].length}]` : ""));
      if (node[k] && typeof node[k] === "object" && !Array.isArray(node[k])) walk(node[k], prefix + k + ".", depth + 1);
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
