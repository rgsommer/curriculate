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

  // Visual / creative proof
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap", // build/draw something then snap a photo
  BODY_BREAK: "body-break",       // movement break

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

  // Kept for backwards compatibility; behaviour now largely driven by location
  MULTI_ROOM_SCAVENGER_HUNT: "multi-room-scavenger-hunt",

  // New task types
  DIFF_DETECTIVE: "diff-detective",
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

    // scoring hints
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    // e.g., correctAnswer: index or option id
    correctAnswerShape: "single-option",

    // Multi-question capable (3–5 items presented together)
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
    // e.g., correctAnswer: index or boolean or 'T'/'F'
    correctAnswerShape: "single-option",

    // Multi-question capable (3–5 items presented together)
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
    // e.g., correctAnswer: string or array of acceptable strings
    correctAnswerShape: "string-or-list",

    // Multi-question capable (3–5 items presented together)
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
    // e.g., { item1: categoryA, item2: categoryB }
    correctAnswerShape: "mapping",

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
    // e.g., array of item ids in correct order
    correctAnswerShape: "array",

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
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    description:
      "Student takes a photo showing proof (e.g., 'Show something magnetic', 'Photo of a triangle in the room'). Prompt must be visual and doable in classroom.",
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
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    description:
      "Student builds, draws, or demonstrates something with materials then photographs it (e.g., 'Build a bridge with 10 popsicle sticks', 'Draw a food chain').",
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

    description:
      "Short movement break. Give a fun 30–60 second physical challenge (jump like a frog, mirror your partner, etc.). No scoring.",
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
    // typically rubric-driven, so AI scoring is helpful
    aiEligible: true,

    objectiveScoring: false,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    description:
      "Longer written response (a paragraph or more). Best evaluated with a rubric and AI scoring rather than a single correct answer.",
  },

  [TASK_TYPES.RECORD_AUDIO]: {
    label: "Record audio answer",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,
    implemented: true,
    aiEligible: false, // pipeline not wired yet

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    description:
      "Student records an audio explanation or reading. Future versions may transcribe and AI-score; for now, teacher reviews manually.",
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

    description:
      "Student draws a picture or diagram to show understanding (e.g., 'Draw the water cycle'). Pairs with the Draw/Mime task runner.",
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

    description:
      "Student acts out a concept without words (charades-style) while team guesses. Handled by the same Draw/Mime UI.",
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

    description:
      "Reverse-format trivia game (like Jeopardy). Provide clues in the form of answers. Expected response must be in question form: 'What is…?', 'Who was…?'. High-energy review game.",
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

    description:
      "Student writes an answer, then sees a partner’s answer and writes a thoughtful reply. Great for opinion, prediction, or reflection questions.",
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

    description:
      "8–12 flashcards with {question, answer}. Students shout answers; voice recognition auto-scores. For vocab, facts, etc.",
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

    description:
      "Same as Sequence but branded as a Timeline. Use for historical events, story plots, planet formation, etc.",
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

    description:
      "Fast-paced idea shouting game. Give seed words or a topic. Kids shout ideas in rounds. Great for divergent thinking.",
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
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    description:
      "Student draws a mind map or concept web on paper and photographs it. Prompt should be a central topic (e.g., 'Water Cycle', 'Fractions').",
  },

  [TASK_TYPES.HIDENSEEK]: {
    label: "Hide & Seek",
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

    description:
      "Hide concept cards around room; find and explain to team. Physical search with knowledge application.",
  },

  // shared/taskTypes.js → add to TASK_TYPE_META
  [TASK_TYPES.AI_DEBATE_JUDGE]: {
    label: "AI Debate Judge",
    category: "competitive",
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
    implemented: true,
    aiEligible: true,
    special: true, // ← marks it as a special task, not in normal rotation
    description: "AI listens to the entire debate and delivers a full written verdict with scores, feedback, and winner announcement.",
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

    description:
      "One draws a concept rapidly; team guesses. First correct shout wins points. Fast-paced art + knowledge.",
  },

  // === Types not yet reliable for AI generation (as of Dec 2025) ===

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

    description:
      "Play musical chairs where each 'chair' has a question or fact. When music stops, students answer to stay in. High-energy movement game.",
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

    objectiveScoring: false,
    defaultAiScoringRequired: false,
    correctAnswerShape: null,

    description:
      "Provide mystery clues leading to a concept or object. Students solve by discussing or drawing conclusions.",
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

    description:
      "Tic-Tac-Toe grid where each square is a True/False question. Correct answer claims the square. Team-based fun.",
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

    description:
      "Students race to find and scan QR codes hidden around the room, each with a mini-task or fact.",
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

    description:
      "Teams debate a prompt (e.g., “Is Pluto a planet?”). Voice-powered with AI judging for persuasiveness and facts.",
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

    description:
      "Gamified review where correct answers ‘feed’ a virtual pet or progress a status bar. Fun positive reinforcement.",
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

    description:
      "Students complete a quick physical mission linked to content (e.g., 'Take 5 steps for each planet you can name').",
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

    description:
      "Hunt for items or solve riddles across rooms. Each find ties to a learning fact. High-movement adventure.",
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

    multiItemCapable: false,

    modes: ["text", "image", "code", "audio", "team-race"],

    description:
      "Spot the differences between two passages or lists. Builds discernment and attention to detail.",
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

    objectiveScoring: true,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    supportsAccents: true,
    accentOptions: ["american", "british", "australian", "canadian", "neutral"],

    description: "AI-powered pronunciation assessment with accent comparison (British vs American, etc.)",
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

    objectiveScoring: true,
    defaultAiScoringRequired: true,
    correctAnswerShape: null,

    description: "Student speaks an answer; AI transcribes and scores for accuracy, grammar, and fluency.",
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

// Helper to safely look up metadata
export function getTaskTypeMeta(taskType) {
  return TASK_TYPE_META[taskType] || null;
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
  if (v === "make_and_snap" || v === "make-and-snap") {
    return TASK_TYPES.MAKE_AND_SNAP;
  }
  if (v === "body_break" || v === "body-break") {
    return TASK_TYPES.BODY_BREAK;
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
  if (v === "mime" || v === "act" || v === "act-out") {
    return TASK_TYPES.MIME;
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

  // New diff detective
  if (v === "diff-detective" || v === "spot-the-difference" || v === "diff" || v === "find-differences") {
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

  // Fallback: if it matches a known value exactly
  const direct = Object.values(TASK_TYPES).find((t) => t === v);
  return direct || TASK_TYPES.SHORT_ANSWER;
}

// Backwards-compatible alias using the name from your earlier snippet
export function normalizeTaskTypeId(raw) {
  return normalizeTaskType(raw);
}