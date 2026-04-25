// backend/routes/adminTeacherOutreach.js
import express from "express";
import { requireAdminToken } from "../middleware/requireAdminToken.js";
import TeacherOutreach from "../models/TeacherOutreach.js";
import FeedbackMessage from "../models/FeedbackMessage.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Email templates                                                    */
/* ------------------------------------------------------------------ */
const TEMPLATES = {
  "thanks": {
    label: "Thanks for using Curriculate",
    subject: "Thank you for using Curriculate!",
    build: ({ teacherName }) => `
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Hi${teacherName ? " " + esc(teacherName) : ""},
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        We just wanted to drop a quick note to say <strong>thank you</strong> for using Curriculate in your classroom. It means the world to us when teachers trust our platform to help their students learn.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        We're constantly improving based on feedback from educators like you. If you ever have ideas, questions, or just want to share how things are going, we'd love to hear from you — simply reply to this email.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Thank you for making a difference in your students' learning journey!
      </p>
    `,
  },
  "new-features": {
    label: "New features announcement",
    subject: "What's new on Curriculate",
    build: ({ teacherName }) => `
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Hi${teacherName ? " " + esc(teacherName) : ""},
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        We've been busy building new features to make Curriculate even better for your classroom. Here's what's new:
      </p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;color:#1e293b;line-height:1.8;">
        <li><strong>Mystery Box mode</strong> — students pick surprise tasks from an interactive grid</li>
        <li><strong>Brain Blitz</strong> — voice-powered clue-guessing game that keeps energy high</li>
        <li><strong>Grade review requests</strong> — students can politely request a second look at their grade</li>
        <li><strong>Team selfies</strong> — capture team photos at the start of each session</li>
      </ul>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        We'd love for you to try these out with your students. As always, your feedback helps us build the right things — just reply to this email anytime.
      </p>
    `,
  },
  "grade-review-followup": {
    label: "Grade review follow-up",
    subject: "A student is waiting for your grade review",
    build: ({ teacherName }) => `
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Hi${teacherName ? " " + esc(teacherName) : ""},
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        This is a friendly follow-up — one or more of your students submitted a grade review request through Curriculate. If you haven't had a chance to look at it yet, the student would really appreciate a response.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        You can find the original request in your inbox (search for "Grade review request" from Curriculate), or visit <a href="https://www.curriculate.net" style="color:#2563eb;text-decoration:none;font-weight:600;">curriculate.net</a> to view student results.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Thank you for being responsive to your students!
      </p>
    `,
  },
  "invitation": {
    label: "Invitation to use Curriculate",
    subject: "You're invited to try Curriculate for your classroom",
    build: ({ teacherName }) => `
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Hi${teacherName ? " " + esc(teacherName) : ""},
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        One of your students recently used <strong>Curriculate</strong> — a platform that turns any lesson into an engaging, team-based classroom activity with Pulse grading and instant feedback.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        We'd love for you to experience it firsthand. Here's what teachers are using Curriculate for:
      </p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;color:#1e293b;line-height:1.8;">
        <li>Running interactive review sessions before tests</li>
        <li>Group activities with real-time progress tracking</li>
        <li>Pulse — grading that saves hours of marking</li>
        <li>Detailed student reports with actionable feedback</li>
      </ul>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Getting started is free — just visit <a href="https://www.curriculate.net" style="color:#2563eb;text-decoration:none;font-weight:600;">curriculate.net</a> and create your first activity in minutes.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        If you have any questions, just reply to this email. We're here to help!
      </p>
    `,
  },
  "referral": {
    label: "Referral campaign",
    subject: "Share Curriculate with 3 teachers, get 3 months free!",
    build: ({ teacherName }) => `
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Hi${teacherName ? " " + esc(teacherName) : ""},
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        You're already using Curriculate to create engaging classroom activities — and we'd love to help you share that experience with your colleagues.
      </p>
      <div style="margin:0 0 20px;padding:20px 24px;background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;text-align:center;">
        <div style="font-size:18px;font-weight:800;color:#1e293b;margin-bottom:6px;">Refer 3 Teachers → Get 3 Months Free</div>
        <div style="font-size:14px;color:#4b5563;line-height:1.5;">
          When 3 teachers you refer sign up and run their first activity, you'll automatically receive <strong>3 months of Curriculate Pro</strong> — completely free.
        </div>
      </div>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        <strong>How it works:</strong>
      </p>
      <ol style="margin:0 0 16px;padding-left:20px;font-size:15px;color:#1e293b;line-height:1.8;">
        <li>Share your love of Curriculate with fellow teachers</li>
        <li>Ask them to mention your name when they sign up</li>
        <li>Once 3 teachers run their first activity, your free months kick in automatically</li>
      </ol>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Know someone who'd love this? Simply forward this email or tell them to visit <a href="https://www.curriculate.net" style="color:#2563eb;text-decoration:none;font-weight:600;">curriculate.net</a>.
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;">
        Thank you for helping us grow the Curriculate community!
      </p>
    `,
  },
  "custom": {
    label: "Custom message",
    subject: "A message from Curriculate",
    build: ({ customBody }) => `
      <div style="margin:0 0 16px;font-size:15px;color:#1e293b;line-height:1.6;white-space:pre-wrap;">${esc(customBody || "")}</div>
    `,
  },
};

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapInBrandedEmail(bodyHtml) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
        <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">Curriculate</div>
      </div>
      <div style="background: #ffffff; padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
        ${bodyHtml}
        <p style="margin:24px 0 0;font-size:15px;color:#1e293b;line-height:1.6;">
          Warm regards,<br/>
          <strong>The Curriculate Team</strong>
        </p>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; padding: 18px 24px; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          <a href="https://www.curriculate.net" style="color: #2563eb; text-decoration: none; font-weight: 600;">Curriculate</a> — Engaging classroom activities with Pulse grading
        </p>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  GET /admin/teacher-outreach — list all known teachers + status     */
