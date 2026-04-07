// backend/controllers/mainTasksetController.js
import TaskSet from "../models/TaskSet.js";
import TeacherProfile from "../models/TeacherProfile.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { normalizeTaskByType } from "../validators/taskValidators.js";
import {
  normalizeSelectedType,
  extractJsonFromText,
  assertValidAiTask,
  retryMustHave,
  buildVocabularyLines,
  regenerateSingleTask,
} from "./sharedTasksetController.js";
import { buildTasksetPrompt } from "./sharedTasksetController.js";

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
function getGenerationEligibleTypes() {
  const eligible = [];

  for (const t of Object.values(TASK_TYPES)) {
    const meta = TASK_TYPE_META?.[t];

    // only implemented types (or those not explicitly false)
    if (!meta || meta.implemented === false) continue;

    // avoid special meta-only types unless you explicitly want them
    if (t === TASK_TYPES.TASK_RUNNER) continue;

    eligible.push(t);
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
// Task-shape sanitizer
// Key rule: Multiple Choice & Physical Multiple Choice must NOT use config.items.
// Promote config.items -> top-level items[] if needed, then delete config.items.
// This reduces avoidable regeneration attempts.
// ------------------------------------------------------------
function sanitizeTaskShapeByType(type, task) {
  if (!task || typeof task !== "object") return task;
  const t = { ...task };

  if (type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
    const cfg = t.config && typeof t.config === "object" ? { ...t.config } : null;

    if ((!Array.isArray(t.items) || t.items.length === 0) && Array.isArray(cfg?.items) && cfg.items.length > 0) {
      t.items = cfg.items;
    }

    if (cfg && "items" in cfg) delete cfg.items;

    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  return t;
}


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
  return left.length >= 5 && right.length >= 5 && !!cm;
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
  return clues.length >= 3;
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

  // Ensure points default
  if (typeof normalized.points !== "number" || normalized.points <= 0) {
    normalized.points = 10;
  }

  return normalized;
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
    specialConsiderations
  );

  const request = {
    model: process.env.AI_MODEL || "gpt-4.1-mini",
    temperature,
    max_completion_tokens: 2600,
    messages: [{ role: "user", content: prompt }],
  };

  // Prefer guaranteed JSON object when supported
  if (!process.env.AI_DISABLE_JSON_RESPONSE_FORMAT) {
    request.response_format = { type: "json_object" };
  }

  const completion = await client.chat.completions.create(request);
  const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";

  const parsed = extractJsonFromText(raw);

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

  if (!Array.isArray(tasks)) {
    throw new Error('AI did not return a JSON object with a "tasks" array.');
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

function _parseConceptList(aiWordBank) {
  const raw = Array.isArray(aiWordBank) ? aiWordBank : String(aiWordBank || "").split(/\r?\n/);

  // de-dupe while preserving order
  const seen = new Set();
  const concepts = [];

  for (const r of raw) {
    const t = _normalizeConcept(r);
    if (!t) continue;
    if (seen.has(t)) continue;
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
  [TASK_TYPES.MULTIPLE_CHOICE]: 3,
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: 3,
  [TASK_TYPES.TRUE_FALSE]: 2,
  [TASK_TYPES.SHORT_ANSWER]: 2,
  [TASK_TYPES.FLASHCARDS]: 6,
  [TASK_TYPES.FLASHCARDS_RACE]: 6,
  [TASK_TYPES.MATCHING]: 6,
  [TASK_TYPES.SORT]: 6,
  [TASK_TYPES.VENNSORT]: 6,
  [TASK_TYPES.SEQUENCE]: 4,
  [TASK_TYPES.TIMELINE]: 4,
  [TASK_TYPES.HANGMAN_DUEL]: 4,
  // Known finicky type: keep it light
  [TASK_TYPES.MUSICAL_CHAIRS]: 2,
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

  // Round-robin assignment across tasks, respecting per-type caps.
  let p = 0;

  // First ensure every concept is assigned at least once (if capacity allows).
  // We loop tasks until we run out of concepts, wrapping tasks as needed.
  for (let c = 0; c < concepts.length; c++) {
    const i = c % safeCount;
    const taskType = pool[i % pool.length];
    const cap = getConceptCapForType(taskType);

    if (plan[i].length < cap) {
      plan[i].push(concepts[p]);
      p++;
    } else {
      // Find next task with room
      let found = false;
      for (let j = 0; j < safeCount; j++) {
        const k = (i + j) % safeCount;
        const tt = pool[k % pool.length];
        const cap2 = getConceptCapForType(tt);
        if (plan[k].length < cap2) {
          plan[k].push(concepts[p]);
          p++;
          found = true;
          break;
        }
      }
      if (!found) break; // no capacity; rare unless concepts are enormous
    }

    if (p >= concepts.length) break;
  }

  // If there is still room, we can cycle again to reinforce (optional).
  // But keep it modest: only add a second pass if there's room.
  let safety = 0;
  while (p < concepts.length && safety++ < safeCount * 3) {
    const i = p % safeCount;
    const taskType = pool[i % pool.length];
    const cap = getConceptCapForType(taskType);
    if (plan[i].length < cap) {
      plan[i].push(concepts[p]);
      p++;
    } else {
      p++;
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

  // Try a few passes; each pass targets a few missing terms.
  const maxPasses = 3;
  const maxTermsPerFix = 6;

  let coverage = computeCoverageReport(aiWordBank, finalized);
  if (!coverage.missingCount) return { coverage, fixes };

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (!coverage.missingCount) break;

    // Pick a task index to regenerate:
    // Prefer a task type that tends to include explicit vocab naturally.
    let idx = finalized.findIndex((t) => COVERAGE_FIX_PREFERRED_TYPES.has(t?.taskType));
    if (idx < 0) idx = 0;

    const targetTask = finalized[idx];
    const allowedType = targetTask?.taskType || finalized[0]?.taskType || TASK_TYPES.MULTIPLE_CHOICE;
    const mustHave = retryMustHave[allowedType] || "";

    const targetTerms = coverage.missing.slice(0, maxTermsPerFix);
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

    const maxAttempts = allowedType === TASK_TYPES.MUSICAL_CHAIRS ? 15 : 8;

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
          // Use ONLY the missing terms to keep the prompt tight.
          vocabularyLines: scopedLines,
          specialConsiderations: fixNote,
          previousTask: attemptTask,
        });

        const fin = finalizeTask(allowedType, attemptTask);
        taskMustIncludeTermsOrThrow(fin, targetTerms);
        finalized[idx] = fin;
        success = true;
        break;
      } catch (e) {
        lastErr = e;
        errors.push({
          phase: "coverage-fix",
          pass,
          index: idx,
          taskType: allowedType,
          attempt,
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
      count,
      specialConsiderations = "",
      topicDescription = "",
    } = req.body || {};

    // Frontend sends topicDescription; merge with specialConsiderations if both present
    const effectiveSpecialConsiderations =
      [specialConsiderations, topicDescription].map(s => String(s || "").trim()).filter(Boolean).join("\n\n");

    const safeCount = clampInt(count, 1, 30, 12);

    const eligible = getGenerationEligibleTypes();
    const normalizedPool =
      Array.isArray(taskTypePool) && taskTypePool.length
        ? taskTypePool.map(normalizeSelectedType).filter(Boolean)
        : eligible;

    const pool = normalizedPool.filter((t) => eligible.includes(t));
    if (!pool.length) {
      if (wantsStream) {
        sendSSE({ type: "error", error: "No eligible task types provided." });
        return res.end();
      }
      return res.status(400).json({ ok: false, error: "No eligible task types provided." });
    }

    // ✅ Ensure at least one physical/movement task is in the pool.
    // Rule: 1 physical task for ≤10 tasks, or 1 per every 4 tasks for larger sets.
    const PHYSICAL_TYPES = [
      TASK_TYPES.BODY_BREAK,
      TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE,
      TASK_TYPES.MAD_DASH,
      TASK_TYPES.MAD_DASH_SEQUENCE,
    ];
    const physicalInPool = pool.filter((t) => PHYSICAL_TYPES.includes(t));
    const neededPhysical = safeCount <= 10 ? 1 : Math.floor(safeCount / 4);
    if (physicalInPool.length < neededPhysical) {
      // Pick from eligible physical types to fill the gap
      const eligiblePhysical = PHYSICAL_TYPES.filter((t) => eligible.includes(t));
      if (eligiblePhysical.length > 0) {
        const toAdd = neededPhysical - physicalInPool.length;
        for (let p = 0; p < toAdd; p++) {
          const pick = eligiblePhysical[p % eligiblePhysical.length];
          // Insert at evenly-spaced positions so physical tasks are spread throughout the set
          const insertAt = Math.round((pool.length / (toAdd + 1)) * (p + 1));
          pool.splice(Math.min(insertAt, pool.length), 0, pick);
        }
        console.log(`[AI] Injected ${toAdd} physical task(s) into pool (${neededPhysical} needed for ${safeCount} tasks)`);
      }
    }

    // ✅ Profile-driven "lens" injection (NOT Christian-only; teacher profile determines lens)
    let mergedSpecialConsiderations = String(effectiveSpecialConsiderations || "").trim();
    try {
      const teacherProfile = await loadTeacherProfileForRequest(req);
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

    let rawTasks = await generateTasksArray({
      typePool: pool,
      count: safeCount,
      subject,
      gradeLevel,
      difficulty,
      learningGoal,
      topicLabel,
      vocabularyLines: initialVocabularyLines,
      specialConsiderations: mergedSpecialConsiderations,
    });

    const finalized = [];
    const errors = [];
    const attemptsByTask = [];

    for (let i = 0; i < safeCount; i++) {
      const expectedType = pool[i % pool.length];
      const candidate = rawTasks[i] || null;

      const mustHave = retryMustHave[expectedType] || "";
      const maxAttempts = expectedType === TASK_TYPES.MUSICAL_CHAIRS ? 15 : 10;

      // Concepts this task MUST include
      const assignedTerms = Array.isArray(conceptPlan[i]) ? conceptPlan[i] : [];
      const scopedLines = buildVocabularyLinesFromConcepts(assignedTerms);

      const scopedConsiderations = [
        mergedSpecialConsiderations,
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

      let attemptTask = candidate && typeof candidate === "object" ? candidate : null;
      let lastErr = null;
      let success = false;
      let usedAttempts = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        usedAttempts = attempt;
        try {
          if (!attemptTask) throw new Error("Missing or invalid task object.");

          const fin = finalizeTask(expectedType, attemptTask);

          // ✅ Check assigned concepts per-task — warn but don't block on missing ones
          const missingTerms = taskMustIncludeTermsOrThrow(fin, assignedTerms, { warnOnly: true });

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

          attemptTask = await regenerateSingleTask({
            allowedType: expectedType,
            mustHave,
            subject,
            gradeLevel,
            difficulty,
            learningGoal,
            topicLabel,
            // ✅ Only give the subset for this task
            vocabularyLines: scopedLines,
            specialConsiderations: scopedConsiderations,
            previousTask: attemptTask,
          });
        }
      }

      if (!success) {
        throw lastErr || new Error(`Failed to generate task for ${expectedType}`);
      }

      // record how many attempts this slot used (1 = first-pass success)
      attemptsByTask.push(Math.max(1, usedAttempts || 1));

      // 🔴 Progress event: tell the client one more task is done
      sendSSE({ type: "progress", done: finalized.length, total: safeCount, taskType: expectedType });
    }

    // ✅ Coverage report + auto-fix (still valuable as a final pass)
    let coverage = computeCoverageReport(aiWordBank, finalized);
    const { coverage: coverageAfterFix, fixes } = await attemptAutoFixCoverage({
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
    coverage = coverageAfterFix || coverage;

    // ✅ Teacher-facing report (actual coverage + Bloom + efficiency)
    const generationReport = buildGenerationReport({
      aiWordBank,
      finalized,
      pool,
      conceptPlan,
      attemptsByTask,
      errors,
    });

    // Use the user-entered title first, fall back to topic/subject — never prefix with "Taskset:"
    const displayName = String(tasksetName || topicTitle || title || topicLabel || subject || "Task Set").trim();

    const doc = await TaskSet.create({
      name: displayName,
      title: displayName,
      subject,
      gradeLevel,
      difficulty,
      learningGoal,
      topicLabel,
      tasks: finalized,
      meta: {
        pool,
        regeneratedCount: errors.length,
        errors,
        coverage,
        coverageFixes: fixes,
        generation: {
          report: generationReport,
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
