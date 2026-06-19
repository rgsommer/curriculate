#!/usr/bin/env node
// test-all-shells.mjs
//
// Tests ALL task type shell templates 10x each.
// For each shell: builds template → fills with simulated content → parses →
// runs through normalizeTaskByType → sanitizeTaskShapeByType → validateAiTask.
//
// Each task type gets 10 different fill variations to stress-test the pipeline.

import { TASK_TYPES, TASK_SHELLS } from "../../shared/taskTypes.js";
import { normalizeTaskByType } from "../validators/taskValidators.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { validateAiTask } from "../controllers/sharedTasksetController.js";

// ── Helper: build, fill, parse, validate ──
function testShell(taskType, fillValues, shellOpts = {}) {
  const shellBuilder = TASK_SHELLS[taskType];
  if (!shellBuilder) throw new Error(`No shell builder for ${taskType}`);

  const { shell, placeholderNames } = shellBuilder(shellOpts);

  const missing = placeholderNames.filter((k) => fillValues[k] === undefined || fillValues[k] === null);
  if (missing.length > 0) throw new Error(`Missing fill values: ${missing.join(", ")}`);

  let filled = shell;
  for (const key of placeholderNames) {
    const rawVal = fillValues[key];
    const val = String(rawVal).trim();
    const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    filled = filled.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escaped);

    const numVal = Number(val);
    const boolVal = val === "true" ? true : val === "false" ? false : null;
    if (!isNaN(numVal) && val !== "") {
      filled = filled.replace(new RegExp(`"<<${key}>>"`, "g"), String(numVal));
    } else if (boolVal !== null) {
      filled = filled.replace(new RegExp(`"<<${key}>>"`, "g"), String(boolVal));
    } else {
      filled = filled.replace(new RegExp(`"<<${key}>>"`, "g"), `"${escaped}"`);
    }
  }

  const task = JSON.parse(filled);

  if (task.config) {
    if (task.config.structure === "<<COPY_FROM_ROOT>>") task.config.structure = task.structure;
    if (task.config.items === "<<COPY_FROM_ROOT>>") task.config.items = [...(task.items || [])];
    if (task.config.clues === "<<COPY_CLUES>>") task.config.clues = [...(task.clues || [])];
    if (task.config.correctAnswer === "<<COPY_ANSWER>>") task.config.correctAnswer = task.correctAnswer;
  }

  let normalized = normalizeTaskByType(taskType, { ...task, taskType: task.taskType });
  normalized = sanitizeTaskShapeByType(taskType, normalized);

  if (normalized._validationError) {
    throw new Error(`[Quality Guardrail] ${normalized._validationError}`);
  }

  const result = validateAiTask(taskType, normalized);
  if (!result.ok) {
    throw new Error(`Validation: ${result.errors.join("; ")}`);
  }

  return normalized;
}

// ══════════════════════════════════════════════════
// VOCABULARY POOLS (10 sets to rotate through)
// ══════════════════════════════════════════════════

