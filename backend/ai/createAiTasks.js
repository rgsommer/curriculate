// backend/ai/createAiTasks.js
// Stage 2: Turn (concept + taskType) plan into full Curriculate tasks.

import OpenAI from "openai";
import { TASK_TYPE_LABELS } from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI builds complete task objects for Curriculate.
 *
 * Supports two signatures for backwards compatibility:
 *
 *   // OLD:
 *   createAiTasks(subject, plan, context?)
 *
 *   // NEW:
 *   createAiTasks({
 *     subject,
 *     taskPlan,
 *     gradeLevel,
 *     difficulty,
 *     learningGoal,
 *     durationMinutes,
 *     topicTitle,
 *     curriculumLenses,
 *   })
 *
 * @returns {Promise<Array<object>>}
 */
export async function createAiTasks(subjectOrConfig, maybePlan, maybeContext) {
  let subject;
  let plan;
  let context;

  // -----------------------------
  // Signature detection
  // -----------------------------
  if (
    typeof subjectOrConfig === "string" ||
    typeof subjectOrConfig === "undefined"
  ) {
    // OLD STYLE: (subject, plan, context)
    subject = subjectOrConfig || "General";
    plan = Array.isArray(maybePlan) ? maybePlan : [];
    context = maybeContext || {};
  } else if (
    subjectOrConfig &&
    typeof subjectOrConfig === "object" &&
    !Array.isArray(subjectOrConfig)
  ) {
    // NEW STYLE: (configObject)
    const cfg = subjectOrConfig;
    subject = cfg.subject || "General";
    plan = Array.isArray(cfg.taskPlan || cfg.plan)
      ? cfg.taskPlan || cfg.plan
      : [];
    context = {
      gradeLevel: cfg.gradeLevel,
      difficulty: cfg.difficulty,
      learningGoal: cfg.learningGoal,
      durationMinutes: cfg.durationMinutes,
      topicTitle: cfg.topicTitle,
      curriculumLenses: cfg.curriculumLenses,
    };
  } else {
    // Fallback – very defensive
    subject = "General";
    plan = [];
    context = {};
  }

  const {
    gradeLevel = "Grade 7",
    difficulty = "MEDIUM",
    learningGoal = "REVIEW",
    durationMinutes = 45,
    topicTitle = "",
    curriculumLenses = [],
  } = context;

  const subjectLabel = subject || "General";

  const taskTypeDescription = Object.entries(TASK_TYPE_LABELS || {})
    .map(([value, label]) => `- ${value}: ${label}`)
    .join("\n");

  const systemPrompt = `
You are the Curriculate Task Architect, an expert at creating station-based classroom tasks.

Your job:
- Receive a subject, a grade level, and a "plan" listing concepts with a chosen taskType.
- For EACH plan entry, generate ONE high-quality, classroom-ready task.
- Follow the Curriculate task schema exactly.

CONTEXT:
- Subject: ${subjectLabel}
- Grade: ${gradeLevel}
- Difficulty: ${difficulty}
- Learning goal: ${learningGoal}
- Lesson duration (approx): ${durationMinutes} minutes
- Topic title (optional): ${topicTitle || "(none provided)"}

TASK TYPES:
The platform understands these taskType values:
${taskTypeDescription}

GENERAL RULES:
- All tasks must be achievable at a physical station in a classroom.
- Use clear, student-facing language (no meta-comments about AI).
- Ground tasks in the given subject and concepts; no random trivia.
- Vary cognitive level: recall, understanding, application, analysis, creativity.
- Avoid extremely long prompts; students should be able to grasp instructions quickly.
- If a taskType implies movement or creativity, lean into that style.
- If a taskType implies analysis, include "why/how" or compare/contrast thinking.

CURRICULATE TASK SCHEMA (RAW):
For each concept you MUST generate an object shaped like:

{
  "title": "Short task title, e.g. 'MC: Treaty of Utrecht'",
  "prompt": "Student-facing instructions, 1–3 short sentences",
  "taskType": "one of the taskType values from the plan",
  "options": [],
  "correctAnswer": null,
  "recommendedTimeSeconds": number,
  "recommendedPoints": number
}

You MUST return valid JSON with this shape ONLY:

{
  "tasks": [
    { ...taskObject as above... }
  ]
}
  `.trim();

  const userPrompt = {
    subject: subjectLabel,
    gradeLevel,
    difficulty,
    learningGoal,
    durationMinutes,
    topicTitle,
    curriculumLenses,
    plan,
  };

  const completion = await client.chat.completions.create({
    model: process.env.AI_TASK_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPrompt) },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[createAiTasks] Failed to parse JSON:", raw);
    parsed = {};
  }

  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return tasks;
}
