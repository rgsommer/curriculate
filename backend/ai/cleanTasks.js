// backend/ai/cleanTasks.js
// Stage 3: Clean/normalize AI-generated tasks into the internal Curriculate format.

/**
 * Roughly categorize subject so we can tweak behaviour a bit.
 */
function detectSubjectCategory(subject) {
  if (!subject) return "other";
  const s = subject.toLowerCase();

  if (
    s.includes("history") ||
    s.includes("new france") ||
    s.includes("british north america") ||
    s.includes("confederation") ||
    s.includes("war") ||
    s.includes("revolution")
  ) {
    return "history";
  }

  if (
    s.includes("science") ||
    s.includes("physics") ||
    s.includes("chemistry") ||
    s.includes("biology") ||
    s.includes("geology")
  ) {
    return "science";
  }

  if (
    s.includes("bible") ||
    s.includes("theology") ||
    s.includes("devotion")
  ) {
    return "bible";
  }

  if (
    s.includes("math") ||
    s.includes("algebra") ||
    s.includes("geometry") ||
    s.includes("statistics")
  ) {
    return "math";
  }

  if (s.includes("geography") || s.includes("global") || s.includes("world")) {
    return "geography";
  }

  return "other";
}

/**
 * Strip obvious hallucination / boilerplate patterns from prompts.
 */
function removeHallucinations(text) {
  if (!text) return "";

  let out = text.toString();

  // Remove URLs and obvious citation patterns
  out = out.replace(/https?:\/\/\S+/gi, "");
  out = out.replace(/\[\d+\]/g, "");
  out = out.replace(/\(\s*see.*?\)/gi, "");

  // Remove AI disclaimers
  out = out.replace(/as an ai (language )?model[, ]?/gi, "");
  out = out.replace(/i (cannot|can’t) (access|browse) the internet[, ]?/gi, "");

  // Remove double spaces created by removals
  out = out.replace(/\s{2,}/g, " ").trim();

  return out;
}

/**
 * Enforce tone/style and length constraints:
 * - Keep prompts readable
 * - Trim overly long text, but don't throw
 */
function sanitizePrompt(prompt, subjectCategory, gradeLevel) {
  if (!prompt) return "";

  let out = prompt.toString().trim();

  // Remove hallucination artifacts first
  out = removeHallucinations(out);

  // Soft caps instead of hard rejects
  const MAX_LENGTH = 450; // characters
  const MAX_WORDS = 80;   // words

  if (out.length > MAX_LENGTH) {
    out = out.slice(0, MAX_LENGTH);
  }

  const words = out.split(/\s+/);
  if (words.length > MAX_WORDS) {
    out = words.slice(0, MAX_WORDS).join(" ");
  }

  // Tone adjustments
  const grade = parseInt(gradeLevel, 10) || 7;
  if (grade <= 9) {
    out = out.replace(/\butilize\b/gi, "use");
    out = out.replace(/\btherefore\b/gi, "so");
    out = out.replace(/\bmoreover\b/gi, "also");
    out = out.replace(/\bin addition\b/gi, "also");
  }

  // Subject-specific tweaks (very light)
  if (subjectCategory === "bible") {
    out = out.replace(/\bmyth(s)?\b/gi, "account$1");
  }

  return out.trim();
}

/**
 * Normalize one task object into the internal format used by TaskSet.
 */
export function cleanTask(rawTask, context = {}) {
  if (!rawTask) return null;

  const {
    subject = "",
    gradeLevel = "7",
  } = context;

  const subjectCategory = detectSubjectCategory(subject);
  const grade = parseInt(gradeLevel, 10) || 7;

  const taskType =
    rawTask.taskType ||
    rawTask.type ||
    "open-text";

  const title =
    rawTask.title ||
    (rawTask.concept ? `Task: ${rawTask.concept}` : "Task");

  const prompt = sanitizePrompt(
    rawTask.prompt || rawTask.instructions || "",
    subjectCategory,
    grade
  );

  let options = Array.isArray(rawTask.options)
    ? rawTask.options.slice(0, 6)
    : [];
  options = options.map((opt) => sanitizePrompt(opt, subjectCategory, grade));

  let correctAnswer =
    rawTask.correctAnswer !== undefined
      ? rawTask.correctAnswer
      : rawTask.answer !== undefined
      ? rawTask.answer
      : null;

  let timeLimitSeconds =
    rawTask.timeLimitSeconds ??
    rawTask.recommendedTimeSeconds ??
    null;

  if (!timeLimitSeconds) {
    // Heuristic default by taskType
    const t = taskType.toLowerCase();
    if (t.includes("mc") || t.includes("choice")) {
      timeLimitSeconds = 60;
    } else if (t.includes("open") || t.includes("text")) {
      timeLimitSeconds = 150;
    } else if (t.includes("sequence") || t.includes("sort")) {
      timeLimitSeconds = 120;
    } else if (t.includes("body") || t.includes("move")) {
      timeLimitSeconds = 75;
    } else {
      timeLimitSeconds = 90;
    }
  }

  let points =
    rawTask.points ??
    rawTask.recommendedPoints ??
    null;

  if (!points) {
    const t = taskType.toLowerCase();
    if (t.includes("mc") || t.includes("choice")) {
      points = 10;
    } else if (t.includes("sequence") || t.includes("sort")) {
      points = 12;
    } else if (t.includes("body") || t.includes("move")) {
      points = 8;
    } else if (t.includes("make") || t.includes("draw") || t.includes("photo")) {
      points = 12;
    } else {
      points = 10;
    }
  }

  return {
    title,
    prompt,
    taskType,
    options,
    correctAnswer,
    timeLimitSeconds,
    points,
  };
}

/**
 * Clean a list of tasks.
 */
export function cleanTaskList(rawTasks, context = {}) {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  return list
    .map((t) => cleanTask(t, context))
    .filter(Boolean);
}
