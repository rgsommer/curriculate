// backend/controllers/aiTasksetController.js

import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Build a list of implemented, AI-eligible task types
const AI_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented !== false && meta.aiEligible !== false)
  .map(([type]) => type);

// Fallback core types if metadata is missing / empty
const CORE_TYPES =
  AI_ELIGIBLE_TYPES && AI_ELIGIBLE_TYPES.length
    ? AI_ELIGIBLE_TYPES
    : [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER];

function validateGeneratePayload(payload = {}) {
  const errors = [];

  if (!payload.gradeLevel) errors.push("gradeLevel is required");
  if (!payload.subject) errors.push("subject is required");

  const difficultiesAllowed = ["EASY", "MEDIUM", "HARD"];
  const goalsAllowed = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

  const difficulty = (payload.difficulty || "MEDIUM").toString().toUpperCase();
  const learningGoal = (payload.learningGoal || "REVIEW").toString().toUpperCase();

  if (!difficultiesAllowed.includes(difficulty)) {
    errors.push("difficulty must be one of " + difficultiesAllowed.join(", "));
  }

  if (!goalsAllowed.includes(learningGoal)) {
    errors.push("learningGoal must be one of " + goalsAllowed.join(", "));
  }

  return { errors, difficulty, learningGoal };
}

/**
 * Normalize a user-facing type token to a canonical TASK_TYPES value.
 * This lets the UI send legacy values like "multiple_choice".
 */
function normalizeSelectedType(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/_/g, "-");

  if (v === "multiple-choice" || v === "multiplechoice" || v === "mcq") {
    return TASK_TYPES.MULTIPLE_CHOICE;
  }
  if (v === "true-false" || v === "truefalse" || v === "tf") {
    return TASK_TYPES.TRUE_FALSE;
  }
  if (v === "short-answer" || v === "shortanswer" || v === "sa" || v === "open-text") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "sort" || v === "categorize" || v === "sort-task") {
    return TASK_TYPES.SORT;
  }
  if (v === "sequence" || v === "timeline" || v === "order") {
    return TASK_TYPES.SEQUENCE;
  }
  if (v === "photo" || v === "photo-evidence" || v === "photo_description") {
    return TASK_TYPES.PHOTO;
  }
  if (v === "make-and-snap" || v === "make_and_snap") {
    return TASK_TYPES.MAKE_AND_SNAP;
  }
  if (v === "body-break" || v === "body_break") {
    return TASK_TYPES.BODY_BREAK;
  }
  if (v === "brain-blitz" || v === "jeopardy" || v === "jeopardy_game") {
    return TASK_TYPES.JEOPARDY;
  }

  // Fallback: if already a canonical value, keep it
  if (Object.values(TASK_TYPES).includes(v)) return v;

  return null;
}

