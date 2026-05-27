// backend/controllers/mainTasksetController.js
import TaskSet from "../models/TaskSet.js";
import TaskDiagnosticLog from "../models/TaskDiagnosticLog.js";
import TeacherProfile from "../models/TeacherProfile.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META, detectSubjectBucket, getSubjectAffinity } from "../../shared/taskTypes.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { normalizeTaskByType } from "../validators/taskValidators.js";
import {
  normalizeSelectedType,
  extractJsonFromText,
  assertValidAiTask,
  retryMustHave,
  buildVocabularyLines,
  regenerateSingleTask,
  buildPeerEditingErrors,
} from "./sharedTasksetController.js";
import { buildTasksetPrompt } from "./sharedTasksetController.js";
import { getTimingStatsForGenerator } from "../services/taskTypeTimingAggregator.js";
import { sanitizeTaskShapeByType } from "./sanitizeTaskShape.js";

// ---------------- Validators (AI output hardening) ----------------
// NOTE: strict AI-output hardening and normalizeSelectedType now live in sharedTasksetController.js.
// This controller keeps the higher-level orchestration and taskset persistence.
// ------------------------------------------------------------------

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[mainTasksetController] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}
const client = new Proxy({}, { get: (_, prop) => getClient()[prop] });

// Build a list of implemented task types that are safe to GENERATE.
// Eligibility here is about generation safety, not scoring.
/**
 * Build an N-slot task type pool with enforced variety:
 * - Guaranteed types are placed first (one slot each, shuffled)
 * - A physical/movement task every 4–5 academic slots
 * - No more than 2 consecutive tasks from the same category
 * - Unique types preferred (no repeats until the full set is exhausted)
 */
function buildDiversePool(availableTypes, count, guaranteedTypes = [], diversityMins = {}, subjectBucket = "general") {
  // diversityMins: { minInterTeam: 1, minIntraTeam: 1, minOffTablet: 2 }
  const { minInterTeam = 0, minIntraTeam = 0, minOffTablet = 0 } = diversityMins;

  const PHYSICAL_BODY_BREAK_TYPES = new Set([
    TASK_TYPES.BODY_BREAK,
    TASK_TYPES.MAD_DASH,
    TASK_TYPES.MAD_DASH_SEQUENCE,
  ]);

  const metaOf = (t) => TASK_TYPE_META?.[t] || {};
  const catOf = (t) => String(metaOf(t).category || "other").toLowerCase();

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // ── Step 1: Start with ALL guaranteed types (bypass subject affinity) ──
  // Teacher explicitly chose these — they go in unconditionally regardless
  // of whether they fit the subject.  Affinity only governs filler slots.
  const uniqueGuaranteed = [...new Set(guaranteedTypes)];

  // If there are more guaranteed types than slots, expand count to fit them all.
  // The teacher explicitly requested these types — we must not silently drop any.
  if (uniqueGuaranteed.length > count) {
    console.log(`[AI] Expanding pool from ${count} to ${uniqueGuaranteed.length} to fit all guaranteed types`);
    count = uniqueGuaranteed.length;
  }

  const pool = shuffle([...uniqueGuaranteed]);
  const inPool = new Set(pool);

  if (pool.length >= count) {
    console.log(`[AI] Guaranteed types fill the pool (${uniqueGuaranteed.length} guaranteed, ${count} slots)`);
  }

  // ── Step 1b: Enforce diversity minimums ──
  // Before general filling, inject types needed to meet inter-team / intra-team / off-tablet minimums.
  // Only draw from availableTypes not already in pool.
  const diversityNeeds = [
    { label: "inter-team", min: minInterTeam, test: (t) => !!metaOf(t).interTeamEnabled },
    { label: "intra-team", min: minIntraTeam, test: (t) => !!metaOf(t).intraTeamEnabled },
    { label: "off-tablet", min: minOffTablet, test: (t) => !!metaOf(t).isOffTablet },
  ];

  for (const need of diversityNeeds) {
    if (need.min <= 0) continue;
    const alreadyHave = pool.filter(need.test).length;
    let deficit = need.min - alreadyHave;
    if (deficit <= 0) continue;

    const candidates = shuffle(availableTypes.filter((t) => !inPool.has(t) && need.test(t)));
    for (const t of candidates) {
      if (deficit <= 0 || pool.length >= count) break;
      pool.push(t);
      inPool.add(t);
      deficit--;
    }
    if (deficit > 0) {
      console.warn(`[AI] Could only satisfy ${need.min - deficit}/${need.min} ${need.label} minimum (not enough eligible types in pool)`);
    } else {
      console.log(`[AI] Diversity: injected ${need.min - alreadyHave} ${need.label} type(s) to meet minimum of ${need.min}`);
    }
  }

  // ── Step 2: Fill remaining slots with diverse non-guaranteed types ──
  //    Uses subject affinity to prefer types that fit the subject.
  if (pool.length < count) {
    const remaining = count - pool.length;
    const fillerTypes = availableTypes.filter((t) => !inPool.has(t));
    const physicalFillers = fillerTypes.filter((t) => PHYSICAL_BODY_BREAK_TYPES.has(t));
    const academicFillers = fillerTypes.filter((t) => !PHYSICAL_BODY_BREAK_TYPES.has(t));

    shuffle(physicalFillers);

    // Weighted-random sort: score = affinity(type, subject) * random().
    // Higher-affinity types land near the front more often, but low-affinity
    // types can still appear (keeps variety).  Types with affinity 0 are excluded.
    const scoredAcademic = academicFillers
      .map((t) => {
        const aff = getSubjectAffinity(t, subjectBucket);
        return { type: t, score: aff * (0.3 + Math.random() * 0.7), aff };
      })
      .filter((e) => e.aff > 0)
      .sort((a, b) => b.score - a.score);

    // Build academic queue — ensure category diversity within the weighted order
    // by skipping types whose category already appeared in the last 2 picks.
    const academicQueue = [];
    const usedTypes = new Set();
    const recentCats = [];

    for (const entry of scoredAcademic) {
      if (academicQueue.length >= remaining * 2) break;
      if (usedTypes.has(entry.type)) continue;
      const cat = catOf(entry.type);
      // Allow if category hasn't appeared in last 2 picks (soft diversity)
      if (recentCats.length >= 2 && recentCats[recentCats.length - 1] === cat && recentCats[recentCats.length - 2] === cat) continue;
      academicQueue.push(entry.type);
      usedTypes.add(entry.type);
      recentCats.push(cat);
    }

    // If we still need more, do a second pass without the category constraint
    if (academicQueue.length < remaining * 2) {
      for (const entry of scoredAcademic) {
        if (academicQueue.length >= remaining * 2) break;
        if (usedTypes.has(entry.type)) continue;
        academicQueue.push(entry.type);
        usedTypes.add(entry.type);
      }
    }

    console.log(`[AI] Subject bucket: "${subjectBucket}" — top filler affinities: ${scoredAcademic.slice(0, 5).map(e => `${e.type}(${e.aff})`).join(", ")}`);

    // Interleave physical breaks every 4–5 academic tasks
    let academicSincePhysical = 0;
    let physIdx = 0;
    let acaIdx = 0;
    const physicalInterval = 5;

    for (let i = 0; i < remaining; i++) {
      if (
        academicSincePhysical >= physicalInterval - 1 &&
        physicalFillers.length > 0 &&
        i < remaining - 1
      ) {
        pool.push(physicalFillers[physIdx % physicalFillers.length]);
        physIdx++;
        academicSincePhysical = 0;
      } else if (acaIdx < academicQueue.length) {
        pool.push(academicQueue[acaIdx]);
        acaIdx++;
        academicSincePhysical++;
      } else if (physicalFillers.length > 0) {
        pool.push(physicalFillers[physIdx % physicalFillers.length]);
        physIdx++;
        academicSincePhysical = 0;
      } else {
        pool.push(fillerTypes[i % Math.max(1, fillerTypes.length)]);
      }
    }

    console.log(`[AI] ${uniqueGuaranteed.length} guaranteed + ${remaining} fillers = ${pool.length} slots`);
  }

  // ── Step 3: Avoid 3+ consecutive same-category (swap if needed) ──
  for (let i = 2; i < pool.length; i++) {
    if (catOf(pool[i]) === catOf(pool[i - 1]) && catOf(pool[i]) === catOf(pool[i - 2])) {
      for (let j = i + 1; j < pool.length; j++) {
        if (catOf(pool[j]) !== catOf(pool[i])) {
          [pool[i], pool[j]] = [pool[j], pool[i]];
          break;
        }
      }
    }
  }

  // ── Step 4: Log diversity audit ──
  const interCount = pool.filter((t) => !!metaOf(t).interTeamEnabled).length;
  const intraCount = pool.filter((t) => !!metaOf(t).intraTeamEnabled).length;
  const offTabCount = pool.filter((t) => !!metaOf(t).isOffTablet).length;
  console.log(`[AI] Diversity audit: ${interCount} inter-team, ${intraCount} intra-team, ${offTabCount} off-tablet out of ${pool.length} tasks`);

  console.log(`[AI] Built diverse pool (${count} slots):`, pool.map((t) => `${t} [${catOf(t)}]`).join(", "));
  return pool;
}

const LANGUAGE_SUBJECTS = /\b(french|spanish|english|esl|efl|eal|fsl|german|italian|portuguese|mandarin|chinese|japanese|korean|arabic|hindi|language|linguistics|vocabulary|grammar|reading|writing|literacy|phonics|pronunciation|immersion)\b/i;

function getGenerationEligibleTypes(subject) {
  const isLanguage = subject ? LANGUAGE_SUBJECTS.test(String(subject)) : false;
  const eligible = [];

  for (const t of Object.values(TASK_TYPES)) {
    const meta = TASK_TYPE_META?.[t];

    // only implemented types that are marked generator-eligible
    if (!meta || meta.implemented === false) continue;
    if (meta.generatorEligible === false) continue;

    // avoid special meta-only types unless you explicitly want them
    if (t === TASK_TYPES.TASK_RUNNER) continue;

    // profile-injected types are added separately based on teacher profile toggles
    if (meta.profileInjectedOnly) continue;

    // language-only tasks (pronunciation, speech recognition) excluded for non-language subjects
    if (meta.languageOnly && !isLanguage) continue;

    eligible.push(t);
  }

  // Shuffle so each generation gets a different mix of types
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  return eligible;
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}


