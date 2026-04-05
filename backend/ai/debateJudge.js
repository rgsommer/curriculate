// backend/ai/debateJudge.js
import OpenAI from "openai";
let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[debateJudge] OPENAI_API_KEY is not set");
  return (_openai = new OpenAI({ apiKey }));
}
const openai = new Proxy({}, { get: (_, prop) => getOpenAI()[prop] });

export async function generateDebateVerdict(debateData) {
  const { resolution, speeches, teamNames = { affirmative: "Affirmative", negative: "Negative" } } = debateData;

  const speechesText = speeches
    .map(s => `${s.team.toUpperCase()} (${s.speaker}): ${s.transcript}`)
    .join("\n\n");

  const prompt = `
You are the world's most respected high school debate judge.

Resolution: "${resolution}"

Full debate transcript:
${speechesText}

Write a complete, professional judging decision including:
1. Winner declaration
2. Final scores (out of 100 per team)
3. Strengths and weaknesses of each side
4. Best individual speaker
5. Key moments that decided the debate
6. Constructive feedback for improvement

Be fair, specific, encouraging, and decisive.

Return ONLY JSON:
{
  "winner": "affirmative" or "negative",
  "scores": { "affirmative": 94, "negative": 89 },
  "bestSpeaker": "Maria (Affirmative)",
  "feedback": "The Affirmative team won this debate due to their superior use of evidence..."
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  return JSON.parse(response.choices[0].message.content);
}