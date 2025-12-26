// shared/taskTypes.js
//
// Canonical task type IDs used across backend, teacher-app, student-app, editor, and AI generator.
// This file is the single source of truth for:
// - taskType IDs (TASK_TYPES)
// - how tasks should be generated/scored (TASK_TYPE_META)
// - whether tasks support inter-team or intra-team play (interTeamEnabled / intraTeamEnabled)
//
// IMPORTANT DESIGN NOTES
// - interTeamEnabled: teams can interact/compete against OTHER teams in the same room/session
// - intraTeamEnabled: players WITHIN the same team can take different roles/turns (pass device, vote, etc.)
// - Some entries are “defined but not implemented” to preserve forward-compatibility. They must be implemented in
//   TaskRunner + the corresponding Task component before being used in live sessions.

// Canonical task type IDs used across backend, editor, and AI generator
export const TASK_TYPES = {
  // Core Q&A
  MULTIPLE_CHOICE: "multiple-choice",
  PHYSICAL_MULTIPLE_CHOICE: "physical-multiple-choice",
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
  MATCHING: "matching",
  TIMELINE: "timeline",
  VENNSORT: "vennsort",

  // Visual / creative proof
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap",
  PHOTO_JOURNAL: "photo-journal",

  // Movement / physical
  BODY_BREAK: "body-break",
  MUSICAL_CHAIRS: "musical-chairs",
  MOTION_MISSION: "motion-mission",
  MAD_DASH: "mad-dash",
  // Back-compat: some code references MAD_DASH_SEQUENCE
  MAD_DASH_SEQUENCE: "mad-dash-sequence",

  // Pre-task / interstitial
  MOOD_CHECKIN: "mood-checkin",
  TREASURE_RUNNER: "treasure-runner",

  // Post-taskset reflection
  MULTI_PLAYER_FEEDBACK: "multi-player-feedback",

  // Competitive / games
  JEOPARDY: "brain-blitz", // historically “JEOPARDY” in code; UI label is Brain Blitz
  TRUE_FALSE_TICTACTOE: "true-false-tictactoe",
  FLASHCARDS: "flashcards",
  FLASHCARDS_RACE: "flashcards-race",
  PET_FEEDING: "pet-feeding",
  SPEED_DRAW: "speed-draw",
  DIFF_DETECTIVE: "diff-detective",
  DRAW_MIME: "draw-mime",
  HANGMAN_DUEL: "hangman-duel",
  WORD_WEAVER_DUEL: "word-weaver-duel",
  GUESS_WHO: "guess-who",
  ECHO_CHAIN: "echo-chain",

  // Collaboration / discussion
  COLLABORATION: "collaboration",
  LIVE_DEBATE: "live-debate",
  AI_DEBATE_JUDGE: "ai-debate-judge",

  // Brainstorming
  BRAINSTORM_BATTLE: "brainstorm-battle",

  // Deduction / clue-based
  MYSTERY_CLUES: "mystery-clues",
  FAKE_OUT: "fake-out",
  PHYSICAL_MYSTERY_CLUES: "physical-mystery-clues",

  // Synthesis / creative extensions
  BRAIN_SPARK_NOTES: "brain-spark-notes",
  MIND_MAPPER: "mind-mapper",
  NARRATION_SYNTHESIZE: "narration-synthesize",
  ROLE_PLAY: "role-play",
  ROLE_PLAY_DECK: "role-play-deck",
  SCRIPT_PLAY: "script-play",

  // Language / speaking
  PRONUNCIATION: "pronunciation",
  SPEECH_RECOGNITION: "speech-recognition",

  // Physical / scavenger
  HIDENSEEK: "hidenseek",
  MULTI_ROOM_SCAVENGER_HUNT: "multi-room-scavenger-hunt",
};

