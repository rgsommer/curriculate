// backend/routes/reports.js
import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requirePlan } from "../middleware/requirePlan.js";
import SessionReport from "../models/SessionReport.js";
import ClassRoster from "../models/ClassRoster.js";
import { buildSessionEdsbyCsv } from "../email/sessionGradesCsv.js";

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

// ─────────────────────────────────────────────────────────────────────────
// Mode C — Match a Session: build Edsby CSV with manual roster matches
//
// POST /api/reports/:id/edsby-csv
// Body: { classRosterId, manualMatches: { "studentName": "edsbyId" | "" } }
//   - manualMatches[name] === ""  → student is intentionally left unmatched
//   - manualMatches[name] === edsbyId → use that roster entry's identity
//   - omitted names → fall back to fuzzy matching (Levenshtein ≤ 2)
//
// Response: { ok, csv, hasAnyId, anyMatched, completedCount } —
//           the frontend wraps this in a download.
// ─────────────────────────────────────────────────────────────────────────
router.post("/reports/:id/edsby-csv", authRequired, requirePlan("PLUS"), async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const id = String(req.params.id || "").trim();
    const { classRosterId, manualMatches } = req.body || {};

    let report = await SessionReport.findOne({ _id: id, ownerId }).lean();
    if (!report) {
      const email = req.user?.email || "";
      if (email) {
        report = await SessionReport.findOne({
          _id: id,
          $or: [
            { teacherEmail: email },
            { sharedFromTeacherEmail: email },
          ],
        }).lean();
      }
    }
    if (!report) return res.status(404).json({ ok: false, error: "Report not found." });

    // Resolve roster (must belong to this teacher).
    let rosterStudents = [];
    if (classRosterId) {
      const roster = await ClassRoster.findById(classRosterId).lean();
      const ownerEmail = String(req.user?.email || "").toLowerCase().trim();
      if (
        !roster ||
        (ownerEmail &&
          String(roster.teacherEmail || "").toLowerCase() !== ownerEmail)
      ) {
        return res.status(403).json({ ok: false, error: "Roster not yours." });
      }
      rosterStudents = Array.isArray(roster.students) ? roster.students : [];
    }

    // Apply manual matches by overlaying onto a copy of studentGrades.
    const overlay = {};
    if (manualMatches && typeof manualMatches === "object") {
      for (const [name, edsbyId] of Object.entries(manualMatches)) {
        overlay[String(name).toLowerCase()] = String(edsbyId || "");
      }
    }
    const rosterByEdsbyId = new Map();
    for (const s of rosterStudents) {
      if (s.edsbyId) rosterByEdsbyId.set(s.edsbyId, s);
      if (s.studentId && !rosterByEdsbyId.has(s.studentId)) {
        rosterByEdsbyId.set(s.studentId, s);
      }
    }

    const studentGrades = (report.studentGrades || []).map((g) => {
      const next = { ...g };
      const k = String(g.studentName || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(overlay, k)) {
        const eid = overlay[k];
        if (eid) {
          const match = rosterByEdsbyId.get(eid);
          if (match) {
            next.firstName = match.firstName || "";
            next.lastName = match.lastName || "";
            next.edsbyId = match.edsbyId || "";
            next.studentId = match.studentId || "";
          }
        } else {
          // explicit "leave unmatched"
          next.firstName = "";
          next.lastName = "";
          next.edsbyId = "";
          next.studentId = "";
        }
      }
      return next;
    });

    const out = buildSessionEdsbyCsv({
      studentGrades,
      perParticipant: Array.isArray(report.perParticipant) ? report.perParticipant : [],
      assessmentName: report.taskSetName || report.transcript?.tasksetName || "Curriculate Activity",
      dateIso: report.startedAt
        ? new Date(report.startedAt).toISOString().slice(0, 10)
        : null,
      // For names not in `overlay`, the builder will Levenshtein-match against
      // the roster as a fallback.
      rosterStudents,
    });

    return res.json({
      ok: true,
      csv: out.csv,
      hasAnyId: out.hasAnyId,
      anyMatched: out.anyMatched,
      completedCount: out.completedCount,
      tasksetName: report.taskSetName || "",
      roomCode: report.roomCode || "",
    });
  } catch (err) {
    console.error("POST /api/reports/:id/edsby-csv failed:", err);
    return res.status(500).json({ ok: false, error: "CSV build failed." });
  }
});

export default router;
