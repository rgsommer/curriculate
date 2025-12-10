// backend/ai/aiScoring.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_MODEL = process.env.AI_SCORING_MODEL || "gpt-4o-mini";

/**
 * Try to infer the student's "answer" value from a submission object.
 * Supports several shapes for backwards compatibility.
 */
function extractStudentAnswer(submission = {}) {
  if (submission == null || typeof submission !== "object") return null;

  // Most likely fields first
  if (typeof submission.answerIndex === "number") return submission.answerIndex;
  if (typeof submission.selectedIndex === "number") return submission.selectedIndex;
  if (typeof submission.selectedOptionIndex === "number") {
    return submission.selectedOptionIndex;
  }
  if (typeof submission.choiceIndex === "number") return submission.choiceIndex;
  if (typeof submission.answer === "number" || typeof submission.answer === "string") {
    return submission.answer;
  }

  // Open-text style
  if (typeof submission.answerText === "string") return submission.answerText;

  return null;
}

/**
 * Objective / rule-based scoring for tasks that have a correctAnswer baked in
 * and do NOT require AI scoring.
 *
 * Returns the same shape as AI scoring:
 * {
 *   totalScore,
 *   maxPoints,
 *   criteria: [{ id, score, maxPoints, comment }],
 *   overallComment
 * }
 */
export function scoreSubmissionRuleBased({ task, submission }) {
  const safeTask = task || {};
  const safeSubmission = submission || {};

  const maxPoints =
    typeof safeTask.points === "number" && safeTask.points > 0
      ? safeTask.points
      : 1;

  const correctAnswer = safeTask.correctAnswer;
  const studentAnswer = extractStudentAnswer(safeSubmission);

  let isCorrect = false;
  let explanation = "";

  // If correctAnswer is a number → index-based (MC / True-False)
  if (typeof correctAnswer === "number") {
    const studentIndex =
      typeof studentAnswer === "number"
        ? studentAnswer
        : Number.isInteger(Number(studentAnswer))
        ? Number(studentAnswer)
        : null;

    if (
      studentIndex != null &&
      Array.isArray(safeTask.options) &&
      studentIndex >= 0 &&
      studentIndex < safeTask.options.length
    ) {
      isCorrect = studentIndex === correctAnswer;
      explanation = isCorrect
        ? "Selected option matches the correct answer."
        : "Selected option does not match the correct answer.";
    } else {
      isCorrect = false;
      explanation = "Student did not provide a valid option index.";
    }
  }
  // If correctAnswer is a string → short-answer style
  else if (typeof correctAnswer === "string") {
    const correct = correctAnswer.trim().toLowerCase();
    const studentText =
      typeof studentAnswer === "string"
        ? studentAnswer.trim().toLowerCase()
        : typeof studentAnswer === "number"
        ? String(studentAnswer)
        : "";

    if (!correct || !studentText) {
      isCorrect = false;
      explanation = "Missing or empty answer.";
    } else {
      // Basic normalization: trim + lower-case; allow simple equality
      // (You can later expand with synonyms or fuzzy matching.)
      isCorrect = studentText === correct;
      explanation = isCorrect
        ? "Student response matches the reference answer."
        : `Expected "${correctAnswer}", but got "${studentAnswer ?? ""}".`;
    }
  } else {
    // We don't know how to auto-score this task
    isCorrect = false;
    explanation =
      "This task is not configured for automatic scoring (no correctAnswer).";
  }

  const totalScore = isCorrect ? maxPoints : 0;

  return {
    totalScore,
    maxPoints,
    criteria: [
      {
        id: "correctness",
        score: totalScore,
        maxPoints,
        comment: explanation,
      },
    ],
    overallComment: explanation,
  };
}

/**
 * Specialized AI scoring for Diff Detective tasks (text, image, code modes).
 */