const VOCAB_SETS = [
  // Set 0: Algebra/Equations
  { terms: ["variable", "equation", "solution", "algebraic expression", "integers", "zero pair", "magnitude", "markup", "pattern rule", "isolate the variable", "table of values", "zero principle", "opposite integers", "solve by re-grouping"],
    subject: "Math", topic: "Solving Equations", grade: 7 },
  // Set 1: Biology
  { terms: ["photosynthesis", "chloroplast", "mitochondria", "cell membrane", "nucleus", "cytoplasm", "osmosis", "diffusion", "respiration", "enzyme", "glucose", "carbon dioxide", "oxygen", "ATP"],
    subject: "Science", topic: "Cell Biology", grade: 8 },
  // Set 2: History
  { terms: ["confederation", "constitution", "democracy", "parliament", "federation", "sovereignty", "treaty", "colony", "legislature", "amendment", "ratification", "republic", "monarchy", "revolution"],
    subject: "History", topic: "Canadian Confederation", grade: 7 },
  // Set 3: Geography
  { terms: ["erosion", "weathering", "sediment", "glacier", "tectonic plates", "fault line", "magma", "volcano", "earthquake", "continental drift", "mantle", "crust", "core", "lithosphere"],
    subject: "Science", topic: "Earth Science", grade: 7 },
  // Set 4: Literature
  { terms: ["metaphor", "simile", "alliteration", "personification", "imagery", "symbolism", "foreshadowing", "irony", "theme", "protagonist", "antagonist", "conflict", "resolution", "narrative"],
    subject: "Language Arts", topic: "Literary Devices", grade: 8 },
  // Set 5: Chemistry
  { terms: ["atom", "molecule", "element", "compound", "mixture", "solution", "solvent", "solute", "chemical reaction", "catalyst", "electron", "proton", "neutron", "periodic table"],
    subject: "Science", topic: "Chemistry Basics", grade: 8 },
  // Set 6: Music
  { terms: ["tempo", "rhythm", "melody", "harmony", "pitch", "dynamics", "forte", "piano", "crescendo", "staccato", "legato", "treble clef", "bass clef", "time signature"],
    subject: "Arts", topic: "Music Theory", grade: 7 },
  // Set 7: Health
  { terms: ["nutrition", "protein", "carbohydrate", "vitamins", "minerals", "hydration", "metabolism", "calories", "fiber", "saturated fat", "cholesterol", "sodium", "antioxidant", "balanced diet"],
    subject: "Health", topic: "Nutrition", grade: 7 },
  // Set 8: French
  { terms: ["conjugation", "infinitive", "subject", "predicate", "adjective", "adverb", "preposition", "pronoun", "article", "singular", "plural", "masculine", "feminine", "agreement"],
    subject: "French", topic: "Grammar Basics", grade: 7 },
  // Set 9: Technology
  { terms: ["algorithm", "variable", "loop", "function", "conditional", "debugging", "iteration", "array", "string", "boolean", "input", "output", "syntax", "compiler"],
    subject: "Technology", topic: "Coding Fundamentals", grade: 8 },
];

