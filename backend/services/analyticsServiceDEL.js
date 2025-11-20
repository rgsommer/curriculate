// services/analyticsService.js
const Task = require("../models/Task");
const Student = require("../models/Student");

/**
 * Helper: round to nearest integer
 */
function round0(num) {
  if (!isFinite(num)) return 0;
  return Math.round(num);
}

/**
 * Helper: given a task, what is the "max points" we'd expect
 * for a single submission?
 * You can tweak these numbers to match your scoring engine.
 */
function getTaskMaxPoints(task) {
  const type = task.type;
  switch (type) {
    case "multiple-choice":
    case "true-false":
    case "short-answer":
    case "sort":
    case "sequence":
      return 10; // fully correct
    case "photo":
    case "make-and-snap":
    case "body-break":
      return 5; // participation-style
    default:
      return 10;
  }
}

/**
 * Build a map: teamId -> [studentId, ...]
 */
function buildTeamStudentMap(session) {
  const map = new Map();
  (session.teams || []).forEach((team) => {
    const teamId = team._id?.toString();
    if (!teamId) return;
    const studentIds = (team.studentIds || []).map((id) => id.toString());
    map.set(teamId, studentIds);
  });
  return map;
}

/**
 * Main analytics builder.
 * @param {Object} session - lean Session doc
 * @param {Array<Object>} submissions - array of Submission docs (lean)
 * @returns {Object} { sessionAnalytics, studentAnalyticsList }
 */
