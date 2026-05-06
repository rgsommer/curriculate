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
  // Core Q&A
  "multiple-choice": 10,
  "physical-multiple-choice": 10,
  "true-false": 10,
  "short-answer": 15,
  "reading-comp": 20,
  "open-text": 15,

  // Ordering / drag-and-drop
  sort: 15,
  sequence: 15,
  matching: 15,
  timeline: 15,
  vennsort: 20,

  // Visual / creative
  draw: 20,
  mime: 15,
  photo: 15,
  "make-and-snap": 20,
  "photo-journal": 20,
  "speed-draw": 25,
  "draw-mime": 20,

  // Movement / physical
  "body-break": 10,
  "musical-chairs": 15,
  "motion-mission": 15,
  "mad-dash": 15,
  "mad-dash-sequence": 15,

  // Pre-task / interstitial
  "mood-checkin": 5,
  "team-selfie": 10,
  "treasure-runner": 15,

  // Competitive / games
  "brain-blitz": 25,
  "true-false-tictactoe": 20,
  "true-false-connect-four": 20,
  "tower-builder": 20,
  flashcards: 10,
  "flashcards-race": 20,
  "pet-feeding": 15,
  "diff-detective": 20,
  "hangman-duel": 20,
  "word-weaver-duel": 20,
  "guess-who": 20,
  "echo-chain": 15,
  spinner: 10,
  trivia: 15,
  riddle: 20,

  // Collaboration / discussion
  collaboration: 15,
  "live-debate": 25,
  "ai-debate-judge": 25,
  "brainstorm-battle": 20,

  // Deduction / clue-based
  "mystery-clues": 15,
  "fake-out": 20,

  // Synthesis / creative
  "brain-spark-notes": 20,
  "mind-mapper": 20,
  "narration-synthesize": 20,
  "role-play": 20,
  "role-play-deck": 20,
  "script-play": 20,

  // Language / speaking
  pronunciation: 15,
  "speech-recognition": 15,
  "record-audio": 15,

  // Writing
  letter: 20,
  "case-study": 25,

  // Observation / visual analysis
  "art-view": 20,
  "historical-doc": 20,

  // Physical / scavenger
  hidenseek: 15,

  // Storytelling
  storytelling: 25,

  // Peer editing
  "peer-editing": 20,

  // Interview (live AI conversation)
  interview: 25,

  // Cloze (fill-in-the-blank)
  cloze: 15,

  // Teach-Back (explain to younger audience)
  "teach-back": 20,
};

const DEFAULT_POINTS = 10;

function getTaskPoints(taskType) {
  return TASK_POINTS[taskType] || DEFAULT_POINTS;
}

/* ------------------------------------------------------------------ */
/*  Engagement classification                                          */
/* ------------------------------------------------------------------ */

function classifyEngagement(results, totalPoints) {
  const completed = (results || []).filter((r) => !r.skipped);
  const skipped = (results || []).filter((r) => r.skipped);
  const withFeedback = completed.filter(
    (r) => r.feedback && (r.feedback.fun > 0 || r.feedback.clarity > 0)
  );
  const avgFun = withFeedback.length
    ? withFeedback.reduce((s, r) => s + (r.feedback?.fun || 0), 0) / withFeedback.length
    : 0;
  const wroteComments = completed.some(
    (r) => r.feedback && (r.feedback.confusing || r.feedback.suggestion)
  );

  // Keener: deeply engaged
  if (completed.length >= 12 || (completed.length >= 8 && avgFun >= 3.5) || (completed.length >= 8 && wroteComments)) {
    return { label: "🌟 Keener", level: "keener", avgFun, wroteComments };
  }
  // Engaged: solid participation
  if (completed.length >= 5) {
    return { label: "👍 Engaged", level: "engaged", avgFun, wroteComments };
  }
  // Tried it: light participation
  if (completed.length >= 2) {
    return { label: "👋 Tried It", level: "tried", avgFun, wroteComments };
  }
  // Drive-by
  return { label: "🚗 Drive-by", level: "driveby", avgFun, wroteComments };
}

