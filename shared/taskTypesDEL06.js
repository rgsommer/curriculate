// shared/taskTypes.js

// Canonical task type IDs used across backend, editor, and AI generator
export const TASK_TYPES = {
  // Core Q&A
  MULTIPLE_CHOICE: "multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT_ANSWER: "short-answer",

  // Open / media responses used in StudentApp TaskRunner
  OPEN_TEXT: "open-text",
  RECORD_AUDIO: "record-audio",
  DRAW: "draw",
  MIME: "mime",

  // Ordering / drag-and-drop
  SORT: "sort",
  SEQUENCE: "sequence",
  TIMELINE: "timeline",
  VENNSORT: "vennsort",  // NEW: Venn diagram sorting with overlaps

  // Visual / creative proof
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap", // build/draw something then snap a photo
  BODY_BREAK: "body-break",       // movement break
  PHOTO_JOURNAL: "photo-journal", // NEW: photo + written explanation combo

  // ✅ NEW: vibe-setter (no scoring, no timer)
  MOOD_CHECKIN: "mood-checkin",

  // Waiting-room mini-game (between tasks)
  TREASURE_RUNNER: "treasure-runner",

  // Extended task types (some may not be AI-generated yet)
  JEOPARDY: "brain-blitz",        // renamed from "jeopardy"
  COLLABORATION: "collaboration",
  MUSICAL_CHAIRS: "musical-chairs",
  MYSTERY_CLUES: "mystery-clues",
  TRUE_FALSE_TICTACTOE: "true-false-tictactoe",
  MAD_DASH: "mad-dash",
  LIVE_DEBATE: "live-debate",
  FLASHCARDS: "flashcards",
  BRAIN_SPARK_NOTES: "brain-spark-notes",
  PET_FEEDING: "pet-feeding",
  MOTION_MISSION: "motion-mission",
  BRAINSTORM_BATTLE: "brainstorm-battle",
  MIND_MAPPER: "mind-mapper",
  HIDENSEEK: "hidenseek",
  SPEED_DRAW: "speed-draw",
  DIFF_DETECTIVE: "diff-detective",
  DRAW_MIME: "draw-mime",
  MATCHING: "matching",
  HANGMAN_DUEL: "hangman-duel",
  WORD_WEAVER_DUEL: "word-weaver-duel",

  // Kept for backwards compatibility; behaviour now largely driven by location
  MULTI_ROOM_SCAVENGER_HUNT: "multi-room-scavenger-hunt",

  // New / AI-augmented task types
  PRONUNCIATION: "pronunciation",
  SPEECH_RECOGNITION: "speech-recognition",
  AI_DEBATE_JUDGE: "ai-debate-judge",
};

// Category labels (for grouping & UI)
const CATEGORY = {
  QUESTION: "question",
  ORDERING: "ordering",
  CREATIVE: "creative",
  MOVEMENT: "movement",
  COMPETITIVE: "competitive",
  REVIEW: "review",
  PHYSICAL: "physical",
};

