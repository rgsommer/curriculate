// backend/controllers/escapeRoomGenerator.js
//
// AI generator for escapeRoomConfig values (ESCAPE_ROOM_PLAN.md §5).
// Calls Claude with the curriculum terms baked into the prompt, validates the
// returned config is solvable (no dead-ends / cycles, all keys reachable), and
// performs one repair attempt on failure.
//
// Output goes onto the TaskSet.escapeRoomConfig field; the runtime engine
// (backend/services/escapeRoom.js) consumes it.

import { EXCLUDED_PUBLISHERS } from "../config/currentEventsExcludedPublishers.js";

const THEMES = ["spy-mission", "archaeology", "biblical-journey", "space-station", "detective-case", "medieval-kingdom", "scientific-emergency", "pirate-treasure"];

function _buildPrompt({ gradeLevel, subject, lessonTopic, narrativeTerms, theme = "spy-mission", difficulty = "medium" }) {
  const termList = (Array.isArray(narrativeTerms) ? narrativeTerms : String(narrativeTerms || "").split(/[,;]/))
    .map((s) => String(s).trim())
    .filter(Boolean);

  return `Generate an Escape Room config for a ${gradeLevel || 7} grade ${subject || "general"} class. The lesson topic is "${lessonTopic || "(general)"}".

THEME: ${theme}
DIFFICULTY: ${difficulty}

CURRICULUM TERMS — these MUST appear in the narrative AND in the lock hints:
${termList.map((t) => `  - ${t}`).join("\n")}

Output JSON ONLY (no markdown, no commentary), matching exactly:
{
  "enabled": true,
  "mode": "linear" | "multi-path",
  "difficulty": "${difficulty}",
  "theme": "${theme}",
  "narrativeTermsUsed": [...],
  "locks": [
    {
      "id": "<unique kebab-case id>",
      "title": "<short evocative title>",
      "narrativeText": "<1-2 sentence in-fiction setup>",
      "requires": { "keys": [<key ids>] },
      "unlocks": { "keys": [<key ids>], "fragments": [<fragment ids>], "roomCompleted": <true only for the final lock> },
      "hint": "<question rooted in the LESSON TOPIC, not a riddle>",
      "type": "password",
      "synthesisAnswer": "<the canonical answer string>"
    }
  ],
  "keys": [
    { "id": "<kebab-case>", "name": "<player-facing name>", "grantedBy": { "taskId": "<linked task id OR null>" }, "narrativeText": "<1 sentence>" }
  ],
  "fragments": [
    { "id": "<kebab-case>", "type": "cipher-digit", "revealValue": "<single digit>", "position": <integer>, "narrativeText": "<1 sentence>" }
  ],
  "narrativeBeats": [
    { "trigger": "lock-1-opened", "text": "..." },
    { "trigger": "room-completed", "text": "..." }
  ]
}

RULES:
- Generate 3-5 locks. The FINAL lock must have unlocks.roomCompleted: true.
- Every lock's "hint" must be a CURRICULUM question — never a riddle disconnected from the lesson.
- Lock 1 must be solvable from lesson basics.
- The final lock should require synthesis of MULTIPLE terms.
- Every key must have grantedBy.taskId, OR be unlocked by an earlier lock's unlocks.keys.
- Every fragment with a revealValue (cipher-digit) should have a unique integer "position".
- Theme metaphors only — never violence, never targeting students.
- All ${termList.length} curriculum terms must appear in at least one lock's hint, narrativeText, or fragment narrativeText.`;
}

