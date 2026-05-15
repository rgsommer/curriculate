// backend/routes/studentProgress.js
// Student progress portal — simple ID + email auth, results listing
import express from "express";
import jwt from "jsonwebtoken";
import StudentAccount from "../models/StudentAccount.js";
import ClassRoster from "../models/ClassRoster.js";
import PublishedResult from "../models/PublishedResult.js";
import { sendWeeklyDigests } from "../email/gradeNotification.js";

const router = express.Router();

/**
 * Extract saved capture image URLs from a result payload string.
 * Returns array of URLs (photo only, excludes video).
 */
function parseImageUrls(payload) {
  if (typeof payload !== "string") return [];
  const urls = [];
  const lines = payload.split("\n");
  let inCaptures = false;
  for (const ln of lines) {
    if (/saved captures/i.test(ln)) { inCaptures = true; continue; }
    if (inCaptures) {
      if (/^\S.*:$/.test(ln.trim()) && !/saved captures/i.test(ln)) break;
      const urlMatch = ln.match(/https?:\/\/\S+/);
      if (urlMatch && !/\/video\.\w+/i.test(urlMatch[0])) {
        urls.push(urlMatch[0]);
      }
    }
  }
  return urls;
}

/**
 * Parse KITA / Achievement Category scores from a result payload string.
 * Returns { isKita, categories: [{ short, name, score, outOf, weight }], weightedTotal }
 * or null if no structured categories found.
 */
