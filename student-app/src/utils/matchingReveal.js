// student-app/src/utils/matchingReveal.js

/**
 * Build a matching reveal object from task and review state
 * Returns an object with rows, correctCount, totalPairs, and percent, or null
 */
export function buildMatchingReveal(task, reviewState) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const correctMatches =
    (reviewState && typeof reviewState.correctMatches === "object" && reviewState.correctMatches) ||
    (cfg && typeof cfg.correctMatches === "object" && cfg.correctMatches) ||
    (task && typeof task.correctMatches === "object" && task.correctMatches) ||
    null;

  if (!correctMatches) return null;

  // Student submission map (we saved it in reviewState.studentAnswer on submit)
  const studentRaw = reviewState?.studentAnswer;
  const studentMatches =
    (studentRaw && typeof studentRaw.matches === "object" && studentRaw.matches) ||
    (studentRaw && typeof studentRaw.pairs === "object" && studentRaw.pairs) ||
    (studentRaw && typeof studentRaw.correctMatches === "object" && studentRaw.correctMatches) ||
    null;

  const leftItems = Array.isArray(reviewState?.leftItems)
    ? reviewState.leftItems
    : Array.isArray(cfg?.leftItems)
    ? cfg.leftItems
    : Array.isArray(task?.leftItems)
    ? task.leftItems
    : [];

  const rightItems = Array.isArray(reviewState?.rightItems)
    ? reviewState.rightItems
    : Array.isArray(cfg?.rightItems)
    ? cfg.rightItems
    : Array.isArray(task?.rightItems)
    ? task.rightItems
    : [];

  const leftTextById = {};
  for (const it of leftItems) {
    const id = String(it?.id ?? "");
    const text = String(it?.text ?? it?.label ?? it ?? "").trim();
    if (id && text) leftTextById[id] = text;
  }

  const rightTextById = {};
  for (const it of rightItems) {
    const id = String(it?.id ?? "");
    const text = String(it?.text ?? it?.label ?? it ?? "").trim();
    if (id && text) rightTextById[id] = text;
  }

  let correctCount = 0;
  const entries = Object.entries(correctMatches);

  const rows = entries.map(([l, r]) => {
    const leftId = String(l);
    const rightId = String(r);

    const left = leftTextById[leftId] || leftId;
    const right = rightTextById[rightId] || rightId;

    const studentRight = studentMatches?.[leftId] != null ? String(studentMatches[leftId]) : null;

    const isAnswered = studentRight != null;
    const isCorrect = isAnswered && studentRight === rightId;

    if (isCorrect) correctCount += 1;

    const studentRightText =
      studentRight != null ? (rightTextById[String(studentRight)] || String(studentRight)) : null;

    return {
      leftId,
      rightId,
      left,
      right,
      studentRight,
      studentRightText,
      isAnswered,
      isCorrect,
    };
  });

  const totalPairs = entries.length || 1;
  const percent = Math.round((correctCount / totalPairs) * 100);

  return { rows, correctCount, totalPairs, percent };
}
