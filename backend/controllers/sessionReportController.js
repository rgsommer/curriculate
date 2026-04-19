// backend/controllers/sessionReportController.js
import { generateNarrativeFromInsights } from "../ai/aiScoring.js";

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function safeStr(x) {
  return typeof x === "string" ? x.trim() : "";
}

function planAllowsStudentDetail(planTierUsed) {
  const t = safeStr(planTierUsed || "").toUpperCase();
  if (!t) return false;
  if (["FREE", "BASIC", "TRIAL", "DEMO", "NONE"].includes(t)) return false;
  if (t.includes("NO_STUDENT") || t.includes("TEACHER_ONLY")) return false;
  return (
    t.startsWith("PLUS") ||
    t.startsWith("PRO") ||
    t.startsWith("SCHOOL") ||
    t.startsWith("DISTRICT") ||
    t.startsWith("ENTERPRISE") ||
    t.startsWith("PREMIUM")
  );
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

function pct(n, d) {
  if (!d || d <= 0) return null;
  return clamp(Math.round((n / d) * 100), 0, 100);
}

function normType(t) {
  return safeStr(String(t || "")).toLowerCase().replace(/_/g, "-");
}

function inferAttachmentType(taskType) {
  const t = String(taskType || "").toLowerCase();
  if (t.includes("photo") || t.includes("snap")) return "photo";
  // Paper-based artifacts that are typically submitted as a photo.
  // (e.g., BrainSparkNotes / MindMapper and similar hand-written tasks,
  //  or art-view / historical-doc paper mode submissions)
  if (
    t.includes("mind") ||
    t.includes("mapper") ||
    t.includes("mind-mapper") ||
    t.includes("mind_mapper") ||
    t.includes("brain") ||
    t.includes("spark") ||
    t.includes("notes") ||
    t.includes("graphic") ||
    t.includes("organizer") ||
    t.includes("art-view") ||
    t.includes("art_view") ||
    t.includes("historical-doc") ||
    t.includes("historical_doc")
  ) {
    return "photo";
  }
  if (t.includes("record") || t.includes("audio") || t.includes("speech")) return "audio";
  if (t.includes("video")) return "video";
  return "file";
}


function normalizeReadingCompComparison(raw) {
  const s = safeStr(raw).toLowerCase();
  if (!s) return "unknown";
  if (s.startsWith("below")) return "below";
  if (s.startsWith("above")) return "above";
  if (s.startsWith("at")) return "at";
  if (["below", "at", "above", "unknown"].includes(s)) return s;
  return "unknown";
}

function extractReadingCompFromPerTask(perTask) {
  const pt = safeArr(perTask);
  const hits = [];
  for (const item of pt) {
    const type = safeStr(item?.type || item?.taskType || item?.task_type);
    const norm = type.toLowerCase().replace(/_/g, "-");
    if (norm !== "reading-comp" && norm !== "readingcomp" && norm !== "reading-comprehension") continue;

    const details = (item?.details && typeof item.details === "object" ? item.details : {}) ||
      (item?.ai && typeof item.ai === "object" ? item.ai : {});
    const rc = (details.readingComp && typeof details.readingComp === "object" ? details.readingComp : details) || {};
    const comparison = normalizeReadingCompComparison(
      rc.comparison ?? rc.gradeComparison ?? rc.levelComparison ?? rc.band ?? item?.readingCompLevel
    );

    const score =
      Number.isFinite(Number(item?.scorePercent)) ? Number(item.scorePercent) :
      Number.isFinite(Number(item?.score)) ? Number(item.score) :
      Number.isFinite(Number(item?.pointsAwarded)) ? Number(item.pointsAwarded) :
      null;

    const feedback = safeStr(rc.feedback || rc.comment || item?.aiFeedback || item?.feedback || "");

    hits.push({ comparison, score, feedback });
  }

  if (!hits.length) return null;

  // Majority vote for comparison; tie-breaker by highest avg score
  const counts = { below: 0, at: 0, above: 0, unknown: 0 };
  for (const h of hits) counts[h.comparison] = (counts[h.comparison] || 0) + 1;

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
  const avgScore =
    hits.map((h) => (Number.isFinite(h.score) ? h.score : null)).filter((x) => x != null).reduce((a,b)=>a+b,0) /
    Math.max(1, hits.map((h)=>Number.isFinite(h.score)).filter(Boolean).length);

  return {
    attempts: hits.length,
    comparisonCounts: counts,
    dominantComparison: top,
    avgScore: Number.isFinite(avgScore) ? Math.round(avgScore) : null,
    sampleFeedback: hits.find((h) => h.feedback)?.feedback || "",
  };
}

function normalizeNoiseSamples(raw) {
  const arr = safeArr(raw);
  const out = [];
  for (const s of arr) {
    if (typeof s === "number" && Number.isFinite(s)) {
      out.push({ t: null, level: s });
      continue;
    }
    if (s && typeof s === "object") {
      const level = Number(s.level ?? s.noise ?? s.value ?? s.lvl);
      if (!Number.isFinite(level)) continue;
      const tRaw = s.t ?? s.ts ?? s.time ?? s.at ?? s.timestamp;
      const t = Number.isFinite(Number(tRaw)) ? Number(tRaw) : tRaw ? new Date(tRaw).getTime() : null;
      out.push({ t: Number.isFinite(t) ? t : null, level });
    }
  }
  return out.slice(0, 20000);
}

function computeNoiseSummary({ room, transcript, noiseSamples, noiseConfig }) {
  const cfg = noiseConfig && typeof noiseConfig === "object" ? noiseConfig : null;

  // Candidates (best-effort)
  const samples =
    normalizeNoiseSamples(noiseSamples) ||
    normalizeNoiseSamples(room?.noiseHistory) ||
    normalizeNoiseSamples(room?.noiseSamples) ||
    normalizeNoiseSamples(transcript?.noiseHistory) ||
    normalizeNoiseSamples(transcript?.noiseSamples) ||
    [];

  const enabled =
    typeof cfg?.enabled === "boolean"
      ? cfg.enabled
      : typeof room?.noise?.enabled === "boolean"
      ? room.noise.enabled
      : typeof room?.noiseConfig?.enabled === "boolean"
      ? room.noiseConfig.enabled
      : false;

  const threshold =
    Number.isFinite(Number(cfg?.threshold))
      ? Number(cfg.threshold)
      : Number.isFinite(Number(room?.noise?.threshold))
      ? Number(room.noise.threshold)
      : Number.isFinite(Number(room?.noiseConfig?.threshold))
      ? Number(room.noiseConfig.threshold)
      : 0;

  const brightness =
    Number.isFinite(Number(cfg?.brightness))
      ? Number(cfg.brightness)
      : Number.isFinite(Number(room?.noise?.brightness))
      ? Number(room.noise.brightness)
      : Number.isFinite(Number(room?.noiseConfig?.brightness))
      ? Number(room.noiseConfig.brightness)
      : 1;

  if (!samples.length && !enabled && !threshold) return null;

  const levels = samples.map((s) => Number(s.level)).filter((n) => Number.isFinite(n));
  const samplesCount = levels.length;

  let avgLevel = null;
  let peakLevel = null;
  let pctOverThreshold = null;
  let durationSeconds = null;

  if (samplesCount) {
    const sum = levels.reduce((a, b) => a + b, 0);
    avgLevel = Math.round((sum / samplesCount) * 10) / 10;
    peakLevel = Math.round(Math.max(...levels) * 10) / 10;

    if (threshold > 0) {
      const over = levels.filter((n) => n >= threshold).length;
      pctOverThreshold = Math.round((over / samplesCount) * 1000) / 10; // 0.1%
    }

    const ts = samples.map((s) => s.t).filter((n) => Number.isFinite(n));
    if (ts.length >= 2) {
      const minT = Math.min(...ts);
      const maxT = Math.max(...ts);
      durationSeconds = Math.max(0, Math.round((maxT - minT) / 1000));
    }
  }

  const source =
    noiseSamples
      ? "noiseSamples:param"
      : room?.noiseHistory
      ? "room.noiseHistory"
      : room?.noiseSamples
      ? "room.noiseSamples"
      : transcript?.noiseHistory
      ? "transcript.noiseHistory"
      : transcript?.noiseSamples
      ? "transcript.noiseSamples"
      : "";

  return {
    enabled: !!enabled,
    threshold: Number.isFinite(Number(threshold)) ? Number(threshold) : 0,
    brightness: Number.isFinite(Number(brightness)) ? Number(brightness) : 1,
    samplesCount,
    avgLevel,
    peakLevel,
    pctOverThreshold,
    durationSeconds,
    source,
  };
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
    // Must match the 10× multiplier used in scoring: basePoints = (task.points ?? 100) * 10
    const rawPts = Number(task.points) || 100;
    sum += rawPts * 10;
  }
  return sum;
}

