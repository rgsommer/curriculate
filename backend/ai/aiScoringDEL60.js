import OpenAI from "openai";
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helpers ---

function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== "string") return fallback;
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
}

// Simple clamp helper
function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

// Normalize a student’s answer that might be a primitive or a MultiPartTask object
// { value, baseIndex, answer } → best primitive we can use.
function normalizeStudentAnswerPrimitive(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object") return raw;

  if (typeof raw.baseIndex === "number") return raw.baseIndex;
  if (raw.value != null) return raw.value;
  if (raw.answer != null) return raw.answer;

  return raw;
}

// --- RULE-BASED SCORING FOR OBJECTIVE TASKS ---

function scoreSubmissionRuleBased({ task, submission }) {
  const meta = TASK_TYPE_META[task.taskType] || {};

  // If the caller accidentally sends an objective task here, skip AI scoring.
  if (meta.objectiveScoring) {
    return {
      score: null,
      maxPoints: typeof task.points === "number" ? task.points : null,
      method: "skipped-objective",
      details: { reason: "Objective task types should be scored deterministically (not via aiScoring)." },
    };
  }
  if (!meta.objectiveScoring) return null;

  const points = typeof task.points === "number" ? task.points : 1;
  let score = 0;
  let maxPoints = points;

  const correct = task.correctAnswer;
  let studentAnswerRaw = submission?.answer;

  // Allow for SHORT_ANSWER multi-question payloads that were stringified
  // as JSON with shape: { kind: "multi-short-answer", answers: [...] }.
  let workingSubmission = submission || {};
  if (
    task.taskType === TASK_TYPES.SHORT_ANSWER &&
    Array.isArray(task.items) &&
    task.items.length > 0 &&
    (!Array.isArray(workingSubmission.answers) ||
      workingSubmission.answers.length === 0)
  ) {
    let payload = null;
    if (typeof workingSubmission.answer === "string") {
      payload = safeJsonParse(workingSubmission.answer);
    } else if (typeof workingSubmission === "string") {
      payload = safeJsonParse(workingSubmission);
    }
    if (
      payload &&
      payload.kind === "multi-short-answer" &&
      Array.isArray(payload.answers)
    ) {
      workingSubmission = { ...workingSubmission, answers: payload.answers };
    }
  }

  // Multiple-choice / True-False / Short-answer with explicit correctAnswer
    if (
    [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(
      task.taskType
    )
  ) {
    let totalItems = 0;
    let correctCount = 0;

    // Multi-question item set
    if (Array.isArray(task.items) && task.items.length > 0) {
      const items = task.items;
      totalItems = items.length;
      maxPoints = points * items.length;

      items.forEach((item, index) => {
        const answersArray =
          workingSubmission?.answers && Array.isArray(workingSubmission.answers)
            ? workingSubmission.answers
            : null;
        const studentItemAnswerRaw =
          answersArray && index < answersArray.length
            ? answersArray[index]
            : undefined;

        if (studentItemAnswerRaw == null) return;
        if (item.correctAnswer == null) return;

        const studentItemAnswer = normalizeStudentAnswerPrimitive(
          studentItemAnswerRaw
        );
        const baseOptions = Array.isArray(item.options)
          ? item.options
          : Array.isArray(task.options)
          ? task.options
          : null;

        let isCorrect = false;

        // Correct answer is a single primitive
        if (
          typeof item.correctAnswer === "string" ||
          typeof item.correctAnswer === "number" ||
          typeof item.correctAnswer === "boolean"
        ) {
          // If it's a numeric index and we have options, allow both index and option-text matches
          if (
            typeof item.correctAnswer === "number" &&
            baseOptions &&
            baseOptions[item.correctAnswer] != null
          ) {
            const correctIndex = item.correctAnswer;
            const correctText = String(baseOptions[correctIndex]).trim().toLowerCase();

            if (typeof studentItemAnswer === "number") {
              isCorrect = studentItemAnswer === correctIndex;
            } else {
              const normStudent = String(studentItemAnswer).trim().toLowerCase();
              isCorrect = normStudent === correctText;
            }
          } else {
            // Plain primitive compare
            const normStudent = String(studentItemAnswer).trim().toLowerCase();
            const normCorrect = String(item.correctAnswer).trim().toLowerCase();
            isCorrect = normStudent === normCorrect;
          }
        } else if (Array.isArray(item.correctAnswer)) {
          // Accept any of a list
          const normStudent = String(studentItemAnswer).trim().toLowerCase();
          const matches = item.correctAnswer.some(
            (ans) => String(ans).trim().toLowerCase() === normStudent
          );
          isCorrect = matches;
        }

        if (isCorrect) {
          score += points;
          correctCount += 1;
        }
      });
    } else {
      // Single question
      totalItems = 1;

      if (correct != null && studentAnswerRaw != null) {
        const studentAnswer = normalizeStudentAnswerPrimitive(studentAnswerRaw);
        const options = Array.isArray(task.options) ? task.options : null;

        let candidates;

        if (Array.isArray(correct)) {
          candidates = correct.slice();
        } else if (
          typeof correct === "number" &&
          options &&
          options[correct] != null
        ) {
          // Index-based correct answer → allow both index and option text
          candidates = [correct, options[correct]];
        } else {
          candidates = [correct];
        }

        const correctMatch = candidates.some((ans) => {
          // If both numeric, compare numerically
          if (typeof ans === "number" && typeof studentAnswer === "number") {
            return ans === studentAnswer;
          }

          const normStudent = String(studentAnswer).trim().toLowerCase();
          const normCorrect = String(ans).trim().toLowerCase();
          return normStudent === normCorrect;
        });

        if (correctMatch) {
          score = points;
          correctCount = 1;
        }
      }
    }

    return {
      score,
      maxPoints,
      method: "rule-based",
      totalScore: score,
      totalItems,
      correctCount,
      details: {
        type: task.taskType,
        correctAnswer: task.correctAnswer,
        studentAnswer: submission?.answer,
      },
    };
  }

    // Sort / Sequence / Timeline use config for correctness
  if (
    [TASK_TYPES.SORT, TASK_TYPES.SEQUENCE, TASK_TYPES.TIMELINE].includes(task.taskType) &&
    task.config &&
    Array.isArray(task.config.items)
  ) {
    const items = task.config.items || [];

    // SORT uses a mapping (or items payload) instead of a simple order array
    if (task.taskType === TASK_TYPES.SORT) {
      let mapping = submission?.mapping || null;

      // If no explicit mapping was provided, but we have a payload-style
      // submission with buckets/items, build a mapping keyed by item id/text.
      if (!mapping && Array.isArray(submission?.items)) {
        mapping = {};
        submission.items.forEach((it) => {
          if (it == null) return;
          if (it.id != null) {
            mapping[it.id] = it.bucketIndex;
          }
          if (it.text != null) {
            mapping[it.text] = it.bucketIndex;
          }
        });
      }

      mapping = mapping || {};

      const gradedItems = items.filter(
        (it) => it && typeof it.bucketIndex === "number"
      );
      const totalItems = gradedItems.length || items.length || 1;
      const perItem = points / totalItems;
      score = 0;
      let correctCount = 0;

      gradedItems.forEach((it) => {
        const expectedBucket = it.bucketIndex;
        const studentBucket = mapping[it.id] ?? mapping[it.text];
        if (studentBucket == null) return;
        if (Number(studentBucket) === Number(expectedBucket)) {
          score += perItem;
          correctCount += 1;
        }
      });

      return {
        score,
        maxPoints: points,
        method: "rule-based",
        totalScore: score,
        totalItems,
        correctCount,
        details: {
          type: task.taskType,
          config: task.config,
          submission: { mapping },
        },
      };
    }

    // SEQUENCE / TIMELINE use an order array
    const studentOrderRaw = submission?.order || [];
    const studentOrder = Array.isArray(studentOrderRaw) ? studentOrderRaw : [];
    const totalItems = items.length || 1;

    if (!Array.isArray(studentOrder) || studentOrder.length === 0) {
      return {
        score: 0,
        maxPoints: points,
        method: "rule-based",
        totalScore: 0,
        totalItems,
        correctCount: 0,
        details: {
          reason: "No student order provided.",
        },
      };
    }

    // SEQUENCE / TIMELINE
    const perItem = points / totalItems;
    score = 0;
    let correctCount = 0;

    const allNumeric =
      Array.isArray(studentOrder) &&
      studentOrder.length === totalItems &&
      studentOrder.every((v) => Number.isInteger(v));

    if (allNumeric) {
      // Student order is an array of indices (0..n-1); award credit when
      // the item in each position matches the original correct index.
      for (let correctIndex = 0; correctIndex < totalItems; correctIndex++) {
        if (studentOrder[correctIndex] === correctIndex) {
          score += perItem;
          correctCount += 1;
        }
      }
    } else {
      // Student order is an array of item IDs; we derive the correct order
      const correctOrderIds = items.map((it, idx) => it.id ?? `item-${idx}`);

      correctOrderIds.forEach((id, index) => {
        const studentIndex = studentOrder.indexOf(id);
        if (studentIndex === index) {
          score += perItem;
          correctCount += 1;
        }
      });
    }

    return {
      score,
      maxPoints: points,
      method: "rule-based",
      totalScore: score,
      totalItems,
      correctCount,
      details: {
        type: task.taskType,
        // For numeric-based submissions correctOrderIds is implicit (0..n-1),
        // but we still include ids when they are present for debugging.
        correctOrder: items.map((it, idx) => it.id ?? `item-${idx}`),
        studentOrder,
      },
    };
  }

  // Everything else: not rule-based
  return null;
}

// --- AI SCORING CORE ---

async function scoreSubmissionWithAI({
  task,
  submission,
  rubric,
  explicitTotalPoints,
}) {
  if (!rubric || !rubric.totalPoints) {
    throw new Error("AI scoring requires a rubric with totalPoints.");
  }

  const totalPoints =
    typeof explicitTotalPoints === "number" ? explicitTotalPoints : rubric.totalPoints;

  const work = buildStudentWorkDescription(task, submission);

  const systemPrompt = `
You are an expert teacher evaluating a student team's work.

- Always return JSON ONLY, with no extra commentary.
- Use the provided rubric strictly.
- Score fairly but generously when in doubt.
- totalPoints is the maximum score you can award.
`.trim();

  const userPrompt = `
Task Type: ${task.taskType}
Task Title: ${task.title || "(untitled)"}
Task Prompt: ${task.prompt || "(no prompt)"}

Rubric:
${JSON.stringify(rubric, null, 2)}

Student Work (normalized):
${JSON.stringify(work, null, 2)}

Return JSON of the form:
{
  "score": number,  // 0–${totalPoints}
  "maxPoints": number,
  "reason": string  // brief explanation for the teacher
}
`.trim();

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = safeJsonParse(raw, {});
  const score = clamp(Number(parsed.score ?? 0), 0, totalPoints);

  return {
    score,
    maxPoints: totalPoints,
    reason: parsed.reason || "AI-scored based on rubric.",
    method: "ai-rubric",
  };
}

// --- BUILD NORMALIZED STUDENT-WORK DESCRIPTION FOR AI ---

function buildStudentWorkDescription(task, submission) {
  const type = task.taskType;

  // Multi-question Q&A descriptions
  if (
    [TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(
      type
    )
  ) {
    if (Array.isArray(task.items) && task.items.length > 0) {
      return {
        summary: "Set of question/answer pairs.",
        items: task.items.map((item, index) => {
          let rawStudent =
            submission?.answers && Array.isArray(submission.answers)
              ? submission.answers[index]
              : undefined;
          const normalizedStudent = normalizeStudentAnswerPrimitive(rawStudent);

          return {
            id: item.id || `q${index + 1}`,
            prompt: item.prompt,
            correctAnswer: item.correctAnswer,
            studentAnswer: normalizedStudent,
          };
        }),
      };
    }

    return {
      summary: "Single question/answer pair.",
      prompt: task.prompt,
      correctAnswer: task.correctAnswer,
      studentAnswer:
        normalizeStudentAnswerPrimitive(
          submission?.answer ?? submission?.text ?? null
        ),
    };
  }

  // Open text – pulls the real typed response
  if (type === TASK_TYPES.OPEN_TEXT) {
    const rawAnswer = submission?.answer ?? submission ?? null;
    let studentText = "";

    if (rawAnswer && typeof rawAnswer === "object") {
      studentText =
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        "";
    } else if (typeof rawAnswer === "string") {
      studentText = rawAnswer;
    }

    // Fallbacks if answer was stored directly on submission
    if (!studentText) {
      studentText =
        submission?.text ??
        submission?.response ??
        submission?.answerText ??
        "";
    }

    studentText = typeof studentText === "string" ? studentText : String(studentText || "");

    return {
      summary: "Open-text response.",
      prompt: task.prompt,
      studentText,
    };
  }

  // Photo Journal – explicit handling for photo + explanation
  if (
    type === TASK_TYPES.PHOTO_JOURNAL ||
    type === "photo-journal" ||
    type === "photo_journal" ||
    type === "photojournal"
  ) {
    const rawAnswer = submission?.answer ?? submission ?? null;

    let explanation = "";
    let notes = "";
    let hasPhoto = false;
    let photoMeta = null;

    if (rawAnswer && typeof rawAnswer === "object") {
      explanation =
        rawAnswer.explanation ??
        rawAnswer.caption ??
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        "";

      notes = rawAnswer.notes ?? "";

      if (rawAnswer.photo && typeof rawAnswer.photo === "object") {
        hasPhoto = true;
        // Only pass safe, non-binary metadata through to AI (no raw image data).
        photoMeta = {
          url: rawAnswer.photo.url || null,
          filename: rawAnswer.photo.filename || null,
          mimetype: rawAnswer.photo.mimetype || null,
          size: rawAnswer.photo.size || null,
        };
      } else if (rawAnswer.hasPhoto === true) {
        hasPhoto = true;
      }
    } else if (typeof rawAnswer === "string") {
      explanation = rawAnswer;
    }

    if (!explanation) {
      explanation =
        submission?.text ??
        submission?.response ??
        submission?.answerText ??
        "";
    }

    explanation =
      typeof explanation === "string" ? explanation : String(explanation || "");

    return {
      summary:
        "Photo journal task: student took or uploaded a photo and wrote a short explanation/caption about it.",
      prompt: task.prompt,
      explanation,
      notes,
      hasPhoto,
      photoMeta,
    };
  }

  // Hide & Seek – student finds a specific reference and explains its significance
  if (type === TASK_TYPES.HIDENSEEK || type === "hidenseek") {
    const rawAnswer = submission?.answer ?? submission ?? null;

    let significance = "";
    let hasPhoto = false;
    let photoMeta = null;

    if (rawAnswer && typeof rawAnswer === "object") {
      significance =
        rawAnswer.significance ??
        rawAnswer.explanation ??
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        "";

      if (rawAnswer.photo && typeof rawAnswer.photo === "object") {
        hasPhoto = true;
        photoMeta = {
          url: rawAnswer.photo.url || null,
          filename: rawAnswer.photo.filename || null,
          mimetype: rawAnswer.photo.mimetype || null,
          size: rawAnswer.photo.size || null,
        };
      } else if (rawAnswer.hasPhoto === true) {
        hasPhoto = true;
      }
    } else if (typeof rawAnswer === "string") {
      significance = rawAnswer;
    }

    if (!significance) {
      significance =
        submission?.significance ??
        submission?.text ??
        submission?.response ??
        submission?.answerText ??
        "";
    }

    significance =
      typeof significance === "string"
        ? significance
        : String(significance || "");

    const pageReference =
      task?.config?.pageReference ||
      task?.config?.page ||
      task?.config?.location ||
      null;

    const referenceAnswer =
      task?.config?.referenceAnswer ||
      task?.config?.modelAnswer ||
      task?.correctAnswer ||
      null;

    return {
      summary:
        "Hide & Seek task: student found a specific page or location and explained why it is important.",
      prompt: task.prompt,
      pageReference,
      referenceAnswer,
      significance,
      hasPhoto,
      photoMeta,
    };
  }

  // Photo / Make-and-Snap / Draw-Mime and related media tasks
  if (
    type === TASK_TYPES.PHOTO ||
    type === TASK_TYPES.MAKE_AND_SNAP ||
    type === TASK_TYPES.DRAW_MIME ||
    type === "photo" ||
    type === "make-and-snap" ||
    type === "make_and_snap" ||
    type === "draw-mime"
  ) {
    const rawAnswer = submission?.answer ?? submission ?? null;
    let studentText = "";

    if (rawAnswer && typeof rawAnswer === "object") {
      studentText =
        rawAnswer.text ??
        rawAnswer.response ??
        rawAnswer.answerText ??
        rawAnswer.notes ??
        "";
    } else if (typeof rawAnswer === "string") {
      studentText = rawAnswer;
    }

    if (!studentText) {
      studentText =
        submission?.text ??
        submission?.notes ??
        submission?.answerText ??
        "";
    }

    studentText =
      typeof studentText === "string" ? studentText : String(studentText || "");

    let summary;
    if (
      type === TASK_TYPES.MAKE_AND_SNAP ||
      type === "make-and-snap" ||
      type === "make_and_snap"
    ) {
      summary =
        "Make-and-Snap task: students built or created something, then took a photo as evidence.";
    } else if (type === TASK_TYPES.DRAW_MIME || type === "draw-mime") {
      summary =
        "Draw/Mime task: students drew or acted out the idea, often taking a photo of their work or pose.";
    } else {
      summary =
        "Photo evidence task: students took or uploaded a photo as evidence connected to the prompt.";
    }

    return {
      summary,
      prompt: task.prompt,
      studentText,
      hasPhoto:
        submission?.hasPhoto === true ||
        (typeof studentText === "string" &&
          studentText.toLowerCase().includes("[photo taken]")),
      // Raw image blobs/URLs are not sent to AI here; teacher sees the media separately.
    };
  }

  // Pronunciation / speech recognition
  if (
    type === TASK_TYPES.PRONUNCIATION ||
    type === TASK_TYPES.SPEECH_RECOGNITION ||
    type === "pronunciation" ||
    type === "speech-recognition"
  ) {
    const targetText =
      task.targetText ||
      task.referenceText ||
      submission?.referenceText ||
      null;

    const recognizedText =
      submission?.recognizedText ||
      submission?.transcript ||
      submission?.answerText ||
      null;

    const audioReference = submission?.audioUrl || submission?.audio || null;

    const targetAccent =
      submission?.targetAccent || task.targetAccent || null;

    const language = submission?.language || task.language || null;

    return {
      summary: "Spoken response evaluated for pronunciation / speech.",
      prompt: task.prompt,
      targetText,
      recognizedText,
      audioReference,
      targetAccent,
      language,
    };
  }

  // Collaboration summary
  if (type === TASK_TYPES.COLLABORATION) {
    return {
      summary: "Collaboration task: description of team process and outcome.",
      prompt: task.prompt,
      teamNotes: submission?.notes || "",
      artifacts: submission?.artifacts || [],
    };
  }

  // NEW: Mind Mapper – use completion flag + node info for AI
  if (type === TASK_TYPES.MIND_MAPPER || type === "mind-mapper") {
    const configItems =
      (task.config && Array.isArray(task.config.items) && task.config.items) || [];
    const shuffledItems =
      (Array.isArray(task.shuffledItems) && task.shuffledItems) || [];
    const nodes = configItems.length ? configItems : shuffledItems;
    const organizerType = task.organizerType || "mind-map";
    const completed = submission?.completed === true;

    return {
      summary: `Mind Mapper puzzle on organizer "${organizerType}". Students dragged concept nodes into an order; client logic reports the puzzle as ${
        completed ? "COMPLETED (all nodes correctly ordered)." : "NOT completed."
      }`,
      organizerType,
      nodes: (nodes || []).map((it, index) => ({
        id: it.id || `node-${index + 1}`,
        text: it.text || it.label || "",
        correctIndex:
          typeof it.correctIndex === "number" ? it.correctIndex : null,
      })),
      clientCompletionFlag: completed,
    };
  }

  // NEW: Brain Spark Notes – completion + bullet structure
  if (type === TASK_TYPES.BRAIN_SPARK_NOTES || type === "brain-spark-notes") {
    const completed =
      submission?.completed === true ||
      submission?.answer?.completed === true;
    const studentNotes =
      submission?.notes ||
      submission?.answer?.notes ||
      "";

    return {
      summary:
        "Brain Spark Notes task: students were given bullet-point prompts for their notebook and marked whether they completed the notes.",
      prompt: task.prompt,
      bullets: Array.isArray(task.bullets) ? task.bullets : [],
      completed,
      studentNotes,
    };
  }

  // Fallback: generic
  return {
    summary: `Student submission for taskType "${type}" with generic structure.`,
    details: {
      taskPrompt: task.prompt,
      studentAnswer: submission?.answer ?? submission ?? null,
    },
  };
}

// --- SPECIAL CASE: ECHO CHAIN (ORAL MEMORY CHAIN, RULE-BASED) ---
// EchoChain is primarily an oral, intra-team game. The client tracks the chain and submits
// a summary payload. Scoring here is deterministic and focuses on:
// - chain length achieved
// - whether a full rotation was completed without errors (optional bonus)
// Expected flexible submission shapes (we accept several common fields):
//   {
//     chain: string[],
//     chainLength?: number,
//     errors?: number,
//     mistakes?: number,
//     completedRotation?: boolean,
//     rotationsCompleted?: number,
//     timeLeftSeconds?: number
//   }
// Notes:
// - We do NOT attempt semantic correctness of each added term here (that would require
//   speech-to-text + subject knowledge). Instead we score the teamwork/working-memory
//   completion signal. If you later add speech recognition, you can route through AI.
function scoreEchoChain({ task, submission }) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const chain =
    (Array.isArray(submission?.chain) && submission.chain) ||
    (Array.isArray(submission?.answer?.chain) && submission.answer.chain) ||
    [];

  const chainLengthRaw =
    submission?.chainLength ??
    submission?.answer?.chainLength ??
    (Array.isArray(chain) ? chain.length : 0);

  const chainLength = clamp(Number(chainLengthRaw) || 0, 0, 999);

  const errorsRaw =
    submission?.errors ??
    submission?.mistakes ??
    submission?.answer?.errors ??
    submission?.answer?.mistakes ??
    0;

  const errors = clamp(Number(errorsRaw) || 0, 0, 999);

  const rotationsCompletedRaw =
    submission?.rotationsCompleted ??
    submission?.answer?.rotationsCompleted ??
    (submission?.completedRotation === true || submission?.answer?.completedRotation === true ? 1 : 0);

  const rotationsCompleted = clamp(Number(rotationsCompletedRaw) || 0, 0, 999);

  const completedRotation =
    submission?.completedRotation === true ||
    submission?.answer?.completedRotation === true ||
    rotationsCompleted >= 1;

  const timeLeftRaw =
    submission?.timeLeftSeconds ??
    submission?.answer?.timeLeftSeconds ??
    submission?.timeLeft ??
    submission?.secondsLeft ??
    null;

  const timeLeftSeconds =
    timeLeftRaw == null ? null : clamp(Number(timeLeftRaw) || 0, 0, 3600);

  const basePoints = typeof cfg.basePoints === "number" ? cfg.basePoints : 0;
  const perAdd =
    typeof cfg.pointsPerCorrectAdd === "number"
      ? cfg.pointsPerCorrectAdd
      : typeof cfg.pointsPerAdd === "number"
      ? cfg.pointsPerAdd
      : 1;

  const rotationBonus =
    typeof cfg.rotationBonusPoints === "number"
      ? cfg.rotationBonusPoints
      : typeof cfg.fullRotationBonus === "number"
      ? cfg.fullRotationBonus
      : 5;

  const maxChainLength =
    typeof cfg.maxChainLength === "number"
      ? clamp(cfg.maxChainLength, 1, 999)
      : 999;

  const cappedChainLen = clamp(chainLength, 0, maxChainLength);

  const points = typeof task.points === "number" ? task.points : 15;

  // Score model: reward building the chain; subtract a small penalty per error;
  // add a bonus for completing a clean full rotation.
  let score = basePoints + cappedChainLen * perAdd;

  // Small penalty for mistakes (doesn't nuke the whole attempt)
  if (errors > 0) score -= errors * Math.max(1, Math.round(perAdd / 2));

  // Rotation bonus only if the team completed a rotation and had zero errors.
  if (completedRotation && errors === 0) score += rotationBonus;

  // Time bonus (optional): small extra for finishing with time remaining.
  if (errors === 0 && typeof timeLeftSeconds === "number") {
    if (timeLeftSeconds >= 20) score += 2;
    else if (timeLeftSeconds > 0) score += 1;
  }

  score = clamp(Math.round(score), 0, points);

  const correct = completedRotation && errors === 0;

  const reason = correct
    ? `Great job—your team completed a full rotation with no mistakes! Chain length: ${cappedChainLen}.`
    : errors > 0
    ? `Nice attempt. You reached a chain length of ${cappedChainLen}, but there ${errors === 1 ? 'was 1 mistake' : `${errors} mistakes`}. Try again and focus on repeating the full chain accurately.`
    : completedRotation
    ? `You completed a rotation, but the system couldn't confirm a clean run. Chain length: ${cappedChainLen}.`
    : `Good start! Chain length: ${cappedChainLen}. Aim for a full rotation with no mistakes for a bonus.`;

  return {
    score,
    maxPoints: points,
    method: "rule-based",
    correct,
    reason,
    details: {
      type: TASK_TYPES.ECHO_CHAIN || "echo-chain",
      chainLength: cappedChainLen,
      errors,
      completedRotation,
      rotationsCompleted,
      timeLeftSeconds,
      config: {
        basePoints,
        perAdd,
        rotationBonus,
        maxChainLength,
      },
    },
  };
}

// --- SPECIAL CASE: GUESS WHO (YES/NO DEDUCTION, RULE-BASED) ---
// GuessWho is not AI-scored; it is deterministically scored from submission state.
// Expected submission shape (flexible):
//   { correct: boolean, timeLeftSeconds?: number, guessesUsed?: number, maxGuesses?: number }
// The UI/gameplay (hold-to-reveal, timer start on first reveal, guess counter) is handled client-side;
// backend scoring only needs correctness + time/guesses for bonus.
function scoreGuessWho({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 20;

  const correct = submission?.correct === true;

  // Support several common field names to be resilient.
  const timeLeftRaw =
    submission?.timeLeftSeconds ??
    submission?.timeLeft ??
    submission?.secondsLeft ??
    submission?.timeRemaining ??
    null;

  const guessesUsedRaw =
    submission?.guessesUsed ??
    submission?.guessCount ??
    submission?.guesses ??
    null;

  const maxGuessesRaw =
    submission?.maxGuesses ??
    task?.maxGuesses ??
    task?.config?.maxGuesses ??
    task?.config?.guessLimit ??
    task?.guessLimit ??
    10;

  const timeLeftSeconds =
    timeLeftRaw == null ? null : clamp(Number(timeLeftRaw) || 0, 0, 3600);
  const guessesUsed =
    guessesUsedRaw == null ? null : clamp(Number(guessesUsedRaw) || 0, 0, 999);
  const maxGuesses = clamp(Number(maxGuessesRaw) || 10, 1, 999);

  // Bonus model: reward quick solves + efficient guessing. Keep simple & transparent.
  let bonus = 0;

  // Time bonus (matches your suggested tiers, but safe if time is unknown)
  if (correct && typeof timeLeftSeconds === "number") {
    if (timeLeftSeconds >= 40) bonus += 20;
    else if (timeLeftSeconds >= 20) bonus += 15;
    else if (timeLeftSeconds > 0) bonus += 10;
  }

  // Guess-efficiency bonus (small; prevents time bonus from dominating)
  if (correct && typeof guessesUsed === "number") {
    // best: <= 3 guesses, good: <= 6 guesses
    if (guessesUsed <= 3) bonus += 8;
    else if (guessesUsed <= 6) bonus += 4;
  }

  const score = correct ? points + bonus : 0;

  const reason = correct
    ? `Correct! +${points}${bonus ? ` (bonus +${bonus})` : ""}.` +
      (typeof guessesUsed === "number"
        ? ` Guesses used: ${guessesUsed}/${maxGuesses}.`
        : "") +
      (typeof timeLeftSeconds === "number" ? ` Time left: ${timeLeftSeconds}s.` : "")
    : "Not quite. Keep narrowing it down using only yes/no questions, then make your best guess.";

  return {
    score,
    maxPoints: points + 28, // theoretical max with current bonus caps (20 time + 8 guesses)
    method: "rule-based",
    correct,
    reason,
    details: {
      type: TASK_TYPES.GUESS_WHO || "guess-who",
      timeLeftSeconds,
      guessesUsed,
      maxGuesses,
      basePoints: points,
      bonus,
    },
  };
}

// --- SPECIAL CASE: DIFF DETECTIVE ---

async function scoreDiffDetective({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 10;
  const foundCount = submission?.foundCount ?? 0;
  const totalDifferences =
    task.config?.differences?.length ?? task.totalDifferences ?? 5;

  if (totalDifferences <= 0) {
    return {
      score: 0,
      maxPoints: points,
      method: "rule-based",
      details: {
        reason: "No totalDifferences configured for DiffDetective.",
      },
    };
  }

  const ratio = clamp(foundCount / totalDifferences, 0, 1);
  const score = Math.round(ratio * points);

  return {
    score,
    maxPoints: points,
    method: "rule-based",
    details: {
      type: TASK_TYPES.DIFF_DETECTIVE,
      foundCount,
      totalDifferences,
      ratio,
    },
  };
}

// --- SPECIAL CASE: MIND MAPPER (AI-ASSISTED BUT SIMPLE) ---

async function scoreMindMapper({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 20;
  const completed = submission?.completed === true;

  // Simple rubric: full credit if completed, partial/zero otherwise.
  const rubric = {
    totalPoints: points,
    criteria: [
      {
        id: "mindmap_completion",
        label: "Mind Mapper puzzle completion",
        maxPoints: points,
        description:
          "Give FULL points if the student successfully completed the Mind Mapper puzzle and the client reports completed=true. " +
          "If not completed, give between 0 and 50% of the points depending on how close or thorough the attempt appears from the description. " +
          "Always include a brief explanation for your decision.",
      },
    ],
  };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric,
    explicitTotalPoints: points,
  });

  const clampedScore = clamp(
    typeof result.score === "number" ? result.score : 0,
    0,
    points
  );

  return {
    ...result,
    score: clampedScore,
    maxPoints: points,
    method: "ai-rubric",
    rubricUsed: rubric,
    details: {
      ...(result.details || {}),
      type: TASK_TYPES.MIND_MAPPER,
      completed,
    },
  };
}

// --- SPECIAL CASE: PHOTO JOURNAL (PHOTO + TEXT) ---

async function scorePhotoJournal({ task, submission, rubric }) {
  const points = typeof task.points === "number" ? task.points : 10;

  // Default rubric if the caller didn't provide one.
  const effectiveRubric =
    rubric ||
    {
      totalPoints: points,
      criteria: [
        {
          id: "photo_match",
          label: "Photo matches the prompt",
          maxPoints: Math.round(points * 0.6),
          description:
            "Does the photo clearly show something that matches the teacher's prompt or evidence requested? " +
            "Give most or all of these points if the image is mostly on-topic, even if not perfect.",
        },
        {
          id: "explanation_quality",
          label: "Explanation clarity and accuracy",
          maxPoints: points - Math.round(points * 0.6),
          description:
            "Is the written explanation accurate, clear, and appropriately detailed for the grade level? " +
            "Does it explain WHY the photo is a good example of the idea or evidence requested?",
        },
      ],
    };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric: effectiveRubric,
    explicitTotalPoints: points,
  });

  const clampedScore = clamp(
    typeof result.score === "number" ? result.score : 0,
    0,
    points
  );

  return {
    ...result,
    score: clampedScore,
    maxPoints: points,
    method: "ai-rubric",
    rubricUsed: effectiveRubric,
    details: {
      ...(result.details || {}),
      type: TASK_TYPES.PHOTO_JOURNAL,
    },
  };
}

