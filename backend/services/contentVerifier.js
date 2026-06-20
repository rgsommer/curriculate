// backend/services/contentVerifier.js
//
// Generation-time CONTENT verification for AI-generated tasks. This runs
// AFTER the structural validators (sanitize / normalize / validate /
// playability) succeed, and asks a second AI pass to check the task's
// FACTUAL and PEDAGOGICAL correctness — the class of issues structural
// rules can't catch (a real distractor with a wrong claim attached, a
// timeline item in the wrong era, a vennsort overlap-judgment edge case).
//
// Design intent:
//   - SOFT verification only. Returns warnings; never throws / rejects.
//   - Whitelist of 8 content-sensitive types. Other types skip the call.
//   - Per-content-hash cache so the same task isn't re-verified twice.
//   - Fails OPEN on infra errors — a flaky API never blocks a generation.
//   - Attaches results to task._contentWarnings for downstream UI / logs.

import OpenAI from "openai";
import crypto from "node:crypto";
import { TASK_TYPES } from "../../shared/taskTypes.js";

/* ============================================================
   Whitelist — only these types pay the verification cost.
   Picked from the audit-3/4 report's "content-judgment issues
   no structural rule could catch" category.
   ============================================================ */
export const CONTENT_VERIFY_TYPES = new Set([
  TASK_TYPES.MULTIPLE_CHOICE,
  TASK_TYPES.TRUE_FALSE,
  TASK_TYPES.SHORT_ANSWER,
  TASK_TYPES.TIMELINE,
  TASK_TYPES.LEGENDS,
  TASK_TYPES.FAKE_OUT,
  TASK_TYPES.VENNSORT,
  TASK_TYPES.TRUTH_OR_DARE,
]);

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[contentVerifier] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}

/* ============================================================
   Per-task-hash cache (in-process). Two generations of the
   "same" task (same type + same key content) reuse the result.
   ============================================================ */
const _cache = new Map();
const CACHE_MAX = 500;

function _contentHash(taskType, task) {
  const key = JSON.stringify(_keyContent(taskType, task));
  return crypto.createHash("sha256").update(`${taskType}:${key}`).digest("hex").slice(0, 32);
}

function _cacheGet(hash) { return _cache.get(hash); }
function _cacheSet(hash, value) {
  if (_cache.size >= CACHE_MAX) {
    // Drop oldest insertion. Map iteration is insertion-ordered.
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(hash, value);
}

/* ============================================================
   _keyContent(type, task)
   Per-type extraction of the FIELDS THAT AFFECT CORRECTNESS.
   Stable JSON for caching + the verification prompt body.
   ============================================================ */
function _keyContent(type, task) {
  const cfg = task?.config || {};
  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE:
    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE:
      return {
        title: task.title,
        items: (task.items || cfg.items || []).map((it) => ({
          prompt: it?.prompt,
          options: it?.options,
          correctAnswer: it?.correctAnswer,
        })),
      };
    case TASK_TYPES.TRUE_FALSE:
      return {
        title: task.title,
        items: (task.items || cfg.items || []).map((it) => ({
          prompt: it?.prompt,
          correctAnswer: it?.correctAnswer,
        })),
      };
    case TASK_TYPES.SHORT_ANSWER:
      return {
        title: task.title,
        prompt: task.prompt,
        items: (task.items || cfg.items || []).map((it) => ({
          prompt: it?.prompt,
          correctAnswer: it?.correctAnswer,
          acceptableAnswers: it?.acceptableAnswers,
        })),
        correctAnswer: task.correctAnswer,
        acceptableAnswers: task.acceptableAnswers,
      };
    case TASK_TYPES.TIMELINE: {
      const items =
        (cfg.items && cfg.items) ||
        (task.items && task.items.map((it) => (typeof it === "string" ? it : it.text))) ||
        [];
      return { title: task.title, items };
    }
    case TASK_TYPES.LEGENDS:
      return {
        title: task.title,
        figure: cfg.figure,
        facts: cfg.facts,
      };
    case TASK_TYPES.FAKE_OUT:
      return {
        title: task.title,
        rounds: (cfg.rounds || []).map((r) => ({
          prompt: r?.prompt,
          options: r?.options,
          correctIndex: r?.correctIndex,
          jokeOption: r?.jokeOption,
        })),
      };
    case TASK_TYPES.VENNSORT:
      return {
        title: task.title,
        categories: cfg.categories,
        items: cfg.items,
        correctAnswer: task.correctAnswer,
      };
    case TASK_TYPES.TRUTH_OR_DARE:
      return {
        title: task.title,
        seedChallenges: (cfg.seedChallenges || []).map((c) => ({
          type: c?.type,
          prompt: c?.prompt,
          acceptableAnswers: c?.acceptableAnswers,
          teacherHint: c?.teacherHint,
        })),
      };
    default:
      return { title: task.title, prompt: task.prompt };
  }
}

