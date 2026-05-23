// backend/services/truthOrDare/moderation.js
//
// 5-layer safety pipeline for Truth or Dare challenges.
//   1. Phrase blacklist (substring match, fast)
//   2. Regex pattern blacklist (versioned, in safetyPatterns.js)
//   3. Approved-category whitelist
//   4. Intensity-cap gates (physical/social/noise vs teacher caps)
//   5. OpenAI moderation API call (best-effort, optional)
//
// Returns { ok: boolean, reasons: [...], severity: "block"|"warn"|"clean", flaggedBy: "layer-name" }
//
// Callers (generator.js) treat ok:false as a reject and retry once,
// then fall back to the curated library.

import {
  SAFETY_VERSION,
  SAFETY_PATTERNS,
  SAFETY_PHRASE_BLACKLIST,
  APPROVED_CATEGORIES,
} from "./safetyPatterns.js";

let _openai = null;
async function _getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const mod = await import("openai");
    const OpenAI = mod.default || mod.OpenAI;
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000 });
    return _openai;
  } catch (e) {
    console.warn("[T-or-D moderation] OpenAI client unavailable:", e?.message || e);
    return null;
  }
}

/**
 * Synchronous fast-path: phrase + regex + category + intensity.
 * Returns { ok, reasons[] }.
 */
export function moderateChallengeSync(challenge, { caps = {} } = {}) {
  const reasons = [];
  if (!challenge || typeof challenge !== "object") {
    return { ok: false, reasons: ["challenge is not an object"], severity: "block", flaggedBy: "shape" };
  }

  const text = [
    challenge.prompt || "",
    challenge.teacherHint || "",
  ].filter(Boolean).join(" \n ").toLowerCase();

  // Layer 1 — phrase blacklist
  for (const phrase of SAFETY_PHRASE_BLACKLIST) {
    if (text.includes(phrase)) {
      reasons.push(`phrase-blacklist: "${phrase}"`);
      return { ok: false, reasons, severity: "block", flaggedBy: "phrase-blacklist", category: "phrase-blacklist" };
    }
  }

  // Layer 2 — regex blacklist
  for (const { rx, category, severity } of SAFETY_PATTERNS) {
    if (rx.test(text)) {
      if (severity === "block") {
        reasons.push(`pattern-blacklist: ${category}`);
        return { ok: false, reasons, severity: "block", flaggedBy: "pattern-blacklist", category };
      } else if (severity === "warn") {
        reasons.push(`pattern-warn: ${category}`);
      }
    }
  }

  // Layer 3 — approved-category whitelist
  if (!APPROVED_CATEGORIES.includes(challenge.category)) {
    reasons.push(`category not approved: "${challenge.category}"`);
    return { ok: false, reasons, severity: "block", flaggedBy: "category-whitelist", category: "unknown-category" };
  }

  // Layer 4 — intensity caps
  const phys = Number(challenge.physicalIntensity) || 0;
  const soc = Number(challenge.socialIntensity) || 0;
  const noise = Number(challenge.noiseExpected) || 0;
  if (caps.physicalIntensityMax != null && phys > caps.physicalIntensityMax) {
    reasons.push(`physicalIntensity ${phys} exceeds cap ${caps.physicalIntensityMax}`);
    return { ok: false, reasons, severity: "block", flaggedBy: "intensity-cap", category: "physical-intensity" };
  }
  if (caps.socialIntensityMax != null && soc > caps.socialIntensityMax) {
    reasons.push(`socialIntensity ${soc} exceeds cap ${caps.socialIntensityMax}`);
    return { ok: false, reasons, severity: "block", flaggedBy: "intensity-cap", category: "social-intensity" };
  }
  if (caps.noiseAllowed === false && noise > 1) {
    reasons.push(`noiseExpected ${noise} but noiseAllowed=false`);
    return { ok: false, reasons, severity: "block", flaggedBy: "intensity-cap", category: "noise" };
  }
  if (caps.movementAllowed === false && phys > 1) {
    reasons.push(`physical intensity ${phys} but movementAllowed=false`);
    return { ok: false, reasons, severity: "block", flaggedBy: "intensity-cap", category: "movement" };
  }

  return { ok: true, reasons, severity: reasons.length ? "warn" : "clean", flaggedBy: null };
}

/**
 * Full pipeline including async OpenAI moderation API call. If OpenAI
 * is unavailable (no key / timeout), skips that layer and returns the
 * sync result.
 */
export async function moderateChallenge(challenge, { caps = {} } = {}) {
  const syncResult = moderateChallengeSync(challenge, { caps });
  if (!syncResult.ok) return { ...syncResult, version: SAFETY_VERSION };

  // Layer 5 — OpenAI moderation
  const client = await _getOpenAI();
  if (!client) return { ...syncResult, version: SAFETY_VERSION };

  try {
    const mod = await client.moderations.create({
      model: "omni-moderation-latest",
      input: `${challenge.prompt}\n${challenge.teacherHint || ""}`,
    });
    const result = mod?.results?.[0];
    if (result?.flagged === true) {
      // Find the highest-scoring flagged category
      const cats = result.categories || {};
      const flaggedCats = Object.entries(cats).filter(([, v]) => v === true).map(([k]) => k);
      return {
        ok: false,
        reasons: [...syncResult.reasons, `openai-moderation: ${flaggedCats.join(", ")}`],
        severity: "block",
        flaggedBy: "openai-moderation",
        category: flaggedCats[0] || "openai-flagged",
        version: SAFETY_VERSION,
      };
    }
  } catch (e) {
    // Fail open — log but don't block, since other layers caught the bad
    // stuff. This keeps the game running during OpenAI outages.
    console.warn("[T-or-D moderation] OpenAI moderation call failed:", e?.message || e);
  }

  return { ...syncResult, version: SAFETY_VERSION };
}