// Core metadata for each implemented task type
// NOTE: maxTime is in seconds and duplicated as maxTimeSeconds for clarity.
// NEW: quickTaskEligible → can be sensibly used as a one-off Quick Task.
export const TASK_TYPE_META = {
  // === CORE AI-ELIGIBLE TYPES ===

  [TASK_TYPES.MULTIPLE_CHOICE]: {
    label: "Multiple choice",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTime: 60,
    maxTimeSeconds: 60,
    implemented: true,
    aiEligible: true,

    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "single-option",

    quickTaskEligible: true,

    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },

    description:
      "Classic multiple-choice question with 3–5 options. Provide one clearly correct answer. Great for quick knowledge checks.",
  },

  [TASK_TYPES.TRUE_FALSE]: {
    label: "True / False",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTime: 45,
    maxTimeSeconds: 45,
    implemented: true,
    aiEligible: true,

    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "single-option",

    quickTaskEligible: true,

    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },

    description:
      "True or False statement. Make it tricky but fair — students should have to think, not just guess.",
  },

  [TASK_TYPES.SHORT_ANSWER]: {
    label: "Short answer",
    category: CATEGORY.QUESTION,
    hasOptions: false,
    expectsText: true,
    maxTime: 90,
    maxTimeSeconds: 90,
    implemented: true,
    aiEligible: true,

    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "string-or-list",

    quickTaskEligible: true,

    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },

    description:
      "One-sentence or single-word answer. Provide a clear reference answer (e.g., “Photosynthesis”, “Abraham Lincoln”).",
  },

  [TASK_TYPES.SORT]: {
    label: "Sort / categorize",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,

    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "mapping",

    quickTaskEligible: true,

    description:
      "Give 6–10 items that belong to 2–4 clear categories (e.g., Living/Non-living, Vertebrate/Invertebrate).",
  },

  [TASK_TYPES.SEQUENCE]: {
    label: "Sequence / timeline",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,

    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "array",

    quickTaskEligible: true,

    description:
      "Give 4–8 items that must be dragged into the correct order (e.g., life cycle stages, steps in a process).",
  },

  [TASK_TYPES.PHOTO]: {
    label: "Photo Evidence",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,

    implemented: true,

    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Student takes a photo showing proof of completing a task or finding an item (e.g., 'Take a picture of your team forming a right angle').",
  },

  [TASK_TYPES.MAKE_AND_SNAP]: {
    label: "Make It & Snap It",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,

    implemented: true,

    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Student or team builds, creates, or arranges something and then snaps a photo. AI can score how well the photo matches the prompt.",
  },

  [TASK_TYPES.BODY_BREAK]: {
    label: "Body Break",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: false,
    maxTime: 60,
    maxTimeSeconds: 60,
    implemented: true,
    aiEligible: true,

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Short movement break. Fun 30–60 second physical challenge. No scoring.",
  },

  [TASK_TYPES.MATCHING]: {
    label: "Matching / Connect",
    category: CATEGORY.ORDERING,
    hasOptions: false,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "map",
    quickTaskEligible: true,
    multiItemCapable: false,
    description: "Draw lines to match 5-7 concepts (left) to words (right). Animated lines with sounds.",
  },

  [TASK_TYPES.PHOTO_JOURNAL]: {
    label: "Photo Journal",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,

    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Student snaps a photo and writes a short explanation, caption, or reflection about what the photo shows.",
  },

  // === Open / media types used with AI scoring / rubrics ===

  [TASK_TYPES.OPEN_TEXT]: {
    label: "Open-text response",
    category: CATEGORY.QUESTION,
    hasOptions: false,
    expectsText: true,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,
    aiEligible: true,

    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Longer written response. Best evaluated with a rubric and AI scoring rather than a single correct answer.",
  },

  [TASK_TYPES.RECORD_AUDIO]: {
    label: "Record audio answer",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,
    implemented: true,
    aiEligible: false,

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Student records an audio explanation or reading. Teacher reviews manually.",
  },

  [TASK_TYPES.DRAW]: {
    label: "Draw it",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,
    implemented: true,
    aiEligible: false,

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Student draws a picture or diagram to show understanding.",
  },

  [TASK_TYPES.HANGMAN_DUEL]: {
    label: "Hangman Duel",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "AI generates different words per station ONLY from aiWordBank so teams don’t help each other.",
  },

  [TASK_TYPES.WORD_WEAVER_DUEL]: {
    label: "Word Weaver Duel",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 240,
    maxTimeSeconds: 240,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Teams reconstruct a target phrase by entering each word.",
  },

  [TASK_TYPES.MIME]: {
    label: "Act it out (Mime)",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Student acts out a concept without words (charades-style).",
  },

  // ✅ NEW: Mood Check-in (no scoring, no timer)
  [TASK_TYPES.MOOD_CHECKIN]: {
    label: "Mood Check-in",
    category: CATEGORY.REVIEW,
    hasOptions: false,
    expectsText: true, // optional shared textbox
    maxTime: 0,
    maxTimeSeconds: 0,
    implemented: true,

    // This is not “AI-generated content” and not “AI-scored”
    aiEligible: false,
    generatorEligible: false,

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "A fun vibe-setter before the task set: each player taps a mood emoji, optionally adds what they’re excited about. No timer, no scoring.",
  },
