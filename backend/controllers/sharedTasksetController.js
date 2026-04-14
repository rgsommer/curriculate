// backend/controllers/sharedTasksetController.js
//
// Shared AI-task generation helpers used by BOTH:
// - mainTasksetController (full taskset generation)
// - demoTasksetController (SSE per-type demo generation)
//
// Goal: keep core prompt construction + strict validation in ONE place,
// so controllers stay thin and we avoid patch-on-patch divergence.

import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { sanitizeTaskShapeByType } from "./sanitizeTaskShape.js";

/* ============================================================
   OpenAI client
   ============================================================ */

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[sharedTasksetController] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}
const client = new Proxy({}, { get: (_, prop) => getClient()[prop] });

/* ============================================================
   Small helpers
   ============================================================ */

function _isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function _hasBlankLike(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const s = value.trim();
    return (
      s === "" ||
      s.includes("_____") ||
      s.includes("____") ||
      s.includes("[blank]") ||
      s.includes("{blank}")
    );
  }
  if (Array.isArray(value)) return value.some(_hasBlankLike);
  if (typeof value === "object") return Object.values(value).some(_hasBlankLike);
  return false;
}

function _len(x) { return Array.isArray(x) ? x.length : 0; }

function _isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }


// sanitizeTaskShapeByType is now imported from ./sanitizeTaskShape.js (canonical single source)

function validatePlayabilityByType(type, task) {
  const errors = [];
  const cfg = _isObj(task?.config) ? task.config : {};

  // ------------------------------------------------------------
  // Multiple Choice / Physical Multiple Choice contract enforcement
  // ONE source of truth: top-level task.items only.
  // - Do NOT allow config.items (prevents drift / duplication)
  // - Enforce playability constraints (question & option counts)
  // ------------------------------------------------------------
  if (type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
    if (_len(cfg?.items) > 0) errors.push("Do not include config.items for multiple-choice tasks; use top-level items[] only.");
    const items = Array.isArray(task?.items) ? task.items : [];
    if (_len(items) === 0) errors.push("items[] is required (top-level) for multiple-choice tasks.");
    // Physical Multiple Choice: exactly 4 questions, each with exactly 4 options (A–D)
    if (type === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
      if (_len(items) !== 4) errors.push(`items[] must have exactly 4 questions (got ${_len(items)})`);
    } else {
      // Regular multiple choice: 3–5 questions
      if (_len(items) < 3 || _len(items) > 5) errors.push(`items[] must have 3–5 questions (got ${_len(items)})`);
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const prompt = String(it.prompt || it.question || it.text || "").trim();
      const options = Array.isArray(it.options) ? it.options.map((o) => String(o || "").trim()).filter(Boolean) : [];
      const correct = Number.isInteger(it.correctAnswer)
        ? it.correctAnswer
        : Number.isInteger(it.correctIndex)
          ? it.correctIndex
          : null;

      if (!prompt) errors.push(`items[${i}].prompt required`);
      if (type === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
        if (options.length !== 4) errors.push(`items[${i}].options must be exactly 4 options for physical-multiple-choice (got ${options.length})`);
      } else {
        if (options.length < 2) errors.push(`items[${i}].options must have at least 2 options`);
      }
      if (!Number.isInteger(correct)) errors.push(`items[${i}].correctAnswer must be a number index`);
      else if (correct < 0 || correct >= options.length) errors.push(`items[${i}].correctAnswer out of range`);
    }
  }


  if (type === TASK_TYPES.VENNSORT) {
    if (_len(cfg.categories) < 2) errors.push("config.categories[] must have at least 2 items");
    if (_len(cfg.items) < 5) errors.push("config.items[] must have at least 5 items");
    if (!_isObj(task?.correctAnswer)) errors.push("correctAnswer mapping is required");
    // Check balance: each category should have at least 2 items
    if (_isObj(task?.correctAnswer) && Array.isArray(cfg.categories) && cfg.categories.length >= 2) {
      const catCounts = {};
      for (const cats of Object.values(task.correctAnswer)) {
        if (Array.isArray(cats)) cats.forEach((c) => { catCounts[c] = (catCounts[c] || 0) + 1; });
      }
      for (const cat of cfg.categories) {
        const name = typeof cat === "string" ? cat : cat?.name || cat?.label || "";
        if (name && (catCounts[name] || 0) < 2) errors.push(`Category "${name}" has fewer than 2 items — distribution is unbalanced`);
      }
    }
    // Check item text length
    if (Array.isArray(cfg.items)) {
      const longItems = cfg.items.filter((it) => String(it?.text || it || "").length > 80);
      if (longItems.length > 0) errors.push(`${longItems.length} item(s) exceed 80 characters — keep item text short`);
    }
  }

  if (type === TASK_TYPES.SEQUENCE || type === TASK_TYPES.TIMELINE) {
    if (_len(cfg.items) < 3 && _len(task?.items) < 3) errors.push("sequence/items must have at least 3 steps");
    const hasOrder =
      _len(task?.correctOrder) ||
      _len(cfg?.correctOrder) ||
      _isObj(task?.answerKey) ||
      _isObj(cfg?.answerKey) ||
      _len(task?.correctAnswer) ||
      _len(cfg?.correctAnswer) ||
      _isObj(task?.correctAnswer) ||
      _isObj(cfg?.correctAnswer);
    if (!hasOrder) errors.push("correct order is required (correctOrder/answerKey)");
  }

  if (type === TASK_TYPES.TRUE_FALSE_TICTACTOE) {
    const stmts = task?.statements ?? cfg?.statements ?? task?.items ?? cfg?.items ?? [];
    if (_len(stmts) < 9) errors.push("need at least 9 statements");
  }

  if (type === TASK_TYPES.GUESS_WHO) {
    const sa = cfg.secretAnswers ?? task.secretAnswers ?? [];
    if (_len(sa) < 2) errors.push("need at least 2 secretAnswers");
  }

  if (type === TASK_TYPES.FAKE_OUT) {
    const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : Array.isArray(task.rounds) ? task.rounds : [];
    if (_len(rounds) < 3) errors.push("config.rounds must have at least 3 rounds");
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i] || {};
      const prompt = String(r.prompt || r.statement || "").trim();
      const options = Array.isArray(r.options) ? r.options : [];
      const joke = String(r.jokeOption || "").trim();
      if (!prompt) errors.push(`rounds[${i}].prompt is required`);
      const optCount = options.filter(Boolean).length;
      if (optCount !== 3 && optCount !== 4) errors.push(`rounds[${i}].options must be 3 or 4 items (got ${optCount})`);
      // Check for duplicate options
      const uniqueOpts = new Set(options.map((o) => String(o || "").trim().toLowerCase()).filter(Boolean));
      if (uniqueOpts.size < optCount) errors.push(`rounds[${i}].options has duplicates — all options must be unique`);
      if (!joke) errors.push(`rounds[${i}].jokeOption is required`);
    }
  }

  if (type === TASK_TYPES.MUSICAL_CHAIRS) {
    // Musical Chairs uses the SAME payload as Multiple Choice / True-False.
    // Requirement: at least 7 questions (items). Options may be length 2 (T/F) or 3–5 (MC).
    const items = Array.isArray(task?.items)
      ? task.items
      : Array.isArray(cfg?.items)
        ? cfg.items
        : [];

    if (_len(items) < 7) errors.push(`items[] must have at least 7 items (got ${_len(items)})`);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const prompt = String(it.prompt || it.question || it.text || "").trim();
      const options = Array.isArray(it.options)
        ? it.options.map((o) => String(o || "").trim()).filter(Boolean)
        : [];
      const correct = Number.isInteger(it.correctAnswer)
        ? it.correctAnswer
        : Number.isInteger(it.correctIndex)
          ? it.correctIndex
          : null;

      if (!prompt) errors.push(`items[${i}].prompt required`);
      if (options.length < 2) errors.push(`items[${i}].options must have at least 2 options`);
      if (!Number.isInteger(correct)) errors.push(`items[${i}].correctAnswer must be a number index`);
      else if (correct < 0 || correct >= options.length) errors.push(`items[${i}].correctAnswer out of range`);
    }
  }

  if (type === TASK_TYPES.NARRATION_SYNTHESIZE) {
    if (typeof cfg.playerCount !== "number") errors.push("config.playerCount must be a number");
    if (_len(cfg.prompts) < 2) errors.push("config.prompts must have at least 2 items");
  }

  if (type === TASK_TYPES.ROLE_PLAY_DECK) {
    if (_len(cfg.roles) < 2) errors.push("config.roles must have at least 2 roles");
    if (!String(cfg.scenario || "").trim()) errors.push("config.scenario is required");
  }

  if (type === TASK_TYPES.SCRIPT_PLAY) {
    const lines = task?.lines ?? cfg?.lines ?? task?.dialogue ?? cfg?.dialogue ?? [];
    if (_len(lines) < 4) errors.push("script lines/dialogue must have at least 4 lines");
  }

  if (type === TASK_TYPES.PRONUNCIATION) {
    const ref = task?.referenceText ?? cfg?.referenceText;
    if (!String(ref || "").trim()) errors.push("referenceText is required");
  }

  if (type === TASK_TYPES.HANGMAN_DUEL) {
    // Support either top-level wordsByStation or config.wordsByStation
    const pool = Array.isArray(task?.wordsByStation)
      ? task.wordsByStation
      : Array.isArray(cfg?.wordsByStation)
        ? cfg.wordsByStation
        : [];

    if (_len(pool) < 4) errors.push("wordsByStation must have at least 4 entries");

    for (let i = 0; i < pool.length; i++) {
      const w = pool[i] || {};
      const word = String(w.word || w.answer || "").trim();
      const hint = String(w.hint || w.clue || "").trim();
      if (!word) errors.push(`wordsByStation[${i}].word is required`);
      if (!hint) errors.push(`wordsByStation[${i}].hint is required`);
    }
  }


  return { ok: errors.length === 0, errors };
}

