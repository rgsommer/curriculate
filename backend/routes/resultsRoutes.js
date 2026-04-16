// routes/resultsRoutes.js
import express from "express";
import rateLimit from "express-rate-limit";
import PublishedResult from "../models/PublishedResult.js";
import FeedbackMessage from "../models/FeedbackMessage.js";
import { genAA123, normalizeCode } from "../utils/refCode.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

/**
 * Public lookup limiter: keep it *tight* to stop guessing.
 * - 10 requests / hour / IP
 * - generic message
 */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many lookup attempts. Please wait a few minutes and try again." },
});

// Optional: slightly higher limit for create endpoint (teacher side)
// (You can also protect this with your existing auth later.)
const createLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});

/**
 * POST /results
 * Body: { payload, meta?, teacherId?, sessionId? }
 * Returns: { code, expiresAt }
 */
router.post("/", createLimiter, async (req, res) => {
  try {
    const { payload, meta, teacherId, sessionId } = req.body || {};
    if (payload == null) return res.status(400).json({ error: "Missing payload." });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Retry on collision
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = genAA123();
      try {
        await PublishedResult.create({
          code,
          payload,
          meta,
          teacherId,
          sessionId,
          expiresAt,
        });
        return res.json({ code, expiresAt });
      } catch (e) {
        // Duplicate code -> retry
        if (String(e?.code) === "11000") continue;
        throw e;
      }
    }

    return res.status(503).json({ error: "Could not generate code. Try again." });
  } catch (err) {
    console.error("POST /results error:", err);
    return res.status(500).json({ error: "Server error." });
  }
});

/**
 * POST /results/feedback
 * Body: { role: "student"|"parent", message: string, refCode?: string }
 * Saves feedback from students/parents viewing results
 */
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many feedback submissions. Please wait a few minutes." },
});

router.post("/feedback", feedbackLimiter, async (req, res) => {
  try {
    const { role, message, refCode, type } = req.body || {};
    const msg = String(message || "").trim();
    if (!msg) return res.status(400).json({ error: "Missing message" });

    const validRoles = ["student", "parent"];
    const cleanRole = validRoles.includes(role) ? role : "unknown";
    const isGradeReview = type === "grade-review";

    const saved = await FeedbackMessage.create({
      message: isGradeReview
        ? `[GRADE REVIEW — ${cleanRole}] ${msg}`
        : `[Results Feedback — ${cleanRole}] ${msg}`,
      meta: {
        source: "results-page",
        role: cleanRole,
        type: isGradeReview ? "grade-review" : "feedback",
        refCode: refCode ? normalizeCode(refCode) : null,
        submittedAt: new Date().toISOString(),
      },
    });

    return res.json({ ok: true, id: saved._id });
  } catch (e) {
    console.error("POST /results/feedback error:", e);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
});

/**
 * POST /results/grade-review
 * Body: { teacherEmail, reason, refCode, role }
 * Emails the teacher with a grade review request and saves to feedback log.
 */
const gradeReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many review requests. Please wait a few minutes." },
});