function parseCategories(payload) {
  if (typeof payload !== "string") return null;
  const lines = payload.split("\n");

  const isKita = lines.some((l) => l.trim() === "Achievement Categories (KITA):");
  const isAchievement = lines.some((l) => l.trim() === "Achievement Categories:");

  if (!isKita && !isAchievement) return null;

  const header = isKita ? "Achievement Categories (KITA):" : "Achievement Categories:";
  let inSection = false;
  const categories = [];
  let weightedTotal = null;

  for (const ln of lines) {
    if (ln.trim() === header) { inSection = true; continue; }
    if (!inSection) continue;

    // Stop at next heading
    if (/^\S.*:$/.test(ln.trim()) && ln.trim() !== header) break;

    const t = ln.trim();

    // KITA line: "- K Knowledge & Understanding: 3.5/5 (25%) — comment"
    const kitaMatch = t.match(/^-\s*([KTCA])\s+(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)\s*\((\d+)%\)/);
    if (kitaMatch) {
      categories.push({
        short: kitaMatch[1],
        name: kitaMatch[2].trim(),
        score: parseFloat(kitaMatch[3]),
        outOf: parseFloat(kitaMatch[4]),
        weight: parseInt(kitaMatch[5], 10),
      });
      continue;
    }

    // Achievement summary line with score: "- K Knowledge & Understanding 3.50/5.00 [strong]: comment"
    const achScoreMatch = t.match(/^-?\s*(\S+)\s+(.+?)\s+([\d.]+)\/([\d.]+)\s*\[(\w+)\]/);
    if (achScoreMatch) {
      categories.push({
        short: achScoreMatch[1],
        name: achScoreMatch[2].trim(),
        score: parseFloat(achScoreMatch[3]),
        outOf: parseFloat(achScoreMatch[4]),
        level: achScoreMatch[5].trim().toLowerCase(),
      });
      continue;
    }

    // Achievement summary without score: "- K Knowledge & Understanding [strong]: comment"
    const achMatch = t.match(/^-?\s*(\S+)\s+(.+?)\s*\[(\w+)\]/);
    if (achMatch) {
      categories.push({
        short: achMatch[1],
        name: achMatch[2].trim(),
        level: achMatch[3].trim().toLowerCase(),
      });
      continue;
    }

    // Weighted Total: 78%
    const totalMatch = t.match(/^Weighted Total:\s*(\d+)%$/);
    if (totalMatch) {
      weightedTotal = parseInt(totalMatch[1], 10);
    }
  }

  if (categories.length === 0) return null;
  return { isKita, categories, weightedTotal };
}

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
                    Curriculate Pulse can mark a full class set in minutes — tests, essays, even handwritten work.
                    Snap a photo or upload a batch, and get detailed feedback with scores ready to export to your gradebook.
                  </p>
                  <a href="https://www.curriculate.net/pulse" style="display: inline-block; margin-top: 12px; color: #4361ee; font-size: 13px; font-weight: 600; text-decoration: none;">
                    Explore Pulse →
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

      // Full roster list for reassignment dropdown
      const rosterStudentsList = [];
      const seenR = new Set();
      for (const tr of teacherRosters) {
        for (const s of tr.students || []) {
          const fid = s.studentId || s.edsbyId;
          const key = `${fid}|${tr.className}`;
          if (!fid || seenR.has(key)) continue;
          seenR.add(key);
          rosterStudentsList.push({ studentId: fid, firstName: s.firstName || "", lastName: s.lastName || "", className: tr.className || "" });
        }
      }
      rosterStudentsList.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

      const token = jwt.sign({ teacherEmail: email, type: "teacher-progress" }, jwtSecret(), { expiresIn: "7d" });
      return res.json({
        ok: true,
        token,
        isTeacherOverview: true,
        students,
        rosterStudents: rosterStudentsList,
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

      // Parse KITA / achievement categories from payload
      const cats = parseCategories(r.payload);
      const images = parseImageUrls(r.payload);

      return {
        code: r.code,
        sessionId: r.sessionId || null,
        subject,
        assessmentType,
        title,
        className: meta.className || "",
        score,
        outOf,
        pct,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        viewCount: r.viewCount || 0,
        viewSources: r.viewSources || {},
        lastViewedAt: r.lastViewedAt || null,
        categories: cats,
        images,
      };
    });

    const withPct = entries.filter((e) => e.pct != null);
    const overallAvg = withPct.length > 0
      ? Math.round(withPct.reduce((s, e) => s + e.pct, 0) / withPct.length)
      : null;

    // Compute class averages for each assignment title
    // Group by sessionId + title to find matching class results
    const sessionIds = [...new Set(results.filter((r) => r.sessionId).map((r) => r.sessionId))];
    const titleKeys = [...new Set(results.map((r) => (r.meta?.title || "").toLowerCase().trim()).filter(Boolean))];

    let classAvgMap = {}; // { "title_lower": { avg, count } }
    if (sessionIds.length > 0 && titleKeys.length > 0) {
      try {
        const classResults = await PublishedResult.aggregate([
          {
            $match: {
              sessionId: { $in: sessionIds },
              "meta.title": { $ne: null },
            },
          },
          {
            $group: {
              _id: { $toLower: "$meta.title" },
              payloads: { $push: "$payload" },
              count: { $sum: 1 },
            },
          },
        ]);

        for (const cr of classResults) {
          const scores = [];
          for (const p of cr.payloads) {
            if (typeof p === "string") {
              const m = p.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
              if (m) {
                const outOf = parseFloat(m[2]);
                if (outOf > 0) scores.push(Math.round((parseFloat(m[1]) / outOf) * 100));
              }
            }
          }
          if (scores.length > 1) {
            classAvgMap[cr._id] = {
              avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
              count: scores.length,
            };
          }
        }
      } catch (err) {
        console.warn("[progress] Class avg computation failed:", err.message);
      }
    }

    // Attach class averages to entries
    for (const entry of entries) {
      const key = (entry.title || "").toLowerCase().trim();
      if (classAvgMap[key]) {
        entry.classAvg = classAvgMap[key].avg;
        entry.classSize = classAvgMap[key].count;
      }
    }

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
    const prefs = account.emailPrefs || {};
    // Return emails with their notification preference
    const emailsWithPrefs = (account.emails || []).map((em) => ({
      address: em,
      notify: prefs[em] || "on-new", // default to "on-new"
    }));
    return res.json({
      ok: true,
      firstName: account.firstName,
      lastName: account.lastName,
      className: account.className,
      emails: account.emails || [],
      emailPrefs: emailsWithPrefs,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed." });
  }
});