function deriveParticipantInsights({ participant, sessionMeta }) {
  const perTask = safeArr(participant?.perTask || participant?.tasks || participant?.attempts);
  const tasksAssigned = Number(participant?.tasksAssigned ?? participant?.tasks_total ?? perTask.length ?? 0) || 0;
  const tasksCompleted = Number(participant?.tasksCompleted ?? participant?.tasks_completed ?? perTask.length ?? 0) || 0;

  const totalPoints = Number(participant?.totalPoints ?? participant?.points ?? 0) || 0;
  const maxPoints = Number(participant?.maxPoints ?? participant?.pointsPossible ?? 0) || 0;

  const completionPercent = pct(tasksCompleted, tasksAssigned) ?? 0;
  const participationLevel =
    completionPercent >= 90 ? "high" : completionPercent >= 65 ? "medium" : "developing";

  const earnedReflectionBonus = perTask.some((t) => {
    const br = String(t?.bonusReason ?? t?.aiScore?.bonusReason ?? "").toLowerCase();
    const bp = Number(t?.bonusPoints ?? t?.aiScore?.bonusPoints ?? 0);
    const learned = safeStr(t?.learned ?? t?.answerPayload?.learned ?? "");
    return br === "learned" || bp > 0 || learned.length > 0;
  });

  const strengths = [];
  if (earnedReflectionBonus) {
    strengths.push({
      id: "metacognition_reflection",
      label: "Reflection",
      confidence: 0.7,
      evidenceCount: 1,
      why: "Shared what was learned.",
    });
  }

  const insight = {
    schemaVersion: "1.0",
    studentId: safeStr(participant?.studentId || participant?._id || ""),
    studentName: safeStr(participant?.studentName || participant?.name || ""),
    teamId: safeStr(participant?.teamId || "") || null,
    teamName: safeStr(participant?.teamName || "") || null,
    session: {
      sessionId: safeStr(sessionMeta?.sessionId || ""),
      classroomName: safeStr(sessionMeta?.className || sessionMeta?.classroomName || ""),
      taskSetName: safeStr(sessionMeta?.taskSetName || ""),
      startedAt: sessionMeta?.startedAt || null,
      endedAt: sessionMeta?.endedAt || null,
      subject: safeStr(sessionMeta?.subject || ""),
      gradeBand: safeStr(sessionMeta?.gradeLevel || ""),
      audience: safeStr(sessionMeta?.audience || "teacher"),
      tone: safeStr(sessionMeta?.tone || "encouraging"),
    },
    overall: {
      points: { earned: totalPoints, max: maxPoints, percent: maxPoints ? pct(totalPoints, maxPoints) : null },
      participation: { tasksCompleted, tasksAssigned, completionPercent, participationLevel },
    },
    skills: {
      strengths: strengths.slice(0, 3),
      developing: [],
      collaboration: { label: "Teamwork & collaboration", rating: 3, max: 5, signals: [] },
    },
    highlights: earnedReflectionBonus
      ? [{ type: "bonus", taskIndex: null, taskType: "multi-player-feedback", headline: "Earned 🎁 reflection bonus", detail: "Shared a learning takeaway.", impact: "" }]
      : [],
    growth: { primaryGoal: null, secondaryGoals: [] },
    misconceptions: [],
    taskTypePerformance: {},
    evidence: perTask.slice(0, 40).map((t) => ({
      taskIndex: Number.isFinite(Number(t?.taskIndex)) ? Number(t.taskIndex) : null,
      taskType: normType(t?.type ?? t?.taskType),
      title: safeStr(t?.title || t?.taskTitle || ""),
      pointsEarned: Number(t?.pointsEarned ?? t?.points ?? 0) || 0,
      maxPoints: Number(t?.maxPoints ?? 0) || 0,
      isCorrect: typeof t?.isCorrect === "boolean" ? t.isCorrect : null,
      latencyMs: Number.isFinite(Number(t?.latencyMs)) ? Number(t.latencyMs) : null,
      tags: [],
    })),
    awards: {
      bonuses: earnedReflectionBonus ? [{ id: "learned_bonus", label: "🎁 +1 Learned", taskIndex: null, points: 1, evidence: "Shared what was learned." }] : [],
      badges: [],
    },
    narrative: {
      status: "not_generated",
      audience: safeStr(sessionMeta?.audience || "teacher"),
      readingLevelHint: "auto",
      language: "en",
      bullets: { didWell: [], tryNext: [] },
      paragraphs: { summary: "", teacherNote: "" },
      safety: { noComparisons: true, noSensitiveClaims: true },
    },
  };

  return insight;
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

  // NEW (optional): noise sampling / config (class-level)
  noiseSamples,
  noiseConfig,

  // NEW (optional): narrative generation options
  narrativeOptions,
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
            learned: safeStr(fb?.learned || ""),
            submittedAt: toDate(fb?.submittedAt),
          }
        : { rating: null, highlights: "", improvements: "", favoriteTask: "", learned: "", submittedAt: null },

      scoringBreakdown,
    };
  });

  // Class averages
  const classAverageScore =
    teams.length > 0 ? Math.round(teams.reduce((s, t) => s + (t.scorePercent || 0), 0) / teams.length) : null;

  const classAverageEngagement =
    teams.length > 0 ? Math.round(teams.reduce((s, t) => s + (t.engagementScore || 0), 0) / teams.length) : null;


  // Noise summary (class-level; best-effort)
  const noiseSummary = computeNoiseSummary({ room, transcript, noiseSamples, noiseConfig });

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
        type: m?.isPaperPhoto ? "photo" : inferAttachmentType(taskType),
        url: String(m.url),
        label: m?.isPaperPhoto ? `${taskTitle} - ${teamName} (${m.playerName || "paper"})` : label,
        teamId: String(m?.teamId || ""),
        teamName,
        taskIndex: idx,
        taskTitle,
        taskType,
        isPaperPhoto: !!m?.isPaperPhoto,
        playerName: m?.playerName || "",
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

  // Enrich perParticipant with studentInsights (and optional narrative) for PDF / Reports
  let enrichedPerParticipant = perParticipant || null;
  if (includeIndividualReports && Array.isArray(perParticipant)) {
    const sessionMeta = {
      sessionId: safeStr(room?._id || transcript?._id || ""),
      className: safeStr(className || taskset?.className || ""),
      classroomName: safeStr(className || taskset?.className || ""),
      taskSetName: safeStr(taskset?.name || taskset?.title || taskset?.taskSetName || ""),
      subject: safeStr(taskset?.subject || ""),
      gradeLevel: safeStr(gradeLevel || taskset?.gradeLevel || taskset?.grade || ""),
      startedAt: toDate(room?.startedAt || transcript?.startedAt),
      endedAt: new Date(),
      audience: safeStr(narrativeOptions?.audience || "parent"),
      tone: safeStr(narrativeOptions?.tone || "encouraging"),
    };

    enrichedPerParticipant = [];
    for (const p of perParticipant) {
      const existing = p?.studentInsights;
      const insight = existing && typeof existing === "object" ? existing : deriveParticipantInsights({ participant: p, sessionMeta });

      const wantNarr = !!narrativeOptions?.generateNarrative;
      if (wantNarr) {
        try {
          const narrative = await generateNarrativeFromInsights(insight, narrativeOptions);
          insight.narrative = { ...insight.narrative, ...narrative, status: narrative?.paragraphs?.summary ? "generated" : insight.narrative.status };
        } catch (e) {
          // Snapshot must still be saved even if narrative fails
          console.warn("Report narrative generation failed:", e?.message || e);
        }
      }

      const rc = extractReadingCompFromPerTask(p?.perTask || p?.tasks || p?.attempts);
      const readingCompLevel = rc ? rc.dominantComparison : "unknown";
      const readingComp = rc ? { ...rc, gradeLevel: safeStr(gradeLevel || ""), readingCompLevel } : null;

      enrichedPerParticipant.push({
        ...p,
        readingComp,
        readingCompLevel,
        studentInsights: {
          ...insight,
          readingComp: readingComp || insight.readingComp || null,
        },
      });
    }
  }

