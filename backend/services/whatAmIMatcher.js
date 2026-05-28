// backend/services/whatAmIMatcher.js
//
// Server-side answer matching and point computation for the "what-am-i" task type.
//
// Matching strategy (lowest → highest tolerance):
//   1. exact     — normalized strings equal
//   2. substring — submission contains a candidate or vice-versa
//   3. fuzzy     — Levenshtein within a length-scaled tolerance of the shortest candidate
//
// Used by:
//   - validateAiTask (rejects AI-generated tasks whose own answer doesn't match itself)
//   - the future server-authoritative reveal/submit handler (commit #4)
//   - the AI generator's repair loop (re-tests after rewrite)
//
// The client renderer (student-app/src/components/tasks/types/WhatAmITask.jsx) has its
// own inline matcher with identical semantics for the offline / solo path. Keeping the
// two in sync is verified by the round-trip test below.

export function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/**
 * Decide whether `submission` is a match for the canonical answer or any acceptableAnswer.
 *
 * @param {string} submission
 * @param {{ answer?: string, acceptableAnswers?: string[] }} config
 * @returns {{ ok: boolean, strategy: "exact"|"substring"|"fuzzy"|"empty"|"miss", matched?: string }}
 */
export function isAcceptable(submission, config) {
  const sub = normalizeForMatch(submission);
  if (!sub) return { ok: false, strategy: "empty" };

  const canonical = normalizeForMatch(config?.answer);
  const variants = Array.isArray(config?.acceptableAnswers)
    ? config.acceptableAnswers.map(normalizeForMatch)
    : [];
  const candidates = Array.from(new Set([canonical, ...variants].filter(Boolean)));
  if (candidates.length === 0) return { ok: false, strategy: "miss" };

  // 1. Exact
  for (const c of candidates) {
    if (sub === c) return { ok: true, strategy: "exact", matched: c };
  }
  // 2. Substring
  for (const c of candidates) {
    if (!c) continue;
    if (sub.includes(c) || c.includes(sub)) {
      return { ok: true, strategy: "substring", matched: c };
    }
  }
  // 3. Fuzzy on shortest candidate, tolerance scales with length
  const shortest = candidates.reduce((a, b) => (a.length <= b.length ? a : b), candidates[0]);
  if (shortest) {
    const tolerance =
      shortest.length <= 6 ? 1 :
      shortest.length <= 12 ? 2 :
      3;
    if (levenshtein(sub, shortest) <= tolerance) {
      return { ok: true, strategy: "fuzzy", matched: shortest };
    }
  }

  return { ok: false, strategy: "miss" };
}

/**
 * Compute the point award for a successful guess.
 *
 * @param {Object} opts
 * @param {number} opts.cluesRevealed       How many clues were revealed before the correct guess.
 * @param {number} opts.totalClues          Total clues available on the task.
 * @param {Object} [opts.scoring]           config.scoring (perClueCurve, streakMultiplier, etc.)
 * @param {boolean} [opts.isStealer]        true if this team is taking a steal turn (commit #4+)
 * @param {boolean} [opts.isFirst]          true if this is the first correct submission in inter-team mode
 * @param {boolean} [opts.hadStreak]        carrying a session-wide correct-streak bonus
 * @returns {number}                        Points to award (≥ 1 on success).
 */
export function computePoints({ cluesRevealed = 0, totalClues = 0, scoring = {}, isStealer = false, isFirst = false, hadStreak = false } = {}) {
  const curve = Array.isArray(scoring?.perClueCurve) && scoring.perClueCurve.length > 0
    ? scoring.perClueCurve
    : defaultCurve(totalClues);
  // The FIRST clue is free: players need at least one clue to have a fair chance,
  // so the ceiling stays at max for clue 1 and only starts dropping from clue 2.
  // (Otherwise the top score is only reachable by guessing blind with 0 clues —
  // impossible for a real concept — tester: "how could anyone ever get 10?")
  const effective = Math.max(0, cluesRevealed - 1);
  let pts = curve[Math.min(effective, curve.length - 1)] ?? 1;

  if (cluesRevealed === 0 && Number(scoring?.noClueBonus) > 0) {
    pts += Number(scoring.noClueBonus);
  }
  if (isStealer) pts = Math.floor(pts * 0.5);
  if (isFirst && Number(scoring?.firstBonus) > 0) pts += Number(scoring.firstBonus);
  if (hadStreak && Number(scoring?.streakMultiplier) > 1) {
    pts = Math.floor(pts * Number(scoring.streakMultiplier));
  }
  return Math.max(1, pts);
}

function defaultCurve(totalClues) {
  // 10, 8, 6, 4, 2, 1, 1, …
  const base = [10, 8, 6, 4, 2];
  while (base.length < (Number(totalClues) || 0) + 1) {
    base.push(Math.max(1, base[base.length - 1] - 1));
  }
  return base;
}

/**
 * Quick self-check used by the validator: ensure the AI's declared answer
 * actually matches itself (the canonical answer should round-trip through
 * isAcceptable with strategy "exact"). Catches a class of AI bugs where the
 * answer field accidentally contains a sentence rather than a name.
 */
export function selfCheckAnswer(config) {
  const r = isAcceptable(config?.answer, config);
  return r.ok && (r.strategy === "exact" || r.strategy === "substring");
}

export default { isAcceptable, computePoints, normalizeForMatch, selfCheckAnswer };
