// backend/controllers/aiTasksetController.js

import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

// Build a list of implemented AI-eligible task types dynamically:
const AI_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(
    ([, meta]) => meta.implemented !== false && meta.aiEligible !== false
  )
  .map(([type]) => type);

// Fallback to simple core types if metadata is missing / empty
const coreTypes =
  AI_ELIGIBLE_TYPES && AI_ELIGIBLE_TYPES.length
    ? AI_ELIGIBLE_TYPES
    : [
        TASK_TYPES.MULTIPLE_CHOICE,
        TASK_TYPES.TRUE_FALSE,
        TASK_TYPES.SHORT_ANSWER,
      ];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Basic payload validation. We keep this simple and normalize difficulty/goal
 * to uppercase so "medium" / "review" from the frontend are accepted.
 */
function validateGeneratePayload(payload = {}) {
  const errors = [];

  if (!payload.gradeLevel) errors.push("gradeLevel is required");
  if (!payload.subject) errors.push("subject is required");

  const difficultiesAllowed = ["EASY", "MEDIUM", "HARD"];
  const goalsAllowed = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

  const difficulty = (payload.difficulty || "MEDIUM")
    .toString()
    .toUpperCase();
  const learningGoal = (payload.learningGoal || "REVIEW")
    .toString()
    .toUpperCase();

  if (!difficultiesAllowed.includes(difficulty)) {
    errors.push("difficulty must be one of " + difficultiesAllowed.join(", "));
  }

  if (!goalsAllowed.includes(learningGoal)) {
    errors.push("learningGoal must be one of " + goalsAllowed.join(", "));
  }

  return { errors, difficulty, learningGoal };
}

/**
 * Main Express handler used by /api/ai/tasksets
 * This works with your current AiTasksetGenerator.jsx payload.
 */
