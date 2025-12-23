// backend/controllers/aiTasksetController.js
import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META, normalizeTaskTypeId } from "../../shared/taskTypes.js";

const retryMustHave = {
  [TASK_TYPES.MULTIPLE_CHOICE]:
    'MULTIPLE_CHOICE must include items[] with 3–5 questions. Each item: { id, prompt, options[], correctAnswer } (correctAnswer is an index).',
  [TASK_TYPES.TRUE_FALSE]:
    "TRUE_FALSE must include items[] with at least 3 statements. Each item: { id, prompt, correctAnswer: 0|1 } where 0=True, 1=False.",
  [TASK_TYPES.SORT]:
    "SORT must include config.buckets (>=2) and config.items (>=3). Each item: { text, bucketIndex:number|null }.",
  [TASK_TYPES.SEQUENCE]:
    "SEQUENCE must include config.items (>=3). Each item: { text }.",
  [TASK_TYPES.VENNSORT]:
    'VENNSORT must include config.categories (2–3 names) and config.items (5–10). Also include correctAnswer as a map: { "itemId": ["CategoryA", "CategoryB"] } (empty array allowed for "belongs nowhere").',
  [TASK_TYPES.JEOPARDY]:
    "JEOPARDY (BrainBlitz) must include clues (>=3). Each clue: { clue, answer }.",
  [TASK_TYPES.HANGMAN_DUEL]:
    "HANGMAN_DUEL must include wordsByStation[] (4–8 entries). Each entry: { word, hint }. Each word must come ONLY from aiWordBank, all words must be different, and lengths must be similar (max length difference ≤ 2).",
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Build a list of implemented, AI-eligible task types that are safe to GENERATE.
// - implemented !== false
// - aiEligible !== false
// - generatorEligible !== false (some types are AI-scoreable but not generator-safe)
// - exclude HIDENSEEK (your special case)
const AI_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(
    ([type, meta]) =>
      meta?.implemented !== false &&
      meta?.aiEligible !== false &&
      meta?.generatorEligible !== false &&
      type !== TASK_TYPES.HIDENSEEK
  )
  .map(([type]) => type);

const CORE_TYPES = AI_ELIGIBLE_TYPES.length
  ? AI_ELIGIBLE_TYPES
  : [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER];

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
 * IMPORTANT: robust normalization:
 * - lower
 * - underscores -> hyphen
 * - whitespace -> hyphen
 * - strip punctuation
 * Example: "Brain Blitz!" => "brain-blitz"
 */
function normalizeSelectedType(raw) {
  // Delegate to shared normalizer so we don't maintain duplicate v=== chains here.
  const normalized = normalizeTaskTypeId(raw);
  return normalized || null;
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

function normalizeHangmanWord(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .trim();
}

function enforceHangmanFromWordBank(task, wordBank) {
  // Pure helper: validate + normalize a Hangman task using ONLY the provided wordBank
  if (!task || task.taskType !== TASK_TYPES.HANGMAN_DUEL) return task;

  const bank = (Array.isArray(wordBank) ? wordBank : [])
    .map(normalizeHangmanWord)
    .filter(Boolean);

  // If no bank, do not mutate (generator should have required this)
  if (!bank.length) return task;

  // “suitably challenging”: tune these if you want
  const minLen = 5;
  const maxLen = 14;

  // Prefer multi-word shape
  const rawList = Array.isArray(task.wordsByStation) ? task.wordsByStation : null;

  // Back-compat: if a single word exists, convert to wordsByStation[0]
  const singleWord = normalizeHangmanWord(task.word);

  let list = [];
  if (rawList && rawList.length) {
    list = rawList
      .map((entry) => ({
        word: normalizeHangmanWord(entry?.word),
        hint: typeof entry?.hint === "string" ? entry.hint.trim() : "",
      }))
      .filter((e) => e.word);
  } else if (singleWord) {
    list = [
      {
        word: singleWord,
        hint: typeof task.hint === "string" ? task.hint.trim() : "",
      },
    ];
  }

  // Enforce: choose 4–8 unique words from bank, similar length (max diff ≤ 2)
  // Start from the list provided (if valid), otherwise build from bank.
  const isFromBank = (w) => bank.includes(w);
  const isLenOk = (w) => w.length >= minLen && w.length <= maxLen;

  // Keep only valid candidates from provided list
  const provided = [];
  const seen = new Set();
  for (const e of list) {
    const w = e.word;
    if (!w || seen.has(w)) continue;
    if (!isFromBank(w)) continue;
    if (!isLenOk(w)) continue;
    provided.push({ word: w, hint: e.hint || "" });
    seen.add(w);
    if (provided.length >= 8) break;
  }

  // If we already have 4–8, ensure length similarity (diff ≤ 2); otherwise rebuild.
  const lengthDiffOk = (arr) => {
    if (!arr.length) return false;
    const lens = arr.map((x) => x.word.length);
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    return max - min <= 2;
  };

  let finalList = provided;

  if (finalList.length < 4 || !lengthDiffOk(finalList)) {
    // Build from bank: filter to length window first
    const bankFiltered = bank.filter((w) => isLenOk(w));

    // Pick a tight length band (L..L+2) with the most available words
    const counts = new Map();
    for (const w of bankFiltered) {
      const L = w.length;
      for (let start = L - 2; start <= L; start++) {
        const key = `${start}`;
        const ok = L >= start && L <= start + 2;
        if (!ok) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Choose best band
    let bestStart = null;
    let bestCount = -1;
    for (const [k, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestStart = Number(k);
      }
    }

    const bandStart = Number.isFinite(bestStart) ? bestStart : minLen;
    const band = bankFiltered.filter(
      (w) => w.length >= bandStart && w.length <= bandStart + 2
    );

    // Preserve any valid provided words that fit the band
    const bandSet = new Set(band);
    finalList = [];
    const used = new Set();

    for (const e of provided) {
      if (!bandSet.has(e.word)) continue;
      finalList.push({ word: e.word, hint: e.hint || "" });
      used.add(e.word);
    }

    for (const w of band) {
      if (finalList.length >= 8) break;
      if (used.has(w)) continue;
      finalList.push({ word: w, hint: "" });
      used.add(w);
    }

    // If still <4, relax to any filtered bank words
    if (finalList.length < 4) {
      for (const w of bankFiltered) {
        if (finalList.length >= 4) break;
        if (used.has(w)) continue;
        finalList.push({ word: w, hint: "" });
        used.add(w);
      }
    }

    // Absolute fallback: at least one
    if (!finalList.length) {
      finalList = [{ word: bank[0], hint: "" }];
    }
  }

  return {
    ...task,
    // canonical multi-word shape
    wordsByStation: finalList.slice(0, Math.min(8, finalList.length)),
    // keep back-compat fields (optional) but make them coherent
    word: finalList[0]?.word || singleWord || bank[0] || "HANGMAN",
    hint:
      finalList[0]?.hint ||
      (typeof task.hint === "string" ? task.hint.trim() : ""),
  };
}

function tfItemsAreValid(items) {
  return (
    Array.isArray(items) &&
    items.length >= 3 &&
    items.every((it) => isNonEmptyString(it?.prompt))
  );
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
  return (
    Array.isArray(clues) &&
    clues.length >= 3 &&
    clues.every((c) => isNonEmptyString(c?.clue))
  );
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
- VENNSORT must include config: { categories: ["A","B"(,"C")], items: [{ id?, text }] } and correctAnswer: { "itemId": ["A","B"] } (empty array allowed for belongs nowhere).
- JEOPARDY (BrainBlitz) must include clues: [{ clue, answer }]
- MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions (each with prompt, options[], correctAnswer index).
- HANGMAN_DUEL must include wordsByStation[]
- WORD_WEAVER_DUEL must include phrase (string). Optionally include targetWords[] (array of words) for objective checking.
 (4–8 entries). Each entry: { word, hint }. Each word must come ONLY from the vocabulary list (aiWordBank), all words must be different, and lengths must be similar (max length difference ≤ 2).

Return the task in this normalized shape:
{
  "title": "Short title",
  "prompt": "Student-facing instructions",
  "taskType": "${allowedType}",
  "options": [],
  "correctAnswer": null,
  "items": [],
  "clues": [],
  "wordsByStation": [],
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

    // If demo explicitly requests taskTypes, use that as the pool (and keep its order)
    if (Array.isArray(requestedTypes) && requestedTypes.length) {
      typePool = requestedTypes;
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
      titleTrimmed ||
      `${subject || "Lesson"} – Grade ${gradeLevel || "?"} review`;

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
        ? `\nSpecial considerations:\n${specialConsiderations || ""}\n${
            customNotes || ""
          }\n`
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
- For VENNSORT tasks: include config.categories (2–3 strings), config.items (5–10 strings or {id,text}), and correctAnswer as a map { "itemId": ["CategoryA", "CategoryB"] } (empty array allowed).
- For JEOPARDY/BrainBlitz tasks: include clues (>=3) with {clue, answer}
- MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions (each with prompt, options[], correctAnswer index).
- TRUE_FALSE multi-item: include items[] with >=3 statements when prompt says "each statement".
- For HANGMAN_DUEL tasks:
- For WORD_WEAVER_DUEL tasks: include phrase (string) and (optional) targetWords[].
 follow the HANGMAN_DUEL requirements block below (wordsByStation per station; no single "word" field).
  HANGMAN_DUEL (taskType: "hangman-duel") requirements:

  You MUST generate a Hangman Duel task that provides DIFFERENT words per station so teams do not share answers.

  Source of words:
  - Choose words ONLY from the teacher-provided aiWordBank (the vocabulary list). Do NOT invent new words.

  Output shape (exact keys required):
  {
    "title": "…",
    "prompt": "…",
    "taskType": "hangman-duel",
    "style": "classic",
    "playerCount": 4,
    "wordsByStation": [
      { "word": "WORD1", "hint": "…" },
      { "word": "WORD2", "hint": "…" },
      { "word": "WORD3", "hint": "…" },
      { "word": "WORD4", "hint": "…" }
      // ...up to 8 total entries
    ],
    "config": {}
  }

  wordsByStation rules:
  - Provide EXACTLY 8 entries if the aiWordBank contains 8 or more suitable words; otherwise provide as many as possible (minimum 4).
  - Each "word" must match a term from aiWordBank EXACTLY (same spelling), but you may output it in ALL CAPS.
  - Each station entry MUST have a DIFFERENT word (no duplicates).
  - All chosen words must be of similar difficulty:
  - target word length window: choose words within a tight range (max length difference across chosen words ≤ 2 characters).
  - avoid picking a single unusually obscure or unusually easy word compared to the others.
- "hint" must be short (3–10 words), helpful but not a giveaway, and should not include the full word.
- Only letters A–Z in the final "word" string (strip spaces/punctuation). If a term has spaces or punctuation, convert it to letters-only (e.g., "New France" → "NEWFRANCE") ONLY IF the letters-only form still clearly corresponds to the aiWordBank term.

Do NOT include "options", "correctAnswer", or "items" for Hangman Duel.

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

    // For demo/testing, allow taskTypes override
    const requestedTypes = Array.isArray(req.body?.taskTypes)
      ? req.body.taskTypes.filter(Boolean)
      : null;

    const targetCount = requestedTypes?.length
      ? requestedTypes.length
      : Number(numberOfTasks || 8);

    // Demo generates one task per taskType
    if (requestedTypes) {
      if (!Array.isArray(aiTasks) || aiTasks.length !== requestedTypes.length) {
        return res.status(400).json({
          ok: false,
          error: "AI did not return one task per requested task type.",
        });
      }

      for (let i = 0; i < requestedTypes.length; i++) {
        const got = normalizeSelectedType(aiTasks[i]?.taskType || aiTasks[i]?.type);
        if (got !== requestedTypes[i]) {
          return res.status(400).json({
            ok: false,
            error: `Task ${i} type mismatch: expected ${requestedTypes[i]}, got ${got}`,
          });
        }
      }
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

      // ✅ HANGMAN DUEL normalization (multi-word per station)
      // Expect: wordsByStation: [{ word, hint }...] chosen ONLY from aiWordBank
      if (taskType === TASK_TYPES.HANGMAN_DUEL) {
        const style = isNonEmptyString(t.style)
          ? t.style
          : isNonEmptyString(config?.style)
          ? config.style
          : "classic";
        const playerCount = clampInt(
          t.playerCount ?? config?.playerCount,
          2,
          8,
          4
        );

        // Accept AI output in either t.wordsByStation or t.config.wordsByStation; back-compat: t.word + t.hint
        const wordsByStation =
          (Array.isArray(t.wordsByStation) && t.wordsByStation) ||
          (Array.isArray(config?.wordsByStation) && config.wordsByStation) ||
          null;

        const hangmanTask = enforceHangmanFromWordBank(
          {
            index,
            title: isNonEmptyString(t.title)
              ? String(t.title).trim().slice(0, 120)
              : `Task ${index + 1}`,
            prompt: isNonEmptyString(t.prompt)
              ? String(t.prompt).trim()
              : "Play Hangman Duel using the word bank terms.",
            taskType,
            style,
            playerCount,
            wordsByStation: wordsByStation || undefined,
            word: t.word || config?.word || "",
            hint: t.hint || config?.hint || "",
            options: [],
            correctAnswer: null,
            aiScoringRequired: false,
            timeLimitSeconds: Number.isFinite(t.timeLimitSeconds)
              ? clampInt(t.timeLimitSeconds, 10, 600, null)
              : null,
            points: Number.isFinite(t.points)
              ? clampInt(t.points, 1, 50, 10)
              : 10,
            config: {},
            items: [],
          },
          rawWordBank
        );

        // ✅ Finalize per-station word + hint so StudentApp can render placeholders
        const stationIdx = Number.isInteger(t.stationIndex)
          ? t.stationIndex
          : Number.isInteger(t.stationIdIndex)
          ? t.stationIdIndex
          : index %
            ((hangmanTask.wordsByStation && hangmanTask.wordsByStation.length) ||
              1);

        const stationEntry =
          Array.isArray(hangmanTask.wordsByStation) &&
          hangmanTask.wordsByStation.length
            ? hangmanTask.wordsByStation[stationIdx] ||
              hangmanTask.wordsByStation[0]
            : null;

          const finalWord = stationEntry?.word || hangmanTask.word || "";
          const finalHint = stationEntry?.hint || hangmanTask.hint || "";
          const FALLBACK_WORDS = [
            "CHRISTMAS",
            "NATIVITY",
            "BETHLEHEM",
            "MANGER",
            "WISEMEN",
            "SHEPHERDS",
            "STAR",
            "GIFTS",
          ];

        const finalWordRaw =
          stationEntry?.word ||
          hangmanTask.word ||
          (FALLBACK_WORDS[stationIdx % FALLBACK_WORDS.length] || "");

        const finalHintRaw =
          stationEntry?.hint ||
          hangmanTask.hint ||
          "Guess the term.";

        return {
          ...hangmanTask,
          stationIndex: stationIdx,
          word: String(finalWordRaw).trim(),
          hint: String(finalHintRaw).trim(),
          // ✅ keep canonical data in config too
          config: {
            ...(hangmanTask.config || {}),
            wordsByStation: Array.isArray(hangmanTask.wordsByStation)
              ? hangmanTask.wordsByStation
              : [],
            word: String(finalWordRaw).trim(),
            hint: String(finalHintRaw).trim(),
            style: hangmanTask.style || "classic",
            playerCount: hangmanTask.playerCount || 4,
          },
        };
      }

      // -------- MULTIPLE CHOICE normalization (single vs multi) --------
      if (taskType === TASK_TYPES.MULTIPLE_CHOICE) {
        if (Array.isArray(t.items) && t.items.length) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.MULTIPLE_CHOICE;
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
            {
              id: "q1",
              prompt: "Question 1",
              options: ["Option A", "Option B"],
              correctAnswer: 0,
            },
            {
              id: "q2",
              prompt: "Question 2",
              options: ["Option A", "Option B"],
              correctAnswer: 0,
            },
            {
              id: "q3",
              prompt: "Question 3",
              options: ["Option A", "Option B"],
              correctAnswer: 0,
            },
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
          (Array.isArray(t.statements) &&
            t.statements.length &&
            t.statements) ||
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

              let ca =
                it?.correctAnswer ?? it?.answer ?? it?.correct ?? it?.isTrue ?? 0;

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
                {
                  id: "tf1",
                  prompt:
                    "True or False: Review the key idea from the lesson.",
                  options: ["True", "False"],
                  correctAnswer: 0,
                },
                {
                  id: "tf2",
                  prompt:
                    "True or False: Recall an important term from the unit.",
                  options: ["True", "False"],
                  correctAnswer: 0,
                },
                {
                  id: "tf3",
                  prompt:
                    "True or False: Identify one fact related to today's topic.",
                  options: ["True", "False"],
                  correctAnswer: 0,
                },
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
              return String(
                b.label || b.name || b.title || `Category ${i + 1}`
              ).trim();
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

      // -------- VENNSORT normalization --------
      else if (taskType === TASK_TYPES.VENNSORT) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawCats =
          Array.isArray(aiConfig.categories) ? aiConfig.categories
          : Array.isArray(aiConfig.circles) ? aiConfig.circles
          : Array.isArray(t.categories) ? t.categories
          : Array.isArray(t.circles) ? t.circles
          : [];

        const categories = rawCats
          .map((c, i) =>
            typeof c === "string"
              ? c.trim()
              : String(c?.label || c?.name || c?.title || `Category ${i + 1}`).trim()
          )
          .filter(Boolean)
          .slice(0, 3);

        const rawItems =
          Array.isArray(aiConfig.items) ? aiConfig.items
          : Array.isArray(t.items) ? t.items
          : Array.isArray(t.options) ? t.options
          : [];

        const normItems = rawItems
          .filter(Boolean)
          .slice(0, 10)
          .map((it, idx) => {
            if (typeof it === "string") return { id: `item-${idx + 1}`, text: it.trim() };
            if (it && typeof it === "object") {
              const text = String(it.text || it.label || it.name || it.value || `Item ${idx + 1}`).trim();
              const id = String(it.id || it._id || it.key || `item-${idx + 1}`).trim();
              return { id, text };
            }
            return { id: `item-${idx + 1}`, text: String(it || `Item ${idx + 1}`).trim() };
          })
          .filter((x) => isNonEmptyString(x.text));

        // correctAnswer map: { [itemId]: string[] } (empty array allowed)
        const rawCA =
          (t.correctAnswer && typeof t.correctAnswer === "object" && t.correctAnswer) ||
          (aiConfig.correctAnswer && typeof aiConfig.correctAnswer === "object" && aiConfig.correctAnswer) ||
          {};

        const ca = {};
        for (const item of normItems) {
          const v = rawCA[item.id];
          const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
          const cleaned = arr
            .map((s) => String(s).trim())
            .filter(Boolean)
            .filter((c) => categories.includes(c));
          ca[item.id] = [...new Set(cleaned)].sort();
        }

        const valid = categories.length >= 2 && categories.length <= 3 && normItems.length >= 5;

        if (!valid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.VENNSORT;

          // safe placeholders so UI still renders
          const safeCats = categories.length >= 2 ? categories.slice(0, 2) : ["Category A", "Category B"];
          const safeItems =
            normItems.length >= 5
              ? normItems.slice(0, 5)
              : rawWordBank.slice(0, 5).map((w, i) => ({ id: `item-${i + 1}`, text: String(w || `Item ${i + 1}`).trim() }));

          const safeCA = {};
          for (const it of safeItems) safeCA[it.id] = [];

          config = { ...aiConfig, categories: safeCats, items: safeItems, correctAnswer: safeCA };
          options = [];
          items = [];
          correctAnswer = safeCA;
        } else {
          config = { ...aiConfig, categories, items: normItems, correctAnswer: ca };
          options = [];
          items = [];
          correctAnswer = ca;
        }
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
      const title = isNonEmptyString(t.title)
        ? String(t.title).trim().slice(0, 120)
        : `Task ${index + 1}`;

      const prompt = isNonEmptyString(t.prompt)
        ? String(t.prompt).trim()
        : "Follow the instructions given by your teacher.";

      const timeLimitSeconds = Number.isFinite(t.timeLimitSeconds)
        ? clampInt(t.timeLimitSeconds, 10, 600, null)
        : null;

      const points = Number.isFinite(t.points)
        ? clampInt(t.points, 1, 50, 10)
        : 10;

      // --- correctAnswer normalization for single MC/TF objective types ---
      // correctAnswer already initialized above
      if (
        (taskType === TASK_TYPES.MULTIPLE_CHOICE ||
          taskType === TASK_TYPES.TRUE_FALSE) &&
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

    // --- Targeted retry requirements (per type) ---
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

          const regenType =
            normalizeSelectedType(regenerated?.taskType || allowedType) || allowedType;

          // Accept only if it returns same intended type
          if (regenType !== allowedType) continue;

          // Accept only if it returns same intended type
          if (allowedType === TASK_TYPES.SORT) {
            const cfg =
              regenerated?.config && typeof regenerated.config === "object"
                ? regenerated.config
                : {};
            const buckets = Array.isArray(cfg.buckets)
              ? cfg.buckets
                  .map((b) => String(b || "").trim())
                  .filter(Boolean)
              : [];
            const items = Array.isArray(cfg.items)
              ? cfg.items
                  .map((it) => ({
                    text: String(it?.text || "").trim(),
                    bucketIndex:
                      typeof it?.bucketIndex === "number" ? it.bucketIndex : null,
                  }))
                  .filter((it) => it.text)
              : [];

            const fixedCfg = { ...cfg, buckets, items };

            if (sortConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
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
            const cfg =
              regenerated?.config && typeof regenerated.config === "object"
                ? regenerated.config
                : {};
            const rawItems = Array.isArray(cfg.items) ? cfg.items : [];
            const fixedItems = rawItems
              .map((it, idx) => {
                if (typeof it === "string") return { text: it.trim() };
                if (it && typeof it === "object") {
                  const text =
                    it.text || it.label || it.name || it.prompt || `Step ${idx + 1}`;
                  return { text: String(text).trim() };
                }
                return { text: String(it || `Step ${idx + 1}`).trim() };
              })
              .filter((x) => isNonEmptyString(x.text));

            const fixedCfg = { ...cfg, items: fixedItems };

            if (sequenceConfigIsValid(fixedCfg)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
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

          if (allowedType === TASK_TYPES.VENNSORT) {
            const cfg =
              regenerated?.config && typeof regenerated.config === "object"
                ? regenerated.config
                : {};
            const rawCats = Array.isArray(cfg.categories) ? cfg.categories : [];
            const categories = rawCats
              .map((c) => String(c || "").trim())
              .filter(Boolean)
              .slice(0, 3);

            const rawItems = Array.isArray(cfg.items) ? cfg.items : [];
            const normItems = rawItems
              .slice(0, 10)
              .map((it, idx) => {
                if (typeof it === "string") return { id: `item-${idx + 1}`, text: it.trim() };
                const id = String(it?.id || it?._id || it?.key || `item-${idx + 1}`).trim();
                const text = String(it?.text || it?.label || it?.name || it?.value || `Item ${idx + 1}`).trim();
                return { id, text };
              })
              .filter((it) => it.text);

            const rawCA =
              (regenerated?.correctAnswer &&
                typeof regenerated.correctAnswer === "object" &&
                regenerated.correctAnswer) ||
              (cfg.correctAnswer &&
                typeof cfg.correctAnswer === "object" &&
                cfg.correctAnswer) ||
              {};

            const ca = {};
            for (const it of normItems) {
              const v = rawCA[it.id];
              const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
              const cleaned = arr
                .map((s) => String(s).trim())
                .filter(Boolean)
                .filter((c) => categories.includes(c));
              ca[it.id] = [...new Set(cleaned)].sort();
            }

            const valid =
              categories.length >= 2 && categories.length <= 3 && normItems.length >= 5;

            if (valid) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
                taskType: TASK_TYPES.VENNSORT,
                options: [],
                correctAnswer: ca,
                aiScoringRequired: false, // objective
                timeLimitSeconds: t.timeLimitSeconds,
                points: t.points,
                config: { ...cfg, categories, items: normItems, correctAnswer: ca },
                items: [],
              };
              break;
            }
          }

          if (allowedType === TASK_TYPES.TRUE_FALSE) {
            const rawItems = Array.isArray(regenerated?.items) ? regenerated.items : [];
            const fixedItems = rawItems
              .map((it, idx) => {
                const id = it?.id || `tf${idx + 1}`;
                const prompt = String(
                  it?.prompt || it?.question || it?.text || `Statement ${idx + 1}`
                ).trim();
                let ca = it?.correctAnswer ?? it?.answer ?? 0;
                if (typeof ca === "string") ca = ca.trim().toLowerCase() === "false" ? 1 : 0;
                else if (Number.isInteger(ca)) ca = ca === 1 ? 1 : 0;
                else ca = 0;
                return { id, prompt, options: ["True", "False"], correctAnswer: ca };
              })
              .filter((it) => isNonEmptyString(it.prompt));

            if (tfItemsAreValid(fixedItems)) {
              replaced = {
                ...t,
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
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
                  const clueText =
                    cl.clue || cl.prompt || cl.question || cl.text || `Clue ${idx + 1}`;
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
                title: isNonEmptyString(regenerated?.title)
                  ? String(regenerated.title).trim().slice(0, 120)
                  : t.title,
                prompt: isNonEmptyString(regenerated?.prompt)
                  ? String(regenerated.prompt).trim()
                  : t.prompt,
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
                const id = it?.id || `mc${idx + 1}`;
                const prompt = String(it?.prompt || it?.question || it?.text || "").trim();
                const options = Array.isArray(it?.options)
                  ? it.options.map((o) => String(o).trim()).filter(Boolean)
                  : [];
                let correctAnswer = Number.isInteger(it?.correctAnswer) ? it.correctAnswer : 0;

                if (correctAnswer < 0) correctAnswer = 0;
                if (correctAnswer >= options.length) correctAnswer = 0;

                return { id, prompt, options, correctAnswer };
              })
              .filter((it) => it.prompt && it.options.length >= 2);

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
                items: fixedItems.slice(0, 5), // enforce 3–5 from regen prompt
                options: [],
                correctAnswer: null,
                config: {},
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