// ------------------------------------------------------------
// ============================================================
//  POST-GENERATION AI REVIEW
//  One final holistic pass over the entire taskset. The AI checks
//  for cross-task issues (ambiguous sequences, wrong task type for
//  content, missing required fields, duplicate questions, etc.)
//  and returns a corrected JSON array.
// ============================================================
async function postGenerationReview(tasks, { subject, gradeLevel, sendSSE }) {
  if (!tasks || tasks.length === 0) return tasks;
  try {
    const client = getClient();

    // Build a concise representation — strip heavy fields the reviewer doesn't need
    const slim = tasks.map((t, i) => {
      const { aiMetadata, isPublic, requiresDrawing, ...rest } = t || {};
      return { _index: i, ...rest };
    });

    const prompt = `You are a task-set quality reviewer for an educational platform called Curriculate.

SUBJECT: ${subject || "General"}
GRADE LEVEL: ${gradeLevel || "Unknown"}

Below is a JSON array of ${tasks.length} AI-generated tasks. Review each task and fix any issues you find.

COMMON ISSUES TO CHECK:
1. FAKE_OUT: must have EXACTLY 3 options per round (not 4). correctIndex and jokeIndex must be valid.
2. PET_FEEDING: must have "goodFoods" (6-8 true statements) and "badFoods" (6-8 false statements) at ROOT level.
3. BODY_BREAK / MOTION_MISSION: must have "movement": true.
4. SEQUENCE / TIMELINE: every item must have ONE clearly correct position — no ambiguous or overlapping ordering.
5. VENNSORT: minimum 7 items, at least 2 items per category, item text under 60 chars.
6. MULTIPLE_CHOICE: vary correctAnswer positions — don't put the answer in the same slot for every question.
7. HANGMAN_DUEL: words must be pure alphabetic (A-Z only), 3-14 characters.
8. COLLABORATION: should only have title + prompt (no config.roles — that's role-play-deck).
9. ALL TASKS: must have non-empty "title" and "prompt" strings.
10. Cross-task: no duplicate questions across different tasks. Content should be varied.

RULES:
- Return ONLY a JSON array (no markdown, no commentary).
- Preserve the same number of tasks in the same order.
- If a task is fine, return it unchanged.
- If a task has issues, fix them in-place.
- Do NOT add new tasks or remove tasks.
- Do NOT change taskType unless it's clearly wrong for the content.
- Keep fixes minimal and targeted — don't rewrite content that's already good.

TASKS:
${JSON.stringify(slim, null, 2)}`;

    if (typeof sendSSE === "function") {
      sendSSE({ type: "phase", phase: "review", message: "Final quality review…" });
    }

    const tokenBudget = Math.min(16384, Math.max(4096, tasks.length * 500));
    const request = {
      model: process.env.AI_REVIEW_MODEL || process.env.AI_MODEL || "gpt-4.1-mini",
      temperature: 0.1, // low temperature for reliable fixes
      max_completion_tokens: tokenBudget,
      messages: [{ role: "user", content: prompt }],
    };
    if (!process.env.AI_DISABLE_JSON_RESPONSE_FORMAT) {
      request.response_format = { type: "json_object" };
    }

    const completion = await client.chat.completions.create(request);
    const raw = completion.choices?.[0]?.message?.content?.trim() || "";
    const parsed = extractJsonFromText(raw);

    if (!parsed) {
      console.warn("[PostReview] Could not parse AI response — keeping original tasks.");
      return tasks;
    }

    // The AI might return { tasks: [...] } or just [...]
    const reviewed = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tasks) ? parsed.tasks : null;
    if (!reviewed || reviewed.length !== tasks.length) {
      console.warn(`[PostReview] AI returned ${reviewed?.length ?? "null"} tasks (expected ${tasks.length}) — keeping originals.`);
      return tasks;
    }

    // Merge reviewed tasks back: re-run sanitizer on each, keep original if review broke it
    let fixCount = 0;
    const merged = tasks.map((original, i) => {
      const rev = reviewed[i];
      if (!rev || typeof rev !== "object") return original;
      // Strip the _index helper we added
      const { _index, ...cleaned } = rev;
      // Ensure taskType didn't change unexpectedly
      if (cleaned.taskType && cleaned.taskType !== original.taskType) {
        console.warn(`[PostReview] Task ${i}: taskType changed from "${original.taskType}" to "${cleaned.taskType}" — keeping original type.`);
        cleaned.taskType = original.taskType;
      }
      // Quick diff: did the review actually change anything?
      const origStr = JSON.stringify(original);
      const revStr = JSON.stringify(cleaned);
      if (origStr === revStr) return original; // no change

      fixCount++;
      // Re-run sanitizer on the reviewed task
      const type = normalizeSelectedType(cleaned.taskType || original.taskType) || original.taskType;
      const sanitized = sanitizeTaskShapeByType(type, cleaned);

      // GUARDRAIL: the reviewer sometimes drops type-specific structured fields
      // it doesn't understand (e.g. peer-editing errors[], a deck's items[]),
      // which would ship a broken task. Never let the review make a task WORSE:
      // if the original was playable and the reviewed version isn't, keep the
      // original.
      try {
        const origOk = assessTaskPlayability(original).playable !== false;
        const revOk = assessTaskPlayability(sanitized).playable !== false;
        if (origOk && !revOk) {
          console.warn(`[PostReview] Task ${i} (${type}) became unplayable after review (likely dropped a required field) — keeping original.`);
          fixCount--;
          return original;
        }
      } catch { /* if the check throws, fall through to the reviewed task */ }

      return sanitized;
    });

    if (fixCount > 0) {
      console.log(`[PostReview] Applied fixes to ${fixCount}/${tasks.length} tasks.`);
    } else {
      console.log(`[PostReview] All ${tasks.length} tasks passed review — no changes.`);
    }

    return merged;
  } catch (err) {
    console.error("[PostReview] Review failed — keeping original tasks:", err?.message || err);
    return tasks; // never break generation if review fails
  }
}

// sanitizeTaskShapeByType is now imported from ./sanitizeTaskShape.js (canonical single source)


function sortConfigIsValid(cfg) {
  const buckets = Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  return buckets.length >= 2 && items.length >= 3;
}

// Ensure each bucket has at least one *correctly assigned* item.
// Prevents cases like: Continents/Not Continents but all items are Continents.
function sortHasAtLeastOnePerBucket(cfg) {
  const buckets = Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  const items = Array.isArray(cfg?.items) ? cfg.items : [];

  if (!buckets.length || !items.length) return false;

  const found = new Set();
  for (const it of items) {
    const bi = Number(it?.bucketIndex);
    if (Number.isInteger(bi) && bi >= 0 && bi < buckets.length) {
      found.add(bi);
    }
  }
  return found.size >= buckets.length;
}

function sequenceConfigIsValid(cfg) {
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  return items.length >= 3;
}

function asNonEmptyString(v) {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : "";
  }
  if (v == null) return "";
  const s = String(v).trim();
  return s ? s : "";
}

function bucketLabelFromAny(b) {
  if (typeof b === "string") return asNonEmptyString(b);
  if (b && typeof b === "object") {
    return (
      asNonEmptyString(b.label) ||
      asNonEmptyString(b.name) ||
      asNonEmptyString(b.title) ||
      asNonEmptyString(b.text) ||
      asNonEmptyString(b.value) ||
      asNonEmptyString(b.id)
    );
  }
  return "";
}

function itemTextFromAny(it, fallbackIdx = 0) {
  if (typeof it === "string") return asNonEmptyString(it);
  if (it && typeof it === "object") {
    return (
      asNonEmptyString(it.text) ||
      asNonEmptyString(it.label) ||
      asNonEmptyString(it.title) ||
      asNonEmptyString(it.prompt) ||
      asNonEmptyString(it.value) ||
      asNonEmptyString(it.term) ||
      `Item ${fallbackIdx + 1}`
    );
  }
  return `Item ${fallbackIdx + 1}`;
}

function coerceBucketIndex(ref, buckets) {
  // returns number | null
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 0 && n < buckets.length) return n;

  // ref is string label/id
  const s = asNonEmptyString(ref);
  if (s) {
    const needle = s.toLowerCase();
    const idx = buckets.findIndex((b) => {
      const hay = String(b || "").toLowerCase();
      return hay === needle || hay.includes(needle) || needle.includes(hay);
    });
    if (idx >= 0) return idx;
  }

  // ref is object containing label/id
  if (ref && typeof ref === "object") {
    const key =
      asNonEmptyString(ref.label) ||
      asNonEmptyString(ref.name) ||
      asNonEmptyString(ref.title) ||
      asNonEmptyString(ref.text) ||
      asNonEmptyString(ref.value) ||
      asNonEmptyString(ref.id);

    if (key) {
      const idx = buckets.findIndex((b) => b.toLowerCase() === key.toLowerCase());
      if (idx >= 0) return idx;
    }
  }

  return null;
}

function flattenSortConfig(task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  // Accept legacy / AI variants
  const rawBuckets =
    (Array.isArray(cfg.buckets) && cfg.buckets) ||
    (Array.isArray(cfg.categories) && cfg.categories) ||
    (Array.isArray(task?.buckets) && task.buckets) ||
    (Array.isArray(task?.categories) && task.categories) ||
    [];

  const buckets = rawBuckets
    .map(bucketLabelFromAny)
    .map((s) => s.trim())
    // Reject stringified objects — these are lost labels that would show as "[object Object]"
    .filter((s) => s && s !== "[object Object]" && !s.startsWith("[object "));

  const rawItems =
    (Array.isArray(cfg.items) && cfg.items) ||
    (Array.isArray(cfg.sortItems) && cfg.sortItems) ||
    (Array.isArray(task?.items) && task.items) ||
    (Array.isArray(task?.sortItems) && task.sortItems) ||
    [];

  const items = rawItems
    .map((it, idx) => {
      const text = itemTextFromAny(it, idx);

      // bucketIndex may be directly provided
      let bi = null;
      if (it && typeof it === "object") {
        if (Number.isInteger(it.bucketIndex)) bi = it.bucketIndex;
        else if (Number.isInteger(it.bucket)) bi = it.bucket;
      }

      // otherwise map from label/id/etc
      if (bi == null && buckets.length) {
        const ref =
          (it &&
            typeof it === "object" &&
            (it.bucketLabel ?? it.category ?? it.bucketName ?? it.bucketId ?? it.bucket)) ||
          null;
        bi = coerceBucketIndex(ref, buckets);
      }

      // clamp or null
      if (!Number.isInteger(bi) || bi < 0 || bi >= buckets.length) bi = null;

      return { text, bucketIndex: bi };
    })
    .filter((x) => asNonEmptyString(x?.text));

  return {
    ...task,
    config: {
      ...(cfg || {}),
      buckets,
      items,
    },
  };
}

function flattenSequenceConfig(task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const raw =
    (Array.isArray(cfg.items) && cfg.items) ||
    (Array.isArray(task?.items) && task.items) ||
    (Array.isArray(cfg.steps) && cfg.steps) ||
    (Array.isArray(task?.steps) && task.steps) ||
    (Array.isArray(cfg.events) && cfg.events) ||
    (Array.isArray(task?.events) && task.events) ||
    [];

  const items = raw
    .map((it, idx) => itemTextFromAny(it, idx))
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ...task,
    config: {
      ...(cfg || {}),
      items,
    },
  };
}

function matchingIsValid(task) {
  // support either legacy config.pairs OR left/right items + correctMatches
  if (Array.isArray(task?.config?.pairs) && task.config.pairs.length >= 4) return true;

  const left = Array.isArray(task?.leftItems) ? task.leftItems : [];
  const right = Array.isArray(task?.rightItems) ? task.rightItems : [];
  const cm = task?.correctMatches && typeof task.correctMatches === "object" ? task.correctMatches : null;
  if (left.length < 5 || right.length < 5 || !cm) return false;

  // Reject if ANY item looks like a generic placeholder (e.g. "Left 1", "Term 3", "Definition 2")
  // Previously checked "every" which let tasks through if even one item had real text.
  const isPlaceholder = (text) => /^(left|right|term|definition|item|word|concept|option|key\s*term|match)\s*\d+$/i.test(String(text || "").trim());
  const leftTexts = left.map((x) => (typeof x === "object" ? (x?.text || x?.label) : x) || "");
  const rightTexts = right.map((x) => (typeof x === "object" ? (x?.text || x?.label) : x) || "");
  const anyLeftPlaceholder = leftTexts.some(isPlaceholder);
  const anyRightPlaceholder = rightTexts.some(isPlaceholder);
  if (anyLeftPlaceholder || anyRightPlaceholder) return false;

  return true;
}

function vennSortIsValid(task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const cats = Array.isArray(cfg.categories) ? cfg.categories : [];
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const ca = task?.correctAnswer && typeof task.correctAnswer === "object" ? task.correctAnswer : null;
  return cats.length >= 2 && items.length >= 5 && !!ca;
}

function flashcardsIsValid(task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  return items.length >= 5;
}

function jeopIsValid(task) {
  const clues = Array.isArray(task?.clues) ? task.clues : [];
  if (clues.length < 3) return false;

  // Reject if correctAnswer is purely numeric / a calculation result
  // (e.g. "42", "$10.00", "14.99%"). BrainBlitz answers must be shout-able words.
  const answer = String(task?.correctAnswer || task?.config?.correctAnswer || "").trim();
  if (answer && /^[\$%€£]?\d[\d.,\s/$%€£]*$/.test(answer)) return false;

  return true;
}

function hangmanIsValid(task) {
  const w = Array.isArray(task?.wordsByStation) ? task.wordsByStation : [];
  return w.length >= 4 && w.every((x) => isNonEmptyString(x?.word) && isNonEmptyString(x?.hint));
}

