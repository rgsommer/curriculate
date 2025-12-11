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

// Normalize a student’s answer that might be a primitive or a MultiPartTask object
// { value, baseIndex, answer } → best primitive we can use.
function normalizeStudentAnswerPrimitive(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object") return raw;

  if (typeof raw.baseIndex === "number") return raw.baseIndex;
  if (raw.value != null) return raw.value;
  if (raw.answer != null) return raw.answer;

  return raw;
}

// --- RULE-BASED SCORING FOR OBJECTIVE TASKS ---

function scoreSubmissionRuleBased({ task, submission }) {
  const meta = TASK_TYPE_META[task.taskType] || {};
  if (!meta.objectiveScoring) return null;

  const points = typeof task.points === "number" ? task.points : 1;
  let score = 0;
  let maxPoints = points;

  const correct = task.correctAnswer;
  const studentAnswerRaw = submission?.answer;

  // Multiple-choice / True-False / Short-answer with explicit correctAnswer
  if (
    [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(
      task.taskType
    )
  ) {
    // Multi-question item set
    if (Array.isArray(task.items) && task.items.length > 0) {
      const items = task.items;
      maxPoints = points * items.length;

      items.forEach((item, index) => {
        const studentItemAnswerRaw =
          submission?.answers && Array.isArray(submission.answers)
            ? submission.answers[index]
            : undefined;

        if (studentItemAnswerRaw == null) return;
        if (item.correctAnswer == null) return;

        const studentItemAnswer = normalizeStudentAnswerPrimitive(
          studentItemAnswerRaw
        );
        const baseOptions = Array.isArray(item.options)
          ? item.options
          : Array.isArray(task.options)
          ? task.options
          : null;

        let isCorrect = false;

        // Correct answer is a single primitive
        if (
          typeof item.correctAnswer === "string" ||
          typeof item.correctAnswer === "number" ||
          typeof item.correctAnswer === "boolean"
        ) {
          // If it's a numeric index and we have options, allow both index and option-text matches
          if (
            typeof item.correctAnswer === "number" &&
            baseOptions &&
            baseOptions[item.correctAnswer] != null
          ) {
            const correctIndex = item.correctAnswer;
            const correctText = String(baseOptions[correctIndex]).trim().toLowerCase();

            if (typeof studentItemAnswer === "number") {
              isCorrect = studentItemAnswer === correctIndex;
            } else {
              const normStudent = String(studentItemAnswer).trim().toLowerCase();
              isCorrect = normStudent === correctText;
            }
          } else {
            // Plain primitive compare
            const normStudent = String(studentItemAnswer).trim().toLowerCase();
            const normCorrect = String(item.correctAnswer).trim().toLowerCase();
            isCorrect = normStudent === normCorrect;
          }
        } else if (Array.isArray(item.correctAnswer)) {
          // Accept any of a list
          const normStudent = String(studentItemAnswer).trim().toLowerCase();
          const matches = item.correctAnswer.some(
            (ans) => String(ans).trim().toLowerCase() === normStudent
          );
          isCorrect = matches;
        }

        if (isCorrect) {
          score += points;
        }
      });
    } else {
      // Single question
      if (correct != null && studentAnswerRaw != null) {
        const studentAnswer = normalizeStudentAnswerPrimitive(studentAnswerRaw);
        const options = Array.isArray(task.options) ? task.options : null;

        let candidates;

        if (Array.isArray(correct)) {
          candidates = correct.slice();
        } else if (
          typeof correct === "number" &&
          options &&
          options[correct] != null
        ) {
          // Index-based correct answer → allow both index and option text
          candidates = [correct, options[correct]];
        } else {
          candidates = [correct];
        }

        const correctMatch = candidates.some((ans) => {
          // If both numeric, compare numerically
          if (typeof ans === "number" && typeof studentAnswer === "number") {
            return ans === studentAnswer;
          }

          const normStudent = String(studentAnswer).trim().toLowerCase();
          const normCorrect = String(ans).trim().toLowerCase();
          return normStudent === normCorrect;
        });

        if (correctMatch) {
          score = points;
        }
      }
    }

    return {
      score,
      maxPoints,
      method: "rule-based",
      details: {
        type: task.taskType,
        correctAnswer: task.correctAnswer,
        studentAnswer: submission?.answer,
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
        items: task.items.map((item, index) => {
          let rawStudent =
            submission?.answers && Array.isArray(submission.answers)
              ? submission.answers[index]
              : undefined;
          const normalizedStudent = normalizeStudentAnswerPrimitive(rawStudent);

          return {
            id: item.id || `q${index + 1}`,
            prompt: item.prompt,
            correctAnswer: item.correctAnswer,
            studentAnswer: normalizedStudent,
          };
        }),
      };
    }

    return {
      summary: "Single question/answer pair.",
      prompt: task.prompt,
      correctAnswer: task.correctAnswer,
      studentAnswer:
        normalizeStudentAnswerPrimitive(
          submission?.answer ?? submission?.text ?? null
        ),
    };
  }

  // Open text – pulls the real typed response
  if (type === TASK_TYPES.OPEN_TEXT) {
    const rawAnswer = submission?.answer ?? submission ?? null;
    let studentText = "";

    if (rawAnswer && typeof rawAnswer === "object") {
      studentText =
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        "";
    } else if (typeof rawAnswer === "string") {
      studentText = rawAnswer;
    }

    // Fallbacks if answer was stored directly on submission
    if (!studentText) {
      studentText =
        submission?.text ??
        submission?.response ??
        submission?.answerText ??
        "";
    }

    studentText = typeof studentText === "string" ? studentText : String(studentText || "");

    return {
      summary: "Open-text response.",
      prompt: task.prompt,
      studentText,
    };
  }

  // Photo Journal – explicit handling for photo + explanation
  if (
    type === TASK_TYPES.PHOTO_JOURNAL ||
    type === "photo-journal" ||
    type === "photo_journal" ||
    type === "photojournal"
  ) {
    const rawAnswer = submission?.answer ?? submission ?? null;

    let explanation = "";
    let notes = "";
    let hasPhoto = false;
    let photoMeta = null;

    if (rawAnswer && typeof rawAnswer === "object") {
      explanation =
        rawAnswer.explanation ??
        rawAnswer.caption ??
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        "";

      notes = rawAnswer.notes ?? "";

      if (rawAnswer.photo && typeof rawAnswer.photo === "object") {
        hasPhoto = true;
        // Only pass safe, non-binary metadata through to AI (no raw image data).
        photoMeta = {
          url: rawAnswer.photo.url || null,
          filename: rawAnswer.photo.filename || null,
          mimetype: rawAnswer.photo.mimetype || null,
          size: rawAnswer.photo.size || null,
        };
      } else if (rawAnswer.hasPhoto === true) {
        hasPhoto = true;
      }
    } else if (typeof rawAnswer === "string") {
      explanation = rawAnswer;
    }

    if (!explanation) {
      explanation =
        submission?.text ??
        submission?.response ??
        submission?.answerText ??
        "";
    }

    explanation =
      typeof explanation === "string" ? explanation : String(explanation || "");

    return {
      summary:
        "Photo journal task: student took or uploaded a photo and wrote a short explanation/caption about it.",
      prompt: task.prompt,
      explanation,
      notes,
      hasPhoto,
      photoMeta,
    };
  }

  // Photo / Make-and-Snap / Draw-Mime and related media tasks
  if (
    type === TASK_TYPES.PHOTO ||
    type === TASK_TYPES.MAKE_AND_SNAP ||
    type === TASK_TYPES.DRAW_MIME ||
    type === "photo" ||
    type === "make-and-snap" ||
    type === "make_and_snap" ||
    type === "draw-mime"
  ) {
    const rawAnswer = submission?.answer ?? submission ?? null;
    let studentText = "";

    if (rawAnswer && typeof rawAnswer === "object") {
      studentText =
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        rawAnswer.notes ??
        "";
    } else if (typeof rawAnswer === "string") {
      studentText = rawAnswer;
    }

    if (!studentText) {
      studentText =
        submission?.text ??
        submission?.notes ??
        submission?.answerText ??
        "";
    }

    studentText =
      typeof studentText === "string" ? studentText : String(studentText || "");

    let summary;
    if (
      type === TASK_TYPES.MAKE_AND_SNAP ||
      type === "make-and-snap" ||
      type === "make_and_snap"
    ) {
      summary =
        "Make-and-Snap task: students built or created something, then took a photo as evidence.";
    } else if (type === TASK_TYPES.DRAW_MIME || type === "draw-mime") {
      summary =
        "Draw/Mime task: students drew or acted out the idea, often taking a photo of their work or pose.";
    } else {
      summary =
        "Photo evidence task: students took or uploaded a photo as evidence connected to the prompt.";
    }

    return {
      summary,
      prompt: task.prompt,
      studentText,
      hasPhoto:
        submission?.hasPhoto === true ||
        (typeof studentText === "string" &&
          studentText.toLowerCase().includes("[photo taken]")),
      // Raw image blobs/URLs are not sent to AI here; teacher sees the media separately.
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
  const totalDifferences =
    task.config?.differences?.length ?? task.totalDifferences ?? 5;

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

// --- SPECIAL CASE: MIND MAPPER (AI-ASSISTED BUT SIMPLE) ---

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

// --- SPECIAL CASE: PHOTO JOURNAL (PHOTO + TEXT) ---

async function scorePhotoJournal({ task, submission, rubric }) {
  const points = typeof task.points === "number" ? task.points : 10;

  // Default rubric if the caller didn't provide one.
  const effectiveRubric =
    rubric ||
    {
      totalPoints: points,
      criteria: [
        {
          id: "photo_match",
          label: "Photo matches the prompt",
          maxPoints: Math.round(points * 0.6),
          description:
            "Does the photo clearly show something that matches the teacher's prompt or evidence requested? " +
            "Give most or all of these points if the image is mostly on-topic, even if not perfect.",
        },
        {
          id: "explanation_quality",
          label: "Explanation clarity and accuracy",
          maxPoints: points - Math.round(points * 0.6),
          description:
            "Is the written explanation accurate, clear, and appropriately detailed for the grade level? " +
            "Does it explain WHY the photo is a good example of the idea or evidence requested?",
        },
      ],
    };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric: effectiveRubric,
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
    rubricUsed: effectiveRubric,
    details: {
      ...(result.details || {}),
      type: TASK_TYPES.PHOTO_JOURNAL,
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
  if (
    task?.taskType === TASK_TYPES.DIFF_DETECTIVE ||
    task?.taskType === "diff-detective"
  ) {
    return scoreDiffDetective({ task, submission });
  }

  // Specialized path: Photo Journal (photo + written explanation)
  if (
    task?.taskType === TASK_TYPES.PHOTO_JOURNAL ||
    task?.taskType === "photo-journal" ||
    task?.taskType === "photo_journal" ||
    task?.taskType === "photojournal"
  ) {
    return scorePhotoJournal({ task, submission, rubric });
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
  if (!rubric && task.taskType !== TASK_TYPES.PHOTO_JOURNAL) {
    throw new Error(
      `AI scoring is required for taskType "${task.taskType}" but no rubric was provided.`
    );
  }

  return await scoreSubmissionWithAI({
    task: safeTask,
    submission,
    rubric: rubric,
    explicitTotalPoints: safeTask.points,
  });
}

export default {
  generateAIScore,
};
