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
      meta.generatorEligible !== false && // NEW: exclude non-generator types (Pronunciation, AI Debate Judge, etc.)
      type !== TASK_TYPES.HIDENSEEK // allow AI scoring but never auto-generate HideNSeek
  )
  .map(([type]) => type);

// Fallback core types if metadata is missing / empty
const CORE_TYPES =
  AI_ELIGIBLE_TYPES && AI_ELIGIBLE_TYPES.length
    ? AI_ELIGIBLE_TYPES
    : [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER];

// Types that can sensibly hold multiple sub-questions ("items") in one task
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
  if (v === "short-answer" || v === "shortanswer" || v === "sa") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "open-text" || v === "open_text" || v === "open") {
    return TASK_TYPES.OPEN_TEXT;
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
  if (
    v === "photo-journal" ||
    v === "photo_journal" ||
    v === "photojournal" ||
    v === "photo-journal-task"
  ) {
    return TASK_TYPES.PHOTO_JOURNAL;
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
  if (v === "collaboration" || v === "collab" || v === "pair-discussion") {
    return TASK_TYPES.COLLABORATION;
  }
  if (
    v === "diff-detective" ||
    v === "spot-the-difference" ||
    v === "diff" ||
    v === "find-differences"
  ) {
    return TASK_TYPES.DIFF_DETECTIVE;
  }
  if (v === "draw-mime" || v === "drawmime" || v === "draw-or-mime") {
    return TASK_TYPES.DRAW_MIME;
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
      topicTitle = "", // Task set title: main topic
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
      (Array.isArray(req.body.requiredTaskTypes) &&
        req.body.requiredTaskTypes) ||
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

    const multiItemTypesList = MULTI_ITEM_TYPES.filter((t) =>
      typePool.includes(t)
    );

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
- Mix of the allowed taskTypes only: ${taskTypeList}.
- Each task has a short clear title and a prompt that students will see.
- Tasks should, whenever possible, reflect the listed curricular lenses
  (for example, by connecting content or examples to that perspective).

For "${TASK_TYPES.MULTIPLE_CHOICE}":
  - Each task may be a SINGLE question or a SHORT SET (mini-quiz) of 3–5 multiple-choice questions.
  - If it is a short set, use an "items" array where each item is:
    {
      "id": "q1",
      "prompt": "Question text",
      "options": ["A", "B", "C"],
      "correctAnswer": 0
    }
  - The top-level "prompt" should still be a brief instruction like
    "Answer each of the following multiple-choice questions."
  - For each question, provide 3–5 options (short strings).
  - For each question, correctAnswer is the ZERO-BASED index of the correct option.

For "${TASK_TYPES.TRUE_FALSE}":
  - Each task may be a SINGLE statement or a SHORT SET of 3–5 True/False statements.
  - If it is a short set, use an "items" array where each item is:
    {
      "id": "s1",
      "prompt": "Statement text",
      "options": ["True", "False"],
      "correctAnswer": 0
    }
  - The top-level "prompt" should be a brief instruction like
    "Decide if each statement is True or False."
  - For each question, options must be ["True", "False"].
  - For each question, correctAnswer is the ZERO-BASED index (0 or 1).

For "${TASK_TYPES.SHORT_ANSWER}":
  - Each task may be a SINGLE prompt or a SHORT SET of 3–5 short-answer prompts.
  - If it is a short set, use an "items" array where each item is:
    {
      "id": "sa1",
      "prompt": "Prompt text",
      "correctAnswer": "reference answer"
    }
  - The top-level "prompt" should be a brief instruction like
    "Answer each question with a word or short phrase."
  - For short-answer tasks, top-level "options" should be an empty array.
  - For each question, correctAnswer is a short reference answer string (or null).

For "${TASK_TYPES.OPEN_TEXT}":
  - Use a SINGLE open-ended prompt that calls for a paragraph-length written response.
  - Do NOT include an "options" array; students will type their own answer.
  - "correctAnswer" should be null (these are evaluated with a rubric / AI scoring).
  - Good uses: short reflections, explanations, or justifications about the topic.

For "${TASK_TYPES.SORT}":
  - Use a "config" object with:
    - "buckets": an array of 2–4 category labels (short strings).
    - "items": an array of 6–10 objects of the form
      { "text": "Item text", "bucketIndex": 0 }
      where bucketIndex is the ZERO-BASED index into "buckets" for the correct category.
  - "options" must be an empty array.
  - "correctAnswer" should be null (sorting is scored from config.items.bucketIndex).

For "${TASK_TYPES.SEQUENCE}":
  - Use a "config" object with:
    - "items": an array of 4–8 objects of the form
      { "text": "Step or event in the correct order" }.
  - The array MUST list the items in the correct logical / chronological order.
  - Students will be given these items in random order and will re-order them.
  - "options" should normally be an empty array.
  - "correctAnswer" should be null (ordering is scored from the full sequence, not a single index).

For "${TASK_TYPES.COLLABORATION}":
  - Use a single open-ended prompt that invites opinion, prediction, explanation,
    or reflection related to the topic.
  - Do NOT include an "options" array; students will type their own answer.
  - "correctAnswer" should be null (these are scored by rubric / AI, not by a single key).
  - Good examples: "Do you agree with this statement? Why or why not?",
    "Predict what might happen next and explain your reasoning.",
    "Explain how this idea would affect people living in X situation."

For "${TASK_TYPES.DIFF_DETECTIVE}":
  - Create a task where students must spot specific differences between two texts
    (or two lists, code snippets, etc.).
  - Provide these fields at the top level:
    - "original": the original passage or list (string).
    - "modified": the changed passage or list (string).
    - "differences": an array of objects, each:
      {
        "expected": "original fragment → changed fragment",
        "hint": "short optional hint for this difference (or null)"
      }
  - "options" should be an empty array.
  - "correctAnswer" should be an array of short strings, one per difference,
    describing each difference succinctly (e.g., "jumps → jumped", "206 → 208").
  - Time limit should be 60–120 seconds depending on difficulty.

For "${TASK_TYPES.FLASHCARDS}":
  - Create a deck of 8–12 flashcards focused on the vocabulary terms.
  - Use a "cards" array where each card is:
    {
      "question": "Short cue or question",
      "answer": "Short word or phrase"
    }
  - Questions should be concise prompts tied directly to the vocabulary.
  - Answers must be short words/phrases, not full paragraphs.
  - Top-level "options" should be an empty array.
  - Top-level "correctAnswer" should be null (each card has its own answer).

For "${TASK_TYPES.JEOPARDY}":
  - Create a Brain Blitz / Jeopardy-style round made of several fast clues.
  - Provide a "clues" array where each clue is:
    {
      "clue": "Text shown to students",
      "answer": "Expected student question in 'What is...?' or 'Who was...?' form"
    }
  - Aim for 4–8 clues per task; all clues must be tightly tied to the vocabulary list.
  - Top-level "options" should be an empty array and "correctAnswer" must be null.
  - The title or prompt can describe the overall round (e.g., "Brain Blitz: Early Explorers").

For "${TASK_TYPES.DRAW_MIME}":
  - Create a single, vivid prompt that invites students to respond with a drawing
    (or act it out, if the teacher chooses).
  - Do NOT include options; students respond with a drawing only.
  - "correctAnswer" must be null.
  - Example: "Draw the water cycle with arrows to show how water moves from
    evaporation to condensation to precipitation."

For "${TASK_TYPES.MIND_MAPPER}":
  - Create a concept-mapping puzzle with 6–10 idea nodes.
  - Provide a "config" object with:
      "items": [
        { "text": "Idea text", "correctIndex": 0 },
        { "text": "Another idea", "correctIndex": 1 },
        ...
      ]
  - The array MUST be in the correct conceptual order.
  - Do NOT shuffle; the StudentApp will handle the randomization.
  - "options" should be an empty array.
  - "correctAnswer" must be null (scoring is based on matching correctIndex).

For "${TASK_TYPES.BRAIN_SPARK_NOTES}":
  - Create a single clear prompt that tells students what key idea or question
    their notes should cover.
  - Provide a "bullets" array of 3–7 short bullet points that students should
    copy into their notebook.
  - Each bullet must be a short, student-friendly sentence or phrase
    (not a full paragraph).
  - Do NOT include an "options" array.
  - "correctAnswer" must be null (these are participation/AI-scored, not right/wrong).
  - Example bullets:
    ["Definition of erosion", "Two real-world examples", "Why it matters"].

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

    // OPTIONAL for multi-question tasks (MC / TF / Short Answer):
    "items": [
      {
        "id": "q1",
        "prompt": "First question",
        "options": ["A", "B", "C"],
        "correctAnswer": 0
      }
    ],

    // OPTIONAL for sort tasks:
    "config": {
      "buckets": ["Category 1", "Category 2"],
      "items": [
        { "text": "Item 1", "bucketIndex": 0 }
      ]
    },

    // OPTIONAL for flashcards:
    // "cards": [
    //   { "question": "Q1", "answer": "A1" }
    // ]

    // OPTIONAL for Brain Spark Notes:
    // "bullets": ["Key idea 1", "Key idea 2"]
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

    console.log("AI RAW TASKS (debug)", JSON.stringify(aiTasks, null, 2));

    // ---------- Normalize AI tasks into TaskSet schema ----------
    const tasks = aiTasks.slice(0, safeCount).map((t, index) => {
      // Try to interpret the AI's taskType using the same normalizer we use for UI input
      const rawTypeToken = t.taskType || t.type || "";
      const normalizedFromAi = normalizeSelectedType(rawTypeToken);

      let taskType = TASK_TYPES.SHORT_ANSWER;

      if (normalizedFromAi && typePool.includes(normalizedFromAi)) {
        taskType = normalizedFromAi;
      } else if (typeof rawTypeToken === "string") {
        // Fallback: use the literal lowercased token if it matches typePool
        const lowered = rawTypeToken.toString().trim().toLowerCase();
        if (typePool.includes(lowered)) {
          taskType = lowered;
        } else if (typePool.length === 1) {
          // As a last resort, if only one type was allowed, trust that.
          taskType = typePool[0];
        }
      }

      const meta = TASK_TYPE_META[taskType] || {};
      const multiItemCapable = !!meta.multiItemCapable;

      // Base options, config, items
      let options = Array.isArray(t.options) ? t.options : [];
      let config = null;
      let items = [];

      // ---------- Options / config / items by type ----------
      if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
        // Normalise multi-item MC, if present
        if (multiItemCapable && Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `q${idx + 1}`;
            const iprompt =
              it.prompt && String(it.prompt).trim()
                ? String(it.prompt).trim()
                : `Question ${idx + 1}`;
            let ioptions = Array.isArray(it.options) ? it.options : [];
            if (ioptions.length < 2) {
              ioptions = ["Option A", "Option B"];
            }

            let icorrect = it.correctAnswer ?? null;
            if (typeof icorrect === "string") {
              const idxMatch = ioptions.findIndex(
                (opt) => String(opt).trim() === icorrect.trim()
              );
              icorrect = idxMatch >= 0 ? idxMatch : 0;
            } else if (Number.isInteger(icorrect)) {
              let idxNum = icorrect;
              if (idxNum < 0 || idxNum >= ioptions.length) idxNum = 0;
              icorrect = idxNum;
            } else {
              icorrect = 0;
            }

            return {
              id,
              prompt: iprompt,
              options: ioptions,
              correctAnswer: icorrect,
            };
          });
        }

        // Legacy / single-question MC at top-level
        if (options.length < 2) {
          options = ["Option A", "Option B"];
        }
      } else if (taskType === TASK_TYPES.SEQUENCE) {
        // Normalise sequence/timeline tasks into config.items
        const aiConfig =
          t.config && typeof t.config === "object" ? t.config : {};

        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.options)
          ? t.options
          : [];

        const seqItems = rawItems.map((it, idx) => {
          if (typeof it === "string") {
            return { text: it };
          }

          if (it && typeof it === "object") {
            const text =
              it.text ||
              it.label ||
              it.name ||
              it.prompt ||
              `Step ${idx + 1}`;
            return { text };
          }

          return { text: String(it) };
        });

        config = {
          ...aiConfig,
          items: seqItems,
        };

        // We don't need flat options for sequence; items live in config.items
        options = [];
      } else if (taskType === TASK_TYPES.SORT) {
        // Normalise sort/categorize into config.buckets + config.items
        const aiConfig =
          t.config && typeof t.config === "object" ? t.config : {};

        // Buckets / categories: accept a few common field names
        const rawBuckets = Array.isArray(aiConfig.buckets)
          ? aiConfig.buckets
          : Array.isArray(aiConfig.categories)
          ? aiConfig.categories
          : Array.isArray(t.buckets)
          ? t.buckets
          : Array.isArray(t.categories)
          ? t.categories
          : [];

        const buckets = rawBuckets.map((b, i) => {
          if (typeof b === "string") return b;
          if (b && typeof b === "object") {
            return (
              b.label ||
              b.name ||
              b.title ||
              b.category ||
              `Category ${i + 1}`
            );
          }
          return `Category ${i + 1}`;
        });

        // Items / events to sort: accept a few field names
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

        const sortItems = rawItems.map((it, idx) => {
          if (typeof it === "string") {
            return { text: it, bucketIndex: null };
          }

          if (it && typeof it === "object") {
            const text =
              it.text ||
              it.label ||
              it.name ||
              it.prompt ||
              `Item ${idx + 1}`;

            let bucketIndex = null;
            if (typeof it.bucketIndex === "number") {
              bucketIndex = it.bucketIndex;
            } else if (typeof it.bucket === "number") {
              bucketIndex = it.bucket;
            } else if (typeof it.categoryIndex === "number") {
              bucketIndex = it.categoryIndex;
            }

            // Clamp out-of-range indices
            if (
              typeof bucketIndex === "number" &&
              (bucketIndex < 0 || bucketIndex >= buckets.length)
            ) {
              bucketIndex = null;
            }

            return { text, bucketIndex };
          }

          return { text: String(it), bucketIndex: null };
        });

        config = {
          ...aiConfig,
          buckets,
          items: sortItems,
        };

        // No flat options / correctAnswer for SORT; scoring uses config
        options = [];
      } else if (taskType === TASK_TYPES.MIND_MAPPER) {
        // Normalize MindMapper into config.items with { text, correctIndex }
        const aiConfig =
          t.config && typeof t.config === "object" ? t.config : {};

        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.options)
          ? t.options
          : [];

        const mappedItems = rawItems.map((it, idx) => {
          if (typeof it === "string") {
            return { text: it, correctIndex: idx };
          }
          if (it && typeof it === "object") {
            const text =
              it.text ||
              it.label ||
              it.name ||
              it.prompt ||
              `Idea ${idx + 1}`;

            let correctIndex = it.correctIndex;
            if (typeof correctIndex !== "number") {
              correctIndex = idx;
            }

            return { text, correctIndex };
          }
          return { text: String(it), correctIndex: idx };
        });

        config = {
          ...aiConfig,
          items: mappedItems,
        };

        // StudentApp MindMapperTask expects no "options" for this type
        options = [];
      } else if (taskType === TASK_TYPES.JEOPARDY) {
        // Normalise BrainBlitz / Jeopardy tasks: preserve a structured "clues" array
        const rawClues =
          (Array.isArray(t.clues) && t.clues.length && t.clues) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          [];

        const clues = rawClues.map((cl, idx) => {
          if (!cl || (typeof cl !== "object" && typeof cl !== "string")) {
            const text = typeof cl === "string" ? cl : `Clue ${idx + 1}`;
            return { clue: text, answer: "" };
          }

          if (typeof cl === "string") {
            return { clue: cl, answer: "" };
          }

          const clueText =
            cl.clue ||
            cl.prompt ||
            cl.text ||
            cl.question ||
            `Clue ${idx + 1}`;

          let answer = cl.answer ?? "";
          if (typeof answer !== "string") {
            answer = String(answer || "");
          }

          return {
            clue: String(clueText),
            answer: answer.trim(),
          };
        });

        t.clues = clues;
        // BrainBlitz doesn’t use top-level options
        options = [];
      } else if (taskType === TASK_TYPES.BRAIN_SPARK_NOTES) {
        // Normalize Brain Spark Notes into a bullets array of strings
        const rawBullets =
          (Array.isArray(t.bullets) && t.bullets.length && t.bullets) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          [];

        const bullets = rawBullets
          .map((b, idx) => {
            if (typeof b === "string") {
              return b.trim();
            }
            if (b && typeof b === "object") {
              const text =
                b.text ||
                b.prompt ||
                b.title ||
                b.note ||
                b.description ||
                `Note ${idx + 1}`;
              return String(text).trim();
            }
            return String(b || `Note ${idx + 1}`).trim();
          })
          .filter((line) => !!line);

        t.bullets = bullets;
        // No options for Brain Spark Notes
        options = [];
      } else {
        // Other types – assume no options by default
        options = Array.isArray(t.options) ? t.options : [];
      }

      // For SHORT_ANSWER, we may also receive an "items" array
      if (taskType === TASK_TYPES.SHORT_ANSWER && multiItemCapable) {
        if (Array.isArray(t.items) && t.items.length) {
          items = t.items.map((it, idx) => {
            const id = it.id || `sa${idx + 1}`;
            const iprompt =
              it.prompt && String(it.prompt).trim()
                ? String(it.prompt).trim()
                : `Prompt ${idx + 1}`;
            let icorrect = it.correctAnswer ?? null;
            if (typeof icorrect === "string") {
              icorrect = icorrect.trim();
            } else {
              icorrect = null;
            }
            return {
              id,
              prompt: iprompt,
              correctAnswer: icorrect,
            };
          });
        }
      }

      // ---------- correctAnswer + aiScoringRequired ----------
      let correctAnswer = t.correctAnswer ?? null;

      if (
        (taskType === TASK_TYPES.MULTIPLE_CHOICE ||
          taskType === TASK_TYPES.TRUE_FALSE) &&
        options.length > 0
      ) {
        // normalise to a valid index
        if (typeof correctAnswer === "string") {
          const idx = options.findIndex(
            (opt) => String(opt).trim() === correctAnswer.trim()
          );
          correctAnswer = idx >= 0 ? idx : 0;
        } else if (Number.isInteger(correctAnswer)) {
          let idx = correctAnswer;
          if (idx < 0 || idx >= options.length) idx = 0;
          correctAnswer = idx;
        } else {
          correctAnswer = 0;
        }
      } else if (taskType === TASK_TYPES.SHORT_ANSWER) {
        if (typeof correctAnswer !== "string") {
          correctAnswer = null;
        } else {
          const trimmed = correctAnswer.trim();
          const lower = trimmed.toLowerCase();

          // If the AI tried to make a “short answer” that’s just True/False,
          // auto-convert it into a proper TRUE_FALSE item instead.
          if (lower === "true" || lower === "false") {
            taskType = TASK_TYPES.TRUE_FALSE;
            options = ["True", "False"];
            correctAnswer = lower === "true" ? 0 : 1;
          } else {
            correctAnswer = trimmed;
          }
        }
      } else if (
        taskType === TASK_TYPES.SORT ||
        taskType === TASK_TYPES.SEQUENCE ||
        taskType === TASK_TYPES.MIND_MAPPER ||
        taskType === TASK_TYPES.JEOPARDY ||
        taskType === TASK_TYPES.BRAIN_SPARK_NOTES
      ) {
        // These rely on richer structures, not a flat correctAnswer
        correctAnswer = null;
      }

      // For objective types, we can score directly; others need AI/rubric.
      const objective = meta.objectiveScoring === true;
      let aiScoringRequired;
      if (typeof t.aiScoringRequired === "boolean") {
        // If AI or UI explicitly set it, respect that.
        aiScoringRequired = t.aiScoringRequired;
      } else if (objective) {
        // Objective types can be auto-scored without AI.
        aiScoringRequired = false;
      } else if (typeof meta.defaultAiScoringRequired === "boolean") {
        // Fall back to the metadata default.
        aiScoringRequired = meta.defaultAiScoringRequired;
      } else {
        // Safe default: non-objective types need AI/rubric.
        aiScoringRequired = true;
      }

      // ---------- Flashcards deck (cards) ----------
      let cards = null;
      if (taskType === TASK_TYPES.FLASHCARDS) {
        const rawCards =
          (Array.isArray(t.cards) && t.cards.length
            ? t.cards
            : Array.isArray(t.items) && t.items.length
            ? t.items
            : []) || [];

        cards = rawCards.map((c, idx) => {
          if (!c || (typeof c !== "object" && typeof c !== "string")) {
            return { question: `Card ${idx + 1}`, answer: "" };
          }

          if (typeof c === "string") {
            return { question: c, answer: "" };
          }

          const question = c.question || c.prompt || c.clue || `Card ${idx + 1}`;

          let answer = c.answer ?? c.correctAnswer ?? "";

          if (Array.isArray(answer)) {
            answer = answer[0] ?? "";
          }

          if (typeof answer !== "string") {
            answer = String(answer || "");
          }

          return {
            question: String(question),
            answer: answer.trim(),
          };
        });

        // Flashcards rely on per-card answers, not top-level options/correctAnswer
        options = [];
        correctAnswer = null;
      }

      // ---------- Common fields ----------
      const title =
        t.title && String(t.title).trim()
          ? String(t.title).trim().slice(0, 120)
          : `Task ${index + 1}`;

      // If this is a multi-item task and the prompt is missing, fall back to a generic heading.
      let prompt =
        t.prompt && String(t.prompt).trim()
          ? String(t.prompt).trim()
          : multiItemCapable && items.length
          ? "Answer each of the questions below."
          : "Follow the instructions given by your teacher.";

      const timeLimitSeconds = Number.isFinite(t.timeLimitSeconds)
        ? Math.max(10, Math.min(600, Math.round(t.timeLimitSeconds)))
        : null;

      const points = Number.isFinite(t.points)
        ? Math.max(1, Math.min(50, Math.round(t.points)))
        : 10;

      // Diff Detective specific normalization
      let original = null;
      let modified = null;
      let differences = null;

      if (taskType === TASK_TYPES.DIFF_DETECTIVE) {
        original = t.original ? String(t.original) : "";
        modified = t.modified ? String(t.modified) : "";

        const rawDiffs = Array.isArray(t.differences) ? t.differences : [];
        differences = rawDiffs.map((d, i) => {
          if (!d || typeof d !== "object") {
            return { expected: String(d || ""), hint: null };
          }
          return {
            expected: d.expected ? String(d.expected) : "",
            hint:
              typeof d.hint === "string" && d.hint.trim()
                ? d.hint.trim()
                : null,
          };
        });

        // DiffDetective doesn't need options/config/items
        options = [];
        config = null;
        items = [];
      }

      // ---------- MindMapper: attach shuffledItems for StudentApp ----------
      if (
        taskType === TASK_TYPES.MIND_MAPPER &&
        config &&
        Array.isArray(config.items)
      ) {
        const uiItems = config.items.map((it, idx) => ({
          id: `item-${idx}`,
          text: it.text,
          correctIndex: it.correctIndex,
        }));
        t.shuffledItems = uiItems;
      }

      return {
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
          original,
          modified,
          differences,
        }),
        // MindMapper data for Student UI
        ...(taskType === TASK_TYPES.MIND_MAPPER && {
          shuffledItems: t.shuffledItems,
        }),
        // BrainBlitz / Jeopardy clues
        ...(taskType === TASK_TYPES.JEOPARDY && {
          clues: Array.isArray(t.clues) ? t.clues : [],
        }),
        // Brain Spark Notes bullets
        ...(taskType === TASK_TYPES.BRAIN_SPARK_NOTES && {
          bullets: Array.isArray(t.bullets) ? t.bullets : [],
        }),
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
          notes: customNotes || "",
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
