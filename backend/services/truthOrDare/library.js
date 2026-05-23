// backend/services/truthOrDare/library.js
//
// In-memory access to the curated evergreen library. Loaded lazily.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _library = null;

function _normSubject(s) {
  const t = String(s || "").toLowerCase().trim();
  if (!t) return "general";
  if (t.includes("math")) return "math";
  if (t.includes("scien") || t.includes("biolog") || t.includes("chem") || t.includes("phys")) return "science";
  if (t.includes("hist") || t.includes("social")) return "history";
  if (t.includes("englis") || t.includes("lang") || t.includes("liter") || t.includes("read")) return "language";
  if (t.includes("art") || t.includes("music") || t.includes("draw") || t.includes("paint")) return "arts";
  if (t.includes("healt") || t.includes("pe") || t.includes("phys.ed")) return "health";
  if (t.includes("busi") || t.includes("econ")) return "business";
  if (t.includes("religi") || t.includes("bible") || t.includes("faith")) return "religion";
  return "general";
}

function _gradeBand(gradeLevel) {
  const g = Number(gradeLevel) || 0;
  if (g <= 2) return "K-2";
  if (g <= 5) return "3-5";
  if (g <= 8) return "6-8";
  return "9-12";
}

function _loadLibrary() {
  if (_library) return _library;
  try {
    const filePath = path.join(__dirname, "../../data/truthOrDareEvergreen.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    _library = Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (e) {
    console.warn("[T-or-D library] Failed to load evergreen library:", e?.message || e);
    _library = [];
  }
  return _library;
}

/**
 * Find a matching curated entry for (subject, gradeLevel, tier, kindHint, recentIds).
 * - subject normalized to bucket
 * - gradeLevel mapped to band
 * - tier exact match
 * - kindHint = "truth" | "dare" | "either"
 * - recentIds excluded
 *
 * Returns the first match found after random shuffle. Falls back through
 * relaxed filters (kind → subject → tier) before giving up.
 */
export function findCuratedChallenge({ subject, gradeLevel, tier = "sprout", kindHint = "either", recentIds = [], categoryAvoid = [] } = {}) {
  const lib = _loadLibrary();
  if (!lib.length) return null;

  const subjBucket = _normSubject(subject);
  const band = _gradeBand(gradeLevel);
  const excludeIds = new Set(recentIds || []);
  const avoidCats = new Set(categoryAvoid || []);

  const matches = lib.filter((e) => {
    if (excludeIds.has(e.id)) return false;
    if (!e.subjects.includes(subjBucket) && !e.subjects.includes("general")) return false;
    if (!e.gradeBands.includes(band)) return false;
    if (e.tier !== tier) return false;
    if (kindHint !== "either" && e.type !== kindHint) return false;
    if (avoidCats.has(e.category)) return false;
    return true;
  });

  if (matches.length) return _pickRandom(matches);

  // Relax: drop category avoid
  const m2 = lib.filter((e) => !excludeIds.has(e.id) &&
    (e.subjects.includes(subjBucket) || e.subjects.includes("general")) &&
    e.gradeBands.includes(band) &&
    e.tier === tier &&
    (kindHint === "either" || e.type === kindHint));
  if (m2.length) return _pickRandom(m2);

  // Relax: drop kind hint
  const m3 = lib.filter((e) => !excludeIds.has(e.id) &&
    (e.subjects.includes(subjBucket) || e.subjects.includes("general")) &&
    e.gradeBands.includes(band) &&
    e.tier === tier);
  if (m3.length) return _pickRandom(m3);

  // Relax: drop tier
  const m4 = lib.filter((e) => !excludeIds.has(e.id) &&
    (e.subjects.includes(subjBucket) || e.subjects.includes("general")) &&
    e.gradeBands.includes(band));
  if (m4.length) return _pickRandom(m4);

  // Relax: drop subject
  const m5 = lib.filter((e) => !excludeIds.has(e.id) && e.gradeBands.includes(band));
  if (m5.length) return _pickRandom(m5);

  // Absolute fallback: any non-excluded
  const m6 = lib.filter((e) => !excludeIds.has(e.id));
  return m6.length ? _pickRandom(m6) : (lib[0] || null);
}

function _pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Returns a few-shot example set for the AI prompt. */
export function getFewShotExamples({ subject, gradeLevel, tier, kindHint = "either" } = {}) {
  const lib = _loadLibrary();
  const subjBucket = _normSubject(subject);
  const band = _gradeBand(gradeLevel);
  const matches = lib.filter((e) => e.gradeBands.includes(band) &&
    (e.subjects.includes(subjBucket) || e.subjects.includes("general")) &&
    e.tier === tier &&
    (kindHint === "either" || e.type === kindHint));
  // Take up to 3
  const shuffled = [...matches].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

export function librarySize() {
  return _loadLibrary().length;
}
