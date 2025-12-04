// shared/taskTypes.js

// Canonical task type IDs used across backend, editor, and AI generator
export const TASK_TYPES = {
  MULTIPLE_CHOICE: "multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT_ANSWER: "short-answer",
  SORT: "sort",
  SEQUENCE: "sequence",
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap",
  BODY_BREAK: "body-break",
  JEOPARDY: "brain-blitz",                    // ← renamed!
  COLLABORATION: "collaboration",
  MUSICAL_CHAIRS: "musical-chairs","musical-chairs",
  MYSTERY_CLUES: "mystery-clues",
  TRUE_FALSE_TICTACTOE: "true-false-tictactoe",
  MAD_DASH: "mad-dash",
  LIVE_DEBATE: "live-debate",
  FLASHCARDS: "flashcards","flashcards",
  TIMELINE: "timeline",
  BRAIN_SPARK_NOTES: "brain-spark-notes",
  PET_FEEDING: "pet-feeding",
  MOTION_MISSION: "motion-mission",
  BRAINSTORM_BATTLE: "brainstorm-battle",
  MIND_MAPPER: "mind-mapper",
  HIDENSEEK: "hidenseek",
  SPEED_DRAW: "speed-draw",
  MULTI_ROOM_SCAVENGER_HUNT: "multi-room-scavenger-hunt",
};

const CATEGORY = {
  QUESTION: "question",
  ORDERING: "ordering",
  CREATIVE: "creative",
  MOVEMENT: "movement",
  COMPETITIVE: "competitive",
  REVIEW: "review",
  PHYSICAL: "physical",
};

