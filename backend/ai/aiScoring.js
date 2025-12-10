import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.AI_SCORING_MODEL || "gpt-4o-mini";

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

  // Some tasks may embed the final answer in "value"
  if (submission.value !== undefined) return submission.value;

  // Older or alternate shapes
  if (typeof submission.choice === "number") return submission.choice;
  if (typeof submission.optionIndex === "number") return submission.optionIndex;

  // Direct "answer"
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
 *   totalScore: number,
 *   maxPoints: number,
 *   criteria: [{ id, score, maxPoints, comment }],
 *   overallComment: string
 * }
 */
function scoreSubmissionRuleBased({ task, submission }) {
  const maxPoints = typeof task.points === "number" ? task.points : 10;
  const correctAnswer = task.correctAnswer;
  const studentAnswer = extractStudentAnswer(submission);

  let isCorrect = false;
  let explanation = "";

  if (correctAnswer === undefined || correctAnswer === null) {
    // No reference answer → cannot objectively score
    isCorrect = false;
    explanation = "No correctAnswer is configured for this task.";
  } else if (studentAnswer == null) {
    isCorrect = false;
    explanation = "Student did not submit an answer.";
  } else if (
    typeof correctAnswer === "number" ||
    typeof correctAnswer === "boolean"
  ) {
    // Numeric / boolean exact equality
    isCorrect = Number(studentAnswer) === Number(correctAnswer);
    explanation = isCorrect
      ? "Student answer matches the required value."
      : `Expected ${correctAnswer}, but got ${studentAnswer}.`;
  } else if (typeof correctAnswer === "string") {
    const studentText = String(studentAnswer).trim().toLowerCase();
    const correct = correctAnswer.trim().toLowerCase();

    if (!studentText) {
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
    overallComment: explanation,
  };
}

/**
 * Build a human-readable description of the student's work, so the AI
 * can "see" what the student did without dumping raw JSON.
 */
function buildStudentWorkDescription(task, submission) {
  const taskType = task?.taskType || task?.type;

  // Open text / short-answer
  if (taskType === "open-text" || taskType === "short-answer") {
    const text =
      submission?.answerText ??
      (typeof submission?.answer === "string" ? submission.answer : "") ??
      "";
    return `The student wrote the following response:\n\n"${text}"`;
  }

  // Draw / Mime / Draw-Mime → do NOT dump raw base64 image data
  if (
    taskType === "draw" ||
    taskType === "mime" ||
    taskType === "draw-mime" ||
    taskType === "draw_mime"
  ) {
    const note =
      submission?.answerText ??
      (typeof submission?.caption === "string" ? submission.caption : "") ??
      "";

    let desc =
      "The student completed a visual or performance task (drawing or miming). " +
      "You cannot see the actual image or performance, but you can see their note or caption, if any.\n\n";

    if (note) {
      desc += `Student note/caption:\n"${note}"`;
    } else {
      desc += "The student did not provide any written note or caption.";
    }
    return desc;
  }

  // Diff Detective: text or code differences
  if (taskType === "diff-detective" || taskType === "diff_detective") {
    const mode = task.mode || "text";
    const found = Array.isArray(submission?.foundDiffs)
      ? submission.foundDiffs.length
      : submission?.foundCount ?? 0;
    const total = task.targetDifferences
      ? task.targetDifferences.length
      : task.totalDifferences ?? task.differences?.length ?? "unknown";

    return (
      `This is a Diff Detective task in "${mode}" mode.\n` +
      `The student reported finding approximately ${found} differences out of ${total}.\n\n` +
      `Raw submission object:\n${JSON.stringify(submission, null, 2)}`
    );
  }

  // Motion Mission: body movement / steps
  if (taskType === "motion-mission" || taskType === "motion_mission") {
    const rawCount = submission?.stepCount ?? submission?.motionCount;
    const steps = typeof rawCount === "number" ? rawCount : "unknown";

    return (
      "This is a Motion Mission task where students had to move their bodies (e.g., steps, jumps, actions).\n" +
      `The recorded movement count for this submission is: ${steps}.\n\n` +
      "Additional raw submission:\n" +
      JSON.stringify(submission, null, 2)
    );
  }

  // Pet Feeding: scoreboard-style data
  if (taskType === "pet-feeding" || taskType === "pet_feeding") {
    const totalFed = submission?.totalFed ?? submission?.score ?? null;
    return (
      "This is a Pet Feeding / virtual pet task, where students keep a digital pet fed or cared for.\n" +
      (totalFed != null
        ? `The student's recorded feeding / care score is: ${totalFed}.\n\n`
        : "") +
      "Raw submission data:\n" +
      JSON.stringify(submission, null, 2)
    );
  }

  // Pronunciation / speaking tasks might use "transcript"
  if (taskType === "pronunciation" || taskType === "speaking") {
    const transcript =
      submission?.transcript ??
      submission?.answerText ??
      submission?.answer ??
      "";
    return (
      "This is a speaking/pronunciation task. The student's spoken answer has been transcribed as follows:\n\n" +
      `"${transcript}"`
    );
  }

  // Collaboration tasks
  if (taskType === "collaboration") {
    const main =
      submission?.answerText ??
      submission?.answer ??
      "";

    const reply =
      submission?.reply ??
      submission?.partnerReply ??
      "";

    const partner =
      submission?.partnerAnswer ??
      "";

    let description = `This is a pair collaboration task.\n\n` +
      `Student's main answer:\n"${main || "(no main answer)"}"`;

    if (partner) {
      description += `\n\nPartner's answer they were responding to:\n"${partner}"`;
    }

    if (reply) {
      description += `\n\nStudent's reply to their partner:\n"${reply}"`;
    }

    return description;
  }

  // Make & Snap - creative build + photo tasks
  if (taskType === "make-and-snap" || taskType === "make_and_snap") {
    const text =
      submission?.answerText ??
      (typeof submission?.answer === "string" ? submission.answer : "") ??
      "";

    const note =
      text && typeof text === "string"
        ? text
        : "(no written note was provided; only a photo indicator, if any).";

    return (
      'This was a "Make & Snap" creative task. ' +
      "The student built, drew, or demonstrated something at a station and then took a photo of it. " +
      "You cannot see the actual image from here, but you can see any written note or description they provided.\n\n" +
      `Student note / description:\n"${note}"`
    );
  }

  // Fallback for other types
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

  const userPrompt = JSON.stringify(
    {
      rubric,
      task: {
        title: task.title ?? task.name ?? null,
        instructions: task.prompt ?? task.description ?? null,
        taskType: task.taskType ?? task.type ?? null,
        maxPoints: typeof task.points === "number" ? task.points : undefined,
      },
      submission: {
        description: studentWorkDescription,
        raw: submission,
      },
      responseSchema: {
        type: "object",
        properties: {
          totalScore: { type: "number" },
          maxPoints: { type: "number" },
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                score: { type: "number" },
                maxPoints: { type: "number" },
                comment: { type: "string" },
              },
              required: ["id", "score", "maxPoints"],
            },
          },
          overallComment: { type: "string" },
        },
        required: ["totalScore", "maxPoints", "criteria"],
      },
    },
    null,
    2
  );

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

  const maxPoints =
    typeof parsed.maxPoints === "number"
      ? parsed.maxPoints
      : typeof task.points === "number"
      ? task.points
      : rubric.totalPoints ?? 10;

  const totalScore =
    typeof parsed.totalScore === "number"
      ? parsed.totalScore
      : Array.isArray(parsed.criteria)
      ? parsed.criteria.reduce(
          (sum, c) => sum + (typeof c.score === "number" ? c.score : 0),
          0
        )
      : 0;

  const criteria = Array.isArray(parsed.criteria)
    ? parsed.criteria.map((c, idx) => ({
        id: c.id ?? rubric.criteria[idx]?.id ?? `criterion_${idx + 1}`,
        score: typeof c.score === "number" ? c.score : 0,
        maxPoints:
          typeof c.maxPoints === "number"
            ? c.maxPoints
            : rubric.criteria[idx]?.maxPoints ?? 0,
        comment: c.comment ?? "",
      }))
    : [];

  return {
    totalScore,
    maxPoints,
    criteria,
    overallComment: parsed.overallComment ?? "",
  };
}