async function scoreDiffDetective({ task, submission }) {
  const mode = task.mode || "text";
  const studentText = typeof submission?.answerText === "string"
    ? submission.answerText
    : typeof submission?.answer === "string"
      ? submission.answer
      : "";

  if (!studentText.trim()) {
    return {
      totalScore: 0,
      maxPoints: task.points || 30,
      criteria: [],
      overallComment: "No answer submitted.",
    };
  }

  const differences = Array.isArray(task.differences) ? task.differences : [];

  if (differences.length === 0) {
    return scoreSubmissionRuleBased({ task, submission }); // fallback
  }

  let prompt = `
You are grading a "Diff Detective" task where students spot differences.

Expected differences:
${differences.map((d, i) => `${i + 1}. ${d.expected} (${d.type || "change"})`).join("\n")}

Student's answer:
"""${studentText.trim()}"""

Instructions:
- Accept natural language descriptions (e.g., "jumps to jumped", "missing comma").
- Award partial credit: 1 point per correctly identified difference.
- Be fair but accurate.

Return ONLY JSON:
{
  "totalScore": number,
  "maxPoints": number,
  "found": number,
  "totalExpected": number,
  "feedback": "string",
  "details": array of {expected: string, found: boolean, studentSaid: string}
}
`.trim();

  let model = "gpt-4o-mini";
  let messages = [{ role: "user", content: prompt }];

  if (mode === "image" && submission.imageUrl) {
    model = "gpt-4o"; // Need vision model
    prompt = `
Analyze this student-submitted image and describe what they circled/pointed to.
Compare to expected differences: ${differences.map(d => d.expected).join(", ")}.

Student text: "${studentText}"

Score how many they found.
` + prompt;

    messages = [
      { role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: submission.imageUrl } }
      ]}
    ];
  } else if (mode === "code") {
    prompt = `
This is a code debugging task.
Original code:
"""${task.original}"""

Modified (buggy) code:
"""${task.modified}"""

` + prompt;
  } else if (mode === "audio") {
    prompt = `
This is an "Audio Diff Detective" task for language learning.

Correct sentence:
"""${task.correctText}"""

Incorrect sentence spoken:
"""${task.incorrectText || "unknown"}"""

` + prompt;
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    });

    const result = JSON.parse(response.choices[0].message.content);

    const score = Math.min(result.totalScore || 0, result.maxPoints || task.points || 30);

    return {
      totalScore: score,
      maxPoints: result.maxPoints || task.points || 30,
      criteria: [
        {
          id: "differences_found",
          score: score,
          maxPoints: result.maxPoints || task.points || 30,
          comment: result.feedback || `Found ${result.found || 0}/${result.totalExpected || differences.length}`,
        },
      ],
      overallComment: result.feedback || "Good effort on spotting differences!",
    };
  } catch (err) {
    console.error("Diff Detective AI scoring failed:", err);
    // Simple fallback: keyword matching
    let found = 0;
    const lowerStudent = studentText.toLowerCase();
    differences.forEach(diff => {
      const [from, to] = diff.expected.split("→").map(s => s.trim().toLowerCase());
      if (lowerStudent.includes(from) || (to && lowerStudent.includes(to))) {
        found++;
      }
    });
    const score = Math.floor((found / differences.length) * (task.points || 30));
    return {
      totalScore: score,
      maxPoints: task.points || 30,
      criteria: [{
        id: "differences_found",
        score,
        maxPoints: task.points || 30,
        comment: `Fallback: found ~${found}/${differences.length} differences`,
      }],
      overallComment: "Scored with backup method.",
    };
  }
}

/**
 * Specialized AI scoring for pronunciation tasks, with accent comparison.
 */
