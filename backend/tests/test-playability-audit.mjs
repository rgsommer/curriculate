#!/usr/bin/env node
// backend/tests/test-playability-audit.mjs
//
// Playability audit for EVERY implemented + generatorEligible task type.
//
// For each type we build a realistic "happy-path" sample (the shape a good AI
// generation would emit) and run it through the canonical generation pipeline:
//
//     sanitizeTaskShapeByType → normalizeTaskByType → validateTaskByType → assessTaskPlayability
//
// We record PASS (validate.ok && playable) / FAIL (with errors/reason).
//
// We ALSO build a "sloppy variant" injecting the common AI mistakes the Bible
// audit surfaced (empty/misplaced arrays, count mismatches, missing defaults,
// tight timers, bonus-unlock=100, missing worldview, answer-key shape issues)
// and assert the pipeline RECOVERS (still playable) OR cleanly REJECTS — never
// crashes and never produces a silently-broken "playable" task.
//
// Run: node backend/tests/test-playability-audit.mjs
// Exits non-zero if any HAPPY-PATH sample is unplayable.

import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { TASK_TYPES, TASK_TYPE_META, normalizeTaskType } from "../../shared/taskTypes.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

// Silence the chatty [sanitize] logs so the audit table stays readable.
const _log = console.log;
let _quiet = false;
console.log = (...a) => { if (!_quiet) _log(...a); };
function quiet(fn) { _quiet = true; try { return fn(); } finally { _quiet = false; } }

/**
 * Run a raw task object through the full generation pipeline.
 * Returns { ok, playable, crash, errors, issues, task }.
 */