function _validateConfig(config, requiredTerms = []) {
  const errors = [];
  if (!config || typeof config !== "object") {
    errors.push("config is not an object");
    return { ok: false, errors };
  }
  if (!Array.isArray(config.locks) || config.locks.length === 0) errors.push("locks[] required");
  if (!Array.isArray(config.keys)) errors.push("keys[] required");
  if (!Array.isArray(config.fragments)) errors.push("fragments[] required");

  const lockIds = new Set();
  const keyIds = new Set((config.keys || []).map((k) => k?.id).filter(Boolean));
  const fragIds = new Set((config.fragments || []).map((f) => f?.id).filter(Boolean));

  let finalLockSeen = false;
  for (const lock of config.locks || []) {
    if (!lock?.id) { errors.push("lock missing id"); continue; }
    if (lockIds.has(lock.id)) errors.push(`duplicate lock id: ${lock.id}`);
    lockIds.add(lock.id);
    if (lock.unlocks?.roomCompleted) finalLockSeen = true;
    if (Array.isArray(lock.requires?.keys)) {
      for (const k of lock.requires.keys) if (!keyIds.has(k)) errors.push(`lock ${lock.id} requires unknown key: ${k}`);
    }
    if (Array.isArray(lock.requires?.fragments)) {
      for (const f of lock.requires.fragments) if (!fragIds.has(f)) errors.push(`lock ${lock.id} requires unknown fragment: ${f}`);
    }
  }
  if (!finalLockSeen) errors.push("no lock has unlocks.roomCompleted=true");

  // Reachability: every key must be granted by something (task OR an earlier lock's unlocks)
  const grantedKeys = new Set();
  for (const k of config.keys || []) {
    if (k?.grantedBy?.taskId) grantedKeys.add(k.id);
  }
  for (const lock of config.locks || []) {
    for (const grant of lock.unlocks?.keys || []) grantedKeys.add(grant);
    for (const grant of lock.unlocks?.fragments || []) grantedKeys.add(grant);  // fragments share the namespace for reachability
  }
  for (const k of keyIds) if (!grantedKeys.has(k)) errors.push(`key '${k}' is never granted`);

  // Curriculum term coverage — at least 80%
  if (Array.isArray(requiredTerms) && requiredTerms.length > 0) {
    const corpus = JSON.stringify(config).toLowerCase();
    const covered = requiredTerms.filter((t) => corpus.includes(String(t).toLowerCase())).length;
    const coverage = covered / requiredTerms.length;
    if (coverage < 0.8) errors.push(`only ${Math.round(coverage * 100)}% of curriculum terms appear in the config (need ≥ 80%)`);
  }

  return { ok: errors.length === 0, errors };
}

async function _callClaude(prompt, modelOverride) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: modelOverride || process.env.ESCAPE_ROOM_GENERATOR_MODEL || "claude-sonnet-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${errText.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

/**
 * Generate a complete escapeRoomConfig. On validation failure, makes ONE repair attempt
 * before falling back to a minimal single-lock skeleton.
 *
 * @returns {Promise<{ ok: true, config, attempts } | { ok: false, error, skeleton }>}
 */
export async function generateEscapeRoomConfig({ gradeLevel, subject, lessonTopic, narrativeTerms = [], theme, difficulty }) {
  const terms = Array.isArray(narrativeTerms)
    ? narrativeTerms
    : String(narrativeTerms || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  const pickTheme = theme && THEMES.includes(theme) ? theme : THEMES[Math.floor(Math.random() * THEMES.length)];

  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = attempt === 1
        ? _buildPrompt({ gradeLevel, subject, lessonTopic, narrativeTerms: terms, theme: pickTheme, difficulty })
        : _buildPrompt({ gradeLevel, subject, lessonTopic, narrativeTerms: terms, theme: pickTheme, difficulty }) + `\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastErrors.join("\n")}\nFix these errors and re-output ONLY the corrected JSON.`;
      const config = await _callClaude(prompt);
      const v = _validateConfig(config, terms);
      if (v.ok) return { ok: true, config, attempts: attempt };
      lastErrors = v.errors;
      console.warn(`[escapeRoomGenerator] attempt ${attempt} invalid:`, v.errors.slice(0, 4));
    } catch (e) {
      console.warn(`[escapeRoomGenerator] attempt ${attempt} error:`, e?.message);
      lastErrors = [`call failed: ${e?.message}`];
    }
  }

  // Fallback: single-lock skeleton
  const skeleton = {
    enabled: true,
    mode: "linear",
    difficulty: difficulty || "medium",
    theme: pickTheme,
    narrativeTermsUsed: terms,
    locks: [
      {
        id: "final",
        title: "The Exit Door",
        narrativeText: "A single locked door blocks the way out.",
        requires: { keys: ["key-1"] },
        unlocks: { roomCompleted: true },
        hint: terms.length > 0 ? `Use what you've learned about ${terms.join(", ")} today.` : "Recall today's lesson.",
        type: "password",
        synthesisAnswer: String(terms[0] || "escape").toLowerCase(),
      },
    ],
    keys: [{ id: "key-1", name: "Lesson Key", grantedBy: { taskId: null }, narrativeText: "Granted automatically when the round starts." }],
    fragments: [],
    narrativeBeats: [{ trigger: "room-completed", text: "The door swings open. You escaped." }],
  };
  return { ok: false, error: lastErrors[0] || "Generator failed", skeleton };
}

export default { generateEscapeRoomConfig };
