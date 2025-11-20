// controllers/aiTasksetController.js
import { buildAiTasksetPrompt } from '../services/tasksetPromptBuilder.js';

const prompt = buildAiTasksetPrompt(profile, effectiveConfig);
const TeacherProfile = require('../models/TeacherProfile');
const TaskSet = require('../models/TaskSet');
const UserSubscription = require('../models/UserSubscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { callLLM } = require('../services/llmService');
const { buildAiTasksetPrompt } = require('../services/tasksetPromptBuilder');

function validateGeneratePayload(body) {
  const errors = [];

  if (!body.gradeLevel) errors.push('gradeLevel is required');
  if (!body.subject) errors.push('subject is required');
  if (!body.durationMinutes) errors.push('durationMinutes is required');
  if (!body.learningGoal) errors.push('learningGoal is required');

  const difficultyAllowed = ['EASY', 'MEDIUM', 'HARD'];
  if (body.difficulty && !difficultyAllowed.includes(body.difficulty)) {
    errors.push('difficulty must be EASY, MEDIUM, or HARD');
  }

  const goalsAllowed = ['REVIEW', 'INTRODUCTION', 'ENRICHMENT', 'ASSESSMENT'];
  if (body.learningGoal && !goalsAllowed.includes(body.learningGoal)) {
    errors.push('learningGoal must be one of ' + goalsAllowed.join(', '));
  }

  return errors;
}

async function generateTaskset(req, res) {
  try {
    const userId = req.user._id;

    const profile = await TeacherProfile.findOne({ userId });
    if (!profile) {
      return res
        .status(400)
        .json({ error: 'Teacher profile required. Please complete your profile first.' });
    }

    const errors = validateGeneratePayload(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors.join('; ') });
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
      allowDrawingMimeTasks
    } = req.body;

    const effectiveConfig = {
      gradeLevel,
      subject,
      difficulty: difficulty || profile.defaultDifficulty || 'MEDIUM',
      durationMinutes: durationMinutes || profile.defaultDurationMinutes || 45,
      topicTitle: topicTitle || '',
      wordConceptList: Array.isArray(wordConceptList)
        ? wordConceptList
        : (wordConceptList || '').split(',').map(w => w.trim()).filter(Boolean),
      learningGoal: learningGoal || profile.defaultLearningGoal || 'REVIEW',
      allowMovementTasks:
        typeof allowMovementTasks === 'boolean'
          ? allowMovementTasks
          : !!profile.prefersMovementTasks,
      allowDrawingMimeTasks:
        typeof allowDrawingMimeTasks === 'boolean'
          ? allowDrawingMimeTasks
          : !!profile.prefersDrawingMimeTasks
    };

    const prompt = buildAiTasksetPrompt(profile, effectiveConfig);
    const llmRaw = await callLLM(prompt);

    let tasksetJson;
    try {
      tasksetJson = JSON.parse(llmRaw);
    } catch (err) {
      console.error('Failed to parse LLM JSON', llmRaw);
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    if (!Array.isArray(tasksetJson.tasks) || !tasksetJson.tasks.length) {
      return res.status(500).json({ error: 'AI did not return any tasks' });
    }

    // Determine plan & features to decide if we save
    const sub = await UserSubscription.findOne({ userId });
    const plan = await SubscriptionPlan.findOne({ name: sub.planName });
    const features = plan?.features || {};

    let saved = null;
    if (features.canSaveTasksets) {
      saved = await TaskSet.create({
        title: tasksetJson.title || effectiveConfig.topicTitle || 'Generated TaskSet',
        createdBy: userId,
        gradeLevel: tasksetJson.gradeLevel || effectiveConfig.gradeLevel,
        subject: tasksetJson.subject || effectiveConfig.subject,
        difficulty: tasksetJson.difficulty || effectiveConfig.difficulty,
        durationMinutes: tasksetJson.durationMinutes || effectiveConfig.durationMinutes,
        learningGoal: tasksetJson.learningGoal || effectiveConfig.learningGoal,
        tasks: tasksetJson.tasks
      });
    }

    // Increment AI generation usage
    if (sub) {
      sub.aiGenerationsUsedThisPeriod += 1;
      await sub.save();
    }

    res.json({
      taskset: saved || tasksetJson,
      saved: !!saved,
      planName: sub?.planName,
      canSaveTasksets: !!features.canSaveTasksets
    });
  } catch (err) {
    console.error('Error generating AI taskset', err);
    res.status(500).json({ error: 'Failed to generate taskset' });
  }
}

module.exports = { generateTaskset };