function runPipeline(type, raw) {
  const canonical = normalizeTaskType(type);
  try {
    let task = clone(raw);
    task.taskType = canonical;
    task = quiet(() => sanitizeTaskShapeByType(canonical, task));
    task = quiet(() => normalizeTaskByType(canonical, task));
    const v = quiet(() => validateTaskByType(canonical, task));
    const p = quiet(() => assessTaskPlayability(task));
    return {
      ok: v.ok,
      playable: p.playable,
      crash: null,
      errors: v.errors || [],
      issues: p.issues || [],
      task,
    };
  } catch (e) {
    return { ok: false, playable: false, crash: e.message, errors: [], issues: [], task: null };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Happy-path samples. Each is realistic AI generator output (rich shape that
// the normalizer/validator are tuned for — NOT the trimmed demo-renderer shape).
// Keyed by canonical taskType value.
// ──────────────────────────────────────────────────────────────────────────
const HAPPY = {};

const mc = (extra = {}) => ({
  title: "Cell Biology Check",
  prompt: "Choose the best answer.",
  items: [
    { prompt: "What is the powerhouse of the cell?", options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], correctAnswer: 1 },
    { prompt: "Where is DNA primarily stored?", options: ["Cytoplasm", "Membrane", "Nucleus", "Vacuole"], correctAnswer: 2 },
    { prompt: "What controls what enters a cell?", options: ["Cell membrane", "Nucleolus", "Lysosome", "Cytoskeleton"], correctAnswer: 0 },
  ],
  ...extra,
});
HAPPY["multiple-choice"] = mc();
HAPPY["physical-multiple-choice"] = mc({ title: "Move to the Right Answer" });

HAPPY["true-false"] = {
  title: "Photosynthesis True/False",
  prompt: "Decide whether each statement is True or False.",
  items: [
    { statement: "Plants release oxygen during photosynthesis.", correctAnswer: true },
    { statement: "Photosynthesis happens only at night.", correctAnswer: false },
    { statement: "Chlorophyll absorbs sunlight.", correctAnswer: true },
  ],
};

HAPPY["short-answer"] = {
  title: "Define the Terms",
  prompt: "Answer in one sentence.",
  items: [
    { prompt: "What is a noun?", correctAnswer: "A person, place, or thing." },
    { prompt: "What is a verb?", correctAnswer: "An action or state of being." },
  ],
};

HAPPY["reading-comp"] = {
  title: "The Water Cycle",
  prompt: "Read the passage and answer the questions.",
  config: {
    text: "Water evaporates from oceans and lakes, rises into the air, and cools to form clouds. When the droplets grow heavy, they fall as precipitation, returning water to the surface to begin the cycle again.",
    questions: [
      { question: "What causes water to rise into the air?", correctAnswer: "evaporation" },
      { question: "What forms when water vapor cools?", correctAnswer: "clouds" },
      { question: "What returns water to the surface?", correctAnswer: "precipitation" },
    ],
  },
};

const openLike = (title) => ({ title, prompt: "Write a thoughtful, complete response of a few sentences." });
HAPPY["open-text"] = openLike("Reflect on the Reading");
HAPPY["case-study"] = { title: "The Recycling Dilemma", prompt: "A town must decide whether to build a recycling plant or expand its landfill. Analyze the trade-offs and recommend a course of action.", config: { scenario: "Greenville produces 50 tons of waste daily and its landfill is nearly full." } };
HAPPY["record-audio"] = openLike("Record Your Summary");
HAPPY["draw"] = openLike("Draw the Food Chain");
HAPPY["mime"] = openLike("Act It Out");
HAPPY["photo"] = openLike("Photograph a Right Angle");
HAPPY["make-and-snap"] = { title: "Build a Bridge", prompt: "Build a small bridge from paper and tape, then photograph it." };
HAPPY["photo-journal"] = openLike("Document Your Plant's Growth");
HAPPY["body-break"] = openLike("Stretch Break");
HAPPY["motion-mission"] = openLike("Act Out the Verb");
HAPPY["draw-mime"] = { title: "Charades: Science Edition", prompt: "Draw or mime each concept for your team.", clues: ["Gravity", "Evaporation", "Volcano", "Magnet"] };
HAPPY["speed-draw"] = { title: "Speed Draw: Atom", prompt: "Quickly sketch this term!", word: "Atom" };
HAPPY["storytelling"] = { title: "Build a Story", prompt: "Create characters and we'll weave them into a tale." };
HAPPY["collaboration"] = { title: "Group Brainstorm", prompt: "As a team, list five ways to reduce plastic waste at school." };

HAPPY["sort"] = {
  title: "Sort the Vocabulary",
  prompt: "Drag each term into the correct category.",
  config: {
    buckets: ["Mammals", "Reptiles"],
    items: [
      { text: "Dolphin", bucketIndex: 0 }, { text: "Crocodile", bucketIndex: 1 },
      { text: "Bat", bucketIndex: 0 }, { text: "Iguana", bucketIndex: 1 },
      { text: "Elephant", bucketIndex: 0 }, { text: "Cobra", bucketIndex: 1 },
      { text: "Whale", bucketIndex: 0 }, { text: "Gecko", bucketIndex: 1 },
    ],
  },
};

const seqSample = (title) => ({
  title,
  prompt: "Put the events in the correct order.",
  items: [
    { text: "Seed is planted (spring)" },
    { text: "Sprout breaks soil (1790s)" },
    { text: "Plant flowers (mid 1800s)" },
    { text: "Fruit ripens (late 1800s)" },
    { text: "Seeds disperse (1900s)" },
  ],
});
HAPPY["sequence"] = seqSample("Plant Life Cycle");
HAPPY["timeline"] = {
  title: "Canadian History Timeline",
  prompt: "Order these events chronologically.",
  items: [
    { text: "Treaty of Utrecht (1713)" },
    { text: "Seven Years' War ends (1763)" },
    { text: "Constitutional Act (1791)" },
    { text: "War of 1812 (1812)" },
    { text: "Confederation (1867)" },
  ],
};

HAPPY["matching"] = {
  title: "Match the Capitals",
  prompt: "Match each country to its capital.",
  config: {
    leftItems: ["France", "Japan", "Egypt", "Brazil", "Canada"],
    rightItems: ["Paris", "Tokyo", "Cairo", "Brasilia", "Ottawa"],
    correctMatches: { France: "Paris", Japan: "Tokyo", Egypt: "Cairo", Brazil: "Brasilia", Canada: "Ottawa" },
  },
};

HAPPY["labelme"] = {
  title: "Label the Plant Cell",
  prompt: "Drag each term to the correct marker.",
  imagePrompt: "A labeled diagram of a plant cell with markers on the nucleus, cell wall, chloroplast, vacuole, and membrane.",
  labels: [
    { id: "A", correct: "Nucleus", x: 30, y: 40 },
    { id: "B", correct: "Cell wall", x: 10, y: 10 },
    { id: "C", correct: "Chloroplast", x: 60, y: 50 },
    { id: "D", correct: "Vacuole", x: 50, y: 70 },
    { id: "E", correct: "Membrane", x: 20, y: 80 },
  ],
  options: ["Nucleus", "Cell wall", "Chloroplast", "Vacuole", "Membrane"],
};

HAPPY["vennsort"] = {
  title: "Reptiles vs Amphibians",
  prompt: "Place each item in the correct region of the Venn diagram.",
  config: {
    categories: ["Reptiles", "Amphibians"],
    items: [
      { text: "Dry scaly skin", categories: ["Reptiles"] },
      { text: "Lays eggs in water", categories: ["Amphibians"] },
      { text: "Cold-blooded", categories: ["Reptiles", "Amphibians"] },
      { text: "Has lungs as adult", categories: ["Reptiles", "Amphibians"] },
      { text: "Breathes through skin", categories: ["Amphibians"] },
      { text: "Snake", categories: ["Reptiles"] },
    ],
  },
};

HAPPY["brain-blitz"] = {
  title: "Brain Blitz: Geography",
  prompt: "Buzz in with the answer to each clue.",
  clues: [
    { clue: "Largest ocean on Earth", answer: "Pacific" },
    { clue: "Longest river in the world", answer: "Nile" },
    { clue: "Tallest mountain above sea level", answer: "Everest" },
    { clue: "Largest desert", answer: "Sahara" },
    { clue: "Smallest continent", answer: "Australia" },
  ],
};

HAPPY["true-false-tictactoe"] = {
  title: "Tic-Tac-Toe: Fractions",
  prompt: "Claim a square by judging each statement True or False.",
  statements: [
    { text: "1/2 equals 2/4", answer: true }, { text: "3/3 is less than 1", answer: false },
    { text: "1/4 plus 1/4 equals 1/2", answer: true }, { text: "5/5 equals 1", answer: true },
    { text: "2/3 is greater than 3/4", answer: false }, { text: "1/10 is greater than 1/5", answer: false },
    { text: "0.5 equals 1/2", answer: true }, { text: "7/8 is less than 1", answer: true },
    { text: "1/3 equals 0.3 exactly", answer: false },
  ],
};

HAPPY["true-false-connect-four"] = {
  title: "Connect Four: Grammar",
  prompt: "Drop your token by answering True or False.",
  statements: [
    { text: "A noun names a person, place, or thing.", isFalse: false },
    { text: "Adjectives describe verbs.", isFalse: true },
    { text: "A sentence must have a subject.", isFalse: false },
    { text: "'Quickly' is a noun.", isFalse: true },
    { text: "Verbs show action.", isFalse: false },
    { text: "A pronoun replaces a noun.", isFalse: false },
    { text: "Punctuation is never important.", isFalse: true },
  ],
};

HAPPY["tower-builder"] = {
  title: "Build the Tower: Exercise",
  prompt: "Stack only the true benefits to build the tallest tower.",
  items: [
    { statement: "Exercise strengthens the heart.", category: "benefit" },
    { statement: "Exercise improves mood.", category: "benefit" },
    { statement: "Exercise builds muscle.", category: "benefit" },
    { statement: "Exercise rots your teeth.", category: "harm" },
    { statement: "Exercise makes you weaker.", category: "harm" },
    { statement: "Exercise improves sleep.", category: "benefit" },
  ],
};

const flashSample = (title) => ({
  title,
  prompt: "Flip through the cards and recall each answer.",
  items: [
    { question: "Capital of France", answer: "Paris" },
    { question: "Capital of Japan", answer: "Tokyo" },
    { question: "Capital of Italy", answer: "Rome" },
    { question: "Capital of Spain", answer: "Madrid" },
    { question: "Capital of Egypt", answer: "Cairo" },
  ],
});
HAPPY["flashcards"] = flashSample("Capitals Flashcards");
HAPPY["flashcards-race"] = flashSample("Capitals Race");

HAPPY["pet-feeding"] = {
  title: "Feed the Pet: Healthy Habits",
  prompt: "Feed the pet only the healthy choices.",
  goodFoods: ["Drink water", "Eat vegetables", "Sleep 8 hours", "Exercise daily", "Wash hands"],
  badFoods: ["Skip breakfast", "Stay up all night", "Eat only candy", "Never brush teeth", "Avoid all activity"],
};

HAPPY["guess-who"] = {
  title: "Guess Who: Scientists",
  prompt: "Ask yes/no questions to identify the mystery scientist.",
  config: {
    secretAnswers: ["Isaac Newton", "Marie Curie", "Charles Darwin", "Albert Einstein"],
    items: [
      { name: "Isaac Newton", facts: ["Described gravity", "Studied light"] },
      { name: "Marie Curie", facts: ["Discovered radium", "Won two Nobel Prizes"] },
      { name: "Charles Darwin", facts: ["Theory of evolution", "Sailed the Beagle"] },
      { name: "Albert Einstein", facts: ["Theory of relativity", "E=mc^2"] },
    ],
  },
};

HAPPY["echo-chain"] = {
  title: "Echo Chain: Vocabulary",
  prompt: "Repeat the chain aloud, then add one related word.",
  config: { seedTerm: "Photosynthesis" },
};

HAPPY["hangman-duel"] = {
  title: "Hangman Duel: Biology Terms",
  prompt: "Guess the hidden word letter by letter.",
  config: {
    wordsByStation: [
      { word: "cell", hint: "The basic unit of life" },
      { word: "gene", hint: "A unit of heredity" },
      { word: "atom", hint: "Smallest unit of an element" },
      { word: "tissue", hint: "A group of similar cells" },
      { word: "organ", hint: "A structure made of tissues" },
      { word: "enzyme", hint: "A protein that speeds reactions" },
      { word: "nucleus", hint: "Control center of the cell" },
      { word: "protein", hint: "Built from amino acids" },
    ],
  },
};

HAPPY["word-weaver-duel"] = {
  title: "Word Weaver: Weather",
  prompt: "Use the given words to build the best sentence.",
  config: { words: ["storm", "pressure", "humidity", "front", "forecast", "climate", "barometer"] },
};

HAPPY["fake-out"] = {
  title: "Fake Out: History",
  prompt: "Spot the real answer among the fakes.",
  config: {
    rounds: [
      { prompt: "Who was the first US president?", options: ["George Washington", "Thomas Jefferson", "John Adams"], correctOption: "George Washington", correctIndex: 0, jokeOption: "Abraham Lincoln Jr.", jokeIndex: 3 },
      { prompt: "What year did WWII end?", options: ["1945", "1939", "1918"], correctOption: "1945", correctIndex: 0, jokeOption: "Last Tuesday", jokeIndex: 3 },
      { prompt: "Where were the pyramids built?", options: ["Egypt", "Greece", "Rome"], correctOption: "Egypt", correctIndex: 0, jokeOption: "Atlantis", jokeIndex: 3 },
    ],
  },
};

HAPPY["mystery-clues"] = {
  title: "Mystery: The Missing Element",
  prompt: "Use the clues to deduce the answer.",
  clues: ["I am a gas at room temperature.", "I make up most of Earth's atmosphere.", "My symbol is N."],
};

HAPPY["what-am-i"] = {
  title: "What Am I? Cell Structure",
  prompt: "Read the clues and guess.",
  answer: "Mitochondria",
  acceptableAnswers: ["mitochondria", "the mitochondria"],
  clues: [
    { level: 1, text: "I am found in nearly every eukaryotic cell." },
    { level: 2, text: "I convert nutrients into usable energy." },
    { level: 3, text: "I am nicknamed the powerhouse." },
  ],
  difficulty: "medium",
  mode: "intra-team",
};

HAPPY["brain-spark-notes"] = {
  title: "Brain Spark Notes: The Cell",
  prompt: "Copy these key notes into your notebook.",
  notes: {
    heading: "The Cell",
    keyTerms: [
      { term: "Nucleus", definition: "Control center of the cell.", points: ["Holds DNA", "Directs activity"] },
      { term: "Mitochondria", definition: "Produces energy.", points: ["Makes ATP", "Has its own DNA"] },
      { term: "Membrane", definition: "Outer boundary.", points: ["Controls entry", "Semi-permeable"] },
    ],
    mainPoints: [
      { heading: "Structure", bullets: ["Cells have organelles", "Each has a job"] },
      { heading: "Function", bullets: ["Cells make energy", "Cells reproduce"] },
      { heading: "Types", bullets: ["Plant cells", "Animal cells"] },
    ],
    summary: ["Cells are the basic unit of life.", "Each organelle has a role."],
  },
};

HAPPY["mind-mapper"] = {
  title: "Mind Map: Ecosystems",
  prompt: "Fill in the blank slots with the correct terms.",
  structure: {
    center: "Ecosystem",
    branches: [
      { label: "Producers", slots: ["_____", "_____"] },
      { label: "Consumers", slots: ["_____", "_____"] },
    ],
  },
  items: [
    { text: "Grass", correctIndex: 0 },
    { text: "Algae", correctIndex: 1 },
    { text: "Deer", correctIndex: 2 },
    { text: "Wolf", correctIndex: 3 },
  ],
};

HAPPY["narration-synthesize"] = {
  title: "Build the Story Together",
  prompt: "Each player adds one line following their prompt.",
  config: {
    playerCount: 3,
    prompts: [
      "Set the scene in a forest.",
      "Introduce a surprising character.",
      "Add a problem to solve.",
    ],
  },
};

HAPPY["role-play-deck"] = {
  title: "Town Hall Role Play",
  prompt: "Each student plays a role in the debate.",
  config: {
    scenario: "The town council is deciding whether to build a new park.",
    roles: [
      { role: "Mayor", goal: "Keep the budget balanced", constraint: "Must remain neutral" },
      { role: "Parent", goal: "Get a safe play space", constraint: "Limited free time" },
      { role: "Business owner", goal: "Attract more customers", constraint: "Worried about parking" },
    ],
  },
};

HAPPY["script-play"] = {
  title: "Scene: The Big Decision",
  prompt: "Perform the scene with your group.",
  config: {
    roles: ["Captain", "Navigator"],
    lines: [
      "Captain: We are off course.",
      "Navigator: The storm pushed us east.",
      "Captain: Can we correct it before dawn?",
      "Navigator: Only if we change heading now.",
    ],
  },
};

HAPPY["pronunciation"] = {
  title: "Pronounce: Bonjour",
  prompt: "Say the phrase aloud clearly.",
  referenceText: "Bonjour, comment allez-vous?",
};

HAPPY["speech-recognition"] = {
  title: "Say the Sentence",
  prompt: "Read this sentence aloud.",
  config: { referenceText: "The quick brown fox jumps over the lazy dog." },
};

HAPPY["letter"] = {
  title: "Letter to a Historical Figure",
  prompt: "Write a letter to Abraham Lincoln about leadership.",
  config: {
    character: "Abraham Lincoln",
    relevantConcepts: ["Emancipation Proclamation", "Civil War", "Gettysburg Address", "national unity"],
  },
};

HAPPY["interview"] = {
  title: "Interview Einstein",
  prompt: "Conduct an interview with this historical figure.",
  candidates: [
    { name: "Albert Einstein", era: "20th century", description: "Theoretical physicist.", greeting: "Hello, curious one!", systemPrompt: "You are Albert Einstein. Answer warmly about relativity and curiosity." },
    { name: "Isaac Newton", era: "17th century", description: "Physicist and mathematician.", greeting: "Good day.", systemPrompt: "You are Isaac Newton. Discuss gravity and optics formally." },
  ],
  minTurns: 3,
  maxTurns: 5,
};

HAPPY["cloze"] = {
  title: "Fill the Blanks: Water Cycle",
  prompt: "Drag the correct word into each blank.",
  passage: "Water ___ from the ocean, rises, and forms ___. It then falls as ___.",
  blanks: [{ answer: "evaporates" }, { answer: "clouds" }, { answer: "rain" }],
  distractors: ["freezes", "snow"],
};

HAPPY["teach-back"] = {
  title: "Teach a 2nd Grader",
  prompt: "Explain these concepts simply.",
  concepts: ["Gravity", "Friction", "Energy"],
  targetAge: "a 2nd grader",
};

HAPPY["peer-editing"] = {
  title: "Edit the Paragraph",
  prompt: "Find and fix the errors in the passage.",
  passage: "The cat sat on teh mat and looked at the bird. It was very hungery and wanted to chase it accross the yard.",
  errors: [
    { wordIndex: 4, type: "typo", correct: "the", word: "teh" },
    { wordIndex: 13, type: "typo", correct: "hungry", word: "hungery" },
    { wordIndex: 18, type: "typo", correct: "across", word: "accross" },
  ],
};

HAPPY["live-debate"] = {
  title: "Debate: School Uniforms",
  prompt: "Argue your side of the resolution.",
  config: { postulate: "Schools should require uniforms." },
};

HAPPY["brainstorm-battle"] = {
  title: "Brainstorm Battle: Inventions",
  prompt: "List as many ideas as you can each round.",
  config: { rounds: [{ prompt: "Name uses for a paperclip." }, { prompt: "Name ways to save water." }] },
};

HAPPY["riddle"] = {
  title: "Riddle Break",
  prompt: "What has keys but no locks, space but no room?",
  config: { riddle: "What has keys but no locks, space but no room?", answer: "A keyboard" },
};

HAPPY["trivia"] = {
  title: "Trivia Round",
  prompt: "Answer the trivia questions.",
  config: {
    rounds: [
      { mode: "truefalse", statement: "The sun is a star.", answer: true },
      { mode: "bluff", facts: ["Honey never spoils", "Sharks have bones", "Bananas are berries"], fakeIndex: 1 },
      { mode: "closerto", question: "How many bones in the adult body?", choices: ["206", "300"], correctChoice: 0 },
    ],
  },
};

HAPPY["spinner"] = {
  title: "Spin to Win",
  prompt: "Spin the wheel and answer.",
  config: {
    wedges: [
      { label: "Easy", points: 10 }, { label: "Medium", points: 20 },
      { label: "Hard", points: 30 }, { label: "Bonus", points: 50 },
    ],
  },
};

HAPPY["musical-chairs"] = {
  title: "Musical Chairs: Math Facts",
  prompt: "Answer when the music stops.",
  items: [
    { prompt: "7 x 8 = ?", options: ["54", "56", "48", "64"], correctAnswer: 1 },
    { prompt: "9 x 6 = ?", options: ["54", "56", "63", "45"], correctAnswer: 0 },
    { prompt: "12 x 12 = ?", options: ["124", "144", "121", "132"], correctAnswer: 1 },
  ],
};

HAPPY["mad-dash-sequence"] = {
  title: "Mad Dash: Order of Operations",
  prompt: "Run to arrange the steps in order.",
  config: {
    items: [
      { text: "Parentheses" }, { text: "Exponents" }, { text: "Multiply/Divide" }, { text: "Add/Subtract" },
    ],
    correctOrder: [0, 1, 2, 3],
  },
};

HAPPY["art-view"] = {
  title: "Observe the Painting",
  prompt: "Study the artwork and record your observations.",
  config: {
    imageUrl: "https://example.com/starry-night.jpg",
    imageDescription: "A swirling night sky over a village, with a large cypress tree in the foreground and a bright crescent moon.",
  },
};

HAPPY["historical-doc"] = {
  title: "Analyze the Document",
  prompt: "Read the primary source and answer the prompts.",
  config: {
    imageUrl: "https://example.com/declaration.jpg",
    docTitle: "The Declaration of Independence",
    imageDescription: "A handwritten parchment beginning 'When in the Course of human events...'",
    analysisPrompts: ["What is the main argument?", "Who was the intended audience?"],
  },
};

HAPPY["diff-detective"] = {
  title: "Spot the Differences",
  prompt: "Compare the two scenes and find the changes.",
  mode: "scene",
  sceneItems: ["tree", "house", "sun", "river", "bird"],
};

HAPPY["legends"] = {
  title: "Legends: A Pioneer of Science",
  prompt: "Sort the 10 facts to identify the figure.",
  config: {
    figure: {
      name: "Marie Curie",
      portraitUrl: "https://example.com/curie.jpg",
      era: "Late 1800s – early 1900s",
      summary: "Pioneering physicist and chemist.",
    },
    facts: [
      { text: "Was the first woman to win a Nobel Prize.", category: "what" },
      { text: "Discovered two new elements.", category: "what" },
      { text: "Worked in a converted shed in Paris.", category: "where" },
      { text: "Was born in Warsaw.", category: "where" },
      { text: "Believed knowledge belongs to all.", category: "why" },
      { text: "Wanted to relieve battlefield suffering.", category: "why" },
      { text: "Lived from 1867 to 1934.", category: "when" },
      { text: "Enjoyed cycling holidays.", category: "decoy" },
      { text: "Spoke several languages.", category: "decoy" },
      { text: "Had a lifelong love of poetry.", category: "decoy" },
    ],
  },
};

HAPPY["truth-or-dare"] = {
  title: "Truth or Dare: Photosynthesis",
  prompt: "Pick truth or dare and complete the challenge.",
  config: {
    subject: "Science",
    unitName: "Photosynthesis",
    gradeLevel: 7,
  },
};

HAPPY["current-events"] = {
  title: "Today's Connection",
  prompt: "Loading today's connection to the lesson…",
  config: { lessonTopic: "Renewable energy" },
};

HAPPY["hole-in-one"] = {
  title: "Hole in One: Vocabulary",
  prompt: "Answer questions to earn coins, then place rails to guide the ball.",
  config: {
    board: { width: 12, height: 18, gridSize: 24, startPosition: { x: 1, y: 1 }, holePosition: { x: 10, y: 16, radius: 0.8 }, obstacles: [] },
    questionBank: [
      { prompt: "What is 2 + 2?", answer: "4" },
      { prompt: "Capital of France?", answer: "Paris" },
    ],
  },
};

HAPPY["careers"] = {
  title: "Careers: Best Fit",
  prompt: "Decide whether this career fits the candidate.",
  config: {
    mode: "best-fit",
    career: { name: "Marine Biologist", description: "Studies ocean life and ecosystems." },
  },
};

HAPPY["quest"] = {
  title: "Quest: Build a Settlement",
  prompt: "Gather resources and complete the objectives.",
  config: {
    title: "Found a Colony",
    scenario: "Your group lands on an uninhabited coast and must build a thriving settlement.",
    objectives: [
      { description: "Build a shelter", requiredResources: { wood: 2 } },
      { description: "Secure fresh water", requiredResources: {} },
    ],
    resources: [
      { id: "wood", name: "Wood", acquisitionOptions: [{ type: "coins", amount: 10 }] },
      { id: "water", name: "Water", acquisitionOptions: [{ type: "coins", amount: 5 }] },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Sloppy-variant builders. Each takes a clone of the happy sample and injects
// the common AI mistakes for that type. The pipeline should RECOVER (playable)
// or REJECT cleanly — never crash, never silently-broken-playable.
// ──────────────────────────────────────────────────────────────────────────
const SLOPPY = {
  // Bug class 2: content under config instead of top-level.
  "multiple-choice": (t) => ({ ...t, items: undefined, config: { items: t.items } }),
  "physical-multiple-choice": (t) => ({ ...t, items: undefined, config: { items: t.items } }),
  // Bug class 2: statements key synonym + missing canonical.
  "true-false": (t) => ({ ...t, items: undefined, statements: t.items }),
  // Bug class 8: correctAnswer as bool synonyms already handled; flip to isTrue strings.
  "true-false-tictactoe": (t) => ({ ...t, statements: t.statements.map((s) => ({ text: s.text, isTrue: String(s.answer) })) }),
  "true-false-connect-four": (t) => ({ ...t, statements: undefined, items: t.statements }),
  // Bug class 2: cards under alt keys.
  flashcards: (t) => ({ ...t, items: undefined, config: { cards: t.items } }),
  "flashcards-race": (t) => ({ ...t, items: undefined, cards: t.items }),
  // Bug class 1: empty array → should be rejected, not crash.
  matching: (t) => ({ ...t, config: { ...t.config, leftItems: [], rightItems: [], correctMatches: {} } }),
  // Bug class 1: empty items[] + generic instruction prompt → must reject,
  // not silently turn the instruction into a bogus single question.
  "short-answer": (t) => ({ ...t, items: [], prompt: "Answer each question in one sentence." }),
  // Bug class 3: more rounds claimed via playerCount than prompts.
  "narration-synthesize": (t) => ({ ...t, config: { playerCount: 8, prompts: t.config.prompts } }),
  // Bug class 6: bonus unlock at 100 should downgrade to 50.
  sort: (t) => ({ ...t, isBonus: true, unlockConditions: { coreProgressPct: 100 } }),
  // Bug class 7: worldview unset on a faith subject — sanitizer should infer.
  "truth-or-dare": (t) => ({ ...t, config: { subject: "Bible", unitName: "The Gospels", gradeLevel: 8 } }),
  // Bug class 8: correctOrder trivial identity (sanitizer auto-scrambles).
  "mad-dash-sequence": (t) => ({ ...t, config: { items: t.config.items, correctOrder: [0, 1, 2, 3] } }),
  // Bug class 4: missing config defaults the renderer needs.
  "art-view": (t) => ({ ...t, config: { imageDescription: t.config.imageDescription } }),
  // Bug class 5: tight timer on a complex build prompt — sanitizer bumps it.
  "make-and-snap": (t) => ({ ...t, prompt: "Build a detailed model of the solar system and photograph it.", timeLimitSeconds: 30 }),
  photo: (t) => ({ ...t, prompt: "Create a detailed drawing of a cell and photograph it.", timeLimitSeconds: 20 }),
  // Bug class 2: fake-out joke leaked into options.
  "fake-out": (t) => ({
    ...t,
    config: {
      rounds: t.config.rounds.map((r) => ({ ...r, options: [...r.options, r.jokeOption] })),
    },
  }),
  // Bug class 3: fewer cards than required → reject cleanly.
  "hangman-duel": (t) => ({ ...t, config: { wordsByStation: t.config.wordsByStation.slice(0, 4) } }),
  // Bug class 2: referenceText under config alias.
  pronunciation: (t) => ({ ...t, referenceText: undefined, config: { referenceText: HAPPY["pronunciation"].referenceText } }),
  // Bug class 2: structure/items under config.
  "mind-mapper": (t) => ({ ...t, structure: undefined, items: undefined, config: { structure: HAPPY["mind-mapper"].structure, items: HAPPY["mind-mapper"].items } }),
  // Bug class 1: empty clues → reject cleanly.
  "draw-mime": (t) => ({ ...t, clues: [] }),
  // Bug class 8: legends portraitUrl missing protocol → reject cleanly.
  legends: (t) => ({ ...t, config: { ...clone(t.config), figure: { ...t.config.figure, portraitUrl: "curie.jpg" } } }),
};

// ──────────────────────────────────────────────────────────────────────────
// Run the audit.
// ──────────────────────────────────────────────────────────────────────────
const eligible = Object.entries(TASK_TYPE_META)
  .filter(([, v]) => v.implemented === true && v.generatorEligible === true)
  .map(([t]) => t)
  .sort();

const rows = [];
let happyPlayable = 0;
let happyUnplayable = 0;
const missingSamples = [];

for (const type of eligible) {
  const sample = HAPPY[type];
  if (!sample) {
    missingSamples.push(type);
    rows.push({ type, happy: "NO-SAMPLE", sloppy: "-" });
    continue;
  }

  // Happy path
  const happy = runPipeline(type, sample);
  const happyOk = happy.ok && happy.playable && !happy.crash;
  if (happyOk) happyPlayable += 1;
  else happyUnplayable += 1;

  let happyLabel = happyOk ? "PASS" : "FAIL";
  let happyDetail = "";
  if (!happyOk) {
    if (happy.crash) happyDetail = `CRASH: ${happy.crash}`;
    else happyDetail = [...happy.errors, ...happy.issues.map((i) => `unplayable: ${i}`)].join(" | ");
  }

  // Sloppy variant
  let sloppyLabel = "—";
  let sloppyDetail = "";
  const sloppyFn = SLOPPY[type];
  if (sloppyFn) {
    const sloppyRaw = sloppyFn(clone(sample));
    const s = runPipeline(type, sloppyRaw);
    if (s.crash) { sloppyLabel = "CRASH"; sloppyDetail = s.crash; }
    else if (s.ok && s.playable) { sloppyLabel = "RECOVERED"; }
    else { sloppyLabel = "REJECTED"; sloppyDetail = [...s.errors, ...s.issues].slice(0, 2).join(" | "); }
  }

  rows.push({ type, happy: happyLabel, happyDetail, sloppy: sloppyLabel, sloppyDetail });
}

// ── Print table ──
_log("\n══════════════════════════════════════════════════════════════════════");
_log(" PLAYABILITY AUDIT — happy-path + sloppy-variant per eligible task type");
_log("══════════════════════════════════════════════════════════════════════\n");
_log(`${"TYPE".padEnd(28)} ${"HAPPY".padEnd(10)} SLOPPY`);
_log("─".repeat(70));
for (const r of rows) {
  _log(`${r.type.padEnd(28)} ${String(r.happy).padEnd(10)} ${r.sloppy}`);
  if (r.happyDetail) _log(`${" ".repeat(28)}   ↳ ${r.happyDetail}`);
  if (r.sloppyDetail) _log(`${" ".repeat(28)}   ↳ sloppy: ${r.sloppyDetail}`);
}

// ── Summary ──
const crashCount = rows.filter((r) => r.sloppy === "CRASH").length;
_log("\n──────────────────────────── SUMMARY ────────────────────────────");
_log(`Happy-path: ${happyPlayable} playable / ${eligible.length} total`);
if (happyUnplayable > 0) {
  _log(`\nUNPLAYABLE happy-path samples (${happyUnplayable}):`);
  rows.filter((r) => r.happy === "FAIL").forEach((r) => _log(`  ✗ ${r.type}: ${r.happyDetail}`));
}
if (missingSamples.length) {
  _log(`\nTypes with NO hand-built sample (${missingSamples.length}): ${missingSamples.join(", ")}`);
}
const recovered = rows.filter((r) => r.sloppy === "RECOVERED").map((r) => r.type);
const rejected = rows.filter((r) => r.sloppy === "REJECTED").map((r) => r.type);
_log(`\nSloppy variants — RECOVERED (${recovered.length}): ${recovered.join(", ") || "none"}`);
_log(`Sloppy variants — REJECTED cleanly (${rejected.length}): ${rejected.join(", ") || "none"}`);
if (crashCount > 0) {
  _log(`\n⚠️  Sloppy variants that CRASHED (${crashCount}):`);
  rows.filter((r) => r.sloppy === "CRASH").forEach((r) => _log(`  ✗ ${r.type}: ${r.sloppyDetail}`));
}

// ── Exit code: fail only if a happy-path sample is unplayable, a sample is
//    missing, or a sloppy variant crashed (a crash is always a real bug). ──
const exitBad = happyUnplayable > 0 || missingSamples.length > 0 || crashCount > 0;
_log(`\n${exitBad ? "❌ AUDIT FAILED" : "✅ AUDIT PASSED"} — happy=${happyPlayable}/${eligible.length}, sloppy-crashes=${crashCount}\n`);
process.exit(exitBad ? 1 : 0);