const canIncludeStudentDetail = !!includeIndividualReports && planAllowsStudentDetail(planTierUsed);

  // Reading Comp summary (optional; only if that task type ran and gradeLevel looks like a grade group)
  const rcTotals = { below: 0, at: 0, above: 0, unknown: 0 };
  const rcByTeam = {};
  const rcByStudent = [];
  const gradeNum = (() => {
    const n = parseInt(String(gradeLevel || "").replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) && n > 0 && n <= 12 ? n : null;
  })();

  for (const p of enrichedPerParticipant) {
    const lvl = normalizeReadingCompComparison(p?.readingCompLevel || p?.readingComp?.dominantComparison);
    rcTotals[lvl] = (rcTotals[lvl] || 0) + 1;

    const teamName = safeStr(p?.teamName || "");
    if (teamName) {
      rcByTeam[teamName] = rcByTeam[teamName] || { below: 0, at: 0, above: 0, unknown: 0 };
      rcByTeam[teamName][lvl] = (rcByTeam[teamName][lvl] || 0) + 1;
    }

    rcByStudent.push({
      name: safeStr(p?.name || p?.studentName || ""),
      teamName,
      level: lvl,
      avgScore: p?.readingComp?.avgScore ?? null,
    });
  }

  const hasReadingCompData = Object.values(rcTotals).some((n) => (Number(n) || 0) > 0) && rcByStudent.length > 0;
  const readingCompSummary = hasReadingCompData
    ? {
        enabled: true,
        gradeLevel: gradeNum,
        totals: rcTotals,
        byTeam: rcByTeam,
        byStudent: rcByStudent,
        note:
          gradeNum != null
            ? "Comparison is relative to the grade's expected reading comprehension."
            : "Comparison is heuristic (grade level not detected).",
      }
    : { enabled: false };

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

    noiseSummary,

    readingCompSummary,

    teams,
    attachments,

    // Save per-participant (optional; PDF renderer will gate it)
    perParticipant: canIncludeStudentDetail ? enrichedPerParticipant : [],

    planTierUsed: safeStr(planTierUsed || "FREE") || "FREE",
    includeIndividualReports: canIncludeStudentDetail,

    generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
  };
}
