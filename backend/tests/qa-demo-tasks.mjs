#!/usr/bin/env node
/**
 * Comprehensive QA for demo tasks — checks every static task for:
 *   ✓ Passes normalizer + validator + playability
 *   ✓ No placeholder text ("Item 1", "Group A", "Step 3", etc.)
 *   ✓ Sufficient items/options/cards for the task type
 *   ✓ Meaningful labels (not generic fallbacks)
 *   ✓ Image URLs are reachable (if present)
 *   ✓ All text fields have real content
 *   ✓ Lists which task types have NO static demo (relying on flaky AI)
 *
 * Usage: node backend/tests/qa-demo-tasks.mjs
 */

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Parse STATIC_DEMO_TASKS from source ──
const controllerSrc = fs.readFileSync(
  path.join(__dirname, "../controllers/demoTasksetController.js"), "utf8"
);

const startMatch = controllerSrc.indexOf("const STATIC_DEMO_TASKS = {");
if (startMatch === -1) { console.error("Cannot find STATIC_DEMO_TASKS"); process.exit(1); }

let braceCount = 0, endIdx = startMatch, foundStart = false;
for (let i = startMatch; i < controllerSrc.length; i++) {
  if (controllerSrc[i] === "{") { braceCount++; foundStart = true; }
  if (controllerSrc[i] === "}") { braceCount--; }
  if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
}

const snippet = controllerSrc.slice(startMatch, endIdx).replace("const STATIC_DEMO_TASKS = ", "return ");
let STATIC_DEMO_TASKS;
try {
  STATIC_DEMO_TASKS = new Function("TASK_TYPES", snippet)(TASK_TYPES);
} catch (e) {
  console.error("Parse error:", e.message);
  process.exit(1);
}

function cloneJson(x) { return JSON.parse(JSON.stringify(x)); }

// ── Placeholder / generic content detection ──
const GENERIC_LABELS = /^(group\s*[a-d]|category\s*[a-d0-9]|option\s*[a-d0-9]|bucket\s*[0-9]|team\s*[0-9]|player\s*[0-9]|speaker\s*[0-9]|role\s*[a-d])/i;
const NUMBERED_PLACEHOLDER = /^(item|step|clue|card|hint|word|thing|concept|term|answer|question|fact|statement|point|note|round|scene)\s*\d+$/i;
const PLACEHOLDER_CONTENT = /placeholder|template missing|lorem ipsum|todo|fixme|tbd|sample\s*text|example\s*text|dummy/i;
const SINGLE_LETTER = /^[A-D]$/;
const BLANKS = /^_{3,}$/;

function isGenericText(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > 60) return false;
  return GENERIC_LABELS.test(t) || NUMBERED_PLACEHOLDER.test(t) || PLACEHOLDER_CONTENT.test(t) || SINGLE_LETTER.test(t) || BLANKS.test(t);
}

// Fields that are programmatic IDs or intentional blanks — not user-facing text
const SKIP_FIELDS = new Set(["id", "_id", "bucketIndex", "answerKey", "correctMatches", "correctAnswer", "correctOrder"]);
const BLANK_SLOT_FIELDS = /slots|blank/i;

function findGenericStrings(obj, path = "", results = []) {
  if (obj == null) return results;
  if (typeof obj === "string") {
    if (isGenericText(obj)) results.push({ path, value: obj });
    return results;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findGenericStrings(v, `${path}[${i}]`, results));
    return results;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_")) continue;
      // Skip programmatic ID fields and intentional blank slots
      if (SKIP_FIELDS.has(k)) continue;
      if (BLANK_SLOT_FIELDS.test(k)) continue;
      // Skip blank fill-in slots anywhere in path
      if (BLANK_SLOT_FIELDS.test(path) && typeof v === "string" && /^_{3,}$/.test(v.trim())) continue;
      findGenericStrings(v, path ? `${path}.${k}` : k, results);
    }
  }
  return results;
}

