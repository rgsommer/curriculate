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
import { getTimingStatsForGenerator } from "../services/taskTypeTimingAggregator.js";

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
function buildDiversePool(availableTypes, count, guaranteedTypes = []) {
  // Pure physical/movement break types (NOT PMC — that's academic with movement)
  const PHYSICAL_BODY_BREAK_TYPES = new Set([
    TASK_TYPES.BODY_BREAK,
    TASK_TYPES.MAD_DASH,
    TASK_TYPES.MAD_DASH_SEQUENCE,
  ]);

  const catOf = (t) => {
    const meta = TASK_TYPE_META?.[t];
    return String(meta?.category || "other").toLowerCase();
  };

  // Split available types into physical and academic
  const physicalTypes = availableTypes.filter((t) => PHYSICAL_BODY_BREAK_TYPES.has(t));
  const academicTypes = availableTypes.filter((t) => !PHYSICAL_BODY_BREAK_TYPES.has(t));

  // Group academic types by category for variety
  const byCat = {};
  for (const t of academicTypes) {
    const cat = catOf(t);
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(t);
  }
  // Shuffle within each category
  for (const arr of Object.values(byCat)) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  // Shuffle physical types too
  for (let i = physicalTypes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [physicalTypes[i], physicalTypes[j]] = [physicalTypes[j], physicalTypes[i]];
  }

  // Build interleaved academic list: round-robin across categories for max variety
  const catKeys = Object.keys(byCat);
  // Shuffle category order
  for (let i = catKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [catKeys[i], catKeys[j]] = [catKeys[j], catKeys[i]];
  }
  const catIdx = {};
  for (const k of catKeys) catIdx[k] = 0;

  const academicQueue = [];
  const usedTypes = new Set();
  let round = 0;
  while (academicQueue.length < count * 2 && round < 20) {
    let added = false;
    for (const cat of catKeys) {
      const arr = byCat[cat];
      if (catIdx[cat] < arr.length) {
        const t = arr[catIdx[cat]];
        if (!usedTypes.has(t)) {
          academicQueue.push(t);
          usedTypes.add(t);
          added = true;
        }
        catIdx[cat]++;
      }
    }
    if (!added) {
      // All unique types exhausted; allow repeats
      for (const cat of catKeys) catIdx[cat] = 0;
      usedTypes.clear();
      round++;
    }
  }

  // Now build the final pool: insert physical every 4–5 academic tasks
  const pool = [];
  let academicSincePhysical = 0;
  let physIdx = 0;
  let acaIdx = 0;
  const physicalInterval = 5; // physical after every 4-5 academic tasks

  for (let i = 0; i < count; i++) {
    if (
      academicSincePhysical >= physicalInterval - 1 &&
      physicalTypes.length > 0 &&
      i < count - 1 // don't end on a physical
    ) {
      pool.push(physicalTypes[physIdx % physicalTypes.length]);
      physIdx++;
      academicSincePhysical = 0;
    } else if (acaIdx < academicQueue.length) {
      pool.push(academicQueue[acaIdx]);
      acaIdx++;
      academicSincePhysical++;
    } else if (physicalTypes.length > 0) {
      pool.push(physicalTypes[physIdx % physicalTypes.length]);
      physIdx++;
      academicSincePhysical = 0;
    } else {
      // Fallback: repeat from available
      pool.push(availableTypes[i % availableTypes.length]);
    }
  }

  // Inject guaranteed types: ensure each appears at least once in the pool
  if (guaranteedTypes.length > 0) {
    const uniqueGuaranteed = [...new Set(guaranteedTypes)];

    if (uniqueGuaranteed.length >= count) {
      // Guaranteed types fill or exceed the pool — use them directly
      // Shuffle so the order isn't predictable
      const shuffled = [...uniqueGuaranteed];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      pool.length = 0;
      pool.push(...shuffled.slice(0, count));
    } else {
      // Fewer guaranteed types than pool slots — replace non-guaranteed slots
      // First, identify which guaranteed types are already in the pool
      const missing = uniqueGuaranteed.filter((g) => !pool.includes(g));
      // Replace slots occupied by non-guaranteed types (prefer duplicates first)
      for (const gType of missing) {
        let replaced = false;
        // Pass 1: replace a non-guaranteed duplicate (type appears more than once)
        for (let i = pool.length - 1; i >= 0; i--) {
          const t = pool[i];
          if (uniqueGuaranteed.includes(t)) continue; // don't evict another guaranteed type
          if (pool.indexOf(t) !== i) {
            pool[i] = gType;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          // Pass 2: replace any non-guaranteed type (last occurrence)
          for (let i = pool.length - 1; i >= 0; i--) {
            if (!uniqueGuaranteed.includes(pool[i])) {
              pool[i] = gType;
              replaced = true;
              break;
            }
          }
        }
        if (!replaced) {
          // All slots are guaranteed types already — append and we'll trim
          pool.push(gType);
        }
      }
      // Trim back to count if we overflowed
      if (pool.length > count) pool.length = count;
    }
    console.log(`[AI] Guaranteed types injected (${uniqueGuaranteed.length}): ${uniqueGuaranteed.join(", ")}`);
  }

  // Verify no more than 2 consecutive same-category (swap if needed)
  for (let i = 2; i < pool.length; i++) {
    if (catOf(pool[i]) === catOf(pool[i - 1]) && catOf(pool[i]) === catOf(pool[i - 2])) {
      // Find a later slot with a different category and swap
      for (let j = i + 1; j < pool.length; j++) {
        if (catOf(pool[j]) !== catOf(pool[i])) {
          [pool[i], pool[j]] = [pool[j], pool[i]];
          break;
        }
      }
    }
  }

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

  // ── VENNSORT: Build correctAnswer from item category data if missing ──
  if (type === TASK_TYPES.VENNSORT) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    const cats = Array.isArray(cfg.categories) ? cfg.categories : [];
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const hasCA = t.correctAnswer && typeof t.correctAnswer === "object" && Object.keys(t.correctAnswer).length > 0;

    // Promote categories / items from top-level if config is empty
    if (cats.length === 0 && Array.isArray(t.categories) && t.categories.length >= 2) {
      cfg.categories = t.categories;
    }
    if (items.length === 0 && Array.isArray(t.items) && t.items.length >= 5) {
      cfg.items = t.items;
    }
    if (!t.config || typeof t.config !== "object") t.config = {};
    if (cfg.categories) t.config.categories = cfg.categories;
    if (cfg.items) t.config.items = cfg.items;

    const finalCats = Array.isArray(t.config.categories) ? t.config.categories : [];
    const finalItems = Array.isArray(t.config.items) ? t.config.items : [];

    if (!hasCA && finalItems.length > 0 && finalCats.length >= 2) {
      // AI often puts category data on each item — try to reconstruct correctAnswer
      const built = {};
      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        if (!it || typeof it !== "object") continue;

        const itemId = it.id || it.itemId || `item-${i}-${(it.text || it.label || it.name || "").replace(/\s+/g, "")}`;
        // Normalize item ID on the object too
        if (!it.id) it.id = itemId;

        // Look for category assignments in common AI patterns
        let assignedCats = null;
        if (Array.isArray(it.categories) && it.categories.length > 0) {
          assignedCats = it.categories;
        } else if (Array.isArray(it.correctCategories) && it.correctCategories.length > 0) {
          assignedCats = it.correctCategories;
        } else if (typeof it.category === "string" && it.category) {
          assignedCats = [it.category];
        } else if (typeof it.correctCategory === "string" && it.correctCategory) {
          assignedCats = [it.correctCategory];
        } else if (typeof it.placement === "string" && it.placement) {
          // Sometimes AI uses "placement": "Both" or "placement": "CategoryA"
          if (it.placement.toLowerCase() === "both" && finalCats.length === 2) {
            assignedCats = [...finalCats];
          } else {
            assignedCats = [it.placement];
          }
        } else if (typeof it.region === "string" && it.region) {
          assignedCats = [it.region];
        } else if (typeof it.zone === "string" && it.zone) {
          assignedCats = [it.zone];
        } else if (Array.isArray(it.belongsTo) && it.belongsTo.length > 0) {
          assignedCats = it.belongsTo;
        }

        if (assignedCats && assignedCats.length > 0) {
          // Validate that categories reference actual category names
          const validCats = assignedCats.filter((c) =>
            finalCats.some((fc) => {
              const fcStr = typeof fc === "string" ? fc : fc?.label || fc?.name || "";
              return fcStr.toLowerCase() === String(c).toLowerCase();
            })
          );
          // Map back to the canonical category name (preserving original casing)
          const canonicalCats = validCats.map((c) => {
            const match = finalCats.find((fc) => {
              const fcStr = typeof fc === "string" ? fc : fc?.label || fc?.name || "";
              return fcStr.toLowerCase() === String(c).toLowerCase();
            });
            return typeof match === "string" ? match : match?.label || match?.name || String(c);
          });
          if (canonicalCats.length > 0) {
            built[itemId] = canonicalCats;
          }
        }
      }

      if (Object.keys(built).length >= 5) {
        t.correctAnswer = built;
        console.log(`[sanitize] Built vennsort correctAnswer from item data (${Object.keys(built).length} entries)`);
      }
    }
  }

  // ── Script Play: coerce common AI shapes into lines[] ──
  if (type === TASK_TYPES.SCRIPT_PLAY) {
    // Helper: flatten a beat/scene object into "Speaker: line" strings
    const flattenObj = (l) => {
      if (typeof l === "string") return [l.trim()];
      if (l && typeof l === "object") {
        const speaker = String(l.speaker || l.character || l.name || l.role || "").trim();

        // Beat objects may have lines[] (array of strings) inside them
        const innerLines = Array.isArray(l.lines) ? l.lines : Array.isArray(l.dialogue) ? l.dialogue : null;
        if (innerLines && innerLines.length) {
          return innerLines.map((il) => {
            const txt = String(typeof il === "string" ? il : il?.text || il?.line || il?.say || "").trim();
            return txt ? (speaker ? `${speaker}: ${txt}` : txt) : "";
          }).filter(Boolean);
        }

        const text = String(l.text || l.line || l.say || l.dialogue || "").trim();
        if (!text) return [];
        return [speaker ? `${speaker}: ${text}` : text];
      }
      return [];
    };

    let lines =
      (Array.isArray(t.lines) && t.lines.length && t.lines) ||
      (Array.isArray(t.config?.lines) && t.config.lines.length && t.config.lines) ||
      (Array.isArray(t.dialogue) && t.dialogue.length && t.dialogue) ||
      (Array.isArray(t.config?.dialogue) && t.config.dialogue.length && t.config.dialogue) ||
      // beats[] — the schema example format with nested lines per beat
      (Array.isArray(t.config?.beats) && t.config.beats.length && t.config.beats) ||
      (Array.isArray(t.beats) && t.beats.length && t.beats) ||
      (Array.isArray(t.scenes) && t.scenes.length && t.scenes) ||
      (Array.isArray(t.config?.scenes) && t.config.scenes.length && t.config.scenes) ||
      null;

    // AI sometimes returns a single "script" string block — split on newlines
    if (!lines) {
      const blob = String(t.script || t.config?.script || t.text || t.config?.text || "").trim();
      if (blob) {
        lines = blob.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      }
    }

    // Flatten all entries (handles beats with nested lines[], scene objects, plain strings)
    if (lines) {
      lines = lines.flatMap(flattenObj).filter(Boolean);
      t.lines = lines;
      if (t.config && typeof t.config === "object") t.config.lines = lines;
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
  // High-capacity: these task types naturally incorporate many terms
  [TASK_TYPES.FLASHCARDS]: 8,
  [TASK_TYPES.FLASHCARDS_RACE]: 8,
  [TASK_TYPES.MATCHING]: 8,
  [TASK_TYPES.SORT]: 6,
  [TASK_TYPES.VENNSORT]: 6,
  [TASK_TYPES.READING_COMP]: 5,
  [TASK_TYPES.PET_FEEDING]: 5,
  [TASK_TYPES.BRAIN_BLITZ]: 5,
  [TASK_TYPES.GUESS_WHO]: 5,
  [TASK_TYPES.NARRATION_SYNTHESIZE]: 5,

  // Medium-capacity: can work with several terms
  [TASK_TYPES.MULTIPLE_CHOICE]: 4,
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: 4,
  [TASK_TYPES.SEQUENCE]: 4,
  [TASK_TYPES.TIMELINE]: 4,
  [TASK_TYPES.SHORT_ANSWER]: 4,
  [TASK_TYPES.TRUE_FALSE]: 6,
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: 4,
  [TASK_TYPES.FAKE_OUT]: 5,
  [TASK_TYPES.ECHO_CHAIN]: 4,
  [TASK_TYPES.COLLABORATION]: 4,
  [TASK_TYPES.BRAINSTORM_BATTLE]: 4,
  [TASK_TYPES.MAD_DASH_SEQUENCE]: 4,
  [TASK_TYPES.WORD_WEAVER_DUEL]: 4,
  [TASK_TYPES.HANGMAN_DUEL]: 4,
  [TASK_TYPES.ROLE_PLAY_DECK]: 4,
  [TASK_TYPES.SCRIPT_PLAY]: 4,
  [TASK_TYPES.MIND_MAPPER]: 5,
  [TASK_TYPES.BRAIN_SPARK_NOTES]: 4,
  [TASK_TYPES.LIVE_DEBATE]: 3,
  [TASK_TYPES.OPEN_TEXT]: 3,
  [TASK_TYPES.PRONUNCIATION]: 4,
  [TASK_TYPES.SPEECH_RECOGNITION]: 4,

  // Low-capacity: keep these light
  [TASK_TYPES.DRAW]: 2,
  [TASK_TYPES.DRAW_MIME]: 2,
  [TASK_TYPES.MIME]: 2,
  [TASK_TYPES.RECORD_AUDIO]: 3,
  [TASK_TYPES.PHOTO]: 2,
  [TASK_TYPES.PHOTO_JOURNAL]: 2,
  [TASK_TYPES.MAKE_AND_SNAP]: 2,
  [TASK_TYPES.MUSICAL_CHAIRS]: 2,       // Known finicky type: keep it light
  [TASK_TYPES.MOTION_MISSION]: 2,
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

  // ── Pass 3: Reinforce — repeat concepts to fill remaining capacity ──
  // Tasks with room get additional (duplicate) concepts so more tasks
  // reference the vocabulary, improving student reinforcement.
  if (concepts.length > 0) {
    let rIdx = 0;
    for (const slot of slotsByCapDesc) {
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
    } = req.body || {};

    // Accept either key the frontend might send
    const durationMinutes = Number(totalDurationMinutes || durationMinutesBody) || null;

    // Frontend sends topicDescription; merge with specialConsiderations if both present
    const effectiveSpecialConsiderations =
      [specialConsiderations, topicDescription].map(s => String(s || "").trim()).filter(Boolean).join("\n\n");

    // Accept either key the frontend might send for count
    const safeCount = clampInt(count || numberOfTasks, 1, 30, 12);

    const eligible = getGenerationEligibleTypes(subject);

    // Accept either key the frontend might send for the type pool
    const rawPool = taskTypePool || requiredTaskTypes;
    const userPool =
      Array.isArray(rawPool) && rawPool.length
        ? rawPool.map(normalizeSelectedType).filter(Boolean).filter((t) => eligible.includes(t))
        : null;

    // Resolve guaranteed types (must appear in pool regardless of limit setting)
    const guaranteed =
      Array.isArray(guaranteedTaskTypes) && guaranteedTaskTypes.length
        ? guaranteedTaskTypes.map(normalizeSelectedType).filter(Boolean).filter((t) => eligible.includes(t))
        : [];

    // Build the actual N-slot pool with enforced variety + guaranteed types first
    const pool = buildDiversePool(userPool || eligible, safeCount, guaranteed);
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
      timingContext,
    });

    sendSSE({ type: "phase", phase: "finalizing", message: "Validating and finalizing tasks…" });

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

      const candidate = rawTasks[i] || null;

      const mustHave = retryMustHave[expectedType] || "";
      const maxAttempts = expectedType === TASK_TYPES.MUSICAL_CHAIRS ? 6 : 4;

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

      // Prefer single words (no spaces/hyphens) — much better for Hangman
      const isHangmanFriendly = (w) => !/[\s\-]/.test(w) && w.length >= 3 && w.length <= 14;

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
        // Last resort: if still < TARGET, fill from allWords (prefer hangman-friendly, then any)
        if (picked.length < TARGET) {
          const used = new Set(picked.map((w) => w.toLowerCase()));
          const friendly = allWords.filter((w) => isHangmanFriendly(w) && !used.has(w.toLowerCase()));
          const unfriendly = allWords.filter((w) => !isHangmanFriendly(w) && !used.has(w.toLowerCase()));
          for (const w of [...friendly, ...unfriendly]) {
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
      durationMinutes: durationMinutes || undefined,
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
