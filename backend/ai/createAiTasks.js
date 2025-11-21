// backend/ai/createAiTasks.js
import OpenAI from "openai";
import {
  TASK_TYPES,
  TASK_TYPE_LABELS,
} from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI builds complete task objects for Curriculate.
 *
 * Input: subject, plan = [{ concept, taskType, reason? }, ...]
 *
 * Output: [{
 *   concept,
 *   taskType,
 *   title,
 *   prompt,
 *   options,
 *   correctAnswer,
 *   recommendedPoints,
 *   recommendedTimeSeconds
 * }]
 */
export async function createAiTasks(subject, plan, context = {}) {
  const systemPrompt = `
You design complete classroom tasks for a platform called Curriculate.

Curriculate task schema:
- title: short title (e.g. "MC: Treaty of Utrecht")
- prompt: student-facing instructions
- taskType: one of the allowed string values (do not change it)
- options: 
    * multiple-choice → 3-5 options, one clearly best
    * sequence → 3-6 steps in scrambled order
    * sort → 3-6 items that could be categorized
    * other types → usually empty array []
- correctAnswer:
    * multiple-choice → index of correct option (0-based)
    * others → null or short string if needed
- recommendedTimeSeconds:
    * MC / short-answer: ~45–90
    * open-text: ~120–180
    * make-and-snap / photo: ~120–180
    * body-break: ~45–90
- recommendedPoints:
    * MC: ~10
    * sequence / sort: ~12
    * creative tasks: ~12–15
    * physical tasks: ~8–10
    * brief inputs: ~8–10

Task type meanings (examples, not exhaustive):
${Object.entries(TASK_TYPE_LABELS)
  .map(([value, label]) => `- ${value}: ${label}`)
  .join("\n")}

RULES:
- Do NOT invent new taskType values. Use the ones given for each task.
- Make prompts concrete, age-appropriate, and specific to the subject.
- Avoid vague phrases like "discuss" or "reflect" without guidance.
- ALWAYS return valid JSON only, with no commentary.
- You may use the optional 'context' data (gradeLevel, difficulty, learningGoal) if helpful.

Return JSON:
{
  "tasks": [
    {
      "concept": "string",
      "taskType": "string (same as input)",
      "title": "string",
      "prompt": "string",
      "options": ["..."],
      "correctAnswer": null | number | string,
      "recommendedPoints": number,
      "recommendedTimeSeconds": number
    }
  ]
}
`;

  const userPrompt = {
    subject,
    plan,
    context,
  };

  const completion = await client.chat.completions.create({
    model: "gpt-4.1",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPrompt) },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content || "{}");
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return tasks;
}
