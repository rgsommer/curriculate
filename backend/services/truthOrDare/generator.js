// backend/services/truthOrDare/generator.js
//
// Generates a single Truth-or-Dare challenge for a room. Flow:
//   1. Build classroom profile + recent-history hints
//   2. Compose system + user prompts (with few-shot examples)
//   3. Call LLM (gpt-4o-mini) — JSON-mode where supported
//   4. Validate schema shape
//   5. Run safety pipeline (moderation.js)
//   6. Dedupe against recent challenges for the room
//   7. If any step fails: ONE retry with stricter prompt
//   8. If retry also fails: fall back to curated library
//
// Returns a normalized challenge object:
//   { id, type, tier, category, prompt, teacherHint, timeSeconds,
//     physicalIntensity, socialIntensity, noiseExpected,
//     acceptableAnswers, judgmentMode, rewardTier, sourceProvenance,
//     moderationVersion }

import { APPROVED_CATEGORIES } from "./safetyPatterns.js";
import { moderateChallenge, moderateChallengeSync } from "./moderation.js";
import { findCuratedChallenge, getFewShotExamples } from "./library.js";
import { hasSeenChallenge, rememberChallenge, recentIdsForRoom } from "./recentChallenges.js";

let _openai = null;
async function _getClient() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const mod = await import("openai");
    const OpenAI = mod.default || mod.OpenAI;
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 12000 });
    return _openai;
  } catch (e) {
    console.warn("[T-or-D generator] OpenAI client unavailable:", e?.message || e);
    return null;
  }
}

const MODEL = process.env.TRUTH_OR_DARE_MODEL || "gpt-4o-mini";

function _newId() {
  return "ch-" + Math.random().toString(36).slice(2, 10);
}

function _normChallenge(raw, { sourceProvenance = "ai" } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const allowedTypes = ["truth", "dare"];
  const allowedTiers = ["sprout", "stem", "big"];
  const allowedJudge = ["ai", "teacher", "class-vote"];
  const allowedReward = ["small", "medium", "large"];

  const type = allowedTypes.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return null;

  let acceptable = raw.acceptableAnswers;
  if (typeof acceptable === "string") {
    acceptable = acceptable.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(acceptable)) acceptable = null;

  return {
    id: raw.id && typeof raw.id === "string" ? raw.id : _newId(),
    type,
    tier: allowedTiers.includes(raw.tier) ? raw.tier : "sprout",
    category: APPROVED_CATEGORIES.includes(raw.category) ? raw.category : "recall",
    prompt,
    teacherHint: typeof raw.teacherHint === "string" ? raw.teacherHint.trim() : "",
    timeSeconds: Math.max(15, Math.min(90, Number(raw.timeSeconds) || 30)),
    physicalIntensity: Math.max(0, Math.min(3, Number(raw.physicalIntensity) || 0)),
    socialIntensity: Math.max(0, Math.min(3, Number(raw.socialIntensity) || 1)),
    noiseExpected: Math.max(0, Math.min(3, Number(raw.noiseExpected) || 0)),
    acceptableAnswers: acceptable,
    judgmentMode: allowedJudge.includes(raw.judgmentMode) ? raw.judgmentMode : "teacher",
    rewardTier: allowedReward.includes(raw.rewardTier) ? raw.rewardTier : "small",
    sourceProvenance,
    moderationVersion: "v1",
  };
}

