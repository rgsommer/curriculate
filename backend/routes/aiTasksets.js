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
 * Body:
 * {
 *   gradeLevel,
 *   subject,
 *   difficulty,
 *   durationMinutes,
 *   topicTitle,
 *   wordConceptList?: string[],
 *   lenses?: {
 *     includePhysicalMovement?: boolean,
 *     includeCreative?: boolean,
 *     includeAnalytical?: boolean,
 *     includeInputTasks?: boolean
 *   },
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
    } = req.body || {};

    const words = Array.isArray(wordConceptList)
      ? wordConceptList.filter((w) => w && String(w).trim().length > 0)
      : [];

    if (words.length === 0) {
      return res
        .status(400)
        .json({ error: "wordConceptList must include at least one concept." });
    }

    const safeSubject = subject || "our topic";
    const safeTitle =
      topicTitle ||
      (subject ? `${subject} – AI Task Set` : "AI-Generated Task Set");

    // Decide how many tasks (same basic idea as your old version)
    const targetCount =
      typeof approxTaskCount === "number" && approxTaskCount > 0
        ? approxTaskCount
        : Math.max(6, Math.min(16, (durationMinutes || 45) / 4));

    // 1) AI: concept -> taskType plan
    const rawPlan = await planTaskTypes(
      safeSubject,
      words,
      IMPLEMENTED_TASK_TYPES,
      lenses,
      targetCount
    );

    const plan = rawPlan || [];

    // 2) AI: taskType plan -> full tasks
    const tasks = await createAiTasks(safeSubject, plan, {
      gradeLevel,
      difficulty,
      learningGoal,
      durationMinutes,
      topicTitle: safeTitle,
    });

    // 3) Normalize tasks to Curriculate format
    const normalizedTasks = tasks.map((t, index) => {
      const type = t.taskType || "short-answer";

      const time = t.recommendedTimeSeconds || 300; // 5min default
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
              o.toString().trim().toLowerCase() ===
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

    // 4) Optional polish with your existing cleaner
    if (typeof cleanTaskList === "function") {
      tasks = await cleanTaskList(normalizedTasks, {
        gradeLevel,
        subject: safeSubject,
        difficulty,
        durationMinutes,
        learningGoal,
      });
    }

    // 5) Save taskset
    const doc = await TaskSet.create({
      name: safeTitle,
      description:
        learningGoal ||
        `AI-generated mix of task types for ${safeSubject}.`,
      tasks,
      displays: [],
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      learningGoal,
      isPublic: false,
    });

    return res.status(201).json({ taskset: doc });
  } catch (err) {
    console.error("AI taskset generation failed:", err);
    return res
      .status(500)
      .json({ error: "AI taskset generation failed" });
  }
});

export default router;