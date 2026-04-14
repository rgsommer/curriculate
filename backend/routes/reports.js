// backend/routes/reports.js
import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import SessionReport from "../models/SessionReport.js";

const router = express.Router();

function getOwnerId(req) {
  return String(req.user?._id || req.user?.userId || req.user?.id || req.userId || "").trim();
}

// List reports for current teacher (most recent first)
router.get("/reports", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      console.warn("[reports] GET /api/reports — empty ownerId. user:", req.user?._id, "guest:", req.user?.guest);
      return res.status(401).json({ ok: false, error: "Unauthorized — no owner identity found. Are you logged in?" });
    }

    let rows = await SessionReport.find({ ownerId })
      .sort({ createdAt: -1 })
      .select("_id roomCode className gradeLevel headline createdAt startedAt planTierUsed taskSetName runByPresenterName sharedFromTeacherName sharedFromTeacherEmail classAverageScore classAverageEngagement noiseSummary")
      .lean();

    // If no reports found by ownerId, try matching by teacher email
    if ((!rows || rows.length === 0) && req.user?.email) {
      const email = String(req.user.email).trim().toLowerCase();
      rows = await SessionReport.find({
        $or: [
          { teacherEmail: { $regex: new RegExp(`^${email}$`, "i") } },
          { sharedFromTeacherEmail: { $regex: new RegExp(`^${email}$`, "i") } },
        ],
      })
        .sort({ createdAt: -1 })
        .select("_id roomCode className gradeLevel headline createdAt startedAt planTierUsed taskSetName runByPresenterName sharedFromTeacherName sharedFromTeacherEmail classAverageScore classAverageEngagement noiseSummary")
        .lean();
      if (rows?.length) {
        console.log(`[reports] Found ${rows.length} reports via email fallback for ${email} (ownerId ${ownerId} had 0)`);
      }
    }

    return res.json({ ok: true, reports: rows || [] });
  } catch (err) {
    console.error("GET /api/reports failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get one report (full JSON snapshot)
router.get("/reports/:id", authRequired, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      console.warn("[reports] GET /api/reports/:id — empty ownerId. user:", req.user?._id, "guest:", req.user?.guest);
      return res.status(401).json({ ok: false, error: "Unauthorized — no owner identity found. Are you logged in?" });
    }

    const id = String(req.params.id || "").trim();
    let doc = await SessionReport.findOne({ _id: id, ownerId }).lean();

    // If not found by ownerId, check if the user is the report's sharedFromTeacherEmail
    if (!doc) {
      const email = req.user?.email || "";
      if (email) {
        doc = await SessionReport.findOne({
          _id: id,
          $or: [
            { teacherEmail: email },
            { sharedFromTeacherEmail: email },
          ],
        }).lean();
      }
    }

    if (!doc) {
      console.warn(`[reports] Report ${id} not found for ownerId=${ownerId}`);
      return res.status(404).json({ ok: false, error: "Report not found. It may belong to a different account." });
    }

    return res.json({ ok: true, report: doc });
  } catch (err) {
    console.error("GET /api/reports/:id failed:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
