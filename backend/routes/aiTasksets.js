// backend/routes/aiTasksets.js
import express from "express";
import TaskSet from "../models/TaskSet.js";
import { cleanTaskList } from "../ai/cleanTasks.js";

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
 *   wordConceptList = [],
 *   lenses: {
 *     includePhysicalMovement?: boolean,
 *     includeDrawingMime?: boolean,
 *     includeBodyBreaks?: boolean,
 *     includeScavengerHunts?: boolean,
 *   },
 *   learningGoal?,
 *   curriculumLenses?
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
      curriculumLenses,
    } = req.body || {};

    const ownerId = req.user?.id || null;
    const name =
      (topicTitle && String(topicTitle).trim()) ||
      `AI Taskset – ${subject || "General"} (${gradeLevel || "All"})`;

    const {
      includePhysicalMovement: allowMovementTasks = true,
      includeDrawingMime: allowDrawingMimeTasks = true,
      includeBodyBreaks: allowBodyBreaks = true,
      includeScavengerHunts: allowScavengerHunts = true,
    } = lenses;

    const tasks = [];

    // Normalize concepts list
    const concepts = Array.isArray(wordConceptList)
      ? wordConceptList.map((w) => String(w || "").trim()).filter(Boolean)
      : [];

    concepts.forEach((term, idx) => {
      const safeTerm = term || `Item ${idx + 1}`;

      // 1) Simple explanation task
      tasks.push({
        taskId: `explain-${idx + 1}`,
        title: `Explain: ${safeTerm}`,
        prompt: `In 1–3 sentences, explain what "${safeTerm}" means in the context of ${subject || "our topic"}.`,
        taskType: "short-answer",
        options: [],
        correctAnswer: null,
        timeLimitSeconds: 90,
        points: 10,
      });

      // 2) Movement task (if allowed)
      if (allowMovementTasks) {
        tasks.push({
          taskId: `move-${idx + 1}`,
          title: `Movement: ${safeTerm}`,
          prompt: `As a team, create a quick physical demonstration (using gestures only) that represents "${safeTerm}". Keep it under 20 seconds. One member should be ready to explain your idea to the teacher.`,
          taskType: "movement",
          options: [],
          correctAnswer: null,
          timeLimitSeconds: 90,
          points: 5,
        });
      }

      // 3) Drawing / mime task (if allowed)
      if (allowDrawingMimeTasks) {
        tasks.push({
          taskId: `draw-${idx + 1}`,
          title: `Draw / Mime: ${safeTerm}`,
          prompt: `One teammate secretly reads the word "${safeTerm}". They must draw or mime it (no talking!) until the others guess it correctly.`,
          taskType: "drawing-mime",
          options: [],
          correctAnswer: safeTerm,
          timeLimitSeconds: 120,
          points: 5,
        });
      }

      // 4) Body break / quick physical reset (if allowed)
      if (allowBodyBreaks) {
        tasks.push({
          taskId: `bodybreak-${idx + 1}`,
          title: `Body Break: ${safeTerm}`,
          prompt: `Take a quick body break that somehow connects to "${safeTerm}" (for example, act out a short movement that matches it). Keep it short and appropriate.`,
          taskType: "body-break",
          options: [],
          correctAnswer: null,
          timeLimitSeconds: 60,
          points: 3,
        });
      }

      // 5) Scavenger hunt style (if allowed)
      if (allowScavengerHunts) {
        tasks.push({
          taskId: `scavenger-${idx + 1}`,
          title: `Scavenger: ${safeTerm}`,
          prompt: `Find or point to something in the classroom (or on a map, diagram, or in a textbook) that connects to "${safeTerm}". Be ready to explain the connection in one sentence.`,
          taskType: "scavenger",
          options: [],
          correctAnswer: null,
          timeLimitSeconds: 180,
          points: 8,
        });
      }
    });

    // If no concepts were given, bail gracefully
    if (!tasks.length) {
      return res.status(400).json({
        error: "No tasks could be generated – check your word list.",
      });
    }

    // Clean / filter the tasks (length, "word salad", etc.)
    const cleanedTasks = cleanTaskList(tasks);

    if (!cleanedTasks.length) {
      return res.status(400).json({
        error:
          "The AI did not produce any usable tasks. Try reducing your word list or simplifying your request.",
      });
    }

    const doc = await TaskSet.create({
      name,
      ownerId,
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      topicTitle,
      learningGoal,
      curriculumLenses,
      tasks: cleanedTasks,
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