/* ------------------------------------------------------------------
 *  PATCH /profile/email-pref
 *  { email: string, notify: "on-new" | "weekly" | "never" }
 *  Updates notification preference for one email address.
 * ------------------------------------------------------------------ */
router.patch("/profile/email-pref", studentAuth, async (req, res) => {
  try {
    const { email, notify } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    const validPrefs = ["on-new", "weekly", "never"];
    if (!em || !validPrefs.includes(notify)) {
      return res.status(400).json({ error: "Invalid email or preference." });
    }

    const account = await StudentAccount.findOne({ studentId: req.studentId });
    if (!account) return res.status(404).json({ error: "Account not found." });

    // Verify this email belongs to the account
    if (!account.emails.includes(em)) {
      return res.status(403).json({ error: "Email not associated with this account." });
    }

    const prefs = account.emailPrefs || {};
    prefs[em] = notify;
    account.emailPrefs = prefs;
    account.markModified("emailPrefs");
    await account.save();

    return res.json({ ok: true, notify });
  } catch (err) {
    console.error("PATCH /profile/email-pref error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update preference." });
  }
});

/* ------------------------------------------------------------------
 *  POST /profile/add-email
 *  Adds an email to the student account (e.g. entered during recommend flow).
 * ------------------------------------------------------------------ */
