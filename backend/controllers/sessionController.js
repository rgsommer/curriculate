// backend/controllers/sessionController.js
import Session from "../models/Session.js";
import Submission from "../models/Submission.js";
import SessionAnalytics from "../models/SessionAnalytics.js";
import StudentSessionAnalytics from "../models/StudentSessionAnalytics.js";
import { buildAnalyticsForSession } from "../services/analyticsService.js";

/**
 * POST /sessions/:id/end
 * Ends a live session, computes analytics, stores them.
 */
export async function endSession(req, res) {
  try {
    const { id: sessionId } = req.params;
    const teacherId = req.user.id; // from requireAuth

    const session = await Session.findOne({
      _id: sessionId,
      teacherId,
    }).lean();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Mark session ended
    await Session.updateOne(
      { _id: sessionId },
      { status: "ended", endedAt: new Date() }
    );

    // Pull all submissions for this session
    const submissions = await Submission.find({ sessionId }).lean();

    // Build analytics
    const { sessionAnalytics, studentAnalyticsList } =
      await buildAnalyticsForSession(session, submissions);

    const saDoc = await SessionAnalytics.create(sessionAnalytics);

    // Student-level analytics are optional but useful; ignore if schema mismatch for now
    if (studentAnalyticsList.length > 0) {
      try {
        await StudentSessionAnalytics.insertMany(
          studentAnalyticsList.map((s) => ({
            ...s,
            teacherId,
            classroomId: session.classroomId || null,
          }))
        );
      } catch (err) {
        console.error("Student analytics insert error (non-fatal):", err);
      }
    }

    return res.json({
      ok: true,
      sessionAnalyticsId: saDoc._id,
    });
  } catch (err) {
    console.error("endSession error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