// ✅ NEW: Treasure Runner (waiting-room mini-game)
[TASK_TYPES.TREASURE_RUNNER]: {
  label: "Treasure Runner",
  category: CATEGORY.COMPETITIVE,
  hasOptions: false,
  expectsText: false,
  maxTime: 60,
  maxTimeSeconds: 60,
  implemented: true,

  // Not a curriculum task to generate inside AI tasksets by default
  aiEligible: false,
  generatorEligible: false,

  objectiveScoring: false,
  defaultAiScoringRequired: false,
  correctAnswerShape: null,

  // Useful as a filler mini-game (Quick Task / waiting state)
  quickTaskEligible: true,

  special: true,
  description:
    "A fast, arcade-style mini-game shown while waiting for the next task. Bonus points can be awarded based on score/placement.",
},


  // === Other extended types ===

  [TASK_TYPES.JEOPARDY]: {
    label: "Brain Blitz!",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 90,
    maxTimeSeconds: 90,
    implemented: true,
    aiEligible: true,

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    quickTaskEligible: true,

    description:
      "Reverse-format trivia game (like Jeopardy). Expected response must be in question form.",
  },

  [TASK_TYPES.COLLABORATION]: {
    label: "Collaboration (Pair & Respond)",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Student writes an answer, then sees a partner’s answer and writes a thoughtful reply.",
  },

  [TASK_TYPES.FLASHCARDS]: {
    label: "Flashcards – Shout to Answer!",
    category: CATEGORY.REVIEW,
    hasOptions: false,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: true,
    correctAnswerShape: "string-or-list",
    quickTaskEligible: true,
    description:
      "8–12 flashcards with {question, answer}. Students shout answers; voice recognition auto-scores.",
  },

  [TASK_TYPES.TIMELINE]: {
    label: "Timeline – Drag to Order",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "array",
    quickTaskEligible: true,
    description:
      "Same as Sequence but branded as a Timeline.",
  },

  [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    label: "Brain Spark Notes",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Student takes quick notes in their notebook on a key question or prompt, then optionally submits a photo of their notes.",
  },

  [TASK_TYPES.BRAINSTORM_BATTLE]: {
    label: "Brainstorm Battle – Shout Ideas!",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Fast-paced idea shouting game. Give seed words or a topic.",
  },

  [TASK_TYPES.MIND_MAPPER]: {
    label: "Mind Mapper",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Student draws a mind map or concept web on paper and photographs it.",
  },

  [TASK_TYPES.HIDENSEEK]: {
    label: "Hide & Seek",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: true,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Give a page or location reference; students find it, snap a photo, and explain the significance.",
  },

  [TASK_TYPES.AI_DEBATE_JUDGE]: {
    label: "AI Debate Judge",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: true,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: false,
    special: true,
    description:
      "AI listens to the debate and delivers a written verdict with scores, feedback, and winner announcement.",
  },

  [TASK_TYPES.SPEED_DRAW]: {
    label: "Speed Draw – First to Answer Wins!",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "One draws a concept rapidly; team guesses. First correct shout wins points.",
  },

  [TASK_TYPES.MUSICAL_CHAIRS]: {
    label: "Musical Chairs (Race!)",
    category: CATEGORY.PHYSICAL,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Play musical chairs where each 'chair' has a question or fact.",
  },

  [TASK_TYPES.MYSTERY_CLUES]: {
    label: "Mystery Clues",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Provide mystery clues leading to a concept or object.",
  },

  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: {
    label: "True/False Tic-Tac-Toe",
    category: CATEGORY.COMPETITIVE,
    hasOptions: true,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "single-option",
    quickTaskEligible: false,
    description:
      "Tic-Tac-Toe grid where each square is a True/False question.",
  },

  [TASK_TYPES.MAD_DASH]: {
    label: "Mad Dash – Race to Scan!",
    category: CATEGORY.PHYSICAL,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Students race to find and scan QR codes hidden around the room.",
  },

  [TASK_TYPES.LIVE_DEBATE]: {
    label: "Live Debate",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Teams debate a prompt. Voice-powered with AI judging for persuasiveness and facts.",
  },

  [TASK_TYPES.PET_FEEDING]: {
    label: "Feed the Pet!",
    category: CATEGORY.REVIEW,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Gamified review where correct answers ‘feed’ a virtual pet.",
  },

  [TASK_TYPES.MOTION_MISSION]: {
    label: "Motion Mission",
    category: CATEGORY.PHYSICAL,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Students complete a quick physical mission linked to content.",
  },

  [TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT]: {
    label: "Multi-Room Scavenger Hunt",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: false,
    maxTime: 300,
    maxTimeSeconds: 300,
    implemented: true,
    aiEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Hunt for items or solve riddles across rooms.",
  },

  [TASK_TYPES.VENNSORT]: {
    label: "Venn Sort",
    category: CATEGORY.ORDERING,
    hasOptions: false,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    correctAnswerShape: "map",
    quickTaskEligible: true,
    multiItemCapable: false,
    description:
      "Drag 5–10 items into a Venn diagram with 2–3 overlapping categories.",
  },

  [TASK_TYPES.DIFF_DETECTIVE]: {
    label: "Diff Detective",
    category: CATEGORY.QUESTION,
    hasOptions: false,
    expectsText: true,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: true,
    correctAnswerShape: "list-of-strings",
    quickTaskEligible: true,
    multiItemCapable: false,
    modes: ["text", "image", "code", "audio", "team-race"],
    description:
      "Spot the differences between two passages or lists.",
  },

  [TASK_TYPES.DRAW_MIME]: {
    label: "Draw or Mime",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    multiItemCapable: false,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,
    quickTaskEligible: false,
    description:
      "Teams respond by either drawing the idea or miming it.",
  },

  [TASK_TYPES.PRONUNCIATION]: {
    label: "Pronunciation Practice",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 90,
    maxTimeSeconds: 90,
    implemented: true,
    aiEligible: true,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: true,
    supportsAccents: true,
    accentOptions: ["american", "british", "australian", "canadian", "neutral"],
    description:
      "AI-powered pronunciation assessment with accent comparison.",
  },

  [TASK_TYPES.SPEECH_RECOGNITION]: {
    label: "Speech Recognition",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
    implemented: true,
    aiEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,
    quickTaskEligible: true,
    description:
      "Student speaks an answer; AI transcribes and scores.",
  },
};