export const TASK_TYPE_META = {
  [TASK_TYPES.MULTIPLE_CHOICE]: {
    label: "Multiple Choice",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 60,
    aiEligible: true,
    description: "Classic multiple-choice question with 3–5 options. Provide one clearly correct answer. Great for quick knowledge checks.",
  },
  [TASK_TYPES.TRUE_FALSE]: {
    label: "True / False",
    category: CATEGORY.QUESTION,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 45,
    aiEligible: true,
    description: "True or False statement. Make it tricky but fair — kids love shouting the answer!",
  },
  [TASK_TYPES.SHORT_ANSWER]: {
    label: "Short Answer",
    category: CATEGORY.QUESTION,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 90,
    aiEligible: true,
    description: "One-sentence or single-word answer expected. Provide a clear reference answer (e.g., 'Photosynthesis', 'Abraham Lincoln').",
  },
  [TASK_TYPES.SORT]: {
    label: "Sort / Categorize",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    aiEligible: true,
    description: "Give 6–10 items that belong to 2–4 clear categories (e.g., Living/Non-living, Vertebrate/Invertebrate).",
  },
  [TASK_TYPES.SEQUENCE]: {
    label: "Sequence / Put in Order",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    aiEligible: true,
    description: "Give 6–10 steps or events that have one correct chronological order (water cycle, life cycle, historical events, etc.).",
  },
  [TASK_TYPES.PHOTO]: {
    label: "Photo Evidence",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    aiEligible: true,
    description: "Student takes a photo showing proof (e.g., 'Show something magnetic', 'Photo of a triangle in the room'). Prompt must be visual and doable in classroom.",
  },
  [TASK_TYPES.MAKE_AND_SNAP]: {
    label: "Make It & Snap It",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    aiEligible: true,
    description: "Student builds, draws, or demonstrates something with materials then photographs it (e.g., 'Build a bridge with 10 popsicle sticks', 'Draw a food chain').",
  },
  [TASK_TYPES.BODY_BREAK]: {
    label: "Body Break",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 60,
    aiEligible: true,
    description: "Short movement break. Give a fun 30–60 second physical challenge (jump like a frog, mirror your partner, etc.). No scoring.",
  },
  [TASK_TYPES.JEOPARDY]: {
    label: "Brain Blitz!",
    category: CATEGORY.COMPETITIVE,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 90,
    aiEligible: true,
    description: "Reverse-format trivia (like Jeopardy). Provide 6–10 clues in the form of answers. Expected response must be in question form: 'What is…?', 'Who was…?', etc. Voice-powered, high-energy review game.",
  },
  [TASK_TYPES.COLLABORATION]: {
    label: "Pair & Respond",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 180,
    aiEligible: true,
    description: "Student writes answer → sees partner’s → writes thoughtful reply for bonus points. Great for opinion, prediction, or reflection questions.",
  },
  [TASK_TYPES.FLASHCARDS]: {
    label: "Flashcards – Shout to Answer!",
    category: CATEGORY.REVIEW,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    aiEligible: true,
    description: "Generate 8–12 flashcard objects with { question, answer }. Kids shout answers. Voice recognition auto-scores. Perfect for vocabulary, math facts, capitals, etc.",
  },
  [TASK_TYPES.BRAINSTORM_BATTLE]: {
    label: "Brainstorm Battle – Shout Ideas!",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    aiEligible: true,
    description: "Fast-paced idea shouting game. Give seed words or a topic. Kids shout ideas → lightning rounds reward previously shouted words. Pure creative chaos.",
  },
  [TASK_TYPES.TIMELINE]: {
    label: "Timeline – Drag to Order",
    category: CATEGORY.ORDERING,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    aiEligible: true,
    description: "Same as Sequence but branded as Timeline. Use for historical events, story plot, planet formation, etc.",
  },
  [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    label: "Brain Spark Notes",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 180,
    aiEligible: true,
    description: "Student takes quick notes in their notebook on a key question or prompt. Photo of notes is submitted.",
  },
  [TASK_TYPES.MIND_MAPPER]: {
    label: "Mind Mapper",
    category: CATEGORY.CREATIVE,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    aiEligible: true,
    description: "Student draws a mind map or concept web on paper and photographs it. Prompt should be a central topic (e.g., 'Water Cycle', 'Fractions').",
  },

  // === Not yet reliable for AI generation (as of Dec 2025) ===
  [TASK_TYPES.MUSICAL_CHAIRS]: { label: "Musical Chairs (Race!)", implemented: true, aiEligible: false },
  [TASK_TYPES.MYSTERY_CLUES]: { label: "Mystery Clue Cards", implemented: true, aiEligible: false },
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: { label: "True/False Tic-Tac-Toe", implemented: true, aiEligible: false },
  [TASK_TYPES.MAD_DASH]: { label: "Mad Dash – Race to Scan!", implemented: true, aiEligible: false },
  [TASK_TYPES.LIVE_DEBATE]: { label: "Live AI-Judged Debate", implemented: true, aiEligible: false },
  [TASK_TYPES.PET_FEEDING]: { label: "Feed the Pet!", implemented: true, aiEligible: false },
  [TASK_TYPES.MOTION_MISSION]: { label: "Motion Mission", implemented: true, aiEligible: false },
  [TASK_TYPES.HIDENSEEK]: { label: "HideNSeek", implemented: true, aiEligible: false },
  [TASK_TYPES.SPEED_DRAW]: { label: "Speed Draw", implemented: true, aiEligible: false },
  [TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT]: { label: "Multi-Room Scavenger Hunt", aiEligible: false },
};

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
    [TASK_TYPES.HIDENSEEK]: {
    label: "HideNSeek – Find & Explain!",
    implemented: true,
    category: "physical",
  },
    [TASK_TYPES.SPEED_DRAW]: {
    label: "Speed Draw – First to Answer Wins!",
    implemented: true,
    category: "competitive",
  },
    [TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT]: {
    label: "Multi-Room Scavenger Hunt",
    category: CATEGORY.MOVEMENT,
    hasOptions: false,
    expectsText: false,
    maxTime: 300, // 5 minutes default
    maxTimeSeconds: 300,
    // No AI generation flag (checked in generators)
    aiEligible: false,
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