/**
 * POST /api/ai/tasksets
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

      // New / current shape from AiTasksetGenerator
      difficulty,
      learningGoal,
      topicDescription = "", // "Special considerations" from UI
      topicTitle = "",       // Task set title: main topic
      totalDurationMinutes,
      durationMinutes,
      numberOfTasks,
      presenterProfile,
      aiWordBank,

      // Session / room context
      tasksetName: explicitName,
      roomLocation,
      locationCode,
      isFixedStationTaskset,
      displays,
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
      });

    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Invalid payload: " + errors.join(", ") });
    }

    const safeCount = Math.max(4, Math.min(20, requestedCount || 8));

    // ------------- Resolve allowed task types -------------
    const rawSelected =
      (Array.isArray(selectedTypes) && selectedTypes) ||
      (Array.isArray(req.body.requiredTaskTypes) && req.body.requiredTaskTypes) ||
      [];

    let typePool;

    if (rawSelected.length > 0) {
      const normalized = rawSelected
        .map(normalizeSelectedType)
        .filter(Boolean)
        .filter((t) => AI_ELIGIBLE_TYPES.includes(t));
      typePool = normalized.length ? normalized : CORE_TYPES;
    } else {
      typePool = CORE_TYPES;
    }

    // ------------- Presenter lenses / perspectives -------------
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

    // ------------- Vocabulary / word bank -------------
    let rawWordBank = [];
    if (Array.isArray(aiWordBank)) {
      rawWordBank = aiWordBank;
    } else if (typeof aiWordBank === "string") {
      rawWordBank = aiWordBank
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);
    }

    // If the UI somehow sent nothing, still guard here
    if (!rawWordBank.length) {
      return res.status(400).json({
        error:
          "Vocabulary / key terms are required. The AI needs at least one term to stay on topic.",
      });
    }

    const vocabularyText = rawWordBank.map((w) => `- ${w}`).join("\n");

    // ------------- Topic & subject discipline -------------
    const titleTrimmed = (topicTitle || explicitName || "").trim();
    const topicLabel =
      titleTrimmed ||
      `${subject || "Lesson"} – Grade ${gradeLevel || "?"} review`;

    const specialConsiderations = (topicDescription || "").trim();
    const customNotes = (customInstructions || "").trim();

    const normalizedSubject = (subject || "").toString().toLowerCase();

    // Allow religious content ONLY if the subject actually is Bible / Religion, etc.
    const subjectIsReligious = /bible|religion|religious|christian|faith/.test(
      normalizedSubject
    );

    const religiousGuardrail = subjectIsReligious
      ? ""
      : `
You MUST NOT introduce religious, Bible, theological, or spiritual content,
and you MUST NOT write about unrelated subjects. Stay strictly within the
given subject and topic.`.trim();

    // ------------- Build per-type guidelines from TASK_TYPE_META -------------
    const typeGuidelines = typePool
      .map((t) => {
        const meta = TASK_TYPE_META[t] || {};
        const label = meta.label || t;
        const desc = meta.description || "";
        return `- "${t}" (${label}): ${desc}`;
      })
      .join("\n");

    // ------------- System & user prompts -------------
    const systemPrompt = `
You are an expert classroom teacher using Curriculate, a station-based task system.

Your job:
- Generate short, engaging, curriculum-aligned tasks for the given grade, subject, and topic.
- Use ONLY the allowed task types provided.
- Obey all constraints and special considerations from the teacher.
- Use the vocabulary list as the core of the topic—do not drift.

${religiousGuardrail}

For each allowed taskType, follow these guidelines:
${typeGuidelines}
`.trim();

    const vocabSection = `
Vocabulary / key terms for this task set.
These define the boundaries of the topic. Do NOT generate tasks unrelated
to these terms.

${vocabularyText}
`.trim();

    const considerationsSection = specialConsiderations
      ? `
Special considerations from the teacher (these constrain style or emphasis,
but do NOT change the core topic):

${specialConsiderations}
`.trim()
      : "";

    const lensesSection =
      lensesText && lensesText !== "none specified"
        ? `
Curricular lenses / perspectives to emphasize (when natural):

${lensesText}
`.trim()
        : "";

    const taskTypeList = typePool.join(", ");

    const userPrompt = `
Create ${safeCount} tasks for the following class:

- Subject: ${subject}
- Grade level: ${gradeLevel}
- Difficulty: ${normDifficulty}
- Learning goal: ${normGoal}
- Topic / unit: ${topicLabel}
- Approx lesson duration (minutes): ${duration}

${vocabSection}

${considerationsSection}

${lensesSection}

Rules:
- All tasks MUST be directly about the topic and vocabulary above.
- Use the vocabulary terms throughout the set; every term should appear in at least one task.
- Do NOT introduce off-topic content.
- Use ONLY these taskType values (no others): ${taskTypeList}
- For "${TASK_TYPES.MULTIPLE_CHOICE}":
  - Provide 3–5 options (short, student-friendly).
  - correctAnswer is the ZERO-BASED index of the correct option.
- For "${TASK_TYPES.TRUE_FALSE}":
  - options should be ["True", "False"].
  - correctAnswer is the ZERO-BASED index (0 for True, 1 for False).
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
      model: process.env.AI_TASKSET_MODEL || "gpt-4o-mini",
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
      console.error("AI taskset JSON parse error:", err, raw.slice(0, 500));
      return res.status(500).json({
        error: "AI returned invalid JSON for taskset",
      });
    }

    if (!Array.isArray(aiTasks) || aiTasks.length === 0) {
      return res
        .status(500)
        .json({ error: "AI returned no tasks for this request" });
    }

    // ---------- Normalize AI tasks into TaskSet schema ----------
    const tasks = aiTasks.slice(0, safeCount).map((t, index) => {
      const rawType = (t.taskType || "").toString().toLowerCase();

      let taskType = TASK_TYPES.SHORT_ANSWER;
      if (typePool.includes(rawType)) {
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
      } else if (
        taskType === TASK_TYPES.SORT ||
        taskType === TASK_TYPES.SEQUENCE
      ) {
        // Keep options as-is for ordering tasks
      } else {
        // For short-answer, photo, creative, etc., we usually don't need options
        if (taskType !== TASK_TYPES.SORT && taskType !== TASK_TYPES.SEQUENCE) {
          options = [];
        }
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
          typeof correctAnswer === "string" && correctAnswer.trim().length
            ? correctAnswer.trim()
            : null;
      } else {
        // Non-objective types: ignore any stray correctAnswer
        correctAnswer = null;
      }

      const timeLimitSeconds =
        Number(t.timeLimitSeconds) && Number(t.timeLimitSeconds) > 0
          ? Number(t.timeLimitSeconds)
          : 60;

      const points =
        Number(t.points) && Number(t.points) > 0 ? Number(t.points) : 10;

      const canAutoScore =
        correctAnswer !== null && correctAnswer !== undefined;

      const aiScoringRequired = !canAutoScore;

      return {
        taskId: `ai-${index + 1}`,
        title: t.title || `${topicLabel} – Task ${index + 1}`,
        prompt:
          t.prompt ||
          `Answer this question about ${topicLabel}.`,
        taskType,
        options,
        correctAnswer,
        aiScoringRequired,
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

    // ---------- Word-bank usage analysis ----------
    let aiWordsUsed = [];
    let aiWordsUnused = [];

    if (rawWordBank.length && Array.isArray(tasks)) {
      const allText = tasks
        .map((t) => `${t.title || ""} ${t.prompt || ""}`)
        .join(" ")
        .toLowerCase();

      aiWordsUsed = rawWordBank.filter((w) =>
        allText.includes(String(w).toLowerCase())
      );
      aiWordsUnused = rawWordBank.filter(
        (w) => !allText.includes(String(w).toLowerCase())
      );
    }

    const now = new Date();

    const finalName = explicitName || topicLabel;

    const tasksetDoc = new TaskSet({
      name: finalName,
      description: specialConsiderations || "",
      subject,
      gradeLevel,
      difficulty: normDifficulty,
      learningGoal: normGoal,
      tasks,
      displays: Array.isArray(displays) ? displays : [],
      meta: {
        source: "ai",
        sourceConfig: {
          aiWordBank: rawWordBank,
          aiWordsUsed,
          aiWordsUnused,
          topicTitle,
        },
      },
      requiredTaskTypes: typePool,
      totalDurationMinutes: duration,
      createdAt: now,
      updatedAt: now,
      roomLocation: roomLocation || locationCode || "Classroom",
      isFixedStationTaskset:
        !!isFixedStationTaskset ||
        (Array.isArray(displays) && displays.length > 0),
    });

    await tasksetDoc.save();

    return res.json({
      ok: true,
      taskset: tasksetDoc.toObject(),
      tasksetId: tasksetDoc._id,
    });
  } catch (err) {
    console.error("AI Taskset generation failed:", err);
    return res.status(500).json({
      error: "Failed to generate taskset",
      details: err.message || String(err),
    });
  }
};

export default { generateAiTaskset };
