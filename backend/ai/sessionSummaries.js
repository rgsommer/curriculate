// ====================================================================
//  \ai\sessionSummaries.js
//  Generates AI-powered session summaries for:
//    • Overall group summary
//    • Key concepts
//    • Per-participant comments
//    • Per-category scoring (up to 4 custom categories)
//  Uses "perspectives" array to frame tone/context/worldview.
// ====================================================================

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SUMMARY_MODEL =
  process.env.AI_SUMMARY_MODEL || "gpt-5.1";

/**
 * Generate AI session summaries:
 *
 * @param {Object} params
 * @param {Object} params.transcript              // from buildTranscript()
 * @param {Array}  params.perParticipantStats     // from computePerParticipantStats()
 * @param {Array}  params.assessmentCategories    // up to 4 categories defined by teacher
 * @param {Array}  params.perspectives            // worldview/discipline/approach tags
 */

export async function generateSessionSummaries({
  transcript,
  perParticipantStats,
  assessmentCategories,
  perspectives,
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  // --------------------------------------------------------------
  // SYSTEM PROMPT — critical instruction for safe, structured output
  // --------------------------------------------------------------
  const systemPrompt = `
You are an assistant that generates structured session summaries for a teacher,
conference leader, or facilitator. 

You ALWAYS output valid JSON (no commentary, no markdown). 

You will be given:
- A transcript of all tasks and submissions.
- Numeric per-participant stats (engagementPercent, finalPercent, etc.).
- Up to 4 custom assessment categories (name, description, weight).
- A list of "perspectives" (strings). These describe the tone, worldview,
  instructional lens, or organizational context. Examples might include:
  • Christian/Biblical
  • Character / Virtue Formation
  • Leadership Development
  • Business / Professional
  • Team-Building
  • Inquiry-Based Learning
Blend these perspectives gently, professionally, and naturally into the tone of
your summaries. Do NOT sermonize or moralize; apply them lightly and in context.

Your tasks:

1. "groupSummary"
   Write 3–5 sentences summarizing:
     - Big ideas or concepts explored
     - General class/team performance
     - Tone framed gently through the given perspectives

2. "keyConcepts"
   List 5–10 key terms or ideas relevant to the activity.

3. "perParticipant"
   For each participant entry:
     - Use participant.studentName and participant.teamName.
     - Write a 3-sentence summary:
         Sentence 1: What topics/tasks they worked with.
         Sentence 2: What they did well.
         Sentence 3: One growth step or encouragement, framed in the provided perspectives.
     - Include engagementPercent and finalPercent as provided.
     - Include a "categories" array with each assessment category:
         {
           key,
           label,
           percent,   // approximate using finalPercent as the anchor
           comment    // short, category-specific, perspective-aware encouragement
         }

ALWAYS return valid JSON matching the structure in the user prompt.
No Markdown. No explanation outside the JSON.
`;

  // --------------------------------------------------------------
  // USER PROMPT — with payload
  // --------------------------------------------------------------
  const payload = {
    transcript,
    perParticipantStats,
    assessmentCategories,
    perspectives,
  };

  const userPrompt = `
Here is the session data as JSON:

${JSON.stringify(payload, null, 2)}

Return ONLY this JSON structure:

{
  "groupSummary": string,
  "keyConcepts": string[],
  "perParticipant": [
    {
      "teamName": string,
      "studentName": string,
      "summary": string,
      "engagementPercent": number,
      "finalPercent": number,
      "categories": [
        {
          "key": string,
          "label": string,
          "percent": number,
          "comment": string
        }
      ]
    }
  ]
}
`;

  // --------------------------------------------------------------
  // OPENAI CALL
  // --------------------------------------------------------------
  const response = await client.responses.create({
    model: SUMMARY_MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw =
    response?.output?.[0]?.content?.[0]?.text ||
    response?.output_text ||
    null;

  if (!raw) {
    throw new Error("No AI summary returned.");
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("AI SUMMARY PARSE ERROR:", err, "\nRAW:", raw);
    throw new Error("Invalid JSON returned by AI session summary model.");
  }
}
