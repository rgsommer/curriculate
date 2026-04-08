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

  // Demo-only intro / walkthrough
  TASK_RUNNER: "task-runner",

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
  MULTI_ROOM_SCAVENGER_HUNT: "hidenseek"
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
    - Create 3–5 multiple-choice items. Each item must include a clear question prompt, 4 answer options (A–D), and a correctAnswer index that matches the options array. Avoid trick wording; make exactly one option clearly correct.
    
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
    correctAnswerShape: "single-option-index",
    multiItemCapable: true,
    preferredItemsPerTask: { min: 3, max: 5 },
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Physical Multiple Choice (kinesthetic). Looks exactly like standard multiple-choice on the device (full question + four fully visible options A\u2013D), but students cannot submit by tapping.\nTo submit, they must walk to one of the classroom\u2019s 8 permanent colored QR stations and scan the station whose color matches the color displayed beside their chosen option.\n\nHow it works:\n- The system randomly selects 4 of the 8 station colors and maps them to A/B/C/D each question (randomized every play).\n- Each option shows a large color chip (e.g., A \u25cf Red, B \u25cf Teal, C \u25cf Purple, D \u25cf Green).\n- Student decides the answer, walks to that color station, scans, and the scan auto-submits that letter.\n- Typically 3\u20135 questions per task \u2192 3\u20135 trips across the room.\n\nAI generation shape:\n- config.items: array of 3\u20135 questions\n- each item: { question: string, options: [string,string,string,string], correctIndex: 0\u20133 }\n- system provides per-question colorMap (generated at runtime; not required from AI)\nScoring: objective (correctIndex). Inter-team: NO. Intra-team: NO.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "physical-multiple-choice".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Same as Multiple Choice, but students must NOT tap an option to submit.
    - Each option A/B/C/D must be shown with a clearly visible COLOR chip (from the 8 permanent station colors).
    - Students submit by walking to the station whose color matches their chosen option and scanning that QR.
    - After each successful scan, auto-advance to the next question. The final scan auto-submits.
    - Color-to-letter mapping is randomized each time the task is played (and may vary per question).
    - Include 3–5 questions (config.items). Keep questions quick and unambiguous.
    
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
    - Create 3–6 short-answer questions that can be answered in 1–2 sentences or a number/phrase. Include an answerKey or exemplar answer where the schema allows.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
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
    - Create an ORIGINAL paragraph of X sentences, where X equals the grade level (if grade is not given, use 10 sentences).
    - Provide the paragraph as a single string field (e.g., paragraph or generatedParagraph) so the student UI can render it.
    - The student action is: write ONE sentence that summarizes/shows understanding of the paragraph.
    - Keep the prompt student-facing and very explicit (Grade 7 reading level).
    - Do NOT generate multiple-choice questions for this task.
    
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
    - Create a sorting activity with 8–14 items and 2–4 categories. Categories must be clearly labeled; every item must belong to exactly one category.
    
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
    correctAnswerShape: "ordered-array",
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Drag 4–8 steps/events into the correct order (process steps, life cycles, cause→effect chains, or historical chronology). Reinforces procedural understanding and ‘big picture’ structure.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "sequence".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a sequencing task with 6–10 steps/events. Provide the correct order and shuffled items for display. Steps must be unambiguous and clearly distinct.
    
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
    - Create a timeline task with 6–10 dated/ordered events. Provide event labels and correct chronological order. Dates can be approximate if appropriate, but order must be clear.
    
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
    Generate ONE Curriculate task object with taskType “matching”.

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance:
    - Create exactly 6 pairs connecting left items to right items (term→definition, person→role, cause→effect, etc.).
    - NEVER use fields named “options”, “items”, “pairs”, or “answers”. Use ONLY the exact field names shown below.

    REQUIRED OUTPUT FORMAT (use this exact structure, no deviations):
    {
      “taskType”: “matching”,
      “title”: “short title (3-7 words)”,
      “prompt”: “Connect each item on the left to its match on the right.”,
      “leftItems”: [“Term A”, “Term B”, “Term C”, “Term D”, “Term E”, “Term F”],
      “rightItems”: [“Definition A”, “Definition B”, “Definition C”, “Definition D”, “Definition E”, “Definition F”],
      “correctMatches”: {
        “L1”: “R1”,
        “L2”: “R2”,
        “L3”: “R3”,
        “L4”: “R4”,
        “L5”: “R5”,
        “L6”: “R6”
      }
    }

    Rules for correctMatches: use keys L1–L6 (matching index in leftItems) and values R1–R6 (matching index in rightItems). Each left item matches exactly one right item.

    Common failure prevention:
    - Do NOT wrap items in objects; leftItems and rightItems must be plain string arrays.
    - Do NOT use “config” wrapper; all fields at root level.
    - Ensure all 6 L/R keys appear in correctMatches.
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
    - Create a Venn sorting task with 10–16 items that fit into left-only, right-only, or both.
    - config.categories: array of 2–3 category label strings (e.g. ["Mammals","Reptiles"]).
    - config.items: array of 5–10 objects, each with { "id": "item-0-Dog", "text": "Dog" }.
    - CRITICAL — you MUST include a top-level "correctAnswer" object mapping every item id to an array of category names it belongs to. Example:
      "correctAnswer": {
        "item-0-Dog": ["Mammals"],
        "item-1-Bat": ["Mammals","Reptiles"],
        "item-2-Snake": ["Reptiles"]
      }
    - Each item in config.items MUST also have a "categories" array matching its correctAnswer entry.

    Common failure prevention:
    - Do NOT omit the correctAnswer field — the task WILL be rejected without it.
    - Do not omit required arrays/fields; satisfy minimum item counts (≥5 items, ≥2 categories).
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.

    Task-specific guidance (choose ONE mode):
    A) Standard open-text (default):
       - Create an open-ended writing prompt with 2–4 guiding questions.
       - Encourage evidence/clarity; optionally include a simple rubric (bullet criteria) if schema supports.

    B) Vocabulary Paragraph mode (use when the objective is vocabulary usage):
       - Set config.kind = "vocabulary-paragraph".
       - Include config.words as an array of 5–10 target vocabulary words/phrases (strings).
       - Student task: write ONE coherent paragraph that uses EVERY word at least once.
         * Inflections are allowed (pluralization / verb tense / correct forms).
         * The paragraph must sound natural and show understanding of meaning.
       - Scoring is AI-based. If the schema supports it, include a rubric/criteria emphasizing:
         1) all required words included,
         2) contextual correctness / natural usage,
         3) grammatical coherence,
         4) overall quality & creativity (optional bonus).

    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure prompts are student-facing instructions (what to do).
    - Do NOT invent extra keys that are not in the schema.
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
    - Prompt students to record a 20–45 second response. Include 2–3 speaking cues and 2–4 simple assessment criteria (clarity, accuracy, evidence, etc.) if schema supports.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    - Prompt students to take a photo that evidences learning (e.g., whiteboard work, model, artifact). Include clear requirements for what must be visible in the photo and 2–3 quick checklist criteria.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Make & Snap: the team physically builds/creates/arranges something from a prompt, then submits a photo (and required note). Typically AI-scored for alignment to the prompt. Benefit: hands-on application, creativity, collaboration, authentic assessment, and transfer beyond the screen.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "make-and-snap".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Prompt students to build/make something quick (diagram, model, arrangement) and then photograph it. Include materials constraints (classroom-safe) and a clear checklist of required features in the final photo.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Team captures a photo AND writes a short caption/explanation/reflection connecting the image to the prompt. AI-scored using photo evidence + caption. Pedagogical benefits: connects visual evidence to verbal reasoning, supports metacognition, and improves explanation quality beyond “just a picture.” Inter-team: NO. Intra-team: NO.\n\nAI MUST output:\n- taskType: \"photo-journal\"\n- prompt\n- Optional: config.captionPrompt, config.wordCountTarget\nStudent submission includes: { photoUrl|photo, caption }",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "photo-journal".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Prompt students to submit a photo plus a short caption/reflection (2–4 sentences). Include reflection questions and success criteria.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description:
      "Short movement break (30–60s). The device shows a quick physical challenge or guided moves (stretch, jumping jacks, dance, quick poses) and the team follows along. No answers; no objective scoring; no AI scoring. Includes upbeat prompts/animations for buy-in. Benefit: boosts attention, reduces restlessness, and helps energy regulation through brain–body activation.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "body-break".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Provide a 30–60 second classroom-safe movement break with 3–5 steps. Keep it simple, inclusive, and safe (no jumping onto furniture, etc.).
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
      - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.
      
      Task-specific guidance:
      - Create a quick movement-based challenge tied to content (e.g., act out a concept, move to corners, gestures). Include clear start/stop cues and safety constraints.
      
      Common failure prevention:
      - Do not omit required arrays/fields; satisfy minimum item counts.
      - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
      - Ensure prompts are student-facing instructions (what to do).
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

    description: `
      A fast, station-based tap game (like “multiple choice, but musical chairs”).

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

      MENTAL MODEL: This is just multiple-choice / true-false, but used in “musical chairs” rounds.

      Return JSON ONLY. No markdown. No extra keys.

      HARD REQUIREMENTS:

      taskType must be exactly "musical-chairs"

      items.length MUST be exactly 8

      include a mix of question types:

      at least 2 items must be true/false (exactly 2 options)

      at least 2 items must be multiple-choice (3–4 options)

      each item.options length must be 2–4

      each item.correctAnswer must be a valid 0-based index into options AND must point to the correct option

      do NOT default correctAnswer to 0; correctAnswer=0 is only allowed if the first option is truly correct

      vary the position of the correct option across items (do not always place it first)

      config.rounds must equal 8

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

  interTeamEnabled: true,
  intraTeamEnabled: true,

  description:
    "High-energy “sequence under pressure” physical/interactive race. Players are presented with 3–5 ordered terms/items. The task card associates each item with a color at runtime, randomizes display, and scores by accuracy + speed. Players must determine the correct order, then scan stations in that order.",

  aiPrompt: `
    Generate ONE Curriculate task object with taskType "mad-dash-sequence".

    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Provide config.items (3–5 strings) and config.correctOrder (array of indices).
    - correctOrder must be a valid permutation of [0..items.length-1].
    - Do NOT include colors — colors are assigned at runtime.

    Task shape:
    {
      "taskType": "mad-dash-sequence",
      "title": "string",
      "prompt": "string",
      "config": {
        "items": ["string","string","string"],
        "correctOrder": [0,1,2]
      }
    }

    Content guidance:
    - Grade 3+ wording.
    - Items should be short (3–8 words).
    - Use simple sequences for easy; academic sequences for harder (process steps, timeline events, procedure order).
    - Prompt should tell students: figure out the order, then scan in that order.
    `.trim(),
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
      "Pre-taskset vibe-setter: each player taps a mood emoji; team can optionally add what they’re excited about. No timer, no scoring. Improves classroom climate and engagement.",
  
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
    - Create a game-like task where teams earn “treasure” by answering 6–10 quick questions. Provide clear scoring rules and answers where applicable.
    
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
    interTeamEnabled: true,
    intraTeamEnabled: true,
    description: "Brain Blitz (Jeopardy-style): the device shows an answer/term and students must respond with the correct question (Jeopardy format).\nStudent flow:\n- Prompt shows a clue/answer (word/name/phrase).\n- Players respond quickly by voice (preferred) or typing.\n- AI checks meaning and Jeopardy-style phrasing (strictness adjustable by difficulty).\nScoring: AI-scored; fast, competitive retrieval + reformulation.\nAI generation should produce:\n- clue (string) OR prompt (string)\n- expectedQuestion (string) OR expectedKeyPoints (array)\n- allowTyping (boolean, optional)\n- timeLimitSeconds (optional; usually 30\u201390)\nInter-team: YES. Intra-team: YES.",
  
    aiPrompt: `
      You are generating ONE task object.

      MENTAL MODEL: This is Jeopardy-style clue → response, but implemented as a rapid “clue ladder.”
      Students see several short clues and try to guess the single final answer.

      Return JSON ONLY. No markdown. No commentary.

      HARD REQUIREMENTS:
      - taskType must be exactly "brain-blitz"
      - title: non-empty string
      - prompt: non-empty string (explain: read clues, then guess)
      - clues: array of AT LEAST 5 short clue strings (5–8 is ideal)
      - correctAnswer: a short string that is the single target answer

      VALID EXAMPLE (copy this SHAPE, change the content):
      {
        "taskType": "brain-blitz",
        "title": "Seven Years’ War: Mystery Term",
        "prompt": "Read each clue. After the final clue, type your best guess for the answer.",
        "clues": [
          "This region was contested by Britain and France in North America.",
          "Rivers and trade routes made it strategically valuable.",
          "Conflicts here helped spark the wider Seven Years’ War.",
          "It connects to Fort Duquesne and colonial expansion.",
          "Many Indigenous nations were drawn into the struggle here."
        ],
        "correctAnswer": "Ohio Valley",
        "config": {
          "clues": [
            "This region was contested by Britain and France in North America.",
            "Rivers and trade routes made it strategically valuable.",
            "Conflicts here helped spark the wider Seven Years’ War.",
            "It connects to Fort Duquesne and colonial expansion.",
            "Many Indigenous nations were drawn into the struggle here."
          ],
          "correctAnswer": "Ohio Valley"
        }
      }

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
        "• A stack of short statements appears as draggable/tappable ‘bubbles’.",
        "• Each player is assigned a role: TRUE or FALSE (internally X/O).",
        "• On your turn, pick a statement and place it on a square. If the statement matches your role’s truthiness, you claim the square; otherwise your opponent claims it.",
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
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a tic-tac-toe grid of 9 true/false statements. Provide the correct truth value for each square. Mix true and false evenly.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    correctAnswerShape: "string-or-list",
    description:
      "Standard flashcard review (8–12 cards) with {question, answer}. Intended flow is ‘shout to answer’ with optional speech recognition / AI transcription support. Focus is mastery and repeated retrieval, not competition. Intra-team play enabled; inter-team play disabled.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "flashcards".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 12–20 flashcards (front/back). Front is a term/question; back is a definition/answer. Keep cards brief and accurate.
    
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
        "• Players/teams BUZZ IN (tap) — first buzz earns the right to answer.",
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
        "Pedagogical benefits: retrieval practice + speed/automaticity (Bloom’s: Remember/Understand),",
        "with motivating game-show energy (sounds, confetti, live score).",
      ].join("\n"),
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "flashcards-race".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 12–20 flashcards optimized for speed. Include clear, short fronts and backs. Avoid ambiguous synonyms.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Yes/No deduction game. One player privately views the secret concept (hold-to-reveal). Others ask only yes/no questions, then make limited guesses (e.g., max 10). Timer (e.g., 60s) starts on first reveal. Encourages logical elimination and strategic questioning.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "guess-who".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a “Guess Who” style set: 12–18 characters/items each with 6–10 yes/no attributes. Ensure attributes discriminate well.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      [
        "Hangman Duel (intra-team). Teams solve a mystery word shown as blanks by taking turns choosing letters (drag letter tiles/cubes into the blanks container).",
        "",
        "Gameplay expectations:",
        "• Correct letters lock in and score; wrong letters move to a used pile and advance a playful ‘build’ (not grim).",
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
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 10–16 hangman words/phrases relevant to the topic. Prefer 1–3 word phrases; avoid punctuation; include category hints.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "Scrabble-style, turn-based team duel: players drag/place 5–10 short words onto a grid (horizontal/vertical), earning points for each valid placement and intersections. Builds vocabulary, phrase structure, syntax awareness, and cooperative competition.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "word-weaver-duel".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a word-building challenge: provide 8–12 target vocabulary words and 4–6 constraints (use in a sentence, synonyms, prefixes, etc.).
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.DIFF_DETECTIVE]: {
    label: "Diff Detective",
    category: "analysis",
    intraTeamEnabled: false,
    interTeamEnabled: false,
    description: `
      “Spot the differences” between two versions (usually passages/lists; can be code/diagrams if UI supports it).
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
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 6–10 pairs of very similar statements/images-descriptions where students must spot the difference. Provide the “difference” answer key.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.SPEED_DRAW]: {
    label: "Speed Draw",
    category: "creative",
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
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 6–10 quick “draw it” prompts tied to content. Each prompt must be drawable in 30–60 seconds and include one required label.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: false,
    description: 
    "Feed the Pet: a motivation layer where completing the task feeds/powers up a virtual pet.\nStudent flow:\n- A cute pet appears (pack/theme).\n- Students choose a treat; celebration plays; task submits.\nScoring: typically completion-based or fixed bonus (e.g., +10) handled by session rules.\nAI generation should produce:\n- pack (string; one of: classic, farm, ocean, dino, fantasy)\n- optional pointsAwarded (number)\nInter-team: NO. Intra-team: NO.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "pet-feeding".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 8–12 questions; each correct answer feeds a virtual pet. Provide answers and simple difficulty progression.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: true,
    intraTeamEnabled: false,
    description:
      "Pair-and-respond collaboration between two teams. One team writes an initial response, " +
      "then views another team’s response and writes a thoughtful reply. AI-scored for quality and engagement.",
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "collaboration".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a collaboration task requiring teams to combine partial info. Provide 3–5 roles with unique clues; success requires sharing and synthesizing into one final response.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
      - Include non-empty root fields: taskType, title, prompt.
      - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.
      
      Task-specific guidance:
      - Provide a debate resolution plus 3 pro and 3 con starting points, and 4 judging criteria (evidence, clarity, respect, rebuttal).
      
      Common failure prevention:
      - Do not omit required arrays/fields; satisfy minimum item counts.
      - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
      - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: "Fast-paced team brainstorm to activate prior knowledge and generate ideas without fear of being wrong.\nStudent flow:\n- A topic/seed prompt appears.\n- Team rapidly contributes short ideas (spoken aloud and/or typed as quick entries).\n- Optional quick vote/rank at the end to highlight the strongest ideas.\nScoring: Not single-correct; typically completion-based (optionally +bonus for voting).\nAI generation should produce:\n- prompt (string)\n- seedTopic (string, optional)\n- ideaSlots (number, optional; default 8\u201312)\n- enableVoting (boolean, optional)\n- timeLimitSeconds (optional; usually 60\u2013120)\nInter-team: NO. Intra-team: YES.",
    pedagogyNotes: "Fast-paced ‘shout ideas’ collaborative brainstorm. The device shows a topic/seed prompt and your team rapidly contributes many ideas (spoken aloud and/or typed as short entries). No single correct answer — the goal is divergent thinking. Optional quick vote/rank at the end to highlight strongest ideas. Builds creative ideation, background knowledge, verbal participation, and lowers fear of being wrong.",
  
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
      - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
      - Keep language age-appropriate and classroom-safe.
      - Avoid copyrighted passages; write original content.
      
      Task-specific guidance:
      - Create a mystery with 6–10 clues and a single final solution. Provide clue order and the final answer. Keep it solvable and classroom-appropriate.
      
      Common failure prevention:
      - Do not omit required arrays/fields; satisfy minimum item counts.
      - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
      - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description: `
Turn-based oral reading + listening “truth vs fake” game (Balderdash-style).
One player (the Reader) reads aloud; others LISTEN and vote. AI provides 3 plausible options where ONLY ONE is correct,
plus one hilarious “obviously false” option. One additional slot is always a HUMAN-made-up option during play.

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
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "brain-spark-notes".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a note-taking task with a clear topic title and a model set of notes.
    - Provide task.bullets as an array of concise jot-notes/definitions that students will COPY (no blanks).
    - Bullet count: 3–5 for Grades 3–7; 6–10 for Grades 8+ (if grade is unknown, use 5–7).
    - Each bullet should be a specific definition or key point (not generic advice).
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a synthesize-and-summarize task: provide 2–3 short source bullets and ask for a 3–5 sentence synthesis with a claim + evidence.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create 10–16 role-play prompt cards. Each card has a scenario, roles, and a goal. Keep prompts short and varied.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    interTeamEnabled: false,
    intraTeamEnabled: true,
    description:
      "AI-generated Script Play: a structured performance task. The device shows the CURRENT speaker’s line in large text, plus optional tone cues (e.g., serious, excited) and stage directions (e.g., whispering, pointing). It also shows brief context lines for ‘just before’ and ‘up next’ so the team understands the story flow. Students PASS the device from speaker to speaker and read/act their lines. Intra-team only (no inter-team). Pedagogical benefits: reading fluency, expressive oral language, comprehension, narrative reasoning, collaboration, and deeper retention through performance.",
  
    aiPrompt: `
    Generate ONE Curriculate task object with taskType "script-play".
    
    Hard requirements:
    - Output ONLY a single JSON object (no markdown, no commentary).
    - Include non-empty root fields: taskType, title, prompt.
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a short script (8–16 lines) for 2–4 speakers that teaches a concept. Include stage directions lightly and add 3 comprehension/debrief questions.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
      - “1-2-3 GO” starts the timer.
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
    - This task has UP TO 4 ROUNDS — one per player. Each player will secretly choose to either DRAW or MIME their clue.
    - Generate EXACTLY 4 unique clues, one per round, in the "clues" array.
    - Each clue must be a single word or very short phrase (≤ 5 words) that can be drawn OR mimed without speaking.
    - All 4 clues should relate to the subject/topic of the taskset.
    - Good examples: "gravity", "photosynthesis", "forgiveness", "Abraham Lincoln", "water cycle"
    - Set task.prompt to clues[0] (the first clue) for backward compatibility.
    - Optionally set timeLimitSeconds to 60.

    CRITICAL — clues must NEVER:
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
    - Create 8–12 draw-only prompts tied to the topic. Include one required label or annotation per prompt.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
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
    - Create 8–12 mime-only prompts tied to the topic. Prompts must be actable without props and be classroom-appropriate.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
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
    - Follow the schema for this taskType EXACTLY as provided in the schema catalog in the system instructions.
    - Keep language age-appropriate and classroom-safe.
    - Avoid copyrighted passages; write original content.
    
    Task-specific guidance:
    - Create a call-and-response / echo chain activity: 8–12 short phrases (language or key facts) that build progressively. Include the correct sequence.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
},

  [TASK_TYPES.PRONUNCIATION]: {
    label: "Pronunciation Practice",
    category: CATEGORY.OTHER,
    implemented: true,
    demoEligible: true,
    generatorEligible: true,
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 90,
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
    objectiveKeyed: false,
    aiScoringDefaultOn: true,
    scoringMode: "ai",
    maxTimeSeconds: 90,
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
        "referenceText?: string  // optional reading-aloud text (if task is ‘read this aloud’ instead of ‘answer this’)",
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
    - Create a speech-recognition practice set: 8–12 target phrases plus acceptable variations. Include guidance for enunciation and success criteria.
    
    Common failure prevention:
    - Do not omit required arrays/fields; satisfy minimum item counts.
    - Ensure any indexes/keys (e.g., correctAnswer) are valid and in range.
    - Ensure prompts are student-facing instructions (what to do).
    `,
}

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
  preferredItemsPerTask: null
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
            "Noah… look. This map has today’s date on it.",
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
            "Either it’s a prank… or it’s a clue.",
            "Let’s follow it—carefully.",
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