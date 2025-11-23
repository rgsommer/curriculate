// backend/controllers/aiTasksetController.js

import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
import UserSubscription from "../models/UserSubscription.js";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

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
      profile = await TeacherProfile.findOne({ userId });
    }

    // If we don't have a stored profile yet, fall back to request values
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

    if (!profile) {
      profile = {
        defaultDifficulty: difficulty || "MEDIUM",
        defaultDurationMinutes: durationMinutes || 45,
        defaultLearningGoal: learningGoal || "REVIEW",
        prefersMovementTasks: !!allowMovementTasks,
        prefersDrawingMimeTasks: !!allowDrawingMimeTasks,
        curriculumLenses: curriculumLenses || [],
      };
    }

    // ----------------------------------------
    // Optional: subscription / feature gating
    // ----------------------------------------
    let sub = null;
    let planName = null;
    let features = {};
    let canSaveTasksets = false;

    try {
      if (userId) {
        sub = await UserSubscription.findOne({ userId }).populate("plan");
      }
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

    // Optional: check AI taskset limits if you want
    if (sub && sub.plan) {
      const plan = sub.plan;
      const limits = plan.aiTaskLimits || {};
      const maxPerMonth = limits.tasksetsPerMonth || limits.maxTasksets || null;

      if (maxPerMonth != null && maxPerMonth >= 0) {
        const used = sub.aiTaskSetsUsedThisPeriod || 0;
        if (used >= maxPerMonth) {
          return res.status(403).json({
            error: "AI_LIMIT_REACHED",
            message:
              "You have used all AI task sets available in your current plan for this billing period.",
          });
        }
      }
    }

    // -------------------------
    // Stage 1: Plan task types
    // -------------------------
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

    const planResult = await planTaskTypes(
      effectiveConfig,
      TASK_TYPES,
      {
        includePhysicalMovement: effectiveConfig.allowMovementTasks,
        includeCreative: effectiveConfig.allowDrawingMimeTasks,
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
      gradeLevel: effectiveConfig.gradeLevel,
      subject: effectiveConfig.subject,
      topicTitle: effectiveConfig.topicTitle,
      learningGoal: effectiveConfig.learningGoal,
      concepts: effectiveConfig.wordConceptList,
      taskPlan: plannedTasks,
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

    // Optionally save the taskset if plan allows
    let saved = null;
    if (canSaveTasksets) {
      const doc = new TaskSet({
        userId,
        ...tasksetJson,
      });
      saved = await doc.save();

      // Increment usage if we track AI sets per plan
      if (sub && sub.plan) {
        sub.aiTaskSetsUsedThisPeriod =
          (sub.aiTaskSetsUsedThisPeriod || 0) + 1;
        await sub.save();
      }
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
