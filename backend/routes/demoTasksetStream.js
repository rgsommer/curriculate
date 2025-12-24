// backend/controllers/demoTasksetStreamController.js
import OpenAI from "openai";
import {
  normalizeSelectedType,
  retryMustHave,
  regenerateSingleTask,
} from "./aiTasksetController.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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

    const vocab = Array.isArray(aiWordBank)
      ? aiWordBank
      : String(aiWordBank || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

    if (!subject || !gradeLevel) throw new Error("subject and gradeLevel required");
    if (!vocab.length) throw new Error("aiWordBank is required");

    const vocabularyLines = vocab.map((w) => `- ${w}`).join("\n");
    const topicLabel = (topicTitle || "").trim() || `${subject} – Grade ${gradeLevel} review`;
    const specialConsiderations = [topicDescription, customInstructions].filter(Boolean).join("\n\n");

    const tasks = [];
    const total = typePool.length;

    sseWrite(res, "start", { total });

    for (let i = 0; i < total; i++) {
      const allowedType = typePool[i];
      sseWrite(res, "progress", { done: i, total, currentType: allowedType });

      const mustHave = retryMustHave?.[allowedType] || `Produce a valid ${allowedType} task with all required fields.`;

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
