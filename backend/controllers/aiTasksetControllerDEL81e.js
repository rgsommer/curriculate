// backend/controllers/aiTasksetController.js
import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

export const retryMustHave = {
  [TASK_TYPES.MULTIPLE_CHOICE]:
    'MULTIPLE_CHOICE must include items[] with 3–5 questions. Each item: { id, prompt, options[], correctAnswer } (correctAnswer is an index).',
  [TASK_TYPES.TRUE_FALSE]:
    "TRUE_FALSE must include items[] with at least 3 statements. Each item: { id, prompt, correctAnswer: 0|1 } where 0=True, 1=False.",
  [TASK_TYPES.SHORT_ANSWER]:
    'SHORT_ANSWER must include either (A) a single prompt + correctAnswer (string) OR (B) items[] with 3–5 prompts, each with correctAnswer (string) and optionally acceptableAnswers (array of strings). Answers should be short (one word or one sentence). Include acceptableAnswers for synonyms/spelling variants. Keep prompts clear and specific. Objective scoring required; AI scoring should also validate nonsense / near-matches.',

  [TASK_TYPES.OPEN_TEXT]:
    'OPEN_TEXT must include a clear prompt plus settings: { gradeLevel:number, difficulty:"EASY"|"MEDIUM"|"HARD" }. For MEDIUM/HARD, include settings.minWords computed as 2×gradeLevel (MEDIUM) or 3×gradeLevel (HARD). Do NOT include correctAnswer. Include rubricFocus: ["clarity","accuracy","reasoning","evidence"] to guide AI scoring and teacher reporting. Response box should allow multi-paragraph answers.',
  [TASK_TYPES.DRAW_MIME]:
    "DRAW_MIME must include a short concept prompt (what to draw/act). Optional: config.mode \"DRAW\"|\"MIME\" or \"EITHER\". Include timeLimitSeconds ~60 and encourage teammates to guess. Not objective-scored.",


  [TASK_TYPES.SORT]:
    "SORT must include config.buckets (>=2) and config.items (>=3). Each item: { text, bucketIndex:number|null }.",
  [TASK_TYPES.SEQUENCE]:
    "SEQUENCE must include config.items (>=3). Each item: { text }.",
  [TASK_TYPES.MATCHING]:
    'MATCHING must include leftItems[] and rightItems[] (5–7 each) and correctMatches map {"leftId":"rightId"}.',
  [TASK_TYPES.VENNSORT]:
    'VENNSORT must include config.categories (2–3 names) and config.items (5–10). Also include correctAnswer as a map: { "itemId": ["CategoryA", "CategoryB"] } (empty array allowed for "belongs nowhere").',

  [TASK_TYPES.JEOPARDY]:
    "JEOPARDY (BrainBlitz) must include clues (>=3). Each clue: { clue, answer }.",
  [TASK_TYPES.HANGMAN_DUEL]:
    "HANGMAN_DUEL must include wordsByStation[] (4–8 entries). Each entry: { word, hint }. Each word must come ONLY from aiWordBank, all words must be different, and lengths must be similar (max length difference ≤ 2).",

  [TASK_TYPES.FLASHCARDS]:
    'FLASHCARDS must include config.items (>=5). Each item: { question, answer }.',

  
  [TASK_TYPES.FLASHCARDS_RACE]:
    'FLASHCARDS_RACE must include config.items (>=5). Each item: { question, answer }. May include config.secondsPerCard (default 20), config.playerCount (1–4), and config.interTeam (boolean).',
[TASK_TYPES.WORD_WEAVER_DUEL]:
    'WORD_WEAVER_DUEL should include words (array of 5–10 short words) and a gridSize (number, e.g. 11). It may optionally include phrase/wordBank for fallback phrase-rebuild mode.',

  [TASK_TYPES.DIFF_DETECTIVE]:
    'DIFF_DETECTIVE must include two short texts to compare: config.textA and config.textB (3–6 sentences each) with 5–8 subtle but detectable differences.',
  [TASK_TYPES.GUESS_WHO]:
    'GUESS_WHO must include config.playerCount (2–6), config.secretAnswers (array length = playerCount), config.category (string), config.maxGuesses (<=15), and config.timerSeconds (<=180). Intra-team only. Hold-to-reveal secret for answerer, yes/no Q&A, and limited guesses.',

  [TASK_TYPES.ECHO_CHAIN]:
    "ECHO_CHAIN must include: seedTerm (string from aiWordBank), prompt (clear turn-by-turn rules), and config with optional perTurnSeconds (5–20), rotationBonusPoints, pointsPerCorrectAdd, and maxChainLength (optional). Intra-team only.",

  [TASK_TYPES.NARRATION_SYNTHESIZE]:
    "NARRATION_SYNTHESIZE must include config.playerCount (2–8), config.prompts (array length == playerCount) where each element is { id, concept, prompt }. Each prompt must be an explainable concept or process (not a single word). Optional config.perTurnSeconds (0 disables). Optional config.ratingScale: { min, max, label }. Intra-team only.",
  [TASK_TYPES.ROLE_PLAY_DECK]:
    "ROLE_PLAY_DECK must include config.playerCount (2–6), config.playerNames (array length playerCount), config.mode (mystery|classic or allow choice), config.roles (array length playerCount) each with { name, role, characteristics: [3–6 morally appropriate traits] }, and config.scenario (subject/grade appropriate, 2–5 sentences). Intra-team only; do NOT include inter-team gameplay.",


  [TASK_TYPES.MAD_DASH_SEQUENCE]:
    'MAD_DASH_SEQUENCE must include either (A) sequence[] as an array of 3–4 color names (e.g., ["Red","Blue","Green"]), OR (B) sequenceItems[] as 3–4 objects { color, label } where color is one of the station colors. Include timeLimitSeconds (60–180) and points (10–25). Do NOT include options/correctAnswer/items.',

};