router.post("/grade-review", gradeReviewLimiter, async (req, res) => {
  try {
    const { teacherEmail, reason, refCode, role, studentName, school, className, teacherName } = req.body || {};
    const email = String(teacherEmail || "").trim().toLowerCase();
    const msg = String(reason || "").trim();
    const code = refCode ? normalizeCode(refCode) : "";
    const stuName = String(studentName || "").trim();
    const schName = String(school || "").trim();
    const clsName = String(className || "").trim();
    const tchName = String(teacherName || "").trim();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return res.status(400).json({ error: "Please provide a valid teacher email address." });
    }
    if (!msg) {
      return res.status(400).json({ error: "Please explain why the grade should be reviewed." });
    }
    if (!code) {
      return res.status(400).json({ error: "Missing result code." });
    }

    const resultsUrl = `https://www.curriculate.net/results?code=${code}`;
    const cleanRole = ["student", "parent"].includes(role) ? role : "student";

    // Save to feedback log
    await FeedbackMessage.create({
      message: `[GRADE REVIEW — ${cleanRole}] Teacher: ${tchName || email} | Student: ${stuName || "unknown"} | Code: ${code} | Reason: ${msg}`,
      meta: {
        source: "results-page",
        type: "grade-review",
        role: cleanRole,
        teacherEmail: email,
        teacherName: tchName,
        studentName: stuName,
        school: schName,
        className: clsName,
        refCode: code,
        submittedAt: new Date().toISOString(),
      },
    });

    // Build context line for the email
    const contextParts = [];
    if (schName) contextParts.push(schName);
    if (clsName) contextParts.push(clsName);
    const contextLine = contextParts.length ? contextParts.join(" · ") : "";
    const esc = (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Send email to teacher
    try {
      await sendSystemEmail({
        to: email,
        subject: `Grade review request from ${stuName || "a student"} — ${code}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
              <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">Curriculate</div>
              <div style="font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 4px;">Grade Review Request</div>
            </div>

            <div style="background: #ffffff; padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
              <!-- Greeting -->
              <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b; line-height: 1.6;">
                Hi${tchName ? " " + esc(tchName) : ""},
              </p>
              <p style="margin: 0 0 20px; font-size: 15px; color: #1e293b; line-height: 1.6;">
                ${stuName ? "<strong>" + esc(stuName) + "</strong>" : "A " + cleanRole} has submitted a request to review their grade for result <strong>${code}</strong>${contextLine ? " in <strong>" + esc(contextLine) + "</strong>" : ""}.
              </p>

              <!-- Reason card -->
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
                <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Reason for review</div>
                <div style="font-size: 14px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${esc(msg)}</div>
              </div>

              <!-- Student info -->
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 6px 12px 6px 0; font-size: 13px; color: #64748b; width: 110px;">Student</td>
                  <td style="padding: 6px 0; font-size: 14px; color: #1e293b; font-weight: 600;">${esc(stuName || "Not provided")}</td>
                </tr>
                ${schName ? `<tr>
                  <td style="padding: 6px 12px 6px 0; font-size: 13px; color: #64748b;">School</td>
                  <td style="padding: 6px 0; font-size: 14px; color: #1e293b;">${esc(schName)}</td>
                </tr>` : ""}
                ${clsName ? `<tr>
                  <td style="padding: 6px 12px 6px 0; font-size: 13px; color: #64748b;">Class / Subject</td>
                  <td style="padding: 6px 0; font-size: 14px; color: #1e293b;">${esc(clsName)}</td>
                </tr>` : ""}
                <tr>
                  <td style="padding: 6px 12px 6px 0; font-size: 13px; color: #64748b;">Result code</td>
                  <td style="padding: 6px 0; font-size: 14px; color: #1e293b; font-weight: 600;">${code}</td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="text-align: center; margin-bottom: 8px;">
                <a href="${resultsUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
                  View result ${code}
                </a>
              </div>
            </div>

            <!-- Footer -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; padding: 18px 24px; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                This email was sent via <a href="https://www.curriculate.net" style="color: #2563eb; text-decoration: none; font-weight: 600;">Curriculate</a> because a ${cleanRole} requested a grade review.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                If you did not expect this message, you can safely ignore it.
              </p>
            </div>
          </div>
        `,
      });
      console.log(`[grade-review] Email sent to ${email} for code ${code} from ${stuName || "anonymous"}`);
    } catch (emailErr) {
      console.error("[grade-review] Email send failed:", emailErr.message);
      // Still return success — the review is saved in the DB even if email fails
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /results/grade-review error:", e);
    return res.status(500).json({ error: "Failed to submit review request." });
  }
});

/**
 * GET /results/:code
 * Returns: { payload, meta, createdAt, expiresAt } or generic not found
 */
router.get("/:code", lookupLimiter, async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    if (code.length !== 5) return res.status(404).json({ error: "Code not found." });

    const doc = await PublishedResult.findOneAndUpdate(
      { code },
      { $inc: { viewCount: 1 }, $set: { lastViewedAt: new Date() } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: "Code not found." });

    // TTL will remove expired docs, but keep this as belt + suspenders.
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
      return res.status(404).json({ error: "Code not found." });
    }

    return res.json({
      payload: doc.payload,
      meta: doc.meta || null,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
      viewCount: doc.viewCount || 1,
    });
  } catch (err) {
    console.error("GET /results/:code error:", err);
    return res.status(500).json({ error: "Server error." });
  }
});

export default router;
