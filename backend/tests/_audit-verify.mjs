// backend/tests/_audit-verify.mjs
//
// Throwaway audit-verification harness for the Grade-8 Bible/Pentecost taskset.
// Loads the 10-task fixture and runs each task through the canonical pipeline:
//   sanitizeTaskShapeByType → normalizeTaskByType → validateTaskByType → assessTaskPlayability
// Prints PASS/FAIL per task with any errors.
//
// Run: node backend/tests/_audit-verify.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "_audit-bible-taskset.json");
const tasks = JSON.parse(readFileSync(fixturePath, "utf8"));

console.log(`\nAudit verify — ${tasks.length} tasks from ${fixturePath}\n${"─".repeat(60)}`);

let passCount = 0;
let failCount = 0;

tasks.forEach((raw, i) => {
  const type = raw.taskType;
  const label = `Task ${i + 1} [${type}] "${String(raw.title || "").slice(0, 40)}"`;

  let errs = [];
  let playable = false;
  let playabilityIssues = [];

  try {
    const sanitized = sanitizeTaskShapeByType(type, raw);
    const normalized = normalizeTaskByType(type, sanitized);

    // Surface any inline validation flags the normalizer/sanitizer set
    if (normalized._validationError) errs.push(`_validationError: ${normalized._validationError}`);

    const v = validateTaskByType(type, normalized);
    if (!v.ok) errs.push(...(v.errors || []));

    const p = assessTaskPlayability(normalized);
    playable = !!p.playable;
    playabilityIssues = p.issues || [];
  } catch (e) {
    errs.push(`THREW: ${e.message}`);
  }

  const ok = errs.length === 0 && playable;
  if (ok) {
    passCount++;
    console.log(`✅ ${label}`);
  } else {
    failCount++;
    console.log(`❌ ${label}`);
    for (const e of errs) console.log(`     validate: ${e}`);
    if (!playable) {
      for (const pi of playabilityIssues) console.log(`     playability: ${pi}`);
      if (playabilityIssues.length === 0) console.log(`     playability: (not playable, no issue detail)`);
    }
  }
});

console.log(`${"─".repeat(60)}`);
console.log(`PASS: ${passCount}   FAIL: ${failCount}   (of ${tasks.length})`);
process.exit(failCount === 0 ? 0 : 1);