// Category labels (for grouping & UI)
const CATEGORY = {
  QUESTION: "question",
  ORDERING: "ordering",
  CREATIVE: "creative",
  MOVEMENT: "movement",
  COMPETITIVE: "competitive",
  DEDUCTION: "deduction",
  COLLABORATION: "collaboration",
  FEEDBACK: "feedback/meta",
  SYNTHESIS: "synthesis",
  OTHER: "other",
  RECALL: "recall",
  ROLE_PLAY: "role-play"
};

// Small helper: ensure all meta objects include the same “capability surface”.
function metaBase(overrides = {}) {
  return {
    // Identity
    label: "",
    category: CATEGORY.OTHER,
    description: "",

    // Capabilities
    implemented: false,
    aiEligible: false, // may be AI-generated
    generatorEligible: false, // safe for generator to produce reliably (schema enforced)
    objectiveScoring: false, // can be scored without AI judgement
    defaultAiScoringRequired: false,
    quickTaskEligible: false,

    // Interaction model
    interTeamEnabled: false,
    intraTeamEnabled: false,

    // Typical UI needs
    hasOptions: false,
    expectsText: false,

    // Timing (seconds). 0 means “no timer”.
    maxTimeSeconds: 0,

    // Schema hints (optional; helps AI generator + admin UI)
    correctAnswerShape: null, // e.g., "single-option" | "string-or-list" | "map" | "array" | ...
    multiItemCapable: false,
    preferredItemsPerTask: null,

    ...overrides,
  };
}