// ── Pick N random terms from a set ──
function pickTerms(setIdx, count) {
  const s = VOCAB_SETS[setIdx % VOCAB_SETS.length];
  const shuffled = [...s.terms].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
function meta(setIdx) {
  return VOCAB_SETS[setIdx % VOCAB_SETS.length];
}

// ══════════════════════════════════════════════════
// FILL GENERATORS — one per task type
// Each returns a fill object for a given vocab set index
// ══════════════════════════════════════════════════

const fillGenerators = {
  [TASK_TYPES.MULTIPLE_CHOICE]: (si) => {
    const t = pickTerms(si, 4); const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Quiz`, PROMPT: "Choose the best answer for each question.",
      Q1_PROMPT: `What is ${t[0]}?`, Q1_A: `A type of ${t[1]}`, Q1_B: `The correct definition of ${t[0]}`, Q1_C: `Another word for ${t[2]}`, Q1_D: `Related to ${t[3]}`, Q1_CORRECT_INDEX: "1",
      Q2_PROMPT: `Which term relates to ${t[1]}?`, Q2_A: t[0], Q2_B: t[2], Q2_C: t[1], Q2_D: t[3], Q2_CORRECT_INDEX: "2",
      Q3_PROMPT: `${t[2]} is best described as what?`, Q3_A: `The definition of ${t[2]}`, Q3_B: `A type of ${t[0]}`, Q3_C: `The opposite of ${t[3]}`, Q3_D: `None of the above`, Q3_CORRECT_INDEX: "0",
      Q4_PROMPT: `How does ${t[3]} work?`, Q4_A: `By using ${t[0]}`, Q4_B: `Through ${t[1]}`, Q4_C: `It doesn't`, Q4_D: `Through its core mechanism in ${m.topic}`, Q4_CORRECT_INDEX: "3",
    }, opts: {} };
  },

  [TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE]: (si) => {
    // Reuse MC generator
    return fillGenerators[TASK_TYPES.MULTIPLE_CHOICE](si);
  },

  [TASK_TYPES.MATCHING]: (si) => {
    const t = pickTerms(si, 6); const m = meta(si);
    const fill = { TITLE: `${m.topic} Match`, PROMPT: "Match each term to its definition." };
    t.forEach((term, i) => {
      fill[`TERM_${i + 1}`] = term;
      fill[`DEF_${i + 1}`] = `The definition of ${term} in the context of ${m.topic}`;
    });
    return { fill, opts: {} };
  },

  [TASK_TYPES.LABELME]: (si) => {
    const t = pickTerms(si, 5); const m = meta(si);
    const fill = {
      TITLE: `Label ${m.topic}`,
      PROMPT: "Match each marker A-E to the correct part.",
      IMAGE_PROMPT: `A clean, high-contrast educational diagram of ${m.topic}, simple flat illustration, no text labels.`,
    };
    ["A", "B", "C", "D", "E"].forEach((L, i) => {
      fill[`${L}_TERM`] = t[i];
      fill[`${L}_X`] = String(20 + i * 12);
      fill[`${L}_Y`] = String(20 + i * 12);
    });
    return { fill, opts: {} };
  },

  [TASK_TYPES.VENNSORT]: (si) => {
    const t = pickTerms(si, 8); const m = meta(si);
    const fill = {
      TITLE: `Sort ${m.topic} Terms`, PROMPT: "Drag each term into the correct category.",
      CAT_1: `${m.topic} Group A`, CAT_2: `${m.topic} Group B`,
    };
    t.forEach((term, i) => {
      fill[`ITEM_${i + 1}`] = term;
      fill[`ITEM_${i + 1}_CAT`] = i < 4 ? `${m.topic} Group A` : `${m.topic} Group B`;
    });
    return { fill, opts: { itemCount: 8, branchCount: 2 } };
  },

  [TASK_TYPES.JEOPARDY]: (si) => {
    const t = pickTerms(si, 6); const m = meta(si);
    const fill = { TITLE: `${m.topic} BrainBlitz`, PROMPT: "Listen to the clues and shout the answer!" };
    for (let i = 0; i < 6; i++) {
      fill[`CLUE_${i + 1}`] = `A grade ${m.grade} ${m.subject} concept from ${m.topic} (clue ${i + 1})`;
      fill[`ANSWER_${i + 1}`] = t[i];
    }
    return { fill, opts: { itemCount: 6 } };
  },

  [TASK_TYPES.FAKE_OUT]: (si) => {
    const t = pickTerms(si, 3); const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} FakeOut`, PROMPT: "Pick the correct answer — watch out for the joke!",
      R1_PROMPT: `What is ${t[0]}?`, R1_OPT_A: `The correct answer about ${t[0]}`, R1_OPT_B: `A wrong answer`, R1_OPT_C: `Another wrong answer`, R1_CORRECT_INDEX: "0", R1_CORRECT_OPT: `The correct answer about ${t[0]}`, R1_JOKE: `A silly banana`, R1_JOKE_INDEX: "2",
      R2_PROMPT: `Which describes ${t[1]}?`, R2_OPT_A: `Not this one`, R2_OPT_B: `The real definition of ${t[1]}`, R2_OPT_C: `Nope`, R2_CORRECT_INDEX: "1", R2_CORRECT_OPT: `The real definition of ${t[1]}`, R2_JOKE: `A dancing penguin`, R2_JOKE_INDEX: "3",
      R3_PROMPT: `${t[2]} is related to what?`, R3_OPT_A: `Nothing`, R3_OPT_B: `Something else`, R3_OPT_C: `${m.topic} concepts`, R3_CORRECT_INDEX: "2", R3_CORRECT_OPT: `${m.topic} concepts`, R3_JOKE: `Pizza delivery`, R3_JOKE_INDEX: "1",
    }, opts: { itemCount: 3 } };
  },

  [TASK_TYPES.MAD_DASH_SEQUENCE]: (si) => {
    const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Steps`, PROMPT: "Put the steps in the correct order.",
      STEP_1: `First step in ${m.topic}`,
      STEP_2: `Second step in ${m.topic}`,
      STEP_3: `Third step in ${m.topic}`,
      STEP_4: `Final step in ${m.topic}`,
    }, opts: { itemCount: 4 } };
  },

  [TASK_TYPES.HANGMAN_DUEL]: (si) => {
    // Need 8 pure-alpha words — strip spaces/hyphens and filter
    const m = meta(si);
    const alphaPool = m.terms
      .map(t => t.replace(/[\s\-']/g, ""))
      .filter(t => /^[a-zA-Z]{3,14}$/.test(t));
    // Pad from a reliable backup pool to guarantee 8
    const backup = ["concept", "theory", "model", "system", "process", "method", "element", "factor", "formula", "pattern", "result", "analysis"];
    const combined = [...new Set([...alphaPool, ...backup])];
    const t = combined.slice(0, 8);
    const fill = { TITLE: `${m.topic} Hangman`, PROMPT: "Guess the letters to reveal each term." };
    t.forEach((term, i) => {
      fill[`WORD_${i + 1}`] = term;
      fill[`HINT_${i + 1}`] = `A key term in ${m.topic} related to ${m.subject}`;
    });
    return { fill, opts: {} };
  },

  [TASK_TYPES.FLASHCARDS]: (si) => {
    const t = pickTerms(si, 5); const m = meta(si);
    const fill = { TITLE: `${m.topic} Study Cards`, PROMPT: "Flip each card to study." };
    t.forEach((term, i) => {
      fill[`FRONT_${i + 1}`] = term;
      fill[`BACK_${i + 1}`] = `Definition of ${term} in ${m.topic}`;
    });
    return { fill, opts: { itemCount: 5 } };
  },

  [TASK_TYPES.FLASHCARDS_RACE]: (si) => {
    const t = pickTerms(si, 5); const m = meta(si);
    const fill = { TITLE: `${m.topic} Speed Cards`, PROMPT: "Type the term as fast as you can!" };
    t.forEach((term, i) => {
      fill[`CLUE_${i + 1}`] = `The definition of ${term}`;
      fill[`TERM_${i + 1}`] = term;
    });
    return { fill, opts: { itemCount: 5 } };
  },

  [TASK_TYPES.PET_FEEDING]: (si) => {
    const t = pickTerms(si, 6); const m = meta(si);
    const fill = { TITLE: `${m.topic} Pet Feeding`, PROMPT: "Feed true statements, reject false ones!" };
    for (let i = 0; i < 6; i++) {
      fill[`TRUE_${i + 1}`] = `${t[i % t.length]} is an important concept in ${m.topic}`;
      fill[`FALSE_${i + 1}`] = `${t[(i + 3) % t.length]} has nothing to do with ${m.subject}`;
    }
    return { fill, opts: { itemCount: 6 } };
  },

  [TASK_TYPES.MUSICAL_CHAIRS]: (si) => {
    const t = pickTerms(si, 7); const m = meta(si);
    const fill = { TITLE: `${m.topic} Musical Chairs`, PROMPT: "Tap your answer before the music stops!" };
    for (let i = 0; i < 7; i++) {
      const n = i + 1;
      fill[`Q${n}_PROMPT`] = `What is ${t[i]}?`;
      fill[`Q${n}_A`] = `The correct answer for ${t[i]}`;
      fill[`Q${n}_B`] = `A wrong answer`;
      fill[`Q${n}_C`] = `Another wrong answer`;
      fill[`Q${n}_CORRECT_INDEX`] = String(i % 3);
    }
    return { fill, opts: {} };
  },

  [TASK_TYPES.ROLE_PLAY_DECK]: (si) => {
    // Shell was realigned to renderer contract (commit ebc4c9ae) —
    // {name, role, characteristics[3], gender} per role instead of
    // {name, goal, constraint}. Test fixture matched here so the
    // shell-fill check keeps passing.
    const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Role Play`, PROMPT: "Take on your assigned role.",
      SCENARIO: `A classroom debate about the most important concept in ${m.topic}. Students must argue their position using evidence from the lesson.`,
      ROLE_1_NAME: `Dr. Carter the ${m.topic} Expert`,
      ROLE_1_ROLE: `Subject-matter expert defending the importance of key ${m.topic} concepts`,
      ROLE_1_TRAIT_1: "knowledgeable", ROLE_1_TRAIT_2: "patient", ROLE_1_TRAIT_3: "articulate",
      ROLE_1_GENDER: "female",
      ROLE_2_NAME: `Casey the ${m.topic} Skeptic`,
      ROLE_2_ROLE: "Friendly challenger who keeps asking for evidence",
      ROLE_2_TRAIT_1: "curious", ROLE_2_TRAIT_2: "skeptical", ROLE_2_TRAIT_3: "fair",
      ROLE_2_GENDER: "nonbinary",
      ROLE_3_NAME: `Mateo the Mediator`,
      ROLE_3_ROLE: "Quiet peacemaker who summarises both sides before adding an opinion",
      ROLE_3_TRAIT_1: "calm", ROLE_3_TRAIT_2: "empathetic", ROLE_3_TRAIT_3: "thoughtful",
      ROLE_3_GENDER: "male",
    }, opts: { itemCount: 3 } };
  },

  [TASK_TYPES.BRAIN_SPARK_NOTES]: (si) => {
    const t = pickTerms(si, 6); const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Notes`, PROMPT: "Review these study notes.",
      HEADING: m.topic,
      SUMMARY_1: `${m.topic} is a key part of ${m.subject} in grade ${m.grade}.`,
      SUMMARY_2: `Understanding ${t[0]} and ${t[1]} is essential for mastery.`,
      KT_1_TERM: t[0], KT_1_DEF: `Definition of ${t[0]}`, KT_1_PT1: `${t[0]} is used in ${m.topic}`, KT_1_PT2: `${t[0]} relates to ${t[1]}`,
      KT_2_TERM: t[1], KT_2_DEF: `Definition of ${t[1]}`, KT_2_PT1: `${t[1]} is fundamental`, KT_2_PT2: `${t[1]} connects to ${t[2]}`,
      KT_3_TERM: t[2], KT_3_DEF: `Definition of ${t[2]}`, KT_3_PT1: `${t[2]} appears in many contexts`, KT_3_PT2: `${t[2]} is tested frequently`,
      MP_1_HEADING: `Understanding ${t[3]}`, MP_1_B1: `${t[3]} is defined as a core concept`, MP_1_B2: `Students should practice ${t[3]} regularly`,
      MP_2_HEADING: `Applying ${t[4]}`, MP_2_B1: `${t[4]} can be applied in real-world scenarios`, MP_2_B2: `${t[4]} builds on prior knowledge`,
      MP_3_HEADING: `Connecting ${t[5]}`, MP_3_B1: `${t[5]} ties together multiple ideas`, MP_3_B2: `${t[5]} is a synthesis concept`,
    }, opts: { itemCount: 3 } };
  },

  [TASK_TYPES.TRUE_FALSE_CONNECT_FOUR]: (si) => {
    const t = pickTerms(si, 10); const m = meta(si);
    const fill = { TITLE: `${m.topic} Connect Four`, PROMPT: "Answer true or false to claim a space!" };
    for (let i = 0; i < 10; i++) {
      const n = i + 1;
      const isTrue = i % 2 === 0;
      fill[`STMT_${n}`] = isTrue
        ? `${t[i % t.length]} is a real concept in ${m.topic}`
        : `${t[i % t.length]} has nothing to do with ${m.subject}`;
      fill[`STMT_${n}_IS_FALSE`] = isTrue ? "false" : "true";
    }
    return { fill, opts: { itemCount: 10 } };
  },

  [TASK_TYPES.TRUE_FALSE_TICTACTOE]: (si) => {
    const t = pickTerms(si, 9); const m = meta(si);
    const fill = { TITLE: `${m.topic} Tic Tac Toe`, PROMPT: "Answer true or false to place your mark!" };
    for (let i = 0; i < 9; i++) {
      const n = i + 1;
      const isTrue = i % 2 === 0;
      fill[`STMT_${n}`] = isTrue
        ? `${t[i % t.length]} is part of ${m.topic}`
        : `${t[i % t.length]} is unrelated to ${m.subject}`;
      fill[`STMT_${n}_IS_FALSE`] = isTrue ? "false" : "true";
    }
    return { fill, opts: {} };
  },

  [TASK_TYPES.SORT]: (si) => {
    const t = pickTerms(si, 8); const m = meta(si);
    const fill = {
      TITLE: `Sort ${m.topic}`, PROMPT: "Drag each term into the correct category.",
      BUCKET_1: `${m.topic} Basics`, BUCKET_2: `Advanced ${m.topic}`,
    };
    t.forEach((term, i) => {
      fill[`SORT_ITEM_${i + 1}`] = term;
      fill[`SORT_ITEM_${i + 1}_BUCKET`] = String(i < 4 ? 0 : 1);
    });
    return { fill, opts: { itemCount: 8, branchCount: 2 } };
  },

  [TASK_TYPES.GUESS_WHO]: (si) => {
    const t = pickTerms(si, 8); const m = meta(si);
    const fill = { TITLE: `Guess the ${m.topic} Concept`, PROMPT: "Read the facts and figure out which concept!" };
    t.forEach((term, i) => {
      const n = i + 1;
      fill[`CANDIDATE_${n}`] = term;
      fill[`CANDIDATE_${n}_FACT1`] = `This is a ${m.subject} term`;
      fill[`CANDIDATE_${n}_FACT2`] = `It relates to ${m.topic}`;
      fill[`CANDIDATE_${n}_FACT3`] = `Students learn it in grade ${m.grade}`;
    });
    return { fill, opts: {} };
  },

  [TASK_TYPES.LETTER]: (si) => {
    const t = pickTerms(si, 4); const m = meta(si);
    return { fill: {
      TITLE: `Letter about ${m.topic}`, PROMPT: "Write a letter as the character below.",
      CHARACTER: `Professor ${m.subject}son`, CHARACTER_DESC: `A renowned expert in ${m.topic} who teaches at a university.`,
      LETTER_STYLE: si % 2 === 0 ? "friendly" : "business",
      TOPIC_CONTEXT: `Explain to a colleague why ${t[0]} and ${t[1]} are important in ${m.topic}.`,
      CONCEPT_1: t[0], CONCEPT_2: t[1], CONCEPT_3: t[2], CONCEPT_4: t[3],
    }, opts: { itemCount: 4 } };
  },

  [TASK_TYPES.CASE_STUDY]: (si) => {
    const t = pickTerms(si, 5); const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Case Study`, PROMPT: "Analyze the scenario and propose a solution.",
      SCENARIO: `A student is struggling to understand the relationship between ${t[0]} and ${t[1]} in ${m.topic}. Their teacher has asked them to create a presentation explaining these concepts to younger students. How should they approach this task?`,
      EXPERT_ROLE: `${m.subject} Education Specialist`, EXPERT_DESC: `An expert who specializes in teaching ${m.topic} to middle school students.`,
      CONCEPT_1: t[0], CONCEPT_2: t[1], CONCEPT_3: t[2], CONCEPT_4: t[3], CONCEPT_5: t[4],
    }, opts: { itemCount: 5 } };
  },

  [TASK_TYPES.DIFF_DETECTIVE]: (si) => {
    const t = pickTerms(si, 3); const m = meta(si);
    return { fill: {
      TITLE: `${m.topic} Error Spotter`, PROMPT: "Find the differences between Text A and Text B.",
      TEXT_A: `In ${m.topic}, ${t[0]} is a fundamental concept. It connects to ${t[1]} through several key principles. Students in grade ${m.grade} learn that ${t[2]} plays an important role in understanding the subject.`,
      TEXT_B: `In ${m.topic}, ${t[0]} is an advanced concept. It connects to ${t[2]} through several minor principles. Students in grade ${m.grade + 1} learn that ${t[1]} plays a small role in understanding the topic.`,
      DIFF_1: "fundamental → advanced",
      DIFF_2: "key → minor",
      DIFF_3: "important → small",
      DIFF_4: "subject → topic",
      DIFF_5: `${t[1]} → ${t[2]}`,
      // Scene (visual) mode picks this instead; provide a superset so any
      // randomly-chosen shell variant (text / scene / compare-real) has its fills.
      ITEMS: `${m.topic} | ${t[0]} | ${t[1]} | ${t[2]} | Sample D | Sample E | Sample F | Sample G`,
      SUBJECT_A: `a classic example of ${t[0]}`,
      SUBJECT_B: `a modern example of ${t[0]}`,
      DESC_A: `An older form of ${t[0]} in ${m.topic}.`,
      DESC_B: `A newer form of ${t[0]} in ${m.topic}.`,
    }, opts: {} };
  },

  [TASK_TYPES.DRAW_MIME]: (si) => {
    const t = pickTerms(si, 4); const m = meta(si);
    return { fill: {
      TITLE: `Draw: ${m.topic}`,
      CLUE_1: t[0], CLUE_2: t[1], CLUE_3: t[2], CLUE_4: t[3],
    }, opts: {} };
  },

  [TASK_TYPES.MIND_MAPPER]: (si) => {
    const t = pickTerms(si, 6); const m = meta(si);
    const orgTypes = ["mind-map", "hierarchy", "fishbone", "flowchart", "venn", "web"];
    return { fill: {
      TITLE: `${m.topic} Concept Map`, PROMPT: "Drag terms into the correct branch.",
      ORGANIZER_TYPE: orgTypes[si % orgTypes.length], CENTER_TOPIC: m.topic, DIFFICULTY: "medium",
      BRANCH_1: `${m.topic} Foundations`, BRANCH_2: `${m.topic} Applications`, BRANCH_3: `${m.topic} Connections`,
      ITEM_1: t[0], ITEM_2: t[1], ITEM_3: t[2], ITEM_4: t[3], ITEM_5: t[4], ITEM_6: t[5],
    }, opts: { itemCount: 6, branchCount: 3 } };
  },
};


// ══════════════════════════════════════════════════
// RUN ALL TESTS — 10x EACH
// ══════════════════════════════════════════════════

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  ALL TASK SHELL TEMPLATES — 10x EACH VALIDATION TEST        ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

const typeList = Object.keys(fillGenerators);
let totalPassed = 0;
let totalFailed = 0;
const failures = [];

for (const taskType of typeList) {
  const typeName = Object.entries(TASK_TYPES).find(([, v]) => v === taskType)?.[0] || taskType;
  let typePassed = 0;
  let typeFailed = 0;
  const typeErrors = [];

  for (let run = 0; run < 10; run++) {
    try {
      const { fill, opts } = fillGenerators[taskType](run);
      testShell(taskType, fill, opts);
      typePassed++;
    } catch (err) {
      typeFailed++;
      if (!typeErrors.includes(err.message)) typeErrors.push(err.message);
    }
  }

  totalPassed += typePassed;
  totalFailed += typeFailed;

  if (typeFailed === 0) {
    console.log(`  ✅ ${typeName.padEnd(28)} 10/10`);
  } else {
    console.log(`  ❌ ${typeName.padEnd(28)} ${typePassed}/10`);
    typeErrors.forEach((e) => console.log(`     ERROR: ${e}`));
    failures.push({ type: typeName, passed: typePassed, errors: typeErrors });
  }
}

const totalTests = typeList.length * 10;
console.log("\n════════════════════════════════════════════════════════════════");
console.log(`  Task types: ${typeList.length}`);
console.log(`  Total runs: ${totalTests}`);
console.log(`  Passed: ${totalPassed}  Failed: ${totalFailed}`);
console.log(`  Success rate: ${(totalPassed / totalTests * 100).toFixed(1)}%`);
if (totalFailed === 0) {
  console.log("  🎉 100% SUCCESS RATE across all types × 10 runs!");
} else {
  console.log(`\n  ${failures.length} type(s) had failures.`);
}
console.log("════════════════════════════════════════════════════════════════");

// Exit non-zero on any failure so this can gate a build/deploy.
process.exit(totalFailed > 0 ? 1 : 0);
