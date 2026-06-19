// backend/validators/taskValidators.js
// Used by aiTasksetController (single-shot) and demoTasksetStreamController (streaming).

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { normalizeTaskType } from "../../shared/taskTypes.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { buildDiffScene } from "../../shared/diffDetectiveScene.js";
import { selfCheckAnswer as _whatAmI_selfCheckAnswer } from "../services/whatAmIMatcher.js";

/** Reject obvious placeholder / template-missing content. */
const _PLACEHOLDER_RE =
  /(\bplaceholder\b|template\s+missing|\[object Object\]|lorem\s+ipsum|\[insert\b|\[?\s*insert\s+here\b)/i;
const _WEAK_LABEL_RE = /\b(option\s*\d+|left\s*\d+|right\s*\d+|term\s*\d+|definition\s*\d+|key\s*term\s*\d+|concept\s*\d+|branch\s*\d+|sub.?branch\s*\d+|word\s*\d+|role\s+[A-Z]\b|bucket\s*\d+|category\s*\d+|group\s*\d+|statement\s*\d+|clue\s*\d+|hint\s*\d+)\b/i;

function _isBadText(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;

  if (_PLACEHOLDER_RE.test(t)) return true;
  if (/^[A-D]$/.test(t)) return true;
  // Catch generic numbered labels like "Item 1", "Step 4", "Clue 3", "WORD1", "Role A"
  if (_WEAK_LABEL_RE.test(t) && t.length < 30) return true;
  // Also catch "Item N" / "Step N" patterns (previously exempted) but only with a space
  // (e.g. "Item 1" is a placeholder, but "item1" is a valid programmatic ID)
  if (/^(item|step|clue)\s+\d+$/i.test(t)) return true;
  if (/_{3,}/.test(t)) return true;
  return false;
}

function _scanStringsDeep(obj, max = 80) {
  const out = [];
  const seen = new Set();
  const walk = (v) => {
    if (out.length >= max) return;
    if (v == null) return;
    if (typeof v === "string") return void out.push(v);
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return void v.forEach(walk);
    Object.keys(v).forEach((k) => walk(v[k]));
  };
  walk(obj);
  return out;
}

/**
 * Placeholder scan with task-type-aware exceptions.
 * Mind Mapper *requires* "_____" in structure, so we exclude structure for that type.
 */
function _placeholderErrorIfAny(taskType, task) {
  try {
    const base = {
      title: task?.title,
      prompt: task?.prompt,
      config: taskType === TASK_TYPES.MIND_MAPPER ? undefined : task?.config,
      items: task?.items,
      notes: task?.notes,
      bullets: task?.bullets,
      // Intentionally exclude structure for MIND_MAPPER
      structure: taskType === TASK_TYPES.MIND_MAPPER ? undefined : task?.structure,
      statements: task?.statements,
      rounds: task?.rounds,
      leftItems: task?.leftItems,
      rightItems: task?.rightItems,
      secretAnswers: task?.secretAnswers,
    };

    const strs = _scanStringsDeep(base);
    const hit = strs.find(_isBadText);
    if (hit) return `contains placeholder text: "${String(hit).slice(0, 60)}"`;

    if (taskType === TASK_TYPES.FAKE_OUT || taskType === "fake-out") {
      const rounds = task?.config?.rounds ?? task?.rounds ?? [];
      const roundHit = Array.isArray(rounds)
        ? rounds
            .flatMap((r) => [r?.prompt, ...(r?.options ?? []), r?.jokeOption, r?.correctOption])
            .find(_isBadText)
        : null;
      if (roundHit) return `fake-out contains placeholder text: "${String(roundHit).slice(0, 60)}"`;
    }

    return null;
  } catch {
    return null;
  }
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

// Detect generic instruction text (vs. a real question). Used to stop the
// short-answer single-prompt fallback from turning a directive like
// "Answer each question in one sentence." into a bogus, unanswerable question.
function _isGenericInstruction(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return true;
  // Common normalizer/AI instruction defaults that are NOT questions.
  if (/^(complete the task|answer( each)?|respond|write|explain your|describe your|share your)\b/.test(t) &&
      !/\?$/.test(t)) {
    // "Answer each question..." style directives that end without a '?'.
    if (/\b(each|the following|below|in (one|a) sentence|your (answer|response))\b/.test(t)) return true;
    if (t === "complete the task." || t === "complete the task") return true;
  }
  return false;
}

function asNonEmptyString(x, fallback = "") {
  if (typeof x === "string" && x.trim()) return x.trim();
  return fallback;
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function stripChoicePrefix(s) {
  return String(s ?? "")
    .replace(/^\s*[A-Da-d]\s*[).:\-]\s*/u, "")
    .trim();
}

function extractListLines(text) {
  const s = String(text || "").replace(/\r\n/g, "\n");
  const lines = s.split("\n");
  const out = [];

  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;

    // Numbered: "1. ...", "2) ...", "3 - ..."
    const mNum = line.match(/^\s*\d+\s*[).:\-]\s*(.+)$/u);
    if (mNum && mNum[1] && mNum[1].trim()) {
      out.push(mNum[1].trim());
      continue;
    }

    // Bulleted: "- ...", "• ...", "* ..."
    const mBul = line.match(/^\s*[-*•]\s*(.+)$/u);
    if (mBul && mBul[1] && mBul[1].trim()) {
      out.push(mBul[1].trim());
      continue;
    }
  }

  // De-dupe while preserving order
  const seen = new Set();
  return out.filter((x) => {
    const k = String(x).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toInt(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(x, min, max, fallback = min) {
  const n = toInt(x, fallback);
  return Math.max(min, Math.min(max, n));
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
}

function normalizeCorrectIndex(item, options) {
  const opts = Array.isArray(options) ? options : [];
  const idxCandidates = [item?.correctAnswer, item?.correctIndex, item?.answerIndex];
  for (const c of idxCandidates) {
    const n = toInt(c, -999);
    if (n >= 0 && n < opts.length) return n;
  }
  const s = typeof item?.correctAnswer === "string" ? item.correctAnswer.trim() : "";
  if (s) {
    const i = opts.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
    if (i >= 0) return i;
  }
  return null;
}

function normalizeTFAnswer(v) {
  // Canonical: 0=True, 1=False
  if (v === 0 || v === 1) return v;
  if (v === true) return 0;
  if (v === false) return 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s in { true: 1, t: 1, yes: 1 }) return 0;
    if (s in { false: 1, f: 1, no: 1 }) return 1;
    if (s === "0") return 0;
    if (s === "1") return 1;
  }
  return null;
}

function ensureId(item, i) {
  if (item && typeof item.id === "string" && item.id.trim()) return item.id.trim();
  return String(i + 1);
}

function normalizeSortTask(task) {
  const t = { ...(task || {}) };
  t.title = t.title || "Sort";
  t.prompt = t.prompt || "Sort the items into the correct buckets.";

  t.config = t.config && typeof t.config === "object" ? { ...t.config } : {};

  // Buckets (schema uses config.buckets)
  let buckets = Array.isArray(t.config.buckets) ? t.config.buckets : [];
  buckets = buckets.map((b) => String(b).trim()).filter(Boolean);
  if (buckets.length < 2) buckets = ["Bucket 1", "Bucket 2"];
  t.config.buckets = buckets;

  // Items: normalize into objects with id + text
  let items = Array.isArray(t.items) ? t.items : Array.isArray(t.config.items) ? t.config.items : [];
  items = items
    .map((it, idx) => {
      if (typeof it === "string") return { id: `item${idx + 1}`, text: it.trim() };
      const text = String(it?.text || it?.prompt || it?.label || it?.value || "").trim();
      const id = String(it?.id || `item${idx + 1}`);
      return { ...it, id, text };
    })
    .filter((it) => it.text);

  // Do NOT pad with placeholder items — let validation reject if < 4

  t.items = items;
  t.config.items = items;

  const existing =
    (t.config.answerKey && typeof t.config.answerKey === "object" && t.config.answerKey) ||
    (t.answerKey && typeof t.answerKey === "object" && t.answerKey) ||
    null;

  let answerKey = existing ? { ...existing } : {};

  // Build answerKey from items' bucketIndex / bucket / category fields if answerKey is missing
  const needFill = Object.keys(answerKey).length < items.length;
  if (needFill) {
    items.forEach((it, idx) => {
      if (answerKey[it.id] !== undefined) return;

      // Check if item has a bucketIndex (AI often puts this on items)
      const bi = it.bucketIndex ?? it.bucket ?? it.category;
      if (typeof bi === "number" && bi >= 0 && bi < buckets.length) {
        answerKey[it.id] = bi;
      } else if (typeof bi === "string") {
        // Try to match bucket name to index
        const bIdx = buckets.findIndex((b) => b.toLowerCase() === bi.toLowerCase());
        answerKey[it.id] = bIdx >= 0 ? bIdx : idx % buckets.length;
      } else {
        answerKey[it.id] = idx % buckets.length;
      }
    });
  }

  t.config.answerKey = answerKey;
  t.answerKey = answerKey;

  return t;
}

export function normalizeTaskByType(taskType, rawTask) {
  const task = isObject(rawTask) ? { ...rawTask } : {};

  // Inject taskType if missing
  if (!task.taskType && taskType) task.taskType = taskType;

  // Strip leaked generation-context footers (e.g. "\n\nSettings: { gradeLevel: 7, ... }")
  // These sometimes appear when the AI echoes its own prompt context back into a field.
  function stripGenerationFooter(s) {
    if (typeof s !== "string") return s;
    return s
      .replace(/\n+Settings\s*:\s*\{[^}]*\}\s*$/i, "")
      .replace(/\n+Context\s*:\s*\{[^}]*\}\s*$/i, "")
      .replace(/\n+Grade\s*level\s*:\s*\d+.*$/i, "")
      .trim();
  }

  // Normalize common fields
  task.title = asNonEmptyString(stripGenerationFooter(task.title), asNonEmptyString(stripGenerationFooter(task.name), ""));
  task.prompt = asNonEmptyString(stripGenerationFooter(task.prompt), asNonEmptyString(stripGenerationFooter(task.instructions), ""));
  if (!isObject(task.config)) task.config = {};

  // Guarantee required top-level fields
  if (!task.title) task.title = `${taskType || "Task"}`;
  if (!task.prompt) {
    if (taskType === TASK_TYPES.MULTIPLE_CHOICE || taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
      task.prompt = "Choose the best answer.";
    } else if (taskType === TASK_TYPES.TRUE_FALSE) {
      task.prompt = "Decide whether each statement is True or False.";
    } else {
      task.prompt = "Complete the task.";
    }
  }

  switch (taskType) {
    case TASK_TYPES.DIFF_DETECTIVE: {
      // Visual scene mode: only fires when the generator EXPLICITLY sets
      // mode:"image"|"scene" AND supplies a label list. The labeled-tile-grid
      // renderer is NOT a stand-in for real image-to-image spot-the-difference
      // (tester 2026-05-31: "wanted it to be a image difference detection")
      // and so should not be promoted automatically — it only runs when a
      // caller explicitly opts in (e.g. the static demo). Text/compare
      // variants fall through harmlessly.
      let items = [];
      if (Array.isArray(task.labels)) items = task.labels;
      else if (Array.isArray(task.sceneItems)) items = task.sceneItems;
      else if (typeof task.labels === "string") items = task.labels.split(/\s*\|\s*|\s*,\s*/);
      else if (typeof task.sceneItems === "string") items = task.sceneItems.split(/\s*\|\s*|\s*,\s*/);
      items = items.map((s) => String(s || "").trim()).filter(Boolean);

      if ((task.mode === "scene" || task.mode === "image") && items.length >= 3) {
        const scene = buildDiffScene(items, task.title || task.prompt || "diff-detective");
        if (scene) {
          task.mode = "image";
          task.imageA = task.imageA || scene.imageA;
          task.imageB = task.imageB || scene.imageB;
          task.labelA = task.labelA || scene.labelA;
          task.labelB = task.labelB || scene.labelB;
          task.differences = scene.differences;
          task.totalDifferences = scene.totalDifferences;
          // Keep text so downstream playability/reports always have content.
          if (!task.original) task.original = `Scene A — items: ${items.join(", ")}.`;
          if (!task.modified) task.modified = `Scene B — same scene with ${scene.totalDifferences} changes to spot.`;
        }
      }
      break;
    }

    case TASK_TYPES.MULTIPLE_CHOICE:
    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE: {
      let items = Array.isArray(task.items)
        ? task.items
        : Array.isArray(task.questions)
        ? task.questions
        : [];

      items = items.map((it, i) => {
        const obj = isObject(it) ? { ...it } : {};
        const prompt = asNonEmptyString(obj.prompt, asNonEmptyString(obj.question, ""));
        let options = normalizeOptions(obj.options || obj.choices).map(stripChoicePrefix);
        const correctAnswer = (() => {
          const ci = normalizeCorrectIndex(obj, options);
          return Number.isInteger(ci) ? ci : 0;
        })();

        return {
          id: ensureId(obj, i),
          prompt,
          options,
          correctAnswer,
        };
      });

      // --- GUARDRAIL: Shuffle answer positions so correct answer isn't always in the same slot ---
      items = items.map((item) => {
        if (!Array.isArray(item.options) || item.options.length < 2) return item;
        const correctText = item.options[item.correctAnswer] ?? item.options[0];
        // Fisher-Yates shuffle
        const shuffled = [...item.options];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return {
          ...item,
          options: shuffled,
          correctAnswer: shuffled.indexOf(correctText),
        };
      });

      // --- CAP: a single MC station should be a quick check, not a 20-question quiz ---
      const MC_MAX_ITEMS = 6;
      if (items.length > MC_MAX_ITEMS) items = items.slice(0, MC_MAX_ITEMS);

      task.items = items;

      // --- GUARDRAIL: Flag likely-wrong MC answers using absolute language ---
      // In history/social studies, "correct" answers with absolute terms like
      // "immediately freed all", "completely eliminated", "had no effect" are
      // almost always factually wrong — the real answer is usually nuanced.
      const absolutePattern = /\b(immediately|completely|entirely|totally|never|always|all\s+(?:people|slaves|settlers|citizens)|had\s+no\s+(?:effect|impact|influence)|no\s+(?:one|people|settlers))\b/i;
      for (const item of items) {
        if (!Array.isArray(item.options) || typeof item.correctAnswer !== "number") continue;
        const correctOption = item.options[item.correctAnswer];
        if (correctOption && absolutePattern.test(correctOption)) {
          task._validationWarning = `MC question "${item.prompt?.slice(0, 60)}..." has a correct answer with absolute language: "${correctOption.slice(0, 60)}". In history, absolute claims are usually wrong — verify this answer key.`;
        }
      }

      // For MC/Physical MC, schema forbids config.items (use top-level items[] only)
      if (task.config && Array.isArray(task.config.items)) delete task.config.items;
      break;
    }

    case TASK_TYPES.TRUE_FALSE: {
      // Canonical: top-level items[] with correctAnswer 0/1; do not keep config.items
      let items = Array.isArray(task.items)
        ? task.items
        : Array.isArray(task.questions)
        ? task.questions
        : Array.isArray(task.statements)
        ? task.statements
        : Array.isArray(task.config?.items)
        ? task.config.items
        : Array.isArray(task.config?.statements)
        ? task.config.statements
        : [];

      // Strip placeholder/template statements that slipped through generation
      // (tester saw "Statement 1" / "{{STATEMENT_1}}" rendered as real items).
      // Mirrors the word-weaver placeholder guard below.
      const isPlaceholderStatement = (s) => {
        const t = String(s || "").trim();
        if (!t) return true;
        if (/^(statement|question|sentence|item|fact)\s*\d+[.!?]?$/i.test(t)) return true; // "Statement 1"
        if (/\{\{.*?\}\}/.test(t) || /<<.*?>>/.test(t)) return true;                        // {{X}} / <<X>>
        if (/^(sample|example|placeholder|todo|tbd|lorem ipsum)\b/i.test(t)) return true;
        return false;
      };

      items = items
        .map((it, i) => {
          const obj = isObject(it) ? { ...it } : {};
          const prompt = asNonEmptyString(obj.prompt, asNonEmptyString(obj.statement, asNonEmptyString(obj.text, "")));
          const tf = normalizeTFAnswer(obj.correctAnswer ?? obj.answer ?? obj.isTrue ?? obj.correct);
          return {
            id: ensureId(obj, i),
            prompt,
            correctAnswer: tf ?? 0,
          };
        })
        .filter((x) => x.prompt && !isPlaceholderStatement(x.prompt));

      // Cap — the renderer shows every statement; 8 is plenty for one round.
      if (items.length > 8) items = items.slice(0, 8);

      task.items = items;

      if (task.config && Array.isArray(task.config.items)) delete task.config.items;
      break;
    }

    case TASK_TYPES.WORD_WEAVER_DUEL: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      let words =
        (Array.isArray(cfg.words) && cfg.words) ||
        (Array.isArray(task.words) && task.words) ||
        (Array.isArray(cfg.items) && cfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        [];

      words = words
        .map((w) => (typeof w === "string" ? w : w?.word ?? w?.text ?? w?.value))
        .map((w) => String(w || "").trim())
        .filter(Boolean)
        // Strip any placeholder words that slipped through
        .filter((w) => !/^WORD\s*\d+$/i.test(w));

      // Do NOT pad with placeholder words — let validation reject if < 8

      cfg.words = words;
      task.config = cfg;
      task.items = words;

      task.title = asNonEmptyString(task.title, "Word Weaver Duel");
      task.prompt = asNonEmptyString(task.prompt, "Use the given words to build the best response.");
      break;
    }

    case TASK_TYPES.HIDENSEEK: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      let clues =
        (Array.isArray(cfg.clues) && cfg.clues) ||
        (Array.isArray(task.clues) && task.clues) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(task.steps) && task.steps) ||
        [];

      clues = clues
        .map((c) => {
          if (typeof c === "string") return c.trim();
          return String(c?.text || c?.clue || c?.value || "").trim();
        })
        .filter(Boolean);

      if (clues.length < 5) {
        const extracted = extractListLines(task.prompt);
        if (extracted.length) clues = extracted;
      }

      // NOTE: leave strictness policy to controllers; normalization should not invent junk.
      // We'll pad only if needed for demo-safety but not with placeholder markers.
      while (clues.length < 5) clues.push(`Clue ${clues.length + 1}`);

      cfg.clues = clues;

      if (typeof cfg.finalCheckpoint !== "string" && typeof task.finalCheckpoint === "string") {
        cfg.finalCheckpoint = task.finalCheckpoint;
      }

      task.config = cfg;
      break;
    }

    case TASK_TYPES.GUESS_WHO: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      let pool =
        (Array.isArray(cfg.items) && cfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(cfg.characters) && cfg.characters) ||
        (Array.isArray(task.characters) && task.characters) ||
        [];

      pool = pool
        .map((c, i) => {
          if (typeof c === "string") return { name: c.trim(), facts: [] };
          const name = String(c?.name || c?.title || c?.label || `Candidate ${i + 1}`).trim();
          const facts = Array.isArray(c?.facts) ? c.facts.map((x) => String(x).trim()).filter(Boolean) : [];
          return { ...c, name, facts };
        })
        .filter((c) => c && typeof c.name === "string" && c.name.trim());

      // Do NOT pad with placeholder candidates — let validation reject if < 6

      task.items = pool;
      task.config = isObject(task.config) ? task.config : {};
      task.config.items = pool;

      cfg.items = pool;
      task.title = asNonEmptyString(task.title, "Guess Who");
      task.prompt = asNonEmptyString(task.prompt, "Ask yes/no questions to identify the mystery person.");
      break;
    }

    case TASK_TYPES.MUSICAL_CHAIRS: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      let items = Array.isArray(task.items) ? task.items : Array.isArray(cfg.items) ? cfg.items : [];
      items = items.filter(isObject);

      if (items.length === 0) throw new Error("MUSICAL_CHAIRS requires items[]");

      items = items.map((it, i) => {
        const obj = { ...it };
        const id = asNonEmptyString(obj.id, String(i + 1));
        const prompt = asNonEmptyString(obj.prompt, "");
        let options = normalizeOptions(obj.options).map(stripChoicePrefix);

        if (!prompt) throw new Error(`MUSICAL_CHAIRS items[${i}].prompt required`);
        if (!Array.isArray(options) || options.length < 2) {
          throw new Error(`MUSICAL_CHAIRS items[${i}].options must have 2-4 options`);
        }
        if (options.length > 4) options = options.slice(0, 4);

        let correctAnswer = toInt(obj.correctAnswer, -1);
        const correctOption = asNonEmptyString(obj.correctOption ?? obj.correctAnswerText ?? "", "");

        if (correctOption) {
          const idx = options.findIndex((o) => o === correctOption);
          if (idx === -1) throw new Error(`MUSICAL_CHAIRS items[${i}] correctOption not in options`);
          correctAnswer = idx;
        }

        if (correctAnswer < 0 || correctAnswer >= options.length) {
          throw new Error(`MUSICAL_CHAIRS items[${i}].correctAnswer out of range`);
        }

        return { id, prompt, options, correctAnswer };
      });

      // --- CAP: musical-chairs canonical round count is 7 ---
      if (items.length > 7) items = items.slice(0, 7);

      task.items = items;

      cfg.rounds = toInt(cfg.rounds, items.length);
      if (cfg.rounds !== items.length) cfg.rounds = items.length;

      cfg.items = JSON.parse(JSON.stringify(items));
      task.config = cfg;

      break;
    }

    case TASK_TYPES.SORT: {
      const normalized = normalizeSortTask(task);
      task.title = normalized.title;
      task.prompt = normalized.prompt;
      task.items = normalized.items;
      task.config = normalized.config;

      // Cap item count — too many terms overwhelm the drag UI (testers saw ~30
      // when the whole word bank got dumped in). A good sort is 6-10 terms.
      const SORT_MAX_ITEMS = 10;
      if (Array.isArray(task.items) && task.items.length > SORT_MAX_ITEMS) {
        task.items = task.items.slice(0, SORT_MAX_ITEMS);
      }
      if (isObject(task.config) && Array.isArray(task.config.items) && task.config.items.length > SORT_MAX_ITEMS) {
        task.config.items = task.config.items.slice(0, SORT_MAX_ITEMS);
      }

      const cfg = isObject(task.config) ? task.config : (task.config = {});
      const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
      const items = Array.isArray(cfg.items) ? cfg.items : [];

      if (!isObject(cfg.answerKey) || Object.keys(cfg.answerKey).length < items.length) {
        cfg.answerKey = isObject(cfg.answerKey) ? { ...cfg.answerKey } : {};
        items.forEach((it, idx) => {
          const id = String(it?.id || `item${idx + 1}`);
          it.id = id;
          if (cfg.answerKey[id] === undefined) cfg.answerKey[id] = buckets.length ? idx % buckets.length : 0;
        });
      }

      task.answerKey = cfg.answerKey;

      task.categories = task.config.buckets;
      task.config.categories = task.config.buckets;

      // --- GUARDRAIL: Reject sort tasks with too few items ---
      // A good sort has 8-14 items across 2-3 buckets. Below 6 is too easy/trivial.
      // Hard reject at <6 so the AI retries with more items.
      if (items.length < 6 && items.length > 0) {
        task._validationError = `Sort must have at least 6 items (got ${items.length}). You MUST include 8-14 specific vocabulary terms spread across all buckets. Do NOT use topic headings or category descriptions as items.`;
      } else if (items.length < 8) {
        task._validationWarning = `Sort has only ${items.length} items — 8-14 preferred for a challenging activity`;
      }

      // --- GUARDRAIL: Flag lopsided sort buckets ---
      // If one bucket has <2 items while another has 5+, the sort is trivially easy
      if (buckets.length >= 2 && items.length >= 4) {
        const bucketCounts = new Array(buckets.length).fill(0);
        for (const it of items) {
          const bi = typeof it?.bucketIndex === "number" ? it.bucketIndex : -1;
          if (bi >= 0 && bi < buckets.length) bucketCounts[bi]++;
        }
        const minBucket = Math.min(...bucketCounts);
        const maxBucket = Math.max(...bucketCounts);
        if (minBucket < 2 && maxBucket >= 5) {
          task._validationWarning = `Sort is lopsided: bucket "${buckets[bucketCounts.indexOf(minBucket)]}" has only ${minBucket} item(s) while "${buckets[bucketCounts.indexOf(maxBucket)]}" has ${maxBucket} — each bucket should have at least 2-3 items`;
        }
      }

      // --- GUARDRAIL: Flag sort items that are descriptions rather than vocabulary terms ---
      // Items like "Missionary work", "Education establishment", "Community support", "Social services"
      // are generic category descriptions, not terms from a vocabulary list.
      if (items.length >= 4) {
        const descriptionPattern = /^(missionary|education|church|religious|community|moral|spiritual|social|political|economic|cultural|agricultural|colonial|domestic)\s+(work|establishment|building|guidance|support|leadership|revival|teaching|services|reform|development|practices|activities|contributions|influence|movements|traditions|efforts)$/i;
        // Also catch "X-run Y" patterns like "Church-run schools"
        const compoundPattern = /^[A-Za-z]+-(?:run|based|led|driven|funded|sponsored)\s+\w+$/i;
        const descItems = items.filter((it) => {
          const txt = String(it?.text || "").trim();
          return descriptionPattern.test(txt) || compoundPattern.test(txt);
        });
        // Lowered threshold from 50% to 35% — even 3/9 generic items degrades quality
        if (descItems.length >= Math.max(3, Math.ceil(items.length * 0.35))) {
          task._validationError = `Sort items are generic descriptions, not vocabulary terms: ${descItems.map((it) => `"${it.text}"`).join(", ")}. Items must be specific terms from the vocabulary list (e.g. "Clergy Reserve", "Jonathan Edwards", "Pemmican").`;
        }
      }

      break;
    }

    case TASK_TYPES.SEQUENCE:
    case TASK_TYPES.TIMELINE: {
      const cfg = isObject(task.config) ? { ...task.config } : {};

      let items =
        Array.isArray(cfg.items) ? cfg.items :
        Array.isArray(task.items) ? task.items :
        Array.isArray(task.steps) ? task.steps :
        Array.isArray(task.sequence) ? task.sequence :
        [];

      items = items
        .map((it) => {
          if (isObject(it)) {
            // Check ALL possible property names the AI might use for item text
            return asNonEmptyString(it.text,
              asNonEmptyString(it.prompt,
                asNonEmptyString(it.label,
                  asNonEmptyString(it.title,
                    asNonEmptyString(it.name,
                      asNonEmptyString(it.event,
                        asNonEmptyString(it.step,
                          asNonEmptyString(it.description,
                            asNonEmptyString(it.value, "")))))))));
          }
          return asNonEmptyString(it, "");
        })
        .map((s) => String(s).trim())
        .filter(Boolean);

      // --- GUARDRAIL: Reject sequences/timelines with too few items ---
      // Hard reject at <4 (unplayable). Warn at 4-5 (playable but shallow).
      if (items.length < 4) {
        task._validationError = `Sequence/timeline must have at least 4 items, got ${items.length}.`;
        if (items.length === 0) items = ["Placeholder — regenerate this task"];
      } else if (items.length < 6) {
        task._validationWarning = `Sequence/timeline has only ${items.length} items — 6+ preferred`;
      }
      // Flag vague pattern items (e.g. "Impact of...", "Settlement of...", "Growth of...")
      const vaguePattern = /^(Impact|Effect|Growth|Rise|Spread|Settlement|Development|Influence|Role)\s+of\b/i;
      const vagueCount = items.filter((s) => vaguePattern.test(s)).length;
      if (vagueCount > items.length * 0.5) {
        task._validationWarning = `${vagueCount}/${items.length} sequence items are vague patterns — prefer specific datable events`;
      }

      // --- GUARDRAIL: Deterministic chronological auto-sort ---
      // When items contain parenthesized dates/periods, sort them chronologically.
      // This fixes the AI returning events in wrong order without needing retries.
      const extractDateValue = (text) => {
        // Match parenthesized date hints like (1713), (early 1700s), (mid-1800s), (late 18th century), (1790s)
        // Falls back to scanning the full text if no parenthesized hint is found.
        const parenMatch = text.match(/\(([^)]+)\)/);
        const hint = parenMatch
          ? parenMatch[1].toLowerCase().trim()
          : text.toLowerCase().trim();

        // Try exact year: (1713)
        const exactYear = hint.match(/\b(\d{4})\b/);
        if (exactYear) return parseInt(exactYear[1], 10);

        // Try decade: (1790s)
        const decade = hint.match(/\b(\d{3})0s\b/);
        if (decade) {
          const base = parseInt(decade[1], 10) * 10;
          if (hint.includes("early")) return base + 2;
          if (hint.includes("late")) return base + 8;
          if (hint.includes("mid")) return base + 5;
          return base + 5;
        }

        // Try century phrases with qualifier: (early 1700s), (mid-1800s), (late 1700s)
        // Match qualifier + century as a unit to avoid cross-contamination
        // in ranges like "late 1700s to early 1800s"
        const qualCentury = hint.match(/\b(early|late|mid)[- ]?(\d{4})s\b/);
        if (qualCentury) {
          const base = parseInt(qualCentury[2], 10);
          if (qualCentury[1] === "early") return base + 15;
          if (qualCentury[1] === "late") return base + 75;
          return base + 50; // mid
        }

        // Try bare century without qualifier: (1700s)
        const bareCentury = hint.match(/\b(\d{4})s\b/);
        if (bareCentury) return parseInt(bareCentury[1], 10) + 50;

        // Try ordinal century with qualifier: (early 19th century)
        const qualOrd = hint.match(/\b(early|late|mid)[- ]?(\d{1,2})(?:st|nd|rd|th)\s+century\b/);
        if (qualOrd) {
          const base = (parseInt(qualOrd[2], 10) - 1) * 100;
          if (qualOrd[1] === "early") return base + 15;
          if (qualOrd[1] === "late") return base + 75;
          return base + 50;
        }

        // Try bare ordinal century: (18th century)
        const bareOrd = hint.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/);
        if (bareOrd) return (parseInt(bareOrd[1], 10) - 1) * 100 + 50;

        return null;
      };

      const dateValues = items.map(extractDateValue);
      const datedCount = dateValues.filter((v) => v !== null).length;

      // Only auto-sort if most items (≥60%) have extractable dates
      if (datedCount >= Math.ceil(items.length * 0.6) && items.length >= 3) {
        const indexed = items.map((text, i) => ({ text, date: dateValues[i] ?? Infinity }));
        indexed.sort((a, b) => a.date - b.date);
        const sorted = indexed.map((x) => x.text);
        // Check if order actually changed
        const changed = sorted.some((s, i) => s !== items[i]);
        if (changed) {
          items = sorted;
          // Don't warn — this is an expected auto-fix
        }
      }

      // --- GUARDRAIL: Warn (not reject) on coarse date ties ---
      // When 2+ items resolve to the same extracted date, the ordering might
      // rely on contextual knowledge rather than explicit dates. That's fine —
      // many valid timelines have events in the same broad era that are still
      // chronologically distinguishable. Downgraded to a warning only.
      if (!task._validationError && items.length >= 4) {
        const dv = items.map(extractDateValue);
        const seen = {};
        const ties = [];
        dv.forEach((v, i) => {
          if (v === null) return;
          if (seen[v] !== undefined) {
            if (!ties.some((t) => t.date === v)) {
              ties.push({ date: v, a: items[seen[v]], b: items[i] });
            }
          } else {
            seen[v] = i;
          }
        });
        if (ties.length > 0) {
          const desc = ties.map((t) => `"${t.a}" and "${t.b}" both resolve to ~${t.date}`).join("; ");
          task._validationWarning = `Timeline has items with similar date hints: ${desc}. Verify the intended order is unambiguous.`;
        }
      }

      // Cap step/event count — too many overwhelms the ordering UI and usually
      // means the AI dumped the whole concept list as "steps" (tester: "look how
      // many items there are"). A clean sequence/timeline is 4-7; keep the first
      // 7 (earliest, since timelines are already chronologically sorted above).
      const SEQ_MAX_ITEMS = 7;
      if (items.length > SEQ_MAX_ITEMS) {
        items = items.slice(0, SEQ_MAX_ITEMS);
      }

      cfg.items = items;
      cfg.sequence = items;
      task.sequence = items;
      task.config = cfg;

      task.items = items.map((text, i) => ({ id: `seq${i + 1}`, text }));

      // Always regenerate correctOrder from actual item IDs.
      // The AI often provides correctOrder with mismatched IDs (e.g. "item1" vs "seq1"),
      // which breaks scoring. Since items are already in correct order (post auto-sort),
      // the correct order IS the current item order.
      {
        const ids = task.items.map((it) => it.id);
        task.correctOrder = ids;
        cfg.correctOrder = ids;
      }

      if (!isObject(cfg.answerKey) && isObject(task.answerKey)) cfg.answerKey = task.answerKey;

      task.title = asNonEmptyString(task.title, taskType === TASK_TYPES.TIMELINE ? "Timeline" : "Sequence");
      task.prompt = asNonEmptyString(task.prompt, "Put the steps in the correct order.");

      if (
        taskType !== TASK_TYPES.MULTIPLE_CHOICE &&
        taskType !== TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE
      ) {
        if (!Array.isArray(task.items) && Array.isArray(task.config?.items)) task.items = task.config.items;
        if (!Array.isArray(task.config?.items) && Array.isArray(task.items)) {
          task.config = isObject(task.config) ? task.config : {};
          task.config.items = task.items;
        }
      }

      break;
    }

    case TASK_TYPES.TRUE_FALSE_TICTACTOE: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      // AI may send items[], config.items[], statements[], or config.statements[]
      const itemsIn = Array.isArray(task.items)
        ? task.items
        : Array.isArray(cfg.items)
          ? cfg.items
          : Array.isArray(task.statements)
            ? task.statements
            : Array.isArray(cfg.statements)
              ? cfg.statements
              : Array.isArray(cfg.statementSets?.[0])
                ? cfg.statementSets[0]
                : [];

      // Accept common field shapes and coerce answers to boolean.
      const items = itemsIn
        .map((it) => {
          const statement = isNonEmptyString(it?.statement)
            ? String(it.statement).trim()
            : isNonEmptyString(it?.prompt)
              ? String(it.prompt).trim()
              : isNonEmptyString(it?.text)
                ? String(it.text).trim()
                : "";

          // Check isFalse (inverted boolean) in addition to normal answer fields
          const raw =
            it?.correctAnswer ??
            it?.answer ??
            it?.isTrue ??
            it?.correct ??
            it?.truth ??
            null;

          let correctAnswer = null;

          if (typeof raw === "boolean") correctAnswer = raw;
          else if (raw === 0 || raw === 1) correctAnswer = raw === 0; // 0=True, 1=False (matches your TF canonical)
          else if (typeof raw === "string") {
            const s = raw.trim().toLowerCase();
            if (s === "true" || s === "t" || s === "yes") correctAnswer = true;
            if (s === "false" || s === "f" || s === "no") correctAnswer = false;
          }

          // Fallback: isFalse is the inverse (AI description suggests this field name)
          if (correctAnswer === null && it?.isFalse !== undefined) {
            if (typeof it.isFalse === "boolean") correctAnswer = !it.isFalse;
            else if (typeof it.isFalse === "string") {
              const s = it.isFalse.trim().toLowerCase();
              if (s === "true" || s === "t" || s === "yes") correctAnswer = false;
              if (s === "false" || s === "f" || s === "no") correctAnswer = true;
            }
          }

          return { statement, correctAnswer };
        })
        .filter((it) => it.statement && typeof it.correctAnswer === "boolean");

      task.items = items;

      // Canonical config mirrors items AND provides statements for renderers that want it.
      task.config = {
        ...cfg,
        items: task.items,
        statements: task.items.map((it) => ({ text: it.statement, answer: it.correctAnswer })),
      };

      break;
    }

    case TASK_TYPES.TOWER_BUILDER: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      const itemsIn = Array.isArray(task.items)
        ? task.items
        : Array.isArray(cfg.items)
          ? cfg.items
          : Array.isArray(task.statements)
            ? task.statements
            : Array.isArray(cfg.statements)
              ? cfg.statements
              : [];

      const _validCats = new Set(["benefit", "harm", "neutral"]);

      const towerItems = itemsIn
        .map((it) => {
          const statement = isNonEmptyString(it?.statement)
            ? String(it.statement).trim()
            : isNonEmptyString(it?.text)
              ? String(it.text).trim()
              : isNonEmptyString(it?.prompt)
                ? String(it.prompt).trim()
                : "";

          let category = String(it?.category || "").toLowerCase();
          if (!_validCats.has(category)) {
            if (typeof it?.correctAnswer === "boolean") {
              category = it.correctAnswer ? "benefit" : "harm";
            } else if (typeof it?.isFalse === "boolean") {
              category = it.isFalse ? "harm" : "benefit";
            } else if (typeof it?.answer === "boolean") {
              category = it.answer ? "benefit" : "harm";
            } else {
              category = "benefit";
            }
          }

          return { statement, category };
        })
        .filter((it) => it.statement);

      task.items = towerItems;
      task.config = {
        ...cfg,
        items: task.items,
        statements: task.items.map((it) => ({ text: it.statement, category: it.category })),
      };
      break;
    }

    case TASK_TYPES.FLASHCARDS:
    case TASK_TYPES.FLASHCARDS_RACE: {
      // AI may place cards at root level (items, cards, flashcards, questions) or inside config.
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      const _fcSources = [
        cfg.items, task.items,
        cfg.cards, task.cards,
        cfg.flashcards, task.flashcards,
        cfg.questions, task.questions,
      ];
      let rawItems = [];
      for (const src of _fcSources) {
        if (Array.isArray(src) && src.length > 0) { rawItems = src; break; }
      }

      const cards = rawItems
        .map((it) => {
          // Handle string items: treat as a term (question = term, answer = term)
          if (typeof it === "string") {
            const trimmed = it.trim();
            return trimmed ? { question: trimmed, answer: trimmed } : null;
          }
          if (!it || typeof it !== "object") return null;
          const question = String(it.question || it.term || it.front || it.word || it.concept || it.prompt || it.text || it.clue || "").trim();
          const answer = String(it.answer || it.definition || it.back || it.meaning || it.response || it.correctAnswer || it.correct || "").trim();
          // Also handle {question, acceptableAnswers} shape where answer is in acceptableAnswers[0]
          const finalAnswer = answer || (Array.isArray(it.acceptableAnswers) && it.acceptableAnswers.length ? String(it.acceptableAnswers[0]).trim() : "");
          // If we have a question but no answer, use the question as both (better than dropping it)
          if (question && !finalAnswer) return { question, answer: question };
          return question && finalAnswer ? { question, answer: finalAnswer } : null;
        })
        .filter(Boolean);

      if (cards.length > 0) {
        cfg.items = cards;
      } else {
        console.warn(`[normalizeFlashcards] No valid cards found for ${task.taskType}. rawItems had ${rawItems.length} entries.`);
      }
      task.config = cfg;
      break;
    }

    case TASK_TYPES.LABELME: {
      // Canonical: labels[{id,correct,x,y}] + options[] (+ a marker→term
      // correctMatches map, reusing Matching's objective grading shape).
      const LETTERS = ["A", "B", "C", "D", "E"];
      const rawLabels = Array.isArray(task.labels)
        ? task.labels
        : Array.isArray(task.config?.labels)
        ? task.config.labels
        : [];
      const labels = rawLabels
        .map((l, i) => {
          const obj = isObject(l) ? l : {};
          const id = asNonEmptyString(obj.id, LETTERS[i] || `M${i + 1}`).toUpperCase();
          const correct = asNonEmptyString(obj.correct, asNonEmptyString(obj.term, asNonEmptyString(obj.answer, "")));
          const x = Math.max(0, Math.min(100, Number(obj.x)));
          const y = Math.max(0, Math.min(100, Number(obj.y)));
          return { id, correct, x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 };
        })
        .filter((l) => l.correct)
        .slice(0, 5);

      // Options: provided options ∪ all correct terms (dedup), keep strings.
      const provided = Array.isArray(task.options)
        ? task.options
        : Array.isArray(task.config?.options)
        ? task.config.options
        : [];
      const optSet = [];
      const seenOpt = new Set();
      for (const o of [...provided.map((s) => String(s || "").trim()), ...labels.map((l) => l.correct)]) {
        const key = o.toLowerCase();
        if (o && !seenOpt.has(key)) { seenOpt.add(key); optSet.push(o); }
      }

      task.labels = labels;
      task.options = optSet;
      task.correctMatches = Object.fromEntries(labels.map((l) => [l.id, l.correct]));
      task.imageUrl = asNonEmptyString(task.imageUrl, asNonEmptyString(task.config?.imageUrl, ""));
      task.imagePrompt = asNonEmptyString(task.imagePrompt, asNonEmptyString(task.config?.imagePrompt, ""));
      if (!isObject(task.grading)) task.grading = { exactMatch: true, partialCredit: true };
      break;
    }

    case TASK_TYPES.MAPIT: {
      // Canonical: markers[{number, lat, lng, correctAnswer, clue?, note?}] +
      // choices[] + map{centerLat, centerLng, zoom, regionHint?} + correctMatches
      // (markerId → correctAnswer, reusing Matching's scoring shape).
      const cfg = isObject(task.config) ? task.config : {};

      const rawMarkers = Array.isArray(task.markers)
        ? task.markers
        : Array.isArray(cfg.markers)
        ? cfg.markers
        : [];

      const markers = rawMarkers
        .map((m, i) => {
          const obj = isObject(m) ? m : {};
          const number = Number(obj.number ?? obj.markerNumber ?? i + 1);
          const lat = Number(obj.lat ?? obj.latitude);
          const lng = Number(obj.lng ?? obj.lon ?? obj.longitude);
          const correctAnswer = asNonEmptyString(
            obj.correctAnswer,
            asNonEmptyString(obj.label, asNonEmptyString(obj.answer, asNonEmptyString(obj.text, "")))
          );
          const clue = asNonEmptyString(obj.clue, asNonEmptyString(obj.hint, ""));
          const note = asNonEmptyString(obj.note, asNonEmptyString(obj.context, ""));
          return {
            id: `M${Number.isFinite(number) ? number : i + 1}`,
            number: Number.isFinite(number) ? number : i + 1,
            lat: Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : null,
            lng: Number.isFinite(lng) ? Math.max(-180, Math.min(180, lng)) : null,
            correctAnswer,
            ...(clue ? { clue } : {}),
            ...(note ? { note } : {}),
          };
        })
        .filter((m) => m.correctAnswer && m.lat !== null && m.lng !== null)
        // CAP: 3–5 markers is the playable range. Beyond 5 overwhelms the
        // student; force-trim. (Below 3 is caught by the validator.)
        .slice(0, 5);

      // Renumber sequentially in case the AI omitted/duplicated numbers.
      markers.forEach((m, i) => {
        m.number = i + 1;
        m.id = `M${i + 1}`;
      });

      // Choices: every correctAnswer is in the list, plus any user-provided
      // distractors. Dedup case-insensitively. Final count capped at 8 so
      // the picker doesn't get crowded.
      const providedChoices = Array.isArray(task.choices)
        ? task.choices
        : Array.isArray(cfg.choices)
        ? cfg.choices
        : [];
      const choiceTexts = [
        ...markers.map((m) => m.correctAnswer),
        ...providedChoices.map((c) => (typeof c === "string" ? c : (c?.text || c?.label || ""))).filter(Boolean),
      ];
      const seen = new Set();
      const choices = [];
      for (const c of choiceTexts) {
        const trimmed = String(c).trim().slice(0, 80);
        const key = trimmed.toLowerCase();
        if (trimmed && !seen.has(key)) { seen.add(key); choices.push(trimmed); }
        if (choices.length >= 8) break;
      }

      // Map viewport — default to North-American view if AI omitted it.
      const rawMap = isObject(task.map) ? task.map : isObject(cfg.map) ? cfg.map : {};
      const centerLat = Number(rawMap.centerLat ?? rawMap.center?.lat);
      const centerLng = Number(rawMap.centerLng ?? rawMap.center?.lng);
      const zoom = Number(rawMap.zoom);
      const map = {
        regionHint: asNonEmptyString(rawMap.regionHint, ""),
        centerLat: Number.isFinite(centerLat) ? centerLat : (markers.length ? markers.reduce((s, m) => s + m.lat, 0) / markers.length : 45),
        centerLng: Number.isFinite(centerLng) ? centerLng : (markers.length ? markers.reduce((s, m) => s + m.lng, 0) / markers.length : -90),
        zoom: Number.isFinite(zoom) ? Math.max(1, Math.min(10, zoom)) : 5,
      };

      task.markers = markers;
      task.choices = choices;
      task.map = map;
      // Mirror Matching's scoring shape so existing analytics + partial-credit
      // logic apply for free: markerId → correctAnswer.
      task.correctMatches = Object.fromEntries(markers.map((m) => [m.id, m.correctAnswer]));
      if (!isObject(task.grading)) task.grading = { exactMatch: true, partialCredit: true };
      break;
    }

    case TASK_TYPES.MATCHING: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      // Helper: convert a string[] or object[] into our {id, text} format
      const normItems = (arr, prefix) =>
        arr.map((x, i) => {
          if (typeof x === "string") return { id: `${prefix}${i + 1}`, text: x.trim() };
          const obj = isObject(x) ? x : {};
          const text = asNonEmptyString(obj.text, asNonEmptyString(obj.label, asNonEmptyString(obj.term, asNonEmptyString(obj.name, ""))));
          return { id: asNonEmptyString(obj.id, `${prefix}${i + 1}`), text };
        }).filter((x) => x.text);

      if (Array.isArray(cfg.pairs) && cfg.pairs.length > 0) {
        // config.pairs: [{left, right}]
        const pairs = cfg.pairs.filter(isObject);
        const leftItems = pairs
          .map((p, i) => ({ id: `L${i + 1}`, text: asNonEmptyString(p.left, "") }))
          .filter((x) => x.text);
        const rightItems = pairs
          .map((p, i) => ({ id: `R${i + 1}`, text: asNonEmptyString(p.right, "") }))
          .filter((x) => x.text);
        const correctMatches = {};
        for (let i = 0; i < Math.min(leftItems.length, rightItems.length); i++) correctMatches[leftItems[i].id] = rightItems[i].id;
        task.leftItems = leftItems;
        task.rightItems = rightItems;
        task.correctMatches = correctMatches;
      } else if (Array.isArray(cfg.leftItems) && cfg.leftItems.length > 0) {
        // config.leftItems / config.rightItems / config.correctMatches
        task.leftItems = normItems(cfg.leftItems, "L");
        task.rightItems = normItems(Array.isArray(cfg.rightItems) ? cfg.rightItems : [], "R");
        const rawCm = isObject(cfg.correctMatches) ? cfg.correctMatches : {};
        // Re-key: if AI used plain text labels as keys, map them to generated IDs
        const leftByText = Object.fromEntries(task.leftItems.map((x) => [x.text.toLowerCase(), x.id]));
        const rightByText = Object.fromEntries(task.rightItems.map((x) => [x.text.toLowerCase(), x.id]));
        const rightById = new Set(task.rightItems.map((x) => x.id));
        const leftById = new Set(task.leftItems.map((x) => x.id));
        const correctMatches = {};
        for (const [k, v] of Object.entries(rawCm)) {
          const leftId = leftById.has(k) ? k : (leftByText[k.toLowerCase()] || null);
          const rightId = rightById.has(v) ? v : (rightByText[String(v).toLowerCase()] || null);
          if (leftId && rightId) correctMatches[leftId] = rightId;
        }
        task.correctMatches = correctMatches;
      } else {
        // Root-level leftItems / rightItems (AI output or direct schema)
        task.leftItems = normItems(Array.isArray(task.leftItems) ? task.leftItems : [], "L");
        task.rightItems = normItems(Array.isArray(task.rightItems) ? task.rightItems : [], "R");
        // correctMatches: accept {L1:R1} or text-keyed maps
        const rawCm2 = isObject(task.correctMatches) ? task.correctMatches : {};
        if (Object.keys(rawCm2).length > 0) {
          const leftByText2 = Object.fromEntries(task.leftItems.map((x) => [x.text.toLowerCase(), x.id]));
          const rightByText2 = Object.fromEntries(task.rightItems.map((x) => [x.text.toLowerCase(), x.id]));
          const rightById2 = new Set(task.rightItems.map((x) => x.id));
          const leftById2 = new Set(task.leftItems.map((x) => x.id));
          const cm2 = {};
          for (const [k, v] of Object.entries(rawCm2)) {
            const leftId = leftById2.has(k) ? k : (leftByText2[k.toLowerCase()] || null);
            const rightId = rightById2.has(v) ? v : (rightByText2[String(v).toLowerCase()] || null);
            if (leftId && rightId) cm2[leftId] = rightId;
          }
          task.correctMatches = cm2;
        } else {
          task.correctMatches = {};
        }
      }

      // Do NOT pad with placeholder items — let validation reject if < 5.
      // Padding with "Left 1"/"Right 1" creates unplayable tasks that slip past checks.

      if (!isObject(task.correctMatches)) task.correctMatches = {};

      // Only auto-fill correctMatches if both sides have real items
      const minLen = Math.min(task.leftItems.length, task.rightItems.length);
      for (let i = 0; i < minLen; i++) {
        const l = task.leftItems[i];
        const r = task.rightItems[i];
        if (l && r && task.correctMatches[l.id] == null) task.correctMatches[l.id] = r.id;
      }

      // --- CAP: matching past ~8 pairs is too long to play; trim both columns and drop orphaned matches ---
      const MATCHING_MAX_PAIRS = 8;
      if (task.leftItems.length > MATCHING_MAX_PAIRS) task.leftItems = task.leftItems.slice(0, MATCHING_MAX_PAIRS);
      if (task.rightItems.length > MATCHING_MAX_PAIRS) task.rightItems = task.rightItems.slice(0, MATCHING_MAX_PAIRS);
      if (isObject(task.correctMatches)) {
        const keptLeft = new Set(task.leftItems.map((x) => x.id));
        const keptRight = new Set(task.rightItems.map((x) => x.id));
        const trimmedCm = {};
        for (const [k, v] of Object.entries(task.correctMatches)) {
          if (keptLeft.has(k) && keptRight.has(v)) trimmedCm[k] = v;
        }
        task.correctMatches = trimmedCm;
      }

      // --- GUARDRAIL: Reject matching tasks with empty content ---
      if (!task.leftItems.length || !task.rightItems.length || !Object.keys(task.correctMatches).length) {
        task._validationError = `Matching task has no content: ${task.leftItems.length} left items, ${task.rightItems.length} right items, ${Object.keys(task.correctMatches).length} matches — must have at least 4 pairs`;
      }
      break;
    }

    case TASK_TYPES.ECHO_CHAIN: {
      // Echo-chain: oral memory game. Needs config.seedTerm (one word/phrase).
      const ecCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize seedTerm from various field names AI might use
      if (!ecCfg.seedTerm) {
        ecCfg.seedTerm =
          task.seedTerm || ecCfg.startWord || task.startWord ||
          ecCfg.word || task.word || ecCfg.concept || task.concept || "";
      }
      ecCfg.seedTerm = String(ecCfg.seedTerm || "").trim();
      if (!ecCfg.minChainLength) ecCfg.minChainLength = 5;
      task.title = asNonEmptyString(task.title, "Echo Chain");
      task.prompt = asNonEmptyString(task.prompt, "Repeat the chain aloud, then add one related word!");
      break;
    }

    case TASK_TYPES.NARRATION_SYNTHESIZE: {
      const nsCfg = isObject(task.config) ? task.config : (task.config = {});
      let pc = nsCfg.playerCount ?? nsCfg.players ?? task.playerCount;
      if (typeof pc === "string" && !Number.isNaN(Number(pc))) pc = Number(pc);
      if (typeof pc !== "number" || Number.isNaN(pc)) pc = 4;
      nsCfg.playerCount = Math.max(2, Math.min(8, pc));

      let prompts =
        (Array.isArray(nsCfg.prompts) && nsCfg.prompts) ||
        (Array.isArray(task.prompts) && task.prompts) ||
        (Array.isArray(nsCfg.items) && nsCfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        [];

      // PRESERVE object shape. The renderer requires {id, concept, prompt}
      // per entry. Previously this block did String(p) — which turned every
      // object into the literal string "[object Object]", which then got
      // flagged by the placeholder-text guard. Strings are kept as-is and
      // sanitizeTaskShapeByType converts them to proper objects downstream.
      prompts = prompts
        .map((p) => {
          if (typeof p === "string") return p.trim() || null;
          if (p && typeof p === "object") return p;
          return null;
        })
        .filter(Boolean);
      if (prompts.length < 2) {
        prompts = [
          "Continue the chain with one sentence.",
          "Add a detail that changes the meaning.",
        ];
      }
      nsCfg.prompts = prompts;

      task.title = asNonEmptyString(task.title, "Narration Synthesize");
      task.prompt = asNonEmptyString(task.prompt, "Players take turns adding to a shared narration. Follow the prompts.");
      break;
    }

    case TASK_TYPES.FAKE_OUT: {
      const cfg = isObject(task.config) ? task.config : {};
      const roundsIn = Array.isArray(task.rounds)
        ? task.rounds
        : Array.isArray(cfg.rounds)
          ? cfg.rounds
          : [];

      const rounds = roundsIn
        .map((r) => {
          const prompt = isNonEmptyString(r?.prompt) ? String(r.prompt).trim() : "";

          const baseOptions = Array.isArray(r?.options)
            ? r.options.map((o) => String(o || "").trim()).filter(isNonEmptyString)
            : [];

          const jokeOption = isNonEmptyString(r?.jokeOption) ? String(r.jokeOption).trim() : "";
          const correctOption = isNonEmptyString(r?.correctOption) ? String(r.correctOption).trim() : "";

          let options = baseOptions;

          // Canonicalize to 4 options when we have 3 + jokeOption
          if (options.length === 3 && jokeOption) {
            const desiredJokeIndex = Number.isInteger(r?.jokeIndex) ? r.jokeIndex : 3;
            const insertAt = clampInt(desiredJokeIndex, 0, 3);
            options = [...options.slice(0, insertAt), jokeOption, ...options.slice(insertAt)];
          }

          // Resolve indexes from options if needed
          const jokeIndex =
            Number.isInteger(r?.jokeIndex)
              ? r.jokeIndex
              : jokeOption
                ? options.findIndex((o) => o === jokeOption)
                : -1;

          const correctIndex =
            Number.isInteger(r?.correctIndex)
              ? r.correctIndex
              : correctOption
                ? options.findIndex((o) => o === correctOption)
                : -1;

          return {
            prompt,
            options,
            jokeOption: jokeOption || (jokeIndex >= 0 ? options[jokeIndex] : ""),
            correctOption: correctOption || (correctIndex >= 0 ? options[correctIndex] : ""),
            jokeIndex,
            correctIndex,
          };
        })
        .filter((r) => r.prompt);

      task.rounds = rounds;

      task.config = {
        ...cfg,
        rounds,
        pointsPerCorrect: Number.isFinite(cfg.pointsPerCorrect) ? cfg.pointsPerCorrect : 10,
        readerBonusPoints: Number.isFinite(cfg.readerBonusPoints) ? cfg.readerBonusPoints : 0,
        interTeamEnabled: !!cfg.interTeamEnabled,
        intraTeamEnabled: cfg.intraTeamEnabled !== false,
        playerCount: Number.isFinite(cfg.playerCount) ? cfg.playerCount : 4,
      };

      break;
    }

    case TASK_TYPES.MAD_DASH: {
      const cfg = isObject(task.config) ? { ...task.config } : {};

      let seq =
        Array.isArray(task.sequence) ? task.sequence :
        Array.isArray(cfg.sequence) ? cfg.sequence :
        Array.isArray(task.items) ? task.items :
        Array.isArray(cfg.items) ? cfg.items :
        [];

      seq = seq
        .map((x) => (isObject(x) ? x.text ?? x.prompt ?? x.label ?? x.color : x))
        .map((s) => asNonEmptyString(s, "").trim())
        .filter(Boolean);

      while (seq.length < 3) seq.push(`Step ${seq.length + 1}`);
      if (seq.length > 8) seq = seq.slice(0, 8);

      task.sequence = seq;
      task.items = seq;
      cfg.sequence = seq;
      cfg.items = seq;
      task.config = cfg;

      task.title = asNonEmptyString(task.title, "Mad Dash");
      task.prompt = asNonEmptyString(task.prompt, "Scan the colours/stations in the given order.");
      break;
    }

    case TASK_TYPES.MAD_DASH_SEQUENCE: {
      const cfg = isObject(task.config) ? { ...task.config } : {};

      let items =
        Array.isArray(cfg.items) ? cfg.items :
        Array.isArray(task.items) ? task.items :
        Array.isArray(task.sequence) ? task.sequence :
        Array.isArray(cfg.sequence) ? cfg.sequence :
        [];

      items = items
        .map((x) => (isObject(x) ? x.text ?? x.prompt ?? x.label ?? x.value : x))
        .map((s) => asNonEmptyString(s, "").trim())
        .filter(Boolean);

      while (items.length < 3) items.push(`Item ${items.length + 1}`);

      let order =
        cfg.correctOrder ?? task.correctOrder ??
        cfg.answerKey ?? task.answerKey ??
        cfg.correctAnswer ?? task.correctAnswer ??
        null;

      // Reorder items into their correct sequence first, then CAP to 4 steps.
      // Testers: 5 was too many, and the steps must have a clear single order.
      // Capping after reordering keeps the kept subset a valid ordered sequence.
      const isValidPerm =
        Array.isArray(order) &&
        order.length === items.length &&
        order.every((o) => Number.isInteger(o) && o >= 0 && o < items.length) &&
        new Set(order).size === items.length;
      if (isValidPerm) items = order.map((o) => items[o]);
      if (items.length > 4) items = items.slice(0, 4);
      // Items are now in correct order → identity ordering.
      order = items.map((_, i) => i);

      cfg.items = items;
      cfg.correctOrder = order;

      task.items = items;
      task.sequence = items;
      task.correctOrder = order;
      task.config = cfg;

      task.title = asNonEmptyString(task.title, "Mad Dash Sequence");
      task.prompt = asNonEmptyString(task.prompt, "Determine the correct order, then scan the colours in that order.");
      break;
    }

    case TASK_TYPES.READING_COMP: {
      const cfg = isObject(task.config) ? { ...task.config } : {};

      const passage = asNonEmptyString(
        cfg.text,
        asNonEmptyString(
          cfg.passage,
          asNonEmptyString(
            cfg.readingPassage,
            asNonEmptyString(
              cfg.generatedParagraph,
              asNonEmptyString(
                task.generatedParagraph,
                asNonEmptyString(
                  task.passage,
                  asNonEmptyString(task.readingPassage, asNonEmptyString(task.text, asNonEmptyString(task.paragraph, "")))
                )
              )
            )
          )
        )
      ).trim();

      const finalPassage = passage || "Read the following passage carefully.";

      cfg.text = finalPassage;
      cfg.generatedParagraph = finalPassage;
      cfg.passage = finalPassage;
      cfg.reading = finalPassage;

      let qs =
        Array.isArray(cfg.questions) ? cfg.questions :
        Array.isArray(task.questions) ? task.questions :
        Array.isArray(task.items) ? task.items :
        Array.isArray(cfg.items) ? cfg.items :
        Array.isArray(task.prompts) ? task.prompts :
        [];

      // Detect placeholder / blank-filler patterns from the AI
      function _isPlaceholderQuestion(s) {
        if (!s) return true;
        const t = String(s).trim().toLowerCase();
        return (
          t.includes("_____") ||
          t.includes("____") ||
          t.includes("[blank]") ||
          /^question\s*\d+\s*[:\-]?\s*$/.test(t) ||   // "Question 1:", "Question 2 -", etc.
          /^question\s*\d+\s*[:\-]\s*_+\s*$/.test(t)  // "Question 1: _____"
        );
      }

      qs = qs
        .map((q, i) => {
          if (isObject(q)) {
            const prompt = asNonEmptyString(q.prompt, asNonEmptyString(q.question, asNonEmptyString(q.text, "")));
            const answer = asNonEmptyString(q.answer, asNonEmptyString(q.correctAnswer, ""));
            return { id: ensureId(q, i), prompt, answer: answer || undefined };
          }
          const prompt = asNonEmptyString(q, "");
          return { id: String(i + 1), prompt, answer: undefined };
        })
        // Remove empty OR placeholder questions
        .filter((x) => asNonEmptyString(x.prompt) && !_isPlaceholderQuestion(x.prompt));

      // ✅ Replace blank-fillers / too-few questions with safe generic fallbacks
      if (qs.length < 3) {
        qs = [
          { id: "1", prompt: "What is the main idea of the passage?", answer: undefined },
          { id: "2", prompt: "Name one important detail that supports the main idea.", answer: undefined },
          { id: "3", prompt: "What conclusion can you draw from the passage?", answer: undefined },
        ];
      }

      cfg.questions = qs;

      // Store passage under two canonical keys only (text + passage).
      // Older code used generatedParagraph and reading as well — drop them to avoid quadruple bloat.
      cfg.text    = finalPassage;
      cfg.passage = finalPassage;
      delete cfg.generatedParagraph;
      delete cfg.reading;

      // Keep one root-level alias for renderers that read task.passage directly
      task.passage = finalPassage;
      delete task.reading;
      delete task.text;

      task.config = cfg;

      // --- GUARDRAIL: AUTO-FIX topic-bouncing passages ---
      // Instead of rejecting (AI keeps producing the same thing on retry),
      // programmatically strip the passage down to the dominant topic.
      if (finalPassage && finalPassage.length > 100) {
        const topicSignals = [
          { rx: /\bsoap[- ]?making\b/i, label: "soap-making" },
          { rx: /\bcandle[- ]?making\b/i, label: "candle-making" },
          { rx: /\bwool\s+spinning\b/i, label: "wool spinning" },
          { rx: /\bbackwoods\b/i, label: "backwoods" },
          { rx: /\bcrown\s+reserve\b/i, label: "crown reserve" },
          { rx: /\bclergy\s+reserve\b/i, label: "clergy reserve" },
          { rx: /\b1793\s+act\b/i, label: "1793 act" },
          { rx: /\bslavery\b/i, label: "slavery" },
          { rx: /\bemancipation\b/i, label: "emancipation" },
          { rx: /\bfur\s+trade\b/i, label: "fur trade" },
          { rx: /\bgreat\s+awakening\b/i, label: "great awakening" },
          { rx: /\bsewing\b/i, label: "sewing" },
          { rx: /\bschooling\b/i, label: "schooling" },
          { rx: /\bone[- ]?room\s+school/i, label: "one-room school" },
          { rx: /\bgovernor\s+simcoe\b/i, label: "governor simcoe" },
          { rx: /\bloyalist/i, label: "loyalist" },
          { rx: /\bm[eé]tis\b/i, label: "métis" },
          { rx: /\bpemmican\b/i, label: "pemmican" },
          { rx: /\bsmallpox\b/i, label: "smallpox" },
          { rx: /\bepidemic/i, label: "epidemic" },
          { rx: /\bdebtors['']?\s*prison\b/i, label: "debtors prison" },
          { rx: /\bfire\s+safety\b/i, label: "fire safety" },
        ];

        // Split into sentences and tag each with the topics it mentions
        const sentences = finalPassage.match(/[^.!?]+[.!?]+/g) || [finalPassage];
        const sentenceTopics = sentences.map((sent) => ({
          text: sent.trim(),
          topics: topicSignals.filter((t) => t.rx.test(sent)).map((t) => t.label),
        }));

        // Count which topics appear across ALL sentences
        const topicCounts = {};
        for (const st of sentenceTopics) {
          for (const t of st.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
        }
        const distinctTopics = Object.keys(topicCounts);

        if (distinctTopics.length >= 4) {
          // Find the dominant topic (most sentence mentions)
          const dominant = distinctTopics.sort((a, b) => topicCounts[b] - topicCounts[a])[0];
          // Also allow closely related topics (mentioned in same sentences as dominant)
          const relatedTopics = new Set([dominant]);
          for (const st of sentenceTopics) {
            if (st.topics.includes(dominant)) {
              for (const t of st.topics) relatedTopics.add(t);
            }
          }

          // Keep sentences that mention the dominant/related topics, OR are topic-free (connective tissue)
          const filtered = sentenceTopics.filter((st) =>
            st.topics.length === 0 || st.topics.some((t) => relatedTopics.has(t))
          );

          if (filtered.length >= 4) {
            const newPassage = filtered.map((s) => s.text).join(" ");
            cfg.text = newPassage;
            cfg.passage = newPassage;
            task.passage = newPassage;
            console.warn(`[Quality Auto-Fix] Reading passage trimmed from ${sentences.length} sentences (${distinctTopics.length} topics) to ${filtered.length} sentences focused on "${dominant}"`);
          }
          // If filtering left too few sentences, keep original — imperfect but playable
        }
      }

      // --- GUARDRAIL: Auto-fix prompt/passage content mismatch ---
      // When the prompt references specific topics not found in the passage,
      // rewrite the prompt to be generic so students aren't confused.
      const currentPassage = cfg.text || cfg.passage || "";
      const currentPrompt = asNonEmptyString(task.prompt, "");
      if (currentPassage.length > 50 && currentPrompt.length > 10) {
        // Extract quoted terms, capitalized phrases, and specific references from the prompt
        const promptTerms = [];
        // Match phrases like "crown reserve", "1793 act", multi-word capitalized terms
        const termPatterns = [
          /\b(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,  // "Crown Reserve", "Great Awakening"
          /\b(\d{4}\s+[Aa]ct)\b/g,                             // "1793 Act"
          /\b([A-Z][a-z]+(?:\s+[a-z]+){0,2}\s+(?:Act|Treaty|Law|Bill|Reserve))\b/g,
        ];
        for (const rx of termPatterns) {
          let m;
          while ((m = rx.exec(currentPrompt)) !== null) {
            const term = m[1].trim();
            if (term.length > 3) promptTerms.push(term);
          }
        }

        if (promptTerms.length > 0) {
          const passageLower = currentPassage.toLowerCase();
          const missing = promptTerms.filter((t) => !passageLower.includes(t.toLowerCase()));
          // If most prompt-specific terms are missing from the passage, rewrite the prompt
          if (missing.length > 0 && missing.length >= promptTerms.length * 0.5) {
            task.prompt = "Read the passage and answer the questions.";
            console.warn(`[Quality Auto-Fix] Reading prompt rewritten — referenced terms not in passage: ${missing.join(", ")}`);
          }
        }
      }

      // --- GUARDRAIL: Detect dangling references in passage ---
      // The AI sometimes generates "This law affected..." without naming the law,
      // or "These changes..." without specifying what changed. This confuses students.
      {
        const passageText = cfg.text || cfg.passage || "";
        const sentences = passageText.match(/[^.!?]+[.!?]+/g) || [];
        if (sentences.length >= 2) {
          // Check if early sentences (1st or 2nd) use dangling demonstratives
          // without a prior sentence establishing the referent
          const danglingPattern = /\b(this|these|that|those)\s+(law|act|event|change|movement|policy|practice|development|issue|conflict|situation|problem|decision|reform|rule|treaty|agreement)\b/i;
          for (let si = 0; si < Math.min(sentences.length, 3); si++) {
            const sent = sentences[si].trim();
            const dm = sent.match(danglingPattern);
            if (dm) {
              // Check if ANY prior sentence mentions a specific noun that could be the referent
              const referentText = sentences.slice(0, si).join(" ").toLowerCase();
              const referent = dm[2].toLowerCase(); // e.g. "law"
              // Look for a SPECIFIC instance: "the 1793 Act", "the Clergy Reserve", a capitalized proper noun + referent type
              const hasSpecificReferent = /\b(the\s+)?(\d{4}\s+)?[A-Z][a-z]/.test(sentences.slice(0, si).join(" "))
                && referentText.includes(referent);
              if (!hasSpecificReferent && si <= 1) {
                // Dangling ref in first 2 sentences = hard reject (confusing for students)
                task._validationError = `Reading passage has a dangling reference: "${dm[0]}" in sentence ${si + 1} without naming what "${dm[2]}" refers to. The passage must introduce specific nouns before using "this/these/that".`;
                break;
              }
            }
          }
        }
      }

      task.title = asNonEmptyString(task.title, "Reading Comprehension");
      task.prompt = asNonEmptyString(task.prompt, "Read the passage and answer the questions.");
      break;
    }

    case TASK_TYPES.MIND_MAPPER: {
      if (!isObject(task.structure) && isObject(task.config?.structure)) task.structure = task.config.structure;
      if (!Array.isArray(task.items) && Array.isArray(task.config?.items)) task.items = task.config.items;
      if (!Array.isArray(task.items) && Array.isArray(task.prompts)) task.items = task.prompts;

      task.items = Array.isArray(task.items)
        ? task.items
            .map((it, i) => {
              const obj = isObject(it) ? { ...it } : {};
              return { id: ensureId(obj, i), text: asNonEmptyString(obj.text, asNonEmptyString(obj.prompt, "")) };
            })
            .filter((x) => x.text)
        : [];

      // NOTE: Do NOT pad with placeholder text like "Concept N" — that triggers
      // placeholder rejection in validation. If items < 4, let validation catch it.
      // The template-based generator guarantees the correct count.

      task.items = task.items.map((it) => asNonEmptyString(it.text, "")).map((s) => String(s).trim()).filter(Boolean);

      // --- CAP: a mind map past ~7 branches is unreadable / too much to fill in ---
      const MIND_MAPPER_MAX_ITEMS = 7;
      if (task.items.length > MIND_MAPPER_MAX_ITEMS) {
        task.items = task.items.slice(0, MIND_MAPPER_MAX_ITEMS);
      }

      if (!isObject(task.structure)) {
        task.structure = { center: "Main Idea", branches: task.items.map((t) => `${t}: _____`) };
      } else {
        const structureText = JSON.stringify(task.structure);
        if (!structureText.includes("_____")) {
          task.structure.branches = Array.isArray(task.structure.branches)
            ? task.structure.branches.map((b) => `${b} _____`)
            : task.items.map((t) => `${t}: _____`);
        }
      }

      // Keep branch count in step with the item cap
      if (isObject(task.structure) && Array.isArray(task.structure.branches) && task.structure.branches.length > MIND_MAPPER_MAX_ITEMS) {
        task.structure.branches = task.structure.branches.slice(0, MIND_MAPPER_MAX_ITEMS);
      }

      task.title = asNonEmptyString(task.title, "Mind Mapper");
      task.prompt = asNonEmptyString(task.prompt, "Complete the mind map by filling in the missing information.");

      task.config = isObject(task.config) ? task.config : {};
      task.config.structure = task.structure;
      break;
    }

    case TASK_TYPES.ROLE_PLAY_DECK: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      const scenario = cfg.scenario ?? task.scenario ?? cfg.context ?? task.context ?? cfg.prompt ?? "";
      cfg.scenario = String(scenario || "").trim();

      let roles =
        (Array.isArray(cfg.roles) && cfg.roles) ||
        (Array.isArray(task.roles) && task.roles) ||
        (Array.isArray(cfg.items) && cfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        [];

      roles = roles
        .map((r, i) => {
          if (typeof r === "string") return { name: r.trim(), goal: "", constraint: "" };
          const name = String(r?.name || r?.role || r?.title || `Role ${i + 1}`).trim();
          const goal = String(r?.goal || r?.objective || "").trim();
          const constraint = String(r?.constraint || r?.rule || "").trim();
          return { ...r, name, goal, constraint };
        })
        .filter((r) => r.name);

      if (!cfg.scenario) cfg.scenario = "Work through the scenario respectfully and aim for a constructive outcome.";
      // Do NOT pad with placeholder roles — let validation reject if < 2 real roles
      // Filter out generic placeholder role names
      roles = roles.filter((r) => !/^role\s*[A-Z0-9]$/i.test(r.name));

      cfg.roles = roles;

      task.title = asNonEmptyString(task.title, "Role Play Deck");
      task.prompt = asNonEmptyString(task.prompt, "Read your role card and act it out within the scenario.");
      break;
    }

    case TASK_TYPES.PRONUNCIATION: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      const ref = task.referenceText ?? cfg.referenceText ?? task.text ?? cfg.text ?? task.promptText ?? cfg.promptText ?? "";
      task.referenceText = String(ref || "").trim();
      cfg.referenceText = task.referenceText;

      if (!task.referenceText) {
        task.referenceText = "Read this sentence clearly and at a steady pace.";
        cfg.referenceText = task.referenceText;
      }

      task.title = asNonEmptyString(task.title, "Pronunciation");
      task.prompt = asNonEmptyString(task.prompt, "Listen and repeat the reference text carefully.");
      break;
    }

    case TASK_TYPES.SCRIPT_PLAY: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});
      let lines =
        (Array.isArray(task.lines) && task.lines) ||
        (Array.isArray(cfg.lines) && cfg.lines) ||
        (Array.isArray(task.dialogue) && task.dialogue) ||
        (Array.isArray(cfg.dialogue) && cfg.dialogue) ||
        [];

      lines = lines
        .map((l) => {
          if (typeof l === "string") return l.trim();
          const speaker = String(l?.speaker || l?.name || "").trim();
          const text = String(l?.text || l?.line || l?.say || "").trim();
          if (!text) return "";
          return speaker ? `${speaker}: ${text}` : text;
        })
        .filter(Boolean);

      if (lines.length < 4) {
        const blob = String(task.script || cfg.script || task.text || "").trim();
        if (blob) {
          const split = blob.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (split.length >= 4) lines = split;
        }
      }

      if (lines.length < 4) {
        lines = [
          "Narrator: The scene opens with a problem to solve.",
          "Student A: I think we should try a different approach.",
          "Student B: What evidence do we have?",
          "Narrator: They agree on a plan and act on it.",
        ];
      }

      task.lines = lines;
      cfg.lines = lines;

      // Setting paragraph: introduces scene and assigns roles to team members
      let setting = String(task.setting || cfg.setting || task.config?.setting || "").trim();
      // Extract character names from lines if no roles provided
      let roles = Array.isArray(task.roles) ? task.roles :
        Array.isArray(cfg.roles) ? cfg.roles :
        Array.isArray(task.config?.roles) ? task.config.roles : [];

      if (!roles.length) {
        // Infer roles from "Speaker: ..." lines
        const seen = new Set();
        for (const l of lines) {
          const m = l.match(/^([^:]+):/);
          if (m) {
            const name = m[1].trim().replace(/\(.*\)/, "").trim();
            if (name && !seen.has(name)) { seen.add(name); roles.push(name); }
          }
        }
      }

      if (!setting && roles.length) {
        const assignments = roles.map((r, i) => `Team member ${i + 1}, you are ${r}`).join(". ") + ".";
        setting = `This is a short script with ${roles.length} roles: ${roles.join(", ")}. ${assignments} Read your lines with expression and pass the device to the next speaker.`;
      }

      task.setting = setting;
      task.roles = roles;
      cfg.setting = setting;
      cfg.roles = roles;

      task.title = asNonEmptyString(task.title, "Script Play");
      task.prompt = asNonEmptyString(task.prompt, "Act out the script with your group.");
      break;
    }

    case TASK_TYPES.BRAIN_SPARK_NOTES: {
      const cfg = isObject(task.config) ? { ...task.config } : {};
      const notes = isObject(task.notes) ? { ...task.notes } : isObject(cfg.notes) ? { ...cfg.notes } : {};

      const heading =
        asNonEmptyString(notes.heading, "") ||
        asNonEmptyString(notes.title, "") ||
        asNonEmptyString(task.title, "") ||
        "Brain Spark Notes";
      notes.heading = heading;

      let keyTerms =
        Array.isArray(task.keyTerms) ? task.keyTerms :
        Array.isArray(notes.keyTerms) ? notes.keyTerms :
        Array.isArray(cfg.keyTerms) ? cfg.keyTerms :
        [];

      keyTerms = keyTerms.map((kt, i) => {
        const obj = isObject(kt) ? { ...kt } : {};
        const term = asNonEmptyString(obj.term, asNonEmptyString(obj.title, `Key Term ${i + 1}`));

        let points = Array.isArray(obj.points) ? obj.points : Array.isArray(obj.bullets) ? obj.bullets : [];
        points = points.map((p) => asNonEmptyString(p, "")).map((s) => s.trim()).filter(Boolean);

        const definition =
          asNonEmptyString(obj.definition, "") ||
          asNonEmptyString(obj.def, "") ||
          asNonEmptyString(obj.meaning, "") ||
          asNonEmptyString(obj.description, "");

        const safeDefinition = definition || points[0] || `Definition: ${term}`;

        while (points.length < 2) {
          points.push(points.length === 0 ? `Key idea about ${term}` : `Another key idea about ${term}`);
        }

        return { term, definition: safeDefinition, points };
      });

      while (keyTerms.length < 3) {
        const n = keyTerms.length + 1;
        keyTerms.push({
          term: `Key Term ${n}`,
          definition: `Definition: Key Term ${n}`,
          points: [`Key idea about Key Term ${n}`, `Another key idea about Key Term ${n}`],
        });
      }

      let mainPoints =
        Array.isArray(notes.mainPoints) ? notes.mainPoints :
        Array.isArray(cfg.mainPoints) ? cfg.mainPoints :
        Array.isArray(notes.sections) ? notes.sections :
        [];

      mainPoints = mainPoints.map((mp, i) => {
        const obj = isObject(mp) ? { ...mp } : {};
        const mpHeading = asNonEmptyString(obj.heading, "") || asNonEmptyString(obj.title, "") || `Main Point ${i + 1}`;

        const hasSections = Array.isArray(obj.sections) && obj.sections.length > 0;
        if (hasSections) {
          const sections = obj.sections.map((sec, j) => {
            const sObj = isObject(sec) ? { ...sec } : {};
            const title = asNonEmptyString(sObj.title, asNonEmptyString(sObj.heading, `Section ${j + 1}`));
            let bullets = Array.isArray(sObj.bullets) ? sObj.bullets : [];
            bullets = bullets.map((b) => asNonEmptyString(b, "")).map((s) => s.trim()).filter(Boolean);
            while (bullets.length < 2) bullets.push(bullets.length === 0 ? `Key detail for ${title}` : `Another detail for ${title}`);
            return { title, bullets };
          });

          if (sections.length === 0) {
            sections.push({ title: "Section 1", bullets: ["Key detail", "Another key detail"] });
          }
          return { heading: mpHeading, sections };
        }

        let bullets = Array.isArray(obj.bullets) ? obj.bullets
          : Array.isArray(obj.details) ? obj.details
          : Array.isArray(obj.points) ? obj.points
          : (typeof obj.content === "string" && obj.content.trim() ? [obj.content.trim()] : []);
        bullets = bullets.map((b) => asNonEmptyString(b, "")).map((s) => s.trim()).filter(Boolean);
        while (bullets.length < 2) bullets.push(bullets.length === 0 ? `Key idea for ${mpHeading}` : `Another key idea for ${mpHeading}`);
        return { heading: mpHeading, bullets };
      });

      while (mainPoints.length < 3) {
        const n = mainPoints.length + 1;
        mainPoints.push({
          heading: `Main Point ${n}`,
          bullets: [`Key idea for Main Point ${n}`, `Another key idea for Main Point ${n}`],
        });
      }

      let summary =
        Array.isArray(notes.summary) ? notes.summary :
        Array.isArray(cfg.summary) ? cfg.summary :
        [];

      summary = summary.map((s) => asNonEmptyString(s, "")).map((s) => s.trim()).filter(Boolean);
      // Ensure at least 1 summary point; duplicate the first if only one exists rather than
      // injecting a generic placeholder that would be visible to students.
      if (summary.length === 0) summary.push("Key summary point");
      if (summary.length < 2) summary.push(summary[0]);

      notes.keyTerms = keyTerms;
      notes.mainPoints = mainPoints;
      notes.summary = summary;

      task.notes = notes;

      // ✅ bullets should be >=3 and derived from summary (but not overwrite with summary accidentally)
      const bullets = Array.isArray(summary) ? [...summary] : [];
      // Pad bullets by reusing existing content rather than adding numbered placeholders
      while (bullets.length < 3 && summary.length > 0) bullets.push(summary[bullets.length % summary.length]);
      task.bullets = bullets;

      // ✅ FIX: preserve cfg + mirror bullets correctly (do NOT set bullets: summary)
      task.config = { ...cfg, notes, bullets };

      task.title = asNonEmptyString(task.title, "Brain Spark Notes");
      task.prompt = asNonEmptyString(task.prompt, "Copy these notes carefully into your notebook. Write clearly and keep the structure.");
      break;
    }

    case TASK_TYPES.HANGMAN_DUEL: {
      const cfg = isObject(task.config) ? { ...task.config } : {};
      if (!Array.isArray(cfg.wordsByStation) && Array.isArray(task.wordsByStation)) cfg.wordsByStation = task.wordsByStation;
      if (!Array.isArray(cfg.wordsByStation) && Array.isArray(task.config?.words)) cfg.wordsByStation = task.config.words;

      cfg.wordsByStation = Array.isArray(cfg.wordsByStation)
        ? cfg.wordsByStation
            .map((w) => {
              const obj = isObject(w) ? { ...w } : {};
              const word = asNonEmptyString(obj.word, asNonEmptyString(obj.answer, asNonEmptyString(obj.text, "")));
              const hint = asNonEmptyString(obj.hint, asNonEmptyString(obj.clue, asNonEmptyString(obj.category, "")));
              return { word, hint: hint || "" };
            })
            .filter((x) => x.word)
        : [];

      // Trim to 8 if AI generated more (common: prompt says 10-16)
      if (cfg.wordsByStation.length > 12) cfg.wordsByStation = cfg.wordsByStation.slice(0, 12);

      // Do NOT pad with placeholder words — let validation reject if < 8

      task.config = cfg;
      break;
    }

    case TASK_TYPES.DRAW_MIME: {
      // Draw-mime clues must be 1-5 words each (e.g. "gravity", "water cycle").
      // AI often generates long prompt text instead of short clues — we extract or reject.

      const MAX_CLUE_WORDS = 5;
      const MAX_CLUE_CHARS = 40;

      // Check if a string is a valid short clue (1-5 words, ≤40 chars)
      const MIN_CLUE_CHARS = 3;
      const STOP_WORDS = new Set(["i","a","an","the","or","and","of","to","in","on","at","is","it","be","do","no","so","if","up","by","my","we","he","she","me"]);
      // Words that indicate a task title / category, not a drawable clue
      const TITLE_WORDS = /\b(vocabulary|vocab|review|quiz|test|activity|task|exercise|assignment|history|science|math|english|french|chapter|unit|lesson|draw|mime|practice)\b/i;
      const _isValidClue = (s) => {
        if (!s) return false;
        const trimmed = s.trim();
        if (!trimmed || trimmed.length < MIN_CLUE_CHARS || trimmed.length > MAX_CLUE_CHARS) return false;
        const words = trimmed.split(/\s+/);
        if (words.length < 1 || words.length > MAX_CLUE_WORDS) return false;
        // Reject if every word is a stop word
        if (words.every((w) => STOP_WORDS.has(w.toLowerCase()))) return false;
        // Reject generic task titles / category names
        if (TITLE_WORDS.test(trimmed)) return false;
        return true;
      };

      // Try to extract short noun phrases from a long string
      // (e.g. "Draw pictures for each prompt: photosynthesis, gravity, water cycle" → ["photosynthesis", "gravity", "water cycle"])
      const _extractCluesFromText = (text) => {
        if (!text) return [];
        // Try splitting by common delimiters
        const candidates = text
          .split(/[,;\n•\-\d+\.\)]+/)
          .map((s) => s.replace(/^[\s:]+|[\s.!?]+$/g, "").trim())
          .filter((s) => s.length > 0 && s.length <= MAX_CLUE_CHARS);

        // Keep only ones that look like short noun phrases (1-5 words, no instruction verbs)
        const instructionPattern = /^(draw|mime|act|sort|arrange|sequence|order|match|categorize|include|be sure|make|write|read|explain|describe|list|for each|pictures for)/i;
        const good = candidates.filter((c) => {
          const words = c.split(/\s+/).length;
          return words >= 1 && words <= MAX_CLUE_WORDS && !instructionPattern.test(c);
        });
        return good.slice(0, 4);
      };

      // --- Normalise clues array ---
      // Priority: explicit clues > vocabulary/word list > prompt text extraction

      let clues = Array.isArray(task.clues)
        ? task.clues.map((c) => String(c || "").trim()).filter(Boolean)
        : [];

      // Also check config.clues
      if (!clues.length && Array.isArray(task.config?.clues)) {
        clues = task.config.clues.map((c) => String(c || "").trim()).filter(Boolean);
      }

      // ✅ Prefer vocabulary / word list from the task (teacher's own words)
      if (!clues.length) {
        const wordSources = [
          task.words, task.config?.words,
          task.vocabulary, task.config?.vocabulary,
          task.requiredWords, task.config?.requiredWords,
          task.wordList, task.config?.wordList,
          task.concepts, task.config?.concepts,
          task.terms, task.config?.terms,
          task.items, task.config?.items,
          task.statements, task.config?.statements,
        ];
        const _extractText = (w) => {
          if (typeof w === "string") return w.trim();
          if (w && typeof w === "object") return String(w.text || w.word || w.term || w.statement || w.clue || w.concept || w.name || "").trim();
          return "";
        };
        for (const src of wordSources) {
          if (Array.isArray(src) && src.length > 0) {
            clues = src.map(_extractText).filter(Boolean);
            if (clues.length) {
              console.log(`[normalizeDrawMime] Using ${clues.length} words from task word list`);
              break;
            }
          }
        }
      }

      // If still empty, try to extract clues from prompt text
      if (!clues.length) {
        const p = String(task.prompt || task.config?.prompt || "").trim();
        if (p) {
          // If prompt itself is a valid short clue, use it directly
          if (_isValidClue(p)) {
            clues = [p];
          } else {
            // Try to extract short phrases from the long prompt
            clues = _extractCluesFromText(p);
            if (clues.length) {
              console.warn(`[normalizeDrawMime] Extracted ${clues.length} clues from long prompt: "${p.slice(0, 80)}…"`);
            }
          }
        }
      }

      // Filter: only keep clues that pass the word/length check
      clues = clues.filter((c) => _isValidClue(c));

      // Final fallback: use task title if it's short enough, otherwise generic
      if (!clues.length) {
        const title = (task.title || "").trim();
        if (title && _isValidClue(title)) {
          clues = [title];
        } else {
          // Try to extract from title too
          const fromTitle = _extractCluesFromText(title);
          clues = fromTitle.length > 0 ? fromTitle : ["Draw or Mime"];
        }
      }

      task.clues = clues.slice(0, 4);
      // Keep task.prompt in sync with first clue (backward compat)
      if (task.clues.length > 0) task.prompt = task.clues[0];

      // Strip fields from other task types that may have leaked in (wrong-type assignment)
      delete task.config?.seedTerm;
      delete task.config?.startWord;
      delete task.config?.secretAnswers;
      delete task.config?.characters;
      delete task.config?.postulate;
      delete task.config?.goodFoods;
      delete task.config?.badFoods;
      break;
    }

    case TASK_TYPES.SHORT_ANSWER: {
      // Normalize correctAnswer from common AI alternate field names
      const _saAnswer = (obj) =>
        asNonEmptyString(obj?.correctAnswer) ||
        asNonEmptyString(obj?.answer) ||
        asNonEmptyString(obj?.correct) ||
        asNonEmptyString(obj?.expected) ||
        asNonEmptyString(obj?.correctResponse) ||
        asNonEmptyString(obj?.response) ||
        "";

      // Normalize items[] if present — fix missing correctAnswer from alternate names
      const rawItems = Array.isArray(task.items) ? task.items
        : Array.isArray(task.config?.items) ? task.config.items
        : null;

      if (rawItems && rawItems.length > 0) {
        task.items = rawItems.map((it, i) => ({
          id: it.id || `q${i + 1}`,
          prompt: asNonEmptyString(it.prompt) || asNonEmptyString(it.question) || "",
          correctAnswer: _saAnswer(it),
        }));
        // Cap the question pool. The AI sometimes makes one question per
        // vocabulary word (testers saw 20+), which is far too many — a
        // short-answer task is split ~2 questions per player. Keep at most 12
        // so even a 6-player team gets two unique questions each.
        if (task.items.length > 12) {
          task.items = task.items.slice(0, 12);
        }
      } else {
        // Single-prompt format → convert to items[]
        const saPrompt = asNonEmptyString(task.prompt) || asNonEmptyString(task.question) || "";
        const saAns = _saAnswer(task);
        if (saPrompt && saAns) {
          task.items = [{ id: "q1", prompt: saPrompt, correctAnswer: saAns }];
        }
      }
      // Default the per-player split so the renderer can hand out ~2 questions
      // each and label them by name. Teacher can still override via config.
      task.config = (task.config && typeof task.config === "object") ? task.config : {};
      if (typeof task.config.questionsPerPlayer !== "number") {
        task.config.questionsPerPlayer = 2;
      }
      break;
    }

    case TASK_TYPES.TRUE_FALSE_CONNECT_FOUR: {
      // Normalize statements from various AI field names
      const _c4Sources = [
        task.statements, task.config?.statements,
        task.items, task.config?.items,
        task.clues, task.config?.clues,
      ];
      let c4Raw = [];
      for (const src of _c4Sources) {
        if (Array.isArray(src) && src.length > 0) { c4Raw = src; break; }
      }

      const c4Stmts = c4Raw
        .map((s, i) => {
          if (!s) return null;
          if (typeof s === "string") return { text: s.trim(), isFalse: false, id: `s${i}` };
          const text = String(s.text || s.prompt || s.statement || s.question || "").trim();
          if (!text) return null;
          const isFalse =
            typeof s.isFalse === "boolean" ? s.isFalse :
            typeof s.correct === "boolean" ? !s.correct :
            typeof s.correctAnswer === "boolean" ? !s.correctAnswer :
            typeof s.answer === "boolean" ? !s.answer :
            typeof s.answer === "string" ? String(s.answer).toLowerCase() === "false" :
            false;
          return { text, isFalse, id: String(s.id || s._id || `s${i}`) };
        })
        .filter(Boolean);

      task.statements = c4Stmts;
      if (!task.timeLimitSeconds) task.timeLimitSeconds = 300;
      break;
    }

    // ─── Simple types: only need title + prompt (already normalized globally) ───
    case TASK_TYPES.OPEN_TEXT:
      break;

    case TASK_TYPES.LETTER: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      // Normalize character from common field names
      cfg.character = asNonEmptyString(cfg.character,
        asNonEmptyString(cfg.characterName,
          asNonEmptyString(cfg.recipient,
            asNonEmptyString(task.character, ""))));
      cfg.characterDescription = asNonEmptyString(cfg.characterDescription,
        asNonEmptyString(cfg.charDesc, asNonEmptyString(cfg.description, "")));
      cfg.letterStyle = asNonEmptyString(cfg.letterStyle,
        asNonEmptyString(cfg.style, "friendly"));
      cfg.topicContext = asNonEmptyString(cfg.topicContext,
        asNonEmptyString(cfg.context, asNonEmptyString(cfg.topic, "")));

      // Normalize relevantConcepts
      if (!Array.isArray(cfg.relevantConcepts)) {
        cfg.relevantConcepts = Array.isArray(cfg.concepts) ? cfg.concepts
          : Array.isArray(cfg.keywords) ? cfg.keywords
          : Array.isArray(cfg.vocabTerms) ? cfg.vocabTerms
          : [];
      }
      cfg.relevantConcepts = cfg.relevantConcepts
        .map((c) => String(c || "").trim())
        .filter(Boolean)
        .slice(0, 12);

      // Validate letter style
      if (!["business", "friendly"].includes(cfg.letterStyle)) {
        cfg.letterStyle = "friendly";
      }

      // Hard reject: must have a character
      if (!cfg.character) {
        task._validationError = "Letter task must include config.character (the name of who students write to).";
      }

      // Warn if no relevant concepts for scoring
      if (cfg.relevantConcepts.length < 2) {
        task._validationWarning = `Letter task has only ${cfg.relevantConcepts.length} relevantConcepts — 4-8 preferred for concept-based scoring.`;
      }

      task.config = cfg;
      break;
    }

    case TASK_TYPES.CASE_STUDY: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      cfg.scenario = asNonEmptyString(cfg.scenario,
        asNonEmptyString(cfg.caseDescription,
          asNonEmptyString(cfg.problem,
            asNonEmptyString(cfg.situation, ""))));
      cfg.expertRole = asNonEmptyString(cfg.expertRole,
        asNonEmptyString(cfg.expert, asNonEmptyString(cfg.evaluator, "Subject Expert")));
      cfg.expertDescription = asNonEmptyString(cfg.expertDescription,
        asNonEmptyString(cfg.expertDesc, ""));

      if (!Array.isArray(cfg.relevantConcepts)) {
        cfg.relevantConcepts = Array.isArray(cfg.concepts) ? cfg.concepts
          : Array.isArray(cfg.keywords) ? cfg.keywords
          : Array.isArray(cfg.vocabTerms) ? cfg.vocabTerms
          : [];
      }
      cfg.relevantConcepts = cfg.relevantConcepts
        .map((c) => String(c || "").trim())
        .filter(Boolean)
        .slice(0, 12);

      if (!cfg.scenario) {
        task._validationError = "Case study task must include config.scenario (the problem/dilemma to solve).";
      }
      if (cfg.relevantConcepts.length < 2) {
        task._validationWarning = `Case study has only ${cfg.relevantConcepts.length} relevantConcepts — 4-8 preferred for scoring.`;
      }

      task.config = cfg;
      break;
    }

    case TASK_TYPES.STORYTELLING: {
      const cfg = isObject(task.config) ? task.config : (task.config = {});

      cfg.setting = asNonEmptyString(cfg.setting,
        asNonEmptyString(cfg.world, asNonEmptyString(cfg.place, "a mysterious land")));
      cfg.topicContext = asNonEmptyString(cfg.topicContext,
        asNonEmptyString(cfg.topic, asNonEmptyString(cfg.context, "")));
      cfg.genre = asNonEmptyString(cfg.genre, "adventure");

      // Normalize genre to allowed values
      const allowedGenres = ["adventure", "mystery", "comedy", "historical fiction", "fantasy", "sci-fi"];
      if (!allowedGenres.includes(cfg.genre.toLowerCase())) {
        cfg.genre = "adventure";
      }

      // Normalize showNationality
      if (typeof cfg.showNationality === "string") {
        cfg.showNationality = cfg.showNationality.toLowerCase() === "true";
      }
      if (typeof cfg.showNationality !== "boolean") {
        cfg.showNationality = true;
      }

      // Normalize vocabWords
      if (!Array.isArray(cfg.vocabWords)) {
        cfg.vocabWords = Array.isArray(cfg.vocab) ? cfg.vocab
          : Array.isArray(cfg.words) ? cfg.words
          : Array.isArray(cfg.vocabTerms) ? cfg.vocabTerms
          : [];
      }
      cfg.vocabWords = cfg.vocabWords
        .map((w) => String(w || "").trim())
        .filter(Boolean)
        .slice(0, 12);

      if (!cfg.setting || cfg.setting === "a mysterious land") {
        task._validationWarning = "Storytelling task has a generic setting — a vivid, specific setting improves the story.";
      }

      task.config = cfg;
      break;
    }

    case TASK_TYPES.RECORD_AUDIO: {
      // --- GUARDRAIL: AUTO-FIX multi-topic audio prompts ---
      // The AI stubbornly generates prompts asking about 2-3 topics in 20-45 seconds.
      // Instead of rejecting (retries produce the same thing), extract the first topic
      // and rewrite the prompt to focus on it.
      const audioPrompt = (task.prompt || "");
      const audioLower = audioPrompt.toLowerCase();
      const andTheCount = (audioLower.match(/,\s*(and\s+)?the\s+/g) || []).length;
      const eachCount = (audioLower.match(/\beach\b/g) || []).length;
      const listPattern = /\b(explain|discuss|describe|talk about)\b.+,.+,?\s*(and|&)\s+/i;
      // Detect "Include how...", "Also discuss...", "Also explain..." — secondary instruction blocks
      const secondaryInstructionPattern = /\b(include\s+how|also\s+(?:discuss|explain|describe|mention|talk)|in\s+addition|additionally|furthermore)\b/i;
      // Count distinct topic-introducing verbs (e.g. "explaining X. Include how Y" = 2 verbs = 2 topics)
      const topicVerbCount = (audioLower.match(/\b(explain(?:ing)?|discuss(?:ing)?|describ(?:e|ing)|includ(?:e|ing)\s+how|mention(?:ing)?)\b/g) || []).length;
      const isMultiTopic = listPattern.test(audioPrompt)
        || (andTheCount >= 2)
        || (eachCount >= 1 && andTheCount >= 1)
        || secondaryInstructionPattern.test(audioPrompt)
        || topicVerbCount >= 3;

      if (isMultiTopic) {
        // Extract the first topic: look for the verb phrase and take up to the first separator
        const verbMatch = audioPrompt.match(/\b(explain(?:ing)?|discuss(?:ing)?|describe|talk(?:ing)?\s+about)\s+(how\s+)?/i);
        if (verbMatch) {
          const afterVerb = audioPrompt.slice(verbMatch.index + verbMatch[0].length);
          // Preserve "how" if the original prompt used it (e.g. "explaining how X influenced Y")
          const howPrefix = verbMatch[2] ? "how " : "";
          // Take everything up to: comma, semicolon, "and the/how/why", "Include", "Also", period+space
          const firstTopicMatch = afterVerb.match(/^(.+?)(?:\s*[,;]\s*|\s+and\s+(?:the|how|why)|\.\s+(?:Include|Also|In addition|Additionally|Furthermore|Mention)|\.\s*$)/i);
          const firstTopic = firstTopicMatch ? firstTopicMatch[1].trim() : afterVerb.split(/[,;]/)[0].trim();
          // Strip trailing period
          const cleanTopic = firstTopic.replace(/\.\s*$/, "").trim();
          if (cleanTopic.length > 10) {
            task.prompt = `Record a 20–45 second response explaining ${howPrefix}${cleanTopic}. Speak clearly, give at least one specific example, and explain why this matters.`;
            console.warn(`[Quality Auto-Fix] Record-audio prompt rewritten to single topic: "${howPrefix}${cleanTopic}"`);
          }
        }
      }
      break;
    }

    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME: {
      // Normalise misplaced clues: AI sometimes puts them in config.rounds, config.statements, items, etc.
      if (!Array.isArray(task.clues) || task.clues.length === 0) {
        const cfg = task.config || {};
        const candidates = [task.items, cfg.items, cfg.rounds, cfg.statements, cfg.prompts, cfg.clues];
        for (const src of candidates) {
          if (Array.isArray(src) && src.length > 0) {
            task.clues = src.map((c) => (typeof c === "string" ? c : (c && (c.text || c.prompt || c.clue || c.word || c.name)) || "").trim()).filter(Boolean);
            if (task.clues.length > 0) break;
          }
        }
      }
      // Clean config fields that belong to other types so the validator doesn't reject
      if (task.config) {
        delete task.config.statements;
        delete task.config.rounds;
        delete task.config.prompts;
        delete task.config.wordsByStation;
        delete task.config.secretAnswers;
        delete task.config.seedTerm;
        delete task.config.goodFoods;
      }
      // --- CAP: draw/mime should focus on ONE concept; a handful of clues max ---
      if (Array.isArray(task.clues) && task.clues.length > 6) {
        task.clues = task.clues.slice(0, 6);
      }
      break;
    }
    case TASK_TYPES.PHOTO:
    case TASK_TYPES.MAKE_AND_SNAP:
    case TASK_TYPES.PHOTO_JOURNAL:
    case TASK_TYPES.BODY_BREAK:
    case TASK_TYPES.MOTION_MISSION:
      // Leave items/config untouched so validation can detect wrong-type assignments
      break;

    case TASK_TYPES.VENNSORT: {
      const vCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize categories from various field names
      if (!Array.isArray(vCfg.categories) || !vCfg.categories.length) {
        vCfg.categories = Array.isArray(task.categories) ? task.categories : [];
      }
      // Normalize items
      if (!Array.isArray(vCfg.items) || !vCfg.items.length) {
        vCfg.items = Array.isArray(task.items) ? task.items : [];
      }
      // Normalize correctAnswer / answerKey
      if (!vCfg.correctAnswer && !vCfg.answerKey) {
        vCfg.correctAnswer = task.correctAnswer || task.answerKey || null;
      }

      // --- CAP: vennsort gets unplayable past ~10 items (too much sorting) ---
      const VENNSORT_MAX_ITEMS = 10;
      if (Array.isArray(vCfg.items) && vCfg.items.length > VENNSORT_MAX_ITEMS) {
        vCfg.items = vCfg.items.slice(0, VENNSORT_MAX_ITEMS);
      }
      if (Array.isArray(task.items) && task.items.length > VENNSORT_MAX_ITEMS) {
        task.items = task.items.slice(0, VENNSORT_MAX_ITEMS);
      }

      // --- GUARDRAIL: Reject vennsort items with empty categories (unplaceable) ---
      if (Array.isArray(vCfg.items) && vCfg.items.length > 0) {
        const correctAnswerMap = isObject(vCfg.correctAnswer) ? vCfg.correctAnswer
          : isObject(task.correctAnswer) ? task.correctAnswer : {};
        const unplaceableItems = vCfg.items.filter((it) => {
          const id = it?.id || "";
          const itemCats = Array.isArray(it?.categories) ? it.categories : [];
          const answerCats = Array.isArray(correctAnswerMap[id]) ? correctAnswerMap[id] : [];
          return itemCats.length === 0 && answerCats.length === 0;
        });
        if (unplaceableItems.length > 0) {
          task._validationError = `Vennsort has ${unplaceableItems.length} item(s) with no category assignment (e.g. "${unplaceableItems[0]?.text}") — every item MUST belong to at least one category. Students cannot place items that have no correct answer.`;
        }
      }

      // --- GUARDRAIL: Flag overly generic vennsort items ---
      if (Array.isArray(vCfg.items) && vCfg.items.length > 0 && !task._validationError) {
        const genericPattern = /^(social|economic|cultural|political|environmental|historical|general|overall|various)\s+(disruption|impact|change|effects?|factors?|issues?|aspects?|developments?|influences?)$/i;
        const genericItems = vCfg.items.filter((it) => genericPattern.test(String(it?.text || "").trim()));
        if (genericItems.length >= 3) {
          task._validationWarning = `Vennsort has ${genericItems.length} overly generic items (e.g. "${genericItems[0]?.text}") — items should be specific terms with defensible category placements`;
        }
      }
      break;
    }

    case TASK_TYPES.JEOPARDY: {
      // Normalize clues from various field names
      if (!Array.isArray(task.clues) || !task.clues.length) {
        task.clues = Array.isArray(task.items) ? task.items
          : Array.isArray(task.config?.clues) ? task.config.clues
          : Array.isArray(task.config?.items) ? task.config.items
          : [];
      }
      break;
    }

    case TASK_TYPES.GUESS_WHO: {
      const gwCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize secretAnswers from various field names
      if (!Array.isArray(gwCfg.secretAnswers) || !gwCfg.secretAnswers.length) {
        gwCfg.secretAnswers =
          Array.isArray(task.secretAnswers) ? task.secretAnswers :
          Array.isArray(task.items) ? task.items.map((x) => typeof x === "string" ? x : x?.text || x?.word || x?.name || "") :
          Array.isArray(gwCfg.items) ? gwCfg.items.map((x) => typeof x === "string" ? x : x?.text || x?.word || x?.name || "") :
          typeof gwCfg.secretAnswer === "string" ? [gwCfg.secretAnswer] :
          typeof task.secretAnswer === "string" ? [task.secretAnswer] : [];
      }
      gwCfg.secretAnswers = gwCfg.secretAnswers.map(String).filter(Boolean);
      if (!gwCfg.maxGuesses) gwCfg.maxGuesses = 10;
      break;
    }

    case TASK_TYPES.PET_FEEDING: {
      // Pet-feeding: classify statements as good/bad by feeding them to a pet.
      // Normalize goodFoods/badFoods into foodItems with { label, good } shape.
      const pfCfg = isObject(task.config) ? task.config : (task.config = {});
      if (!pfCfg.pack) pfCfg.pack = task.pack || "classic";
      if (!pfCfg.goal) pfCfg.goal = task.goal || 4;

      // If AI provided goodFoods/badFoods arrays, convert to foodItems
      const goodFoods = Array.isArray(task.goodFoods) ? task.goodFoods
        : Array.isArray(pfCfg.goodFoods) ? pfCfg.goodFoods : [];
      const badFoods = Array.isArray(task.badFoods) ? task.badFoods
        : Array.isArray(pfCfg.badFoods) ? pfCfg.badFoods : [];

      if (goodFoods.length || badFoods.length) {
        task.goodFoods = goodFoods.map(String).filter(Boolean);
        task.badFoods = badFoods.map(String).filter(Boolean);
      }

      // Also accept items/foodItems with { label, good } objects
      if (!task.goodFoods?.length && !task.badFoods?.length) {
        const rawItems =
          Array.isArray(pfCfg.foodItems) ? pfCfg.foodItems :
          Array.isArray(task.foodItems) ? task.foodItems :
          Array.isArray(task.items) ? task.items :
          Array.isArray(pfCfg.items) ? pfCfg.items : [];

        if (rawItems.length) {
          task.goodFoods = rawItems
            .filter((x) => x?.good === true || x?.isGood === true)
            .map((x) => String(x?.label || x?.text || x?.word || "").trim())
            .filter(Boolean);
          task.badFoods = rawItems
            .filter((x) => x?.good === false || x?.isGood === false)
            .map((x) => String(x?.label || x?.text || x?.word || "").trim())
            .filter(Boolean);
        }
      }

      // Cap each list at 8 — the prompt asks 6–8 each; more just drags out the game.
      if (Array.isArray(task.goodFoods) && task.goodFoods.length > 8) task.goodFoods = task.goodFoods.slice(0, 8);
      if (Array.isArray(task.badFoods) && task.badFoods.length > 8) task.badFoods = task.badFoods.slice(0, 8);
      break;
    }

    case TASK_TYPES.LIVE_DEBATE: {
      const ldCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize postulate from various field names
      if (!task.postulate) {
        task.postulate = ldCfg.postulate || task.resolution || ldCfg.resolution || task.topic || ldCfg.topic || "";
      }
      if (!ldCfg.postulate && task.postulate) ldCfg.postulate = task.postulate;
      break;
    }

    case TASK_TYPES.BRAINSTORM_BATTLE: {
      const bbCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize rounds
      if (!Array.isArray(bbCfg.rounds) || !bbCfg.rounds.length) {
        bbCfg.rounds = Array.isArray(task.rounds) ? task.rounds : [];
      }
      break;
    }

    case TASK_TYPES.COLLABORATION: {
      const colCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize roles
      if (!Array.isArray(colCfg.roles) || !colCfg.roles.length) {
        colCfg.roles = Array.isArray(task.roles) ? task.roles : [];
      }
      break;
    }

    case TASK_TYPES.SPEECH_RECOGNITION: {
      const srCfg = isObject(task.config) ? task.config : (task.config = {});
      // Normalize target phrases from various field names
      if (!Array.isArray(srCfg.targetPhrases) || !srCfg.targetPhrases.length) {
        srCfg.targetPhrases =
          Array.isArray(task.targetPhrases) ? task.targetPhrases :
          Array.isArray(task.items) ? task.items :
          Array.isArray(srCfg.items) ? srCfg.items : [];
      }
      break;
    }

    case TASK_TYPES.PEER_EDITING: {
      // Normalize passage
      task.passage = asNonEmptyString(task.passage, asNonEmptyString(task.text, ""));
      if (!task.passage) {
        errors.push("peer-editing task has no passage text");
      }

      // Normalize errors array
      let errs = Array.isArray(task.errors) ? task.errors
        : Array.isArray(task.corrections) ? task.corrections
        : [];
      errs = errs
        .filter((e) => e && typeof e === "object")
        .map((e) => {
          const wi = typeof e.wordIndex === "number" ? e.wordIndex : parseInt(e.wordIndex || e.index, 10);
          const tp = ["typo", "grammar", "logic", "punctuation", "delete", "insert"].includes(e.type) ? e.type : "typo";
          const correct = e.correct || e.replacement || e.fix || null;
          return { wordIndex: isNaN(wi) ? 0 : wi, type: tp, correct };
        });
      if (errs.length < 3) {
        errors.push(`peer-editing task needs at least 5 errors, found ${errs.length}`);
      }
      task.errors = errs;

      // Normalize mode
      if (!["on-screen", "paper", "timed"].includes(task.mode)) {
        task.mode = "on-screen";
      }
      break;
    }

    case TASK_TYPES.INTERVIEW: {
      // Promote candidates from config if needed
      if (!Array.isArray(task.candidates) && Array.isArray(task.config?.candidates)) {
        task.candidates = task.config.candidates;
      }

      // Normalize candidates. We DROP any entry missing the load-bearing
      // fields (name + systemPrompt) before counting — tester Richard
      // 2026-06-08 saw an interview task with zero usable interviewees
      // because the AI returned blank-name placeholders that the old
      // length check let through.
      let cands = Array.isArray(task.candidates) ? task.candidates : [];
      cands = cands
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          name: asNonEmptyString(c.name, asNonEmptyString(c.characterName, "")),
          era: asNonEmptyString(c.era, asNonEmptyString(c.timePeriod, "")),
          description: asNonEmptyString(c.description, asNonEmptyString(c.bio, "")),
          greeting: asNonEmptyString(c.greeting, asNonEmptyString(c.intro, "")),
          systemPrompt: asNonEmptyString(c.systemPrompt, asNonEmptyString(c.system, "")),
        }))
        .filter((c) => c.name.trim() && c.systemPrompt.trim());
      if (cands.length < 2) {
        errors.push(`interview task needs at least 2 candidates with non-empty name + systemPrompt, found ${cands.length}`);
      }
      task.candidates = cands;

      // Normalize turn bounds
      task.minTurns = typeof task.minTurns === "number" ? task.minTurns
        : typeof task.config?.minTurns === "number" ? task.config.minTurns : 3;
      task.maxTurns = typeof task.maxTurns === "number" ? task.maxTurns
        : typeof task.config?.maxTurns === "number" ? task.config.maxTurns : 5;
      break;
    }

    case TASK_TYPES.CLOZE: {
      // Promote from config
      if (!task.passage && task.config?.passage) task.passage = task.config.passage;
      if (!Array.isArray(task.blanks) && Array.isArray(task.config?.blanks)) task.blanks = task.config.blanks;
      if (!Array.isArray(task.distractors) && Array.isArray(task.config?.distractors)) task.distractors = task.config.distractors;
      if (!task.passage && task.text) task.passage = task.text;

      task.passage = asNonEmptyString(task.passage, "");

      // Normalize blanks
      let blanks = Array.isArray(task.blanks) ? task.blanks : [];
      blanks = blanks
        .filter((b) => b != null)
        .map((b) => {
          if (typeof b === "string") return { answer: b.trim() };
          if (typeof b === "object") return { answer: asNonEmptyString(b.answer, asNonEmptyString(b.word, "")) };
          return { answer: String(b).trim() };
        })
        .filter((b) => b.answer.length > 0);
      task.blanks = blanks;

      // Normalize distractors (optional)
      if (Array.isArray(task.distractors)) {
        task.distractors = task.distractors
          .map((d) => typeof d === "string" ? d.trim() : asNonEmptyString(d?.word, ""))
          .filter(Boolean);
      } else {
        task.distractors = [];
      }
      break;
    }

    case TASK_TYPES.TEACH_BACK: {
      // Promote from config
      if (!Array.isArray(task.concepts) && Array.isArray(task.config?.concepts)) task.concepts = task.config.concepts;
      if (!task.targetAge && task.config?.targetAge) task.targetAge = task.config.targetAge;
      if (!task.targetAge && task.target_age) { task.targetAge = task.target_age; delete task.target_age; }
      if (!task.targetAge && task.targetAudience) { task.targetAge = task.targetAudience; delete task.targetAudience; }

      // Normalize concepts
      if (Array.isArray(task.concepts)) {
        task.concepts = task.concepts
          .map((c) => typeof c === "string" ? c.trim() : asNonEmptyString(c?.name || c?.concept, ""))
          .filter(Boolean);
      }

      task.targetAge = asNonEmptyString(task.targetAge, "");
      break;
    }

    case TASK_TYPES.QUEST: {
      // Quest-task normalization — canonical shape lives entirely in config.
      // Tasksets containing a quest task should also have questModeEnabled=true on the parent,
      // but that's a TaskSet-level concern handled by the generator; we only validate the task here.
      const cfg = isObject(task.config) ? { ...task.config } : {};

      cfg.title    = asNonEmptyString(cfg.title, asNonEmptyString(task.title, ""));
      cfg.scenario = asNonEmptyString(cfg.scenario, "");

      cfg.objectives = Array.isArray(cfg.objectives) ? cfg.objectives : [];
      cfg.resources  = Array.isArray(cfg.resources)  ? cfg.resources  : [];
      if (!isObject(cfg.premiumResources)) cfg.premiumResources = {};
      cfg.ranks = Array.isArray(cfg.ranks) ? cfg.ranks : [
        { id: "completed", label: "Mission Completed", min: 0 },
        { id: "prepared",  label: "Well Prepared",     min: 1 },
        { id: "master",    label: "Master Mission",    min: 2 },
      ];

      task.config = cfg;

      // Quest tasks default to a higher max-points pool since they aggregate objectives
      if (typeof task.points !== "number") task.points = 30;
      break;
    }

    case TASK_TYPES.WHAT_AM_I: {
      // Canonical shape lives in task.config. Sanitizer has already promoted
      // top-level answer/clues/etc into config; here we tighten up defaults
      // and ensure the runtime contract is satisfied.
      const cfg = isObject(task.config) ? { ...task.config } : {};

      // answer
      cfg.answer = asNonEmptyString(cfg.answer, "");

      // acceptableAnswers — always lowercase array, dedupe
      let accepted = Array.isArray(cfg.acceptableAnswers) ? cfg.acceptableAnswers : [];
      accepted = accepted
        .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
        .filter(Boolean);
      // Ensure the canonical answer itself appears in the matcher list (lowercased)
      if (cfg.answer) {
        const canon = cfg.answer.trim().toLowerCase();
        if (canon && !accepted.includes(canon)) accepted.unshift(canon);
      }
      cfg.acceptableAnswers = Array.from(new Set(accepted));

      // clues — re-index levels, drop empties
      let clues = Array.isArray(cfg.clues) ? cfg.clues : [];
      clues = clues
        .map((c) => (c && typeof c === "object" ? c : null))
        .filter(Boolean)
        .map((c, i) => ({
          level: i + 1,
          text: asNonEmptyString(c.text || c.clue, ""),
        }))
        .filter((c) => c.text);
      cfg.clues = clues;

      // difficulty enum
      const allowedDiff = ["easy", "medium", "hard", "expert"];
      cfg.difficulty = allowedDiff.includes(cfg.difficulty) ? cfg.difficulty : "medium";

      // mode enum
      const allowedMode = ["solo", "intra-team", "inter-team"];
      cfg.mode = allowedMode.includes(cfg.mode) ? cfg.mode : "intra-team";

      // Default scoring (perClueCurve = clues.length + 1 entries; first entry is "0 clues revealed")
      if (!isObject(cfg.scoring)) cfg.scoring = {};
      const need = cfg.clues.length + 1;
      let curve = Array.isArray(cfg.scoring.perClueCurve)
        ? cfg.scoring.perClueCurve.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
        : [];
      if (curve.length !== need) {
        // Build default curve: 10, 8, 6, 4, 2, 1, 1...
        const base = [10, 8, 6, 4, 2];
        while (base.length < need) base.push(Math.max(1, base[base.length - 1] - 1));
        curve = base.slice(0, need);
      }
      cfg.scoring.perClueCurve = curve;

      // Ensure top-level fields don't shadow config (sanitizer should have stripped already, but be defensive)
      delete task.answer;
      delete task.clues;
      delete task.acceptableAnswers;
      delete task.difficulty;
      delete task.mode;

      task.config = cfg;
      // Default top-level points to the max of the curve so legacy point-readers behave
      if (typeof task.points !== "number") task.points = Math.max(...curve, 0);
      break;
    }

    default:
      break;
  }

  // Global mirror for MOST types (keep task.items and config.items in sync)
  const forbidConfigItems =
    taskType === TASK_TYPES.MULTIPLE_CHOICE ||
    taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE ||
    taskType === TASK_TYPES.TRUE_FALSE; // ✅ include TRUE_FALSE

  if (!forbidConfigItems) {
    if (!Array.isArray(task.items) && Array.isArray(task.config?.items)) task.items = task.config.items;
    if (!Array.isArray(task.config?.items) && Array.isArray(task.items)) {
      task.config = isObject(task.config) ? task.config : {};
      task.config.items = task.items;
    }
  } else {
    if (task.config && Array.isArray(task.config.items)) delete task.config.items;
  }

  return task;
}