async function scorePronunciation({ task, submission }) {
  if (!submission.audioUrl) {
    return { totalScore: 0, maxPoints: 30, overallComment: "No audio recorded." };
  }

  // Transcribe student's audio
  const audioFile = await fetch(submission.audioUrl).then(r => r.blob());
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: audioFile,
  });

  const targetAccent = submission.targetAccent || task.targetAccent || "american";
  const language = task.language || "English";

  const prompt = `
You are a world-class pronunciation coach for ${language}.

Reference sentence: "${task.referenceText}"

Student said (transcribed): "${transcription.text}"

Focus sounds: ${task.focusSounds?.join(", ") || "general pronunciation"}

Target accent: ${targetAccent.toUpperCase()} English

Assess:
- Accuracy: Correct words (0-10)
- Fluency: Rhythm, speed (0-10)
- Pronunciation: Clarity of sounds (0-10)
- Accent match: How close to ${targetAccent} (0-10, with British vs American differences noted)

Total score = sum / 4 * 3 (max 30)

Be encouraging. Return ONLY JSON:
{
  "totalScore": number,
  "accuracy": number,
  "fluency": number,
  "pronunciation": number,
  "accentMatch": number,
  "feedback": "string",
  "britishVsAmerican": ["string", "string"]
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const result = JSON.parse(response.choices[0].message.content);

  return {
    totalScore: result.totalScore || 20,
    maxPoints: 30,
    criteria: [
      { id: "accuracy", score: result.accuracy || 10, maxPoints: 10, comment: "Word recognition" },
      { id: "fluency", score: result.fluency || 10, maxPoints: 10, comment: "Flow and rhythm" },
      { id: "pronunciation", score: result.pronunciation || 10, maxPoints: 10, comment: "Sound clarity" },
    ],
    overallComment: result.feedback || "Well spoken!",
    studentTranscription: transcription.text,
    accentAnalysis: {
      accentMatch: result.accentMatch || 10,
      britishVsAmerican: result.britishVsAmerican || [],
    }
  };
}

/**
 * Specialized AI scoring for speech recognition tasks (real-time spoken answers).
 */
async function scoreSpeechRecognition({ task, submission }) {
  const spoken = submission.spokenText?.trim() || "";
  const reference = task.referenceText?.trim() || "";

  if (!spoken) {
    return {
      totalScore: 0,
      maxPoints: 30,
      overallComment: "No speech detected.",
    };
  }

  const prompt = `
You are grading a spoken answer.

Task: ${task.prompt || "Read aloud or answer verbally"}
Reference text (if reading): "${reference || "none"}"
Student said: "${spoken}"

Score out of 30:
- Accuracy (words correct): 0–15
- Grammar & structure: 0–8
- Fluency & clarity: 0–7

Return JSON:
{
  "totalScore": 28,
  "accuracy": 14,
  "grammar": 8,
  "fluency": 6,
  "feedback": "Great job! You said 'environment' clearly...",
  "wordMatch": 92,
  "missingWords": ["the", "and"],
  "extraWords": ["um", "like"]
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const result = JSON.parse(response.choices[0].message.content);

  return {
    totalScore: result.totalScore || 20,
    maxPoints: 30,
    criteria: [
      { id: "accuracy", score: result.accuracy || 10, maxPoints: 15, comment: "Word recognition" },
      { id: "grammar", score: result.grammar || 6, maxPoints: 8, comment: "Sentence structure" },
      { id: "fluency", score: result.fluency || 5, maxPoints: 7, comment: "Flow and clarity" },
    ],
    overallComment: result.feedback || "Well spoken!",
    speechAnalysis: {
      transcript: spoken,
      wordMatch: result.wordMatch,
      missing: result.missingWords,
      fillers: result.extraWords,
    }
  };
}

/**
 * Specialized AI scoring for AI Debate Judge tasks.
 */
async function scoreDebate({ task, submission }) {
  const debateData = submission.debateData || {}; // { resolution, speeches: [{team, speaker, audioUrl, phase}] }
  const resolution = debateData.resolution || task.resolution;

  const speechesWithTranscripts = await Promise.all(
    debateData.speeches.map(async s => {
      const audioBlob = await fetch(s.audioUrl).then(r => r.blob());
      const transcription = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: audioBlob,
      });
      return { ...s, transcript: transcription.text };
    })
  );

  const speechesText = speechesWithTranscripts
    .map(s => `${s.team.toUpperCase()} (${s.speaker}, ${s.phase}): ${s.transcript}`)
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

  const result = JSON.parse(response.choices[0].message.content);

  return {
    totalScore: result.scores[result.winner] || 50, // For winner only
    maxPoints: 100,
    criteria: [
      { id: "overall", score: result.scores.affirmative || 50, maxPoints: 100, comment: "Affirmative Score" },
      { id: "overall", score: result.scores.negative || 50, maxPoints: 100, comment: "Negative Score" },
    ],
    overallComment: result.feedback,
    bestSpeaker: result.bestSpeaker,
    winner: result.winner
  };
}