export const generateAiTaskset = async (req, res) => {
  try {
    const {
      subject,
      gradeLevel,

      // Old shape
      numTasks,
      selectedTypes,
      customInstructions = "",

      // New shape from AiTasksetGenerator.jsx
      difficulty,
      learningGoal,
      topicDescription = "",
      topicTitle = "",
      totalDurationMinutes,
      durationMinutes,
      numberOfTasks,

      // NEW: presenter profile with lenses/perspective
      presenterProfile,
    } = req.body || {};

    const requestedCount = Number(numberOfTasks) || Number(numTasks) || 8;

    const duration =
      Number(totalDurationMinutes) || Number(durationMinutes) || 45;

    const { errors, difficulty: normDifficulty, learningGoal: normGoal } =
      validateGeneratePayload({
        subject,
        gradeLevel,
        difficulty,
        learningGoal,
        durationMinutes: duration,
      });

    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Invalid payload: " + errors.join(", ") });
    }

    // Safety clamp
    const safeCount = Math.max(4, Math.min(20, requestedCount || 8));

    // Resolve curricular lenses / perspectives from presenterProfile
    let lenses = [];
    if (
      presenterProfile &&
      Array.isArray(presenterProfile.curriculumLenses) &&
      presenterProfile.curriculumLenses.length
    ) {
      lenses = presenterProfile.curriculumLenses;
    } else if (
      presenterProfile &&
      Array.isArray(presenterProfile.perspectives) &&
      presenterProfile.perspectives.length
    ) {
      lenses = presenterProfile.perspectives;
    }
    const lensesText = lenses.length ? lenses.join(", ") : "none specified";

    // If the frontend passed required/selected types, intersect with coreTypes
    const rawSelected =
      (Array.isArray(selectedTypes) && selectedTypes) || [];
    const typePool =
      rawSelected.length > 0
        ? rawSelected.filter((t) => coreTypes.includes(t))
        : coreTypes;

    const tasksetName =
      topicTitle ||
      topicDescription?.slice(0, 60) ||
      `${subject || "Lesson"} – AI Task Set`;

    // ------------- OpenAI prompt -----------------

    const systemPrompt = `
You are an expert classroom teacher using Curriculate, a station-based
task system. You will generate short, engaging tasks that can be used
in a 45–60 minute lesson.

Each task must be one of these taskType values ONLY:
${coreTypes.map((t) => `- "${t}"`).join("\n")}

You MUST NOT invent any other taskType values.

When curricular lenses / perspectives are provided, you must shape tasks
so that they naturally reflect those lenses.
`.trim();

    const userPrompt = `
Create ${safeCount} tasks for:

- Subject: ${subject}
- Grade level: ${gradeLevel}
- Difficulty: ${normDifficulty}
- Learning goal: ${normGoal}
- Topic / description: ${topicDescription || "(general review)"}
- Approx lesson duration (minutes): ${duration}
- Curricular lenses / perspectives to emphasize: ${lensesText}

Rules:
- Mix of the allowed taskTypes only: ${typePool.join(", ")}.
- Each task has a short clear title and prompt.
- Tasks should, whenever possible, reflect the listed curricular lenses
  (for example, by connecting content or examples to that perspective).
- For "${TASK_TYPES.MULTIPLE_CHOICE}":
  - Provide 3–5 options (short strings).
  - correctAnswer is the ZERO-BASED index of the correct option.
- For "${TASK_TYPES.TRUE_FALSE}":
  - options can be ["True", "False"].
  - correctAnswer is the ZERO-BASED index (0 or 1).
- For "${TASK_TYPES.SHORT_ANSWER}":
  - options is an empty array.
  - correctAnswer is a short reference answer string (or null).

Return ONLY valid JSON in this exact format (no backticks, no extra text):

[
  {
    "title": "Short title",
    "prompt": "Student-facing instructions / question.",
    "taskType": "multiple-choice",
    "options": ["Option A", "Option B"],
    "correctAnswer": 0,
    "timeLimitSeconds": 60,
    "points": 10
  },
  ...
]
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "[]";

    let aiTasks;
    try {
      aiTasks = JSON.parse(raw);
    } catch (err) {
      console.error("Failed to parse AI JSON:", raw.slice(0, 500));
      throw new Error("AI did not return valid JSON");
    }

    if (!Array.isArray(aiTasks) || aiTasks.length === 0) {
      throw new Error("AI returned no tasks");
    }

    // Normalize / sanitize tasks into TaskSet schema shape
    const tasks = aiTasks.slice(0, safeCount).map((t, index) => {
      const rawType = (t.taskType || "").toString().toLowerCase();

      let taskType = TASK_TYPES.SHORT_ANSWER;
      if (coreTypes.includes(rawType)) {
        taskType = rawType;
      }

      let options = Array.isArray(t.options) ? t.options : [];
      if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
        if (options.length < 2) {
          options = ["Option A", "Option B"];
        }
      } else if (taskType === TASK_TYPES.TRUE_FALSE) {
        if (options.length !== 2) {
          options = ["True", "False"];
        }
      } else {
        options = [];
      }

      let correctAnswer = t.correctAnswer ?? null;

      if (
        (taskType === TASK_TYPES.MULTIPLE_CHOICE ||
          taskType === TASK_TYPES.TRUE_FALSE) &&
        options.length > 0
      ) {
        let idx = Number.isInteger(correctAnswer) ? correctAnswer : 0;
        if (idx < 0 || idx >= options.length) idx = 0;
        correctAnswer = idx;
      } else if (taskType === TASK_TYPES.SHORT_ANSWER) {
        correctAnswer =
          typeof correctAnswer === "string" ? correctAnswer : null;
      }

      const timeLimitSeconds =
        Number(t.timeLimitSeconds) && Number(t.timeLimitSeconds) > 0
          ? Number(t.timeLimitSeconds)
          : 60;

      const points =
        Number(t.points) && Number(t.points) > 0
          ? Number(t.points)
          : 10;

      return {
        taskId: `ai-${index + 1}`,
        title: t.title || `${subject || "Task"} #${index + 1}`,
        prompt:
          t.prompt ||
          `Answer this question about ${subject || "the topic"}.`,
        taskType,
        options,
        correctAnswer,
        timeLimitSeconds,
        points,
        displayKey: "",
        ignoreNoise: false,
        order: index,
        timeMinutes: Math.round(timeLimitSeconds / 60) || 1,
        movement: false,
        requiresDrawing: false,
        notesForTeacher: "",
      };
    });

    const now = new Date();

    const tasksetDoc = await TaskSet.create({
      name: tasksetName,
      subject,
      gradeLevel,
      learningGoal: normGoal,
      difficulty: normDifficulty,
      durationMinutes: duration,
      tasks,
      displays: [],
      isPublic: false,
      meta: {
        generatedBy: "AI",
        generatedAt: now.toISOString(),
        sourceConfig: {
          subject,
          gradeLevel,
          difficulty: normDifficulty,
          learningGoal: normGoal,
          topicDescription,
          topicTitle,
          durationMinutes: duration,
          requestedCount: safeCount,
          typePool,
          customInstructions,
          lenses,
        },
      },
    });

    return res.json({ ok: true, taskset: tasksetDoc });
  } catch (err) {
    console.error("AI Taskset generation failed:", err);
    return res.status(500).json({
      error: "Failed to generate taskset",
      details: err.message || String(err),
    });
  }
};

export default { generateAiTaskset };