/* ============================================================
   Per-type verification PROMPTS. Each tells the verifier what
   to look for and how to report. Output is always the same
   structured-warning shape:
     { warnings: [{ field, severity, issue, suggestion }] }
   ============================================================ */
function _verifyPromptForType(type) {
  const TAIL =
    "Output JSON only: { warnings: [{ field, severity, issue, suggestion }] }. " +
    'severity is one of "minor" | "major" | "blocking". field is a path like ' +
    '"items[2].correctAnswer". issue is one short sentence describing what is wrong. ' +
    "suggestion is one short sentence proposing a fix. If there are no problems, " +
    "return { warnings: [] }. Do NOT flag stylistic preferences or write-better-prompt " +
    "tweaks — only flag FACTUAL or PEDAGOGICAL correctness issues. Be conservative: " +
    "if you are not sure something is wrong, do not flag it.";

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE:
    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE:
      return (
        "You are checking a multiple-choice quiz for factual correctness. " +
        "For each item: (1) verify that options[correctAnswer] is factually correct " +
        "for the prompt. (2) verify that none of the OTHER options are ALSO correct " +
        "for the prompt (ambiguous answers). (3) flag any distractor that contains a " +
        "false factual claim attached to a real noun (e.g. 'Battle of New Orleans " +
        "inspired the Star-Spangled Banner' — battle is real but the claim is false). " +
        "Anachronistic distractors (figures from a different century) are MINOR not " +
        "blocking. " + TAIL
      );
    case TASK_TYPES.TRUE_FALSE:
      return (
        "You are checking a true/false quiz for factual correctness. For each item: " +
        "verify that the marked correctAnswer (1=true, 0=false) matches the factual " +
        "truth of the statement. Flag any item whose answer is keyed wrong. Flag any " +
        "statement whose truth value depends on definitional ambiguity (e.g. 'every " +
        "fraction can be written as a decimal' — true for terminating, false for " +
        "irrationals if the prompt is read literally). " + TAIL
      );
    case TASK_TYPES.SHORT_ANSWER:
      return (
        "You are checking a short-answer quiz. For each item: verify that the stored " +
        "correctAnswer is FACTUALLY correct AND that the prompt admits ONLY that " +
        "answer (or that acceptableAnswers covers other defensible answers). The " +
        "biggest failure mode: an open-ended prompt with ONE locked canonical answer " +
        "— a student giving a different correct answer would be marked wrong. Flag " +
        "such prompts as BLOCKING with the suggestion to add an acceptableAnswers " +
        "array. " + TAIL
      );
    case TASK_TYPES.TIMELINE:
      return (
        "You are checking a chronological timeline. Verify that the items, in their " +
        "current order, are in TRUE chronological order. BCE dates run BACKWARDS " +
        "(1259 BCE is AFTER 1750 BCE). Flag any pair of adjacent items where the " +
        "later-listed one actually came FIRST historically. If 2+ items are out of " +
        "order, severity is BLOCKING. " + TAIL
      );
    case TASK_TYPES.LEGENDS:
      return (
        "You are checking a 'Legends' deduction game. Verify (1) every category-" +
        "labeled fact ('what', 'where', 'why', 'when') is actually TRUE about the " +
        "figure config.figure.name. (2) every 'decoy'-labeled fact is FALSE about " +
        "the figure (decoys may be true of an ADJACENT figure in the same era, but " +
        "must be false of THIS one). A decoy that's accidentally true about the " +
        "legend is BLOCKING — it breaks the sorting key. " + TAIL
      );
    case TASK_TYPES.FAKE_OUT:
      return (
        "You are checking a Fake-Out (Balderdash-style) game. For each round: " +
        "(1) verify options[correctIndex] is the factually correct answer to the " +
        "prompt. (2) check that the 2 non-correct distractor options don't attach " +
        "FALSE facts to real things (e.g. 'Battle of New Orleans inspired the " +
        "Star-Spangled Banner' is BLOCKING — Star-Spangled Banner was Fort McHenry). " +
        "Distractors should be real things that are simply wrong for THIS prompt, " +
        "not invented facts. " + TAIL
      );
    case TASK_TYPES.VENNSORT:
      return (
        "You are checking a 2-circle Venn sort. The two categories are config.categories. " +
        "For each item in config.items, verify its categories assignment is " +
        "DEFENSIBLE under standard grade-level usage. Specifically: items in [A,B] " +
        "(the overlap) must be genuinely concepts in BOTH categories; items in [A] " +
        "only must NOT be defensibly classifiable as B. The biggest failure mode: " +
        "an item whose conventional grade-level classification is overlap but the " +
        "key puts it in A-only or B-only. Flag those as MAJOR. " + TAIL
      );
    case TASK_TYPES.TRUTH_OR_DARE:
      return (
        "You are checking Truth-or-Dare seed challenges. For each 'truth'-type " +
        "challenge: (1) verify the asked-for answer is factually correct (DON'T let " +
        "a challenge ask students to defend a known-false claim like '0.333... is " +
        "not equal to 1/3'). (2) for 'name N ways' / 'list N methods' prompts, " +
        "check that acceptableAnswers contains N genuinely DIFFERENT methods, not " +
        "rephrasings of the same one. Flag false-claim challenges as BLOCKING. " +
        TAIL
      );
    default:
      return null;
  }
}

