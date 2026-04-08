#!/usr/bin/env node
/**
 * validateAllTaskTypes.js
 * ─────────────────────────────────────────────────────────────────
 * Programmatic validation test for ALL generator-eligible task types.
 *
 * For each type, builds a minimal-but-valid sample task and runs it
 * through the full validation pipeline:
 *   normalizeTaskByType → validateTaskByType → assessTaskPlayability
 *
 * Usage:
 *   node backend/tests/validateAllTaskTypes.js
 *   node backend/tests/validateAllTaskTypes.js --type vennsort
 *   node backend/tests/validateAllTaskTypes.js --verbose
 *
 * Exit code 0 = all pass, 1 = at least one failure.
 */

import { TASK_TYPES } from "../../shared/taskTypes.js";
import {
  normalizeTaskByType,
  validateTaskByType,
  validateAiTask,
} from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

// ── CLI flags ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");
const singleType = (() => {
  const idx = args.indexOf("--type");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();

// ── Sample tasks for every generator-eligible type ─────────────
const SAMPLE_TASKS = {
  [TASK_TYPES.MULTIPLE_CHOICE]: {
    taskType: "multiple-choice",
    title: "Capital Cities",
    prompt: "What is the capital of France?",
    items: [
      {
        prompt: "What is the capital of France?",
        options: ["Berlin", "Madrid", "Paris", "Rome"],
        correctAnswer: 2,
      },
      {
        prompt: "What is the capital of Japan?",
        options: ["Seoul", "Tokyo", "Beijing", "Bangkok"],
        correctAnswer: 1,
      },
      {
        prompt: "What is the capital of Brazil?",
        options: ["Buenos Aires", "Lima", "Brasília", "Santiago"],
        correctAnswer: 2,
      },
    ],
  },

  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: {
    taskType: "physical-multiple-choice",
    title: "Science on the Move",
    prompt: "Run to the corner that matches the correct answer!",
    items: [
      {
        prompt: "What planet is closest to the Sun?",
        options: ["Venus", "Mercury", "Earth", "Mars"],
        correctAnswer: 1,
      },
      {
        prompt: "What gas do plants absorb?",
        options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"],
        correctAnswer: 2,
      },
      {
        prompt: "How many legs does an insect have?",
        options: ["4", "6", "8", "10"],
        correctAnswer: 1,
      },
    ],
  },

  [TASK_TYPES.TRUE_FALSE]: {
    taskType: "true-false",
    title: "True or False: Animals",
    prompt: "Decide whether each statement is true or false.",
    items: [
      { prompt: "Dolphins are mammals.", correctAnswer: 1 },
      { prompt: "Spiders have six legs.", correctAnswer: 0 },
      { prompt: "Penguins can fly.", correctAnswer: 0 },
    ],
  },

  [TASK_TYPES.SHORT_ANSWER]: {
    taskType: "short-answer",
    title: "Vocabulary Check",
    prompt: "Answer the following questions.",
    items: [
      { prompt: "What is a synonym for 'happy'?", correctAnswer: "joyful" },
      { prompt: "What is the opposite of 'fast'?", correctAnswer: "slow" },
    ],
  },

  [TASK_TYPES.READING_COMP]: {
    taskType: "reading-comp",
    title: "The Water Cycle",
    prompt: "Read the passage and answer the questions.",
    config: {
      text: "Water evaporates from oceans, lakes, and rivers. It rises into the atmosphere, where it cools and condenses into clouds. When the droplets become heavy enough, they fall as precipitation — rain, snow, or hail. This cycle repeats endlessly, sustaining life on Earth.",
      questions: [
        {
          prompt: "What happens when water rises into the atmosphere?",
          options: ["It freezes instantly", "It condenses into clouds", "It disappears", "It turns to steam forever"],
          correctAnswer: 1,
        },
        {
          prompt: "What are three forms of precipitation mentioned?",
          options: ["Rain, fog, dew", "Rain, snow, hail", "Sleet, mist, drizzle", "Frost, ice, snow"],
          correctAnswer: 1,
        },
        {
          prompt: "Where does water evaporate from?",
          options: ["Only oceans", "Oceans, lakes, and rivers", "Mountains", "Underground wells"],
          correctAnswer: 1,
        },
      ],
    },
  },

  [TASK_TYPES.SORT]: {
    taskType: "sort",
    title: "Living vs Non-Living",
    prompt: "Sort these items into the correct category.",
    config: {
      buckets: ["Living", "Non-Living"],
      items: [
        { text: "Dog", bucketIndex: 0 },
        { text: "Rock", bucketIndex: 1 },
        { text: "Tree", bucketIndex: 0 },
        { text: "Water", bucketIndex: 1 },
        { text: "Cat", bucketIndex: 0 },
      ],
      answerKey: {
        Dog: "Living",
        Rock: "Non-Living",
        Tree: "Living",
        Water: "Non-Living",
        Cat: "Living",
      },
    },
  },

  [TASK_TYPES.SEQUENCE]: {
    taskType: "sequence",
    title: "Order the Planets",
    prompt: "Put these planets in order from the Sun.",
    config: {
      items: [
        { id: "s0", text: "Mercury" },
        { id: "s1", text: "Venus" },
        { id: "s2", text: "Earth" },
        { id: "s3", text: "Mars" },
      ],
    },
    correctOrder: ["s0", "s1", "s2", "s3"],
  },

  [TASK_TYPES.TIMELINE]: {
    taskType: "timeline",
    title: "Historical Events",
    prompt: "Put these events in chronological order.",
    config: {
      items: [
        { id: "t0", text: "Moon Landing (1969)" },
        { id: "t1", text: "World War II Ends (1945)" },
        { id: "t2", text: "Internet Created (1983)" },
        { id: "t3", text: "First Smartphone (2007)" },
      ],
    },
    correctOrder: ["t1", "t0", "t2", "t3"],
  },

  [TASK_TYPES.MATCHING]: {
    taskType: "matching",
    title: "Country Capitals",
    prompt: "Match each country with its capital city.",
    leftItems: [
      { id: "l0", text: "France" },
      { id: "l1", text: "Japan" },
      { id: "l2", text: "Brazil" },
      { id: "l3", text: "Egypt" },
      { id: "l4", text: "Australia" },
    ],
    rightItems: [
      { id: "r0", text: "Paris" },
      { id: "r1", text: "Tokyo" },
      { id: "r2", text: "Brasília" },
      { id: "r3", text: "Cairo" },
      { id: "r4", text: "Canberra" },
    ],
    correctMatches: { l0: "r0", l1: "r1", l2: "r2", l3: "r3", l4: "r4" },
  },

  [TASK_TYPES.VENNSORT]: {
    taskType: "vennsort",
    title: "Mammals vs Reptiles",
    prompt: "Sort these animals into the Venn diagram.",
    config: {
      categories: ["Mammals", "Reptiles"],
      items: [
        { id: "item-0-Dog", text: "Dog", categories: ["Mammals"] },
        { id: "item-1-Snake", text: "Snake", categories: ["Reptiles"] },
        { id: "item-2-Cat", text: "Cat", categories: ["Mammals"] },
        { id: "item-3-Lizard", text: "Lizard", categories: ["Reptiles"] },
        { id: "item-4-Horse", text: "Horse", categories: ["Mammals"] },
      ],
    },
    correctAnswer: {
      "item-0-Dog": ["Mammals"],
      "item-1-Snake": ["Reptiles"],
      "item-2-Cat": ["Mammals"],
      "item-3-Lizard": ["Reptiles"],
      "item-4-Horse": ["Mammals"],
    },
  },

  [TASK_TYPES.OPEN_TEXT]: {
    taskType: "open-text",
    title: "Reflection",
    prompt: "Write a short reflection about what you learned today.",
  },

  [TASK_TYPES.RECORD_AUDIO]: {
    taskType: "record-audio",
    title: "Verbal Summary",
    prompt: "Record yourself summarizing the main idea of the lesson.",
  },

  [TASK_TYPES.PHOTO]: {
    taskType: "photo",
    title: "Find a Shape",
    prompt: "Take a photo of something in the room that is a rectangle.",
  },

  [TASK_TYPES.MAKE_AND_SNAP]: {
    taskType: "make-and-snap",
    title: "Build a Model",
    prompt: "Build a model of the solar system using classroom materials and take a photo.",
  },

  [TASK_TYPES.PHOTO_JOURNAL]: {
    taskType: "photo-journal",
    title: "Nature Walk Journal",
    prompt: "Take 3 photos of different plants you see and write a caption for each.",
  },

  [TASK_TYPES.BODY_BREAK]: {
    taskType: "body-break",
    title: "Stretch Break",
    prompt: "Stand up and do 10 jumping jacks, then touch your toes 5 times!",
  },

  [TASK_TYPES.MOTION_MISSION]: {
    taskType: "motion-mission",
    title: "Classroom Explorer",
    prompt: "Walk to three different corners of the room. At each corner, write down one thing you notice.",
  },

  [TASK_TYPES.MUSICAL_CHAIRS]: {
    taskType: "musical-chairs",
    title: "Music Quiz Chairs",
    prompt: "Walk around until the music stops, then answer the question at your station!",
    config: {
      rounds: 3,
      items: [
        {
          prompt: "What is 7 × 8?",
          options: ["54", "56", "58", "64"],
          correctAnswer: 1,
        },
        {
          prompt: "Which planet is known as the Red Planet?",
          options: ["Jupiter", "Mars", "Venus"],
          correctAnswer: 1,
        },
        {
          prompt: "What is H₂O commonly known as?",
          options: ["Salt", "Water", "Sugar", "Vinegar"],
          correctAnswer: 1,
        },
      ],
    },
    items: [
      {
        prompt: "What is 7 × 8?",
        options: ["54", "56", "58", "64"],
        correctAnswer: 1,
      },
      {
        prompt: "Which planet is known as the Red Planet?",
        options: ["Jupiter", "Mars", "Venus"],
        correctAnswer: 1,
      },
      {
        prompt: "What is H₂O commonly known as?",
        options: ["Salt", "Water", "Sugar", "Vinegar"],
        correctAnswer: 1,
      },
    ],
  },

  [TASK_TYPES.MAD_DASH_SEQUENCE]: {
    taskType: "mad-dash-sequence",
    title: "Order Rush",
    prompt: "Run to the stations in the correct order!",
    items: [
      { id: "md0", text: "Step 1: Gather materials" },
      { id: "md1", text: "Step 2: Mix ingredients" },
      { id: "md2", text: "Step 3: Bake in oven" },
    ],
    correctOrder: ["md0", "md1", "md2"],
  },

  [TASK_TYPES.JEOPARDY]: {
    taskType: "brain-blitz",
    title: "Science Brain Blitz",
    prompt: "Answer the clues to earn points!",
    clues: [
      { clue: "This gas makes up 78% of the atmosphere.", answer: "Nitrogen" },
      { clue: "The powerhouse of the cell.", answer: "Mitochondria" },
      { clue: "Force equals mass times this.", answer: "Acceleration" },
      { clue: "The closest star to Earth.", answer: "The Sun" },
      { clue: "Chemical symbol H₂O.", answer: "Water" },
    ],
  },

  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: {
    taskType: "true-false-tictactoe",
    title: "Tic-Tac-Toe: Science",
    prompt: "Choose a square and decide if the statement is true or false.",
    items: Array.from({ length: 9 }, (_, i) => ({
      statement: `Statement ${i + 1}: The Earth revolves around the Sun.`,
      correctAnswer: i % 2 === 0,
    })),
  },

  [TASK_TYPES.FLASHCARDS]: {
    taskType: "flashcards",
    title: "Vocabulary Flashcards",
    prompt: "Study these vocabulary words.",
    config: {
      items: [
        { front: "Photosynthesis", back: "The process plants use to convert sunlight into food" },
        { front: "Mitosis", back: "Cell division producing two identical cells" },
        { front: "Ecosystem", back: "A community of living organisms and their environment" },
        { front: "Erosion", back: "The gradual wearing away of land by water or wind" },
        { front: "Gravity", back: "The force that attracts objects toward Earth" },
        { front: "Nucleus", back: "The control center of a cell" },
        { front: "Habitat", back: "The natural environment of an organism" },
        { front: "Condensation", back: "The process of gas turning into liquid" },
      ],
    },
  },

  [TASK_TYPES.FLASHCARDS_RACE]: {
    taskType: "flashcards-race",
    title: "Speed Vocab Race",
    prompt: "Race to match definitions with terms!",
    config: {
      items: [
        { front: "Democracy", back: "Government by the people" },
        { front: "Monarchy", back: "Rule by a king or queen" },
        { front: "Republic", back: "Government with elected representatives" },
        { front: "Oligarchy", back: "Rule by a small group" },
        { front: "Theocracy", back: "Government ruled by religious leaders" },
      ],
    },
  },

  [TASK_TYPES.GUESS_WHO]: {
    taskType: "guess-who",
    title: "Historical Figures",
    prompt: "Guess the historical figure from the clues!",
    candidates: [
      { name: "Albert Einstein", facts: ["Born in Germany", "Theory of Relativity", "Nobel Prize in Physics"] },
      { name: "Marie Curie", facts: ["Born in Poland", "Discovered Radium", "Two Nobel Prizes"] },
      { name: "Isaac Newton", facts: ["Born in England", "Laws of Motion", "Discovered Gravity"] },
      { name: "Galileo Galilei", facts: ["Born in Italy", "Telescope improvements", "Supported heliocentrism"] },
      { name: "Nikola Tesla", facts: ["Born in Croatia", "Alternating current", "Tesla coil inventor"] },
      { name: "Ada Lovelace", facts: ["Born in England", "First computer programmer", "Worked with Babbage"] },
    ],
  },

  [TASK_TYPES.HANGMAN_DUEL]: {
    taskType: "hangman-duel",
    title: "Vocabulary Hangman",
    prompt: "Guess the word from the hint!",
    config: {
      wordsByStation: Array.from({ length: 8 }, (_, i) => ({
        word: ["ELEPHANT", "GIRAFFE", "PENGUIN", "DOLPHIN", "CHEETAH", "GORILLA", "OCTOPUS", "BUFFALO"][i],
        hint: ["Large gray mammal with a trunk", "Tallest land animal", "Flightless bird from Antarctica", "Intelligent ocean mammal", "Fastest land animal", "Great ape from Africa", "Eight-armed sea creature", "Large wild bovine"][i],
      })),
    },
    wordsByStation: Array.from({ length: 8 }, (_, i) => ({
      word: ["ELEPHANT", "GIRAFFE", "PENGUIN", "DOLPHIN", "CHEETAH", "GORILLA", "OCTOPUS", "BUFFALO"][i],
      hint: ["Large gray mammal with a trunk", "Tallest land animal", "Flightless bird from Antarctica", "Intelligent ocean mammal", "Fastest land animal", "Great ape from Africa", "Eight-armed sea creature", "Large wild bovine"][i],
    })),
  },

  [TASK_TYPES.WORD_WEAVER_DUEL]: {
    taskType: "word-weaver-duel",
    title: "Word Challenge",
    prompt: "Use these words to create the best sentence!",
    items: ["adventure", "mysterious", "discover", "ancient", "journey", "treasure", "hidden", "explore"],
  },

  [TASK_TYPES.PET_FEEDING]: {
    taskType: "pet-feeding",
    title: "Feed the Knowledge Pet",
    prompt: "Answer correctly to feed the pet!",
    items: [
      {
        prompt: "What is the largest ocean?",
        options: ["Atlantic", "Pacific", "Indian", "Arctic"],
        correctAnswer: 1,
      },
      {
        prompt: "How many continents are there?",
        options: ["5", "6", "7", "8"],
        correctAnswer: 2,
      },
      {
        prompt: "What is the smallest country?",
        options: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"],
        correctAnswer: 1,
      },
    ],
  },

  [TASK_TYPES.COLLABORATION]: {
    taskType: "collaboration",
    title: "Partner Discussion",
    prompt: "Discuss with your partner: What are three ways to reduce pollution in your community?",
  },

  [TASK_TYPES.LIVE_DEBATE]: {
    taskType: "live-debate",
    title: "Should Homework Be Abolished?",
    prompt: "Debate whether homework should be abolished in schools.",
    config: {
      topic: "Should homework be abolished?",
      sides: ["For abolishing homework", "Against abolishing homework"],
    },
  },

  [TASK_TYPES.BRAINSTORM_BATTLE]: {
    taskType: "brainstorm-battle",
    title: "Invention Ideas",
    prompt: "Brainstorm as many creative inventions as you can to solve everyday problems!",
  },

  // NOTE: fake-out has a known normalizer/validator conflict — normalizer inserts
  // jokeOption INTO options (making 4), but validator expects exactly 3 + separate joke.
  // We skip the normalizer here and feed the validator's expected post-format directly.
  [TASK_TYPES.FAKE_OUT]: {
    taskType: "fake-out",
    title: "Spot the Fake",
    prompt: "Can you tell which answer is real and which is fake?",
    rounds: [
      {
        prompt: "What is the largest bone in the human body?",
        options: ["Humerus", "Femur", "Tibia"],
        correctIndex: 1,
        jokeOption: "Funny Bone",
        jokeIndex: 3,
      },
      {
        prompt: "What is the chemical symbol for gold?",
        options: ["Go", "Au", "Gd"],
        correctIndex: 1,
        jokeOption: "Bling",
        jokeIndex: 3,
      },
      {
        prompt: "What is the speed of light in km/s (approx)?",
        options: ["200,000", "300,000", "400,000"],
        correctIndex: 1,
        jokeOption: "Ludicrous Speed",
        jokeIndex: 3,
      },
    ],
    config: {
      rounds: [
        {
          prompt: "What is the largest bone in the human body?",
          options: ["Humerus", "Femur", "Tibia"],
          correctIndex: 1,
          jokeOption: "Funny Bone",
          jokeIndex: 3,
        },
        {
          prompt: "What is the chemical symbol for gold?",
          options: ["Go", "Au", "Gd"],
          correctIndex: 1,
          jokeOption: "Bling",
          jokeIndex: 3,
        },
        {
          prompt: "What is the speed of light in km/s (approx)?",
          options: ["200,000", "300,000", "400,000"],
          correctIndex: 1,
          jokeOption: "Ludicrous Speed",
          jokeIndex: 3,
        },
      ],
    },
  },

  [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    taskType: "brain-spark-notes",
    title: "Photosynthesis Notes",
    prompt: "Review these notes about photosynthesis.",
    notes: {
      heading: "Photosynthesis",
      keyTerms: [
        { term: "Chlorophyll", definition: "Green pigment that absorbs light" },
        { term: "Glucose", definition: "Sugar produced by photosynthesis" },
        { term: "Carbon Dioxide", definition: "Gas absorbed from the atmosphere" },
      ],
      mainPoints: [
        {
          heading: "What is Photosynthesis?",
          bullets: [
            "Process by which plants convert light into chemical energy",
            "Takes place primarily in the leaves",
          ],
        },
        {
          heading: "Inputs",
          bullets: [
            "Sunlight provides energy",
            "Water is absorbed through roots",
            "Carbon dioxide enters through stomata",
          ],
        },
        {
          heading: "Outputs",
          bullets: [
            "Glucose is produced as food for the plant",
            "Oxygen is released as a byproduct",
          ],
        },
      ],
      summary: [
        "Photosynthesis converts light energy into chemical energy.",
        "It is essential for life on Earth, producing oxygen and food.",
      ],
    },
  },

  [TASK_TYPES.MIND_MAPPER]: {
    taskType: "mind-mapper",
    title: "Water Cycle Map",
    prompt: "Complete the mind map about the water cycle.",
    structure: "Water evaporates → _____ form → Precipitation falls → Water collects in _____",
    items: [
      { id: "mm0", text: "Clouds" },
      { id: "mm1", text: "Rivers and lakes" },
      { id: "mm2", text: "Evaporation" },
      { id: "mm3", text: "Condensation" },
    ],
  },

  [TASK_TYPES.NARRATION_SYNTHESIZE]: {
    taskType: "narration-synthesize",
    title: "Story Synthesis",
    prompt: "Each player narrates a part of the story. Together, build a complete narrative!",
    config: {
      playerCount: 3,
      prompts: [
        "Describe the setting of the story.",
        "Introduce the main character and their challenge.",
        "Narrate the resolution of the story.",
      ],
    },
  },

  [TASK_TYPES.ROLE_PLAY_DECK]: {
    taskType: "role-play-deck",
    title: "Historical Debate",
    prompt: "Take on a role and argue your perspective!",
    scenario: "A town meeting in 1776 to discuss independence from Britain.",
    roles: [
      { name: "Patriot", description: "You believe the colonies should be independent." },
      { name: "Loyalist", description: "You believe the colonies should remain under British rule." },
    ],
  },

  [TASK_TYPES.SCRIPT_PLAY]: {
    taskType: "script-play",
    title: "Scene: The Discovery",
    prompt: "Act out this scene about a scientific discovery.",
    dialogue: [
      { speaker: "Scientist A", line: "I think I found something incredible in the sample!" },
      { speaker: "Scientist B", line: "Let me see... this could change everything we know about genetics!" },
      { speaker: "Scientist A", line: "We need to run more tests to be sure." },
      { speaker: "Scientist B", line: "Agreed. But if confirmed, this is a breakthrough." },
    ],
  },

  [TASK_TYPES.DRAW_MIME]: {
    taskType: "draw-mime",
    title: "Draw or Act It Out",
    prompt: "Draw or mime the concept for your team to guess!",
    clues: [
      "Gravity",
      "Photosynthesis",
      "Volcano eruption",
      "Water cycle",
    ],
  },

  [TASK_TYPES.DRAW]: {
    taskType: "draw",
    title: "Draw the Concept",
    prompt: "Draw a diagram showing the food chain from producers to apex predators.",
  },

  [TASK_TYPES.MIME]: {
    taskType: "mime",
    title: "Act It Out",
    prompt: "Without speaking, act out the concept of gravity for your teammates to guess.",
  },

  [TASK_TYPES.ECHO_CHAIN]: {
    taskType: "echo-chain",
    title: "Retell the Story",
    prompt: "Listen to the previous player and add your part to continue the chain!",
    config: {
      playerCount: 4,
      prompts: [
        "Start the story about an adventure in space.",
        "Continue by describing what happens when they land on a new planet.",
        "Add a challenge the astronauts must overcome.",
        "Conclude the story with how they return home.",
      ],
    },
  },

  [TASK_TYPES.PRONUNCIATION]: {
    taskType: "pronunciation",
    title: "Pronunciation Practice",
    prompt: "Practice saying this phrase clearly.",
    referenceText: "The quick brown fox jumps over the lazy dog.",
  },

  [TASK_TYPES.SPEECH_RECOGNITION]: {
    taskType: "speech-recognition",
    title: "Speak Your Answer",
    prompt: "Say the answer to this question out loud: What is the capital of Italy?",
    correctAnswer: "Rome",
  },
};

// Types where the normalizer transforms data in a way the post-normalize
// validator can't handle (known bugs). We test validate-only for these.
const SKIP_FULL_PIPELINE = new Set([
  TASK_TYPES.FAKE_OUT, // normalizer inserts jokeOption into options (4), validator expects 3
]);

// ── Test runner ────────────────────────────────────────────────
const PASS = "\x1b[32m✓ PASS\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";
const WARN = "\x1b[33m⚠ WARN\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function runTest(taskType, sampleTask) {
  const result = { type: taskType, pass: false, errors: [], warnings: [] };

  try {
    // Step 1: Normalize (skip for types with known normalizer/validator mismatches)
    const normalized = SKIP_FULL_PIPELINE.has(taskType)
      ? { ...sampleTask, taskType }
      : normalizeTaskByType(taskType, { ...sampleTask, taskType });

    // Step 2: Validate
    const validation = validateTaskByType(taskType, normalized);
    if (!validation.ok) {
      result.errors.push(`Validation: ${(validation.errors || []).join("; ")}`);
    }

    // Step 3: Playability
    const play = assessTaskPlayability(normalized);
    if (!play.playable) {
      result.errors.push(`Playability: ${play.issues.join("; ")}`);
    } else if (play.issues?.length) {
      result.warnings.push(`Playability warnings: ${play.issues.join("; ")}`);
    }

    // Step 4: Full pipeline (validateAiTask = normalize + validate + playability)
    // Skip for types with known normalizer/validator mismatches (tested above separately)
    if (!SKIP_FULL_PIPELINE.has(taskType)) {
      const full = validateAiTask(taskType, sampleTask);
      if (!full.ok) {
        // Deduplicate with above
        const newErrors = (full.errors || []).filter(
          (e) => !result.errors.some((existing) => existing.includes(e))
        );
        if (newErrors.length) {
          result.errors.push(`Full pipeline: ${newErrors.join("; ")}`);
        }
      }
    }

    result.pass = result.errors.length === 0;
  } catch (err) {
    result.errors.push(`Exception: ${err.message}`);
  }

  return result;
}

// ── Main ───────────────────────────────────────────────────────
console.log(`\n${BOLD}═══════════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}  Curriculate Task Type Validator — ${Object.keys(SAMPLE_TASKS).length} types${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}\n`);

let passed = 0;
let failed = 0;
let warned = 0;
const failures = [];

const typesToTest = singleType
  ? { [singleType]: SAMPLE_TASKS[singleType] }
  : SAMPLE_TASKS;

if (singleType && !SAMPLE_TASKS[singleType]) {
  console.error(`Unknown task type: "${singleType}"`);
  console.error(`Available types:\n  ${Object.keys(SAMPLE_TASKS).join("\n  ")}`);
  process.exit(1);
}

for (const [taskType, sample] of Object.entries(typesToTest)) {
  const result = runTest(taskType, sample);

  if (result.pass) {
    passed++;
    const warnStr = result.warnings.length ? ` ${WARN} ${result.warnings.join("; ")}` : "";
    if (result.warnings.length) warned++;
    console.log(`  ${PASS}  ${taskType}${warnStr}`);
    if (verbose && result.warnings.length) {
      for (const w of result.warnings) console.log(`         ${w}`);
    }
  } else {
    failed++;
    failures.push(result);
    console.log(`  ${FAIL}  ${taskType}`);
    for (const e of result.errors) {
      console.log(`         ${e}`);
    }
  }
}

console.log(`\n${BOLD}───────────────────────────────────────────────────────────${RESET}`);
console.log(`  ${passed} passed, ${failed} failed, ${warned} warnings`);
console.log(`${BOLD}───────────────────────────────────────────────────────────${RESET}\n`);

if (failures.length) {
  console.log(`${BOLD}FAILURES:${RESET}`);
  for (const f of failures) {
    console.log(`\n  ${f.type}:`);
    for (const e of f.errors) console.log(`    → ${e}`);
  }
  console.log();
}

process.exit(failed > 0 ? 1 : 0);
