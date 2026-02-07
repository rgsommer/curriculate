// backend/services/gameFlow.js
// Helpers for auto-advancing tasksets and building end-of-session analytics.

export function allTeamsSubmitted(room) {
  if (!room || !room.currentTask) return false;
  const teamIds = Object.values(room.teams || {}).map((t) => t.teamId);
  if (!teamIds.length) return false;

  const submittedTeams = new Set(
    (room.currentTask.submissions || []).map((s) => s.teamId)
  );

  return teamIds.every((id) => submittedTeams.has(id));
}

/**
 * Build per-player result summary.
 *  - Grade uses correctness + engagement + speed
 */
export function buildFinalResults(room) {
  const submissions = room.submissions || [];
  const perPlayer = {};

  for (const s of submissions) {
    const key = s.playerId || `${s.teamId}-anon`;
    if (!perPlayer[key]) {
      perPlayer[key] = {
        playerId: key,
        teamId: s.teamId,
        attempts: 0,
        correct: 0,
        totalTimeMs: 0,
      };
    }

    const p = perPlayer[key];
    p.attempts += 1;
    if (s.correct) p.correct += 1;
    if (typeof s.timeMs === "number") p.totalTimeMs += s.timeMs;
  }

  const totalTasks = room.taskset?.tasks?.length || 0;

  const players = Object.values(perPlayer).map((p) => {
    const accuracy = p.attempts ? p.correct / p.attempts : 0;
    const engagement =
      totalTasks > 0 ? Math.min(p.attempts / totalTasks, 1) : 0;
    const avgTime = p.correct > 0 ? p.totalTimeMs / p.correct : null;

    let speedScore = 0;
    if (avgTime != null) {
      if (avgTime <= 30000) speedScore = 1.0;
      else if (avgTime <= 60000) speedScore = 0.7;
      else speedScore = 0.4;
    }

    const grade =
      Math.round(
        (accuracy * 0.6 + engagement * 0.25 + speedScore * 0.15) * 100
      ) || 0;

    return {
      ...p,
      accuracy,
      engagement,
      avgTimeMs: avgTime,
      grade,
    };
  });

  return { players, totalTasks };
}

/**
 * Advance to next task in the current taskset and broadcast it.
 * This assumes room.taskset.tasks holds the plan.
 */
export function advanceToNextTask(io, room) {
  if (!room || !io) return;
  const code = room.code;
  const tasks = room.taskset?.tasks || [];
  if (!code || !tasks.length) return;

  if (typeof room.currentTaskIndex !== "number") {
    room.currentTaskIndex = -1;
  }

  room.currentTaskIndex += 1;

  // End of taskset → send final analysis
  if (room.currentTaskIndex >= tasks.length) {
    const results = buildFinalResults(room);
    io.to(code).emit("tasksetComplete", {
      roomCode: code,
      results,
    });
    return;
  }

  const nextTaskDef = tasks[room.currentTaskIndex];

  const {
    prompt,
    correctAnswer,
    options,
    taskType,
    points,
  } = nextTaskDef || {};

  room.currentTask = {
    prompt: (prompt || "").trim(),
    correctAnswer: (correctAnswer || "").trim() || null,
    options: options || [],
    taskType: taskType || nextTaskDef.type || "short-answer",
    points: points || 10,
    at: Date.now(),
    submissions: [],
  };

  io.to(code).emit("taskUpdate", room.currentTask);
  io.to(code).emit("roundStarted", room.currentTask);
}

export default {
  allTeamsSubmitted,
  advanceToNextTask,
  buildFinalResults,
};