router.post("/profile/add-email", studentAuth, async (req, res) => {
  try {
    const em = String(req.body?.email || "").trim().toLowerCase();
    if (!em || !em.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required." });
    }
    const account = await StudentAccount.findOne({ studentId: req.studentId });
    if (!account) return res.status(404).json({ error: "Account not found." });
    const emailList = (account.emails || []).map((e) => e.toLowerCase());
    if (emailList.includes(em)) {
      return res.json({ ok: true, added: false, emailCount: account.emails.length });
    }
    account.emails.push(em);
    await account.save();
    console.log(`[profile] Email ${em} added to ${req.studentId} via recommend flow`);
    return res.json({ ok: true, added: true, emailCount: account.emails.length });
  } catch (err) {
    console.error("POST /profile/add-email error:", err?.message || err);
    return res.status(500).json({ error: "Failed to add email." });
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
    // Also detect results whose meta.className points to a class the student isn't
    // rostered in — create virtual class entries so e.g. Math tests aren't orphaned
    // under History when no Math roster exists.
    const students = [];
    for (const id of idArray) {
      const classes = studentClasses[id] || [];
      const studentResults = byStudent[id] || [];
      if (studentResults.length === 0) continue;

      // Build set of roster class names this student belongs to
      const rosterClassSet = new Set(classes.map((c) => c.className || ""));

      // Check if any results belong to a class not in this student's rosters.
      // This covers: (a) meta.className set to a non-roster class, and
      // (b) meta.subject that doesn't match any of the student's roster classes
      // (e.g. Math results when only History/Geo rosters are uploaded).
      const extraClasses = new Set();
      for (const r of studentResults) {
        const rc = (r.meta?.className || "").trim();
        // Case (a): explicit className not in any roster
        if (rc && !rosterClassSet.has(rc)) {
          extraClasses.add(rc);
          classNames.add(rc);
          continue;
        }
        // Case (b): no className, but subject doesn't match any of this student's roster classes
        if (!rc) {
          const matchesAnyRoster = classes.some((c) => resultMatchesClass(r, c.className));
          if (!matchesAnyRoster) {
            const subj = (r.meta?.subject || "").trim();
            if (subj) {
              // Try to infer a specific class name from the assignment title
              // e.g. "7A Math Journal" → MATH7A, "8B Science Test" → SCI8B
              const title = (r.meta?.title || "").trim();
              const sectionMatch = title.match(/\b(\d+[A-Za-z])\b/); // e.g. "7A", "8B", "9C"
              const subjLower = subj.toLowerCase();
              // Map subject to a short prefix (same as roster naming convention)
              const prefixMap = {
                math: "MATH", mathematics: "MATH",
                geography: "GEO", geo: "GEO",
                history: "HIST", hist: "HIST",
                science: "SCI", sci: "SCI",
                english: "ENG", ela: "ENG", "language arts": "ENG",
                french: "FRE", français: "FRE",
                "christian ethics": "CED", ethics: "CED", religion: "CED", bible: "CED",
                music: "MUS", art: "ART", pe: "PE", "physical education": "PE",
                technology: "TECH", tech: "TECH",
              };
              const prefix = prefixMap[subjLower];
              if (sectionMatch && prefix) {
                // Build class name like MATH7A, SCI8B
                const label = `${prefix}${sectionMatch[1].toUpperCase()}`;
                extraClasses.add(label);
                classNames.add(label);
              } else {
                // Fallback: use capitalized subject
                const label = subj.charAt(0).toUpperCase() + subj.slice(1);
                extraClasses.add(label);
                classNames.add(label);
              }
            }
          }
        }
      }

      // For each roster class, compute stats only for results that belong to that class
      for (const cls of classes) {
        const classResults = studentResults.filter((r) => resultMatchesClass(r, cls.className));
        // Also include unclassified results (no className, no subject match) in the student's first class
        const unclassified = studentResults.filter((r) => {
          const rc = (r.meta?.className || "").trim();
          const subj = (r.meta?.subject || "").trim();
          return !rc && !subj;
        });
        const effectiveResults = classResults.length > 0 ? classResults : [];
        // Add unclassified results only to the first class to avoid double-counting
        if (cls === classes[0]) {
          for (const u of unclassified) {
            if (!effectiveResults.includes(u)) effectiveResults.push(u);
          }
        }
        if (effectiveResults.length === 0) continue;

        const scores = [];
        for (const r of effectiveResults) {
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
          totalAssignments: effectiveResults.length,
          avg,
          lastGraded: effectiveResults[0]?.createdAt || null,
        });
      }

      // Create entries for virtual classes (from meta.className or subject not in any roster)
      for (const vc of extraClasses) {
        const vcResults = studentResults.filter((r) => {
          const rc = (r.meta?.className || "").trim();
          if (rc === vc) return true;
          if (!rc) {
            // Re-derive the label for this result using the same logic as above
            const matchesAnyRoster = classes.some((c) => resultMatchesClass(r, c.className));
            if (matchesAnyRoster) return false;
            const subj = (r.meta?.subject || "").trim();
            if (!subj) return false;
            const title = (r.meta?.title || "").trim();
            const sectionMatch = title.match(/\b(\d+[A-Za-z])\b/);
            const subjLower = subj.toLowerCase();
            const prefixMap = {
              math: "MATH", mathematics: "MATH",
              geography: "GEO", geo: "GEO",
              history: "HIST", hist: "HIST",
              science: "SCI", sci: "SCI",
              english: "ENG", ela: "ENG", "language arts": "ENG",
              french: "FRE", français: "FRE",
              "christian ethics": "CED", ethics: "CED", religion: "CED", bible: "CED",
              music: "MUS", art: "ART", pe: "PE", "physical education": "PE",
              technology: "TECH", tech: "TECH",
            };
            const prefix = prefixMap[subjLower];
            const derivedLabel = (sectionMatch && prefix)
              ? `${prefix}${sectionMatch[1].toUpperCase()}`
              : subj.charAt(0).toUpperCase() + subj.slice(1);
            return derivedLabel === vc;
          }
          return false;
        });
        if (vcResults.length === 0) continue;
        const scores = [];
        for (const r of vcResults) {
          if (typeof r.payload === "string") {
            const m = r.payload.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
            if (m) {
              const outOf = parseFloat(m[2]);
              if (outOf > 0) scores.push(Math.round((parseFloat(m[1]) / outOf) * 100));
            }
          }
        }
        const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        // Use name from any roster entry for this student
        const nameEntry = classes[0] || {};
        students.push({
          studentId: id,
          firstName: nameEntry.firstName || "",
          lastName: nameEntry.lastName || "",
          className: vc,
          totalAssignments: vcResults.length,
          avg,
          lastGraded: vcResults[0]?.createdAt || null,
        });
      }
    }

    const filtered = students.filter((s) => s.totalAssignments > 0)
      .sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

    // ── Verified-email + portal-access annotation ────────────────────
    // Look up StudentAccount for every student id we're about to
    // return so the UI can show a ✉ badge per student and a class
    // banner with "N of M students viewing results via email".  Cheap:
    // single $in query indexed on studentId.
    const accountIds = [...new Set(filtered.map((s) => s.studentId))];
    const accounts = accountIds.length
      ? await StudentAccount.find({ studentId: { $in: accountIds } })
          .select("studentId emails loginCount lastLoginAt parentLoginCount lastParentLoginAt")
          .lean()
      : [];
    const acctByStudent = {};
    for (const a of accounts) acctByStudent[a.studentId] = a;
    for (const s of filtered) {
      const a = acctByStudent[s.studentId];
      const emails = Array.isArray(a?.emails) ? a.emails.filter(Boolean) : [];
      s.emailCount = emails.length;
      s.hasEmail = emails.length > 0;
      s.studentLoginCount = Number(a?.loginCount || 0);
      s.parentLoginCount = Number(a?.parentLoginCount || 0);
      s.lastLoginAt = a?.lastLoginAt || a?.lastParentLoginAt || null;
      // "Verified" = email on file AND someone (student or parent) has
      // actually logged in via that email.
      s.emailVerified = s.hasEmail && (s.studentLoginCount > 0 || s.parentLoginCount > 0);
    }

    // Class-level reach stats: dedupe by studentId (a student can
    // appear in multiple class rows when in multiple sections).
    const uniqueIds = new Set(filtered.map((s) => s.studentId));
    const uniqueWithEmail = new Set(
      filtered.filter((s) => s.hasEmail).map((s) => s.studentId)
    );
    const uniqueVerified = new Set(
      filtered.filter((s) => s.emailVerified).map((s) => s.studentId)
    );
    const emailStats = {
      totalStudents: uniqueIds.size,
      withEmail: uniqueWithEmail.size,
      verified: uniqueVerified.size,
      withEmailPct: uniqueIds.size
        ? Math.round((uniqueWithEmail.size / uniqueIds.size) * 100)
        : 0,
      verifiedPct: uniqueIds.size
        ? Math.round((uniqueVerified.size / uniqueIds.size) * 100)
        : 0,
    };

    // Full roster list (all students, including those without grades) for reassignment
    const rosterStudents = [];
    const seenRoster = new Set();
    for (const r of teacherRosters) {
      for (const s of r.students || []) {
        const fullId = s.studentId || s.edsbyId;
        const key = `${fullId}|${r.className}`;
        if (!fullId || seenRoster.has(key)) continue;
        seenRoster.add(key);
        rosterStudents.push({
          studentId: fullId,
          firstName: s.firstName || "",
          lastName: s.lastName || "",
          className: r.className || "",
        });
      }
    }
    rosterStudents.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

    return res.json({
      ok: true,
      students: filtered,
      rosterStudents,
      classNames: [...classNames].sort(),
      totalStudents: new Set(filtered.map((s) => s.studentId)).size,
      totalAssignments: allResults.length,
      emailStats,
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

    const { title, className, studentId: newStudentId, studentName: newStudentName } = req.body || {};
    const newTitle = title != null ? String(title).trim() : null;
    const newClassName = className != null ? String(className).trim() : null;
    const newSid = newStudentId != null ? String(newStudentId).trim() : null;
    const newSname = newStudentName != null ? String(newStudentName).trim() : null;

    if (newTitle != null && !newTitle) return res.status(400).json({ error: "Title cannot be empty." });
    if (newTitle == null && newClassName == null && newSid == null) return res.status(400).json({ error: "Nothing to update." });

    const doc = await PublishedResult.findOne({ code });
    if (!doc) return res.status(404).json({ error: "Result not found." });

    // Verify teacher owns this student via roster (check both current and target student)
    const currentSid = doc.meta?.studentId;
    if (currentSid) {
      const roster = await ClassRoster.findOne({
        teacherEmail: req.teacherEmail,
        $or: [{ "students.studentId": currentSid }, { "students.edsbyId": currentSid }],
      }).lean();
      if (!roster) return res.status(403).json({ error: "This result does not belong to your roster." });
    }
    if (newSid) {
      const targetRoster = await ClassRoster.findOne({
        teacherEmail: req.teacherEmail,
        $or: [{ "students.studentId": newSid }, { "students.edsbyId": newSid }],
      }).lean();
      if (!targetRoster) return res.status(403).json({ error: "Target student is not in your roster." });
    }

    doc.meta = doc.meta || {};
    if (newTitle != null) doc.meta.title = newTitle;
    if (newClassName != null) doc.meta.className = newClassName;
    if (newSid != null) doc.meta.studentId = newSid;
    if (newSname != null) doc.meta.studentName = newSname;
    doc.markModified("meta");
    await doc.save();

    const changes = [];
    if (newTitle != null) changes.push(`title="${newTitle}"`);
    if (newClassName != null) changes.push(`className="${newClassName}"`);
    if (newSid != null) changes.push(`studentId="${newSid}"`);
    if (newSname != null) changes.push(`studentName="${newSname}"`);
    console.log(`[teacher-update] ${req.teacherEmail} updated result ${code}: ${changes.join(", ")}`);
    return res.json({ ok: true, title: doc.meta.title, className: doc.meta.className, studentId: doc.meta.studentId });
  } catch (err) {
    console.error("PATCH /teacher/result/:code error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update." });
  }
});

