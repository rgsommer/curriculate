// backend/scripts/audit-generate.mjs
//
// Harness used by the audit workflow. Generates ONE task via the real
// AI generator for a given (type, subject, grade, topic) and runs it
// through sanitize → normalize → validate → playability, capturing any
// failure points along the way. Outputs JSON on stdout so a parent
// process (subagent) can parse it.
//
// Usage:
//   node backend/scripts/audit-generate.mjs \
//     --type multiple-choice \
//     --subject science \
//     --grade 7 \
//     --topic "Water cycle" \
//     [--difficulty easy|medium|hard] \
//     [--learning-goal "Identify the stages of the water cycle"]
//
// Exits 0 on success (JSON includes "ok": true/false). Exits 2 on
// harness-internal crashes (missing key, import failure, etc.).

import "dotenv/config";
import path from "node:path";

// Load .env from the BACKEND directory (script can be invoked from repo
// root, which would otherwise miss it).
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import {
  regenerateSingleTask,
  retryMustHave,
} from "../controllers/sharedTasksetController.js";
import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import {
  normalizeTaskByType,
  validateTaskByType,
} from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { TASK_TYPE_META } from "../../shared/taskTypes.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const type = String(args.type || "").trim();
const subject = String(args.subject || "general").trim();
const grade = Number(args.grade || 7);
const topic = String(args.topic || "today's lesson").trim();
const difficulty = String(args.difficulty || "medium").trim();
const learningGoal = String(args["learning-goal"] || `Understand ${topic}`).trim();

if (!type || !TASK_TYPE_META[type]) {
  console.error(JSON.stringify({ ok: false, harnessError: `unknown task type: ${type}` }));
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY) {
  console.error(JSON.stringify({ ok: false, harnessError: "OPENAI_API_KEY missing — add to backend/.env" }));
  process.exit(2);
}

const t0 = Date.now();
let task;
let generationError = null;
try {
  task = await regenerateSingleTask({
    allowedType: type,
    mustHave: retryMustHave?.[type] || "",
    subject,
    gradeLevel: grade,
    difficulty,
    learningGoal,
    topicLabel: topic,
    vocabularyLines: "",
    specialConsiderations: "",
    onPrompt: () => {},
  });
} catch (err) {
  generationError = String(err?.message || err);
}
const tGen = Date.now() - t0;

if (generationError || !task) {
  console.log(JSON.stringify({
    ok: false,
    type, subject, grade, topic,
    stage: "generate",
    error: generationError || "no task returned",
    elapsedMs: tGen,
  }));
  process.exit(0);
}

let s, n, v, p;
let pipelineError = null;
try {
  s = sanitizeTaskShapeByType(type, task);
  n = normalizeTaskByType(type, s);
  v = validateTaskByType(type, n);
  p = assessTaskPlayability(n);
} catch (err) {
  pipelineError = String(err?.message || err);
}

if (pipelineError) {
  console.log(JSON.stringify({
    ok: false,
    type, subject, grade, topic,
    stage: "pipeline",
    error: pipelineError,
    task,
    elapsedMs: Date.now() - t0,
  }));
  process.exit(0);
}

console.log(JSON.stringify({
  ok: true,
  type, subject, grade, topic,
  validation: { ok: v.ok, errors: v.errors || [] },
  playability: { playable: p.playable, issues: p.issues || [] },
  contentWarnings: n?._contentWarnings || [],
  task: n,
  elapsedMs: Date.now() - t0,
  generationElapsedMs: tGen,
}));
