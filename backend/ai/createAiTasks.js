// backend/ai/createAiTasks.js
// Stage 2: Turn (concept + taskType) plan into full Curriculate tasks.

import OpenAI from "openai";
import {
  TASK_TYPES,
  TASK_TYPE_LABELS,
} from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI builds complete task objects for Curriculate.
 *
 * @param {string} subject
 * @param {Array<{ concept: string, taskType: string, reason?: string }>} plan
 * @param {object} context
 * @param {string} [context.gradeLevel]
 * @param {string} [context.difficulty]
 * @param {string} [context.learningGoal]
 * @param {number} [context.durationMinutes]
 * @param {string} [context.topicTitle]
 * @returns {Promise<Array<object>>}
 */
export async function createAiTasks(subject, plan, context = {}) {
  const {
    gradeLevel = "Grade 7",
    difficulty = "MEDIUM",
    learningGoal = "REVIEW",
    durationMinutes = 45,
    topicTitle = "",
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
  "options": [
    // For multiple-choice, sequence, sort and similar:
    //   multiple-choice → 3–5 options, one clearly best
    //   sequence → 3–6 steps that will later be ordered
    //   sort → 3–6 items that can be grouped somehow
    // For open-text, body-break, make-and-snap, etc., this is usually []
  ],
  "correctAnswer": null or number or string,
  //   multiple-choice → index (0-based) of the correct option
  //   sequence/sort → null or short string hint
  //   other → usually null or short ideal answer
  "recommendedTimeSeconds": number,
  // rough guidance:
  //   MC / short-answer: ~45–90
  //   open-text: ~120–180
  //   make-and-snap / photo: ~120–180
  //   body-break / movement: ~45–90
  "recommendedPoints": number
  // rough guidance:
  //   MC: ~10
  //   sequence / sort: ~12
  //   creative tasks: ~12–15
  //   physical tasks: ~8–10
  //   quick inputs: ~8–10
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
    plan,
  };

  const completion = await client.chat.completions.create({
    model: "gpt-5.1",
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
