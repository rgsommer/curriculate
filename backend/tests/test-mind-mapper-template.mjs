#!/usr/bin/env node
// test-mind-mapper-template.mjs
//
// Tests the mind-mapper template generation pipeline 10 times.
// Since we can't call OpenAI from this environment, we simulate the AI response
// (the flat placeholder map) and run the FULL pipeline:
//   shell builder → placeholder stamping → JSON parse → COPY_FROM_ROOT →
//   normalizeTaskByType → sanitizeTaskShapeByType → validateAiTask
//
// This tests everything EXCEPT the actual API call — and the whole point of
// templates is that the structure is locked, so what matters is whether our
// pipeline accepts well-formed content.

import { TASK_TYPES, TASK_SHELLS } from "../../shared/taskTypes.js";
import { normalizeTaskByType } from "../validators/taskValidators.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { validateAiTask } from "../controllers/sharedTasksetController.js";

// ── Vocabulary list from the user ──
const VOCAB = [
  "algebraic expression",
  "equation",
  "integers",
  "isolate the variable",
  "left side = right side",
  "magnitude",
  "markup",
  "opposite integers",
  "pattern rule",
  "solution",
  "solve by re-grouping",
  "solve using counters",
  "solving by inspection",
  "solving by systematic trial",
  "table of values",
  "variable",
  "zero pair",
  "zero principle",
];

// ── Simulated AI fill responses (10 variations) ──
// Each one picks different subsets of vocab and creates different organizer layouts
const SIMULATED_FILLS = [
  {
    TITLE: "Equation Basics Mind Map",
    PROMPT: "Drag each term to its correct place in the concept web about solving equations.",
    ORGANIZER_TYPE: "mind-map",
    CENTER_TOPIC: "Solving Equations",
    DIFFICULTY: "medium",
    BRANCH_1: "Key Vocabulary",
    BRANCH_2: "Solving Methods",
    BRANCH_3: "Core Principles",
    ITEM_1: "variable",
    ITEM_2: "equation",
    ITEM_3: "solving by inspection",
    ITEM_4: "solve by re-grouping",
    ITEM_5: "isolate the variable",
    ITEM_6: "zero principle",
  },
  {
    TITLE: "Integer Operations Web",
    PROMPT: "Place each concept in its correct branch of the integer operations organizer.",
    ORGANIZER_TYPE: "web",
    CENTER_TOPIC: "Working with Integers",
    DIFFICULTY: "medium",
    BRANCH_1: "Integer Concepts",
    BRANCH_2: "Computation Strategies",
    BRANCH_3: "Key Rules",
    ITEM_1: "integers",
    ITEM_2: "opposite integers",
    ITEM_3: "zero pair",
    ITEM_4: "magnitude",
    ITEM_5: "solve using counters",
    ITEM_6: "zero principle",
  },
  {
    TITLE: "Algebra Foundations",
    PROMPT: "Complete the mind map by dragging vocabulary terms to the correct branches.",
    ORGANIZER_TYPE: "hierarchy",
    CENTER_TOPIC: "Algebraic Thinking",
    DIFFICULTY: "easy",
    BRANCH_1: "Expressions & Equations",
    BRANCH_2: "Problem-Solving Tools",
    ITEM_1: "algebraic expression",
    ITEM_2: "equation",
    ITEM_3: "table of values",
    ITEM_4: "pattern rule",
  },
  {
    TITLE: "Equation Solving Strategies",
    PROMPT: "Sort these solving strategies and concepts into the correct categories.",
    ORGANIZER_TYPE: "mind-map",
    CENTER_TOPIC: "How to Solve Equations",
    DIFFICULTY: "hard",
    BRANCH_1: "Strategies",
    BRANCH_2: "Key Concepts",
    BRANCH_3: "Balance Principles",
    BRANCH_4: "Representations",
    ITEM_1: "solving by inspection",
    ITEM_2: "solving by systematic trial",
    ITEM_3: "solve by re-grouping",
    ITEM_4: "isolate the variable",
    ITEM_5: "left side = right side",
    ITEM_6: "zero principle",
    ITEM_7: "table of values",
    ITEM_8: "variable",
  },
  {
    TITLE: "Variable & Expression Concepts",
    PROMPT: "Drag each term into the correct spot on the concept organizer.",
    ORGANIZER_TYPE: "mind-map",
    CENTER_TOPIC: "Variables and Expressions",
    DIFFICULTY: "medium",
    BRANCH_1: "Definitions",
    BRANCH_2: "Techniques",
    BRANCH_3: "Applications",
    ITEM_1: "variable",
    ITEM_2: "algebraic expression",
    ITEM_3: "pattern rule",
    ITEM_4: "table of values",
    ITEM_5: "markup",
    ITEM_6: "solution",
  },
  {
    TITLE: "Zero Principle Explorer",
    PROMPT: "Fill in the mind map to show how the zero principle connects to integer operations.",
    ORGANIZER_TYPE: "fishbone",
    CENTER_TOPIC: "The Zero Principle",
    DIFFICULTY: "medium",
    BRANCH_1: "Related Concepts",
    BRANCH_2: "Using Zero Pairs",
    BRANCH_3: "Integer Rules",
    ITEM_1: "zero pair",
    ITEM_2: "zero principle",
    ITEM_3: "opposite integers",
    ITEM_4: "integers",
    ITEM_5: "solve using counters",
    ITEM_6: "magnitude",
  },
  {
    TITLE: "Balancing Equations",
    PROMPT: "Place each concept where it belongs in this equation-balancing organizer.",
    ORGANIZER_TYPE: "mind-map",
    CENTER_TOPIC: "Equation Balance",
    DIFFICULTY: "easy",
    BRANCH_1: "What is Balance?",
    BRANCH_2: "How to Solve",
    ITEM_1: "left side = right side",
    ITEM_2: "equation",
    ITEM_3: "isolate the variable",
    ITEM_4: "solution",
  },
  {
    TITLE: "Pattern Rules and Tables",
    PROMPT: "Complete the organizer showing how pattern rules connect to tables and equations.",
    ORGANIZER_TYPE: "flowchart",
    CENTER_TOPIC: "Patterns to Equations",
    DIFFICULTY: "medium",
    BRANCH_1: "Finding Patterns",
    BRANCH_2: "Building Equations",
    BRANCH_3: "Solving",
    ITEM_1: "pattern rule",
    ITEM_2: "table of values",
    ITEM_3: "algebraic expression",
    ITEM_4: "equation",
    ITEM_5: "variable",
    ITEM_6: "solution",
  },
  {
    TITLE: "Markup and Equations",
    PROMPT: "Drag each term to its correct place to show how markup problems use equations.",
    ORGANIZER_TYPE: "mind-map",
    CENTER_TOPIC: "Markup Problems",
    DIFFICULTY: "hard",
    BRANCH_1: "Problem Setup",
    BRANCH_2: "Equation Parts",
    BRANCH_3: "Solving Steps",
    BRANCH_4: "Key Vocabulary",
    ITEM_1: "markup",
    ITEM_2: "equation",
    ITEM_3: "variable",
    ITEM_4: "algebraic expression",
    ITEM_5: "isolate the variable",
    ITEM_6: "solve by re-grouping",
    ITEM_7: "solution",
    ITEM_8: "solving by systematic trial",
  },
  {
    TITLE: "Trial and Inspection Methods",
    PROMPT: "Organize these solving methods and related terms in the concept web.",
    ORGANIZER_TYPE: "venn",
    CENTER_TOPIC: "Solving Methods Compared",
    DIFFICULTY: "medium",
    BRANCH_1: "Inspection",
    BRANCH_2: "Systematic Trial",
    BRANCH_3: "Shared Concepts",
    ITEM_1: "solving by inspection",
    ITEM_2: "solving by systematic trial",
    ITEM_3: "equation",
    ITEM_4: "variable",
    ITEM_5: "solution",
    ITEM_6: "isolate the variable",
  },
];

