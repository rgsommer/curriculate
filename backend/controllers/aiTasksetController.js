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

const MULTI_ITEM_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.multiItemCapable)
  .map(([type]) => type);

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

function normalizeSelectedType(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/_/g, "-");

  if (v === "multiple-choice" || v === "multiplechoice" || v === "mcq" || v === "mc")
    return TASK_TYPES.MULTIPLE_CHOICE;
  if (v === "true-false" || v === "truefalse" || v === "tf")
    return TASK_TYPES.TRUE_FALSE;
  if (v === "short-answer" || v === "shortanswer" || v === "sa")
    return TASK_TYPES.SHORT_ANSWER;
  if (v === "open-text" || v === "open_text" || v === "open")
    return TASK_TYPES.OPEN_TEXT;
  if (v === "sort" || v === "categorize" || v === "sort-task")
    return TASK_TYPES.SORT;
  if (v === "sequence" || v === "timeline" || v === "order")
    return TASK_TYPES.SEQUENCE;
  if (v === "photo" || v === "photo-evidence" || v === "photo_description")
    return TASK_TYPES.PHOTO;
  if (
    v === "make-and-snap" ||
    v === "make_and_snap" ||
    v === "makeandsnap"
  )
    return TASK_TYPES.MAKE_AND_SNAP;
  if (v === "body-break" || v === "body_break") return TASK_TYPES.BODY_BREAK;
  if (v === "brain-blitz" || v === "jeopardy" || v === "jeopardy_game")
    return TASK_TYPES.JEOPARDY;
  if (v === "collaboration" || v === "collab" || v === "pair-discussion")
    return TASK_TYPES.COLLABORATION;
  if (v === "diff-detective" || v === "spot-the-difference" || v === "diff")
    return TASK_TYPES.DIFF_DETECTIVE;
  if (v === "mind-mapper" || v === "mind_mapper") return TASK_TYPES.MIND_MAPPER;
  if (v === "flashcards") return TASK_TYPES.FLASHCARDS;
  if (v === "brain-spark-notes" || v === "brain_spark_notes")
    return TASK_TYPES.BRAIN_SPARK_NOTES;

  if (Object.values(TASK_TYPES).includes(v)) return v;
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
- For SORT: put buckets/items under config: { buckets: [...], items: [{ text, bucketIndex|null }] }
- For SEQUENCE: put items under config: { items: [{ text }] }

