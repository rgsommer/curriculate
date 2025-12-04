// backend/ai/aiScoring.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.AI_SCORING_MODEL || "gpt-5.1";

/**
 * Try to infer the student's "answer" value from a submission object.
 * Supports several shapes for backwards compatibility.
 */
function extractStudentAnswer(submission = {}) {
  if (submission == null || typeof submission !== "object") return null;

  // Most likely fields first
  if (typeof submission.answerIndex === "number") return submission.answerIndex;
  if (typeof submission.selectedIndex === "number") return submission.selectedIndex;
  if (typeof submission.selectedOptionIndex === "number") {
    return submission.selectedOptionIndex;
  }
  if (typeof submission.choiceIndex === "number") return submission.choiceIndex;
  if (typeof submission.answer === "number" || typeof submission.answer === "string") {
    return submission.answer;
  }

  // Open-text style
  if (typeof submission.answerText === "string") return submission.answerText;

  return null;
}

/**
 * Objective / rule-based scoring for tasks that have a correctAnswer baked in
 * and do NOT require AI scoring.
 *
 * Returns the same shape as AI scoring:
 * {
 *   totalScore,
 *   maxPoints,
 *   criteria: [{ id, score, maxPoints, comment }],
 *   overallComment
 * }
 */
export function scoreSubmissionRuleBased({ task, submission }) {
  const safeTask = task || {};
  const safeSubmission = submission || {};

  const maxPoints =
    typeof safeTask.points === "number" && safeTask.points > 0
      ? safeTask.points
      : 1;

  const correctAnswer = safeTask.correctAnswer;
  const studentAnswer = extractStudentAnswer(safeSubmission);

  let isCorrect = false;
  let explanation = "";

  // If correctAnswer is a number → index-based (MC / True-False)
  if (typeof correctAnswer === "number") {
    const studentIndex =
      typeof studentAnswer === "number"
        ? studentAnswer
        : Number.isInteger(Number(studentAnswer))
        ? Number(studentAnswer)
        : null;

    if (
      studentIndex != null &&
      Array.isArray(safeTask.options) &&
      studentIndex >= 0 &&
      studentIndex < safeTask.options.length
    ) {
      isCorrect = studentIndex === correctAnswer;
      explanation = isCorrect
        ? "Selected option matches the correct answer."
        : "Selected option does not match the correct answer.";
    } else {
      isCorrect = false;
      explanation = "Student did not provide a valid option index.";
    }
  }
  // If correctAnswer is a string → short-answer style
  else if (typeof correctAnswer === "string") {
    const correct = correctAnswer.trim().toLowerCase();
    const studentText =
      typeof studentAnswer === "string"
        ? studentAnswer.trim().toLowerCase()
        : typeof studentAnswer === "number"
        ? String(studentAnswer)
        : "";

    if (!correct || !studentText) {
      isCorrect = false;
      explanation = "Missing or empty answer.";
    } else {
      // Basic normalization: trim + lower-case; allow simple equality
      // (You can later expand with synonyms or fuzzy matching.)
      isCorrect = studentText === correct;
      explanation = isCorrect
        ? "Student response matches the reference answer."
        : `Expected "${correctAnswer}", but got "${studentAnswer ?? ""}".`;
    }
  } else {
    // We don't know how to auto-score this task
    isCorrect = false;
    explanation =
      "This task is not configured for automatic scoring (no correctAnswer).";
  }

  const totalScore = isCorrect ? maxPoints : 0;

  return {
    totalScore,
    maxPoints,
    criteria: [
      {
        id: "correctness",
        score: totalScore,
        maxPoints,
        comment: explanation,
      },
    ],
    overallComment: isCorrect
      ? "Correct."
      : `Incorrect. ${explanation || "Review this concept with the student."}`,
  };
}

/**
 * Build a human-readable description of what the student submitted.
 * For now, we handle text-based answers (open-text); later we can
 * add branches for audio transcripts, images, captions, etc.
 */
function buildStudentWorkDescription(task, submission) {
  const taskType = task?.taskType || task?.type;

  if (taskType === "open-text" || taskType === "short-answer") {
    const text =
      submission?.answerText ??
      (typeof submission?.answer === "string" ? submission.answer : "") ??
      "";
    return `The student wrote the following response:\n\n"${text}"`;
  }

  // Future:
  // if (taskType === "record-audio") {... use transcript ...}
  // if (taskType === "make-and-snap" || taskType === "draw") {... use image description + OCR ...}

  // Fallback
  return `Raw submission:\n${JSON.stringify(submission, null, 2)}`;
}

/**
 * Ask the model to score a submission according to a rubric.
 *
 * Returns:
 * {
 *   totalScore: number,
 *   maxPoints: number,
 *   criteria: [{ id, score, maxPoints, comment }],
 *   overallComment: string
 * }
 */
export async function scoreSubmissionWithAI({ task, rubric, submission }) {
  if (!rubric || !rubric.criteria || rubric.criteria.length === 0) {
    throw new Error("Missing rubric for AI scoring");
  }

  const studentWorkDescription = buildStudentWorkDescription(task || {}, submission || {});

  const systemPrompt = `
You are an assistant helping a Grade 7–8 teacher score student work.

Always:
- Use the rubric provided.
- Give partial credit when a criterion is partially met.
- Be generous but honest, and avoid being overly strict about spelling, grammar, or accents.
- Return ONLY valid JSON in the exact structure requested, with no extra commentary.
`.trim();

  const userPrompt = `
Here is the grading rubric (JSON):

${JSON.stringify(rubric, null, 2)}

Here is the task the student was given:

${(task && task.prompt) || ""}

Here is the student's work:

${studentWorkDescription}

Score the work according to the rubric. For each criterion, assign a score from 0 up to maxPoints. Then compute the total score (sum of criteria) and ensure it does not exceed rubric.maxPoints.

Return ONLY JSON in this format:

{
  "totalScore": number,
  "maxPoints": number,
  "criteria": [
    {
      "id": string,
      "score": number,
      "maxPoints": number,
      "comment": string
    }
  ],
  "overallComment": string
}
`.trim();

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0, // scoring should be deterministic
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content?.trim() || "{}";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("AI scoring JSON parse error:", err, content);
    throw new Error("Failed to parse AI scoring response");
  }

  return parsed;
}

/**
 * Backwards-compatible entry point.
 *
 * Anywhere that calls generateAIScore({ task, rubric, submission })
 * will now:
 *  - Use rule-based scoring if task.aiScoringRequired === false AND a correctAnswer exists.
 *  - Otherwise fall back to AI scoring with rubric.
 */
export async function generateAIScore({ task, rubric, submission }) {
  const safeTask = task || {};

  const hasCorrect =
    safeTask.correctAnswer !== undefined && safeTask.correctAnswer !== null;

  const requiresAI =
    typeof safeTask.aiScoringRequired === "boolean"
      ? safeTask.aiScoringRequired
      : !hasCorrect; // default: if we don't have a correctAnswer, we need AI

  if (!requiresAI && hasCorrect) {
    // Instant objective scoring
    return scoreSubmissionRuleBased({ task: safeTask, submission });
  }

  // Fallback to AI + rubric
  return scoreSubmissionWithAI({ task: safeTask, rubric, submission });
}
