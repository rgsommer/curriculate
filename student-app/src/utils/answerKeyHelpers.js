// student-app/src/utils/answerKeyHelpers.js
import { TASK_TYPES } from "../../../shared/taskTypes.js";

/**
 * Determine if a task uses objective scoring
 */
export const isObjectiveTask = (task) => {
  if (!task) return false;

  // explicit flags
  if (task.objectiveScoring === true) return true;
  if (task?.config?.objectiveScoring === true) return true;

  // common "no AI" marker in this project
  if (task.aiScoringRequired === false) return true;

  // heuristic: objective task types usually ship correct answers/config
  const t = task.taskType || task.type;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  // Items can live at task.items OR task.config.items (AI generator uses config.items)
  const items = Array.isArray(task.items) && task.items.length > 0
    ? task.items
    : (Array.isArray(cfg.items) ? cfg.items : []);
  const hasItemCorrect = items.some(
    (it) => it && (it.correctAnswer !== undefined || it.correctIndex !== undefined || it.referenceAnswer)
  );
  const hasTopCorrect = task.correctAnswer !== undefined && task.correctAnswer !== null;
  const hasSortConfig =
    Array.isArray(cfg.buckets) &&
    cfg.buckets.length >= 2 &&
    Array.isArray(cfg.items) &&
    cfg.items.length >= 2 &&
    cfg.items.some((it) => typeof it?.bucketIndex === "number");
  const hasSeqConfig = Array.isArray(cfg.items) && cfg.items.length >= 2;

  const objectiveTypes = new Set([
    TASK_TYPES.TRUE_FALSE,
    TASK_TYPES.MULTIPLE_CHOICE,
    TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE,
    TASK_TYPES.SHORT_ANSWER,
    TASK_TYPES.SORT,
    TASK_TYPES.SEQUENCE,
    TASK_TYPES.TIMELINE,
    TASK_TYPES.MATCHING,
    TASK_TYPES.VENNSORT,
  ]);

  if (objectiveTypes.has(t) && (hasItemCorrect || hasTopCorrect || hasSortConfig || hasSeqConfig))
    return true;

  // scoringMode string fallback
  if (task.scoringMode && String(task.scoringMode).toLowerCase().includes("objective"))
    return true;

  return false;
};

/**
 * Extract the prompt/question from an item
 */
export const getItemPrompt = (item, idx) => {
  const raw =
    item?.prompt ??
    item?.question ??
    item?.label ??
    item?.stem ??
    item?.text ??
    item?.title ??
    item?.description ??
    "";
  const s = typeof raw === "string" ? raw.trim() : String(raw || "").trim();
  return s || `Question ${idx + 1}`;
};

/**
 * Convert a true/false value to "True" or "False" string
 */
export const tfCorrectToText = (val) => {
  // supports: boolean, "true"/"false", 0/1, "0"/"1"
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "number") return val === 1 ? "True" : "False";
  const s = String(val ?? "").trim().toLowerCase();
  if (s === "true") return "True";
  if (s === "false") return "False";
  if (s === "1") return "True";
  if (s === "0") return "False";
  return "";
};

/**
 * Build an answer key object from task data
 * Returns an object with title and answer rows, or null if no key can be built
 */
export const buildObjectiveAnswerKey = (task) => {
  if (!task) return null;

  const taskType = task.taskType || task.type;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  // Items can live at task.items OR task.config.items (AI generator uses config.items)
  const items = Array.isArray(task.items) && task.items.length > 0
    ? task.items
    : (Array.isArray(cfg.items) ? cfg.items : []);

  // --- TRUE/FALSE ---
  if (taskType === TASK_TYPES.TRUE_FALSE) {
    if (items.length) {
      return {
        title: "Answer key",
        rows: items.map((it, idx) => ({
          q: getItemPrompt(it, idx),
          a: tfCorrectToText(it?.correctAnswer) || "(missing correct answer)",
        })),
      };
    }
    // single TF fallback
    const single = tfCorrectToText(task.correctAnswer);
    if (single) {
      return {
        title: "Answer key",
        rows: [{ q: task.prompt || "True/False", a: single }],
      };
    }
  }

  // --- MULTIPLE CHOICE ---
  if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
    if (items.length) {
      return {
        title: "Answer key",
        rows: items.map((it, idx) => {
          const opts = Array.isArray(it.options) ? it.options : [];
          // AI generator uses correctIndex; legacy uses correctAnswer
          const c = it.correctAnswer ?? it.correctIndex;
          let correctText = "";
          if (typeof c === "number") correctText = opts[c] ?? "";
          else if (typeof c === "string") correctText = c;
          return { q: getItemPrompt(it, idx), a: String(correctText || "").trim() || "(missing correct answer)" };
        }),
      };
    }

    // single MC fallback
    const opts = Array.isArray(task.options) ? task.options : [];
    const c = task.correctAnswer;
    const correctText =
      typeof c === "number" ? opts[c] ?? "" : typeof c === "string" ? c : "";
    if (correctText) {
      return {
        title: "Answer key",
        rows: [{ q: task.prompt || "Multiple choice", a: String(correctText).trim() }],
      };
    }
  }

  // --- SHORT ANSWER ---
  if (taskType === TASK_TYPES.SHORT_ANSWER) {
    if (items.length) {
      return {
        title: "Suggested answers",
        rows: items.map((it, idx) => ({
          q: getItemPrompt(it, idx),
          a: String(it.referenceAnswer ?? it.answer ?? it.expected ?? "").trim() || "(no reference answer)",
        })),
      };
    }
    const ref = String(task.referenceAnswer ?? "").trim();
    if (ref) {
      return { title: "Suggested answer", rows: [{ q: task.prompt || "Short answer", a: ref }] };
    }
  }

  // --- SORT / CATEGORIZE ---
  if (taskType === TASK_TYPES.SORT) {
    const cfg = task.config && typeof task.config === "object" ? task.config : {};
    const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
    const sortItems = Array.isArray(cfg.items) ? cfg.items : [];

    if (buckets.length && sortItems.length) {
      const grouped = buckets.map((b) => ({ bucket: String(b || "").trim(), items: [] }));
      const unassigned = [];

      sortItems.forEach((it) => {
        const text = String(it?.text ?? it ?? "").trim();
        if (!text) return;
        const bi = it?.bucketIndex;
        if (typeof bi === "number" && bi >= 0 && bi < grouped.length) grouped[bi].items.push(text);
        else unassigned.push(text);
      });

      return {
        title: "Correct categories",
        buckets: grouped.filter((g) => g.bucket),
        unassigned,
      };
    }
  }

  // --- SEQUENCE / TIMELINE ---
  if (taskType === TASK_TYPES.SEQUENCE || taskType === TASK_TYPES.TIMELINE) {
    const cfg = task.config && typeof task.config === "object" ? task.config : {};
    const seq = Array.isArray(cfg.items) ? cfg.items : [];
    if (seq.length) {
      return {
        title: "Correct order",
        ordered: seq.map((it, idx) => ({
          n: idx + 1,
          text: String(it?.text ?? it ?? "").trim() || `Step ${idx + 1}`,
        })),
      };
    }
  }
  return null;
};