function _buildSystemPrompt({ gradeLevel, subject, unitName, worldview = "general", physicalIntensityMax, socialIntensityMax, movementAllowed, noiseAllowed, timeBudgetSeconds, extraStrictness = false }) {
  const worldviewBlock = (() => {
    if (worldview === "faith") return "Allow gentle references to prayer/faith where they support the lesson topic. Don't mock any religion. Don't proselytize.";
    if (worldview === "secular") return "Frame everything in secular, empirical terms. Avoid religious framing.";
    return "Neutral — let students bring their own framing. Don't lead religious or political content.";
  })();

  const extra = extraStrictness ? `
ADDITIONAL STRICTNESS — your last attempt triggered the safety filter. Tone down social pressure, avoid anything resembling personal disclosure, and choose a SAFER category (recall/explain/reflect over persuade/improv if you have a choice).
` : "";

  return `You are the Truth or Dare master for a North American classroom of grade-${gradeLevel} students studying ${subject} (current unit: ${unitName}). Generate ONE Truth or Dare challenge as a JSON object.

ABSOLUTE NO-FLY ZONE:
- No romance, dating, attraction, crushes, "do you like X".
- No personal disclosure (family income, religion of family, mental health, sexuality, home address).
- No physical contact, touching, hugging, proximity.
- No food, drink, mouth contact.
- No standing on furniture, leaving the classroom, large unsafe movements.
- No singling out any student's appearance, accent, grades, or family.
- No politics, no religion mockery, no celebrity drama, no current-event tragedy.
- No "embarrassing" framing — every challenge must have a path to GLORY, not shame.

WORLDVIEW: ${worldview} — ${worldviewBlock}

VOICE: Warm, playful, slightly theatrical. NEVER snide. NEVER condescending. The challenge should sound like an invitation, not a punishment.

TRUTH questions must be answerable from ${subject}/${unitName} content the class has studied OR a universal-knowledge question a grade-${gradeLevel} student could reasonably answer.

DARE challenges must:
1. Be doable in <=${timeBudgetSeconds}s from a student's seat${movementAllowed ? "" : " (NO standing or large movements — desk-only)"}.
2. Embody, perform, or relate to ${subject}/${unitName} content.
3. Give the performer a clear path to look brilliant.
4. Be at most 1 sentence of instruction.

CAPS: physicalIntensity must be <= ${physicalIntensityMax}, socialIntensity must be <= ${socialIntensityMax}.${!noiseAllowed ? " noiseExpected must be 0 or 1." : ""}
${extra}
OUTPUT — JSON ONLY, no commentary, no markdown:
{
  "type": "truth" | "dare",
  "tier": "sprout" | "stem" | "big",
  "category": "recall" | "explain" | "defend" | "mime" | "persuade" | "roleplay" | "improv" | "draw" | "narrate" | "compose" | "reflect" | "predict",
  "prompt": "the challenge text shown to the student (single sentence)",
  "teacherHint": "1-sentence tip for the teacher on what to look for",
  "timeSeconds": 15-90,
  "physicalIntensity": 0-3,
  "socialIntensity": 0-3,
  "noiseExpected": 0-3,
  "acceptableAnswers": ["short", "key", "phrases"] | null,
  "judgmentMode": "ai" | "teacher" | "class-vote",
  "rewardTier": "small" | "medium" | "large"
}`;
}

function _buildUserPrompt({ tier, kindHint, recentCategories, recentThemes, fewShot }) {
  const examplesBlock = fewShot.length
    ? `\n\nEXAMPLES OF THE STYLE WE WANT (do not copy verbatim — generate a NEW challenge):\n${fewShot.map((ex, i) => `EXAMPLE ${i + 1}: ${JSON.stringify(ex, null, 2)}`).join("\n\n")}\n`
    : "";

  return `TIER: ${tier}
KIND_HINT: ${kindHint}
RECENT_CATEGORIES_TO_AVOID: ${JSON.stringify(recentCategories || [])}
RECENT_PROMPT_THEMES_TO_AVOID: ${JSON.stringify(recentThemes || [])}
${examplesBlock}
Give me ONE challenge now.`;
}

async function _callLLM({ systemPrompt, userPrompt }) {
  const client = await _getClient();
  if (!client) return null;
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.85,
      response_format: { type: "json_object" },
    });
    const text = resp?.choices?.[0]?.message?.content || "";
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Try to find the first {...} block in the text
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  } catch (e) {
    console.warn("[T-or-D generator] LLM call failed:", e?.message || e);
    return null;
  }
}

