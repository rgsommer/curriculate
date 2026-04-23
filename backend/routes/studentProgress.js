// backend/routes/studentProgress.js
// Student progress portal — auth + results listing
import express from "express";
import bcrypt from "bcryptjs";
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
 *  POST /register
 *  { studentId, password, email?, parentEmails? }
 * ------------------------------------------------------------------ */
router.post("/register", async (req, res) => {
  try {
    const { studentId, password, email, parentEmails } = req.body || {};
    const sid = String(studentId || "").trim();
    const pw = String(password || "");
    if (!sid || pw.length < 4) {
      return res.status(400).json({ error: "Student ID and password (min 4 chars) required." });
    }

    // Look up student in any roster
    const rosters = await ClassRoster.find({}).lean();
    let rosterStudent = null;
    let rosterInfo = null;
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

    // Check if already registered
    const existing = await StudentAccount.findOne({ studentId: fullId });
    if (existing) {
      return res.status(409).json({ error: "This student ID is already registered. Use login instead." });
    }

    const passwordHash = await bcrypt.hash(pw, 10);
    const parentList = Array.isArray(parentEmails)
      ? parentEmails.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@"))
      : typeof parentEmails === "string"
        ? parentEmails.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))
        : [];

    const account = await StudentAccount.create({
      studentId: fullId,
      last4: rosterStudent.last4 || fullId.slice(-4),
      passwordHash,
      email: String(email || "").trim().toLowerCase(),
      parentEmails: parentList,
      firstName: rosterStudent.firstName,
      lastName: rosterStudent.lastName,
      edsbyId: rosterStudent.edsbyId || "",
      teacherEmail: rosterInfo.teacherEmail,
      className: rosterInfo.className,
    });

    const token = signStudentToken(fullId);
    return res.json({
      ok: true,
      token,
      student: {
        firstName: account.firstName,
        lastName: account.lastName,
        className: account.className,
      },
    });
  } catch (err) {
    console.error("POST /student-progress/register error:", err?.message || err);
    return res.status(500).json({ error: "Registration failed." });
  }
});

/* ------------------------------------------------------------------
 *  POST /login
 *  { studentId, password }
 * ------------------------------------------------------------------ */
router.post("/login", async (req, res) => {
  try {
    const { studentId, password } = req.body || {};
    const sid = String(studentId || "").trim();
    if (!sid || !password) {
      return res.status(400).json({ error: "Student ID and password required." });
    }

    // Find by full ID, last4, or edsbyId
    const account = await StudentAccount.findOne({
      $or: [{ studentId: sid }, { last4: sid }, { edsbyId: sid }],
    });
    if (!account) {
      return res.status(401).json({ error: "Student ID not found. Register first." });
    }

    const valid = await bcrypt.compare(String(password), account.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = signStudentToken(account.studentId);
    return res.json({
      ok: true,
      token,
      student: {
        firstName: account.firstName,
        lastName: account.lastName,
        className: account.className,
      },
    });
  } catch (err) {
    console.error("POST /student-progress/login error:", err?.message || err);
    return res.status(500).json({ error: "Login failed." });
  }
});

/* ------------------------------------------------------------------
 *  POST /forgot-password
 *  { studentId }
 * ------------------------------------------------------------------ */
router.post("/forgot-password", async (req, res) => {
  try {
    const sid = String(req.body?.studentId || "").trim();
    const account = await StudentAccount.findOne({
      $or: [{ studentId: sid }, { last4: sid }, { edsbyId: sid }],
    });
    if (!account || !account.email) {
      return res.json({ ok: true, message: "If an account with that ID exists, a reset link was sent." });
    }

    // Generate 6-digit reset code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    account.resetToken = code;
    account.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    await account.save();

    // In production, send email here. For now, log it.
    console.log(`[student-progress] Password reset code for ${account.studentId}: ${code}`);

    return res.json({ ok: true, message: "If an account with that ID exists, a reset code was sent to your email." });
  } catch (err) {
    console.error("POST /student-progress/forgot-password error:", err?.message || err);
    return res.status(500).json({ error: "Failed." });
  }
});

/* ------------------------------------------------------------------
 *  POST /reset-password
 *  { studentId, code, newPassword }
 * ------------------------------------------------------------------ */
router.post("/reset-password", async (req, res) => {
  try {
    const { studentId, code, newPassword } = req.body || {};
    const sid = String(studentId || "").trim();
    const account = await StudentAccount.findOne({
      $or: [{ studentId: sid }, { last4: sid }],
    });
    if (!account || !account.resetToken || account.resetToken !== String(code).trim()) {
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }
    if (account.resetTokenExpires && account.resetTokenExpires < new Date()) {
      return res.status(400).json({ error: "Reset code has expired." });
    }
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    }

    account.passwordHash = await bcrypt.hash(String(newPassword), 10);
    account.resetToken = null;
    account.resetTokenExpires = null;
    await account.save();

    const token = signStudentToken(account.studentId);
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("POST /student-progress/reset-password error:", err?.message || err);
    return res.status(500).json({ error: "Reset failed." });
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

    // Find results by studentId in meta (from batch grading)
    // Also try matching by edsbyId and last4
    const ids = [account.studentId, account.edsbyId, account.last4].filter(Boolean);
    const results = await PublishedResult.find({
      $or: ids.map((id) => ({ "meta.studentId": id })),
    })
      .sort({ createdAt: -1 })
      .lean();

    // Build summary
    const entries = results.map((r) => {
      const meta = r.meta || {};
      // Try to extract score from payload
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

    // Overall average
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
      email: account.email || "",
      parentEmails: account.parentEmails || [],
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed." });
  }
});

/* ------------------------------------------------------------------
 *  PUT /profile (requires student auth)
 *  { email?, parentEmails? }
 * ------------------------------------------------------------------ */
router.put("/profile", studentAuth, async (req, res) => {
  try {
    const updates = {};
    if (req.body?.email != null) {
      updates.email = String(req.body.email).trim().toLowerCase();
    }
    if (req.body?.parentEmails != null) {
      const list = Array.isArray(req.body.parentEmails)
        ? req.body.parentEmails
        : String(req.body.parentEmails).split(/[,;\s]+/);
      updates.parentEmails = list.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@"));
    }
    await StudentAccount.updateOne({ studentId: req.studentId }, { $set: updates });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

export default router;