// Finalize a task: normalize by type + small hardening checks
function finalizeTask(expectedType, rawTask) {
  const forced = { ...(rawTask || {}), taskType: expectedType };

  // Flatten AI-rich objects into the editor's expected simple shapes
  // so the editor doesn't render [object Object].
  if (expectedType === TASK_TYPES.SORT) {
    Object.assign(forced, flattenSortConfig(forced));
  }
  if (expectedType === TASK_TYPES.SEQUENCE) {
    Object.assign(forced, flattenSequenceConfig(forced));
  }

  // No fillers: do NOT invent title/prompt/settings here.
  // If required fields are missing, validation must fail and the controller must regenerate.
  let normalized = normalizeTaskByType(expectedType, forced);

  // Sanitize known drift (e.g., MC config.items) before strict validation
  normalized = sanitizeTaskShapeByType(expectedType, normalized);

  // GUARDRAIL: Check for quality issues flagged during normalization
  if (normalized._validationError) {
    const errMsg = normalized._validationError;
    delete normalized._validationError;
    throw new Error(`[Quality Guardrail] ${errMsg}`);
  }
  if (normalized._validationWarning) {
    console.warn(`[Quality Guardrail] ${expectedType}: ${normalized._validationWarning}`);
    delete normalized._validationWarning;
  }

  // Validate by type (strict)
  assertValidAiTask(expectedType, normalized);

  // Additional "sanity" checks for a few types that frequently poison
  if (expectedType === TASK_TYPES.SORT) {
    if (!sortConfigIsValid(normalized?.config) || !sortHasAtLeastOnePerBucket(normalized?.config)) {
      throw new Error("SORT failed extra sanity checks (buckets/items distribution).");
    }
  }
  if (expectedType === TASK_TYPES.SEQUENCE) {
    if (!sequenceConfigIsValid(normalized?.config)) throw new Error("SEQUENCE failed extra sanity checks.");
  }
  if (expectedType === TASK_TYPES.MATCHING) {
    if (!matchingIsValid(normalized)) throw new Error("MATCHING failed extra sanity checks.");
  }
  if (expectedType === TASK_TYPES.VENNSORT) {
    if (!vennSortIsValid(normalized)) throw new Error("VENNSORT failed extra sanity checks.");
  }
  if (expectedType === TASK_TYPES.FLASHCARDS || expectedType === TASK_TYPES.FLASHCARDS_RACE) {
    if (!flashcardsIsValid(normalized)) throw new Error("FLASHCARDS failed extra sanity checks.");
  }
  if (expectedType === TASK_TYPES.JEOPARDY) {
    if (!jeopIsValid(normalized)) throw new Error("JEOPARDY failed extra sanity checks.");
  }
  if (expectedType === TASK_TYPES.HANGMAN_DUEL) {
    if (!hangmanIsValid(normalized)) throw new Error("HANGMAN_DUEL failed extra sanity checks.");
  }
  
  // ✅ Playability hardening (runtime-viable, not just schema-valid)
  const play = assessTaskPlayability(normalized);
  if (!play.playable) {
    throw new Error(`AI task not playable for ${expectedType}: ${play.issues.join("; ")}`);
  }

  // Ensure timeLimitSeconds is set (drives the countdown bar on student view)
  if (typeof normalized.timeLimitSeconds !== "number" || normalized.timeLimitSeconds <= 0) {
    const t = (expectedType || "").toLowerCase();
    if (t.includes("choice") || t.includes("true-false") || t.includes("flashcard")) {
      normalized.timeLimitSeconds = 60;
    } else if (t.includes("open") || t.includes("text") || t.includes("record")) {
      normalized.timeLimitSeconds = 150;
    } else if (t.includes("sequence") || t.includes("sort") || t.includes("matching") || t.includes("timeline")) {
      normalized.timeLimitSeconds = 120;
    } else if (t.includes("body") || t.includes("motion") || t.includes("draw-mime")) {
      normalized.timeLimitSeconds = 75;
    } else if (t.includes("reading")) {
      normalized.timeLimitSeconds = 180;
    } else {
      normalized.timeLimitSeconds = 90;
    }
  }

  // Enforce minimum time floors for writing-heavy / performance task types.
  // The AI often defaults everything to 90s which is far too short for extended responses.
  const TIME_FLOORS = {
    [TASK_TYPES.LETTER]: 240,
    [TASK_TYPES.CASE_STUDY]: 240,
    [TASK_TYPES.OPEN_TEXT]: 150,
    [TASK_TYPES.SCRIPT_PLAY]: 180,
    [TASK_TYPES.ROLE_PLAY_DECK]: 180,
    [TASK_TYPES.NARRATION_SYNTHESIZE]: 180,
    [TASK_TYPES.READING_COMP]: 180,
    [TASK_TYPES.COLLABORATION]: 150,
    [TASK_TYPES.LIVE_DEBATE]: 180,
  };
  const floor = TIME_FLOORS[expectedType];
  if (floor && normalized.timeLimitSeconds < floor) {
    normalized.timeLimitSeconds = floor;
  }

  // Ensure points default
  if (typeof normalized.points !== "number" || normalized.points <= 0) {
    normalized.points = 10;
  }

  return normalized;
}

/**
 * Attempt to recover a valid tasks array from a truncated JSON string.
 * E.g. the AI returned `{"tasks":[{...},{...},{` — we strip the
 * incomplete trailing object and close the array/object.
 */
function _repairTruncatedJson(raw) {
  try {
    // Find the "tasks" array opening
    const tasksIdx = raw.indexOf('"tasks"');
    if (tasksIdx === -1) return null;
    const bracketIdx = raw.indexOf("[", tasksIdx);
    if (bracketIdx === -1) return null;

    // Walk backwards from end to find the last complete object (ending with })
    let lastClose = raw.lastIndexOf("}");
    while (lastClose > bracketIdx) {
      // Try closing the array and outer object at this point
      const attempt = raw.slice(0, lastClose + 1) + "]}";
      try {
        const parsed = JSON.parse(attempt);
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
          console.log(`[AI] JSON repair succeeded — salvaged ${parsed.tasks.length} task(s).`);
          return parsed;
        }
      } catch { /* keep searching */ }
      lastClose = raw.lastIndexOf("}", lastClose - 1);
    }
    return null;
  } catch {
    return null;
  }
}

async function generateTasksArray({
  typePool,
  count,
  subject,
  gradeLevel,
  difficulty,
  learningGoal,
  topicLabel,
  vocabularyLines,
  specialConsiderations,
  timingContext = "",
  temperature = 0.4,
}) {
  const prompt = buildTasksetPrompt(
    typePool,
    count,
    subject,
    gradeLevel,
    difficulty,
    learningGoal,
    topicLabel,
    vocabularyLines,
    specialConsiderations,
    timingContext
  );

  // Use the more capable batch model for initial generation (complex multi-task schema).
  // Falls back to AI_MODEL, then gpt-4.1-mini.
  // Scale token budget with task count so large sets don't truncate.
  const tokenBudget = Math.min(16384, Math.max(4096, count * 400));

  const request = {
    model: process.env.AI_BATCH_MODEL || process.env.AI_MODEL || "gpt-4.1-mini",
    temperature,
    max_completion_tokens: tokenBudget,
    messages: [{ role: "user", content: prompt }],
  };

  // Prefer guaranteed JSON object when supported
  if (!process.env.AI_DISABLE_JSON_RESPONSE_FORMAT) {
    request.response_format = { type: "json_object" };
  }

  const completion = await client.chat.completions.create(request);
  const finishReason = completion.choices?.[0]?.finish_reason || "unknown";
  const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";

  if (finishReason === "length") {
    console.warn(`[AI] Response truncated (finish_reason=length, budget=${tokenBudget}). Attempting JSON repair…`);
  }

  let parsed = extractJsonFromText(raw);

  // If normal parse failed and response was truncated, try to salvage partial JSON
  if (!parsed && finishReason === "length") {
    parsed = _repairTruncatedJson(raw);
  }

  let tasks = null;

  // Canonical: { tasks: [...] }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.tasks)) {
    tasks = parsed.tasks;
  }
  // Soft back-compat: raw array
  else if (Array.isArray(parsed)) {
    console.warn("[AI] Returned raw array; treating as tasks[].");
    tasks = parsed;
  }
  // Soft back-compat: { items: [...] }
  else if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.items)) {
    console.warn('[AI] Returned {items:[...]}; treating as tasks[].');
    tasks = parsed.items;
  }
  // Last resort: try raw parse if extractJsonFromText missed it
  else {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object" && !Array.isArray(j) && Array.isArray(j.tasks)) {
        tasks = j.tasks;
      } else if (Array.isArray(j)) {
        console.warn("[AI] Returned raw array (raw JSON.parse); treating as tasks[].");
        tasks = j;
      } else if (j && typeof j === "object" && !Array.isArray(j) && Array.isArray(j.items)) {
        console.warn('[AI] Returned {items:[...]} (raw JSON.parse); treating as tasks[].');
        tasks = j.items;
      }
    } catch {
      // ignore
    }
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.error("[AI] Could not parse tasks. finish_reason:", finishReason, "raw length:", raw.length, "raw (first 500):", raw.slice(0, 500));
    throw new Error('AI did not return a JSON object with a "tasks" array.');
  }

  if (finishReason === "length" && tasks.length < count) {
    console.warn(`[AI] Truncation recovered ${tasks.length}/${count} tasks; downstream loop will regenerate the rest.`);
  }

  // NOTE: We no longer hard-fail on length mismatch.
  // The controller loop below will repair missing/invalid tasks one-by-one,
  // which is strictly more reliable than throwing a 500 for a minor shortfall.
  return tasks;
}

/* ============================================================
   TeacherProfile -> Perspective lens injection (profile-driven)
   ============================================================ */

function getOwnerId(req) {
  return String(req.user?._id || req.user?.userId || req.user?.id || req.userId || "").trim();
}

// Mirrors teacher-app options; labels are only for prompt readability.
const PERSPECTIVE_LABELS = {
  "christian-biblical": "Christian / Biblical",
  "character-formation": "Character / Virtue Formation",
  "historical-thinking": "Historical Thinking",
  "inquiry-learning": "Inquiry-Based Learning",
  "business-professional": "Business / Professional",
  "leadership-development": "Leadership Development",
  "team-building": "Team-Building",
  "missions-outreach": "Missions / Outreach",
};

async function loadTeacherProfileForRequest(req) {
  const ownerId = getOwnerId(req);
  if (!ownerId) return null;

  // Support common storage shapes
  const profile =
    (await TeacherProfile.findOne({ ownerId }).lean()) ||
    (await TeacherProfile.findOne({ userId: ownerId }).lean()) ||
    (await TeacherProfile.findOne({ user: ownerId }).lean()) ||
    null;

  return profile;
}

function worldviewBlockFromProfile(profile) {
  const raw = Array.isArray(profile?.perspectives) ? profile.perspectives : [];
  const perspectives = raw.map((s) => String(s || "").trim()).filter(Boolean);

  if (!perspectives.length) return "";

  const lines = perspectives.map((p) => `- ${PERSPECTIVE_LABELS[p] || p}`);

  return [
    "PERSPECTIVE LENS (from the teacher profile)",
    ...lines,
    "",
    "Apply these lenses consistently in tone, framing, examples, and question design.",
    "Do not inject other worldview assumptions unless explicitly requested by the teacher.",
  ].join("\n");
}

/* ============================================================
   Concept coverage reporting (+ allocation + enforcement)
   ============================================================ */

function _normalizeConcept(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Reject document artifacts and non-vocabulary entries that leak from
 * PDF/doc extraction (image captions, layout labels, page numbers, etc.)
 */
const _DOC_ARTIFACT_RE = /^(illustration|figure|image|photo|picture|diagram|table|caption|page|source|copyright|©|\d+\s*$)/i;
const _DOC_ARTIFACT_CONTENT_RE = /\b(illustration:\s|figure\s*\d|image\s*\d|\.png|\.jpg|\.gif|\.svg|clip\s*art|stock\s*photo|shutterstock|getty|istock)/i;

function _isDocArtifact(s) {
  if (!s) return false;
  if (_DOC_ARTIFACT_RE.test(s.trim())) return true;
  if (_DOC_ARTIFACT_CONTENT_RE.test(s)) return true;
  return false;
}

function _parseConceptList(aiWordBank) {
  const raw = Array.isArray(aiWordBank) ? aiWordBank : String(aiWordBank || "").split(/\r?\n/);

  // de-dupe while preserving order
  const seen = new Set();
  const concepts = [];

  for (const r of raw) {
    const t = _normalizeConcept(r);
    if (!t) continue;
    if (seen.has(t)) continue;
    // Filter out document artifacts (image captions, figure labels, etc.)
    if (_isDocArtifact(t)) {
      console.warn(`[_parseConceptList] Filtered document artifact: "${t}"`);
      continue;
    }
    seen.add(t);
    concepts.push(t);
  }

  return concepts;
}

function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _taskHaystack(finalizedTasks) {
  try {
    return JSON.stringify(finalizedTasks || []).toLowerCase();
  } catch {
    return String(finalizedTasks || "").toLowerCase();
  }
}

function computeCoverageReport(aiWordBank, finalizedTasks) {
  const requested = _parseConceptList(aiWordBank);
  const hay = _taskHaystack(finalizedTasks);

  const mentionCounts = {};
  const covered = [];
  const missing = [];

  for (const concept of requested) {
    const esc = _escapeRegex(concept);
    const re = new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, "g");

    let count = 0;
    while (re.exec(hay)) count++;

    mentionCounts[concept] = count;

    if (count > 0) covered.push(concept);
    else missing.push(concept);
  }

  return {
    requestedCount: requested.length,
    coveredCount: covered.length,
    missingCount: missing.length,
    requested,
    covered,
    missing,
    mentionCounts,
  };
}

/* ============================================================
   Generation report (actual coverage + Bloom)
   ============================================================ */

