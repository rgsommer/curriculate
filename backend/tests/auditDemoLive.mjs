/**
 * auditDemoLive.mjs
 * Reads the exported demo-taskset-live.json and runs every task through
 * normalize → validate → playability.
 *
 * Usage:  node tests/auditDemoLive.mjs [--verbose] [--type crossword-sprint]
 */

import { readFileSync } from "fs";
import { normalizeAndValidateTask } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const typeFilter = args.find((a, i) => args[i - 1] === "--type") || null;

const raw = JSON.parse(readFileSync(new URL("../demo-taskset-live.json", import.meta.url), "utf8"));
const tasks = raw?.taskset?.tasks || raw?.tasks || [];

console.log(`\n📋 Demo taskset: ${tasks.length} tasks\n`);

let pass = 0;
let normFail = 0;
let playFail = 0;
const failures = [];

for (let i = 0; i < tasks.length; i++) {
  const t = tasks[i];
  const taskType = t?.taskType || t?.type || "(unknown)";

  if (typeFilter && taskType !== typeFilter) continue;

  const { ok, errors, normalizedTask } = normalizeAndValidateTask(taskType, t);
  const play = assessTaskPlayability(normalizedTask || t);

  const status = !ok ? "❌ NORM/VAL" : !play.playable ? "🟡 PLAY" : "✅";

  if (!ok || !play.playable || verbose) {
    console.log(`#${String(i).padStart(2)} ${status}  ${taskType}`);
    console.log(`    title: ${(t?.title || "").slice(0, 70)}`);
  }

  if (!ok) {
    normFail++;
    console.log(`    errors: ${JSON.stringify(errors)}`);
    failures.push({ idx: i, taskType, title: t?.title, kind: "validate", errors });
  } else if (!play.playable) {
    playFail++;
    console.log(`    issues: ${JSON.stringify(play.issues)}`);
    failures.push({ idx: i, taskType, title: t?.title, kind: "playability", issues: play.issues });
  } else {
    pass++;
    if (verbose) console.log(`    ✓ OK`);
  }
}

console.log(`\n${"─".repeat(50)}`);
console.log(`  PASS:            ${pass}`);
console.log(`  VALIDATE FAIL:   ${normFail}`);
console.log(`  PLAYABILITY FAIL: ${playFail}`);
console.log(`  TOTAL:           ${pass + normFail + playFail}`);
console.log(`${"─".repeat(50)}\n`);

if (failures.length === 0) {
  console.log("🎉 All tasks passed!\n");
} else {
  console.log(`⚠️  ${failures.length} task(s) need attention:\n`);
  for (const f of failures) {
    console.log(`  #${f.idx} ${f.taskType}: ${f.kind}`);
    if (f.errors) console.log(`     ${f.errors.join("; ")}`);
    if (f.issues) console.log(`     ${f.issues.join("; ")}`);
  }
  console.log();
}