/**
 * Specialized AI scoring for Diff Detective tasks (text, image, code modes).
 */
async function scoreDiffDetective({ task, submission }) {
  const mode = task.mode || "text";

  // If we already have a raw "foundCount" from the client, we can score quickly.
  if (typeof submission?.foundCount === "number") {
    const found = submission.foundCount;
    const total =
      (Array.isArray(task.targetDifferences) && task.targetDifferences.length) ||
      task.totalDifferences ||
      10;

    const ratio = total > 0 ? found / total : 0;
    const maxPoints = task.points || 30;
    const score = Math.round(ratio * maxPoints);

    return {
      totalScore: score,
      maxPoints,
      criteria: [
        {
          id: "differences_found",
          score,
          maxPoints,
          comment: `Student found approximately ${found} of ${total} differences.`,
        },
      ],
      overallComment: `Student found about ${found} of ${total} differences in ${mode} mode.`,
    };
  }

  // If not, fall back to AI-based scoring that looks at the raw submission.
  const rubric = {
    totalPoints: task.points || 30,
    criteria: [
      {
        id: "differences_found",
        maxPoints: task.points || 30,
        description:
          "How many of the intended differences did the student successfully identify? Consider both quantity and accuracy.",
      },
    ],
  };

  try {
    const aiResult = await scoreSubmissionWithAI({ task, rubric, submission });
    return aiResult;
  } catch (err) {
    console.error("Diff Detective AI scoring failed, falling back:", err);

    const differences =
      Array.isArray(task.targetDifferences) && task.targetDifferences.length
        ? task.targetDifferences
        : [];

    const found =
      Array.isArray(submission?.foundDiffs) && submission.foundDiffs.length
        ? submission.foundDiffs.length
        : 0;

    const total = differences.length || task.totalDifferences || 10;
    const ratio = total > 0 ? found / total : 0;
    const maxPoints = task.points || 30;
    const score = Math.round(ratio * maxPoints);

    return {
      totalScore: score,
      maxPoints,
      criteria: [{
        id: "differences_found",
        score,
        maxPoints: task.points || 30,
        comment: `Fallback: found ~${found}/${differences.length} differences`,
      }],
      overallComment: "Scored with backup method.",
    };
  }
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

  // ----- Diff Detective Integration -----
  if (task?.taskType === "diff-detective") {
    return await scoreDiffDetective({ task, submission });
  }

  const hasCorrect =
    safeTask.correctAnswer !== undefined && safeTask.correctAnswer !== null;

  const hasRubric =
    rubric && Array.isArray(rubric.criteria) && rubric.criteria.length > 0;

  const hasExplicitFlag = typeof safeTask.aiScoringRequired === "boolean";

  const requiresAI = hasExplicitFlag
    ? safeTask.aiScoringRequired
    : !hasCorrect && hasRubric; // default: only use AI when no correctAnswer AND a rubric is provided

  if (!requiresAI && hasCorrect) {
    // Instant objective scoring for objective tasks
    return scoreSubmissionRuleBased({ task: safeTask, submission });
  }

  if (!requiresAI && !hasCorrect) {
    // Neither AI nor objective scoring is enabled → return a neutral result
    return {
      totalScore: 0,
      maxPoints: safeTask.points || 0,
      criteria: [],
      overallComment:
        "AI scoring was not enabled for this task and no objective scoring rules were found.",
    };
  }

  // At this point, AI scoring is required and a rubric should be present
  return scoreSubmissionWithAI({ task: safeTask, rubric, submission });
}