function _escapeRegexLoose(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _isObjectiveTaskType(taskType) {
  const meta = TASK_TYPE_META?.[taskType] || {};
  // objectiveKeyed is the clearest signal in your metadata
  if (meta.objectiveKeyed === true) return true;
  // fallback: many objective tasks also declare scoringMode
  if (String(meta.scoringMode || "").toLowerCase() === "objective") return true;
  return false;
}

// Bloom level is a heuristic indicator (task-type level). This is intentionally simple.
// You can refine per-task by inspecting prompts later.
function bloomForTaskType(taskType) {
  const meta = TASK_TYPE_META?.[taskType] || {};
  const cat = String(meta.category || "").toLowerCase();

  // Creative / open-ended tends to map to Create/Analyze.
  if (cat.includes("create") || cat.includes("creative") || cat.includes("writing")) return "Create";
  if (cat.includes("debate") || cat.includes("discussion") || cat.includes("analysis")) return "Analyze";

  // Objective tasks default to Remember/Understand.
  if (_isObjectiveTaskType(taskType)) return "Remember";

  // Movement / game-ish tasks often require applying concepts in context.
  if (cat.includes("movement") || cat.includes("game") || cat.includes("team")) return "Apply";

  return "Understand";
}

function computeActualCoverageObjectiveAnalytical(aiWordBank, finalizedTasks) {
  const requested = _parseConceptList(aiWordBank);
  const matrix = requested.map((c) => ({ concept: c, objective: 0, analytical: 0 }));
  const idxByConcept = new Map(matrix.map((r, i) => [r.concept, i]));

  // Precompile regexes once.
  const reByConcept = new Map();
  for (const c of requested) {
    const esc = _escapeRegexLoose(c);
    // boundary-ish match, case-insensitive (haystacks are lowercased)
    reByConcept.set(c, new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, "i"));
  }

  for (const t of finalizedTasks || []) {
    const taskType = String(t?.taskType || "");
    const isObj = _isObjectiveTaskType(taskType);
    const hay = _taskHaystack([t]);

    for (const c of requested) {
      const re = reByConcept.get(c);
      if (!re) continue;
      if (re.test(hay)) {
        const idx = idxByConcept.get(c);
        if (idx == null) continue;
        if (isObj) matrix[idx].objective += 1;
        else matrix[idx].analytical += 1;
      }
    }
  }

  const notCovered = matrix.filter((r) => r.objective === 0 && r.analytical === 0).map((r) => r.concept);
  const objectiveOnly = matrix
    .filter((r) => r.objective > 0 && r.analytical === 0)
    .map((r) => r.concept);
  const analyticalReinforced = matrix.filter((r) => r.analytical > 0).map((r) => r.concept);

  return {
    requestedCount: requested.length,
    matrix,
    notCovered,
    objectiveOnly,
    analyticalReinforced,
  };
}

function computeBloomsReport(finalizedTasks) {
  const dist = {};
  const perTask = [];

  for (let i = 0; i < (finalizedTasks || []).length; i++) {
    const t = finalizedTasks[i];
    const taskType = String(t?.taskType || "");
    const bloom = bloomForTaskType(taskType);
    dist[bloom] = (dist[bloom] || 0) + 1;
    perTask.push({ index: i, taskType, bloom });
  }

  const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] || "Understand";

  return { distribution: dist, dominantLevel: dominant, perTask };
}

function buildGenerationReport({ aiWordBank, finalized, pool, conceptPlan, attemptsByTask, errors }) {
  const blooms = computeBloomsReport(finalized);
  const actualCoverage = computeActualCoverageObjectiveAnalytical(aiWordBank, finalized);
  const errorCount = Array.isArray(errors) ? errors.length : 0;
  const attemptsTotal = (Array.isArray(finalized) ? finalized.length : 0) + errorCount;

  return {
    totalTasks: Array.isArray(finalized) ? finalized.length : 0,
    blooms,
    coverage: {
      actual: actualCoverage,
      // planned allocation (teacher-facing intent; NOT used as "truth")
      planned: {
        requestedConcepts: _parseConceptList(aiWordBank),
        perTask: Array.isArray(conceptPlan)
          ? conceptPlan.map((terms, idx) => ({
              index: idx,
              taskType: pool?.[idx % (pool?.length || 1)] || "",
              terms: Array.isArray(terms) ? terms : [],
              bucket: _isObjectiveTaskType(pool?.[idx % (pool?.length || 1)]) ? "objective" : "analytical",
            }))
          : [],
      },
    },
    efficiency: {
      attemptsByTask: Array.isArray(attemptsByTask) ? attemptsByTask : [],
      totalAttempts: attemptsTotal,
      regeneratedAttempts: errorCount,
    },
  };
}

function buildVocabularyLinesFromConcepts(concepts) {
  return (concepts || []).map((w) => `- ${w}`).join("\n");
}

/**
 * Concept allocation:
 * - Decide which concepts each task is responsible for.
 * - Keep prompts tight: only pass that subset when generating that task.
 *
 * "Objective-ish" types get more terms; messy/creative types get fewer.
 */
const CONCEPT_CAPS_BY_TYPE = {
  // High-capacity: these task types naturally incorporate many terms — max them out
  [TASK_TYPES.FLASHCARDS]: 8,
  [TASK_TYPES.FLASHCARDS_RACE]: 8,
  [TASK_TYPES.MATCHING]: 8,
  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: 8, // 20-30 T/F statements — more concepts = richer content
  [TASK_TYPES.SORT]: 8,
  [TASK_TYPES.VENNSORT]: 8,
  [TASK_TYPES.TRUE_FALSE]: 8,
  [TASK_TYPES.READING_COMP]: 7,
  [TASK_TYPES.PET_FEEDING]: 7,
  [TASK_TYPES.JEOPARDY]: 7,              // Brain Blitz (enum key is JEOPARDY)
  [TASK_TYPES.GUESS_WHO]: 7,
  [TASK_TYPES.NARRATION_SYNTHESIZE]: 7,
  [TASK_TYPES.TOWER_BUILDER]: 7,         // MC questions per layer — more concepts = more layers
  [TASK_TYPES.MUSICAL_CHAIRS]: 7,        // MC rounds — more concepts = more variety
  [TASK_TYPES.FAKE_OUT]: 7,
  [TASK_TYPES.MIND_MAPPER]: 7,
  [TASK_TYPES.WORD_WEAVER_DUEL]: 8,      // Vocabulary-heavy by design

  // Rich writing tasks: students weave concepts into extended prose
  [TASK_TYPES.LETTER]: 7,                // More concepts = richer letter content
  [TASK_TYPES.CASE_STUDY]: 7,            // More concepts = more realistic scenario

  // Medium-capacity → pushed up for maximum reinforcement
  [TASK_TYPES.MULTIPLE_CHOICE]: 6,
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: 6,
  [TASK_TYPES.SEQUENCE]: 6,
  [TASK_TYPES.TIMELINE]: 6,
  [TASK_TYPES.SHORT_ANSWER]: 6,
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: 6,
  [TASK_TYPES.MAD_DASH_SEQUENCE]: 6,
  [TASK_TYPES.ECHO_CHAIN]: 6,
  [TASK_TYPES.COLLABORATION]: 6,
  [TASK_TYPES.BRAINSTORM_BATTLE]: 6,
  [TASK_TYPES.HANGMAN_DUEL]: 6,
  [TASK_TYPES.ROLE_PLAY_DECK]: 6,
  [TASK_TYPES.SCRIPT_PLAY]: 6,
  [TASK_TYPES.BRAIN_SPARK_NOTES]: 6,
  [TASK_TYPES.PRONUNCIATION]: 6,
  [TASK_TYPES.SPEECH_RECOGNITION]: 6,

  // Simpler types — still bumped for reinforcement
  [TASK_TYPES.LIVE_DEBATE]: 5,
  [TASK_TYPES.OPEN_TEXT]: 6,              // vocabulary-paragraph variant benefits from more words
  [TASK_TYPES.RECORD_AUDIO]: 5,
  [TASK_TYPES.DRAW]: 4,
  [TASK_TYPES.DRAW_MIME]: 4,
  [TASK_TYPES.MIME]: 4,
  [TASK_TYPES.PHOTO]: 4,
  [TASK_TYPES.PHOTO_JOURNAL]: 4,
  [TASK_TYPES.MAKE_AND_SNAP]: 4,
  [TASK_TYPES.BODY_BREAK]: 3,
  [TASK_TYPES.MOTION_MISSION]: 3,
};

function getConceptCapForType(taskType) {
  const n = Number(CONCEPT_CAPS_BY_TYPE[taskType]);
  if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(8, Math.round(n)));
  return 2;
}

function planConceptAllocation(aiWordBank, pool, safeCount) {
  const concepts = _parseConceptList(aiWordBank);
  const plan = Array.from({ length: safeCount }, () => []);

  if (!concepts.length) return { concepts, plan };

  const caps = [];
  for (let i = 0; i < safeCount; i++) {
    const taskType = pool[i % pool.length];
    caps.push({ idx: i, cap: getConceptCapForType(taskType), taskType });
  }

  // Sort tasks by capacity descending so high-capacity tasks fill first.
  const slotsByCapDesc = caps
    .slice()
    .sort((a, b) => b.cap - a.cap || a.idx - b.idx);

  // ── Pass 1: Round-robin across ALL tasks, one concept per task ──
  // Ensures every task gets at least one concept before any task gets two.
  // Iterate through tasks in capacity-descending order.
  let cursor = 0;
  for (const slot of slotsByCapDesc) {
    if (cursor >= concepts.length) break;
    plan[slot.idx].push(concepts[cursor++]);
  }

  // ── Pass 2: Fill high-capacity tasks with remaining concepts ──
  // After every task has 1, give more concepts to tasks that can handle them.
  // Keep cycling through tasks (highest-cap first) until all concepts placed.
  let safety = 0;
  while (cursor < concepts.length && safety++ < concepts.length * 2) {
    let placed = false;
    for (const slot of slotsByCapDesc) {
      if (cursor >= concepts.length) break;
      if (plan[slot.idx].length < slot.cap) {
        plan[slot.idx].push(concepts[cursor++]);
        placed = true;
      }
    }
    if (!placed) break; // all tasks at capacity
  }

  // ── Pass 3: Reinforce — fill remaining capacity with ALL concepts ──
  // Overlap is fine: every task should reference as many concepts as its
  // cap allows.  Walk the FULL concept list (not just leftovers) so
  // content-hungry types (Brain Blitz cap 5, Tower Builder cap 5, etc.)
  // get a rich variety even when the unique allocation was thin.
  if (concepts.length > 0) {
    for (const slot of slotsByCapDesc) {
      const already = new Set(plan[slot.idx].map(c => c.toLowerCase()));
      // First add any concepts NOT already in this task
      for (let ci = 0; ci < concepts.length && plan[slot.idx].length < slot.cap; ci++) {
        if (!already.has(concepts[ci].toLowerCase())) {
          plan[slot.idx].push(concepts[ci]);
          already.add(concepts[ci].toLowerCase());
        }
      }
      // Then cycle through all concepts if still under cap
      let rIdx = 0;
      while (plan[slot.idx].length < slot.cap) {
        plan[slot.idx].push(concepts[rIdx % concepts.length]);
        rIdx++;
      }
    }
  }

  return { concepts, plan };
}

function taskMustIncludeTermsOrThrow(task, terms, options) {
  const needed = Array.isArray(terms) ? terms.map(_normalizeConcept).filter(Boolean) : [];
  if (!needed.length) return;

  const hay = _taskHaystack([task]);

  const makeLoose = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const buildVariants = (t) => {
    const base = _normalizeConcept(t);
    const andVariant = _normalizeConcept(base.replace(/&/g, " and "));
    const ampVariant = _normalizeConcept(base.replace(/\band\b/g, "&"));
    const loose = makeLoose(base);

    // Also allow matching against a "loose" haystack for punctuation-sensitive terms.
    return {
      exact: [base, andVariant, ampVariant].filter(Boolean),
      loose,
    };
  };

  const looseHay = makeLoose(hay);

  const missing = [];
  for (const t of needed) {
    const { exact, loose } = buildVariants(t);

    // 1) Exact-ish variants (keep punctuation)
    let ok = false;
    for (const v of exact) {
      const esc = _escapeRegex(v);
      const re = new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, "i");
      if (re.test(hay)) {
        ok = true;
        break;
      }
    }

    // 2) Loose match (punctuation-insensitive), useful for "&" and similar
    if (!ok && loose) {
      const escLoose = _escapeRegex(loose);
      const reLoose = new RegExp(`(^| )${escLoose}($| )`, "i");
      if (reLoose.test(looseHay)) ok = true;
    }

    // 3) Compound term match: for terms with ":" or "–" or " - ",
    // check if ALL sub-parts appear somewhere in the task (even in different fields).
    // e.g. "schooling: one room schoolhouses" → both "schooling" and "one room schoolhouses" must appear.
    if (!ok) {
      const parts = t.split(/\s*[:–—\-]\s*/).map(makeLoose).filter((p) => p.length > 2);
      if (parts.length >= 2) {
        const allPartsFound = parts.every((part) => {
          const escPart = _escapeRegex(part);
          return new RegExp(`(^| )${escPart}($| )`, "i").test(looseHay);
        });
        if (allPartsFound) ok = true;
      }
    }

    if (!ok) missing.push(t);
  }

  if (missing.length) {
    const msg = `Concepts not included: ${missing.join(", ")}`;
    if (options?.warnOnly) {
      console.warn(`[taskMustIncludeTerms] WARNING (non-blocking): ${msg}`);
      return missing;          // Return missing list for caller to handle
    }
    throw new Error(msg);
  }
  return [];
}

// "Objective-ish" types that are most likely to cleanly include specific vocabulary terms.
const COVERAGE_FIX_PREFERRED_TYPES = new Set([
  TASK_TYPES.MULTIPLE_CHOICE,
  TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE,
  TASK_TYPES.TRUE_FALSE,
  TASK_TYPES.SHORT_ANSWER,
  TASK_TYPES.FLASHCARDS,
  TASK_TYPES.FLASHCARDS_RACE,
  TASK_TYPES.MATCHING,
  TASK_TYPES.SORT,
  TASK_TYPES.VENNSORT,
  TASK_TYPES.SEQUENCE,
  TASK_TYPES.TIMELINE,
  TASK_TYPES.HANGMAN_DUEL,
]);

