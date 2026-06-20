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
// - Some entries are "defined but not implemented" to preserve forward-compatibility. They must be implemented in
//   TaskRunner + the corresponding Task component before being used in live sessions.

// Canonical task type IDs used across backend, editor, and AI generator
export const TASK_TYPES = {
  // Core Q&A
  MULTIPLE_CHOICE: "multiple-choice",
  PHYSICAL_MULTIPLE_CHOICE: "physical-multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT_ANSWER: "short-answer",
  READING_COMP: "reading-comp", // Reading comprehension (1-sentence summary)

  // Open / media responses used in StudentApp TaskRunner
  OPEN_TEXT: "open-text",
  RECORD_AUDIO: "record-audio",
  DRAW: "draw",
  MIME: "mime",

  // Ordering / drag-and-drop
  SORT: "sort",
  SEQUENCE: "sequence",
  MATCHING: "matching",
  LABELME: "labelme",
  MAPIT: "mapit",
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
  TEAM_SELFIE: "team-selfie",
  TREASURE_RUNNER: "treasure-runner",

  // Demo-only intro / walkthrough
  TASK_RUNNER: "task-runner",

  // Post-taskset reflection
  MULTI_PLAYER_FEEDBACK: "multi-player-feedback",

  // Competitive / games
  JEOPARDY: "brain-blitz", // historically "JEOPARDY" in code; UI label is Brain Blitz
  TRUE_FALSE_TICTACTOE: "true-false-tictactoe",
  TRUE_FALSE_CONNECT_FOUR: "true-false-connect-four",
  TOWER_BUILDER: "tower-builder",
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
  WHAT_AM_I: "what-am-i",

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

  // Letter writing with AI reply
  LETTER: "letter",

  // Case study with AI feedback
  CASE_STUDY: "case-study",

  // Observation / visual analysis
  ART_VIEW: "art-view",
  HISTORICAL_DOC: "historical-doc",

  // Physical / scavenger
  HIDENSEEK: "hidenseek",
  MULTI_ROOM_SCAVENGER_HUNT: "hidenseek",

  // Storytelling -- AI generates story from student-built characters
  STORYTELLING: "storytelling",

  // Peer editing / proofreading
  PEER_EDITING: "peer-editing",

  // Interview — live AI conversation with historical/topical figure
  INTERVIEW: "interview",

  // Cloze — fill-in-the-blank passage with drag-and-drop word bank
  CLOZE: "cloze",

  // Teach-Back — explain concepts to a younger audience, AI-assessed
  TEACH_BACK: "teach-back",

  // Comic relief / no-score
  RIDDLE: "riddle",
  TRIVIA: "trivia",
  SPINNER: "spinner",

  // Quest Mode — overlay-typed task that drives the live expedition simulation.
  // Inert unless the parent TaskSet has `questModeEnabled: true`.
  QUEST: "quest",

  // Careers (Grades 6–12) — see CAREERS_TASK_PLAN.md.
  // Six modes carried inside config.mode: best-fit, pathway-builder,
  // aptitude-match, salary-vs-lifestyle, who-should-be-hired, career-myths.
  CAREERS: "careers",

  // Hole in One — tilt-physics mini-game. See HOLE_IN_ONE_PLAN.md.
  HOLE_IN_ONE: "hole-in-one",

  // Current Events Connection — runtime-resolved task.
  // Persistent shell stores teacher inputs; CONTENT is resolved at session launch
  // from a live web-search pipeline. See CURRENT_EVENTS_PLAN.md.
  CURRENT_EVENTS: "current-events",

  // Legends — 5W deduction game. Identify a legendary figure by sorting 10 facts
  // into WHAT / WHERE / WHY / WHEN buckets (2/2/2/1 with 3 decoys).
  LEGENDS: "legends",

  // Truth or Dare — classroom-safe social engagement engine.
  // Standalone task and overlay-injectable. See TRUTH_OR_DARE_PLAN.md.
  TRUTH_OR_DARE: "truth-or-dare",

  // UpVote — debatable binary proposition. Class votes For/Against on a
  // genuinely two-sided subject-tied claim; AI surfaces the strongest
  // reasoning for each side. NOT a fact-check (use True/False) and NOT a
  // one-vs-one debate (use Live Debate) — UpVote is a class judgement call.
  UPVOTE: "upvote",
};

// ================================
// BLOOM'S TAXONOMY MAPPING
// ================================
// Maps each task type to one or more Bloom's Taxonomy cognitive levels.
// Levels (lowest → highest): Remember, Understand, Apply, Analyze, Evaluate, Create
//
// Many task types exercise multiple levels. The PRIMARY level is listed first;
// additional levels reflect secondary cognitive demands.

export const BLOOMS_LEVELS = {
  REMEMBER:    { level: 1, label: "Remember",    verb: "Recall",     color: "#ef4444", description: "Retrieving relevant knowledge from long-term memory" },
  UNDERSTAND:  { level: 2, label: "Understand",  verb: "Explain",    color: "#f97316", description: "Constructing meaning from instructional messages" },
  APPLY:       { level: 3, label: "Apply",       verb: "Use",        color: "#eab308", description: "Carrying out or using a procedure in a given situation" },
  ANALYZE:     { level: 4, label: "Analyze",     verb: "Distinguish", color: "#22c55e", description: "Breaking material into parts and detecting relationships" },
  EVALUATE:    { level: 5, label: "Evaluate",    verb: "Judge",      color: "#3b82f6", description: "Making judgments based on criteria and standards" },
  CREATE:      { level: 6, label: "Create",      verb: "Produce",    color: "#8b5cf6", description: "Putting elements together to form a novel, coherent whole" },
};

export const TASK_BLOOMS_MAP = {
  // Remember -- recall, recognition, listing
  "multiple-choice":            ["REMEMBER", "UNDERSTAND"],
  "physical-multiple-choice":   ["REMEMBER", "APPLY"],
  "true-false":                 ["REMEMBER", "UNDERSTAND"],
  "flashcards":                 ["REMEMBER"],
  "flashcards-race":            ["REMEMBER", "APPLY"],
  "hangman-duel":               ["REMEMBER"],
  "riddle":                     ["REMEMBER"],
  "trivia":                     ["REMEMBER", "UNDERSTAND"],
  "spinner":                    ["REMEMBER"],

  // Understand -- explain, summarize, interpret
  "short-answer":               ["UNDERSTAND", "REMEMBER"],
  "reading-comp":               ["UNDERSTAND", "ANALYZE"],
  "brain-spark-notes":          ["UNDERSTAND", "ANALYZE"],
  "pronunciation":              ["UNDERSTAND", "APPLY"],
  "speech-recognition":         ["UNDERSTAND", "APPLY"],

  // Apply -- use, execute, implement, demonstrate
  "sort":                       ["APPLY", "ANALYZE"],
  "sequence":                   ["APPLY", "ANALYZE"],
  "matching":                   ["APPLY", "REMEMBER"],
  "labelme":                    ["REMEMBER", "UNDERSTAND"],
  "mapit":                      ["APPLY", "ANALYZE"],
  "timeline":                   ["APPLY", "ANALYZE"],
  "vennsort":                   ["APPLY", "ANALYZE"],
  "mad-dash":                   ["APPLY", "REMEMBER"],
  "mad-dash-sequence":          ["APPLY", "ANALYZE"],
  "pet-feeding":                ["APPLY"],
  "tower-builder":              ["APPLY", "EVALUATE"],
  "musical-chairs":             ["APPLY", "REMEMBER"],
  "word-weaver-duel":           ["APPLY", "CREATE"],
  "mystery-clues":              ["APPLY", "REMEMBER"],
  "physical-mystery-clues":     ["APPLY", "REMEMBER"],
  "hidenseek":                  ["APPLY"],

  // Analyze -- compare, organize, deconstruct, attribute
  "mind-mapper":                ["ANALYZE", "CREATE"],
  "brain-blitz":                ["ANALYZE", "REMEMBER"],
  "true-false-tictactoe":       ["ANALYZE", "EVALUATE"],
  "true-false-connect-four":    ["ANALYZE", "EVALUATE"],
  "diff-detective":             ["ANALYZE"],
  "case-study":                 ["ANALYZE", "EVALUATE"],
  "art-view":                   ["ANALYZE", "EVALUATE"],
  "historical-doc":             ["ANALYZE", "EVALUATE"],
  "fake-out":                   ["ANALYZE", "EVALUATE"],
  "guess-who":                  ["ANALYZE"],
  "what-am-i":                  ["ANALYZE", "EVALUATE"],
  "quest":                      ["APPLY", "ANALYZE", "EVALUATE"],
  "careers":                    ["EVALUATE", "ANALYZE"],
  "hole-in-one":                ["APPLY", "ANALYZE"],
  "current-events":             ["ANALYZE", "EVALUATE"],
  "legends":                    ["ANALYZE", "REMEMBER"],
  "truth-or-dare":              ["APPLY", "ANALYZE", "REMEMBER"],
  "upvote":                     ["EVALUATE", "ANALYZE"],

  // Evaluate -- critique, judge, argue, defend
  "open-text":                  ["EVALUATE", "UNDERSTAND"],
  "live-debate":                ["EVALUATE", "ANALYZE"],
  "ai-debate-judge":            ["EVALUATE", "ANALYZE"],
  "collaboration":              ["EVALUATE", "CREATE"],
  "narration-synthesize":       ["EVALUATE", "CREATE"],
  "letter":                     ["EVALUATE", "CREATE"],
  "peer-editing":               ["EVALUATE", "ANALYZE"],
  "interview":                  ["EVALUATE", "ANALYZE", "APPLY"],
  "cloze":                      ["REMEMBER", "UNDERSTAND", "APPLY"],
  "teach-back":                 ["UNDERSTAND", "EVALUATE"],

  // Create -- design, construct, produce, invent
  "draw":                       ["CREATE"],
  "mime":                       ["CREATE", "APPLY"],
  "draw-mime":                  ["CREATE", "APPLY"],
  "speed-draw":                 ["CREATE", "APPLY"],
  "photo":                      ["CREATE"],
  "make-and-snap":              ["CREATE", "APPLY"],
  "photo-journal":              ["CREATE", "EVALUATE"],
  "echo-chain":                 ["CREATE", "UNDERSTAND"],
  "brainstorm-battle":          ["CREATE", "ANALYZE"],
  "role-play":                  ["CREATE", "EVALUATE"],
  "role-play-deck":             ["CREATE", "EVALUATE"],
  "script-play":                ["CREATE", "EVALUATE"],
  "record-audio":               ["CREATE", "UNDERSTAND"],

  // Meta / non-cognitive (excluded from analysis)
  "mood-checkin":               null,
  "team-selfie":                null,
  "treasure-runner":            null,
  "task-runner":                null,
  "multi-player-feedback":      null,
  "body-break":                 null,
  "motion-mission":             null,
};

/**
 * Analyze a taskset's cognitive profile using Bloom's Taxonomy.
 * Returns a structured breakdown for reports.
 *
 * @param {Array} tasks - Array of task objects (must have .taskType)
 * @returns {{ levels: Object[], taskDetails: Object[], summary: string }}
 */
export function analyzeBloomsTaxonomy(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  // Count primary and secondary hits per level
  const primary = { REMEMBER: 0, UNDERSTAND: 0, APPLY: 0, ANALYZE: 0, EVALUATE: 0, CREATE: 0 };
  const secondary = { ...primary };
  const taskDetails = [];
  let cognitiveTaskCount = 0;

  for (const task of tasks) {
    const type = task?.taskType || task?.type || "";
    const mapping = TASK_BLOOMS_MAP[type];
    if (!mapping) continue; // meta/non-cognitive task

    cognitiveTaskCount++;
    const [pri, sec] = mapping;
    primary[pri]++;
    if (sec) secondary[sec]++;

    taskDetails.push({
      title: task.title || type,
      taskType: type,
      primaryLevel: BLOOMS_LEVELS[pri].label,
      secondaryLevel: sec ? BLOOMS_LEVELS[sec].label : null,
    });
  }

  if (cognitiveTaskCount === 0) return null;

  // Build level summaries
  const levels = Object.entries(BLOOMS_LEVELS).map(([key, meta]) => {
    const priCount = primary[key];
    const secCount = secondary[key];
    return {
      key,
      ...meta,
      primaryCount: priCount,
      secondaryCount: secCount,
      totalCount: priCount + secCount,
      primaryPercent: Math.round((priCount / cognitiveTaskCount) * 100),
    };
  });

  // Determine the highest level reached (primary only)
  const highestReached = [...levels].reverse().find(l => l.primaryCount > 0);

  // Generate a narrative summary
  const activeLabels = levels.filter(l => l.primaryCount > 0).map(l => `${l.label} (${l.primaryCount})`);
  const dominant = levels.reduce((a, b) => a.primaryCount >= b.primaryCount ? a : b);

  const summary =
    `This activity set addressed ${activeLabels.length} of 6 Bloom's Taxonomy levels: ${activeLabels.join(", ")}. ` +
    `The most emphasized level was ${dominant.label} (${dominant.primaryPercent}% of cognitive tasks). ` +
    (highestReached && highestReached.level >= 5
      ? `Students were challenged up to the ${highestReached.label} level -- the higher-order thinking skills.`
      : highestReached && highestReached.level >= 3
        ? `The set reached the ${highestReached.label} level. Consider adding tasks at the Evaluate or Create level for deeper cognitive challenge.`
        : `The set focused on foundational skills. Consider adding open-ended, creative, or evaluative tasks to push students into higher-order thinking.`);

  return {
    levels,
    taskDetails,
    cognitiveTaskCount,
    totalTaskCount: tasks.length,
    highestLevel: highestReached?.label || "None",
    dominantLevel: dominant.label,
    summary,
  };
}

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