// --- SPECIAL CASE: HIDENSEEK (PAGE REFERENCE + SIGNIFICANCE EXPLANATION) ---

async function scoreHideNSeek({ task, submission, rubric }) {
  const points = typeof task.points === "number" ? task.points : 10;

  const referenceAnswer =
    task?.config?.referenceAnswer ||
    task?.config?.modelAnswer ||
    task?.correctAnswer ||
    null;

  const effectiveRubric =
    rubric ||
    {
      totalPoints: points,
      criteria: [
        {
          id: "alignment",
          label: "Matches the key idea or significance",
          maxPoints: Math.round(points * 0.6),
          description:
            "Compare the student's explanation of WHY this page/location is important to the teacher's reference answer. " +
            "Give most or all of these points if the student clearly captures the main idea, even if wording is different.",
        },
        {
          id: "clarity_detail",
          label: "Clarity and appropriate detail",
          maxPoints: points - Math.round(points * 0.6),
          description:
            "Is the explanation clear, understandable, and reasonably detailed for the grade level? " +
            "Reward brief but focused answers that show understanding; do not require long paragraphs.",
        },
      ],
    };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric: effectiveRubric,
    explicitTotalPoints: points,
  });

  const clampedScore = clamp(
    typeof result.score === "number" ? result.score : 0,
    0,
    points
  );

  return {
    ...result,
    score: clampedScore,
    maxPoints: points,
    method: "ai-rubric",
    rubricUsed: effectiveRubric,
    details: {
      ...(result.details || {}),
      type: TASK_TYPES.HIDENSEEK,
      referenceAnswer,
    },
  };
}

