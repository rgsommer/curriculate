// shared/taskTypes.js

// Canonical task type IDs used across backend, editor, and AI generator
export const TASK_TYPES = {
  MULTIPLE_CHOICE: "multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT_ANSWER: "short-answer",
  SORT: "sort",
  SEQUENCE: "sequence",
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap",     // build/draw something then snap a photo
  BODY_BREAK: "body-break",           // movement break
  JEOPARDY: "jeopardy",
  COLLABORATION: "collaboration",
  MUSICAL_CHAIRS: "musical-chairs",
  MYSTERY_CLUES: "mystery-clues",
  TRUE_FALSE_TICTACTOE: "true-false-tictactoe",
  MAD_DASH: "mad-dash",
  LIVE_DEBATE: "live-debate",
  FLASHCARDS: "flashcards",  
  TIMELINE: "timeline",
  BRAIN_SPARK_NOTES: "brain-spark-notes",
  PET_FEEDING: "pet-feeding",
  MOTION_MISSION: "motion-mission",
  BRAINSTORM_BATTLE: "brainstorm-battle",
  MIND_MAPPER: "mind-mapper",  
};

// Category labels (for grouping & UI)
const CATEGORY = {
  QUESTION: "question",
  ORDERING: "ordering",
  CREATIVE: "creative",
  MOVEMENT: "movement",
};

// Core metadata for each implemented task type
// NOTE: maxTime is in seconds and duplicated as maxTimeSeconds for clarity.
export const TASK_TYPE_META = {
  [TASK_TYPES.MULTIPLE_CHOICE]: {
    label: "Multiple choice",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTime: 60,
    maxTimeSeconds: 60,
  },
  [TASK_TYPES.TRUE_FALSE]: {
    label: "True / False",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTime: 45,
    maxTimeSeconds: 45,
  },
  [TASK_TYPES.SHORT_ANSWER]: {
    label: "Short answer",
    category: CATEGORY.QUESTION,
    hasOptions: false,
    expectsText: true,
    maxTime: 90,
    maxTimeSeconds: 90,
  },
  [TASK_TYPES.SORT]: {
    label: "Sort / categorize",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
  },
  [TASK_TYPES.SEQUENCE]: {
    label: "Sequence / timeline",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTime: 120,
    maxTimeSeconds: 120,
  },
  [TASK_TYPES.PHOTO]: {
    label: "Photo evidence",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 180,
    maxTimeSeconds: 180,
  },
  [TASK_TYPES.MAKE_AND_SNAP]: {
    label: "Make it & snap it",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTime: 240,
    maxTimeSeconds: 240,
  },
    [TASK_TYPES.BODY_BREAK]: {
    label: "Body break",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: false,
    maxTime: 60,
    maxTimeSeconds: 60,
  },
  [TASK_TYPES.JEOPARDY]: {
    label: "Jeopardy game",
    category: CATEGORY.QUESTION,
    // The Jeopardy board itself (categories, clues, values) is stored in
    // task.jeopardyConfig; this metadata just tells the editor/runtime how
    // to treat the *response* shape.
    hasOptions: false,          // answers are free-text, not pre-defined options
    expectsText: true,          // the team types an answer
    maxTime: 60,
    maxTimeSeconds: 60,
  },
    [TASK_TYPES.COLLABORATION]: {
    label: "Collaboration (Pair & Respond)",
    implemented: true,
    category: "creative",
  },
  [TASK_TYPES.MUSICAL_CHAIRS]: {
    label: "Musical Chairs (Race!)",
    implemented: true,
    category: "physical",
  },
  [TASK_TYPES.MYSTERY_CLUES]: {
    label: "Mystery Clue Cards (Memory Bonus)",
    implemented: true,
    category: "creative",
  },
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: {
    label: "True/False Tic-Tac-Toe Battle",
    implemented: true,
    category: "competitive",
  },
    [TASK_TYPES.MAD_DASH]: {
    label: "Mad Dash – Race to Scan!",
    implemented: true,
    category: "physical",
  },
    [TASK_TYPES.LIVE_DEBATE]: {
    label: "Live AI-Judged Debate",
    implemented: true,
    category: "argumentation",
  },
    [TASK_TYPES.FLASHCARDS]: {
    label: "Flashcards – Shout to Answer!",
    implemented: true,
    category: "review",
  },
    [TASK_TYPES.TIMELINE]: {
    label: "Timeline – Drag to Order",
    implemented: true,
    category: "ordering",
  },
    [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    label: "Brain Spark Notes (Write in Notebook!)",
    implemented: true,
    category: "introduction",
  },
    [TASK_TYPES.PET_FEEDING]: {
    label: "Feed the Pet! (Fun Break)",
    implemented: true,
    category: "movement",
  },
    [TASK_TYPES.MOTION_MISSION]: {
    label: "Motion Mission – Move to Win!",
    implemented: true,
    category: "physical",
  },
    [TASK_TYPES.BRAINSTORM_BATTLE]: {
    label: "Brainstorm Battle – Shout Ideas!",
    implemented: true,
    category: "introduction",
  },
    [TASK_TYPES.MIND_MAPPER]: {
    label: "Mind Mapper – Organize Ideas!",
    implemented: true,
    category: "organization",
  },
};

// Flat map of taskType → human-readable label
export const TASK_TYPE_LABELS = Object.fromEntries(
  Object.entries(TASK_TYPE_META).map(([type, meta]) => [
    type,
    meta.label || type,
  ])
);

// Flat list for selector UIs
export const IMPLEMENTED_TASK_TYPES = Object.values(TASK_TYPES);

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
    default:
      return "other";
  }
}

// Normalize various historical representations ("MULTIPLE_CHOICE", "mcq", etc.)
export function normalizeTaskType(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/_/g, "-").trim();

  if (v === "multiple_choice" || v === "multiple-choice" || v === "mcq") {
    return TASK_TYPES.MULTIPLE_CHOICE;
  }
  if (v === "true_false" || v === "true-false" || v === "tf") {
    return TASK_TYPES.TRUE_FALSE;
  }
  if (v === "short_answer" || v === "short-answer" || v === "sa") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "sort") {
    return TASK_TYPES.SORT;
  }
  if (v === "sequence" || v === "ordering") {
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
  if (
    v === "jeopardy" ||
    v === "jeopardy_ai_ref" ||
    v === "jeopardy-ai-ref" ||
    v === "jp"
  ) {
    return TASK_TYPES.JEOPARDY;
  }

  // Fallback: if it matches a known key exactly
  const direct = Object.values(TASK_TYPES).find((t) => t === v);
  return direct || TASK_TYPES.SHORT_ANSWER;
}
