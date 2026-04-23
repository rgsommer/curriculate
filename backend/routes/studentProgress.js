// backend/routes/studentProgress.js
// Student progress portal — simple ID + email auth, results listing
import express from "express";
import jwt from "jsonwebtoken";
import StudentAccount from "../models/StudentAccount.js";
import ClassRoster from "../models/ClassRoster.js";
import PublishedResult from "../models/PublishedResult.js";

const router = express.Router();

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return s;
}

function signStudentToken(studentId) {
  return jwt.sign({ studentId, type: "student" }, jwtSecret(), { expiresIn: "90d" });
}

function studentAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.type !== "student") return res.status(401).json({ error: "Invalid token type" });
    req.studentId = decoded.studentId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ------------------------------------------------------------------
 *  POST /login
 *  { studentId, email }
 *  Simple: enter student ID + email. If the email is new, it gets
 *  added and all existing emails are notified. No password needed.
 * ------------------------------------------------------------------ */
router.post("/login", async (req, res) => {
  try {
    const { studentId, email: rawEmail } = req.body || {};
    const sid = String(studentId || "").trim();
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!sid) {
      return res.status(400).json({ error: "Student ID is required." });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    // Look up student in rosters to validate the ID
    let rosterStudent = null;
    let rosterInfo = null;
    const rosters = await ClassRoster.find({}).lean();
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.studentId === sid || s.last4 === sid || s.edsbyId === sid) {
          rosterStudent = s;
          rosterInfo = { teacherEmail: r.teacherEmail, className: r.className };
          break;
        }
      }
      if (rosterStudent) break;
    }

    if (!rosterStudent) {
      return res.status(404).json({ error: "Student ID not found in any class roster. Ask your teacher to upload the class roster first." });
    }

    const fullId = rosterStudent.studentId || rosterStudent.edsbyId || sid;

    // Find or create account
    let account = await StudentAccount.findOne({
      $or: [{ studentId: fullId }, { last4: rosterStudent.last4 }, { edsbyId: rosterStudent.edsbyId }].filter(q => Object.values(q).some(Boolean)),
    });

    let newEmailAdded = false;
    const existingEmails = [];

    if (!account) {
      // First time — create account
      account = await StudentAccount.create({
        studentId: fullId,
        last4: rosterStudent.last4 || fullId.slice(-4),
        emails: [email],
        firstName: rosterStudent.firstName,
        lastName: rosterStudent.lastName,
        edsbyId: rosterStudent.edsbyId || "",
        teacherEmail: rosterInfo.teacherEmail,
        className: rosterInfo.className,
      });
    } else {
      // Existing account — check if email is already on file
      const emailList = (account.emails || []).map((e) => e.toLowerCase());
      if (!emailList.includes(email)) {
        // New email — add it and note existing ones to notify
        existingEmails.push(...emailList);
        account.emails.push(email);
        newEmailAdded = true;
      }

      // Update name/class from roster in case it changed
      account.firstName = rosterStudent.firstName;
      account.lastName = rosterStudent.lastName;
      account.className = rosterInfo.className;
    }

    // Track login
    account.loginCount = (account.loginCount || 0) + 1;
    account.lastLoginAt = new Date();
    await account.save();

    // TODO: If newEmailAdded && existingEmails.length > 0, send notification
    // to existingEmails: "A new email (email) was added to the progress
    // account for {firstName} {lastName}."
    if (newEmailAdded && existingEmails.length > 0) {
      console.log(`[student-progress] New email ${email} added to ${fullId}. Notify: ${existingEmails.join(", ")}`);
    }

    const token = signStudentToken(fullId);
    return res.json({
      ok: true,
      token,
      student: {
        firstName: account.firstName,
        lastName: account.lastName,
        className: account.className,
      },
      newEmailAdded,
      emailCount: account.emails.length,
    });
  } catch (err) {
    console.error("POST /student-progress/login error:", err?.message || err);
    return res.status(500).json({ error: "Login failed." });
  }
});

/* ------------------------------------------------------------------
 *  GET /results (requires student auth)
 *  Returns all published results for this student
 * ------------------------------------------------------------------ */
