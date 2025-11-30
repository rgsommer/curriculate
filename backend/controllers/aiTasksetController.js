// backend/controllers/aiTasksetController.js

import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
import { authRequired } from "../middleware/authRequired.js";
// NOTE: Not using UserSubscription yet; keep it out until subscription plans are finalized.
// import UserSubscription from "../models/UserSubscription.js";

import { TASK_TYPES } from "../../shared/taskTypes.js";
import { planTaskTypes } from "../ai/planTaskTypes.js";
import { createAiTasks } from "../ai/createAiTasks.js";
import { cleanTaskList } from "../ai/cleanTasks.js";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function validateGeneratePayload(payload = {}) {
  const errors = [];

  if (!payload.gradeLevel) errors.push("gradeLevel is required");
  if (!payload.subject) errors.push("subject is required");

  const difficultiesAllowed = ["EASY", "MEDIUM", "HARD"];
  if (payload.difficulty && !difficultiesAllowed.includes(payload.difficulty)) {
    errors.push("difficulty must be one of " + difficultiesAllowed.join(", "));
  }

  if (payload.durationMinutes && Number(payload.durationMinutes) <= 0) {
    errors.push("durationMinutes must be a positive number");
  }

  const goalsAllowed = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];
  if (payload.learningGoal && !goalsAllowed.includes(payload.learningGoal)) {
    errors.push("learningGoal must be one of " + goalsAllowed.join(", "));
  }

  return errors;
}

export const generateAiTaskset = [
  authRequired,
  async (req, res) => {
    try {
      const {
        subject,
        gradeLevel,
        numTasks = 8,
        selectedTypes = [],        // ← default to empty array
        customInstructions = "",
        difficulty = "MEDIUM",
      } = req.body;

      // Safety: always have an array
      const typesToUse = Array.isArray(selectedTypes) ? selectedTypes : [];

      if (!subject || !gradeLevel) {
        return res.status(400).json({
          error: "subject and gradeLevel are required",
        });
      }

      console.log("Generating AI taskset:", {
        subject,
        gradeLevel,
        numTasks,
        typesToUse,
        difficulty,
        userId: req.user?.id,
      });

      const taskset = await generateTaskset({
        subject,
        gradeLevel,
        numTasks,
        selectedTypes: typesToUse,
        customInstructions,
        difficulty,
        teacherId: req.user?.id,
      });

      const saved = await TaskSet.create({
        ...taskset,
        ownerId: req.user?.id || null,
        isPublic: false,
      });

      res.json({ ok: true, taskset: saved });
    } catch (err) {
      console.error("AI Taskset generation failed:", err);
      res.status(500).json({
        error: "Failed to generate taskset",
        details: err.message || String(err),
      });
    }
  },
];

