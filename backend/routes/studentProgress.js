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

function teacherAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.type !== "teacher-progress") return res.status(401).json({ error: "Invalid token type" });
    req.teacherEmail = decoded.teacherEmail;
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
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    // Teacher class overview: email only, no student ID → send magic code
    if (!sid) {
      const { magicCode } = req.body || {};

      // Check if this email belongs to a teacher with rosters
      const teacherRosters = await ClassRoster.find({ teacherEmail: email }).lean();
      if (teacherRosters.length === 0) {
        return res.status(400).json({ error: "Student ID is required. Teachers: use the email associated with your uploaded rosters." });
      }

      // Step 1: No magic code provided → generate and send one
      if (!magicCode) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        // Store code in memory (simple approach — expires in 10 min)
        if (!global._teacherMagicCodes) global._teacherMagicCodes = {};
        global._teacherMagicCodes[email] = { code, expires: Date.now() + 10 * 60 * 1000 };
        console.log(`[student-progress] Teacher magic code for ${email}: ${code}`);
        // Send email with code
        try {
          const { sendSystemEmail } = await import("../email/shareInviteEmailer.js");
          await sendSystemEmail({
            to: email,
            subject: "Your Curriculate verification code",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 0;">
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 28px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                  <h1 style="color: #ffffff; font-size: 22px; margin: 0 0 4px 0; font-weight: 700;">Curriculate</h1>
                  <p style="color: #a0aec0; font-size: 13px; margin: 0;">Progress Portal — Teacher Access</p>
                </div>

                <!-- Code section -->
                <div style="background: #ffffff; padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                  <p style="color: #333; font-size: 15px; line-height: 1.5; margin: 0 0 16px 0;">
                    Here's your verification code to access your class overview:
                  </p>
                  <div style="background: #f0f4ff; border: 2px solid #4361ee; border-radius: 10px; padding: 22px; text-align: center; margin: 0 0 16px 0;">
                    <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #4361ee;">${code}</span>
                  </div>
                  <p style="color: #888; font-size: 12px; text-align: center; margin: 0 0 20px 0;">
                    This code expires in 10 minutes.
                  </p>

                  <!-- What you'll see -->
                  <div style="background: #f8fafc; border-radius: 8px; padding: 16px 20px; margin: 0 0 4px 0;">
                    <p style="color: #1a1a2e; font-weight: 600; font-size: 14px; margin: 0 0 10px 0;">Once verified, you'll be able to:</p>
                    <p style="color: #555; font-size: 13px; line-height: 1.7; margin: 0;">
                      ✓ &nbsp;See every student's grades and overall averages<br>
                      ✓ &nbsp;Track class progress over time<br>
                      ✓ &nbsp;Click into individual student results<br>
                      ✓ &nbsp;See which students and parents are checking in
                    </p>
                  </div>
                </div>

                <!-- Curriculate teaser -->
                <div style="background: #f0f4ff; padding: 20px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                  <p style="color: #4361ee; font-weight: 600; font-size: 14px; margin: 0 0 8px 0;">Did you know?</p>
                  <p style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                    Curriculate's AI grading can mark a full class set in minutes — tests, essays, even handwritten work.
                    Snap a photo or upload a batch, and get detailed feedback with scores ready to export to your gradebook.
                  </p>
                  <a href="https://www.curriculate.net/ai-grading" style="display: inline-block; margin-top: 12px; color: #4361ee; font-size: 13px; font-weight: 600; text-decoration: none;">
                    Explore AI Grading →
                  </a>
                </div>

                <!-- Footer -->
                <div style="background: #1a1a2e; padding: 16px 24px; border-radius: 0 0 12px 12px; text-align: center;">
                  <p style="color: #a0aec0; font-size: 11px; margin: 0; line-height: 1.5;">
                    Curriculate — AI-powered tools that give teachers their time back.<br>
                    If you didn't request this code, you can safely ignore this email.
                  </p>
                </div>
              </div>
            `,
          });
        } catch (emailErr) {
          console.error("[student-progress] Failed to send magic code email:", emailErr?.message || emailErr);
        }
        return res.json({ ok: true, needsCode: true, message: "A 6-digit code has been sent to your email." });
      }

      // Step 2: Magic code provided → verify and return class overview
      const stored = global._teacherMagicCodes?.[email];
      if (!stored || stored.code !== String(magicCode).trim() || stored.expires < Date.now()) {
        return res.status(401).json({ error: "Invalid or expired code. Request a new one." });
      }
      delete global._teacherMagicCodes[email];

      // Build class overview
      const allStudentIds = new Set();
      const studentMap = {};
      for (const r of teacherRosters) {
        for (const s of r.students || []) {
          const fullId = s.studentId || s.edsbyId;
          if (!fullId) continue;
          if (!allStudentIds.has(fullId)) {
            allStudentIds.add(fullId);
            studentMap[fullId] = { firstName: s.firstName, lastName: s.lastName, className: r.className };
          }
        }
      }

      const idArray = [...allStudentIds];
      const allResults = await PublishedResult.find({
        "meta.studentId": { $in: idArray },
      }).sort({ createdAt: -1 }).lean();

      const byStudent = {};
      for (const r of allResults) {
        const sid2 = r.meta?.studentId;
        if (!sid2) continue;
        if (!byStudent[sid2]) byStudent[sid2] = [];
        byStudent[sid2].push(r);
      }

      const students = idArray.map((id) => {
        const info = studentMap[id] || {};
        const studentResults = byStudent[id] || [];
        const scores = [];
        for (const r of studentResults) {
          if (typeof r.payload === "string") {
            const m = r.payload.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
            if (m) {
              const outOf = parseFloat(m[2]);
              if (outOf > 0) scores.push(Math.round((parseFloat(m[1]) / outOf) * 100));
            }
          }
        }
        const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        return {
          studentId: id,
          firstName: info.firstName || "",
          lastName: info.lastName || "",
          className: info.className || "",
          totalAssignments: studentResults.length,
          avg,
          lastGraded: studentResults[0]?.createdAt || null,
        };
      }).filter((s) => s.totalAssignments > 0)
        .sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

      const token = jwt.sign({ teacherEmail: email, type: "teacher-progress" }, jwtSecret(), { expiresIn: "7d" });
      return res.json({
        ok: true,
        token,
        isTeacherOverview: true,
        students,
        totalStudents: students.length,
        totalAssignments: allResults.length,
      });
    }

    // Look up student in rosters to validate the ID
    let rosterStudent = null;
    let rosterInfo = null;
    const rosters = await ClassRoster.find({}).lean();
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.studentId === sid || s.last4 === sid || s.edsbyId === sid ||
            // Suffix match: kid enters "400224" but roster has "328400224"
            (sid.length >= 4 && s.studentId && s.studentId.endsWith(sid))) {
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

    // Teacher access: if the email matches the teacher who uploaded the roster,
    // grant access immediately without adding teacher email to notification list
    if (email === rosterInfo.teacherEmail.toLowerCase()) {
      // Ensure account exists (create if first access)
      let account = await StudentAccount.findOne({
        $or: [{ studentId: fullId }, { last4: rosterStudent.last4 }, { edsbyId: rosterStudent.edsbyId }].filter(q => Object.values(q).some(Boolean)),
      });
      if (!account) {
        account = await StudentAccount.create({
          studentId: fullId,
          last4: rosterStudent.last4 || fullId.slice(-4),
          emails: [],
          firstName: rosterStudent.firstName,
          lastName: rosterStudent.lastName,
          edsbyId: rosterStudent.edsbyId || "",
          teacherEmail: rosterInfo.teacherEmail,
          className: rosterInfo.className,
        });
      }
      const token = signStudentToken(fullId);
      return res.json({
        ok: true,
        token,
        student: {
          firstName: account.firstName,
          lastName: account.lastName,
          className: account.className,
          emailCount: (account.emails || []).length,
        },
        isTeacher: true,
      });
    }

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
        className: meta.className || "",
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
 *  GET /teacher/students (requires teacher auth)
 *  Returns class overview — same data as the magic code login response
 * ------------------------------------------------------------------ */
router.get("/teacher/students", teacherAuth, async (req, res) => {
  try {
    const email = req.teacherEmail;
    const teacherRosters = await ClassRoster.find({ teacherEmail: email }).lean();

    // Build student → classes map (a student can be in multiple classes)
    const allStudentIds = new Set();
    const studentClasses = {}; // { studentId: [{ firstName, lastName, className }] }
    const classNames = new Set();
    for (const r of teacherRosters) {
      classNames.add(r.className || "");
      for (const s of r.students || []) {
        const fullId = s.studentId || s.edsbyId;
        if (!fullId) continue;
        allStudentIds.add(fullId);
        if (!studentClasses[fullId]) studentClasses[fullId] = [];
        studentClasses[fullId].push({
          firstName: s.firstName, lastName: s.lastName, className: r.className || "",
        });
      }
    }

    const idArray = [...allStudentIds];
    console.log(`[teacher-overview] ${email}: ${teacherRosters.length} rosters, ${idArray.length} student IDs.`);

    const allResults = await PublishedResult.find({
      "meta.studentId": { $in: idArray },
    }).sort({ createdAt: -1 }).lean();

    // Group results by student
    const byStudent = {};
    for (const r of allResults) {
      const sid = r.meta?.studentId;
      if (!sid) continue;
      if (!byStudent[sid]) byStudent[sid] = [];
      byStudent[sid].push(r);
    }

    // Helper: does a result belong to a class?
    // Uses meta.className (explicit override) or fuzzy-matches meta.subject to className
    function resultMatchesClass(result, className) {
      const meta = result.meta || {};
      // Explicit className override takes priority
      if (meta.className) return meta.className === className;
      // Fuzzy match subject to className: "Math" matches "MATH7A", "Geography" matches "GEO8C"
      const subj = (meta.subject || "").toLowerCase();
      const cls = (className || "").toLowerCase();
      if (!subj || !cls) return false;
      // Extract subject prefix from className (e.g. "GEO" from "GEO8C", "HIST" from "HIST7A", "MATH" from "MATH7A", "CED" from "CED8A")
      const clsPrefix = cls.replace(/[0-9]/g, "");
      const subjMap = {
        math: ["math"],
        geo: ["geography", "geo"],
        hist: ["history", "hist"],
        sci: ["science", "sci"],
        eng: ["english", "eng", "ela", "language arts"],
        fre: ["french", "fre", "français"],
        ced: ["ced", "christian ethics", "ethics", "religion"],
        mus: ["music", "mus"],
        art: ["art", "visual art"],
        pe: ["pe", "phys ed", "physical education"],
        tech: ["tech", "technology"],
      };
      for (const [prefix, keywords] of Object.entries(subjMap)) {
        if (clsPrefix.startsWith(prefix) && keywords.some((k) => subj.includes(k))) return true;
      }
      // Fallback: subject string starts with class prefix
      if (clsPrefix.length >= 3 && subj.startsWith(clsPrefix)) return true;
      return false;
    }

    // Create one entry per student per class (student appears in all their classes)
    const students = [];
    for (const id of idArray) {
      const classes = studentClasses[id] || [];
      const studentResults = byStudent[id] || [];
      if (studentResults.length === 0) continue;

      for (const cls of classes) {
        // Filter results that belong to this class
        const classResults = studentResults.filter((r) => resultMatchesClass(r, cls.className));
        // Also find "unclassified" results (no subject and no className override)
        const unclassified = studentResults.filter((r) => {
          const meta = r.meta || {};
          return !meta.className && !meta.subject;
        });
        const relevant = [...classResults];
        // Add unclassified only if this is the student's first class (avoid double-counting)
        if (classes.indexOf(cls) === 0) {
          for (const u of unclassified) {
            if (!relevant.find((r) => r.code === u.code)) relevant.push(u);
          }
        }

        const scores = [];
        for (const r of relevant) {
          if (typeof r.payload === "string") {
            const m = r.payload.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
            if (m) {
              const outOf = parseFloat(m[2]);
              if (outOf > 0) scores.push(Math.round((parseFloat(m[1]) / outOf) * 100));
            }
          }
        }
        const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        students.push({
          studentId: id,
          firstName: cls.firstName || "",
          lastName: cls.lastName || "",
          className: cls.className || "",
          totalAssignments: relevant.length,
          avg,
          lastGraded: relevant[0]?.createdAt || null,
        });
      }
    }

    const filtered = students.filter((s) => s.totalAssignments > 0)
      .sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

    return res.json({
      ok: true,
      students: filtered,
      classNames: [...classNames].sort(),
      totalStudents: new Set(filtered.map((s) => s.studentId)).size,
      totalAssignments: allResults.length,
    });
  } catch (err) {
    console.error("GET /student-progress/teacher/students error:", err?.message || err);
    return res.status(500).json({ error: "Failed to load class overview." });
  }
});

/* ------------------------------------------------------------------
 *  PATCH /teacher/result/:code
 *  Teacher renames an assignment (updates meta.title).
 * ------------------------------------------------------------------ */
router.patch("/teacher/result/:code", teacherAuth, async (req, res) => {
  try {
    const code = (req.params.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (code.length !== 5) return res.status(400).json({ error: "Invalid code." });

    const { title, className } = req.body || {};
    const newTitle = title != null ? String(title).trim() : null;
    const newClassName = className != null ? String(className).trim() : null;

    if (newTitle != null && !newTitle) return res.status(400).json({ error: "Title cannot be empty." });
    if (newTitle == null && newClassName == null) return res.status(400).json({ error: "Nothing to update." });

    const doc = await PublishedResult.findOne({ code });
    if (!doc) return res.status(404).json({ error: "Result not found." });

    // Verify teacher owns this student via roster
    const studentId = doc.meta?.studentId;
    if (studentId) {
      const roster = await ClassRoster.findOne({
        teacherEmail: req.teacherEmail,
        $or: [{ "students.studentId": studentId }, { "students.edsbyId": studentId }],
      }).lean();
      if (!roster) return res.status(403).json({ error: "This result does not belong to your roster." });
    }

    doc.meta = doc.meta || {};
    if (newTitle != null) doc.meta.title = newTitle;
    if (newClassName != null) doc.meta.className = newClassName;
    doc.markModified("meta");
    await doc.save();

    const changes = [];
    if (newTitle != null) changes.push(`title="${newTitle}"`);
    if (newClassName != null) changes.push(`className="${newClassName}"`);
    console.log(`[teacher-update] ${req.teacherEmail} updated result ${code}: ${changes.join(", ")}`);
    return res.json({ ok: true, title: doc.meta.title, className: doc.meta.className });
  } catch (err) {
    console.error("PATCH /teacher/result/:code error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update." });
  }
});

/* ------------------------------------------------------------------
 *  DELETE /teacher/result/:code
 *  Teacher deletes a single published result by its ref code.
 *  Verifies the result belongs to one of the teacher's roster students.
 * ------------------------------------------------------------------ */
router.delete("/teacher/result/:code", teacherAuth, async (req, res) => {
  try {
    const code = (req.params.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (code.length !== 5) return res.status(400).json({ error: "Invalid code." });

    // Verify the result exists
    const doc = await PublishedResult.findOne({ code }).lean();
    if (!doc) return res.status(404).json({ error: "Result not found." });

    // Verify teacher owns this student via roster
    const studentId = doc.meta?.studentId;
    if (studentId) {
      const roster = await ClassRoster.findOne({
        teacherEmail: req.teacherEmail,
        "students.studentId": studentId,
      }).lean();
      const rosterByEdsby = !roster ? await ClassRoster.findOne({
        teacherEmail: req.teacherEmail,
        "students.edsbyId": studentId,
      }).lean() : roster;
      if (!rosterByEdsby) {
        return res.status(403).json({ error: "This result does not belong to your roster." });
      }
    }

    await PublishedResult.deleteOne({ code });
    console.log(`[teacher-delete] ${req.teacherEmail} deleted result ${code} (student: ${studentId || "unknown"})`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /teacher/result/:code error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete result." });
  }
});

/* ------------------------------------------------------------------
 *  GET /debug (temporary diagnostic — remove after fixing)
 * ------------------------------------------------------------------ */
router.get("/debug", async (req, res) => {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    const rosters = await ClassRoster.find(email ? { teacherEmail: email } : {}).lean();
    const rosterInfo = rosters.map((r) => ({
      className: r.className,
      teacherEmail: r.teacherEmail,
      studentCount: (r.students || []).length,
      sampleStudents: (r.students || []).slice(0, 3).map((s) => ({
        name: `${s.firstName} ${s.lastName}`,
        studentId: s.studentId,
        edsbyId: s.edsbyId,
        last4: s.last4,
      })),
    }));

    // Recent published results with meta.studentId
    const recentResults = await PublishedResult.find({ "meta.source": "batch-grading" })
      .sort({ createdAt: -1 }).limit(10).lean();
    const resultInfo = recentResults.map((r) => ({
      code: r.code,
      studentId: r.meta?.studentId,
      studentName: r.meta?.studentName,
      title: r.meta?.title,
      createdAt: r.createdAt,
    }));

    return res.json({
      rosters: rosterInfo,
      recentResults: resultInfo,
      totalRosters: rosters.length,
      totalResults: recentResults.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message });
  }
});

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
