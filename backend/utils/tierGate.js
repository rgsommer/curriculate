// backend/utils/tierGate.js
//
// Shared tier-gate helpers used outside the express middleware path
// (e.g., inside socket handlers and async report flows).
//
// Tier order, matching middleware/requirePlan.js:
//     FREE  <  PLUS  <  PRO
// PRO is the top tier. A user on PRO satisfies a PLUS gate.

const TIER_RANK = { FREE: 0, PLUS: 1, PRO: 2 };

/**
 * Map a free-form plan label to its rank. Accepts common variants:
 *   "FREE", "PLUS", "PRO", "TEACHER_PLUS", "TEACHER_PRO_MONTHLY",
 *   "SCHOOL_PRO_YEARLY", etc. Higher-tier names ("PRO") win when both
 *   substrings appear (defensive — shouldn't happen in practice).
 */
export function tierRank(planLabel) {
  const t = String(planLabel || "").toUpperCase();
  if (!t) return 0;
  if (t.includes("PRO")) return TIER_RANK.PRO;
  if (t.includes("PLUS")) return TIER_RANK.PLUS;
  return TIER_RANK.FREE;
}

/**
 * Returns true if `planLabel` is at or above the `required` minimum.
 * Example: hasTierAtLeast("TEACHER_PLUS", "PLUS")  → true
 *          hasTierAtLeast("TEACHER_PLUS", "PRO")   → false
 *          hasTierAtLeast("TEACHER_PRO",  "PLUS")  → true
 */
export function hasTierAtLeast(planLabel, required) {
  const need = TIER_RANK[String(required || "").toUpperCase()] ?? 0;
  return tierRank(planLabel) >= need;
}

export { TIER_RANK };
