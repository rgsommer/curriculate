// backend/score/scoreEvents.js
// Normalizes every task submission into a consistent "score event" that can be aggregated into
// a single Session Score and TeacherProfile category rollups.
//
// Design goals:
// - Works for objective tasks, AI-scored tasks, peer-rated tasks (NarrationSynthesize), and participation tasks.
// - Backward compatible: accepts many payload shapes.
// - Non-breaking: if data is missing, returns a safe "completed-only" event.

import { TASK_TYPE_META } from "../../shared/taskTypes.js";

export function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function num(n, fallback = null) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function pickCategoryWeights(taskType) {
  const meta = TASK_TYPE_META?.[taskType] || {};
  const cw = meta.categoryWeights && typeof meta.categoryWeights === "object" ? meta.categoryWeights : null;
  return cw || {};
}

function normalizePeerRating({ ratings, min = 1, max = 5 }) {
  const arr = Array.isArray(ratings) ? ratings : [];
  const values = arr
    .map((r) => (typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating)))
    .filter((n) => Number.isFinite(n));
  if (!values.length) return null;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const denom = Number(max) - Number(min);
  if (!Number.isFinite(denom) || denom <= 0) return null;

  return {
    avg,
    count: values.length,
    normalized: clamp01((avg - Number(min)) / denom),
  };
}

function inferObjectiveFromSubmission(submission) {
  const cc = num(submission?.correctCount, null);
  const tc = num(submission?.totalCount, null);
  if (cc != null && tc != null && tc > 0) return { correctCount: cc, totalCount: tc, normalized: clamp01(cc / tc) };

  const score = num(submission?.score, null);
  const maxScore = num(submission?.maxScore ?? submission?.pointsPossible, null);
  if (score != null && maxScore != null && maxScore > 0) return { normalized: clamp01(score / maxScore), score, maxScore };

  if (typeof submission?.isCorrect === "boolean") return { normalized: submission.isCorrect ? 1 : 0, correctCount: submission.isCorrect ? 1 : 0, totalCount: 1 };

  const list =
    (Array.isArray(submission?.items) && submission.items) ||
    (Array.isArray(submission?.results) && submission.results) ||
    (Array.isArray(submission?.questions) && submission.questions) ||
    null;

  if (list && list.length) {
    const bools = list.map((x) => x?.isCorrect).filter((v) => typeof v === "boolean");
    if (bools.length) {
      const c = bools.filter(Boolean).length;
      return { correctCount: c, totalCount: bools.length, normalized: clamp01(c / bools.length) };
    }
  }

  return null;
}

function inferAiScoreNormalized(submission) {
  const ai = submission?.aiScore || submission?.ai || null;
  const score10 = num(ai?.score, null);
  if (score10 != null) return clamp01(score10 / 10);

  const percent = num(ai?.percent, null);
  if (percent != null) return clamp01(percent / 100);

  const rs = num(submission?.rubricScore, null);
  const rm = num(submission?.rubricMax, null);
  if (rs != null && rm != null && rm > 0) return clamp01(rs / rm);

  return null;
}

function defaultPointsPossible() {
  return 100;
}

