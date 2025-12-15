// backend/controllers/aiTasksetController.js
import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Build a list of implemented, AI-eligible task types
const AI_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(
    ([type, meta]) =>
      meta.implemented !== false &&
      meta.aiEligible !== false &&
      meta.generatorEligible !== false &&
      type !== TASK_TYPES.HIDENSEEK
  )
  .map(([type]) => type);

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
 * IMPORTANT: robust normalization:
 * - lower
 * - underscores -> hyphen
 * - whitespace -> hyphen
 * - strip punctuation
 * Example: "Brain Blitz!" => "brain-blitz"
 */
function normalizeSelectedType(raw) {
  if (!raw) return null;

  const v = String(raw)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, ""); // strip punctuation like !, ?, etc.

  if (v === "multiple-choice" || v === "multiplechoice" || v === "mcq" || v === "mc")
    return TASK_TYPES.MULTIPLE_CHOICE;
  if (v === "true-false" || v === "truefalse" || v === "tf")
    return TASK_TYPES.TRUE_FALSE;
  if (v === "short-answer" || v === "shortanswer" || v === "sa")
    return TASK_TYPES.SHORT_ANSWER;
  if (v === "open-text" || v === "opentext" || v === "open")
    return TASK_TYPES.OPEN_TEXT;

  if (v === "sort" || v === "categorize" || v === "sort-task")
    return TASK_TYPES.SORT;

  if (v === "sequence" || v === "timeline" || v === "order")
    return TASK_TYPES.SEQUENCE;

  if (v === "brain-blitz" || v === "brainblitz" || v === "jeopardy" || v === "jeopardy-game" || v === "jeopardy_game")
    return TASK_TYPES.JEOPARDY;

  if (v === "brain-spark-notes" || v === "brainsparknotes" || v === "brain_spark_notes")
    return TASK_TYPES.BRAIN_SPARK_NOTES;

  if (v === "mind-mapper" || v === "mindmapper" || v === "mind_mapper")
    return TASK_TYPES.MIND_MAPPER;

  if (v === "flashcards") return TASK_TYPES.FLASHCARDS;
  if (v === "diff-detective" || v === "spot-the-difference" || v === "diff")
    return TASK_TYPES.DIFF_DETECTIVE;

  if (v === "photo") return TASK_TYPES.PHOTO;
  if (v === "photo-journal" || v === "photojournal") return TASK_TYPES.PHOTO_JOURNAL;
  if (v === "draw-or-mime" || v === "drawormime") return TASK_TYPES.DRAW_OR_MIME;
  if (v === "body-break" || v === "bodybreak") return TASK_TYPES.BODY_BREAK;

  return null;
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function sortConfigIsValid(cfg) {
  const buckets = Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  return buckets.length >= 2 && items.length >= 3;
}

function sequenceConfigIsValid(cfg) {
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  return items.length >= 3;
}

function tfItemsAreValid(items) {
  return Array.isArray(items) && items.length >= 3 && items.every((it) => isNonEmptyString(it?.prompt));
}

function mcItemsAreValid(items) {
  return (
    Array.isArray(items) &&
    items.length >= 3 &&
    items.every(
      (it) =>
        isNonEmptyString(it?.prompt) &&
        Array.isArray(it?.options) &&
        it.options.length >= 2 &&
        Number.isInteger(it?.correctAnswer) &&
        it.correctAnswer >= 0 &&
        it.correctAnswer < it.options.length
    )
  );
}

function cluesAreValid(clues) {
  return Array.isArray(clues) && clues.length >= 3 && clues.every((c) => isNonEmptyString(c?.clue));
}