/* ------------------------------------------------------------------
 *  POST /teacher/bulk-rename
 *  { oldTitle: string, newTitle: string }
 *  Renames all results with matching meta.title across the teacher's roster students.
 * ------------------------------------------------------------------ */
router.post("/teacher/bulk-rename", teacherAuth, async (req, res) => {
  try {
    const { oldTitle, newTitle } = req.body || {};
    const from = String(oldTitle || "").trim();
    const to = String(newTitle || "").trim();
    if (!to) return res.status(400).json({ error: "New title cannot be empty." });

    // Get all student IDs from teacher's rosters
    const rosters = await ClassRoster.find({ teacherEmail: req.teacherEmail }).lean();
    const studentIds = new Set();
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.studentId) studentIds.add(s.studentId);
        if (s.edsbyId) studentIds.add(s.edsbyId);
      }
    }
    if (studentIds.size === 0) return res.json({ ok: true, updated: 0 });

    // Build query: match by studentId AND title (or assessmentType fallback)
    const query = {
      "meta.studentId": { $in: [...studentIds] },
    };
    if (from) {
      query.$or = [
        { "meta.title": from },
        { "meta.title": { $in: ["", null] }, "meta.assessmentType": from },
      ];
    } else {
      // Empty oldTitle = match results with no title set
      query["meta.title"] = { $in: ["", null] };
    }

    const result = await PublishedResult.updateMany(query, {
      $set: { "meta.title": to },
    });

    console.log(`[bulk-rename] ${req.teacherEmail}: "${from}" → "${to}", ${result.modifiedCount} updated`);
    return res.json({ ok: true, updated: result.modifiedCount });
  } catch (err) {
    console.error("POST /teacher/bulk-rename error:", err?.message || err);
    return res.status(500).json({ error: "Failed to bulk rename." });
  }
});