export function buildVocabularyLines(aiWordBank) {
  const vocab = Array.isArray(aiWordBank)
    ? aiWordBank
    : String(aiWordBank || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

  return vocab.map((w) => `- ${w}`).join("\n");
}

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
export function normalizeSelectedType(raw) {
  if (!raw) return null;

  const v = String(raw)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, ""); // strip punctuation like !, ?, etc.

  if (
    v === "multiple-choice" ||
    v === "multiplechoice" ||
    v === "mcq" ||
    v === "mc"
  )
    return TASK_TYPES.MULTIPLE_CHOICE;
  if (
    v === "physical-multiple-choice" ||
    v === "physical-multiplechoice" ||
    v === "physical-mc" ||
    v === "pmc" ||
    v === "physicalmc"
  )
    return TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;
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

  if (
    v === "vennsort" ||
    v === "venn-sort" ||
    v === "venn" ||
    v === "venn-diagram" ||
    v === "venn_diagram"
  )
    return TASK_TYPES.VENNSORT;

  if (
    v === "brain-blitz" ||
    v === "brainblitz" ||
    v === "jeopardy" ||
    v === "jeopardy-game" ||
    v === "jeopardy_game"
  )
    return TASK_TYPES.JEOPARDY;


// Brainstorm Battle
if (
  v === "brainstorm-battle" ||
  v === "brainstormbattle" ||
  v === "brainstorm" ||
  v === "brain-storm-battle"
)
  return TASK_TYPES.BRAINSTORM_BATTLE;

// Collaboration (Pair & Respond)
if (
  v === "collaboration" ||
  v === "collab" ||
  v === "pair-and-respond" ||
  v === "pair-respond"
)
  return TASK_TYPES.COLLABORATION;

// Live Debate
if (v === "live-debate" || v === "livedebate" || v === "debate" || v === "live_debate")
  return TASK_TYPES.LIVE_DEBATE;

// True/False TicTacToe
if (
  v === "true-false-tictactoe" ||
  v === "true-false-tic-tac-toe" ||
  v === "truefalsetictactoe" ||
  v === "tictactoe" ||
  v === "tic-tac-toe"
)
  return TASK_TYPES.TRUE_FALSE_TICTACTOE;


  if (
    v === "brain-spark-notes" ||
    v === "brainsparknotes" ||
    v === "brain_spark_notes"
  )
    return TASK_TYPES.BRAIN_SPARK_NOTES;

  if (v === "mind-mapper" || v === "mindmapper" || v === "mind_mapper")
    return TASK_TYPES.MIND_MAPPER;

  if (v === "hangman" || v === "hangman-duel" || v === "hangmanduel")
    return TASK_TYPES.HANGMAN_DUEL;

  if (
    v === "word-weaver" ||
    v === "wordweaver" ||
    v === "word-weaver-duel" ||
    v === "wordweaverduel" ||
    v === "word-weaver_duel" ||
    v === "word_weaver_duel"
  )
    return TASK_TYPES.WORD_WEAVER_DUEL;

  if (v === "flashcards") return TASK_TYPES.FLASHCARDS;
  if (v === "flashcards-race" || v === "flashcardsrace" || v === "flashcard-race" || v === "flashcardrace") return TASK_TYPES.FLASHCARDS_RACE;
  if (v === "diff-detective" || v === "spot-the-difference" || v === "diff")
    return TASK_TYPES.DIFF_DETECTIVE;

  if (v === "photo") return TASK_TYPES.PHOTO;
  if (v === "photo-journal" || v === "photojournal")
    return TASK_TYPES.PHOTO_JOURNAL;
  if (v === "draw-or-mime" || v === "drawormime")
    return TASK_TYPES.DRAW_MIME;
  if (v === "body-break" || v === "bodybreak") return TASK_TYPES.BODY_BREAK;

  // Pre-task / interstitial
  if (v === "mood-checkin" || v === "moodcheckin" || v === "mood") return TASK_TYPES.MOOD_CHECKIN;
  if (v === "treasure-runner" || v === "treasurerunner" || v === "treasure")
    return TASK_TYPES.TREASURE_RUNNER;

  // Post-taskset
  if (v === "multi-player-feedback" || v === "multiplayerfeedback" || v === "feedback")
    return TASK_TYPES.MULTI_PLAYER_FEEDBACK;


  if (v === "guess-who" || v === "guesswho" || v === "guess_who")
    return TASK_TYPES.GUESS_WHO;

  if (v === "echochain" || v === "echo-chain" || v === "echo_chain" || v === "echo chain") return TASK_TYPES.ECHO_CHAIN;

  if (v === "fakeout" || v === "fake-out" || v === "fake_out" || v === "fake out")
    return TASK_TYPES.FAKE_OUT;

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

function extractJsonFromText(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const a0 = raw.indexOf("[");
  const a1 = raw.lastIndexOf("]");
  if (a0 >= 0 && a1 > a0) {
    const sub = raw.slice(a0, a1 + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // continue
    }
  }

  const o0 = raw.indexOf("{");
  const o1 = raw.lastIndexOf("}");
  if (o0 >= 0 && o1 > o0) {
    const sub = raw.slice(o0, o1 + 1);
    try {
      return JSON.parse(sub);
    } catch {
      // continue
    }
  }

  return null;
}

function sortConfigIsValid(cfg) {
  const buckets = Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  return buckets.length >= 2 && items.length >= 3;
}

// Ensure each bucket has at least one *correctly assigned* item.
// Prevents cases like: Continents/Not Continents but all items are Continents.
function sortHasAtLeastOnePerBucket(cfg) {
  const buckets = Array.isArray(cfg?.buckets) ? cfg.buckets : [];
  const items = Array.isArray(cfg?.items) ? cfg.items : [];
  if (buckets.length < 2 || items.length < buckets.length) return false;

  const counts = new Array(buckets.length).fill(0);
  for (const it of items) {
    const bi = it?.bucketIndex;
    if (typeof bi === "number" && bi >= 0 && bi < buckets.length) {
      counts[bi] += 1;
    }
  }
  return counts.every((c) => c > 0);
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

function physicalMcItemsAreValid(items) {
  return (
    Array.isArray(items) &&
    items.length >= 3 &&
    items.every(
      (it) =>
        isNonEmptyString(it?.prompt) &&
        Array.isArray(it?.options) &&
        it.options.length === 4 &&
        Number.isInteger(it?.correctAnswer) &&
        it.correctAnswer >= 0 &&
        it.correctAnswer < it.options.length
    )
  );
}

}

function cluesAreValid(clues) {
  return (
    Array.isArray(clues) &&
    clues.length >= 3 &&
    clues.every((c) => isNonEmptyString(c?.clue))
  );
}

function shuffleArray(arr) {
  const a = Array.isArray(arr) ? [...arr] : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Targeted regeneration for one broken task (same type, more content)
export async function regenerateSingleTask({
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
- PHYSICAL_MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions, and EACH question must have exactly 4 options.
- HANGMAN_DUEL must include wordsByStation[]
- BRAINSTORM_BATTLE must be a divergent brainstorm: include a clear prompt/topic; NO single correct answer; include timeLimitSeconds (60–150).
- COLLABORATION must include a clear prompt for a written response, and should encourage point-form or sentences; it's AI-scored with a rubric.
- LIVE_DEBATE must include a debate motion/postulate (task.postulate or prompt) suitable for grades 7+ and a short structure reminder (timed turns, rebuttals). Do NOT hardcode team names; pairing/sides are handled by Curriculate at runtime.
- TRUE_FALSE_TICTACTOE must include statements[] with boolean isFalse (mix true/false). Provide at least 8 statements.

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
  "statements": [],
  "board": [],
  "postulate": "",
  "config": {},
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

    // Demo generator support: if the demo flow hits the same /api/ai/tasksets route,
    // allow the caller to request a clearly-labeled set.
    const isDemoRequest =
      !!req.body?.isDemo ||
      !!req.body?.demo ||
      String(req.body?.source || "").toLowerCase() === "demo";

    const requestedCount = Number(numberOfTasks) || Number(numTasks) || 8;
    const duration = Number(totalDurationMinutes) || Number(durationMinutes) || 45;

    const { errors, difficulty: normDifficulty, learningGoal: normGoal } =
      validateGeneratePayload({ subject, gradeLevel, difficulty, learningGoal });

    if (errors.length) {
      return res
        .status(400)
        .json({ error: "Invalid payload: " + errors.join(", ") });
    }

    let safeCount = clampInt(requestedCount, 4, 20, 8);

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

    // If the caller requested a lot of types, but also asked for enough tasks to include them,
    // we enforce that the final set includes each requested type at least once.
    // (This prevents "missing tasks" like Matching simply because the model didn't pick it.)
    const requestedTypeSet = new Set(typePool);
    const mustCoverAllRequestedTypes = safeCount >= requestedTypeSet.size;


    // Demo/test can pass an explicit taskTypes[] list (often the full set of eligible types).
    const requestedTypesRaw = Array.isArray(req.body?.taskTypes) ? req.body.taskTypes : null;
    const requestedTypes = requestedTypesRaw?.length
      ? requestedTypesRaw
          .map(normalizeSelectedType)
          .filter(Boolean)
          .filter((t) => AI_ELIGIBLE_TYPES.includes(t))
      : null;

    // If demo requested explicit types, generate one per type (and set count accordingly).
    if (isDemoRequest && requestedTypes?.length) {
      safeCount = clampInt(requestedTypes.length, 4, 40, requestedTypes.length);
      typePool = requestedTypes.slice(); // force exact coverage for demo
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
        .split(/\r?\n+/)
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

    const coverAllLine = mustCoverAllRequestedTypes
      ? `- You MUST include EACH allowed taskType at least once (since there are enough tasks to cover them all).`
      : "";

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
${coverAllLine}
- Each task has a short clear title and a prompt that students will see.
- For SORT tasks: include config.buckets (>=2) and config.items (>=3) with {text, bucketIndex|null}. Ensure EVERY bucket has at least one item correctly assigned (no empty categories).
- For SEQUENCE tasks: include config.items (>=3) with {text}
- For MATCHING tasks: include leftItems (5–7) and rightItems (5–7), each item {id,label}. Also include correctMatches as a map { "leftId": "rightId" }. (You may also include correctAnswer with the same map.)
- For VENNSORT tasks: include config.categories (2–3 strings), config.items (5–10 strings or {id,text}), and correctAnswer as a map { "itemId": ["CategoryA", "CategoryB"] } (empty array allowed).
- For JEOPARDY/BrainBlitz tasks: include clues (>=3) with {clue, answer}
- For FLASHCARDS tasks: include config.items (>=5) with {question, answer}
- For DIFF_DETECTIVE tasks: include config.textA and config.textB (3–6 sentences each) with 5–8 subtle differences.
- For GUESS_WHO tasks: include config.playerCount (2–6), config.secretAnswers (array length = playerCount; each is a single concept), config.category (string), config.maxGuesses (<=15, default 10), config.timerSeconds (<=180, default 60). The secretAnswers should be chosen ONLY from aiWordBank when possible. Do NOT include inter-team gameplay.
- For ROLE_PLAY_DECK tasks: include config.playerCount (2–6), config.playerNames (length playerCount), config.mode ("mystery" or "classic" or "choose"), config.roles (length playerCount) each { name, role, characteristics: [3–6 traits] }, and config.scenario (2–5 sentences, subject/grade appropriate). Intra-team only; do NOT include inter-team gameplay.
- MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions (each with prompt, options[], correctAnswer index).
- PHYSICAL_MULTIPLE_CHOICE must be multi-item: include items[] with 3–5 questions, and EACH question must have exactly 4 options.
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

    let aiTasks = null;

    if (isDemoRequest && requestedTypes?.length) {
      // Generate EXACTLY one task per requested type (most reliable for Demo)
      const demoTasks = [];
      for (const allowedType of requestedTypes) {
        const mustHave = retryMustHave?.[allowedType] || `Produce a valid ${allowedType} task with all required fields.`;
        try {
          const t = await regenerateSingleTask({
            allowedType,
            mustHave,
            subject,
            gradeLevel,
            difficulty: normDifficulty,
            learningGoal: normGoal,
            topicLabel,
            vocabularyLines,
            specialConsiderations: [specialConsiderations, customNotes].filter(Boolean).join("\n\n"),
            previousTask: null,
          });
          demoTasks.push(t);
        } catch (e) {
          console.error("Demo per-type generation failed for", allowedType, e);
          // fall back to a placeholder so demo never hard-fails
          demoTasks.push({
            title: `${allowedType} (placeholder)`,
            prompt: `Demo placeholder for ${allowedType}. Please regenerate this task.`,
            taskType: allowedType,
            options: [],
            correctAnswer: null,
            items: [],
            clues: [],
            config: {},
          });
        }
      }
      aiTasks = demoTasks;
    } else {
      const completion = await client.chat.completions.create({
      model: process.env.AI_TASKSET_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 2600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "[]";

    if (!aiTasks) aiTasks = extractJsonFromText(raw);
    }

    if (!aiTasks) {
      console.error("AI taskset JSON parse error:", raw.slice(0, 1200));
      return res.status(500).json({ error: "AI returned invalid JSON for taskset" });
    }

    if (!Array.isArray(aiTasks) || aiTasks.length === 0) {
      return res.status(500).json({ error: "AI returned no tasks" });
    }

    const targetCount = requestedTypes?.length
      ? requestedTypes.length
      : Number(numberOfTasks || 8);

    // Demo generates one task per taskType
        // Demo can request specific taskTypes. We accept AI returning tasks in any order,
    // but we must end up with exactly ONE task per requested type.
    if (requestedTypes?.length) {
      const want = requestedTypes.map(normalizeSelectedType).filter(Boolean);
      const wantSet = new Set(want);

      const byType = new Map(); // type -> task
      for (const t of Array.isArray(aiTasks) ? aiTasks : []) {
        const got = normalizeSelectedType(t?.taskType || t?.type);
        if (!got || !wantSet.has(got)) continue;
        if (!byType.has(got)) byType.set(got, t);
      }

      const missing = want.filter((t) => !byType.has(t));
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `AI did not return a task for: ${missing.join(", ")}`,
        });
      }

      // Re-order and collapse to one-per-type for downstream normalization
      aiTasks = want.map((t) => byType.get(t));
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

      
      // -------- GUESS WHO normalization --------
      else if (taskType === TASK_TYPES.GUESS_WHO) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
        const playerCount = clampInt(
          t.playerCount ?? aiConfig.playerCount ?? aiConfig.players,
          2,
          6,
          4
        );

        // secretAnswers: one per round/player
        let secretAnswers =
          Array.isArray(aiConfig.secretAnswers) ? aiConfig.secretAnswers
          : Array.isArray(t.secretAnswers) ? t.secretAnswers
          : Array.isArray(t.answers) ? t.answers
          : [];

        secretAnswers = secretAnswers
          .map((s) => String(s || "").trim())
          .filter(Boolean);

        // If insufficient, choose from word bank (unique, shuffled)
        if (secretAnswers.length < playerCount) {
          const pool = shuffleArray(rawWordBank.map((w) => String(w).trim()).filter(Boolean));
          for (const w of pool) {
            if (secretAnswers.length >= playerCount) break;
            if (!secretAnswers.includes(w)) secretAnswers.push(w);
          }
        }

        // Absolute fallback placeholders
        while (secretAnswers.length < playerCount) {
          secretAnswers.push(`Mystery ${secretAnswers.length + 1}`);
        }

        const timerSeconds = clampInt(
          t.timerSeconds ?? aiConfig.timerSeconds ?? t.timeLimitSeconds,
          15,
          180,
          60
        );

        const maxGuesses = clampInt(
          t.maxGuesses ?? aiConfig.maxGuesses,
          3,
          15,
          10
        );

        const category = isNonEmptyString(aiConfig.category)
          ? String(aiConfig.category).trim().slice(0, 60)
          : isNonEmptyString(t.category)
          ? String(t.category).trim().slice(0, 60)
          : "Guess Who";

        config = {
          ...aiConfig,
          playerCount,
          secretAnswers: secretAnswers.slice(0, playerCount),
          timerSeconds,
          maxGuesses,
          category,
          interTeamEnabled: false,
          intraTeamEnabled: true,
        };

        // GuessWho is an in-device deduction game; no AI scoring required.
        options = [];
        items = [];
        correctAnswer = null;
      }

      // -------- FAKE OUT normalization --------
      else if (taskType === TASK_TYPES.FAKE_OUT) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const playerCount = clampInt(
          t.playerCount ?? aiConfig.playerCount ?? aiConfig.players ?? aiConfig.numPlayers,
          2,
          8,
          4
        );

        const playerNames = Array.isArray(aiConfig.playerNames)
          ? aiConfig.playerNames.map((n, i) => String(n || "").trim() || `Player ${i + 1}`)
          : [];

        const rawRounds = Array.isArray(aiConfig.rounds)
          ? aiConfig.rounds
          : Array.isArray(t.rounds)
          ? t.rounds
          : [];

        const rounds = rawRounds
          .map((r) => {
            const statement = String(r?.statement || r?.prompt || "").trim();
            const options = Array.isArray(r?.options)
              ? r.options.map((x) => String(x || "").trim()).filter(Boolean)
              : Array.isArray(r?.choices)
              ? r.choices.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            const correctIndex =
              typeof r?.correctIndex === "number"
                ? r.correctIndex
                : typeof r?.answerIndex === "number"
                ? r.answerIndex
                : typeof r?.correctAnswer === "number"
                ? r.correctAnswer
                : null;

            return { statement, options, correctIndex };
          })
          .filter((r) => r.statement && Array.isArray(r.options) && r.options.length >= 4);

        const fixedRounds = rounds.map((r) => ({
          statement: r.statement,
          options: r.options.slice(0, 4),
          // IMPORTANT: correctIndex is only among the "serious" 3; option 4 is the obvious joke
          correctIndex:
            typeof r.correctIndex === "number" && r.correctIndex >= 0 && r.correctIndex <= 3
              ? r.correctIndex
              : 0,
        }));

        config = {
          ...aiConfig,
          playerCount,
          playerNames: playerNames.length ? playerNames.slice(0, playerCount) : undefined,
          rounds: fixedRounds,
          pointsPerCorrect: clampInt(aiConfig.pointsPerCorrect ?? 10, 1, 50, 10),
          readerBonusPoints: clampInt(aiConfig.readerBonusPoints ?? aiConfig.foolBonusPoints ?? 5, 0, 50, 5),
          interTeamEnabled: false,
          intraTeamEnabled: true,
        };

        // FakeOut is in-device; no AI scoring required.
        options = [];
        items = [];
        correctAnswer = null;

        if (!Array.isArray(fixedRounds) || fixedRounds.length < 1) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.FAKE_OUT;
        }
      }



// -------- ECHO CHAIN normalization --------
else if (taskType === TASK_TYPES.ECHO_CHAIN) {
  const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
  const seedFromAi = isNonEmptyString(t.seedTerm)
    ? String(t.seedTerm).trim()
    : isNonEmptyString(aiConfig.seedTerm)
    ? String(aiConfig.seedTerm).trim()
    : "";

  const bank = rawWordBank.map((w) => String(w || "").trim()).filter(Boolean);
  const fallbackSeed = bank.length ? bank[index % bank.length] : "concept";

  const seedTerm = (seedFromAi && bank.includes(seedFromAi)) ? seedFromAi : (seedFromAi || fallbackSeed);

  const perTurnSeconds = clampInt(
    t.perTurnSeconds ?? aiConfig.perTurnSeconds ?? aiConfig.turnSeconds,
    0,
    60,
    10
  );

  const rotationBonusPoints = clampInt(
    t.rotationBonusPoints ?? aiConfig.rotationBonusPoints,
    0,
    500,
    25
  );

  const pointsPerCorrectAdd = clampInt(
    t.pointsPerCorrectAdd ?? aiConfig.pointsPerCorrectAdd,
    0,
    50,
    5
  );

  const maxChainLength = clampInt(
    t.maxChainLength ?? aiConfig.maxChainLength,
    0,
    100,
    0
  );

  const title = isNonEmptyString(t.title)
    ? String(t.title).trim().slice(0, 120)
    : `Echo Chain: ${seedTerm}`;

  const prompt =
    isNonEmptyString(t.prompt)
      ? String(t.prompt).trim()
      : `Echo Chain! Start with “${seedTerm}”. Player 1 repeats it aloud and adds one related term. Player 2 repeats the full chain and adds one. Keep going around your team. If you forget a word or change the order, the chain breaks—laugh it off and restart!`;

  return {
    _localId: `t${index + 1}`,
    index,
    title,
    prompt,
    taskType,
    seedTerm,
    config: {
      seedTerm,
      perTurnSeconds,
      rotationBonusPoints,
      pointsPerCorrectAdd,
      maxChainLength: maxChainLength > 0 ? maxChainLength : undefined,
    },
    // Echo Chain is typically oral; no answer-key fields.
    options: [],
    objectiveScoring: false,
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

      
// -------- PHYSICAL MULTIPLE CHOICE normalization (multi only) --------
      if (taskType === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
        if (Array.isArray(t.items) && t.items.length) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;

          items = t.items.map((it, idx) => {
            const id = it.id || `q${idx + 1}`;
            const prompt =
              (it.prompt && String(it.prompt).trim()) ||
              (it.question && String(it.question).trim()) ||
              (it.text && String(it.text).trim()) ||
              `Question ${idx + 1}`;

            let ioptions = Array.isArray(it.options) ? it.options : [];
            // Enforce exactly 4 visible options for the physical station format
            if (ioptions.length < 4) {
              // pad deterministically (UI will still shuffle/present)
              const base = [...ioptions];
              while (base.length < 4) base.push(`Option ${String.fromCharCode(65 + base.length)}`);
              ioptions = base.slice(0, 4);
            } else if (ioptions.length > 4) {
              ioptions = ioptions.slice(0, 4);
            }

            let correctAnswer = it.correctAnswer;
            if (!Number.isInteger(correctAnswer)) {
              if (typeof correctAnswer === "string") {
                const idxFound = ioptions.findIndex(
                  (o) => String(o).trim() === String(correctAnswer).trim()
                );
                correctAnswer = idxFound >= 0 ? idxFound : 0;
              } else {
                correctAnswer = 0;
              }
            }

            if (correctAnswer < 0 || correctAnswer >= ioptions.length) {
              correctAnswer = 0;
            }

            return { id, prompt, options: ioptions, correctAnswer };
          });

          if (!physicalMcItemsAreValid(items)) {
            t.__needsRetry = true;
            t.__retryType = TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;

            const padded = Array.isArray(items) ? [...items] : [];
            while (padded.length < 3) {
              padded.push({
                id: `q${padded.length + 1}`,
                prompt: `Question ${padded.length + 1}`,
                options: ["Option A", "Option B", "Option C", "Option D"],
                correctAnswer: 0,
              });
            }
            items = padded.slice(0, 5);
          }

          options = [];
          correctAnswer = null;
        } else {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE;
          items = [
            {
              id: "q1",
              prompt: "Question 1",
              options: ["Option A", "Option B", "Option C", "Option D"],
              correctAnswer: 0,
            },
            {
              id: "q2",
              prompt: "Question 2",
              options: ["Option A", "Option B", "Option C", "Option D"],
              correctAnswer: 0,
            },
            {
              id: "q3",
              prompt: "Question 3",
              options: ["Option A", "Option B", "Option C", "Option D"],
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

        const basicValid = sortConfigIsValid(candidateCfg);
        const coverageValid = sortHasAtLeastOnePerBucket(candidateCfg);

        if (!basicValid || !coverageValid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.SORT;

          const safeBuckets = buckets.length >= 2 ? buckets.slice(0, 2) : ["Group A", "Group B"];
          const safeItems =
            sortItems.length >= Math.max(3, safeBuckets.length)
              ? sortItems.slice(0, Math.max(3, safeBuckets.length))
              : rawWordBank
                  .slice(0, Math.max(3, safeBuckets.length))
                  .map((w) => ({ text: String(w), bucketIndex: null }));

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

      // -------- FLASHCARDS normalization --------
      else if (taskType === TASK_TYPES.FLASHCARDS) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawCards =
          (Array.isArray(aiConfig.items) && aiConfig.items) ||
          (Array.isArray(t.cards) && t.cards) ||
          (Array.isArray(t.items) && t.items) ||
          [];

        const cards = rawCards
          .filter(Boolean)
          .slice(0, 12)
          .map((c, idx) => {
            if (typeof c === "string") {
              // allow "Q: ... | A: ..." as a compact format
              const s = c.trim();
              const parts = s.split("|").map((p) => p.trim());
              const q = parts[0]?.replace(/^q\s*:\s*/i, "").trim() || `Card ${idx + 1}`;
              const a = parts[1]?.replace(/^a\s*:\s*/i, "").trim() || "";
              return { question: q, answer: a };
            }
            if (c && typeof c === "object") {
              const question = String(c.question || c.q || c.front || c.prompt || "").trim();
              const answer = String(c.answer || c.a || c.back || c.response || "").trim();
              return { question, answer };
            }
            return { question: `Card ${idx + 1}`, answer: "" };
          })
          .filter((c) => isNonEmptyString(c.question) && isNonEmptyString(c.answer));

        const valid = cards.length >= 5;
        if (!valid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.FLASHCARDS;

          const safeCards = rawWordBank.slice(0, 5).map((w, i) => ({
            question: `Define: ${String(w || `Term ${i + 1}`).trim()}`,
            answer: "",
          }));

          config = { ...aiConfig, items: safeCards };
        } else {
          config = { ...aiConfig, items: cards };
        }

        options = [];
        items = [];
        correctAnswer = null;
      }

      
      // -------- FLASHCARDS RACE normalization --------
      else if (taskType === TASK_TYPES.FLASHCARDS_RACE) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawCards =
          (Array.isArray(aiConfig.items) && aiConfig.items) ||
          (Array.isArray(aiConfig.cards) && aiConfig.cards) ||
          (Array.isArray(t.cards) && t.cards) ||
          (Array.isArray(t.items) && t.items) ||
          [];

        const cards = rawCards
          .filter(Boolean)
          .slice(0, 12)
          .map((c, idx) => {
            if (typeof c === "string") {
              const s = c.trim();
              const parts = s.split("|").map((p) => p.trim());
              const q =
                parts[0]?.replace(/^q\s*:\s*/i, "").trim() || `Card ${idx + 1}`;
              const a = parts[1]?.replace(/^a\s*:\s*/i, "").trim() || "";
              return { question: q, answer: a };
            }
            if (c && typeof c === "object") {
              const question = String(
                c.question || c.q || c.front || c.prompt || ""
              ).trim();
              const answer = String(
                c.answer || c.a || c.back || c.response || ""
              ).trim();
              return { question, answer };
            }
            return { question: `Card ${idx + 1}`, answer: "" };
          })
          .filter((c) => isNonEmptyString(c.question) && isNonEmptyString(c.answer));

        const valid = cards.length >= 5;
        if (!valid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.FLASHCARDS_RACE;

          const safeCards = rawWordBank.slice(0, 5).map((w, i) => ({
            question: `Define: ${String(w || `Term ${i + 1}`).trim()}`,
            answer: "",
          }));

          config = { ...aiConfig, items: safeCards };
        } else {
          // Enforce simple, predictable race defaults
          const secondsPerCardRaw = Number(
            aiConfig.secondsPerCard ?? aiConfig.timePerCard ?? aiConfig.seconds ?? 20
          );
          const secondsPerCard = Number.isFinite(secondsPerCardRaw) && secondsPerCardRaw > 5
            ? Math.round(secondsPerCardRaw)
            : 20;

          const playerCountRaw = Number(aiConfig.playerCount ?? aiConfig.players ?? 2);
          const playerCount =
            Number.isFinite(playerCountRaw) && playerCountRaw >= 1 && playerCountRaw <= 4
              ? Math.round(playerCountRaw)
              : 2;

          config = {
            ...aiConfig,
            items: cards,
            secondsPerCard,
            playerCount,
            interTeam: aiConfig.interTeam !== false, // default true
            intraTeam: false,
            pointsCorrect: Number.isFinite(Number(aiConfig.pointsCorrect))
              ? Number(aiConfig.pointsCorrect)
              : 10,
            pointsFirstBuzzBonus: Number.isFinite(Number(aiConfig.pointsFirstBuzzBonus))
              ? Number(aiConfig.pointsFirstBuzzBonus)
              : 5,
          };
        }

        options = [];
        items = [];
        correctAnswer = null;
      }

// -------- WORD WEAVER normalization --------
      else if (taskType === TASK_TYPES.WORD_WEAVER_DUEL) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
        let phrase =
          String(
            t.phrase ||
              t.targetPhrase ||
              t.solution ||
              aiConfig.phrase ||
              aiConfig.targetPhrase ||
              aiConfig.solution ||
              ""
          ).trim();

        // fall back: parse "Reconstruct the phrase: '...'." or "...: \"...\""
        if (!phrase && isNonEmptyString(t.prompt)) {
          const m = String(t.prompt).match(/phrase\s*:\s*['\"]([^'\"]{4,120})['\"]/i);
          if (m && m[1]) phrase = String(m[1]).trim();
        }

        const tokens = phrase
          ? phrase
              .split(/\s+/)
              .map((w) => String(w).trim())
              .filter(Boolean)
          : [];

        const wordBank = Array.isArray(t.wordBank)
          ? t.wordBank.map((w) => String(w))
          : Array.isArray(aiConfig.wordBank)
            ? aiConfig.wordBank.map((w) => String(w))
            : tokens.length
              ? shuffleArray([...tokens])
              : [];

        const valid = isNonEmptyString(phrase) && tokens.length >= 2;
        if (!valid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.WORD_WEAVER_DUEL;
          phrase = rawWordBank.slice(0, 4).join(" ") || "Teamwork and Perseverance";
        }

        // Keep legacy fields as TOP-LEVEL for backward compatibility
        t.phrase = phrase;
        t.wordBank = wordBank;

        // Preferred new mode: Scrabble-like word placement on a grid.
        // If AI provided `words`, respect them; otherwise derive from wordBank/tokens.
        const aiWordsRaw = Array.isArray(t.words) ? t.words : Array.isArray(aiConfig.words) ? aiConfig.words : null;
        const derivedWords =
          Array.isArray(aiWordsRaw) && aiWordsRaw.length
            ? aiWordsRaw
            : (wordBank.length ? wordBank : tokens).slice(0, 10);

        const words = derivedWords
          .map((w) => String(w || "").trim())
          .filter(Boolean)
          .slice(0, 10);

        if (words.length >= 5) {
          t.mode = t.mode || "scrabble";
          t.words = words;
          t.gridSize =
            Number.isFinite(Number(t.gridSize)) && Number(t.gridSize) >= 7
              ? Number(t.gridSize)
              : Number.isFinite(Number(aiConfig.gridSize)) && Number(aiConfig.gridSize) >= 7
                ? Number(aiConfig.gridSize)
                : 11;

          t.turnkeeper =
            typeof t.turnkeeper === "object" && t.turnkeeper
              ? t.turnkeeper
              : typeof aiConfig.turnkeeper === "object" && aiConfig.turnkeeper
                ? aiConfig.turnkeeper
                : {
                    playerCount: Number(aiConfig.playerCount) > 0 ? Number(aiConfig.playerCount) : 2,
                    perTurnSeconds: Number(aiConfig.perTurnSeconds) > 0 ? Number(aiConfig.perTurnSeconds) : 25,
                  };
        } else {
          // If we can't form a real scrabble round, fall back to phrase rebuild mode.
          t.mode = t.mode || "phrase";
        }

        config = { ...aiConfig };
        options = [];
        items = [];
        correctAnswer = null;
      }

      // -------- DIFF DETECTIVE normalization --------
      else if (taskType === TASK_TYPES.DIFF_DETECTIVE) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};
        const textA = String(
          aiConfig.textA || t.textA || aiConfig.a || t.a || aiConfig.leftText || t.leftText || ""
        ).trim();
        const textB = String(
          aiConfig.textB || t.textB || aiConfig.b || t.b || aiConfig.rightText || t.rightText || ""
        ).trim();

        const valid = isNonEmptyString(textA) && isNonEmptyString(textB) && textA !== textB;
        if (!valid) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.DIFF_DETECTIVE;

          const fallbackA = `Culture is the shared beliefs, customs, and behaviors of a group. It includes language, traditions, values, and art. Culture is passed down over time through families and communities.`;
          const fallbackB = `Culture is the shared beliefs, customs, and behaviors of a group. It includes language, traditions, values, and art. Culture changes over time through contact with other groups.`;
          config = { ...aiConfig, textA: fallbackA, textB: fallbackB };
        } else {
          config = { ...aiConfig, textA, textB };
        }

        options = [];
        items = [];
        correctAnswer = null;
      }

      // -------- BRAIN SPARK NOTES normalization --------
      else if (taskType === TASK_TYPES.BRAIN_SPARK_NOTES) {
        // Expected shape for student UI:
        //  - t.title (string)
        //  - t.bullets: 3–5 bullets (Grades < 8) OR 6–10 bullets (Grades 8+)
        //  - Optional: t.prompt (topic prompt), used by teachers / transcripts
        const gradeRaw = t.gradeLevel ?? t.grade ?? t.config?.gradeLevel ?? null;
        const gradeLevel = Number.isFinite(Number(gradeRaw)) ? Number(gradeRaw) : null;

        const minBullets = gradeLevel != null && gradeLevel >= 8 ? 6 : 3;
        const maxBullets = gradeLevel != null && gradeLevel >= 8 ? 10 : 5;

        const rawBullets =
          (Array.isArray(t.bullets) && t.bullets.length && t.bullets) ||
          (Array.isArray(t.items) && t.items.length && t.items) ||
          (Array.isArray(t.options) && t.options.length && t.options) ||
          [];

        let bullets = rawBullets
          .map((b, idx) => {
            if (typeof b === "string") return b.trim();
            if (b && typeof b === "object") {
              const text =
                b.text ||
                b.prompt ||
                b.title ||
                b.note ||
                b.description ||
                b.value ||
                `Note ${idx + 1}`;
              return String(text).trim();
            }
            return String(b || `Note ${idx + 1}`).trim();
          })
          .filter(Boolean)
          .map((s) => String(s).trim())
          .filter(Boolean);

        // De-dupe while preserving order
        const seen = new Set();
        bullets = bullets.filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        // Clamp size (but do not invent content if AI provided too little)
        if (bullets.length > maxBullets) bullets = bullets.slice(0, maxBullets);

        // Always keep bullets on the root object for the task component.
        t.bullets = bullets;

        // Normalize generic task fields
        options = [];
        items = [];
        correctAnswer = null;

        // Ensure ai scoring defaults if not explicitly set by task authoring
        if (t.aiScoringRequired == null) t.aiScoringRequired = true;
      }

      // -------- Mind Mapper normalization (keeps config.items) --------
      else if (taskType === TASK_TYPES.MIND_MAPPER) {
        // Expected shape for student UI:
        //  - t.organizerType: one of a known set (mind-map, hierarchy, fishbone, flowchart, venn, web)
        //  - t.config.items: 5–7 idea cards (strings or objects with text)
        //  - Optional: t.shuffledItems pre-randomized (the UI supports it)
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const gradeRaw = t.gradeLevel ?? t.grade ?? aiConfig.gradeLevel ?? null;
        const gradeLevel = Number.isFinite(Number(gradeRaw)) ? Number(gradeRaw) : null;

        // Medium/Hard can omit hierarchy hints; the UI itself shuffles and lets kids drag-sort.
        // We'll still cap item counts to keep the task readable.
        const minIdeas = 5;
        const maxIdeas = 7;

        const organizerTypeRaw =
          t.organizerType ||
          aiConfig.organizerType ||
          aiConfig.organizer ||
          aiConfig.template ||
          "mind-map";

        const allowedOrganizers = new Set([
          "mind-map",
          "hierarchy",
          "fishbone",
          "flowchart",
          "venn",
          "web",
        ]);

        const organizerType = allowedOrganizers.has(String(organizerTypeRaw))
          ? String(organizerTypeRaw)
          : "mind-map";

        const rawItems = Array.isArray(aiConfig.items)
          ? aiConfig.items
          : Array.isArray(t.items)
          ? t.items
          : Array.isArray(t.options)
          ? t.options
          : [];

        let mapped = rawItems
          .map((it, idx) => {
            if (typeof it === "string") return { text: it.trim(), correctIndex: idx };
            if (it && typeof it === "object") {
              const text =
                it.text || it.label || it.name || it.prompt || it.value || `Idea ${idx + 1}`;
              let correctIndex = it.correctIndex;
              if (typeof correctIndex !== "number") correctIndex = idx;
              return { text: String(text).trim(), correctIndex };
            }
            return { text: String(it || `Idea ${idx + 1}`).trim(), correctIndex: idx };
          })
          .filter((x) => x && x.text && String(x.text).trim());

        // De-dupe ideas (case-insensitive), preserve order
        const seen = new Set();
        mapped = mapped.filter((x) => {
          const k = String(x.text).trim().toLowerCase();
          if (!k) return false;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        // Clamp ideas to 5–7, but don't invent content if AI under-generated
        if (mapped.length > maxIdeas) mapped = mapped.slice(0, maxIdeas);

        // Ensure correctIndex forms 0..n-1 (canonical order)
        mapped = mapped.map((x, idx) => ({ ...x, correctIndex: idx }));

        config = { ...aiConfig, organizerType, items: mapped };
        t.organizerType = organizerType;
        t.config = config;

        // Pre-randomize for the UI (it will still normalize if absent).
        // We keep deterministic shuffle so two students on the same task get the same order.
        if (!Array.isArray(t.shuffledItems) || t.shuffledItems.length === 0) {
          const seedStr = String(t._id || t.id || t.taskId || "mind-mapper");
          const shuffled = [...mapped];
          let seed = 0;
          for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
          const rand = () => {
            seed ^= seed << 13; seed >>>= 0;
            seed ^= seed >> 17; seed >>>= 0;
            seed ^= seed << 5; seed >>>= 0;
            return (seed >>> 0) / 4294967296;
          };
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rand() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          t.shuffledItems = shuffled.map((x, idx) => ({ id: `item-${idx}`, text: x.text, correctIndex: x.correctIndex }));
        }

        options = [];
        items = [];
        correctAnswer = null;

        if (t.aiScoringRequired == null) t.aiScoringRequired = true;
      }

      // -------- MATCHING normalization --------
      else if (taskType === TASK_TYPES.MATCHING) {
        const aiConfig = t.config && typeof t.config === "object" ? t.config : {};

        const rawLeft =
          (Array.isArray(t.leftItems) && t.leftItems) ||
          (Array.isArray(aiConfig.leftItems) && aiConfig.leftItems) ||
          null;

        const rawRight =
          (Array.isArray(t.rightItems) && t.rightItems) ||
          (Array.isArray(aiConfig.rightItems) && aiConfig.rightItems) ||
          null;

        const rawPairs =
          (Array.isArray(t.pairs) && t.pairs) ||
          (Array.isArray(t.items) && t.items) ||
          (Array.isArray(aiConfig.pairs) && aiConfig.pairs) ||
          (Array.isArray(aiConfig.items) && aiConfig.items) ||
          [];

        const normItem = (x, idx, prefix) => {
          if (typeof x === "string") return { id: `${prefix}${idx + 1}`, label: x.trim() };
          const id = String(x?.id || x?._id || x?.key || `${prefix}${idx + 1}`).trim();
          const label = String(x?.label || x?.text || x?.term || "").trim();
          return { id, label: label || `${prefix}${idx + 1}` };
        };

        let leftItemsLocal = [];
        let rightItemsLocal = [];
        let correctMatchesLocal = {};

        if (rawLeft && rawRight) {
          leftItemsLocal = rawLeft.map((x, idx) => normItem(x, idx, "L"));
          rightItemsLocal = rawRight.map((x, idx) => normItem(x, idx, "R"));

          const cm =
            (t.correctMatches && typeof t.correctMatches === "object" && t.correctMatches) ||
            (t.correctAnswer && typeof t.correctAnswer === "object" && t.correctAnswer) ||
            (aiConfig.correctMatches && typeof aiConfig.correctMatches === "object" && aiConfig.correctMatches) ||
            (aiConfig.correctAnswer && typeof aiConfig.correctAnswer === "object" && aiConfig.correctAnswer) ||
            {};

          correctMatchesLocal = Object.fromEntries(
            Object.entries(cm).map(([k, v]) => [String(k), String(v)])
          );
        } else {
          leftItemsLocal = rawPairs.map((p, idx) => ({
            id: String(p?.leftId || p?.leftKey || p?.id || `L${idx + 1}`),
            label: String(p?.leftLabel || p?.leftText || p?.left || p?.term || `Left ${idx + 1}`).trim(),
          }));
          rightItemsLocal = rawPairs.map((p, idx) => ({
            id: String(p?.rightId || p?.rightKey || p?.matchId || `R${idx + 1}`),
            label: String(p?.rightLabel || p?.rightText || p?.right || p?.definition || `Right ${idx + 1}`).trim(),
          }));
          correctMatchesLocal = Object.fromEntries(
            rawPairs.map((p, idx) => {
              const leftId = String(p?.leftId || p?.leftKey || p?.id || `L${idx + 1}`);
              const rightId = String(p?.rightId || p?.rightKey || p?.matchId || `R${idx + 1}`);
              return [leftId, rightId];
            })
          );
        }

        if (leftItemsLocal.length < 3 || rightItemsLocal.length < 3) {
          t.__needsRetry = true;
          t.__retryType = TASK_TYPES.MATCHING;

          const fallback = rawWordBank.slice(0, 6);
          leftItemsLocal = fallback.map((w, i) => ({ id: `L${i + 1}`, label: String(w) }));
          rightItemsLocal = fallback
            .slice()
            .reverse()
            .map((w, i) => ({ id: `R${i + 1}`, label: String(w) }));
          correctMatchesLocal = Object.fromEntries(
            leftItemsLocal.map((l, i) => [l.id, rightItemsLocal[rightItemsLocal.length - 1 - i]?.id || rightItemsLocal[i]?.id])
          );
        }

        // lift to top-level for the student MatchingTask component + objective checking
        t.leftItems = leftItemsLocal;
        t.rightItems = rightItemsLocal;
        t.correctMatches = correctMatchesLocal;
        t.correctAnswer = correctMatchesLocal;

        options = [];
        items = [];
        config = { ...aiConfig };
        correctAnswer = correctMatchesLocal;
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
        taskType === TASK_TYPES.BRAIN_SPARK_NOTES ||
        taskType === TASK_TYPES.GUESS_WHO
      ) {
        correctAnswer = null;
      }

      // --- aiScoringRequired: objective types default false ---
      let aiScoringRequired;
      if (typeof t.aiScoringRequired === "boolean") aiScoringRequired = t.aiScoringRequired;
      else if (objective) aiScoringRequired = false;
      else if (taskType === TASK_TYPES.GUESS_WHO) aiScoringRequired = false;
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


      if (taskType === TASK_TYPES.MAD_DASH_SEQUENCE || taskType === TASK_TYPES.MAD_DASH) {
        // Preserve sequence fields for scan-race tasks
        out.sequence = Array.isArray(t.sequence) ? t.sequence : [];
        out.sequenceItems = Array.isArray(t.sequenceItems) ? t.sequenceItems : [];
        if (Array.isArray(t.stationColors)) out.stationColors = t.stationColors;
      }

      if (taskType === TASK_TYPES.JEOPARDY) out.clues = clues;

      if (taskType === TASK_TYPES.MATCHING) {
        out.leftItems = Array.isArray(t.leftItems) ? t.leftItems : [];
        out.rightItems = Array.isArray(t.rightItems) ? t.rightItems : [];
        out.correctMatches =
          t.correctMatches && typeof t.correctMatches === "object" ? t.correctMatches : {};
      }

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


          // ---- FAKE OUT ----
          if (allowedType === TASK_TYPES.FAKE_OUT) {
            const cfg =
              regenerated?.config && typeof regenerated.config === "object"
                ? regenerated.config
                : {};

            const playerCount = clampInt(cfg.playerCount ?? 4, 2, 8, 4);

            const rawRounds = Array.isArray(cfg.rounds) ? cfg.rounds : [];
            const rounds = rawRounds
              .map((r) => ({
                statement: String(r?.statement || "").trim(),
                options: Array.isArray(r?.options)
                  ? r.options.map((x) => String(x || "").trim()).filter(Boolean)
                  : [],
                correctIndex: typeof r?.correctIndex === "number" ? r.correctIndex : null,
              }))
              .filter((r) => r.statement && Array.isArray(r.options) && r.options.length >= 4);

            if (rounds.length >= 1) {
              replaced = {
                ...t,
                title:
                  typeof regenerated?.title === "string" && regenerated.title.trim()
                    ? regenerated.title.trim()
                    : t.title,
                prompt:
                  typeof regenerated?.prompt === "string" && regenerated.prompt.trim()
                    ? regenerated.prompt.trim()
                    : t.prompt,
                taskType: TASK_TYPES.FAKE_OUT,
                options: [],
                items: [],
                correctAnswer: null,
                config: {
                  ...cfg,
                  playerCount,
                  rounds: rounds.map((r) => ({
                    statement: r.statement,
                    options: r.options.slice(0, 4),

                    // IMPORTANT FIX:
                    // FakeOut options length is 4, so correctIndex must be 0..3 (not 0..2)
                    correctIndex:
                      typeof r.correctIndex === "number" && r.correctIndex >= 0 && r.correctIndex <= 3
                        ? r.correctIndex
                        : 0,
                  })),
                  interTeamEnabled: false,
                  intraTeamEnabled: true,
                },
                aiScoringRequired: t.aiScoringRequired ?? false,
              };
            }

            // invalid fake-out; continue retry loop
            continue;
          }

          // ---- SEQUENCE ----
          if (allowedType === TASK_TYPES.SEQUENCE) {
            const cfg =
              regenerated?.config && typeof regenerated.config === "object"
                ? regenerated.config
                : {};

            const rawItems = Array.isArray(cfg.items) ? cfg.items : [];
            const fixedItems = rawItems
              .slice(0, 10)
              .map((it, idx) => {
                if (typeof it === "string") {
                  return { text: String(it || `Step ${idx + 1}`).trim() };
                }
                return {
                  text: String(it?.text || it?.label || it?.name || it?.value || `Step ${idx + 1}`).trim(),
                };
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

            // invalid sequence; continue retry loop
            continue;
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

          

if (allowedType === TASK_TYPES.BRAINSTORM_BATTLE) {
  // Divergent idea list; no single correct answer required.
  const tl = clampInt(
    regenerated?.timeLimitSeconds ?? t.timeLimitSeconds ?? 90,
    60,
    150,
    90
  );

  fixed = {
    ...t,
    title: isNonEmptyString(regenerated?.title)
      ? String(regenerated.title).trim().slice(0, 120)
      : t.title,
    prompt: isNonEmptyString(regenerated?.prompt)
      ? String(regenerated.prompt).trim()
      : t.prompt,
    taskType: TASK_TYPES.BRAINSTORM_BATTLE,
    options: [],
    items: [],
    correctAnswer: null,
    aiScoringRequired: false,
    timeLimitSeconds: tl,
    points: t.points,
    config:
      regenerated?.config && typeof regenerated.config === "object"
        ? regenerated.config
        : {},
  };
  break;
}

if (allowedType === TASK_TYPES.COLLABORATION) {
  const tl = clampInt(
    regenerated?.timeLimitSeconds ?? t.timeLimitSeconds ?? 180,
    60,
    300,
    180
  );

  const cfg =
    regenerated?.config && typeof regenerated.config === "object"
      ? regenerated.config
      : {};

  fixed = {
    ...t,
    title: isNonEmptyString(regenerated?.title)
      ? String(regenerated.title).trim().slice(0, 120)
      : t.title,
    prompt: isNonEmptyString(regenerated?.prompt)
      ? String(regenerated.prompt).trim()
      : t.prompt,
    taskType: TASK_TYPES.COLLABORATION,
    options: [],
    items: [],
    correctAnswer: null,
    aiScoringRequired: true,
    timeLimitSeconds: tl,
    points: t.points,
    config: { ...cfg, aiRubricHint: cfg.aiRubricHint || "Score for completeness, clarity, evidence, and thoughtfulness. If replying to another team's answer, score for specific engagement and constructive extension." },
  };
  break;
}

if (allowedType === TASK_TYPES.LIVE_DEBATE) {
  const tl = clampInt(
    regenerated?.timeLimitSeconds ?? t.timeLimitSeconds ?? 135,
    90,
    180,
    135
  );

  const postulate =
    (isNonEmptyString(regenerated?.postulate) && String(regenerated.postulate).trim()) ||
    (isNonEmptyString(regenerated?.motion) && String(regenerated.motion).trim()) ||
    (isNonEmptyString(regenerated?.prompt) && String(regenerated.prompt).trim()) ||
    (isNonEmptyString(t?.postulate) && String(t.postulate).trim()) ||
    (isNonEmptyString(t?.prompt) && String(t.prompt).trim()) ||
    "";

  const cfg =
    regenerated?.config && typeof regenerated.config === "object"
      ? regenerated.config
      : {};

  fixed = {
    ...t,
    title: isNonEmptyString(regenerated?.title)
      ? String(regenerated.title).trim().slice(0, 120)
      : t.title || "Live Debate",
    prompt: isNonEmptyString(regenerated?.prompt)
      ? String(regenerated.prompt).trim()
      : t.prompt,
    postulate,
    taskType: TASK_TYPES.LIVE_DEBATE,
    options: [],
    items: [],
    correctAnswer: null,
    aiScoringRequired: true,
    timeLimitSeconds: tl,
    points: t.points,
    config: {
      prepSeconds: clampInt(cfg.prepSeconds ?? 300, 60, 600, 300),
      minSpeakSeconds: clampInt(cfg.minSpeakSeconds ?? 105, 30, 180, 105),
      maxSpeakSeconds: clampInt(cfg.maxSpeakSeconds ?? 135, 45, 180, 135),
      graceSeconds: clampInt(cfg.graceSeconds ?? 15, 0, 60, 15),
      ...cfg,
    },
  };
  break;
}

if (allowedType === TASK_TYPES.TRUE_FALSE_TICTACTOE) {
  const rawStatements =
    (Array.isArray(regenerated?.statements) && regenerated.statements) ||
    (Array.isArray(regenerated?.config?.statements) && regenerated.config.statements) ||
    (Array.isArray(regenerated?.items) && regenerated.items) ||
    [];

  const statements = rawStatements
    .map((s, idx) => {
      if (typeof s === "string") {
        const txt = s.trim();
        return txt ? { text: txt, isFalse: idx % 2 === 0 } : null;
      }
      if (s && typeof s === "object") {
        const txt = String(s.text || s.statement || s.prompt || "").trim();
        if (!txt) return null;
        const isFalse =
          typeof s.isFalse === "boolean"
            ? s.isFalse
            : typeof s.isTrue === "boolean"
            ? !s.isTrue
            : idx % 2 === 0;
        return { text: txt, isFalse };
      }
      return null;
    })
    .filter(Boolean);

  // Ensure a mix of true/false and a minimum count
  const tfCount = {
    true: statements.filter((x) => x && x.isFalse === false).length,
    false: statements.filter((x) => x && x.isFalse === true).length,
  };

  if (statements.length < 8 || tfCount.true === 0 || tfCount.false === 0) {
    continue; // force retry
  }

  fixed = {
    ...t,
    title: isNonEmptyString(regenerated?.title)
      ? String(regenerated.title).trim().slice(0, 120)
      : t.title || "True/False Tic-Tac-Toe",
    prompt: isNonEmptyString(regenerated?.prompt)
      ? String(regenerated.prompt).trim()
      : t.prompt,
    taskType: TASK_TYPES.TRUE_FALSE_TICTACTOE,
    options: [],
    items: [],
    correctAnswer: null,
    aiScoringRequired: false,
    timeLimitSeconds: clampInt(
      regenerated?.timeLimitSeconds ?? t.timeLimitSeconds ?? 180,
      60,
      240,
      180
    ),
    points: t.points,
    board: Array.isArray(regenerated?.board) && regenerated.board.length === 9
      ? regenerated.board
      : Array(9).fill(null),
    statements,
    config:
      regenerated?.config && typeof regenerated.config === "object"
        ? regenerated.config
        : {},
  };
  break;
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

    // --- Ensure each requested type appears at least once (when there are enough tasks) ---
    if (mustCoverAllRequestedTypes && tasks.length) {
      const present = new Set(tasks.map((t) => t?.taskType).filter(Boolean));
      const missing = [...requestedTypeSet].filter((t) => t && !present.has(t));

      // Replace surplus tasks (starting from the end) with regenerated missing-type tasks.
      for (let m = 0; m < missing.length; m++) {
        const missingType = missing[m];
        const mustHave = retryMustHave[missingType] || "Provide a valid task payload.";

        try {
          const regenerated = await regenerateSingleTask({
            allowedType: missingType,
            mustHave,
            subject,
            gradeLevel,
            difficulty: normDifficulty,
            learningGoal: normGoal,
            topicLabel,
            vocabularyLines,
            specialConsiderations,
            previousTask: {},
          });

          if (regenerated && typeof regenerated === "object") {
            // Put it through the same normalization pipeline by pretending it's one of the tasks
            const one = await (async () => {
              const tmp = { ...regenerated, taskType: missingType };
              // Minimal fields expected later in the mapping
              return tmp;
            })();

            // Replace from the end so we don't disturb earlier ordering.
            const replaceIdx = Math.max(0, tasks.length - 1 - m);
            tasks[replaceIdx] = { ...tasks[replaceIdx], ...one, taskType: missingType };
          }
        } catch (e) {
          console.error("Missing-type regeneration failed", { missingType, error: e?.message || String(e) });
        }
      }
    }

    const now = new Date();
    let finalName = explicitName || topicLabel;
    if (!isNonEmptyString(finalName)) finalName = "Untitled";
    if (isDemoRequest && !String(finalName).startsWith("Demo Set: ")) {
      finalName = `Demo Set: ${finalName}`;
    }

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

export { normalizeSelectedType, retryMustHave, regenerateSingleTask };


export default { generateAiTaskset };