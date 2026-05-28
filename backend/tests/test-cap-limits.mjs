#!/usr/bin/env node
// test-cap-limits.mjs
//
// Regression guard for the per-type item caps added in the "align task count
// limits" audit. For each capped task type we deliberately build an OVER-STUFFED
// task (more items than the cap), run it through the real deterministic pipeline
// (normalizeTaskByType → sanitizeTaskShapeByType), and assert the surviving
// arrays were trimmed to <= cap.
//
// This catches future drift where someone bumps a prompt count or removes a
// slice() and the model starts dumping the whole word bank again.
//
// Run: node backend/tests/test-cap-limits.mjs

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { normalizeTaskByType } from "../validators/taskValidators.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";

// ── helpers ──
const OVERSTUFF = 24; // every test feeds this many items, well past any cap

const len = (v) => (Array.isArray(v) ? v.length : 0);

function run(type, raw) {
  let t = normalizeTaskByType(type, { ...raw, taskType: type });
  t = sanitizeTaskShapeByType(type, t);
  return t;
}

// content generators (realistic enough to dodge placeholder rejection)
const longStatement = (i) => `Water expands when it freezes — variant ${i + 1} of the claim.`;
const mcItem = (i) => ({
  prompt: `Which option correctly describes concept ${i + 1}?`,
  options: ["First plausible answer", "Second plausible answer", "Third plausible answer", "Fourth plausible answer"],
  correctAnswer: i % 4,
});
const tfItem = (i) => ({ prompt: longStatement(i), correctAnswer: i % 2 === 0 });
const shortClue = (i) => `concept ${i + 1}`;
const term = (i) => `vocabulary term ${i + 1}`;
const definition = (i) => `A clear definition of vocabulary term number ${i + 1} for matching.`;