// Core metadata for each implemented task type
export const TASK_TYPE_META = {
  // =========================
  // CORE Q&A / OBJECTIVE TASKS
  // =========================

  [TASK_TYPES.MULTIPLE_CHOICE]: metaBase({
    label: "Multiple Choice",
    category: CATEGORY.QUESTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 60,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Classic multiple-choice question set (3\u20135 items). Students read each question and choose one of four visible options (A\u2013D). Submit by tapping an option on-screen. Great for quick checks for understanding and fast feedback.\n\nAI generation shape:\n- config.items: array of 3\u20135 questions\n- each item: { question: string, options: [string,string,string,string], correctIndex: 0\u20133, explanation?: string }\n- optional: title, prompt, timeLimitSeconds, points\nScoring: objective (correctIndex) \u2014 no AI scoring required.",
  }),

  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: metaBase({
    label: "Physical Multiple Choice",
    category: CATEGORY.QUESTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 90,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Physical Multiple Choice (kinesthetic). Looks exactly like standard multiple-choice on the device (full question + four fully visible options A\u2013D), but students cannot submit by tapping.\nTo submit, they must walk to one of the classroom\u2019s 8 permanent colored QR stations and scan the station whose color matches the color displayed beside their chosen option.\n\nHow it works:\n- The system randomly selects 4 of the 8 station colors and maps them to A/B/C/D each question (randomized every play).\n- Each option shows a large color chip (e.g., A \u25cf Red, B \u25cf Teal, C \u25cf Purple, D \u25cf Green).\n- Student decides the answer, walks to that color station, scans, and the scan auto-submits that letter.\n- Typically 3\u20135 questions per task \u2192 3\u20135 trips across the room.\n\nAI generation shape:\n- config.items: array of 3\u20135 questions\n- each item: { question: string, options: [string,string,string,string], correctIndex: 0\u20133 }\n- system provides per-question colorMap (generated at runtime; not required from AI)\nScoring: objective (correctIndex). Inter-team: NO. Intra-team: NO.",
  }),

  [TASK_TYPES.TRUE_FALSE]: metaBase({
    label: "True / False",
    category: CATEGORY.QUESTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 45,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 6 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students judge statements as True or False. Objective-scored and designed to be tricky-but-fair so students must think rather than guess. Great for quick misconception checks, conceptual clarity, and efficient review.",
  }),

  [TASK_TYPES.SHORT_ANSWER]: metaBase({
    label: "Short Answer",
    category: CATEGORY.QUESTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: true,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 90,
    correctAnswerShape: "string-or-list",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students type a single word or one-sentence answer. Objective scoring checks against a reference answer (and optional acceptable answers), with AI scoring as a safety net to reject nonsense and award partial credit for close answers. Great for quick, precise checks for understanding without multiple-choice guesswork.",
  }),

  // =========================
  // ORDERING / DRAG & DROP
  // =========================

  [TASK_TYPES.SORT]: metaBase({
    label: "Sort / Categorize",
    category: CATEGORY.ORDERING,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    correctAnswerShape: "bucket-mapping",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 6–10 items into 2–4 categories. Objective scoring maps each item → category. Great for classification, concept boundaries, and quick detection of misconceptions (wrong bucket = instant insight).",
  }),

  [TASK_TYPES.SEQUENCE]: metaBase({
    label: "Sequence / Order",
    category: CATEGORY.ORDERING,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    correctAnswerShape: "ordered-array",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 4–8 steps/events into the correct order (process steps, life cycles, cause→effect chains, or historical chronology). Reinforces procedural understanding and ‘big picture’ structure.",
  }),

  [TASK_TYPES.TIMELINE]: metaBase({
    label: "Timeline – Drag to Order",
    category: CATEGORY.ORDERING,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    correctAnswerShape: "ordered-array",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Timeline-branded ordering task. Students drag events into chronological order. Excellent for historical thinking and understanding causal sequences over time.",
  }),

  [TASK_TYPES.MATCHING]: metaBase({
    label: "Matching / Connect",
    category: CATEGORY.ORDERING,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    correctAnswerShape: "left-to-right-map",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Two columns of 5–7 items. Students draw animated lines to connect correct pairs (term→definition, cause→effect, person→event). Fast formative assessment and strong association-building.",
  }),

  [TASK_TYPES.VENNSORT]: metaBase({
    label: "Venn Sort",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    correctAnswerShape: "item-to-zones-map",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 5–10 items into a 2–3 circle Venn diagram with overlapping regions (including outside). Objective scoring maps item → which circle(s). Builds nuanced classification and relational reasoning beyond simple categories.",
  }),

  // =========================
  // OPEN RESPONSE / MEDIA (AI or teacher-reviewed)
  // =========================

  [TASK_TYPES.OPEN_TEXT]: metaBase({
    label: "Open-text Response",
    category: CATEGORY.QUESTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Students type a longer explanation/argument/reflection (multi-sentence; can be multi-paragraph).",
        "Difficulty-based minimum length discourages one-word responses when reasoning is expected:",
        "• MEDIUM: settings.minWords = 2 × gradeLevel",
        "• HARD: settings.minWords = 3 × gradeLevel",
        "Not objectively scored. AI-scored using a rubric focus: clarity, accuracy, reasoning, evidence (and optionally a short teacher-facing comment).",
        "No inter-team or intra-team gameplay—this is individual writing within the station flow.",
        "Benefits: writing development, articulation of reasoning, deeper thinking, assessment beyond multiple choice."
      ].join("\n"),
  }),

  [TASK_TYPES.RECORD_AUDIO]: metaBase({
    label: "Record Audio Answer",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Student records an oral explanation/reading. Typically teacher-reviewed. Great for oral fluency, confidence, and accessibility for students who express better verbally than in writing.",
  }),

  [TASK_TYPES.PHOTO]: metaBase({
    label: "Photo Evidence",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Student takes a photo as evidence (geometry example, found item, lab setup, diagram on board). Typically AI-scored because photos vary. Builds observation and real-world connection.",
  }),

  [TASK_TYPES.MAKE_AND_SNAP]: metaBase({
    label: "Make It & Snap It",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Team physically builds/creates/arranges something from a prompt, then submits a photo. Typically AI-scored for alignment to the prompt. Encourages hands-on application and authentic assessment.",
  }),

  [TASK_TYPES.PHOTO_JOURNAL]: metaBase({
    label: "Photo Journal",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Student captures a photo AND writes a caption/explanation/reflection. Typically AI-scored. Connects visual evidence to verbal reasoning and supports metacognition.",
  }),

  // =========================
  // MOVEMENT / PHYSICAL
  // =========================

  [TASK_TYPES.BODY_BREAK]: metaBase({
    label: "Body Break",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 60,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "30–60 second movement break (stretch, jumping jacks, dance, quick poses). No scoring. Boosts attention and regulates energy to improve readiness for learning.",
  }),

  [TASK_TYPES.MOTION_MISSION]: metaBase({
    label: "Motion Mission",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Quick physical mission linked to content or energy (e.g., ‘Act out erosion’). Usually not objective-scored. Increases engagement and supports embodied cognition.",
  }),

  [TASK_TYPES.MUSICAL_CHAIRS]: metaBase({
    label: "Musical Chairs",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "Music cues movement; when it stops, students ‘land’ and trigger a quick question/fact. Great energizer and attention-control practice; can be used in inter-team race mode if desired.",
  }),

  [TASK_TYPES.MAD_DASH]: metaBase({
    label: "Mad Dash – Race to Scan!",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "High-energy physical race (scan/find/complete) under time pressure. Can be used for sequencing/procedure or QR races. Builds teamwork and urgency while reinforcing order/steps.",
  }),

  [TASK_TYPES.MAD_DASH_SEQUENCE]: metaBase({
    label: "Mad Dash Sequence",
    category: CATEGORY.MOVEMENT,
    implemented: false,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    maxTimeSeconds: 180,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "High-energy ‘sequence under pressure’ variant of Mad Dash. If used, should require correct order of steps/events plus speed.",
  }),

  [TASK_TYPES.HIDENSEEK]: metaBase({
    label: "Hide & Seek",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students are given a page/location reference, must find it, snap a photo, and explain significance. Builds source/location literacy and contextual understanding through active searching.",
  }),

  [TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT]: metaBase({
    label: "Multi-Room Scavenger Hunt",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 300,
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "Hunt for items or solve riddles across rooms/locations. Not a standard station task; designed for special events or larger activities.",
  }),

  // =========================
  // FEEDBACK / META
  // =========================

  [TASK_TYPES.MOOD_CHECKIN]: metaBase({
    label: "Mood Check-in",
    category: CATEGORY.FEEDBACK,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Pre-taskset vibe-setter: each player taps a mood emoji; team can optionally add what they’re excited about. No timer, no scoring. Improves classroom climate and engagement.",
  }),

  [TASK_TYPES.MULTI_PLAYER_FEEDBACK]: metaBase({
    label: "Multi-player Feedback",
    category: CATEGORY.FEEDBACK,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    expectsText: true,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "End-of-taskset reflection: each player rates the set (emoji scale) and the team can leave an optional comment. No scoring. Drives iterative improvement and metacognition.",
  }),

  [TASK_TYPES.TREASURE_RUNNER]: metaBase({
    label: "Treasure Runner",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Interstitial mini-game used while waiting for the next task. Keeps teams engaged during transitions and reduces off-task behavior. Can optionally award small bonus points.",
  }),

  // =========================
  // COMPETITIVE / GAME MODES
  // =========================

  [TASK_TYPES.JEOPARDY]: metaBase({
    label: "Brain Blitz!",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    expectsText: true,
    maxTimeSeconds: 90,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Jeopardy-like rapid trivia in reverse format (response as a question). Competitive feel; excellent for retrieval + reformulation and precision with academic language.",
  }),

  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: metaBase({
    label: "True/False Tic-Tac-Toe",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "A tic-tac-toe grid where each square contains a True/False question; correct answers claim squares. Combines retrieval practice with strategy and motivating repetition.",
  }),

  // ✅ Updated to match your stated intent: mastery-oriented, low-stress, intra-team yes, inter-team no
  [TASK_TYPES.FLASHCARDS]: metaBase({
    label: "Flashcards",
    category: CATEGORY.RECALL,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false, // typically not graded; just tracked / completion
    defaultAiScoringRequired: false, // voice/AI optional, not required
    quickTaskEligible: true,
    expectsText: false,
    maxTimeSeconds: 120,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    correctAnswerShape: "string-or-list",
    description:
      "Standard flashcard review (8–12 cards) with {question, answer}. Intended flow is ‘shout to answer’ with optional speech recognition / AI transcription support. Focus is mastery and repeated retrieval, not competition. Intra-team play enabled; inter-team play disabled.",
  }),

  // ✅ Updated: this mode is inherently inter-team (A vs B scoring / winner events)
  [TASK_TYPES.FLASHCARDS_RACE]: metaBase({
    label: "Flashcards Race",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: false,
    expectsText: false,
    maxTimeSeconds: 0,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Competitive rapid-retrieval flashcards. Teams race to answer quickly with live scoring/leaderboard and optional streak bonuses. Builds speeded retrieval and automaticity.",
  }),

  // (rest unchanged from your file)
  [TASK_TYPES.GUESS_WHO]: metaBase({
    label: "Guess Who",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 60,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Yes/No deduction game. One player privately views the secret concept (hold-to-reveal). Others ask only yes/no questions, then make limited guesses (e.g., max 10). Timer (e.g., 60s) starts on first reveal. Encourages logical elimination and strategic questioning.",
  }),

  [TASK_TYPES.HANGMAN_DUEL]: metaBase({
    label: "Hangman Duel",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Teams solve a mystery word shown as blanks by taking turns choosing letters (drag letter tiles). Correct letters lock in; wrong letters move to a used pile and progress a playful ‘build’ (theme can be hangman/snowman/tree/etc.). AI should generate different words per station from aiWordBank so teams don’t help each other.",
  }),

  [TASK_TYPES.WORD_WEAVER_DUEL]: metaBase({
    label: "Word Weaver Duel",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    expectsText: true,
    maxTimeSeconds: 240,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Teams reconstruct a target phrase by entering each word (turn-based competition feel). Rewards accuracy and speed; reinforces vocabulary, syntax awareness, and phrase structure.",
  }),

  [TASK_TYPES.DIFF_DETECTIVE]: metaBase({
    label: "Diff Detective",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: true,
    expectsText: true,
    maxTimeSeconds: 120,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Spot the differences between two versions (often short passages/lists). Students submit differences as a list. Builds close reading, attention to detail, and comparison skills. Modes may include text/image/code/audio/team-race depending on implementation.",
  }),

  [TASK_TYPES.SPEED_DRAW]: metaBase({
    label: "Speed Draw",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "One player rapidly draws a concept; teammates guess quickly. Timed rounds and points for first correct guess. Reinforces vocabulary through visual encoding.",
  }),

  [TASK_TYPES.PET_FEEDING]: metaBase({
    label: "Feed the Pet!",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "A motivational loop: correct answers or task success ‘feeds’/powers up a virtual pet. Encourages repeated retrieval and positive reinforcement without changing academic rigor.",
  }),

  [TASK_TYPES.COLLABORATION]: metaBase({
    label: "Collaboration (Pair & Respond)",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    expectsText: true,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Pair-and-respond workflow: students write an initial response, then see a partner’s response and write a thoughtful reply/extension (agree/disagree, add evidence, ask a question, build on an idea). Builds accountable talk in writing and synthesis.",
  }),

  [TASK_TYPES.LIVE_DEBATE]: metaBase({
    label: "Live Debate",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    expectsText: true,
    maxTimeSeconds: 300,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Team debate format. Players take sides on a prompt, speak in timed turns, and offer rebuttals. Typically rubric/AI-scored rather than objective. Builds argumentation, evidence use, and respectful discourse.",
  }),

  [TASK_TYPES.AI_DEBATE_JUDGE]: metaBase({
    label: "AI Debate Judge",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    aiEligible: true,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    maxTimeSeconds: 180,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Debate happens live; AI produces a written verdict with scores, feedback, and a winner announcement. Encourages evidence and structure by making criteria visible.",
  }),

  [TASK_TYPES.BRAINSTORM_BATTLE]: metaBase({
    label: "Brainstorm Battle",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 120,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Fast-paced ‘shout ideas’ brainstorm. Device presents a topic/seed prompt and the team rapidly contributes ideas aloud (optionally captured). May include quick voting/ranking. Great for activating prior knowledge and lowering fear of being wrong.",
  }),

  [TASK_TYPES.MYSTERY_CLUES]: metaBase({
    label: "Mystery Clues",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Clue-based deduction to identify a concept/object. Useful for inquiry and reasoning. (If you want AI generation here, add generator rules + schema and set generatorEligible true.)",
  }),

  [TASK_TYPES.FAKE_OUT]: metaBase({
    label: "Fake Out",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: true,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 90,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Turn-based oral reading + listening ‘truth vs fake’ game (Balderdash-style). One player is the Reader and holds the device, reading the statement aloud. AI provides 4 options: (1–3) long, plausible, hard-to-discern variations where ONLY ONE is fully correct, plus (4) a hilarious, obviously false ‘joke’ option that should never be correct. The Reader records each teammate’s vote (tap/check under names), then the reveal triggers discussion. Scoring: points for correct picks; optional Reader bonus for each teammate fooled. Schema: config.playerCount (2–8), optional config.playerNames[], and config.rounds[] where each round has { statement, options[4], correctIndex (0–2) }. Intra-team only; inter-team disabled.",
  }),

  [TASK_TYPES.PHYSICAL_MYSTERY_CLUES]: metaBase({
    label: "Physical Mystery Clues",
    category: CATEGORY.DEDUCTION,
    implemented: false,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 300,
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "Physical clue hunt. Students move around to find real-world clues (stations/objects/pages) and piece them together to solve a mystery concept. Encourages inquiry, persistence, and applying deduction outside a seated worksheet.",
  }),

    [TASK_TYPES.BRAIN_SPARK_NOTES]: metaBase({
    label: "Brain Spark Notes",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    maxTimeSeconds: 240,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Students see a clean, on-screen ‘model notes’ page (like real class notes): a title plus concise bullets.",
        "They copy the notes into a notebook/paper, then confirm completion (or submit a photo, if enabled in your flow).",
        "Bullets are short definitions/jot-notes that summarize key ideas from the topic/prompt.",
        "Suggested count: 3–5 bullets (Grades 8+ can use ~6–10).",
        "AI scoring can evaluate completeness, clarity, and organization.",
        "Benefits: summarization, distillation, study-skill building, and synthesis of main ideas.",
        "GENERATOR RULES: Provide task.title, task.prompt (topic), and task.bullets (array of concise definitions/jot-notes).",
        "Inter-team: NO. Intra-team: NO."
      ].join("\n"),
  }),

  [TASK_TYPES.MIND_MAPPER]: metaBase({
    label: "Mind Mapper",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Students build a mind map / concept web around a central concept, using an on-screen organizer template as a guide.",
        "On-screen: an organizer with blanks plus a bank of 5–7 ideas; students recreate the organizer on paper and fill it in.",
        "Easy: indicates main ideas vs sub-ideas. Medium/Hard: does not label main vs sub-ideas.",
        "Hard: expects 1–3 additional student-generated sub-points beyond the provided ideas.",
        "AI scoring can evaluate completeness, structure/relationships, and clarity of organization.",
        "To support variety, use multiple organizer styles (e.g., mind map, concept web, fishbone, hierarchy, flow).",
        "GENERATOR RULES: Provide task.title, task.prompt (central concept), task.organizerType, and task.items (array of 5–7 ideas; each can optionally include a ‘level’ hint for Easy).",
        "Inter-team: NO. Intra-team: NO."
      ].join("\n"),
  }),
  [TASK_TYPES.NARRATION_SYNTHESIZE]: metaBase({
    label: "Narration Synthesize",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    noAutoScoring: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 60,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: `
      NARRATION_SYNTHESIZE (Intra-team only)

      Must include:
      - config.playerCount: number (2–8)
      - config.prompts: array length == playerCount
        Each element: { id, concept, prompt }
        - concept and prompt must describe an explainable concept or process (not a single word).
        - prompt should invite a short spoken explanation, with steps/causes/effects/examples.

      Optional:
      - config.perTurnSeconds: number (0 disables)
      - config.ratingScale: { min, max, label }

      Intra-team only.
      `.trim(),
    }),

  [TASK_TYPES.ROLE_PLAY]: metaBase({
    label: "Role Play (Legacy)",
    category: CATEGORY.SYNTHESIS,
    implemented: false,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Legacy alias for Role Play Deck. Prefer taskType \"role-play-deck\" (TASK_TYPES.ROLE_PLAY_DECK). This id is kept for backwards compatibility and normalizes to ROLE_PLAY_DECK.",
  }),

  [TASK_TYPES.ROLE_PLAY_DECK]: metaBase({
    label: "Role Play Deck",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: `
    Role-based scenario role-play using an AI-generated role deck.

    How it works:
    - Choose a mode: Mystery (hidden roles) or Classic (open roles).
    - Each player draws ONE role card: { name, role, characteristics[] }.
    - Read the subject-linked scenario aloud and role-play it as a team.
    - Submit marks completion (no objective scoring).

    Constraints:
    - School-appropriate and morally appropriate; no mocking, cruelty, or unsafe behavior.
    - Characteristics are short, positive traits (3–5 per role).
    - Scenario must connect to the subject/lesson and invite perspective-taking.
    - INTRA-team only (no inter-team mechanics).

    Expected payload:
    {
      taskType: "role-play-deck",
      title: string,
      prompt: string,
      timeLimitSeconds?: number,
      config: {
        mode?: "mystery" | "classic" | "choose",
        playerCount?: number,
        playerNames?: string[],
        roles: Array<{ name: string, role: string, characteristics: string[] }>,
        scenario: string
      }
    }
    `.trim(),
  }),

  [TASK_TYPES.SCRIPT_PLAY]: metaBase({
    label: "Script Play",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 300,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "AI-generated Script Play: a structured performance task. The device shows the CURRENT speaker’s line in large text, plus optional tone cues (e.g., serious, excited) and stage directions (e.g., whispering, pointing). It also shows brief context lines for ‘just before’ and ‘up next’ so the team understands the story flow. Students PASS the device from speaker to speaker and read/act their lines. Intra-team only (no inter-team). Pedagogical benefits: reading fluency, expressive oral language, comprehension, narrative reasoning, collaboration, and deeper retention through performance.",
  }),

  [TASK_TYPES.DRAW_MIME]: metaBase({
    label: "Draw or Mime",
    category: CATEGORY.CREATIVE,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Teams represent a concept non-verbally—either drawing or acting it out—while teammates guess. Reinforces vocabulary and builds multi-modal memory traces.",
  }),

  [TASK_TYPES.DRAW]: metaBase({
    label: "Draw",
    category: CATEGORY.CREATIVE,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 240,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drawing response task. Students draw a diagram or concept representation. Often used with teacher review or photo submission in other tasks.",
  }),

  [TASK_TYPES.MIME]: metaBase({
    label: "Mime",
    category: CATEGORY.CREATIVE,
    implemented: true,
    aiEligible: false,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Charades-style acting response. Students act out a concept without words. Great for vocabulary and concept visualization through movement.",
  }),

  [TASK_TYPES.ECHO_CHAIN]: metaBase({
    label: "Echo Chain",
    category: CATEGORY.RECALL,
    implemented: true,
    aiEligible: true,
    generatorEligible: true,
    objectiveScoring: false,
    defaultAiScoringRequired: false,
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Oral memory-chain game. The device starts with a subject-related seed term. Players take turns repeating the full chain aloud and adding one related term. Optional per-turn timer and bonuses for completing a full rotation. Builds retrieval practice, working memory, listening accuracy, and vocabulary association networks.",
  }),

  [TASK_TYPES.PRONUNCIATION]: metaBase({
    label: "Pronunciation Practice",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: true,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    maxTimeSeconds: 90,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students speak prompted words/phrases and receive AI-based pronunciation feedback. Builds phonetic accuracy, language acquisition, and speaking confidence.",
  }),

  [TASK_TYPES.SPEECH_RECOGNITION]: metaBase({
    label: "Speech Recognition",
    category: CATEGORY.OTHER,
    implemented: true,
    aiEligible: true,
    generatorEligible: false,
    objectiveScoring: false,
    defaultAiScoringRequired: true,
    maxTimeSeconds: 120,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students speak an answer; AI transcribes and can score meaning/accuracy. Useful for accessibility and oral response practice.",
  }),

  // =========================
  // COMPETITIVE (placeholder type)
  // =========================
};

