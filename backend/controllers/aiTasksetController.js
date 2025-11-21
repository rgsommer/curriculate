// backend/controllers/aiTasksetController.js

import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
import UserSubscription from "../models/UserSubscription.js";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

import { TASK_TYPES } from "../shared/taskTypes.js";
import { planTaskTypes } from "../ai/planTaskTypes.js";
import { createAiTasks } from "../ai/createAiTasks.js";
import { cleanTaskList } from "../ai/cleanTasks.js";

function validateGeneratePayload(body = {}) {
  const errors = [];

  if (!body.gradeLevel) errors.push("gradeLevel is required");
  if (!body.subject) errors.push("subject is required");
  if (!body.durationMinutes) errors.push("durationMinutes is required");
  if (!body.learningGoal) errors.push("learningGoal is required");

  const difficultyAllowed = ["EASY", "MEDIUM", "HARD"];
  if (body.difficulty && !difficultyAllowed.includes(body.difficulty)) {
    errors.push("difficulty must be EASY, MEDIUM, or HARD");
  }

  const goalsAllowed = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];
  if (body.learningGoal && !goalsAllowed.includes(body.learningGoal)) {
    errors.push("learningGoal must be one of " + goalsAllowed.join(", "));
  }

  return errors;
}

export async function generateTaskset(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const payloadErrors = validateGeneratePayload(req.body);
    if (payloadErrors.length > 0) {
      return res.status(400).json({
        error: "Invalid payload",
        details: payloadErrors,
      });
    }

    const profile = await TeacherProfile.findOne({ userId });
    if (!profile) {
      return res.status(400).json({
        error:
          "Teacher profile required. Please complete your profile first.",
      });
    }

    // Optional: subscription / feature gating
    let sub = null;
    let planName = null;
    let features = {};
    let canSaveTasksets = false;

    try {
      sub = await UserSubscription.findOne({ userId }).populate("plan");
      if (sub && sub.plan) {
        planName = sub.plan.planName || sub.plan.name || null;
        features = sub.plan.features || {};
        canSaveTasksets = !!features.canSaveTasksets;
      }
    } catch (subErr) {
      console.warn(
        "[aiTasksetController] Subscription lookup failed:",
        subErr.message
      );
    }

    const {
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      topicTitle,
      wordConceptList,
      learningGoal,
      allowMovementTasks,
      allowDrawingMimeTasks,
      curriculumLenses,
    } = req.body;

    // Normalize wordConceptList into an array of strings
    const conceptList = Array.isArray(wordConceptList)
      ? wordConceptList
      : (wordConceptList || "")
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean);

    const effectiveConfig = {
      gradeLevel,
      subject,
      difficulty: difficulty || profile.defaultDifficulty || "MEDIUM",
      durationMinutes:
        durationMinutes || profile.defaultDurationMinutes || 45,
      topicTitle: topicTitle || "",
      wordConceptList: conceptList,
      learningGoal:
        learningGoal || profile.defaultLearningGoal || "REVIEW",
      allowMovementTasks:
        typeof allowMovementTasks === "boolean"
          ? allowMovementTasks
          : !!profile.prefersMovementTasks,
      allowDrawingMimeTasks:
        typeof allowDrawingMimeTasks === "boolean"
          ? allowDrawingMimeTasks
          : !!profile.prefersDrawingMimeTasks,
      curriculumLenses: curriculumLenses || profile.curriculumLenses || [],
    };

    // -------------------------
    // Stage 1: Plan task types
    // -------------------------
    let implementedTypes = Object.values(TASK_TYPES || {});
    if (!implementedTypes.length) {
      // Fallback in case TASK_TYPES is empty
      implementedTypes = [
        "multiple-choice",
        "short-answer",
        "open-text",
        "sequence",
        "sort",
        "make-and-snap",
        "body-break",
      ];
    }

    // Respect teacher/AI toggles for movement & drawing/mime
    if (!effectiveConfig.allowMovementTasks) {
      implementedTypes = implementedTypes.filter((t) => {
        const v = t.toLowerCase();
        return !v.includes("body") && !v.includes("move");
      });
    }

    if (!effectiveConfig.allowDrawingMimeTasks) {
      implementedTypes = implementedTypes.filter((t) => {
        const v = t.toLowerCase();
        return !v.includes("draw") && !v.includes("mime");
      });
    }

    const plan = await planTaskTypes(
      effectiveConfig.subject,
      effectiveConfig.wordConceptList,
      implementedTypes,
      {
        includePhysicalMovement: effectiveConfig.allowMovementTasks,
        includeCreative: effectiveConfig.allowDrawingMimeTasks,
        includeAnalytical: true,
        includeInputTasks: true,
      },
      effectiveConfig.wordConceptList.length
    );

    // -------------------------
    // Stage 2: Create raw tasks
    // -------------------------
    const rawTasks = await createAiTasks(
      effectiveConfig.subject,
      plan,
      {
        gradeLevel: effectiveConfig.gradeLevel,
        difficulty: effectiveConfig.difficulty,
        learningGoal: effectiveConfig.learningGoal,
        durationMinutes: effectiveConfig.durationMinutes,
        topicTitle: effectiveConfig.topicTitle,
      }
    );

    // -------------------------
    // Stage 3: Clean & normalize
    // -------------------------
    const cleanedTasks = cleanTaskList(rawTasks, {
      subject: effectiveConfig.subject,
      gradeLevel: effectiveConfig.gradeLevel,
    });

    const tasksetJson = {
      title:
        effectiveConfig.topicTitle ||
        `${effectiveConfig.subject} – AI TaskSet`,
      gradeLevel: effectiveConfig.gradeLevel,
      subject: effectiveConfig.subject,
      difficulty: effectiveConfig.difficulty,
      durationMinutes: effectiveConfig.durationMinutes,
      learningGoal: effectiveConfig.learningGoal,
      tasks: cleanedTasks,
      source: "AI_GENERATOR",
    };

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
    console.error("Error generating AI taskset", err);
    return res.status(500).json({ error: "Failed to generate taskset" });
  }
}

export default { generateTaskset };
