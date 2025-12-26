// backend/controllers/demoTasksetStreamController.js
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import { normalizeSelectedType, retryMustHave, regenerateSingleTask } from "./aiTasksetController.js";

/**
 * SSE endpoint: generates a "demo" taskset by stepping through each eligible task type
 * and generating ONE good task for each type (in order).
 *
 * Client receives:
 *  - event: init      data: { types, total }
 *  - event: progress  data: { index, total, taskType, status }
 *  - event: task      data: { index, total, taskType, task }
 *  - event: done      data: { ok: true, taskset: {...} }
 *  - event: error     data: { ok: false, error, taskType? }
 */
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}


function normalizeFakeOutDemoTask(task) {
  if (!task || typeof task !== "object") return task;

  // Accept either top-level rounds or config.rounds.
  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  const rawRounds = Array.isArray(cfg.rounds)
    ? cfg.rounds
    : Array.isArray(task.rounds)
    ? task.rounds
    : [];

  const rounds = rawRounds
    .map((r) => {
      const statement = String(r?.statement || r?.prompt || "").trim();
      const options = Array.isArray(r?.options)
        ? r.options.map((x) => String(x || "").trim()).filter(Boolean)
        : Array.isArray(r?.choices)
        ? r.choices.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const correctIndex =
        typeof r?.correctIndex === "number"
          ? r.correctIndex
          : typeof r?.answerIndex === "number"
          ? r.answerIndex
          : typeof r?.correctAnswer === "number"
          ? r.correctAnswer
          : 0;

      return { statement, options, correctIndex };
    })
    // Require 4 options (1–3 serious, 4th obvious joke)
    .filter((r) => r.statement && Array.isArray(r.options) && r.options.length >= 4)
    .map((r) => ({
      statement: r.statement,
      options: r.options.slice(0, 4),
      // correctIndex must be among the first 3 serious options
      correctIndex: r.correctIndex >= 0 && r.correctIndex <= 2 ? r.correctIndex : 0,
    }));

  const playerCountRaw = cfg.playerCount ?? cfg.players ?? cfg.numPlayers ?? task.playerCount;
  const playerCount = Math.max(2, Math.min(8, Number(playerCountRaw) || 4));

  const playerNames = Array.isArray(cfg.playerNames)
    ? cfg.playerNames.map((n, i) => String(n || "").trim() || `Player ${i + 1}`)
    : undefined;

  const fixed = {
    ...task,
    taskType: TASK_TYPES.FAKE_OUT,
    config: {
      ...cfg,
      playerCount,
      playerNames: playerNames && playerNames.length ? playerNames.slice(0, playerCount) : cfg.playerNames,
      rounds,
      pointsPerCorrect: Number(cfg.pointsPerCorrect ?? 10) || 10,
      readerBonusPoints: Number(cfg.readerBonusPoints ?? cfg.foolBonusPoints ?? 5) || 0,
      interTeamEnabled: false,
      intraTeamEnabled: true,
    },
  };

  return fixed;
}

function getEligibleDemoTypes(selectedTypes = null) {
  const all = Object.entries(TASK_TYPE_META || {})
    .filter(([, meta]) => meta && meta.implemented !== false)
    .filter(([, meta]) => meta.aiEligible === true && meta.generatorEligible === true)
    .map(([type]) => type);

  if (Array.isArray(selectedTypes) && selectedTypes.length) {
    const normalized = selectedTypes
      .map((t) => normalizeSelectedType(t) || t)
      .filter(Boolean);
    const set = new Set(normalized);
    return all.filter((t) => set.has(t));
  }

  return all;
}