/**
 * Build a description of the student's work, depending on task type.
 */
function buildStudentWorkDescription(task, submission) {
  const taskType = task?.taskType || task?.type;

  if (taskType === "open-text" || taskType === "short-answer") {
    const text =
      submission?.answerText ??
      (typeof submission?.answer === "string" ? submission.answer : "") ??
      "";
    return `The student wrote the following response:\n\n"${text}"`;
  }

  // 🔹 NEW: collaboration-friendly description
  if (taskType === "collaboration") {
    const main =
      submission?.answerText ??
      submission?.main ??
      (typeof submission?.answer === "string" ? submission.answer : "") ??
      "";

    const reply =
      submission?.reply ??
      submission?.partnerReply ??
      "";

    const partner =
      submission?.partnerAnswer ??
      "";

    let description = `This is a pair collaboration task.\n\n` +
      `Student's main answer:\n"${main || "(no main answer)"}"`;

    if (partner) {
      description += `\n\nPartner's answer they were responding to:\n"${partner}"`;
    }

    if (reply) {
      description += `\n\nStudent's reply to their partner:\n"${reply}"`;
    }

    return description;
  }

  // Fallback for other types
  return `Raw submission:\n${JSON.stringify(submission, null, 2)}`;
}

/**
 * Ask the model to score a submission according to a rubric.
 *
 * Returns:
 * {
 *   totalScore: number,
 *   maxPoints: number,
 *   criteria: [{ id, score, maxPoints, comment }],
 *   overallComment: string
 * }
 */
export async function scoreSubmissionWithAI({ task, rubric, submission }) {
  if (!rubric || !rubric.criteria || rubric.criteria.length === 0) {
    throw new Error("Missing rubric for AI scoring");
  }

  const studentWorkDescription = buildStudentWorkDescription(task || {}, submission || {});

  const systemPrompt = `
You are an assistant helping a Grade 7–8 teacher score student work.

Always:
- Use the rubric provided.
- Give partial credit when a criterion is partially met.
- Be generous but honest, and avoid being overly strict about spelling, grammar, or accents.
- Return ONLY valid JSON in the exact structure requested, with no extra commentary.
`.trim();

  const userPrompt = `
Here is the grading rubric (JSON):

${JSON.stringify(rubric, null, 2)}

Here is the task the student was given:

${(task && task.prompt) || ""}

Here is the student's work:

${studentWorkDescription}

Score the work according to the rubric. For each criterion, assign a score from 0 up to maxPoints. Then compute the total score (sum of criteria) and ensure it does not exceed rubric.maxPoints.

Return ONLY JSON in this format:

{
  "totalScore": number,
  "maxPoints": number,
  "criteria": [
    {
      "id": string,
      "score": number,
      "maxPoints": number,
      "comment": string
    }
  ],
  "overallComment": string
}
`.trim();

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0, // scoring should be deterministic
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content?.trim() || "{}";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("AI scoring JSON parse error:", err, content);
    throw new Error("Failed to parse AI scoring response");
  }

  return parsed;
}

/**
 * Backwards-compatible entry point.
 *
 * Anywhere that calls generateAIScore({ task, rubric, submission })
 * will now:
 *  - Use rule-based scoring if task.aiScoringRequired === false AND a correctAnswer exists.
 *  - Otherwise fall back to AI scoring with rubric.
 */
export async function generateAIScore({ task, rubric, submission }) {
  const safeTask = task || {};

  // ----- Diff Detective Integration -----
  if (task?.taskType === "diff-detective") {
    return await scoreDiffDetective({ task, submission });
  }

  const hasCorrect =
    safeTask.correctAnswer !== undefined && safeTask.correctAnswer !== null;

  const requiresAI =
    typeof safeTask.aiScoringRequired === "boolean"
      ? safeTask.aiScoringRequired
      : !hasCorrect; // default: if we don't have a correctAnswer, we need AI

  if (!requiresAI && hasCorrect) {
    // Instant objective scoring
    return scoreSubmissionRuleBased({ task: safeTask, submission });
  }

  // Fallback to AI + rubric
  return scoreSubmissionWithAI({ task: safeTask, rubric, submission });
}