// Targeted regeneration for one broken task (same type, more content)
async function regenerateSingleTask({
  allowedType,
  mustHave,
  subject,
  gradeLevel,
  difficulty,
  learningGoal,
  topicLabel,
  vocabularyLines,
  specialConsiderations,
  previousTask,
}) {
  const sys = `
You generate exactly ONE classroom task for Curriculate.
Return ONLY valid JSON for a single task object (no markdown, no backticks, no extra text).
`.trim();

  const prev = JSON.stringify(previousTask || {}, null, 2);

  const user = `
Create ONE task of type "${allowedType}" ONLY.

Class:
- Subject: ${subject}
- Grade: ${gradeLevel}
- Difficulty: ${difficulty}
- Learning goal: ${learningGoal}
- Topic/unit: ${topicLabel}

Vocabulary / key terms (stay within these):
${vocabularyLines}

Special considerations (if any):
${specialConsiderations || "none"}

Hard requirements:
- ${mustHave}
- Provide a short title and a clear student prompt.
- TRUE_FALSE multi-item must include "items": [{ "id": "...", "prompt": "...", "correctAnswer": 0|1 }]
- SORT must include config: { buckets: [...], items: [{ text, bucketIndex|null }] }
- SEQUENCE must include config: { items: [{ text }] }
- JEOPARDY (BrainBlitz) must include clues: [{ clue, answer }]
- MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions (each with prompt, options[], correctAnswer index).

Return the task in this normalized shape:
{
  "title": "Short title",
  "prompt": "Student-facing instructions",
  "taskType": "${allowedType}",
  "options": [],
  "correctAnswer": null,
  "items": [],
  "clues": [],
  "config": {}
}

Previous FAILED attempt (for reference only; do not repeat its mistakes):
${prev}
`.trim();

  const completion = await client.chat.completions.create({
    model: process.env.AI_TASKSET_MODEL || "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 900,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";
  return JSON.parse(raw);
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

      // New / current shape
      difficulty,
      learningGoal,
      topicDescription = "",
      topicTitle = "",
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
    const duration = Number(totalDurationMinutes) || Number(durationMinutes) || 45;

    const { errors, difficulty: normDifficulty, learningGoal: normGoal } =
      validateGeneratePayload({ subject, gradeLevel, difficulty, learningGoal });

    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Invalid payload: " + errors.join(", ") });
    }

    const safeCount = clampInt(requestedCount, 4, 20, 8);

    // Resolve allowed task types
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

    // Presenter lenses / perspectives
    let lenses = [];
    if (presenterProfile?.curriculumLenses?.length)
      lenses = presenterProfile.curriculumLenses;
    else if (presenterProfile?.perspectives?.length)
      lenses = presenterProfile.perspectives;
    const lensesText = lenses.length ? lenses.join(", ") : "none specified";

    // Vocabulary / word bank
    let rawWordBank = [];
    if (Array.isArray(aiWordBank)) rawWordBank = aiWordBank;
    else if (typeof aiWordBank === "string") {
      rawWordBank = aiWordBank
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);
    }

    if (!rawWordBank.length) {
      return res.status(400).json({
        error:
          "Vocabulary / key terms are required. The AI needs at least one term to stay on topic.",
      });
    }

    const vocabularyLines = rawWordBank.map((w) => `- ${w}`).join("\n");

    const titleTrimmed = (topicTitle || explicitName || "").trim();
    const topicLabel =
      titleTrimmed || `${subject || "Lesson"} – Grade ${gradeLevel || "?"} review`;

    const specialConsiderations = (topicDescription || "").trim();
    const customNotes = (customInstructions || "").trim();

    // ---- Allowed types summary for the model ----
    const typeGuidelines = typePool
      .map((t) => {
        const meta = TASK_TYPE_META[t] || {};
        const label = meta.label || t;
        const desc = meta.description || "";
        return `- "${t}" (${label}): ${desc}`;
      })
      .join("\n");

    const systemPrompt = `
You are an expert classroom teacher using Curriculate, a station-based task system.

Your job:
- Generate short, engaging, curriculum-aligned tasks for the given grade, subject, and topic.
- Use ONLY the allowed task types provided.
- Obey all constraints and special considerations from the teacher.
- Use the vocabulary list as the core of the topic—do not drift.

For each allowed taskType, follow these guidelines:
${typeGuidelines}
`.trim();

    const lensesSection =
      lensesText && lensesText !== "none specified"
        ? `\nCurricular lenses / perspectives to emphasize (when natural):\n${lensesText}\n`
        : "";

    const considerationsSection =
      specialConsiderations || customNotes
        ? `\nSpecial considerations:\n${specialConsiderations || ""}\n${customNotes || ""}\n`
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

Vocabulary / key terms (stay within these):
${vocabularyLines}

${considerationsSection}
${lensesSection}

Rules:
- Mix of the allowed taskTypes only: ${taskTypeList}.
- Each task has a short clear title and a prompt that students will see.
- For SORT tasks: include config.buckets (>=2) and config.items (>=3) with {text, bucketIndex|null}
- For SEQUENCE tasks: include config.items (>=3) with {text}
- For JEOPARDY/BrainBlitz tasks: include clues (>=3) with {clue, answer}
- MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions (each with prompt, options[], correctAnswer index).
- TRUE_FALSE multi-item: include items[] with >=3 statements when prompt says "each statement".

Return ONLY valid JSON in this exact format (no backticks, no extra text):
[
  {
    "title": "Short title",
    "prompt": "Student-facing instructions",
    "taskType": "multiple-choice",
    "options": ["Option A", "Option B"],
    "correctAnswer": 0,
    "timeLimitSeconds": 60,
    "points": 10,
    "items": [],
    "clues": [],
    "config": {}
  }
]
`.trim();

    const completion = await client.chat.completions.create({
      model: process.env.AI_TASKSET_MODEL || "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 2200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";

    let aiTasks;
    try {
      aiTasks = JSON.parse(raw);
    } catch (err) {
      console.error("AI taskset JSON parse error:", err, raw.slice(0, 800));
      return res
        .status(500)
        .json({ error: "AI returned invalid JSON for taskset" });
    }

    if (!Array.isArray(aiTasks) || aiTasks.length === 0) {
      return res.status(500).json({ error: "AI returned no tasks" });
    }

    // ---------- Normalize AI tasks into TaskSet schema ----------
    const tasks = aiTasks.slice(0, safeCount).map((t, index) => {
      const rawTypeToken = t.taskType || t.type || "";
      const normalizedFromAi = normalizeSelectedType(rawTypeToken);

      let taskType = TASK_TYPES.SHORT_ANSWER;

      if (normalizedFromAi && typePool.includes(normalizedFromAi)) {
        taskType = normalizedFromAi;
      } else if (typeof rawTypeToken === "string") {
        const lowered = rawTypeToken.toString().trim().toLowerCase();
        if (typePool.includes(lowered)) taskType = lowered;
        else if (typePool.length === 1) taskType = typePool[0];
      }

      const meta = TASK_TYPE_META[taskType] || {};
      const objective = meta.objectiveScoring === true;

      let options = Array.isArray(t.options) ? t.options : [];
      let config = t.config && typeof t.config === "object" ? t.config : {};
      let items = Array.isArray(t.items) ? t.items : [];
      let clues = Array.isArray(t.clues) ? t.clues : [];
      // Initialize correctAnswer early (some branches set it before the final normalization step)
      let correctAnswer = t.correctAnswer ?? null;

      // -------- MULTIPLE CHOICE normalization (single vs multi) --------
      if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
        if (Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `q${idx + 1}`;
            const prompt =
              (it.prompt && String(it.prompt).trim()) ||
              (it.question && String(it.question).trim()) ||
              (it.text && String(it.text).trim()) ||
              `Question ${idx + 1}`;

            let ioptions = Array.isArray(it.options) ? it.options : [];
            if (ioptions.length < 2) ioptions = ["Option A", "Option B"];

            let correctAnswer = it.correctAnswer ?? 0;
            if (typeof correctAnswer === "string") {
              const idxMatch = ioptions.findIndex(
                (opt) => String(opt).trim() === correctAnswer.trim()
              );
              correctAnswer = idxMatch >= 0 ? idxMatch : 0;
            } else if (!Number.isInteger(correctAnswer)) {
              correctAnswer = 0;
            } else if (correctAnswer < 0 || correctAnswer >= ioptions.length) {
              correctAnswer = 0;
            }

            return { id, prompt, options: ioptions, correctAnswer };
          });

        // If AI gave too few questions, retry (no downgrade) and ship safe placeholders
        if (!mcItemsAreValid(items)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.MULTIPLE_CHOICE;

          // pad to minimum 3 so editor/student isn't blank even before retry succeeds
          const padded = Array.isArray(items) ? [...items] : [];
          while (padded.length < 3) {
            const i = padded.length + 1;
            padded.push({
              id: `q${i}`,
              prompt: `Question ${i}`,
              options: ["Option A", "Option B"],
              correctAnswer: 0,
            });
          }
          items = padded.slice(0, 5);
        }

          options = [];
       } else {
        // AI returned a single MC (no items[]) — force retry to get 3–5 multi-items
        t.__needsRetry = true;
        t.__retryType = TASK_TYPES.MULTIPLE_CHOICE;

        // ship safe placeholders immediately so editor/student isn't stuck
        items = [
          { id: "q1", prompt: "Question 1", options: ["Option A", "Option B"], correctAnswer: 0 },
          { id: "q2", prompt: "Question 2", options: ["Option A", "Option B"], correctAnswer: 0 },
          { id: "q3", prompt: "Question 3", options: ["Option A", "Option B"], correctAnswer: 0 },
        ];

        options = [];
        correctAnswer = null;
      }
      }

      // -------- TRUE/FALSE normalization (single vs multi) --------
      else if (taskType === TASK_TYPES.TRUE_FALSE) {
        // We want AI-generated TRUE/FALSE to be multi-item (3–5 statements).
        // Accept a few common shapes, then normalize into items[] = [{id,prompt,options,correctAnswer}]
        const rawItems =
          (Array.isArray(t.items) && t.items.length && t.items) ||
          (Array.isArray(t.statements) && t.statements.length && t.statements) ||
          (Array.isArray(t.questions) && t.questions.length && t.questions) ||
          (Array.isArray(t.prompts) && t.prompts.length && t.prompts) ||
          [];

        if (rawItems.length) {
          items = rawItems
            .map((it, idx) => {
              const id = it?.id || `tf${idx + 1}`;
              const prompt =
                (it?.prompt && String(it.prompt).trim()) ||
                (it?.statement && String(it.statement).trim()) ||
                (it?.question && String(it.question).trim()) ||
                (it?.text && String(it.text).trim()) ||
                `Statement ${idx + 1}`;

              let ca = it?.correctAnswer ?? it?.answer ?? it?.correct ?? it?.isTrue ?? 0;

              // Normalize correctAnswer:
              // - index: 0=True, 1=False
              // - string: "true"/"false"
              // - boolean: true/false
              if (typeof ca === "boolean") {
                ca = ca ? 0 : 1;
              } else if (typeof ca === "string") {
                const lower = ca.trim().toLowerCase();
                ca = lower === "false" ? 1 : 0;
              } else if (Number.isInteger(ca)) {
                ca = ca === 1 ? 1 : 0;
              } else {
                ca = 0;
              }

              return { id, prompt, options: ["True", "False"], correctAnswer: ca };
            })
            .filter((it) => isNonEmptyString(it.prompt))
            .slice(0, 5);

          options = [];
        } else {
          // No items returned → force retry. (But still ship safe placeholders so editor/student UI isn't empty.)
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.TRUE_FALSE;

          const safe = rawWordBank.slice(0, 5).map((w, i) => ({
            id: `tf${i + 1}`,
            prompt: `True or False: ${String(w || `Statement ${i + 1}`)}`,
            options: ["True", "False"],
            correctAnswer: 0,
          }));

          items = safe.length
            ? safe
            : [
                { id: "tf1", prompt: "True or False: Review the key idea from the lesson.", options: ["True", "False"], correctAnswer: 0 },
                { id: "tf2", prompt: "True or False: Recall an important term from the unit.", options: ["True", "False"], correctAnswer: 0 },
                { id: "tf3", prompt: "True or False: Identify one fact related to today's topic.", options: ["True", "False"], correctAnswer: 0 },
              ];

          options = [];
        }

        // If items are still not valid (e.g., <3), mark for retry (no downgrade) and pad.
        if (!tfItemsAreValid(items)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.TRUE_FALSE;

          const padded = Array.isArray(items) ? [...items] : [];
          while (padded.length < 3) {
            const i = padded.length + 1;
            padded.push({
              id: `tf${i}`,
              prompt: `True or False: Statement ${i}`,
              options: ["True", "False"],
              correctAnswer: 0,
            });
          }
          items = padded.slice(0, 5);
          options = [];
        }

        // TRUE/FALSE should not use top-level options/correctAnswer when multi-item
        config = {};
        correctAnswer = null;
      }

      // -------- SORT normalization --------

      else if (taskType === TASK_TYPES.SORT) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawBuckets = Array.isArray(aiConfig.buckets)
          ? aiConfig.buckets
          : Array.isArray(aiConfig.categories)
          ? aiConfig.categories
          : Array.isArray(t.buckets)
          ? t.buckets
          : Array.isArray(t.categories)
          ? t.categories
          : [];

        const buckets = rawBuckets
          .map((b, i) => {
            if (typeof b === "string") return b.trim();
            if (b && typeof b === "object")
              return String(b.label || b.name || b.title || `Category ${i + 1}`).trim();
            return `Category ${i + 1}`;
          })
          .filter(Boolean);

        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(aiConfig.sortItems)
          ? aiConfig.sortItems
          : Array.isArray(aiConfig.events)
          ? aiConfig.events
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.sortItems)
          ? t.sortItems
          : Array.isArray(t.events)
          ? t.events
          : [];

        const sortItems = rawItems
          .map((it, idx) => {
            if (typeof it === "string") return { text: it.trim(), bucketIndex: null };

            if (it && typeof it === "object") {
              const text = String(
                it.text || it.label || it.name || it.prompt || `Item ${idx + 1}`
              ).trim();

              let bucketIndex =
                typeof it.bucketIndex === "number"
                  ? it.bucketIndex
                  : typeof it.bucket === "number"
                  ? it.bucket
                  : typeof it.categoryIndex === "number"
                  ? it.categoryIndex
                  : null;

              if (
                typeof bucketIndex === "number" &&
                (bucketIndex < 0 || bucketIndex >= buckets.length)
              ) {
                bucketIndex = null;
              }

              return { text, bucketIndex };
            }

            return { text: String(it || `Item ${idx + 1}`).trim(), bucketIndex: null };
          })
          .filter((x) => isNonEmptyString(x.text));

        const candidateCfg = { ...aiConfig, buckets, items: sortItems };

        if (!sortConfigIsValid(candidateCfg)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.SORT;

          const safeBuckets = buckets.length >= 2 ? buckets.slice(0, 2) : ["Group A", "Group B"];
          const safeItems =
            sortItems.length >= 3
              ? sortItems.slice(0, 3)
              : rawWordBank.slice(0, 3).map((w) => ({ text: String(w), bucketIndex: null }));

          config = { ...aiConfig, buckets: safeBuckets, items: safeItems };
        } else {
          config = candidateCfg;
        }

        options = [];
        items = [];
      }

      // -------- SEQUENCE normalization --------
      else if (taskType === TASK_TYPES.SEQUENCE) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawSeq =
          Array.isArray(aiConfig.items) ? aiConfig.items
          : Array.isArray(aiConfig.steps) ? aiConfig.steps
          : Array.isArray(aiConfig.events) ? aiConfig.events
          : Array.isArray(aiConfig.sequence) ? aiConfig.sequence
          : Array.isArray(t.items) ? t.items
          : Array.isArray(t.steps) ? t.steps
          : Array.isArray(t.events) ? t.events
          : [];

        const seqItems = rawSeq
          .map((it, idx) => {
            if (typeof it === "string") return { text: it.trim() };
            if (it && typeof it === "object") {
              const text = it.text || it.label || it.name || it.prompt || `Step ${idx + 1}`;
              return { text: String(text).trim() };
            }
            return { text: String(it || `Step ${idx + 1}`).trim() };
          })
          .filter((x) => isNonEmptyString(x.text));

        const candidateCfg = { ...aiConfig, items: seqItems };

        if (!sequenceConfigIsValid(candidateCfg)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.SEQUENCE;

          const safeItems =
            seqItems.length >= 3
              ? seqItems.slice(0, 3)
              : rawWordBank.slice(0, 3).map((w, i) => ({
                  text: String(w || `Step ${i + 1}`).trim(),
                }));

          config = { ...aiConfig, items: safeItems };
        } else {
          config = candidateCfg;
        }

        options = [];
        items = [];
      }

      // -------- JEOPARDY / BRAIN BLITZ normalization --------
      else if (taskType === TASK_TYPES.JEOPARDY) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawClues =
          (Array.isArray(t.clues) && t.clues.length && t.clues) ||
          (Array.isArray(aiConfig.clues) && aiConfig.clues.length && aiConfig.clues) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          (Array.isArray(t.questions) && t.questions.length && t.questions) ||
          (Array.isArray(t.prompts) && t.prompts.length && t.prompts) ||
          [];

        let normalized = rawClues
          .map((cl, idx) => {
            if (typeof cl === "string") return { clue: cl.trim(), answer: "" };
            if (cl && typeof cl === "object") {
              const clueText =
                cl.clue || cl.prompt || cl.question || cl.text || cl.title || `Clue ${idx + 1}`;
              let answer = cl.answer ?? cl.correctAnswer ?? "";
              if (Array.isArray(answer)) answer = answer[0] ?? "";
              if (typeof answer !== "string") answer = String(answer || "");
              return { clue: String(clueText).trim(), answer: answer.trim() };
            }
            return { clue: `Clue ${idx + 1}`, answer: "" };
          })
          .filter((c) => isNonEmptyString(c.clue));

        if (!cluesAreValid(normalized)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.JEOPARDY;

          // safe placeholder (still JEOPARDY)
          normalized =
            rawWordBank.slice(0, 3).map((w, i) => ({
              clue: String(w || `Clue ${i + 1}`),
              answer: "",
            })) || [
              { clue: "Review the key idea from the lesson.", answer: "" },
              { clue: "Recall an important term or concept.", answer: "" },
              { clue: "Explain one fact related to this topic.", answer: "" },
            ];
        }

        clues = normalized;
        t.clues = normalized;

        options = [];
        items = [];
      }

      // -------- BRAIN SPARK NOTES normalization --------
      else if (taskType === TASK_TYPES.BRAIN_SPARK_NOTES) {
        const rawBullets =
          (Array.isArray(t.bullets) && t.bullets.length && t.bullets) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          [];

        const bullets = rawBullets
          .map((b, idx) => {
            if (typeof b === "string") return b.trim();
            if (b && typeof b === "object") {
              const text =
                b.text || b.prompt || b.title || b.note || b.description || `Note ${idx + 1}`;
              return String(text).trim();
            }
            return String(b || `Note ${idx + 1}`).trim();
          })
          .filter(Boolean);

        t.bullets = bullets;
        options = [];
        items = [];
      }

      // -------- Mind Mapper normalization (keeps config.items) --------
      else if (taskType === TASK_TYPES.MIND_MAPPER) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.options)
          ? t.options
          : [];

        const mapped = rawItems.map((it, idx) => {
          if (typeof it === "string") return { text: it, correctIndex: idx };
          if (it && typeof it === "object") {
            const text = it.text || it.label || it.name || it.prompt || `Idea ${idx + 1}`;
            let correctIndex = it.correctIndex;
            if (typeof correctIndex !== "number") correctIndex = idx;
            return { text: String(text), correctIndex };
          }
          return { text: String(it), correctIndex: idx };
        });

        config = { ...aiConfig, items: mapped };
        options = [];
        items = [];
      }

      // ---- Titles / prompts / timers / points ----
      const title =
        isNonEmptyString(t.title) ? String(t.title).trim().slice(0, 120) : `Task ${index + 1}`;

      const prompt =
        isNonEmptyString(t.prompt)
          ? String(t.prompt).trim()
          : "Follow the instructions given by your teacher.";

      const timeLimitSeconds = Number.isFinite(t.timeLimitSeconds)
        ? clampInt(t.timeLimitSeconds, 10, 600, null)
        : null;

      const points = Number.isFinite(t.points) ? clampInt(t.points, 1, 50, 10) : 10;

      // --- correctAnswer normalization for single MC/TF objective types ---
      // correctAnswer already initialized above
      if (
        (taskType === TASK_TYPES.MULTIPLE_CHOICE || taskType === TASK_TYPES.TRUE_FALSE) &&
        options.length > 0
      ) {
        if (typeof correctAnswer === "string") {
          const idx = options.findIndex(
            (opt) => String(opt).trim() === correctAnswer.trim()
          );
          correctAnswer = idx >= 0 ? idx : 0;
        } else if (Number.isInteger(correctAnswer)) {
          if (correctAnswer < 0 || correctAnswer >= options.length) correctAnswer = 0;
        } else if (correctAnswer == null) {
          correctAnswer = 0;
        }
      } else if (
        taskType === TASK_TYPES.SORT ||
        taskType === TASK_TYPES.SEQUENCE ||
        taskType === TASK_TYPES.MIND_MAPPER ||
        taskType === TASK_TYPES.JEOPARDY ||
        taskType === TASK_TYPES.BRAIN_SPARK_NOTES
      ) {
        correctAnswer = null;
      }

      // --- aiScoringRequired: objective types default false ---
      let aiScoringRequired;
      if (typeof t.aiScoringRequired === "boolean") aiScoringRequired = t.aiScoringRequired;
      else if (objective) aiScoringRequired = false;
      else if (typeof meta.defaultAiScoringRequired === "boolean")
        aiScoringRequired = meta.defaultAiScoringRequired;
      else aiScoringRequired = true;

      const out = {
        index,
        title,
        prompt,
        taskType,
        options,
        correctAnswer,
        aiScoringRequired,
        timeLimitSeconds,
        points,
        config: config && Object.keys(config).length ? config : {},
        items,
      };

      if (taskType === TASK_TYPES.JEOPARDY) out.clues = clues;

      // carry retry flags (temporary; removed before save)
      if (t.__needsRetry) {
        out.__needsRetry = true;
        out.__retryType = t.__retryType;
      }

      return out;
    });

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t.__needsRetry) continue;

      const allowedType = t.__retryType;
      const mustHave = retryMustHave[allowedType] || "Produce a valid task.";

      let replaced = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const regenerated = await regenerateSingleTask({
            allowedType,
            mustHave,
            subject,
            gradeLevel,
            difficulty: normDifficulty,
            learningGoal: normGoal,
            topicLabel,
            vocabularyLines,
            specialConsiderations: specialConsiderations || customNotes || "",
            previousTask: t,
          });

          const regenType = normalizeSelectedType(regenerated?.taskType || allowedType) || allowedType;

          // Accept only if it returns same intended type
          if (regenType !== allowedType) continue;

          // Normalize minimal pieces for validity checks
          if (allowedType === TASK_TYPES.SORT) {
            const cfg = regenerated?.config && typeof regenerated.config === "object" ? regenerated.config : {};
            const buckets = Array.isArray(cfg.buckets) ? cfg.buckets.map((b) => String(b || "").trim()).filter(Boolean) : [];
            const items = Array.isArray(cfg.items)
              ? cfg.items
                  .map((it) => ({
                    text: String(it?.text || "").trim(),
                    bucketIndex: typeof it?.bucketIndex === "number" ? it.bucketIndex : null,
                  }))
                  .filter((it) => it.text)
              : [];

            const fixedCfg = { ...cfg, buckets, items };

            if (sortConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.SORT,
                options: [],
                correctAnswer: null,
                aiScoringRequired: t.aiScoringRequired,
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: fixedCfg,
                items: [],
              };
              break;
            }
          }

          if (allowedType === TASK_TYPES.SEQUENCE) {
            const cfg = regenerated?.config && typeof regenerated.config === "object" ? regenerated.config : {};
            const rawItems = Array.isArray(cfg.items) ? cfg.items : [];
            const fixedItems = rawItems
              .map((it, idx) => {
                if (typeof it === "string") return { text: it.trim() };
                if (it && typeof it === "object") {
                  const text = it.text || it.label || it.name || it.prompt || `Step ${idx + 1}`;
                  return { text: String(text).trim() };
                }
                return { text: String(it || `Step ${idx + 1}`).trim() };
              })
              .filter((x) => isNonEmptyString(x.text));

            const fixedCfg = { ...cfg, items: fixedItems };

            if (sequenceConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.SEQUENCE,
                options: [],
                correctAnswer: null,
                aiScoringRequired: t.aiScoringRequired,
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: fixedCfg,
                items: [],
              };
              break;
            }
          }

          if (allowedType === TASK_TYPES.TRUE_FALSE) {
            const rawItems = Array.isArray(regenerated?.items) ? regenerated.items : [];
            const fixedItems = rawItems.map((it, idx) => {
              const id = it?.id || `tf${idx + 1}`;
              const prompt = String(it?.prompt || it?.question || it?.text || `Statement ${idx + 1}`).trim();
              let ca = it?.correctAnswer ?? it?.answer ?? 0;
              if (typeof ca === "string") ca = ca.trim().toLowerCase() === "false" ? 1 : 0;
              else if (Number.isInteger(ca)) ca = ca === 1 ? 1 : 0;
              else ca = 0;
              return { id, prompt, options: ["True", "False"], correctAnswer: ca };
            }).filter((it) => isNonEmptyString(it.prompt));

            if (tfItemsAreValid(fixedItems)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.TRUE_FALSE,
                options: [],
                correctAnswer: null,
                aiScoringRequired: false, // objective
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: {},
                items: fixedItems,
              };
              break;
            }
          }

          if (allowedType === TASK_TYPES.JEOPARDY) {
            const rawClues =
              (Array.isArray(regenerated?.clues) && regenerated.clues) ||
              (Array.isArray(regenerated?.config?.clues) && regenerated.config.clues) ||
              (Array.isArray(regenerated?.items) && regenerated.items) ||
              [];

            const fixedClues = rawClues
              .map((cl, idx) => {
                if (typeof cl === "string") return { clue: cl.trim(), answer: "" };
                if (cl && typeof cl === "object") {
                  const clueText = cl.clue || cl.prompt || cl.question || cl.text || `Clue ${idx + 1}`;
                  let answer = cl.answer ?? cl.correctAnswer ?? "";
                  if (Array.isArray(answer)) answer = answer[0] ?? "";
                  if (typeof answer !== "string") answer = String(answer || "");
                  return { clue: String(clueText).trim(), answer: answer.trim() };
                }
                return { clue: `Clue ${idx + 1}`, answer: "" };
              })
              .filter((c) => isNonEmptyString(c.clue));

            if (cluesAreValid(fixedClues)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.JEOPARDY,
                options: [],
                correctAnswer: null,
                aiScoringRequired: true,
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: {},
                items: [],
                clues: fixedClues,
              };
              break;
            }
          }
          if (allowedType === TASK_TYPES.MULTIPLE_CHOICE) {
            const rawItems = Array.isArray(regenerated?.items) ? regenerated.items : [];

            const fixedItems = rawItems
              .map((it, idx) => {
                const id = it?.id || `q${idx + 1}`;
                const prompt = String(
                  it?.prompt || it?.question || it?.text || `Question ${idx + 1}`
                ).trim();

                let options = Array.isArray(it?.options)
                  ? it.options.map((o) => String(o).trim()).filter(Boolean)
                  : [];

                if (options.length < 2) options = ["Option A", "Option B"];

                let ca = it?.correctAnswer ?? 0;
                if (typeof ca === "string") {
                  const k = options.findIndex((o) => o === ca.trim());
                  ca = k >= 0 ? k : 0;
                } else if (!Number.isInteger(ca) || ca < 0 || ca >= options.length) {
                  ca = 0;
                }

                return { id, prompt, options, correctAnswer: ca };
              })
              .filter((it) => isNonEmptyString(it.prompt))
              .slice(0, 5);

            if (mcItemsAreValid(fixedItems)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
                taskType: TASK_TYPES.MULTIPLE_CHOICE,
                options: [],
                correctAnswer: null,
                aiScoringRequired: false,
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: {},
                items: fixedItems,
              };
              break;
            }
          }

        } catch (e) {
          console.error("Task retry failed", {
            index: i,
            attempt,
            type: allowedType,
            error: e?.message || String(e),
          });
        }
      }

      if (replaced) tasks[i] = replaced;

      // always strip internal flags
      delete tasks[i].__needsRetry;
      delete tasks[i].__retryType;
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
          topicTitle,
          notes: customNotes || "",
        },
      },
      requiredTaskTypes: typePool,
      totalDurationMinutes: duration,
      createdAt: now,
      updatedAt: now,
      roomLocation: roomLocation || locationCode || "Classroom",
      isFixedStationTaskset:
        !!isFixedStationTaskset || (Array.isArray(displays) && displays.length > 0),
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