// ── Run the pipeline ──
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  MIND-MAPPER TEMPLATE GENERATION TEST (10 runs)            ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

for (let i = 0; i < 10; i++) {
  const fill = SIMULATED_FILLS[i];
  const label = `Run ${i + 1}: "${fill.TITLE}"`;

  try {
    // 1) Build the shell with appropriate sizing
    const difficulty = fill.DIFFICULTY;
    const itemCount = Object.keys(fill).filter((k) => k.startsWith("ITEM_")).length;
    const branchCount = Object.keys(fill).filter((k) => k.startsWith("BRANCH_")).length;
    const shellBuilder = TASK_SHELLS[TASK_TYPES.MIND_MAPPER];
    const { shell, placeholderNames } = shellBuilder({ itemCount, branchCount });

    // 2) Verify all placeholders are present in the fill
    const missing = placeholderNames.filter((k) => !fill[k]);
    if (missing.length > 0) {
      throw new Error(`Test data missing placeholders: ${missing.join(", ")}`);
    }

    // 3) Stamp values into shell
    let filled = shell;
    for (const key of placeholderNames) {
      const val = fill[key].trim();
      const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      filled = filled.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escaped);
    }

    // 4) Parse the filled JSON
    const task = JSON.parse(filled);

    // 5) Copy root → config where marked
    if (task.config) {
      if (task.config.structure === "<<COPY_FROM_ROOT>>") task.config.structure = task.structure;
      if (task.config.items === "<<COPY_FROM_ROOT>>") task.config.items = [...(task.items || [])];
    }

    // 6) Normalize
    let normalized = normalizeTaskByType(TASK_TYPES.MIND_MAPPER, { ...task, taskType: "mind-mapper" });

    // 7) Sanitize
    normalized = sanitizeTaskShapeByType(TASK_TYPES.MIND_MAPPER, normalized);

    // 8) Check quality guardrails
    if (normalized._validationError) {
      throw new Error(`[Quality Guardrail] ${normalized._validationError}`);
    }

    // 9) Validate
    const result = validateAiTask(TASK_TYPES.MIND_MAPPER, normalized);
    if (!result.ok) {
      throw new Error(`Validation failed: ${result.errors.join("; ")}`);
    }

    console.log(`  ✅ ${label}`);
    console.log(`     items: [${(normalized.items || task.items).slice(0, 4).map(i => typeof i === 'string' ? i : i?.text).join(", ")}${itemCount > 4 ? ", ..." : ""}]`);
    console.log(`     branches: ${branchCount}, slots: ${itemCount}, organizerType: ${task.organizerType}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${label}`);
    console.log(`     ERROR: ${err.message}`);
    failed++;
  }
  console.log();
}

// ── Summary ──
console.log("════════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed}/10 passed, ${failed}/10 failed`);
console.log(`  Success rate: ${(passed / 10 * 100).toFixed(0)}%`);
if (failed === 0) {
  console.log("  🎉 100% SUCCESS RATE — template approach works!");
} else {
  console.log("  ⚠️  Some runs failed — check errors above.");
}
console.log("════════════════════════════════════════════════════════════════");