router.get("/results", studentAuth, async (req, res) => {
  try {
    const account = await StudentAccount.findOne({ studentId: req.studentId }).lean();
    if (!account) return res.status(404).json({ error: "Account not found." });

    // Find results by studentId in meta
    const ids = [account.studentId, account.edsbyId, account.last4].filter(Boolean);
    const results = await PublishedResult.find({
      $or: ids.map((id) => ({ "meta.studentId": id })),
    })
      .sort({ createdAt: -1 })
      .lean();

    // Keep-alive: extend expiry on all this student's results by 30 days.
    // Any login (student or parent) refreshes the TTL.
    if (results.length > 0) {
      const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const resultIds = results.map((r) => r._id);
      PublishedResult.updateMany(
        { _id: { $in: resultIds }, expiresAt: { $lt: newExpiry } },
        { $set: { expiresAt: newExpiry } }
      ).catch(() => {});
    }

    // Build summary
    const entries = results.map((r) => {
      const meta = r.meta || {};
      let score = null, outOf = null, pct = null, subject = "", assessmentType = "", title = "";
      if (typeof r.payload === "string") {
        const scoreMatch = r.payload.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
        if (scoreMatch) {
          score = parseFloat(scoreMatch[1]);
          outOf = parseFloat(scoreMatch[2]);
          pct = outOf > 0 ? Math.round((score / outOf) * 100) : null;
        }
      }
      subject = meta.subject || "";
      assessmentType = meta.assessmentType || "";
      title = meta.title || assessmentType || "Assignment";

      return {
        code: r.code,
        subject,
        assessmentType,
        title,
        score,
        outOf,
        pct,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      };
    });

    const withPct = entries.filter((e) => e.pct != null);
    const overallAvg = withPct.length > 0
      ? Math.round(withPct.reduce((s, e) => s + e.pct, 0) / withPct.length)
      : null;

    return res.json({
      ok: true,
      student: {
        firstName: account.firstName,
        lastName: account.lastName,
        className: account.className,
        emailCount: (account.emails || []).length,
      },
      results: entries,
      overallAvg,
      totalAssignments: entries.length,
    });
  } catch (err) {
    console.error("GET /student-progress/results error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load results." });
  }
});

/* ------------------------------------------------------------------
 *  GET /profile (requires student auth)
 * ------------------------------------------------------------------ */
router.get("/profile", studentAuth, async (req, res) => {
  try {
    const account = await StudentAccount.findOne({ studentId: req.studentId }).lean();
    if (!account) return res.status(404).json({ error: "Account not found." });
    return res.json({
      ok: true,
      firstName: account.firstName,
      lastName: account.lastName,
      className: account.className,
      emails: account.emails || [],
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed." });
  }
});

/* ------------------------------------------------------------------
 *  GET /profile emails are read-only for security.
 *  Emails can only be added (by logging in with a new email).
 *  Removal requires teacher intervention to prevent bad actors
 *  (e.g. a classmate deleting parent emails).
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
 *  GET /stats (admin)
 * ------------------------------------------------------------------ */
router.get("/stats", async (req, res) => {
  try {
    const totalAccounts = await StudentAccount.countDocuments();
    const loggedInLast7d = await StudentAccount.countDocuments({
      lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });
    const loggedInLast30d = await StudentAccount.countDocuments({
      lastLoginAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    const totalLogins = await StudentAccount.aggregate([
      { $group: { _id: null, total: { $sum: "$loginCount" } } },
    ]);
    const totalEmails = await StudentAccount.aggregate([
      { $group: { _id: null, total: { $sum: { $size: { $ifNull: ["$emails", []] } } } } },
    ]);
    const multiEmail = await StudentAccount.countDocuments({
      "emails.1": { $exists: true },
    });

    return res.json({
      ok: true,
      totalAccounts,
      loggedInLast7d,
      loggedInLast30d,
      totalLogins: totalLogins[0]?.total || 0,
      totalEmails: totalEmails[0]?.total || 0,
      accountsWithMultipleEmails: multiEmail,
    });
  } catch (err) {
    console.error("GET /student-progress/stats error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load stats." });
  }
});

export default router;