Return the task in this normalized shape:
{
  "title": "Short title",
  "prompt": "Student-facing instructions",
  "taskType": "${allowedType}",
  "options": [],
  "correctAnswer": null,
  "items": [],
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

Return ONLY valid JSON in this exact format (no backticks, no extra text):
[
  {
    "title": "Short title",
    "prompt": "Student-facing instructions / question or mini-quiz heading.",
    "taskType": "multiple-choice",
    "options": ["Option A", "Option B"],
    "correctAnswer": 0,
    "timeLimitSeconds": 60,
    "points": 10,
    "items": [],
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
      const multiItemCapable = !!meta.multiItemCapable;

      let options = Array.isArray(t.options) ? t.options : [];
      let config = null;
      let items = [];
      let correctAnswer = t.correctAnswer ?? null;

      // MULTIPLE CHOICE (multi-item capable)
      if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
        if (multiItemCapable && Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `q${idx + 1}`;
            const iprompt =
              (it.prompt && String(it.prompt).trim()) ||
              (it.question && String(it.question).trim()) ||
              (it.text && String(it.text).trim()) ||
              `Question ${idx + 1}`;

            let ioptions = Array.isArray(it.options) ? it.options : [];
            if (ioptions.length < 2) ioptions = ["Option A", "Option B"];

            let icorrect = it.correctAnswer ?? null;
            if (typeof icorrect === "string") {
              const idxMatch = ioptions.findIndex(
                (opt) => String(opt).trim() === icorrect.trim()
              );
              icorrect = idxMatch >= 0 ? idxMatch : 0;
            } else if (Number.isInteger(icorrect)) {
              if (icorrect < 0 || icorrect >= ioptions.length) icorrect = 0;
            } else {
              icorrect = 0;
            }

            return { id, prompt: iprompt, options: ioptions, correctAnswer: icorrect };
          });

          options = [];
          correctAnswer = null;
        } else {
          if (options.length < 2) options = ["Option A", "Option B"];
          // normalize correctAnswer to index
          if (typeof correctAnswer === "string") {
            const idx = options.findIndex(
              (opt) => String(opt).trim() === correctAnswer.trim()
            );
            correctAnswer = idx >= 0 ? idx : 0;
          } else if (Number.isInteger(correctAnswer)) {
            if (correctAnswer < 0 || correctAnswer >= options.length) correctAnswer = 0;
          } else {
            correctAnswer = 0;
          }
        }
      }

      // TRUE / FALSE (single or multi-item)
      else if (taskType === TASK_TYPES.TRUE_FALSE) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        if (multiItemCapable && Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `tf${idx + 1}`;
            const iprompt =
              (it.prompt && String(it.prompt).trim()) ||
              (it.question && String(it.question).trim()) ||
              (it.text && String(it.text).trim()) ||
              `Statement ${idx + 1}`;

            const ioptions = ["True", "False"];

            let icorrect = it.correctAnswer ?? it.answer ?? it.correct ?? null;
            if (typeof icorrect === "string") {
              const lower = icorrect.trim().toLowerCase();
              icorrect = lower === "false" ? 1 : 0;
            } else if (Number.isInteger(icorrect)) {
              icorrect = icorrect === 1 ? 1 : 0;
            } else {
              // if AI omitted, still default (objective scoring needs a value)
              icorrect = 0;
            }

            return { id, prompt: iprompt, options: ioptions, correctAnswer: icorrect };
          });

          options = [];
          correctAnswer = null;
          config = aiConfig && Object.keys(aiConfig).length ? aiConfig : null;
        } else {
          options = ["True", "False"];

          if (!isNonEmptyString(t.prompt)) {
            // ensure something displays
            t.prompt = isNonEmptyString(t.title)
              ? `${t.title} — True or False?`
              : "Decide whether the statement is True or False.";
          }

          // normalize correctAnswer
          if (typeof correctAnswer === "string") {
            const lower = correctAnswer.trim().toLowerCase();
            correctAnswer = lower === "false" ? 1 : 0;
          } else if (Number.isInteger(correctAnswer)) {
            correctAnswer = correctAnswer === 1 ? 1 : 0;
          } else if (correctAnswer == null) {
            // set a safe default so objective scoring works
            correctAnswer = 0;
          }

          config = aiConfig && Object.keys(aiConfig).length ? aiConfig : null;
        }
      }

      // SORT (retry instead of downgrade)
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
          .filter((x) => x.text);

        const candidateCfg = { ...aiConfig, buckets, items: sortItems };

        // If invalid, mark for retry and ship a minimal valid placeholder (still SORT).
        if (!sortConfigIsValid(candidateCfg)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.SORT;

          const safeBuckets =
            buckets.length >= 2 ? buckets.slice(0, 2) : ["Group A", "Group B"];

          // Use word bank terms for placeholder items when possible
          const safeItems = (sortItems.length ? sortItems : rawWordBank.slice(0, 3).map((w) => ({ text: String(w), bucketIndex: null })))
            .slice(0, 3);

          config = { ...aiConfig, buckets: safeBuckets, items: safeItems };
        } else {
          config = candidateCfg;
        }

        options = [];
        items = [];
        correctAnswer = null;
      }

      // SEQUENCE (retry instead of downgrade)
      else if (taskType === TASK_TYPES.SEQUENCE) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawItems =
          Array.isArray(aiConfig.items) ? aiConfig.items
          : Array.isArray(aiConfig.steps) ? aiConfig.steps
          : Array.isArray(aiConfig.events) ? aiConfig.events
          : Array.isArray(aiConfig.sequence) ? aiConfig.sequence
          : Array.isArray(t.items) ? t.items
          : Array.isArray(t.steps) ? t.steps
          : Array.isArray(t.events) ? t.events
          : Array.isArray(t.options) ? t.options
          : [];

        const seqItems = rawItems
          .map((it, idx) => {
            if (typeof it === "string") return { text: it.trim() };
            if (it && typeof it === "object") {
              const text = it.text || it.label || it.name || it.prompt || `Step ${idx + 1}`;
              return { text: String(text).trim() };
            }
            return { text: String(it || `Step ${idx + 1}`).trim() };
          })
          .filter((x) => x.text);

        const candidateCfg = { ...aiConfig, items: seqItems };

        if (!sequenceConfigIsValid(candidateCfg)) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.SEQUENCE;

          // placeholder (still SEQUENCE) with at least 3 items
          const safeItems =
            seqItems.length >= 3
              ? seqItems.slice(0, 3)
              : rawWordBank.slice(0, 3).map((w, i) => ({ text: String(w || `Step ${i + 1}`).trim() })) ||
                [{ text: "Step 1" }, { text: "Step 2" }, { text: "Step 3" }];

          config = { ...aiConfig, items: safeItems.slice(0, 3) };
        } else {
          config = candidateCfg;
        }

        options = [];
        items = [];
        correctAnswer = null;
      }

      // SHORT ANSWER (multi-item capable)
      else if (taskType === TASK_TYPES.SHORT_ANSWER) {
        if (multiItemCapable && Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `sa${idx + 1}`;
            const iprompt =
              (it.prompt && String(it.prompt).trim()) ||
              (it.question && String(it.question).trim()) ||
              `Prompt ${idx + 1}`;

            let icorrect = it.correctAnswer ?? null;
            icorrect = typeof icorrect === "string" ? icorrect.trim() : null;

            return { id, prompt: iprompt, correctAnswer: icorrect };
          });
        }

        if (typeof correctAnswer !== "string") correctAnswer = null;
        else correctAnswer = correctAnswer.trim() || null;
      }

      // JEOPARDY / BRAIN BLITZ (robust clue normalization)
      else if (taskType === TASK_TYPES.JEOPARDY) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawClues =
          (Array.isArray(t.clues) && t.clues.length && t.clues) ||
          (Array.isArray(aiConfig.clues) && aiConfig.clues.length && aiConfig.clues) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          (Array.isArray(t.questions) && t.questions.length && t.questions) ||
          (Array.isArray(t.prompts) && t.prompts.length && t.prompts) ||
          [];

        let clues = rawClues.map((cl, idx) => {
          // string → clue text only
          if (typeof cl === "string") {
            return { clue: cl.trim(), answer: "" };
          }

          if (cl && typeof cl === "object") {
            const clueText =
              cl.clue ||
              cl.prompt ||
              cl.question ||
              cl.text ||
              cl.title ||
              `Clue ${idx + 1}`;

            let answer = cl.answer ?? cl.correctAnswer ?? "";
            if (Array.isArray(answer)) answer = answer[0] ?? "";
            if (typeof answer !== "string") answer = String(answer || "");

            return {
              clue: String(clueText).trim(),
              answer: answer.trim(),
            };
          }

          return { clue: `Clue ${idx + 1}`, answer: "" };
        });

        // 🔒 FINAL SAFETY NET: ensure at least 3 clues
        if (clues.length < 3) {
          clues = [
            { clue: "Review the key idea from the lesson.", answer: "" },
            { clue: "Recall an important term or concept.", answer: "" },
            { clue: "Explain one fact related to this topic.", answer: "" },
          ];
        }

        t.clues = clues;
        options = [];
        items = [];
        correctAnswer = null;
      }

      // BRAIN SPARK NOTES (bullets)
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
        correctAnswer = null;
      }

      // MIND MAPPER normalize into config.items
      else if (taskType === TASK_TYPES.MIND_MAPPER) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.options)
          ? t.options
          : [];

        const mappedItems = rawItems.map((it, idx) => {
          if (typeof it === "string") return { text: it, correctIndex: idx };
          if (it && typeof it === "object") {
            const text =
              it.text || it.label || it.name || it.prompt || `Idea ${idx + 1}`;
            let correctIndex = it.correctIndex;
            if (typeof correctIndex !== "number") correctIndex = idx;
            return { text: String(text), correctIndex };
          }
          return { text: String(it), correctIndex: idx };
        });

        config = { ...aiConfig, items: mappedItems };
        options = [];
        correctAnswer = null;
      }

      // FLASHCARDS
      let cards = null;
      if (taskType === TASK_TYPES.FLASHCARDS) {
        const rawCards =
          (Array.isArray(t.cards) && t.cards.length ? t.cards
          : Array.isArray(t.items) && t.items.length ? t.items
          : []) || [];

        cards = rawCards.map((c, idx) => {
          if (!c || (typeof c !== "object" && typeof c !== "string")) {
            return { question: `Card ${idx + 1}`, answer: "" };
          }
          if (typeof c === "string") return { question: c, answer: "" };

          const question = c.question || c.prompt || c.clue || `Card ${idx + 1}`;
          let answer = c.answer ?? c.correctAnswer ?? "";
          if (Array.isArray(answer)) answer = answer[0] ?? "";
          if (typeof answer !== "string") answer = String(answer || "");

          return { question: String(question), answer: answer.trim() };
        });

        options = [];
        correctAnswer = null;
      }

      // Diff Detective
      let originalText = null;
      let modifiedText = null;
      let differences = null;

      if (taskType === TASK_TYPES.DIFF_DETECTIVE) {
        originalText = t.original ? String(t.original) : "";
        modifiedText = t.modified ? String(t.modified) : "";

        const rawDiffs = Array.isArray(t.differences) ? t.differences : [];
        differences = rawDiffs.map((d) => {
          if (!d || typeof d !== "object")
            return { expected: String(d || ""), hint: null };
          return {
            expected: d.expected ? String(d.expected) : "",
            hint:
              typeof d.hint === "string" && d.hint.trim() ? d.hint.trim() : null,
          };
        });

        options = [];
        correctAnswer = null;
        config = null;
        items = [];
      }

      const title =
        isNonEmptyString(t.title) ? String(t.title).trim().slice(0, 120) : `Task ${index + 1}`;

      let prompt =
        isNonEmptyString(t.prompt)
          ? String(t.prompt).trim()
          : multiItemCapable && Array.isArray(items) && items.length
          ? "Answer each of the questions below."
          : "Follow the instructions given by your teacher.";

      const timeLimitSeconds = Number.isFinite(t.timeLimitSeconds)
        ? clampInt(t.timeLimitSeconds, 10, 600, null)
        : null;

      const points = Number.isFinite(t.points) ? clampInt(t.points, 1, 50, 10) : 10;

      // AI scoring requirement
      const objective = meta.objectiveScoring === true;
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
        config,
        items,
        ...(taskType === TASK_TYPES.FLASHCARDS && { cards }),
        ...(taskType === TASK_TYPES.DIFF_DETECTIVE && {
          original: originalText,
          modified: modifiedText,
          differences,
        }),
        ...(taskType === TASK_TYPES.JEOPARDY && { clues: Array.isArray(t.clues) ? t.clues : [] }),
        ...(taskType === TASK_TYPES.BRAIN_SPARK_NOTES && { bullets: Array.isArray(t.bullets) ? t.bullets : [] }),
      };

      // carry retry flags (temporary; removed before save)
      if (t.__needsRetry) {
        out.__needsRetry = true;
        out.__retryType = t.__retryType;
      }

      return out;
    });

    // --- Targeted retry pass for SORT/SEQUENCE (no downgrades) ---
    const retryMustHave = {
      [TASK_TYPES.SORT]:
        "SORT must include config.buckets (at least 2) and config.items (at least 3), each item as { text, bucketIndex: number|null }.",
      [TASK_TYPES.SEQUENCE]:
        "SEQUENCE must include config.items (at least 3), each item as { text }.",
    };

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t.__needsRetry) continue;

      const allowedType = t.__retryType;
      if (allowedType !== TASK_TYPES.SORT && allowedType !== TASK_TYPES.SEQUENCE) continue;

      const mustHave = retryMustHave[allowedType] || "Produce a valid task for this type.";

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

          // sanitize & accept only if valid
          const regenCfg =
            regenerated?.config && typeof regenerated.config === "object"
              ? regenerated.config
              : {};

          if (allowedType === TASK_TYPES.SORT) {
            const buckets = Array.isArray(regenCfg.buckets) ? regenCfg.buckets : [];
            const items = Array.isArray(regenCfg.items) ? regenCfg.items : [];
            const fixedCfg = {
              buckets: buckets.map((b) => String(b || "").trim()).filter(Boolean),
              items: items
                .map((it) => ({
                  text: String(it?.text || "").trim(),
                  bucketIndex:
                    typeof it?.bucketIndex === "number" ? it.bucketIndex : null,
                }))
                .filter((it) => it.text),
            };

            if (sortConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.SORT,
                config: { ...(regenCfg || {}), ...fixedCfg },
                options: [],
                items: [],
                correctAnswer: null,
              };
              break;
            }
          }

          if (allowedType === TASK_TYPES.SEQUENCE) {
            const rawItems = Array.isArray(regenCfg.items) ? regenCfg.items : [];
            const fixedItems = rawItems
              .map((it, idx) => {
                if (typeof it === "string") return { text: it.trim() };
                if (it && typeof it === "object") {
                  const text = it.text || it.label || it.name || it.prompt || `Step ${idx + 1}`;
                  return { text: String(text).trim() };
                }
                return { text: String(it || `Step ${idx + 1}`).trim() };
              })
              .filter((x) => x.text);

            const fixedCfg = { items: fixedItems };

            if (sequenceConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title) ? String(regenerated.title).trim().slice(0, 120) : t.title,
                prompt: isNonEmptyString(regenerated?.prompt) ? String(regenerated.prompt).trim() : t.prompt,
                taskType: TASK_TYPES.SEQUENCE,
                config: { ...(regenCfg || {}), items: fixedItems },
                options: [],
                items: [],
                correctAnswer: null,
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

    // Word-bank usage analysis
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
