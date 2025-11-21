// backend/ai/planTaskTypes.js
import OpenAI from "openai";
import {
  TASK_TYPE_LABELS,
} from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI decides: concept → taskType
 *
 * @param {string} subject
 * @param {string[]} concepts
 * @param {string[]} implementedTypes
 * @param {object} lenses
 * @param {number} targetCount
 * @returns {Promise<Array<{concept: string, taskType: string, reason?: string}>>}
 */
export async function planTaskTypes(
  subject,
  concepts,
  implementedTypes,
  lenses = {},
  targetCount
) {
  const {
    includePhysicalMovement = true,
    includeCreative = true,
    includeAnalytical = true,
    includeInputTasks = true,
  } = lenses;

  const systemPrompt = `
You are an expert curriculum designer for an interactive classroom platform called Curriculate.

Your job: for each concept, choose ONE best taskType from the allowed list.

Task types available (value: label):
${implementedTypes.map((t) => `- ${t}: ${TASK_TYPE_LABELS[t] || t}`).join(
    "\n"
  )}

Some broad guidelines (not strict rules):
- Analytical (MC/sequence/sort) are good for:
  * processes, timelines, causes & consequences, classification, factual checks
- Creative (open-text, make-and-snap, draw) are good for:
  * explanations, reflections, models, analogies, visual or constructed representations
- Physical movement (body-break) is good for:
  * acting out processes, tableaux, role-play, kinesthetic representation
- Input (photo, short-answer, record-audio) are good for:
  * quick captures, brief explanations, evidence from environment

Teacher lenses:
- includePhysicalMovement: ${includePhysicalMovement}
- includeCreative: ${includeCreative}
- includeAnalytical: ${includeAnalytical}
- includeInputTasks: ${includeInputTasks}

RULES:
- ONLY choose taskType values from the 'implementedTypes' list provided.
- NEVER invent new taskType values.
- Prefer a mix of taskTypes across the whole plan (not all the same).
- If the subject clearly suggests timelines (e.g., History), consider sequence/sort for key events.
- If the concept is an object, consider photo, draw, or make-and-snap.
- If the concept is a character trait or big idea, consider open-text or short-answer.
- You may create fewer tasks than the number of concepts, but never more than 'targetCount'.
- You MUST return valid JSON and nothing else.

Return JSON shaped as:
{
  "plan": [
    { "concept": "string", "taskType": "string-from-implementedTypes", "reason": "short explanation" }
  ]
}
`;

  const userPrompt = {
    subject,
    concepts,
    implementedTypes,
    targetCount,
    lenses: {
      includePhysicalMovement,
      includeCreative,
      includeAnalytical,
      includeInputTasks,
    },
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
  const plan = Array.isArray(parsed.plan) ? parsed.plan : [];
  return plan;
}