async function attemptAutoFixCoverage({
  aiWordBank,
  finalized,
  subject,
  gradeLevel,
  difficulty,
  learningGoal,
  topicLabel,
  mergedSpecialConsiderations,
  errors,
}) {
  const fixes = [];

  // Up to 4 passes.  Each pass picks a DIFFERENT high-capacity task and
  // asks the AI to regenerate it with the missing terms.  We limit each
  // pass to a manageable number of terms so the AI can actually comply.
  const maxPasses = 4;
  const maxTermsPerFix = 6;

  let coverage = computeCoverageReport(aiWordBank, finalized);
  if (!coverage.missingCount) return { coverage, fixes };

  // Track which task indices we've already regenerated so each pass
  // picks a different task, spreading fixes across the taskset.
  const usedIndices = new Set();

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (!coverage.missingCount) break;

    // Pick a task index to regenerate.
    // Prefer high-capacity preferred types we haven't tried yet.
    let idx = -1;

    // 1) Try preferred types first (not yet used)
    for (let i = 0; i < finalized.length; i++) {
      if (usedIndices.has(i)) continue;
      if (!finalized[i]) continue;
      if (COVERAGE_FIX_PREFERRED_TYPES.has(finalized[i].taskType)) {
        // Prefer tasks with higher concept caps
        const cap = getConceptCapForType(finalized[i].taskType);
        if (idx < 0 || cap > getConceptCapForType(finalized[idx]?.taskType)) {
          idx = i;
        }
      }
    }

    // 2) Fall back to any unused task
    if (idx < 0) {
      for (let i = 0; i < finalized.length; i++) {
        if (!usedIndices.has(i) && finalized[i]) { idx = i; break; }
      }
    }

    // 3) Last resort: reuse a preferred-type task
    if (idx < 0) {
      idx = finalized.findIndex((t) => COVERAGE_FIX_PREFERRED_TYPES.has(t?.taskType));
    }
    if (idx < 0) idx = 0;

    usedIndices.add(idx);

    const targetTask = finalized[idx];
    const allowedType = targetTask?.taskType || TASK_TYPES.MULTIPLE_CHOICE;
    const mustHave = retryMustHave[allowedType] || "";

    // Take a batch of missing terms sized to what the task type can handle
    const typeCap = getConceptCapForType(allowedType);
    const batchSize = Math.min(maxTermsPerFix, typeCap, coverage.missingCount);
    const targetTerms = coverage.missing.slice(0, batchSize);
    const scopedLines = buildVocabularyLinesFromConcepts(targetTerms);

    const fixNote = [
      mergedSpecialConsiderations,
      "COVERAGE FIX PASS",
      `You MUST explicitly include and use ALL of these missing concepts in this ONE task: ${targetTerms.join(", ")}`,
      "Integrate naturally; do not add filler; do not invent unrelated concepts.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let attemptTask = null;
    let lastErr = null;
    let success = false;

    const maxAttempts = allowedType === TASK_TYPES.MUSICAL_CHAIRS ? 5 : 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        attemptTask = await regenerateSingleTask({
          allowedType,
          mustHave,
          subject,
          gradeLevel,
          difficulty,
          learningGoal,
          topicLabel,
          vocabularyLines: scopedLines,
          specialConsiderations: fixNote,
          previousTask: attemptTask,
        });

        const fin = finalizeTask(allowedType, attemptTask);
        // Use warn-only so partial success still counts
        const stillMissing = taskMustIncludeTermsOrThrow(fin, targetTerms, { warnOnly: true });
        if (stillMissing.length === 0 || stillMissing.length < targetTerms.length) {
          // Accept if we covered at least some of the target terms
          finalized[idx] = fin;
          success = stillMissing.length === 0;
          if (stillMissing.length > 0) {
            errors.push({
              phase: "coverage-fix",
              pass, index: idx, taskType: allowedType, attempt,
              error: `Partial: still missing ${stillMissing.join(", ")}`,
              targetTerms,
            });
          }
          break;
        }
        throw new Error(`Concepts not included: ${stillMissing.join(", ")}`);
      } catch (e) {
        lastErr = e;
        errors.push({
          phase: "coverage-fix",
          pass, index: idx, taskType: allowedType, attempt,
          error: String(e?.message || e),
          targetTerms,
        });
      }
    }

    fixes.push({
      pass,
      index: idx,
      taskType: allowedType,
      attemptedTerms: targetTerms,
      ok: success,
      error: success ? "" : String(lastErr?.message || lastErr || "unknown"),
    });

    coverage = computeCoverageReport(aiWordBank, finalized);
  }

  return { coverage, fixes };
}

/**
 * POST /api/ai/tasksets
 * Body: { title, subject, gradeLevel, difficulty, learningGoal, topicLabel, aiWordBank, taskTypePool?, count? }
 */