/* ------------------------------------------------------------------
 *  POST /teacher/bulk-delete
 *  { title: string }
 *  Deletes all results with matching title across the teacher's roster students.
 * ------------------------------------------------------------------ */
router.post("/teacher/bulk-delete", teacherAuth, async (req, res) => {
  try {
    const { title } = req.body || {};
    const target = String(title || "").trim();

    const rosters = await ClassRoster.find({ teacherEmail: req.teacherEmail }).lean();
    const studentIds = new Set();
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.studentId) studentIds.add(s.studentId);
        if (s.edsbyId) studentIds.add(s.edsbyId);
      }
    }
    if (studentIds.size === 0) return res.json({ ok: true, deleted: 0 });

    const query = { "meta.studentId": { $in: [...studentIds] } };
    if (target) {
      query.$or = [
        { "meta.title": target },
        { "meta.title": { $in: ["", null] }, "meta.assessmentType": target },
      ];
    } else {
      query["meta.title"] = { $in: ["", null] };
    }

    const result = await PublishedResult.deleteMany(query);
    console.log(`[bulk-delete] ${req.teacherEmail}: title="${target}", ${result.deletedCount} deleted`);
    return res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("POST /teacher/bulk-delete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to bulk delete." });
  }
});

/* ------------------------------------------------------------------
 *  POST /teacher/dedup
 *  Finds and removes duplicate results for the teacher's roster students.
 *  Duplicates are identified ONLY by same studentId + pdfName (source PDF).
 *  Title/subject are NOT used — multiple assignments can share the same
 *  title (e.g. several "Geo Journal" entries that are different journals).
 *  Keeps the most recent result in each group and deletes the rest.
 *  Results without pdfName (e.g. single-photo mode) are never touched.
 * ------------------------------------------------------------------ */