// ── Content sufficiency checks ──
function checkSufficiency(taskType, task) {
  const warnings = [];
  const cfg = task.config || {};

  // Type-specific minimum checks
  const checks = {
    "matching": () => {
      const left = task.leftItems || cfg.leftItems || [];
      const right = task.rightItems || cfg.rightItems || [];
      if (left.length < 5) warnings.push(`Only ${left.length} left items (need 5+)`);
      if (right.length < 5) warnings.push(`Only ${right.length} right items (need 5+)`);
    },
    "vennsort": () => {
      const cats = cfg.categories || task.categories || [];
      const items = cfg.items || task.items || [];
      if (cats.length < 2) warnings.push(`Only ${cats.length} categories (need 2+)`);
      if (items.length < 5) warnings.push(`Only ${items.length} items (need 5+)`);
      // Check for generic category names
      cats.forEach((c, i) => {
        if (/^(group|category)\s*[a-z0-9]?$/i.test(String(c).trim())) {
          warnings.push(`Category "${c}" is generic — needs a real label`);
        }
      });
    },
    "sort": () => {
      const buckets = cfg.buckets || [];
      const items = cfg.items || task.items || [];
      if (buckets.length < 2) warnings.push(`Only ${buckets.length} buckets (need 2+)`);
      if (items.length < 6) warnings.push(`Only ${items.length} items (need 6+)`);
    },
    "multiple-choice": () => {
      const opts = cfg.options || task.options || [];
      if (opts.length < 3) warnings.push(`Only ${opts.length} options (need 3+)`);
    },
    "trivia": () => {
      const rounds = cfg.rounds || task.rounds || [];
      if (rounds.length < 3) warnings.push(`Only ${rounds.length} trivia rounds (need 3+)`);
    },
    "flashcards": () => {
      const cards = cfg.cards || task.cards || [];
      if (cards.length < 5) warnings.push(`Only ${cards.length} flashcards (need 5+)`);
    },
    "flashcards-race": () => {
      const cards = cfg.cards || task.cards || [];
      if (cards.length < 5) warnings.push(`Only ${cards.length} flashcard-race cards (need 5+)`);
    },
    "pet-feeding": () => {
      const good = task.goodFoods || cfg.goodFoods || [];
      const bad = task.badFoods || cfg.badFoods || [];
      const total = good.length + bad.length;
      if (total < 10) warnings.push(`Only ${total} food items (need 10+)`);
      if (good.length < 4) warnings.push(`Only ${good.length} good foods (need 4+)`);
      if (bad.length < 4) warnings.push(`Only ${bad.length} bad foods (need 4+)`);
    },
    "mad-dash-sequence": () => {
      const items = cfg.items || task.items || [];
      if (items.length < 3) warnings.push(`Only ${items.length} sequence items (need 3+)`);
    },
    "script-play": () => {
      const scenes = cfg.scenes || [];
      if (scenes.length < 1) warnings.push("No scenes");
      const totalLines = scenes.reduce((n, s) => n + (s?.lines?.length || 0), 0);
      if (totalLines < 4) warnings.push(`Only ${totalLines} lines total (need 4+)`);
    },
    "role-play-deck": () => {
      const roles = cfg.roles || [];
      if (roles.length < 2) warnings.push(`Only ${roles.length} roles (need 2+)`);
    },
    "mystery-clues": () => {
      const clues = task.clues || task.clueCards || cfg.clues || [];
      if (clues.length < 2) warnings.push(`Only ${clues.length} clue cards (need 2+)`);
    },
    "brain-spark-notes": () => {
      const notes = task.notes || cfg.notes || {};
      const terms = notes.keyTerms || [];
      if (terms.length < 2) warnings.push(`Only ${terms.length} key terms (need 2+)`);
    },
    "case-study": () => {
      const scenario = cfg.scenario || "";
      if (scenario.length < 50) warnings.push(`Scenario too short (${scenario.length} chars, need 50+)`);
    },
    "narration-synthesize": () => {
      const prompts = cfg.prompts || [];
      if (prompts.length < 2) warnings.push(`Only ${prompts.length} prompts (need 2+)`);
      // Check for "[object Object]" coercion
      prompts.forEach((p, i) => {
        if (String(p).includes("[object Object]")) {
          warnings.push(`prompts[${i}] was coerced to "[object Object]" — must be a string`);
        }
      });
    },
    "brainstorm-battle": () => {
      const rounds = cfg.rounds || [];
      if (rounds.length < 1) warnings.push("No config.rounds (validator requires 1+)");
    },
    "echo-chain": () => {
      const seed = cfg.seedTerm || task.seedTerm || "";
      if (!seed) warnings.push("No seedTerm");
    },
    "fake-out": () => {
      const rounds = cfg.rounds || task.rounds || [];
      if (rounds.length < 1) warnings.push(`Only ${rounds.length} fake-out rounds (need 1+)`);
    },
  };

  if (checks[taskType]) checks[taskType]();
  return warnings;
}

// ── Image URL reachability ──
async function checkImageUrl(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    if (!res.ok) return `HTTP ${res.status}`;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return `Not an image (content-type: ${ct})`;
    return null; // OK
  } catch (e) {
    return e.name === "AbortError" ? "Timeout (8s)" : e.message;
  }
}

function extractImageUrls(obj, urls = []) {
  if (!obj || typeof obj !== "object") return urls;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (k.toLowerCase().includes("image") || k.toLowerCase().includes("url")) && v.startsWith("http")) {
      urls.push({ field: k, url: v });
    } else if (typeof v === "object") {
      extractImageUrls(v, urls);
    }
  }
  return urls;
}

// ── Run QA ──
console.log(`\n${"═".repeat(70)}`);
console.log(`  DEMO TASK QA — ${Object.keys(STATIC_DEMO_TASKS).length} static tasks`);
console.log(`${"═".repeat(70)}\n`);

let passed = 0, failed = 0;
const allIssues = {};