export async function createAiTaskset(req, res) {
  // SSE streaming mode: send progress events as tasks are finalized.
  // Activated when client sends Accept: text/event-stream
  const wantsStream = String(req.headers.accept || "").includes("text/event-stream");

  // Helper: write one SSE event. No-op if not in stream mode.
  function sendSSE(obj) {
    if (!wantsStream) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch { /* connection closed */ }
  }

  if (wantsStream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
  }

  try {
    const {
      title,
      tasksetName,   // user-entered name from the generator form
      topicTitle,    // alias sent by AiTasksetGenerator
      subject = "General",
      gradeLevel = 7,
      difficulty = "MEDIUM",
      learningGoal = "",
      topicLabel = "",
      aiWordBank = "",
      taskTypePool,
      requiredTaskTypes,     // alias sent by AiTasksetGenerator when "Limit" is on
      guaranteedTaskTypes,   // types that MUST appear in the pool
      count,
      numberOfTasks,         // alias sent by AiTasksetGenerator
      specialConsiderations = "",
      topicDescription = "",
      totalDurationMinutes,
      durationMinutes: durationMinutesBody,
      isFixedStationTaskset,
      displays: rawDisplays,
      atDeskOnly,
      questMode,         // Quest Mode overlay flag — see QUEST_MODE_PLAN.md
      escapeRoomMode,    // Escape Room overlay flag — see ESCAPE_ROOM_PLAN.md
      escapeRoomTheme,   // optional theme override (spy-mission / archaeology / ...)
      narrativeTerms,    // CSV string OR array — used by the escape room generator's curriculum-term gate
      duelsEnabled,      // Auto-duel trigger flag — see backend/services/duel.js
    } = req.body || {};

    // At-desk-only mode: the 6 task types that fundamentally require students
    // to get up and around the classroom. When `atDeskOnly === true`, these
    // are stripped from both the eligible candidate list and any user-selected
    // pool so they can't appear in the generated set.
    const MOVEMENT_REQUIRED_TYPES = new Set([
      "musical-chairs",
      "mad-dash",
      "mad-dash-sequence",
      "physical-multiple-choice",
      "hidenseek",
      "treasure-runner",
    ]);
    const isAtDeskOnly = atDeskOnly === true;
    const isQuestMode = questMode === true;
    const isEscapeRoomMode = escapeRoomMode === true;

    // ── Fixed station / display support ──
    // Teacher may assign physical objects/topics to colored stations.
    // Each display: { key, name, stationColor, description, notesForTeacher, imageUrl }
    const displays = Array.isArray(rawDisplays)
      ? rawDisplays.filter((d) => d && (d.name || d.description || d.stationColor))
      : [];
    const hasFixedStations = !!(isFixedStationTaskset || displays.length > 0);

    // Accept either key the frontend might send
    const durationMinutes = Number(totalDurationMinutes || durationMinutesBody) || null;

    // Frontend sends topicDescription; merge with specialConsiderations if both present
    const effectiveSpecialConsiderations =
      [specialConsiderations, topicDescription].map(s => String(s || "").trim()).filter(Boolean).join("\n\n");

    // Accept either key the frontend might send for count.
    const explicitCount = count || numberOfTasks;

    let eligible = getGenerationEligibleTypes(subject);

    // Accept either key the frontend might send for the type pool.
    // Teacher-selected types bypass the eligible filter (e.g. languageOnly
    // types like pronunciation chosen for a non-language subject).
    const rawPool = taskTypePool || requiredTaskTypes;
    const allImplemented = Object.values(TASK_TYPES).filter((t) => {
      const m = TASK_TYPE_META?.[t];
      return m && m.implemented !== false && m.generatorEligible !== false;
    });
    let userPool =
      Array.isArray(rawPool) && rawPool.length
        ? rawPool.map(normalizeSelectedType).filter(Boolean).filter((t) => allImplemented.includes(t))
        : null;

    // Resolve guaranteed types (must appear in pool regardless of limit setting).
    // These are teacher-chosen so they skip the languageOnly / subject filter.
    let guaranteed =
      Array.isArray(guaranteedTaskTypes) && guaranteedTaskTypes.length
        ? guaranteedTaskTypes.map(normalizeSelectedType).filter(Boolean).filter((t) => allImplemented.includes(t))
        : [];

    // 🔹 At-desk-only filter — strip movement-required task types from every
    //   pool, BEFORE the candidate count / duration logic uses them. This
    //   guarantees the generator literally cannot pick a movement task.
    if (isAtDeskOnly) {
      const beforeEligible = eligible.length;
      const beforeUser = userPool ? userPool.length : null;
      const beforeGuaranteed = guaranteed.length;
      eligible = eligible.filter((t) => !MOVEMENT_REQUIRED_TYPES.has(t));
      if (userPool) userPool = userPool.filter((t) => !MOVEMENT_REQUIRED_TYPES.has(t));
      guaranteed = guaranteed.filter((t) => !MOVEMENT_REQUIRED_TYPES.has(t));
      console.log(
        `[AI] atDeskOnly=true → eligible ${beforeEligible}→${eligible.length}` +
        (beforeUser != null ? `, userPool ${beforeUser}→${userPool.length}` : "") +
        (beforeGuaranteed ? `, guaranteed ${beforeGuaranteed}→${guaranteed.length}` : "")
      );
    }

    // If no explicit count, derive from duration using per-type estimated minutes.
    // Average the estimatedMinutes across the candidate pool so heavier task mixes
    // yield fewer tasks and lighter mixes yield more.
    let durationDerivedCount = null;
    if (durationMinutes && !explicitCount) {
      const candidatePool = userPool || eligible;
      const avgMinutes = candidatePool.length
        ? candidatePool.reduce((sum, t) => sum + (TASK_TYPE_META?.[t]?.estimatedMinutes || 5), 0) / candidatePool.length
        : 5;
      durationDerivedCount = Math.max(4, Math.min(20, Math.round(durationMinutes / avgMinutes)));
      console.log(`[AI] Duration ${durationMinutes}min ÷ avg ${avgMinutes.toFixed(1)}min/task → ${durationDerivedCount} tasks`);
    }
    let safeCount = clampInt(explicitCount || durationDerivedCount, 1, 30, 12);

    // Task count must be at least the number of explicitly selected types —
    // the teacher's type selection always trumps the duration-based estimate.
    if (userPool && userPool.length > safeCount) {
      console.log(`[AI] Expanding safeCount from ${safeCount} to ${userPool.length} to fit all selected task types`);
      safeCount = userPool.length;
    }

    // 🔹 Early-finisher bonus tasks — ALWAYS add 2 extra tasks beyond the
    //   teacher's time-derived count. These are tagged isBonus + requiredForCompletion:false
    //   below, so teams that finish core early get them automatically while slower
    //   teams never need to see them. The teacher's intended time budget is honored
    //   for the core; the bonus tasks are pure overflow.
    const EARLY_FINISHER_BONUS_COUNT = 2;
    const QUEST_HIDDEN_COUNT = 1;     // quest mode adds 1 hidden ON TOP of the always-on +2 bonus
    {
      const beforeCount = safeCount;
      safeCount += EARLY_FINISHER_BONUS_COUNT;
      console.log(`[AI] +${EARLY_FINISHER_BONUS_COUNT} early-finisher bonus tasks → safeCount ${beforeCount}→${safeCount}`);
    }
    if (isQuestMode) {
      const beforeCount = safeCount;
      safeCount += QUEST_HIDDEN_COUNT;
      if (!guaranteed.includes("quest")) guaranteed.unshift("quest");
      console.log(`[AI] questMode=true → +${QUEST_HIDDEN_COUNT} hidden task, safeCount ${beforeCount}→${safeCount}, 'quest' forced into guaranteed`);
    }

    // 🔹 Drop-insurance buffer — over-generate a few EXTRA tasks beyond the
    //   intended size. If a task turns out unplayable, we drop it and trim back
    //   to `targetTaskCount`, so a generation hiccup never shortens the set.
    //   targetTaskCount is what we actually deliver (core + bonus + quest).
    const REPAIR_BUFFER_COUNT = 3;
    const targetTaskCount = safeCount;
    {
      const beforeCount = safeCount;
      safeCount += REPAIR_BUFFER_COUNT;
      console.log(`[AI] +${REPAIR_BUFFER_COUNT} drop-insurance buffer → generate ${safeCount}, trim back to ${targetTaskCount}`);
    }

    // ✅ Load teacher profile early — needed for both diversity minimums and worldview lens.
    let teacherProfile = null;
    try {
      teacherProfile = await loadTeacherProfileForRequest(req);
    } catch (e) {
      console.warn("[AI] TeacherProfile lookup failed:", String(e?.message || e));
    }

    // Build the actual N-slot pool with enforced variety + guaranteed types first.
    // Diversity minimums come from the teacher profile (defaults: 1 inter, 1 intra, 2 off-tablet).
    const diversityMins = {
      minInterTeam: teacherProfile?.minInterTeamTasks ?? 1,
      minIntraTeam: teacherProfile?.minIntraTeamTasks ?? 1,
      minOffTablet: teacherProfile?.minOffTabletTasks ?? 2,
    };
    const subjectBucket = detectSubjectBucket(subject);
    const pool = buildDiversePool(userPool || eligible, safeCount, guaranteed, diversityMins, subjectBucket);

    // ── Profile-injected types (not user-selectable, auto-added via teacher toggles) ──
    if (teacherProfile?.includeRiddleInSets) {
      // Insert one riddle roughly in the middle of the set as a comic-relief breather
      const riddlePos = Math.max(1, Math.floor(pool.length / 2));
      pool.splice(riddlePos, 0, TASK_TYPES.RIDDLE);
      console.log(`[AI] Profile toggle: injected riddle at position ${riddlePos}`);
    }
    if (teacherProfile?.includeMysteryCluesInSets && pool.length >= 4) {
      // Interleave mystery-clues reveal tasks at ~1/3 and ~2/3 through the set,
      // then a final recall task at the end.
      const revealCount = Math.min(3, Math.max(2, Math.floor(pool.length / 4)));
      const spacing = Math.floor(pool.length / (revealCount + 1));
      for (let ri = revealCount; ri >= 1; ri--) {
        const pos = Math.min(pool.length, ri * spacing);
        pool.splice(pos, 0, TASK_TYPES.MYSTERY_CLUES);
      }
      // Final recall task at the very end
      pool.push(TASK_TYPES.MYSTERY_CLUES);
      console.log(`[AI] Profile toggle: injected ${revealCount} mystery-clues reveals + 1 final recall`);
    }

    // Update safeCount to match actual pool size (may have grown to fit all guaranteed types + injected)
    safeCount = pool.length;
    if (!pool.length) {
      if (wantsStream) {
        sendSSE({ type: "error", error: "No eligible task types provided." });
        return res.end();
      }
      return res.status(400).json({ ok: false, error: "No eligible task types provided." });
    }

    // ✅ Profile-driven "lens" injection (NOT Christian-only; teacher profile determines lens)
    let mergedSpecialConsiderations = String(effectiveSpecialConsiderations || "").trim();
    try {
      const worldviewBlock = worldviewBlockFromProfile(teacherProfile);
      mergedSpecialConsiderations = [worldviewBlock, mergedSpecialConsiderations]
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .join("\n\n");
    } catch (e) {
      // never block generation if profile lookup fails
      console.warn("[AI] TeacherProfile lens lookup failed:", String(e?.message || e));
    }

    // ✅ Plan concept allocation (which tasks get which concepts)
    const { concepts: requestedConcepts, plan: conceptPlan } = planConceptAllocation(aiWordBank, pool, safeCount);

    // IMPORTANT:
    // To reduce prompt complexity (especially for finicky schema tasks),
    // the initial batch prompt should NOT include the full word bank.
    // We'll enforce coverage per-task during the finalize/regenerate loop.
    const initialVocabularyLines = requestedConcepts.length
      ? buildVocabularyLinesFromConcepts(requestedConcepts.slice(0, 10))
      : "";

    // Announce total so the client can show a progress bar
    sendSSE({ type: "start", total: safeCount });
    sendSSE({ type: "phase", phase: "generating", message: "Generating tasks with AI…" });

    // ── Build timing context from real completion data ──
    let timingContext = "";
    try {
      const teacherOwnerId = getOwnerId(req);
      const timingStats = await getTimingStatsForGenerator(teacherOwnerId);
      if (Object.keys(timingStats).length > 0) {
        const lines = Object.entries(timingStats)
          .filter(([, s]) => s.sampleCount >= 5) // only include reliable data
          .map(([type, s]) => `  - ${type}: ~${s.avgMinutes} min avg (${s.sampleCount} samples, source: ${s.source})`)
          .join("\n");
        if (lines) {
          timingContext = lines;
          if (durationMinutes) {
            timingContext += `\n  Target session duration: ${durationMinutes} minutes. Choose task count and complexity so total ≈ ${durationMinutes} min.`;
          }
        }
      }
    } catch (e) {
      console.warn("[AI] Timing stats lookup failed (non-blocking):", e?.message || e);
    }

    // ── Per-task sequential generation ──
    // Each task is generated individually via regenerateSingleTask to avoid
    // cross-type schema contamination that occurs in batch generation.
    // This is slower (one API call per task) but far more accurate.

    sendSSE({ type: "phase", phase: "generating", message: "Generating tasks one-by-one…" });

    if (hasFixedStations) {
      console.log(`[AI] Fixed station mode: ${displays.length} display(s) assigned across ${safeCount} tasks`);
      displays.forEach((d, idx) => console.log(`  Station ${idx + 1}: ${d.stationColor || "?"} → "${d.name}"`));
    }

    const finalized = [];
    const errors = [];
    const attemptsByTask = [];

    const deferredHangmanSlots = []; // indices where Hangman will be built from leftover words

    for (let i = 0; i < safeCount; i++) {
      const expectedType = pool[i % pool.length];

      // ── Defer Hangman: skip in main loop, build from unused words later ──
      if (expectedType === TASK_TYPES.HANGMAN_DUEL && aiWordBank) {
        deferredHangmanSlots.push(i);
        finalized.push(null); // placeholder
        attemptsByTask.push(0);
        sendSSE({ type: "progress", done: finalized.length, total: safeCount, taskType: expectedType });
        continue;
      }

      const mustHave = retryMustHave[expectedType] || "";
      // Give matching and other structurally-tricky types more retries
      const maxAttempts = (expectedType === TASK_TYPES.MUSICAL_CHAIRS || expectedType === TASK_TYPES.MATCHING) ? 6 : 4;

      // Concepts this task MUST include
      const assignedTerms = Array.isArray(conceptPlan[i]) ? conceptPlan[i] : [];
      const scopedLines = buildVocabularyLinesFromConcepts(assignedTerms);

      // ── Fixed station context for this task ──
      // Round-robin assign displays to tasks so each station gets roughly equal coverage.
      let displayContext = "";
      let assignedDisplayKey = null;
      if (hasFixedStations && displays.length > 0) {
        const display = displays[i % displays.length];
        assignedDisplayKey = display.key || display.name || `display-${i % displays.length}`;
        const stationLines = [
          "FIXED STATION CONTEXT",
          `This task is assigned to a physical station with color: ${display.stationColor || "unspecified"}.`,
          display.name ? `Station display/object: "${display.name}"` : "",
          display.description ? `Description: ${display.description}` : "",
          "The task content MUST directly reference or relate to whatever is physically present at this station.",
          "Students will be standing at this station looking at the physical object/display when they do this task.",
          display.stationColor ? `Include stationColor: "${display.stationColor}" in the task config.` : "",
          `Include displayKey: "${assignedDisplayKey}" in the task output.`,
        ].filter(Boolean).join("\n");
        displayContext = stationLines;
      }

      const scopedConsiderations = [
        mergedSpecialConsiderations,
        displayContext,
        assignedTerms.length
          ? [
              "CONCEPT REQUIREMENTS",
              `You MUST explicitly include and use ALL of these concepts in THIS ONE task: ${assignedTerms.join(", ")}`,
              "Integrate naturally. Do NOT invent unrelated concepts. Do NOT omit any required concept.",
            ].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      let lastErr = null;
      let success = false;
      let usedAttempts = 0;

      // Generate the first attempt. Wrapped in try/catch so a first-try schema
      // failure (regenerateSingleTask throws assertValidAiTask) doesn't escape
      // and abort the WHOLE set — the retry loop + final drop handle it.
      let attemptTask = null;
      try {
        attemptTask = await regenerateSingleTask({
          allowedType: expectedType,
          mustHave,
          subject,
          gradeLevel,
          difficulty,
          learningGoal,
          topicLabel,
          vocabularyLines: scopedLines,
          specialConsiderations: scopedConsiderations,
          previousTask: null,
        });
      } catch (e) {
        lastErr = e; // first loop iteration sees attemptTask=null → retries with the error hint
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        usedAttempts = attempt;
        try {
          if (!attemptTask) throw new Error("Missing or invalid task object.");

          const fin = finalizeTask(expectedType, attemptTask);

          // ✅ Check assigned concepts per-task.
          // For content-rich types (cap > 2), retry if concepts are missing (first 2 attempts).
          // For simple types (draw, mime, photo — cap ≤ 2), warn but don't block.
          const isSimpleType = getConceptCapForType(expectedType) <= 2;
          const warnOnly = isSimpleType || attempt > 2;
          taskMustIncludeTermsOrThrow(fin, assignedTerms, { warnOnly });

          // ── Stamp fixed-station metadata onto finalized task ──
          if (hasFixedStations && assignedDisplayKey) {
            fin.displayKey = assignedDisplayKey;
            const display = displays[i % displays.length];
            if (display?.stationColor) {
              fin.stationColor = display.stationColor;
              if (fin.config && typeof fin.config === "object") {
                fin.config.stationColor = display.stationColor;
              }
            }
          }

          finalized.push(fin);
          success = true;
          break;
        } catch (e) {
          lastErr = e;
          errors.push({
            index: i,
            taskType: expectedType,
            attempt,
            error: String(e?.message || e),
            assignedTerms,
          });

          // Wrapped: if THIS regeneration also throws its schema error, don't
          // let it escape the loop and abort the whole set — null it so the
          // next iteration retries, and the final !success branch drops it.
          try {
            attemptTask = await regenerateSingleTask({
              allowedType: expectedType,
              mustHave,
              subject,
              gradeLevel,
              difficulty,
              learningGoal,
              topicLabel,
              vocabularyLines: scopedLines,
              specialConsiderations: scopedConsiderations,
              previousTask: attemptTask,
              previousError: String(e?.message || e),
            });
          } catch (regenErr) {
            lastErr = regenErr;
            attemptTask = null;
          }
        }
      }

      if (!success) {
        // Don't abort the WHOLE set because one task type kept failing its
        // schema (e.g. flashcards-race answers too long for a math topic).
        // Drop this slot and carry on — the drop-insurance buffer keeps the
        // final count, and coverage auto-fix backfills any concepts it covered.
        console.warn(`[AI] dropping ungeneratable slot ${i} (${expectedType}): ${lastErr?.message || lastErr}`);
        errors.push({
          index: i,
          taskType: expectedType,
          dropped: true,
          error: String(lastErr?.message || lastErr),
        });
        sendSSE({ type: "progress", done: finalized.length, total: safeCount, taskType: expectedType });
        continue; // skip the finalized.push / attemptsByTask.push for this slot
      }

      // record how many attempts this slot used (1 = first-pass success)
      attemptsByTask.push(Math.max(1, usedAttempts || 1));

      // 🔴 Progress event: tell the client one more task is done
      sendSSE({ type: "progress", done: finalized.length, total: safeCount, taskType: expectedType });
    }

    // If EVERY slot failed, don't save an empty set — surface a clear error.
    if (finalized.filter(Boolean).length === 0) {
      throw new Error("Could not generate any valid tasks for this topic. Try different task types or simplifying the vocabulary, then regenerate.");
    }

    // ✅ Coverage report + auto-fix (only when there are vocabulary terms to check)
    let coverage = computeCoverageReport(aiWordBank, finalized);
    let fixes = [];

    if (coverage.missingCount > 0) {
      sendSSE({ type: "phase", phase: "coverage", message: "Checking vocabulary coverage…" });
      const result = await attemptAutoFixCoverage({
        aiWordBank,
        finalized,
        subject,
        gradeLevel,
        difficulty,
        learningGoal,
        topicLabel,
        mergedSpecialConsiderations,
        errors,
      });
      coverage = result.coverage || coverage;
      fixes = result.fixes || [];
    }

    // ── Deferred Hangman: build from unused words (prioritize uncovered, fill with others) ──
    if (deferredHangmanSlots.length > 0 && aiWordBank) {
      sendSSE({ type: "phase", phase: "hangman", message: "Building Hangman from vocabulary…" });

      // Recompute coverage against non-null tasks
      const liveTasksForCoverage = finalized.filter((t) => t !== null);
      const hangmanCoverage = computeCoverageReport(aiWordBank, liveTasksForCoverage);
      const allWords = _parseConceptList(aiWordBank);

      // Only allow pure alphabetic words (no numbers, hyphens, apostrophes, etc.)
      const isHangmanFriendly = (w) => /^[A-Za-z]{3,14}$/.test(w);

      for (const slotIdx of deferredHangmanSlots) {
        // Prioritize uncovered words, then fill from covered words to reach 8
        const TARGET = 8;
        const uncovered = [...(hangmanCoverage.missing || [])].filter(isHangmanFriendly);
        const covered = [...(hangmanCoverage.covered || [])].filter(isHangmanFriendly);

        // Shuffle both so we don't always pick the same ones
        for (let j = uncovered.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [uncovered[j], uncovered[k]] = [uncovered[k], uncovered[j]];
        }
        for (let j = covered.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [covered[j], covered[k]] = [covered[k], covered[j]];
        }

        // Take uncovered first, then fill from covered
        const picked = uncovered.slice(0, TARGET);
        if (picked.length < TARGET) {
          picked.push(...covered.slice(0, TARGET - picked.length));
        }
        // Last resort: if still < TARGET, fill from allWords (only hangman-friendly — never use words with non-alpha chars)
        if (picked.length < TARGET) {
          const used = new Set(picked.map((w) => w.toLowerCase()));
          const friendly = allWords.filter((w) => isHangmanFriendly(w) && !used.has(w.toLowerCase()));
          for (const w of friendly) {
            if (picked.length >= TARGET) break;
            if (!used.has(w.toLowerCase())) {
              picked.push(w);
              used.add(w.toLowerCase());
            }
          }
        }

        // Build the Hangman task — NO AI call needed
        const wordsByStation = picked.slice(0, TARGET).map((word, idx) => ({
          word: word.toUpperCase(),
          hint: `Think about this ${word.length}-letter word from your vocabulary`,
        }));

        try {
          const hangmanTask = finalizeTask(TASK_TYPES.HANGMAN_DUEL, {
            taskType: TASK_TYPES.HANGMAN_DUEL,
            title: `Vocabulary Hangman`,
            prompt: "Guess the word from the hint! Each station has a different word.",
            timeLimitSeconds: 120,
            config: { wordsByStation },
            wordsByStation,
          });

          finalized[slotIdx] = hangmanTask;
          attemptsByTask[slotIdx] = 1;
          console.log(`[Hangman] Built from ${uncovered.length} unused + ${Math.max(0, picked.length - uncovered.length)} reused words`);
        } catch (e) {
          console.warn(`[Hangman] Deferred build failed:`, e?.message);
          // Fall back to AI generation
          try {
            const aiTask = await regenerateSingleTask({
              allowedType: TASK_TYPES.HANGMAN_DUEL,
              mustHave: retryMustHave[TASK_TYPES.HANGMAN_DUEL] || "",
              subject, gradeLevel, difficulty, learningGoal, topicLabel,
              vocabularyLines: buildVocabularyLinesFromConcepts(picked),
              specialConsiderations: mergedSpecialConsiderations,
            });
            finalized[slotIdx] = finalizeTask(TASK_TYPES.HANGMAN_DUEL, aiTask);
            attemptsByTask[slotIdx] = 2;
          } catch (e2) {
            console.error(`[Hangman] AI fallback also failed:`, e2?.message);
            // Remove the null placeholder — don't block the whole taskset
            finalized[slotIdx] = null;
          }
        }

        sendSSE({ type: "progress", done: finalized.filter((t) => t !== null).length, total: safeCount, taskType: TASK_TYPES.HANGMAN_DUEL });
      }

      // Remove any remaining null slots (if Hangman failed completely)
      const beforeLen = finalized.length;
      for (let i = finalized.length - 1; i >= 0; i--) {
        if (finalized[i] === null) finalized.splice(i, 1);
      }
      if (finalized.length < beforeLen) {
        console.warn(`[Hangman] Removed ${beforeLen - finalized.length} failed Hangman slot(s)`);
      }

      // Recompute final coverage including Hangman words
      coverage = computeCoverageReport(aiWordBank, finalized);
    }

    // ── DROP-INSURANCE TRIM ──
    // We over-generated by REPAIR_BUFFER_COUNT. Trim back to targetTaskCount,
    // dropping UNPLAYABLE tasks FIRST (so a generation hiccup is removed, not
    // shipped) and then surplus playable tasks from the end. The buffer means
    // dropping a bad task doesn't shorten the delivered set.
    {
      const liveCount = finalized.filter(Boolean).length;
      let toRemove = liveCount - targetTaskCount;
      if (toRemove > 0) {
        const dropIdx = new Set();
        // pass 1: unplayable tasks, scanning from the end
        for (let i = finalized.length - 1; i >= 0 && toRemove > 0; i--) {
          const t = finalized[i];
          if (!t) continue;
          let bad = false;
          try { bad = assessTaskPlayability(t).playable === false; } catch { bad = false; }
          if (bad) { dropIdx.add(i); toRemove--; }
        }
        // pass 2: surplus playable tasks, from the end
        for (let i = finalized.length - 1; i >= 0 && toRemove > 0; i--) {
          if (finalized[i] && !dropIdx.has(i)) { dropIdx.add(i); toRemove--; }
        }
        if (dropIdx.size) {
          const removedTypes = [];
          for (let i = finalized.length - 1; i >= 0; i--) {
            if (dropIdx.has(i)) {
              removedTypes.push(finalized[i]?.taskType || "?");
              finalized.splice(i, 1);
              if (Array.isArray(attemptsByTask) && i < attemptsByTask.length) attemptsByTask.splice(i, 1);
            }
          }
          console.log(`[AI] drop-insurance trim: removed ${dropIdx.size} task(s) [${removedTypes.join(", ")}] → ${finalized.length} (target ${targetTaskCount})`);
        }
      }
    }

    // ✅ GUARDRAIL: Cross-task term *dominance* detection
    // We WANT terms to appear across many tasks (that's vocabulary reinforcement).
    // We only flag when one term is the PRIMARY FOCUS (appears in the task title)
    // of too many tasks — meaning it's hogging slots other terms should get.
    const termTitleCount = {};   // term appears as primary focus (in title)
    const termMentionCount = {}; // term mentioned anywhere (title + prompt)
    const totalTasks = finalized.filter(Boolean).length;
    for (const task of finalized) {
      if (!task) continue;
      const titleLower = (task.title || "").toLowerCase();
      const promptLower = (task.prompt || "").toLowerCase();
      const combined = `${titleLower} ${promptLower}`;
      for (const word of aiWordBank || []) {
        const termLower = String(word.term || word).toLowerCase();
        if (termLower.length < 3) continue;
        if (combined.includes(termLower)) {
          termMentionCount[termLower] = (termMentionCount[termLower] || 0) + 1;
        }
        if (titleLower.includes(termLower)) {
          termTitleCount[termLower] = (termTitleCount[termLower] || 0) + 1;
        }
      }
    }
    // Only warn when a term dominates task TITLES (primary focus) in >30% of tasks or >3 titles
    const titleDominanceThreshold = Math.max(3, Math.ceil(totalTasks * 0.3));
    const overusedTerms = Object.entries(termTitleCount)
      .filter(([, count]) => count > titleDominanceThreshold)
      .map(([term, count]) => ({ term, titleCount: count, mentionCount: termMentionCount[term] || count }));
    if (overusedTerms.length > 0) {
      console.warn(`[Quality Guardrail] Term(s) dominating too many task titles:`,
        overusedTerms.map((t) => `"${t.term}" is primary focus in ${t.titleCount}/${totalTasks} tasks`).join(", ")
      );
    }

    // ✅ Teacher-facing report (actual coverage + Bloom + efficiency)
    const generationReport = buildGenerationReport({
      aiWordBank,
      finalized,
      pool,
      conceptPlan,
      attemptsByTask,
      errors,
    });

    // ✅ POST-GENERATION AI REVIEW: one final holistic pass
    if (!process.env.AI_SKIP_POST_REVIEW) {
      try {
        const reviewed = await postGenerationReview(finalized, { subject, gradeLevel, sendSSE });
        if (reviewed && reviewed.length === finalized.length) {
          finalized.splice(0, finalized.length, ...reviewed);
        }
      } catch (e) {
        console.warn("[PostReview] Skipped due to error:", e?.message || e);
      }
    }

    // Use the user-entered title first, fall back to topic/subject — never prefix with "Taskset:"
    const displayName = String(tasksetName || topicTitle || title || topicLabel || subject || "Task Set").trim();

    // ── Tag trailing tasks as bonus / hidden ──
    // Every taskset gets +2 bonus tasks (early-finisher provision). They sit at
    // the end of the sequence and are marked requiredForCompletion:false +
    // unlockConditions:{ coreProgressPct: 100 } so they only surface to teams
    // that complete the core. Quest tasksets get an additional hidden task.
    if (Array.isArray(finalized) && finalized.length >= EARLY_FINISHER_BONUS_COUNT) {
      const totalBonusSlots = EARLY_FINISHER_BONUS_COUNT + (isQuestMode ? QUEST_HIDDEN_COUNT : 0);
      const n = finalized.length;
      // Bonus tasks (the always-on 2)
      const bonusStart = n - totalBonusSlots;
      const bonusEnd   = n - (isQuestMode ? QUEST_HIDDEN_COUNT : 0) - 1;
      for (let i = bonusStart; i <= bonusEnd; i++) {
        if (finalized[i] && typeof finalized[i] === "object") {
          finalized[i].isBonus = true;
          finalized[i].requiredForCompletion = false;
          // Default unlock at 50% core progress so early-finishers see bonuses in
          // time. Preserve any explicit coreProgressPct the AI already returned.
          const existing = finalized[i].unlockConditions;
          if (!existing || typeof existing !== "object" || existing.coreProgressPct === undefined) {
            finalized[i].unlockConditions = { coreProgressPct: 50 };
          }
        }
      }
      // Hidden task (quest mode only)
      if (isQuestMode && finalized[n - 1] && typeof finalized[n - 1] === "object") {
        finalized[n - 1].isHidden = true;
        finalized[n - 1].requiredForCompletion = false;
        finalized[n - 1].unlockConditions = { coreQuestCompleted: true, minRemainingMinutes: 8 };
      }
      console.log(`[AI] tagged early-finisher tasks: indices ${bonusStart}..${bonusEnd} as isBonus${isQuestMode ? `, ${n - 1} as isHidden` : ""}`);
    }

    // ── Escape Room: generate the lock/key/fragment config from curriculum terms ──
    // Wires keys[].grantedBy.taskId to actual task IDs in `finalized` so the
    // runtime engine grants keys as tasks complete.
    let escapeRoomConfig = null;
    if (isEscapeRoomMode) {
      try {
        const { generateEscapeRoomConfig } = await import("./escapeRoomGenerator.js");
        const termsArr = Array.isArray(narrativeTerms)
          ? narrativeTerms
          : String(narrativeTerms || aiWordBank || topicLabel || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        const genResult = await generateEscapeRoomConfig({
          gradeLevel, subject, lessonTopic: topicLabel,
          narrativeTerms: termsArr,
          theme: escapeRoomTheme,
          difficulty,
        });
        if (genResult.ok) {
          escapeRoomConfig = genResult.config;
        } else {
          console.warn("[AI] escape room generator fell back to skeleton:", genResult.error);
          escapeRoomConfig = genResult.skeleton;
        }
        // Distribute keys[].grantedBy.taskId across the first N core tasks
        const eligibleTaskIds = finalized
          .filter((t) => !t.isBonus && !t.isHidden)
          .map((t) => t.taskId || t._id || `idx-${finalized.indexOf(t)}`);
        for (let i = 0; i < (escapeRoomConfig?.keys || []).length; i++) {
          const k = escapeRoomConfig.keys[i];
          if (k.grantedBy && k.grantedBy.taskId == null && eligibleTaskIds[i]) {
            k.grantedBy.taskId = eligibleTaskIds[i];
          }
        }
      } catch (e) {
        console.error("[AI] escape room generation failed:", e?.message);
      }
    }

    // ✅ AUTO PLAYABILITY TEST + REPAIR — runs right after generation.
    // validateTaskByType checks the GENERATION schema; assessTaskPlayability
    // checks what the STUDENT renderer actually needs, so it catches
    // contract gaps that would otherwise only surface on a test-run. Any task
    // that fails gets ONE targeted regeneration (with the issue as the fix
    // hint); whatever still fails is reported so the teacher can act.
    sendSSE({ type: "phase", phase: "playability", message: "Testing tasks for playability…" });

    const scanPlayability = () => {
      const out = [];
      (Array.isArray(finalized) ? finalized : []).forEach((t, idx) => {
        if (!t) return;
        try {
          const pa = assessTaskPlayability(t);
          if (pa && pa.playable === false && Array.isArray(pa.issues) && pa.issues.length) {
            out.push({ index: idx, taskType: t.taskType || t.type || "unknown", title: t.title || "", issues: pa.issues });
          }
        } catch { /* never let the check break generation */ }
      });
      return out;
    };

    let playabilityIssues = scanPlayability();
    let playabilityRepaired = 0;
    let playabilityReplaced = 0;
    const repairLog = []; // per-task record → written to TaskDiagnosticLog (auto)

    if (playabilityIssues.length) {
      sendSSE({ type: "phase", phase: "playability", message: `Auto-repairing ${playabilityIssues.length} task(s)…` });
      // Fields to carry over so downstream wiring (bonus/hidden flags, fixed
      // stations, escape-room key→taskId, ordering) survives the regeneration.
      const PRESERVE = ["id", "isBonus", "requiredForCompletion", "unlockConditions", "isHidden", "displayKey", "stationColor", "_taskIndex"];
      // Up to 3 attempts per task — we really don't want to ship a broken set.
      // Each attempt is ADDITIVE (keep good content, top up the missing piece)
      // and the latest failure is fed back into the next attempt's hint.
      const MAX_REPAIR_ATTEMPTS = 3;
      for (const flag of playabilityIssues) {
        const idx = flag.index;
        const original = finalized[idx];
        if (!original) continue;
        const type = original.taskType || original.type;
        const assignedTerms = Array.isArray(conceptPlan[idx]) ? conceptPlan[idx] : [];
        const scopedLines = buildVocabularyLinesFromConcepts(assignedTerms);

        let prevAttempt = original;        // shown to the AI for reference
        let curIssues = flag.issues;       // what to fix this round
        let fixed = false;

        // Focused peer-editing repair: the passage is usually fine; it's just
        // missing the errors[] answer key. Rebuild ONLY the key for the existing
        // passage (reliable) before falling back to whole-task regeneration.
        if (type === TASK_TYPES.PEER_EDITING && (original.passage || original.text)) {
          try {
            const passage = String(original.passage || original.text || "");
            const rawErrs = await buildPeerEditingErrors(passage, { gradeLevel });
            if (Array.isArray(rawErrs) && rawErrs.length >= 3) {
              let pe = sanitizeTaskShapeByType(type, { ...original, passage, errors: rawErrs });
              for (const k of PRESERVE) { if (original[k] !== undefined) pe[k] = original[k]; }
              if (assessTaskPlayability(pe).playable !== false) {
                finalized[idx] = pe;
                playabilityRepaired += 1;
                fixed = true;
              }
            }
          } catch (e) {
            console.warn(`[AI] peer-editing key build failed for #${idx + 1}:`, e?.message || e);
          }
        }

        for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS && !fixed; attempt++) {
          try {
            const scopedConsiderations = [
              mergedSpecialConsiderations,
              assignedTerms.length
                ? `CONCEPT REQUIREMENTS\nYou MUST include ALL of these concepts in THIS ONE task: ${assignedTerms.join(", ")}`
                : "",
              [
                `PLAYABILITY FIX (ADDITIVE) — repair attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}`,
                `The previous version of this task is shown above for reference. It is NOT renderable for students because: ${curIssues.join("; ")}.`,
                "Repair it ADDITIVELY: KEEP every part of the previous task that is already correct, and only ADD or FIX the specific piece called out above.",
                "If the problem is simply too few items (e.g. it needs 4 clues but has 3, or needs 6 statements but has 4), RETURN THE EXISTING ITEMS UNCHANGED and APPEND the missing one(s), written in the same style/format as the existing ones. Do not rewrite or reorder the good items.",
              ].join("\n"),
            ].filter(Boolean).join("\n\n");

            let repaired = await regenerateSingleTask({
              allowedType: type,
              mustHave: retryMustHave[type] || "",
              subject, gradeLevel, difficulty, learningGoal, topicLabel,
              vocabularyLines: scopedLines,
              specialConsiderations: scopedConsiderations,
              previousTask: prevAttempt,
              previousError: curIssues.join("; "),
            });
            repaired = finalizeTask(type, repaired);
            for (const k of PRESERVE) { if (original[k] !== undefined) repaired[k] = original[k]; }

            const pa2 = assessTaskPlayability(repaired);
            if (!pa2 || pa2.playable !== false) {
              finalized[idx] = repaired;
              playabilityRepaired += 1;
              fixed = true;
              repairLog.push({
                taskIndex: idx, taskType: type, title: repaired.title || original.title || "",
                errors: flag.issues, fixed: true, aiRepaired: true,
                aiRepairError: `auto-repaired in place (attempt ${attempt})`,
              });
            } else {
              // Carry the latest (still-broken) version + its issues forward.
              prevAttempt = repaired;
              curIssues = (pa2 && Array.isArray(pa2.issues) && pa2.issues.length) ? pa2.issues : curIssues;
            }
          } catch (e) {
            console.warn(`[AI] playability auto-repair attempt ${attempt} failed for #${idx + 1} ${type}:`, e?.message || e);
          }
        }

        // ── DROP + REPLACE ── 3 additive attempts couldn't fix this task, so
        // we will NOT ship it broken. First try a couple of clean same-type
        // regenerations; if those also fail, drop it for a guaranteed-playable
        // open-text reflection on the same concepts so the slot is never empty
        // or broken.
        if (!fixed) {
          // (a) A couple of clean same-type regenerations.
          for (let r = 1; r <= 2 && !fixed; r++) {
            try {
              let fresh = await regenerateSingleTask({
                allowedType: type,
                mustHave: retryMustHave[type] || "",
                subject, gradeLevel, difficulty, learningGoal, topicLabel,
                vocabularyLines: scopedLines,
                specialConsiderations: [
                  mergedSpecialConsiderations,
                  assignedTerms.length ? `CONCEPT REQUIREMENTS\nInclude these concepts: ${assignedTerms.join(", ")}` : "",
                  "Generate a COMPLETE, fresh task of this type from scratch. Include EVERY required field and the FULL minimum number of items — the previous version was missing required content.",
                ].filter(Boolean).join("\n\n"),
                previousTask: null,
              });
              fresh = finalizeTask(type, fresh);
              for (const k of PRESERVE) { if (original[k] !== undefined) fresh[k] = original[k]; }
              const pa3 = assessTaskPlayability(fresh);
              if (!pa3 || pa3.playable !== false) {
                finalized[idx] = fresh;
                playabilityReplaced += 1;
                fixed = true;
                repairLog.push({
                  taskIndex: idx, taskType: type, title: fresh.title || "",
                  errors: flag.issues, fixed: true, aiRepaired: true,
                  aiRepairError: `replaced with a fresh ${type} (same type)`,
                  rawTask: original,
                });
              }
            } catch (e) {
              console.warn(`[AI] replacement regen ${r} failed for #${idx + 1} ${type}:`, e?.message || e);
            }
          }

          // (b) A reliable ALTERNATE type on the same concepts — a real graded
          // task rather than a reflection, so the slot stays high-quality.
          const ALT_TYPES = [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.SHORT_ANSWER, TASK_TYPES.TRUE_FALSE];
          for (const altType of ALT_TYPES) {
            if (fixed) break;
            try {
              let alt = await regenerateSingleTask({
                allowedType: altType,
                mustHave: retryMustHave[altType] || "",
                subject, gradeLevel, difficulty, learningGoal, topicLabel,
                vocabularyLines: scopedLines,
                specialConsiderations: [
                  mergedSpecialConsiderations,
                  assignedTerms.length ? `CONCEPT REQUIREMENTS\nInclude these concepts: ${assignedTerms.join(", ")}` : "",
                  `This replaces a ${type} task that could not be generated correctly. Make a complete, self-contained ${altType} task on the same material.`,
                ].filter(Boolean).join("\n\n"),
                previousTask: null,
              });
              alt = finalizeTask(altType, alt);
              for (const k of PRESERVE) { if (original[k] !== undefined) alt[k] = original[k]; }
              const paAlt = assessTaskPlayability(alt);
              if (!paAlt || paAlt.playable !== false) {
                finalized[idx] = alt;
                playabilityReplaced += 1;
                fixed = true;
                repairLog.push({
                  taskIndex: idx, taskType: type, title: alt.title || "",
                  errors: flag.issues, fixed: true, aiRepaired: true,
                  aiRepairError: `unfixable ${type} → replaced with a ${altType} on the same concepts`,
                  rawTask: original,
                });
              }
            } catch (e) {
              console.warn(`[AI] alternate-type replacement (${altType}) failed for #${idx + 1} ${type}:`, e?.message || e);
            }
          }

          // (c) Guaranteed-playable last resort: open-text only needs title +
          // prompt, so it ALWAYS renders.
          if (!fixed) {
            const topicForPrompt = assignedTerms.length
              ? assignedTerms.join(", ")
              : (topicLabel || subject || "today's lesson");
            const fallback = finalizeTask(TASK_TYPES.OPEN_TEXT, {
              taskType: TASK_TYPES.OPEN_TEXT,
              title: `Reflect: ${(original.title || topicLabel || subject || "Your Thinking")}`.slice(0, 80),
              prompt: `In a few clear sentences, explain what you understand about ${topicForPrompt}. Include a definition in your own words and one example.`,
            });
            for (const k of PRESERVE) { if (original[k] !== undefined) fallback[k] = original[k]; }
            finalized[idx] = fallback;
            playabilityReplaced += 1;
            fixed = true;
            repairLog.push({
              taskIndex: idx, taskType: type, title: fallback.title || "",
              errors: flag.issues, fixed: true, aiRepaired: true,
              aiRepairError: `unfixable ${type} → dropped, replaced with open-text reflection (LAST RESORT — review this type)`,
              rawTask: original,
            });
            console.warn(`[AI] playability: dropped unfixable #${idx + 1} ${type} → replaced with open-text reflection`);
          }
        }
      }
      // Re-scan to see what (if anything) still fails after all repair attempts.
      playabilityIssues = scanPlayability();
    }

    if (playabilityRepaired || playabilityReplaced || playabilityIssues.length) {
      console.warn(`[AI] playability: auto-repaired ${playabilityRepaired}, replaced ${playabilityReplaced}, ${playabilityIssues.length} still flagged`);
    }

    const fixedTotal = playabilityRepaired + playabilityReplaced;
    const fixedNote = fixedTotal
      ? ` (auto-fixed ${fixedTotal}${playabilityReplaced ? `, ${playabilityReplaced} replaced` : ""})`
      : "";
    sendSSE({
      type: "phase",
      phase: "playability",
      message: playabilityIssues.length
        ? `⚠️ ${playabilityIssues.length} task(s) still need attention${fixedNote}`
        : (fixedTotal ? `✅ All tasks playable${fixedNote}` : "✅ All tasks playable"),
      playabilityIssues,
      playabilityRepaired,
      playabilityReplaced,
    });

    const doc = await TaskSet.create({
      name: displayName,
      title: displayName,
      subject,
      gradeLevel,
      difficulty,
      learningGoal,
      topicLabel,
      durationMinutes: durationMinutes || undefined,
      tasks: finalized,
      ...(displays.length > 0 ? { displays } : {}),
      ...(isAtDeskOnly ? { atDeskOnly: true } : {}),
      ...(isQuestMode ? { questModeEnabled: true } : {}),
      ...(escapeRoomConfig ? { escapeRoomConfig } : {}),
      ...(duelsEnabled === true ? { duelsEnabled: true } : {}),
      meta: {
        pool,
        regeneratedCount: errors.length,
        errors,
        coverage,
        coverageFixes: fixes,
        // Auto playability test result (render-contract check). Empty issues[]
        // means every task is renderable for students. repairedCount = fixed in
        // place; replacedCount = dropped + swapped for a playable task.
        playability: {
          checkedAt: new Date(),
          issues: playabilityIssues,
          repairedCount: playabilityRepaired,
          replacedCount: playabilityReplaced,
        },
        generation: {
          report: generationReport,
          ...(overusedTerms.length > 0 && { qualityWarnings: { overusedTerms } }),
        },
        // nice for teacher-facing "what was planned"
        conceptAllocation: {
          requestedConcepts,
          perTask: conceptPlan.map((terms, idx) => ({
            index: idx,
            taskType: pool[idx % pool.length],
            terms,
          })),
        },
      },
    });

    // Report any auto-repairs/replacements to the diagnostic log so they show
    // up in the admin panel and we can address task types that keep failing —
    // especially the open-text "last resort" drops.
    if (repairLog.length) {
      try {
        await TaskDiagnosticLog.create({
          tasksetId: String(doc._id),
          tasksetName: displayName,
          triggeredBy: "auto",
          teacherNote: "Auto playability repair during generation",
          totalTasks: Array.isArray(finalized) ? finalized.length : 0,
          issuesFound: repairLog.length,
          issuesFixed: playabilityRepaired,
          aiRepaired: playabilityRepaired + playabilityReplaced,
          diagnostics: repairLog,
        });
      } catch (logErr) {
        console.error("[AI] failed to write auto diagnostic log:", logErr?.message);
      }
    }

    if (wantsStream) {
      sendSSE({ type: "complete", ok: true, taskset: doc });
      return res.end();
    }
    return res.json({ ok: true, taskset: doc });
  } catch (err) {
    if (wantsStream) {
      sendSSE({ type: "error", error: String(err?.message || err) });
      return res.end();
    }
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
