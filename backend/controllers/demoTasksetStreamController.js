// backend/controllers/demoTasksetStreamController.js
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

// reuse your normalizeSelectedType / retryMustHave / regenerateSingleTask logic
import {
  normalizeSelectedType,
  retryMustHave,
  regenerateSingleTask,
} from "./aiTasksetController.js";

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Local helper (do NOT import from aiTasksetController; avoids export mismatch)
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

export const generateDemoTasksetStreaming = async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const payloadRaw = req.query.payload ? decodeURIComponent(req.query.payload) : "{}";
    const payload = JSON.parse(payloadRaw);

    const {
      subject,
      gradeLevel,
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

    // Default demo: all AI-eligible generatorEligible types
    const typePool = requestedTypes.length
      ? requestedTypes
      : Object.entries(TASK_TYPE_META)
          .filter(([type, meta]) => meta?.implemented !== false && meta?.aiEligible !== false && meta?.generatorEligible !== false)
          .map(([type]) => type)
          .filter((t) => t !== TASK_TYPES.HIDENSEEK);

    const vocabularyLines = buildVocabularyLines(aiWordBank);
    const topicLabel = (topicTitle || "").trim() || `${subject} – Grade ${gradeLevel} review`;
    const specialConsiderations = [topicDescription, customInstructions].filter(Boolean).join("\n\n");

    const tasks = [];
    const total = typePool.length;

    sseWrite(res, "start", { total });

    for (let i = 0; i < total; i++) {
      const allowedType = typePool[i];
      sseWrite(res, "progress", { done: i, total, currentType: allowedType });

      // Default mustHave (from aiTasksetController), with a Flashcards override to enforce schema + size.
      let mustHave = retryMustHave?.[allowedType] || `Produce a valid ${allowedType} task with all required fields.`;

      if (allowedType === TASK_TYPES.FLASHCARDS) {
        mustHave = [
          "Return a FLASHCARDS task.",
          "Include 8–12 flashcards with {question, answer}.",
          "Put them in task.cards OR task.config.items (each item must have question and answer).",
          "Questions and answers must be short and readable on a big card UI.",
          "No inter-team elements; intra-team ‘pass the device / shout answer’ is fine.",
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

      // after each type finishes:
      sseWrite(res, "progress", { done: i + 1, total, currentType: allowedType });
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
    res.end();
  } catch (err) {
    sseWrite(res, "error", { ok: false, error: err?.message || "Stream error" });
    res.end();
  }
};
