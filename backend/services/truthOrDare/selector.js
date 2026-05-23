// backend/services/truthOrDare/selector.js
//
// Weighted-random player/team selection for a Truth-or-Dare round.
//
// Inputs: the list of candidate teams + per-room session state. Output: a
// single chosen team, plus the candidate ranking we used (the client uses
// it for the slot-machine animation reel).
//
// Weighting follows TRUTH_OR_DARE_PLAN.md §2:
//   - cooldown weight 0 for teams selected in the last 2 rounds
//   - +2x for teams who haven't participated yet this session
//   - +1.3x for teams trailing in score (bottom half)
//   - teacher override always wins
//   - if quiet-class mode is on, +1.5x for teams who haven't reacted lately
//
// All weights are multiplied; final pick uses simple alias-style sampling.

/**
 * @typedef {Object} TeamRef
 * @property {string} teamId
 * @property {string} [playerName]
 * @property {number} [score]
 * @property {number} [roundsSinceParticipated]   // null/undefined = never
 * @property {number} [roundsSinceReacted]        // null/undefined = never
 * @property {boolean} [absent]                   // present=false → weight 0
 */

/**
 * @param {TeamRef[]} teams
 * @param {object} state
 *   - currentRound (number) — round about to start (0-indexed)
 *   - cooldownsBy (Map | object) — teamId → unlockAtRound
 *   - quietMode (bool) — apply silent-classroom bias
 *   - forceTeamId (string|null) — teacher override
 *   - cooldownWindowRounds (number, default 2)
 *   - scoreParityBoost (bool, default true)
 *   - participationBoost (bool, default true)
 * @returns {{ teamId: string, playerName: string, ranking: { teamId: string, weight: number }[] }}
 */
export function selectNextTeam(teams = [], state = {}) {
  const present = teams.filter((t) => t && t.teamId && !t.absent);
  if (!present.length) {
    return { teamId: "", playerName: "", ranking: [] };
  }

  // Teacher override short-circuit
  if (state.forceTeamId) {
    const forced = present.find((t) => t.teamId === state.forceTeamId);
    if (forced) {
      return {
        teamId: forced.teamId,
        playerName: forced.playerName || "",
        ranking: [{ teamId: forced.teamId, weight: 1 }],
      };
    }
  }

  const cooldownWindow = Number(state.cooldownWindowRounds ?? 2);
  const currentRound = Number(state.currentRound ?? 0);
  const cooldowns = _coerceMap(state.cooldownsBy);

  // Compute median score for parity bonus
  const scores = present.map((t) => Number(t.score) || 0);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted[Math.floor(sorted.length / 2)]
    : 0;

  const ranking = present.map((t) => {
    // Cooldown gate (weight 0 inside window)
    const unlock = Number(cooldowns.get(t.teamId) ?? 0);
    if (unlock > currentRound) {
      return { teamId: t.teamId, playerName: t.playerName || "", weight: 0 };
    }

    let w = 1;

    if (state.participationBoost !== false) {
      const rsp = t.roundsSinceParticipated;
      if (rsp == null) w *= 2;            // never participated → 2x
      else if (rsp >= 4) w *= 1.4;        // long absence → 1.4x
    }

    if (state.scoreParityBoost !== false) {
      const s = Number(t.score) || 0;
      if (s <= median) w *= 1.3;
    }

    if (state.quietMode) {
      const rsr = t.roundsSinceReacted;
      if (rsr == null || rsr >= 3) w *= 1.5;
    }

    return { teamId: t.teamId, playerName: t.playerName || "", weight: w };
  });

  // Filter eligible (weight > 0)
  const eligible = ranking.filter((r) => r.weight > 0);

  // If cooldowns wiped everyone out, relax by halving the cooldown window
  const pool = eligible.length
    ? eligible
    : ranking.map((r) => ({ ...r, weight: 1 }));

  const totalW = pool.reduce((acc, r) => acc + r.weight, 0);
  if (totalW <= 0) {
    const fallback = pool[0];
    return {
      teamId: fallback.teamId,
      playerName: fallback.playerName,
      ranking: pool,
    };
  }

  let pick = Math.random() * totalW;
  let chosen = pool[pool.length - 1];
  for (const r of pool) {
    pick -= r.weight;
    if (pick <= 0) { chosen = r; break; }
  }

  return {
    teamId: chosen.teamId,
    playerName: chosen.playerName,
    ranking,
  };
}

/**
 * Build the candidate reel for the slot-machine animation. We shuffle the
 * full team list so it looks "random" during the spin, but the final landing
 * frame matches the actual chosen team.
 *
 * @param {TeamRef[]} teams
 * @param {string} chosenTeamId
 * @param {number} reelLength (default 18)
 */
export function buildSpinReel(teams = [], chosenTeamId = "", reelLength = 18) {
  if (!teams.length) return [];
  const reel = [];
  // Interleave shuffled teams, ending with the chosen one.
  for (let i = 0; i < reelLength - 1; i++) {
    const t = teams[Math.floor(Math.random() * teams.length)];
    reel.push({ teamId: t.teamId, playerName: t.playerName || "" });
  }
  const chosen = teams.find((t) => t.teamId === chosenTeamId) || teams[0];
  reel.push({ teamId: chosen.teamId, playerName: chosen.playerName || "" });
  return reel;
}

/** Mark a team as cooled-down for the next N rounds. */
export function applyCooldown(cooldownsBy, teamId, currentRound, windowRounds = 2) {
  const map = _coerceMap(cooldownsBy);
  map.set(teamId, currentRound + Math.max(1, windowRounds));
  return map;
}

/** Advance the tier for a team after `windowSuccesses` successful rounds. */
export function escalateTier(currentTier, consecutiveSuccesses) {
  if (currentTier === "sprout" && consecutiveSuccesses >= 3) return "stem";
  if (currentTier === "stem"   && consecutiveSuccesses >= 5) return "big";
  return currentTier;
}

/** Demote one tier after a fail/pass. */
export function demoteTier(currentTier) {
  if (currentTier === "big") return "stem";
  if (currentTier === "stem") return "sprout";
  return "sprout";
}

function _coerceMap(m) {
  if (m instanceof Map) return m;
  if (m && typeof m === "object") return new Map(Object.entries(m));
  return new Map();
}
