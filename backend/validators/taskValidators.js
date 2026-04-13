// backend/validators/taskValidators.js
// Used by aiTasksetController (single-shot) and demoTasksetStreamController (streaming).

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { normalizeTaskType } from "../../shared/taskTypes.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

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
        : Array.isArray(task.config?.items)
        ? task.config.items
        : [];

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
        .filter((x) => x.prompt);

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

        // Try century phrases: (early 1700s), (mid-1800s), (late 1700s)
        const centuryMatch = hint.match(/\b(\d{4})s\b/);
        if (centuryMatch) {
          const base = parseInt(centuryMatch[1], 10);
          if (hint.includes("early")) return base + 15;
          if (hint.includes("late")) return base + 75;
          if (hint.includes("mid")) return base + 50;
          return base + 50;
        }

        // Try ordinal century: (18th century), (early 19th century)
        const ordCentury = hint.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/);
        if (ordCentury) {
          const base = (parseInt(ordCentury[1], 10) - 1) * 100;
          if (hint.includes("early")) return base + 15;
          if (hint.includes("late")) return base + 75;
          if (hint.includes("mid")) return base + 50;
          return base + 50;
        }

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

      // --- GUARDRAIL: Reject sequences/timelines with tied dates ---
      // When 2+ items resolve to the same date value, the "correct" order is
      // arbitrary and students get marked wrong for a defensible answer.
      if (!task._validationError && items.length >= 4) {
        const dv = items.map(extractDateValue);
        const seen = {};
        const ties = [];
        dv.forEach((v, i) => {
          if (v === null) return;
          if (seen[v] !== undefined) {
            // Only report the pair once
            if (!ties.some((t) => t.date === v)) {
              ties.push({ date: v, a: items[seen[v]], b: items[i] });
            }
          } else {
            seen[v] = i;
          }
        });
        if (ties.length > 0) {
          const desc = ties.map((t) => `"${t.a}" and "${t.b}" both resolve to ~${t.date}`).join("; ");
          task._validationError = `Sequence/timeline has items with identical or overlapping dates: ${desc}. Every item must have a distinct, unambiguous date so there is exactly one correct order.`;
        }
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

      prompts = prompts.map((p) => String(p || "").trim()).filter(Boolean);
      if (prompts.length < 2) prompts = ["Continue the chain with one sentence.", "Add a detail that changes the meaning."];

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
      if (seq.length > 5) seq = seq.slice(0, 5);

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
      if (items.length > 5) items = items.slice(0, 5);

      let order =
        cfg.correctOrder ?? task.correctOrder ??
        cfg.answerKey ?? task.answerKey ??
        cfg.correctAnswer ?? task.correctAnswer ??
        null;

      const n = items.length;
      if (!Array.isArray(order) || order.length !== n) order = Array.from({ length: n }, (_, i) => i);

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

      while (task.items.length < 4) {
        const i = task.items.length + 1;
        task.items.push({ id: `mm${i}`, text: `Concept ${i}` });
      }

      task.items = task.items.map((it) => asNonEmptyString(it.text, "")).map((s) => String(s).trim()).filter(Boolean);

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

        let bullets = Array.isArray(obj.bullets) ? obj.bullets : [];
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
      while (summary.length < 2) summary.push(`Summary point ${summary.length + 1}`);

      notes.keyTerms = keyTerms;
      notes.mainPoints = mainPoints;
      notes.summary = summary;

      task.notes = notes;

      // ✅ bullets should be >=3 and derived from summary (but not overwrite with summary accidentally)
      const bullets = Array.isArray(summary) ? [...summary] : [];
      while (bullets.length < 3) bullets.push(`Key takeaway ${bullets.length + 1}`);
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
              return { word, hint: hint || (word ? `Think about this ${word.length}-letter word` : "") };
            })
            .filter((x) => x.word)
        : [];

      // Trim to 8 if AI generated more (common: prompt says 10-16)
      if (cfg.wordsByStation.length > 8) cfg.wordsByStation = cfg.wordsByStation.slice(0, 8);

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
      } else {
        // Single-prompt format → convert to items[]
        const saPrompt = asNonEmptyString(task.prompt) || asNonEmptyString(task.question) || "";
        const saAns = _saAnswer(task);
        if (saPrompt && saAns) {
          task.items = [{ id: "q1", prompt: saPrompt, correctAnswer: saAns }];
        }
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
    case TASK_TYPES.MIME:
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
      } else {
        // Single-prompt fallback — also check alternate field names
        const saPrompt = _resolvePrompt(task);
        const saAns = _resolveAns(task);
        if (!saPrompt) errors.push("prompt required");
        // Missing correctAnswer is not a blocker — AI scoring can handle it
        // Auto-convert to items[] if we found a prompt
        if (saPrompt) {
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

    case TASK_TYPES.MATCHING: {
      if (!Array.isArray(task.leftItems) || task.leftItems.length < 5) errors.push("leftItems[] must have at least 5 items");
      if (!Array.isArray(task.rightItems) || task.rightItems.length < 5) errors.push("rightItems[] must have at least 5 items");
      if (!isObject(task.correctMatches) || Object.keys(task.correctMatches).length < 5) errors.push("correctMatches map must include at least 5 pairs");
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
        if (!isNonEmptyString(w?.hint)) errors.push("hangman-duel: each wordsByStation.hint must be non-empty");
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
      if (c4Stmts.length < 10) {
        errors.push(`true-false-connect-four requires at least 10 statements (got ${c4Stmts.length})`);
        break;
      }
      const badStmts = c4Stmts.filter((s) => !s?.text || typeof s.text !== "string" || !s.text.trim());
      if (badStmts.length > 0) {
        errors.push(`${badStmts.length} statement(s) have empty text`);
      }
      // Check for reasonable true/false balance (at least 30% each side)
      const falseCount = c4Stmts.filter((s) => s.isFalse).length;
      const trueCount = c4Stmts.length - falseCount;
      if (falseCount < 3 || trueCount < 3) {
        errors.push(`statements must include at least 3 true and 3 false (got ${trueCount} true, ${falseCount} false)`);
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

    // ─── Simple types: only need title + prompt (global checks cover these) ───
    case TASK_TYPES.OPEN_TEXT:
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
      const colRoles = task.config?.roles || [];
      if (!Array.isArray(colRoles) || colRoles.length < 2) errors.push("collaboration requires config.roles[] with at least 2 roles");
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
      if (!Array.isArray(nsCfg.prompts) || nsCfg.prompts.length < 2) errors.push("narration-synthesize requires config.prompts[] with at least 2 prompts");
      break;
    }

    case TASK_TYPES.PRONUNCIATION: {
      const prItems = Array.isArray(task.items) ? task.items : [];
      if (prItems.length < 3) errors.push("pronunciation requires at least 3 items");
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
      }
      if (!isNonEmptyString(rpCfg.scenario)) {
        errors.push("role-play-deck requires config.scenario (non-empty)");
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
