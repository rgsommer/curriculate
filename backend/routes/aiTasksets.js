// backend/routes/aiTasksets.js
import express from "express";
import TaskSet from "../models/TaskSet.js";
import { cleanTaskList } from "../ai/cleanTasks.js";
import {
  IMPLEMENTED_TASK_TYPES,
  TASK_TYPES,
} from "../../shared/taskTypes.js";

import { planTaskTypes } from "../ai/planTaskTypes.js";
import { createAiTasks } from "../ai/createAiTasks.js";

const router = express.Router();

/**
 * POST /api/ai/tasksets
 * Body can be in either of these shapes:
 *
 * (A) Newer frontend (AiTasksetGenerator.jsx):
 * {
 *   gradeLevel,
 *   subject,
 *   difficulty,
 *   learningGoal,
 *   topicDescription,              // free-text description
 *   totalDurationMinutes,
 *   numberOfTasks
 * }
 *
 * (B) Older / original API:
 * {
 *   gradeLevel,
 *   subject,
 *   difficulty,
 *   durationMinutes,
 *   topicTitle,
 *   wordConceptList?: string[],
 *   lenses?: { ... },
 *   learningGoal?: string,
 *   approxTaskCount?: number
 * }
 */
router.post("/", async (req, res) => {
  try {
    const {
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      topicTitle,
      wordConceptList = [],
      lenses = {},
      learningGoal,
      approxTaskCount,

      // NEW fields used by AiTasksetGenerator.jsx
      topicDescription,
      numberOfTasks,
      totalDurationMinutes,
    } = req.body || {};

    // -----------------------------
    // 1) Derive concept words
    // -----------------------------
    let words = Array.isArray(wordConceptList)
      ? wordConceptList
          .map((w) => (w == null ? "" : String(w)))
          .map((w) => w.trim())
          .filter((w) => w.length > 0)
      : [];

    // If no explicit wordConceptList, derive from topicDescription
    if (words.length === 0 && typeof topicDescription === "string") {
      const fromDesc = topicDescription
        .split(/[,;\n]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (fromDesc.length > 0) {
        words = fromDesc;
      }
    }

    // Last fallback: subject itself as a concept
    if (words.length === 0 && subject) {
      words = [subject];
    }

    if (words.length === 0) {
      return res.status(400).json({
        error: "wordConceptList must include at least one concept.",
      });
    }

    const safeSubject = subject || "our topic";
    const safeTitle =
      topicTitle ||
      (subject ? `${subject} – AI Task Set` : "AI-Generated Task Set");

    // -----------------------------
    // 2) Decide how many tasks to generate
    // -----------------------------
    const safeDuration =
      typeof totalDurationMinutes === "number" && totalDurationMinutes > 0
        ? totalDurationMinutes
        : durationMinutes;

    const baseDuration =
      typeof safeDuration === "number" && safeDuration > 0
        ? safeDuration
        : 45;

    const targetCount =
      typeof approxTaskCount === "number" && approxTaskCount > 0
        ? approxTaskCount
        : typeof numberOfTasks === "number" && numberOfTasks > 0
        ? numberOfTasks
        : Math.max(6, Math.min(16, baseDuration / 4));

    // -----------------------------
    // 3) AI: concept -> taskType plan
    // -----------------------------
    const rawPlan = await planTaskTypes(
      safeSubject,
      words,
      IMPLEMENTED_TASK_TYPES,
      lenses,
      targetCount
    );

    const plan = rawPlan || [];

    // -----------------------------
    // 4) AI: taskType plan -> full tasks
    // -----------------------------
    const aiTasks = await createAiTasks(safeSubject, plan, {
      gradeLevel,
      difficulty,
      learningGoal,
      durationMinutes: baseDuration,
      topicTitle: safeTitle,
    });

    // -----------------------------
    // 5) Normalize tasks to Curriculate format
    // -----------------------------
    const normalizedTasks = aiTasks.map((t, index) => {
      const type = t.taskType || "short-answer";

      const time = t.recommendedTimeSeconds || 300; // 5 min default
      const points = t.recommendedPoints || 1;

      const options = Array.isArray(t.options) ? t.options : [];

      let correctAnswer = null;
      if (type === TASK_TYPES.MULTIPLE_CHOICE && options.length >= 2) {
        if (typeof t.correctAnswer === "number") {
          const idx = t.correctAnswer;
          correctAnswer = idx >= 0 && idx < options.length ? idx : 0;
        } else if (typeof t.correctAnswer === "string") {
          const idx = options.findIndex(
            (o) =>
              o &&
              o
                .toString()
                .trim()
                .toLowerCase() ===
                t.correctAnswer.toString().trim().toLowerCase()
          );
          correctAnswer = idx >= 0 ? idx : 0;
        } else {
          correctAnswer = 0;
        }
      } else {
        correctAnswer = t.correctAnswer ?? null;
      }

      return {
        taskId: `ai-${index + 1}`,
        title: t.title || `${t.concept || "Task"} – ${type}`,
        prompt: t.prompt || "",
        taskType: type,
        options,
        correctAnswer,
        timeLimitSeconds: time,
        points,
        linear: true,
        displayKey: "",
        orderIndex: index,
      };
    });

    // -----------------------------
    // 6) Optional polish with cleaner
    // -----------------------------
    let finalTasks = normalizedTasks;
    if (typeof cleanTaskList === "function") {
      finalTasks = await cleanTaskList(normalizedTasks, {
        gradeLevel,
        subject: safeSubject,
        difficulty,
        durationMinutes: baseDuration,
        learningGoal,
      });
    }

    // -----------------------------
    // 7) Save taskset
    // -----------------------------
    const doc = await TaskSet.create({
      name: safeTitle,
      description:
        learningGoal ||
        `AI-generated mix of task types for ${safeSubject}.`,
      tasks: finalTasks,
      displays: [],
      gradeLevel,
      subject,
      difficulty,
      durationMinutes: baseDuration,
      learningGoal,
      isPublic: false,
    });

    return res.status(201).json({ taskset: doc });
  } catch (err) {
    console.error("AI taskset generation failed:", err);
    return res.status(500).json({ error: "AI taskset generation failed" });
  }
});

export default router;