router.post("/teacher/dedup", teacherAuth, async (req, res) => {
  try {
    const rosters = await ClassRoster.find({ teacherEmail: req.teacherEmail }).lean();
    const studentIds = new Set();
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.studentId) studentIds.add(s.studentId);
        if (s.edsbyId) studentIds.add(s.edsbyId);
      }
    }
    if (studentIds.size === 0) return res.json({ ok: true, removed: 0, groups: 0 });

    // Fetch only results that have a pdfName (batch mode), newest first
    const allResults = await PublishedResult.find({
      "meta.studentId": { $in: [...studentIds] },
      "meta.pdfName": { $exists: true, $ne: "" },
    }).sort({ createdAt: -1 }).lean();

    // Group by studentId + pdfName
    const groups = {};
    for (const r of allResults) {
      const sid = r.meta?.studentId || "";
      const pdfName = (r.meta?.pdfName || "").trim();
      if (!pdfName) continue;
      const key = `${sid}||${pdfName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    // Find groups with more than one result — delete all but the newest
    const toDelete = [];
    let dupGroups = 0;
    for (const [, results] of Object.entries(groups)) {
      if (results.length <= 1) continue;
      dupGroups++;
      for (let i = 1; i < results.length; i++) {
        toDelete.push(results[i]._id);
      }
    }

    if (toDelete.length > 0) {
      await PublishedResult.deleteMany({ _id: { $in: toDelete } });
    }

    console.log(`[teacher-dedup] ${req.teacherEmail}: found ${dupGroups} duplicate groups, removed ${toDelete.length} older entries`);
    return res.json({ ok: true, removed: toDelete.length, groups: dupGroups });
  } catch (err) {
    console.error("POST /teacher/dedup error:", err?.message || err);
    return res.status(500).json({ error: "Failed to remove duplicates." });
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

/* ------------------------------------------------------------------
 *  POST /weekly-digest
 *  Triggers the weekly grade digest for all students with "weekly" pref.
 *  Intended to be called by a cron job / scheduled task every Saturday at 4 PM.
 *  Protected by a simple secret to prevent abuse.
 * ------------------------------------------------------------------ */
router.post("/weekly-digest", async (req, res) => {
  try {
    const secret = req.headers["x-digest-secret"] || req.body?.secret;
    if (secret !== process.env.DIGEST_SECRET && process.env.DIGEST_SECRET) {
      return res.status(403).json({ error: "Unauthorized." });
    }
    const result = await sendWeeklyDigests();
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("POST /weekly-digest error:", err?.message || err);
    return res.status(500).json({ error: "Failed to send digests." });
  }
});

export default router;