export const streamDemoTaskset = async (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let clientGone = false;

  // Heartbeat keeps proxies (and sometimes Render) from killing the stream.
  const heartbeat = setInterval(() => {
    if (clientGone) return;
    // comment line is valid SSE
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);

  const cleanup = () => {
    clientGone = true;
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    const payloadRaw = req.query?.payload ? decodeURIComponent(String(req.query.payload)) : "{}";
    const payload = safeJsonParse(payloadRaw, {});

    const subject = payload.subject || "General";
    const gradeLevel = payload.gradeLevel || "7";
    const difficulty = payload.difficulty || payload.normDifficulty || "MEDIUM";
    const learningGoal = payload.learningGoal || payload.normGoal || "REVIEW";
    const topicLabel = payload.topicLabel || payload.topic || payload.unit || "Demo";
    const duration = Number(payload.duration || 30) || 30;

    const selectedTypes = payload.selectedTypes || payload.taskTypes || null;

    const types = getEligibleDemoTypes(selectedTypes);
    const total = types.length;

    sseWrite(res, "init", { types, total });

    const tasks = [];

    for (let i = 0; i < types.length; i += 1) {
      if (clientGone) break;

      const taskType = types[i];
      sseWrite(res, "progress", { index: i, total, taskType, status: "generating" });

      try {
        const mustHave = retryMustHave?.[taskType] || null;

        const task = await regenerateSingleTask({
          allowedType: taskType,
          mustHave,
          subject,
          gradeLevel,
          difficulty,
          learningGoal,
          topicLabel,
          previousTask: null,
          // demo wants one solid task per type; keep temp moderate
          temperature: 0.35,
        });

        const fixedTask = taskType === TASK_TYPES.FAKE_OUT ? normalizeFakeOutDemoTask(task) : task;

        tasks.push(fixedTask);

        sseWrite(res, "task", { index: i, total, taskType, task: fixedTask });
        sseWrite(res, "progress", { index: i, total, taskType, status: "done" });
      } catch (err) {
        // We keep going: demo should still return a taskset even if one type fails.
        const msg = err?.message || String(err) || "Generation error";
        sseWrite(res, "error", { ok: false, error: msg, taskType, index: i, total });

        if (taskType === TASK_TYPES.FAKE_OUT) {
          tasks.push({
            title: `${taskType} (placeholder)`,
            prompt:
              "Demo placeholder for Fake Out. Reader reads the statement aloud, team listens, reader records votes, then reveal.",
            taskType,
            timeLimitSeconds: 90,
            options: [],
            correctAnswer: null,
            items: [],
            clues: [],
            config: {
              playerCount: 4,
              playerNames: ["Player 1", "Player 2", "Player 3", "Player 4"],
              pointsPerCorrect: 10,
              readerBonusPoints: 5,
              rounds: [
                {
                  statement: "Demo: The definition of magnetism is…",
                  options: [
                    "A force produced by moving electric charges that creates a field pulling or pushing certain materials (like iron) without contact; it has north and south poles and can be induced or permanent.",
                    "A chemical reaction in metals where heat causes atoms to swap places, creating an invisible pull that works on all materials equally, especially plastics and wood.",
                    "A kind of gravity that only appears when objects are warmed by friction, making them attract anything nearby until they cool down again.",
                    "A mystical banana-powered magnet unicorn that only works on Tuesdays and is fueled by laughter (obviously false).",
                  ],
                  correctIndex: 0,
                },
              ],
              interTeamEnabled: false,
              intraTeamEnabled: true,
            },
          });
        } else {
          tasks.push({
            title: `${taskType} (placeholder)`,
            prompt: `Demo placeholder for ${taskType}. Please regenerate this task.`,
            taskType,
            options: [],
            correctAnswer: null,
            items: [],
            clues: [],
            config: {},
          });
        }

        sseWrite(res, "progress", { index: i, total, taskType, status: "placeholder" });
      }
    }

    const taskset = {
      ok: true,
      taskset: {
        name: `Demo Set: ${topicLabel}`,
        description: "",
        tasks,
        isPublic: false,
        gradeLevel: String(gradeLevel),
        subject: String(subject),
        difficulty: String(difficulty).toUpperCase(),
        learningGoal: String(learningGoal).toUpperCase(),
        durationMinutes: duration,
      },
    };

    sseWrite(res, "done", taskset);
    cleanup();
  } catch (err) {
    if (!clientGone) {
      sseWrite(res, "error", { ok: false, error: err?.message || "Stream error" });
    }
    cleanup();
  }
};
