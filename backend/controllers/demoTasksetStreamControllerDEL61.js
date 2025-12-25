// backend/controllers/demoTasksetStreamController.js
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

// Canonical generation helpers live in aiTasksetController.
// IMPORTANT: these must be exported at definition in aiTasksetController.js.
import {
  normalizeSelectedType,
  retryMustHave,
  regenerateSingleTask,
} from "./aiTasksetController.js";

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Local helper (kept here intentionally to avoid cross-file export coupling)
function buildVocabularyLines(aiWordBank) {
  const list = Array.isArray(aiWordBank) ? aiWordBank : [];
  if (!list.length) return "";
  return list
    .map((w) => {
      if (typeof w === "string") return `- ${w}`;
      const term = String(w?.term ?? w?.word ?? w?.vocab ?? "").trim();
      const def = String(w?.definition ?? w?.meaning ?? w?.def ?? "").trim();
      if (!term && !def) return "";
      return def ? `- ${term}: ${def}` : `- ${term}`;
    })
    .filter(Boolean)
    .join("\n");
}

function safeJsonParse(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export const generateDemoTasksetStreaming = async (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let clientGone = false;

  // Heartbeat to keep proxies (and sometimes Render) from killing the stream
  const heartbeat = setInterval(() => {
    if (clientGone) return;
    // Comment line is valid SSE and ignored by client logic
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
    const payloadRaw = req.query?.payload
      ? decodeURIComponent(String(req.query.payload))
      : "{}";
    const payload = safeJsonParse(payloadRaw, {});

    const {
      subject = "",
      gradeLevel = "",
      difficulty = "MEDIUM",
      learningGoal = "REVIEW",
      topicTitle = "",
      topicDescription = "",
      customInstructions = "",
      aiWordBank = [],
      taskTypes = [],
    } = payload || {};

    const requestedTypes = Array.isArray(taskTypes)
      ? taskTypes.map(normalizeSelectedType).filter(Boolean)
      : [];

    // Default demo pool: all types that are implemented + aiEligible + generatorEligible
    const defaultPool = Object.entries(TASK_TYPE_META)
      .filter(([, meta]) => meta?.implemented !== false)
      .filter(([, meta]) => meta?.aiEligible !== false)
      .filter(([, meta]) => meta?.generatorEligible !== false)
      .map(([type]) => type)
      // If you want HideNSeek excluded from demo by default:
      .filter((t) => t !== TASK_TYPES.HIDENSEEK);

    const typePool = requestedTypes.length ? requestedTypes : defaultPool;

    const vocabularyLines = buildVocabularyLines(aiWordBank);
    const topicLabel =
      String(topicTitle || "").trim() ||
      `${String(subject || "Subject")} – Grade ${String(gradeLevel || "")} review`;

    const specialConsiderations = [topicDescription, customInstructions]
      .filter(Boolean)
      .map(String)
      .join("\n\n");

    const tasks = [];
    const total = typePool.length;

    sseWrite(res, "start", { total });

    for (let i = 0; i < total; i++) {
      if (clientGone) return;

      const allowedType = typePool[i];

      sseWrite(res, "progress", {
        done: i,
        total,
        currentType: allowedType,
      });

      // Default mustHave from aiTasksetController, with a couple schema-quality overrides
      let mustHave =
        (retryMustHave && retryMustHave[allowedType]) ||
        `Produce a valid ${allowedType} task with all required fields.`;

      if (allowedType === TASK_TYPES.FLASHCARDS) {
        mustHave = [
          "Return a FLASHCARDS task.",
          "Include 8–12 flashcards with {question, answer}.",
          "Put them in task.cards OR task.config.items (each item must have question and answer).",
          "Questions and answers must be short and readable on a big card UI.",
          "No inter-team elements; intra-team 'pass the device / shout answer' is fine.",
        ].join(" ");
      }

      if (allowedType === TASK_TYPES.SCRIPT_PLAY) {
        mustHave = [
          "Return a SCRIPT_PLAY task.",
          "Include config.scenes with 1–2 scenes.",
          "Each scene must have turns (8–16 turns total recommended).",
          "Each turn: { speakerIndex, line } and optional tone/direction.",
          "At least 2 speakers. Keep every line short and readable on a big card UI.",
          "Intra-team pass-the-device play only; no inter-team elements.",
        ].join(" ");
      }

      const task = await regenerateSingleTask({
        allowedType,
        mustHave,
        subject,
        gradeLevel,
        difficulty,
        learningGoal,
        topicLabel,
        vocabularyLines,
        specialConsiderations,
        previousTask: null,
      });

      tasks.push(task);

      sseWrite(res, "progress", {
        done: i + 1,
        total,
        currentType: allowedType,
      });
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
      },
    };

    sseWrite(res, "done", taskset);
    cleanup();
  } catch (err) {
    if (!clientGone) {
      sseWrite(res, "error", {
        ok: false,
        error: err?.message || "Stream error",
      });
    }
    cleanup();
  }
};
