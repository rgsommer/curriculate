// backend/ai/cleanTasks.js
// Modern cleaner for AI-generated tasks.
// Keeps tasks intact but enforces safety, removes obvious hallucinations,
// and nudges tone toward age-appropriate, subject-aware language.

/**
 * Roughly categorize subject so we can tweak behaviour a bit.
 */
function detectSubjectCategory(subject) {
  if (!subject) return "other";
  const s = subject.toLowerCase();

  if (s.includes("history") || s.includes("new france") || s.includes("british north america") || s.includes("confederation")) {
    return "history";
  }
  if (s.includes("science") || s.includes("physics") || s.includes("chemistry") || s.includes("biology")) {
    return "science";
  }
  if (s.includes("bible") || s.includes("scripture") || s.includes("theology") || s.includes("gospel")) {
    return "bible";
  }
  if (s.includes("geography")) {
    return "geography";
  }
  return "other";
}

/**
 * Remove obvious hallucination artifacts:
 * - Raw URLs
 * - "see figure X" / "as shown above" references
 * - bracketed citations like [1], [2], or (Smith, 2020)
 * - "As an AI language model..." disclaimers
 */
function removeHallucinations(text) {
  let out = text;

  // Strip URLs
  out = out.replace(/\bhttps?:\/\/\S+/gi, "");
  out = out.replace(/\bwww\.\S+/gi, "");

  // Remove simple numeric citations [1], [2], etc.
  out = out.replace(/\[\s*\d+\s*\]/g, "");

  // Remove common academic-style citations (Smith, 2020)
  out = out.replace(/\(\s*[A-Z][A-Za-z]+,\s*\d{4}\s*\)/g, "");

  // Remove "see figure X", "see table 1"
  out = out.replace(/\bsee (figure|fig\.|table)\s*\d+\b/gi, "");

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
 * - Trim overly long text, but don't throw tasks away
 * - Light touch on subject-specific tweaks
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
  // - Avoid overly academic phrases for mid-school grades
  const grade = parseInt(gradeLevel, 10) || 7;
  if (grade <= 9) {
    out = out.replace(/\butilize\b/gi, "use");
    out = out.replace(/\btherefore\b/gi, "so");
    out = out.replace(/\bmoreover\b/gi, "also");
  }

  // Subject-specific gentle tweaks
  if (subjectCategory === "bible") {
    // Avoid weirdly flippant language in Bible prompts
    out = out.replace(/\bOMG\b/gi, "Oh my");
    // Make sure "god" is capitalized when clearly referencing God
    out = out.replace(/\bgod\b/g, "God");
  }

  if (subjectCategory === "science") {
    // Avoid "magical" language for mechanisms
    out = out.replace(/\bmagical\b/gi, "remarkable");
  }

  if (subjectCategory === "history") {
    // Nudge toward time language
    if (!/when\b|during\b|in the year\b|timeline\b/gi.test(out)) {
      // no-op for now: we could add more, but keep it light
    }
  }

  // Remove trailing weird punctuation from aggressive cleaning
  out = out.replace(/\s+[,;:.!?]$/, (m) => m.trim().slice(-1));

  return out.trim();
}

export function cleanTask(raw, context = {}) {
  if (!raw) return null;

  const { subject, gradeLevel } = context;
  const subjectCategory = detectSubjectCategory(subject);

  const originalPrompt = (raw.prompt || "").toString();
  const prompt = sanitizePrompt(originalPrompt, subjectCategory, gradeLevel);

  if (!prompt) return null;

  // Keep AI-chosen type if present
  const taskType = raw.taskType || raw.type || "short-answer";

  // Ensure points are in reasonable range
  let points = parseInt(
    raw.points ?? raw.recommendedPoints ?? 10,
    10
  );
  if (!Number.isFinite(points)) points = 10;
  points = Math.max(1, Math.min(20, points));

  // Ensure time is sane
  let time = parseInt(
    raw.timeLimitSeconds ?? raw.recommendedTimeSeconds ?? 60,
    10
  );
  if (!Number.isFinite(time)) time = 60;
  time = Math.max(20, Math.min(300, time));

  // Options: keep valid arrays only
  const options = Array.isArray(raw.options) ? raw.options : [];

  // Correct answer: keep index or string if valid;
  // do not attempt heavy corrections here – that’s done in aiTasksets.js
  const correctAnswer = raw.correctAnswer ?? null;

  return {
    ...raw, // preserve: title, taskId, orderIndex, displayKey, linear, etc.
    prompt,
    taskType,
    points,
    timeLimitSeconds: time,
    options,
    correctAnswer,
  };
}

export function cleanTaskList(rawTasks, context = {}) {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  return list
    .map((t) => cleanTask(t, context))
    .filter(Boolean);
}

export default {
  cleanTask,
  cleanTaskList,
};