export function computeScoreEvent({
  task,
  taskType,
  teamId,
  taskId,
  submission,
  teacherCategories = null,
  taskWeight = 1,
}) {
  const type = taskType || task?.taskType || task?.type || "";
  const meta = TASK_TYPE_META?.[type] || {};
  const weight = Number.isFinite(Number(taskWeight)) && Number(taskWeight) > 0 ? Number(taskWeight) : 1;

  const completed = submission?.completed != null ? !!submission.completed : true;
  const timeSeconds = num(submission?.timeSeconds ?? submission?.durationSeconds ?? submission?.elapsedSeconds, null);

  let normalized = null;
  let pointsEarned = null;
  let pointsPossible = null;

  // Objective
  const objective = inferObjectiveFromSubmission(submission);
  if (objective && objective.normalized != null) {
    normalized = objective.normalized;
    pointsPossible = defaultPointsPossible(meta);
    pointsEarned = Math.round(pointsPossible * normalized);
  }

  // Peer-rated (NarrationSynthesize)
  if (normalized == null) {
    const scale =
      submission?.ratingScale ||
      submission?.data?.ratingScale ||
      submission?.answerPayload?.ratingScale ||
      task?.config?.ratingScale ||
      null;

    const min = num(scale?.min, 1);
    const max = num(scale?.max, 5);
    const ratings =
      submission?.ratings ||
      submission?.data?.ratings ||
      submission?.data?.peerRatings ||
      submission?.answerPayload?.ratings ||
      null;

    const peer = normalizePeerRating({ ratings, min, max });
    if (peer && peer.normalized != null) {
      normalized = peer.normalized;
      pointsPossible = defaultPointsPossible(meta);
      pointsEarned = Math.round(pointsPossible * normalized);
    }
  }

  // AI scored
  if (normalized == null) {
    const aiNorm = inferAiScoreNormalized(submission);
    if (aiNorm != null) {
      normalized = clamp01(aiNorm);
      pointsPossible = defaultPointsPossible(meta);
      pointsEarned = Math.round(pointsPossible * normalized);
    }
  }

  // Participation fallback
  if (normalized == null) {
    normalized = completed ? 1 : 0;
    pointsPossible = defaultPointsPossible(meta);
    pointsEarned = Math.round(pointsPossible * normalized);
  }

  // Category rollups
  const baseCategoryWeights = pickCategoryWeights(type);
  const categories = Array.isArray(teacherCategories) ? teacherCategories : null;

  const categoryContrib = {};
  const keys = categories
    ? categories.map((c) => String(c.key || c.id || c.label || "")).filter(Boolean)
    : Object.keys(baseCategoryWeights);

  keys.forEach((k) => {
    const w = num(baseCategoryWeights?.[k], null);
    if (w == null) return;
    categoryContrib[k] = clamp01(normalized);
  });

  return {
    taskId: taskId || task?._id || task?.id || null,
    taskType: type,
    teamId: teamId || null,
    pointsEarned,
    pointsPossible,
    normalized,
    weight,
    evidence: {
      completed,
      timeSeconds,
      correctCount: num(submission?.correctCount, null),
      totalCount: num(submission?.totalCount, null),
      ratings:
        submission?.ratings ||
        submission?.data?.ratings ||
        submission?.data?.peerRatings ||
        submission?.answerPayload?.ratings ||
        null,
      ratingScale:
        submission?.ratingScale ||
        submission?.data?.ratingScale ||
        submission?.answerPayload?.ratingScale ||
        task?.config?.ratingScale ||
        null,
      aiScore: submission?.aiScore || null,
    },
    categoryContrib,
  };
}

export function computeSessionRollups(scoreEvents, teacherCategories = null, sessionPointsMax = 1000) {
  const events = Array.isArray(scoreEvents) ? scoreEvents : [];
  const totalWeight = events.reduce((sum, e) => sum + (Number(e?.weight) > 0 ? Number(e.weight) : 0), 0);

  const sessionScoreNormalized =
    totalWeight > 0
      ? events.reduce((sum, e) => sum + (Number(e?.normalized) * Number(e?.weight || 0)), 0) / totalWeight
      : 0;

  const sessionScorePoints = Math.round(clamp01(sessionScoreNormalized) * Number(sessionPointsMax || 1000));

  const categories = Array.isArray(teacherCategories) ? teacherCategories : null;
  const catKeys = categories
    ? categories.map((c) => String(c.key || c.id || c.label || "")).filter(Boolean)
    : Array.from(
        new Set(
          events.flatMap((e) =>
            e?.categoryContrib && typeof e.categoryContrib === "object" ? Object.keys(e.categoryContrib) : []
          )
        )
      );

  const categoryScores = {};
  catKeys.forEach((k) => {
    const denom = events.reduce((sum, e) => {
      const has = e?.categoryContrib && Object.prototype.hasOwnProperty.call(e.categoryContrib, k);
      if (!has) return sum;
      const w = Number(e?.weight) > 0 ? Number(e.weight) : 0;
      return sum + w;
    }, 0);

    if (denom <= 0) return;

    const nume = events.reduce((sum, e) => {
      const has = e?.categoryContrib && Object.prototype.hasOwnProperty.call(e.categoryContrib, k);
      if (!has) return sum;
      const w = Number(e?.weight) > 0 ? Number(e.weight) : 0;
      return sum + clamp01(e.normalized) * w;
    }, 0);

    categoryScores[k] = clamp01(nume / denom);
  });

  return {
    sessionScoreNormalized: clamp01(sessionScoreNormalized),
    sessionScorePoints,
    sessionPointsMax: Number(sessionPointsMax || 1000),
    categoryScores,
  };
}