for (const [taskType, rawTask] of Object.entries(STATIC_DEMO_TASKS)) {
  const task = cloneJson(rawTask);
  task.taskType = taskType;
  const issues = [];

  // 1. Normalize + Validate + Playability
  let normalized;
  try {
    normalized = normalizeTaskByType(taskType, { ...task });
  } catch (e) {
    issues.push(`❌ NORMALIZE CRASH: ${e.message}`);
    normalized = task;
  }

  try {
    const v = validateTaskByType(taskType, normalized);
    if (!v.ok) v.errors.forEach(e => issues.push(`❌ VALIDATE: ${e}`));
  } catch (e) {
    issues.push(`❌ VALIDATE CRASH: ${e.message}`);
  }

  if (normalized._validationError) {
    issues.push(`❌ GUARDRAIL: ${normalized._validationError}`);
  }

  try {
    const play = assessTaskPlayability(normalized);
    if (!play.playable) play.issues.forEach(e => issues.push(`❌ PLAYABILITY: ${e}`));
  } catch (e) {
    issues.push(`❌ PLAYABILITY CRASH: ${e.message}`);
  }

  // 2. Generic / placeholder text
  const genericHits = findGenericStrings(normalized);
  genericHits.forEach(h => issues.push(`⚠️  GENERIC TEXT at ${h.path}: "${h.value}"`));

  // 3. Content sufficiency
  const suffWarnings = checkSufficiency(taskType, normalized);
  suffWarnings.forEach(w => issues.push(`⚠️  INSUFFICIENT: ${w}`));

  // 4. Empty title/prompt
  if (!String(normalized.title || "").trim()) issues.push("❌ EMPTY TITLE");
  if (!String(normalized.prompt || "").trim()) issues.push("❌ EMPTY PROMPT");
  if (String(normalized.title || "").toLowerCase().includes("template missing")) issues.push("❌ TITLE says 'template missing'");
  if (String(normalized.prompt || "").toLowerCase().includes("template missing")) issues.push("❌ PROMPT says 'template missing'");

  if (issues.length > 0) {
    failed++;
    allIssues[taskType] = issues;
    console.log(`❌ ${taskType} (${issues.length} issue${issues.length > 1 ? "s" : ""})`);
    issues.forEach(i => console.log(`   ${i}`));
  } else {
    passed++;
    console.log(`✅ ${taskType}`);
  }
}

// 5. Image URL checks (async)
console.log(`\n${"─".repeat(70)}`);
console.log("  IMAGE URL CHECKS");
console.log(`${"─".repeat(70)}\n`);

const imageChecks = [];
for (const [taskType, rawTask] of Object.entries(STATIC_DEMO_TASKS)) {
  const urls = extractImageUrls(rawTask);
  for (const { field, url } of urls) {
    imageChecks.push({ taskType, field, url });
  }
}

if (imageChecks.length === 0) {
  console.log("  No image URLs found in static tasks.\n");
} else {
  const results = await Promise.all(
    imageChecks.map(async ({ taskType, field, url }) => {
      const err = await checkImageUrl(url);
      return { taskType, field, url, err };
    })
  );
  for (const { taskType, field, url, err } of results) {
    if (err) {
      console.log(`❌ ${taskType} → ${field}: ${err}`);
      console.log(`   ${url}`);
      failed++; // count as a failure
    } else {
      console.log(`✅ ${taskType} → ${field}: OK`);
    }
  }
}

// 6. Coverage report — which types have NO static demo?
console.log(`\n${"─".repeat(70)}`);
console.log("  COVERAGE: Task types WITHOUT static demo tasks");
console.log(`${"─".repeat(70)}\n`);

const allTypes = Object.values(TASK_TYPES).filter(v => typeof v === "string");
const coveredTypes = new Set(Object.keys(STATIC_DEMO_TASKS));
const uncovered = allTypes.filter(t => !coveredTypes.has(t));

// Group by complexity
const SIMPLE_TYPES = new Set([
  "open-text", "record-audio", "draw", "photo", "photo-journal",
  "make-and-snap", "collaboration", "team-selfie", "mood-checkin",
  "body-break", "motion-mission", "mime", "letter",
]);

const uncoveredSimple = uncovered.filter(t => SIMPLE_TYPES.has(t));
const uncoveredComplex = uncovered.filter(t => !SIMPLE_TYPES.has(t));

if (uncoveredComplex.length > 0) {
  console.log(`  ⚠️  COMPLEX types needing static demos (${uncoveredComplex.length}):`);
  uncoveredComplex.forEach(t => console.log(`     - ${t}`));
}
if (uncoveredSimple.length > 0) {
  console.log(`\n  ℹ️  SIMPLE types (OK without static demo) (${uncoveredSimple.length}):`);
  uncoveredSimple.forEach(t => console.log(`     - ${t}`));
}

console.log(`\n${"═".repeat(70)}`);
console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
console.log(`  Static coverage: ${coveredTypes.size}/${allTypes.length} types`);
console.log(`${"═".repeat(70)}\n`);

process.exit(failed > 0 ? 1 : 0);
