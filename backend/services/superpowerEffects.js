// backend/services/superpowerEffects.js
//
// Server-side activation logic for the superpowers whose effect is
// enforced by the backend (Bonus Booster, Point Shield, Mystery Gift).
// Client-side powers (Slow Time, Truth Seeker, Time Warp) don't
// route through here — they're purely display-side flags the student
// app owns.
//
// Contract:
//   armSuperpower(team, powerId) → { ok, error? }
//     idempotent-per-power; refuses if the team's assigned power
//     doesn't match, or the team already used this session.
//
//   applyBonusOrShield(team, points) → { pointsOut, triggered }
//     called by the submission scoring path just before the
//     submissionDoc is created. Multiplies for Bonus Booster,
//     absorbs a negative for Point Shield. Clears the flag when it
//     fires so the power is one-shot.
//
//   applyMysteryGift(team, roomStations) → { bonus, revealText, triggered }
//     called by the station scan handler on a successful arrival
//     scan. Adds a synthetic bonus + returns copy so the student's
//     UI can surface a reveal.
//
// All three are pure over their inputs — they mutate the team object
// (clearing the pending flag) but read no globals and throw only on
// developer error.

const SERVER_ENFORCED = new Set([
  "bonus_booster",
  "point_shield",
  "mystery_gift",
  "second_chance",
]);

const MYSTERY_GIFT_BONUS_POINTS = 50;

/**
 * Arm a superpower on a team. Called from the `superpower:activate`
 * socket handler.
 */
export function armSuperpower(team, powerId) {
  if (!team) return { ok: false, error: "team-not-found" };
  if (!powerId) return { ok: false, error: "missing-power-id" };
  if (team.superpower !== powerId) {
    return { ok: false, error: "not-assigned-this-power" };
  }
  if (team.superpowerUsedAt) {
    return { ok: false, error: "already-used" };
  }

  // Client-owned powers don't need server arming — silently accept so
  // the client can use a single unified activate emit and we don't
  // spam the console with false errors.
  if (!SERVER_ENFORCED.has(powerId)) {
    team.superpowerUsedAt = new Date().toISOString();
    return { ok: true, clientOnly: true };
  }

  team.pendingSuperpower = { id: powerId, armedAt: Date.now() };
  team.superpowerUsedAt = new Date().toISOString();
  return { ok: true };
}

/**
 * Apply Bonus Booster (2× points) or Point Shield (absorb negative)
 * to a submission's raw points. Idempotent per activation — clears
 * pendingSuperpower once triggered.
 *
 * @returns { pointsOut, triggered: null | "bonus_booster" | "point_shield" }
 */
export function applyBonusOrShield(team, pointsIn) {
  const raw = Number.isFinite(pointsIn) ? pointsIn : 0;
  const pending = team?.pendingSuperpower;
  if (!pending) return { pointsOut: raw, triggered: null };

  if (pending.id === "bonus_booster" && raw > 0) {
    team.pendingSuperpower = null;
    return { pointsOut: raw * 2, triggered: "bonus_booster" };
  }
  if (pending.id === "point_shield" && raw < 0) {
    team.pendingSuperpower = null;
    return { pointsOut: 0, triggered: "point_shield" };
  }
  // A shield armed but no negative on this submission stays armed for
  // the next one. Same for a booster with 0 or negative points.
  return { pointsOut: raw, triggered: null };
}

/**
 * Apply Mystery Gift on a successful station scan.
 *
 * @returns { bonus: number, revealText: string, triggered: boolean }
 */
export function applyMysteryGift(team) {
  const pending = team?.pendingSuperpower;
  if (!pending || pending.id !== "mystery_gift") {
    return { bonus: 0, revealText: "", triggered: false };
  }
  team.pendingSuperpower = null;
  // For MVP the reveal is a fixed bonus + a fun copy line. Future
  // versions could randomize the reward across a small pool.
  return {
    bonus: MYSTERY_GIFT_BONUS_POINTS,
    revealText: `🎁 Mystery Gift! +${MYSTERY_GIFT_BONUS_POINTS} points for arriving at this station.`,
    triggered: true,
  };
}

/**
 * Apply Second Chance (Tier 2) on a submit path.
 *
 * When a team armed Second Chance and this submission is WRONG,
 * we don't record anything — the flag clears and the caller is told
 * to short-circuit the submit path with a retry ack. The team's retry
 * runs the normal path (no superpower armed) and scores real points.
 *
 * @returns { triggered: boolean, revealText: string }
 *   Triggered = true means the caller should skip the rest of the
 *   submit handler, emit `superpower:triggered`, and ack with
 *   { ok: true, secondChanceRetry: true }.
 */
export function applySecondChance(team, correct) {
  const pending = team?.pendingSuperpower;
  if (!pending || pending.id !== "second_chance") {
    return { triggered: false, revealText: "" };
  }
  // Only fires on an explicitly-wrong answer. Correct === null (AI
  // still scoring) or correct === true both mean "don't consume the
  // charge yet."
  if (correct !== false) {
    return { triggered: false, revealText: "" };
  }
  team.pendingSuperpower = null;
  return {
    triggered: true,
    revealText: "✋ Second Chance! That answer didn't count — give it one more shot.",
  };
}

export const __constants = {
  SERVER_ENFORCED,
  MYSTERY_GIFT_BONUS_POINTS,
};
