// backend/ai/cleanTasks.js
// Utility to clean and filter AI-generated tasks before saving.

export function cleanTask(raw) {
  if (!raw || !raw.prompt) return null;

  let prompt = String(raw.prompt || "").trim();
  if (!prompt) return null;

  // Hard cap on characters / words to avoid huge "word salad" prompts
  if (prompt.length > 260) return null;
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount > 45) return null;

  const taskType = raw.taskType || raw.type || "short-answer";
  let points = parseInt(raw.points, 10);
  if (!Number.isFinite(points) || points <= 0) points = 10;

  const options = Array.isArray(raw.options) ? raw.options : [];

  return {
    prompt,
    taskType,
    points,
    options,
    correctAnswer: raw.correctAnswer || null,
    timeLimitSeconds: raw.timeLimitSeconds || null,
  };
}

export function cleanTaskList(rawTasks) {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  const cleaned = list.map(cleanTask).filter(Boolean);
  return cleaned;
}

export default {
  cleanTask,
  cleanTaskList,
};
