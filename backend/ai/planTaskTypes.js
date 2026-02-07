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
 * @param {number} targetCount - max number of tasks to plan
 * @returns {Promise<{plannedTasks: Array, implementedTypes: string[]}>}
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
- Use physical/movement types (act-it-out, mime, etc.) for processes, sequences, role-play.
- Use creative types (draw, make-and-snap, photo) for objects, scenes, emotions.
- Use analytical types (sequence, compare/contrast, "why/how") for cause/effect, timelines.
- Use input types (short-answer, photo evidence) for reflections, quick captures.

RULES:
- ONLY choose from the allowed taskType values.
- NEVER invent new taskType values.
- Prefer a healthy mix across the plan.
- You MAY plan fewer tasks than concepts, but never more than targetCount.
- Focus on meaningful, station-based tasks.

You MUST return valid JSON and nothing else.

JSON SHAPE:
{
  "plan": [
    {
      "concept": "string (one of the input concepts)",
      "taskType": "string (one of the allowed taskTypes)",
      "reason": "1–2 sentence explanation"
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
    model: process.env.AI_TASK_MODEL || "gpt-5.1",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a JSON API. Respond only with valid JSON." },
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

  // THE FIX: Extract implementedTypes from the actual plan
  const implementedTypesUsed = [...new Set(plan.map(p => p.taskType).filter(Boolean))];

  // RETURN BOTH — this is what the controller expects!
  return {
    plannedTasks: plan,
    implementedTypes: implementedTypesUsed, // ← Now always a proper array
  };
}