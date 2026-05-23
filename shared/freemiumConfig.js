// shared/freemiumConfig.js
// Central freemium gating configuration for Curriculate Grading
//
// Before ACTIVATION_DATE: everything is free, unlocked padlocks shown as previews.
// After  ACTIVATION_DATE: limits enforced, locked padlocks + upgrade prompts.

export const FREEMIUM = {
  // ── Master switch ─────────────────────────────────────────────────
  // Set to `true` to force-enable freemium regardless of date.
  // Set to `false` to force-disable. Leave `null` for date-based auto-activation.
  FORCE_ENABLED: null,

  // Auto-activation: freemium kicks in at midnight UTC on this date.
  ACTIVATION_DATE: new Date("2026-11-30T00:00:00Z"),

  // ── Free-tier limits ──────────────────────────────────────────────
  FREE_MONTHLY_LIMIT: 10,           // max grading submissions per month per session (free tier)
  // Per-IP monthly abuse ceiling. The free limit above is per browser session
  // (anyone can clear it / use another device), so it can't be the only gate or
  // it's trivially reset. This much-higher IP ceiling stops a single client from
  // spinning up unlimited sessions to run up OpenAI costs, while staying high
  // enough that a whole school behind one NAT'd IP can work normally.
  // ~30 teachers × 10 free grades = 300, so 600 gives real schools generous room.
  IP_MONTHLY_LIMIT: 600,
  FREE_VOICE: "warm",               // the one voice available for free
  FREE_MODES: ["paste"],            // input modes available for free

  // ── Gated features (locked when freemium is active + user is free) ─
  GATED_VOICES: [
    "professional", "direct", "coach", "gentle_firm",
    "journal_response", "witty_light", "standards",
    "student_friendly", "iep_supportive", "student_conference",
    "pudewa_mastery", "tutor",
  ],
  GATED_MODES: ["photo", "batch", "video"],  // paste stays free

  // ── Pricing ───────────────────────────────────────────────────────
  PLUS_PRICE_MONTHLY: 4.99,         // CAD
  PLUS_PRICE_LABEL: "$4.99 CAD/month",
  UPGRADE_URL: "/pricing",

  // ── Copy / labels ─────────────────────────────────────────────────
  UPGRADE_CTA: "Upgrade to unlock",
  FREE_BADGE: "Free",
  PLUS_BADGE: "Plus",
};

/**
 * Is freemium currently active?
 * Checks FORCE_ENABLED first, then falls back to date comparison.
 */
export function isFreemiumActive() {
  if (FREEMIUM.FORCE_ENABLED === true) return true;
  if (FREEMIUM.FORCE_ENABLED === false) return false;
  return new Date() >= FREEMIUM.ACTIVATION_DATE;
}

/**
 * Is a given voice gated (i.e., requires Plus when freemium is active)?
 */
export function isVoiceGated(voiceValue) {
  return FREEMIUM.GATED_VOICES.includes(voiceValue);
}

/**
 * Is a given input mode gated?
 */
export function isModeGated(mode) {
  return FREEMIUM.GATED_MODES.includes(mode);
}

/**
 * Should the padlock be shown on a feature?
 * Before activation: show unlocked padlock (preview).
 * After activation + free user: show locked padlock.
 * After activation + paid user: no padlock.
 */
export function getPadlockState(userTier) {
  const active = isFreemiumActive();
  const isFree = !userTier || userTier === "FREE";

  if (!active) return "unlocked";          // before activation: always show unlocked preview
  if (isFree) return "locked";             // active + free user: locked
  return "none";                           // active + paid user: no padlock
}

/**
 * Can the user submit another grading this month?
 * @param {number} usedThisMonth - submissions this billing period
 * @param {string} userTier - "FREE" | "PLUS" | "PRO"
 */
export function canSubmitGrading(usedThisMonth, userTier) {
  if (!isFreemiumActive()) return { allowed: true };
  if (userTier && userTier !== "FREE") return { allowed: true };
  if (usedThisMonth >= FREEMIUM.FREE_MONTHLY_LIMIT) {
    return {
      allowed: false,
      reason: `You've used all ${FREEMIUM.FREE_MONTHLY_LIMIT} free gradings this month. Upgrade to Plus for unlimited grading.`,
      remaining: 0,
    };
  }
  return {
    allowed: true,
    remaining: FREEMIUM.FREE_MONTHLY_LIMIT - usedThisMonth,
  };
}

/**
 * Per-IP abuse ceiling check. Independent of the per-session free limit: this
 * exists only to stop a single network from running up unbounded paid AI calls
 * by cycling sessionIds. Returns { allowed, reason }.
 * @param {number} ipUsedThisMonth - submissions from this IP this billing period
 */
export function canSubmitGradingByIp(ipUsedThisMonth) {
  if (!isFreemiumActive()) return { allowed: true };
  if (ipUsedThisMonth >= FREEMIUM.IP_MONTHLY_LIMIT) {
    return {
      allowed: false,
      reason: "We're seeing unusually high grading activity from your network. Please try again later, or upgrade to Plus for unlimited grading.",
    };
  }
  return { allowed: true };
}