export async function generateTaskset(options) {
  const {
    subject,
    gradeLevel,
    numTasks = 8,
    selectedTypes = [],
    customInstructions = "",
    difficulty = "MEDIUM",
    teacherId,
    durationMinutes = 45,
    topicTitle = "",
    wordConceptList = [],
    learningGoal = "REVIEW",
    curriculumLenses = [],
    // Add topicDescription if used in your truncation
    topicDescription = "",
  } = options;

  try {
    const payloadErrors = validateGeneratePayload(options);
    if (payloadErrors.length > 0) {
      throw new Error("Invalid payload: " + payloadErrors.join(", "));
    }

    // -----------------------------
    // Teacher profile (soft lookup)
    // -----------------------------
    let profile = null;
    if (teacherId) {
      try {
        profile = await TeacherProfile.findOne({ userId: teacherId });
      } catch (err) {
        console.warn(
          "[aiTasksetController] Failed to load TeacherProfile:",
          err.message
        );
      }
    }

    const effectiveConfig = {
      gradeLevel,
      subject,
      difficulty,
      durationMinutes,
      topicTitle,
      wordConceptList,
      learningGoal,
      curriculumLenses: curriculumLenses || profile?.curriculumLenses || [],
      // Add topicDescription if needed
      topicDescription,
    };

    let canSaveTasksets = true;
    let planName = "Balanced Mix";

    // ... (your truncated code here – assume it sets implementedTypes, rawTasks, etc.) ...
    // For example:
    // const implementedTypes = await planTaskTypes(effectiveConfig, selectedTypes, numTasks);
    // const rawTasks = await createAiTasks(effectiveConfig, implementedTypes, customInstructions);

    // Extract key concepts from topicDescription using a quick prompt
    const conceptPrompt = `Extract 6–10 key historical concepts/people/events from this topic as a simple bullet list (one per line). Only return the list, no extra text:

"${effectiveConfig.topicTitle || effectiveConfig.topicDescription || 'General History'}"`;

    // ... (assume AI call here for concepts) ...

    let tasks = []; // Assume this gets populated in your truncation

    // Your example code for brainstorm-battle (adjust as needed)
    const prompts = [
      "Brainstorm words starting with S related to science!",
      // ... more prompts
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    tasks.push({
      type: "brainstorm-battle",
      prompt,
      seedWords: ["think", "create", "imagine", "connect"],
      durationSeconds: 90,
    });

    if (selectedTypes.includes("mind-mapper")) {
      const types = ["mind-map", "hierarchy", "fishbone", "flowchart", "venn", "web"];
      const organizerType = types[Math.floor(Math.random() * types.length)];

      const prompt = `
        Generate 9 related terms for "${topicDescription || subject}" at ${gradeLevel} level.
        Include one main idea, supporting ideas, and details.
        Return JSON:
        {
          "organizerType": "${organizerType}",
          "items": [
            { "id": "1", "text": "Photosynthesis", "correctIndex": 0 },
            ...
          ]
        }
        `;

      const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] });
      const data = JSON.parse(response.choices[0].message.content);

      // Shuffle for students
      const shuffled = data.items.sort(() => Math.random() - 0.5);

      tasks.push({
        type: "mind-mapper",
        organizerType: data.organizerType,
        shuffledItems: shuffled,
        correctOrder: data.items.map(i => i.id),
      });
    }

    // -------------------------
    // Stage 3: Clean & normalize
    // -------------------------
    const cleanedTasks = await cleanTaskList(tasks /* or rawTasks */, TASK_TYPES);

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
        implementedTypes: [] /* assume from earlier */,
        sourceConfig: effectiveConfig,
      },
    };

    // ————————————————————————————————
    // Flashcards – 100% AI Generated
    // ————————————————————————————————
    if (selectedTypes.includes("flashcards")) {
      const numCards = 4 + Math.floor(Math.random() * 3); // 4–6 cards

      const flashcardPrompt = `
      Generate exactly ${numCards} flashcard questions and answers.
      Grade level: ${gradeLevel}
      Subject: ${subject}
      Topic: ${topicDescription || "general review"}

      Rules:
      - One short, clear question per card
      - One short, exact answer
      - Perfect for shouting out loud
      - Variety encouraged

      Return ONLY valid JSON in this exact format:
      [
        { "question": "7 × 8 = ?", "answer": "56" },
        { "question": "Capital of France?", "answer": "Paris" },
        ...
      ]
      `;

      let cards = [];

      try {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: flashcardPrompt }],
          temperature: 0.7,
          max_tokens: 1000,
        });

        const raw = response.choices[0]?.message?.content?.trim() || "[]";
        cards = JSON.parse(raw);

        // Safety: if AI gave wrong format, fall back to a few safe ones
        if (!Array.isArray(cards) || cards.length === 0) throw new Error("Invalid AI response");
      } catch (err) {
        console.warn("Flashcards AI failed, using safe fallback:", err.message);
        cards = [
          { question: "What is 5 + 7?", answer: "12" },
          { question: "Capital of Brazil?", answer: "Brasília" },
          { question: "Largest planet?", answer: "Jupiter" },
          { question: "Opposite of 'hot'?", answer: "cold" },
        ].slice(0, numCards);
      }

      tasks.push({
        type: "flashcards",
        prompt: "SHOUT the answer to each flashcard!",
        cards,
      });
    }

    // No save here – caller (generateAiTaskset) handles saving
    return tasksetJson;
  } catch (err) {
    console.error("🔥 AI Taskset Generation Error:");
    console.error(err.stack || err);
    throw new Error(err.message || "Failed to generate taskset");
  }
}

export default { generateTaskset };