// backend/ai/createAiTasks.js
// Stage 2: Turn (concept + taskType) plan into full Curriculate tasks.
//
// Option A: taskValidators.js is the single source of truth for task schemas.
// This file generates best-effort raw tasks and then delegates canonicalization
// + validation (and playability hardening) to taskValidators.

import OpenAI from "openai";
import { TASK_TYPE_LABELS } from "../../shared/taskTypes.js";
import { normalizeAndValidateTask } from "../validators/taskValidators.js";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[createAiTasks] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}
const client = new Proxy({}, { get: (_, prop) => getClient()[prop] });

function asString(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function parseGradeNumber(gradeLevel) {
  // Accept: "Grade 7", "7", 7, "G7", etc.
  const s = asString(gradeLevel).trim();
  const m = s.match(/(\d{1,2})/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : 8;
}

function normalizeDifficulty(d) {
  const up = asString(d || "MEDIUM").trim().toUpperCase();
  if (up === "EASY" || up === "MEDIUM" || up === "HARD") return up;
  return "MEDIUM";
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const i = Math.round(x);
  return Math.min(max, Math.max(min, i));
}

function cleanJson(raw) {
  const s = asString(raw).trim();
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/g, "")
    .replace(/```$/g, "")
    .trim();
}

function buildMinimalFallbackRawTask(planEntry, ctx, index) {
  const taskType = asString(planEntry?.taskType || "short-answer").trim();
  const concept = asString(planEntry?.concept || planEntry?.topic || planEntry?.word || "").trim();
  const label = asString(TASK_TYPE_LABELS?.[taskType] || taskType).trim();

  const title = concept ? `${label}: ${concept}` : `Task ${index + 1}`;
  const prompt = concept ? `Answer using the concept: ${concept}.` : "Answer clearly using one specific detail.";

  // Intentionally minimal: validator will canonicalize per task type.
  return {
    taskType,
    title,
    prompt,
    timeLimitSeconds: 60,
    points: 10,
  };
}

/**
 * AI builds complete task objects for Curriculate.
 *
 * Supports two signatures for backwards compatibility:
 *   createAiTasks(subject, plan, context?)
 *   createAiTasks({ subject, taskPlan, gradeLevel, difficulty, learningGoal, durationMinutes, topicTitle, curriculumLenses })
 */
export async function createAiTasks(subjectOrConfig, maybePlan, maybeContext) {
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
    plan = Array.isArray(cfg.taskPlan || cfg.plan) ? (cfg.taskPlan || cfg.plan) : [];
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

  const gradeLevel = context.gradeLevel || "Grade 7";
  const gradeNum = parseGradeNumber(gradeLevel);
  const difficulty = normalizeDifficulty(context.difficulty);
  const learningGoal = context.learningGoal || "REVIEW";
  const durationMinutes = context.durationMinutes || 45;
  const topicTitle = context.topicTitle || "";
  const curriculumLenses = Array.isArray(context.curriculumLenses) ? context.curriculumLenses : [];

  const subjectLabel = subject || "General";

  // Keep the model prompt generic. The validator enforces exact schemas.
  const systemPrompt = `
You are the Curriculate Task Architect.

You will be given:
- Subject, grade level, difficulty, learning goal, optional topic title
- A PLAN array. Each entry includes at least: { concept, taskType }

You MUST generate ONE task object per PLAN entry.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [ ... ]
}

Rules:
- Task count MUST equal plan.length.
- taskType MUST match each plan entry's taskType exactly.
- Each task must include at least:
  - title: non-empty string
  - prompt: non-empty string
  - taskType: string
- For task types with structured fields (items/options/config), include the correct fields for that type.
- Keep prompts concise and classroom-station friendly.
- Do NOT include markdown or code fences.
- No extra wrapper keys besides { "tasks": [...] }.
  `.trim();

  const userPrompt = {
    subject: subjectLabel,
    gradeLevel,
    gradeNum,
    difficulty,
    learningGoal,
    durationMinutes,
    topicTitle,
    curriculumLenses,
    plan,
  };

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: process.env.AI_TASK_MODEL || "gpt-5.1",
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
      openaiErr.message?.includes("insufficient_quota")
    ) {
      console.warn("Primary model unavailable — falling back to gpt-4o-mini");
      completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a JSON API. Respond only with valid JSON." },
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPrompt) },
        ],
      });
    } else {
      throw openaiErr;
    }
  }

  const raw = completion?.choices?.[0]?.message?.content || "{}";
  const cleanRaw = cleanJson(raw);

  let parsed = {};
  try {
    parsed = JSON.parse(cleanRaw);
  } catch {
    parsed = {};
  }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const ctx = { gradeLevel, gradeNum, difficulty, learningGoal, durationMinutes, topicTitle, curriculumLenses };

  // Reconcile EXACTLY to plan length. Plan entries are authoritative.
  const out = [];
  const failures = [];

  for (let i = 0; i < plan.length; i++) {
    const planEntry = plan[i] || {};
    const wantedType = asString(planEntry?.taskType || "short-answer").trim();

    const aiTask = rawTasks[i];
    const candidate =
      aiTask && typeof aiTask === "object"
        ? { ...aiTask, taskType: wantedType } // force plan authority
        : buildMinimalFallbackRawTask(planEntry, ctx, i);

    // Delegate strict schema + canonicalization to taskValidators.
    const r1 = normalizeAndValidateTask(wantedType, candidate, { requirePlayable: true });

    if (r1.ok) {
      out.push(r1.normalizedTask);
      continue;
    }

    // Retry with minimal fallback.
    const fallback = buildMinimalFallbackRawTask(planEntry, ctx, i);
    const r2 = normalizeAndValidateTask(wantedType, fallback, { requirePlayable: true });

    if (r2.ok) {
      out.push(r2.normalizedTask);
      continue;
    }

    failures.push({
      index: i,
      taskType: wantedType,
      concept: asString(planEntry?.concept || planEntry?.topic || planEntry?.word || ""),
      errors: [...(r1.errors || []), ...(r2.errors || [])],
    });
  }

  if (failures.length) {
    const msg =
      "AI task schema invalid: " +
      failures
        .map((f) => `#${f.index + 1} (${f.taskType}) ${f.errors.join("; ")}`)
        .join(" | ");
    const err = new Error(msg);
    err.details = failures;
    throw err;
  }

  // Light bounds (do not override per-type validators; just keep nonsense out).
  for (const t of out) {
    if (typeof t.timeLimitSeconds !== "undefined") {
      t.timeLimitSeconds = clampInt(t.timeLimitSeconds, 10, 3600, 60);
    }
    if (typeof t.points !== "undefined") {
      t.points = clampInt(t.points, 0, 1000, 10);
    }
  }

  return out;
}