// Flat map of taskType → human-readable label
export const TASK_TYPE_LABELS = Object.fromEntries(
  Object.entries(TASK_TYPE_META).map(([type, meta]) => [
    type,
    meta.label || type,
  ])
);

// Flat list for selector UIs (only implemented types)
export const IMPLEMENTED_TASK_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented !== false)
  .map(([type]) => type);

// List of AI-eligible types – safe for the generator to use
export const AI_ELIGIBLE_TASK_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.aiEligible)
  .map(([type]) => type);

// List of types that are safe / sensible as one-off Quick Tasks in LiveSession
export const QUICK_TASK_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.quickTaskEligible)
  .map(([type]) => type);

// Helper to safely look up metadata
export function getTaskTypeMeta(taskType) {
  return TASK_TYPE_META[taskType] || null;
}

// Is this task objectively scorable (no AI judgement needed)?
export function isObjectiveScoringTaskType(taskType) {
  const meta = TASK_TYPE_META[taskType];
  return !!meta?.objectiveScoring;
}

// Category helper
export function categoryLabelFor(typeValue) {
  const meta = TASK_TYPE_META[typeValue];
  if (!meta) return "other";
  switch (meta.category) {
    case CATEGORY.QUESTION:
      return "question";
    case CATEGORY.ORDERING:
      return "ordering";
    case CATEGORY.CREATIVE:
      return "creative";
    case CATEGORY.MOVEMENT:
      return "movement";
    case CATEGORY.COMPETITIVE:
      return "competitive";
    case CATEGORY.REVIEW:
      return "review";
    case CATEGORY.PHYSICAL:
      return "physical";
    default:
      return "other";
  }
}

