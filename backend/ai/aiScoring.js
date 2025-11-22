import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.AI_SCORING_MODEL || "gpt-5.1";

/**
 * Build a human-readable description of what the student submitted.
 * For now, we handle text-based answers (open-text); later we can
 * add branches for audio transcripts, images, captions, etc.
 */
function buildStudentWorkDescription(task, submission) {
  const taskType = task.taskType || task.type;

  if (taskType === "open-text") {
    const text = submission.answerText || "";
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

  const studentWorkDescription = buildStudentWorkDescription(task, submission);

  const systemPrompt = `
You are an assistant helping a Grade 7–8 history teacher score student work.

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

  const response = await openai.responses.create({
    model: DEFAULT_MODEL,
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.output[0]?.content[0]?.text || "{}";
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
 * Backwards-compatibility wrapper.
 * Some parts of the code import { generateAIScore }.
 * This simply calls scoreSubmissionWithAI with the same args.
 */
export async function generateAIScore(args) {
  return scoreSubmissionWithAI(args);
}
