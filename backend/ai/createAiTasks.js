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
  const base = {
    taskType,
    title,
    prompt,
    timeLimitSeconds: 60,
    points: 10,
  };

  // Brain-blitz needs a clues array of objects to pass validation.
  if (taskType === "brain-blitz") {
    const word = concept || "vocabulary";
    base.prompt = "Guess each term from the clue!";
    base.clues = [
      { clue: `A key concept related to ${word}`, answer: word },
      { clue: `Another important term about ${word}`, answer: word },
    ];
  }

  return base;
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
- CRITICAL: NEVER use placeholder text. Every item, option, clue, left/right entry, question, and answer MUST contain real subject-matter content drawn from the subject, topic, and concept. NEVER write "Term 1", "Term 2", "Definition 1", "Option A", "Item 1", "Left 1", "Right 1", or any other generic filler. If you do not have enough content, invent plausible age-appropriate content for the subject.

Task-type-specific rules:
- draw-mime: MUST include a "clues" array of EXACTLY 4 unique short clues (1-3 words each, max 5 words).
  Each clue is a single concept to draw or mime (e.g. "gravity", "water cycle", "Abraham Lincoln").
  Set "prompt" to clues[0]. Do NOT put instructions in prompt — only the first clue word(s).
  Example: { "taskType":"draw-mime", "title":"Draw or Mime: Key Concepts", "prompt":"gravity", "clues":["gravity","photosynthesis","water cycle","food chain"] }
- sequence: MUST include an "items" array of 6-10 strings in the CORRECT order. Each item is a real, specific step or event — NEVER "Step 1", "Step 2", "Event A", or any placeholder. Write the actual historical/scientific steps in plain language.
  Set "prompt" to the question asking students to order them (e.g. "Put these events in chronological order.").
  Also include "correctOrder" as the array of ids ["seq1","seq2","seq3","seq4"] matching the correct order.
  Example: { "taskType":"sequence", "title":"Journey of a Missionary", "prompt":"Put the following steps in the correct order to show the typical journey of a missionary.", "items":["Feels a calling to serve","Attends missionary training","Travels to assigned location","Builds relationships with locals","Returns home to share experiences"] }
- sort: MUST include a "categories" array with 2-3 category objects, each having "label" and "items" array.
  Example: { "taskType":"sort", "title":"Sort by Category", "prompt":"Sort these items into the correct categories.", "categories":[{"label":"Fruits","items":["apple","banana"]},{"label":"Vegetables","items":["carrot","broccoli"]}] }
- short-answer: MUST include "items" array with 4-8 objects, each having "prompt" (the question) and "correctAnswer" (expected answer string).
  Example: { "taskType":"short-answer", "title":"Key Terms", "prompt":"Answer each question.", "items":[{"id":"q1","prompt":"What was the main export?","correctAnswer":"fur"},{"id":"q2","prompt":"Who led the expedition?","correctAnswer":"Samuel de Champlain"}] }
- matching: MUST include "leftItems" array and "rightItems" array (5-7 items each) plus a "correctMatches" object mapping left IDs to right IDs.
  Each item is an object with "id" and "text". Use L1,L2,... for left IDs and R1,R2,... for right IDs.
  NEVER use placeholder text like "Term 1", "Definition 2", "Left 1", "Right 1" — every "text" value MUST be a real vocabulary word, name, concept, or definition drawn from the subject.
  Example: { "taskType":"matching", "title":"Match Terms to Definitions", "prompt":"Connect each word on the left to its correct meaning on the right.", "leftItems":[{"id":"L1","text":"Obedience"},{"id":"L2","text":"Faith"},{"id":"L3","text":"Grace"},{"id":"L4","text":"Covenant"},{"id":"L5","text":"Repentance"}], "rightItems":[{"id":"R1","text":"Following God's commands"},{"id":"R2","text":"Trust in what is unseen"},{"id":"R3","text":"Unmerited favor from God"},{"id":"R4","text":"A sacred agreement"},{"id":"R5","text":"Turning away from sin"}], "correctMatches":{"L1":"R1","L2":"R2","L3":"R3","L4":"R4","L5":"R5"} }
- brain-blitz: MUST include a "clues" array of 6-8 OBJECTS, each with { "clue": "descriptive hint", "answer": "vocabulary word" }. Every clue MUST have a DIFFERENT unique answer word. Answers must be vocabulary words or concepts, NEVER computed numbers, decimals, or formulas. Do NOT include a top-level "correctAnswer" field.
  Example: { "taskType":"brain-blitz", "title":"Math Vocabulary Blitz", "prompt":"Guess the math term from the clue!", "clues":[{"clue":"The result of adding two numbers","answer":"sum"},{"clue":"A number multiplied by itself","answer":"square"},{"clue":"The bottom number of a fraction","answer":"denominator"},{"clue":"A shape with three sides","answer":"triangle"},{"clue":"The distance around a circle","answer":"circumference"},{"clue":"An equation showing two ratios are equal","answer":"proportion"}] }
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
      model: process.env.AI_MODEL || "gpt-4.1-mini",
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
      console.warn("Primary model unavailable — falling back to gpt-4.1-mini");
      completion = await client.chat.completions.create({
        model: "gpt-4.1-mini",
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
