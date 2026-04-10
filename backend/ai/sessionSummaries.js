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

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[sessionSummaries] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}
const client = new Proxy({}, { get: (_, prop) => getClient()[prop] });

const SUMMARY_MODEL =
  process.env.AI_MODEL || "gpt-4.1-mini";

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
  topTeams,
  topPlayers,
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

3. "classChatBlurb"
   Write a fun, upbeat, 3–5 sentence paragraph that a teacher can paste directly
   into their Google Classroom, class chat, or parent newsletter. Requirements:
     - Use an enthusiastic but professional teacher voice
     - Name the activity / taskset by title if available
     - Mention 2–3 concepts or skills practiced (keep it brief, not an exhaustive list)
     - Name the top 3 teams (in 1st/2nd/3rd order) and top 3 individual players if available
     - End with an encouraging line about what comes next or how well the class did
     - Gently weave in any provided perspectives without being heavy-handed
   Example tone: "What a session! We had a blast reviewing [concepts] through [activities].
   Congrats to [Team A] for taking first place, with [Team B] and [Team C] close behind!
   Shout-out to [Player1], [Player2], and [Player3] for top individual scores. Keep it up!"

4. "skillsDeveloped"
   List 5–8 academic/soft skills that students practiced during this session.
   Be specific to the actual tasks and content — NOT generic filler.
   Examples: "close reading comprehension", "collaborative persuasive writing",
   "mental math under time pressure", "evidence-based argumentation",
   "vocabulary recall", "team communication", "creative problem-solving".

5. "activityHighlights"
   For each distinct task/activity in the session, return an object:
     { "taskType": string, "title": string, "description": string }
   where "description" is one sentence explaining what students did.

6. "engagementLevel"
   A single word or short phrase: "Exceptional", "High", "Moderate", "Low", or a custom phrase.

7. "overallProficiency"
   A single word or short phrase like "Strong", "Developing", "Emerging", etc.

8. "perParticipant"
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
    topTeams: topTeams || [],
    topPlayers: topPlayers || [],
  };

  const userPrompt = `
Here is the session data as JSON:

${JSON.stringify(payload, null, 2)}

Return ONLY this JSON structure:

{
  "groupSummary": string,
  "keyConcepts": string[],
  "classChatBlurb": string,
  "skillsDeveloped": string[],
  "activityHighlights": [ { "taskType": string, "title": string, "description": string } ],
  "engagementLevel": string,
  "overallProficiency": string,
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
