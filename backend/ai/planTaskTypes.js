// backend/ai/planTaskTypes.js
// Stage 1: Decide which taskType to use for each concept.

import OpenAI from "openai";
import { TASK_TYPE_LABELS } from "../../shared/taskTypes.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI decides: concept → taskType
 *
 * @param {string} subject
 * @param {string[]} concepts
 * @param {string[]} implementedTypes - list of allowed taskType values (strings)
 * @param {object} lenses
 * @param {boolean} [lenses.includePhysicalMovement]
 * @param {boolean} [lenses.includeCreative]
 * @param {boolean} [lenses.includeAnalytical]
 * @param {boolean} [lenses.includeInputTasks]
 * @param {number} targetCount - max number of tasks to plan
 * @returns {Promise<Array<{ concept: string, taskType: string, reason: string }>>}
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

  const subjectLabel = subject || "General";

  const implementedTypeDescriptions = implementedTypes
    .map((t) => {
      const label = TASK_TYPE_LABELS?.[t] || "";
      return `- ${t}${label ? `: ${label}` : ""}`;
    })
    .join("\n");

  const systemPrompt = `
You are the Curriculate Task Planner, an expert curriculum designer.

Your job:
- Look at a subject and a list of key concepts/words.
- Choose the BEST taskType (from a provided list) for each concept.
- Write a 1–2 sentence reason for each choice, for the teacher.

CONTEXT:
- Subject: ${subjectLabel}
- Concepts: you will receive a list.
- Allowed taskType values (you MUST choose only from these):
${implementedTypeDescriptions}

LENSES:
- includePhysicalMovement: ${includePhysicalMovement}
- includeCreative: ${includeCreative}
- includeAnalytical: ${includeAnalytical}
- includeInputTasks: ${includeInputTasks}

GUIDELINES:
- Use physical-movement types (body-break, act-it-out, mime, etc.) for:
  * processes, sequences, role-play, kinesthetic representation.
- Use creative types (draw, make-and-snap, photo, etc.) for:
  * objects, scenes, emotional/affective ideas, imaginative response.
- Use analytical types (sequence, sort, compare/contrast, "why/how" prompts) for:
  * cause/effect, timelines, trade-offs, deeper reasoning.
- Use input types (short-answer, open-text, photo evidence, record-audio) for:
  * quick captures, reflections, short explanations, evidence from environment.

RULES:
- ONLY choose taskType values from the 'implementedTypes' list.
- NEVER invent new taskType values.
- Prefer a healthy mix of taskTypes across the whole plan (not all the same).
- You MAY plan fewer tasks than the number of concepts, but NEVER more than 'targetCount'.
- Focus on concepts that will make the most meaningful, station-based tasks.
- You MUST return valid JSON and nothing else.

JSON SHAPE:
{
  "plan": [
    {
      "concept": "string (one of the input concepts)",
      "taskType": "string (one of the implementedTypes)",
      "reason": "1–2 sentence explanation for the teacher"
    }
  ]
}
  `.trim();

  const userPrompt = {
    subject: subjectLabel,
    concepts: concepts,
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
    model: "gpt-5.1",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPrompt) },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[planTaskTypes] Failed to parse JSON:", raw);
    parsed = {};
  }

  const plan = Array.isArray(parsed.plan) ? parsed.plan : [];
  return plan;
}
