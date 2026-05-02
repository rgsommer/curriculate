// backend/routes/demo.js
// Conference demo + classroom practice endpoints:
// lead registration, results capture, email, teacher activity dashboard
import express from "express";
import rateLimit from "express-rate-limit";
import ConferenceLead from "../models/ConferenceLead.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  Rate limiters                                                      */
/* ------------------------------------------------------------------ */

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: "Too many registrations, please try again later" },
});

const resultsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Too many submissions, please try again later" },
});

/* ------------------------------------------------------------------ */
/*  Points config                                                      */
/* ------------------------------------------------------------------ */

// Points per task type (some types are harder / more engaging)
const TASK_POINTS = {
  "multiple-choice": 10,
  "true-false": 10,
  "short-answer": 15,
  sort: 15,
  sequence: 15,
  matching: 15,
  flashcards: 10,
  "flashcards-race": 20,
  timeline: 15,
  vennsort: 20,
  "brain-blitz": 25,
  "open-text": 15,
  "hangman-duel": 20,
  "speed-draw": 25,
  "pet-feeding": 15,
  spinner: 10,
  trivia: 15,
  riddle: 20,
  "tower-builder": 20,
  "reading-comp": 20,
  "diff-detective": 20,
  "echo-chain": 15,
  "word-weaver-duel": 20,
  "body-break": 10,
  "mind-mapper": 20,
};

const DEFAULT_POINTS = 10;

function getTaskPoints(taskType) {
  return TASK_POINTS[taskType] || DEFAULT_POINTS;
}

