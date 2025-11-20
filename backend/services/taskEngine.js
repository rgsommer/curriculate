// backend/services/taskEngine.js
const { TASK_TYPES } = require("../../shared/taskTypes");

// ===== Helpers =====
function normalizeText(s) {
  return (s || "").toString().trim().toLowerCase();
}

function percentCorrect(countCorrect, total) {
  if (!total || total <= 0) return 0;
  return Math.round((countCorrect / total) * 100);
}

// ===== Validation & Scoring =====

// submissionPayload is whatever the client sends in `task:submit`
function validateSubmission(task, submissionPayload) {
  const { type, config } = task;

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE: {
      const { selectedIndex } = submissionPayload;
      if (typeof selectedIndex !== "number") throw new Error("Invalid MC submission");
      if (!Array.isArray(config.options) || selectedIndex < 0 || selectedIndex >= config.options.length) {
        throw new Error("MC selectedIndex out of range");
      }
      break;
    }

    case TASK_TYPES.TRUE_FALSE: {
      if (typeof submissionPayload.answer !== "boolean") {
        throw new Error("Invalid True/False submission");
      }
      break;
    }

    case TASK_TYPES.SHORT_ANSWER: {
      const { answer } = submissionPayload;
      if (typeof answer !== "string") throw new Error("Invalid short answer submission");
      break;
    }

    case TASK_TYPES.SORT: {
      // submission: [{ itemIndex, bucketIndex }]
      if (!Array.isArray(submissionPayload.assignments)) {
        throw new Error("Invalid sort submission");
      }
      submissionPayload.assignments.forEach((a) => {
        if (typeof a.itemIndex !== "number" || typeof a.bucketIndex !== "number") {
          throw new Error("Invalid sort assignment");
        }
      });
      break;
    }

    case TASK_TYPES.SEQUENCE: {
      // submission: [indices in order]
      if (!Array.isArray(submissionPayload.order)) {
        throw new Error("Invalid sequence submission");
      }
      break;
    }

    case TASK_TYPES.PHOTO:
    case TASK_TYPES.MAKE_AND_SNAP: {
      // submission: { imageUrl } (stored previously) OR { base64 } (you then store and replace)
      if (!submissionPayload.imageUrl && !submissionPayload.base64) {
        throw new Error("Invalid photo submission: no image data");
      }
      break;
    }

    case TASK_TYPES.BODY_BREAK: {
      // submission: { done: true, optional: imageUrl }
      if (submissionPayload.done !== true) {
        throw new Error("Invalid body-break submission");
      }
      break;
    }

    default:
      throw new Error("Unknown task type");
  }

  return true;
}

function scoreSubmission(task, submissionPayload, context = {}) {
  // context could include: how many teams already correct, timestamps, etc.
  const baseScore = 10;
  const partialScoreMax = 10;
  const { type, config } = task;

  switch (type) {
    case TASK_TYPES.MULTIPLE_CHOICE: {
      const correctIndex = config.correct;
      const isCorrect = submissionPayload.selectedIndex === correctIndex;
      return { isCorrect, points: isCorrect ? baseScore : 0, detail: {} };
    }

    case TASK_TYPES.TRUE_FALSE: {
      const isCorrect = submissionPayload.answer === config.correct;
      return { isCorrect, points: isCorrect ? baseScore : 0, detail: {} };
    }

    case TASK_TYPES.SHORT_ANSWER: {
      const acceptable = (config.acceptable || []).map(normalizeText);
      const given = normalizeText(submissionPayload.answer);
      const isCorrect = acceptable.includes(given);
      return { isCorrect, points: isCorrect ? baseScore : 0, detail: {} };
    }

    case TASK_TYPES.SORT: {
      const items = config.items || []; // [{ text, correctBucket }]
      const assignments = submissionPayload.assignments || [];
      let correctCount = 0;

      assignments.forEach((a) => {
        const item = items[a.itemIndex];
        if (item && item.correctBucket === a.bucketIndex) correctCount++;
      });

      const pct = percentCorrect(correctCount, items.length);
      const points = Math.round((pct / 100) * partialScoreMax);

      return { isCorrect: pct === 100, points, detail: { correctCount, pct } };
    }

    case TASK_TYPES.SEQUENCE: {
      const correctOrder = config.correctOrder || []; // e.g. [0,2,1]
      const givenOrder = submissionPayload.order || [];
      let correctCount = 0;

      for (let i = 0; i < correctOrder.length; i++) {
        if (givenOrder[i] === correctOrder[i]) correctCount++;
      }

      const pct = percentCorrect(correctCount, correctOrder.length);
      const points = Math.round((pct / 100) * partialScoreMax);

      return { isCorrect: pct === 100, points, detail: { correctCount, pct } };
    }

    case TASK_TYPES.PHOTO:
    case TASK_TYPES.MAKE_AND_SNAP: {
      // For now: participation points only, teacher can override later
      return { isCorrect: null, points: 5, detail: { auto: true } };
    }

    case TASK_TYPES.BODY_BREAK: {
      // Participation only, or photo-based later
      return { isCorrect: null, points: 5, detail: { done: true } };
    }

    default:
      return { isCorrect: null, points: 0, detail: {} };
  }
}

module.exports = {
  validateSubmission,
  scoreSubmission,
};
