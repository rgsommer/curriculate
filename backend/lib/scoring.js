// backend/lib/scoring.js
// Pure scoring utilities to compute points to add per team for a given task

const DEFAULTS = {
  BASE_POINTS: 10,
  SPEED_BONUSES: [5, 3, 2],
};

/**
 * Compute scores to add per team for a given session and its submissions.
 * Does not mutate inputs.
 *
 * @param {Object} session - session object (expects .teams array with _id and score)
 * @param {Array} submissions - array of submissions with { teamId, isCorrect, responseTimeMs }
 * @param {Object} opts - optional overrides: BASE_POINTS, SPEED_BONUSES
 * @returns {Object} { scoresToAdd: { [teamId]: number } }
 */
export function computeScores(session, submissions, opts = {}) {
  const BASE_POINTS = opts.BASE_POINTS ?? DEFAULTS.BASE_POINTS;
  const SPEED_BONUSES = opts.SPEED_BONUSES ?? DEFAULTS.SPEED_BONUSES;

  const scoresToAdd = new Map();

  const correctSubs = (submissions || [])
    .filter((s) => s && s.isCorrect)
    .slice()
    .sort((a, b) => (a.responseTimeMs || 0) - (b.responseTimeMs || 0));

  for (const s of submissions || []) {
    if (!s || !s.teamId) continue;
    if (!s.isCorrect) {
      scoresToAdd.set(s.teamId.toString(), 0);
    } else {
      scoresToAdd.set(s.teamId.toString(), BASE_POINTS);
    }
  }

  correctSubs.forEach((s, index) => {
    const bonus = SPEED_BONUSES[index] || 0;
    const key = s.teamId.toString();
    scoresToAdd.set(key, (scoresToAdd.get(key) || 0) + bonus);
  });

  // Ensure all teams in session are represented (even if zero)
  (session && session.teams ? session.teams : []).forEach((team) => {
    const key = team._id.toString();
    if (!scoresToAdd.has(key)) scoresToAdd.set(key, 0);
  });

  // Convert to plain object
  const obj = {};
  for (const [k, v] of scoresToAdd.entries()) obj[k] = v;

  return { scoresToAdd: obj };
}

export default { computeScores };