/* ------------------------------------------------------------------ */
/*  POST /register                                                     */
/*  Captures name, email, role for a conference/classroom visitor       */
/* ------------------------------------------------------------------ */

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const { name, email, role, conference, source, classroom, promoCode } = req.body;

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
          promoCode: promoCode || "CONFERENCE2025",
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

    // Accept adaptive points from frontend (with sanity cap per task)
    // Frontend applies 1.5× for new task types, 0.5× for repeats
    const MAX_PTS_PER_TASK = 25; // hard cap to prevent abuse
    let totalPoints = 0;
    const scoredResults = results.map((r) => {
      if (r.skipped) return { ...r, points: 0 };
      const base = getTaskPoints(r.taskType);
      // Trust frontend points if reasonable, otherwise fall back to base
      const frontendPts = typeof r.points === "number" ? r.points : 0;
      const pts = (frontendPts > 0 && frontendPts <= MAX_PTS_PER_TASK)
        ? frontendPts
        : base;
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

    // Send results email to user (fire-and-forget)
    sendDemoResultsEmail(lead).catch((err) =>
      console.error("[demo/results] Email send failed:", err.message)
    );

    // Send admin notification (fire-and-forget)
    sendAdminNotification(lead).catch((err) =>
      console.error("[demo/results] Admin email failed:", err.message)
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
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
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
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
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
/*  GET /feedback-export                                               */
/*  Plain text export of all feedback for pasting / AI review          */
/* ------------------------------------------------------------------ */

router.get("/feedback-export", async (req, res) => {
  try {
    const key = req.query.key;
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const leads = await ConferenceLead.find({ "results.0": { $exists: true } })
      .select("results name email source classroom createdAt")
      .lean();

    // Build per-task-type aggregation
    const byType = {};

    for (const lead of leads) {
      for (const r of lead.results || []) {
        if (r.skipped || !r.feedback) continue;
        const tt = r.taskType;
        if (!byType[tt]) {
          byType[tt] = { title: r.title || tt, funScores: [], clarityScores: [], comments: [] };
        }
        if (r.feedback.fun) byType[tt].funScores.push(r.feedback.fun);
        if (r.feedback.clarity) byType[tt].clarityScores.push(r.feedback.clarity);
        if (r.feedback.confusing) {
          byType[tt].comments.push(`  [CONFUSING] "${r.feedback.confusing}" — ${lead.name}`);
        }
        if (r.feedback.suggestion) {
          byType[tt].comments.push(`  [SUGGESTION] "${r.feedback.suggestion}" — ${lead.name}`);
        }
      }
    }

    // Sort by worst fun rating first
    const sorted = Object.entries(byType).sort((a, b) => {
      const avgA = a[1].funScores.length ? a[1].funScores.reduce((s, v) => s + v, 0) / a[1].funScores.length : 5;
      const avgB = b[1].funScores.length ? b[1].funScores.reduce((s, v) => s + v, 0) / b[1].funScores.length : 5;
      return avgA - avgB;
    });

    const lines = [
      "=== CURRICULATE DEMO/PRACTICE FEEDBACK REPORT ===",
      `Generated: ${new Date().toISOString()}`,
      `Total testers: ${leads.length}`,
      `Task types with feedback: ${sorted.length}`,
      "",
    ];

    for (const [taskType, data] of sorted) {
      const avgFun = data.funScores.length
        ? (data.funScores.reduce((s, v) => s + v, 0) / data.funScores.length).toFixed(1)
        : "N/A";
      const avgClarity = data.clarityScores.length
        ? (data.clarityScores.reduce((s, v) => s + v, 0) / data.clarityScores.length).toFixed(1)
        : "N/A";

      lines.push(`--- ${taskType} (${data.title}) ---`);
      lines.push(`  Responses: ${data.funScores.length} | Fun: ${avgFun}/5 | Clarity: ${avgClarity}/5`);
      if (data.comments.length > 0) {
        lines.push("  Comments:");
        data.comments.forEach((c) => lines.push(`    ${c}`));
      }
      lines.push("");
    }

    res.type("text/plain").send(lines.join("\n"));
  } catch (err) {
    console.error("[demo/feedback-export] Error:", err.message);
    res.status(500).json({ error: "Failed to export feedback" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /feedback-clear                                               */
/*  Strips all feedback fields from ConferenceLead results             */
/* ------------------------------------------------------------------ */

router.post("/feedback-clear", feedbackClearHandler);
router.get("/feedback-clear", feedbackClearHandler);

async function feedbackClearHandler(req, res) {
  try {
    const key = req.query.key || req.body?.key;
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await ConferenceLead.updateMany(
      { "results.feedback": { $exists: true } },
      { $unset: { "results.$[].feedback": 1 } }
    );

    res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("[demo/feedback-clear] Error:", err.message);
    res.status(500).json({ error: "Failed to clear feedback" });
  }
}

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
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
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
/*  ADMIN NOTIFICATION EMAIL                                           */
/*  Sent to admin@curriculate.net for every conference/practice run    */
/* ------------------------------------------------------------------ */

async function sendAdminNotification(lead) {
  const completed = (lead.results || []).filter((r) => !r.skipped);
  const skipped = (lead.results || []).filter((r) => r.skipped);
  const engagement = classifyEngagement(lead.results, lead.totalPoints);
  const isClassroom = lead.source === "classroom";
  const wasOfferedReferral = engagement.level === "keener" && !isClassroom;

  // ── Build leaderboard: all students who have submitted results ──
  let leaderboardHtml = "";
  try {
    const filter = { totalPoints: { $gt: 0 } };
    // Scope to classroom if applicable
    if (isClassroom && lead.classroom) filter.classroom = lead.classroom;
    else if (!isClassroom && lead.conference) filter.conference = lead.conference;

    const allLeads = await ConferenceLead.find(filter)
      .sort({ totalPoints: -1, createdAt: 1 })
      .limit(50)
      .lean();

    if (allLeads.length > 0) {
      const rows = allLeads.map((l, i) => {
        const rank = i + 1;
        const isCurrent = String(l._id) === String(lead._id);
        const tasksCompleted = (l.results || []).filter((r) => !r.skipped).length;
        const uniqueTypes = new Set((l.results || []).filter((r) => !r.skipped).map((r) => r.taskType)).size;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
        const rowBg = isCurrent ? "#fefce8" : (i % 2 === 0 ? "#fff" : "#f8fafc");
        const nameBold = isCurrent ? "font-weight:900;color:#b45309;" : "font-weight:600;";
        const arrow = isCurrent ? " ← just submitted" : "";

        return `<tr style="background:${rowBg};">
          <td style="padding:6px 10px;font-size:14px;text-align:center;width:36px;">${medal}</td>
          <td style="padding:6px 10px;font-size:14px;${nameBold}">${esc(l.name)}${arrow}</td>
          <td style="padding:6px 10px;font-size:14px;font-weight:800;color:#f59e0b;text-align:center;">${l.totalPoints || 0}</td>
          <td style="padding:6px 10px;font-size:13px;color:#64748b;text-align:center;">${tasksCompleted}</td>
          <td style="padding:6px 10px;font-size:13px;color:#64748b;text-align:center;">${uniqueTypes}</td>
        </tr>`;
      }).join("");

      const scopeLabel = isClassroom && lead.classroom ? esc(lead.classroom) : "All Students";
      leaderboardHtml = `
      <div style="background:#fff;padding:16px 24px;border:1px solid #e2e8f0;border-top:none;">
        <div style="font-weight:900;font-size:14px;margin-bottom:10px;color:#1e293b;">Leaderboard — ${scopeLabel} (${allLeads.length} student${allLeads.length !== 1 ? "s" : ""})</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:6px 10px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;">#</th>
              <th style="padding:6px 10px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;">Name</th>
              <th style="padding:6px 10px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;">Pts</th>
              <th style="padding:6px 10px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;">Tasks</th>
              <th style="padding:6px 10px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;">Types</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }
  } catch (err) {
    console.error("[demo/admin-email] Leaderboard query failed:", err.message);
    // Non-fatal — send email without leaderboard
  }

  // Reward recommendation for practice students
  let rewardNote = "";
  if (isClassroom) {
    if (lead.totalPoints >= 500) {
      rewardNote = "🏆 Outstanding — consider a $10 Tim's card";
    } else if (lead.totalPoints >= 300) {
      rewardNote = "⭐ Strong effort — consider recognition or small reward";
    } else if (lead.totalPoints >= 150) {
      rewardNote = "👍 Good participation";
    } else {
      rewardNote = "Getting started";
    }
  }

  // Feedback highlights
  const comments = [];
  for (const r of completed) {
    if (r.feedback?.confusing) {
      comments.push(`<span style="color:#dc2626;">[confusing]</span> ${esc(r.taskType)}: "${esc(r.feedback.confusing)}"`);
    }
    if (r.feedback?.suggestion) {
      comments.push(`<span style="color:#16a34a;">[suggestion]</span> ${esc(r.taskType)}: "${esc(r.feedback.suggestion)}"`);
    }
  }

  const modeLabel = isClassroom ? "🎓 Practice" : "🎯 Conference";
  const subjectLine = `${engagement.label} ${isClassroom ? "Student" : "Visitor"}: ${lead.name} (${lead.totalPoints} pts)`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 20px 24px; border-radius: 16px 16px 0 0; color: #fff;">
        <div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px;">${modeLabel} Completion</div>
        <div style="font-size: 22px; font-weight: 900; margin-top: 4px;">${esc(lead.name)}</div>
        <div style="font-size: 13px; opacity: 0.7; margin-top: 2px;">${esc(lead.email)}${lead.role ? ` · ${esc(lead.role)}` : ""}</div>
      </div>

      <div style="background: #fff; padding: 20px 24px; border: 1px solid #e2e8f0; border-top: none;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Engagement</td>
            <td style="padding: 8px 0; font-weight: 800; text-align: right; font-size: 16px;">${engagement.label}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Points</td>
            <td style="padding: 8px 0; font-weight: 800; text-align: right; color: #f59e0b; font-size: 16px;">${lead.totalPoints}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Tasks</td>
            <td style="padding: 8px 0; text-align: right;">${completed.length} completed, ${skipped.length} skipped</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Avg Fun</td>
            <td style="padding: 8px 0; text-align: right;">${engagement.avgFun ? engagement.avgFun.toFixed(1) + "/5" : "N/A"}</td>
          </tr>
          ${!isClassroom ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Referral Offered</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 700; color: ${wasOfferedReferral ? "#16a34a" : "#94a3b8"};">
              ${wasOfferedReferral ? "✅ Yes — Ambassador popup shown" : "No"}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Promo Code</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 700;">${esc(lead.promoCode || "CONFERENCE2025")}</td>
          </tr>
          ` : ""}
          ${isClassroom ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Classroom</td>
            <td style="padding: 8px 0; text-align: right;">${esc(lead.classroom || "—")}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Reward</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 700;">${rewardNote}</td>
          </tr>
          ` : ""}
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Source</td>
            <td style="padding: 8px 0; text-align: right;">${esc(lead.source)} · ${esc(lead.conference || "general")}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Wrote Comments</td>
            <td style="padding: 8px 0; text-align: right;">${engagement.wroteComments ? "✅ Yes" : "No"}</td>
          </tr>
        </table>
      </div>

      ${comments.length > 0 ? `
      <div style="background: #f8fafc; padding: 16px 24px; border: 1px solid #e2e8f0; border-top: none;">
        <div style="font-weight: 800; font-size: 13px; margin-bottom: 8px; color: #334155;">Feedback Comments:</div>
        ${comments.map((c) => `<div style="font-size: 13px; margin-bottom: 6px; line-height: 1.4;">${c}</div>`).join("")}
      </div>
      ` : ""}

      ${leaderboardHtml}

      <div style="background: #f1f5f9; padding: 12px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
        <div style="font-size: 11px; color: #94a3b8; text-align: center;">
          Curriculate Demo Admin · ${new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" })}
        </div>
      </div>
    </div>
  `;

  await sendSystemEmail({
    to: "admin@curriculate.net",
    subject: subjectLine,
    html,
  });
}

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