export function extractJsonFromText(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const a0 = raw.indexOf("[");
  const a1 = raw.lastIndexOf("]");
  if (a0 >= 0 && a1 > a0) {
    const sub = raw.slice(a0, a1 + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // continue
    }
  }

  const o0 = raw.indexOf("{");
  const o1 = raw.lastIndexOf("}");
  if (o0 >= 0 && o1 > o0) {
    const sub = raw.slice(o0, o1 + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * IMPORTANT: robust normalization:
 * - lower
 * - underscores -> hyphen
 * - whitespace -> hyphen
 * - strip punctuation
 * Example: "Brain Blitz!" => "brain-blitz"
 */
export function normalizeSelectedType(raw) {
  if (!raw) return null;

  const v = String(raw)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  // ✅ If it's already an exact TASK_TYPES value, accept it immediately
  if (Object.values(TASK_TYPES).includes(v)) return v;

  if (v === "multiple-choice" || v === "multiplechoice" || v === "mcq" || v === "mc")
    return TASK_TYPES.MULTIPLE_CHOICE;

  if (
    v === "physical-multiple-choice" ||
    v === "physical-multiplechoice" ||
    v === "physical-mc" ||
    v === "pmc" ||
    v === "physicalmc"
  )
    return TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;

  if (v === "true-false" || v === "truefalse" || v === "tf") return TASK_TYPES.TRUE_FALSE;
  if (v === "short-answer" || v === "shortanswer" || v === "sa") return TASK_TYPES.SHORT_ANSWER;
  if (v === "open-text" || v === "opentext" || v === "open") return TASK_TYPES.OPEN_TEXT;

  if (v === "sort" || v === "categorize" || v === "sort-task") return TASK_TYPES.SORT;
  if (v === "sequence" || v === "order") return TASK_TYPES.SEQUENCE;
  if (v === "timeline") return TASK_TYPES.TIMELINE;

  if (v === "vennsort" || v === "venn-sort" || v === "venn" || v === "venn-diagram" || v === "venn_diagram")
    return TASK_TYPES.VENNSORT;

  if (v === "brain-blitz" || v === "brainblitz") return TASK_TYPES.BRAIN_BLITZ;
  if (v === "jeopardy" || v === "jeopardy-game" || v === "jeopardy_game") return TASK_TYPES.JEOPARDY;

  if (v === "brainstorm-battle" || v === "brainstormbattle" || v === "brainstorm" || v === "brain-storm-battle")
    return TASK_TYPES.BRAINSTORM_BATTLE;

  if (v === "collaboration" || v === "collab" || v === "pair-and-respond" || v === "pair-respond")
    return TASK_TYPES.COLLABORATION;

  if (v === "live-debate" || v === "livedebate" || v === "debate" || v === "live_debate")
    return TASK_TYPES.LIVE_DEBATE;

  if (
    v === "true-false-tictactoe" ||
    v === "true-false-tic-tac-toe" ||
    v === "truefalsetictactoe" ||
    v === "tictactoe" ||
    v === "tic-tac-toe"
  )
    return TASK_TYPES.TRUE_FALSE_TICTACTOE;

  if (v === "brain-spark-notes" || v === "brainsparknotes" || v === "brain_spark_notes")
    return TASK_TYPES.BRAIN_SPARK_NOTES;

  if (v === "mind-mapper" || v === "mindmapper" || v === "mind_mapper") return TASK_TYPES.MIND_MAPPER;
  if (v === "hangman" || v === "hangman-duel" || v === "hangmanduel") return TASK_TYPES.HANGMAN_DUEL;

  if (
    v === "word-weaver" ||
    v === "wordweaver" ||
    v === "word-weaver-duel" ||
    v === "wordweaverduel" ||
    v === "word-weaver_duel" ||
    v === "word_weaver_duel"
  )
    return TASK_TYPES.WORD_WEAVER_DUEL;

  if (v === "flashcards") return TASK_TYPES.FLASHCARDS;
  if (v === "flashcards-race" || v === "flashcardsrace" || v === "flashcard-race" || v === "flashcardrace")
    return TASK_TYPES.FLASHCARDS_RACE;

  if (v === "diff-detective" || v === "spot-the-difference" || v === "diff") return TASK_TYPES.DIFF_DETECTIVE;

  if (v === "photo") return TASK_TYPES.PHOTO;
  if (v === "photo-journal" || v === "photojournal") return TASK_TYPES.PHOTO_JOURNAL;
  if (v === "draw-or-mime" || v === "drawormime") return TASK_TYPES.DRAW_MIME;
  if (v === "body-break" || v === "bodybreak") return TASK_TYPES.BODY_BREAK;

  if (v === "mood-checkin" || v === "moodcheckin" || v === "mood") return TASK_TYPES.MOOD_CHECKIN;
  if (v === "treasure-runner" || v === "treasurerunner" || v === "treasure") return TASK_TYPES.TREASURE_RUNNER;

  if (v === "multi-player-feedback" || v === "multiplayerfeedback" || v === "feedback") return TASK_TYPES.MULTI_PLAYER_FEEDBACK;

  if (v === "guess-who" || v === "guesswho" || v === "guess_who") return TASK_TYPES.GUESS_WHO;
  if (v === "echochain" || v === "echo-chain" || v === "echo_chain" || v === "echo chain") return TASK_TYPES.ECHO_CHAIN;
  if (v === "fakeout" || v === "fake-out" || v === "fake_out" || v === "fake out") return TASK_TYPES.FAKE_OUT;

  if (v === "matching" || v === "match") return TASK_TYPES.MATCHING;
  if (v === "make-and-snap" || v === "makeandsnap" || v === "make-snap") return TASK_TYPES.MAKE_AND_SNAP;

  // Mad Dash (route scan / body break)
  if (v === "mad-dash" || v === "maddash") return TASK_TYPES.MAD_DASH;

  // Mad Dash Sequence (academic ordering by scanning)
  if (v === "mad-dash-sequence" || v === "maddashsequence" || v === "mad-dash-seq")
    return TASK_TYPES.MAD_DASH_SEQUENCE;

  if (v === "hidenseek" || v === "hide-n-seek" || v === "hide-and-seek") return TASK_TYPES.HIDENSEEK;
  if (v === "pet-feeding" || v === "petfeeding" || v === "feed-the-pet") return TASK_TYPES.PET_FEEDING;

  if (v === "narration-synthesize" || v === "narrationsynthesize" || v === "narration" || v === "synthesize-narration")
    return TASK_TYPES.NARRATION_SYNTHESIZE;

  if (v === "role-play-deck" || v === "roleplaydeck" || v === "role-play" || v === "roleplay")
    return TASK_TYPES.ROLE_PLAY_DECK;

  if (v === "script-play" || v === "scriptplay" || v === "script") return TASK_TYPES.SCRIPT_PLAY;

  if (v === "pronunciation" || v === "pronounce" || v === "pronunciation-drill") return TASK_TYPES.PRONUNCIATION;

  if (v === "speech-recognition" || v === "speechrecognition" || v === "speech" || v === "speech-rec")
    return TASK_TYPES.SPEECH_RECOGNITION;

  return null;
}

export function buildVocabularyLines(aiWordBank) {
  const vocab = Array.isArray(aiWordBank)
    ? aiWordBank
    : String(aiWordBank || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

  return vocab.map((w) => `- ${w}`).join("\n");
}

/* ============================================================
   Coverage planning (Primary vs Reinforcement)
   ============================================================ */

function _slugifyConceptLabel(label) {
  const s = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || `c-${Math.random().toString(36).slice(2, 8)}`;
}

function _mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _hashSeed(seed) {
  const s = String(seed || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Allocate concepts across planned task slots in a teacher-like way:
 * - Objective/assessed tasks get PRIMARY concepts.
 * - Deeper tasks get REINFORCEMENT concepts (plus optional overflow).
 *
 * Returns a plan that can be attached to taskset.meta and used to build smaller prompts.
 */
export function allocateCoveragePlan({
  concepts,
  tasksPlan,
  taskTypeMeta,
  seed,
  policy,
}) {
  const rand = _mulberry32(_hashSeed(seed || "coverage"));

  const conceptObjs = (Array.isArray(concepts) ? concepts : [])
    .map((c) => {
      if (c && typeof c === "object") {
        const label = String(c.label || c.term || c.word || "").trim();
        return {
          id: String(c.id || _slugifyConceptLabel(label)),
          label,
          aliases: Array.isArray(c.aliases) ? c.aliases : [],
          priority: Number.isFinite(Number(c.priority)) ? Number(c.priority) : 0,
          tags: Array.isArray(c.tags) ? c.tags : [],
        };
      }
      const label = String(c || "").trim();
      return { id: _slugifyConceptLabel(label), label, aliases: [], priority: 0, tags: [] };
    })
    .filter((c) => c.label);

  const pol = {
    primaryPerTaskDefault: 1,
    reinforcePerTaskDefault: 2,
    primaryPerTaskByType: {},
    reinforcePerTaskByType: {},
    cooldownSlots: 3,
    requirePrimaryIfCapacity: true,
    requireReinforcementIfPossible: true,
    ...(policy || {}),
  };

  const slots = (Array.isArray(tasksPlan) ? tasksPlan : []).map((slot, idx) => {
    const taskType = String(slot?.taskType || slot || "");
    const meta = taskTypeMeta?.[taskType] || {};
    const isObjective = meta.objectiveKeyed === true || meta.scoringMode === "objective";
    const category = String(meta.category || "");
    const isMovement = category === "movement";
    const fn = isObjective ? "ASSESS" : isMovement ? "NEUTRAL" : "REINFORCE";
    return {
      slotId: String(slot?.slotId || `t${String(idx + 1).padStart(2, "0")}`),
      index: idx,
      taskType,
      function: slot?.function || fn,
    };
  });

  const primaryCount = Object.create(null);
  const reinforceCount = Object.create(null);
  const lastSlotUsed = Object.create(null);
  for (const c of conceptObjs) {
    primaryCount[c.id] = 0;
    reinforceCount[c.id] = 0;
    lastSlotUsed[c.id] = -9999;
  }

  const conceptOrder = [...conceptObjs];
  conceptOrder.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // deterministic shuffle within equal-priority blocks
  let start = 0;
  while (start < conceptOrder.length) {
    let end = start + 1;
    while (end < conceptOrder.length && conceptOrder[end].priority === conceptOrder[start].priority) end++;
    const seg = conceptOrder.slice(start, end);
    _shuffleInPlace(seg, rand);
    for (let i = 0; i < seg.length; i++) conceptOrder[start + i] = seg[i];
    start = end;
  }

  function pickConceptIds({ k, slotIndex, preferAssessed }) {
    const picked = [];
    const cooldown = Math.max(0, Number(pol.cooldownSlots) || 0);

    const scored = conceptObjs
      .map((c) => {
        const inCooldown = slotIndex - lastSlotUsed[c.id] <= cooldown;
        const alreadyAssessed = primaryCount[c.id] > 0;
        const needPrimary = primaryCount[c.id] === 0;
        const needReinforce = reinforceCount[c.id] === 0;

        let score = 0;
        if (inCooldown) score += 1000;
        if (preferAssessed && !alreadyAssessed) score += 50;
        if (needPrimary) score -= 20;
        if (needReinforce) score -= 10;
        score += primaryCount[c.id] * 5 + reinforceCount[c.id] * 2;
        score -= (c.priority || 0) * 3;

        const orderIdx = conceptOrder.findIndex((x) => x.id === c.id);
        score += orderIdx / 1000;
        return { id: c.id, score };
      })
      .sort((a, b) => a.score - b.score);

    for (const cand of scored) {
      if (picked.length >= k) break;
      if (!picked.includes(cand.id)) picked.push(cand.id);
    }
    return picked;
  }

  const slotCoverage = Object.create(null);
  const assessSlots = slots.filter((s) => s.function === "ASSESS");
  const reinforceSlots = slots.filter((s) => s.function === "REINFORCE");

  // Primary pass (objective)
  for (const slot of assessSlots) {
    const k = Math.max(
      0,
      Number(pol.primaryPerTaskByType?.[slot.taskType] ?? pol.primaryPerTaskDefault) || 0
    );

    if (k === 0 || conceptObjs.length === 0) {
      slotCoverage[slot.slotId] = { primary: [], reinforce: [], context: [] };
      continue;
    }

    const picked = pickConceptIds({ k, slotIndex: slot.index, preferAssessed: false });
    for (const id of picked) {
      primaryCount[id] += 1;
      lastSlotUsed[id] = slot.index;
    }
    slotCoverage[slot.slotId] = { primary: picked, reinforce: [], context: [] };
  }

  const unassessed = conceptObjs.filter((c) => primaryCount[c.id] === 0).map((c) => c.id);

  // Reinforcement pass (analytical)
  for (const slot of reinforceSlots) {
    const m = Math.max(
      0,
      Number(pol.reinforcePerTaskByType?.[slot.taskType] ?? pol.reinforcePerTaskDefault) || 0
    );

    if (m === 0 || conceptObjs.length === 0) {
      slotCoverage[slot.slotId] = slotCoverage[slot.slotId] || { primary: [], reinforce: [], context: [] };
      continue;
    }

    const picked = pickConceptIds({ k: m, slotIndex: slot.index, preferAssessed: true });
    for (const id of picked) {
      reinforceCount[id] += 1;
      lastSlotUsed[id] = slot.index;
    }

    slotCoverage[slot.slotId] = slotCoverage[slot.slotId] || { primary: [], reinforce: [], context: [] };
    slotCoverage[slot.slotId].reinforce = picked;
  }

  // Expected report
  const byConcept = {};
  for (const c of conceptObjs) {
    byConcept[c.id] = {
      id: c.id,
      label: c.label,
      primaryCount: primaryCount[c.id] || 0,
      reinforceCount: reinforceCount[c.id] || 0,
      primarySlots: [],
      reinforceSlots: [],
    };
  }
  for (const slot of slots) {
    const cov = slotCoverage[slot.slotId] || { primary: [], reinforce: [], context: [] };
    for (const id of cov.primary || []) byConcept[id]?.primarySlots.push(slot.slotId);
    for (const id of cov.reinforce || []) byConcept[id]?.reinforceSlots.push(slot.slotId);
  }

  const unreinforced = conceptObjs.filter((c) => reinforceCount[c.id] === 0).map((c) => c.id);
  const uncovered = conceptObjs
    .filter((c) => (primaryCount[c.id] || 0) === 0 && (reinforceCount[c.id] || 0) === 0)
    .map((c) => c.id);

  return {
    version: "coverage-plan:v1",
    seed: String(seed || ""),
    conceptBank: { concepts: conceptObjs },
    policy: pol,
    tasksPlan: slots.map((s) => ({
      slotId: s.slotId,
      taskType: s.taskType,
      function: s.function,
      coverageIntent: {
        primary: slotCoverage[s.slotId]?.primary || [],
        reinforce: slotCoverage[s.slotId]?.reinforce || [],
        context: slotCoverage[s.slotId]?.context || [],
      },
      promptDirectives: {
        mustAssessPrimary: s.function === "ASSESS",
        assessmentMode: s.function === "ASSESS" ? "explicit" : "avoid-quiz",
        reinforcementMode: s.function === "REINFORCE" ? "natural-use" : "n/a",
      },
    })),
    expectedCoverageReport: {
      byConcept,
      unassessedConceptIds: unassessed,
      unreinforcedConceptIds: unreinforced,
      uncoveredConceptIds: uncovered,
    },
  };
}

/* ============================================================
   Strict validators (legacy in-controller hardening)
   ============================================================ */

function validateBrainSparkNotesTask(task) {
  const errors = [];
  const notes = task?.notes ?? task?.content ?? null;

  if (!notes || typeof notes !== "object") {
    errors.push("notes object is required");
    return { ok: false, errors };
  }

  const heading = String(notes.heading ?? notes.title ?? "").trim();
  if (!heading) errors.push("notes.heading (or notes.title) is required");

  // keyTerms: array of objects, min 3, each has points min 2
  const keyTerms = Array.isArray(notes.keyTerms) ? notes.keyTerms : Array.isArray(notes.terms) ? notes.terms : [];
  if (!Array.isArray(keyTerms) || keyTerms.length < 3) {
    errors.push("notes.keyTerms must have at least 3 items");
  } else {
    for (let i = 0; i < keyTerms.length; i++) {
      const kt = keyTerms[i];
      const term = String(kt?.term ?? kt?.word ?? kt?.name ?? "").trim();
      const def = String(kt?.definition ?? kt?.def ?? "").trim();
      if (!term) errors.push(`keyTerms[${i}].term is required`);
      if (!def) errors.push(`keyTerms[${i}].definition is required`);

      const pts = Array.isArray(kt?.points)
        ? kt.points
        : Array.isArray(kt?.bullets)
          ? kt.bullets
          : Array.isArray(kt?.facts)
            ? kt.facts
            : [];

      const ptCount = pts.filter((p) => typeof p === "string" && p.trim()).length;
      if (ptCount < 2) errors.push(`keyTerms[${i}].points[] must have at least 2 items`);
    }
  }

  // mainPoints: min 3
  // Accept EITHER:
  //  A) { heading, bullets: string[] }  (2-level)
  //  B) { heading, sections: [{ title, bullets: string[] }] } (3-level)
  const mainPoints = Array.isArray(notes.mainPoints) ? notes.mainPoints : Array.isArray(notes.sections) ? notes.sections : [];
  if (!Array.isArray(mainPoints) || mainPoints.length < 3) {
    errors.push("notes.mainPoints must have at least 3 items");
  } else {
    for (let i = 0; i < mainPoints.length; i++) {
      const mp = mainPoints[i] || {};
      const mpHeading = String(mp?.heading ?? mp?.title ?? "").trim();
      if (!mpHeading) errors.push(`mainPoints[${i}].heading is required`);

      const hasSections = Array.isArray(mp?.sections) && mp.sections.length > 0;

      if (hasSections) {
        // 3-level validation
        for (let j = 0; j < mp.sections.length; j++) {
          const sec = mp.sections[j] || {};
          const secTitle = String(sec?.title ?? sec?.heading ?? "").trim();
          if (!secTitle) errors.push(`mainPoints[${i}].sections[${j}].title is required`);

          const bullets = Array.isArray(sec?.bullets) ? sec.bullets : Array.isArray(sec?.points) ? sec.points : [];
          const bCount = bullets.filter((b) => typeof b === "string" && b.trim()).length;
          if (bCount < 2) errors.push(`mainPoints[${i}].sections[${j}].bullets[] must have at least 2 items`);
        }
      } else {
        // 2-level validation
        const bullets = Array.isArray(mp?.bullets) ? mp.bullets : Array.isArray(mp?.points) ? mp.points : [];
        const bCount = bullets.filter((b) => typeof b === "string" && b.trim()).length;
        if (bCount < 2) errors.push(`mainPoints[${i}].bullets[] must have at least 2 items`);
      }
    }
  }

  // summary: array min 2
  const summary = notes.summary ?? notes.recap ?? null;
  if (!Array.isArray(summary)) {
    errors.push("notes.summary required");
  } else {
    const sCount = summary.filter((s) => typeof s === "string" && s.trim()).length;
    if (sCount < 2) errors.push("notes.summary[] must include at least 2 bullets");
  }

  return { ok: errors.length === 0, errors };
}

const ALLOWED_MINDMAPPER_ORGS = new Set(["mind-map", "hierarchy", "fishbone", "flowchart", "venn", "web"]);
// NOTE: kept for backwards compatibility (controllers import it).
// This function MUST NOT fabricate missing fields (no fillers).
export function ensureTitlePrompt(task) {
  const t = { ...(task || {}) };
  if (typeof t.title === "string") t.title = t.title.trim();
  if (typeof t.prompt === "string") t.prompt = t.prompt.trim();
  return t;
}


function validateMindMapperTask(task) {
  const errors = [];
  const org = task?.organizerType ?? task?.organizer ?? "mind-map";
  if (!_isNonEmptyString(org)) errors.push("organizerType is required");
  else if (!ALLOWED_MINDMAPPER_ORGS.has(org))
    errors.push(`organizerType must be one of: ${Array.from(ALLOWED_MINDMAPPER_ORGS).join(", ")}`);

  const items = task?.items ?? task?.options ?? task?.shuffledItems ?? [];
  if (!Array.isArray(items) || items.length < 4) {
    errors.push("items[] must be an array with at least 4 items");
  } else {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const text = typeof it === "string" ? it : it?.text ?? it?.label ?? it?.prompt ?? it?.name;
      if (!_isNonEmptyString(text)) errors.push(`items[${i}].text is required`);
      if (typeof it === "object") {
        const ci = it?.correctIndex;
        if (typeof ci !== "number" || !Number.isFinite(ci)) errors.push(`items[${i}].correctIndex must be a number`);
      }
    }
  }

  const structure = task?.structure ?? task?.organizerStructure ?? null;
  if (!structure || typeof structure !== "object" || !_hasBlankLike(structure)) {
    errors.push("structure must exist and include blank slots (e.g., '_____' or empty slot strings)");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate an AI-produced task against the schema for a *known expected type*.
 * IMPORTANT: We do NOT trust `task.taskType` coming back from the model.
 * We force the type to the one we are currently generating.
 */
export function validateAiTask(expectedType, task) {
  const type = normalizeSelectedType(expectedType);
  if (!type) return { ok: false, errors: ["taskType missing/unknown"] };

  const forced = sanitizeTaskShapeByType(type, { ...(task || {}), taskType: type });

  if (type === TASK_TYPES.BRAIN_SPARK_NOTES) return validateBrainSparkNotesTask(forced);
  if (type === TASK_TYPES.MIND_MAPPER) return validateMindMapperTask(forced);

  const p = validatePlayabilityByType(type, forced);
  if (!p.ok) return p;

  return validateTaskByType(type, forced);

}

export function assertValidAiTask(expectedType, task) {
  const forced = { ...(task || {}), taskType: expectedType };

  const v = validateAiTask(expectedType, forced);
  if (!v.ok) {
    const err = new Error(`AI task schema invalid for ${expectedType}: ${v.errors.join("; ")}`);
    err.validationErrors = v.errors;
    throw err;
  }
  return true;
}

/* ============================================================
   Retry "must-have" constraints (targeted regeneration)
   ============================================================ */

export const retryMustHave = {
  [TASK_TYPES.MULTIPLE_CHOICE]:
    'MULTIPLE_CHOICE must include items[] with 3–5 questions. Put questions ONLY in top-level items[] (do NOT include config.items). Each item: { id, prompt, options[], correctAnswer } (correctAnswer is an index). IMPORTANT: Vary the correctAnswer position — use at least 3 different index values across items. Do NOT put the correct answer in the same position for every question. DOUBLE-CHECK: For EACH question, verify that options[correctAnswer] is actually the factually correct answer.',
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]:
    'PHYSICAL_MULTIPLE_CHOICE must include items[] with EXACTLY 4 questions. Put questions ONLY in top-level items[] (do NOT include config.items). Each item: { id, prompt, options[4], correctAnswer } where correctAnswer is a 0-based index. IMPORTANT: Vary the correctAnswer position — use at least 3 different index values across items. DOUBLE-CHECK: For EACH question, verify that options[correctAnswer] is actually the factually correct answer. Read back the question, read the option at the index you chose, and confirm it is right before finalizing.',
  [TASK_TYPES.TRUE_FALSE]:
    "TRUE_FALSE must include items[] with at least 3 statements. Each item: { id, prompt, correctAnswer: 0|1 } where 1=True, 0=False.",
  [TASK_TYPES.MUSICAL_CHAIRS]:
    'MUSICAL_CHAIRS must include items[] with EXACTLY 7 tap-based questions. Each item: { id, prompt, options[2..4], correctAnswer:number } where correctAnswer is a 0-based index into options. ALSO include config.rounds=7 and config.items as an IDENTICAL copy of items.',
  [TASK_TYPES.SHORT_ANSWER]:
    'SHORT_ANSWER must include either (A) a single prompt + correctAnswer (string) OR (B) items[] with 3–5 prompts, each with correctAnswer (string) and optionally acceptableAnswers (array of strings).',
  [TASK_TYPES.OPEN_TEXT]:
    'OPEN_TEXT must include a clear prompt plus settings: { gradeLevel:number, difficulty:"EASY"|"MEDIUM"|"HARD" }. Do NOT include correctAnswer.',
  [TASK_TYPES.BRAIN_SPARK_NOTES]:
    `BRAIN_SPARK_NOTES MUST include a top-level "notes" object (NOT config-only) with EXACT shape:
  {
    "notes": {
      "heading": "string",
      "keyTerms": [ { "term":"string", "definition":"string", "points":["string","string"] } ],
      "mainPoints": [ { "heading":"string", "bullets":["string","string"] } ],
      "summary": ["string","string"]
    }
  }
  HARD REQUIREMENTS:
  - notes.mainPoints MUST have at least 3 items.
  - Each mainPoint MUST be EITHER:
    A) { heading, bullets:["...","..."] }  (2-level), OR
    B) { heading, sections:[ { title, bullets:["...","..."] } ] } (3-level preferred).
  - bullets must be string[] and each bullets[] must have at least 2 items.
  - notes.keyTerms MUST have at least 3 items
  - notes.mainPoints MUST have at least 3 items
  - each keyTerms[i].points MUST have at least 2 items
  - each mainPoints[i].bullets MUST have at least 2 items
  - notes.summary is REQUIRED and MUST have at least 2 items
  Do NOT omit any of these fields. Do NOT return placeholders.`,
  [TASK_TYPES.DRAW_MIME]:
    'DRAW_MIME MUST include a "clues" array of EXACTLY 4 short drawable/actable concepts (1-3 words each, max 5 words). Pick 4 words from the vocabulary list. Set "prompt" to clues[0]. Do NOT put instructions or sentences in prompt — only the first clue word(s). Example: { "taskType":"draw-mime", "title":"Draw: Key Concepts", "prompt":"gravity", "clues":["gravity","water cycle","photosynthesis","food chain"], "config":{"mode":"EITHER"} }. Optional: config.mode "DRAW"|"MIME"|"EITHER".',
  [TASK_TYPES.SORT]:
    'SORT: Pick 8–14 terms from the vocabulary list as items. MINIMUM 6 items — sort tasks with fewer than 6 will be REJECTED. Create 2–4 clearly labelled categories (config.buckets as plain strings, e.g. ["Key Figures","Major Events"]). Each item: { text: string, bucketIndex: number }. Items MUST be real vocabulary terms — NEVER use placeholder text like "Item 1". IMPORTANT: buckets MUST be plain strings — do NOT return objects like { label: "..." }. Each item.text must be a SPECIFIC term/name/event, NOT a generic description like "Emphasis on personal faith" or "Provided social services". Categories should both be thematic groupings — do NOT use a person as one category and an abstract concept as the other.',
  [TASK_TYPES.SEQUENCE]:
   "SEQUENCE: Pick 6–10 items that have a clear logical or chronological order. MINIMUM 6 items — fewer will be REJECTED. Items can be steps in a process, stages of development, historical events, or any set with an unambiguous ordering. CRITICAL: every item must have ONE clearly correct position — if two items could reasonably swap places, the sequence is broken. Avoid vague or overlapping items. Do not omit.",
  [TASK_TYPES.TIMELINE]:
    "TIMELINE: Pick 6–10 events that can be placed chronologically. MINIMUM 6 events — fewer will be REJECTED. Each event should include a date or narrow date range in parentheses when possible. CRITICAL: every event must have ONE clearly correct position in the timeline — if two events could reasonably swap, the timeline is ambiguous. Avoid bunching multiple events into the same time period. Do not omit.",
  [TASK_TYPES.LETTER]:
    'LETTER: config MUST include character (full name), characterDescription (1-2 sentences), letterStyle ("business" or "friendly"), topicContext (what to write about), and relevantConcepts (MINIMUM 4, ideally 6-8 vocab terms students can use for bonus points — fewer than 4 will be REJECTED). Pick a character that fits the topic naturally.',
  [TASK_TYPES.CASE_STUDY]:
    'CASE_STUDY: config MUST include scenario (2-4 sentences describing a realistic problem/dilemma), expertRole (who evaluates, e.g. "History Professor"), expertDescription (1 sentence), and relevantConcepts (4-8 vocab terms for bonus points). Scenario must present a genuine open-ended problem to solve, not just background info.',
  [TASK_TYPES.MATCHING]:
    'MATCHING: Pick at least 6 terms from the vocabulary list and use them as leftItems (plain string array). For each term, write a short definition (8-20 words) and use those as rightItems (plain string array). Include correctMatches map {"L1":"R1","L2":"R2",...} at root level. Do NOT use empty arrays — a matching task with no items will be REJECTED. Do NOT use "items", "options", or "config" — only leftItems, rightItems, correctMatches at root. NEVER output placeholder text like "Term 1" or "Definition 2".',
  [TASK_TYPES.VENNSORT]:
    'VENNSORT: Pick 7–14 terms from the vocabulary list as items. Create 2–3 meaningful categories (config.categories). config.items (7–14 objects). Also include correctAnswer map: { "itemId": ["CategoryA"] }. Items MUST be real vocabulary terms — NEVER use placeholder text like "Item 1". CRITICAL: Every item MUST have at least one category assigned — items with categories:[] (empty) will be REJECTED because students cannot place them. If an item does not fit your categories, either change categories or remove the item. Every item placement must be clearly defensible and unambiguous. BALANCE IS MANDATORY: EVERY category must have AT LEAST 2 items assigned to it. If a category is underpopulated, ADD more relevant terms (even if they are not in the vocabulary list) until every category has ≥2 items. You are allowed to invent extra items as needed to achieve balance. Count your assignments before returning — a category with 0 or 1 items will be REJECTED. Keep item text SHORT (max 60 characters each) — truncate or rephrase long descriptions.',
  [TASK_TYPES.JEOPARDY]:
    'JEOPARDY (BrainBlitz) must include clues[] with at least 5 SHORT clue STRINGS and a correctAnswer string (the single target answer). Also include config.clues and config.correctAnswer mirroring the root fields. CRITICAL: ALL clues must describe the SAME single concept/answer. Do NOT mix clues about different topics (e.g. do NOT have some clues about multiplication and others about addition). Every clue must be a valid hint for correctAnswer.',
  [TASK_TYPES.HANGMAN_DUEL]:
    "HANGMAN_DUEL must include wordsByStation[] (exactly 8). Each entry: { word, hint }. Words must be PURE ALPHABETIC (only A-Z letters, no numbers, hyphens, apostrophes, or special characters) and come from aiWordBank. CRITICAL: Each hint must be a real DEFINITION or CONTEXT CLUE for the word (e.g. 'The force that pulls objects toward Earth' for GRAVITY). Do NOT use lazy placeholders like 'Think about this N-letter word' — those will be REJECTED.",
  [TASK_TYPES.FLASHCARDS]:
    'FLASHCARDS: Pick 12–20 terms from the vocabulary list as card fronts (question field). Write a clear definition for each as the card back (answer field). config.items (>=5). Each item: { question, answer }. NEVER use placeholder text like "Term 1" or "Card 2".',
  [TASK_TYPES.FLASHCARDS_RACE]:
    'FLASHCARDS_RACE: Pick 8–15 terms from the vocabulary list. For each term, write a clue/definition as the "question" and the term itself as the "answer". config.items (>=5). Each item: { question, answer }. NEVER use placeholder text like "Question 1" or "Answer 2".',
  [TASK_TYPES.WORD_WEAVER_DUEL]:
    "WORD_WEAVER_DUEL should include words (array 5–10) and gridSize (number).",
  [TASK_TYPES.DIFF_DETECTIVE]:
    "DIFF_DETECTIVE must include config.textA and config.textB (3–6 sentences each) with 5–8 differences.",
  [TASK_TYPES.GUESS_WHO]:
    "GUESS_WHO must include config.items (or items) with at least 8 candidates. Each candidate needs { name, facts: [>=3], isAnswer:boolean? }. Do not return fewer than 8.",
  [TASK_TYPES.ECHO_CHAIN]:
    "ECHO_CHAIN must include seedTerm (from aiWordBank) and a clear turn-by-turn prompt.",
  [TASK_TYPES.FAKE_OUT]:
    "FAKE_OUT must include config.rounds with 3+ rounds. Each round: { prompt, options: string[3], correctIndex: 0..2, correctOption: string, jokeOption: string, jokeIndex: 0..3 }. CRITICAL: options must contain EXACTLY 3 UNIQUE strings. jokeOption is a SEPARATE field — it must NOT appear inside options[]. The system inserts jokeOption into the displayed choices at jokeIndex automatically. correctOption must match options[correctIndex] exactly. Vary correctIndex across rounds — do NOT always use index 0.",
  [TASK_TYPES.MAD_DASH]:
    "MAD_DASH must include sequence (or config.sequence) as an array of 3–5 station/color names (strings). No correctOrder/answerKey is required.",
  [TASK_TYPES.MAD_DASH_SEQUENCE]:
    "MAD_DASH_SEQUENCE must include config.items (array of 3–5 strings) AND config.correctOrder (a permutation of indexes 0..items.length-1). Do NOT include colors; colors are assigned at runtime. IMPORTANT: The items must be sequential STEPS for solving ONE specific problem or completing ONE specific process (e.g. steps of photosynthesis, stages of cell division). Each item is ONE step — do NOT mix unrelated facts or topics. correctOrder values must be INTEGERS (not strings). CRITICAL: items must be listed in SCRAMBLED order, NOT already in the correct sequence. The correctOrder array tells the system how to unscramble them. If items are [A,B,C,D] and correct sequence is B,D,A,C then correctOrder is [1,3,0,2]. A trivial correctOrder of [0,1,2,3] means the items are already in order — that is NOT a puzzle and will be REJECTED.",
  [TASK_TYPES.MIND_MAPPER]:
    "MIND_MAPPER must include structure (organizer with blanks) and items[] (>=4).",
  [TASK_TYPES.MAKE_AND_SNAP]:
    "MAKE_AND_SNAP must include config: { requiresPhoto: true, materials: string[] } and a clear prompt.",
  [TASK_TYPES.NARRATION_SYNTHESIZE]:
    "NARRATION_SYNTHESIZE must include config.playerCount (number, 2..8) and config.prompts (array of at least 4 strings). Do not omit. Example: { config: { playerCount: 4, prompts: ['...', '...', '...', '...'] } }",
  [TASK_TYPES.PRONUNCIATION]:
    "PRONUNCIATION must include referenceText (non-empty string) AND (optional) targetWords array. Do not omit referenceText.",
  [TASK_TYPES.ROLE_PLAY_DECK]:
    "ROLE_PLAY_DECK must include config.scenario (non-empty string) and config.roles (array of at least 3 role objects). Each role MUST have: name (string), goal (a specific objective the character pursues — NOT empty), and constraint (a limitation or conflict — NOT empty). Empty goal or constraint strings will be REJECTED. Do not omit any field.",
  [TASK_TYPES.SCRIPT_PLAY]:
    "SCRIPT_PLAY must include lines/dialogue as an array of at least 8 lines. Each line should be a string or { speaker, text }. Do not omit.",
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]:
    "TRUE_FALSE_TICTACTOE must include at least 12 statements (so the game can fill a 3x3 board). Each statement must include a boolean answer.",
  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]:
    'TRUE_FALSE_CONNECT_FOUR must include at least 10 statements (items[] or statements[]). Each statement: { text: string, isFalse: boolean }. Aim for a roughly 50/50 mix of true and false — at least 3 of each. Do NOT return an empty items array. Every statement must be content-specific (not generic) and clearly true or clearly false.',
  [TASK_TYPES.READING_COMP]:
    "READING_COMP must include a paragraph (generatedParagraph or paragraph field) about ONE unified topic. Do NOT stitch together summaries of multiple unrelated subjects. Go deep on one topic rather than touching many shallowly.",
  [TASK_TYPES.RECORD_AUDIO]:
    "RECORD_AUDIO must include a prompt asking students to discuss ONE specific topic in 20–45 seconds. Do NOT ask about multiple topics — one focused topic is enough for a short recording.",
  [TASK_TYPES.PET_FEEDING]:
    'PET_FEEDING MUST include "goodFoods" (array of 6-8 TRUE/PRO statements) and "badFoods" (array of 6-8 FALSE/CON statements) at the ROOT level of the task object. Total must be at least 12 items. Each item is a short factual claim (1 sentence). Do NOT return empty arrays. Also include config: { goal: 4-5, pack: "classic"|"farm"|"ocean"|"dino"|"fantasy" }. Example: { "goodFoods":["The sun is a star","Water boils at 100°C"], "badFoods":["The moon is larger than Earth","Fish live on land"] }',
  [TASK_TYPES.SPEECH_RECOGNITION]:
    'SPEECH_RECOGNITION must include "referenceText" as a ROOT-level string field (10-40 words). This is the expected spoken answer or reading-aloud passage. Do NOT generate a "phrases" array — only referenceText is used by the component.',
  [TASK_TYPES.COLLABORATION]:
    'COLLABORATION is a pair-and-respond task between two teams. It only needs taskType, title, and a clear prompt. The prompt should ask teams to write an initial response, then they will view and reply to another team\'s answer. Do NOT include config.roles, config.clues, or role-play content — this is NOT a role-play task. If the task requires individual roles within a team, use "role-play-deck" instead.',
  [TASK_TYPES.ART_VIEW]:
    'ART_VIEW is a two-phase observation task. config MUST include BOTH imageUrl (a Wikimedia Commons direct file URL) AND imageDescription (detailed: title, artist, year, what it depicts — this is the fallback if the URL breaks later). Also MUST include imageTitle, imageArtist, imageYear. Include config.viewingSeconds (default 60), config.responseSeconds (default 120), config.minObservations (default 5). config.focusHints (array of 2-4 curriculum-relevant observation prompts). The image MUST be historical art or a primary source directly related to the lesson topic.',
  [TASK_TYPES.HISTORICAL_DOC]:
    'HISTORICAL_DOC is a two-phase primary source analysis task. config MUST include BOTH imageUrl (a Wikimedia Commons direct file URL to an image of the document) AND imageDescription (detailed: what the document is, who created it, when, what it says — this is the fallback if the URL breaks later). Also MUST include docTitle, docAuthor, docYear, docType (e.g. "treaty", "letter", "proclamation"), historicalContext (1-2 sentence context shown before viewing). Include config.viewingSeconds (default 90 — longer than art because reading takes longer), config.responseSeconds (default 150). config.analysisPrompts MUST be an array of 2-4 guided analysis questions about the document\'s relevance, impact, and historical significance. The document MUST be a real, historically significant primary source directly related to the lesson topic.',
};

/* ============================================================
   Prompt-building: pull generation hints FROM shared/taskTypes.js
   ============================================================ */

function _extractHintsFromDescription(desc) {
  const s = String(desc || "").trim();
  if (!s) return "";
  const idx = s.toLowerCase().indexOf("ai generation");
  if (idx >= 0) {
    // Take a reasonable slice from "AI generation" onward
    return s.slice(idx).trim();
  }
  return "";
}

function buildCanonicalSchemaCatalog() {
  const lines = [];
  for (const [type, meta] of Object.entries(TASK_TYPE_META || {})) {
    if (!meta || typeof meta !== "object") continue;

    const hints = String(meta.aiPrompt || "").trim();

    if (!hints) {
      lines.push(`- ${type}\n(MISSING aiPrompt)`);
      continue;
    }

    lines.push(`- ${type}\n${hints}`);
  }

  if (!lines.length) {
    return `Allowed taskType values: ${Object.values(TASK_TYPES).join(", ")}`;
  }

  return `TASK TYPE GENERATION HINTS (from shared/taskTypes.js)\n\n${lines.join("\n\n")}`;
}

function _getAiPromptForType(type) {
  const meta = TASK_TYPE_META?.[type];
  const p = String(meta?.aiPrompt || "").trim();
  if (p) return p;

  // Back-compat fallback if you still have old descriptions in some entries
  const fallback = _extractHintsFromDescription(meta?.description);
  return String(fallback || "").trim();
}

function buildSingleTaskPrompt(allowedType, mustHave) {
  const typePrompt = _getAiPromptForType(allowedType);

  const includeCatalog = allowedType !== TASK_TYPES.BRAIN_SPARK_NOTES;

  return `
    You generate EXACTLY ONE classroom task for Curriculate.

    OUTPUT RULES
    - Output MUST be a SINGLE JSON OBJECT.
    - taskType MUST be exactly "${allowedType}".
    - MUST include non-empty "title" and "prompt" for the task.
    - Include ONLY fields required by that taskType.
    - For multiple-choice and physical-multiple-choice: include questions ONLY in top-level items[]; do NOT include config.items.
    - Must-have constraints: ${mustHave || "none"}

    TYPE-SPECIFIC AI PROMPT (from shared/taskTypes.js)
    ${typePrompt || "(MISSING aiPrompt — follow Must-have constraints.)"}

    ${includeCatalog ? buildCanonicalSchemaCatalog() : ""}
    `.trim();
}

export function buildTasksetPrompt(
  typePool,
  count,
  subject,
  gradeLevel,
  difficulty,
  learningGoal,
  topicLabel,
  vocabularyLines,
  specialConsiderations,
  timingContext = ""
) {
  const perType = (typePool || [])
    .map((t) => `### ${t}\n${_getAiPromptForType(t) || "(MISSING aiPrompt)"}`)
    .join("\n\n");

  return `
    You generate EXACTLY ${count} tasks for Curriculate.
    - You MUST include non-empty string fields: "title" and "prompt" for every task.
    - If the taskType is config-only, still provide a student-facing "prompt" describing what to do.
    - For multiple-choice and physical-multiple-choice: include questions ONLY in top-level items[]; do NOT include config.items.

    OUTPUT RULES
    - Output MUST be a SINGLE JSON OBJECT with this shape:
      { "tasks": [ ... ] }
    - "tasks" MUST be an array of EXACTLY ${count} task objects.
    - Return ONLY JSON. No prose.

    ⚠️ CRITICAL — TYPE-CONTENT ALIGNMENT (most common failure mode):
    Each task's content MUST match its taskType's schema. Do NOT mix schemas across tasks.
    Common mistakes to avoid:
    - Do NOT put multiple-choice items[] (with options/correctAnswer) on non-MC types like record-audio, photo, body-break, make-and-snap, brain-spark-notes.
    - Do NOT put tower-builder config on body-break tasks.
    - Do NOT put brain-blitz items on make-and-snap or photo tasks.
    - Do NOT put echo-chain config (seedTerm) on draw-mime tasks.
    - Simple types (open-text, record-audio, draw, mime, photo, make-and-snap, photo-journal, body-break, motion-mission) need ONLY title + prompt. Do NOT add items[], options[], config.items, or MC-style content.
    - Before writing each task, re-read the schema for THAT specific taskType and generate content that matches ONLY that schema.

    CONTENT CONTEXT
    Subject: ${subject}
    Grade: ${gradeLevel}
    Difficulty: ${difficulty}
    Learning goal: ${learningGoal}
    Topic: ${topicLabel}

    Vocabulary (use these; do not drift):
    ${vocabularyLines || "(none)"}

    Special considerations:
    ${specialConsiderations || "none"}
${timingContext ? `
    TASK TIMING GUIDANCE (based on real student completion data)
    Use these average completion times to plan task complexity and quantity.
    If the teacher requested a specific session duration, choose task count and
    complexity so that total estimated time ≈ requested duration.
    ${timingContext}
` : ""}
    PER-TYPE AI PROMPTS (from shared/taskTypes.js)
    ${perType}

    ${buildCanonicalSchemaCatalog()}
    `.trim();
    }

/* ============================================================
   SINGLE TASK REGENERATION (one task, one type)
   ============================================================ */

export async function regenerateSingleTask({
  allowedType,
  onPrompt,
  mustHave,
  subject,
  gradeLevel,
  difficulty,
  learningGoal,
  topicLabel,
  vocabularyLines,
  specialConsiderations,
  previousTask,
  previousError,
  temperature,
}) {
  const system = buildSingleTaskPrompt(allowedType, mustHave);

  const errorContext = previousError
    ? `\n\n    ⚠️ REASON THE PREVIOUS ATTEMPT WAS REJECTED:\n    ${previousError}\n    You MUST fix this specific issue. Do NOT repeat the same mistake.`
    : "";

  const user = `
    Create ONE task of type "${allowedType}".
    - You MUST include non-empty string fields: "title" and "prompt" for every task.
    - If the taskType is config-only, still provide a student-facing "prompt" describing what to do.

    Subject: ${subject}
    Grade: ${gradeLevel}
    Difficulty: ${difficulty}
    Learning goal: ${learningGoal}
    Topic: ${topicLabel}

    Vocabulary (use these; do not drift):
    ${vocabularyLines}

    Special considerations:
    ${specialConsiderations || "none"}

    Previous failed attempt (do NOT repeat):
    ${JSON.stringify(previousTask || {}, null, 2)}${errorContext}
    `.trim();

  // Optional debug hook (used by demo stream / sim tooling)
  try {
    if (typeof onPrompt === "function") {
      onPrompt({
        taskType: allowedType,
        system,
        user,
        topicLabel,
        subject,
        gradeLevel,
        difficulty,
        learningGoal,
      });
    }
  } catch {
    // never fail generation due to debug tooling
  }

  const request = {
    model: process.env.AI_MODEL || "gpt-4.1-mini",
    temperature: typeof temperature === "number" ? temperature : 0.4,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  // Prefer guaranteed JSON when supported
  if (!process.env.AI_DISABLE_JSON_RESPONSE_FORMAT) {
    request.response_format = { type: "json_object" };
  }

  const completion = await client.chat.completions.create(request);
  const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";

  const finishReason = completion.choices?.[0]?.finish_reason;
  const parsed = extractJsonFromText(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`[AI] Single-task generation failed for ${allowedType}. finish_reason=${finishReason}, raw (first 300):`, raw.slice(0, 300));
      throw new Error(`AI did not return a JSON object task for ${allowedType}.`);
    }

    // 1) Force the type + guarantee title/prompt on the raw task

    // 2) Normalize into your canonical schema for that taskType
    let normalized = normalizeTaskByType(allowedType, { ...parsed, taskType: allowedType });

    // 2.5) Sanitize common drift (e.g., MC config.items) before validation
    normalized = sanitizeTaskShapeByType(allowedType, normalized);

    // 2.6) GUARDRAIL: Check for quality issues flagged during normalization
    if (normalized._validationError) {
      const errMsg = normalized._validationError;
      delete normalized._validationError;
      throw new Error(`[Quality Guardrail] ${errMsg}`);
    }
    if (normalized._validationWarning) {
      console.warn(`[Quality Guardrail] ${allowedType}: ${normalized._validationWarning}`);
      delete normalized._validationWarning;
    }

    // 3) Validate exactly once, against the expected type
    assertValidAiTask(allowedType, normalized);

  return normalized;

}
