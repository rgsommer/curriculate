#!/usr/bin/env node
// Test ALL static demo tasks against normalizer, validator, and playability checker.
// Usage: node backend/tests/test-static-demos.mjs

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

// --- Import the STATIC_DEMO_TASKS ---
// We can't easily import from demoTasksetController (it has express/mongoose deps),
// so we'll dynamically read and eval just the object.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerPath = path.join(__dirname, "../controllers/demoTasksetController.js");
const controllerSrc = fs.readFileSync(controllerPath, "utf8");

// Extract the STATIC_DEMO_TASKS object by finding it in the source
const startMatch = controllerSrc.indexOf("const STATIC_DEMO_TASKS = {");
if (startMatch === -1) {
  console.error("Could not find STATIC_DEMO_TASKS in demoTasksetController.js");
  process.exit(1);
}

// Find the matching closing brace by counting braces
let braceCount = 0;
let endIdx = startMatch;
let foundStart = false;
for (let i = startMatch; i < controllerSrc.length; i++) {
  if (controllerSrc[i] === "{") { braceCount++; foundStart = true; }
  if (controllerSrc[i] === "}") { braceCount--; }
  if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
}

// We need TASK_TYPES in scope for the eval
const snippet = controllerSrc.slice(startMatch, endIdx)
  .replace("const STATIC_DEMO_TASKS = ", "return ");

let STATIC_DEMO_TASKS;
try {
  const fn = new Function("TASK_TYPES", snippet);
  STATIC_DEMO_TASKS = fn(TASK_TYPES);
} catch (e) {
  console.error("Failed to parse STATIC_DEMO_TASKS:", e.message);
  process.exit(1);
}

console.log(`\nFound ${Object.keys(STATIC_DEMO_TASKS).length} static demo tasks.\n`);

function cloneJson(x) { return JSON.parse(JSON.stringify(x)); }

let passed = 0;
let failed = 0;

for (const [taskType, rawTask] of Object.entries(STATIC_DEMO_TASKS)) {
  const task = cloneJson(rawTask);
  task.taskType = taskType;

  const errors = [];

  // 1. Normalize
  let normalized;
  try {
    normalized = normalizeTaskByType(taskType, { ...task });
  } catch (e) {
    errors.push(`NORMALIZE ERROR: ${e.message}`);
    normalized = task;
  }

  // 2. Validate
  try {
    const v = validateTaskByType(taskType, normalized);
    if (!v.ok) {
      errors.push(...v.errors.map(e => `VALIDATE: ${e}`));
    }
  } catch (e) {
    errors.push(`VALIDATE ERROR: ${e.message}`);
  }

  // Check _validationError (set by normalizer guardrails)
  if (normalized._validationError) {
    errors.push(`NORMALIZER GUARDRAIL: ${normalized._validationError}`);
  }

  // 3. Playability
  try {
    const play = assessTaskPlayability(normalized);
    if (!play.playable) {
      errors.push(...play.issues.map(e => `PLAYABILITY: ${e}`));
    }
  } catch (e) {
    errors.push(`PLAYABILITY ERROR: ${e.message}`);
  }

  if (errors.length > 0) {
    failed++;
    console.log(`❌ ${taskType}`);
    errors.forEach(e => console.log(`   ${e}`));
    console.log();
  } else {
    passed++;
    console.log(`✅ ${taskType}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} total.\n`);
process.exit(failed > 0 ? 1 : 0);
