// backend/controllers/analyticsController.js
import SessionAnalytics from "../models/SessionAnalytics.js";
import StudentSessionAnalytics from "../models/StudentSessionAnalytics.js";
import Session from "../models/Session.js";

/**
 * GET /analytics/sessions
 * List recent sessions with summary analytics for the logged-in teacher
 */
export async function listSessions(req, res) {
  try {
    const teacherId = req.user.id;

    const sessionAnalytics = await SessionAnalytics.find({ teacherId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (!sessionAnalytics.length) {
      return res.json({ sessions: [] });
    }

    const sessionIds = sessionAnalytics.map((sa) => sa.sessionId);
    const sessions = await Session.find({ _id: { $in: sessionIds } })
      .populate("classroomId")
      .populate("taskSetId")
      .lean();

    const sessionMap = new Map(sessions.map((s) => [s._id.toString(), s]));

    const result = sessionAnalytics.map((sa) => {
      const s = sessionMap.get(sa.sessionId.toString());
      const classroomName = s?.classroomId?.name || "Class";
      const taskSetName = s?.taskSetId?.title || "Task Set";
      const startedAt = s?.startedAt || sa.createdAt;

      return {
        _id: sa._id,
        sessionId: sa.sessionId,
        classroomName,
        taskSetName,
        startedAt,
        classAverageScore: sa.classAverageScore,
        classAverageAccuracy: sa.classAverageAccuracy,
      };
    });

    return res.json({ sessions: result });
  } catch (err) {
    console.error("listSessions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/**
 * GET /analytics/sessions/:id
 * Detailed analytics for a single session
 */
export async function getSessionDetails(req, res) {
  try {
    const teacherId = req.user.id;
    const { id } = req.params;

    const sa = await SessionAnalytics.findOne({
      _id: id,
      teacherId,
    }).lean();

    if (!sa) {
      return res.status(404).json({ error: "Session analytics not found" });
    }

    const session = await Session.findById(sa.sessionId)
      .populate("classroomId")
      .populate("taskSetId")
      .lean();

    const studentAnalytics = await StudentSessionAnalytics.find({
      sessionId: sa.sessionId,
      teacherId,
    }).lean();

    const response = {
      sessionAnalytics: {
        _id: sa._id,
        sessionId: sa.sessionId,
        classroomName: session?.classroomId?.name || "Class",
        taskSetName: session?.taskSetId?.title || "Task Set",
        startedAt: session?.startedAt || sa.createdAt,
        classAverageScore: sa.classAverageScore,
        classAverageAccuracy: sa.classAverageAccuracy,
        tasks: sa.tasks || [],
        teams: sa.teams || [],
      },
      studentAnalytics: studentAnalytics.map((s) => ({
        _id: s._id,
        studentId: s.studentId,
        studentName: s.studentName,
        totalPoints: s.totalPoints,
        maxPoints: s.maxPoints,
        accuracyPct: s.accuracyPct,
        tasksCompleted: s.tasksCompleted,
        tasksAssigned: s.tasksAssigned,
        avgLatencyMs: s.avgLatencyMs,
        perTask: s.perTask || [],
      })),
    };

    return res.json(response);
  } catch (err) {
    console.error("getSessionDetails error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
