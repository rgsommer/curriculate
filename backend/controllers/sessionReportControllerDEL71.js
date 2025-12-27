// backend/controllers/sessionReportController.js

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function safeStr(x) {
  return typeof x === "string" ? x.trim() : "";
}

function toDate(x) {
  if (!x) return null;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clamp(n, a, b) {
  const x = Number(n) || 0;
  return Math.max(a, Math.min(b, x));
}

function inferAttachmentType(taskType) {
  const t = String(taskType || "").toLowerCase();
  if (t.includes("photo") || t.includes("snap")) return "photo";
  // Paper-based artifacts that are typically submitted as a photo.
  // (e.g., BrainSparkNotes / MindMapper and similar hand-written tasks)
  if (
    t.includes("mind") ||
    t.includes("mapper") ||
    t.includes("mind-mapper") ||
    t.includes("mind_mapper") ||
    t.includes("brain") ||
    t.includes("spark") ||
    t.includes("notes") ||
    t.includes("graphic") ||
    t.includes("organizer")
  ) {
    return "photo";
  }
  if (t.includes("record") || t.includes("audio") || t.includes("speech")) return "audio";
  if (t.includes("video")) return "video";
  return "file";
}

// Basic engagement heuristic: attempted tasks / total tasks.
function computeEngagement(attemptedTasks, totalTasks) {
  if (!totalTasks || totalTasks <= 0) return 0;
  return clamp(Math.round((attemptedTasks / totalTasks) * 100), 0, 100);
}

// Attempts points possible from attempted task indices (fallback points=10 if unknown)
function computePointsPossible(tasks, attemptedIdxs) {
  const arr = safeArr(tasks);
  let sum = 0;
  for (const idx of attemptedIdxs) {
    const task = arr[idx] || {};
    sum += Number(task.points) || 10;
  }
  return sum;
}

/**
 * Build an immutable, teacher-friendly snapshot.
 * This is what you persist to SessionReport and later render to PDF / show in Reports.
 */
export async function buildSessionReportSnapshot({
  ownerId,
  room,
  roomCode,
  schoolName,
  className,
  gradeLevel,
  assessmentCategories,
  includeIndividualReports,
  planTierUsed,
  summary,
  transcript,
  perParticipant,
  moodCheckins,
  exitFeedback,
  mediaSubmissions,
  generatedAt,
}) {
  if (!ownerId) throw new Error("buildSessionReportSnapshot: missing ownerId");
  if (!room) throw new Error("buildSessionReportSnapshot: missing room");

  const code = String(roomCode || room.code || "").toUpperCase();
  const taskset = room.taskset || transcript?.taskset || {};
  const tasks = safeArr(taskset.tasks);

  const teamsMap = room.teams && typeof room.teams === "object" ? room.teams : {};
  const submissions = safeArr(room.submissions || transcript?.submissions);

  const totalTasks = tasks.length;

  const moods = moodCheckins && typeof moodCheckins === "object" ? moodCheckins : {};
  const feedbacks = exitFeedback && typeof exitFeedback === "object" ? exitFeedback : {};

  // Build teams array
  const teams = Object.entries(teamsMap).map(([teamId, team]) => {
    const teamName = safeStr(team?.teamName || team?.name || `Team-${String(teamId).slice(-4)}`);
    const members = safeArr(team?.members).map(safeStr).filter(Boolean);

    const teamSubs = submissions.filter((s) => String(s?.teamId) === String(teamId));

    const attemptedIdxs = Array.from(
      new Set(
        teamSubs
          .map((s) => s?.taskIndex)
          .filter((n) => Number.isFinite(n) && n >= 0)
      )
    );

    const tasksCompleted = attemptedIdxs.length;
    const teamPoints = teamSubs.reduce((sum, s) => sum + (Number(s?.points) || 0), 0);
    const pointsPossible = computePointsPossible(tasks, attemptedIdxs);

    const scorePercent = pointsPossible > 0 ? clamp(Math.round((teamPoints / pointsPossible) * 100), 0, 100) : 0;
    const engagementScore = computeEngagement(tasksCompleted, totalTasks);

    const mood = moods[String(teamId)] || null;
    const fb = feedbacks[String(teamId)] || null;

    const scoringBreakdown = {
      percent: scorePercent,
      categories: safeArr(assessmentCategories)
        .map((c) => {
          const name = safeStr(c?.name || c);
          if (!name) return null;
          return { name, score: null, max: null };
        })
        .filter(Boolean),
    };

    return {
      teamId: String(teamId),
      teamName,
      members,

      moodEntry: mood
        ? {
            moods: safeArr(mood?.moods).filter((n) => Number.isInteger(n)),
            excitement: safeStr(mood?.excitement || ""),
            submittedAt: toDate(mood?.submittedAt),
          }
        : { moods: [], excitement: "", submittedAt: null },

      tasksCompleted,
      engagementScore,
      scorePercent,

      teamPoints,
      pointsPossible,

      exitFeedback: fb
        ? {
            rating: Number.isFinite(fb?.rating) ? Number(fb.rating) : null,
            highlights: safeStr(fb?.highlights || ""),
            improvements: safeStr(fb?.improvements || ""),
            favoriteTask: safeStr(fb?.favoriteTask || ""),
            submittedAt: toDate(fb?.submittedAt),
          }
        : { rating: null, highlights: "", improvements: "", favoriteTask: "", submittedAt: null },

      scoringBreakdown,
    };
  });

  // Class averages
  const classAverageScore =
    teams.length > 0 ? Math.round(teams.reduce((s, t) => s + (t.scorePercent || 0), 0) / teams.length) : null;

  const classAverageEngagement =
    teams.length > 0 ? Math.round(teams.reduce((s, t) => s + (t.engagementScore || 0), 0) / teams.length) : null;

  // Attachments: from mediaSubmissions + enrich with task info if available
  const attachments = safeArr(mediaSubmissions)
    .map((m) => {
      if (!m?.url) return null;
      const idx = Number.isFinite(m?.taskIndex) ? m.taskIndex : -1;
      const task = tasks[idx] || {};
      const taskTitle = safeStr(task?.title || task?.taskType || (idx >= 0 ? `Task ${idx + 1}` : "Submission"));
      const taskType = safeStr(task?.taskType || "");

      const teamName = safeStr(m?.teamName || "");
      const label = `${taskTitle}${teamName ? ` - ${teamName}` : ""}`;

      return {
        type: inferAttachmentType(taskType),
        url: String(m.url),
        label,
        teamId: String(m?.teamId || ""),
        teamName,
        taskIndex: idx,
        taskTitle,
        taskType,
        submittedAt: toDate(m?.submittedAt),
      };
    })
    .filter(Boolean);

  // Parent note: prefer AI field, otherwise blank (TeacherApp can regenerate later if needed)
  const parentNote =
    safeStr(summary?.parentNote) ||
    safeStr(summary?.parent_note) ||
    safeStr(summary?.noteToParents) ||
    "";

  return {
    ownerId: String(ownerId),
    roomCode: code,

    schoolName: safeStr(schoolName || ""),
    className: safeStr(className || taskset?.className || ""),
    gradeLevel: safeStr(gradeLevel || taskset?.gradeLevel || taskset?.grade || ""),

    taskSetName: safeStr(taskset?.name || taskset?.title || taskset?.taskSetName || ""),
    subject: safeStr(taskset?.subject || ""),

    startedAt: toDate(room?.startedAt || transcript?.startedAt),
    endedAt: new Date(),

    summary: summary && typeof summary === "object" ? summary : {},
    parentNote,

    classAverageScore,
    classAverageEngagement,

    teams,
    attachments,

    // Save per-participant (optional; PDF renderer will gate it)
    perParticipant: perParticipant || null,

    planTierUsed: safeStr(planTierUsed || "FREE") || "FREE",
    includeIndividualReports: !!includeIndividualReports,

    generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
  };
}