async function buildAnalyticsForSession(session, submissions) {
  const sessionId = session._id;

  // ----- Gather task & student info -----

  // 1) Tasks used in this session
  const allTaskIdStrings = [
    ...new Set(submissions.map((s) => s.taskId.toString())),
  ];
  const tasks = await Task.find({ _id: { $in: allTaskIdStrings } }).lean();
  const taskMap = new Map(tasks.map((t) => [t._id.toString(), t]));

  // 2) Students: from session teams + from submissions.studentIds (if any)
  const studentIdSet = new Set();
  (session.teams || []).forEach((team) => {
    (team.studentIds || []).forEach((id) => studentIdSet.add(id.toString()));
  });
  submissions.forEach((s) => {
    (s.studentIds || []).forEach((id) => studentIdSet.add(id.toString()));
  });
  const studentIds = [...studentIdSet];

  const students = await Student.find({ _id: { $in: studentIds } }).lean();
  const studentMap = new Map(students.map((st) => [st._id.toString(), st]));

  // 3) Teams map for summaries
  const teamStudentMap = buildTeamStudentMap(session);
  const teamMap = new Map(
    (session.teams || []).map((t) => [t._id?.toString(), t])
  );

  const numTasksAssigned = allTaskIdStrings.length;

  // ----- Aggregators -----

  // Per-task
  const taskAgg = {}; // taskIdStr -> {...}

  // Per-student
  const studentAgg = {}; // studentIdStr -> {...}

  // Per-team
  const teamAgg = {}; // teamIdStr -> {...}

  // We will compute class averages from studentAgg at the end.

  // ----- Iterate through submissions -----
  submissions.forEach((sub) => {
    const taskIdStr = sub.taskId.toString();
    const task = taskMap.get(taskIdStr);
    if (!task) return;

    const maxPointsForTask = getTaskMaxPoints(task);
    const scoring = sub.scoring || {};
    const points = scoring.points ?? 0;
    const isCorrect = typeof scoring.isCorrect === "boolean" ? scoring.isCorrect : null;
    const latency = sub.latencyMs || 0;

    // Determine which students this submission belongs to.
    // Priority: submission.studentIds; fallback: team -> students
    let submissionStudentIds = [];
    if (sub.studentIds && sub.studentIds.length > 0) {
      submissionStudentIds = sub.studentIds.map((id) => id.toString());
    } else if (sub.teamId) {
      const teamIdStr = sub.teamId.toString();
      const teamStudents = teamStudentMap.get(teamIdStr) || [];
      submissionStudentIds = teamStudents;
    }

    // ---- Per-task aggregation ----
    if (!taskAgg[taskIdStr]) {
      taskAgg[taskIdStr] = {
        taskId: sub.taskId,
        type: task.type,
        prompt: task.prompt,
        pointsTotal: 0,
        pointsMaxTotal: 0,
        correctCount: 0,
        incorrectCount: 0,
        submissionsCount: 0,
        totalLatencyMs: 0,
      };
    }
    const tAgg = taskAgg[taskIdStr];
    tAgg.pointsTotal += points;
    tAgg.pointsMaxTotal += maxPointsForTask;
    tAgg.submissionsCount += 1;
    tAgg.totalLatencyMs += latency;

    if (isCorrect === true) tAgg.correctCount++;
    else if (isCorrect === false) tAgg.incorrectCount++;

    // ---- Per-team aggregation ----
    if (sub.teamId) {
      const teamIdStr = sub.teamId.toString();
      if (!teamAgg[teamIdStr]) {
        const team = teamMap.get(teamIdStr);
        teamAgg[teamIdStr] = {
          teamId: sub.teamId,
          teamName: team?.name || "Team",
          totalPoints: 0,
          correctCount: 0,
          incorrectCount: 0,
          submissionsCount: 0,
          totalLatencyMs: 0,
        };
      }
      const tmAgg = teamAgg[teamIdStr];
      tmAgg.totalPoints += points;
      tmAgg.submissionsCount += 1;
      tmAgg.totalLatencyMs += latency;
      if (isCorrect === true) tmAgg.correctCount++;
      else if (isCorrect === false) tmAgg.incorrectCount++;
    }

    // ---- Per-student aggregation ----
    submissionStudentIds.forEach((sid) => {
      if (!studentAgg[sid]) {
        const st = studentMap.get(sid);
        studentAgg[sid] = {
          studentId: st?._id || sid,
          studentName: st?.name || "Unknown",
          totalPoints: 0,
          maxPoints: 0,
          correctCount: 0,
          incorrectCount: 0,
          submissionsCount: 0,
          totalLatencyMs: 0,
          tasksCompletedSet: new Set(),
          perTaskMap: {}, // taskIdStr -> best submission
        };
      }
      const sAgg = studentAgg[sid];

      sAgg.totalPoints += points;
      sAgg.maxPoints += maxPointsForTask;
      if (isCorrect === true) sAgg.correctCount++;
      else if (isCorrect === false) sAgg.incorrectCount++;
      sAgg.submissionsCount++;
      sAgg.totalLatencyMs += latency;
      sAgg.tasksCompletedSet.add(taskIdStr);

      // Per-task transcript – keep BEST (highest points) submission per task
      const existing = sAgg.perTaskMap[taskIdStr];
      if (!existing || points > existing.points) {
        sAgg.perTaskMap[taskIdStr] = {
          taskId: sub.taskId,
          type: task.type,
          prompt: task.prompt,
          points,
          isCorrect,
          latencyMs: latency,
        };
      }
    });
  });

  // ----- Convert aggregators into final shapes -----

  // 1) Task summaries
  const taskSummaries = Object.values(taskAgg).map((tAgg) => {
    const answerCount = tAgg.correctCount + tAgg.incorrectCount;
    const avgScorePct =
      tAgg.pointsMaxTotal > 0
        ? round0((tAgg.pointsTotal / tAgg.pointsMaxTotal) * 100)
        : 0;
    const avgCorrectPct =
      answerCount > 0 ? round0((tAgg.correctCount / answerCount) * 100) : 0;
    const avgLatencyMs =
      tAgg.submissionsCount > 0
        ? round0(tAgg.totalLatencyMs / tAgg.submissionsCount)
        : 0;

    return {
      taskId: tAgg.taskId,
      type: tAgg.type,
      prompt: tAgg.prompt,
      avgScore: avgScorePct,
      avgCorrectPct,
      submissionsCount: tAgg.submissionsCount,
      avgLatencyMs,
    };
  });

  // 2) Student analytics list (for StudentSessionAnalytics + UI)
  const studentAnalyticsList = Object.values(studentAgg).map((sAgg) => {
    const maxPoints = sAgg.maxPoints || 0;
    const scorePct =
      maxPoints > 0 ? round0((sAgg.totalPoints / maxPoints) * 100) : 0;

    const answerCount = sAgg.correctCount + sAgg.incorrectCount;
    const accuracyPct =
      answerCount > 0 ? round0((sAgg.correctCount / answerCount) * 100) : 0;

    const avgLatencyMs =
      sAgg.submissionsCount > 0
        ? round0(sAgg.totalLatencyMs / sAgg.submissionsCount)
        : 0;

    const tasksCompleted = sAgg.tasksCompletedSet.size;
    const tasksAssigned =
      numTasksAssigned > 0 ? numTasksAssigned : tasksCompleted; // fallback if unknown

    const perTask = Object.values(sAgg.perTaskMap);

    return {
      sessionId,
      studentId: sAgg.studentId,
      studentName: sAgg.studentName, // add to schema if you want persisted
      teacherId: session.teacherId,
      classroomId: session.classroomId?._id || session.classroomId || null,

      totalPoints: sAgg.totalPoints,
      maxPoints,
      accuracyPct,
      tasksCompleted,
      tasksAssigned,
      avgLatencyMs,
      perTask,
    };
  });

  // 3) Class averages (from studentAnalyticsList)
  let totalScorePct = 0;
  let totalAccuracyPct = 0;

  studentAnalyticsList.forEach((sa) => {
    totalScorePct += sa.maxPoints > 0 ? sa.totalPoints / sa.maxPoints : 0;
    totalAccuracyPct += sa.accuracyPct / 100;
  });

  const numStudents = studentAnalyticsList.length || 1;
  const classAverageScore = round0((totalScorePct / numStudents) * 100);
  const classAverageAccuracy = round0((totalAccuracyPct / numStudents) * 100);

  // 4) Team summaries
  const teamSummaries = Object.values(teamAgg).map((tm) => {
    const answerCount = tm.correctCount + tm.incorrectCount;
    const avgLatencyMs =
      tm.submissionsCount > 0
        ? round0(tm.totalLatencyMs / tm.submissionsCount)
        : 0;

    return {
      teamId: tm.teamId,
      teamName: tm.teamName,
      totalPoints: tm.totalPoints,
      correctCount: tm.correctCount,
      incorrectCount: tm.incorrectCount,
      avgLatencyMs,
    };
  });

  // ----- Final sessionAnalytics object -----
  const sessionAnalytics = {
    sessionId,
    teacherId: session.teacherId,
    classroomId: session.classroomId?._id || session.classroomId || null,

    classAverageScore,
    classAverageAccuracy,

    tasks: taskSummaries,
    teams: teamSummaries,
  };

  return { sessionAnalytics, studentAnalyticsList };
}

module.exports = {
  buildAnalyticsForSession,
};
