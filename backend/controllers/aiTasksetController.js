// backend/controllers/aiTasksetController.js

import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
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

    // Extract key concepts from topicDescription using a quick prompt
const conceptPrompt = `Extract 6–10 key historical concepts/people/events from this topic as a simple bullet list (one per line). Only return the list, no extra text:

"${effectiveConfig.topicTitle || effectiveConfig.topicDescription || 'General History'}"

Examples:
- French and Indian War
- George Washington
- Albany Plan of Union
- Proclamation of 1763`;

const conceptResponse = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: conceptPrompt }],
});

const conceptText = conceptResponse.choices[0].message.content.trim();
const concepts = conceptText
  .split("\n")
  .map(l => l.replace(/^-?\s*/, "").trim())
  .filter(Boolean)
  .slice(0, 10);

console.log("Extracted concepts:", concepts);

const planResult = await planTaskTypes(
  effectiveConfig.subject,
  concepts.length > 0 ? concepts : ["general topic"], // fallback
  Object.keys(TASK_TYPES),
  {
    includePhysicalMovement: true,
    includeCreative: true,
    includeAnalytical: true,
    includeInputTasks: true,
  },
  8 // target ~8 tasks
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

    if (selectedTypes.includes("timeline")) {
    const timelinePrompt = `
      Generate a timeline of 6 historical events (or steps in a process) about ${topicDescription || subject}.
      Return ONLY JSON:
      {
        "instructions": "Put these events in chronological order",
        "items": [
          { "id": 1, "text": "World War I begins" },
          { "id": 2, "text": "Treaty of Versailles signed" },
          ...
        ],
        "correctOrder": [3, 1, 5, 2, 6, 4]
      }
      `;

        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: timelinePrompt }],
        });

        const data = JSON.parse(response.choices[0].message.content);

        // Shuffle for students
        const shuffled = [...data.items].sort(() => Math.random() - 0.5);

        tasks.push({
          type: "timeline",
          instructions: data.instructions,
          shuffledItems: shuffled,
          correctOrder: data.items.map(i => i.id),
        });
      }

      if (selectedTypes.includes("pet-feeding")) {
        const animals = ["dog", "cat", "dragon"];
        const petType = animals[Math.floor(Math.random() * animals.length)];

        const treatOptions = ["Bone", "Fish", "Pizza", "Cookie", "Chicken", "Ice Cream"];
        const shuffled = treatOptions.sort(() => Math.random() - 0.5);
        const correctCount = 2 + Math.floor(Math.random() * 2); // 2–3 correct

        const treats = shuffled.slice(0, 5).map((name, i) => ({
          name,
          correct: i < correctCount,
        }));

        tasks.push({
          type: "pet-feeding",
          prompt: "Feed your hungry pet!",
          petType,
          treats,
          points: 10,
          ignoreNoise: true,
        });
      }
    if (selectedTypes.includes("motion-mission")) {
      const activities = [
        { name: "Jump 10 times", target: 10 },
        { name: "Run on the spot for 15 seconds", target: 15 },
        { name: "Do 8 squats", target: 8 },
        { name: "Dance wildly!", target: 12 },
      ];
      const activity = activities[Math.floor(Math.random() * activities.length)];

      tasks.push({
        type: "motion-mission",
        prompt: "Complete the motion challenge!",
        activity,
        points: 15,
        ignoreNoise: true,
      });
    }

    if (selectedTypes.includes("brainstorm-battle")) {
      const prompts = [
        "What comes to mind when you think of energy?",
        "How do living things survive?",
        "What makes a story exciting?"
      ];
      const prompt = prompts[Math.floor(Math.random() * prompts.length)];

      tasks.push({
        type: "brainstorm-battle",
        prompt,
        seedWords: ["think", "create", "imagine", "connect"],
        durationSeconds: 90,
      });
    }

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