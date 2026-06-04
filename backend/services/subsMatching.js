// backend/services/subsMatching.js
//
// Pure matching logic for /subs — kept separate (and dependency-free) so
// it's unit-testable and reused identically by the escalation engine and
// the "how many qualified candidates?" checks the morning dashboard shows.
//
// HARD filters (an ineligible sub is NEVER offered the job — challenge #1,
// #5, #10, #11): required role type, all required qualifications, and any
// required faith-fit attributes (only when the school enables faith fit).
//
// SOFT factors (influence ranking but don't exclude — challenge #3, #9):
// proximity, grade comfort, and reliability. These are blended into a
// score the admin's ranking can be sorted/nudged by. Proximity + a full
// reliability model are scaffolded here with clear seams; the hard filters
// are fully enforced today.

export const ROLE_TYPES = ["teacher", "ea", "specialist", "tech"];
export const FAITH_KEYS = ["statementOfFaith", "prayer", "christianEd", "values"];

const norm = (s) => String(s || "").trim().toLowerCase();

// Does this teacher meet the request's HARD requirements?
export function isEligible(teacher, request) {
  if (!teacher || teacher.active === false) return false;

  // Role type (teacher vs EA vs specialist vs tech).
  const role = request.requiredRole || "teacher";
  const roles = teacher.roleTypes && teacher.roleTypes.length ? teacher.roleTypes : ["teacher"];
  if (!roles.includes(role)) return false;

  // All required qualifications must be present (case-insensitive).
  // "General" means general classroom coverage (e.g. K–8) — no subject
  // filter, so any teacher of the right role qualifies.
  const haves = new Set((teacher.qualifications || []).map(norm));
  for (const q of request.requiredQualifications || []) {
    if (norm(q) === "general") continue;
    if (!haves.has(norm(q))) return false;
  }

  // Faith-fit: every required key must be self-declared true.
  for (const key of request.requiredFaithFit || []) {
    if (!teacher.faithFit || teacher.faithFit[key] !== true) return false;
  }

  return true;
}

// Explain WHY a teacher is ineligible (for admin-facing diagnostics on the
// "zero qualified candidates" surface).
export function eligibilityReasons(teacher, request) {
  const reasons = [];
  if (!teacher || teacher.active === false) reasons.push("not available");
  const role = request.requiredRole || "teacher";
  const roles = teacher?.roleTypes?.length ? teacher.roleTypes : ["teacher"];
  if (!roles.includes(role)) reasons.push(`not a ${role}`);
  const haves = new Set((teacher?.qualifications || []).map(norm));
  for (const q of request.requiredQualifications || []) {
    if (norm(q) === "general") continue;
    if (!haves.has(norm(q))) reasons.push(`missing "${q}"`);
  }
  for (const key of request.requiredFaithFit || []) {
    if (!teacher?.faithFit || teacher.faithFit[key] !== true) reasons.push(`faith: ${key}`);
  }
  return reasons;
}

// Haversine distance in km (proximity scaffold — challenge #3).
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Soft ranking score in [0,1]. Higher = better match. Used to suggest a
// ranking order; the admin's explicit ranking still wins. Blends grade
// comfort, reliability, and proximity (within the sub's max travel).
// TODO(ranking): tune weights with real fill-rate data per challenge #3/#9.
export function matchScore(teacher, request, schoolLocation) {
  let score = 0.5;

  // Grade comfort.
  if (request.gradeName && teacher.gradeComfort?.some((g) => norm(g) === norm(request.gradeName))) {
    score += 0.15;
  }

  // Reliability (acceptance/on-time/admin rating already aggregated onto
  // teacher.reliability — see ReliabilityRecord).
  const rel = teacher.reliability || {};
  if (typeof rel.adminRating === "number") score += (rel.adminRating / 5) * 0.2 - 0.1;
  if (typeof rel.acceptanceRate === "number") score += rel.acceptanceRate * 0.1 - 0.05;

  // Proximity: closer is better, and respect the sub's max travel.
  const d = distanceKm(teacher.location, schoolLocation);
  if (d != null) {
    if (teacher.maxTravelKm && d > teacher.maxTravelKm) score -= 0.25;
    else score += Math.max(0, 0.15 * (1 - d / 50));
  }

  return Math.max(0, Math.min(1, score));
}