/**
 * Public: generate one challenge.
 * @param {object} opts
 *   - roomCode (string)
 *   - subject (string)
 *   - unitName (string)
 *   - gradeLevel (number)
 *   - tier ("sprout" | "stem" | "big")
 *   - kindHint ("truth" | "dare" | "either")
 *   - physicalIntensityMax (0-3)
 *   - socialIntensityMax (0-3)
 *   - movementAllowed (bool)
 *   - noiseAllowed (bool)
 *   - timeBudgetSeconds (number, default 45)
 *   - worldview ("general"|"secular"|"faith")
 *   - recentCategories (string[])
 *   - skipLibrary (bool) — for testing
 * Returns a normalized challenge (always succeeds — library fallback).
 */
export async function generateChallenge(opts = {}) {
  const {
    roomCode,
    subject = "general",
    unitName = "general topic",
    gradeLevel = 7,
    tier = "sprout",
    kindHint = "either",
    physicalIntensityMax = 2,
    socialIntensityMax = 2,
    movementAllowed = true,
    noiseAllowed = true,
    timeBudgetSeconds = 45,
    worldview = "general",
    recentCategories = [],
    skipLibrary = false,
  } = opts;

  const caps = { physicalIntensityMax, socialIntensityMax, movementAllowed, noiseAllowed };
  const fewShot = getFewShotExamples({ subject, gradeLevel, tier, kindHint });
  const recentIds = recentIdsForRoom(roomCode);

  // Attempt 1
  let challenge = null;
  let lastFailReason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const systemPrompt = _buildSystemPrompt({
      gradeLevel, subject, unitName, worldview,
      physicalIntensityMax, socialIntensityMax,
      movementAllowed, noiseAllowed, timeBudgetSeconds,
      extraStrictness: attempt === 1,
    });
    const userPrompt = _buildUserPrompt({
      tier, kindHint, recentCategories,
      recentThemes: [], // v2: extract themes from prior prompts
      fewShot: attempt === 0 ? fewShot : fewShot.slice(0, 1),
    });
    const raw = await _callLLM({ systemPrompt, userPrompt });
    if (!raw) {
      lastFailReason = "llm-no-response";
      continue;
    }
    const norm = _normChallenge(raw, { sourceProvenance: "ai" });
    if (!norm) {
      lastFailReason = "schema-malformed";
      continue;
    }
    // Safety pipeline (full, including OpenAI moderation API)
    const mod = await moderateChallenge(norm, { caps });
    if (!mod.ok) {
      lastFailReason = `safety:${mod.category || mod.flaggedBy}`;
      continue;
    }
    // Dedupe
    if (hasSeenChallenge(roomCode, { id: norm.id, prompt: norm.prompt })) {
      lastFailReason = "duplicate";
      continue;
    }
    challenge = norm;
    break;
  }

  // Library fallback
  if (!challenge && !skipLibrary) {
    const lib = findCuratedChallenge({
      subject, gradeLevel, tier, kindHint,
      recentIds,
      categoryAvoid: recentCategories,
    });
    if (lib) {
      const norm = _normChallenge({ ...lib, id: `lib-${lib.id}` }, { sourceProvenance: "library" });
      if (norm) {
        // Library entries are pre-vetted but still run sync moderation
        // against the live intensity caps in case the room is "Safe
        // Classroom" and the library entry exceeds those.
        const mod = moderateChallengeSync(norm, { caps });
        if (mod.ok) challenge = norm;
      }
    }
  }

  // Absolute fallback — should never hit in production
  if (!challenge) {
    challenge = _normChallenge({
      id: "fallback-default",
      type: "truth",
      tier: "sprout",
      category: "reflect",
      prompt: "Tell us one thing you'll remember from today's lesson.",
      teacherHint: "Any honest answer earns the points.",
      timeSeconds: 20,
      physicalIntensity: 0,
      socialIntensity: 1,
      noiseExpected: 0,
      acceptableAnswers: null,
      judgmentMode: "teacher",
      rewardTier: "small",
    }, { sourceProvenance: "fallback" });
  }

  rememberChallenge(roomCode, { id: challenge.id, prompt: challenge.prompt });
  return { challenge, lastFailReason };
}