const VERIFIER_RESPONSE_SCHEMA = {
  type: "object",
  required: ["warnings"],
  properties: {
    warnings: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "severity", "issue", "suggestion"],
        properties: {
          field: { type: "string" },
          severity: { enum: ["minor", "major", "blocking"] },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

/**
 * Verify a task's content. Returns { ok, warnings, fromCache, skipped }.
 * Soft-failing — always resolves, never throws.
 *
 * opts.model — override the gpt-4o-mini default for high-stakes types.
 * opts.timeoutMs — abort after N ms (default 12000).
 */
export async function verifyTaskContent(task, opts = {}) {
  const type = task?.taskType;
  if (!type) {
    return { ok: true, warnings: [], skipped: "no-task-type" };
  }
  if (!CONTENT_VERIFY_TYPES.has(type)) {
    return { ok: true, warnings: [], skipped: "type-not-verified" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { ok: true, warnings: [], skipped: "no-api-key" };
  }
  if (process.env.SKIP_CONTENT_VERIFY === "1") {
    return { ok: true, warnings: [], skipped: "env-flag" };
  }

  const hash = _contentHash(type, task);
  const cached = _cacheGet(hash);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const prompt = _verifyPromptForType(type);
  if (!prompt) {
    return { ok: true, warnings: [], skipped: "no-prompt-for-type" };
  }

  const keyContent = _keyContent(type, task);
  const userMsg = `Task to verify (type: ${type}):\n\n${JSON.stringify(keyContent, null, 2)}`;
  const model = opts.model || "gpt-4o-mini";
  const timeoutMs = opts.timeoutMs || 12000;

  try {
    const client = getClient();
    const completion = await Promise.race([
      client.chat.completions.create({
        model,
        temperature: 0.1, // verification is a fact-checking task — keep it deterministic
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userMsg },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`verifier-timeout-${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { warnings: [] };
    }
    const warnings = Array.isArray(parsed?.warnings)
      ? parsed.warnings
          .filter((w) => w && typeof w === "object")
          .map((w) => ({
            field: String(w.field || "").slice(0, 120),
            severity: ["minor", "major", "blocking"].includes(w.severity) ? w.severity : "minor",
            issue: String(w.issue || "").slice(0, 280),
            suggestion: String(w.suggestion || "").slice(0, 280),
          }))
      : [];

    const result = { ok: true, warnings };
    _cacheSet(hash, result);
    return result;
  } catch (err) {
    // Fail OPEN — the verifier never blocks generation.
    console.warn(`[contentVerifier] ${type} verification failed:`, err?.message);
    return { ok: true, warnings: [], skipped: "verifier-error", error: String(err?.message || err) };
  }
}

/** Convenience helper for diagnostics — clear the in-process cache. */
export function clearVerifierCache() {
  _cache.clear();
}