/* ------------------------------------------------------------------ */
router.get("/teacher-outreach", requireAdminToken, async (req, res) => {
  try {
    // Gather unique teacher emails from grade review feedback
    const reviews = await FeedbackMessage.find(
      { "meta.type": "grade-review", "meta.teacherEmail": { $exists: true, $ne: "" } },
      { "meta.teacherEmail": 1, "meta.teacherName": 1, "meta.school": 1, "meta.className": 1, "meta.studentName": 1, createdAt: 1 }
    ).sort({ createdAt: -1 }).lean();

    // Build teacher map from reviews
    const teacherMap = new Map();
    for (const r of reviews) {
      const email = (r.meta?.teacherEmail || "").toLowerCase().trim();
      if (!email) continue;
      if (!teacherMap.has(email)) {
        teacherMap.set(email, {
          email,
          teacherName: r.meta?.teacherName || "",
          schools: new Set(),
          classes: new Set(),
          reviewCount: 0,
          firstSeen: r.createdAt,
        });
      }
      const t = teacherMap.get(email);
      t.reviewCount++;
      if (r.meta?.school) t.schools.add(r.meta.school);
      if (r.meta?.className) t.classes.add(r.meta.className);
      if (!t.teacherName && r.meta?.teacherName) t.teacherName = r.meta.teacherName;
    }

    // Merge with outreach records (contact history)
    const outreachRecords = await TeacherOutreach.find({}).lean();
    const outreachMap = new Map();
    const hiddenEmails = new Set();
    for (const o of outreachRecords) {
      const em = o.email.toLowerCase();
      if (o.hidden) { hiddenEmails.add(em); continue; }
      outreachMap.set(em, o);
    }

    const teachers = [];
    for (const [email, info] of teacherMap) {
      if (hiddenEmails.has(email)) continue; // skip deleted teachers
      const outreach = outreachMap.get(email);
      teachers.push({
        email,
        teacherName: info.teacherName || outreach?.teacherName || "",
        schools: [...info.schools],
        classes: [...info.classes],
        reviewCount: info.reviewCount,
        firstSeen: info.firstSeen,
        lastContactedAt: outreach?.lastContactedAt || null,
        emailsSent: outreach?.emails?.length || 0,
        source: outreach?.source || "grade-review",
      });
    }

    // Include TeacherOutreach records that have no grade reviews (e.g. grading-email senders)
    for (const [email, outreach] of outreachMap) {
      if (!teacherMap.has(email) && !hiddenEmails.has(email)) {
        teachers.push({
          email,
          teacherName: outreach.teacherName || "",
          schools: outreach.school ? [outreach.school] : [],
          classes: [],
          reviewCount: 0,
          firstSeen: outreach.createdAt || outreach.lastContactedAt,
          lastContactedAt: outreach.lastContactedAt || null,
          emailsSent: outreach.emails?.length || 0,
          source: outreach.source || "grading-email",
        });
      }
    }

    // Sort: not-yet-contacted first, then by firstSeen desc
    teachers.sort((a, b) => {
      if (!a.lastContactedAt && b.lastContactedAt) return -1;
      if (a.lastContactedAt && !b.lastContactedAt) return 1;
      return new Date(b.firstSeen) - new Date(a.firstSeen);
    });

    return res.json({
      ok: true,
      teachers,
      templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label })),
    });
  } catch (e) {
    console.error("GET /admin/teacher-outreach error:", e);
    return res.status(500).json({ error: "Failed to load teacher outreach data" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /admin/teacher-outreach/delete — remove selected teachers     */
/* ------------------------------------------------------------------ */
router.post("/teacher-outreach/delete", requireAdminToken, async (req, res) => {
  try {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || !emails.length) {
      return res.status(400).json({ error: "No emails provided" });
    }
    const normalized = emails.map((e) => String(e).toLowerCase().trim()).filter(Boolean);
    // Remove any existing TeacherOutreach records
    await TeacherOutreach.deleteMany({ email: { $in: normalized } });
    // Mark each email as hidden so grade-review feedback entries don't resurface them
    for (const email of normalized) {
      await TeacherOutreach.findOneAndUpdate(
        { email },
        { $set: { hidden: true }, $setOnInsert: { source: "deleted" } },
        { upsert: true }
      );
    }
    return res.json({ ok: true, deleted: normalized.length });
  } catch (e) {
    console.error("POST /admin/teacher-outreach/delete error:", e);
    return res.status(500).json({ error: "Failed to delete outreach records" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /admin/teacher-outreach/send — send email to selected teachers */
/* ------------------------------------------------------------------ */
router.post("/teacher-outreach/send", requireAdminToken, async (req, res) => {
  try {
    const { emails, template, customSubject, customBody } = req.body || {};

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "No recipients selected" });
    }
    if (!template || !TEMPLATES[template]) {
      return res.status(400).json({ error: "Invalid template" });
    }

    const tmpl = TEMPLATES[template];
    const results = [];

    for (const recipient of emails) {
      const email = String(recipient.email || recipient || "").toLowerCase().trim();
      if (!email || !email.includes("@")) continue;

      const teacherName = recipient.teacherName || "";
      const subject = customSubject || tmpl.subject;
      const bodyHtml = tmpl.build({ teacherName, customBody: customBody || "" });
      const html = wrapInBrandedEmail(bodyHtml);

      try {
        await sendSystemEmail({ to: email, subject, html });

        // Upsert outreach record
        await TeacherOutreach.findOneAndUpdate(
          { email },
          {
            $set: {
              lastContactedAt: new Date(),
              teacherName: teacherName || undefined,
            },
            $setOnInsert: { source: "admin-outreach" },
            $push: {
              emails: {
                template,
                subject,
                sentAt: new Date(),
                customBody: template === "custom" ? (customBody || "") : "",
              },
            },
          },
          { upsert: true, new: true }
        );

        results.push({ email, ok: true });
        console.log(`[outreach] Sent "${template}" to ${email}`);
      } catch (sendErr) {
        console.error(`[outreach] Failed to send to ${email}:`, sendErr.message);
        results.push({ email, ok: false, error: sendErr.message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return res.json({ ok: true, sent, failed, results });
  } catch (e) {
    console.error("POST /admin/teacher-outreach/send error:", e);
    return res.status(500).json({ error: "Failed to send emails" });
  }
});

export default router;
