// backend/controllers/demoTasksetController.js
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import {
  normalizeSelectedType,
  retryMustHave,
  regenerateSingleTask,
} from "./sharedTasksetController.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import * as fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

/**
 * Canonical demo pool key
 */
const DEMO_TASKSET_KEY = "demoTaskset:v1";

/**
 * Bump this when demo generation logic/schema/playability changes
 */
const DEMO_SIGNATURE_VERSION = "demo:v3:attempt-log:strict:no-placeholders:LOGS_ON_2026-01-19a";

/**
 * Attempts
 */
const DEFAULT_MAX_ATTEMPTS = 10;
const MAX_ATTEMPTS_BY_TYPE = {
  [TASK_TYPES.MUSICAL_CHAIRS]: 15,
};

function cloneJson(x) {
  return x ? JSON.parse(JSON.stringify(x)) : x;
}

// Deterministic, schema-correct demo tasks for types that are unnecessarily flaky to
// generate via LLM (or where "correct shape" matters more than "novel content").
// These are NOT placeholders; they are canonical examples designed to exercise the
// frontend with reliable, valid data.
const STATIC_DEMO_TASKS = {
  [TASK_TYPES.SORT]: {
    taskType: TASK_TYPES.SORT,
    title: "Sorting Animals by Habitat",
    prompt:
      "Sort the items into the correct habitat buckets. Drag each item to the right category.",
    // Canonical schema for sort in Curriculate:
    // - config.buckets: string[] (bucket labels)
    // - config.items: {id,text,bucketIndex}[]
    // - config.answerKey: { [id]: bucketIndex }
    // We also include top-level mirrors for convenience/legacy rendering.
    config: {
      buckets: ["Forest", "Ocean", "Desert", "Grassland"],
      items: [
        { id: "item1", text: "Bear", bucketIndex: 0 },
        { id: "item2", text: "Owl", bucketIndex: 0 },
        { id: "item3", text: "Shark", bucketIndex: 1 },
        { id: "item4", text: "Dolphin", bucketIndex: 1 },
        { id: "item5", text: "Camel", bucketIndex: 2 },
        { id: "item6", text: "Cactus", bucketIndex: 2 },
        { id: "item7", text: "Lion", bucketIndex: 3 },
        { id: "item8", text: "Elephant", bucketIndex: 3 },
      ],
      answerKey: {
        item1: 0,
        item2: 0,
        item3: 1,
        item4: 1,
        item5: 2,
        item6: 2,
        item7: 3,
        item8: 3,
      },
    },
    // Optional mirrors
    items: [
      { id: "item1", text: "Bear", bucketIndex: 0 },
      { id: "item2", text: "Owl", bucketIndex: 0 },
      { id: "item3", text: "Shark", bucketIndex: 1 },
      { id: "item4", text: "Dolphin", bucketIndex: 1 },
      { id: "item5", text: "Camel", bucketIndex: 2 },
      { id: "item6", text: "Cactus", bucketIndex: 2 },
      { id: "item7", text: "Lion", bucketIndex: 3 },
      { id: "item8", text: "Elephant", bucketIndex: 3 },
    ],
    answerKey: {
      item1: 0,
      item2: 0,
      item3: 1,
      item4: 1,
      item5: 2,
      item6: 2,
      item7: 3,
      item8: 3,
    },
    categories: ["Forest", "Ocean", "Desert", "Grassland"],
  },

  [TASK_TYPES.MIND_MAPPER]: {
    taskType: TASK_TYPES.MIND_MAPPER,
    title: "Parts of a Plant Cell",
    prompt: "Drag each organelle to its correct position in the mind map.",
    organizerType: "mind-map",
    config: {
      organizerType: "mind-map",
      structure: {
        center: "Plant Cell",
        branches: [
          { label: "Energy", slots: ["_____", "_____"] },
          { label: "Protection", slots: ["_____"] },
          { label: "Storage", slots: ["_____"] },
          { label: "Control", slots: ["_____", "_____"] },
        ],
      },
      items: [
        { text: "Chloroplast", correctIndex: 0 },
        { text: "Mitochondria", correctIndex: 1 },
        { text: "Cell Wall", correctIndex: 2 },
        { text: "Vacuole", correctIndex: 3 },
        { text: "Nucleus", correctIndex: 4 },
        { text: "DNA", correctIndex: 5 },
      ],
    },
    items: [
      { text: "Chloroplast", correctIndex: 0 },
      { text: "Mitochondria", correctIndex: 1 },
      { text: "Cell Wall", correctIndex: 2 },
      { text: "Vacuole", correctIndex: 3 },
      { text: "Nucleus", correctIndex: 4 },
      { text: "DNA", correctIndex: 5 },
    ],
    structure: {
      center: "Plant Cell",
      branches: [
        { label: "Energy", slots: ["_____", "_____"] },
        { label: "Protection", slots: ["_____"] },
        { label: "Storage", slots: ["_____"] },
        { label: "Control", slots: ["_____", "_____"] },
      ],
    },
  },

  [TASK_TYPES.STORYTELLING]: {
    taskType: TASK_TYPES.STORYTELLING,
    title: "A Tale of Ancient Rome",
    prompt: "Build your character and AI will write a story featuring your team in Ancient Rome! Pick your gender, personality, role, and nationality -- then read the adventure together.",
    config: {
      setting: "Ancient Rome during the height of the Empire, where senators debate in marble halls and legions march along cobblestone roads.",
      topicContext: "The rise and fall of the Roman Republic, exploring how power, leadership, and civic duty shaped one of history's greatest civilizations.",
      genre: "adventure",
      showNationality: true,
      vocabWords: ["republic", "senate", "legion", "aqueduct", "gladiator", "consul"],
    },
  },
};