/* ------------------------------------------------------------------ */
/*  POST /register                                                     */
/*  Captures name, email, role for a conference/classroom visitor       */
/* ------------------------------------------------------------------ */

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, role, conference, source, classroom } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Upsert: if same email + conference already exists, update name/role
    const lead = await ConferenceLead.findOneAndUpdate(
      { email: email.toLowerCase().trim(), conference: conference || "general" },
      {
        $set: {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          role: role || "",
          source: source || "conference",
          classroom: classroom || "",
          conference: conference || "general",
        },
        $setOnInsert: { registeredAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // Return the points config so the client can show points per task
    res.json({ ok: true, leadId: lead._id, taskPoints: TASK_POINTS });
  } catch (err) {
    console.error("[demo/register] Error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /results                                                      */
/*  Stores task results for a lead and sends the results email         */
/* ------------------------------------------------------------------ */

router.post("/results", resultsLimiter, async (req, res) => {
  try {
    const { email, results, conference, source } = req.body;

    if (!email || !results) {
      return res.status(400).json({ error: "Email and results are required" });
    }

    // Calculate total points
    let totalPoints = 0;
    const scoredResults = results.map((r) => {
      const pts = r.skipped ? 0 : getTaskPoints(r.taskType);
      totalPoints += pts;
      return { ...r, points: pts };
    });

    const lead = await ConferenceLead.findOneAndUpdate(
      { email: email.toLowerCase().trim(), conference: conference || "general" },
      {
        $set: {
          results: scoredResults,
          totalPoints,
          resultsSentAt: new Date(),
        },
      },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ error: "Lead not found — register first" });
    }

    // Send results email (fire-and-forget)
    sendDemoResultsEmail(lead).catch((err) =>
      console.error("[demo/results] Email send failed:", err.message)
    );

    res.json({ ok: true, totalPoints });
  } catch (err) {
    console.error("[demo/results] Error:", err.message);
    res.status(500).json({ error: "Failed to save results" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /activity                                                      */
/*  Teacher dashboard: list student activity, filterable by source/    */
/*  classroom. Auth via query param or teacher token.                  */
/* ------------------------------------------------------------------ */

router.get("/activity", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.classroom) filter.classroom = req.query.classroom;
    if (req.query.conference) filter.conference = req.query.conference;

    const leads = await ConferenceLead.find(filter)
      .sort({ totalPoints: -1, createdAt: -1 })
      .limit(Number(req.query.limit) || 500)
      .lean();

    // Summary stats
    const totalStudents = leads.length;
    const totalCompleted = leads.reduce(
      (sum, l) => sum + (l.results || []).filter((r) => !r.skipped).length,
      0
    );
    const avgPoints =
      totalStudents > 0
        ? Math.round(leads.reduce((s, l) => s + (l.totalPoints || 0), 0) / totalStudents)
        : 0;

    // Unique classrooms
    const classrooms = [...new Set(leads.map((l) => l.classroom).filter(Boolean))];

    res.json({
      ok: true,
      count: totalStudents,
      totalCompleted,
      avgPoints,
      classrooms,
      leads: leads.map((l) => ({
        name: l.name,
        email: l.email,
        role: l.role,
        source: l.source,
        classroom: l.classroom,
        totalPoints: l.totalPoints || 0,
        tasksCompleted: (l.results || []).filter((r) => !r.skipped).length,
        tasksSkipped: (l.results || []).filter((r) => r.skipped).length,
        totalTasks: (l.results || []).length,
        registeredAt: l.registeredAt,
        resultsSentAt: l.resultsSentAt,
        results: l.results || [],
      })),
    });
  } catch (err) {
    console.error("[demo/activity] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /leaderboard                                                   */
/*  Public leaderboard for a classroom — no auth, just classroom code  */
/* ------------------------------------------------------------------ */

router.get("/leaderboard", async (req, res) => {
  try {
    const { classroom, conference } = req.query;
    if (!classroom) {
      return res.status(400).json({ error: "classroom parameter is required" });
    }

    const leads = await ConferenceLead.find({
      classroom,
      conference: conference || "general",
      "results.0": { $exists: true }, // only users who have results
    })
      .sort({ totalPoints: -1 })
      .limit(100)
      .select("name totalPoints results")
      .lean();

    res.json({
      ok: true,
      classroom,
      leaderboard: leads.map((l, i) => ({
        rank: i + 1,
        name: l.name,
        points: l.totalPoints || 0,
        tasksCompleted: (l.results || []).filter((r) => !r.skipped).length,
      })),
    });
  } catch (err) {
    console.error("[demo/leaderboard] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /feedback-summary                                              */
/*  Aggregates per-task-type feedback from all students                 */
/* ------------------------------------------------------------------ */

router.get("/feedback-summary", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const leads = await ConferenceLead.find({ "results.0": { $exists: true } })
      .select("results name")
      .lean();

    // Aggregate feedback by task type
    const byType = {};
    const allComments = [];

    for (const lead of leads) {
      for (const r of lead.results || []) {
        if (r.skipped || !r.feedback) continue;

        const tt = r.taskType;
        if (!byType[tt]) {
          byType[tt] = { taskType: tt, title: r.title, funSum: 0, claritySum: 0, count: 0 };
        }
        byType[tt].funSum += r.feedback.fun || 0;
        byType[tt].claritySum += r.feedback.clarity || 0;
        byType[tt].count += 1;

        if (r.feedback.confusing) {
          allComments.push({
            taskType: tt,
            title: r.title,
            type: "confusing",
            text: r.feedback.confusing,
            from: lead.name,
          });
        }
        if (r.feedback.suggestion) {
          allComments.push({
            taskType: tt,
            title: r.title,
            type: "suggestion",
            text: r.feedback.suggestion,
            from: lead.name,
          });
        }
      }
    }

    // Compute averages
    const summary = Object.values(byType)
      .map((t) => ({
        taskType: t.taskType,
        title: t.title,
        avgFun: t.count > 0 ? Math.round((t.funSum / t.count) * 10) / 10 : 0,
        avgClarity: t.count > 0 ? Math.round((t.claritySum / t.count) * 10) / 10 : 0,
        responseCount: t.count,
      }))
      .sort((a, b) => a.avgFun - b.avgFun); // worst-rated first for attention

    res.json({
      ok: true,
      summary,
      comments: allComments,
      totalResponses: Object.values(byType).reduce((s, t) => s + t.count, 0),
    });
  } catch (err) {
    console.error("[demo/feedback-summary] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch feedback summary" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /points-config                                                 */
/*  Returns the points-per-task-type map for frontend display          */
/* ------------------------------------------------------------------ */

router.get("/points-config", (_req, res) => {
  res.json({ ok: true, taskPoints: TASK_POINTS, defaultPoints: DEFAULT_POINTS });
});

/* ------------------------------------------------------------------ */
/*  GET /leads (legacy admin endpoint)                                 */
/* ------------------------------------------------------------------ */

router.get("/leads", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const leads = await ConferenceLead.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ ok: true, count: leads.length, leads });
  } catch (err) {
    console.error("[demo/leads] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

/* ------------------------------------------------------------------ */
/*  RESULTS EMAIL                                                      */
/* ------------------------------------------------------------------ */

async function sendDemoResultsEmail(lead) {
  const completed = lead.results.filter((r) => !r.skipped);
  const skipped = lead.results.filter((r) => r.skipped);
  const firstName = (lead.name || "").split(" ")[0] || "there";
  const isClassroom = lead.source === "classroom";

  // Build task result rows
  const taskRows = lead.results
    .map((r) => {
      const icon = r.skipped ? "⏭️" : "✅";
      const status = r.skipped ? "Skipped" : "Completed";
      const statusColor = r.skipped ? "#94a3b8" : "#16a34a";
      const pts = r.points || 0;
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #334155;">
            ${icon} ${esc(r.title || r.taskType)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">
            ${esc(r.taskType)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 600; color: ${statusColor};">
            ${status}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 800; color: ${pts > 0 ? '#f59e0b' : '#cbd5e1'}; text-align: center;">
            ${pts > 0 ? `+${pts}` : "—"}
          </td>
        </tr>`;
    })
    .join("");

  // Promo section (only for conference visitors, not students)
  const promoSection = isClassroom
    ? ""
    : `
        <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <div style="font-size: 14px; color: #92400e; font-weight: 600; margin-bottom: 8px;">🎉 Exclusive Conference Offer</div>
          <div style="font-size: 22px; font-weight: 900; color: #78350f; margin-bottom: 4px;">1 Month Free</div>
          <div style="font-size: 13px; color: #92400e; margin-bottom: 16px;">Use promo code at signup:</div>
          <div style="display: inline-block; background: #ffffff; border: 2px dashed #f59e0b; border-radius: 10px; padding: 10px 24px; font-size: 22px; font-weight: 900; color: #78350f; letter-spacing: 2px;">
            ${esc(lead.promoCode || "CONFERENCE2025")}
          </div>
        </div>

        <div style="text-align: center; margin-bottom: 8px;">
          <a href="https://www.curriculate.net/pricing?promo=${encodeURIComponent(lead.promoCode || "CONFERENCE2025")}&ref=demo" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 16px;">
            Start Your Free Month →
          </a>
        </div>`;

  const greeting = isClassroom
    ? `Hey ${esc(firstName)}! Here's a summary of your practice session:`
    : `Hey ${esc(firstName)}! 👋 Thanks for trying Curriculate at the conference. Here's a summary of your demo session:`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
        <div style="font-size: 28px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">Curriculate</div>
        <div style="font-size: 14px; color: rgba(255,255,255,0.8); margin-top: 6px;">${isClassroom ? "Your Practice Results" : "Your Demo Results"}</div>
      </div>

      <!-- Body -->
      <div style="padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
        <p style="margin: 0 0 20px; font-size: 16px; color: #1e293b; line-height: 1.6;">
          ${greeting}
        </p>

        <!-- Stats card -->
        <div style="display: flex; gap: 12px; margin-bottom: 24px;">
          <div style="flex: 1; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #16a34a;">${completed.length}</div>
            <div style="font-size: 12px; color: #15803d; font-weight: 600;">Completed</div>
          </div>
          <div style="flex: 1; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #f59e0b;">${lead.totalPoints || 0}</div>
            <div style="font-size: 12px; color: #d97706; font-weight: 600;">Points</div>
          </div>
          <div style="flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #2563eb;">${lead.results.length}</div>
            <div style="font-size: 12px; color: #3b82f6; font-weight: 600;">Total Tasks</div>
          </div>
        </div>

        <!-- Results table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Task</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Type</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Status</th>
              <th style="padding: 10px 12px; text-align: center; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Pts</th>
            </tr>
          </thead>
          <tbody>
            ${taskRows}
          </tbody>
        </table>

        ${promoSection}
      </div>

      <!-- Footer -->
      <div style="background: #f8fafc; border-radius: 0 0 16px 16px; padding: 20px 24px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          Curriculate — AI-powered interactive learning for classrooms<br/>
          <a href="https://www.curriculate.net" style="color: #3b82f6; text-decoration: none;">curriculate.net</a>
        </p>
      </div>
    </div>
  `;

  const subject = isClassroom
    ? `Your Curriculate Practice Results — ${lead.totalPoints || 0} points!`
    : `Your Curriculate Demo Results 🎯 + Free Month Offer`;

  await sendSystemEmail({ to: lead.email, subject, html });

  console.log(`[demo] ✅ Results email sent to ${lead.email} (${lead.source}, ${lead.totalPoints} pts)`);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default router;