// Simple normalization helper – keeps AI / editor / backend in sync
export function normalizeTaskType(value) {
  if (!value) return TASK_TYPES.SHORT_ANSWER;
  const v = String(value).toLowerCase().replace(/_/g, "-").trim();

  // Core types
  if (v === "mcq" || v === "multiplechoice" || v === "multiple-choice") {
    return TASK_TYPES.MULTIPLE_CHOICE;
  }
  if (v === "tf" || v === "truefalse" || v === "true-false") {
    return TASK_TYPES.TRUE_FALSE;
  }
  if (v === "sa" || v === "shortanswer" || v === "short-answer") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "sort" || v === "categorize" || v === "category") {
    return TASK_TYPES.SORT;
  }
  if (v === "sequence" || v === "timeline" || v === "order") {
    return TASK_TYPES.SEQUENCE;
  }
  if (v === "photo" || v === "photo-evidence" || v === "image") {
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
  if (v === "make_and_snap" || v === "make-and-snap") {
    return TASK_TYPES.MAKE_AND_SNAP;
  }
  if (v === "body_break" || v === "body-break") {
    return TASK_TYPES.BODY_BREAK;
  }

  // ✅ Mood check-in
  if (v === "mood-checkin" || v === "mood-check-in" || v === "moodcheckin") {
    return TASK_TYPES.MOOD_CHECKIN;
  }

  // Open / media
  if (v === "open-text" || v === "open_text" || v === "open") {
    return TASK_TYPES.OPEN_TEXT;
  }
  if (v === "record-audio" || v === "record_audio") {
    return TASK_TYPES.RECORD_AUDIO;
  }
  if (v === "draw" || v === "drawing") {
    return TASK_TYPES.DRAW;
  }
  if (v === "matching" || v === "match" || v === "connect" || v === "line-match") {
    return TASK_TYPES.MATCHING;
  }
  if (v === "mime" || v === "act" || v === "act-out") {
    return TASK_TYPES.MIME;
  }
  if (
    v === "vennsort" || v === "venn-sort" || v === "venn" || v === "venndiagram" || v === "venn-diagram"
  ) {
    return TASK_TYPES.VENNSORT;
  }

  // Jeopardy / Brain Blitz legacy names
  if (
    v === "jeopardy" ||
    v === "brain-blitz" ||
    v === "jeopardy_ai_ref" ||
    v === "jeopardy-ai-ref" ||
    v === "jp"
  ) {
    return TASK_TYPES.JEOPARDY;
  }

  // Diff detective
  if (
    v === "diff-detective" ||
    v === "spot-the-difference" ||
    v === "diff" ||
    v === "find-differences"
  ) {
    return TASK_TYPES.DIFF_DETECTIVE;
  }

  // Pronunciation
  if (v === "pronunciation" || v === "pronounce" || v === "speech-practice") {
    return TASK_TYPES.PRONUNCIATION;
  }

  // Speech recognition
  if (v === "speech-recognition" || v === "speech" || v === "voice-answer") {
    return TASK_TYPES.SPEECH_RECOGNITION;
  }

  // Hangman
  if (v === "hangman" || v === "hangman-duel" || v === "hangmanduel") {
    return TASK_TYPES.HANGMAN_DUEL;
  }

  // Fallback: if it matches a known value exactly
  const direct = Object.values(TASK_TYPES).find((t) => t === v);
  return direct || TASK_TYPES.SHORT_ANSWER;
}

// Backwards-compatible alias using the name from your earlier snippet
export function normalizeTaskTypeId(raw) {
  return normalizeTaskType(raw);
}