// Backwards-compatible helper: returns the raw errors array (old behavior)
export function validateTaskByTypeErrors(taskType, task) {
  const result = validateTaskByType(taskType, task);
  return Array.isArray(result) ? result : result?.errors || [];
}

// New / preferred: returns { ok, errors }
export function validateTaskByType(taskType, task) {
  const errors = [];
  if (!taskType || taskType === "(unknown)") errors.push("taskType missing/unknown");

  if (typeof task?.title !== "string" || !task.title.trim()) errors.push("title required");
  if (typeof task?.prompt !== "string" || !task.prompt.trim()) errors.push("prompt required");

  switch (taskType) {
    case TASK_TYPES.BRAIN_BLITZ: {
      const clues = Array.isArray(task.clues)
        ? task.clues
        : Array.isArray(task.config?.clues)
        ? task.config.clues
        : [];

      if (!Array.isArray(clues) || clues.length < 5) {
        errors.push("clues[] must be an array with at least 5 items");
        break;
      }

      clues.forEach((c, i) => {
        if (typeof c === "string") {
          if (!c.trim()) errors.push(`clues[${i}] must be non-empty`);
        } else {
          const clueText = typeof c?.clue === "string" ? c.clue.trim() : "";
          const answerText = typeof c?.answer === "string" ? c.answer.trim() : "";
          if (!clueText) errors.push(`clues[${i}].clue required`);
          if (!answerText) errors.push(`clues[${i}].answer required`);
        }
      });
      break;
    }

    case TASK_TYPES.BRAIN_SPARK_NOTES: {
      const notes = task?.notes ?? task?.config?.notes ?? null;

      if (!notes || typeof notes !== "object" || Array.isArray(notes)) {
        errors.push("notes object is required");
        break;
      }

      if (typeof notes.heading !== "string" || !notes.heading.trim()) errors.push("notes.heading required");

      const keyTerms = Array.isArray(notes.keyTerms) ? notes.keyTerms : [];
      if (keyTerms.length < 3) {
        errors.push("notes.keyTerms must have at least 3 items");
      } else {
        for (let i = 0; i < keyTerms.length; i++) {
          const kt = keyTerms[i];
          if (!kt || typeof kt !== "object" || Array.isArray(kt)) {
            errors.push(`notes.keyTerms[${i}] must be an object`);
            continue;
          }
          const term = typeof kt.term === "string" ? kt.term.trim() : "";
          const definition = typeof kt.definition === "string" ? kt.definition.trim() : "";
          if (!term) errors.push(`notes.keyTerms[${i}].term required`);
          if (!definition) errors.push(`notes.keyTerms[${i}].definition required`);
          const points = Array.isArray(kt.points) ? kt.points : [];
          const pointCount = points.filter((p) => typeof p === "string" && p.trim()).length;
          if (pointCount < 2) errors.push(`notes.keyTerms[${i}].points must have at least 2 items`);
        }
      }

      const mainPoints = Array.isArray(notes.mainPoints) ? notes.mainPoints : [];
      if (mainPoints.length < 3) {
        errors.push("notes.mainPoints must have at least 3 items");
      } else {
        for (let i = 0; i < mainPoints.length; i++) {
          const mp = mainPoints[i];
          if (!mp || typeof mp !== "object" || Array.isArray(mp)) {
            errors.push(`notes.mainPoints[${i}] must be an object`);
            continue;
          }
          const heading = typeof mp.heading === "string" ? mp.heading.trim() : "";
          if (!heading) errors.push(`notes.mainPoints[${i}].heading required`);

          const hasSections = Array.isArray(mp.sections) && mp.sections.length > 0;
          if (hasSections) {
            for (let j = 0; j < mp.sections.length; j++) {
              const sec = mp.sections[j];
              if (!sec || typeof sec !== "object" || Array.isArray(sec)) {
                errors.push(`notes.mainPoints[${i}].sections[${j}] must be an object`);
                continue;
              }
              const title = typeof sec.title === "string" ? sec.title.trim() : "";
              if (!title) errors.push(`notes.mainPoints[${i}].sections[${j}].title required`);
              const bullets = Array.isArray(sec.bullets) ? sec.bullets : [];
              const bulletCount = bullets.filter((b) => typeof b === "string" && b.trim()).length;
              if (bulletCount < 2) errors.push(`notes.mainPoints[${i}].sections[${j}].bullets must have at least 2 items`);
            }
          } else {
            const bullets = Array.isArray(mp.bullets) ? mp.bullets : [];
            const bulletCount = bullets.filter((b) => typeof b === "string" && b.trim()).length;
            if (bulletCount < 2) errors.push(`notes.mainPoints[${i}].bullets must have at least 2 items`);
          }
        }
      }

      const summary = Array.isArray(notes.summary) ? notes.summary : null;
      if (!Array.isArray(summary)) errors.push("notes.summary required");
      else {
        const summaryCount = summary.filter((s) => typeof s === "string" && s.trim()).length;
        if (summaryCount < 2) errors.push("notes.summary[] must include at least 2 bullets");
      }

      break;
    }

    case TASK_TYPES.MULTIPLE_CHOICE:
    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE: {
      if (!Array.isArray(task.items) || task.items.length < 3) {
        errors.push("items[] must have at least 3 items");
        break;
      }
      task.items.forEach((it, i) => {
        if (!asNonEmptyString(it.prompt)) errors.push(`items[${i}].prompt required`);
        if (!Array.isArray(it.options) || it.options.length < 3) errors.push(`items[${i}].options must have at least 3 options`);
        if (typeof it.correctAnswer !== "number") errors.push(`items[${i}].correctAnswer must be a number index`);
        else if (it.correctAnswer < 0 || it.correctAnswer >= it.options.length) errors.push(`items[${i}].correctAnswer out of range`);
      });
      break;
    }

    case TASK_TYPES.MUSICAL_CHAIRS: {
      if (!Array.isArray(task.items) || task.items.length < 1) {
        errors.push("items[] required");
        break;
      }
      task.items.forEach((it, i) => {
        if (!asNonEmptyString(it?.prompt)) errors.push(`items[${i}].prompt required`);
        if (!Array.isArray(it?.options) || it.options.length < 2 || it.options.length > 4) errors.push(`items[${i}].options must have 2-4 options`);
        if (typeof it?.correctAnswer !== "number" || !Number.isInteger(it.correctAnswer)) errors.push(`items[${i}].correctAnswer must be an integer index`);
        else if (Array.isArray(it.options) && (it.correctAnswer < 0 || it.correctAnswer >= it.options.length)) errors.push(`items[${i}].correctAnswer out of range`);
      });

      const rounds = task?.config?.rounds;
      if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1) errors.push("config.rounds must be an integer >= 1");
      else if (rounds !== task.items.length) errors.push("config.rounds must equal items.length");

      if (!Array.isArray(task?.config?.items)) errors.push("config.items required (array)");
      else {
        try {
          const a = JSON.stringify(task.items);
          const b = JSON.stringify(task.config.items);
          if (a !== b) errors.push("config.items must be identical to items");
        } catch {
          errors.push("config.items must be identical to items");
        }
      }

      break;
    }

    case TASK_TYPES.FAKE_OUT: {
      const cfg = isObject(task?.config) ? task.config : {};
      const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : Array.isArray(task.rounds) ? task.rounds : [];

      if (!Array.isArray(rounds) || rounds.length < 3) {
        errors.push("config.rounds must have at least 3 rounds");
        break;
      }

      rounds.forEach((r, i) => {
        if (!asNonEmptyString(r?.prompt)) errors.push(`rounds[${i}].prompt required`);
        else if (_isBadText(r.prompt)) errors.push(`rounds[${i}].prompt looks like placeholder text`);

        // Accept 3 options (pre-normalization: joke separate) or 4 (post-normalization: joke inserted)
        const optLen = Array.isArray(r?.options) ? r.options.length : 0;
        if (optLen !== 3 && optLen !== 4) errors.push(`rounds[${i}].options must have 3 or 4 options (got ${optLen})`);
        else {
          r.options.forEach((opt, oi) => {
            if (!asNonEmptyString(opt)) errors.push(`rounds[${i}].options[${oi}] required`);
            else if (_isBadText(opt)) errors.push(`rounds[${i}].options[${oi}] looks like placeholder text`);
          });
        }

        const ci = r?.correctIndex;
        if (typeof ci !== "number" || !Number.isInteger(ci) || ci < 0 || ci > 3) errors.push(`rounds[${i}].correctIndex must be 0..3`);

        const jo = typeof r?.jokeOption === "string" ? r.jokeOption.trim() : "";
        if (!jo) errors.push(`rounds[${i}].jokeOption required`);
        // Only flag jokeOption-in-options for pre-normalization (3 options); post-normalization (4) expects it there
        if (jo && optLen === 3 && Array.isArray(r?.options) && r.options.includes(jo)) errors.push(`rounds[${i}].jokeOption must NOT be in options`);

        const ji = r?.jokeIndex;
        if (typeof ji !== "number" || !Number.isInteger(ji) || ji < 0 || ji > 3) errors.push(`rounds[${i}].jokeIndex must be 0..3`);
      });

      break;
    }

    case TASK_TYPES.TRUE_FALSE: {
      if (!Array.isArray(task.items) || task.items.length < 3) {
        errors.push("items[] must have at least 3 items");
        break;
      }
      task.items.forEach((it, i) => {
        if (!asNonEmptyString(it.prompt)) errors.push(`items[${i}].prompt required`);
        if (it.correctAnswer !== 0 && it.correctAnswer !== 1) errors.push(`items[${i}].correctAnswer must be 0 or 1`);
      });
      break;
    }

    case TASK_TYPES.TRUE_FALSE_TICTACTOE: {
      if (!Array.isArray(task.items) || task.items.length !== 9) {
        errors.push("true-false-tictactoe requires items[] with exactly 9 statements");
        break;
      }
      for (const it of task.items) {
        if (!isNonEmptyString(it?.statement)) errors.push("each item.statement must be a non-empty string");
        if (typeof it?.correctAnswer !== "boolean") errors.push("each item.correctAnswer must be boolean");
      }
      break;
    }

    case TASK_TYPES.TOWER_BUILDER: {
      if (!Array.isArray(task.items) || task.items.length < 5) {
        errors.push("tower-builder requires items[] with at least 5 statements");
        break;
      }
      // Cap — too many statements means an endless stack (tester: "too many to stack").
      if (task.items.length > 10) {
        task.items = task.items.slice(0, 10);
      }
      const validCats = new Set(["benefit", "harm", "neutral"]);
      for (const it of task.items) {
        if (!isNonEmptyString(it?.statement)) errors.push("each item.statement must be a non-empty string");
        if (!validCats.has(it?.category)) {
          if (typeof it?.correctAnswer === "boolean") {
            it.category = it.correctAnswer ? "benefit" : "harm";
          } else {
            errors.push("each item.category must be benefit, harm, or neutral");
          }
        }
      }
      // Balance — need enough HARM (incorrect/collapse) statements so students must
      // discriminate, not just stack everything (tester: "not enough false").
      const harmCount = task.items.filter((it) => it?.category === "harm").length;
      if (harmCount < 2) {
        errors.push(`tower-builder needs at least 2 "harm" (incorrect) statements so it isn't all-stack — found ${harmCount}. Make ~3 of the statements false/incorrect.`);
      }
      break;
    }

    case TASK_TYPES.FLASHCARDS:
    case TASK_TYPES.FLASHCARDS_RACE: {
      const fcItems = task.config?.items || [];
      if (!Array.isArray(fcItems) || fcItems.length < 5) {
        errors.push("flashcards requires config.items[] with at least 5 cards");
        break;
      }
      for (const it of fcItems) {
        if (!isNonEmptyString(it?.question)) errors.push("each card.question must be a non-empty string");
        if (!isNonEmptyString(it?.answer)) errors.push("each card.answer must be a non-empty string");
      }
      break;
    }

    case TASK_TYPES.SHORT_ANSWER: {
      // Helper: resolve correctAnswer from common AI alternate field names
      const _resolveAns = (o) =>
        asNonEmptyString(o?.correctAnswer) || asNonEmptyString(o?.answer) ||
        asNonEmptyString(o?.correct) || asNonEmptyString(o?.expected) ||
        asNonEmptyString(o?.correctResponse) || asNonEmptyString(o?.response) || "";
      const _resolvePrompt = (o) =>
        asNonEmptyString(o?.prompt) || asNonEmptyString(o?.question) || "";

      const hasItems = Array.isArray(task.items) && task.items.length;
      // GUARD: if the AI emitted an items[] key but it came through empty, the
      // task has no questions — reject instead of falling through to the
      // single-prompt fallback (which would turn the generic instruction prompt
      // into a bogus "question"). Bug class 1: empty content array.
      const emptyItemsKey = Array.isArray(task.items) && task.items.length === 0;
      if (hasItems) {
        if (task.items.length < 1) errors.push("items[] must have at least 1 item");
        task.items.forEach((it, i) => {
          if (!_resolvePrompt(it)) errors.push(`items[${i}].prompt required`);
          // Normalize alternate answer fields onto correctAnswer for downstream code
          if (!asNonEmptyString(it.correctAnswer)) it.correctAnswer = _resolveAns(it);
          // Missing correctAnswer is a warning, not a blocker — AI scoring can handle open-ended questions
          if (!asNonEmptyString(it.correctAnswer)) {
            console.warn(`[validate] short-answer items[${i}].correctAnswer missing — AI scoring will be used`);
          }
        });
      } else if (emptyItemsKey) {
        errors.push("short-answer items[] is empty — provide at least one question");
      } else {
        // Single-prompt fallback — also check alternate field names
        const saPrompt = _resolvePrompt(task);
        const saAns = _resolveAns(task);
        if (!saPrompt) errors.push("prompt required");
        // Auto-convert to items[] if we found a prompt — but only if it reads
        // like an actual question, not a generic instruction. Otherwise the
        // task is unanswerable (no real question was generated).
        else if (_isGenericInstruction(saPrompt)) {
          errors.push("short-answer has no question — the prompt is a generic instruction, not a question; provide items[] with real questions");
        } else {
          task.items = [{ id: "q1", prompt: saPrompt, correctAnswer: saAns || "" }];
        }
      }
      break;
    }

    case TASK_TYPES.SORT: {
      const cfg = task.config || {};
      if (!Array.isArray(cfg.buckets) || cfg.buckets.length < 2) errors.push("config.buckets must have at least 2 buckets");
      if (!Array.isArray(cfg.items) || cfg.items.length < 3) errors.push("config.items must have at least 3 items");
      const ak = cfg.answerKey;
      if (!isObject(ak) || Object.keys(ak).length < cfg.items.length) errors.push("config.answerKey mapping is required");
      break;
    }

    case TASK_TYPES.SEQUENCE:
    case TASK_TYPES.TIMELINE: {
      const cfg = isObject(task.config) ? task.config : {};
      const items =
        (Array.isArray(cfg.items) && cfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(cfg.sequence) && cfg.sequence) ||
        (Array.isArray(task.sequence) && task.sequence) ||
        [];

      if (!Array.isArray(items) || items.length < 4) {
        errors.push("items/sequence must have at least 4 steps");
        break;
      }

      const order = task.correctOrder ?? cfg.correctOrder ?? task.correctAnswer ?? cfg.correctAnswer ?? task.answerKey ?? cfg.answerKey;
      if (!order) errors.push("correct order is required (correctOrder/correctAnswer/answerKey)");
      break;
    }

    case TASK_TYPES.LABELME: {
      if (!Array.isArray(task.labels) || task.labels.length < 5) errors.push("labels[] must have 5 markers (A-E)");
      else if (task.labels.some((l) => !l || !l.correct)) errors.push("every label needs a correct term");
      if (!Array.isArray(task.options) || task.options.length < 5) errors.push("options[] must have at least 5 terms");
      if (!asNonEmptyString(task.imageUrl, "") && !asNonEmptyString(task.imagePrompt, ""))
        errors.push("labelme needs imageUrl or imagePrompt (to generate the diagram)");
      break;
    }

    case TASK_TYPES.MATCHING: {
      if (!Array.isArray(task.leftItems) || task.leftItems.length < 5) errors.push("leftItems[] must have at least 5 items");
      if (!Array.isArray(task.rightItems) || task.rightItems.length < 5) errors.push("rightItems[] must have at least 5 items");
      if (!isObject(task.correctMatches) || Object.keys(task.correctMatches).length < 5) errors.push("correctMatches map must include at least 5 pairs");
      break;
    }

    case TASK_TYPES.MAPIT: {
      if (!Array.isArray(task.markers) || task.markers.length < 3) {
        errors.push(`mapit needs at least 3 markers (got ${task.markers?.length || 0})`);
      } else if (task.markers.length > 5) {
        errors.push(`mapit must have at most 5 markers (got ${task.markers.length}) — students get overwhelmed`);
      } else {
        task.markers.forEach((m, i) => {
          if (!m || !asNonEmptyString(m.correctAnswer, "")) errors.push(`markers[${i}] needs a correctAnswer`);
          if (!Number.isFinite(m?.lat) || m.lat < -90 || m.lat > 90) errors.push(`markers[${i}].lat must be a decimal between -90 and 90`);
          if (!Number.isFinite(m?.lng) || m.lng < -180 || m.lng > 180) errors.push(`markers[${i}].lng must be a decimal between -180 and 180`);
        });
      }
      if (!Array.isArray(task.choices) || task.choices.length < 3) {
        errors.push(`mapit needs at least 3 choices (got ${task.choices?.length || 0})`);
      }
      // Every marker's correctAnswer must appear in choices (case-insensitive).
      if (Array.isArray(task.markers) && Array.isArray(task.choices)) {
        const lowerChoices = new Set(task.choices.map((c) => String(c).trim().toLowerCase()));
        const missing = task.markers
          .filter((m) => m?.correctAnswer && !lowerChoices.has(String(m.correctAnswer).trim().toLowerCase()))
          .map((m) => m.correctAnswer);
        if (missing.length) {
          errors.push(`mapit choices[] is missing ${missing.length} correctAnswer(s): ${missing.slice(0, 3).join(", ")}`);
        }
      }
      // Map viewport must be valid (the normalizer fills defaults, but warn
      // if numbers are extreme — usually means the AI used wrong sign).
      const m = isObject(task.map) ? task.map : {};
      if (!Number.isFinite(m.centerLat) || !Number.isFinite(m.centerLng)) {
        errors.push("mapit needs map.centerLat and map.centerLng (decimal degrees)");
      }
      if (Number.isFinite(m.zoom) && (m.zoom < 1 || m.zoom > 10)) {
        errors.push(`map.zoom must be between 1 and 10 (got ${m.zoom})`);
      }
      break;
    }

    case TASK_TYPES.READING_COMP: {
      const text =
        asNonEmptyString(task.config?.text, "") ||
        asNonEmptyString(task.generatedParagraph, "") ||
        asNonEmptyString(task.config?.generatedParagraph, "");
      if (!text) errors.push("config.text (reading passage) is required (or legacy generatedParagraph)");
      const qs = task.config?.questions;
      if (!Array.isArray(qs) || qs.length < 3) errors.push("config.questions must be an array with at least 3 items");
      break;
    }

    case TASK_TYPES.MIND_MAPPER: {
      if (!Array.isArray(task.items) || task.items.length < 4) errors.push("items[] must be an array with at least 4 items");
      if (!isObject(task.structure)) errors.push("structure must exist and include blank slots (e.g., '_____' or empty slot strings)");
      else {
        const s = JSON.stringify(task.structure);
        if (!s.includes("_____")) errors.push("structure must include blank slots (e.g., '_____')");
      }
      break;
    }

    case TASK_TYPES.MAD_DASH: {
      const cfg = isObject(task.config) ? task.config : {};
      const seq =
        (Array.isArray(task.sequence) && task.sequence) ||
        (Array.isArray(cfg.sequence) && cfg.sequence) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(cfg.items) && cfg.items) ||
        [];

      if (!Array.isArray(seq) || seq.length < 3) errors.push("items/sequence must have at least 3 steps");
      break;
    }

    case TASK_TYPES.MAD_DASH_SEQUENCE: {
      const cfg = isObject(task.config) ? task.config : {};
      const items =
        (Array.isArray(cfg.items) && cfg.items) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(task.sequence) && task.sequence) ||
        (Array.isArray(cfg.sequence) && cfg.sequence) ||
        [];

      if (!Array.isArray(items) || items.length < 3) {
        errors.push("config.items (or items/sequence) must have at least 3 items");
        break;
      }

      const order = cfg.correctOrder ?? task.correctOrder ?? cfg.answerKey ?? task.answerKey;
      if (!order) errors.push("correct order is required (config.correctOrder / correctOrder / answerKey)");
      break;
    }

    case TASK_TYPES.HANGMAN_DUEL: {
      const wb = task.config?.wordsByStation;
      if (!Array.isArray(wb) || wb.length !== 8) {
        errors.push("hangman-duel requires config.wordsByStation[] with exactly 8 entries (one per station)");
        break;
      }
      for (const w of wb) {
        if (!isNonEmptyString(w?.word)) errors.push("hangman-duel: each wordsByStation.word must be non-empty");
        const hint = String(w?.hint || "").trim();
        if (!hint) {
          errors.push("hangman-duel: each wordsByStation.hint must be non-empty");
        } else if (/^think about this \d+-letter word/i.test(hint)) {
          errors.push(`hangman-duel: hint "${hint}" is a placeholder — hints must be real definitions or clues`);
        }
      }
      break;
    }

    case TASK_TYPES.WORD_WEAVER_DUEL: {
      const words =
        (Array.isArray(task.config?.words) && task.config.words) ||
        (Array.isArray(task.items) && task.items) ||
        (Array.isArray(task.words) && task.words) ||
        [];
      if (!Array.isArray(words) || words.length < 6) {
        errors.push(`word-weaver-duel requires at least 6 words (got ${words.length})`);
        break;
      }
      break;
    }

    case TASK_TYPES.TRUE_FALSE_CONNECT_FOUR: {
      const c4Stmts = Array.isArray(task.statements) ? task.statements : [];
      if (c4Stmts.length < 6) {
        errors.push(`true-false-connect-four requires at least 6 statements (got ${c4Stmts.length})`);
        break;
      }
      const badStmts = c4Stmts.filter((s) => !s?.text || typeof s.text !== "string" || !s.text.trim());
      if (badStmts.length > 0) {
        errors.push(`${badStmts.length} statement(s) have empty text`);
      }
      // Check for reasonable true/false balance (at least 2 of each side)
      const falseCount = c4Stmts.filter((s) => s.isFalse).length;
      const trueCount = c4Stmts.length - falseCount;
      if (falseCount < 2 || trueCount < 2) {
        errors.push(`statements must include at least 2 true and 2 false (got ${trueCount} true, ${falseCount} false)`);
      }
      break;
    }

    case TASK_TYPES.DRAW_MIME: {
      const dmClues = Array.isArray(task.clues) ? task.clues : [];
      if (dmClues.length < 2) {
        errors.push("draw-mime requires at least 2 clues");
        break;
      }
      // Reject if clues are all generic fallbacks ("Draw or Mime", "Clue 1", etc.)
      const isGenericClue = (c) =>
        /^(draw\s+or\s+mime|clue\s*\d+|item\s*\d+|concept\s*\d+)$/i.test(String(c || "").trim());
      const genericCount = dmClues.filter(isGenericClue).length;
      if (genericCount === dmClues.length) {
        errors.push("draw-mime clues are all generic placeholders — real subject-matter clues required");
      }
      break;
    }

    case TASK_TYPES.LETTER: {
      const letCfg = task.config || {};
      if (!letCfg.character) errors.push("letter requires config.character");
      if (!Array.isArray(letCfg.relevantConcepts) || letCfg.relevantConcepts.filter(Boolean).length < 4) {
        errors.push(`letter requires at least 4 relevantConcepts (got ${(letCfg.relevantConcepts || []).filter(Boolean).length})`);
      }
      break;
    }

    // ─── Simple types: only need title + prompt (global checks cover these) ───
    case TASK_TYPES.OPEN_TEXT:
    case TASK_TYPES.CASE_STUDY:
    case TASK_TYPES.RECORD_AUDIO:
    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
    case TASK_TYPES.PHOTO:
    case TASK_TYPES.MAKE_AND_SNAP:
    case TASK_TYPES.PHOTO_JOURNAL:
    case TASK_TYPES.BODY_BREAK:
    case TASK_TYPES.MOTION_MISSION: {
      // Title + prompt already validated above; no additional structured data required.
      // BUT reject if the AI stuffed MC-style or structured content (wrong-type assignment).
      const simpleItems = Array.isArray(task.items) ? task.items : [];
      const hasMcContent = simpleItems.some(
        (it) => isObject(it) && (Array.isArray(it.options) || it.correctAnswer !== undefined || it.correctIndex !== undefined)
      );
      if (hasMcContent) {
        errors.push(`${taskType} has multiple-choice style items[] — wrong taskType assignment (content belongs to a different type)`);
      }
      // Also reject if config has structured data from other types
      const cfg = task.config || {};
      if (cfg.statements || cfg.wordsByStation || cfg.rounds || cfg.secretAnswers || cfg.seedTerm || cfg.goodFoods) {
        errors.push(`${taskType} has config fields from another task type — wrong taskType assignment`);
      }
      // --- OVERSTUFFED-PROMPT GUARD (deterministic) ---
      // Draw / Mime / Motion Mission / Body Break are "do ONE simple thing"
      // tasks. A long, multi-numbered prompt means the AI crammed the whole word
      // bank in (e.g. "Draw and label diagrams: 1. … 2. … 8. …"). Hard-reject so
      // it regenerates focused — or gets dropped — rather than shipping.
      // Photo / Make-and-Snap / Photo-Journal are "capture ONE artifact" tasks —
      // they get a more generous budget but still must not be a multi-part brief
      // (tester: "Way too complex: … using fraction strips, counters, number
      // lines, grids, and pattern blocks … 1) … 2) …").
      {
        const p = String(task.prompt || "");
        const numbered = (p.match(/(?:^|\s)\d+[.)]\s/g) || []).length; // "1. ", "2) ", …
        const isSingleFocus =
          taskType === TASK_TYPES.DRAW ||
          taskType === TASK_TYPES.MIME ||
          taskType === TASK_TYPES.MOTION_MISSION ||
          taskType === TASK_TYPES.BODY_BREAK;
        const isPhotoFamily =
          taskType === TASK_TYPES.PHOTO ||
          taskType === TASK_TYPES.MAKE_AND_SNAP ||
          taskType === TASK_TYPES.PHOTO_JOURNAL;
        if (isSingleFocus) {
          if (p.length > 320) {
            errors.push(`${taskType} prompt is too long (${p.length} chars) — this is a single-focus task: give ONE clear thing to do, not a list of concepts.`);
          } else if (numbered >= 3) {
            errors.push(`${taskType} prompt crams ${numbered} numbered parts — pick ONE concept; a single-focus task must not list many sub-tasks.`);
          }
        } else if (isPhotoFamily) {
          if (p.length > 450) {
            errors.push(`${taskType} prompt is too long/complex (${p.length} chars) — ask students to photograph ONE artifact, not a multi-part display of every concept.`);
          } else if (numbered >= 3) {
            errors.push(`${taskType} prompt crams ${numbered} numbered parts — a photo task should capture ONE thing, not a checklist of concepts.`);
          }
        }
      }
      // --- PHOTO time heuristic: complex drawing/build prompts need more time ---
      // WARN (don't block); the sanitizer bumps timeLimitSeconds so this only fires
      // if something downstream cleared it.
      if (
        taskType === TASK_TYPES.PHOTO ||
        taskType === TASK_TYPES.MAKE_AND_SNAP ||
        taskType === TASK_TYPES.PHOTO_JOURNAL
      ) {
        const prompt = String(task.prompt || "");
        const isComplex = prompt.length > 200 || /drawing|model|build|construct|create|design/i.test(prompt);
        if (isComplex) {
          const tl = Number(task.timeLimitSeconds) || 0;
          if (tl < 240) {
            task._validationWarning = `${taskType} has a complex drawing/build prompt but only ${tl || "(unset)"}s — should allow at least 240s`;
          }
        }
      }
      break;
    }

    case TASK_TYPES.ART_VIEW: {
      const avCfg = task.config || {};
      // imageDescription is REQUIRED (serves as fallback when URLs break)
      if (!avCfg.imageDescription) {
        errors.push("art-view requires config.imageDescription (detailed description of the artwork for fallback)");
      }
      // imageUrl is strongly recommended but not hard-rejected (description-only mode works)
      if (!avCfg.imageUrl) {
        console.warn("[validate] art-view is missing config.imageUrl — will display description-only mode");
      }
      const vs = Number(avCfg.viewingSeconds);
      if (vs && (vs < 10 || vs > 300)) {
        errors.push("config.viewingSeconds must be between 10 and 300");
      }
      const rs = Number(avCfg.responseSeconds);
      if (rs && (rs < 30 || rs > 600)) {
        errors.push("config.responseSeconds must be between 30 and 600");
      }
      // --- SPOT-CHECK: gate the viewing-phase Done button so students must
      // actually look at the artwork (3 real + 1 plausible decoy). Optional
      // field for backward compatibility with older saved tasks. ---
      if (Array.isArray(avCfg.spotItems)) {
        const items = avCfg.spotItems.filter((it) => it && typeof it === "object" && typeof it.text === "string" && it.text.trim());
        const realCount = items.filter((it) => it.isBogus !== true).length;
        const bogusCount = items.filter((it) => it.isBogus === true).length;
        if (items.length < 3) {
          errors.push(`config.spotItems must have at least 3 entries with non-empty text (got ${items.length})`);
        }
        if (bogusCount < 1) {
          errors.push("config.spotItems must include at least one decoy entry with isBogus:true");
        }
        if (realCount < 2) {
          errors.push("config.spotItems must include at least 2 real entries (isBogus:false)");
        }
      }
      break;
    }

    case TASK_TYPES.HISTORICAL_DOC: {
      const hdCfg = task.config || {};
      if (!hdCfg.imageDescription) {
        errors.push("historical-doc requires config.imageDescription (detailed description of the document for fallback)");
      }
      if (!hdCfg.imageUrl) {
        console.warn("[validate] historical-doc is missing config.imageUrl — will display description-only mode");
      }
      if (!hdCfg.docTitle) {
        errors.push("historical-doc requires config.docTitle");
      }
      const hdVs = Number(hdCfg.viewingSeconds);
      if (hdVs && (hdVs < 10 || hdVs > 300)) {
        errors.push("config.viewingSeconds must be between 10 and 300");
      }
      const hdRs = Number(hdCfg.responseSeconds);
      if (hdRs && (hdRs < 30 || hdRs > 600)) {
        errors.push("config.responseSeconds must be between 30 and 600");
      }
      if (!Array.isArray(hdCfg.analysisPrompts) || hdCfg.analysisPrompts.length < 2) {
        errors.push("config.analysisPrompts must have at least 2 analysis questions");
      }
      // --- SPOT-CHECK: forces actual engagement during the reading phase
      // (3 real document details + 1 plausible decoy). Optional field for
      // backward compatibility with older saved tasks. ---
      if (Array.isArray(hdCfg.spotItems)) {
        const items = hdCfg.spotItems.filter((it) => it && typeof it === "object" && typeof it.text === "string" && it.text.trim());
        const realCount = items.filter((it) => it.isBogus !== true).length;
        const bogusCount = items.filter((it) => it.isBogus === true).length;
        if (items.length < 3) {
          errors.push(`config.spotItems must have at least 3 entries with non-empty text (got ${items.length})`);
        }
        if (bogusCount < 1) {
          errors.push("config.spotItems must include at least one decoy entry with isBogus:true");
        }
        if (realCount < 2) {
          errors.push("config.spotItems must include at least 2 real entries (isBogus:false)");
        }
      }
      break;
    }

    case TASK_TYPES.VENNSORT: {
      const vCfg = task.config || {};
      if (!Array.isArray(vCfg.categories) || vCfg.categories.length < 2) errors.push("config.categories must have at least 2 categories");
      if (!Array.isArray(vCfg.items) || vCfg.items.length < 5) errors.push("config.items must have at least 5 items");
      const vAk = vCfg.correctAnswer || vCfg.answerKey;
      if (!isObject(vAk) || Object.keys(vAk).length < 3) errors.push("correctAnswer/answerKey mapping is required (at least 3 entries)");
      break;
    }

    case TASK_TYPES.JEOPARDY: {
      const jClues = Array.isArray(task.clues) ? task.clues : [];
      if (jClues.length < 3) errors.push("jeopardy requires at least 3 clues");
      break;
    }

    case TASK_TYPES.GUESS_WHO: {
      const gwAnswers = task.config?.secretAnswers || [];
      if (!Array.isArray(gwAnswers) || gwAnswers.length < 2) errors.push("guess-who requires config.secretAnswers[] with at least 2 concepts");
      break;
    }

    case TASK_TYPES.PET_FEEDING: {
      // Pet-feeding: students classify statements as good (true/pro) or bad (false/con)
      const pfGood = Array.isArray(task.goodFoods) ? task.goodFoods : [];
      const pfBad = Array.isArray(task.badFoods) ? task.badFoods : [];
      const pfItems = Array.isArray(task.items) ? task.items : Array.isArray(task.foodItems) ? task.foodItems : [];
      const pfTotal = pfGood.length + pfBad.length + pfItems.length;
      if (pfTotal < 10) errors.push(`pet-feeding requires at least 10 food items (got ${pfTotal} across goodFoods/badFoods/items)`);
      if (pfGood.length > 0 && pfBad.length < 4) errors.push("pet-feeding requires at least 4 badFoods (false/con statements)");
      if (pfBad.length > 0 && pfGood.length < 4) errors.push("pet-feeding requires at least 4 goodFoods (true/pro statements)");
      break;
    }

    case TASK_TYPES.LIVE_DEBATE: {
      const ldCfg = task.config || {};
      const postulate = task.postulate || ldCfg.postulate || task.resolution || ldCfg.resolution || "";
      if (!postulate) errors.push("live-debate requires a postulate (debate topic/resolution)");
      break;
    }

    case TASK_TYPES.BRAINSTORM_BATTLE: {
      const bbRounds = task.config?.rounds || [];
      if (!Array.isArray(bbRounds) || bbRounds.length < 1) errors.push("brainstorm-battle requires config.rounds[] with at least 1 round");
      break;
    }

    case TASK_TYPES.COLLABORATION: {
      // Collaboration only needs taskType, title, and a prompt.
      // No config.roles required — the frontend doesn't use them.
      const cp = String(task.prompt || "").trim();
      if (!cp) errors.push("collaboration requires a non-empty prompt");
      // --- OVERSTUFFED-PROMPT GUARD ---
      // A team task should be ONE clear, grade-appropriate challenge — not a
      // multi-concept brief (tester: "too complicated for grade 7: … Team 1 will
      // explore adding/subtracting fractions … Team 2 …"). Reject walls of text
      // so it regenerates focused.
      const cNumbered = (cp.match(/(?:^|\s)\d+[.)]\s/g) || []).length;
      if (cp.length > 700) {
        errors.push(`collaboration prompt is too long/complex (${cp.length} chars) — give the teams ONE clear, focused challenge, not a brief covering many concepts.`);
      } else if (cNumbered >= 4) {
        errors.push(`collaboration prompt crams ${cNumbered} numbered parts — narrow it to one focused team challenge.`);
      }
      break;
    }

    case TASK_TYPES.SPEECH_RECOGNITION: {
      const srPhrases = task.config?.targetPhrases || task.items || [];
      if (!Array.isArray(srPhrases) || srPhrases.length < 1) {
        // speech-recognition can work with just a prompt (freeform speech), so only warn
        // errors.push("speech-recognition should have targetPhrases or items");
      }
      break;
    }

    case TASK_TYPES.ECHO_CHAIN: {
      const ecSeed = task.config?.seedTerm || task.seedTerm || "";
      if (!ecSeed) errors.push("echo-chain requires config.seedTerm (a vocabulary word to start the chain)");
      break;
    }

    case TASK_TYPES.NARRATION_SYNTHESIZE: {
      const nsCfg = task.config || {};
      if (!Array.isArray(nsCfg.prompts) || nsCfg.prompts.length < 2) {
        errors.push("narration-synthesize requires config.prompts[] with at least 2 prompts");
      } else {
        const pc = Number(nsCfg.playerCount);
        if (Number.isFinite(pc) && nsCfg.prompts.length < pc) {
          errors.push(`narration-synthesize requires one prompt per player: prompts (${nsCfg.prompts.length}) must be >= playerCount (${pc})`);
        }
      }
      break;
    }

    case TASK_TYPES.PRONUNCIATION: {
      // Component needs referenceText (a word/phrase to pronounce), not items[]
      const refText = task.referenceText || task.config?.referenceText || "";
      if (!String(refText).trim()) errors.push("pronunciation requires referenceText");
      break;
    }

    case TASK_TYPES.SCRIPT_PLAY: {
      const spCfg = task.config || {};
      if (!Array.isArray(spCfg.roles) || spCfg.roles.length < 2) errors.push("script-play requires config.roles[] with at least 2 roles");
      if (!Array.isArray(spCfg.lines) || spCfg.lines.length < 4) errors.push("script-play requires config.lines[] with at least 4 lines");
      break;
    }

    case TASK_TYPES.ROLE_PLAY_DECK: {
      const rpCfg = task.config || {};
      if (!Array.isArray(rpCfg.roles) || rpCfg.roles.length < 2) {
        errors.push("role-play-deck requires config.roles[] with at least 2 named roles");
      } else {
        // Renderer reads { name, role, characteristics[], gender } — those
        // are the load-bearing fields. The old goal/constraint validation
        // was checking dead-code fields the renderer ignores. See the
        // matching realignment in TASK_SHELLS + aiPrompt.
        rpCfg.roles.forEach((r, i) => {
          if (!String(r?.name || "").trim()) errors.push(`role[${i}] missing name`);
          if (!String(r?.role || "").trim()) errors.push(`role[${i}] missing role description`);
          if (!Array.isArray(r?.characteristics) || r.characteristics.length < 1) {
            errors.push(`role[${i}] requires characteristics[] (3-5 short traits)`);
          }
        });
      }
      if (!isNonEmptyString(rpCfg.scenario)) {
        errors.push("role-play-deck requires config.scenario (non-empty)");
      }
      break;
    }

    case TASK_TYPES.PEER_EDITING: {
      if (!task.passage || typeof task.passage !== "string" || task.passage.trim().length < 20) {
        errors.push("peer-editing requires a passage of at least 20 characters");
      }
      if (!Array.isArray(task.errors) || task.errors.length < 3) {
        errors.push("peer-editing requires at least 3 errors in the errors array");
      }
      break;
    }

    case TASK_TYPES.INTERVIEW: {
      if (!Array.isArray(task.candidates) || task.candidates.length < 2) {
        errors.push("interview requires at least 2 candidates");
      } else {
        for (let i = 0; i < task.candidates.length; i++) {
          const c = task.candidates[i];
          if (!c.name || typeof c.name !== "string" || !c.name.trim()) {
            errors.push(`interview candidate[${i}] requires a non-empty name`);
          }
          if (!c.systemPrompt || typeof c.systemPrompt !== "string" || !c.systemPrompt.trim()) {
            errors.push(`interview candidate[${i}] requires a non-empty systemPrompt`);
          }
        }
      }
      if (typeof task.minTurns !== "number" || task.minTurns < 2) {
        errors.push("interview requires minTurns >= 2");
      }
      if (typeof task.maxTurns !== "number" || task.maxTurns < task.minTurns) {
        errors.push("interview requires maxTurns >= minTurns");
      }
      break;
    }

    case TASK_TYPES.CLOZE: {
      if (!task.passage || typeof task.passage !== "string" || task.passage.trim().length < 20) {
        errors.push("cloze requires a passage of at least 20 characters");
      }
      if (!Array.isArray(task.blanks) || task.blanks.length < 2) {
        errors.push("cloze requires at least 2 blanks");
      } else {
        for (let i = 0; i < task.blanks.length; i++) {
          if (!task.blanks[i]?.answer || typeof task.blanks[i].answer !== "string" || !task.blanks[i].answer.trim()) {
            errors.push(`cloze blank[${i}] requires a non-empty answer`);
          }
        }
      }
      // Verify marker count matches blanks count
      if (task.passage && Array.isArray(task.blanks) && task.blanks.length > 0) {
        const markerCount = (task.passage.match(/___/g) || []).length;
        if (markerCount !== task.blanks.length) {
          errors.push(`cloze passage has ${markerCount} ___ markers but ${task.blanks.length} blanks`);
        }
      }
      break;
    }

    case TASK_TYPES.TEACH_BACK: {
      if (!Array.isArray(task.concepts) || task.concepts.length < 3) {
        errors.push("teach-back requires at least 3 concepts");
      } else if (task.concepts.length > 5) {
        errors.push("teach-back should have at most 5 concepts");
      } else {
        for (let i = 0; i < task.concepts.length; i++) {
          if (!task.concepts[i] || typeof task.concepts[i] !== "string" || !task.concepts[i].trim()) {
            errors.push(`teach-back concept[${i}] must be a non-empty string`);
          }
        }
      }
      if (!task.targetAge || typeof task.targetAge !== "string" || !task.targetAge.trim()) {
        errors.push("teach-back requires a non-empty targetAge string");
      }
      break;
    }

    case TASK_TYPES.LEGENDS: {
      const cfg = isObject(task.config) ? task.config : {};
      if (!isObject(cfg.figure) || typeof cfg.figure.name !== "string" || !cfg.figure.name.trim()) {
        errors.push("legends requires config.figure.name");
      }
      if (!isObject(cfg.figure) || typeof cfg.figure.portraitUrl !== "string" || !cfg.figure.portraitUrl.trim()) {
        errors.push("legends requires config.figure.portraitUrl");
      } else if (!/^https?:\/\//.test(cfg.figure.portraitUrl)) {
        errors.push("legends config.figure.portraitUrl must be an http(s) URL");
      }
      if (!Array.isArray(cfg.facts) || cfg.facts.length !== 10) {
        errors.push(`legends requires EXACTLY 10 facts (got ${Array.isArray(cfg.facts) ? cfg.facts.length : "none"})`);
      } else {
        const counts = { what: 0, where: 0, why: 0, when: 0, decoy: 0 };
        for (const f of cfg.facts) {
          if (!f?.text || typeof f.text !== "string" || !f.text.trim()) {
            errors.push("every legends fact must have non-empty text");
            break;
          }
          if (!["what", "where", "why", "when", "decoy"].includes(f.category)) {
            errors.push(`legends fact category "${f.category}" invalid; must be what/where/why/when/decoy`);
            break;
          }
          counts[f.category] += 1;
          // The figure's name must NOT appear in any fact — sorting would be trivial
          if (cfg.figure?.name && f.text.toLowerCase().includes(cfg.figure.name.toLowerCase())) {
            errors.push(`legends fact mentions the figure's name verbatim — players would solve it instantly`);
            break;
          }
        }
        // Required distribution: 2/2/2/1/3
        if (counts.what !== 2)  errors.push(`legends needs exactly 2 'what' facts (got ${counts.what})`);
        if (counts.where !== 2) errors.push(`legends needs exactly 2 'where' facts (got ${counts.where})`);
        if (counts.why !== 2)   errors.push(`legends needs exactly 2 'why' facts (got ${counts.why})`);
        if (counts.when !== 1)  errors.push(`legends needs exactly 1 'when' fact (got ${counts.when})`);
        if (counts.decoy !== 3) errors.push(`legends needs exactly 3 'decoy' facts (got ${counts.decoy})`);
      }
      break;
    }

    case TASK_TYPES.TRUTH_OR_DARE: {
      const cfg = isObject(task.config) ? task.config : {};
      if (typeof cfg.subject !== "string" || !cfg.subject.trim()) {
        errors.push("truth-or-dare requires config.subject");
      }
      if (typeof cfg.unitName !== "string" || !cfg.unitName.trim()) {
        errors.push("truth-or-dare requires config.unitName");
      }
      const grade = Number(cfg.gradeLevel);
      if (!(grade >= 1 && grade <= 12)) {
        errors.push(`truth-or-dare config.gradeLevel must be 1-12 (got ${cfg.gradeLevel})`);
      }
      // Intensity caps
      for (const field of ["physicalIntensityMax", "socialIntensityMax"]) {
        if (cfg[field] != null) {
          const n = Number(cfg[field]);
          if (!(n >= 0 && n <= 3)) {
            errors.push(`truth-or-dare config.${field} must be 0-3 (got ${cfg[field]})`);
          }
        }
      }
      // Round count
      if (cfg.totalRounds != null) {
        const r = Number(cfg.totalRounds);
        if (!(r >= 3 && r <= 12)) {
          errors.push(`truth-or-dare config.totalRounds must be 3-12 (got ${cfg.totalRounds})`);
        }
      }
      // Enum validation
      const allowedTierProgression = ["linear", "random"];
      if (cfg.tierProgression && !allowedTierProgression.includes(cfg.tierProgression)) {
        errors.push(`truth-or-dare config.tierProgression must be one of ${allowedTierProgression.join("/")}`);
      }
      const allowedJudgmentModes = ["teacher", "class-vote", "mixed"];
      if (cfg.judgmentMode && !allowedJudgmentModes.includes(cfg.judgmentMode)) {
        errors.push(`truth-or-dare config.judgmentMode must be one of ${allowedJudgmentModes.join("/")}`);
      }
      // Seed challenge shape (lenient — runtime generator produces the real ones)
      if (cfg.seedChallenges != null) {
        if (!Array.isArray(cfg.seedChallenges)) {
          errors.push("truth-or-dare config.seedChallenges must be an array");
        } else if (cfg.seedChallenges.length > 5) {
          errors.push("truth-or-dare config.seedChallenges max 5");
        } else {
          cfg.seedChallenges.forEach((c, i) => {
            if (!isObject(c)) { errors.push(`truth-or-dare seedChallenges[${i}] must be an object`); return; }
            if (!["truth", "dare"].includes(c.type)) errors.push(`truth-or-dare seedChallenges[${i}].type must be truth|dare`);
            if (typeof c.prompt !== "string" || !c.prompt.trim()) errors.push(`truth-or-dare seedChallenges[${i}].prompt required`);
          });
        }
      }
      break;
    }

    case TASK_TYPES.SPEED_DRAW: {
      const cfg = isObject(task.config) ? task.config : {};
      const word = typeof cfg.word === "string" ? cfg.word.trim() : "";
      if (!word) {
        errors.push("speed-draw requires config.word (one drawable concept, 1-3 words)");
      } else if (word.length > 60) {
        errors.push(`speed-draw config.word too long (${word.length} chars, max 60)`);
      } else if (word.split(/\s+/).length > 5) {
        errors.push(`speed-draw config.word too many words (${word.split(/\s+/).length}, max 5) — ONE drawable concept`);
      }
      if (cfg.timeLimitSeconds != null) {
        const t = Number(cfg.timeLimitSeconds);
        if (!(t >= 30 && t <= 120)) {
          errors.push(`speed-draw config.timeLimitSeconds must be 30-120 (got ${cfg.timeLimitSeconds})`);
        }
      }
      if (cfg.difficulty && !["EASY", "MEDIUM", "HARD"].includes(cfg.difficulty)) {
        errors.push(`speed-draw config.difficulty must be EASY/MEDIUM/HARD (got ${cfg.difficulty})`);
      }
      break;
    }

    case TASK_TYPES.UPVOTE: {
      const cfg = isObject(task.config) ? task.config : {};
      // Proposition: required, 20-250 chars after trim. Length floor is on
      // purpose — anything shorter is almost always a slogan or a question
      // fragment and not a debatable claim.
      const prop = typeof cfg.proposition === "string" ? cfg.proposition.trim() : "";
      if (!prop) {
        errors.push("upvote requires config.proposition");
      } else if (prop.length < 20) {
        errors.push(`upvote config.proposition too short (got ${prop.length} chars, need ≥ 20)`);
      } else if (prop.length > 250) {
        errors.push(`upvote config.proposition too long (got ${prop.length} chars, max 250)`);
      }
      // Vote timer
      if (cfg.voteTimeSeconds != null) {
        const v = Number(cfg.voteTimeSeconds);
        if (!(v >= 30 && v <= 300)) {
          errors.push(`upvote config.voteTimeSeconds must be 30-300 (got ${cfg.voteTimeSeconds})`);
        }
      }
      // Boolean knobs — only error if the wrong TYPE is passed (null means default)
      if (cfg.requireReasoningOnSubmit != null && typeof cfg.requireReasoningOnSubmit !== "boolean") {
        errors.push(`upvote config.requireReasoningOnSubmit must be a boolean (got ${typeof cfg.requireReasoningOnSubmit})`);
      }
      if (cfg.showRunningTally != null && typeof cfg.showRunningTally !== "boolean") {
        errors.push(`upvote config.showRunningTally must be a boolean (got ${typeof cfg.showRunningTally})`);
      }
      // Worldview enum (soft — accept missing/empty)
      if (cfg.worldview && typeof cfg.worldview === "string") {
        const allowed = ["faith", "secular", "general"];
        if (!allowed.includes(cfg.worldview)) {
          errors.push(`upvote config.worldview must be one of ${allowed.join("/")} (got ${cfg.worldview})`);
        }
      }
      break;
    }

    case TASK_TYPES.CURRENT_EVENTS: {
      // The persisted task is a SHELL — the only required input is lessonTopic
      // (everything else has a default). The `resolved` block is filled at runtime
      // by the resolver, not by the AI generator.
      const cfg = isObject(task.config) ? task.config : {};
      if (typeof cfg.lessonTopic !== "string" || !cfg.lessonTopic.trim()) {
        // Fall back to taskset-level topic if available (validator is called pre-create)
        const taskTopic = typeof task.topicLabel === "string" ? task.topicLabel : "";
        if (!taskTopic) {
          errors.push("current-events requires config.lessonTopic (or task.topicLabel) so the resolver knows what to search for");
        }
      }
      // Resolver must NOT see a pre-cooked `resolved` block (the AI sometimes hallucinates one)
      if (cfg.resolved && typeof cfg.resolved === "object") {
        errors.push("current-events config.resolved must not be set at creation time — it's filled at runtime");
      }
      break;
    }

    case TASK_TYPES.HOLE_IN_ONE: {
      const cfg = isObject(task.config) ? task.config : {};
      if (!isObject(cfg.board)) {
        errors.push("hole-in-one requires config.board");
        break;
      }
      const w = Number(cfg.board.width);
      const h = Number(cfg.board.height);
      if (!(w >= 6 && w <= 30)) errors.push(`hole-in-one config.board.width must be 6-30 (got ${w})`);
      if (!(h >= 6 && h <= 30)) errors.push(`hole-in-one config.board.height must be 6-30 (got ${h})`);
      if (!isObject(cfg.board.startPosition) || !isObject(cfg.board.holePosition)) {
        errors.push("hole-in-one requires board.startPosition AND board.holePosition");
      }
      // Solvability heuristic: start ≠ hole, and not directly blocked by a board-spanning wall
      if (cfg.board.startPosition && cfg.board.holePosition) {
        const sx = Number(cfg.board.startPosition.x), sy = Number(cfg.board.startPosition.y);
        const hx = Number(cfg.board.holePosition.x), hy = Number(cfg.board.holePosition.y);
        if (sx === hx && sy === hy) errors.push("hole-in-one start and hole cannot be the same cell");
      }
      // questionBank drives the "earn" phase — without it the renderer
      // skips Earn entirely and the student can never buy rails. Require ≥ 3
      // questions; each must have a prompt + correctAnswer.
      if (!Array.isArray(cfg.questionBank) || cfg.questionBank.length < 3) {
        errors.push(`hole-in-one config.questionBank must have ≥ 3 questions (got ${Array.isArray(cfg.questionBank) ? cfg.questionBank.length : 0}) — without this the Earn phase is empty`);
      } else {
        cfg.questionBank.forEach((q, i) => {
          if (!q?.prompt) errors.push(`hole-in-one questionBank[${i}] missing prompt`);
          if (!q?.correctAnswer) errors.push(`hole-in-one questionBank[${i}] missing correctAnswer`);
        });
      }
      break;
    }

    case TASK_TYPES.CAREERS: {
      const cfg = isObject(task.config) ? task.config : {};
      const allowedModes = ["best-fit", "pathway-builder", "aptitude-match", "salary-vs-lifestyle", "who-should-be-hired", "career-myths"];
      if (!allowedModes.includes(cfg.mode)) {
        errors.push(`careers config.mode must be one of ${allowedModes.join("/")}`);
      }
      // Per-mode shape requirements
      if (cfg.mode === "best-fit" && (!cfg.career || typeof cfg.career !== "object")) {
        errors.push("careers best-fit requires config.career (object with name + description)");
      }
      if (cfg.mode === "pathway-builder" && (!Array.isArray(cfg.pathways) || cfg.pathways.length < 2)) {
        errors.push("careers pathway-builder requires at least 2 pathways");
      }
      if (cfg.mode === "who-should-be-hired" && (!Array.isArray(cfg.candidates) || cfg.candidates.length < 2)) {
        errors.push("careers who-should-be-hired requires at least 2 candidates");
      }
      if (cfg.mode === "salary-vs-lifestyle" && (!cfg.optionA || !cfg.optionB)) {
        errors.push("careers salary-vs-lifestyle requires both optionA and optionB");
      }
      if (cfg.mode === "career-myths" && (!Array.isArray(cfg.questions) || cfg.questions.length === 0)) {
        errors.push("careers career-myths requires at least one question");
      }
      if (cfg.mode === "aptitude-match" && (!Array.isArray(cfg.prompts) || cfg.prompts.length === 0)) {
        errors.push("careers aptitude-match requires at least one prompt");
      }
      // Anti-prestige-bias hint (soft) — flag absolute/elite framing in scenarios
      const prestigeRe = /\b(elite|prestigious|low.class|menial|just a |real career|real job)\b/i;
      const scan = (s) => typeof s === "string" && prestigeRe.test(s);
      if (scan(task.title) || scan(task.prompt) || scan(cfg?.career?.description)) {
        task._validationWarning = "careers task contains prestige-bias language; review for neutrality.";
      }
      break;
    }

    case TASK_TYPES.QUEST: {
      const cfg = isObject(task.config) ? task.config : {};
      if (typeof cfg.title !== "string" || !cfg.title.trim()) {
        errors.push("quest requires config.title (mission title)");
      }
      if (typeof cfg.scenario !== "string" || !cfg.scenario.trim()) {
        errors.push("quest requires config.scenario (narrative setup)");
      }
      if (!Array.isArray(cfg.objectives) || cfg.objectives.length === 0) {
        errors.push("quest requires at least one objective");
      } else {
        cfg.objectives.forEach((o, i) => {
          if (typeof o?.description !== "string" || !o.description.trim()) {
            errors.push(`quest objective[${i}] missing description`);
          }
        });
      }
      if (!Array.isArray(cfg.resources) || cfg.resources.length === 0) {
        errors.push("quest requires at least one resource");
      } else {
        cfg.resources.forEach((r, i) => {
          if (typeof r?.id !== "string" || !r.id.trim()) {
            errors.push(`quest resource[${i}] missing id`);
            return;
          }
          if (!Array.isArray(r.acquisitionOptions) || r.acquisitionOptions.length === 0) {
            errors.push(`quest resource[${i}] (${r.id}) must define at least one acquisitionOption`);
          }
        });
      }
      break;
    }

    case TASK_TYPES.WHAT_AM_I: {
      const cfg = isObject(task.config) ? task.config : {};

      if (typeof cfg.answer !== "string" || !cfg.answer.trim()) {
        errors.push("what-am-i requires config.answer (non-empty string)");
      }
      if (!Array.isArray(cfg.acceptableAnswers) || cfg.acceptableAnswers.length < 2) {
        errors.push("what-am-i requires config.acceptableAnswers (array of 2+ strings)");
      }
      if (!Array.isArray(cfg.clues) || cfg.clues.length < 3 || cfg.clues.length > 6) {
        errors.push(`what-am-i requires config.clues to have 3-6 entries (got ${Array.isArray(cfg.clues) ? cfg.clues.length : "none"})`);
      } else {
        // Each clue must be { level, text } with non-empty text
        cfg.clues.forEach((c, i) => {
          if (!c || typeof c !== "object") {
            errors.push(`what-am-i clue[${i}] must be an object`);
            return;
          }
          if (typeof c.text !== "string" || !c.text.trim()) {
            errors.push(`what-am-i clue[${i}].text must be a non-empty string`);
          }
          if (!Number.isFinite(Number(c.level))) {
            errors.push(`what-am-i clue[${i}].level must be a number`);
          }
        });

        // CRITICAL: no clue may contain the answer string (case-insensitive)
        const ans = (cfg.answer || "").trim().toLowerCase();
        if (ans) {
          const ansTokens = ans.split(/\s+/).filter((t) => t.length >= 4); // skip short common words
          cfg.clues.forEach((c, i) => {
            const text = String(c?.text || "").toLowerCase();
            if (text.includes(ans)) {
              errors.push(`what-am-i clue[${i}] contains the answer verbatim; clues must require inference`);
              return;
            }
            // Soft check: if a clue contains EVERY token of a multi-word answer, flag it
            if (ansTokens.length >= 2 && ansTokens.every((tok) => text.includes(tok))) {
              errors.push(`what-am-i clue[${i}] contains every token of the answer; rewrite to be more oblique`);
            }
          });
        }
      }

      const allowedDiff = ["easy", "medium", "hard", "expert"];
      if (!allowedDiff.includes(cfg.difficulty)) {
        errors.push(`what-am-i config.difficulty must be one of ${allowedDiff.join("/")}`);
      }
      const allowedMode = ["solo", "intra-team", "inter-team"];
      if (cfg.mode && !allowedMode.includes(cfg.mode)) {
        errors.push(`what-am-i config.mode must be one of ${allowedMode.join("/")}`);
      }

      // Self-check: the canonical answer must round-trip through the matcher.
      // (Catches edge cases where the answer field is missing or non-string.)
      if (typeof cfg.answer === "string" && cfg.answer.trim() && Array.isArray(cfg.acceptableAnswers) && cfg.acceptableAnswers.length > 0) {
        if (!_whatAmI_selfCheckAnswer(cfg)) {
          errors.push("what-am-i config.answer does not match itself via the matcher (likely empty or malformed)");
        }
      }

      // Sentence-shaped answer guardrail. A "What Am I?" answer should be a noun
      // phrase, not a sentence. Reject answers > 8 words OR containing sentence-
      // ending punctuation in the middle. Catches AI hallucinations like
      // "It is photosynthesis, the process plants use to make food."
      if (typeof cfg.answer === "string") {
        const wordCount = cfg.answer.trim().split(/\s+/).length;
        if (wordCount > 8) {
          errors.push(`what-am-i config.answer is too long (${wordCount} words) — answers must be a concept name (≤ 8 words), not a sentence`);
        }
        // Strip a trailing period when checking for INTERNAL sentence-ending punctuation.
        const middle = cfg.answer.trim().replace(/[.!?]+$/, "");
        if (/[.!?]\s+\w/.test(middle)) {
          errors.push("what-am-i config.answer reads like a full sentence; answers must be a concept name");
        }
      }
      break;
    }

    default:
      break;
  }

  // ✅ Global placeholder scan (type-aware via _placeholderErrorIfAny)
  const _phErr = _placeholderErrorIfAny(taskType, task);
  if (_phErr) errors.push(_phErr);

  return { ok: errors.length === 0, errors };
}

export function normalizeAndValidateTask(taskType, rawTask, opts = {}) {
  const { requirePlayable = false } = opts;

  // Canonicalize the type first (aliases!)
  const canonicalType = normalizeTaskType(taskType);

  const normalizedTask = normalizeTaskByType(canonicalType, rawTask);

  // keep the canonical type on the object too
  normalizedTask.taskType = canonicalType;

  const { errors } = validateTaskByType(canonicalType, normalizedTask);

  // Playability hardening
  if (requirePlayable) {
    const play = assessTaskPlayability(normalizedTask);
    if (!play.playable) errors.push(...play.issues.map((m) => `AI task not playable: ${m}`));
  }

  return { ok: errors.length === 0, errors, normalizedTask };
}

// Back-compat name used in some controllers
export function validateAiTask(taskType, rawTask) {
  return normalizeAndValidateTask(taskType, rawTask, { requirePlayable: true });
}
