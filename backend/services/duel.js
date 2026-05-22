// backend/services/duel.js
//
// Cross-feature head-to-head Duel orchestrator. Referenced in 4 of the 7
// new-feature specs (Escape Room §live-events, Whodunnit teacher events,
// What Am I? mode #4, Hole in One mode #6). Single shared mechanism so a
// teacher can trigger a duel inside any session — the duel doesn't care
// what feature is currently active.
//
// Flow:
//   1. Teacher emits `duel:start` (optionally picks teams; otherwise random).
//   2. Service picks 2 distinct teams + 1 player from each team's roster.
//   3. Service picks a duel-eligible question: prefers an objective task from
//      the active taskset (true-false / short-answer / multiple-choice); falls
//      back to a small built-in bank if nothing usable is present.
//   4. Server stores `room.activeDuel = { ... }` and broadcasts:
//        - `duel:dispatched` to the two chosen player sockets (private content)
//        - `duel:announced`  to the whole room (no question text — just "Team A
//          vs Team B, duel starting!")
//   5. Players submit via `duel:submit`. First server-validated correct answer
//      wins. Both submissions are recorded so the loser can see what happened.
//   6. Service emits `duel:result` to the room. Bonus points credit winner;
//      small consolation to loser; teacher sees full result.
//
// Anti-abuse / safety:
//   - Only one duel can be active per room at a time.
//   - Submissions outside the duel window are silently ignored.
//   - Wrong submissions are allowed but burn the duelist's first-chance status.
//   - 30-second hard timeout — if neither answers, the duel ends as a "draw".

const FALLBACK_BANK = [
  { type: "short-answer", prompt: "What planet do we live on?", answers: ["earth"], maxPoints: 10 },
  { type: "short-answer", prompt: "What gas do plants take in to grow?", answers: ["carbon dioxide", "co2"], maxPoints: 10 },
  { type: "short-answer", prompt: "What year did humans first walk on the moon?", answers: ["1969"], maxPoints: 10 },
  { type: "short-answer", prompt: "Capital of Canada?", answers: ["ottawa"], maxPoints: 10 },
  { type: "true-false",   prompt: "Sound travels faster in water than in air.", answers: ["true"], maxPoints: 8 },
  { type: "true-false",   prompt: "The Great Wall of China is visible from space with the naked eye.", answers: ["false"], maxPoints: 8 },
];

const DUEL_TIMEOUT_MS = 30 * 1000;
const COUNTDOWN_MS    = 3 * 1000;        // 3-2-1 lead-in
const WIN_BONUS_PCT   = 1.5;             // winner gets 1.5× the question's max points
const CONSOLATION_PTS = 2;               // loser team gets this even on a loss