// --- SPECIAL CASE: BRAIN SPARK NOTES (COMPLETION-BASED) ---

async function scoreBrainSparkNotes({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 5;

  const completed =
    submission?.completed === true ||
    submission?.answer?.completed === true;

  const score = completed ? points : 0;
  const totalItems = 1;
  const correctCount = completed ? 1 : 0;

  return {
    score,
    maxPoints: points,
    method: "rule-based",
    totalScore: score,
    totalItems,
    correctCount,
    reason: completed
      ? "Nice work—your Spark Notes are marked complete, so you earned full credit for writing them down."
      : "No credit: this Spark Notes task was not marked complete.",
    details: {
      type: TASK_TYPES.BRAIN_SPARK_NOTES,
      completed,
    },
  };
}

// --- SPECIAL CASE: SPEECH RECOGNITION / PRONUNCIATION ---

async function scoreSpeechRecognition({ task, submission, rubric }) {
  const points = typeof task.points === "number" ? task.points : 10;

  const effectiveRubric =
    rubric ||
    {
      totalPoints: points,
      criteria: [
        {
          id: "accuracy",
          label: "Content / wording accuracy",
          maxPoints: Math.round(points * 0.5),
          description:
            "Compare the recognizedText with the targetText (if provided) or the prompt. " +
            "Give more points when the spoken words closely match the intended text or answer.",
        },
        {
          id: "pronunciation",
          label: "Pronunciation and clarity",
          maxPoints: Math.round(points * 0.3),
          description:
            "Judge how clear and understandable the student's speech would likely be to a fluent speaker. " +
            "Reward reasonably clear speech, even if accent is present.",
        },
        {
          id: "fluency",
          label: "Fluency and pacing",
          maxPoints: points - Math.round(points * 0.5) - Math.round(points * 0.3),
          description:
            "Consider smoothness and pacing. Give higher points if the student speaks in a mostly smooth way without excessive pauses or restarts.",
        },
      ],
    };

  const result = await scoreSubmissionWithAI({
    task,
    submission,
    rubric: effectiveRubric,
    explicitTotalPoints: points,
  });

  const clampedScore = clamp(
    typeof result.score === "number" ? result.score : 0,
    0,
    points
  );

  return {
    ...result,
    score: clampedScore,
    maxPoints: points,
    method: "ai-rubric",
    rubricUsed: effectiveRubric,
    details: {
      ...(result.details || {}),
      type: task.taskType,
    },
  };
}

// --- SPECIAL CASE: NARRATION SYNTHESIZE (PEER-RATED, NO OPENAI) ---
// NarrationSynthesize is an oral, intra-team teach-back. It should NOT be AI-scored.
// The client submits peer ratings (slider) and completion signals; we translate that
// into a demo-friendly score and a short, encouraging feedback message.
// Expected (flexible) submission shapes:
//   { ratings: number[] }
//   { data: { ratings: number[] } }
//   { answer: { ratings: number[] } }
// Rating scale is taken from task.config.ratingScale: { min, max, label } (defaults 1..5).
function scoreNarrationSynthesize({ task, submission }) {
  const points = typeof task.points === "number" ? task.points : 10;

  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const scale = cfg?.ratingScale && typeof cfg.ratingScale === "object" ? cfg.ratingScale : {};
  const min = Number.isFinite(Number(scale.min)) ? Number(scale.min) : 1;
  const max = Number.isFinite(Number(scale.max)) ? Number(scale.max) : 5;

  const ratings =
    (Array.isArray(submission?.ratings) && submission.ratings) ||
    (Array.isArray(submission?.data?.ratings) && submission.data.ratings) ||
    (Array.isArray(submission?.answer?.ratings) && submission.answer.ratings) ||
    (Array.isArray(submission?.data?.peerRatings) && submission.data.peerRatings) ||
    [];

  const nums = (Array.isArray(ratings) ? ratings : [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  if (!nums.length) {
    return {
      score: 0,
      maxPoints: points,
      method: "peer-rating",
      correct: null,
      reason:
        "Thanks for the teach-back! (No peer ratings were submitted, so no points were calculated.)",
      details: {
        type: TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize",
        ratingsCount: 0,
        scale: { min, max },
      },
    };
  }

  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;

  // Map average rating to points (min -> 0, max -> full points)
  const denom = Math.max(1e-6, max - min);
  const normalized = clamp((avg - min) / denom, 0, 1);
  const score = clamp(Math.round(normalized * points), 0, points);

  const label = String(scale.label || "Clarity / Accuracy / Quality").trim();
  const reason =
    score >= Math.round(points * 0.8)
      ? `Strong teach-back! Your teammates rated your ${label.toLowerCase()} highly (avg ${avg.toFixed(1)}/${max}).`
      : score >= Math.round(points * 0.45)
      ? `Nice work! Your teammates rated your ${label.toLowerCase()} at ${avg.toFixed(1)}/${max}. Next time, add one extra example or restate the key steps clearly.`
      : `Good start—keep practicing! Your teammates rated your ${label.toLowerCase()} at ${avg.toFixed(1)}/${max}. Try organizing your explanation into 2–3 clear steps.`;

  return {
    score,
    maxPoints: points,
    method: "peer-rating",
    correct: null,
    reason,
    details: {
      type: TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize",
      avgRating: avg,
      ratingsCount: nums.length,
      scale: { min, max, label },
      normalized,
    },
  };
}

// --- PUBLIC ENTRYPOINT ---

export async function generateAIScore({ task, submission, rubric }) {
  if (!task) {
    throw new Error("generateAIScore requires a task.");
  }
  // Specialized path: Echo Chain (rule-based, no rubric / no OpenAI call)
  if (
    task?.taskType === TASK_TYPES.ECHO_CHAIN ||
    task?.taskType === "echo-chain" ||
    task?.taskType === "echo_chain" ||
    task?.taskType === "echochain"
  ) {
    return scoreEchoChain({ task, submission });
  }
  // Specialized path: Guess Who (rule-based, no rubric / no OpenAI call)
  if (
    task?.taskType === TASK_TYPES.GUESS_WHO ||
    task?.taskType === "guess-who" ||
    task?.taskType === "guess_who" ||
    task?.taskType === "guesswho"
  ) {
    return scoreGuessWho({ task, submission });
  }


// Specialized path: Narration Synthesize (peer-rated; no OpenAI call)
if (
  task?.taskType === TASK_TYPES.NARRATION_SYNTHESIZE ||
  task?.taskType === "narration-synthesize" ||
  task?.taskType === "narration_synthesize" ||
  task?.taskType === "narrationsynthesize"
) {
  return scoreNarrationSynthesize({ task, submission });
}

  // Specialized path: Mind Mapper
  if (task?.taskType === TASK_TYPES.MIND_MAPPER || task?.taskType === "mind-mapper") {
    return scoreMindMapper({ task, submission });
  }

  // Specialized path: Diff Detective (rule-based, no rubric needed)
  if (
    task?.taskType === TASK_TYPES.DIFF_DETECTIVE ||
    task?.taskType === "diff-detective"
  ) {
    return scoreDiffDetective({ task, submission });
  }

  // Specialized path: Photo Journal (photo + written explanation)
  if (
    task?.taskType === TASK_TYPES.PHOTO_JOURNAL ||
    task?.taskType === "photo-journal" ||
    task?.taskType === "photo_journal" ||
    task?.taskType === "photojournal"
  ) {
    return scorePhotoJournal({ task, submission, rubric });
  }

  // Specialized path: Hide & Seek (page reference + significance explanation)
  if (task?.taskType === TASK_TYPES.HIDENSEEK || task?.taskType === "hidenseek") {
    return scoreHideNSeek({ task, submission, rubric });
  }

  // Specialized path: Brain Spark Notes (completion-based, no rubric needed)
  if (
    task?.taskType === TASK_TYPES.BRAIN_SPARK_NOTES ||
    task?.taskType === "brain-spark-notes"
  ) {
    return scoreBrainSparkNotes({ task, submission });
  }

  // Specialized path: Speech Recognition / Pronunciation
  if (
    task?.taskType === TASK_TYPES.SPEECH_RECOGNITION ||
    task?.taskType === "speech-recognition" ||
    task?.taskType === TASK_TYPES.PRONUNCIATION
  ) {
    return scoreSpeechRecognition({ task, submission, rubric });
  }

  const meta = TASK_TYPE_META[task.taskType] || {};

  // If the caller accidentally sends an objective task here, skip AI scoring.
  if (meta.objectiveScoring) {
    return {
      score: null,
      maxPoints: typeof task.points === "number" ? task.points : null,
      method: "skipped-objective",
      details: { reason: "Objective task types should be scored deterministically (not via aiScoring)." },
    };
  }
  const hasCorrect =
    task.correctAnswer != null ||
    (Array.isArray(task.items) &&
      task.items.some((it) => it.correctAnswer != null));

  const safeTask = {
    ...task,
    aiScoringRequired:
      typeof task.aiScoringRequired === "boolean"
        ? task.aiScoringRequired
        : meta.defaultAiScoringRequired,
  };

  // 2) Determine whether AI scoring is required for this (non-objective) task type.
  const requiresAI =
    task?.aiScoringRequired === true ||
    meta.defaultAiScoringRequired === true ||
    !!rubric;

  if (!requiresAI) {
    return {
      score: null,
      maxPoints: typeof safeTask.points === "number" ? safeTask.points : null,
      method: "none",
      details: {
        reason:
          "AI scoring not required and no rubric was provided.",
      },
    };
  }

  // 3) Use provided rubric or fail
  if (!rubric && task.taskType !== TASK_TYPES.PHOTO_JOURNAL) {
    throw new Error(
      `AI scoring is required for taskType "${task.taskType}" but no rubric was provided.`
    );
  }

  return await scoreSubmissionWithAI({
    task: safeTask,
    submission,
    rubric: rubric,
    explicitTotalPoints: safeTask.points,
  });
}

export default {
  generateAIScore,
};
