// backend/controllers/aiTasksetController.js

import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
// NOTE: Not using UserSubscription yet; keep it out until subscription plans are finalized.
// import UserSubscription from "../models/UserSubscription.js";

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { planTaskTypes } from "../ai/planTaskTypes.js";
import { createAiTasks } from "../ai/createAiTasks.js";
import { cleanTaskList } from "../ai/cleanTasks.js";

function validateGeneratePayload(body = {}) {
  const errors = [];

  if (!body.gradeLevel) errors.push("gradeLevel is required");
  if (!body.subject) errors.push("subject is required");

  const difficultiesAllowed = ["EASY", "MEDIUM", "HARD"];
  if (body.difficulty && !difficultiesAllowed.includes(body.difficulty)) {
    errors.push("difficulty must be one of " + difficultiesAllowed.join(", "));
  }

  if (body.durationMinutes && Number(body.durationMinutes) <= 0) {
    errors.push("durationMinutes must be a positive number");
  }

  const goalsAllowed = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];
  if (body.learningGoal && !goalsAllowed.includes(body.learningGoal)) {
    errors.push("learningGoal must be one of " + goalsAllowed.join(", "));
  }

  return errors;
}

export async function generateTaskset(req, res) {
  try {
    // For now, there is no auth wired, so this will usually be undefined.
    const userId = req.user?._id;

    const payloadErrors = validateGeneratePayload(req.body);
    if (payloadErrors.length > 0) {
      return res.status(400).json({
        error: "Invalid payload",
        details: payloadErrors,
      });
    }

    // -----------------------------
    // Teacher profile (soft lookup)
    // -----------------------------
    let profile = null;
    if (userId) {
      try {
        profile = await TeacherProfile.findOne({ userId });
      } catch (err) {
        console.warn(
          "[aiTasksetController] Failed to load TeacherProfile:",
          err.message
        );
      }
    }

    const {
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      topicTitle,
      wordConceptList,
      learningGoal,
      curriculumLenses,
    } = req.body;

    const effectiveConfig = {
      gradeLevel,
      subject,
      difficulty: difficulty || "MEDIUM",
      durationMinutes: durationMinutes || 45,
      topicTitle: topicTitle || "",
      wordConceptList: wordConceptList || [],
      learningGoal: learningGoal || "REVIEW",
      curriculumLenses: curriculumLenses || profile?.curriculumLenses || [],
    };

    let canSaveTasksets = true;
    let planName = "Balanced Mix";

    // ... (truncated, but assume the rest is as before) ...

    const planResult = await planTaskTypes(
      effectiveConfig.subject,
      effectiveConfig.wordConceptList,
      Object.keys(TASK_TYPES),  // ← FIX: Pass array of keys if TASK_TYPES is object
      {
        includePhysicalMovement: true,
        includeCreative: true,
        includeAnalytical: true,
        includeInputTasks: true,
      },
      effectiveConfig.wordConceptList.length
    );

    const { plannedTasks, implementedTypes } = planResult;

    // -------------------------
    // Stage 2: Create raw tasks
    // -------------------------
    const rawTasks = await createAiTasks({
      subject: effectiveConfig.subject,
      taskPlan: plannedTasks,
      gradeLevel: effectiveConfig.gradeLevel,
      difficulty: effectiveConfig.difficulty,
      learningGoal: effectiveConfig.learningGoal,
      durationMinutes: effectiveConfig.durationMinutes,
      topicTitle: effectiveConfig.topicTitle,
      curriculumLenses: effectiveConfig.curriculumLenses,
    });

    // -------------------------
    // Stage 3: Clean & normalize
    // -------------------------
    const cleanedTasks = await cleanTaskList(rawTasks, TASK_TYPES);

    // Build TaskSet JSON
    const now = new Date();
    const tasksetJson = {
      name:
        effectiveConfig.topicTitle ||
        `${effectiveConfig.subject} – AI set ${now.toISOString().slice(0, 10)}`,
      subject: effectiveConfig.subject,
      gradeLevel: effectiveConfig.gradeLevel,
      learningGoal: effectiveConfig.learningGoal,
      difficulty: effectiveConfig.difficulty,
      durationMinutes: effectiveConfig.durationMinutes,
      curriculumLenses: effectiveConfig.curriculumLenses,
      tasks: cleanedTasks,
      meta: {
        generatedBy: "AI",
        generatedAt: now.toISOString(),
        implementedTypes,
        sourceConfig: effectiveConfig,
      },
    };

    // -------------------------
    // Stage 4: Save (for now, always)
    // -------------------------
    let saved = null;
    if (canSaveTasksets) {
      const doc = new TaskSet({
        userId,
        ...tasksetJson,
      });
      saved = await doc.save();
    }

    return res.json({
      taskset: saved || tasksetJson,
      saved: !!saved,
      planName,
      canSaveTasksets,
    });
  } catch (err) {
    console.error("🔥 AI Taskset Generation Error:");
    console.error(err.stack || err);
    return res.status(500).json({
      error: "Failed to generate taskset",
      details: err.message,
    });
  }
}

export default { generateTaskset };