// backend/controllers/aiTasksetController.js
import TeacherProfile from "../models/TeacherProfile.js";
import TaskSet from "../models/TaskSet.js";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Basic validation of incoming payload
function validateGeneratePayload(payload = {}) {
  const errors = [];
  if (!payload.gradeLevel) errors.push("gradeLevel is required");
  if (!payload.subject) errors.push("subject is required");
  return errors;
}

export async function generateTaskset(req, res) {
  try {
    const body = req.body || {};
    const errors = validateGeneratePayload(body);
    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid payload: " + errors.join(", "),
      });
    }

    const {
      gradeLevel,
      subject,
      difficulty = "MEDIUM",
      learningGoal = "REVIEW",
      topicDescription = "",
      totalDurationMinutes,
      numberOfTasks,
      requiredTaskTypes,
      tasksetName,
      roomLocation,
      locationCode,
      isFixedStationTaskset,
      displays,
      presenterProfile,
    } = body;

    // Derive duration and task count
    const durationNum = Number(totalDurationMinutes);
    const durationMinutes =
      Number.isFinite(durationNum) && durationNum > 0 ? durationNum : 45;

    const requestedCount = Number(numberOfTasks);
    const baseCount = Number.isFinite(requestedCount)
      ? requestedCount
      : Math.round(durationMinutes / 5);
    const targetTaskCount = Math.max(4, Math.min(20, baseCount || 8));

    // Try to load teacher profile for metadata (soft fail)
    const userId = req.user?.id || req.user?._id || null;
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

    const lenses =
      presenterProfile?.curriculumLenses ||
      profile?.curriculumLenses ||
      [];

    const taskTypeHint =
      Array.isArray(requiredTaskTypes) && requiredTaskTypes.length > 0
        ? `Use ONLY the following internal task type codes when designing tasks: ${requiredTaskTypes.join(
            ", "
          )}. You may repeat these types as needed. Do not introduce any other task types.`
        : "Use a varied mix of interactive task types suitable for an active, station-based lesson.";

    const systemPrompt = `
You are an expert curriculum designer building task sets for an interactive classroom platform called Curriculate.
Curriculate supports many different task types (multiple-choice, short-answer, sequence ordering, matching, creative / evidence tasks, and physical station challenges).
You will output ONLY valid JSON. No prose, no commentary.
    `.trim();

    const userPrompt = `
Create a station-based task set for Curriculate.

Grade level: ${gradeLevel}
Subject: ${subject}
Difficulty: ${difficulty}
Learning goal: ${learningGoal}
Duration (minutes): ${durationMinutes}
Number of tasks: exactly ${targetTaskCount}
Topic / unit description: ${topicDescription || "General review"}

Curriculum lenses / perspectives: ${
      Array.isArray(lenses) && lenses.length ? lenses.join(", ") : "none specified"
    }

${taskTypeHint}

OUTPUT FORMAT (JSON ONLY):

{
  "name": "Short name for this task set",
  "description": "One-sentence teacher-facing description",
  "durationMinutes": ${durationMinutes},
  "tasks": [
    {
      "title": "Short student-facing label",
      "prompt": "Full student-facing instructions for the task.",
      "taskType": "short-answer | multiple-choice | true-false | sequence | sort | matching | photo | make-and-snap",
      "options": ["optional", "for MCQ or sort"],
      "correctAnswer": "optional exact answer or index",
      "points": 10
    }
  ]
}

Rules:
- Include exactly ${targetTaskCount} tasks.
- Every task MUST have: title, prompt, taskType, points.
- Prefer simple, concrete instructions that fit in 5–8 minutes per task.
- Use age-appropriate language for students at this grade.
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("[aiTasksetController] Failed to parse AI JSON:", raw);
      return res.status(500).json({
        ok: false,
        error: "AI did not return valid JSON for taskset.",
      });
    }

    const aiTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

    const tasks = aiTasks.map((t, index) => {
      const type = t.taskType || t.type || "short-answer";
      const title =
        t.title ||
        (typeof t.prompt === "string"
          ? t.prompt.slice(0, 60)
          : `Task ${index + 1}`);
      const prompt = t.prompt || "Complete this task.";
      const points =
        typeof t.points === "number" && t.points > 0 ? t.points : 10;

      return {
        taskId: t.taskId || `ai-${index + 1}`,
        title,
        prompt,
        taskType: type,
        options: Array.isArray(t.options) ? t.options : [],
        correctAnswer:
          typeof t.correctAnswer !== "undefined"
            ? t.correctAnswer
            : t.answer ?? null,
        mediaUrl: t.mediaUrl || null,
        timeLimitSeconds:
          typeof t.timeLimitSeconds === "number"
            ? t.timeLimitSeconds
            : undefined,
        points,
      };
    });

    const now = new Date();
    const effectiveName =
      tasksetName ||
      parsed.name ||
      `${subject} – AI Task Set (${now.toISOString().slice(0, 10)})`;

    const effectiveDescription =
      parsed.description ||
      `AI-generated ${subject} task set for grade ${gradeLevel}.`;

    // Map displays into proper schema (DisplaySchema requires "key" and "name")
    let displayDocs = [];
    if (Array.isArray(displays) && displays.length > 0) {
      displayDocs = displays.map((d, idx) => ({
        key: d.key || `station-${idx + 1}`,
        name: d.name || `Station ${idx + 1}`,
        description: d.description || "",
        stationColor: d.stationColor || "",
        notesForTeacher: d.notesForTeacher || "",
        imageUrl: d.imageUrl || "",
      }));
    }

    const tasksetJson = {
      name: effectiveName,
      description: effectiveDescription,
      subject,
      gradeLevel,
      learningGoal,
      difficulty,
      durationMinutes: parsed.durationMinutes || durationMinutes,
      curriculumLenses: lenses,
      locationType: isFixedStationTaskset ? "stations" : "classroom",
      locationCode: locationCode || roomLocation || "Classroom",
      displays: displayDocs,
      tasks,
      meta: {
        generatedBy: "AI",
        generatedAt: now.toISOString(),
        sourceConfig: {
          gradeLevel,
          subject,
          difficulty,
          learningGoal,
          durationMinutes,
          topicDescription,
          requiredTaskTypes,
        },
      },
    };

    // Save TaskSet if we know the teacher
    let saved = null;
    let canSaveTasksets = true;
    if (userId) {
      const doc = new TaskSet({
        userId,
        ...tasksetJson,
      });
      saved = await doc.save();
    } else {
      canSaveTasksets = false;
    }

    const response = {
      ok: true,
      taskset: saved || tasksetJson,
      saved: !!saved,
      planName:
        Array.isArray(requiredTaskTypes) && requiredTaskTypes.length > 0
          ? "Custom task types"
          : "Balanced mix",
      canSaveTasksets,
    };

    return res.json(response);
  } catch (err) {
    console.error("🔥 AI Taskset Generation Error:");
    console.error(err.stack || err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to generate taskset",
    });
  }
}

export default { generateTaskset };
