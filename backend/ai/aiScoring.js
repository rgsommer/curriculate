// backend/ai/aiScoring.js
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helpers ---

function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== "string") return fallback;
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
}

// Simple clamp helper
function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

// --- RULE-BASED SCORING FOR OBJECTIVE TASKS ---

function scoreSubmissionRuleBased({ task, submission }) {
  const meta = TASK_TYPE_META[task.taskType] || {};
  if (!meta.objectiveScoring) return null;

  const points = typeof task.points === "number" ? task.points : 1;
  let score = 0;
  let maxPoints = points;

  const correct = task.correctAnswer;
  const studentAnswer = submission?.answer;

  // Multiple-choice / True-False / Short-answer with explicit correctAnswer
  if (
    [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(
      task.taskType
    )
  ) {
    if (Array.isArray(task.items) && task.items.length > 0) {
      // Multi-question item set
      const items = task.items;
      maxPoints = points * items.length;

      items.forEach((item, index) => {
        const studentItemAnswer =
          submission?.answers && Array.isArray(submission.answers)
            ? submission.answers[index]
            : undefined;

        if (studentItemAnswer == null) return;

        if (item.correctAnswer == null) return;

        // String or primitive comparison
        if (
          typeof item.correctAnswer === "string" ||
          typeof item.correctAnswer === "number" ||
          typeof item.correctAnswer === "boolean"
        ) {
          if (String(studentItemAnswer).trim().toLowerCase() ===
              String(item.correctAnswer).trim().toLowerCase()) {
            score += points;
          }
        } else if (Array.isArray(item.correctAnswer)) {
          // Accept any of a list
          const norm = String(studentItemAnswer).trim().toLowerCase();
          const matches = item.correctAnswer.some((ans) =>
            String(ans).trim().toLowerCase() === norm
          );
          if (matches) score += points;
        }
      });
    } else {
      // Single question
      if (correct != null && studentAnswer != null) {
        const c = Array.isArray(correct) ? correct : [correct];
        const normStudent = String(studentAnswer).trim().toLowerCase();
        const correctMatch = c.some(
          (ans) => String(ans).trim().toLowerCase() === normStudent
        );
        if (correctMatch) score = points;
      }
    }

    return {
      score,
      maxPoints,
      method: "rule-based",
      details: {
        type: task.taskType,
        correctAnswer: task.correctAnswer,
        studentAnswer,
      },
    };
  }

  // Sort / Sequence / Timeline use config for correctness
  if (
    [TASK_TYPES.SORT, TASK_TYPES.SEQUENCE, TASK_TYPES.TIMELINE].includes(task.taskType) &&
    task.config &&
    Array.isArray(task.config.items)
  ) {
    const items = task.config.items;
    const studentOrder = submission?.order || [];
    if (!Array.isArray(studentOrder) || studentOrder.length === 0) {
      return {
        score: 0,
        maxPoints: points,
        method: "rule-based",
        details: {
          reason: "No student order provided.",
        },
      };
    }

    // For SEQUENCE / TIMELINE, we treat items as in correct order; studentOrder is array of item ids.
    // For SORT, each item has bucketIndex; we expect submission.mapping[itemId] = bucketIndex
    if (task.taskType === TASK_TYPES.SORT) {
      const mapping = submission?.mapping || {};
      const perItem = points / items.length;
      score = 0;

      items.forEach((it) => {
        const expectedBucket = it.bucketIndex;
        if (expectedBucket == null) return;
        const studentBucket = mapping[it.id] ?? mapping[it.text];
        if (studentBucket == null) return;
        if (Number(studentBucket) === Number(expectedBucket)) {
          score += perItem;
        }
      });

      return {
        score,
        maxPoints: points,
        method: "rule-based",
        details: {
          type: task.taskType,
          config: task.config,
          submission: { mapping },
        },
      };
    } else {
      // SEQUENCE / TIMELINE
      const correctOrderIds = items.map((it) => it.id);
      const perItem = points / correctOrderIds.length;
      score = 0;

      correctOrderIds.forEach((id, index) => {
        const studentIndex = studentOrder.indexOf(id);
        if (studentIndex === index) {
          score += perItem;
        }
      });

      return {
        score,
        maxPoints: points,
        method: "rule-based",
        details: {
          type: task.taskType,
          correctOrder: correctOrderIds,
          studentOrder,
        },
      };
    }
  }

  // Everything else: not rule-based
  return null;
}

// --- AI SCORING CORE ---

async function scoreSubmissionWithAI({
  task,
  submission,
  rubric,
  explicitTotalPoints,
}) {
  if (!rubric || !rubric.totalPoints) {
    throw new Error("AI scoring requires a rubric with totalPoints.");
  }

  const totalPoints =
    typeof explicitTotalPoints === "number" ? explicitTotalPoints : rubric.totalPoints;

  const work = buildStudentWorkDescription(task, submission);

  const systemPrompt = `
You are an expert teacher evaluating a student team's work.

- Always return JSON ONLY, with no extra commentary.
- Use the provided rubric strictly.
- Score fairly but generously when in doubt.
- totalPoints is the maximum score you can award.
`.trim();

  const userPrompt = `
Task Type: ${task.taskType}
Task Title: ${task.title || "(untitled)"}
Task Prompt: ${task.prompt || "(no prompt)"}

Rubric:
${JSON.stringify(rubric, null, 2)}

Student Work (normalized):
${JSON.stringify(work, null, 2)}

Return JSON of the form:
{
  "score": number,  // 0–${totalPoints}
  "maxPoints": number,
  "reason": string  // brief explanation for the teacher
}
`.trim();

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse(raw, {});
  const score = clamp(Number(parsed.score ?? 0), 0, totalPoints);

  return {
    score,
    maxPoints: totalPoints,
    reason: parsed.reason || "AI-scored based on rubric.",
    method: "ai-rubric",
  };
}

// --- BUILD NORMALIZED STUDENT-WORK DESCRIPTION FOR AI ---

function buildStudentWorkDescription(task, submission) {
  const type = task.taskType;

  // Multi-question Q&A descriptions
  if (
    [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(
      type
    )
  ) {
    if (Array.isArray(task.items) && task.items.length > 0) {
      return {
        summary: "Set of question/answer pairs.",
        items: task.items.map((item, index) => ({
          id: item.id || `q${index + 1}`,
          prompt: item.prompt,
          correctAnswer: item.correctAnswer,
          studentAnswer:
            submission?.answers && Array.isArray(submission.answers)
              ? submission.answers[index]
              : undefined,
        })),
      };
    }

    return {
      summary: "Single question/answer pair.",
      prompt: task.prompt,
      correctAnswer: task.correctAnswer,
      studentAnswer: submission?.answer ?? submission?.text ?? null,
    };
  }

  // Open text
  if (type === TASK_TYPES.OPEN_TEXT) {
    return {
      summary: "Open-text response.",
      prompt: task.prompt,
      studentText: submission?.text || "",
    };
  }

  // Photo / Make-and-snap / Draw / Mime etc.
  if ([TASK_TYPES.PHOTO, TASK_TYPES.MAKE_AND_SNAP, TASK_TYPES.DRAW, TASK_TYPES.MIME].includes(type)) {
    return {
      summary: "Media-based submission (photo / drawing / mime).",
      prompt: task.prompt,
      notes: submission?.notes || "",
      // We don't pass raw image blobs to AI here; teacher sees media separately.
    };
  }

  // Pronunciation / speech recognition
  if (
    type === TASK_TYPES.PRONUNCIATION ||
    type === TASK_TYPES.SPEECH_RECOGNITION
  ) {
    return {
      summary: "Spoken response evaluated for pronunciation / speech.",
      prompt: task.prompt,
      targetText: task.targetText || null,
      recognizedText: submission?.recognizedText || null,
      audioReference: submission?.audioUrl || null,
    };
  }

  // Collaboration summary
  if (type === TASK_TYPES.COLLABORATION) {
    return {
      summary: "Collaboration task: description of team process and outcome.",
      prompt: task.prompt,
      teamNotes: submission?.notes || "",
      artifacts: submission?.artifacts || [],
    };
  }

  // Make-and-snap special description
  if (type === TASK_TYPES.MAKE_AND_SNAP || type === "make_and_snap") {
    return {
      summary:
        "Make-and-Snap task: students built or drew something, then took a photo as evidence.",
      prompt: task.prompt,
      descriptionText: submission?.text || submission?.notes || "",
      // Again, raw media is not passed here; AI only sees textual description.
    };
  }

  // NEW: Mind Mapper – use completion flag + node info for AI
  if (type === TASK_TYPES.MIND_MAPPER || type === "mind-mapper") {
    const configItems =
      (task.config && Array.isArray(task.config.items) && task.config.items) || [];
    const shuffledItems =
      (Array.isArray(task.shuffledItems) && task.shuffledItems) || [];
    const nodes = configItems.length ? configItems : shuffledItems;
    const organizerType = task.organizerType || "mind-map";
    const completed = submission?.completed === true;

    return {
      summary: `Mind Mapper puzzle on organizer "${organizerType}". Students dragged concept nodes into an order; client logic reports the puzzle as ${
        completed ? "COMPLETED (all nodes correctly ordered)." : "NOT completed."
      }`,
      organizerType,
      nodes: (nodes || []).map((it, index) => ({
        id: it.id || `node-${index + 1}`,
        text: it.text || it.label || "",
        correctIndex:
          typeof it.correctIndex === "number" ? it.correctIndex : null,
      })),
      clientCompletionFlag: completed,
    };
  }

  // Fallback: generic
  return {
    summary: `Student submission for taskType "${type}" with generic structure.`,
    details: {
      taskPrompt: task.prompt,
      studentAnswer: submission?.answer ?? submission ?? null,
    },
  };
}

// --- SPECIAL CASE: DIFF DETECTIVE ---

async function scoreDiffDetective({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 10;
  const foundCount = submission?.foundCount ?? 0;
  const totalDifferences = task.config?.differences?.length ?? task.totalDifferences ?? 5;

  if (totalDifferences <= 0) {
    return {
      score: 0,
      maxPoints: points,
      method: "rule-based",
      details: {
        reason: "No totalDifferences configured for DiffDetective.",
      },
    };
  }

  const ratio = clamp(foundCount / totalDifferences, 0, 1);
  const score = Math.round(ratio * points);

  return {
    score,
    maxPoints: points,
    method: "rule-based",
    details: {
      type: TASK_TYPES.DIFF_DETECTIVE,
      foundCount,
      totalDifferences,
      ratio,
    },
  };
}

// --- NEW: SPECIAL CASE – MIND MAPPER (AI-ASSISTED BUT SIMPLE) ---

async function scoreMindMapper({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 20;
  const completed = submission?.completed === true;

  // Simple rubric: full credit if completed, partial/zero otherwise.
  const rubric = {
    totalPoints: points,
    criteria: [
      {
        id: "mindmap_completion",
        label: "Mind Mapper puzzle completion",
        maxPoints: points,
        description:
          "Give FULL points if the student successfully completed the Mind Mapper puzzle and the client reports completed=true. " +
          "If not completed, give between 0 and 50% of the points depending on how close or thorough the attempt appears from the description. " +
          "Always include a brief explanation for your decision.",
      },
    ],
  };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric,
    explicitTotalPoints: points,
  });

  const clampedScore = clamp(
    typeof result.score === "number" ? result.score : 0,
    0,
    points
  );

  return {
    ...result,
    score: clampedScore,
    maxPoints: points,
    method: "ai-rubric",
    rubricUsed: rubric,
    details: {
      ...(result.details || {}),
      type: TASK_TYPES.MIND_MAPPER,
      completed,
    },
  };
}

// --- PUBLIC ENTRYPOINT ---

export async function generateAIScore({ task, submission, rubric }) {
  if (!task) {
    throw new Error("generateAIScore requires a task.");
  }

  // Specialized path: Mind Mapper
  if (task?.taskType === TASK_TYPES.MIND_MAPPER || task?.taskType === "mind-mapper") {
    return scoreMindMapper({ task, submission });
  }

  // Specialized path: Diff Detective (rule-based, no rubric needed)
  if (task?.taskType === TASK_TYPES.DIFF_DETECTIVE || task?.taskType === "diff-detective") {
    return scoreDiffDetective({ task, submission });
  }

  const meta = TASK_TYPE_META[task.taskType] || {};
  const hasCorrect =
    task.correctAnswer != null ||
    (Array.isArray(task.items) &&
      task.items.some((it) => it.correctAnswer != null));

  const safeTask = {
    ...task,
    aiScoringRequired:
      typeof task.aiScoringRequired === "boolean"
        ? task.aiScoringRequired
        : meta.defaultAiScoringRequired,
  };

  // 1) Try rule-based if objective and correct answers exist
  const ruleResult = scoreSubmissionRuleBased({ task: safeTask, submission });
  if (ruleResult) return ruleResult;

  // 2) If AI is not required and no rubric, skip
  const hasExplicitFlag = typeof safeTask.aiScoringRequired === "boolean";
  const requiresAI = hasExplicitFlag
    ? safeTask.aiScoringRequired
    : !hasCorrect && !!rubric;

  if (!requiresAI) {
    return {
      score: null,
      maxPoints: typeof safeTask.points === "number" ? safeTask.points : null,
      method: "none",
      details: {
        reason:
          "AI scoring not required and no objective rule-based scoring available.",
      },
    };
  }

  // 3) Use provided rubric or fail
  if (!rubric) {
    throw new Error(
      `AI scoring is required for taskType "${task.taskType}" but no rubric was provided.`
    );
  }

  return await scoreSubmissionWithAI({
    task: safeTask,
    submission,
    rubric,
    explicitTotalPoints: safeTask.points,
  });
}

export default {
  generateAIScore,
};
