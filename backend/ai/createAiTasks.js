// backend/ai/createAiTasks.js
// Stage 2: Turn (concept + taskType) plan into full Curriculate tasks.

import OpenAI from "openai";
import { TASK_TYPE_LABELS } from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI builds complete task objects for Curriculate.
 * @returns {Promise<Array<object>>}
 */
export async function createAiTasks(subjectOrConfig, maybePlan, maybeContext) {
  // … (your existing signature detection code – unchanged) …
  // ← keep everything up to the systemPrompt exactly as you had it

  let subject;
  let plan;
  let context;

  if (typeof subjectOrConfig === "string" || typeof subjectOrConfig === "undefined") {
    subject = subjectOrConfig || "General";
    plan = Array.isArray(maybePlan) ? maybePlan : [];
    context = maybeContext || {};
  } else if (subjectOrConfig && typeof subjectOrConfig === "object" && !Array.isArray(subjectOrConfig)) {
    const cfg = subjectOrConfig;
    subject = cfg.subject || "General";
    plan = Array.isArray(cfg.taskPlan || cfg.plan) ? cfg.taskPlan || cfg.plan : [];
    context = {
      gradeLevel: cfg.gradeLevel,
      difficulty: cfg.difficulty,
      learningGoal: cfg.learningGoal,
      durationMinutes: cfg.durationMinutes,
      topicTitle: cfg.topicTitle,
      curriculumLenses: cfg.curriculumLenses,
    };
  } else {
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

  const systemPrompt = `…`; // ← your long system prompt (unchanged)

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

  // ──────────────────────────────────────────────────────────────
  // Main change starts here – try GPT-5.1, fall back to gpt-4o-mini
  // ──────────────────────────────────────────────────────────────
  let completion;
  const preferredModel = process.env.AI_TASK_MODEL || "gpt-5.1";

  try {
    completion = await client.chat.completions.create({
      model: preferredModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a JSON API. Respond only with valid JSON." }, 
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPrompt) },
      ],
    });
  } catch (openaiErr) {
    if (
      openaiErr.message?.includes("model does not exist") ||
      openaiErr.message?.includes("insufficient_quota") ||
      openaiErr.status === 404 ||
      openaiErr.status === 429
    ) {
      console.warn(`Model "${preferredModel}" unavailable – falling back to gpt-4o-mini`);
      completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPrompt) },
        ],
      });
    } else {
      console.error("OpenAI error:", openaiErr);
      throw openaiErr; // re-throw unexpected errors
    }
  }

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