function _normalize(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function _isAcceptable(submission, answers) {
  const sub = _normalize(submission);
  if (!sub) return false;
  return (answers || []).some((a) => {
    const norm = _normalize(a);
    if (!norm) return false;
    return sub === norm || sub.includes(norm) || norm.includes(sub);
  });
}

function _shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function _pickPlayerForTeam(team) {
  const members = Array.isArray(team?.members) ? team.members : [];
  const names = members.map((m) => typeof m === "string" ? m : m?.name || m?.playerName).filter(Boolean);
  if (names.length === 0) return null;
  return names[Math.floor(Math.random() * names.length)];
}

function _pickQuestionFromTaskset(room) {
  const tasks = Array.isArray(room?.taskset?.tasks) ? room.taskset.tasks : [];
  // Eligible: true-false / multiple-choice / short-answer with a clear answer key
  const eligible = tasks.filter((t) => {
    if (!t) return false;
    if (t.taskType === "true-false") {
      const items = Array.isArray(t.items) ? t.items : (Array.isArray(t.config?.items) ? t.config.items : []);
      return items.length > 0;
    }
    if (t.taskType === "multiple-choice") {
      const items = Array.isArray(t.items) ? t.items : [];
      return items.length > 0;
    }
    if (t.taskType === "short-answer") {
      const items = Array.isArray(t.items) ? t.items : [];
      return items.length > 0;
    }
    if (t.taskType === "what-am-i") {
      const cfg = t.config || {};
      return cfg.answer && Array.isArray(cfg.acceptableAnswers) && cfg.acceptableAnswers.length > 0;
    }
    return false;
  });
  if (eligible.length === 0) return null;

  const chosen = eligible[Math.floor(Math.random() * eligible.length)];

  if (chosen.taskType === "what-am-i") {
    const cfg = chosen.config || {};
    // For duel use, give the most specific clue as the prompt to keep it fast.
    const clues = Array.isArray(cfg.clues) ? cfg.clues : [];
    const lastClue = clues[clues.length - 1];
    return {
      type: "short-answer",
      prompt: `What Am I? — ${lastClue?.text || chosen.prompt}`,
      answers: cfg.acceptableAnswers,
      maxPoints: 10,
      sourceTaskId: chosen.taskId || null,
    };
  }
  if (chosen.taskType === "true-false") {
    const items = Array.isArray(chosen.items) && chosen.items.length > 0 ? chosen.items : (chosen.config?.items || []);
    const item = items[Math.floor(Math.random() * items.length)];
    const correctIdx = Number(item?.correctAnswer);
    return {
      type: "true-false",
      prompt: String(item?.prompt || item?.question || ""),
      answers: [correctIdx === 1 ? "false" : "true"],   // depends on how options are ordered; default options are ["True","False"]
      maxPoints: 8,
      sourceTaskId: chosen.taskId || null,
    };
  }
  if (chosen.taskType === "multiple-choice") {
    const items = chosen.items || [];
    const item = items[Math.floor(Math.random() * items.length)];
    const correctIdx = Number(item?.correctAnswer);
    const opts = Array.isArray(item?.options) ? item.options : [];
    const correctText = opts[correctIdx] || "";
    return {
      type: "short-answer",       // duel collapses MC to short-answer to keep input shape uniform
      prompt: `${item?.prompt} (answer: ${opts.map((o, i) => String.fromCharCode(65 + i) + ") " + o).join("  ")})`,
      answers: [correctText, String.fromCharCode(65 + correctIdx)],
      maxPoints: 10,
      sourceTaskId: chosen.taskId || null,
    };
  }
  if (chosen.taskType === "short-answer") {
    const items = chosen.items || [];
    const item = items[Math.floor(Math.random() * items.length)];
    return {
      type: "short-answer",
      prompt: String(item?.prompt || item?.question || ""),
      answers: [String(item?.correctAnswer || item?.answer || "")].filter(Boolean),
      maxPoints: 10,
      sourceTaskId: chosen.taskId || null,
    };
  }
  return null;
}

/**
 * Start a duel. Returns { ok, duel, error? }.
 *
 * @param {Object} opts
 * @param {Object} opts.room                   in-memory room
 * @param {string[]} [opts.teamIdsOverride]    optional teacher-picked teams
 */
export function startDuel({ room, teamIdsOverride = null }) {
  if (!room || !room.teams) return { ok: false, error: "Room not ready" };
  if (room.activeDuel && !room.activeDuel.ended) return { ok: false, error: "A duel is already active in this room" };

  const teamIds = Object.keys(room.teams).filter((id) => {
    const t = room.teams[id];
    return t && Array.isArray(t.members) && t.members.length > 0;
  });
  if (teamIds.length < 2) return { ok: false, error: "Need at least 2 teams with players" };

  let chosenTeams;
  if (Array.isArray(teamIdsOverride) && teamIdsOverride.length === 2) {
    chosenTeams = teamIdsOverride.filter((id) => teamIds.includes(id));
    if (chosenTeams.length !== 2) return { ok: false, error: "Override teams not valid" };
  } else {
    chosenTeams = _shuffle(teamIds).slice(0, 2);
  }

  const players = chosenTeams.map((tid) => _pickPlayerForTeam(room.teams[tid]));
  if (players.some((p) => !p)) return { ok: false, error: "Could not pick a player from each team" };

  // Question source: taskset → fallback bank. Validate the picked question has
  // a usable answers array so submissions can actually win.
  let question = _pickQuestionFromTaskset(room);
  const _questionPlayable = (q) => {
    if (!q || typeof q.prompt !== "string" || !q.prompt.trim()) return false;
    if (!Array.isArray(q.answers) || q.answers.length === 0) return false;
    return q.answers.some((a) => typeof a === "string" && a.trim().length > 0);
  };
  if (!_questionPlayable(question)) {
    question = FALLBACK_BANK[Math.floor(Math.random() * FALLBACK_BANK.length)];
  }
  if (!_questionPlayable(question)) {
    // Should never happen — the fallback bank is hardcoded — but defend.
    return { ok: false, error: "No playable duel question available" };
  }

  const duel = {
    id: `duel-${Date.now()}`,
    teamIds: chosenTeams,
    players,                                  // [teamA player, teamB player] — ordered same as teamIds
    teamNames: chosenTeams.map((id) => room.teams[id]?.teamName || `Team-${String(id).slice(-4)}`),
    question,
    startsAt: Date.now() + COUNTDOWN_MS,
    deadlineAt: Date.now() + COUNTDOWN_MS + DUEL_TIMEOUT_MS,
    submissions: [],                          // [{ teamId, playerName, value, correct, ts }]
    winnerTeamId: null,
    ended: false,
    endedAt: null,
  };
  room.activeDuel = duel;
  return { ok: true, duel };
}

/**
 * Submit a duel answer. Server arbitrates correctness + speed.
 * Returns { ok, correct, won, duel } — `won: true` ends the duel.
 */
export function submitDuelAnswer({ room, teamId, playerName, value }) {
  const duel = room?.activeDuel;
  if (!duel || duel.ended) return { ok: false, error: "No active duel" };
  if (Date.now() < duel.startsAt) return { ok: false, error: "Duel hasn't started yet" };
  if (Date.now() > duel.deadlineAt) {
    duel.ended = true;
    duel.endedAt = Date.now();
    return { ok: false, error: "Duel timed out", expired: true };
  }
  if (!duel.teamIds.includes(teamId)) return { ok: false, error: "Your team isn't in this duel" };
  const correct = _isAcceptable(value, duel.question.answers);
  duel.submissions.push({ teamId, playerName, value, correct, ts: Date.now() });

  if (correct) {
    duel.winnerTeamId = teamId;
    duel.ended = true;
    duel.endedAt = Date.now();
    return { ok: true, correct: true, won: true, duel };
  }
  return { ok: true, correct: false, won: false, duel };
}

/**
 * Force-end a duel that timed out (called by the room timer). Returns the duel for emit.
 */
export function endDuelIfTimedOut({ room }) {
  const duel = room?.activeDuel;
  if (!duel || duel.ended) return null;
  if (Date.now() < duel.deadlineAt) return null;
  duel.ended = true;
  duel.endedAt = Date.now();
  return duel;
}

export function getDuelSnapshot(duel) {
  if (!duel) return null;
  return {
    id: duel.id,
    teamIds: duel.teamIds,
    teamNames: duel.teamNames,
    players: duel.players,
    startsAt: duel.startsAt,
    deadlineAt: duel.deadlineAt,
    ended: duel.ended,
    endedAt: duel.endedAt,
    winnerTeamId: duel.winnerTeamId,
    // Note: question is NOT included by default; emitted separately to the duelist sockets.
  };
}

export const DUEL_CONSTANTS = { DUEL_TIMEOUT_MS, COUNTDOWN_MS, WIN_BONUS_PCT, CONSOLATION_PTS };
export default { startDuel, submitDuelAnswer, endDuelIfTimedOut, getDuelSnapshot, DUEL_CONSTANTS };