// Small helper: ensure all meta objects include the same "capability surface".
export const TASK_TYPE_META = {
  // =========================
  // CORE Q&A / OBJECTIVE TASKS
  // =========================

  [TASK_TYPES.MULTIPLE_CHOICE]: {
    label: "Multiple Choice",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 60,
    estimatedMinutes: 3,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Classic multiple-choice question set (3\u20135 items). Students read each question and choose one of four visible options (A\u2013D). Submit by tapping an option on-screen. Great for quick checks for understanding and fast feedback.\n\nAI generation shape:\n- config.items: array of 3\u20135 questions\n- each item: { question: string, options: [string,string,string,string], correctIndex: 0\u20133, explanation?: string }\n- optional: title, prompt, timeLimitSeconds, points\nScoring: objective (correctIndex) \u2014 no AI scoring required.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "multiple-choice".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 3–5 multiple-choice items. Each item: clear question, 4 options, one correctAnswer index.
    - Vary the correctAnswer position across items (the system shuffles options, but varied input helps).
    - Make all wrong answers plausible -- same length/style as the correct answer, not absurd or anachronistic.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: {
    label: "Physical Multiple Choice",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 90,
    estimatedMinutes: 4,
    isOffTablet: true,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Physical Multiple Choice (kinesthetic). Looks exactly like standard multiple-choice on the device (full question + four fully visible options A\u2013D), but students cannot submit by tapping.\nTo submit, they must walk to one of the classroom\u2019s 8 permanent colored CurricQR stations and scan the station whose color matches the color displayed beside their chosen option.\n\nHow it works:\n- The system randomly selects 4 of the 8 station colors and maps them to A/B/C/D each question (randomized every play).\n- Each option shows a large color chip (e.g., A \u25cf Red, B \u25cf Teal, C \u25cf Purple, D \u25cf Green).\n- Student decides the answer, walks to that color station, scans, and the scan auto-submits that letter.\n- Typically 3\u20135 questions per task \u2192 3\u20135 trips across the room.\n\nAI generation shape:\n- config.items: array of 3\u20135 questions\n- each item: { question: string, options: [string,string,string,string], correctIndex: 0\u20133 }\n- system provides per-question colorMap (generated at runtime; not required from AI)\nScoring: objective (correctIndex). Inter-team: NO. Intra-team: NO.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "physical-multiple-choice".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Same as Multiple Choice, but students submit by scanning a colored CurricQR station instead of tapping.
    - Include EXACTLY 4 questions. Keep questions quick and unambiguous.
    - Vary the correctAnswer position. Make all distractors plausible.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.TRUE_FALSE]: {
    label: "True / False",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 45,
    estimatedMinutes: 2,
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 6 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students judge statements as True or False. Objective-scored and designed to be tricky-but-fair so students must think rather than guess. Great for quick misconception checks, conceptual clarity, and efficient review.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "true-false".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 4–8 true/false statements. Mix true and false. Each statement must include the statement text and the correct boolean answer.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.SHORT_ANSWER]: {
    label: "Short Answer",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: true,
    scoringMode: "hybrid",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 90,
    estimatedMinutes: 4,
    correctAnswerShape: "string-or-list",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students type a single word or one-sentence answer. Objective scoring checks against a reference answer (and optional acceptable answers), with AI scoring as a safety net to reject nonsense and award partial credit for close answers. Great for quick, precise checks for understanding without multiple-choice guesswork.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "short-answer".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create EXACTLY 4–6 short-answer questions total — NOT one question per vocabulary word.
      A short-answer task is meant to be split ~2 questions per player on a team, so keep the
      set small. Pick the best 4–6 questions; do not try to cover every vocabulary term.
    - Each question can be answered in 1–2 sentences or a number/phrase. Include an answerKey or
      exemplar answer where the schema allows.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Hard cap: never output more than 8 items. If you have many vocabulary words, choose the
      6 most important rather than making a question for each.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  // =========================
  // ORDERING / DRAG & DROP
  // =========================
  [TASK_TYPES.READING_COMP]: {
    label: "Reading Comp",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 180,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "AI generates a short paragraph for students to read, then students write a one-sentence comprehension/summary response. Optional intra-team variation: each player writes privately, then the team votes on the best summary.",

    demoPrompt: "Read the paragraph, then write ONE clear sentence that shows you understood it.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "reading-comp".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create an ORIGINAL paragraph of X sentences (X = grade level, default 10).
    - The student writes ONE sentence showing understanding. Keep the prompt explicit (Grade 7 level).
    - The passage must be about ONE unified topic with a clear through-line. Pick one topic from the vocabulary list and go deep -- don't try to touch every term.
    - Every sentence must have clear referents. Don't write "This law affected..." without naming the law first.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},


  [TASK_TYPES.SORT]: {
    label: "Sort / Categorize",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    correctAnswerShape: "bucket-mapping",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 6–10 items into 2–4 categories. Objective scoring maps each item → category. Great for classification, concept boundaries, and quick detection of misconceptions (wrong bucket = instant insight).",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "sort".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    1. Pick 6–10 terms from the vocabulary list (MIN 6, MAX 10). Create 2–4 categories that group them.
    2. Items must be specific terms/names/events (e.g. "Jonathan Edwards", "Clergy Reserve") -- NOT descriptions (e.g. "Missionary work", "Social services").
    3. Categories should be thematic groupings (e.g. "Religious Figures" vs "Government Policies") -- not a person vs an abstract concept.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.SEQUENCE]: {
    label: "Sequence / Order",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    correctAnswerShape: "ordered-array",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 4–7 steps/events into the correct order (process steps, life cycles, cause→effect chains, or historical chronology). Reinforces procedural understanding and 'big picture' structure.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "sequence".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    1. The items MUST have ONE objective correct order. Two valid kinds:
       (a) the ordered STEPS of a single procedure (each step depends on the prior), or
       (b) distinct items with a real ordering (chronological events, smallest→largest).
       THE TEST: if the items could be reordered and still make sense, they are NOT a
       sequence — that's a list of parallel facts/methods (tester: "these are all true
       statements and are not related as a sequence"). Reject and pick a real ordered set.
       WRONG: ["Convert improper fractions", "Identify the variable", "Use fraction strips"].
       RIGHT (procedure): ["Find a common denominator", "Rewrite each fraction", "Add the
       numerators", "Simplify to lowest terms"].
    2. Use 4–6 items (never more than 7). For historical topics include dates in parentheses.
    3. Provide items in the correct order; the student sees them shuffled.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.TIMELINE]: {
    label: "Timeline – Drag to Order",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: true,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    correctAnswerShape: "ordered-array",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Timeline-branded ordering task. Students drag events into chronological order. Excellent for historical thinking and understanding causal sequences over time.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "timeline".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    1. Pick 5–7 events from the vocabulary list that can be placed chronologically (MIN 5, MAX 7).
    2. Every event must include a date or date range in parentheses -- e.g. "Stamp Act (1765)".
    3. Provide events in correct chronological order; the student sees them shuffled.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.MATCHING]: {
    label: "Matching / Connect",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    correctAnswerShape: "left-to-right-map",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: `
Matching / Connect (two-column association).
The screen shows 5–7 concepts on the left and 5–7 matches on the right. Students connect pairs by drawing lines.
Undo supported; objective-scored via a left→right map.

AI generation / schema hints (for aiTaskSetGenerator):
taskType: "matching"
title: short (3–7 words)
prompt: concise student instruction
leftItems: string[]          // 6 plain strings at ROOT level (not inside config)
rightItems: string[]         // 6 plain strings at ROOT level
correctMatches: {            // keys L1–L6, values R1–R6 at ROOT level
  "L1": "R1", "L2": "R2", ...
}
NOTE: Do NOT use "items", "options", "pairs", or "config" wrappers.

`,
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "matching".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    1. Pick 6 terms from the vocabulary list → "leftItems" (plain strings).
    2. Write a short definition (8–20 words) for each → "rightItems" (plain strings).
    3. Set correctMatches as L1→R1, L2→R2, … L6→R6.
    - Use ONLY leftItems, rightItems, correctMatches at root level (no "config", "items", or "pairs").

    Required output format:
    {
      "taskType": "matching",
      "title": "short title (3-7 words)",
      "prompt": "Connect each term on the left to its definition on the right.",
      "leftItems": ["backwoods", "pemmican", "clergy reserve", "emancipation", "Beothuk", "working bee"],
      "rightItems": ["Remote forested areas settled by pioneers", "Dried meat and fat food used by fur traders", "Land set aside to support the church", "The process of freeing people from slavery", "Indigenous people of Newfoundland", "Community event where neighbours helped with big tasks"],
      "correctMatches": {
        "L1": "R1",
        "L2": "R2",
        "L3": "R3",
        "L4": "R4",
        "L5": "R5",
        "L6": "R6"
      }
    }

    Rules for correctMatches: L1 matches R1, L2 matches R2, etc. Each left item matches exactly one right item.
    `,
},

  [TASK_TYPES.MAPIT]: {
    label: "Map It",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    estimatedMinutes: 5,
    correctAnswerShape: "marker-to-choice-map",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: `
Map It (match-on-a-map). Students see a real map with 3–5 numbered coloured
markers; they match each marker number to the correct location/event/person
from a shuffled list of choices, using the same two-tap interaction as
Matching. ONLY generate this task type when the vocabulary list has a clear
geographic component (places, battles, voyages, settlements, exploration,
empires, missions, Bible geography, physical geography). For non-geographic
vocab (math operations, grammar rules, abstract concepts), pick a different
task type instead.

AI generation / schema hints:
taskType: "mapit"
title: short (3–7 words)
prompt: concise student instruction
markers: array of 3–5 objects { number, lat, lng, correctAnswer, clue?, note? }
choices: array of strings (the labels that get shuffled — must include every
         correctAnswer, plus 0–2 plausible distractors)
map: { regionHint, centerLat, centerLng, zoom (1–10) }
`,

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "mapit".

    GEOGRAPHIC RELEVANCE GATE (read this first):
    Only output a "mapit" task if the vocabulary list has REAL geographic
    content — places, battles, voyages, exploration, settlements, missions,
    empires, wars, Bible lands, physical geography (rivers, mountains,
    regions), or historical figures strongly tied to specific places.
    If the vocab is mostly abstract (math operations, grammar, science
    processes without a place focus), do NOT generate a mapit task — return
    a clear error JSON: {"taskType":"mapit","_skipReason":"not geographic"}
    and the system will pick a different task type. Forcing this task
    type on non-geographic vocab produces a bad student experience.

    Hard requirements (when geographic content IS present):
    - Output ONLY a single JSON object (no markdown, no commentary).
    - 3 to 5 markers — choose specific, named places students can actually
      study, not vague regions like "Asia". Prefer cities, forts, battle
      sites, rivers, specific routes.
    - Each marker MUST have: number (1..N), lat (decimal degrees,
      -90..90), lng (-180..180), correctAnswer (string from the vocab list
      or closely tied to it).
    - Lat/lng must be approximately right (within a few hundred km is
      fine for an introductory student map). DO NOT invent coordinates
      for fictional places.
    - "choices" is the shuffled list of label strings the student picks
      from — it MUST contain every marker's correctAnswer plus 0–2 plausible
      distractors. No duplicates. Keep each ≤ 60 characters.
    - "map" sets the viewport: regionHint (e.g. "Eastern North America"),
      centerLat / centerLng / zoom (1=world, 4=continent, 6=country, 8=region).
    - Optional per-marker "clue" (8–14 words) and "note" (historical context
      shown after submission) — both help students learn.

    Required output format:
    {
      "taskType": "mapit",
      "title": "Key Places in the War of 1812",
      "prompt": "Match each numbered marker on the map to the correct War of 1812 place.",
      "map": {
        "regionHint": "Great Lakes region, Eastern North America",
        "centerLat": 43.5,
        "centerLng": -78.5,
        "zoom": 6
      },
      "markers": [
        { "number": 1, "lat": 42.33, "lng": -83.05, "correctAnswer": "Detroit", "clue": "British captured it under Brock + Tecumseh." },
        { "number": 2, "lat": 43.16, "lng": -79.05, "correctAnswer": "Queenston Heights", "clue": "Brock died leading a charge here." },
        { "number": 3, "lat": 43.65, "lng": -79.38, "correctAnswer": "York", "clue": "Capital of Upper Canada — burned by U.S. forces." },
        { "number": 4, "lat": 43.10, "lng": -79.07, "correctAnswer": "Niagara", "clue": "Frontier region with several major engagements." }
      ],
      "choices": ["Niagara", "Detroit", "York", "Queenston Heights", "Plains of Abraham"]
    }

    Common failure prevention:
    - Do NOT include any marker without lat/lng.
    - Do NOT add a correctAnswer to choices more than once.
    - Do NOT exceed 5 markers — students get overwhelmed.
    - Do NOT generate this task when the vocab list isn't geographic.
    `,
},

  [TASK_TYPES.LABELME]: {
    label: "Label Me",
    category: CATEGORY.ORDERING,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    correctAnswerShape: "marker-to-term-map",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    // Needs a generated diagram image — pre-generated at taskset creation.
    description: `
Label Me (image labeling — "Matching, but on a diagram").
A diagram / map / illustration is shown with 5 markers A–E. Students match each
marker to the correct term. Objective-scored via a marker→term map; reuses the
Matching grading/review flow.

AI generation / schema hints:
taskType: "labelme"
title: short (3-7 words)
prompt: concise student instruction
imagePrompt: a detailed prompt to generate a CLEAN, high-contrast, uncluttered
  educational diagram/map/illustration (no text labels baked in — markers are
  overlaid by the app). Age-appropriate visual complexity.
labels: [{ id:"A", correct:"<term>", x:<0-100>, y:<0-100> }, ...5 entries A-E]
  x/y are PERCENT positions of each feature on the image (responsive scaling).
options: string[]  // the 5 correct terms (optionally + 1-2 distractors), shuffled by the app
explanation?: short note shown after submit
`,
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "labelme".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, imagePrompt.
    - Pick 5 meaningful, unambiguous features of ONE diagram/map/illustration
      relevant to the lesson (e.g. parts of a flower, provinces on a map,
      organs of the digestive system).
    - labels: exactly 5 entries with id "A".."E", each a "correct" term and
      approximate x/y PERCENT (0-100) of where that feature sits on the image.
    - options: the 5 correct terms (you MAY add 1-2 plausible distractors).
    - imagePrompt: describe a clean, high-contrast, uncluttered educational
      diagram with NO letters/labels drawn on it (the app overlays A-E markers).
    - One clearly correct answer per marker; avoid tiny/crowded features.

    Example:
    {
      "taskType": "labelme",
      "title": "Parts of a Flower",
      "prompt": "Match each labelled marker (A-E) to the correct flower part.",
      "imagePrompt": "A clean, high-contrast botanical diagram of a single flower in cross-section, simple flat illustration, no text labels, white background, clearly showing petal, stamen, pistil, sepal, and stem.",
      "labels": [
        { "id": "A", "correct": "Petal",  "x": 30, "y": 20 },
        { "id": "B", "correct": "Stamen", "x": 55, "y": 38 },
        { "id": "C", "correct": "Pistil", "x": 50, "y": 50 },
        { "id": "D", "correct": "Sepal",  "x": 35, "y": 70 },
        { "id": "E", "correct": "Stem",   "x": 50, "y": 88 }
      ],
      "options": ["Petal", "Stamen", "Pistil", "Sepal", "Stem"],
      "explanation": "The pistil (center) is the female part; the stamen produces pollen."
    }
    `,
},

  [TASK_TYPES.VENNSORT]: {
    label: "Venn Sort",
    category: "classification",
    implemented: true,
    generatorEligible: true,
    demoEligible: true,
    scoringMode: "objective",
    objectiveKeyed: true,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      Drag 5–10 items into a 2- or 3-circle Venn diagram (including overlaps and outside).

      AI MUST output:
      - taskType: "vennsort"
      - prompt
      - categories: 2 or 3 strings
      - items: array of 5–10 items (strings OR objects with id/text)
      - correctAnswer: mapping of itemId -> array of categories it belongs to
        Example:
        {
          "item-0-Dog": ["Mammals"],
          "item-1-Bat": ["Mammals","Birds"]
        }

      Scoring intent:
      - Full credit if category-set matches exactly.
      - Partial credit if placement includes at least one correct category (especially for 3-circle overlaps).
      Recommended point model: 2 points per correctly-included category (max = 2 * requiredCategoriesCount).

      Constraints:
      - If using 3 circles, ensure at least one item belongs in an overlap (2-way or 3-way).
      - Categories must be short and readable.

      Benefits: nuanced classification, intersections, relational reasoning.
          `,
        
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "vennsort".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    1. Pick 10–16 terms from the vocabulary list. Create EXACTLY 2 categories.
       DO NOT create a third "Both" / "Overlap" / "Intersection" category — the
       overlap region is represented by items whose "categories" array contains
       BOTH category names, not a separately-named category.

    OVERLAP-RECOGNITION EXAMPLES (apply this thinking to YOUR topic):
    For "Fractions vs Decimals" the BOTH region MUST include items like:
       - "Tenths" (1/10 is a fraction, 0.1 is a decimal — same value)
       - "Hundredths" (1/100 = 0.01)
       - "Half" (1/2 = 0.5)
       - "Mixed-form numbers" (e.g. 2 1/2 = 2.5)
       - "Equivalent values like 1/4 and 0.25"
    The DECIMALS-ONLY region is things like "Recurring decimal" or "Decimal point".
    The FRACTIONS-ONLY region is things like "Numerator", "Denominator",
       "Improper fraction" (which IS a fraction concept even though it
       converts to a decimal — categorise by whose CONCEPT it is, not
       what it CAN BE converted to).
    Audit-2 #5 caught: "Tenths" was filed under Decimals-only, "Mixed
    number" under Both. Both wrong by the rule above.

    When deciding categories for an item, ask: "Is this item a CONCEPT in
    category A?", "Is it a CONCEPT in category B?". An item belongs in the
    overlap only if it is genuinely a concept in BOTH (e.g. "Half" is a
    fraction concept AND a decimal concept). An item that is purely a
    fraction concept but can be expressed as a decimal (like "Numerator")
    stays in Fractions-only — the conversion possibility doesn't change
    its category membership.
    2. config.items: array of objects with { "id": "item-0-Dog", "text": "Dog", "categories": ["Mammals"] }.
       For an overlap item, "categories" has length 2: ["Mammals","Flying animals"].
    3. Include a top-level "correctAnswer" mapping every item id to its category array.
    4. Every item must have at least one category. Choose categories where placements are unambiguous.
    5. BALANCE — three counts, all must be ≥ 2:
       (a) Items in Category A only (categories array == [A]).
       (b) Items in Category B only (categories array == [B]).
       (c) Items in BOTH categories (categories array == [A,B] or [B,A]).
       A count of 0 in any region = TASK REJECTED. The OVERLAP is a real region
       even though it isn\'t a named category.
       Example for Fractions vs Decimals: "0.5" → ["Fractions","Decimals"]; "1/2" → ["Fractions","Decimals"].
    6. Pick categories that GENUINELY HAVE a non-trivial overlap. If the two
       categories are completely disjoint (e.g., "Mammals" vs "Reptiles"),
       CHOOSE A DIFFERENT PAIR ("Mammals" vs "Flying animals" — bat is in both).
       Without genuine overlap, the Venn structure is meaningless.
    7. If a category is underpopulated, add extra relevant terms (even beyond the vocabulary list).

    Common failure prevention:
    - Do not omit the correctAnswer field.
    - Do not omit required arrays/fields; satisfy minimum item counts (≥5 items, ≥2 categories).
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    - Before finalizing, COUNT: items in category A only, items in category B only, items in BOTH.
      All three counts MUST be ≥ 2. If any count is < 2, fix it before returning.
    `,
},

  // =========================
  // OPEN RESPONSE / MEDIA (AI or teacher-reviewed)
  // =========================

  [TASK_TYPES.OPEN_TEXT]: {
    label: "Open-text Response",
    category: CATEGORY.QUESTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Students type a longer explanation/argument/reflection (multi-sentence; can be multi-paragraph).",
        "",
        "Modes:",
        "\u2022 Standard open-text: open-ended writing with optional guiding questions.",
        "\u2022 Vocabulary Paragraph (config.kind = \"vocabulary-paragraph\"): students write ONE coherent paragraph that uses every required word at least once (inflections allowed).",
        "",
        "Difficulty-based minimum length discourages one-word responses when reasoning is expected:",
        "\u2022 MEDIUM: settings.minWords = 2 \u00d7 gradeLevel",
        "\u2022 HARD: settings.minWords = 3 \u00d7 gradeLevel",
        "",
        "Scoring:",
        "\u2022 Standard open-text is AI-scored using a rubric focus: clarity, accuracy, reasoning, evidence (and optionally a short teacher-facing comment).",
        "\u2022 Vocabulary Paragraph is AI-scored for: (1) inclusion of all required words, (2) contextual correctness / natural usage, (3) grammatical coherence, (4) overall quality & creativity (optional bonus).",
        "",
        "Gameplay:",
        "\u2022 No inter-team or intra-team gameplay\u2014this is individual writing within the station flow.",
        "",
        "Benefits: writing development, articulation of reasoning, deeper thinking, assessment beyond multiple choice.",
      ].join("\n"),

demoPrompt: "Copy these exact notes into your notebook. Then tap DONE.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "open-text".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown).
    - Required root fields: taskType, title (3-7 words tied to the unit), prompt (string).
    - Keep language age-appropriate and classroom-safe; original content only.

    THE PROMPT IS THE TASK. It MUST:
    1. Be a STRING — NOT an object, NOT {text, settings} nested. Settings live in config.
    2. Be at least 30 words long.
    3. Name the specific topic or concept in the prompt itself — never just "Complete the task" or "Write your response".
    4. Pose ONE concrete writing question the student answers (e.g. "Write 3 similes describing a thunderstorm. For each, explain what two things are being compared and why the comparison works").
    5. Include 2-4 guiding sub-questions inline that scaffold the student's response.

    FORBIDDEN PROMPTS (the validator rejects these — REGENERATE if you would ship one):
    - "Complete the task."
    - "Write your response."
    - "Answer the question below."
    - Anything that doesn't name the unit topic in the prompt body itself.

    REQUIRED config fields:
    - config.gradeLevel: integer 1-12 matching the grade the request specified.
    - config.difficulty: "EASY" | "MEDIUM" | "HARD" (controls minWords: 0 / 2×grade / 3×grade).
    - config.minWords (optional integer): explicit override of the difficulty-derived floor.

    Optional MODE B — Vocabulary Paragraph (use when the objective is vocabulary usage):
    - Set config.kind = "vocabulary-paragraph".
    - Include config.words as an array of 5-10 target vocabulary words/phrases (strings).
    - Student writes ONE coherent paragraph using EVERY word at least once (inflections OK).

    Worked example for Grade 5 figurative language:
    {
      "taskType": "open-text",
      "title": "Storm Similes & Metaphors",
      "prompt": "Write 3 similes AND 3 metaphors that describe a thunderstorm. After each one, explain in one sentence what two things are being compared, and why the comparison works. Use vivid sensory language — what does the storm look, sound, or feel like? Try to make each comparison surprising.",
      "config": { "gradeLevel": 5, "difficulty": "MEDIUM" }
    }
    `,
},

  [TASK_TYPES.RECORD_AUDIO]: {
    label: "Record Audio Answer",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Student records an oral explanation/reading. Typically teacher-reviewed. Great for oral fluency, confidence, and accessibility for students who express better verbally than in writing.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "record-audio".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Prompt students to record a 20–45 second response about exactly ONE topic.
    - 20–45 seconds is short -- one topic only. Don't ask about multiple subjects.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.LETTER]: {
    label: "Letter Writing",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students write a letter to a historical/fictional character related to the topic. " +
      "The AI picks an appropriate character and suggests a letter style (business or friendly). " +
      "After submitting, students receive a real-time AI-generated reply letter from the character. " +
      "Points scale with relevant vocabulary concepts mentioned. " +
      "Word target: 10 × grade level (e.g., grade 7 = 70 words).",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "letter".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, config.
    - config MUST include: character (string -- full name), characterDescription (1-2 sentences about who they are),
      letterStyle ("business" or "friendly" -- pick whichever fits the topic and character),
      topicContext (1-2 sentences about the historical/topical context the student should address),
      relevantConcepts (array of 4-8 vocabulary terms the student could weave in for bonus points).
    - The prompt should tell the student who they are writing to, what style of letter to use,
      and what topic to address. Mention they will receive a reply.
    - Pick a character that fits the vocabulary/topic naturally -- can be a real historical figure,
      a role (e.g. "a settler in Upper Canada"), or a fictional persona that makes sense.

    Common failure prevention:
    - Do not omit config or any required config fields.
    - Character must be specific and named (not generic like "a person").
    - relevantConcepts must be real terms from the vocabulary list, not made-up phrases.
    `,
  },

  [TASK_TYPES.CASE_STUDY]: {
    label: "Case Study",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 8,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students are presented with a real-world scenario or dilemma rooted in the topic. " +
      "They write a response explaining how they would solve the case. " +
      "Bonus points for weaving in vocabulary terms. " +
      "After submitting, an AI expert evaluates their solution with feedback. " +
      "Word target: 20 × grade level.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "case-study".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, config.
    - config MUST include: scenario (2-4 sentences describing a realistic problem/dilemma/situation related to the topic),
      expertRole (string -- who evaluates, e.g. "History Professor", "Environmental Scientist"),
      expertDescription (1 sentence about the expert's perspective),
      relevantConcepts (array of 4-8 vocabulary terms the student could weave in for bonus points).
    - The prompt should set the scene and ask students to propose a solution or analysis.
    - The scenario should feel like a real case -- use specific details, dates, names, places.
    - Make the dilemma open-ended enough that multiple good approaches exist.

    Common failure prevention:
    - Do not omit config or any required config fields.
    - Expert must be a specific role/title, not generic like "a person".
    - relevantConcepts must be real terms from the vocabulary list, not made-up phrases.
    - Scenario must present a genuine problem to solve, not just background info.
    `,
  },

  [TASK_TYPES.STORYTELLING]: {
    label: "Storytelling",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "participation",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 300,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Students build characters using their own names -- picking gender, personality traits, roles in society, " +
      "and national backgrounds. AI then generates a fun, age-appropriate story featuring them in a setting " +
      "tied to the lesson topic. The story weaves in vocabulary words and concepts. " +
      "Students read the generated story together and it appears in their reports. " +
      "Optional randomize spinner picks traits/roles for extra fun.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "storytelling".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, config.
    - config MUST include: setting (1-2 sentences describing the world/place/era the story takes place in),
      topicContext (1-2 sentences about the lesson topic the story should incorporate),
      genre (one of: "adventure", "mystery", "comedy", "historical fiction", "fantasy", "sci-fi"),
      showNationality (boolean -- true for history/literature topics, false for science/math),
      vocabWords (array of 4-8 vocabulary terms from the word bank that should be woven into the story).
    - The prompt should tell students they will build characters and AI will write a story featuring them.
    - The setting should match the topic -- e.g. for Roman history: "Ancient Rome during the height of the Empire".

    Common failure prevention:
    - Do not omit config or any required config fields.
    - Setting must be specific and vivid, not generic like "a place".
    - vocabWords must be real terms from the vocabulary list.
    `,
  },

  [TASK_TYPES.PEER_EDITING]: {
    label: "Peer Editing",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    estimatedMinutes: 4,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "A writing sample paragraph is presented as a 'peer's' work on a related topic. Each word is numbered " +
      "with a subscript for easy reference. The passage contains 5–10 intentional errors: typos, grammar " +
      "mistakes, logical errors, punctuation issues. Students tap a word to select it, then choose an action " +
      "(Fix Spelling, Replace, or Delete) and enter the correction. Supports three modes: on-screen (tap-to-edit), " +
      "paper (write corrections by hand and snap a photo), and timed (inter-team 3-minute race). " +
      "Great for language arts, ESL, and cross-curricular writing skills.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "peer-editing".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, passage, errors, mode.
    - passage: a 40–80 word paragraph on the topic that reads like a student wrote it.
      Embed 5–10 intentional errors using a MIX of types — do NOT make them all spelling.
      Include at least one or two of EACH: spelling/typos, grammar (subject/verb agreement,
      verb tense, or a wrong/misused word), and punctuation (missing/incorrect comma,
      apostrophe, period, or capitalization); add a factual/logical error where it fits.
      Write naturally — don't make every sentence have an error.
    - errors: array of objects, each with:
        wordIndex (0-based index of the erroneous word in the passage when split by whitespace),
        word (the EXACT erroneous word as it appears in the passage — this is critical for verification),
        type (one of: "typo", "grammar", "logic", "punctuation", "delete"),
        correct (the correct replacement word/phrase, or null for "delete")
    - mode: always use "on-screen"
    - prompt: student-facing instructions (e.g., "Read this paragraph and find the errors...")
    - title: short title (3-7 words)

    IMPORTANT — Index counting procedure:
    1. Write the passage first.
    2. Split it by whitespace into an array.
    3. For each error, find the EXACT word (including any trailing punctuation) and record its 0-based position.
    4. Include the "word" field with the exact erroneous word so we can verify the index.

    Example errors array:
    [
      { "wordIndex": 3, "word": "proccess", "type": "typo", "correct": "process" },
      { "wordIndex": 7, "word": "converts", "type": "grammar", "correct": "convert" }
    ]

    Common failure prevention:
    - The "word" field MUST match passage.split(/\\s+/)[wordIndex] exactly.
    - Include between 5 and 10 errors, no fewer.
    - Errors should be age-appropriate and clearly wrong (not ambiguous style choices).
    - Do not make the passage so error-filled it's unreadable — intersperse errors naturally.
    `,
  },

  [TASK_TYPES.INTERVIEW]: {
    label: "Interview",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 5,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students interview a historical figure or subject-matter expert via live AI conversation. " +
      "They choose from 2-3 candidate characters, each introduces themselves in-character. " +
      "Students ask 3-5 questions and are scored on relevance — good follow-up questions that " +
      "connect to what the character said earn more points. Input modes: type, voice dictation, " +
      "or paper photo snap. Develops inquiry skills, historical empathy, and critical thinking.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "interview".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, candidates.
    - candidates: array of 2-3 objects, each with:
        name (full name of a REAL historical person or notable figure relevant to the topic),
        era (short era/date string, e.g. "1700s" or "Ancient Greece"),
        description (1-2 sentence bio the student sees before choosing — who they are and why they matter),
        greeting (2-3 sentences the character says to introduce themselves in first person, in-character, setting up what they know about),
        systemPrompt (a DETAILED persona prompt for the AI to role-play this character: their knowledge, speech style, historical context, what they're passionate about, what they witnessed. 3-5 sentences.)
    - prompt: student-facing instructions (e.g., "Choose a person to interview and ask thoughtful questions...")
    - title: short title (3-7 words)
    - config.minTurns: 3
    - config.maxTurns: 5

    IMPORTANT:
    - Candidates MUST be real historical or notable figures relevant to the lesson topic.
    - Each candidate should offer a DIFFERENT perspective on the topic.
    - The systemPrompt must give the AI enough context to stay in character.
    - Greetings should be engaging and mention specific things the student could ask about.

    EVERY SUBJECT HAS GREAT INTERVIEWEES — DO NOT SAY "NO ONE IS RELEVANT":
    - Math: Pythagoras (geometry, triangle theorem), Euclid (Elements, geometry foundations),
      al-Khwarizmi (algebra, the word "algorithm"), René Descartes (variables, coordinate plane),
      Isaac Newton (calculus), Leonhard Euler (graph theory, identity), Hypatia (Alexandria),
      Sophie Germain (number theory), Srinivasa Ramanujan, Carl Gauss, Emmy Noether, Ada Lovelace.
    - Science: Marie Curie, Charles Darwin, Albert Einstein, Galileo, Isaac Newton, Nikola Tesla,
      Rosalind Franklin, Gregor Mendel, Rachel Carson, Katherine Johnson, Jane Goodall, Carl Sagan.
    - Health / Medicine: Hippocrates, Florence Nightingale, Edward Jenner, Louis Pasteur,
      Elizabeth Blackwell, Jonas Salk, Mary Seacole.
    - Business / Economics: Adam Smith, Henry Ford, Madam C.J. Walker, Andrew Carnegie,
      Mansa Musa, John D. Rockefeller, Maggie Lena Walker.
    - For a math topic like "2D Geometry", pick Pythagoras + Euclid + a modern voice like
      Mary Cartwright. For "Variables" or "Algebra", pick Descartes + al-Khwarizmi + Noether.
    - If the lesson topic is genuinely abstract (e.g. "order of operations"), interview the
      MATHEMATICIAN OR EDUCATOR who shaped the convention, not a generic character.

    NEVER ship empty candidates. NEVER use a placeholder like "Math Teacher" or "Scientist" —
    use the real person's full name. If a candidate slot would have an empty name OR
    systemPrompt, the task will be rejected.
    `,
  },

  [TASK_TYPES.CLOZE]: {
    label: "Cloze (Fill in the Blank)",
    category: CATEGORY.QUIZ,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    estimatedMinutes: 3,
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "A passage with grade-level-appropriate blanks. Students drag words from a word bank " +
      "into the correct positions. Each blank is scored instantly on drop — correct on first " +
      "try earns full points, retries earn partial credit. For grades 7+ the word bank " +
      "includes 2-3 plausible distractor words. Builds vocabulary, reading comprehension, " +
      "and contextual reasoning.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "cloze".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, passage, blanks.
    - passage: a coherent, grade-appropriate paragraph (60-120 words) on the lesson topic.
      Replace key vocabulary or concept words with ___ (three underscores).
      The number of blanks should be grade level +/- 2 (e.g. grade 5 → 3-7 blanks,
      grade 9 → 7-11 blanks). Never blank out more than ~15% of the words.
    - blanks: array of objects IN THE ORDER they appear in the passage, each with:
        answer (string — the correct word for that blank)
    - distractors: array of 0-3 plausible-but-wrong words.
      For grades K-6: distractors should be an empty array [].
      For grades 7+: include 2-3 distractor words that are topically related but wrong.
    - title: short title (3-7 words)
    - prompt: student-facing instruction (e.g., "Drag the words into the correct blanks.")

    IMPORTANT:
    - Every ___ in the passage must have exactly one matching entry in blanks[].
    - blanks[] order must match the left-to-right, top-to-bottom order of ___ in the passage.
    - Blank words should be meaningful vocabulary, not articles or prepositions.
    - Distractors should be the same part of speech as real answers to be genuinely challenging.
    - The passage must read naturally with the correct words filled in.
    `,
  },

  [TASK_TYPES.TEACH_BACK]: {
    label: "Teach-Back",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 5,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Each team member takes a turn explaining 3-5 related concepts as if teaching a student " +
      "several grade levels younger. Input modes: record audio, text-to-speech playback, or " +
      "editable text. Players can see what their teammates said before them and must build on it — " +
      "repeating is allowed but adding new detail is rewarded. AI assesses each contribution for " +
      "clarity, accuracy, age-appropriateness, and whether it adds to prior explanations. " +
      "Develops deep understanding through the 'teaching effect' — you learn best when you teach.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "teach-back".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, concepts, targetAge.
    - concepts: array of 3-5 SHORT concept strings (2-5 words each) that are related to
      each other and to the lesson topic. They should be the key vocabulary or ideas a
      student needs to understand.
    - targetAge: a description of the target audience, e.g. "a 2nd grader" or
      "a 5-year-old". This should be roughly (grade_level - 3) years old.
      For K-2, use "a younger child who has never learned this."
    - prompt: student-facing instruction explaining what to do (e.g., "Explain these
      concepts as if you were teaching them to a 2nd grader. Use simple words!")
    - title: short title (3-7 words), e.g. "Teach: The Water Cycle"
    - config.rubric: a short 1-2 sentence rubric for AI scoring, e.g.
      "Award points for clear, accurate, age-appropriate explanations that add
      new detail beyond what teammates already said."

    IMPORTANT:
    - Concepts should be substantive vocabulary or ideas, not generic terms.
    - The target audience age should be noticeably younger than the actual grade.
    - Each concept should be teachable in 1-3 sentences by the student.
    - Concepts should connect — they form a coherent topic, not random words.
    `,
  },

  [TASK_TYPES.PHOTO]: {
    label: "Photo Evidence",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Student takes a photo as proof of completing the prompt (pose, geometry example, found item, lab setup, diagram on board, or written work). This is typically AI-scored because photos vary. Pedagogical benefits: authentic evidence, observation skills, real‑world connection, and creative demonstration of understanding. Inter-team: NO. Intra-team: NO.\n\nAI MUST output:\n- taskType: \"photo\"\n- prompt (clear, photo-friendly)\n- Optional: config.instructions, config.exampleIdeas\nStudent submission includes: { photoUrl|photo, caption? }",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "photo".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - ASK FOR ONE THING. The student takes ONE photo of ONE artifact. The prompt is a single short instruction (≤ 350 chars).
    - FORBIDDEN: numbered lists (1., 2., 3.), bullet-style checklists, "AND" chains of multiple things to capture, multi-part briefs (e.g. "Take a photo of X AND Y AND Z"). The validator rejects ≥ 3 numbered parts.
    - GOOD examples:
        • "Take a photo of a real-world example of a right triangle you can find in the classroom or hallway."
        • "Find an object whose temperature is changing right now, and photograph it next to a thermometer reading."
        • "Photograph one piece of evidence — written or drawn — that explains how plants make food."
    - BAD examples (DO NOT EMIT):
        • "Take photos showing: 1) a fraction model 2) a decimal example 3) an equivalent pair."  ← multi-part numbered list
        • "Capture using fraction strips, counters, number lines, grids, and pattern blocks."  ← too-many-objects checklist
        • "Show all three branches of government with separate photos for each."  ← three-photo demand
    - Optional: config.exampleIdeas (≤ 3 SHORT phrases) gives the student inspiration without adding parts to the prompt.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure prompts are student-facing instructions (what to do).
    - Prompt must be ONE clear instruction in plain language. If you can split your prompt into "step 1 / step 2" it is TOO COMPLEX — narrow it to step 1.
    `,
},

  [TASK_TYPES.MAKE_AND_SNAP]: {
    label: "Make It & Snap It",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Make & Snap: the team physically builds/creates/arranges something from a prompt, then submits a photo (and required note). Typically AI-scored for alignment to the prompt. Benefit: hands-on application, creativity, collaboration, authentic assessment, and transfer beyond the screen.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "make-and-snap".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a BUILD AND PHOTOGRAPH task. Students physically make or arrange ONE thing, then submit a photo of it.
    - Pick ONE clear, grade-appropriate artifact tied to a SINGLE concept. The "prompt" names what to build/make plus AT MOST 2–3 required features to show.
    - Keep the prompt SHORT (1–2 sentences, under ~300 characters). Do NOT use numbered/multi-part checklists ("1) … 2) …") and do NOT list many concepts, materials, or sub-tasks in one prompt — that overwhelms students. ONE build, ONE photo.
    - Use classroom-safe materials (paper, pencils, desks, classroom objects).
    - Good example (focused): "Draw and label a diagram of the water cycle showing evaporation, condensation, and precipitation. Take a photo of your diagram."
    - BAD example (over-stuffed, reject this pattern): "Create a comprehensive display using fraction strips, counters, number lines, grids, and pattern blocks to show: 1) adding fractions … 2) equivalent fractions … 3) …"
    - Prompt students to tap the camera icon to submit when done.

    SCHEMA RESTRICTION -- NEVER include these fields:
    - Do NOT include: items, options, leftItems, rightItems, correctMatches, correctAnswer, clues, pairs, bullets, categories

    Common failure prevention:
    - This task only needs taskType, title, and prompt (plus optional config with checklist items).
    - Do NOT add quiz questions, answer choices, or vocabulary lists.
    `,
},

  [TASK_TYPES.PHOTO_JOURNAL]: {
    label: "Photo Journal",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Team captures a photo AND writes a short caption/explanation/reflection connecting the image to the prompt. AI-scored using photo evidence + caption. Pedagogical benefits: connects visual evidence to verbal reasoning, supports metacognition, and improves explanation quality beyond 'just a picture.' Inter-team: NO. Intra-team: NO.\n\nAI MUST output:\n- taskType: \"photo-journal\"\n- prompt\n- Optional: config.captionPrompt, config.wordCountTarget\nStudent submission includes: { photoUrl|photo, caption }",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "photo-journal".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a PHOTO CAPTURE + CAPTION task. Students find or create something to photograph, then write a short explanation connecting the image to the concept.
    - The "prompt" should: (1) tell students what to photograph, (2) ask 1–2 reflection questions for their caption (2–4 sentences).
    - Good examples: "Take a photo of something that reminds you of the concept of 'gravity' from today's lesson. In your caption, explain why you chose this object and how it relates to gravity."
    - Optionally include config.captionPrompt (a short sentence starter) and config.wordCountTarget (e.g., 30).

    SCHEMA RESTRICTION -- NEVER include these fields:
    - Do NOT include: items, options, leftItems, rightItems, correctMatches, correctAnswer, clues, pairs, bullets, categories

    Common failure prevention:
    - This task only needs taskType, title, and prompt. Vocabulary lists, answer options, and quiz questions do NOT belong here.
    `,
},

  // =========================
  // MOVEMENT / PHYSICAL
  // =========================

  [TASK_TYPES.BODY_BREAK]: {
    label: "Body Break",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 60,
    estimatedMinutes: 2,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Short movement break (30–60s). The device shows a quick physical challenge or guided moves (stretch, jumping jacks, dance, quick poses) and the team follows along. No answers; no objective scoring; no AI scoring. Includes upbeat prompts/animations for buy-in. Benefit: boosts attention, reduces restlessness, and helps energy regulation through brain–body activation.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "body-break".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a MOVEMENT BREAK -- no quiz, no answers, no scoring.
    - Write a fun 30–60 second classroom-safe physical activity (stretches, jumping jacks, dance moves, etc.).
    - The "prompt" field should describe the activity in 2–4 clear steps addressed to students.
    - Title example: "Energy Boost: Shake It Out!"
    - Prompt example: "Stand up and shake your arms for 10 seconds. Now do 10 jumping jacks. Stretch your arms above your head for 5 seconds. Sit back down and take a deep breath!"

    SCHEMA RESTRICTION -- NEVER include these fields (they belong to other task types):
    - Do NOT include: items, options, leftItems, rightItems, correctMatches, correctAnswer, clues, pairs, bullets, categories, config.questions, config.pairs

    Common failure prevention:
    - This task only needs taskType, title, and prompt.
    - Do NOT add quiz content, answer choices, or vocabulary lists.
    `,
},

  [TASK_TYPES.MOTION_MISSION]: {
    label: "Motion Mission",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    estimatedMinutes: 4,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: `
      Motion Mission: a quick physical mission tied to content or just an energy reset.
      Usually completion-based (not objective-scored).

      AI generation / schema hints (for aiTaskSetGenerator):
      taskType: "motion-mission"
      title: short (3–7 words)
      prompt: mission instructions (2–4 short steps; safe, classroom-friendly)
      config: {
        variant?: "content" | "energy",
        safetyNotes?: string,          // 0–1 short line
        musicCue?: boolean             // optional: play a cue
      }
      `,

  
    aiPrompt: `
      Generate ONE Curriculate task object with taskType "motion-mission".

      Hard requirements:
      - Output ONLY a single JSON object (no markdown, no commentary).
      - Include non-empty root fields: taskType, title, prompt.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.

      Task-specific guidance:
      - This is a MOVEMENT MISSION -- no quiz, no answer options, no scoring.
      - PICK ONE concept (two at the very most) and build the whole movement around
        THAT. Do NOT try to touch every concept in the list — a movement that name-drops
        many ideas is wrong and impossible to act out (tester: "too complex for this task,
        pick one or two ideas max"). One clear idea, acted out simply.
      - Tie the movement to that ONE concept (this is what makes it different from Body
        Break, which is content-free): the gesture should represent or reinforce it
        (e.g. "make a right angle with your arms", "step LEFT for a proper fraction, RIGHT for
        improper", "trace a number line in the air").
      - Keep it SHORT and EASY TO ACT: 2–3 simple, physically-doable steps total. Avoid
        anything abstract or hard to perform standing at a desk.
      - The "prompt" field is displayed on screen to students. Write the 2–3 steps addressed
        directly to the student (second-person).
      - IMPORTANT: Do NOT reference a teacher giving verbal cues. The student reads the prompt and taps DONE when finished.
      - Include a safety reminder (e.g., "Move safely and be aware of your space!").

      SCHEMA RESTRICTION -- NEVER include these fields (they belong to other task types):
      - Do NOT include: items, options, leftItems, rightItems, correctMatches, correctAnswer, clues, pairs, bullets, categories, config.questions, config.pairs

      Common failure prevention:
      - This task only needs taskType, title, and prompt (plus optional config with variant/safetyNotes).
      - Do NOT add quiz content, answer choices, or vocabulary lists.
      `,
},

  [TASK_TYPES.MUSICAL_CHAIRS]: {
    label: "Musical Chairs",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,

    // Tap-based rounds; scored objectively by correctAnswer
    aiScoringDefaultOn: false,
    objectiveKeyed: true,
    scoringMode: "objective",
    isOffTablet: true,

    description: `
      A fast, station-based tap game (like "multiple choice, but musical chairs").

      ✅ REQUIREMENTS (strict)
      - taskType: "musical-chairs"
      - title: string
      - prompt: string (clear instructions)
      - items: array of EXACTLY 7 questions (tap-based)
      - each item:
        - id: string
        - prompt: string
        - options: array of 2–4 strings
        - correctAnswer: number (0-based index)

      config.items MUST mirror items, and config.rounds MUST equal items.length (7).
    `.trim(),

    aiPrompt: `
      You are generating ONE task object.

      MENTAL MODEL: This is just multiple-choice / true-false, but used in "musical chairs" rounds.

      Return JSON ONLY. No markdown. No extra keys.

      HARD REQUIREMENTS:

      taskType must be exactly "musical-chairs"

      items.length MUST be exactly 7

      include a mix of question types:

      at least 2 items must be true/false (exactly 2 options)

      at least 2 items must be multiple-choice (3–4 options)

      each item.options length must be 2–4

      each item.correctAnswer must be a valid 0-based index into options AND must point to the correct option

      do NOT default correctAnswer to 0; correctAnswer=0 is only allowed if the first option is truly correct

      vary the position of the correct option across items (do not always place it first)

      config.rounds must equal 7

      config.items must be identical to items (deep copy)

      VALID EXAMPLE (copy this SHAPE, change the content):
      {
      "taskType": "musical-chairs",
      "title": "Quick History Rounds",
      "prompt": "When the music stops, answer the question on your screen. Tap the correct choice quickly.",
      "items": [
      { "id": "1", "prompt": "True/False statement here.", "options": ["False", "True"], "correctAnswer": 1 },
      { "id": "2", "prompt": "Multiple-choice question here.", "options": ["Option A", "Option B", "Option C"], "correctAnswer": 2 },
      { "id": "3", "prompt": "True/False statement here.", "options": ["True", "False"], "correctAnswer": 0 },
      { "id": "4", "prompt": "Multiple-choice question here.", "options": ["Option A", "Option B", "Option C", "Option D"], "correctAnswer": 1 },
      { "id": "5", "prompt": "True/False statement here.", "options": ["False", "True"], "correctAnswer": 1 },
      { "id": "6", "prompt": "Multiple-choice question here.", "options": ["Option A", "Option B", "Option C"], "correctAnswer": 0 },
      { "id": "7", "prompt": "Multiple-choice question here.", "options": ["Option A", "Option B", "Option C"], "correctAnswer": 1 },
      { "id": "8", "prompt": "True/False statement here.", "options": ["True", "False"], "correctAnswer": 0 }
      ],
      "config": {
      "rounds": 8,
      "items": "<<<IDENTICAL COPY OF items ABOVE>>>"
      }
      }

      FINAL VALIDATION (must pass before output):

      Exactly 8 items

      At least 2 true/false items (exactly 2 options)

      At least 2 multiple-choice items (3–4 options)

      For every item, options[correctAnswer] is the correct answer

      config.items is an identical deep copy of items

      Now generate a fresh musical-chairs task using age-appropriate, classroom-safe content.     `.trim()
        },

  [TASK_TYPES.MAD_DASH]: {
    label: "Mad Dash",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,

    // No AI generation (runtime shows a fixed color/station sequence)
    generatorEligible: false,

    aiScoringDefaultOn: false,
    objectiveKeyed: false,
    scoringMode: "none",

    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,

    timed: true,
    timeBonus: true,

    estimatedMinutes: 4,
    interTeamEnabled: true,
    intraTeamEnabled: true,

    description:
      "A sequence of 3–5 colors/stations is presented with a 1-2-3-GO! Players are timed, one at a time, to complete the sequence by scanning those stations in that order. Best time can earn bonus points. Points for completion. No AI-generated content required.",
  },

[TASK_TYPES.MAD_DASH_SEQUENCE]: {
  label: "Mad Dash Sequence",
  category: CATEGORY.ORDERING,
  implemented: true,
  demoEligible: true,

  // AI must provide items + correct order; runtime assigns colors, shuffles display, and scores
  generatorEligible: true,

  aiScoringDefaultOn: false,
  objectiveKeyed: true,
  scoringMode: "objective",

  quickTaskEligible: true,
  hasOptions: false,
  expectsText: false,

  timed: true,
  timeBonus: true,

  estimatedMinutes: 4,
  interTeamEnabled: true,
  intraTeamEnabled: true,

  description:
    "High-energy 'sequence under pressure' physical/interactive race. Players are presented with 3–5 ordered terms/items. The task card associates each item with a color at runtime, randomizes display, and scores by accuracy + speed. Players must determine the correct order, then scan stations in that order.",

  aiPrompt: `
    Generate ONE Curriculate task object with taskType "mad-dash-sequence".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Provide config.items (EXACTLY 4 strings) and config.correctOrder (array of indices).
    - Each item is ONE short, single step (≤10 words). Do NOT cram several concepts
      into one item or write run-on steps — one clear action per step.
    - correctOrder must be a valid permutation of [0..items.length-1].
    - Do NOT include colors -- colors are assigned at runtime.

    Task shape:
    {
      "taskType": "mad-dash-sequence",
      "title": "string",
      "prompt": "Put these [topic] in order from [criterion]",
      "config": {
        "items": ["string","string","string"],
        "correctOrder": [0,1,2],
        "orderingCriterion": "string -- e.g. smallest to largest, earliest to latest, first step to last step"
      }
    }

    CRITICAL -- Items MUST be the steps of ONE single procedure, in order:
    - Pick ONE procedure/process from the topic and break it into the 4 steps you do
      IN ORDER. Each step should depend on the previous one.
    - THE TEST: if the items could be done in any order and still make sense, they are
      NOT a sequence — you have written a list of independent facts/methods. Reject that
      and pick a real step-by-step procedure instead.
    - WRONG (independent methods, no real order): ["Convert improper fractions to mixed
      numbers", "Identify the variable", "Solve 9+w=14", "Use fraction strips to model"].
    - RIGHT (one procedure, forced order) e.g. "Steps to add fractions with different
      denominators": ["Find a common denominator", "Rewrite each fraction with that
      denominator", "Add the numerators", "Simplify the result to lowest terms"].
    - The "prompt" MUST name the procedure + criterion (e.g. "Put the steps to solve a
      one-variable equation in the order you do them").
    - Bad examples: random vocabulary words, unrelated facts, parallel techniques with no
      single correct order.

    Content guidance:
    - Grade 3+ wording.
    - Items MUST be short — 3–8 words each. A long run-on item that lists several
      ideas is WRONG; split the idea into one clean step or drop it.
    - Use simple sequences for easy; academic sequences for harder (process steps, timeline events, procedure order).
    `.trim(),
    },

  // =========================
  // OBSERVATION / VISUAL ANALYSIS
  // =========================

  [TASK_TYPES.ART_VIEW]: {
    label: "Art View",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "hybrid",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 180,
    estimatedMinutes: 5,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Two-phase visual observation task using HISTORICAL ART or PRIMARY SOURCES directly related to the lesson topic. Phase 1: A full-screen image is displayed for a fixed viewing period (default 60 seconds). Students study the image carefully. Phase 2: The image disappears and students type as many observations as they can before time runs out. Hybrid scoring: base points for quantity of unique/valid observations, bonus points from AI for quality, specificity, and analytical depth.\n\nThe image MUST be a well-known historical artwork, photograph, map, or primary source that connects to the lesson topic. The system validates the image URL at runtime and can auto-replace broken links.\n\nAI MUST output:\n- taskType: \"art-view\"\n- title, prompt (student-facing instructions)\n- config.imageUrl: Wikimedia Commons URL to the image (MUST be a direct file link ending in .jpg/.png, e.g. https://upload.wikimedia.org/wikipedia/commons/...)\n- config.imageDescription: ALWAYS include a detailed description of the artwork (title, artist, year, medium, what it depicts) -- used as fallback if URL breaks\n- config.imageTitle: the artwork's title (e.g. \"Starry Night\")\n- config.imageArtist: the artist's name (e.g. \"Vincent van Gogh\")\n- config.imageYear: approximate year or period (e.g. \"1889\" or \"15th century\")\n- config.viewingSeconds: how long to show the image (default 60)\n- config.responseSeconds: how long students have to type observations (default 120)\n- config.minObservations: minimum observations expected (default 5)\n- Optional: config.focusHints (array of 2-4 guiding prompts)\nStudent submission: { observations: string[] }",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "art-view".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.

    Task-specific guidance:
    - The image MUST be a HISTORICAL artwork, photograph, map, or primary source that is DIRECTLY RELEVANT to the lesson topic.
      Examples: studying the Renaissance → use a Raphael or da Vinci painting; studying WWI → use a period photograph or propaganda poster;
      studying geography/aid → use a historical map or documentary photograph of aid work.
    - DATE-FIT RULE — the chosen artwork's CREATION YEAR or DEPICTED PERIOD
      MUST fall WITHIN the topic's date range. Verify before naming it.
      The audit caught a 1830 painting picked for a "1789-1799 French
      Revolution" unit: Delacroix's "Liberty Leading the People" (1830)
      depicts the July Revolution, NOT the 1789-1799 one. Use David's
      "Tennis Court Oath", "Death of Marat", or "Napoleon Crossing the
      Alps" instead — they fall inside or directly bracket the unit's
      window. If you can't find an artwork that genuinely fits the topic's
      date range, PICK A DIFFERENT TOPIC-RELATED PRIMARY SOURCE (map,
      pamphlet, document) rather than a date-mismatched painting.
    - config.imageUrl: provide a Wikimedia Commons DIRECT file URL (must end in .jpg or .png).
      Format: https://upload.wikimedia.org/wikipedia/commons/thumb/HASH/FILENAME/800px-FILENAME
      Do NOT use gallery pages or non-image URLs.
    - config.imageDescription: ALWAYS provide this -- a rich description of the artwork including title, artist, year, subject matter, medium, and what it depicts. This is the fallback if the URL breaks years later.
    - config.imageTitle: the artwork's title.
    - config.imageArtist: the artist or photographer.
    - config.imageYear: year or period string.
    - config.viewingSeconds: default 60 (adjust based on image complexity -- more detail = more time).
    - config.responseSeconds: default 120.
    - config.minObservations: default 5.
    - config.focusHints: array of 2-4 observation prompts tied to the curriculum topic (e.g., "What does this tell us about life in that period?", "Notice the use of light and shadow").
    - config.spotItems: REQUIRED spot-check used during the viewing phase to force actual engagement (not click-through). An array of EXACTLY 4 objects, each { "text": "short phrase", "isBogus": true|false }. Provide 3 REAL details that ARE clearly visible in the artwork (isBogus:false) and 1 BOGUS decoy that sounds plausible for this kind of artwork but is NOT actually shown (isBogus:true). Examples for Van Gogh's "Starry Night": { text: "a swirling night sky", isBogus: false }, { text: "a village with a tall church steeple", isBogus: false }, { text: "a dark cypress tree in the foreground", isBogus: false }, { text: "a horse-drawn carriage on the road", isBogus: true }. The decoy must be plausible (something that could conceivably appear in this kind of artwork), not absurd. Keep each text under 70 characters.
    - The prompt should tell students: "Study this artwork carefully. When it disappears, write down as many observations as you can."

    Common failure prevention:
    - ALWAYS include BOTH imageUrl AND imageDescription.
    - viewingSeconds and responseSeconds must be positive integers.
    - The image must be historically significant and clearly connected to the lesson topic.
    - config.spotItems MUST contain EXACTLY 3 real (isBogus:false) and 1 bogus (isBogus:true) entries — otherwise the task will be rejected.
    `,
  },

  [TASK_TYPES.HISTORICAL_DOC]: {
    label: "Historical Document",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "hybrid",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    isOffTablet: false,
    description:
      "Two-phase primary source analysis task using HISTORICAL DOCUMENTS (treaties, letters, speeches, proclamations, newspaper articles, maps, political cartoons, legal documents, diary entries, etc.) directly related to the lesson topic. Phase 1: A full-screen image of the document is displayed for a fixed reading period (default 90 seconds). Students read and study the document carefully. Phase 2: The image disappears and students write commentary on the document's relevance, impact, and historical significance at the time it was created.\n\nThe document MUST be a real, historically significant primary source that connects to the lesson topic. The system validates the image URL at runtime and can auto-replace broken links via Wikimedia Commons.\n\nAI MUST output:\n- taskType: \"historical-doc\"\n- title, prompt (student-facing instructions)\n- config.imageUrl: Wikimedia Commons URL to the document image (MUST be a direct file link ending in .jpg/.png)\n- config.imageDescription: ALWAYS include a detailed description of the document (what it is, who wrote/created it, when, context, what it says/shows) -- used as fallback if URL breaks\n- config.docTitle: the document's title or name (e.g. \"The Emancipation Proclamation\")\n- config.docAuthor: author or creator (e.g. \"Abraham Lincoln\")\n- config.docYear: year or date (e.g. \"1863\" or \"January 1, 1863\")\n- config.docType: type of document (e.g. \"presidential proclamation\", \"treaty\", \"personal letter\", \"political cartoon\", \"newspaper front page\")\n- config.historicalContext: 1-2 sentence context students see before viewing (e.g. \"This document was issued during the American Civil War...\")\n- config.viewingSeconds: how long to show the document (default 90 -- longer than art because reading takes longer)\n- config.responseSeconds: how long students have to write their analysis (default 150)\n- config.analysisPrompts: array of 2-4 guided analysis questions (e.g. \"What was the immediate impact of this document?\", \"Who was the intended audience?\", \"How does this connect to what we learned about...?\")\nStudent submission: { responses: Array<{ prompt: string, response: string }> }",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "historical-doc".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.

    Task-specific guidance:
    - The document MUST be a REAL historical primary source that is DIRECTLY RELEVANT to the lesson topic.
      Examples: studying the American Revolution → use the Declaration of Independence or a Paul Revere engraving;
      studying WWII → use a wartime propaganda poster, Rosie the Riveter, or a period newspaper front page;
      studying civil rights → use the text of Brown v. Board of Education or a photograph from the March on Washington.
    - Prefer documents with visual interest: handwritten letters, illustrated broadsides, political cartoons, maps, newspaper front pages, illuminated manuscripts, signed treaties.
    - config.imageUrl: provide a Wikimedia Commons DIRECT file URL (must end in .jpg or .png).
      Format: https://upload.wikimedia.org/wikipedia/commons/thumb/HASH/FILENAME/800px-FILENAME
      Do NOT use gallery pages or non-image URLs.
    - config.imageDescription: ALWAYS provide this -- a thorough description of the document including what it looks like, what text it contains (key excerpts if legible), who created it, when, and why it matters. This is the fallback if the URL breaks.
    - config.docTitle: the document's name.
    - config.docAuthor: author, creator, or issuing body.
    - config.docYear: year or date string.
    - config.docType: classification of the document type.
    - config.historicalContext: 1-2 sentences of context shown to students BEFORE viewing (to orient them -- do not give away the analysis).
    - config.viewingSeconds: default 90 (documents need more reading time than art).
    - config.responseSeconds: default 150.
    - config.analysisPrompts: array of 2-4 targeted analysis questions that push students beyond description into evaluation of relevance and impact. At least one should ask about the document's impact AT THE TIME it was created, and at least one should connect to the broader lesson topic.
    - config.spotItems: REQUIRED reading-check used during the viewing phase to force actual engagement with the document (not click-through). An array of EXACTLY 4 objects, each { "text": "short phrase", "isBogus": true|false }. Provide 3 REAL details that ARE genuinely in or about this specific document (isBogus:false) and 1 BOGUS decoy that sounds plausible for this kind of document but is NOT actually in it (isBogus:true). Examples for the Emancipation Proclamation: { text: "the date January 1, 1863", isBogus: false }, { text: "the phrase 'forever free'", isBogus: false }, { text: "Lincoln's signature at the bottom", isBogus: false }, { text: "a list of Confederate generals to be tried", isBogus: true }. The decoy must be plausible for this type of document, not absurd. Keep each text under 70 characters.
    - The prompt should tell students: "Read this historical document carefully. When it disappears, you will answer analysis questions about its significance and impact."

    Common failure prevention:
    - ALWAYS include BOTH imageUrl AND imageDescription.
    - viewingSeconds and responseSeconds must be positive integers.
    - The document must be a real, well-known historical primary source directly connected to the lesson topic.
    - analysisPrompts should ask about relevance and impact, not just description.
    - config.spotItems MUST contain EXACTLY 3 real (isBogus:false) and 1 bogus (isBogus:true) entries — otherwise the task will be rejected.
    `,
  },

  [TASK_TYPES.HIDENSEEK]: {
    label: "Hide & Seek",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Students are given a page/location reference (or clue), must physically find it, snap a photo, and explain its significance. Usually AI-scored due to open-ended explanation. Pedagogical benefits: active searching, source/location literacy, contextual understanding, and making learning physical. Inter-team: NO. Intra-team: NO.\n\nAI MUST output:\n- taskType: \"hidenseek\"\n- prompt (must include what/where to find)\n- Optional: config.locationHint, config.requiredEvidence\nStudent submission includes: { photoUrl|photo, explanation, foundWhere? }",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "hidenseek".
    `,
},

  // =========================
  // FEEDBACK / META
  // =========================

  [TASK_TYPES.MOOD_CHECKIN]: {
    label: "Mood Check-in",
    category: CATEGORY.FEEDBACK,
    implemented: true,
    demoEligible: false,
    generatorEligible: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Pre-taskset vibe-setter: each player taps a mood emoji; team can optionally add what they're excited about. No timer, no scoring. Improves classroom climate and engagement.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "mood-checkin".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a quick SEL check-in: 4–6 mood options plus 1 reflection question and 1 positive action step. Keep wording gentle and teen-appropriate.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.TEAM_SELFIE]: {
    label: "Team Selfie",
    category: CATEGORY.FEEDBACK,
    implemented: true,
    demoEligible: false,
    demoSelectable: false,
    generatorEligible: false,
    profileInjectedOnly: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 0,
    estimatedMinutes: 1,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    isOffTablet: false,
    description:
      "Pre-game selfie task: teams take a fun group photo before the session starts. The photo is saved as the team card and included in session reports. On Plus tier, the AI generates a themed version of the photo based on the taskset subject (historical era, lab scene, etc.).",
  },

  [TASK_TYPES.MULTI_PLAYER_FEEDBACK]: {
    label: "Multi-player Feedback",
    category: CATEGORY.FEEDBACK,
    implemented: true,
    demoEligible: false,
    generatorEligible: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: false,
    expectsText: true,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "End-of-taskset reflection: the team rates the taskset (emoji/1\u20135) and can leave optional comments/suggestions. Optional \u2018what we learned\u2019 note can grant a small bonus point. Not AI-generated; not scored beyond participation/bonus. Improves student voice and metacognition.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "multi-player-feedback".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a peer feedback activity: provide a short work artifact prompt plus a feedback form with 3–5 criteria and 1 kind/helpful comment requirement.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.TREASURE_RUNNER]: {
    label: "Treasure Runner",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: false,
    generatorEligible: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 0,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Interstitial mini-game used while waiting for the next task. Keeps teams engaged during transitions and reduces off-task behavior. Can optionally award small bonus points.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "treasure-runner".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a game-like task where teams earn "treasure" by answering 6–10 quick questions. Provide clear scoring rules and answers where applicable.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.TASK_RUNNER]: {
    label: "Task Runner (Intro)",
    category: CATEGORY.OTHER,
    implemented: true,
    // Demo-only: selectable from DemoPage, but never AI-generated.
    demoEligible: false,
    generatorEligible: false,
    scoringMode: "none",
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    demoSelectable: true,
    estimatedMinutes: 4,
    description: "Demo-only intro / walkthrough video.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "task-runner".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a relay-style task: 6–10 prompts where one teammate runs, reports back, and the team records the answer. Include clear roles and timing.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},


  // =========================
  // COMPETITIVE / GAME MODES
  // =========================

  [TASK_TYPES.JEOPARDY]: {
    label: "Brain Blitz!",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    quickTaskEligible: true,
    expectsText: true,
    maxTimeSeconds: 90,
    estimatedMinutes: 3,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description: "Brain Blitz (Jeopardy-style): the device shows an answer/term and students must respond with the correct question (Jeopardy format).\nStudent flow:\n- Prompt shows a clue/answer (word/name/phrase).\n- Players respond quickly by voice (preferred) or typing.\n- AI checks meaning and Jeopardy-style phrasing (strictness adjustable by difficulty).\nScoring: AI-scored; fast, competitive retrieval + reformulation.\nAI generation should produce:\n- clue (string) OR prompt (string)\n- expectedQuestion (string) OR expectedKeyPoints (array)\n- allowTyping (boolean, optional)\n- timeLimitSeconds (optional; usually 30\u201390)\nInter-team: YES. Intra-team: YES.",
  
    aiPrompt: `
      You are generating ONE task object.

      MENTAL MODEL: This is rapid-fire vocabulary recall. Students see clues one at a time,
      each about a DIFFERENT vocabulary word/concept. They shout (or type) the answer Jeopardy-style.
      Think "rapid quiz" — each clue is a standalone question with its own unique answer.

      Return JSON ONLY. No markdown. No commentary.

      HARD REQUIREMENTS:
      - taskType must be exactly "brain-blitz"
      - title: non-empty string
      - prompt: non-empty string (explain: read each clue, guess the word)
      - clues: array of 6–8 OBJECTS, each with { "clue": "...", "answer": "..." }
      - EVERY clue MUST have a DIFFERENT answer — no two clues share the same answer word
      - Also include config.clues mirroring the root clues array

      WHAT EACH answer MUST BE:
      - A single recognizable WORD or SHORT PHRASE — a concept, term, person, place, or vocabulary word.
      - Something students can shout out loud in a classroom.
      - Good: "photosynthesis", "variable", "denominator", "Sir Isaac Newton"
      - BAD: "$44.97", "42%", "x = 7", "Selling price = $44.97"
      - NEVER a number that requires calculation. NEVER a computed result.

      WHAT CLUES MUST BE:
      - Each clue is a DESCRIPTIVE HINT about its specific answer word.
      - Good clues: "This process happens in the chloroplast" → answer: "photosynthesis"
      - BAD clues: "Calculate the selling price", "Find the markup" (worksheet instructions, NOT clues)
      - NEVER start with directive words like "Calculate", "Find", "Use", "Remember", "Solve", "Apply"

      VALID EXAMPLE (copy this SHAPE, change the content):
      {
        "taskType": "brain-blitz",
        "title": "Key Math Vocabulary",
        "prompt": "Read each clue and shout the answer as a question! e.g. 'What is photosynthesis?'",
        "clues": [
          { "clue": "In algebra, this letter or symbol represents an unknown quantity.", "answer": "variable" },
          { "clue": "The answer you get when you add two or more numbers together.", "answer": "sum" },
          { "clue": "A number that divides evenly into another number with no remainder.", "answer": "factor" },
          { "clue": "This tells you how many times to multiply a base by itself.", "answer": "exponent" },
          { "clue": "A math sentence that shows two expressions are equal, using an = sign.", "answer": "equation" },
          { "clue": "The distance a number is from zero on a number line, always positive.", "answer": "absolute value" }
        ],
        "config": {
          "clues": [
            { "clue": "In algebra, this letter or symbol represents an unknown quantity.", "answer": "variable" },
            { "clue": "The answer you get when you add two or more numbers together.", "answer": "sum" },
            { "clue": "A number that divides evenly into another number with no remainder.", "answer": "factor" },
            { "clue": "This tells you how many times to multiply a base by itself.", "answer": "exponent" },
            { "clue": "A math sentence that shows two expressions are equal, using an = sign.", "answer": "equation" },
            { "clue": "The distance a number is from zero on a number line, always positive.", "answer": "absolute value" }
          ]
        }
      }

      CRITICAL: Every clue must have a UNIQUE answer. If you use the same answer for two clues, the task will be REJECTED.

      Now generate a brand-new brain-blitz task.
      `.trim(),
      },

    [TASK_TYPES.TRUE_FALSE_TICTACTOE]: {
    label: "True/False Tic-Tac-Toe",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      [
        "True/False Tic-Tac-Toe (intra-team duel). Players within the SAME team face off 1:1 on a tic‑tac‑toe grid.",
        "",
        "Core loop:",
        "• A 3×3 grid is shown.",
        "• A stack of short statements appears as draggable/tappable 'bubbles'.",
        "• Each player is assigned a role: TRUE or FALSE (internally X/O).",
        "• On your turn, pick a statement and place it on a square. If the statement matches your role's truthiness, you claim the square; otherwise your opponent claims it.",
        "• First to 3‑in‑a‑row wins the round.",
        "",
        "Rounds:",
        "• AI may generate up to 3 sets of statements (for multiple pairs/rounds). The runtime can use only as many sets as needed so everyone gets a round.",
        "• If an odd number of players: winner of round 1 pairs with the last player.",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"true-false-tictactoe\"",
        "title: short (3–7 words)",
        "prompt: short instructions (optional; UI already explains)",
        "timeLimitSeconds: 120–180",
        "statements: [ { text: string, isFalse: boolean } ]  // 9–14 statements recommended",
        "Optional (for multi-round support):",
        "config: { statementSets?: [ statements[], statements[], ... ] }",
        "",
        "Pedagogical benefits: evaluation + retrieval under game conditions, attention to truth-conditions, and motivating repetition with strategy.",
      ].join("\n"),

    demoPrompt: "Copy these exact notes into your notebook. Then tap DONE.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "true-false-tictactoe".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Create EXACTLY 9 true/false statements for a tic-tac-toe grid.
    - Mix true and false roughly evenly (4-5 true, 4-5 false).
    - CRITICAL: Use an "items" array with EXACTLY 9 objects, each having:
      { "statement": "The Earth is round.", "correctAnswer": true }
    - correctAnswer must be a boolean (true or false), NOT a string.

    Example structure:
    {
      "taskType": "true-false-tictactoe",
      "title": "Science Facts",
      "prompt": "Claim squares by correctly identifying true and false statements!",
      "items": [
        { "statement": "Water boils at 100°C at sea level.", "correctAnswer": true },
        { "statement": "The Sun revolves around the Earth.", "correctAnswer": false },
        ... (9 items total)
      ]
    }

    Common failure prevention:
    - You MUST include EXACTLY 9 items -- not 8, not 10.
    - correctAnswer must be boolean true or false, not a string.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

    [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: {
    label: "True/False Connect Four",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      [
        "True/False Connect Four -- a 7×6 drop-grid game using true/false statements. Designed as an end-of-session review round that recycles unused terms from earlier tasks.",
        "",
        "Core loop:",
        "• A 7-column × 6-row grid is displayed. Pieces drop to the lowest open row in a column (gravity).",
        "• A large pool of true/false statements is shown as tappable bubbles.",
        "• Each team/side is assigned TRUE (Blue/O) or FALSE (Red/X).",
        "• On your turn, pick a statement and tap a column. If the statement matches your role's truthiness, your piece drops in that column; otherwise the opponent's piece drops.",
        "• First to 4-in-a-row (horizontal, vertical, or diagonal) wins.",
        "",
        "Modes:",
        "• Inter-team: two teams play head-to-head, alternating turns.",
        "• Intra-team: team splits in half (like Live Debate) for a within-team duel.",
        "",
        "Term recycling:",
        "• The taskset runner collects unused/remaining terms from prior tasks and feeds them into Connect Four's statement pool.",
        "• AI can also generate fresh statements to pad the pool to 20–30 items.",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"true-false-connect-four\"",
        "title: short (3–7 words)",
        "prompt: short instructions (optional; UI explains)",
        "timeLimitSeconds: 240–300",
        "statements: [ { text: string, isFalse: boolean } ]  // 20–30 statements recommended",
        "",
        "Pedagogical benefits: high-volume review of terms, strategic thinking, gravity mechanic adds spatial reasoning, end-of-session energy burn with learning reinforcement.",
      ].join("\n"),

    demoPrompt: "",
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "true-false-connect-four".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, statements.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a Connect Four game powered by true/false statements. Students pick a statement, then drop a piece into a column. TRUE statements → Blue piece, FALSE statements → Red piece. First to get 4-in-a-row wins.
    - Generate a pool of true/false statements so students can play multiple rounds in 5 minutes.
    - Write one true/false statement for each term or concept you are given, covering the most important ones first.
    - REQUIRED: 8–12 statements (MINIMUM 6 — fewer will be REJECTED). Up to 30 is fine if the topic supports it, but never exceed 30.
    - Mix of TRUE and FALSE, roughly 50/50 — at least 2 TRUE and at least 2 FALSE.
    - Each statement must be a clear, factual claim that is unambiguously true or false.

    REQUIRED STRUCTURE -- items array at ROOT level (8–12 entries, minimum 6):
    {
      "taskType": "true-false-connect-four",
      "title": "Connect Four: The Water Cycle",
      "prompt": "Pick a statement, then tap a column to drop your piece!",
      "timeLimitSeconds": 300,
      "items": [
        { "prompt": "Evaporation turns liquid water into water vapor.", "correctAnswer": true },
        { "prompt": "Condensation happens when water vapor cools and forms droplets.", "correctAnswer": true },
        { "prompt": "Rain falls upward during precipitation.", "correctAnswer": false },
        { "prompt": "The water cycle is powered by the moon's gravity.", "correctAnswer": false }
      ]
    }
    (Either items[{prompt, correctAnswer:boolean}] or statements[{text, isFalse:boolean}] is accepted — they carry the same data.)

    CRITICAL -- NO PLACEHOLDER TEXT:
    - NEVER use "Statement 1", "True statement", "False statement", or any generic filler.
    - Every statement MUST be a real factual claim about the subject.
    - FALSE statements should be plausible-sounding but incorrect (not absurd jokes).

    Common failure prevention:
    - items[]/statements[] MUST contain at least 6 entries (8–12 recommended, 20–30 ideal).
    - Each entry MUST be either { prompt, correctAnswer:boolean } or { text, isFalse:boolean } (non-empty text).
    - Include at least 2 TRUE and at least 2 FALSE; aim for a roughly equal split.
    - Do NOT put statements inside config -- put them at the ROOT level of the task object.
    `,
  },

  [TASK_TYPES.TOWER_BUILDER]: {
    label: "Tower Builder",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      [
        "Tower Builder -- students build a tower by evaluating statements one at a time.",
        "",
        "Binary mode (true/false):",
        "• TRUE statements become solid blocks -- the tower grows.",
        "• FALSE statements are 'mushy' -- the tower partially collapses back to the last solid block.",
        "",
        "Tri-state mode (benefit/harm/neutral):",
        "• BENEFIT statements are solid blocks -- full height.",
        "• NEUTRAL statements are wobbly, smaller blocks -- half height, but they hold.",
        "• HARM statements are mushy -- tower collapses back to last non-harm block.",
        "",
        "Students see one statement at a time and decide: 'Stack it!' or 'Skip'.",
        "Skipping is safe but scores nothing. Stacking a good statement earns points; stacking a bad one destroys progress.",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"tower-builder\"",
        "title: short (3–7 words)",
        "prompt: topic context for students",
        "items: [ { statement: string, category: \"benefit\"|\"harm\"|\"neutral\" } ]",
        "  -- For binary mode, use only \"benefit\" and \"harm\" (mapped from true/false).",
        "  -- For tri-state mode, include all three categories.",
        "  -- 10–15 items recommended.",
        "",
        "Pedagogical benefits: critical evaluation under stakes, consequence-based learning (bad choices cost progress), deeper analysis with tri-state (benefit/harm/neutral requires nuance beyond binary true/false).",
      ].join("\n"),

    demoPrompt: "Stack only the true statements to build your tower!",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "tower-builder".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Create 8–10 statements about the given topic (not more — students stack them one by one).
    - Each item has: { "statement": "...", "category": "benefit"|"harm"|"neutral" }
    - For FACTUAL / recall topics (e.g. math, science facts), use BINARY:
      benefit = a CORRECT statement (stacks), harm = an INCORRECT statement (collapses).
      Do NOT use "neutral" for factual topics — a true fact is never "neutral", and a
      neutral pile of true statements confused testers. Every factual item is either
      correct (benefit) or incorrect (harm).
    - Use the tri-state "neutral" ONLY for genuine evaluation/impact topics (benefit vs harm
      vs truly-neither), never for factual recall.
    - BALANCE IS REQUIRED: at least 3 of the items must be HARM (incorrect/false), so students
      have to discriminate — do NOT make almost everything a benefit (testers: "too many to
      stack", "not enough false").
    - Statements should require genuine thought -- avoid obviously true/false items.

    Example structure (tri-state):
    {
      "taskType": "tower-builder",
      "title": "Industrial Revolution Effects",
      "prompt": "Build your tower with statements that describe BENEFITS of the Industrial Revolution. Avoid harms!",
      "items": [
        { "statement": "Factory production made goods cheaper and more available.", "category": "benefit" },
        { "statement": "Child labor became widespread in factories.", "category": "harm" },
        { "statement": "Population shifted from rural to urban areas.", "category": "neutral" },
        ... (8-10 items total)
      ]
    }

    Example structure (binary):
    {
      "taskType": "tower-builder",
      "title": "Cell Biology Facts",
      "prompt": "Stack only the TRUE statements about cells!",
      "items": [
        { "statement": "Mitochondria produce ATP.", "category": "benefit" },
        { "statement": "Plant cells have no cell wall.", "category": "harm" },
        ... (8-10 items total)
      ]
    }

    Common failure prevention:
    - category must be one of: "benefit", "harm", "neutral" -- not true/false.
    - Include 8-10 items (at least 3 of them HARM).
    - Ensure prompts are student-facing instructions (what to do).
    `,
  },

  // ✅ Updated to match your stated intent: mastery-oriented, low-stress, intra-team yes, inter-team no
  [TASK_TYPES.FLASHCARDS]: {
    label: "Flashcards",
    category: CATEGORY.RECALL,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    scoringMode: "none", // typically not graded; just tracked / completion
    aiScoringDefaultOn: false,
    quickTaskEligible: true,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    correctAnswerShape: "string-or-list",
    description:
      "Standard flashcard review (8–12 cards) with {question, answer}. Intended flow is 'shout to answer' with optional speech recognition / AI transcription support. Focus is mastery and repeated retrieval, not competition. Intra-team play enabled; inter-team play disabled.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "flashcards".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    HOW TO BUILD THE FLASHCARDS:
    1. Look at the Vocabulary / Concept list provided in the user message.
    2. Pick 12–20 terms from that list as card fronts.
    3. For EACH term, write a clear, concise definition or answer as the card back (8–20 words).
    - Card fronts MUST be real vocabulary terms from the provided list -- do NOT invent generic terms.
    - NEVER use placeholder text like "Term 1", "Card 2", "Question 3", etc.
    - Keep cards brief and accurate.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  // ✅ Updated: this mode is inherently inter-team (A vs B scoring / winner events)
  [TASK_TYPES.FLASHCARDS_RACE]: {
    label: "Flashcards Race",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true, // buzzer winner types the answer
    maxTimeSeconds: 420, // ~5–7 min typical, but depends on deck size + pace
    estimatedMinutes: 7,
    interTeamEnabled: false,
    intraTeamEnabled: true, // per spec: inter-team YES, intra-team NO
    correctAnswerShape: "string-or-list",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 5, max: 8 },
    description:
      [
        "High-energy competitive recall: teams race to answer flashcard questions correctly.",
        "",
        "Core loop:",
        "• A card shows a QUESTION (large, high-contrast).",
        "• 20s countdown per card (config.secondsPerCard; AI-adjustable).",
        "• Players/teams BUZZ IN (tap) -- first buzz earns the right to answer.",
        "• Correct → +10 points (optional +5 first-buzz bonus). Wrong → answer right passes.",
        "• Rounds continue until all cards are won or the round timer ends.",
        "• Live leaderboard / score banner updates after every point.",
        "• End screen + 15s post-task overlay auto-advances to the next scan/task.",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"flashcards-race\"",
        "config: {",
        "  items: [ // 5–8 cards",
        "    { question: string, answer: string, acceptableAnswers?: string[] }",
        "  ],",
        "  secondsPerCard?: number, // default 20",
        "  playerCount?: number, // 1–4 (optional)",
        "  interTeam?: true, // must be true for this mode",
        "  points?: { correct?: 10, firstBuzzBonus?: 5 }",
        "}",
        "",
        "Pedagogical benefits: retrieval practice + speed/automaticity (Bloom's: Remember/Understand),",
        "with motivating game-show energy (sounds, confetti, live score).",
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "flashcards-race".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    HOW TO BUILD THE FLASHCARDS RACE:
    1. Look at the Vocabulary / Concept list provided in the user message.
    2. Pick 8–15 terms from that list.
    3. For EACH term, write a short clue, definition, or question as the "question" field.
    4. The term itself (1–5 words, unambiguous) goes in the "answer" field.
    - Questions and answers MUST be based on real vocabulary terms from the provided list -- do NOT invent generic content.
    - NEVER use placeholder text like "Question 1", "Answer 2", "Term 3", etc.
    - This is a buzzer-style competitive recall game. Students race to answer flashcard questions.
    - You MUST place flashcards inside config.items (NOT at the root level).
    - Each flashcard MUST have: { "question": "...", "answer": "..." }
    - "question" = the prompt shown on the card (short, clear -- a definition, clue, or question).
    - "answer" = the expected correct response (1–5 words, unambiguous, ≤50 characters).
    - For MATH: make term↔definition cards — the answer is the short vocabulary TERM (e.g. question "The top number of a fraction" → answer "numerator"; "A polygon with 4 equal sides" → answer "square"). Do NOT make compute-the-answer problems where the answer is a worked value like "5/4 + 1/2 = 7/4". Race answers are short terms students type fast, never calculations.

    CRITICAL -- config.items structure:
    {
      "taskType": "flashcards-race",
      "title": "Flashcards Race: The Water Cycle",
      "prompt": "Buzz in and answer each question as fast as you can!",
      "config": {
        "items": [
          { "question": "What process turns liquid water into water vapor?", "answer": "evaporation" },
          { "question": "Water droplets forming in clouds is called...", "answer": "condensation" }
        ]
      }
    }

    CRITICAL -- NO PLACEHOLDER TEXT:
    - NEVER use "Question 1", "Answer 1", "Term 1", "Card 1" or any generic filler.
    - Every question and answer MUST contain real subject-matter content.

    Common failure prevention:
    - config.items MUST contain at least 5 cards. 8–15 is ideal.
    - Each card MUST have both "question" (non-empty) and "answer" (non-empty).
    - Do NOT put items at the root level -- they MUST be inside config.items.
    `,
},

  // (rest unchanged from your file)
  [TASK_TYPES.GUESS_WHO]: {
    label: "Guess Who",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    maxTimeSeconds: 60,
    estimatedMinutes: 2,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Yes/No deduction game. One player privately views the secret person (hold-to-reveal). Others ask only yes/no questions, then make limited guesses (e.g., max 10). Timer (e.g., 60s) starts on first reveal. The answer should always be a PERSON -- historical figure, scientist, author, leader, etc. Encourages logical elimination and strategic questioning.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "guess-who".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a YES/NO deduction game called "Guess Who" -- the answer must ALWAYS be a PERSON.
    - One player secretly sees the name of a person, and others ask yes/no questions to figure out who it is.
    - Generate config.secretAnswers: an array of 3–6 PEOPLE relevant to the topic (historical figures, scientists, authors, leaders, inventors, artists, etc.). MINIMUM 3 -- each secret answer is one round of play.
    - CRITICAL: Every secretAnswer MUST be a real, named person -- NEVER a concept, vocabulary word, or abstract term. The game is called "Guess WHO" for a reason.
    - Set config.category to the topic/theme label (e.g., "Key Figures of the Renaissance").
    - Set config.maxGuesses to 10 (default).

    REQUIRED STRUCTURE:
    {
      "taskType": "guess-who",
      "title": "Guess Who: Figures of the Revolution",
      "prompt": "One player will secretly see the name of a historical figure. Ask yes/no questions to figure out who it is! You have 10 guesses.",
      "config": {
        "secretAnswers": ["George Washington", "Benjamin Franklin", "Thomas Jefferson", "King George III", "Paul Revere"],
        "category": "American Revolution",
        "maxGuesses": 10
      }
    }

    CRITICAL -- PEOPLE ONLY:
    - NEVER use concepts, vocabulary words, or abstract terms as secret answers.
    - Every secret answer MUST be a real, named person relevant to the topic.
    - If the topic doesn't have obvious people (e.g., math), use famous mathematicians, scientists, or inventors connected to the concepts.

    Common failure prevention:
    - config.secretAnswers MUST contain at least 3 items.
    - Each item must be a person's name, not a concept.
    `,
},

    [TASK_TYPES.HANGMAN_DUEL]: {
    label: "Hangman Duel",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 300,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      [
        "Hangman Duel (intra-team). Teams solve a mystery word shown as blanks by taking turns choosing letters (drag letter tiles/cubes into the blanks container).",
        "",
        "Gameplay expectations:",
        "• Correct letters lock in and score; wrong letters move to a used pile and advance a playful 'build' (not grim).",
        "• Students may attempt a full-word guess (risk/reward).",
        "• Strict turn rotation enforced by turnkeeper where available.",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"hangman-duel\"",
        "title: short (3–7 words)",
        "prompt: optional hint/instructions",
        "timeLimitSeconds: 90–180 (default 120)",
        "config: {",
        "  wordsByStation: [",
        "    { word: string, hint?: string }  // one per station/display; must be DIFFERENT to prevent cross-team helping",
        "  ]",
        "}",
        "",
        "IMPORTANT: choose words from aiWordBank when possible, and vary by station.",
        "IMPORTANT: wordsByStation should have 8 entries (one per station) and words MUST be unique.",
        "IMPORTANT: keep words grade-appropriate and 4–12 letters unless the unit requires otherwise.",
        "",
        "Pedagogical benefits: spelling + vocabulary + pattern recognition, strategic risk-taking, and high engagement under time pressure.",
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "hangman-duel".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - CRITICAL: Include config.wordsByStation with EXACTLY 8 entries.
    - Each entry MUST have both "word" and "hint" fields (both non-empty strings).
    - Words should be 4–12 letters, unique, and grade-appropriate.
    - Example:
      "config": {
        "wordsByStation": [
          { "word": "ELEPHANT", "hint": "Large gray mammal with a trunk" },
          { "word": "GIRAFFE", "hint": "Tallest land animal" },
          ... (8 entries total)
        ]
      }

    Common failure prevention:
    - You MUST include EXACTLY 8 entries in wordsByStation.
    - Every entry MUST have both "word" AND "hint" -- do NOT omit hints.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.WORD_WEAVER_DUEL]: {
    label: "Word Weaver Duel",
    category: CATEGORY.COMPETITIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    expectsText: true,
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Scrabble-style, turn-based team duel: players drag/place 5–10 short words onto a grid (horizontal/vertical), earning points for each valid placement and intersections. Builds vocabulary, phrase structure, syntax awareness, and cooperative competition.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "word-weaver-duel".

    SCHEMA:
    {
      taskType: "word-weaver-duel",
      title: string,
      prompt: string (student-facing instruction),
      config: {
        words: string[] (6–12 REAL vocabulary words from the provided vocabulary list)
      }
    }

    CRITICAL -- NO PLACEHOLDERS:
    NEVER use generic labels like "WORD1", "WORD2", "word3", etc.
    Every word in config.words MUST be a real vocabulary term relevant to the topic.
    BAD: ["WORD1", "WORD2", "WORD3", "WORD4", "WORD5", "WORD6", "WORD7", "WORD8"]
    GOOD: ["photosynthesis", "chloroplast", "carbon dioxide", "glucose", "oxygen", "stomata", "sunlight", "ATP"]

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - config.words must contain 8–12 real vocabulary words from the topic.
    - prompt should tell students to use these words in a word-building challenge.

    INTERLOCKING (IMPORTANT — this is a crossword-style builder):
    - The words must INTERLOCK like a crossword: choose words that SHARE common
      letters so they can cross each other. Prefer a set where most words share
      at least one letter with several others (e.g. common letters like E, A, R,
      S, T, O, N appearing across the set).
    - Mix shorter words (3–5 letters) with longer ones so crossings are easy to
      find. Avoid a set of words with almost no letters in common (e.g. all
      starting and ending on rare, non-overlapping letters), or the puzzle is
      unsolvable.
    - GOOD (shared letters interlock): ["photosynthesis","chloroplast","stomata","oxygen","glucose","sunlight","carbon","water"]

    Common failure prevention:
    - Do NOT generate placeholder words. Use REAL vocabulary from the provided concept list.
    - Do NOT use "WORD" + number patterns. Every word must be meaningful.
    `,
},

  [TASK_TYPES.DIFF_DETECTIVE]: {
    label: "Diff Detective",
    category: "analysis",
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      "Spot the differences" between two versions (usually passages/lists; can be code/diagrams if UI supports it).
      Students identify differences and submit them as a list. Can be objective-scored (if differences are known)
      or AI-assisted.

      AI MUST output a JSON task with:
      - taskType: "diff-detective"
      - title: short (3–7 words)
      - prompt: clear instruction
      - original: string  (Version A)
      - modified: string  (Version B)
      Optional (recommended for objective scoring):
      - differences: array of strings (each a specific difference the student should notice)
      - timeLimitSeconds: 60–120
      Optional:
      - mode: "text" | "list" | "code" (default "text")

      Constraints:
      - Include at least 4 meaningful differences.
      - Keep original/modified similar length.
      - Differences should be unambiguous and grade-appropriate.

      Benefits: close reading, attention to detail, error detection, comparison skills.
          `,
        
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "diff-detective".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - PRIMARY output (text mode — always required):
        Create two short text passages — Version A ("original") and Version B
        ("modified") — that are nearly identical except for 6–10 deliberate,
        unambiguous changes (rewording, swapped facts, changed dates/numbers,
        altered names). Each change must be a real spotting target a student
        can call out.
        Provide "differences": an array of strings, each describing one of
        the changes ("Henry was changed to William", "1812 was changed to
        1813").
        Optional: "mode": "text" (default).

    - SECONDARY (strongly preferred) — "imageScenePrompt" for true image-
      to-image spot-the-difference. Tester (2026-05-31): "wanted it to be
      a image difference detection… these should be topic-relevant images,
      of course".

      "imageScenePrompt": "<1–2 sentence vivid description of a single
                            scene that DEPICTS the lesson topic and weaves
                            in at least 2–3 SPECIFIC vocabulary terms / named
                            entities / places from the vocab list. Brightly
                            lit, plain background, several distinct objects,
                            NO text/numbers/labels in the picture itself.
                            Use concrete nouns the image model can draw.>"

      Examples — note how each names real vocab terms from its lesson:
        War of 1812:
          "British soldiers in red coats and a Canadian militiaman firing
           muskets from the rocky cliff at Queenston Heights, with a stone
           fort and a small wooden cannon in the foreground."
        Cell biology:
          "A cross-section diagram of a plant cell showing a large central
           vacuole, several oval chloroplasts, a round nucleus, and the
           thick cell wall, in flat textbook-style illustration."
        Acadian Expulsion:
          "An Acadian family with a wooden cart loaded with belongings
           standing on a Nova Scotia beach as a British ship waits offshore
           under a grey sky."

      Anti-examples — do NOT emit generic scenes that could be from any
      topic ("a busy classroom", "children playing outside"). The whole
      point is topic-relevance — if you can't name specific lesson terms in
      the scene, OMIT imageScenePrompt entirely and stay with text mode.

      The server will then generate two near-identical images (Image A +
      Image B with 2–3 controlled changes) from this prompt at taskset-
      creation time. On success the student plays the real image-pair
      spot-the-difference; on failure (no image-gen keys, abstract topic,
      etc.) the text passages above are the safe fallback. NEVER emit
      "mode":"image" or a "labels" array yourself — those legacy paths are
      deprecated.

    Common failure prevention:
    - Keep "original" and "modified" similar length and similar phrasing
      except for the deliberate differences.
    - Each difference must be objectively verifiable.
    - Ensure prompts are student-facing instructions (what to do).
    - Only include "imageScenePrompt" when the topic is visually concrete;
      skip it for abstract topics where a single scene wouldn't make sense.
    `,
},

  [TASK_TYPES.SPEED_DRAW]: {
    label: "Speed Draw",
    category: "creative",
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      Pictionary-style speed drawing game.
      One player draws quickly; teammates guess. Often timed (60s).

      AI MUST output:
      - taskType: "speed-draw"
      - word: single drawable concept
      Optional:
      - difficulty: "EASY" | "MEDIUM" | "HARD" (default MEDIUM)
      - timeLimitSeconds: typically 60
      - prompt/title

      Constraints:
      - Choose drawable nouns/phrases (avoid ultra-abstract prompts).
      Benefits: rapid concept visualization, vocabulary reinforcement, retrieval through images.
          `,
        
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "speed-draw".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    SHAPE (single drawable concept, Pictionary-style):
    - config.word: ONE drawable concept tied to the topic (1-3 words, max 5).
      The student draws this ONE thing — their teammates guess. The renderer
      shows the player only this word.
    - config.difficulty: "EASY" | "MEDIUM" | "HARD" (default "MEDIUM").
    - config.timeLimitSeconds: integer 30-120 (default 60).
    - prompt: short student-facing instruction, e.g. "Draw the concept on
      your screen — your team has 60 seconds to guess it!"

    ABSOLUTE BANS — these break the renderer:
    - DO NOT emit items[], prompts[], questions[], or any array of drawables.
      One task = ONE word.
    - DO NOT put labels, multi-part hints, or "draw A and B" in config.word.

    GOOD examples:
    - For "Photosynthesis": config.word = "Chloroplast"
    - For "War of 1812": config.word = "Fort McHenry"
    - For "Fractions": config.word = "Pie chart of 3/4"

    BAD examples (DO NOT EMIT):
    - items: [{ prompt: "Draw an electron" }, { prompt: "Draw a proton" }] (multi-item)
    - config.word: "Draw a fraction and label its parts"        (multi-part)
    - config.word: "fractions, decimals, percents"              (list)
    `,
},

  [TASK_TYPES.PET_FEEDING]: {
    label: "Feed the Pet!",
    category: CATEGORY.MOVEMENT,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 180,
    estimatedMinutes: 4,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: [
      "Feed the Pet: students classify statements as 'good' (true/pro/beneficial) or 'bad' (false/con/harmful) for a topic.",
      "Good items feed and grow a cute virtual pet; bad items make the pet sick.",
      "",
      "Student flow:",
      "- A cute pet appears (from the chosen animal pack).",
      "- Statement cards appear as 'food' items. Student taps to select, then taps the pet to feed it.",
      "- Good (true/pro) statements → pet grows, sparkles, +points.",
      "- Bad (false/con) statements → pet shakes, screen trembles, +mistake.",
      "- Goal: feed the pet enough good items before running out of chances.",
      "",
      "AI generation / schema hints:",
      "taskType: \"pet-feeding\"",
      "title: short (3–7 words)",
      "prompt: instructions (e.g., 'Feed only the TRUE statements to your pet!')",
      "pack: \"classic\" | \"farm\" | \"ocean\" | \"dino\" | \"fantasy\"",
      "goodFoods: string[]  // 5–8 TRUE/PRO statements about the topic",
      "badFoods: string[]   // 4–6 FALSE/CON statements about the topic",
      "config.goal: number  // how many good feeds to win (default 4)",
      "",
      "Alternative: items/foodItems array of { label: string, good: boolean }",
      "Inter-team: NO. Intra-team: NO.",
    ].join("\n"),

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "pet-feeding".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This is a TRUE/FALSE classification game disguised as feeding a pet.
    - Students see statement cards presented as "food" items. They must pick the TRUE/PRO statements (good food) and avoid the FALSE/CON statements (bad food).
    - Generate two arrays:
      * "goodFoods": 6–8 TRUE or PRO statements about the topic (these grow the pet)
      * "badFoods": 6–8 FALSE or CON statements about the topic (these make the pet sick)
    - Aim for at least 12 total items (6+ good, 6+ bad). More is better -- up to 16 total.
    - Each statement should be a short factual claim (1 sentence) that is clearly true or false.
    - Set "pack" to one of: "classic", "farm", "ocean", "dino", "fantasy"
    - Set config.goal to the number of good feeds needed to win (typically 4).

    REQUIRED STRUCTURE:
    {
      "taskType": "pet-feeding",
      "title": "Feed the Pet: The Water Cycle",
      "prompt": "Feed your pet only the TRUE statements! Avoid the false ones or your pet will get sick!",
      "pack": "ocean",
      "goodFoods": [
        "Evaporation turns liquid water into water vapor",
        "The sun powers the water cycle",
        "Condensation forms clouds"
      ],
      "badFoods": [
        "Rain falls upward during precipitation",
        "The water cycle stops at night",
        "Ice cannot turn directly into water vapor"
      ],
      "config": { "goal": 4 }
    }

    CRITICAL -- NO PLACEHOLDER TEXT:
    - NEVER use "Good Food 1", "Bad Food 1", "Statement 1", or any generic filler.
    - Every statement MUST be a real factual claim about the subject.

    Common failure prevention:
    - goodFoods MUST contain at least 6 items. badFoods MUST contain at least 6 items. Total should be 12+.
    - Every item must be a non-empty string with real content.
    `,
},

  [TASK_TYPES.COLLABORATION]: {
    label: "Collaboration (Pair & Respond)",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    expectsText: true,
    maxTimeSeconds: 180,
    estimatedMinutes: 6,
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "Pair-and-respond collaboration between two teams. One team writes an initial response, " +
      "then views another team's response and writes a thoughtful reply. AI-scored for quality and engagement.",
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "collaboration".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - This is a PAIR-AND-RESPOND task: one team writes an initial response to the prompt, then sees another team's response and writes a thoughtful reply. The frontend does NOT use roles or clue cards — it only shows the prompt.
    - Write ONE clear, focused, open-ended prompt about a SINGLE concept that two teams can answer and then build on each other's answers.
    - Keep the prompt SHORT (1–2 sentences, under ~400 characters) and grade-appropriate. Do NOT split it into per-team instructions, numbered parts, or multiple concepts. Do NOT divide the class into teams with different sub-topics — that's too complex.
    - Good example (focused): "In your team, explain one real-world situation where adding fractions with different denominators is useful. Then read another team's example and add one improvement or question."
    - BAD example (over-complex, reject this pattern): "Your class is divided into two teams. Team 1 will explore adding/subtracting fractions with same and different denominators using fraction strips … Team 2 will …"

    Common failure prevention:
    - This task only needs taskType, title, and a single focused prompt. Do NOT add roles, clues, items, or answer keys.
    - Ensure the prompt is a student-facing instruction (what to do).
    `,
},

  [TASK_TYPES.LIVE_DEBATE]: {
    label: "Live Debate",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    expectsText: true,
    maxTimeSeconds: 600,
    estimatedMinutes: 10,
    isOffTablet: true,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Live team debate between two paired teams with timed speaking turns and rebuttals.\n" +
      "Student flow:\n" +
      "- Teams choose from AI-generated debate topics.\n" +
      "- Prep window.\n" +
      "- Timed speaking turns with rebuttals.\n" +
      "Scoring: AI-assisted rubric for argument quality and evidence.",
  
    aiPrompt: `
      Generate ONE Curriculate task object with taskType "live-debate".

      Hard requirements:
      - Output ONLY a single JSON object (no markdown, no commentary).
      - Include non-empty root fields: taskType, title, prompt, postulate.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.

      Task-specific guidance:
      - This is a live debate task. Students argue FOR or AGAINST a proposition.
      - "postulate" is the debate topic/resolution -- a clear, debatable statement.
        MUST be a proposition, NOT an instruction. Good: "The fur trade did more harm than good for Indigenous peoples."
        Bad: "Debate the fur trade."
      - "prompt" is a brief student-facing instruction.

      REQUIRED STRUCTURE:
      {
        "taskType": "live-debate",
        "title": "Debate: The Fur Trade",
        "prompt": "Your team will argue FOR or AGAINST the topic below. Take turns making your best arguments!",
        "postulate": "The fur trade did more harm than good for Indigenous peoples in early Canada."
      }

      Common failure prevention:
      - "postulate" MUST be a debatable statement -- not a question, not an instruction.
      `,
},

  [TASK_TYPES.AI_DEBATE_JUDGE]: {
    label: "AI Debate Judge",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    // Special task: not included in normal AI-generated task sets (invoked on demand).
    generatorEligible: false,
    demoEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    // 2:00 main + 0:30 overtime grace = 150s hard-stop
    maxTimeSeconds: 150,
    estimatedMinutes: 4,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "AI Debate Judge: students run a live debate and the AI produces a written verdict with scores, feedback, and a winner announcement (rubric-style evaluation).\n\nStudent flow:\n- Pick your Side (Affirmative/Negative) and your Position (Introduction / First / Rebuttal / Conclusion).\n- Tap the big 1-2-3 GO button to start recording; the device shows a live sound meter while listening.\n- Timer counts down from 2:00 to -0:30 (overtime grace).\n- Audio cues: 1:45 elapsed, beeps the last 5 seconds to 2:00, warning at 2:15, auto-ends at 2:30.\n- Recording auto-submits at the end (or students can submit early when finished).\n- AI returns: per-speaker score, strengths, specific improvement tips, and an overall side-by-side winner decision.\n\nScoring notes:\n- Penalty if under 1:45 or over 2:15.\n- Encourages evidence and structure by making criteria visible.\n\nPedagogical benefits: clearer criteria for argument improvement, motivation to use evidence and structure, better reflection after live speaking, and higher-quality feedback than peer-only judging.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "ai-debate-judge".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Same as Live Debate, but include a structured rubric and explicit scoring bands for an AI judge (e.g., 1–5 for each criterion).
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.BRAINSTORM_BATTLE]: {
    label: "Brainstorm Battle",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: "Fast-paced team brainstorm to activate prior knowledge and generate ideas without fear of being wrong.\nStudent flow:\n- A topic/seed prompt appears.\n- Team rapidly contributes short ideas (spoken aloud and/or typed as quick entries).\n- Optional quick vote/rank at the end to highlight the strongest ideas.\nScoring: Not single-correct; typically completion-based (optionally +bonus for voting).\nAI generation should produce:\n- prompt (string)\n- seedTopic (string, optional)\n- ideaSlots (number, optional; default 8\u201312)\n- enableVoting (boolean, optional)\n- timeLimitSeconds (optional; usually 60\u2013120)\nInter-team: NO. Intra-team: YES.",
    pedagogyNotes: "Fast-paced 'shout ideas' collaborative brainstorm. The device shows a topic/seed prompt and your team rapidly contributes many ideas (spoken aloud and/or typed as short entries). No single correct answer -- the goal is divergent thinking. Optional quick vote/rank at the end to highlight strongest ideas. Builds creative ideation, background knowledge, verbal participation, and lowers fear of being wrong.",
  
    aiPrompt: `
      Generate ONE Curriculate task object with taskType "brainstorm-battle".
      
      Hard requirements:
      - Output ONLY a single JSON object (no markdown, no commentary).
      - Include non-empty root fields: taskType, title, prompt.
      - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.
      
      Task-specific guidance:
      - Create a timed brainstorm challenge with 3 rounds. Each round has a prompt and scoring rule (unique ideas, relevance, etc.). Provide example answers (not exhaustive).
      
      Common failure prevention:
      - Do not omit required arrays/fields; satisfy minimum item counts.
      - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
      - Ensure prompts are student-facing instructions (what to do).
      `,
},

  [TASK_TYPES.MYSTERY_CLUES]: {
    label: "Mystery Clue Cards (Digital)",
    category: "memory",
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: true,   // not user-selectable; injected via teacher profile toggle
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 30,
    estimatedMinutes: 1,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      Digital observation + working-memory bonus spanning an entire taskset.

      Two phases:
      1) Reveal (non-final tasks):
      - taskType: "mystery-clues"
      - isFinal: false
      - clues: ["Apple","Cat","Rocket"]  (2–4 simple emoji-style labels)
      - UI shows these for ~8 seconds then hides them.

      2) Final recall (final task):
      - taskType: "mystery-clues"
      - isFinal: true
      - clues: MUST be the cumulative set of ALL revealed clues across the taskset.
      - Student selects from a large grid; must match EXACTLY (no missing, no extras).
      - Correct = bonus (typically +10) + celebration.

      Constraints:
      - Keep clue labels simple and common (emoji-friendly).
      - Avoid more than ~8 cumulative clues total.
      - Final task MUST exist and MUST be isFinal:true.

      Key distinction:
      - This is NOT HideNSeek (physical search + photo evidence). This is purely on-screen memory.
          `,
        
    aiPrompt: `
      Generate ONE Curriculate task object with taskType "mystery-clues".

      Hard requirements:
      - Output ONLY a single JSON object (no markdown, no commentary).
      - Include non-empty root fields: taskType, title, prompt.
      - Keep language age-appropriate and classroom-safe.

      This is a CROSS-TASKSET memory challenge. Multiple mystery-clues tasks
      are scattered throughout a taskset. Each reveals 2-4 clue cards for 8
      seconds. The LAST mystery-clues task is the final recall challenge.

      Task-specific guidance:
      - Set isFinal: false (reveal phase) or isFinal: true (recall phase).
        The system auto-marks the final one, but include the field anyway.
      - For reveal tasks (isFinal: false):
        - "clues": array of 2-4 simple, memorable labels (emoji-friendly nouns).
          e.g. ["Apple", "Cat", "Rocket", "Star"]
        - "prompt": "Memorize these clue cards! They disappear in 8 seconds."
        - "title": Something fun like "Mystery Clue Reveal #1"
        - Optional: "revealMs": 8000 (default, ms to show cards)
      - For recall tasks (isFinal: true):
        - "clues": the FULL cumulative set of all clues from prior reveal tasks.
        - "prompt": "Select ONLY the cards you saw earlier. No more, no less!"
        - "title": "Mystery Clue Challenge!"
        - "bonusPoints": 10 (default bonus for perfect recall)
        - "grid": array of 16-20 items including ALL correct clues plus
          plausible distractors. e.g. ["Apple","Cat","Rocket","Star","Moon",
          "Tree","Fish","Car","Book","Hat","Dog","Sun","Key","Pen","Cup","Bell"]
      - Keep total accumulated clues under 8 across the whole taskset.

      Common failure prevention:
      - "clues" array is required and must have at least 2 items.
      - For the final task, "grid" must contain ALL the revealed clues.
      - Labels should be short (1-2 words), common nouns, no punctuation.
      `,
},

  [TASK_TYPES.FAKE_OUT]: {
    label: "Fake Out",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    maxTimeSeconds: 90,
    estimatedMinutes: 3,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: `
Turn-based oral reading + listening "truth vs fake" game (Balderdash-style).
One player (the Reader) reads aloud; others LISTEN and vote. AI provides 3 plausible options where ONLY ONE is correct,
plus one hilarious "obviously false" option. One additional slot is always a HUMAN-made-up option during play.

AI generation / schema hints (for aiTaskSetGenerator):
taskType: "fake-out"
title: short (3–7 words)
prompt: concise (UI explains)
config: {
  rounds: [
    {
      prompt: string,          // the term / concept to be read aloud
      options: string[3],      // EXACTLY 3 (includes the correct one + 2 clever fakes)
      correctIndex: 0|1|2,
      jokeOption: string,      // obviously false option
      jokeIndex: 0|1|2|3       // randomized position (NOT always 4th)
    }
  ]
}

`,
  
    aiPrompt: `
      You are generating ONE task object.

      MENTAL MODEL: Pick the real answer, but there is ONE silly joke option trying to trick you.

      Return JSON ONLY. No markdown. No commentary.

      HARD REQUIREMENTS:

      taskType must be exactly "fake-out"

      title: non-empty string

      prompt: non-empty string

      config.rounds: array with AT LEAST 3 rounds

      each round:

      prompt: string

      options: array of EXACTLY 3 strings (these are the real/fake choices)

      correctIndex: 0|1|2 (index into options)

      jokeOption: string (obviously false; NOT included in options)

      jokeIndex: 0|1|2|3 (insertion position of jokeOption among the 3 options)

      CRITICAL CORRECT INDEX RULE:

      For EACH round, determine the correct option FIRST.

      Place the correct option at ANY index (0, 1, or 2).

      Set correctIndex to the EXACT index of that option.

      Do NOT default correctIndex to 0.

      correctIndex = 0 is allowed ONLY if the first option is truly correct.

      OPTION ORDERING RULE:

      Do NOT always place the correct option first.

      Vary the position of the correct option across rounds.

      UNIQUE OPTIONS RULE (MANDATORY):

      Every option in a round MUST be unique -- no two options may have the same text (case-insensitive).
      The jokeOption must also be different from all 3 options.
      If any duplicates exist, replace the duplicate with a new plausible-but-wrong answer.

      CROSS-ROUND UNIQUENESS RULE (MANDATORY):

      Across ALL rounds in this task, no option text and no jokeOption may appear in more than one round
      (case-insensitive).  Treat the entire task as one set of unique strings.  If you generate the same
      jokeOption for two different prompts -- e.g. "Treaty of Pineapple Pizza" for both Seven Years' War
      AND General Wolfe rounds -- regenerate so each round has a fresh, topically-relevant joke.
      Tester reported the same fake-out clue appearing for both questions; this rule prevents that.

      JOKE OPTION RELEVANCE RULE (MANDATORY):

      The jokeOption must be FUNNY because it is on-topic but obviously wrong, not generic.
      It should reference something specific to that round's prompt -- a known person, place, term,
      or category from the question itself, twisted into something silly.
      Bad: "Mr. Banana"  (no connection to the question).
      Bad: "Floofy McFlooferton" (generic joke name unconnected to the topic).
      Good: for "Which treaty ended the Seven Years' War?" -> "Treaty of Pineapple Pizza"
            (because it riffs on the form "Treaty of X").
      Good: for "Who painted the Mona Lisa?" -> "Bob Ross" (in-genre but obviously wrong era).
      Good: for "Capital of Australia?" -> "Bondi Beach" (Australian, but not a city / not a capital).
      Tester reported "the obviously fake answer provided by ai did not fit"; this rule fixes that.

      ANTI-PATTERN CHECK (MANDATORY):

      If correctIndex is the same value for all rounds, regenerate the entire task.

      VALID EXAMPLE (copy this SHAPE, change the content):
      {
      "taskType": "fake-out",
      "title": "Seven Years' War: Fake-Out",
      "prompt": "One person reads the prompt aloud. Everyone votes for the real answer. Watch out: a silly joke option may appear!",
      "config": {
      "playerCount": 4,
      "rounds": [
      {
      "prompt": "Which treaty ended the Seven Years' War in 1763?",
      "options": ["Treaty of Paris", "Treaty of Utrecht", "Treaty of Versailles"],
      "correctIndex": 0,
      "jokeOption": "Treaty of Pineapple Pizza",
      "jokeIndex": 3
      },
      {
      "prompt": "General Wolfe is most associated with the British victory at...",
      "options": ["Quebec", "New Orleans", "Yorktown"],
      "correctIndex": 0,
      "jokeOption": "The Battle of the Giggle Goblins",
      "jokeIndex": 1
      },
      {
      "prompt": "Fort Duquesne stood near present-day...",
      "options": ["Pittsburgh", "Toronto", "Vancouver"],
      "correctIndex": 0,
      "jokeOption": "The Moon Base Alpha Cafeteria",
      "jokeIndex": 2
      }
      ],
      "pointsPerCorrect": 10,
      "readerBonusPoints": 0,
      "interTeamEnabled": false,
      "intraTeamEnabled": true
      }
      }

      Now generate a brand-new fake-out task.
      .trim(),
          `,
      },

  [TASK_TYPES.PHYSICAL_MYSTERY_CLUES]: {
    label: "Mystery Clue Cards (Alias)",
    category: "memory",
    profileInjectedOnly: true,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      Alias/back-compat string for Mystery Clue Cards.
      If the generator or older content uses "physical-mystery-clues", treat it as "mystery-clues"
      (the mechanic is digital/on-screen memory, not physical).

      AI SHOULD PREFER generating:
      - taskType: "mystery-clues"

      But the runtime should accept either string and normalize.
          `,
        
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "physical-mystery-clues".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Mystery Clues but with movement: clues are found by scanning stations. Provide station order and the final solution; keep instructions clear.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

    [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    label: "Brain Spark Notes",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Students see a clean, on-screen 'model notes' page (like real class notes): a title plus concise bullets.",
        "They copy the notes into a notebook/paper, then confirm completion (or submit a photo, if enabled in your flow).",
        "Bullets are short definitions/jot-notes that summarize key ideas from the topic/prompt.",
        "Suggested count: 3–5 bullets (Grades 8+ can use ~6–10).",
        "AI scoring can evaluate completeness, clarity, and organization.",
        "Benefits: summarization, distillation, study-skill building, and synthesis of main ideas.",
        "GENERATOR RULES: Provide task.title, task.prompt (topic), and task.bullets (array of concise definitions/jot-notes).",
        "Inter-team: NO. Intra-team: NO."
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "brain-spark-notes".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Create a note-taking task with a clear topic title and structured notes.
    - The task MUST include a "notes" object at the root level with the following structure:
      {
        "heading": "Topic Title Here",
        "keyTerms": [
          { "term": "Actual Term", "definition": "Real definition", "points": ["Supporting detail 1", "Supporting detail 2"] }
        ],
        "mainPoints": [
          { "title": "Main Point Title", "content": "Explanation of the main point", "details": ["Detail 1", "Detail 2"] }
        ],
        "summary": ["A concise summary sentence about the topic."]
      }
    - keyTerms: 3–5 items for Grades 3–7; 4–8 for Grades 8+.
    - mainPoints: 2–4 items explaining the key concepts.
    - summary: 1–3 sentences summarising the topic.
    - Each keyTerm MUST have a real term and definition, NOT generic placeholders.

    CRITICAL -- NO PLACEHOLDER TEXT:
    - NEVER write "Key Term 1", "Key Term 2", "Definition 1", "Concept 1", "Main Point 1", or any generic filler.
    - Every term, definition, and point MUST be a real, specific fact drawn from the actual subject.
    - If you are unsure of exact content, invent plausible age-appropriate content -- but NEVER use numbered placeholders.
    - Bad example: { "term": "Key Term 1", "definition": "Definition of Key Term 1" }
    - Good example: { "term": "Photosynthesis", "definition": "The process by which plants convert sunlight into glucose using water and CO₂", "points": ["Occurs in chloroplasts", "Requires chlorophyll"] }

    REQUIRED STRUCTURE:
    {
      "taskType": "brain-spark-notes",
      "title": "Notes: Topic Title",
      "prompt": "Copy these notes into your notebook carefully.",
      "notes": {
        "heading": "Topic Title",
        "keyTerms": [ { "term": "...", "definition": "...", "points": ["..."] } ],
        "mainPoints": [ { "title": "...", "content": "...", "details": ["..."] } ],
        "summary": ["..."]
      }
    }

    Common failure prevention:
    - The "notes" field MUST be at the root level of the task object (NOT inside config).
    - Do not omit keyTerms, mainPoints, or summary -- all three are required.
    - Do not use "bullets" -- use the structured "notes" format above.
    `,
},

  [TASK_TYPES.MIND_MAPPER]: {
    label: "Mind Mapper",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: `
Mind Mapper: students fill in a graphic organizer / concept web (with blanks) using a provided idea bank.

AI generation / schema hints (for aiTaskSetGenerator):
taskType: "mind-mapper"
title: short (3–7 words)
prompt: directions (1–3 sentences)
items: string[]                 // REQUIRED: at least 4 idea-bank items
config: {
  centralTopic: string,
  difficulty: "easy" | "medium" | "hard",
  structure: (string | string[])[],  // REQUIRED: organizer template that MUST include blanks like "_____" or ""
  requiredBlankCount?: number
}

IMPORTANT:
- items[] must include at least 4 entries.
- config.structure MUST include blank slots (e.g., "_____" or "") so students have spaces to fill.
`,

  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "mind-mapper".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Create a graphic organizer / mind map structure with 1 central topic, 3–5 branches, and 2–4 sub-branches each. Include blank slots (_____ or empty strings) for students to fill.
    - The items[] array must contain real subject-matter vocabulary/concepts from the topic -- these are the idea-bank words students drag into the blanks.

    CRITICAL -- NO PLACEHOLDER TEXT:
    - NEVER write "Concept 1", "Concept 2", "Branch 1", "Item 1", "Sub-branch 1", or any numbered filler.
    - Every item in items[] MUST be a real vocabulary word, name, or concept drawn from the subject and topic.
    - config.centralTopic MUST be the actual topic name (e.g., "The Water Cycle", "World War I Causes"), never "Central Topic".
    - config.structure entries must describe real branches/sub-branches (e.g., "Evaporation", "Condensation"), never "Branch 1" or "Sub-branch A".
    - Bad example items: ["Concept 1", "Concept 2", "Concept 3"]
    - Good example items: ["evaporation", "condensation", "precipitation", "runoff", "transpiration"]

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},
  [TASK_TYPES.NARRATION_SYNTHESIZE]: {
    label: "Narration Synthesize",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    noAutoScoring: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 60,
    estimatedMinutes: 2,
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
    
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "narration-synthesize".

    WHAT THIS TASK ACTUALLY IS (read this carefully):
    Turn-based ORAL teach-back. Each player on the team gets ONE concept
    from today's lesson; they speak for ~30 seconds explaining their
    concept in their own words while teammates rate them. This is NOT
    a written synthesis task. There are NO "source bullets". The student
    NEVER reads a passage and summarises it — they just TEACH their
    concept aloud.

    Hard requirements:
    - Output ONLY a single JSON object (no markdown).
    - Required root fields: taskType, title (3-7 words), prompt.

    REQUIRED config fields:
    - config.playerCount: integer 2-6 (default 4). Match this to the
      typical small-group size.
    - config.prompts: ARRAY of OBJECTS, length EXACTLY === playerCount.
      Each element MUST be { id: "p1", concept: "Short concept name", prompt: "Speak for ~30s. Explain X. Include …" }.
      The renderer reads {id, concept, prompt} per object — strings or
      arrays without these keys show as "Concept 1/2/3" placeholders.
    - Optional config.perTurnSeconds: integer (default 30, 0 disables).
    - Optional config.ratingScale: { min: 1, max: 5 }.

    DO NOT EMIT:
    - sourceBullets, sourcePassage, passages, sources — the renderer
      ignores these and the activity is oral, not text-comprehension.
    - prompts as a string or as a single-item array.

    Worked example for Grade 7 Photosynthesis, playerCount 4:
    {
      "taskType": "narration-synthesize",
      "title": "Teach Photosynthesis",
      "prompt": "Each teammate teaches one part of photosynthesis aloud. Listeners rate clarity.",
      "config": {
        "playerCount": 4,
        "perTurnSeconds": 30,
        "ratingScale": { "min": 1, "max": 5 },
        "prompts": [
          { "id": "p1", "concept": "Chloroplast",        "prompt": "Speak for ~30s. Where does photosynthesis happen and what makes that organelle special? Use 'chlorophyll' in your answer." },
          { "id": "p2", "concept": "Light reactions",    "prompt": "Speak for ~30s. What do plants DO with sunlight in the first stage? Mention oxygen and ATP." },
          { "id": "p3", "concept": "Calvin cycle",       "prompt": "Speak for ~30s. How do plants make glucose from CO₂? Don't worry about every step — just the big idea." },
          { "id": "p4", "concept": "Whole-system view",  "prompt": "Speak for ~30s. Why does photosynthesis matter for the rest of the food chain?" }
        ]
      }
    }
    `,
},

  [TASK_TYPES.ROLE_PLAY_DECK]: {
    label: "Role Play Deck",
    category: CATEGORY.COLLABORATION,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 300,
    estimatedMinutes: 7,
    isOffTablet: true,
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
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "role-play-deck".

    SCHEMA — must match exactly:
    {
      "taskType": "role-play-deck",
      "title": "string (3-7 words)",
      "prompt": "1-2 sentence student instruction",
      "config": {
        "scenario": "2-4 sentences describing the situation students will role-play",
        "roles": [
          {
            "name": "Specific character name (Sir Isaac Brock / Pythagoras / Ada the Algebra Apprentice)",
            "role": "One-line description of who they are and why they are in the scenario",
            "characteristics": ["short trait", "short trait", "short trait"],
            "gender": "male" | "female" | "nonbinary"
          },
          ...at least 3 roles
        ]
      }
    }

    HARD REQUIREMENTS — every role MUST have:
    1. name — a specific CHARACTER NAME. NEVER "Role A", "Role 1", "Character 1".
    2. role — distinct from name; describes their function (one short line).
    3. characteristics — array of 3-5 short adjective traits.
    4. gender — one of "male" | "female" | "nonbinary". The renderer uses
       this for the avatar; without it the role card shows a generic icon.

    Scenario should invite perspective-taking and classroom discussion,
    tied to the subject/topic.

    BAD: { name: "Role A", role: "Explain your perspective" }
    GOOD: {
      name: "Sir Isaac Brock",
      role: "British general defending Upper Canada from American invasion",
      characteristics: ["decisive", "loyal", "tactical"],
      gender: "male"
    }
    `,
},

  [TASK_TYPES.SCRIPT_PLAY]: {
    label: "Script Play",
    category: CATEGORY.SYNTHESIS,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 300,
    estimatedMinutes: 8,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "AI-generated Script Play: a structured performance task. The device shows the CURRENT speaker's line in large text, plus optional tone cues (e.g., serious, excited) and stage directions (e.g., whispering, pointing). It also shows brief context lines for 'just before' and 'up next' so the team understands the story flow. Students PASS the device from speaker to speaker and read/act their lines. Intra-team only (no inter-team). Pedagogical benefits: reading fluency, expressive oral language, comprehension, narrative reasoning, collaboration, and deeper retention through performance.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "script-play".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, setting, roles, lines.
    - "setting" is a short paragraph (2–3 sentences) that sets the scene and introduces the characters. This is read aloud before the script starts. It should also tell the team which member plays which role (e.g. "Team member 1, you are Ava. Team member 2, you are Noah.").
    - "roles" is an array of the character names used in the script (e.g. ["Narrator", "Ava", "Noah"]).
    - "lines" MUST be a flat array of 8–16 strings in "Speaker: dialogue" format.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Write a short script for 2–4 speakers that teaches the assigned vocabulary/concepts through a meaningful story or scenario.
    - The script should directly incorporate the topic and vocabulary -- characters should discuss, explain, or demonstrate the concepts through dialogue.
    - Include light stage directions in parentheses within lines, e.g. "Ava: (whispering) Look at this old map..."
    - The script must tell a coherent mini-story with a beginning, middle, and end.

    Example output:
    {
      "taskType": "script-play",
      "title": "The Discovery at the River",
      "prompt": "Pass the device speaker-to-speaker. Read your lines with expression!",
      "setting": "Two young scientists, Ava and Noah, are investigating why their local river looks different this year. A narrator guides the story. Team member 1, you are the Narrator. Team member 2, you are Ava. Team member 3, you are Noah.",
      "roles": ["Narrator", "Ava", "Noah"],
      "lines": [
        "Narrator: The students gathered by the riverbank on a cool morning.",
        "Ava: (pointing) Look -- the water level is much lower than last year.",
        "Noah: That's because of the drought. Less rainfall means less water flow.",
        "Ava: But what about the fish? They need deeper water to survive.",
        "Narrator: Noah knelt down and examined the muddy bank.",
        "Noah: (serious) See these marks? The river used to come up to here.",
        "Ava: So the ecosystem is already changing. We should document this.",
        "Narrator: They took photos and notes, determined to share their findings."
      ]
    }

    Common failure prevention:
    - "lines" must be a FLAT array of strings -- NOT nested objects, NOT beats.
    - Minimum 8 lines. Each line must be a non-empty string.
    - "setting" must be a non-empty string that introduces characters and assigns roles to team members.
    - Ensure the script is meaningful and relevant to the assigned topic/vocabulary.
    `,
},

  [TASK_TYPES.DRAW_MIME]: {
    label: "Draw or Mime",
    category: "creative",
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    isOffTablet: true,
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      Team non-verbal representation challenge: draw OR mime a concept while teammates guess.

      AI MUST output:
      - taskType: "draw-mime"
      - title
      - prompt: the concept to represent (word/short phrase)
      Optional:
      - timeLimitSeconds: usually 60

      Gameplay:
      - "1-2-3 GO" starts the timer.
      - Teammates guess; UI can mark who guessed (name buttons).
      Scoring:
      - Usually participation/round-based (not objective).

      Constraints:
      - Concepts must be drawable/actable and classroom-appropriate.

      Benefits: multi-modal encoding, kinesthetic learning, vocabulary reinforcement, collaboration.
          `,

    demoPrompt: "Choose ONE: draw it or mime it (no words). Start the 60-second timer on GO, then your team guesses.",
        
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "draw-mime".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt, clues.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - This task has UP TO 4 ROUNDS -- one per player. Each player will secretly choose to either DRAW or MIME their clue.
    - Generate EXACTLY 4 unique clues, one per round, in the "clues" array.
    - Each clue must be a single word or very short phrase (≤ 5 words) that can be drawn OR mimed without speaking.
    - All 4 clues should relate to the subject/topic of the taskset.
    - Good examples: "gravity", "photosynthesis", "forgiveness", "Abraham Lincoln", "water cycle"
    - Set task.prompt to clues[0] (the first clue) for backward compatibility.
    - Optionally set timeLimitSeconds to 60.

    CRITICAL -- clues must NEVER:
    - Be sort instructions, category lists, or multi-step instructions
    - Start with "Sort", "Arrange", "Match", "Categorize"
    - Contain quoted lists of items or definitions
    - Each clue must stand alone as a drawable/actable concept

    Output format example:
    {
      "taskType": "draw-mime",
      "title": "Draw or Mime: Key Concepts",
      "prompt": "photosynthesis",
      "clues": ["photosynthesis", "gravity", "water cycle", "food chain"],
      "timeLimitSeconds": 60
    }
    `,
},

  [TASK_TYPES.DRAW]: {
    label: "Draw",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 240,
    estimatedMinutes: 6,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drawing response task. Students draw a diagram or concept representation. Often used with teacher review or photo submission in other tasks.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "draw".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - A Draw task asks students to draw ONE thing. Do NOT write a long, multi-part
      prompt that lists many concepts (e.g. "Draw and label diagrams: 1. … 2. … 8. …").
      That is wrong — students can only draw one subject.
    - "prompt": a SHORT one-line instruction (e.g. "Draw and label this concept.").
    - "clues": a top-level array of 3–6 SHORT single subjects to draw, each tied to the
      ONE assigned concept (e.g. ["a proper fraction as a shaded circle", "1/2 + 1/4 on a
      number line", "equivalent fractions with fraction strips"]). One thing per clue.

    Common failure prevention:
    - The prompt must be ONE short instruction (under ~120 characters), never a numbered list.
    - Provide the "clues" array; do not bury subjects inside the prompt text.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.MIME]: {
    label: "Mime",
    category: CATEGORY.CREATIVE,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    maxTimeSeconds: 180,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Charades-style acting response. Students act out a concept without words. Great for vocabulary and concept visualization through movement.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "mime".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Focus on the ONE concept you are given. Create 3–6 short mime clues (single words or 1–5 word phrases) that all relate to that concept. Each must be actable without props and classroom-appropriate.
    - Put the clues in a top-level "clues" array of strings. Example: "clues": ["photosynthesis", "sunlight", "leaf", "growing plant"]
    - Do NOT use config.rounds, config.statements, or config.items -- use "clues" at the root level.
    - Do NOT cram in unrelated vocabulary — a mime station is for acting out ONE idea from a few angles, not a whole word list.

    Common failure prevention:
    - Do not omit the "clues" array -- it is required.
    - Keep it to 3–6 clues. Each clue must be a single word or short phrase to act out (not a sentence or instruction).
    `,
},

  [TASK_TYPES.ECHO_CHAIN]: {
    label: "Echo Chain",
    category: CATEGORY.RECALL,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 0,
    estimatedMinutes: 4,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: `
Oral memory-chain game. AI starts with a subject-related concept (e.g., "photosynthesis").
Players take turns (1–4) repeating the full chain aloud and adding one related word/phrase.

How it works:
• StartWord: AI-generated (config.startWord)
• Turn: Player repeats chain out loud + adds one (they type ONLY the new word)
• Continue around the group until the chain reaches the minimum length.
• Minimum: config.minChainLength (MUST be >= 5)

AI generation / schema hints (for aiTaskSetGenerator):
taskType: "echo-chain"
title: short (3–7 words)
prompt: concise (UI handles most)
config: {
  startWord: string,
  minChainLength: number,   // >= 5
  perTurnSeconds?: number   // optional, e.g., 10
}

`,
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "echo-chain".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.

    Task-specific guidance:
    - This is an oral memory-chain game. The AI provides ONE seed word/concept.
    - Players take turns repeating the full chain aloud, then adding one related word.
    - config.seedTerm: a single vocabulary word or concept from the topic (the chain starter).
    - config.minChainLength: minimum chain length to reach (default 5).

    REQUIRED STRUCTURE:
    {
      "taskType": "echo-chain",
      "title": "Echo Chain: Early Canada",
      "prompt": "Repeat the chain aloud, then add one related word!",
      "config": {
        "seedTerm": "fur trade",
        "minChainLength": 5
      }
    }

    Common failure prevention:
    - config.seedTerm MUST be a single real vocabulary word or short phrase from the topic.
    - NEVER use "startWord" -- the field name is "seedTerm".
    `,
},

  [TASK_TYPES.PRONUNCIATION]: {
    label: "Pronunciation Practice",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    languageOnly: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 90,
    estimatedMinutes: 2,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Pronunciation Practice. Students speak a prompted word/phrase and receive AI-based pronunciation feedback (optionally comparing to a target accent).",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"pronunciation\"",
        "title: short (3–7 words)",
        "prompt: short instruction (optional)",
        "timeLimitSeconds: 45–90",
        "referenceText: string  // what the student should say",
        "phonetic?: string       // optional guide (IPA-ish or simple syllable hint)",
        "language?: string       // e.g., \"English\" (display label) and/or languageCode below",
        "languageCode?: string   // e.g., \"en-US\" (optional; used by scoring/transcription pipelines)",
        "accentOptions?: string[]  // e.g., [\"american\",\"canadian\",\"british\",\"australian\",\"neutral\"]",
        "targetAccent?: string     // default selected accent (one of accentOptions)",
        "",
        "Pedagogical benefits: phonetic accuracy, language acquisition, speaking confidence, and measurable progress over time.",
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "pronunciation".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 10–16 pronunciation items: each includes a word/phrase and a simple phonetic hint. Focus on clarity and common errors.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.SPEECH_RECOGNITION]: {
    label: "Speech Recognition Answer",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    languageOnly: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 90,
    estimatedMinutes: 2,
    isOffTablet: true,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      [
        "Speech Recognition Answer (oral Open Text). A student speaks an answer; the system transcribes it and AI-scores for meaning/accuracy.",
        "",
        "Suggested flow: 1‑2‑3 Go! then speak for ~60s (timer encourages turn-taking).",
        "",
        "AI generation / schema hints (for aiTaskSetGenerator):",
        "taskType: \"speech-recognition\"",
        "title: short (3–7 words)",
        "prompt: the question/instruction the student should answer",
        "timeLimitSeconds: 45–90 (default 60)",
        "referenceText?: string  // optional reading-aloud text (if task is 'read this aloud' instead of 'answer this')",
        "language?: string       // UI label (e.g., \"English\")",
        "languageCode?: string   // e.g., \"en-US\" (preferred for browser recognition)",
        "rubric?: { focus?: string, points?: number } // optional scoring guidance",
        "",
        "Pedagogical benefits: oral response practice, accessibility, confidence building, and language development.",
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "speech-recognition".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - The prompt should be a question or instruction for the student to answer aloud.
    - Set "referenceText" to the expected spoken answer or reading-aloud passage (a sentence or short paragraph, 10–40 words).
    - The system will transcribe the student's speech and AI-score it against the referenceText for meaning and accuracy.
    - Do NOT generate a "phrases" or "variations" array -- the component only uses referenceText.

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    - MUST include referenceText as a root-level string field.
    `,
},

  // =========================
  // COMIC RELIEF / NO-SCORE
  // =========================

  // =========================
  // TRIVIA -- Bluff Catcher / True-False / Closer To
  // =========================
  [TASK_TYPES.TRIVIA]: {
    label: "Trivia",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 120,
    estimatedMinutes: 2,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    isOffTablet: false,
    description:
      "Fun trivia break with three presentation modes. Bluff Catcher: 3 statements shown, 2 real and 1 fake -- spot the bluff. True/False: rapid-fire fact statement. Closer To: estimation question with 2 choices. Each round has a subject-related fact and a pop culture / student-world fact.\n\nAI MUST output:\n- taskType: \"trivia\"\n- title, prompt\n- config.rounds: array of 2-4 round objects (mix modes)\n- Each round: { mode, category, ...mode-specific fields }\n- Modes: \"bluff\" needs facts[] (3 strings) + fakeIndex + explanation. \"truefalse\" needs statement + answer (bool) + explanation. \"closerto\" needs question + choices[] (2 strings) + correctChoice (0|1) + actualAnswer + explanation.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "trivia".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - config.rounds must be an array of 2-4 round objects.
    - Mix at least 2 different modes across the rounds.
    - Include at least one "subject" round related to the lesson topic and one "pop" round about sports, pop culture, movies, music, or student life.

    Round modes:

    1) "bluff" (Bluff Catcher):
       { mode: "bluff", category: "subject"|"pop", facts: ["fact1", "fact2", "fact3"], fakeIndex: 0|1|2, explanation: "why the fake one is wrong" }
       - Exactly 3 facts. Two must be true, one must be plausible but fake.
       - fakeIndex is the 0-based index of the fake fact.

    2) "truefalse" (True/False):
       { mode: "truefalse", category: "subject"|"pop", statement: "...", answer: true|false, explanation: "the real fact" }
       - Statement should be plausible either way.

    3) "closerto" (Closer To / Estimation):
       { mode: "closerto", category: "subject"|"pop", question: "How many...?", choices: ["150", "300"], correctChoice: 0|1, actualAnswer: "206", explanation: "..." }
       - Two numeric-ish choices. One must be closer to the real answer.

    Example output:
    {
      "taskType": "trivia",
      "title": "Quick Trivia Break",
      "prompt": "Test your knowledge with some fun facts!",
      "points": 0,
      "config": {
        "rounds": [
          {
            "mode": "bluff",
            "category": "subject",
            "facts": [
              "The human body has 206 bones",
              "Your stomach acid can dissolve metal",
              "The average person has 4 kidneys"
            ],
            "fakeIndex": 2,
            "explanation": "Humans have 2 kidneys, not 4!"
          },
          {
            "mode": "truefalse",
            "category": "pop",
            "statement": "The first video game ever made was Pong",
            "answer": false,
            "explanation": "Tennis for Two (1958) came before Pong (1972)."
          }
        ]
      }
    }

    Common failure prevention:
    - fakeIndex must be a valid index (0, 1, or 2) into the facts array.
    - answer for truefalse must be a boolean (true or false), not a string.
    - correctChoice for closerto must be 0 or 1.
    - Make pop culture references age-appropriate and current.
    - Keep explanations to 1-2 sentences.
    `,
  },

  // =========================
  // SPINNER -- Wheel of Fortune reward spinner
  // =========================
  [TASK_TYPES.SPINNER]: {
    label: "Spinner",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 30,
    estimatedMinutes: 0.5,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    isOffTablet: false,
    description:
      "Wheel of Fortune style reward spinner. Students spin a colorful wheel and land on a random reward wedge. Wedges include bonus points, fun perks (\"Team High Five!\", \"Pick the next song\"), and a rare jackpot. Pure fun -- builds anticipation and energy between heavier tasks.\n\nAI MUST output:\n- taskType: \"spinner\"\n- title, prompt\n- config.spinPrompt: fun text shown before spinning\n- config.wedges: array of 6-10 wedge objects\n- Each wedge: { label, points, type: \"points\"|\"bonus\"|\"perk\"|\"jackpot\" }",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "spinner".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - config.spinPrompt: a fun, encouraging line shown before the spin.
    - config.wedges: array of 6-10 wedge objects.

    Wedge types:
    - "points": bonus points for the team. Label like "+50 pts", "+100 pts", "+200 pts"
    - "bonus": special bonus like "Double Next!" or "Free Pass"
    - "perk": fun reward like "Team High Five!", "Pick the next song", "Silly dance break"
    - "jackpot": rare big reward. Only 1 jackpot wedge. Label like "JACKPOT +500!"

    Rules:
    - Most wedges should be "points" type (4-6 of them).
    - Include 1-2 "perk" wedges with fun classroom rewards.
    - Include exactly 1 "jackpot" wedge with high points (400-500).
    - Optionally include 1 "bonus" wedge.
    - Point values should vary: mix of 50, 100, 150, 200.
    - Keep labels short (fits on a wheel wedge).
    - Make perks fun and classroom-appropriate.

    Example output:
    {
      "taskType": "spinner",
      "title": "Bonus Spin!",
      "prompt": "Your team earned a spin! Let's see what you win!",
      "points": 0,
      "config": {
        "spinPrompt": "Give it a spin and see what fortune brings!",
        "wedges": [
          { "label": "+50 pts", "points": 50, "type": "points" },
          { "label": "+100 pts", "points": 100, "type": "points" },
          { "label": "Team High Five!", "points": 50, "type": "perk" },
          { "label": "+200 pts", "points": 200, "type": "points" },
          { "label": "Double Next!", "points": 0, "type": "bonus" },
          { "label": "+150 pts", "points": 150, "type": "points" },
          { "label": "Silly Dance!", "points": 75, "type": "perk" },
          { "label": "JACKPOT +500!", "points": 500, "type": "jackpot" }
        ]
      }
    }
    `,
  },

  [TASK_TYPES.RIDDLE]: {
    label: "Riddle",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: true,   // not user-selectable; injected via teacher profile toggle
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "none",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 60,
    estimatedMinutes: 1,
    interTeamEnabled: false,
    intraTeamEnabled: false,
    isOffTablet: false,
    description:
      "A quick comic-relief task. The AI generates a fun riddle related to the topic. Students read the riddle, try to guess, then tap to reveal the answer. No scoring, no input -- just a lighthearted breather between heavier tasks. Keeps energy up and gives a mental reset.\n\nAI MUST output:\n- taskType: \"riddle\"\n- title (short, fun)\n- prompt (the riddle question itself)\n- config.riddle (the riddle text, same as or elaboration of prompt)\n- config.answer (the punchline / answer)\n- config.hint (optional one-line hint)",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "riddle".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - The riddle should be clever, fun, and loosely related to the lesson topic.
    - Keep it age-appropriate and classroom-safe. Puns encouraged!

    Required config fields:
    - config.riddle  -- the riddle question (string). Can be same as prompt or more elaborate.
    - config.answer  -- the answer / punchline (string). Keep it short and satisfying.
    - config.hint    -- a one-line hint (string, optional but encouraged).

    Example output:
    {
      "taskType": "riddle",
      "title": "Brain Teaser Break",
      "prompt": "I have cities but no houses, forests but no trees, and water but no fish. What am I?",
      "points": 0,
      "config": {
        "riddle": "I have cities but no houses, forests but no trees, and water but no fish. What am I?",
        "answer": "A map!",
        "hint": "You might find me folded in a glove compartment."
      }
    }

    Common failure prevention:
    - Do not include scoring fields -- this is a zero-point comic relief task.
    - Keep the riddle to 1-3 sentences max.
    - The answer should be a single short phrase or word.
    `,
  },

  [TASK_TYPES.WHAT_AM_I]: {
    label: "What Am I?",
    category: CATEGORY.DEDUCTION,
    implemented: true,            // renderer wired in commit #2; server-authoritative reveal is commit #4
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",     // matched by keyword/fuzzy answer matcher
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 120,
    estimatedMinutes: 4,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "A deduction game. Students see 'What am I?' and a single vague clue. They can submit an answer immediately for maximum points, or tap 'Reveal Clue' to unlock progressively more specific clues -- with each reveal lowering the point ceiling. The clue progression must reinforce REAL UNDERSTANDING of the concept, not shallow definitions. Modes: solo, intra-team, inter-team (race). MVP supports solo + intra-team + inter-team.\n\nAI MUST output:\n- taskType: \"what-am-i\"\n- title (short, fun)\n- prompt (1-2 sentence student-facing instructions)\n- config.answer (the canonical answer)\n- config.acceptableAnswers (array of 2-4 variant phrasings)\n- config.clues (array of 3-6 clues, each { level, text }, ordered broad -> precise)\n- config.difficulty (\"easy\" | \"medium\" | \"hard\" | \"expert\")\n- config.mode (default \"intra-team\")\n- config.scoring (optional override of point curve)\n\nClue progression rules:\n- Clue 1 MUST be broad and conceptual (purpose/effect/identity), NOT a definition.\n- Clue 1 must NOT contain the answer or an obvious near-synonym.\n- Final clue may be near-giveaway but still not state the answer verbatim.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "what-am-i".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Required config fields:
    - config.answer            -- the canonical name of the concept (string)
    - config.acceptableAnswers -- 2-4 variant phrasings (array of strings, lowercased OK)
    - config.clues             -- array of 3-6 clues, each: { "level": 1..N, "text": "..." }
    - config.difficulty        -- "easy" | "medium" | "hard" | "expert"
    - config.mode              -- "solo" | "intra-team" | "inter-team" (default "intra-team")

    Optional:
    - config.scoring.perClueCurve -- override the point decay (array of numbers, length = clues.length + 1)

    CRITICAL CLUE RULES (this is the heart of the task):
    - Clue 1 MUST be CONCEPTUAL / EFFECT-BASED. Focus on what the thing DOES, IMPACTS, or MEANS.
      BAD:  "I am a report written by Lord Durham."           (dictionary entry)
      GOOD: "My recommendations helped shape responsible government in Canada."   (effect-based)
    - NO clue may contain the answer string (or close synonyms like "Durham" if the answer is "Lord Durham's Report").
    - Progress broad -> precise: each clue narrows the field.
    - Final clue (the most specific) may name a closely associated thing but never the answer.
    - For history: prefer IMPACT over dates and names.
    - For science: prefer MECHANISM and FUNCTION over taxonomy.
    - For Bible: prefer ACTIONS and RELATIONSHIPS over genealogy.
    - For math: prefer USE-CASE over formula.

    Example output:
    {
      "taskType": "what-am-i",
      "title": "What Am I? — A Pivotal Report",
      "prompt": "I am a historical document. Figure out who I am — guess earlier for more points.",
      "config": {
        "answer": "Lord Durham's Report",
        "acceptableAnswers": ["durham report", "lord durham report", "the durham report"],
        "clues": [
          { "level": 1, "text": "My recommendations helped shape responsible government in Canada." },
          { "level": 2, "text": "I was written after rebellions in two colonies." },
          { "level": 3, "text": "I am attributed to a British nobleman sent on a fact-finding mission in 1838." },
          { "level": 4, "text": "My author's name shares its origin with a city in northern England." }
        ],
        "difficulty": "medium",
        "mode": "intra-team"
      }
    }

    Common failure prevention:
    - clues must have AT LEAST 3 entries; AT MOST 6.
    - clues[i].level must be 1..clues.length, in order.
    - acceptableAnswers must have AT LEAST 2 entries.
    - Do NOT write dictionary-style definitions ("X is a Y that does Z"). Clues should require INFERENCE.
    `,
  },

  [TASK_TYPES.CAREERS]: {
    label: "Careers",
    category: CATEGORY.SYNTHESIS,
    implemented: true,                   // unified renderer covers all 6 modes; AI scorer + per-mode polish are v2
    demoEligible: false,
    demoSelectable: false,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "ai",                   // justifications scored by Haiku-class model
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 600,
    estimatedMinutes: 8,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Career exploration task for Grades 6-12. SIX modes (carried in config.mode):\n  • best-fit — team decides which teammate fits a generated career\n  • pathway-builder — compare apprenticeship vs college vs entrepreneurship etc.\n  • aptitude-match — short interest prompts → AI suggests careers (non-deterministic)\n  • salary-vs-lifestyle — debate dilemmas\n  • who-should-be-hired — pick from generated candidates\n  • career-myths — guess vs reveal\n\nNon-deterministic framing throughout: 'You might enjoy…', never 'You will be…'. Anti-prestige-bias guardrails. Anti-bullying rules on best-fit picks (private, no negative-vote mode). See CAREERS_TASK_PLAN.md.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "careers".

    HARD REQUIREMENTS — every careers task:
    - Output ONLY a single JSON object (no markdown).
    - REQUIRED root fields: taskType, title (3-7 words), prompt (1-2 sentences, student-facing).
    - REQUIRED config.mode from: best-fit | pathway-builder | aptitude-match | salary-vs-lifestyle | who-should-be-hired | career-myths.
    - Use non-deterministic framing — never imply a career is destiny ("You might enjoy…", never "You will be…").
    - Salary information must always be a RANGE, never a single dollar number.
    - Rotate career categories to avoid prestige bias (mix trades / service / creative / technical / etc.).
    - Avoid candidates / careers that pattern-match a single stereotype.

    PER-MODE SHAPE — pick ONE mode and include the matching fields:

    1. mode: "best-fit"
       config.career: { name: string, description: string (1-2 sentences) }
       Example: { mode: "best-fit", career: { name: "Welder", description: "Joins metal pieces for structures, ships, and pipelines." } }

    2. mode: "pathway-builder"
       config.pathways: array of ≥ 2 pathway objects, each { label: string, description: string }
       Compare e.g. apprenticeship vs college vs entrepreneurship.

    3. mode: "aptitude-match"
       config.prompts: array of ≥ 1 interest-check prompt strings.

    4. mode: "salary-vs-lifestyle"
       config.optionA: { title: string, description: string }  (e.g. "High-paying but long hours")
       config.optionB: { title: string, description: string }  (e.g. "Lower pay but flexible schedule")
       BOTH optionA AND optionB are MANDATORY — omitting either = task REJECTED.

    5. mode: "who-should-be-hired"
       config.candidates: array of ≥ 2 candidate objects, each { name, background, strengths[] }

    6. mode: "career-myths"
       config.questions: array of ≥ 1 myth-vs-fact items, each { myth: string, fact: string }

    COMMON FAILURES TO PREVENT:
    - Missing title (task root) — REJECTED.
    - salary-vs-lifestyle missing optionA or optionB — REJECTED.
    - Single salary number instead of a range.
    - Mode field missing or misspelled.
    `,
  },

  [TASK_TYPES.HOLE_IN_ONE]: {
    label: "Hole in One",
    category: CATEGORY.COMPETITIVE,
    implemented: true,                   // MVP: pre-placed rails + tilt-only loop. Earn/Build phases land in v2.
    demoEligible: false,
    demoSelectable: false,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 900,
    estimatedMinutes: 10,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Tilt-physics mini-game. Teams answer curriculum questions to earn rails/balls/bumpers, then place them on a board and tilt the device to roll a ball into a hole. A 'tilter' is rotated between teammates to encourage participation. See HOLE_IN_ONE_PLAN.md.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "hole-in-one".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown).
    - Required root fields: taskType, title (3-7 words tied to the topic), prompt.

    REQUIRED config.board:
    - width: integer 8-16 (default 10).
    - height: integer 10-20 (default 14).
    - gridSize: integer 20-40 (default 26 px/cell — affects ball physics).
    - startPosition: { x: int 0..width-1, y: int 0..height-1 } — top-left zone, e.g. {x:1, y:1}.
    - holePosition: { x: int 0..width-1, y: int 0..height-1 } — bottom-right zone, e.g. {x: width-2, y: height-2}.
      MUST differ from startPosition by at least 4 cells in BOTH x and y.
    - obstacles: array of 0-4 pre-placed rails as { type, x, y, orientation? }.
      type ∈ {"wall","ramp"}, orientation ∈ {"h","v"} when relevant.
      The board MUST be solvable WITHOUT any extra rails purchased (so a team
      that earns zero coins can still tilt the ball home).

    REQUIRED config.questionBank: array of 4-8 curriculum questions.
    Each question: { id: "q1", prompt: "string", correctAnswer: "string", reward: { coins: 1-3 } }.
    The prompt MUST name the unit topic — no generic "Solve the problem".
    Mix question types (recall + apply + analyze). Vary reward values.
    IMPORTANT: reward MUST be an OBJECT { coins: N } — a plain number
    (reward: 1) is silently dropped by the renderer (audit-2 #3).

    Optional config.economy: { straightRailCost:3, curvedRailCost:5, bumperCost:4 }.
    Optional config.scoring: { successPoints:10, playPoints:1 }.

    THEME the board to the lesson — the framing must be ABOUT the topic,
    not borrowed from a different field. Audit-2 #3: a Photosynthesis
    set picked an "electron through circuit" theme, which is electricity,
    not biology, and confused students about what photosynthesis even is.
    - History (War of 1812 / Civil War / etc.): cannonball-to-fort,
      ship-to-harbor, soldier-to-objective — themes from THAT war.
    - Photosynthesis specifically: sunbeam-to-leaf, water-droplet-to-roots,
      CO₂-molecule-to-chloroplast — themes from the actual process.
    - Other science: water-droplet-through-cloud (for water cycle),
      seed-into-soil (for plant growth), photon-to-leaf (for photosynthesis).
    - Math: solving a maze of operations where the hole is the answer cell.
    - English: word-quest-to-destination, character-finds-resolution.
    Rule: the title and prompt must NAME the unit topic. If you can't
    explain to a student why your chosen theme connects to the topic,
    PICK A DIFFERENT THEME.

    Worked example for Grade 7 War of 1812:
    {
      "taskType": "hole-in-one",
      "title": "Cannonball to Fort McHenry",
      "prompt": "Answer questions about the War of 1812 to earn rails, then tilt your cannonball into Fort McHenry!",
      "config": {
        "board": {
          "width": 10, "height": 14, "gridSize": 26,
          "startPosition": { "x": 1, "y": 1 },
          "holePosition":  { "x": 8, "y": 12 },
          "obstacles": []
        },
        "questionBank": [
          { "id":"q1", "prompt":"Which country was the British Empire's main rival on the high seas in 1812?", "correctAnswer":"France", "reward":1 },
          { "id":"q2", "prompt":"What was the name of the song inspired by the bombardment of Fort McHenry?", "correctAnswer":"The Star-Spangled Banner", "reward":2 },
          { "id":"q3", "prompt":"Who was the British general killed at Queenston Heights?", "correctAnswer":"Sir Isaac Brock", "reward":2 },
          { "id":"q4", "prompt":"In what year did the Treaty of Ghent end the War of 1812?", "correctAnswer":"1814", "reward":1 }
        ]
      }
    }
    `,
  },

  [TASK_TYPES.CURRENT_EVENTS]: {
    label: "Current Events Connection",
    category: CATEGORY.SYNTHESIS,
    implemented: true,                   // resolver + renderer live; teacher refresh / evergreen library are v2
    demoEligible: false,
    demoSelectable: false,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "ai",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: true,
    maxTimeSeconds: 900,
    estimatedMinutes: 12,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Connects today's news to the lesson topic. UNIQUE: the persistent stored task is only a SHELL (lesson topic, grade, region, worldview profile). Real content is resolved at session-launch time via WebSearch, filtered for safety + publisher exclusion list, and AI-generated into a full discussion task. Worldview profile shapes the framing (Christian / secular / general) but NOT the event topic. See CURRENT_EVENTS_PLAN.md.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "current-events".

    This is a SHELL task — store ONLY the inputs needed to resolve at runtime:
    - config.lessonTopic (string, from teacher)
    - config.subject (string)
    - config.gradeLevel (number)
    - config.region (string, defaults to teacher's country)
    - config.worldviewProfile ("general" | "secular" | "christian", defaults from teacher profile)
    - config.preferredCategories (array, defaults to ["science","environment","education","archaeology","space","health","cultural"])

    Do NOT generate eventSummary, discussionQuestions, etc. — those are filled in by the resolver pipeline at session launch.
    The prompt field should say "Loading today's story…" or similar placeholder.
    `,
  },

  [TASK_TYPES.LEGENDS]: {
    label: "Legends",
    category: CATEGORY.DEDUCTION,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: true,
    aiScoringDefaultOn: false,
    scoringMode: "objective",
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 240,
    estimatedMinutes: 5,
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "A 5W deduction game. The team sees a portrait of a legendary figure (no name) plus 10 facts in random order. Through 4 phases, they sort the facts: 2 that answer WHAT (what is she famous for / what did she do), 2 that answer WHERE, 2 that answer WHY (what need / motivation), 1 that answers WHEN. The remaining 3 are decoys — facts that LOOK plausible but don't fit any 5W question. After all sorting is done, the figure's name is revealed.\n\nGreat for history, science, Bible studies, literature (legendary characters), and any domain with named giants.\n\nAI MUST output:\n- taskType: \"legends\"\n- title (e.g. 'Legends — Famous Scientist')\n- prompt (1-2 sentence student-facing instructions)\n- config.figure: { name, portraitUrl, era, summary }\n- config.facts: array of EXACTLY 10 facts, each: { id, text, category: 'what'|'where'|'why'|'when'|'decoy' }\n\nFact distribution: 2 WHAT, 2 WHERE, 2 WHY, 1 WHEN, 3 DECOY (total 10).\n\nIMPORTANT: decoy facts should be plausibly about an adjacent legendary figure (same era, related field), or too vague to answer a specific 5W question. Never name the legend directly.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "legends".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Pick a legendary figure relevant to the lesson topic (historical, scientific, biblical, literary).
    - Include EXACTLY 10 facts split as: 2 WHAT, 2 WHERE, 2 WHY, 1 WHEN, 3 DECOY.

    Required config fields:
    - config.figure.name        -- the legendary figure's full name (e.g. "Marie Curie")
    - config.figure.gender      -- "male" or "female" (the figure's documented birth sex; used for he/she pronouns)
    - config.figure.portraitUrl -- a permanent, public-domain portrait URL (Wikipedia / Wikimedia Commons preferred)
    - config.figure.era         -- short era label (e.g. "Late 1800s - early 1900s")
    - config.figure.summary     -- 1-2 sentence summary shown after the reveal
    - config.facts              -- array of EXACTLY 10 fact objects, each with: { id, text, category }
                                   where category is one of: "what", "where", "why", "when", "decoy"

    Category distribution rules:
    - 2 facts with category="what"   (what she did / is famous for)
    - 2 facts with category="where"  (where she lived / worked)
    - 2 facts with category="why"    (why she did it / the need or motivation)
    - 1 fact  with category="when"   (when she lived / did the work)
    - 3 facts with category="decoy"  (plausible-looking but don't fit any 5W; could be about an adjacent figure)

    CRITICAL RULES:
    - NO fact may name the legend directly (would make sorting trivial).
    - DECOY TRUTH RULE — every decoy fact MUST be FALSE about THIS figure.
      Re-verify each decoy against the figure's biography. If a decoy
      happens to also be true about the legend (e.g. "Won a Nobel
      Prize" as a decoy for Marie Curie), the sorting is broken: the
      student keys WHAT facts to "won Nobel" and the decoy gets put
      there too. Prefer decoys that would be TRUE of an adjacent figure
      in the same era / field but FALSE of this one.
    - Decoy facts should be GENUINELY plausible — not obvious red herrings.
    - Choose figures from a diverse range (avoid only male / only European / only secular figures).
    - For Bible class: figures like David, Esther, Ruth, Moses are appropriate.
    - For science: Marie Curie, Katherine Johnson, Charles Drew, Florence Nightingale, etc.
    - For history: figures relevant to the curriculum unit.
    - portraitUrl must be a real Wikimedia Commons URL (not a placeholder, not /api-generated/).

    Example output:
    {
      "taskType": "legends",
      "title": "Legends — A Pioneer of Radioactivity",
      "prompt": "Identify the legendary figure by sorting her 10 facts into the right categories.",
      "config": {
        "figure": {
          "name": "Marie Curie",
          "gender": "female",
          "portraitUrl": "https://upload.wikimedia.org/wikipedia/commons/c/c8/Marie_Curie_c1920.jpg",
          "era": "Late 1800s - early 1900s",
          "summary": "Pioneering physicist and chemist who discovered radium and polonium; first person to win Nobel Prizes in two different sciences."
        },
        "facts": [
          { "id": "f1", "text": "Was the first woman to win a Nobel Prize.", "category": "what" },
          { "id": "f2", "text": "Discovered two new elements, radium and polonium.", "category": "what" },
          { "id": "f3", "text": "Worked in a converted shed at the Sorbonne in Paris.", "category": "where" },
          { "id": "f4", "text": "Was born in Warsaw, then part of the Russian Empire.", "category": "where" },
          { "id": "f5", "text": "Believed scientific knowledge belonged to all humanity, not patent-holders.", "category": "why" },
          { "id": "f6", "text": "Wanted to find a way to relieve battlefield suffering during World War I (mobile X-ray units).", "category": "why" },
          { "id": "f7", "text": "Lived from 1867 to 1934.", "category": "when" },
          { "id": "f8", "text": "Famously declined the British scientist Lord Rutherford's invitation to a banquet.", "category": "decoy" },
          { "id": "f9", "text": "Is sometimes confused with another scientist who studied bacteria.", "category": "decoy" },
          { "id": "f10", "text": "Was rumored to have visited the Eiffel Tower 20 times in one year.", "category": "decoy" }
        ]
      }
    }
    `,
  },

  [TASK_TYPES.TRUTH_OR_DARE]: {
    label: "Truth or Dare",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "subjective",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 600,    // 10 min for a full T-or-D round set
    estimatedMinutes: 7,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "Classroom-safe Truth or Dare. A spotlight randomizer picks a player or team; they choose Truth, Dare, or Double Dare; an AI-generated, curriculum-aware challenge follows; the class votes or the teacher judges; points and coins are awarded. Built for ~5-8 rounds in 6-10 minutes. See TRUTH_OR_DARE_PLAN.md.\n\nAI MUST output:\n- taskType: 'truth-or-dare'\n- title (e.g. 'Truth or Dare — Water Cycle')\n- prompt (1-2 sentence student-facing intro)\n- config.subject, config.unitName, config.gradeLevel\n- config.physicalIntensityMax (0-3, default 2)\n- config.socialIntensityMax (0-3, default 2)\n- config.movementAllowed (bool, default true)\n- config.noiseAllowed (bool, default true)\n- config.totalRounds (3-10, default 6)\n- config.tierProgression ('linear' | 'random', default 'linear')\n- config.judgmentMode ('teacher' | 'class-vote' | 'mixed', default 'mixed')\n- config.safeClassroomMode (bool, default false)\n- config.seedChallenges (array, 1-3): optional pre-seeded challenges (with same shape the runtime generator produces) so the first round is instant.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "truth-or-dare".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Set non-empty title + prompt fields.
    - The task itself is a CONTAINER — the runtime generator produces the
      individual round challenges at play time. You only need to set up the
      session config and (optionally) 1-3 seed challenges so the first
      round can render instantly.

    Required config fields:
    - config.subject (e.g. "Science", "History", "English")
    - config.unitName (e.g. "Water Cycle", "American Revolution")
    - config.gradeLevel (number 1-12)
    - config.physicalIntensityMax (0-3, default 2) - cap on Dare physicality
    - config.socialIntensityMax (0-3, default 2) - cap on social pressure
    - config.movementAllowed (bool, default true)
    - config.noiseAllowed (bool, default true)
    - config.totalRounds (3-10, default 6)
    - config.tierProgression ('linear' | 'random', default 'linear')
    - config.judgmentMode ('teacher' | 'class-vote' | 'mixed', default 'mixed')
    - config.safeClassroomMode (bool, default false)

    REQUIRED config.seedChallenges — array of 4-6 entries, with MANDATORY variety:
      - AT LEAST 2 entries with type: "truth" (recall / explain / defend questions)
      - AT LEAST 2 entries with type: "dare"  (mime / draw / persuade / roleplay challenges)
      - Mix tiers: include AT LEAST one "sprout" and AT LEAST one "stem" so the
        linear progression actually escalates difficulty.
      - judgmentMode MUST be one of "teacher" or "class-vote" — "ai" is not
        recognised by the renderer and gets coerced to "teacher".
      - Each entry shape:
        { type: "truth" | "dare",
          tier: "sprout" | "stem" | "big",
          category: "recall"|"explain"|"defend"|"mime"|"persuade"|"roleplay"|"improv"|"draw"|"narrate"|"compose"|"reflect"|"predict",
          prompt: "...",
          teacherHint: "...",
          timeSeconds: 15-90,
          physicalIntensity: 0-3,
          socialIntensity: 0-3,
          noiseExpected: 0-3,
          acceptableAnswers: ["alt1","alt2",...] | null,
          judgmentMode: "teacher" | "class-vote",
          rewardTier: "small" | "medium" | "large" }
      Why this matters: config.totalRounds is 6 by default. With only 1 seed,
      the SAME challenge repeats every round. With only "truth" types, the
      game stops being Truth-OR-Dare (the renderer's CHOOSING phase lets the
      player pick either; only finding "truth" seeds defeats the format).

    SAFETY (absolute):
    - NO romance, attraction, personal disclosure, family income, religion-mockery,
      sexual content, substances, weapons, self-harm, body image, touching other
      students, food/drink, leaving classroom, climbing furniture, naming-and-shaming.
    - Every challenge MUST be doable from a seat unless movementAllowed=true.
    - Every challenge MUST give the performer a path to look brilliant, not be
      embarrassed.

    Example output:
    {
      "taskType": "truth-or-dare",
      "title": "Truth or Dare - Water Cycle",
      "prompt": "Spotlight Round! Step into the light and show what you know about the water cycle.",
      "config": {
        "subject": "Science",
        "unitName": "Water Cycle",
        "gradeLevel": 5,
        "physicalIntensityMax": 2,
        "socialIntensityMax": 2,
        "movementAllowed": true,
        "noiseAllowed": true,
        "totalRounds": 6,
        "tierProgression": "linear",
        "judgmentMode": "mixed",
        "safeClassroomMode": false,
        "seedChallenges": [
          {
            "type": "truth",
            "tier": "sprout",
            "category": "recall",
            "prompt": "In one sentence, name the three main stages of the water cycle.",
            "teacherHint": "Accept evaporation, condensation, precipitation in any order.",
            "timeSeconds": 20,
            "physicalIntensity": 0,
            "socialIntensity": 1,
            "noiseExpected": 0,
            "acceptableAnswers": ["evaporation, condensation, precipitation"],
            "judgmentMode": "ai",
            "rewardTier": "small"
          }
        ]
      }
    }
    `,
  },

  // ──────────────────────────────────────────────────────────────────────
  // UPVOTE — debatable binary proposition; class judgement call.
  // ──────────────────────────────────────────────────────────────────────
  [TASK_TYPES.UPVOTE]: {
    label: "UpVote",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    demoSelectable: true,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "participation",
    quickTaskEligible: true,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 180,
    estimatedMinutes: 4,
    correctAnswerShape: "none",
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "UpVote — a single debatable proposition tied to the unit. Each team votes For or Against; the class sees the tally and the AI surfaces the strongest argument on each side. Distinct from True/False (no fact answer) and Live Debate (no head-to-head). Best for 'should / better / more / worse' judgement calls, ethical trade-offs, and historical counterfactuals.",
    aiPrompt: `
Generate ONE Curriculate task object with taskType "upvote".

WHAT UPVOTE IS:
A single binary proposition that the class votes For or Against. The
proposition MUST be genuinely two-sided — both Yes and No are defensible
by a thoughtful student. Think "should / better / more / worse" judgement
calls, ethical trade-offs, historical counterfactuals.

WHAT UPVOTE IS NOT:
- NOT True/False — UpVote is never a question of established fact.
- NOT Live Debate — UpVote has no head-to-head matchup, no fixed sides
  assigned to teams, no postulate-style turn-taking.
- NOT a survey of preferences ("Do you like pizza?") — must hinge on the
  subject content.

HARD REQUIREMENTS:
- Output ONLY a single JSON object (no markdown, no commentary).
- title: 3-7 words tied to the unit.
- prompt: 1 sentence student-facing intro that frames the vote.
- config.proposition: ONE sentence, 8-25 words, declarative (not a
  question), subject-tied, with at least TWO defensible viewpoints.
- config.subject (e.g. "History", "Science", "English", "Bible")
- config.unitName (the specific unit/topic)
- config.gradeLevel (number 1-12)
- config.voteTimeSeconds (30-300, default 120)
- config.showRunningTally (boolean, default true)
- config.requireReasoningOnSubmit (boolean, default false)
- config.worldview ("faith" | "secular" | "general", default "general")

EXAMPLES OF GOOD PROPOSITIONS (ship these):
- History G7: "Sir Isaac Brock should not have personally led the charge at Queenston Heights."
- Science G8: "Pluto should still be classified as a planet."
- Bible G6: "Peter's denial of Jesus is a worse failure than Judas's betrayal."
- Math G9: "Memorising times tables is more valuable than learning to derive them."
- English G10: "Macbeth is more responsible for his downfall than Lady Macbeth is."

EXAMPLES OF BAD PROPOSITIONS (reject these):
- "Do zebras have stripes?" — trivially true, not a question of judgement.
- "Was Brock a Frenchman?" — trivially false, fact question.
- "Is murder wrong?" — no defensible counter-case.
- "Is the Pythagorean theorem useful?" — one-sided.
- "Should you study?" — vacuous, not subject-tied.

SAFETY (absolute — no exceptions):
- NO targeting of named LIVING individuals from current politics, sports,
  or entertainment (historical figures like Brock, Caesar, Lincoln are
  fine; living named politicians, athletes, celebrities are NOT).
- NO contested personal-choice medical, legal, or sexuality questions
  (abortion, gender-affirming care, gun ownership, capital punishment,
  drug legalisation, sexual orientation).
- NO framing of any religious tradition as inferior, dishonest, or false;
  do not invite students to vote against the legitimacy of someone's
  faith tradition.
- NO personal disclosure prompts ("are you a better person than…").
- NO romance, attraction, body image, family income.
- NO endorsement-shaped propositions about brands or commercial products.

WORLDVIEW HANDLING:
- worldview "faith" (e.g. Christian-school Bible/Theology units): you MAY
  generate interior-to-the-tradition interpretive questions at age-
  appropriate framing ("Peter's denial vs Judas's betrayal", "free will
  vs predestination at G9", "Mary or Martha showed better discipleship").
  Treat the tradition's truth claims as the shared frame; the vote is on
  interpretation, not on whether the tradition is true.
- worldview "secular" or "general": frame propositions in empirical,
  historical, ethical, or aesthetic terms only. Avoid theology votes.

Example output:
{
  "taskType": "upvote",
  "title": "UpVote — Queenston Heights",
  "prompt": "Read the proposition, then cast your vote For or Against. Defend your side in one line.",
  "config": {
    "proposition": "Sir Isaac Brock should not have personally led the charge at Queenston Heights.",
    "subject": "History",
    "unitName": "War of 1812",
    "gradeLevel": 7,
    "voteTimeSeconds": 120,
    "showRunningTally": true,
    "requireReasoningOnSubmit": false,
    "worldview": "general"
  }
}
    `,
  },

  [TASK_TYPES.QUEST]: {
    label: "Quest",
    category: CATEGORY.OTHER,
    implemented: true,                   // generator + economy live; QuestHud read-only renderer ships in commit #4
    demoEligible: false,
    demoSelectable: false,
    generatorEligible: true,
    profileInjectedOnly: false,
    objectiveKeyed: false,
    aiScoringDefaultOn: false,
    scoringMode: "objective",            // points = sum of objective rewards
    quickTaskEligible: false,
    hasOptions: false,
    expectsText: false,
    maxTimeSeconds: 900,                 // 15 min default
    estimatedMinutes: 15,
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description:
      "A Quest task turns the classroom into a live expedition/simulation economy. Students earn coins through normal academic tasks, then spend coins (and other resources) to acquire supplies, unlock progress, and complete mission objectives.\n\nIMPORTANT: Quest tasks are ONLY playable when the parent TaskSet has `questModeEnabled: true`. If a Quest task appears in a non-quest taskset it should render as an explanatory placeholder telling the teacher to enable Quest Mode.\n\nQuest config (config.*) carries the mission narrative, objectives, resources, premium resources, and rank thresholds. See QUEST_MODE_PLAN.md §3a for the canonical shape.",

    aiPrompt: `
    Generate ONE Curriculate task object with taskType "quest".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.

    Required config fields:
    - config.title            -- mission title (e.g. "Launch the Sea Expedition")
    - config.scenario         -- 2-4 sentence narrative setup
    - config.objectives       -- array of 1-3 objectives, each: { id, description, requiredResources: { resourceId: quantity } }
    - config.resources        -- array of 4-7 resources the team can acquire. Each:
        { id, name, acquisitionOptions: [{ type: "coins", amount: N }], prerequisites: [] }
    - config.specialties      -- array of 2-3 SCARCE resource ids (must also appear in config.resources).
                                 Each team is automatically seeded with a STARTING STOCK of ONE specialty
                                 (round-robin), so different teams hold different surpluses.
    - config.specialtyStartingStock -- integer (default 2): how many units of its specialty a team starts with.
    - config.premiumResources -- optional map of upgraded variants for bonus points
    - config.ranks            -- 3-4 rank tiers, ordered from minimum to most advanced

    DESIGN FOR TRADE (this is the heart of Quest Mode — teams must NEED each other):
    - Mark 2-3 resources as SPECIALTIES (list their ids in config.specialties). Give each specialty a
      HIGH depot price (e.g. 12-20 coins) so buying it outright is painful.
    - Make at least one OBJECTIVE require a MIX of specialties (e.g. needs 1× of specialtyA AND 1× of
      specialtyB). Since each team only starts with ONE specialty, they MUST trade their surplus to a
      team holding the other — comparative advantage creates real gains from trade.
    - The depot still sells specialties (no hard dead-ends), but trading a teammate's surplus is far
      cheaper than the depot price — that price gap is the incentive to trade.
    - Keep NON-specialty "basic supplies" cheap (2-6 coins) and affordable from coins earned in one taskset.

    OTHER GUIDANCE:
    - The lesson topic should be woven into the scenario AND the resource names where possible.
    - Resources should sound like real expedition supplies, not arbitrary tokens.
    - Premium resources should grant bonus points, not be required for completion.

    EXAMPLE config (Sea Expedition):
    {
      "title": "Launch the Sea Expedition",
      "scenario": "Three crews race to outfit a ship. No crew has everything — you'll need to trade.",
      "specialties": ["navigation_charts", "fresh_water", "salted_rations"],
      "specialtyStartingStock": 2,
      "resources": [
        { "id": "navigation_charts", "name": "Navigation Charts", "acquisitionOptions": [{ "type": "coins", "amount": 16 }], "prerequisites": [] },
        { "id": "fresh_water", "name": "Barrels of Fresh Water", "acquisitionOptions": [{ "type": "coins", "amount": 14 }], "prerequisites": [] },
        { "id": "salted_rations", "name": "Salted Rations", "acquisitionOptions": [{ "type": "coins", "amount": 15 }], "prerequisites": [] },
        { "id": "rope", "name": "Rope", "acquisitionOptions": [{ "type": "coins", "amount": 4 }], "prerequisites": [] },
        { "id": "lantern", "name": "Lantern", "acquisitionOptions": [{ "type": "coins", "amount": 5 }], "prerequisites": [] }
      ],
      "objectives": [
        { "id": "obj_provision", "description": "Provision the ship for open water", "requiredResources": { "fresh_water": 1, "salted_rations": 1, "navigation_charts": 1 } },
        { "id": "obj_rig", "description": "Rig the deck", "requiredResources": { "rope": 2, "lantern": 1 } }
      ],
      "ranks": [ ... ]
    }
    `,
  },

  // =========================
  // COMPETITIVE (placeholder type)
  // =========================
};
// -------------------------
// Compatibility + defaults
// -------------------------
// This project historically used:
// - aiEligible              (overloaded as "demo eligible")
// - objectiveScoring        (deterministic / answer-key scoring)
// - defaultAiScoringRequired (AI scoring enabled by default)
//
// Going forward we use:
// - demoEligible
// - objectiveKeyed
// - scoringMode: "none" | "objective" | "ai" | "hybrid"
// - aiScoringDefaultOn
//
// To avoid breaking older code paths, we backfill legacy fields below.

const __TASK_TYPE_META_DEFAULTS = {
  label: "",
  category: CATEGORY.OTHER,
  description: "",
  implemented: false,

  // New switches
  demoEligible: false,
  generatorEligible: false,
  scoringMode: "none",
  objectiveKeyed: false,
  aiScoringDefaultOn: false,

  // Existing capabilities / UI hints (kept)
  quickTaskEligible: false,
  interTeamEnabled: false,
  intraTeamEnabled: false,
  hasOptions: false,
  expectsText: false,
  maxTimeSeconds: 0,
  correctAnswerShape: null,
  multiItemCapable: false,
  preferredItemsPerTask: null,

  // Estimated total classroom minutes per task (includes timer + transition + reading).
  // Used to derive task count from session duration. Default 5 if not overridden.
  estimatedMinutes: 5,

  // True if the primary interaction is physical, verbal, or camera-based (not screen-tapping).
  // Used by the pool builder to enforce off-tablet diversity minimums.
  isOffTablet: false,
};

for (const [k, meta] of Object.entries(TASK_TYPE_META)) {
  const m = { ...__TASK_TYPE_META_DEFAULTS, ...(meta || {}) };

  // Derive any missing new switches from scoringMode
  if (!m.scoringMode) m.scoringMode = "none";
  if (m.scoringMode === "objective") m.objectiveKeyed = true;
  if (m.scoringMode === "hybrid") {
    m.objectiveKeyed = true;
    m.aiScoringDefaultOn = true;
  }
  if (m.scoringMode === "ai") m.aiScoringDefaultOn = true;

  // Legacy fields for older clients/servers that still read them
  m.aiEligible = m.demoEligible === true; // legacy meaning: demo-eligible
  m.objectiveScoring = m.objectiveKeyed === true;
  m.defaultAiScoringRequired = m.aiScoringDefaultOn === true;

  TASK_TYPE_META[k] = m;
}

// -------------------------
// Demo UX hooks (centralized)
// -------------------------
// Optional helpers for demo surfaces so task-type-specific templates / toasts / SFX live in ONE place.
// Consumers (e.g., DemoPage) may read:
// - meta.demoTemplate: object OR function () => object
// - meta.demoToast: string (shown when task starts)
// - meta.demoSfx: string key (consumer decides which audio to play)

const __DEMO_TEMPLATES = {
  [TASK_TYPES.BODY_BREAK]: {
    taskType: TASK_TYPES.BODY_BREAK,
    title: "Body Break",
    prompt:
      "BODY BREAK (45s):\n1) March in place for 10 seconds.\n2) Reach to the sky x5, then touch your toes x5.\n3) Shoulder rolls forward x5, backward x5.\n4) Deep breath in… and out… twice.\n5) Freeze like a statue for 5 seconds on GO!",
    timeLimitSeconds: 0,
    points: 0,
    config: {
      durationSeconds: 45,
      steps: [
        "March in place (10s)",
        "Reach high x5 + touch toes x5",
        "Shoulder rolls x5 forward, x5 back",
        "Two deep breaths",
        "Freeze on GO (5s)",
      ],
      sfx: { start: true, complete: true },
    },
  },

  [TASK_TYPES.ECHO_CHAIN]: {
    taskType: TASK_TYPES.ECHO_CHAIN,
    title: "Echo Chain",
    prompt:
      "Say the chain aloud. Player 1 repeats the starter word and adds one related word. Player 2 repeats the whole chain and adds one. Keep going until someone forgets a word or changes the order.",
    timeLimitSeconds: 0,
    points: 12,
    config: {
      perTurnSeconds: 10,
      rotationBonus: 5,
      seed: "Photosynthesis",
      examples: ["chlorophyll", "sunlight", "glucose"],
    },
  },

  [TASK_TYPES.SCRIPT_PLAY]: {
    taskType: TASK_TYPES.SCRIPT_PLAY,
    title: "Script Play",
    prompt:
      "Pass the device speaker-to-speaker. Read your lines with the tone cues. Add a little acting for bonus points!",
    timeLimitSeconds: 120,
    points: 14,
    config: {
      sceneTitle: "The Lost Map",
      setting: "A candlelit library, late at night",
      roles: ["Narrator", "Ava", "Noah"],
      beats: [
        {
          speaker: "Narrator",
          cue: "Calm, mysterious",
          lines: [
            "The old library creaks as a storm taps the windows.",
            "Ava finds a folded map hidden inside a dusty book.",
          ],
          before: "You are setting the scene.",
          after: "Hand the device to Ava.",
        },
        {
          speaker: "Ava",
          cue: "Whispering, excited",
          stageDirections: ["(leans in)", "(speaks softly)"],
          lines: [
            "Noah… look. This map has today's date on it.",
            "Why would someone hide it here?",
          ],
          before: "You just discovered something important.",
          after: "Hand the device to Noah.",
        },
        {
          speaker: "Noah",
          cue: "Skeptical but curious",
          stageDirections: ["(raises an eyebrow)"],
          lines: [
            "Either it's a prank… or it's a clue.",
            "Let's follow it--carefully.",
          ],
          before: "Respond to Ava and decide what to do.",
          after: "Group: act out the next step together.",
        },
      ],
      scoring: { expressiveBonus: true, maxExpressiveBonus: 4 },
    },
  },

  [TASK_TYPES.ROLE_PLAY_DECK]: {
    taskType: TASK_TYPES.ROLE_PLAY_DECK,
    title: "RolePlay Deck",
    prompt:
      "Choose Mystery (hidden roles) or Classic (open roles). Each player draws ONE role card, then role-play the scenario as a team. Tap Finished when done.",
    timeLimitSeconds: 180,
    points: 12,
    config: {
      mode: "choose",
      roles: [
        {
          name: "Amira",
          role: "Community helper",
          characteristics: ["Kind", "Truthful", "Brave", "Patient"],
        },
        {
          name: "Noah",
          role: "Question-asker",
          characteristics: ["Curious", "Respectful", "Careful thinker", "Fair"],
        },
        {
          name: "Sofia",
          role: "Peacemaker",
          characteristics: ["Empathetic", "Calm", "Listening", "Humble"],
        },
        {
          name: "Eli",
          role: "Planner",
          characteristics: ["Wise", "Organized", "Self-controlled", "Honest"],
        },
      ],
      scenario:
        "Your class is planning a new rule for fair group work. Act out a meeting where each role helps decide what the rule should be and why it matters.",
    },
  },

  [TASK_TYPES.WORD_WEAVER_DUEL]: {
    taskType: TASK_TYPES.WORD_WEAVER_DUEL,
    title: "Word Weaver Duel",
    prompt:
      "Take turns placing whole words onto the grid (horizontal or vertical). Try to intersect existing letters for bonus points.",
    timeLimitSeconds: 180,
    points: 18,
    mode: "scrabble",
    gridSize: 11,
    words: [
      "anchor",
      "harbor",
      "navigate",
      "compass",
      "current",
      "voyage",
      "island",
      "tide",
    ],
    turnkeeper: { playerCount: 4, perTurnSeconds: 12 },
  },

  [TASK_TYPES.FLASHCARDS_RACE]: {
    taskType: TASK_TYPES.FLASHCARDS_RACE,
    title: "Flashcards Race",
    prompt:
      "Buzz in first, answer fast, and win the card. (Demo mode runs locally; live mode uses inter-team events.)",
    timeLimitSeconds: 0,
    points: 15,
    demoMode: true,
    cards: [
      { question: "What is 7 × 8?", answer: "56" },
      { question: "Who discovered gravity (classic story)?", answer: "Isaac Newton" },
      {
        question: "Define 'ecosystem'.",
        answer: "A community of living organisms interacting with their environment.",
      },
      { question: "What is the capital of Canada?", answer: "Ottawa" },
      { question: "What is π to 2 decimals?", answer: "3.14" },
      { question: "Name the first book of the Bible.", answer: "Genesis" },
    ],
  },

  [TASK_TYPES.JEOPARDY]: {
    taskType: TASK_TYPES.JEOPARDY,
    title: "Brain Blitz",
    prompt: "Shout the question (Jeopardy style)!",
    timeLimitSeconds: 0,
    points: 15,
    clues: [
      { clue: "This planet is known as the Red Planet.", answer: "mars" },
      { clue: "This process turns liquid water into water vapor.", answer: "evaporation" },
      { clue: "The capital city of Canada.", answer: "ottawa" },
      { clue: "The largest ocean on Earth.", answer: "pacific" },
      { clue: "A polygon with 3 sides.", answer: "triangle" },
      { clue: "In the Bible, the first book of the Old Testament.", answer: "genesis" },
    ],
  },

  [TASK_TYPES.AI_DEBATE_JUDGE]: {
    taskType: TASK_TYPES.AI_DEBATE_JUDGE,
    title: "AI Debate Judge",
    prompt:
      "Choose your side and role, then tap 1‑2‑3 GO to record. Use evidence, structure, and respectful tone.",
    timeLimitSeconds: 0,
    points: 0,
    config: {
      kind: "ai-debate-judge",
      allowTeamDevice: true,
      sides: ["Affirmative", "Negative"],
      positions: ["Introduction", "First", "Rebuttal", "Conclusion"],
      timing: {
        countdownSeconds: 120,
        graceSeconds: 15,
        penaltyTooShortUnderSeconds: 105,
        penaltyTooLongOverSeconds: 135,
        hardStopSeconds: 150,
      },
      ui: {
        showSoundMeter: true,
        showWaveform: false,
        showListeningIndicator: true,
      },
      scoring: {
        rubricName: "Debate Speech Rubric",
        categories: [
          { id: "structure", label: "Structure & Clarity", weight: 0.25 },
          { id: "evidence", label: "Evidence & Reasoning", weight: 0.35 },
          { id: "rebuttal", label: "Rebuttal & Responsiveness", weight: 0.2 },
          { id: "delivery", label: "Delivery & Respect", weight: 0.2 },
        ],
      },
    },
  },

  [TASK_TYPES.HANGMAN_DUEL]: {
    taskType: TASK_TYPES.HANGMAN_DUEL,
    title: "Hangman Duel",
    prompt:
      "Quick demo round: Hangman Duel. One person types letters. The team helps guess the word before you run out of tries.",
    timeLimitSeconds: 60,
    points: 10,
    config: {
      wordsByStation: [
        { word: "COVENANT", hint: "A serious promise or agreement." },
        { word: "REPUBLIC", hint: "A country where people elect leaders." },
        { word: "PHOTOSYNTHESIS", hint: "How plants make food using light." },
        { word: "MIGRATION", hint: "When people or animals move to a new place." },
      ],
    },
  },

  [TASK_TYPES.TRUE_FALSE]: {
    taskType: TASK_TYPES.TRUE_FALSE,
    title: "True or False?",
    prompt: "Read each statement carefully. Decide if it is TRUE or FALSE.",
    timeLimitSeconds: 0,
    points: 10,
    items: [
      { statement: "The Earth revolves around the Sun.", correctAnswer: true },
      { statement: "Sound travels faster than light.", correctAnswer: false },
      { statement: "Water freezes at 0 degrees Celsius.", correctAnswer: true },
      { statement: "Humans have four lungs.", correctAnswer: false },
      { statement: "The Great Wall of China is visible from the Moon with the naked eye.", correctAnswer: false },
    ],
  },

  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: {
    taskType: TASK_TYPES.TRUE_FALSE_TICTACTOE,
    title: "T/F Tic-Tac-Toe",
    prompt: "Answer True or False to claim a square. Get three in a row to win!",
    timeLimitSeconds: 0,
    points: 12,
    items: [
      { statement: "Photosynthesis happens in the leaves of plants.", correctAnswer: true },
      { statement: "The Pacific Ocean is the smallest ocean.", correctAnswer: false },
      { statement: "Insects have six legs.", correctAnswer: true },
      { statement: "The moon produces its own light.", correctAnswer: false },
      { statement: "Ottawa is the capital of Canada.", correctAnswer: true },
      { statement: "There are 8 continents on Earth.", correctAnswer: false },
      { statement: "Friction is a force that slows things down.", correctAnswer: true },
      { statement: "Diamonds are made of carbon.", correctAnswer: true },
      { statement: "Penguins can fly.", correctAnswer: false },
    ],
  },

  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: {
    taskType: TASK_TYPES.TRUE_FALSE_CONNECT_FOUR,
    title: "T/F Connect Four",
    prompt: "Answer True or False to drop a chip. Connect four in a row to win!",
    timeLimitSeconds: 0,
    points: 14,
    items: [
      { statement: "The chemical symbol for water is H2O.", correctAnswer: true },
      { statement: "Jupiter is the closest planet to the Sun.", correctAnswer: false },
      { statement: "The Sahara is the largest hot desert in the world.", correctAnswer: true },
      { statement: "Mammals are cold-blooded animals.", correctAnswer: false },
      { statement: "A triangle has three sides.", correctAnswer: true },
      { statement: "Lightning never strikes the same place twice.", correctAnswer: false },
      { statement: "The human body has 206 bones.", correctAnswer: true },
      { statement: "Spiders are insects.", correctAnswer: false },
      { statement: "Mount Everest is the tallest mountain on Earth.", correctAnswer: true },
      { statement: "The Amazon River is in Africa.", correctAnswer: false },
      { statement: "Gravity pulls objects toward each other.", correctAnswer: true },
      { statement: "Bats are blind.", correctAnswer: false },
    ],
  },

  [TASK_TYPES.MYSTERY_CLUES]: {
    taskType: TASK_TYPES.MYSTERY_CLUES,
    title: "Mystery Clue!",
    prompt: "Memorize these clues — you will need to recall them later!",
    timeLimitSeconds: 0,
    points: 15,
    isFinal: false,
    revealMs: 8000,
    clues: ["Photosynthesis", "Chlorophyll", "Sunlight"],
  },
};

const __DEMO_TOASTS = {
  [TASK_TYPES.SCRIPT_PLAY]: "🎭 Script Play! Pass the device speaker-to-speaker.",
  [TASK_TYPES.ECHO_CHAIN]: "Echo Chain! Say it aloud and add one.",
  [TASK_TYPES.ROLE_PLAY_DECK]: "🎭 RolePlay Deck! Draw roles, then act it out.",
  [TASK_TYPES.WORD_WEAVER_DUEL]: "🧩 Word Weaver Duel! Take turns placing words for points.",
  [TASK_TYPES.FLASHCARDS_RACE]: "🔔 Flashcards Race! Buzz in and answer fast.",
  [TASK_TYPES.VENNSORT]: "⭕ Venn Sort! Drag items into the correct Venn regions.",
  [TASK_TYPES.SPEED_DRAW]: "✏️ Speed Draw! One draws, teammates guess fast.",
  [TASK_TYPES.PHOTO]: "📸 Photo challenge! Take a clear pic, then add your explanation.",
  [TASK_TYPES.PHOTO_JOURNAL]: "📸 Photo challenge! Take a clear pic, then add your explanation.",
  [TASK_TYPES.HIDENSEEK]: "🔎 Hide & Seek! Find it, snap proof, and explain why it matters.",
  [TASK_TYPES.AI_DEBATE_JUDGE]: "🧑‍⚖️ AI Debate Judge! Pick your side & role, then record your speech.",
  [TASK_TYPES.BODY_BREAK]: "✅ Body Break! Get moving.",
  [TASK_TYPES.HANGMAN_DUEL]: "🪓 Hangman Duel! Guess the word as a team.",
  [TASK_TYPES.JEOPARDY]: "⚡ Brain Blitz! Shout the question (Jeopardy style).",
  [TASK_TYPES.TRUE_FALSE]: "✅ True or False! Read carefully and decide.",
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: "❌⭕ T/F Tic-Tac-Toe! Answer correctly to claim your square.",
  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: "🔴🟡 T/F Connect Four! Answer correctly to drop your chip.",
};

// Demo SFX keys are consumed by the UI layer (DemoPage). Keeping them in meta
// means you can change the sound without editing the page.
const __DEMO_SFX = {
  [TASK_TYPES.SCRIPT_PLAY]: "pageTurn",
  [TASK_TYPES.ECHO_CHAIN]: "echoChime",
  [TASK_TYPES.ROLE_PLAY_DECK]: "cardShuffle",
  [TASK_TYPES.WORD_WEAVER_DUEL]: "woodTap",
  [TASK_TYPES.FLASHCARDS_RACE]: "fakeOut",
  [TASK_TYPES.VENNSORT]: "tap",
  [TASK_TYPES.SPEED_DRAW]: "marker",
  [TASK_TYPES.PHOTO]: "shutter",
  [TASK_TYPES.PHOTO_JOURNAL]: "shutter",
  [TASK_TYPES.HIDENSEEK]: "whoosh",
  [TASK_TYPES.AI_DEBATE_JUDGE]: "gavel",
  [TASK_TYPES.BODY_BREAK]: "goBeep",
};

for (const [type, tmpl] of Object.entries(__DEMO_TEMPLATES)) {
  if (!TASK_TYPE_META[type]) continue;
  if (!TASK_TYPE_META[type].demoTemplate) TASK_TYPE_META[type].demoTemplate = tmpl;
}
for (const [type, msg] of Object.entries(__DEMO_TOASTS)) {
  if (!TASK_TYPE_META[type]) continue;
  if (!TASK_TYPE_META[type].demoToast) TASK_TYPE_META[type].demoToast = msg;
}
for (const [type, key] of Object.entries(__DEMO_SFX)) {
  if (!TASK_TYPE_META[type]) continue;
  if (!TASK_TYPE_META[type].demoSfx) TASK_TYPE_META[type].demoSfx = key;
}

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
// ═══════════════════════════════════════════════════════════════════════
// SUBJECT AFFINITY -- weighted preference for task types per subject area
// ═══════════════════════════════════════════════════════════════════════
//
// Each value is 0.0–1.0:  1.0 = perfect fit,  0.5 = usable but not ideal,
// 0.1 = rare/last-resort,  0.0 = never.
//
// During generation the backend multiplies each candidate type's affinity
// by a random draw, then picks highest-weighted types.  Lower-affinity
// types can still appear (keeps variety) but are much less likely.
//
// Subject buckets: math, science, history, language, arts, health,
// business, religion, general (catch-all).
//
// "universal" types (flashcards, brain-blitz, body-break, etc.) get 1.0
// across the board so they always stay in the mix.

const _DEFAULT_AFFINITY = { math: 0.7, science: 0.7, history: 0.7, language: 0.7, arts: 0.7, health: 0.7, business: 0.7, religion: 0.7, general: 0.7 };

/* ============================================================
   TASK_TYPE_FIX_VERSION
   ============================================================
   Integer per task type, BUMPED any time we ship a meaningful fix
   (aiPrompt rewrite, sanitizer/validator change, renderer behaviour
   change that affects how a tester would judge it).

   The practice-mode exhausted-types endpoint compares each
   tester's recorded feedback-version against the CURRENT version
   for that type. Only entries at the current version count toward
   "exhausted". When we bump a number here, every tester who had
   already given two thumbs-ups on the previous version sees that
   type re-enter their queue — they get to validate the fix.

   How to use:
   - When you change a type's aiPrompt / sanitizer / validator,
     bump its number here.
   - If the type isn't listed, the helper getTaskTypeFixVersion()
     returns 1 as default — that's intentional, no need to seed
     every entry up-front.
*/
export const TASK_TYPE_FIX_VERSION = {
  // ── 2026-06 audit-driven fixes — testers re-validate after each ──
  [TASK_TYPES.VENNSORT]:           3, // (audit2 #5) overlap-recognition worked examples
  [TASK_TYPES.PHOTO]:              2, // single-instruction prompt enforcement
  [TASK_TYPES.MAKE_AND_SNAP]:      2, // matched single-instruction rules
  [TASK_TYPES.CAREERS]:            2, // title-eating sanitizer bug fix + per-mode aiPrompt
  [TASK_TYPES.SPEED_DRAW]:         2, // align to single config.word + new sanitizer/validator
  [TASK_TYPES.OPEN_TEXT]:          2, // reject placeholder prompts + un-nest
  [TASK_TYPES.HOLE_IN_ONE]:        3, // (audit2 #3) reward shape sanitizer + topic-themed framing
  [TASK_TYPES.NARRATION_SYNTHESIZE]: 2, // aiPrompt rewritten for oral teach-back, prompt-shape sanitizer
  [TASK_TYPES.ROLE_PLAY_DECK]:       2, // shell + aiPrompt + validator realigned to renderer's {name,role,characteristics,gender}
  [TASK_TYPES.MIND_MAPPER]:          2, // normalize accepts plain-string items so they survive into the renderer
  [TASK_TYPES.INTERVIEW]:          3, // (#38) subject affinity + strict validator + render fallback
  [TASK_TYPES.MAPIT]:              2, // (#15) graceful Submit + step-hint UX
  [TASK_TYPES.DIFF_DETECTIVE]:     2, // (#22) lenient scoring
  [TASK_TYPES.ART_VIEW]:           3, // (#13) DATE-FIT rule
  [TASK_TYPES.LEGENDS]:            2, // (#9) explicit DECOY TRUTH RULE
  [TASK_TYPES.TIMELINE]:           3, // (audit2 #1) extend BCE branch to century patterns
  [TASK_TYPES.PEER_EDITING]:       3, // (audit2 #2) edit-distance check on wordIndex word
  [TASK_TYPES.GUESS_WHO]:          2, // (#14) shell stripped to secretAnswers only
  [TASK_TYPES.BODY_BREAK]:         2, // (#15) sanitizer fills steps/totalSeconds/label
  [TASK_TYPES.MOTION_MISSION]:     2, // matched body-break sanitizer changes
  [TASK_TYPES.TRUTH_OR_DARE]:      2, // (audit2 #4) require ≥ 4 seeds + truth+dare variety + tier variety
  [TASK_TYPES.HISTORICAL_DOC]:     2, // (#19) shorter timers
  [TASK_TYPES.WHAT_AM_I]:          2, // (#20) easier starter pool
  [TASK_TYPES.MYSTERY_CLUES]:      2, // pool rotation
};

export function getTaskTypeFixVersion(taskType) {
  return TASK_TYPE_FIX_VERSION[taskType] || 1;
}

export const SUBJECT_AFFINITY = {
  // ── Universal / every-subject types ───────────────────────────────
  [TASK_TYPES.MULTIPLE_CHOICE]:        { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 0.8, health: 0.9, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.TRUE_FALSE]:             { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 0.8, health: 0.9, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.SHORT_ANSWER]:           { math: 0.9, science: 1.0, history: 1.0, language: 1.0, arts: 0.8, health: 0.8, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.FLASHCARDS]:             { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 0.9, health: 0.9, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.FLASHCARDS_RACE]:        { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 0.9, health: 0.9, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.JEOPARDY]:               { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 0.9, health: 0.9, business: 1.0, religion: 1.0, general: 1.0 }, // Brain Blitz
  [TASK_TYPES.MATCHING]:               { math: 0.9, science: 1.0, history: 1.0, language: 1.0, arts: 0.8, health: 0.8, business: 0.9, religion: 0.9, general: 0.9 },
  [TASK_TYPES.LABELME]:                { math: 0.8, science: 1.0, history: 1.0, language: 0.7, arts: 0.9, health: 1.0, business: 0.7, religion: 0.9, general: 0.9 },
  [TASK_TYPES.MAPIT]:                  { math: 0.1, science: 0.5, history: 1.0, language: 0.4, arts: 0.3, health: 0.2, business: 0.6, religion: 1.0, general: 0.4 }, // heavy history/religion/geo bias — gated by aiPrompt to refuse non-geographic vocab
  [TASK_TYPES.SORT]:                   { math: 0.9, science: 1.0, history: 0.9, language: 0.8, arts: 0.6, health: 0.7, business: 0.8, religion: 0.7, general: 0.8 },
  [TASK_TYPES.SEQUENCE]:               { math: 1.0, science: 0.9, history: 1.0, language: 0.7, arts: 0.5, health: 0.6, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.TIMELINE]:               { math: 0.4, science: 0.7, history: 1.0, language: 0.5, arts: 0.6, health: 0.3, business: 0.6, religion: 0.8, general: 0.6 },
  [TASK_TYPES.VENNSORT]:               { math: 0.7, science: 1.0, history: 0.9, language: 0.8, arts: 0.6, health: 0.7, business: 0.8, religion: 0.7, general: 0.8 },
  [TASK_TYPES.HANGMAN_DUEL]:           { math: 0.3, science: 0.6, history: 0.7, language: 1.0, arts: 0.7, health: 0.5, business: 0.5, religion: 0.6, general: 0.7 },
  [TASK_TYPES.WORD_WEAVER_DUEL]:       { math: 0.2, science: 0.5, history: 0.6, language: 1.0, arts: 0.7, health: 0.4, business: 0.5, religion: 0.5, general: 0.6 },
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]:   { math: 1.0, science: 1.0, history: 1.0, language: 0.9, arts: 0.7, health: 0.8, business: 0.9, religion: 0.9, general: 0.9 },
  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]:{ math: 1.0, science: 1.0, history: 1.0, language: 0.9, arts: 0.7, health: 0.8, business: 0.9, religion: 0.9, general: 0.9 },

  // ── Movement / body-break types (universal energizers) ────────────
  [TASK_TYPES.BODY_BREAK]:             { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 1.0, health: 1.0, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.MUSICAL_CHAIRS]:         { math: 0.8, science: 0.8, history: 0.8, language: 0.8, arts: 1.0, health: 1.0, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.MOTION_MISSION]:         { math: 0.6, science: 0.8, history: 0.7, language: 0.7, arts: 0.9, health: 1.0, business: 0.5, religion: 0.6, general: 0.7 },
  [TASK_TYPES.MAD_DASH]:               { math: 0.8, science: 0.8, history: 0.8, language: 0.8, arts: 0.8, health: 1.0, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.MAD_DASH_SEQUENCE]:      { math: 1.0, science: 0.9, history: 0.9, language: 0.7, arts: 0.6, health: 0.8, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.TREASURE_RUNNER]:        { math: 0.9, science: 0.9, history: 0.9, language: 0.9, arts: 0.9, health: 1.0, business: 0.8, religion: 0.8, general: 0.9 },
  [TASK_TYPES.HIDENSEEK]:              { math: 0.7, science: 0.8, history: 0.8, language: 0.7, arts: 0.7, health: 0.9, business: 0.6, religion: 0.7, general: 0.8 },

  // ── Creative / language-heavy types ───────────────────────────────
  [TASK_TYPES.OPEN_TEXT]:              { math: 0.3, science: 0.6, history: 0.9, language: 1.0, arts: 0.8, health: 0.5, business: 0.7, religion: 0.8, general: 0.7 },
  [TASK_TYPES.READING_COMP]:          { math: 0.2, science: 0.6, history: 0.9, language: 1.0, arts: 0.7, health: 0.4, business: 0.6, religion: 0.8, general: 0.6 },
  [TASK_TYPES.LETTER]:                { math: 0.1, science: 0.3, history: 0.9, language: 1.0, arts: 0.8, health: 0.2, business: 0.6, religion: 0.7, general: 0.5 },
  [TASK_TYPES.ROLE_PLAY]:             { math: 0.1, science: 0.4, history: 1.0, language: 0.9, arts: 1.0, health: 0.4, business: 0.7, religion: 0.8, general: 0.6 },
  [TASK_TYPES.ROLE_PLAY_DECK]:        { math: 0.1, science: 0.4, history: 1.0, language: 0.9, arts: 1.0, health: 0.4, business: 0.7, religion: 0.8, general: 0.6 },
  [TASK_TYPES.SCRIPT_PLAY]:           { math: 0.1, science: 0.3, history: 0.9, language: 1.0, arts: 1.0, health: 0.3, business: 0.5, religion: 0.7, general: 0.5 },
  [TASK_TYPES.NARRATION_SYNTHESIZE]:   { math: 0.2, science: 0.5, history: 0.9, language: 1.0, arts: 0.9, health: 0.4, business: 0.6, religion: 0.8, general: 0.6 },
  [TASK_TYPES.ECHO_CHAIN]:            { math: 0.3, science: 0.5, history: 0.6, language: 1.0, arts: 0.8, health: 0.4, business: 0.5, religion: 0.5, general: 0.6 },

  // ── Visual / hands-on types ───────────────────────────────────────
  [TASK_TYPES.DRAW]:                   { math: 0.5, science: 0.8, history: 0.6, language: 0.5, arts: 1.0, health: 0.6, business: 0.4, religion: 0.5, general: 0.6 },
  [TASK_TYPES.SPEED_DRAW]:            { math: 0.5, science: 0.7, history: 0.6, language: 0.6, arts: 1.0, health: 0.6, business: 0.4, religion: 0.5, general: 0.6 },
  [TASK_TYPES.DRAW_MIME]:             { math: 0.3, science: 0.6, history: 0.5, language: 0.7, arts: 1.0, health: 0.7, business: 0.4, religion: 0.5, general: 0.6 },
  [TASK_TYPES.PHOTO]:                 { math: 0.4, science: 0.9, history: 0.7, language: 0.5, arts: 1.0, health: 0.8, business: 0.5, religion: 0.5, general: 0.6 },
  [TASK_TYPES.PHOTO_JOURNAL]:         { math: 0.3, science: 0.9, history: 0.8, language: 0.7, arts: 1.0, health: 0.7, business: 0.5, religion: 0.6, general: 0.7 },
  [TASK_TYPES.MAKE_AND_SNAP]:         { math: 0.5, science: 1.0, history: 0.6, language: 0.4, arts: 1.0, health: 0.7, business: 0.4, religion: 0.5, general: 0.6 },
  [TASK_TYPES.ART_VIEW]:              { math: 0.1, science: 0.3, history: 0.8, language: 0.5, arts: 1.0, health: 0.2, business: 0.2, religion: 0.6, general: 0.4 },
  [TASK_TYPES.HISTORICAL_DOC]:        { math: 0.1, science: 0.3, history: 1.0, language: 0.6, arts: 0.4, health: 0.1, business: 0.4, religion: 0.8, general: 0.4 },

  // ── Deduction / strategy types ────────────────────────────────────
  [TASK_TYPES.MYSTERY_CLUES]:          { math: 0.7, science: 0.9, history: 0.9, language: 0.7, arts: 0.6, health: 0.5, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.PHYSICAL_MYSTERY_CLUES]: { math: 0.7, science: 0.9, history: 0.9, language: 0.6, arts: 0.6, health: 0.7, business: 0.6, religion: 0.7, general: 0.7 },
  [TASK_TYPES.FAKE_OUT]:               { math: 0.6, science: 0.8, history: 0.9, language: 1.0, arts: 0.7, health: 0.6, business: 0.7, religion: 0.7, general: 0.8 },
  [TASK_TYPES.GUESS_WHO]:              { math: 0.5, science: 0.7, history: 0.8, language: 0.8, arts: 0.7, health: 0.5, business: 0.6, religion: 0.6, general: 0.7 },
  [TASK_TYPES.DIFF_DETECTIVE]:         { math: 0.8, science: 0.9, history: 0.7, language: 0.7, arts: 0.8, health: 0.5, business: 0.7, religion: 0.6, general: 0.7 },

  // ── Synthesis / higher-order thinking ─────────────────────────────
  [TASK_TYPES.BRAIN_SPARK_NOTES]:      { math: 0.5, science: 0.7, history: 0.9, language: 0.9, arts: 0.8, health: 0.5, business: 0.7, religion: 0.8, general: 0.7 },
  [TASK_TYPES.MIND_MAPPER]:            { math: 0.6, science: 0.9, history: 0.9, language: 0.7, arts: 0.7, health: 0.5, business: 0.8, religion: 0.7, general: 0.8 },
  [TASK_TYPES.CASE_STUDY]:             { math: 0.4, science: 0.8, history: 1.0, language: 0.6, arts: 0.4, health: 0.6, business: 1.0, religion: 0.7, general: 0.7 },
  [TASK_TYPES.BRAINSTORM_BATTLE]:      { math: 0.5, science: 0.8, history: 0.8, language: 0.8, arts: 0.9, health: 0.6, business: 0.8, religion: 0.7, general: 0.8 },

  // ── Collaboration / debate types ──────────────────────────────────
  [TASK_TYPES.COLLABORATION]:          { math: 0.6, science: 0.8, history: 0.9, language: 0.8, arts: 0.8, health: 0.6, business: 0.9, religion: 0.8, general: 0.8 },
  [TASK_TYPES.LIVE_DEBATE]:            { math: 0.3, science: 0.6, history: 1.0, language: 0.9, arts: 0.7, health: 0.5, business: 0.8, religion: 0.9, general: 0.7 },
  [TASK_TYPES.AI_DEBATE_JUDGE]:        { math: 0.3, science: 0.6, history: 1.0, language: 0.9, arts: 0.7, health: 0.5, business: 0.8, religion: 0.9, general: 0.7 },

  // ── Language-specific types ───────────────────────────────────────
  [TASK_TYPES.PRONUNCIATION]:          { math: 0.0, science: 0.0, history: 0.0, language: 1.0, arts: 0.2, health: 0.0, business: 0.0, religion: 0.0, general: 0.1 },
  [TASK_TYPES.SPEECH_RECOGNITION]:     { math: 0.0, science: 0.0, history: 0.0, language: 1.0, arts: 0.2, health: 0.0, business: 0.0, religion: 0.0, general: 0.1 },
  [TASK_TYPES.RECORD_AUDIO]:           { math: 0.1, science: 0.3, history: 0.5, language: 1.0, arts: 0.8, health: 0.2, business: 0.3, religion: 0.4, general: 0.4 },

  // ── Physical station types ────────────────────────────────────────
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]:{ math: 0.9, science: 0.9, history: 0.9, language: 0.8, arts: 0.7, health: 0.9, business: 0.8, religion: 0.8, general: 0.9 },

  // ── Meta / utility types ──────────────────────────────────────────
  [TASK_TYPES.MOOD_CHECKIN]:           { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 1.0, health: 1.0, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.MULTI_PLAYER_FEEDBACK]:  { math: 0.8, science: 0.8, history: 0.8, language: 0.9, arts: 0.9, health: 0.8, business: 0.8, religion: 0.8, general: 0.8 },
  [TASK_TYPES.MIME]:                   { math: 0.2, science: 0.5, history: 0.5, language: 0.8, arts: 1.0, health: 0.7, business: 0.3, religion: 0.4, general: 0.5 },
  [TASK_TYPES.TASK_RUNNER]:            { math: 0.8, science: 0.8, history: 0.8, language: 0.8, arts: 0.8, health: 0.8, business: 0.8, religion: 0.8, general: 0.8 },
  [TASK_TYPES.TOWER_BUILDER]:          { math: 0.9, science: 0.8, history: 0.6, language: 0.5, arts: 0.7, health: 0.6, business: 0.6, religion: 0.5, general: 0.7 },
  [TASK_TYPES.PET_FEEDING]:            { math: 0.7, science: 0.7, history: 0.6, language: 0.7, arts: 0.7, health: 0.7, business: 0.5, religion: 0.6, general: 0.7 },
  [TASK_TYPES.RIDDLE]:                 { math: 0.9, science: 0.9, history: 0.9, language: 1.0, arts: 1.0, health: 0.9, business: 0.9, religion: 0.9, general: 1.0 },
  [TASK_TYPES.TRIVIA]:                 { math: 0.9, science: 0.9, history: 1.0, language: 0.9, arts: 0.9, health: 0.9, business: 0.9, religion: 0.9, general: 1.0 },
  [TASK_TYPES.SPINNER]:                { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 1.0, health: 1.0, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.TEAM_SELFIE]:            { math: 1.0, science: 1.0, history: 1.0, language: 1.0, arts: 1.0, health: 1.0, business: 1.0, religion: 1.0, general: 1.0 },
  [TASK_TYPES.TRUTH_OR_DARE]:          { math: 0.7, science: 0.9, history: 0.95, language: 0.95, arts: 1.0, health: 0.8, business: 0.7, religion: 0.7, general: 0.9 },
  [TASK_TYPES.UPVOTE]:                 { math: 0.5, science: 0.7, history: 1.0,  language: 0.9,  arts: 0.8, health: 0.7, business: 0.9, religion: 1.0,  general: 0.8 },
  // Interview needs a real historical / notable figure relevant to the
  // topic. EVERY discipline has them — Pythagoras / Euclid / Descartes /
  // Newton / Euler for math; Curie / Darwin / Einstein for science;
  // Florence Nightingale / Hippocrates for health; etc. The bug in the
  // Ch7-9 math set (Richard 2026-06-08: "no one to interview") was the
  // AI prompt, not the subject — the prompt now lists mathematicians +
  // scientists explicitly as fair game. Affinities stay high so kids
  // actually meet the people behind the ideas.
  [TASK_TYPES.INTERVIEW]:              { math: 0.85, science: 0.9, history: 1.0, language: 0.9, arts: 0.85, health: 0.85, business: 0.85, religion: 1.0, general: 0.8 },
};

// Subject-detection: map freeform subject strings to affinity bucket keys
const SUBJECT_PATTERNS = [
  { bucket: "math",     pattern: /math|arithmetic|algebra|geometry|calculus|statistics|trig/i },
  { bucket: "science",  pattern: /science|biology|chemistry|physics|ecology|environ|anatomy|astro/i },
  { bucket: "history",  pattern: /hist|social.?studies|geograph|civics|politic|government/i },
  { bucket: "language", pattern: /english|fran[cç]|french|spanish|esl|ell|liter|reading|writing|lang|grammar|immersion/i },
  { bucket: "arts",     pattern: /art(?!h)|music|drama|theater|theatre|creative|visual/i },
  { bucket: "health",   pattern: /health|phys\w*\s*ed|^pe$|fitness|wellness|gym|sport/i },
  { bucket: "business", pattern: /business|economics?|financ|account|market/i },
  { bucket: "religion", pattern: /bible|relig|theolog|faith|church|spirit/i },
];

/**
 * Detect the affinity bucket for a freeform subject string.
 * Returns one of: math, science, history, language, arts, health, business, religion, general.
 */
export function detectSubjectBucket(subject) {
  if (!subject) return "general";
  const s = String(subject).trim();
  for (const { bucket, pattern } of SUBJECT_PATTERNS) {
    if (pattern.test(s)) return bucket;
  }
  return "general";
}

/**
 * Get the affinity weight (0–1) for a task type in a given subject bucket.
 * Falls back to 0.7 (decent universal default) if no entry exists.
 */
export function getSubjectAffinity(taskType, subjectBucket) {
  const entry = SUBJECT_AFFINITY[taskType];
  if (!entry) return 0.7; // unknown type → moderate default
  return entry[subjectBucket] ?? entry.general ?? 0.7;
}

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

  if (
    v === "match" || v === "connect" || v === "line-match" ||
    v === "match-up" || v === "matchup" || v === "pairs" ||
    v === "key-terms-match" || v === "key-terms" || v === "keyterms" ||
    v === "term-match" || v === "vocabulary-match" || v === "vocab-match"
  ) return TASK_TYPES.MATCHING;

  if (
    v === "labelme" || v === "label-me" || v === "label_me" || v === "label" ||
    v === "labeling" || v === "labelling" || v === "diagram-label" ||
    v === "image-label" || v === "map-label"
  ) return TASK_TYPES.LABELME;

  if (v === "venn" || v === "venn-diagram" || v === "venndiagram") return TASK_TYPES.VENNSORT;

  if (v === "jeopardy" || v === "jp") return TASK_TYPES.JEOPARDY;
  
  if (v === "brain-blitz" || v === "brainblitz") return TASK_TYPES.JEOPARDY;

  if (v === "mad-dash" || v === "maddash") return TASK_TYPES.MAD_DASH;

  // Mad Dash Sequence aliases
  if (
    v === "mad-dash-sequence" ||
    v === "maddashsequence" ||
    v === "mad-dash-seq" ||
    v === "mad dash sequence"
  )
    return TASK_TYPES.MAD_DASH_SEQUENCE;

  if (v === "echo-chain" || v === "echochain") return TASK_TYPES.ECHO_CHAIN;
  if (v === "multi-room-scavenger-hunt" || v === "multiroom-scavenger-hunt")
    return TASK_TYPES.HIDENSEEK;    // MULTI-ROOM is not a particular task, but a mode of playing

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

/* ============================================================
   JSON SHELL TEMPLATES -- pre-built task structures with placeholders.

   Instead of asking AI to invent both structure AND content,
   we give it the exact JSON shell and ask it to fill in ONLY
   the content values. This eliminates structural errors.

   Each template function returns:
     { shell: <JSON string with {{PLACEHOLDER}} tokens>,
       fillInstructions: <string telling AI what to put in each placeholder> }

   The generation code sends the shell + instructions to AI, gets
   back a flat { "PLACEHOLDER_NAME": "value", ... } map, and does
   simple string replacement.
   ============================================================ */

export const TASK_SHELLS = {
  [TASK_TYPES.MIND_MAPPER]: function buildMindMapperShell({ itemCount = 6, branchCount = 3 } = {}) {
    // Build branch structures with evenly distributed slots
    const slotsPerBranch = Math.ceil(itemCount / branchCount);
    const branches = [];
    let slotIndex = 0;
    for (let b = 0; b < branchCount; b++) {
      const slots = [];
      for (let s = 0; s < slotsPerBranch && slotIndex < itemCount; s++) {
        slots.push("_____");
        slotIndex++;
      }
      branches.push({
        label: `{{BRANCH_${b + 1}}}`,
        slots,
      });
    }

    const items = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        text: `{{ITEM_${i + 1}}}`,
        correctIndex: i,
      });
    }

    const shell = {
      taskType: "mind-mapper",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      organizerType: "{{ORGANIZER_TYPE}}",
      structure: {
        center: "{{CENTER_TOPIC}}",
        branches,
      },
      items,
      config: {
        centralTopic: "{{CENTER_TOPIC}}",
        difficulty: "{{DIFFICULTY}}",
        structure: "<<COPY_FROM_ROOT>>",
        items: "<<COPY_FROM_ROOT>>",
      },
    };

    // Build the fill instructions
    const placeholders = [
      `TITLE: A short task title (3-7 words) describing this mind-mapping activity`,
      `PROMPT: 1-2 sentence student-facing instructions (e.g., "Drag each term to its correct place in the concept web")`,
      `ORGANIZER_TYPE: one of "mind-map", "hierarchy", "fishbone", "flowchart", "venn", "web" -- pick whichever best fits the topic`,
      `CENTER_TOPIC: The main topic label for the center of the organizer (e.g., "The Water Cycle", "Causes of WWI")`,
      `DIFFICULTY: "easy", "medium", or "hard" -- match the requested difficulty`,
    ];
    for (let b = 0; b < branchCount; b++) {
      placeholders.push(`BRANCH_${b + 1}: A category/branch label -- a real sub-topic name (e.g., "Evaporation", "Alliances"), NEVER "Branch ${b + 1}"`);
    }
    for (let i = 0; i < itemCount; i++) {
      placeholders.push(`ITEM_${i + 1}: A real vocabulary term or concept that belongs in one of the branches -- NEVER "Concept ${i + 1}" or any placeholder`);
    }

    return {
      shell: JSON.stringify(shell, null, 2),
      fillInstructions: placeholders.join("\n"),
      placeholderNames: [
        "TITLE", "PROMPT", "ORGANIZER_TYPE", "CENTER_TOPIC", "DIFFICULTY",
        ...Array.from({ length: branchCount }, (_, i) => `BRANCH_${i + 1}`),
        ...Array.from({ length: itemCount }, (_, i) => `ITEM_${i + 1}`),
      ],
    };
  },

  /* ── MULTIPLE CHOICE ── */
  [TASK_TYPES.MULTIPLE_CHOICE]: function buildMultipleChoiceShell({ itemCount = 4 } = {}) {
    const items = [];
    const placeholders = [
      "TITLE: Short quiz title (3-7 words)",
      "PROMPT: 1-2 sentence student-facing instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < itemCount; i++) {
      const n = i + 1;
      items.push({
        id: `mc${n}`,
        prompt: `{{Q${n}_PROMPT}}`,
        options: [`{{Q${n}_A}}`, `{{Q${n}_B}}`, `{{Q${n}_C}}`, `{{Q${n}_D}}`],
        correctAnswer: `<<Q${n}_CORRECT_INDEX>>`,
      });
      placeholders.push(
        `Q${n}_PROMPT: The question text for question ${n}`,
        `Q${n}_A: Option A (a plausible answer)`,
        `Q${n}_B: Option B (a plausible answer)`,
        `Q${n}_C: Option C (a plausible answer)`,
        `Q${n}_D: Option D (a plausible answer)`,
        `Q${n}_CORRECT_INDEX: The 0-based index (0-3) of the correct option. IMPORTANT: vary across questions -- do NOT always use 0`,
      );
      names.push(`Q${n}_PROMPT`, `Q${n}_A`, `Q${n}_B`, `Q${n}_C`, `Q${n}_D`, `Q${n}_CORRECT_INDEX`);
    }

    const shell = { taskType: "multiple-choice", title: "{{TITLE}}", prompt: "{{PROMPT}}", items };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── PHYSICAL MULTIPLE CHOICE ── */
  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: function buildPhysicalMCShell() {
    // Always exactly 4 questions -- reuse MC shell but fix taskType
    const result = TASK_SHELLS[TASK_TYPES.MULTIPLE_CHOICE]({ itemCount: 4 });
    result.shell = result.shell.replace('"multiple-choice"', '"physical-multiple-choice"');
    return result;
  },

  /* ── MATCHING ── */
  [TASK_TYPES.MATCHING]: function buildMatchingShell({ itemCount = 6 } = {}) {
    const leftItems = [];
    const rightItems = [];
    const correctMatches = {};
    const placeholders = [
      "TITLE: Short matching activity title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < itemCount; i++) {
      const n = i + 1;
      leftItems.push(`{{TERM_${n}}}`);
      rightItems.push(`{{DEF_${n}}}`);
      correctMatches[`{{TERM_${n}}}`] = `{{DEF_${n}}}`;
      placeholders.push(
        `TERM_${n}: A real vocabulary term from the word list -- NEVER "Term ${n}"`,
        `DEF_${n}: A short definition (8-20 words) for TERM_${n}`,
      );
      names.push(`TERM_${n}`, `DEF_${n}`);
    }

    const shell = {
      taskType: "matching",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      leftItems,
      rightItems,
      correctMatches,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── LABEL ME (image labeling) ── */
  [TASK_TYPES.LABELME]: function buildLabelMeShell() {
    const LETTERS = ["A", "B", "C", "D", "E"];
    const placeholders = [
      "TITLE: Short labeling activity title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions (e.g. 'Match each marker A-E to the correct part.')",
      "IMAGE_PROMPT: A detailed prompt to generate ONE clean, high-contrast, uncluttered educational diagram / map / illustration relevant to the topic. NO letters or text labels drawn on it (the app overlays A-E markers). Simple flat style, white/neutral background, age-appropriate.",
    ];
    const names = ["TITLE", "PROMPT", "IMAGE_PROMPT"];
    const labels = [];
    const options = [];
    for (const L of LETTERS) {
      placeholders.push(
        `${L}_TERM: The correct term/part for marker ${L} (a real feature of the diagram)`,
        `${L}_X: Horizontal position of feature ${L} as a percent 0-100 (left→right)`,
        `${L}_Y: Vertical position of feature ${L} as a percent 0-100 (top→bottom)`,
      );
      names.push(`${L}_TERM`, `${L}_X`, `${L}_Y`);
      labels.push({ id: L, correct: `{{${L}_TERM}}`, x: `<<${L}_X>>`, y: `<<${L}_Y>>` });
      options.push(`{{${L}_TERM}}`);
    }
    const shell = {
      taskType: "labelme",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      imagePrompt: "{{IMAGE_PROMPT}}",
      labels,
      options,
      grading: { exactMatch: true, partialCredit: true },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── VENNSORT ── */
  [TASK_TYPES.VENNSORT]: function buildVennSortShell({
    aOnlyCount = 3,
    bOnlyCount = 3,
    bothCount = 3,
  } = {}) {
    // 2-circle Venn with EXPLICIT regions baked into the shell so the AI
    // physically cannot ship an empty overlap. catA/catB are the only two
    // category placeholders; each item carries a fixed categories array
    // that depends on which region it's filling.
    const placeholders = [
      "TITLE: Short sorting activity title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions, e.g. 'Drag each term into the right region.'",
      "CAT_A: First category name. Must overlap meaningfully with CAT_B (e.g. 'Mammals' vs 'Flying animals' — bat is in both).",
      "CAT_B: Second category name. NEVER use 'Both' or 'Overlap' as a third category — overlap is represented by items in the BOTH region below.",
    ];
    const names = ["TITLE", "PROMPT", "CAT_A", "CAT_B"];

    const items = [];
    const correctAnswer = {};

    let n = 1;
    for (let i = 0; i < aOnlyCount; i += 1, n += 1) {
      const id = `vs-${n}`;
      items.push({ id, text: `{{ITEM_${n}}}`, categories: ["{{CAT_A}}"] });
      correctAnswer[id] = ["{{CAT_A}}"];
      placeholders.push(`ITEM_${n}: A real vocabulary term that belongs ONLY in CAT_A (not also in CAT_B).`);
      names.push(`ITEM_${n}`);
    }
    for (let i = 0; i < bOnlyCount; i += 1, n += 1) {
      const id = `vs-${n}`;
      items.push({ id, text: `{{ITEM_${n}}}`, categories: ["{{CAT_B}}"] });
      correctAnswer[id] = ["{{CAT_B}}"];
      placeholders.push(`ITEM_${n}: A real vocabulary term that belongs ONLY in CAT_B (not also in CAT_A).`);
      names.push(`ITEM_${n}`);
    }
    for (let i = 0; i < bothCount; i += 1, n += 1) {
      const id = `vs-${n}`;
      items.push({ id, text: `{{ITEM_${n}}}`, categories: ["{{CAT_A}}", "{{CAT_B}}"] });
      correctAnswer[id] = ["{{CAT_A}}", "{{CAT_B}}"];
      placeholders.push(`ITEM_${n}: A real vocabulary term that belongs in BOTH CAT_A AND CAT_B (overlap region — defensible membership in each).`);
      names.push(`ITEM_${n}`);
    }

    const shell = {
      taskType: "vennsort",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { categories: ["{{CAT_A}}", "{{CAT_B}}"], items },
      correctAnswer,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── JEOPARDY (BrainBlitz) ── */
  [TASK_TYPES.JEOPARDY]: function buildJeopardyShell({ itemCount = 6 } = {}) {
    const clueCount = Math.max(6, itemCount);
    const clues = Array.from({ length: clueCount }, (_, i) => ({
      clue: `{{CLUE_${i + 1}}}`,
      answer: `{{ANSWER_${i + 1}}}`,
    }));
    const placeholders = [
      "TITLE: Short BrainBlitz title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < clueCount; i++) {
      placeholders.push(`CLUE_${i + 1}: A descriptive hint about ANSWER_${i + 1} — a fact or description students can use to guess the word`);
      placeholders.push(`ANSWER_${i + 1}: A different vocabulary word or concept (each clue MUST have a UNIQUE answer — no repeats)`);
      names.push(`CLUE_${i + 1}`, `ANSWER_${i + 1}`);
    }

    const shell = {
      taskType: "jeopardy",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      clues,
      config: { clues: "<<COPY_CLUES>>" },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── FAKE OUT ── */
  [TASK_TYPES.FAKE_OUT]: function buildFakeOutShell({ itemCount = 4 } = {}) {
    const roundCount = Math.max(3, itemCount);
    const rounds = [];
    const placeholders = [
      "TITLE: Short FakeOut game title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let r = 0; r < roundCount; r++) {
      const n = r + 1;
      rounds.push({
        prompt: `{{R${n}_PROMPT}}`,
        options: [`{{R${n}_OPT_A}}`, `{{R${n}_OPT_B}}`, `{{R${n}_OPT_C}}`],
        correctIndex: `<<R${n}_CORRECT_INDEX>>`,
        correctOption: `{{R${n}_CORRECT_OPT}}`,
        jokeOption: `{{R${n}_JOKE}}`,
        jokeIndex: `<<R${n}_JOKE_INDEX>>`,
      });
      placeholders.push(
        `R${n}_PROMPT: The question for round ${n}`,
        `R${n}_OPT_A: A plausible answer option`,
        `R${n}_OPT_B: A plausible answer option`,
        `R${n}_OPT_C: A plausible answer option`,
        `R${n}_CORRECT_INDEX: 0-based index (0-2) of the correct option among OPT_A/B/C. Vary across rounds.`,
        `R${n}_CORRECT_OPT: The text of the correct option (must match the option at CORRECT_INDEX exactly)`,
        `R${n}_JOKE: A funny but clearly wrong option (will be inserted separately -- must NOT match any of OPT_A/B/C)`,
        `R${n}_JOKE_INDEX: 0-3, position where the joke option gets inserted into the displayed choices`,
      );
      names.push(`R${n}_PROMPT`, `R${n}_OPT_A`, `R${n}_OPT_B`, `R${n}_OPT_C`, `R${n}_CORRECT_INDEX`, `R${n}_CORRECT_OPT`, `R${n}_JOKE`, `R${n}_JOKE_INDEX`);
    }

    const shell = {
      taskType: "fake-out",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { rounds },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── MAD DASH SEQUENCE ── */
  [TASK_TYPES.MAD_DASH_SEQUENCE]: function buildMadDashSequenceShell({ itemCount = 4 } = {}) {
    const count = Math.max(3, Math.min(5, itemCount));
    const items = Array.from({ length: count }, (_, i) => `{{STEP_${i + 1}}}`);
    const placeholders = [
      "TITLE: Short sequence puzzle title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < count; i++) {
      placeholders.push(`STEP_${i + 1}: One step in the process. List steps in the CORRECT order -- the system will auto-scramble them.`);
      names.push(`STEP_${i + 1}`);
    }

    // We give them in correct order with trivial correctOrder -- the sanitizer auto-scrambles
    const shell = {
      taskType: "mad-dash-sequence",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        items,
        correctOrder: Array.from({ length: count }, (_, i) => i),
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── HANGMAN DUEL ── */
  [TASK_TYPES.HANGMAN_DUEL]: function buildHangmanDuelShell() {
    const wordsByStation = [];
    const placeholders = [
      "TITLE: Short hangman game title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < 8; i++) {
      const n = i + 1;
      wordsByStation.push({ word: `{{WORD_${n}}}`, hint: `{{HINT_${n}}}` });
      placeholders.push(
        `WORD_${n}: A vocabulary word -- PURE ALPHABETIC only (A-Z, no hyphens/numbers/apostrophes). Pick from the word list.`,
        `HINT_${n}: A real definition or context clue for WORD_${n} (NOT "Think about this word")`,
      );
      names.push(`WORD_${n}`, `HINT_${n}`);
    }

    const shell = {
      taskType: "hangman-duel",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      wordsByStation,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── FLASHCARDS ── */
  [TASK_TYPES.FLASHCARDS]: function buildFlashcardsShell({ itemCount = 12 } = {}) {
    const count = Math.max(5, itemCount);
    const items = [];
    const placeholders = [
      "TITLE: Short flashcard set title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      items.push({ question: `{{FRONT_${n}}}`, answer: `{{BACK_${n}}}` });
      placeholders.push(
        `FRONT_${n}: A vocabulary term from the word list -- NEVER "Term ${n}"`,
        `BACK_${n}: A clear definition or explanation for FRONT_${n}`,
      );
      names.push(`FRONT_${n}`, `BACK_${n}`);
    }

    const shell = {
      taskType: "flashcards",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { items },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── FLASHCARDS RACE ── */
  [TASK_TYPES.FLASHCARDS_RACE]: function buildFlashcardsRaceShell({ itemCount = 10 } = {}) {
    const count = Math.max(5, itemCount);
    const items = [];
    const placeholders = [
      "TITLE: Short flashcard race title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      items.push({ question: `{{CLUE_${n}}}`, answer: `{{TERM_${n}}}` });
      placeholders.push(
        `CLUE_${n}: A definition or clue that describes TERM_${n}`,
        `TERM_${n}: The vocabulary term (the answer students race to type)`,
      );
      names.push(`CLUE_${n}`, `TERM_${n}`);
    }

    const shell = {
      taskType: "flashcards-race",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { items },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── PET FEEDING ── */
  [TASK_TYPES.PET_FEEDING]: function buildPetFeedingShell({ itemCount = 7 } = {}) {
    const count = Math.max(6, itemCount);
    const goodFoods = Array.from({ length: count }, (_, i) => `{{TRUE_${i + 1}}}`);
    const badFoods = Array.from({ length: count }, (_, i) => `{{FALSE_${i + 1}}}`);
    const placeholders = [
      "TITLE: Short pet feeding game title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      placeholders.push(`TRUE_${n}: A TRUE factual statement about the topic (1 sentence)`);
      names.push(`TRUE_${n}`);
    }
    for (let i = 0; i < count; i++) {
      const n = i + 1;
      placeholders.push(`FALSE_${n}: A FALSE factual statement about the topic (1 sentence, clearly wrong)`);
      names.push(`FALSE_${n}`);
    }

    const shell = {
      taskType: "pet-feeding",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      goodFoods,
      badFoods,
      config: { goal: 5, pack: "classic" },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── MUSICAL CHAIRS ── */
  [TASK_TYPES.MUSICAL_CHAIRS]: function buildMusicalChairsShell() {
    const items = [];
    const placeholders = [
      "TITLE: Short musical chairs quiz title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < 7; i++) {
      const n = i + 1;
      items.push({
        id: `chair${n}`,
        prompt: `{{Q${n}_PROMPT}}`,
        options: [`{{Q${n}_A}}`, `{{Q${n}_B}}`, `{{Q${n}_C}}`],
        correctAnswer: `<<Q${n}_CORRECT_INDEX>>`,
      });
      placeholders.push(
        `Q${n}_PROMPT: A quick tap-style question`,
        `Q${n}_A: Option A`,
        `Q${n}_B: Option B`,
        `Q${n}_C: Option C`,
        `Q${n}_CORRECT_INDEX: 0-based index (0-2) of the correct option. Vary across questions.`,
      );
      names.push(`Q${n}_PROMPT`, `Q${n}_A`, `Q${n}_B`, `Q${n}_C`, `Q${n}_CORRECT_INDEX`);
    }

    const shell = {
      taskType: "musical-chairs",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      items,
      config: { rounds: 7, items: "<<COPY_FROM_ROOT>>" },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── ROLE PLAY DECK ── */
  [TASK_TYPES.ROLE_PLAY_DECK]: function buildRolePlayDeckShell({ itemCount = 4 } = {}) {
    // Shape MUST match RolePlayDeckTask.jsx renderer:
    //   role = { name, role, characteristics: string[], gender }
    // The previous shell emitted {goal, constraint} fields that the
    // renderer ignored entirely — audit punch-list #5.
    const roleCount = Math.max(3, itemCount);
    const roles = [];
    const placeholders = [
      "TITLE: Short role-play activity title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
      "SCENARIO: 2-4 sentences describing the situation students will role-play in",
    ];
    const names = ["TITLE", "PROMPT", "SCENARIO"];

    for (let i = 0; i < roleCount; i++) {
      const n = i + 1;
      roles.push({
        name: `{{ROLE_${n}_NAME}}`,
        role: `{{ROLE_${n}_ROLE}}`,
        characteristics: [
          `{{ROLE_${n}_TRAIT_1}}`,
          `{{ROLE_${n}_TRAIT_2}}`,
          `{{ROLE_${n}_TRAIT_3}}`,
        ],
        gender: `{{ROLE_${n}_GENDER}}`,
      });
      placeholders.push(
        `ROLE_${n}_NAME: A specific CHARACTER NAME (e.g. "Sir Isaac Brock", "Pythagoras", "Ada the Algebra Apprentice") — NEVER "Role A" or "Role ${n}"`,
        `ROLE_${n}_ROLE: One-line description of who they are and why they're in the scenario (e.g. "British general defending Upper Canada")`,
        `ROLE_${n}_TRAIT_1: One short adjective trait (e.g. "decisive")`,
        `ROLE_${n}_TRAIT_2: One short adjective trait (e.g. "loyal")`,
        `ROLE_${n}_TRAIT_3: One short adjective trait (e.g. "tactical")`,
        `ROLE_${n}_GENDER: One of "male" | "female" | "nonbinary" — used by the renderer's avatar picker.`,
      );
      names.push(
        `ROLE_${n}_NAME`,
        `ROLE_${n}_ROLE`,
        `ROLE_${n}_TRAIT_1`,
        `ROLE_${n}_TRAIT_2`,
        `ROLE_${n}_TRAIT_3`,
        `ROLE_${n}_GENDER`,
      );
    }

    const shell = {
      taskType: "role-play-deck",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { scenario: "{{SCENARIO}}", roles },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── BRAIN SPARK NOTES ── */
  [TASK_TYPES.BRAIN_SPARK_NOTES]: function buildBrainSparkNotesShell({ itemCount = 4 } = {}) {
    const keyTermCount = Math.max(3, Math.min(6, itemCount));
    const mainPointCount = Math.max(3, Math.min(5, itemCount));

    const keyTerms = [];
    const mainPoints = [];
    const placeholders = [
      "TITLE: Short note-taking title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
      "HEADING: The heading for the notes (e.g., the topic name)",
      "SUMMARY_1: First summary sentence -- a key takeaway",
      "SUMMARY_2: Second summary sentence -- another key takeaway",
    ];
    const names = ["TITLE", "PROMPT", "HEADING", "SUMMARY_1", "SUMMARY_2"];

    for (let i = 0; i < keyTermCount; i++) {
      const n = i + 1;
      keyTerms.push({
        term: `{{KT_${n}_TERM}}`,
        definition: `{{KT_${n}_DEF}}`,
        points: [`{{KT_${n}_PT1}}`, `{{KT_${n}_PT2}}`],
      });
      placeholders.push(
        `KT_${n}_TERM: A vocabulary term`,
        `KT_${n}_DEF: Definition of KT_${n}_TERM`,
        `KT_${n}_PT1: A key point or fact about this term`,
        `KT_${n}_PT2: Another key point or fact about this term`,
      );
      names.push(`KT_${n}_TERM`, `KT_${n}_DEF`, `KT_${n}_PT1`, `KT_${n}_PT2`);
    }

    for (let i = 0; i < mainPointCount; i++) {
      const n = i + 1;
      mainPoints.push({
        heading: `{{MP_${n}_HEADING}}`,
        bullets: [`{{MP_${n}_B1}}`, `{{MP_${n}_B2}}`],
      });
      placeholders.push(
        `MP_${n}_HEADING: A sub-topic heading for main point ${n}`,
        `MP_${n}_B1: First bullet point under this heading`,
        `MP_${n}_B2: Second bullet point under this heading`,
      );
      names.push(`MP_${n}_HEADING`, `MP_${n}_B1`, `MP_${n}_B2`);
    }

    const shell = {
      taskType: "brain-spark-notes",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      notes: {
        heading: "{{HEADING}}",
        keyTerms,
        mainPoints,
        summary: ["{{SUMMARY_1}}", "{{SUMMARY_2}}"],
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── TRUE FALSE CONNECT FOUR ── */
  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: function buildTFConnectFourShell({ itemCount = 12 } = {}) {
    const count = Math.max(9, itemCount); // 9 min for tic-tac-toe reuse, 10+ for connect four
    const items = [];
    const placeholders = [
      "TITLE: Short Connect Four quiz title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      items.push({ text: `{{STMT_${n}}}`, isFalse: `<<STMT_${n}_IS_FALSE>>` });
      placeholders.push(
        `STMT_${n}: A factual statement about the topic that is either clearly true or clearly false`,
        `STMT_${n}_IS_FALSE: "true" if the statement is FALSE, "false" if the statement is TRUE. Aim for roughly 50/50 mix.`,
      );
      names.push(`STMT_${n}`, `STMT_${n}_IS_FALSE`);
    }

    const shell = {
      taskType: "true-false-connect-four",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      items,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── TRUE FALSE TIC TAC TOE ── */
  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: function buildTFTicTacToeShell() {
    // TicTacToe requires EXACTLY 9 statements (3x3 board)
    const result = TASK_SHELLS[TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]({ itemCount: 9 });
    const shell = JSON.parse(result.shell);
    shell.taskType = "true-false-tictactoe";
    return { ...result, shell: JSON.stringify(shell, null, 2) };
  },

  /* ── SORT ── */
  [TASK_TYPES.SORT]: function buildSortShell({ itemCount = 8, branchCount = 2 } = {}) {
    const bucketCount = Math.max(2, Math.min(4, branchCount));
    const count = Math.max(6, itemCount);
    const placeholders = [
      "TITLE: Short sorting activity title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
    ];
    const names = ["TITLE", "PROMPT"];

    const buckets = [];
    for (let b = 0; b < bucketCount; b++) {
      buckets.push(`{{BUCKET_${b + 1}}}`);
      placeholders.push(`BUCKET_${b + 1}: Category name -- a real thematic grouping, NEVER "Category ${b + 1}"`);
      names.push(`BUCKET_${b + 1}`);
    }

    const items = [];
    for (let i = 0; i < count; i++) {
      const n = i + 1;
      items.push({ text: `{{SORT_ITEM_${n}}}`, bucketIndex: `<<SORT_ITEM_${n}_BUCKET>>` });
      placeholders.push(
        `SORT_ITEM_${n}: A specific vocabulary term -- NEVER "Item ${n}"`,
        `SORT_ITEM_${n}_BUCKET: 0-based index of which bucket this item belongs to (0-${bucketCount - 1}). Distribute items roughly evenly across buckets.`,
      );
      names.push(`SORT_ITEM_${n}`, `SORT_ITEM_${n}_BUCKET`);
    }

    const shell = {
      taskType: "sort",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { buckets },
      items,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── GUESS WHO ── */
  [TASK_TYPES.GUESS_WHO]: function buildGuessWhoShell({ itemCount = 4 } = {}) {
    // GuessWhoTask.jsx renders ONLY config.secretAnswers[]. The previous
    // shell emitted config.items[].facts which the renderer ignored
    // entirely — every fact was a wasted token. Audit punch-list #14.
    const count = Math.max(3, Math.min(6, itemCount));
    const secretAnswers = [];
    const placeholders = [
      "TITLE: Short Guess Who game title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions (mention 'yes/no questions' and the guess budget)",
      "CATEGORY: Short topic label (e.g. 'Key Figures of the Renaissance')",
    ];
    const names = ["TITLE", "PROMPT", "CATEGORY"];

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      secretAnswers.push(`{{CANDIDATE_${n}}}`);
      placeholders.push(
        `CANDIDATE_${n}: A real, named PERSON relevant to the topic (historical figure, scientist, author, leader, inventor, artist) — NEVER a concept or vocabulary word`,
      );
      names.push(`CANDIDATE_${n}`);
    }

    const shell = {
      taskType: "guess-who",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: { secretAnswers, category: "{{CATEGORY}}", maxGuesses: 10 },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── LETTER ── */
  [TASK_TYPES.LETTER]: function buildLetterShell({ itemCount = 6 } = {}) {
    const conceptCount = Math.max(4, itemCount);
    const relevantConcepts = Array.from({ length: conceptCount }, (_, i) => `{{CONCEPT_${i + 1}}}`);
    const placeholders = [
      "TITLE: Short letter-writing task title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
      'CHARACTER: Full name of the character students write as (e.g., "Benjamin Franklin")',
      "CHARACTER_DESC: 1-2 sentence description of who the character is",
      'LETTER_STYLE: "business" or "friendly"',
      "TOPIC_CONTEXT: What the letter should be about (1-2 sentences)",
    ];
    const names = ["TITLE", "PROMPT", "CHARACTER", "CHARACTER_DESC", "LETTER_STYLE", "TOPIC_CONTEXT"];

    for (let i = 0; i < conceptCount; i++) {
      placeholders.push(`CONCEPT_${i + 1}: A vocabulary term students can use for bonus points`);
      names.push(`CONCEPT_${i + 1}`);
    }

    const shell = {
      taskType: "letter",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        character: "{{CHARACTER}}",
        characterDescription: "{{CHARACTER_DESC}}",
        letterStyle: "{{LETTER_STYLE}}",
        topicContext: "{{TOPIC_CONTEXT}}",
        relevantConcepts,
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── CASE STUDY ── */
  [TASK_TYPES.CASE_STUDY]: function buildCaseStudyShell({ itemCount = 5 } = {}) {
    const conceptCount = Math.max(4, itemCount);
    const relevantConcepts = Array.from({ length: conceptCount }, (_, i) => `{{CONCEPT_${i + 1}}}`);
    const placeholders = [
      "TITLE: Short case study title (3-7 words)",
      "PROMPT: 1-2 sentence student instructions",
      "SCENARIO: 2-4 sentences describing a realistic problem or dilemma -- must present a genuine open-ended problem, not just background info",
      'EXPERT_ROLE: Who evaluates the response (e.g., "History Professor", "Environmental Scientist")',
      "EXPERT_DESC: 1 sentence describing the expert",
    ];
    const names = ["TITLE", "PROMPT", "SCENARIO", "EXPERT_ROLE", "EXPERT_DESC"];

    for (let i = 0; i < conceptCount; i++) {
      placeholders.push(`CONCEPT_${i + 1}: A vocabulary term relevant to the case`);
      names.push(`CONCEPT_${i + 1}`);
    }

    const shell = {
      taskType: "case-study",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        scenario: "{{SCENARIO}}",
        expertRole: "{{EXPERT_ROLE}}",
        expertDescription: "{{EXPERT_DESC}}",
        relevantConcepts,
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── STORYTELLING ── */
  [TASK_TYPES.STORYTELLING]: function buildStorytellingShell({ itemCount = 6 } = {}) {
    const vocabCount = Math.max(4, itemCount);
    const vocabWords = Array.from({ length: vocabCount }, (_, i) => `{{VOCAB_${i + 1}}}`);
    const placeholders = [
      "TITLE: Short storytelling task title (3-7 words, e.g., 'A Tale of Ancient Rome')",
      "PROMPT: 1-2 sentence student instructions telling them to build characters and generate a story",
      "SETTING: 1-2 sentences describing the world/place/era (e.g., 'Ancient Rome during the height of the Empire, where senators debate in marble halls and legions march along cobblestone roads')",
      "TOPIC_CONTEXT: 1-2 sentences about the lesson topic the story should incorporate",
      'GENRE: One of: "adventure", "mystery", "comedy", "historical fiction", "fantasy", "sci-fi"',
      'SHOW_NATIONALITY: true for history/literature/social studies topics, false for science/math',
    ];
    const names = ["TITLE", "PROMPT", "SETTING", "TOPIC_CONTEXT", "GENRE", "SHOW_NATIONALITY"];

    for (let i = 0; i < vocabCount; i++) {
      placeholders.push(`VOCAB_${i + 1}: A vocabulary term from the word bank to weave into the story`);
      names.push(`VOCAB_${i + 1}`);
    }

    const shell = {
      taskType: "storytelling",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        setting: "{{SETTING}}",
        topicContext: "{{TOPIC_CONTEXT}}",
        genre: "{{GENRE}}",
        showNationality: "<<SHOW_NATIONALITY>>",
        vocabWords,
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── DIFF DETECTIVE ── */
  [TASK_TYPES.DIFF_DETECTIVE]: function buildDiffDetectiveShell() {
    const diffCount = 5;

    const roll = Math.random();

    // COMPARE TWO REAL SUBJECTS (e.g. "a 1950s microscope" vs "a 2025
    // microscope"). The model emits two image subjects + short descriptions +
    // the expected observable differences; the backend pre-generates the two
    // images at taskset-creation time (AI-gen or photo search per the teacher's
    // setting) so render is instant. See backend/services/taskImageGen.js.
    if (roll < 0.33) {
      const cmpPlaceholders = [
        "TITLE: Short Diff Detective title (3-7 words)",
        `PROMPT: 1-2 sentence instructions — tell students to find the ${diffCount} differences between the two images.`,
        "SUBJECT_A: A concrete, depictable image subject (3-8 words), e.g. \"a 1950s optical microscope\" or \"a Monarch butterfly\".",
        "SUBJECT_B: A RELATED but different depictable subject to compare against SUBJECT_A, e.g. \"a 2025 digital microscope\" or \"a Viceroy butterfly\".",
        "DESC_A: 1-2 sentence description of SUBJECT_A (used if an image can't be sourced).",
        "DESC_B: 1-2 sentence description of SUBJECT_B (used if an image can't be sourced).",
      ];
      const cmpNames = ["TITLE", "PROMPT", "SUBJECT_A", "SUBJECT_B", "DESC_A", "DESC_B"];
      const cmpDifferences = [];
      for (let i = 0; i < diffCount; i++) {
        cmpPlaceholders.push(
          `DIFF_${i + 1}: Difference ${i + 1} — one clear sentence describing a difference students should observe between SUBJECT_A and SUBJECT_B.`
        );
        cmpNames.push(`DIFF_${i + 1}`);
        cmpDifferences.push({ expected: `{{DIFF_${i + 1}}}` });
      }
      const cmpShell = {
        taskType: "diff-detective",
        title: "{{TITLE}}",
        prompt: "{{PROMPT}}",
        mode: "compare",
        subjectA: "{{SUBJECT_A}}",
        subjectB: "{{SUBJECT_B}}",
        imagePromptA: "{{SUBJECT_A}}",
        imagePromptB: "{{SUBJECT_B}}",
        labelA: "{{SUBJECT_A}}",
        labelB: "{{SUBJECT_B}}",
        original: "{{DESC_A}}",
        modified: "{{DESC_B}}",
        differences: cmpDifferences,
        totalDifferences: diffCount,
      };
      return {
        shell: JSON.stringify(cmpShell, null, 2),
        fillInstructions: cmpPlaceholders.join("\n"),
        placeholderNames: cmpNames,
      };
    }

    // VISUAL scene mode (tester: "gen must supply 2 images"). We ask only for a
    // short list of topic items; normalizeTaskByType then deterministically
    // renders TWO SVG images (Scene A + Scene B with exactly N differences)
    // plus the exact answer key — fully generated, no curation, no external
    // image URLs. See shared/diffDetectiveScene.js.
    if (roll < 0.66) {
      const itemCount = 8;
      const scenePlaceholders = [
        "TITLE: Short Diff Detective title (3-7 words)",
        `PROMPT: 1-2 sentence instructions — tell students to spot the ${diffCount} differences between Scene A and Scene B.`,
        `ITEMS: EXACTLY ${itemCount} short, distinct, topic-relevant labels (1-2 words each) that belong together in one scene or diagram, separated by " | " (e.g., "Sun | Cloud | Rain | River | Ocean | Mountain | Tree | Soil").`,
      ];
      const sceneShell = {
        taskType: "diff-detective",
        title: "{{TITLE}}",
        prompt: "{{PROMPT}}",
        mode: "scene",
        sceneItems: "{{ITEMS}}",
      };
      return {
        shell: JSON.stringify(sceneShell, null, 2),
        fillInstructions: scenePlaceholders.join("\n"),
        placeholderNames: ["TITLE", "PROMPT", "ITEMS"],
      };
    }

    // Tester ask: diff-detective should compare more than just an edited
    // passage — "two art pics, two documents, two historical figures, two
    // specimens, two scenes, two definitions, two processes, two pieces of
    // equipment". The generator produces TEXT, so visual subjects become rich
    // written descriptions; students spot the differences between the two. One
    // subject type is chosen per task so demo + generated sets vary.
    const COMPARE_TYPES = [
      { mode: "text", labelA: "Original", labelB: "Modified", arrow: true,
        a: "Original text passage (3-6 sentences) with real subject-matter content.",
        b: `A modified copy of TEXT_A with EXACTLY ${diffCount} deliberate changes (changed words, added/removed details, altered facts).` },
      { mode: "compare", labelA: "Definition A", labelB: "Definition B", arrow: false,
        a: "A clear definition/explanation of one key concept (3-6 sentences).",
        b: `A definition of a RELATED but different concept — similar on the surface but differing in EXACTLY ${diffCount} meaningful ways.` },
      { mode: "compare", labelA: "Process A", labelB: "Process B", arrow: false,
        a: "A step-by-step description of one process (3-6 sentences).",
        b: `A similar process that differs in EXACTLY ${diffCount} important ways.` },
      { mode: "compare", labelA: "Document A", labelB: "Document B", arrow: false,
        a: "A short primary-source style document excerpt (3-6 sentences).",
        b: `A second excerpt on the same topic differing in EXACTLY ${diffCount} notable ways (claims, dates, tone, details).` },
      { mode: "compare", labelA: "Figure A", labelB: "Figure B", arrow: false,
        a: "A vivid description of one historical figure (who, when, contributions) in 3-6 sentences.",
        b: `A description of a DIFFERENT but comparable historical figure, differing in EXACTLY ${diffCount} ways.` },
      { mode: "compare", labelA: "Specimen A", labelB: "Specimen B", arrow: false,
        a: "A description of one organism/specimen (features, habitat, traits) in 3-6 sentences.",
        b: `A related specimen that differs in EXACTLY ${diffCount} observable ways.` },
      { mode: "compare", labelA: "Scene A", labelB: "Scene B", arrow: false,
        a: "A description of one scene/setting (3-6 sentences).",
        b: `A very similar scene with EXACTLY ${diffCount} differences (spot-the-difference style).` },
      { mode: "compare", labelA: "Artwork A", labelB: "Artwork B", arrow: false,
        a: "A description of one artwork (subject, style, composition, colors) in 3-6 sentences.",
        b: `A comparable artwork differing in EXACTLY ${diffCount} ways.` },
      { mode: "compare", labelA: "Item A", labelB: "Item B", arrow: false,
        a: "A description of one piece of equipment/tool (parts, purpose, use) in 3-6 sentences.",
        b: `A similar piece of equipment differing in EXACTLY ${diffCount} ways.` },
    ];
    const pick = COMPARE_TYPES[Math.floor(Math.random() * COMPARE_TYPES.length)];

    const placeholders = [
      "TITLE: Short Diff Detective title (3-7 words)",
      `PROMPT: 1-2 sentence student instructions — tell them to find the ${diffCount} differences between ${pick.labelA} and ${pick.labelB}.`,
      `TEXT_A (${pick.labelA}): ${pick.a}`,
      `TEXT_B (${pick.labelB}): ${pick.b}`,
    ];
    const names = ["TITLE", "PROMPT", "TEXT_A", "TEXT_B"];

    const differences = [];
    for (let i = 0; i < diffCount; i++) {
      placeholders.push(
        pick.arrow
          ? `DIFF_${i + 1}: Difference ${i + 1}, written EXACTLY as "original phrase → modified phrase" — copy the exact words from TEXT_A and TEXT_B separated by the → arrow.`
          : `DIFF_${i + 1}: Difference ${i + 1} — one clear sentence stating how ${pick.labelA} and ${pick.labelB} differ on a specific point.`
      );
      names.push(`DIFF_${i + 1}`);
      differences.push({ expected: `{{DIFF_${i + 1}}}` });
    }

    const shell = {
      taskType: "diff-detective",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      mode: pick.mode,
      labelA: pick.labelA,
      labelB: pick.labelB,
      original: "{{TEXT_A}}",
      modified: "{{TEXT_B}}",
      differences,
      totalDifferences: diffCount,
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── DRAW MIME ── */
  [TASK_TYPES.DRAW_MIME]: function buildDrawMimeShell() {
    const placeholders = [
      "TITLE: Short draw/mime title (3-7 words, e.g., 'Draw: Key Concepts')",
      "CLUE_1: First drawable/actable concept (1-3 words) -- this will also be the prompt",
      "CLUE_2: Second drawable/actable concept (1-3 words)",
      "CLUE_3: Third drawable/actable concept (1-3 words)",
      "CLUE_4: Fourth drawable/actable concept (1-3 words)",
    ];
    const names = ["TITLE", "CLUE_1", "CLUE_2", "CLUE_3", "CLUE_4"];

    const shell = {
      taskType: "draw-mime",
      title: "{{TITLE}}",
      prompt: "{{CLUE_1}}",
      clues: ["{{CLUE_1}}", "{{CLUE_2}}", "{{CLUE_3}}", "{{CLUE_4}}"],
      config: { mode: "EITHER" },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  /* ── TEACH-BACK ── */
  [TASK_TYPES.TEACH_BACK]: function buildTeachBackShell({ itemCount = 4 } = {}) {
    const conceptCount = Math.max(3, Math.min(5, itemCount));
    const placeholders = [
      "TITLE: Short title (3-7 words, e.g., 'Teach: The Water Cycle')",
      "PROMPT: Student-facing instruction (e.g., 'Explain these concepts as if teaching a 2nd grader. Use simple words!')",
      "TARGET_AGE: Target audience description (e.g., 'a 2nd grader' or 'a 5-year-old') — should be roughly grade_level minus 3-4 years",
      "RUBRIC: Short 1-2 sentence AI scoring rubric (e.g., 'Award points for clear, accurate, age-appropriate explanations.')",
    ];
    const names = ["TITLE", "PROMPT", "TARGET_AGE", "RUBRIC"];

    for (let i = 1; i <= conceptCount; i++) {
      placeholders.push(`CONCEPT_${i}: A key vocabulary term or concept from the word list (2-5 words) — pick a REAL term the student should be able to explain`);
      names.push(`CONCEPT_${i}`);
    }

    const concepts = [];
    for (let i = 1; i <= conceptCount; i++) concepts.push(`{{CONCEPT_${i}}}`);

    const shell = {
      taskType: "teach-back",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      concepts,
      targetAge: "{{TARGET_AGE}}",
      config: { rubric: "{{RUBRIC}}" },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  // NOTE: peer-editing intentionally omitted from TASK_SHELLS.
  // The passage and error word-indices are interdependent — the AI must co-generate them
  // in a single JSON object. Template placeholder filling can't handle this reliably
  // because LLMs miscounted 0-based word indices through the fill-in-the-blank approach.
  // Instead, peer-editing uses the freeform aiPrompt path exclusively.

  /* ── WHAT AM I? ── */
  [TASK_TYPES.WHAT_AM_I]: function buildWhatAmIShell({ clueCount = 4 } = {}) {
    // Clamp clueCount into the allowed band
    const N = Math.max(3, Math.min(6, Number(clueCount) || 4));

    const clues = [];
    const placeholders = [
      "TITLE: Short, intriguing title (3-7 words) — e.g. 'What Am I? — A Pivotal Report'",
      "PROMPT: 1-2 sentence student-facing instructions — explain that earlier guesses = more points",
      "ANSWER: The canonical name of the concept (string) — e.g. 'Lord Durham's Report'",
      "ACCEPTABLE_ANSWERS: A comma-separated list of 2-4 variant phrasings (lowercase is fine). e.g. 'durham report, lord durham report, the durham report'",
      "DIFFICULTY: 'easy' | 'medium' | 'hard' | 'expert' — match the requested difficulty",
    ];
    const names = ["TITLE", "PROMPT", "ANSWER", "ACCEPTABLE_ANSWERS", "DIFFICULTY"];

    for (let i = 1; i <= N; i++) {
      clues.push({ level: i, text: `{{CLUE_${i}}}` });
      if (i === 1) {
        placeholders.push(
          `CLUE_${i}: BROADEST clue — focus on EFFECT, IMPACT, PURPOSE, or CONCEPTUAL IDENTITY. NOT a dictionary definition. MUST NOT contain the answer or close synonyms. Example: "My recommendations helped shape responsible government in Canada."`,
        );
      } else if (i === N) {
        placeholders.push(
          `CLUE_${i}: MOST specific clue — may name a closely-associated thing (e.g. an author's family name) but MUST NOT state the answer verbatim. This is the near-giveaway tier.`,
        );
      } else {
        placeholders.push(
          `CLUE_${i}: Narrower than CLUE_${i - 1}, broader than CLUE_${i + 1}. Adds historical/scientific/social context. Encourages inference. MUST NOT contain the answer.`,
        );
      }
      names.push(`CLUE_${i}`);
    }

    const shell = {
      taskType: "what-am-i",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        answer: "{{ANSWER}}",
        acceptableAnswers: "{{ACCEPTABLE_ANSWERS}}", // sanitizer splits to array
        clues,
        difficulty: "{{DIFFICULTY}}",
        mode: "intra-team",
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  [TASK_TYPES.TRUTH_OR_DARE]: function buildTruthOrDareShell({ seedCount = 4 } = {}) {
    // Default raised from 1 to 4 — validator requires ≥ 4 seeds with
    // both type variety (truth + dare) and tier variety (sprout +
    // stem). The old 1-seed shell forced the renderer to repeat the
    // same challenge across all 6 rounds. See audit #4 (second sweep).
    const N = Math.max(4, Math.min(8, Number(seedCount) || 4));

    const placeholders = [
      "TITLE: Short, exciting title (3-7 words) — e.g. 'Truth or Dare - Water Cycle'",
      "PROMPT: 1-2 sentence student-facing intro — keep it playful + suspenseful",
      "SUBJECT: The general subject area (e.g. 'Science', 'History', 'English')",
      "UNIT_NAME: Specific unit/topic (e.g. 'Water Cycle', 'American Revolution')",
      "GRADE_LEVEL: integer 1-12 matching the requested grade",
    ];
    const names = ["TITLE", "PROMPT", "SUBJECT", "UNIT_NAME", "GRADE_LEVEL"];

    const seedChallenges = [];
    for (let i = 1; i <= N; i++) {
      seedChallenges.push({
        type: `{{SEED_${i}_TYPE}}`,
        tier: `{{SEED_${i}_TIER}}`,
        category: `{{SEED_${i}_CATEGORY}}`,
        prompt: `{{SEED_${i}_PROMPT}}`,
        teacherHint: `{{SEED_${i}_TEACHER_HINT}}`,
        timeSeconds: `{{SEED_${i}_TIME_SECONDS}}`,
        physicalIntensity: `{{SEED_${i}_PHYS}}`,
        socialIntensity: `{{SEED_${i}_SOCIAL}}`,
        noiseExpected: `{{SEED_${i}_NOISE}}`,
        acceptableAnswers: `{{SEED_${i}_ACCEPTABLE}}`,
        judgmentMode: `{{SEED_${i}_JUDGE}}`,
        rewardTier: `{{SEED_${i}_REWARD}}`,
      });

      placeholders.push(
        `SEED_${i}_TYPE: 'truth' or 'dare' (string)`,
        `SEED_${i}_TIER: 'sprout' | 'stem' | 'big' — start with 'sprout' for the first seed`,
        `SEED_${i}_CATEGORY: one of 'recall' 'explain' 'defend' 'mime' 'persuade' 'roleplay' 'improv' 'draw' 'narrate' 'compose' 'reflect' 'predict'`,
        `SEED_${i}_PROMPT: The actual challenge text shown to the student. Curriculum-aware, SAFE, encourages a path to GLORY not embarrassment.`,
        `SEED_${i}_TEACHER_HINT: 1-sentence tip for the teacher on what to look for`,
        `SEED_${i}_TIME_SECONDS: integer 15-90`,
        `SEED_${i}_PHYS: integer 0-3 (physical intensity)`,
        `SEED_${i}_SOCIAL: integer 0-3 (social intensity / pressure)`,
        `SEED_${i}_NOISE: integer 0-3 (expected noise from the room)`,
        `SEED_${i}_ACCEPTABLE: For Truths with objective answers, a comma-separated list of acceptable answer phrasings. For Dares or subjective Truths: null.`,
        `SEED_${i}_JUDGE: 'ai' | 'teacher' | 'class-vote' — pick based on whether the answer is objectively checkable`,
        `SEED_${i}_REWARD: 'small' | 'medium' | 'large' — match to tier`,
      );
      names.push(
        `SEED_${i}_TYPE`, `SEED_${i}_TIER`, `SEED_${i}_CATEGORY`,
        `SEED_${i}_PROMPT`, `SEED_${i}_TEACHER_HINT`, `SEED_${i}_TIME_SECONDS`,
        `SEED_${i}_PHYS`, `SEED_${i}_SOCIAL`, `SEED_${i}_NOISE`,
        `SEED_${i}_ACCEPTABLE`, `SEED_${i}_JUDGE`, `SEED_${i}_REWARD`,
      );
    }

    const shell = {
      taskType: "truth-or-dare",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        subject: "{{SUBJECT}}",
        unitName: "{{UNIT_NAME}}",
        gradeLevel: "{{GRADE_LEVEL}}",
        physicalIntensityMax: 2,
        socialIntensityMax: 2,
        movementAllowed: true,
        noiseAllowed: true,
        totalRounds: 6,
        tierProgression: "linear",
        judgmentMode: "mixed",
        safeClassroomMode: false,
        seedChallenges,
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },

  // ──────────────────────────────────────────────────────────────────────
  // UpVote — single debatable proposition. Shell is intentionally tight:
  // the only "live" field is the proposition itself; everything else is a
  // session knob with a safe default.
  // ──────────────────────────────────────────────────────────────────────
  [TASK_TYPES.UPVOTE]: function buildUpVoteShell() {
    const placeholders = [
      "TITLE: 3-7 words tied to the unit (e.g. 'UpVote — Queenston Heights')",
      "PROMPT: 1 sentence student-facing intro that frames the vote",
      "PROPOSITION: One declarative sentence, 8-25 words, GENUINELY two-sided, subject-tied. NOT a fact question, NOT a survey of preference. See aiPrompt examples.",
      "SUBJECT: General subject area (e.g. 'History', 'Bible', 'English')",
      "UNIT_NAME: Specific unit/topic",
      "GRADE_LEVEL: integer 1-12 matching the requested grade",
      "WORLDVIEW: 'faith' | 'secular' | 'general' — typically 'general' unless the unit is religious/explicitly secular",
    ];
    const names = ["TITLE", "PROMPT", "PROPOSITION", "SUBJECT", "UNIT_NAME", "GRADE_LEVEL", "WORLDVIEW"];

    const shell = {
      taskType: "upvote",
      title: "{{TITLE}}",
      prompt: "{{PROMPT}}",
      config: {
        proposition: "{{PROPOSITION}}",
        subject: "{{SUBJECT}}",
        unitName: "{{UNIT_NAME}}",
        gradeLevel: "{{GRADE_LEVEL}}",
        worldview: "{{WORLDVIEW}}",
        voteTimeSeconds: 120,
        showRunningTally: true,
        requireReasoningOnSubmit: false,
      },
    };
    return { shell: JSON.stringify(shell, null, 2), fillInstructions: placeholders.join("\n"), placeholderNames: names };
  },
};