// backend/ai/aiScoring.js

import OpenAI from "openai";
import { TASK_TYPE_META, TASK_TYPES } from "../../shared/taskTypes.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.AI_SCORING_MODEL || "gpt-5.1";

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build a human-readable description of what the student submitted.
 * For AI scoring only – not used for instant scoring.
 */
function buildStudentWorkDescription(task, submission) {
  const taskType = task.taskType || task.type;

  // Multiple-choice / True-False
  if (
    taskType === TASK_TYPES.MULTIPLE_CHOICE ||
    taskType === TASK_TYPES.TRUE_FALSE
  ) {
    const options = Array.isArray(task.options) ? task.options : [];
    const idx =
      submission.answerIndex ??
      submission.selectedIndex ??
      submission.selectedOptionIndex ??
      null;

    const chosen =
      idx != null && options[idx] != null
        ? options[idx]
        : submission.answerText || submission.raw || "(no answer)";

    return `The student selected option index ${idx} with text:\n"${chosen}"`;
  }

  // Short answer
  if (taskType === TASK_TYPES.SHORT_ANSWER) {
    const text =
      submission.answerText ||
      submission.text ||
      submission.raw ||
      "(no answer)";
    return `The student wrote the following response:\n\n"${text}"`;
  }

  // Photo / Make-and-snap: usually we only have a caption or filename
  if (
    taskType === TASK_TYPES.PHOTO ||
    taskType === TASK_TYPES.MAKE_AND_SNAP
  ) {
    const caption =
      submission.caption ||
      submission.answerText ||
      submission.text ||
      "";
    return `The student submitted a photo. Caption/notes:\n"${caption}"`;
  }

  // Fallback
  const text = submission.answerText || submission.text || "";
  return `Raw submission:\n${JSON.stringify(
    { answerText: text, ...submission },
    null,
    2
  )}`;
}

/**
 * Try to score deterministically (no AI) using correctAnswer + metadata.
 * Returns a rubric-shaped result or null if we can't handle it.
 */
function scoreObjectivelyIfPossible({ task, submission, rubric }) {
  const taskType = task.taskType || task.type;
  const meta = TASK_TYPE_META[taskType] || {};

  // Respect aiScoringRequired
  const aiRequired =
    typeof task.aiScoringRequired === "boolean"
      ? task.aiScoringRequired
      : meta.defaultAiScoringRequired ?? false;

  if (aiRequired) return null;

  const correct = task.correctAnswer;
  if (correct == null) return null;

  // Determine max points (prefer rubric, else task.points)
  const maxPointsFromRubric =
    rubric && typeof rubric.maxPoints === "number"
      ? rubric.maxPoints
      : null;
  const maxPoints =
    maxPointsFromRubric ??
    (typeof task.points === "number" ? task.points : 1);

  let isCorrect = null;

  if (
    taskType === TASK_TYPES.MULTIPLE_CHOICE ||
    taskType === TASK_TYPES.TRUE_FALSE
  ) {
    // Index-based comparison
    const idx =
      submission.answerIndex ??
      submission.selectedIndex ??
      submission.selectedOptionIndex ??
      null;

    if (typeof idx === "number") {
      isCorrect = idx === correct;
    }
  } else if (taskType === TASK_TYPES.SHORT_ANSWER) {
    const student = normalizeText(
      submission.answerText || submission.text || ""
    );

    if (Array.isArray(correct)) {
      const targets = correct.map(normalizeText);
      isCorrect = targets.includes(student);
    } else if (typeof correct === "string") {
      isCorrect = normalizeText(correct) === student;
    }
  }

  if (isCorrect == null) {
    // We couldn't confidently score this – fall back to AI
    return null;
  }

  const score = isCorrect ? maxPoints : 0;

  return {
    totalScore: score,
    maxPoints,
    criteria: [
      {
        id: "auto",
        score,
        maxPoints,
        comment: isCorrect
          ? "Automatically marked correct based on the stored answer."
          : "Automatically marked incorrect based on the stored answer.",
      },
    ],
    overallComment: isCorrect
      ? "Correct – scored instantly using the stored answer."
      : "Incorrect – scored instantly using the stored answer.",
    aiUsed: false,
  };
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

  const studentWorkDescription = buildStudentWorkDescription(task, submission);

  const systemPrompt = `
You are an assistant helping a Grade 7–8 teacher score student work.

Always:
- Use the rubric provided.
- Give partial credit when a criterion is partially met.
- Be generous but honest, and avoid being overly strict about spelling, grammar, or accents.
- Return ONLY valid JSON in the exact structure requested, with no extra commentary.
`;

  const userPrompt = `
Here is the grading rubric (JSON):

${JSON.stringify(rubric, null, 2)}

Here is the task the student was given:

${task.prompt || ""}

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
`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0, // deterministic scoring
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

  return { ...parsed, aiUsed: true };
}

/**
 * Main entry point: try instant scoring first, then fall back to AI.
 *
 * Args: { task, rubric, submission }
 */
export async function scoreSubmission(args) {
  const instant = scoreObjectivelyIfPossible(args);
  if (instant) return instant;
  // Fall back to rubric-based AI scoring
  return scoreSubmissionWithAI(args);
}

/**
 * Backwards-compatibility wrapper.
 * Some parts of the code import { generateAIScore }.
 * This simply calls scoreSubmissionWithAI with the same args.
 */
export async function generateAIScore(args) {
  return scoreSubmissionWithAI(args);
}