// Flat map of taskType → human-readable label
export const TASK_TYPE_LABELS = Object.fromEntries(
  Object.entries(TASK_TYPE_META).map(([type, meta]) => [type, meta.label || type])
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
  return meta?.category || "other";
}

// Simple normalization helper – keeps AI / editor / backend in sync
export function normalizeTaskType(value) {
  if (!value) return TASK_TYPES.SHORT_ANSWER;
  const v = String(value).toLowerCase().replace(/_/g, "-").trim();

  // Direct match to known values
  const direct = Object.values(TASK_TYPES).find((t) => t === v);
  if (direct) return direct;

  // Common aliases
  if (v === "mcq" || v === "multiplechoice" || v === "multiple-choice") return TASK_TYPES.MULTIPLE_CHOICE;
  if (v === "tf" || v === "truefalse" || v === "true-false") return TASK_TYPES.TRUE_FALSE;
  if (v === "sa" || v === "shortanswer" || v === "short-answer") return TASK_TYPES.SHORT_ANSWER;

  if (v === "open" || v === "open_text" || v === "open-text") return TASK_TYPES.OPEN_TEXT;

  if (v === "match" || v === "connect" || v === "line-match") return TASK_TYPES.MATCHING;

  if (v === "venn" || v === "venn-diagram" || v === "venndiagram") return TASK_TYPES.VENNSORT;

  if (v === "jeopardy" || v === "brain-blitz" || v === "jp") return TASK_TYPES.JEOPARDY;

  if (v === "hangman" || v === "hangmanduel") return TASK_TYPES.HANGMAN_DUEL;

  if (v === "word-weaver" || v === "wordweaver" || v === "word-weaver-duel") return TASK_TYPES.WORD_WEAVER_DUEL;

  if (v === "guesswho" || v === "guess-who" || v === "guess_who") return TASK_TYPES.GUESS_WHO;

  if (v === "flashcardsrace" || v === "flashcards-race") return TASK_TYPES.FLASHCARDS_RACE;

  if (v === "mood-check-in" || v === "moodcheckin") return TASK_TYPES.MOOD_CHECKIN;

  if (v === "fakeout" || v === "fake-out") return TASK_TYPES.FAKE_OUT;

  return TASK_TYPES.SHORT_ANSWER;
}

// Backwards-compatible alias using the name from your earlier snippet
export function normalizeTaskTypeId(raw) {
  return normalizeTaskType(raw);
}