function getDemoTasksetModel() {
  if (mongoose.models.DemoTaskset) return mongoose.models.DemoTaskset;

  const DemoTasksetSchema = new mongoose.Schema(
    {
      key: { type: String, unique: true, index: true },
      taskset: { type: mongoose.Schema.Types.Mixed, default: null },
      signature: { type: String, default: "" },
    },
    { timestamps: true }
  );

  return mongoose.model("DemoTaskset", DemoTasksetSchema);
}

// ---------------- SSE helpers ----------------
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeDemoLog(payload) {
  const dir = path.join(process.cwd(), "sim_out");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `demo-taskset-${isoStamp()}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

// ------------- Placeholder guard -------------
function looksLikePlaceholderTask(task) {
  if (!task || typeof task !== "object") return true;

  const title = String(task.title || "").toLowerCase();
  const prompt = String(task.prompt || "").toLowerCase();

  const poison = [
    "placeholder",
    "please regenerate",
    "demo placeholder",
    "not in the pool yet",
    "regenerate this task",
    "no options provided",
  ];

  return poison.some((p) => title.includes(p) || prompt.includes(p));
}

// ------------- Demo special normalizers -------------
function normalizeFakeOutDemoTask(task) {
  if (!task || typeof task !== "object") return task;

  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  const rawRounds = Array.isArray(cfg.rounds)
    ? cfg.rounds
    : Array.isArray(task.rounds)
    ? task.rounds
    : [];

  const rounds = rawRounds
    .map((r) => {
      const prompt = String(r?.prompt || r?.statement || r?.question || "").trim();

      const optionsRaw = Array.isArray(r?.options)
        ? r.options
        : Array.isArray(r?.choices)
        ? r.choices
        : [];

      const options = optionsRaw.map((x) => String(x || "").trim()).filter(Boolean);

      let correctIndex = Number.isInteger(r?.correctIndex)
        ? r.correctIndex
        : Number.isInteger(r?.correctAnswer)
        ? r.correctAnswer
        : 0;

      if (correctIndex < 0) correctIndex = 0;
      if (correctIndex > 2) correctIndex = 0;

      let jokeOption = String(r?.jokeOption || "").trim();
      let jokeIndex = Number.isInteger(r?.jokeIndex) ? r.jokeIndex : 2;
      // We support 3 base options (0..2) PLUS a separate jokeOption that
      // can be inserted at positions 0..3.
      // If AI tried to provide a 4th option inside options[], treat it as jokeOption.
      if (!jokeOption && options.length >= 4) {
        jokeOption = String(options[3] || "").trim();
      }

      // Clamp jokeIndex to 0..3 (insertion slots among 3 options)
      if (jokeIndex < 0 || jokeIndex > 3) jokeIndex = 3;

      const base3 = options.slice(0, 3).map((s) => String(s || "").trim()).filter(Boolean);
      while (base3.length < 3) base3.push("—");

      if (!jokeOption) jokeOption = "A flying spaghetti monster";
      if (jokeIndex < 0 || jokeIndex > 3) jokeIndex = 3;

      return { prompt, options: base3, correctIndex, jokeOption, jokeIndex };
    })
    .filter(
      (r) =>
        r.prompt &&
        Array.isArray(r.options) &&
        r.options.length === 3 &&
        String(r.jokeOption || "").trim() &&
        Number.isInteger(r.jokeIndex) &&
        r.jokeIndex >= 0 &&
        r.jokeIndex <= 3
    );

  const playerCountRaw = cfg.playerCount ?? cfg.players ?? cfg.numPlayers ?? task.playerCount;
  const playerCount = Math.max(2, Math.min(8, Number(playerCountRaw) || 4));

  return {
    ...task,
    taskType: TASK_TYPES.FAKE_OUT,
    config: {
      ...cfg,
      playerCount,
      rounds,
      pointsPerCorrect: Number(cfg.pointsPerCorrect ?? 10) || 10,
      readerBonusPoints: Number(cfg.readerBonusPoints ?? cfg.foolBonusPoints ?? 5) || 0,
      interTeamEnabled: false,
      intraTeamEnabled: true,
    },
  };
}

function normalizeGuessWhoDemoTask(task) {
  if (!task || typeof task !== "object") return task;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};

  const playerCountRaw = cfg.playerCount ?? cfg.players ?? cfg.numPlayers ?? task.playerCount;
  const playerCount = Math.max(2, Math.min(6, Number(playerCountRaw) || 4));

  const secretAnswers = Array.isArray(cfg.secretAnswers) ? cfg.secretAnswers : [];
  const safeSecrets = secretAnswers
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, playerCount);

  while (safeSecrets.length < playerCount) safeSecrets.push("UNKNOWN");

  return {
    ...task,
    taskType: TASK_TYPES.GUESS_WHO,
    config: {
      ...cfg,
      playerCount,
      secretAnswers: safeSecrets,
      maxGuesses: Math.max(5, Math.min(15, Number(cfg.maxGuesses ?? 12) || 12)),
      timerSeconds: Math.max(30, Math.min(180, Number(cfg.timerSeconds ?? 120) || 120)),
      interTeamEnabled: false,
      intraTeamEnabled: true,
    },
  };
}

// ----------------- Status endpoint -----------------
export async function getDemoTaskset(req, res) {
  const key =
    String(req.query.key || req.body?.key || DEMO_TASKSET_KEY).trim() || DEMO_TASKSET_KEY;

  try {
    const DemoTasksetModel = getDemoTasksetModel();
    const doc = await DemoTasksetModel.findOne({ key }).lean();

    res.setHeader("Cache-Control", "no-store");

    if (!doc || !doc.taskset) {
      return res.status(404).json({
        ok: false,
        key,
        error: "Demo taskset not found. Generate it first.",
      });
    }

    return res.json({
      ok: true,
      key,
      taskset: doc.taskset,
      updatedAt: doc.updatedAt || doc.createdAt || null,
      signature: doc.signature || "",
    });
  } catch (e) {
    console.error("[DEMO] GET /api/demo/taskset failed:", e);
    return res.status(500).json({
      ok: false,
      error: "Failed to load demo taskset",
      message: e?.message || String(e),
    });
  }
}

export async function getDemoTasksetStatus(req, res) {
  const key =
    String(req.query.key || req.body?.key || DEMO_TASKSET_KEY).trim() || DEMO_TASKSET_KEY;

  try {
    const DemoTasksetModel = getDemoTasksetModel();
    const doc = await DemoTasksetModel.findOne({ key }).lean();

    res.setHeader("Cache-Control", "no-store");

    if (!doc) {
      return res.json({ ok: true, key, exists: false, taskCount: 0, updatedAt: null, signature: "" });
    }

    const taskCount = Array.isArray(doc.taskset?.tasks) ? doc.taskset.tasks.length : 0;

    return res.json({
      ok: true,
      key,
      exists: true,
      taskCount,
      updatedAt: doc.updatedAt || doc.createdAt || null,
      signature: doc.signature || "",
    });
  } catch (e) {
    console.error("[DEMO] GET /api/demo/taskset/status failed:", e);
    return res.status(500).json({ ok: false, error: e?.message || "status failed" });
  }
}

/**
 * GET /api/demo/taskset/stream
 *
 * SSE events:
 *  - init      { types, total, signature }
 *  - progress  { index, total, taskType, status }
 *  - attempt   { taskType, attempt, maxAttempts, phase, ok?, error? }  <-- NEW
 *  - task      { index, total, taskType, task }
 *  - fail      { index, total, taskType, attempts, error }            <-- NEW (per type)
 *  - done      { ok, key, taskCount, totalEligible, failedTypes, logFile, signature }
 *  - fatal     { ok:false, error, logFile, signature }
 *
 * STRICT COMPLETENESS:
 * - if ANY task type fails => NOT SAVED
 */
export async function streamDemoTaskset(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const requestedKey = String(req.query.key || "").trim() || DEMO_TASKSET_KEY;

  // heartbeat to keep proxies alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 15000);

  req.on("close", () => clearInterval(heartbeat));
  res.flushHeaders?.();

  // Eligible = implemented + generatorEligible
  const eligibleTypes = Object.values(TASK_TYPES)
    .map((t) => normalizeSelectedType(t))
    .filter(Boolean)
    .filter((t) => {
      const meta = TASK_TYPE_META?.[t];
      return meta && meta.implemented !== false && meta.generatorEligible !== false;
    });

  const signaturePayload = { v: DEMO_SIGNATURE_VERSION, totalEligible: eligibleTypes.length, types: eligibleTypes };
  const signature = JSON.stringify(signaturePayload);

  sseWrite(res, "init", { types: eligibleTypes, total: eligibleTypes.length, signature });

  const DemoModel = getDemoTasksetModel();

  const tasksByType = {};
  const failuresByType = {};
  const debugLog = {
    signaturePayload,
    startedAt: new Date().toISOString(),
    types: eligibleTypes,
    attempts: [], // one entry per attempt with prompt + result + ok/error
    failuresByType: {},
  };

  let logFile = null;

  try {
    for (let i = 0; i < eligibleTypes.length; i++) {
      const taskType = eligibleTypes[i];

      sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "generating" });

      const mustHave = retryMustHave[taskType] || "";
      const maxAttempts = MAX_ATTEMPTS_BY_TYPE[taskType] || DEFAULT_MAX_ATTEMPTS;

      // If a deterministic canonical task is provided for this type, emit it
      // immediately (no LLM calls, no retries) and move on.
      const staticTask = STATIC_DEMO_TASKS[taskType];
      if (staticTask) {
        try {
          const task = cloneJson(staticTask);
          let validatedTask = normalizeTaskByType(taskType, { ...(task || {}), taskType });

          const v = validateTaskByType(taskType, validatedTask);
          if (!v.ok) throw new Error(v.errors.join("; "));

          const play = assessTaskPlayability(validatedTask);
          if (!play.playable) throw new Error(play.issues.join("; "));

          // ✅ store by type (tasks[] is built later)
          tasksByType[taskType] = validatedTask;

          sseWrite(res, "task", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            task: validatedTask,
          });

          sseWrite(res, "progress", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            status: "done",
          });
        } catch (err) {
          const msg = err?.message || String(err);

          failuresByType[taskType] = { error: `Static demo task invalid: ${msg}`, attempts: 0 };
          debugLog.failuresByType[taskType] = failuresByType[taskType];

          sseWrite(res, "fail", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            attempts: 0,
            error: failuresByType[taskType].error,
          });

          sseWrite(res, "progress", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            status: "failed",
          });
        }

        continue; // ⛔ skip LLM generation entirely for this type
      }

      let attemptTask = null;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let promptCapture = null;

        try {
          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "prompting" });

          attemptTask = await regenerateSingleTask({
            allowedType: taskType,
            mustHave,
            subject: "General",
            gradeLevel: 7,
            difficulty: "MEDIUM",
            learningGoal: "Demonstrate the task type clearly and correctly.",
            topicLabel: "Demo",
            vocabularyLines: "",
            specialConsiderations:
              "This is a demo task. Keep content universally appropriate and school-safe.",
            previousTask: attemptTask,
            onPrompt: (p) => {
              promptCapture = p; // includes system + user
            },
          });

          // Normalize demo quirks
          if (taskType === TASK_TYPES.FAKE_OUT) attemptTask = normalizeFakeOutDemoTask(attemptTask);
          if (taskType === TASK_TYPES.GUESS_WHO) attemptTask = normalizeGuessWhoDemoTask(attemptTask);

          // Normalize canonical schema
          attemptTask = normalizeTaskByType(taskType, { ...(attemptTask || {}), taskType });

          // Hard-block placeholders
          if (looksLikePlaceholderTask(attemptTask)) {
            throw new Error("Generated task looks like a placeholder (blocked).");
          }

          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "validating" });

          // Strict schema validation
          const v = validateTaskByType(taskType, attemptTask);
          if (!v.ok) throw new Error(v.errors.join("; "));

          // Playability
          const play = assessTaskPlayability(attemptTask);
          if (!play.playable) throw new Error(play.issues.join("; "));

          // Log success (prompt + output)
          debugLog.attempts.push({
            taskType,
            attempt,
            ok: true,
            prompt: promptCapture || null,
            task: attemptTask,
          });

          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "success", ok: true });

          tasksByType[taskType] = attemptTask;
          break;
        } catch (e) {
          lastErr = e;

          console.error("[DEMO][ATTEMPT FAIL]", {
            taskType,
            attempt,
            maxAttempts,
            error: String(e?.message || e),
          });

          debugLog.attempts.push({
            taskType,
            attempt,
            ok: false,
            error: String(e?.message || e),
            prompt: promptCapture || null,
            // include the best candidate we had (if any)
            task: attemptTask || null,
          });

          sseWrite(res, "attempt", {
            taskType,
            attempt,
            maxAttempts,
            phase: "fail",
            ok: false,
            error: String(e?.message || e),
          });
        }
      }

      if (!tasksByType[taskType]) {
        const msg = String(lastErr?.message || lastErr || `Failed to generate task for ${taskType}`);
        console.error("[DEMO][TYPE FAILED]", {
          taskType,
          attempts: maxAttempts,
          error: msg,
        });

        failuresByType[taskType] = { error: msg, attempts: maxAttempts };
        debugLog.failuresByType[taskType] = failuresByType[taskType];

        sseWrite(res, "fail", {
          index: i,
          total: eligibleTypes.length,
          taskType,
          attempts: maxAttempts,
          error: msg,
        });

        sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "failed" });
        continue;
      }

      sseWrite(res, "task", { index: i, total: eligibleTypes.length, taskType, task: tasksByType[taskType] });
      sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "done" });
    }

    // Write log BEFORE deciding to save, so you always get a logFile even on failure
    debugLog.doneAt = new Date().toISOString();
    debugLog.taskCount = Object.keys(tasksByType).length;
    debugLog.failedTypes = Object.keys(failuresByType);

    logFile = await writeDemoLog(debugLog);
    console.log("[DEMO] debug log written:", logFile);

    const failedTypes = Object.keys(failuresByType);
    const complete = failedTypes.length === 0 && Object.keys(tasksByType).length === eligibleTypes.length;

    if (!complete) {
      // STRICT COMPLETENESS: do NOT save partial demo pools
      sseWrite(res, "done", {
        ok: false,
        key: requestedKey,
        taskCount: Object.keys(tasksByType).length,
        totalEligible: eligibleTypes.length,
        failedTypes,
        failuresByType,
        signature,
        logFile,
        error:
          "Demo generation stopped short: one or more task types failed after retries. Nothing was saved. See logFile for prompts, outputs, and validation errors.",
      });
      clearInterval(heartbeat);
      return res.end();
    }

    // Build ordered tasks (exactly one per eligible type)
    const tasks = eligibleTypes.map((t) => tasksByType[t]);

    // Final safety net: block placeholders
    const poisonTypes = tasks
      .filter((t) => looksLikePlaceholderTask(t))
      .map((t) => t?.taskType || "(unknown)");
    if (poisonTypes.length) {
      throw new Error(`Refusing to save: placeholder-like tasks detected for: ${Array.from(new Set(poisonTypes)).join(", ")}`);
    }

    const displayName = `Demo Taskset (${tasks.length} types)`;
    const taskset = {
      key: requestedKey,
      name: displayName,
      subject: "General",
      gradeLevel: 7,
      createdAt: new Date().toISOString(),
      tasks,
    };

    await DemoModel.updateOne(
      { key: requestedKey },
      { $set: { key: requestedKey, taskset, signature } },
      { upsert: true }
    );

    sseWrite(res, "done", {
      ok: true,
      key: requestedKey,
      taskCount: tasks.length,
      totalEligible: eligibleTypes.length,
      failedTypes: [],
      signature,
      logFile,
    });

    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    debugLog.error = String(err?.message || err);
    console.error("[DEMO][FATAL]", String(err?.message || err));

    try {
      logFile = logFile || (await writeDemoLog(debugLog));
    } catch {}

    sseWrite(res, "fatal", {
      ok: false,
      error: String(err?.message || err),
      signature,
      logFile,
    });

    clearInterval(heartbeat);
    res.end();
  }
}