// ── test cases: { type, label, build(), checks(task) -> [{name, n, max}] } ──
const CASES = [
  {
    type: TASK_TYPES.MULTIPLE_CHOICE,
    label: "multiple-choice items <= 6",
    build: () => ({ title: "MC", prompt: "Choose.", items: Array.from({ length: OVERSTUFF }, (_, i) => mcItem(i)) }),
    checks: (t) => [{ name: "items", n: len(t.items), max: 6 }],
  },
  {
    type: TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE,
    label: "physical-multiple-choice items <= 6",
    build: () => ({ title: "PMC", prompt: "Choose.", items: Array.from({ length: OVERSTUFF }, (_, i) => mcItem(i)) }),
    checks: (t) => [{ name: "items", n: len(t.items), max: 6 }],
  },
  {
    type: TASK_TYPES.TRUE_FALSE,
    label: "true-false items <= 8",
    build: () => ({ title: "TF", prompt: "True or false?", items: Array.from({ length: OVERSTUFF }, (_, i) => tfItem(i)) }),
    checks: (t) => [{ name: "items", n: len(t.items), max: 8 }],
  },
  {
    type: TASK_TYPES.MUSICAL_CHAIRS,
    label: "musical-chairs items <= 7 and rounds == items",
    build: () => {
      const items = Array.from({ length: OVERSTUFF }, (_, i) => ({
        id: `c${i + 1}`,
        prompt: `Quick question ${i + 1}?`,
        options: ["A choice", "B choice", "C choice"],
        correctAnswer: i % 3,
      }));
      return { title: "MChairs", prompt: "Tap fast.", items, config: { rounds: items.length, items } };
    },
    checks: (t) => [
      { name: "items", n: len(t.items), max: 7 },
      { name: "config.rounds==items", n: t.config?.rounds === len(t.items) ? 0 : 1, max: 0 },
    ],
  },
  {
    type: TASK_TYPES.SORT,
    label: "sort items <= 10",
    build: () => ({
      title: "Sort",
      prompt: "Sort them.",
      items: Array.from({ length: OVERSTUFF }, (_, i) => ({ text: term(i), bucketIndex: i % 3 })),
      config: { buckets: ["Group A", "Group B", "Group C"] },
    }),
    checks: (t) => [
      { name: "items", n: len(t.items), max: 10 },
      { name: "config.items", n: len(t.config?.items), max: 10 },
    ],
  },
  {
    type: TASK_TYPES.MATCHING,
    label: "matching left/right <= 8, no orphan matches",
    build: () => {
      const leftItems = Array.from({ length: OVERSTUFF }, (_, i) => term(i));
      const rightItems = Array.from({ length: OVERSTUFF }, (_, i) => definition(i));
      const correctMatches = {};
      for (let i = 0; i < OVERSTUFF; i++) correctMatches[`L${i + 1}`] = `R${i + 1}`;
      return { title: "Match", prompt: "Match them.", leftItems, rightItems, correctMatches };
    },
    checks: (t) => {
      const keptLeft = new Set((t.leftItems || []).map((x) => x.id));
      const keptRight = new Set((t.rightItems || []).map((x) => x.id));
      const orphans = Object.entries(t.correctMatches || {}).filter(([k, v]) => !keptLeft.has(k) || !keptRight.has(v));
      return [
        { name: "leftItems", n: len(t.leftItems), max: 8 },
        { name: "rightItems", n: len(t.rightItems), max: 8 },
        { name: "orphan matches", n: orphans.length, max: 0 },
      ];
    },
  },
  {
    type: TASK_TYPES.MIND_MAPPER,
    label: "mind-mapper items & branches <= 7",
    build: () => ({
      title: "Map",
      prompt: "Fill the map.",
      organizerType: "mind-map",
      items: Array.from({ length: OVERSTUFF }, (_, i) => ({ text: term(i) })),
    }),
    checks: (t) => [
      { name: "items", n: len(t.items), max: 7 },
      { name: "structure.branches", n: len(t.structure?.branches), max: 7 },
    ],
  },
  {
    type: TASK_TYPES.DRAW,
    label: "draw clues <= 6",
    build: () => ({ title: "Draw", prompt: shortClue(0), clues: Array.from({ length: OVERSTUFF }, (_, i) => shortClue(i)) }),
    checks: (t) => [{ name: "clues", n: len(t.clues), max: 6 }],
  },
  {
    type: TASK_TYPES.MIME,
    label: "mime clues <= 6",
    build: () => ({ title: "Mime", prompt: shortClue(0), clues: Array.from({ length: OVERSTUFF }, (_, i) => shortClue(i)) }),
    checks: (t) => [{ name: "clues", n: len(t.clues), max: 6 }],
  },
  {
    type: TASK_TYPES.VENNSORT,
    label: "vennsort items <= 10",
    build: () => ({
      title: "Venn",
      prompt: "Sort into circles.",
      config: {
        categories: ["Category A", "Category B"],
        items: Array.from({ length: OVERSTUFF }, (_, i) => ({ id: `v${i + 1}`, text: term(i), categories: [i % 2 === 0 ? "Category A" : "Category B"] })),
      },
    }),
    checks: (t) => [{ name: "config.items", n: len(t.config?.items), max: 10 }],
  },
  {
    type: TASK_TYPES.PET_FEEDING,
    label: "pet-feeding good/bad foods <= 8 each",
    build: () => ({
      title: "Feed",
      prompt: "Feed the pet.",
      goodFoods: Array.from({ length: OVERSTUFF }, (_, i) => `True statement ${i + 1}`),
      badFoods: Array.from({ length: OVERSTUFF }, (_, i) => `False statement ${i + 1}`),
    }),
    checks: (t) => [
      { name: "goodFoods", n: len(t.goodFoods), max: 8 },
      { name: "badFoods", n: len(t.badFoods), max: 8 },
    ],
  },
  {
    type: TASK_TYPES.SEQUENCE,
    label: "sequence items <= 7",
    build: () => ({ title: "Seq", prompt: "Order them.", items: Array.from({ length: OVERSTUFF }, (_, i) => `Step ${i + 1}: do the next thing in the process`) }),
    checks: (t) => [
      { name: "items", n: len(t.items), max: 7 },
      { name: "config.items", n: len(t.config?.items), max: 7 },
    ],
  },
  {
    type: TASK_TYPES.TIMELINE,
    label: "timeline items <= 7",
    build: () => ({ title: "Timeline", prompt: "Order them.", items: Array.from({ length: OVERSTUFF }, (_, i) => `Event ${i + 1} (${1700 + i})`) }),
    checks: (t) => [
      { name: "items", n: len(t.items), max: 7 },
      { name: "config.items", n: len(t.config?.items), max: 7 },
    ],
  },
  {
    type: TASK_TYPES.MAD_DASH_SEQUENCE,
    label: "mad-dash-sequence items capped to 4",
    build: () => {
      const items = Array.from({ length: 10 }, (_, i) => `Step ${i + 1} of the procedure`);
      const correctOrder = [3, 1, 7, 0, 9, 2, 5, 8, 4, 6]; // valid permutation of 0..9
      return { title: "MadDash", prompt: "Scan in order.", config: { items, correctOrder } };
    },
    checks: (t) => [
      { name: "config.items", n: len(t.config?.items), max: 4 },
      { name: "items", n: len(t.items), max: 4 },
    ],
  },
];

// ── run ──
let failures = 0;
let checksRun = 0;
console.log("Task cap-limit regression guard\n" + "=".repeat(48));

for (const c of CASES) {
  let task;
  try {
    task = run(c.type, c.build());
  } catch (err) {
    failures++;
    console.log(`✗ ${c.type} — pipeline threw: ${err.message}`);
    continue;
  }

  const results = c.checks(task);
  const bad = results.filter((r) => r.n > r.max);
  checksRun += results.length;

  if (bad.length === 0) {
    const summary = results.map((r) => `${r.name}=${r.n}≤${r.max}`).join(", ");
    console.log(`✓ ${c.label}  (${summary})`);
  } else {
    failures += bad.length;
    console.log(`✗ ${c.label}`);
    for (const r of bad) console.log(`    ${r.name}: got ${r.n}, expected ≤ ${r.max}`);
  }
}

console.log("=".repeat(48));
console.log(`${CASES.length} types, ${checksRun} assertions, ${failures} failure(s)`);

if (failures > 0) {
  console.error("\nFAILED — a task type is not clamping over-stuffed input.");
  process.exit(1);
}
console.log("\nPASSED — every capped task type trims over-stuffed input.");
process.exit(0);
