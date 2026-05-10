// backend/routes/demo.js
// Conference demo + classroom practice endpoints:
// lead registration, results capture, email, teacher activity dashboard
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import ConferenceLead from "../models/ConferenceLead.js";
import Recommendation from "../models/Recommendation.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const __demoDir = path.dirname(fileURLToPath(import.meta.url));
let _sampleReportBuf = null;
function getSampleReportPdf() {
  if (!_sampleReportBuf) {
    try {
      _sampleReportBuf = fs.readFileSync(
        path.resolve(__demoDir, "../../frontend/public/pdfs/Curriculate-Teacher-Report-Sample.pdf")
      );
    } catch { _sampleReportBuf = null; }
  }
  return _sampleReportBuf;
}

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

    // Accept adaptive points from frontend (with sanity cap per task).
    //
    // The frontend computes per-task points as:
    //   base × 1.5 (new task type) or × 0.5 (repeat) + feedback bonus (1, 4, or 5)
    // For typical base values (10–20), legitimate per-task points can reach
    // ~35 (20 × 1.5 + 5). The previous cap of 25 was suppressing legitimate
    // scoring AND the over-cap fallback dropped to `base` (losing the
    // multiplier AND the bonus), which manifested as user-visible
    // discrepancies between the on-screen total and the emailed total.
    //
    // New behavior: cap at a level that comfortably accommodates legitimate
    // adaptive + bonus stacking, and CLAMP to the cap when over (don't fall
    // back to `base`). Log clamping events so we can see if real abuse ever
    // happens.
    const MAX_PTS_PER_TASK = 60;
    let totalPoints = 0;
    const scoredResults = results.map((r) => {
      if (r.skipped) return { ...r, points: 0 };
      const base = getTaskPoints(r.taskType);
      const frontendPts = typeof r.points === "number" ? r.points : 0;
      let pts;
      if (frontendPts <= 0) {
        pts = base;
      } else if (frontendPts <= MAX_PTS_PER_TASK) {
        pts = frontendPts; // legitimate (most cases)
      } else {
        pts = MAX_PTS_PER_TASK;
        console.warn(
          `[demo/results] Per-task points clamped: ${frontendPts} → ${MAX_PTS_PER_TASK} ` +
            `(taskType=${r.taskType}, email=${email})`
        );
      }
      totalPoints += pts;
      return { ...r, points: pts };
    });

    // Accumulate points across sessions for the same (email, conference).
    //
    // Previously this used `$set: { totalPoints }` which threw away every
    // prior session's points the moment the same email played again — so
    // returning practicers always ranked as if they were brand-new.  We
    // now $inc totalPoints (lifetime score, drives the leaderboard) and
    // $set results to just this session's tasks (so the per-session email
    // table stays focused on what they just did).  sessionCount is a
    // small counter so the email/admin can show "session #N".
    const sessionTaskCount = scoredResults.length;
    const sessionCompletedCount = scoredResults.filter((r) => !r.skipped).length;
    const now = new Date();

    // Collect every feedback-bearing entry (real ratings, written
    // comments, or skip-dialog reasons) so we can push them onto the
    // lead's append-only feedbackEntries log.  /feedback-export reads
    // this log, so historical comments survive every replay even
    // though `results` gets overwritten with each new session for the
    // sake of the per-session email.
    const newFeedbackEntries = scoredResults
      .map((r) => {
        const fb = r.feedback || {};
        const hasContent =
          (fb.fun && fb.fun > 0) ||
          (fb.clarity && fb.clarity > 0) ||
          (fb.confusing && String(fb.confusing).trim()) ||
          (fb.suggestion && String(fb.suggestion).trim());
        if (!hasContent) return null;
        return {
          taskType: r.taskType || "",
          title: r.title || "",
          fun: Number(fb.fun) || 0,
          clarity: Number(fb.clarity) || 0,
          confusing: String(fb.confusing || "").slice(0, 1000),
          suggestion: String(fb.suggestion || "").slice(0, 1000),
          skipped: !!r.skipped,
          source: fb.source || (r.skipped ? "skip-dialog" : "rating"),
          createdAt: now,
        };
      })
      .filter(Boolean);

    const lead = await ConferenceLead.findOneAndUpdate(
      { email: email.toLowerCase().trim(), conference: conference || "general" },
      {
        $set: {
          results: scoredResults,
          resultsSentAt: now,
        },
        $inc: {
          totalPoints,
          sessionCount: 1,
          lifetimeTaskCount: sessionTaskCount,
          lifetimeCompletedCount: sessionCompletedCount,
        },
        // Append this session's subtotal + completedAt to the trail so
        // we can compute weekly leaderboards.  Capped to the last 30
        // entries.  feedbackEntries is added below conditionally.
        $push: {
          sessions: {
            $each: [
              {
                points: totalPoints,
                completedAt: now,
                completedCount: sessionCompletedCount,
                taskCount: sessionTaskCount,
              },
            ],
            $slice: -30,
          },
        },
      },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ error: "Lead not found — register first" });
    }

    // Append this session's feedback entries to the lead's append-only
    // log.  Done as a separate update so the conditional doesn't bloat
    // the main upsert.  Capped at 500 entries / lead.
    if (newFeedbackEntries.length > 0) {
      try {
        await ConferenceLead.updateOne(
          { _id: lead._id },
          {
            $push: {
              feedbackEntries: {
                $each: newFeedbackEntries,
                $slice: -500,
              },
            },
          }
        );
      } catch (e) {
        console.error("[demo/results] feedbackEntries push failed:", e.message);
      }
    }

    // Carry the per-session subtotal through to the email helpers — the
    // ConferenceLead doc now reflects lifetime totals.
    lead._sessionPoints = totalPoints;

    // Send results email to user (fire-and-forget)
    sendDemoResultsEmail(lead).catch((err) =>
      console.error("[demo/results] Email send failed:", err.message)
    );

    // Send admin notification (fire-and-forget)
    sendAdminNotification(lead).catch((err) =>
      console.error("[demo/results] Admin email failed:", err.message)
    );

    res.json({
      ok: true,
      sessionPoints: totalPoints,           // earned this session
      totalPoints: lead.totalPoints || 0,   // lifetime, after accumulation
      sessionCount: lead.sessionCount || 1,
    });
  } catch (err) {
    console.error("[demo/results] Error:", err.message);
    res.status(500).json({ error: "Failed to save results" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /orphan-feedback                                              */
/*                                                                    */
/*  Recovery endpoint for in-progress practice feedback drafts that   */
/*  the user typed but never submitted (e.g. they tapped "I'm done"   */
/*  mid-feedback or closed the browser).  The student app scans       */
/*  localStorage on session start and posts any orphaned drafts here. */
/*  Each entry appends to the lead's append-only feedbackEntries log. */
/* ------------------------------------------------------------------ */
router.post("/orphan-feedback", async (req, res) => {
  try {
    const { email, conference, entries } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "entries array is required" });
    }

    const cleaned = entries
      .map((e) => {
        const taskType = String(e?.taskType || "").trim();
        const fun = Number(e?.fun) || 0;
        const clarity = Number(e?.clarity) || 0;
        const confusing = String(e?.confusing || "").trim().slice(0, 1000);
        const suggestion = String(e?.suggestion || "").trim().slice(0, 1000);
        if (!taskType) return null;
        const hasContent =
          fun > 0 || clarity > 0 || confusing || suggestion;
        if (!hasContent) return null;
        return {
          taskType,
          title: String(e?.title || "").slice(0, 200),
          fun, clarity, confusing, suggestion,
          skipped: false,
          source: "orphan-recovery",
          createdAt: new Date(),
        };
      })
      .filter(Boolean)
      .slice(0, 50); // safety cap per call

    if (cleaned.length === 0) {
      return res.json({ ok: true, savedCount: 0 });
    }

    const lead = await ConferenceLead.findOneAndUpdate(
      {
        email: String(email).toLowerCase().trim(),
        conference: conference || "general",
      },
      {
        $push: {
          feedbackEntries: { $each: cleaned, $slice: -500 },
        },
      },
      { new: false }
    );

    if (!lead) {
      return res.status(404).json({ error: "Lead not found — register first" });
    }

    res.json({ ok: true, savedCount: cleaned.length });
  } catch (err) {
    console.error("[demo/orphan-feedback] Error:", err.message);
    res.status(500).json({ error: "Failed to recover drafts" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /nudge-inactive                                                */
/*                                                                    */
/*  Admin-triggered re-engagement.  Sends a personalized "we miss     *
/*  you, come back" email to every ConferenceLead that:               *
/*    • hasn't submitted results in the last INACTIVE_DAYS days       *
/*    • hasn't been nudged in the last NUDGE_COOLDOWN_DAYS days       *
/*                                                                    *
/*  Idempotent — safe to retap; cooldown handles dedup.  Returns      *
/*  HTML with a count + the list of recipients so the admin sees      *
/*  exactly what just went out.                                       */
/* ------------------------------------------------------------------ */
const INACTIVE_DAYS = 4;
const NUDGE_COOLDOWN_DAYS = 7;

router.get("/nudge-inactive", async (req, res) => {
  try {
    const key = req.query.key;
    const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
    if (!expected || key !== expected) {
      return res.status(401).type("html").send(
        "<h1>Unauthorized</h1><p>Token missing or wrong.</p>"
      );
    }

    const now = new Date();
    const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 86400e3);
    const cooldownCutoff = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * 86400e3);

    // Match leads who registered with an email AND haven't done anything
    // in the inactive window AND haven't been nudged in the cooldown window.
    const candidates = await ConferenceLead.find({
      email: { $exists: true, $ne: "" },
      $and: [
        {
          $or: [
            { resultsSentAt: { $exists: false } },
            { resultsSentAt: null },
            { resultsSentAt: { $lte: inactiveCutoff } },
          ],
        },
        {
          $or: [
            { lastNudgeAt: { $exists: false } },
            { lastNudgeAt: null },
            { lastNudgeAt: { $lte: cooldownCutoff } },
          ],
        },
      ],
    }).limit(200).lean();

    if (candidates.length === 0) {
      return res.type("html").send(`
        <html><body style="font-family:system-ui;padding:32px;max-width:540px;margin:0 auto;">
        <h1>No nudges sent</h1>
        <p>No practicer matched the criteria right now:
        no submission in ${INACTIVE_DAYS}+ days AND no nudge in the last
        ${NUDGE_COOLDOWN_DAYS} days.</p>
        </body></html>
      `);
    }

    // ── Compute leaderboards ONCE so every nudge can show standings ──
    const allLeads = await ConferenceLead.find({
      email: { $exists: true, $ne: "" },
    })
      .select("name email totalPoints sessions sessionCount")
      .lean();

    // Lifetime ranking
    const allTimeRanked = [...allLeads]
      .filter((l) => (l.totalPoints || 0) > 0)
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));

    // Last completed Sunday → Saturday
    const { start: weekStart, end: weekEnd } = lastCompletedWeek(now);
    const weeklyRanked = allLeads
      .map((l) => {
        const wp = (l.sessions || []).reduce((sum, s) => {
          const t = s?.completedAt ? new Date(s.completedAt).getTime() : 0;
          return t >= weekStart.getTime() && t <= weekEnd.getTime()
            ? sum + (s.points || 0)
            : sum;
        }, 0);
        return { _id: l._id, email: l.email, name: l.name, weeklyPts: wp };
      })
      .filter((r) => r.weeklyPts > 0)
      .sort((a, b) => b.weeklyPts - a.weeklyPts);

    const ord = (n) => {
      const s = ["th", "st", "nd", "rd"], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    const fmtDay = (d) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });

    let sent = 0;
    const failed = [];
    for (const lead of candidates) {
      const firstName = String(lead.name || "").split(" ")[0] || "there";
      const lifetime = Number(lead.totalPoints || 0);
      const sessions = Number(lead.sessionCount || 0);
      const lastPlayed = lead.resultsSentAt
        ? new Date(lead.resultsSentAt).toLocaleDateString("en-CA")
        : null;
      const idleDays = lead.resultsSentAt
        ? Math.floor((now - new Date(lead.resultsSentAt)) / 86400e3)
        : null;

      const allTimeRank = allTimeRanked.findIndex((l) => String(l._id) === String(lead._id));
      const allTimeRow =
        allTimeRank >= 0
          ? `<tr><td>You</td><td><b>${lifetime} pts</b></td><td>${ord(allTimeRank + 1)} of ${allTimeRanked.length}</td></tr>`
          : `<tr><td>You</td><td><b>${lifetime} pts</b></td><td>Unranked yet</td></tr>`;
      const allTimeTop3 = allTimeRanked.slice(0, 3).map((l, i) => {
        const isMe = String(l._id) === String(lead._id);
        const medal = ["🥇", "🥈", "🥉"][i];
        return `<tr style="${isMe ? "background:#fef9c3;" : ""}"><td>${medal} ${esc(l.name)}${isMe ? " (you)" : ""}</td><td><b>${l.totalPoints || 0} pts</b></td><td>${ord(i + 1)}</td></tr>`;
      }).join("");

      const weeklyEntry = weeklyRanked.find((r) => String(r._id) === String(lead._id));
      const weeklyRank = weeklyEntry
        ? weeklyRanked.findIndex((r) => String(r._id) === String(lead._id))
        : -1;
      const weeklyTop3 = weeklyRanked.slice(0, 3).map((r, i) => {
        const isMe = String(r._id) === String(lead._id);
        const medal = ["🥇", "🥈", "🥉"][i];
        return `<tr style="${isMe ? "background:#fef9c3;" : ""}"><td>${medal} ${esc(r.name)}${isMe ? " (you)" : ""}</td><td><b>${r.weeklyPts} pts</b></td><td>${ord(i + 1)}</td></tr>`;
      }).join("");
      const weeklyMyRow =
        weeklyEntry && weeklyRank >= 3
          ? `<tr><td>You</td><td><b>${weeklyEntry.weeklyPts} pts</b></td><td>${ord(weeklyRank + 1)} of ${weeklyRanked.length}</td></tr>`
          : weeklyEntry
            ? "" // already shown in top 3
            : `<tr><td>You</td><td><b>0 pts</b></td><td>Sit out — get back in!</td></tr>`;

      // Playful copy that varies a bit by where they are.
      const greetings = [
        `Hey ${firstName} 👋`,
        `Yo ${firstName} 🎯`,
        `Psst — ${firstName} 🤫`,
        `${firstName}! 👀`,
      ];
      const greeting = greetings[Math.abs((firstName.charCodeAt(0) || 0) + sessions) % greetings.length];
      const idleLine = idleDays != null
        ? `You've been off the leaderboard for <b>${idleDays} day${idleDays === 1 ? "" : "s"}</b>.`
        : `Haven't seen you on the leaderboard yet — let's fix that.`;
      const closeRank = weeklyRank > 2 && weeklyRank < 6
        ? ` You're <b>${ord(weeklyRank + 1)}</b> this week — top 3 is <em>so close</em>.`
        : weeklyRank === -1
          ? " A few quick rounds will get you on the weekly board fast."
          : weeklyRank === 0
            ? " You're sitting at <b>#1</b> this week — defend it!"
            : "";

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fff;">
          <!-- Header -->
          <div style="text-align:center;background:linear-gradient(135deg,#f97316,#dc2626);border-radius:16px 16px 0 0;padding:28px 20px;">
            <img src="https://curriculate.net/images/mascot/streak/1.png" alt="Curriculate mascot" style="width:80px;height:80px;margin-bottom:6px;" />
            <div style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.3px;">☕ Tim's Card up for grabs.</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.92);margin-top:6px;font-weight:700;">
              Top 3 in this week's leaderboard win one. ${idleDays != null ? `It's been ${idleDays} day${idleDays === 1 ? "" : "s"}.` : ""}
            </div>
          </div>

          <!-- Body -->
          <div style="background:#fff;padding:22px 22px 8px;border:1px solid #e2e8f0;border-top:none;color:#0f172a;line-height:1.55;">
            <p style="margin:0 0 10px;font-size:16px;">${greeting} —</p>
            <p style="margin:0 0 12px;font-size:14px;color:#334155;">
              ${idleLine}${closeRank}
            </p>
            <p style="margin:0 0 14px;font-size:14px;color:#334155;">
              We've shipped <b>a pile of fixes</b> since you last played: animated pet, mood-checkin polish, mad-dash reveals, hangman with real names, sequence answer-reveal, and a bunch of contrast/visibility cleanups.
              Hop in for a few quick rounds — the leaderboard window is the last completed Sunday→Saturday week, and it resets every Sunday morning.
            </p>

            <!-- Weekly leaderboard -->
            <div style="margin-top:14px;border-radius:14px;border:2px solid #f59e0b;background:linear-gradient(135deg,#fffbeb,#fef3c7);padding:12px 14px;">
              <div style="font-weight:900;font-size:13px;color:#78350f;letter-spacing:0.4px;text-transform:uppercase;">
                🎁 This week's top 3 — ${fmtDay(weekStart)} → ${fmtDay(weekEnd)}
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a;margin-top:6px;">
                ${weeklyTop3 || `<tr><td colspan="3" style="padding:6px 0;color:#92400e;">No results in this week's window yet — wide open.</td></tr>`}
                ${weeklyMyRow}
              </table>
              <div style="font-size:11px;color:#92400e;margin-top:6px;font-weight:700;">
                Top 3 each week → coffee on us ☕
              </div>
            </div>

            <!-- All-time leaderboard -->
            <div style="margin-top:12px;border-radius:14px;border:1px solid #e2e8f0;background:#f8fafc;padding:12px 14px;">
              <div style="font-weight:900;font-size:13px;color:#1e293b;letter-spacing:0.4px;text-transform:uppercase;">
                🏆 All-time top 3
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a;margin-top:6px;">
                ${allTimeTop3}
                ${allTimeRank >= 3 ? allTimeRow : ""}
              </table>
            </div>

            <div style="text-align:center;margin:22px 0 10px;">
              <a href="https://www.curriculate.net/practice"
                 style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;text-decoration:none;border-radius:14px;font-weight:900;font-size:16px;box-shadow:0 6px 18px rgba(220,38,38,0.35);">
                Climb the board →
              </a>
            </div>
            <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:6px;">
              Lifetime: ${lifetime} pts · ${sessions} session${sessions === 1 ? "" : "s"}${lastPlayed ? ` · last played ${lastPlayed}` : ""}
            </div>
          </div>

          <div style="background:#f8fafc;border-radius:0 0 16px 16px;padding:14px 20px;border:1px solid #e2e8f0;border-top:none;text-align:center;font-size:11px;color:#94a3b8;">
            Curriculate · <a href="https://www.curriculate.net" style="color:#3b82f6;text-decoration:none;">curriculate.net</a>
          </div>
        </div>
      `;
      try {
        await sendSystemEmail({
          to: lead.email,
          subject: `${firstName}, you could win a Tim's card this week ☕`,
          html,
        });
        await ConferenceLead.updateOne(
          { _id: lead._id },
          { $set: { lastNudgeAt: now } }
        );
        sent += 1;
      } catch (e) {
        console.warn("[demo/nudge-inactive] send failed for", lead.email, e.message);
        failed.push(lead.email);
      }
    }

    res.type("html").send(`
      <html><body style="font-family:system-ui;padding:32px;max-width:540px;margin:0 auto;">
      <h1>📬 ${sent} nudge${sent === 1 ? "" : "s"} sent</h1>
      <p>Inactive ${INACTIVE_DAYS}+ days · last nudge >${NUDGE_COOLDOWN_DAYS} days ago.</p>
      ${failed.length ? `<p style="color:#dc2626;"><b>${failed.length} failed:</b> ${failed.join(", ")}</p>` : ""}
      <h3 style="margin-top:24px;">Recipients</h3>
      <ul>
        ${candidates
          .filter((l) => !failed.includes(l.email))
          .map((l) => `<li>${l.name} &lt;${l.email}&gt; · last played ${l.resultsSentAt ? new Date(l.resultsSentAt).toLocaleDateString("en-CA") : "—"} · ${l.totalPoints || 0} pts</li>`)
          .join("")}
      </ul>
      </body></html>
    `);
  } catch (err) {
    console.error("[demo/nudge-inactive] Error:", err.message);
    res.status(500).type("html").send(`<h1>Failed</h1><pre>${String(err.message)}</pre>`);
  }
});

/* ------------------------------------------------------------------ */
/*  GET /followup-conference-visitors                                  */
/*                                                                    */
/*  One-tap intro email to every ConferenceLead that:                 *
/*    • came in via source==="conference"                              *
/*    • registeredAt within the last 60 days (so we're not emailing    *
/*      ancient leads from old events)                                 *
/*    • has NOT been followed-up before (conferenceFollowupAt null)   *
/*                                                                    *
/*  Sends a friendly intro: features highlight, what other Curriculate */
/*  tools exist, and an offer to redeem their 1-month free trial      */
/*  that expires 30 days after the conference (registeredAt + 30d).   */
/* ------------------------------------------------------------------ */
router.get("/followup-conference-visitors", async (req, res) => {
  try {
    const key = req.query.key;
    const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
    if (!expected || key !== expected) {
      return res.status(401).type("html").send("<h1>Unauthorized</h1>");
    }

    const now = new Date();
    const sixtyDays = new Date(now.getTime() - 60 * 86400e3);

    const candidates = await ConferenceLead.find({
      email: { $exists: true, $ne: "" },
      source: "conference",
      registeredAt: { $gte: sixtyDays },
      $or: [
        { conferenceFollowupAt: { $exists: false } },
        { conferenceFollowupAt: null },
      ],
    }).limit(200).lean();

    if (candidates.length === 0) {
      return res.type("html").send(
        `<html><body style="font-family:system-ui;padding:32px;max-width:540px;margin:0 auto;">
        <h1>No conference visitors to follow up</h1>
        <p>Everyone in the last 60 days who registered as a conference
        visitor has already been contacted.</p>
        </body></html>`
      );
    }

    let sent = 0;
    const failed = [];
    for (const lead of candidates) {
      const firstName = String(lead.name || "").split(" ")[0] || "there";
      const conferenceLabel = lead.conference && lead.conference !== "general"
        ? lead.conference
        : "the conference";
      const trialExpires = new Date(
        new Date(lead.registeredAt || now).getTime() + 30 * 86400e3
      );
      const expiresStr = trialExpires.toLocaleDateString("en-CA", {
        month: "long", day: "numeric", year: "numeric",
      });
      const promoCode = lead.promoCode || "CONFERENCE2025";

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;background:#fff;">
          <div style="text-align:center;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:16px 16px 0 0;padding:30px 20px;">
            <img src="https://curriculate.net/images/mascot/promo/1.png" alt="Curriculate mascot" style="width:80px;height:80px;margin-bottom:6px;" />
            <div style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.3px;">Great meeting you, ${esc(firstName)}!</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.92);margin-top:6px;font-weight:700;">
              From everyone at Curriculate — thanks for stopping by ${esc(conferenceLabel)}.
            </div>
          </div>

          <div style="padding:24px 24px 14px;border:1px solid #e2e8f0;border-top:none;color:#0f172a;line-height:1.55;">
            <p style="margin:0 0 14px;font-size:15px;">
              Quick recap of what's in the toolkit so you can pick what fits your classroom first:
            </p>

            <!-- Feature cards -->
            <div style="display:block;margin:0 0 14px;">
              <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;background:linear-gradient(135deg,#fafafa,#f1f5f9);margin-bottom:10px;">
                <div style="font-weight:900;font-size:14px;color:#0f172a;">🎮 Curriculate (Scavenger Hunts)</div>
                <div style="font-size:13px;color:#475569;margin-top:4px;">
                  AI-generated interactive task stations.  Describe a lesson, the AI builds activities (sort, mime, mad-dash, peer-edit, riddles, debate…), kids work through them in teams.
                </div>
                <div style="font-size:11px;color:#3b82f6;margin-top:6px;font-weight:800;">
                  → curriculate.net
                </div>
              </div>

              <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;background:linear-gradient(135deg,#fef3c7,#fde68a);margin-bottom:10px;">
                <div style="font-weight:900;font-size:14px;color:#0f172a;">📝 Pulse Grading</div>
                <div style="font-size:13px;color:#475569;margin-top:4px;">
                  Snap a photo of a quiz, journal, or rubric.  AI returns a graded report
                  with feedback voice, per-student trend, well-being concerns, and Edsby-ready CSV.
                </div>
                <div style="font-size:11px;color:#92400e;margin-top:6px;font-weight:800;">
                  → curriculate.net/grading
                </div>
              </div>

              <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;background:linear-gradient(135deg,#dcfce7,#bbf7d0);">
                <div style="font-weight:900;font-size:14px;color:#0f172a;">🏃 Field Day</div>
                <div style="font-size:13px;color:#475569;margin-top:4px;">
                  Outdoor track-meet manager — events, heats, scoring, records, and personal-best tracking.
                </div>
                <div style="font-size:11px;color:#15803d;margin-top:6px;font-weight:800;">
                  → curriculate.net/fieldday
                </div>
              </div>
            </div>

            <!-- Trial offer -->
            <div style="margin-top:18px;border-radius:16px;border:2px solid #f59e0b;background:linear-gradient(135deg,#fffbeb,#fef3c7);padding:16px;text-align:center;">
              <div style="font-size:12px;font-weight:900;color:#92400e;letter-spacing:0.5px;text-transform:uppercase;">
                🎟️ Conference offer — yours
              </div>
              <div style="font-size:22px;font-weight:1000;color:#78350f;margin-top:4px;">
                1 month FREE
              </div>
              <div style="font-size:13px;color:#78350f;margin-top:4px;">
                Use code <span style="display:inline-block;padding:4px 10px;background:#fff;border:2px dashed #f59e0b;border-radius:8px;font-weight:900;letter-spacing:1px;color:#78350f;">${esc(promoCode)}</span>
              </div>
              <div style="font-size:12px;color:#92400e;margin-top:8px;font-weight:700;">
                Expires ${expiresStr} — 30 days from when we met.
              </div>
              <a href="https://www.curriculate.net/pricing?promo=${encodeURIComponent(promoCode)}&ref=conference-followup"
                 style="display:inline-block;margin-top:14px;padding:12px 28px;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;text-decoration:none;border-radius:12px;font-weight:900;font-size:14px;box-shadow:0 6px 18px rgba(220,38,38,0.35);">
                Redeem free month →
              </a>
            </div>

            <p style="margin:18px 0 4px;font-size:13px;color:#64748b;text-align:center;">
              Questions, feedback, or wanting a walkthrough?  Reply to this email — it goes to a real person.
            </p>
          </div>

          <div style="background:#f8fafc;border-radius:0 0 16px 16px;padding:14px 20px;border:1px solid #e2e8f0;border-top:none;text-align:center;font-size:11px;color:#94a3b8;">
            Curriculate · <a href="https://www.curriculate.net" style="color:#3b82f6;text-decoration:none;">curriculate.net</a>
          </div>
        </div>
      `;
      try {
        await sendSystemEmail({
          to: lead.email,
          subject: `${firstName}, your Curriculate free month is waiting (1 of 3 tools to try)`,
          html,
        });
        await ConferenceLead.updateOne(
          { _id: lead._id },
          { $set: { conferenceFollowupAt: now } }
        );
        sent += 1;
      } catch (e) {
        console.warn("[demo/followup-conference-visitors] failed for", lead.email, e.message);
        failed.push(lead.email);
      }
    }

    res.type("html").send(`
      <html><body style="font-family:system-ui;padding:32px;max-width:540px;margin:0 auto;">
      <h1>📬 ${sent} conference follow-up${sent === 1 ? "" : "s"} sent</h1>
      <p>Recipients: registered ≤60 days ago · source=conference · never contacted before.</p>
      ${failed.length ? `<p style="color:#dc2626;"><b>${failed.length} failed:</b> ${failed.join(", ")}</p>` : ""}
      <ul>
        ${candidates
          .filter((l) => !failed.includes(l.email))
          .map((l) => `<li>${l.name} &lt;${l.email}&gt; · ${l.conference || "general"}</li>`)
          .join("")}
      </ul>
      </body></html>
    `);
  } catch (err) {
    console.error("[demo/followup-conference-visitors] Error:", err.message);
    res.status(500).type("html").send(`<h1>Failed</h1><pre>${String(err.message)}</pre>`);
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

    // Summary stats — prefer the lifetime counters (populated since
    // sessions started accumulating); fall back to results.length for
    // legacy docs that pre-date the counter.
    const totalStudents = leads.length;
    const totalCompleted = leads.reduce(
      (sum, l) =>
        sum +
        (typeof l.lifetimeCompletedCount === "number" && l.lifetimeCompletedCount > 0
          ? l.lifetimeCompletedCount
          : (l.results || []).filter((r) => !r.skipped).length),
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

    // IMPORTANT: include feedbackEntries — Mongoose .select() will
    // omit it otherwise and the exporter falls back to lead.results
    // (only the latest session) instead of the full append-only log.
    // This was the root cause of the "where did my comments go?" bug.
    const leads = await ConferenceLead.find({
      $or: [
        { "results.0": { $exists: true } },
        { "feedbackEntries.0": { $exists: true } },
      ],
    })
      .select("results name feedbackEntries")
      .lean();

    // Aggregate feedback by task type
    const byType = {};
    const allComments = [];

    for (const lead of leads) {
      // Prefer the append-only feedbackEntries log (preserves history
      // across replays).  Fall back to lead.results for legacy docs
      // that were created before feedbackEntries existed.
      const entries =
        Array.isArray(lead.feedbackEntries) && lead.feedbackEntries.length > 0
          ? lead.feedbackEntries
          : (lead.results || []).map((r) => ({
              taskType: r.taskType,
              title: r.title,
              fun: r.feedback?.fun || 0,
              clarity: r.feedback?.clarity || 0,
              confusing: r.feedback?.confusing || "",
              suggestion: r.feedback?.suggestion || "",
              skipped: !!r.skipped,
              source: r.feedback?.source || (r.skipped ? "skip-dialog" : "rating"),
            }));

      for (const e of entries) {
        const tt = e.taskType;
        if (!tt) continue;
        const hasContent =
          (e.fun && e.fun > 0) ||
          (e.clarity && e.clarity > 0) ||
          (e.confusing && String(e.confusing).trim()) ||
          (e.suggestion && String(e.suggestion).trim());
        if (!hasContent) continue;

        if (!byType[tt]) {
          byType[tt] = { taskType: tt, title: e.title, funSum: 0, claritySum: 0, count: 0 };
        }
        // Skip-dialog entries don't include fun/clarity ratings, so
        // they don't roll into the averages.
        if (!e.skipped) {
          byType[tt].funSum += e.fun || 0;
          byType[tt].claritySum += e.clarity || 0;
          byType[tt].count += 1;
        }

        if (e.confusing) {
          allComments.push({
            taskType: tt,
            title: e.title,
            type: "confusing",
            text: e.confusing,
            from: lead.name,
            source: e.source || (e.skipped ? "skip-dialog" : "rating"),
          });
        }
        if (e.suggestion) {
          allComments.push({
            taskType: tt,
            title: e.title,
            type: "suggestion",
            text: e.suggestion,
            from: lead.name,
            source: e.source || (e.skipped ? "skip-dialog" : "rating"),
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

    // Same fix as /feedback-summary above — include feedbackEntries.
    const leads = await ConferenceLead.find({
      $or: [
        { "results.0": { $exists: true } },
        { "feedbackEntries.0": { $exists: true } },
      ],
    })
      .select("results name email source classroom createdAt feedbackEntries")
      .lean();

    // Build per-task-type aggregation
    // Include ALL completed results (even those where feedback popup was skipped)
    const byType = {};

    for (const lead of leads) {
      // Prefer the append-only feedbackEntries log; fall back to
      // results for legacy docs that pre-date the log.
      const entries =
        Array.isArray(lead.feedbackEntries) && lead.feedbackEntries.length > 0
          ? lead.feedbackEntries
          : (lead.results || []).map((r) => ({
              taskType: r.taskType,
              title: r.title,
              fun: r.feedback?.fun || 0,
              clarity: r.feedback?.clarity || 0,
              confusing: r.feedback?.confusing || "",
              suggestion: r.feedback?.suggestion || "",
              skipped: !!r.skipped,
            }));

      // Also count completions from the lifetime counter so the
      // "Completed" stat per task type still reflects real volume even
      // for leads who haven't left feedback.  We collect type → count
      // separately first, so completion counts don't depend on whether
      // feedback was left.
      for (const r of lead.results || []) {
        const tt = r.taskType;
        if (!tt) continue;
        if (r.skipped) continue;
        if (!byType[tt]) {
          byType[tt] = { title: r.title || tt, funScores: [], clarityScores: [], comments: [], responseCount: 0 };
        }
        byType[tt].responseCount += 1;
      }

      for (const e of entries) {
        const tt = e.taskType;
        if (!tt) continue;
        if (!byType[tt]) {
          byType[tt] = { title: e.title || tt, funScores: [], clarityScores: [], comments: [], responseCount: 0 };
        }
        if (!e.skipped) {
          if (e.fun > 0) byType[tt].funScores.push(e.fun);
          if (e.clarity > 0) byType[tt].clarityScores.push(e.clarity);
        }
        const skipTag = e.skipped ? " (via skip)" : "";
        if (e.confusing && String(e.confusing).trim()) {
          byType[tt].comments.push(`  [CONFUSING${skipTag}] "${String(e.confusing).trim()}" — ${lead.name}`);
        }
        if (e.suggestion && String(e.suggestion).trim()) {
          byType[tt].comments.push(`  [SUGGESTION${skipTag}] "${String(e.suggestion).trim()}" — ${lead.name}`);
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
      const rated = data.funScores.length;
      lines.push(`  Completed: ${data.responseCount} | Rated: ${rated} | Fun: ${avgFun}/5 | Clarity: ${avgClarity}/5`);
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
/*  Strips all feedback from ConferenceLead documents.                */
/*                                                                    */
/*  Used to: only $unset the legacy results.[].feedback subpath which *
/*  left the new append-only feedbackEntries[] log untouched.  After  *
/*  the .select() fix made the exporter prefer feedbackEntries[],     *
/*  comments were surviving every clear — tester confirmed.  Now we   *
/*  wipe BOTH paths in one update.  Lead docs themselves are kept     *
/*  (totalPoints / sessionCount survive for the leaderboard).         *
/* ------------------------------------------------------------------ */

router.post("/feedback-clear", feedbackClearHandler);
router.get("/feedback-clear", feedbackClearHandler);

async function feedbackClearHandler(req, res) {
  try {
    const key = req.query.key || req.body?.key;
    if (key !== (process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Two updates: one $unsets the per-result feedback (positional),
    // the other empties the append-only log.  Keeping them split is
    // simpler than co-mingling $unset and $set against the same
    // doc-positional path.
    const r1 = await ConferenceLead.updateMany(
      { "results.feedback": { $exists: true } },
      { $unset: { "results.$[].feedback": 1 } }
    );
    const r2 = await ConferenceLead.updateMany(
      { "feedbackEntries.0": { $exists: true } },
      { $set: { feedbackEntries: [] } }
    );

    res.json({
      ok: true,
      modifiedCount: (r1.modifiedCount || 0) + (r2.modifiedCount || 0),
      legacyResultsCleared: r1.modifiedCount || 0,
      feedbackEntriesCleared: r2.modifiedCount || 0,
    });
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

/* ------------------------------------------------------------------ */
/*  lastCompletedWeek: most recent Sun 00:00 → Sat 23:59:59.999 that  */
/*  has FULLY ELAPSED.  Used for the "top 3 → gift card" weekly       */
/*  leaderboard: the current (in-progress) week is excluded so admins */
/*  see a stable window from the moment Saturday rolls into Sunday.   */
/* ------------------------------------------------------------------ */
function lastCompletedWeek(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Days back to the most recent Saturday strictly before today's start.
  // Sun=1, Mon=2, …, Sat=7. (If today is Sat, this week is still in
  // progress, so we want the previous Saturday — 7 days back.)
  const daysBack = dayOfWeek + 1;
  const end = new Date(d);
  end.setDate(end.getDate() - daysBack);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

/* ------------------------------------------------------------------ */
/*  currentWeek: this week's Sun 00:00 → now.  Used for the live      */
/*  "this week so far" leaderboard alongside the locked gift-card     */
/*  window — so on Sunday morning when last week is empty (everyone  */
/*  just started practicing today) the admin still sees what's        */
/*  happening live.                                                   */
/* ------------------------------------------------------------------ */
function currentWeek(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0=Sun ... 6=Sat
  const start = new Date(d);
  start.setDate(start.getDate() - dayOfWeek); // back to this Sunday
  start.setHours(0, 0, 0, 0);
  // End = the moment this email is rendering — captures everything
  // posted up to right now, including the session that triggered it.
  const end = new Date(now);
  return { start, end };
}

/* ------------------------------------------------------------------ */
/*  buildTopThreeBlock: renders a small ranked table of the top 3     */
/*  performers from a list of {name, points, secondary?}.  Used for   */
/*  both the weekly and the all-time leaderboards in the admin email. */
/* ------------------------------------------------------------------ */
function buildTopThreeBlock(title, rows, currentEmail) {
  if (!rows || rows.length === 0) {
    return `
      <div style="background:#fff;padding:14px 24px;border:1px solid #e2e8f0;border-top:none;">
        <div style="font-weight:900;font-size:13px;margin-bottom:6px;color:#1e293b;">${title}</div>
        <div style="font-size:12px;color:#94a3b8;font-style:italic;">No results in this window yet.</div>
      </div>`;
  }
  const top3 = rows.slice(0, 3);
  const rowHtml = top3
    .map((r, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
      const isCurrent =
        currentEmail && r.email && r.email.toLowerCase() === currentEmail.toLowerCase();
      const rowBg = isCurrent ? "#fefce8" : "#fff";
      const nameStyle = isCurrent ? "font-weight:900;color:#b45309;" : "font-weight:700;color:#0f172a;";
      const arrow = isCurrent ? " ← just submitted" : "";
      return `<tr style="background:${rowBg};">
        <td style="padding:6px 10px;font-size:18px;text-align:center;width:36px;">${medal}</td>
        <td style="padding:6px 10px;font-size:14px;${nameStyle}">${esc(r.name || "—")}${arrow}</td>
        <td style="padding:6px 10px;font-size:11px;color:#64748b;">${esc(r.email || "")}</td>
        <td style="padding:6px 10px;font-size:14px;font-weight:800;color:#f59e0b;text-align:right;">${r.points || 0} pts</td>
      </tr>`;
    })
    .join("");
  return `
    <div style="background:#fff;padding:14px 24px;border:1px solid #e2e8f0;border-top:none;">
      <div style="font-weight:900;font-size:13px;margin-bottom:8px;color:#1e293b;">${title}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>${rowHtml}</tbody>
      </table>
    </div>`;
}

async function sendAdminNotification(lead) {
  const completed = (lead.results || []).filter((r) => !r.skipped);
  const skipped = (lead.results || []).filter((r) => r.skipped);
  const engagement = classifyEngagement(lead.results, lead.totalPoints);
  const isClassroom = lead.source === "classroom";
  // Tighten the conference check the same way the user-facing email
  // does: only treat this as a *real* conference run if both
  // source==="conference" AND the conference field is something other
  // than the default "general" (booth visits always pass ?event=...).
  // Stops a stuck source="conference" on an old lead doc from
  // re-labelling a /practice session as "Conference Completion".
  const isConference =
    lead.source === "conference" &&
    !!lead.conference &&
    lead.conference !== "general";
  // Anything that isn't strictly classroom-or-conference (typically a
  // /practice run with stale source) is treated as practice for
  // labelling.  Practice == not conference.
  const isPractice = !isConference;
  const wasOfferedReferral = engagement.level === "keener" && isConference;

  // ── Top 3 weekly (locked + live) + Top 3 all-time → gift card decisions ─
  let weeklyTopHtml = "";    // last completed Sun→Sat (gift-card window)
  let liveWeekTopHtml = "";  // current week-in-progress, Sun 00:00 → now
  let allTimeTopHtml = "";
  try {
    const scopeFilter = {};
    if (isClassroom && lead.classroom) scopeFilter.classroom = lead.classroom;
    else if (!isClassroom && lead.conference) scopeFilter.conference = lead.conference;

    // ALL-TIME top 3 (lifetime totalPoints, already cumulative)
    const allTimeLeads = await ConferenceLead.find({
      ...scopeFilter,
      totalPoints: { $gt: 0 },
    })
      .sort({ totalPoints: -1, createdAt: 1 })
      .limit(3)
      .select("name email totalPoints sessionCount lifetimeCompletedCount")
      .lean();

    allTimeTopHtml = buildTopThreeBlock(
      "🏆 All-Time Top 3 (lifetime points)",
      allTimeLeads.map((l) => ({
        name: l.name,
        email: l.email,
        points: l.totalPoints || 0,
      })),
      lead.email
    );

    // WEEKLY top 3 — last completed Sun→Sat window
    const { start: weekStart, end: weekEnd } = lastCompletedWeek(new Date());
    const weeklyLeads = await ConferenceLead.find({
      ...scopeFilter,
      "sessions.completedAt": { $gte: weekStart, $lte: weekEnd },
    })
      .select("name email sessions")
      .lean();

    const weeklyRanked = weeklyLeads
      .map((l) => {
        const weekPts = (l.sessions || [])
          .filter((s) => {
            const t = s?.completedAt ? new Date(s.completedAt).getTime() : 0;
            return t >= weekStart.getTime() && t <= weekEnd.getTime();
          })
          .reduce((sum, s) => sum + (s.points || 0), 0);
        return { name: l.name, email: l.email, points: weekPts };
      })
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points);

    const weekFmt = (d) => d.toISOString().slice(0, 10);
    weeklyTopHtml = buildTopThreeBlock(
      `🎁 Weekly Top 3 — ${weekFmt(weekStart)} → ${weekFmt(weekEnd)} (gift-card window)`,
      weeklyRanked,
      lead.email
    );

    // LIVE current week (in progress) — same shape, just a different
    // time window.  On Sunday morning (when last week may be empty)
    // this is the only board with anything in it, so admins still get
    // useful signal from the email.
    const { start: liveStart, end: liveEnd } = currentWeek(new Date());
    const liveLeads = await ConferenceLead.find({
      ...scopeFilter,
      "sessions.completedAt": { $gte: liveStart, $lte: liveEnd },
    })
      .select("name email sessions")
      .lean();
    const liveRanked = liveLeads
      .map((l) => {
        const pts = (l.sessions || [])
          .filter((s) => {
            const t = s?.completedAt ? new Date(s.completedAt).getTime() : 0;
            return t >= liveStart.getTime() && t <= liveEnd.getTime();
          })
          .reduce((sum, s) => sum + (s.points || 0), 0);
        return { name: l.name, email: l.email, points: pts };
      })
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points);
    liveWeekTopHtml = buildTopThreeBlock(
      `🟢 This Week So Far — ${weekFmt(liveStart)} → now (live; gift-card decided Sun)`,
      liveRanked,
      lead.email
    );
  } catch (err) {
    console.error("[demo/admin-email] Top-3 query failed:", err.message);
    // Non-fatal — leaderboards just won't appear
  }

  // ── Full leaderboard (lifetime, top 50) ─────────────────────────────
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

  // Label off the *positive* isConference check — practice / classroom
  // / unknown all collapse to "Practice" so a stuck source="conference"
  // never mis-labels a /practice run as a conference visit.
  const modeLabel = isConference ? "🎯 Conference" : "🎓 Practice";
  const subjectLine = `${engagement.label} ${isConference ? "Visitor" : "Student"}: ${lead.name} (${lead.totalPoints} pts)`;

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
          ${isConference ? `
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

      ${liveWeekTopHtml}
      ${weeklyTopHtml}
      ${allTimeTopHtml}
      ${leaderboardHtml}

      <!-- Admin actions: nudge inactive practicers.  Tokenised GETs so
           the buttons work directly from the email client. -->
      <div style="background:#fff;padding:14px 24px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <div style="font-weight:900;font-size:13px;margin-bottom:8px;color:#1e293b;">
          📬 Outreach
        </div>
        <a href="${process.env.PUBLIC_API_BASE || "https://api.curriculate.net"}/api/conference/nudge-inactive?key=${encodeURIComponent(process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY || "")}"
           style="display:inline-block;padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:800;font-size:13px;text-decoration:none;margin:4px;">
          Nudge inactive practicers
        </a>
        ${isConference ? `
        <a href="${process.env.PUBLIC_API_BASE || "https://api.curriculate.net"}/api/conference/followup-conference-visitors?key=${encodeURIComponent(process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY || "")}"
           style="display:inline-block;padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;font-weight:800;font-size:13px;text-decoration:none;margin:4px;">
          Follow up with conference visitors
        </a>
        ` : ""}
        <div style="margin-top:8px;font-size:11px;color:#64748b;">
          Practice nudge: idle ≥4 days, not nudged in 7.
          ${isConference ? "<br/>Conference follow-up: registered ≤60 days ago, never contacted, with 30-day free-trial offer." : ""}
        </div>
      </div>

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
  // Conference path requires BOTH source==="conference" AND an explicit
  // conference name (i.e. not the "general" fallback).  This stops the
  // greeting + promo from leaking into practice sessions where a stale
  // `source: "conference"` from a prior visit got stuck on the lead
  // doc — the user still sees "Thanks for trying at the conference"
  // even though they came in via /practice.  An *actual* booth visit
  // always passes ?event=...&source=conference, so this is a safe
  // upgrade.
  const isConference =
    lead.source === "conference" &&
    !!lead.conference &&
    lead.conference !== "general";
  // Lifetime totalPoints (cumulative across sessions for this email) vs.
  // just-this-session points (passed through on the lead object before
  // the email was queued). Returning practicers see both, so a third
  // session that earned 50 doesn't look like they only have 50 lifetime.
  const lifetimePoints = lead.totalPoints || 0;
  const sessionPoints =
    typeof lead._sessionPoints === "number"
      ? lead._sessionPoints
      : lifetimePoints;
  const sessionCount = lead.sessionCount || 1;
  const isReturning = sessionCount > 1;

  // ── Per-task timeline + duration estimate ──────────────────────────
  // Each entry has a completedAt; the previous entry's completedAt
  // (or the first entry's, for the very first row) anchors the
  // duration.  Conference reports show this column; practice emails
  // hide it to keep the table tight.
  const fmtDur = (ms) => {
    if (!ms || ms < 1000) return "<1s";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };
  const enriched = (() => {
    const out = [];
    let prevTs = null;
    for (const r of lead.results) {
      const completedAt = r.completedAt ? new Date(r.completedAt) : null;
      const durationMs = completedAt && prevTs ? Math.max(0, completedAt - prevTs) : null;
      out.push({ r, durationMs });
      if (completedAt) prevTs = completedAt;
    }
    return out;
  })();
  const sessionDurationMs =
    enriched.length > 1 && enriched[0].r?.completedAt && enriched[enriched.length - 1].r?.completedAt
      ? new Date(enriched[enriched.length - 1].r.completedAt) -
        new Date(enriched[0].r.completedAt)
      : 0;

  // Build task result rows.  Conference adds a Time column + a
  // feedback line under tasks the visitor commented on, so the report
  // mirrors what a teacher gets for a taskset.
  const taskRows = enriched
    .map(({ r, durationMs }) => {
      const icon = r.skipped ? "⏭️" : "✅";
      const status = r.skipped ? "Skipped" : "Completed";
      const statusColor = r.skipped ? "#94a3b8" : "#16a34a";
      const pts = r.points || 0;
      const fb = r.feedback || null;
      const fbBlob = fb
        ? [fb.confusing, fb.suggestion].filter(Boolean).join(" · ")
        : "";
      const fbRow =
        isConference && fbBlob
          ? `<div style="margin-top:4px;font-size:12px;color:#64748b;font-style:italic;line-height:1.4;">"${esc(
              fbBlob.length > 240 ? fbBlob.slice(0, 240) + "…" : fbBlob
            )}"</div>`
          : "";
      const timeCell = isConference
        ? `<td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #64748b; text-align: right;">${
            durationMs ? fmtDur(durationMs) : "—"
          }</td>`
        : "";
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #334155;">
            ${icon} ${esc(r.title || r.taskType)}${fbRow}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">
            ${esc(r.taskType)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 600; color: ${statusColor};">
            ${status}
          </td>
          ${timeCell}
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 800; color: ${pts > 0 ? '#f59e0b' : '#cbd5e1'}; text-align: center;">
            ${pts > 0 ? `+${pts}` : "—"}
          </td>
        </tr>`;
    })
    .join("");

  const timeColHeader = isConference
    ? `<th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Time</th>`
    : "";

  // Conference-only: a session-duration banner above the results
  // table mirroring a teacher's "session lasted Xm" line.
  const sessionBanner =
    isConference && sessionDurationMs > 1000
      ? `
        <div style="margin: 0 0 18px; padding: 12px 16px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; font-size: 13px; color: #0c4a6e;">
          <strong>📋 Booth session report</strong> — about <strong>${esc(fmtDur(sessionDurationMs))}</strong> on the floor, ${esc(String(completed.length))} task${completed.length === 1 ? "" : "s"} completed${
          skipped.length ? `, ${esc(String(skipped.length))} skipped` : ""
        }.
        </div>`
      : "";

  // Promo section (only for conference visitors).  Conference-only
  // by exact match — anything else (classroom, unknown, blank) gets
  // no promo block.
  const promoSection = !isConference
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

  // ── "Catch the 2 leaders ahead" challenge block ─────────────────────
  // Find the two practicers ranked immediately above this one (closest
  // higher lifetime totals, same scope) and frame them as targets to
  // catch.  If the practicer is #1 → no block, just a congrats line.
  // If they're #2 → only one ahead.  Otherwise → two.
  let leadersAheadHtml = "";
  try {
    const ahead =
      lifetimePoints > 0
        ? await ConferenceLead.find({
            ...(isClassroom && lead.classroom
              ? { classroom: lead.classroom }
              : !isClassroom && lead.conference
              ? { conference: lead.conference }
              : {}),
            totalPoints: { $gt: lifetimePoints },
            _id: { $ne: lead._id },
          })
            .sort({ totalPoints: 1, createdAt: 1 }) // ASCENDING — closest first
            .limit(2)
            .select("name totalPoints")
            .lean()
        : [];

    if (ahead.length === 0 && lifetimePoints > 0) {
      // No-one ahead — you're at the top (or tied).
      leadersAheadHtml = `
        <div style="margin: 0 0 24px; padding: 14px 18px; background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; border-radius: 12px;">
          <div style="font-weight: 900; font-size: 14px; color: #78350f; margin-bottom: 2px;">
            👑 You're at the top of the leaderboard.
          </div>
          <div style="font-size: 13px; color: #92400e;">
            Nobody to catch — they're trying to catch <em>you</em>. Keep the streak going.
          </div>
        </div>`;
    } else if (ahead.length > 0) {
      // Render up to 2 rivals, closest first.
      const rivalRows = ahead
        .map((rival, i) => {
          const rivalFirst =
            (rival.name || "").split(/\s+/)[0] || "A fellow practicer";
          const gap = Math.max(1, (rival.totalPoints || 0) - lifetimePoints);
          const rank = i === 0 ? "Just ahead" : "Right after them";
          return `
            <tr>
              <td style="padding: 8px 12px; font-size: 13px; color: #475569; font-weight: 700; width: 40%;">
                ${esc(rivalFirst)}
              </td>
              <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">
                ${rank}
              </td>
              <td style="padding: 8px 12px; font-size: 13px; font-weight: 800; color: #b45309; text-align: right; white-space: nowrap;">
                +${gap} pt${gap === 1 ? "" : "s"} to catch up
              </td>
            </tr>`;
        })
        .join("");
      const headline =
        ahead.length === 1
          ? "🎯 One practicer ahead of you — go pass them!"
          : "🎯 Catch the 2 practicers ahead of you!";
      leadersAheadHtml = `
        <div style="margin: 0 0 24px; border: 1px solid #fde68a; border-radius: 12px; overflow: hidden;">
          <div style="padding: 12px 16px; background: linear-gradient(135deg, #fffbeb, #fef3c7); font-weight: 900; font-size: 14px; color: #78350f;">
            ${headline}
          </div>
          <table style="width: 100%; border-collapse: collapse; background: #fff;">
            <tbody>
              ${rivalRows}
            </tbody>
          </table>
          <div style="padding: 8px 16px; background: #fffbeb; font-size: 11px; color: #92400e; font-style: italic;">
            Top 3 each week (Sun → Sat) win a Tim's card during our testing phase.
          </div>
        </div>`;
    }
  } catch (err) {
    console.warn("[demo/email] leaders-ahead query failed:", err.message);
    leadersAheadHtml = "";
  }

  // Greeting: only the explicit conference path gets the conference
  // copy.  Practice (lead.source === "classroom"), unknown, blank, or
  // any stale value all get the neutral practice greeting.  Was a
  // negative !isClassroom check, which mis-greeted anyone whose lead
  // doc had source !== "classroom" (e.g. stale "conference" from a
  // very first visit before /practice was used).
  const greeting = isConference
    ? (isReturning
        ? `Hey ${esc(firstName)}! 👋 Welcome back — here's session #${sessionCount}:`
        : `Hey ${esc(firstName)}! 👋 Thanks for trying Curriculate at the conference. Here's a summary of your demo session:`)
    : (isReturning
        ? `Hey ${esc(firstName)}! Welcome back — here's session #${sessionCount}:`
        : `Hey ${esc(firstName)}! Here's a summary of your practice session:`);

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
        <img src="https://curriculate.net/images/mascot/email-results/1.png" alt="Curriculate mascot" style="width: 80px; height: 80px; margin-bottom: 8px;" />
        <div style="font-size: 28px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">Curriculate</div>
        <div style="font-size: 14px; color: rgba(255,255,255,0.8); margin-top: 6px;">${isConference ? "Your Demo Results" : "Your Practice Results"}</div>
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
            <div style="font-size: 28px; font-weight: 900; color: #f59e0b;">${sessionPoints}</div>
            <div style="font-size: 12px; color: #d97706; font-weight: 600;">This Session</div>
          </div>
          <div style="flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; text-align: center;">
            <div style="font-size: 28px; font-weight: 900; color: #2563eb;">${lifetimePoints}</div>
            <div style="font-size: 12px; color: #3b82f6; font-weight: 600;">Lifetime Points</div>
          </div>
        </div>
        ${isReturning ? `
          <div style="margin: -8px 0 24px; text-align:center; font-size:12px; color:#64748b;">
            Session #${sessionCount} for ${esc(lead.email)} — points carry over across all your visits.
          </div>` : ""}

        ${leadersAheadHtml}

        ${sessionBanner}

        <!-- Results table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Task</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Type</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Status</th>
              ${timeColHeader}
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

  // Subject: only the conference path gets the demo+free-month wording.
  // Everyone else (practice, unknown source, stale data) sees the
  // neutral practice subject.
  const subject = isConference
    ? `Your Curriculate Demo Results 🎯 + Free Month Offer`
    : `Your Curriculate Practice Results — ${lead.totalPoints || 0} points!`;

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

/* ------------------------------------------------------------------ */
/*  POST /recommend                                                     */
/*  Student recommends a teacher — one recommendation per teacher       */
/* ------------------------------------------------------------------ */

const recommendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many recommendations, please try again later" },
});

router.post("/recommend", recommendLimiter, async (req, res) => {
  try {
    const { teacherName, teacherEmail, studentName, studentEmail } = req.body;

    if (!teacherEmail || !studentName) {
      return res.status(400).json({ error: "Teacher email and student name are required" });
    }

    const normalizedTeacherEmail = teacherEmail.toLowerCase().trim();

    // Check if this teacher has already been recommended (by anyone)
    const existing = await Recommendation.findOne({
      teacherEmail: normalizedTeacherEmail,
      source: "student-practice",
    });

    if (existing) {
      return res.json({
        ok: false,
        alreadyRecommended: true,
        message: "This teacher has already been recommended!",
      });
    }

    // Create the recommendation record
    const rec = await Recommendation.create({
      recommenderName: studentName.trim(),
      recommenderEmail: (studentEmail || "").toLowerCase().trim(),
      teacherName: (teacherName || "").trim(),
      teacherEmail: normalizedTeacherEmail,
      source: "student-practice",
      message: `${studentName.trim()} recommended you to try Curriculate!`,
    });

    // Send recommendation email to the teacher (fire-and-forget)
    sendTeacherRecommendationEmail({
      teacherName: (teacherName || "").trim(),
      teacherEmail: normalizedTeacherEmail,
      studentName: studentName.trim(),
    }).catch((err) => {
      console.error("[demo/recommend] Email send failed:", err.message);
    });

    console.log(`[demo/recommend] ${studentName} recommended ${normalizedTeacherEmail}`);
    res.json({ ok: true, points: 25 });
  } catch (err) {
    console.error("[demo/recommend] Error:", err.message);
    res.status(500).json({ error: "Recommendation failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /recommend-practice                                            */
/*  Practicer shared the practice link with a friend.  Award lifetime   */
/*  + session points, capped to PRACTICE_RECOMMEND_DAILY_CAP per email  */
/*  per day so it can't be farmed.  No email is sent — the friend gets  */
/*  the message via whatever channel the user chose (SMS / iMessage /   */
/*  WhatsApp / copy-paste).  We just record that the share happened.    */
/* ------------------------------------------------------------------ */

const PRACTICE_RECOMMEND_POINTS = 10;
const PRACTICE_RECOMMEND_DAILY_CAP = 3; // 3 friends/day = 30 pts/day max

router.post("/recommend-practice", recommendLimiter, async (req, res) => {
  try {
    const { studentName, studentEmail, channel, recipientHint } = req.body || {};
    const meEmail = String(studentEmail || "").toLowerCase().trim();
    if (!meEmail) {
      return res.status(400).json({ error: "Student email is required" });
    }

    const lead = await ConferenceLead.findOne({ email: meEmail });
    if (!lead) {
      // Lead always exists if the user is on the results screen — but
      // bail gracefully if not.
      return res.status(404).json({ error: "Lead not found" });
    }

    // Daily cap: count practice-recommend entries in the last 24h.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = (lead.practiceShares || []).filter(
      (s) => s.createdAt && new Date(s.createdAt) > dayAgo
    );
    if (recent.length >= PRACTICE_RECOMMEND_DAILY_CAP) {
      return res.json({
        ok: false,
        capped: true,
        message: `Daily cap of ${PRACTICE_RECOMMEND_DAILY_CAP} share bonuses reached. Come back tomorrow!`,
      });
    }

    const points = PRACTICE_RECOMMEND_POINTS;
    const entry = {
      channel: String(channel || "unknown").slice(0, 32),
      recipientHint: String(recipientHint || "").slice(0, 200),
      points,
      createdAt: new Date(),
    };

    await ConferenceLead.updateOne(
      { _id: lead._id },
      {
        $inc: { totalPoints: points },
        $push: { practiceShares: { $each: [entry], $slice: -200 } },
      }
    );

    console.log(
      `[demo/recommend-practice] ${studentName || meEmail} shared via ${entry.channel} (+${points} pts)`
    );
    res.json({ ok: true, points, dailyRemaining: PRACTICE_RECOMMEND_DAILY_CAP - recent.length - 1 });
  } catch (err) {
    console.error("[demo/recommend-practice] Error:", err.message);
    res.status(500).json({ error: "Recommendation failed" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /check-recommendation                                           */
/*  Check if a teacher has already been recommended                     */
/* ------------------------------------------------------------------ */

router.get("/check-recommendation", async (req, res) => {
  try {
    const email = (req.query.email || "").toLowerCase().trim();
    if (!email) return res.json({ recommended: false });

    const existing = await Recommendation.findOne({
      teacherEmail: email,
      source: "student-practice",
    });

    res.json({ recommended: !!existing });
  } catch (err) {
    console.error("[demo/check-recommendation] Error:", err.message);
    res.json({ recommended: false });
  }
});

/* ------------------------------------------------------------------ */
/*  Teacher recommendation email                                        */
/* ------------------------------------------------------------------ */

async function sendTeacherRecommendationEmail({ teacherName, teacherEmail, studentName }) {
  const greeting = teacherName ? `Hi ${esc(teacherName)}` : "Hi there";

  const html = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="background: linear-gradient(135deg, #7c3aed, #a855f7); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
        <img src="https://curriculate.net/images/mascot/email-recommend/1.png" alt="Curriculate mascot" style="width: 80px; height: 80px; margin-bottom: 8px;" />
        <h1 style="margin: 0; color: #fff; font-size: 22px; font-weight: 900;">A Student Recommended You!</h1>
      </div>

      <div style="background: #fff; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin-top: 0;">
          ${greeting},
        </p>
        <p style="font-size: 16px; color: #334155; line-height: 1.6;">
          <strong style="color: #7c3aed;">${esc(studentName)}</strong> thinks you're an amazing teacher and recommended you try <strong>Curriculate</strong> — an AI-powered platform with 60+ interactive task types for classroom engagement.
        </p>

        <div style="background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 2px solid #c4b5fd; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
          <div style="font-size: 14px; color: #6d28d9; font-weight: 700; margin-bottom: 8px;">
            Your student said you're worth recommending
          </div>
          <div style="font-size: 13px; color: #7c3aed;">
            That's a pretty great compliment! 💜
          </div>
        </div>

        <p style="font-size: 15px; color: #334155; line-height: 1.6;">
          Curriculate helps you create interactive scavenger hunts, AI-graded assignments, and engaging activities — all in minutes.
        </p>

        <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 2px solid #93c5fd; border-radius: 12px; padding: 20px; margin: 20px 0;">
          <div style="font-size: 15px; color: #1e40af; font-weight: 800; margin-bottom: 8px;">
            📊 See what your reports look like
          </div>
          <div style="font-size: 14px; color: #334155; line-height: 1.5;">
            After every session, Curriculate automatically generates a detailed report — team scores, Bloom's taxonomy analysis, a student gradebook, and even a ready-to-send note to parents. We attached a sample so you can see for yourself!
          </div>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="https://curriculate.net/pricing" style="display: inline-block; padding: 14px 32px; border-radius: 12px; background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; font-weight: 900; font-size: 16px; text-decoration: none; box-shadow: 0 4px 12px rgba(124,58,237,0.3);">
            Try It Free →
          </a>
        </div>

        <p style="font-size: 13px; color: #94a3b8; text-align: center;">
          Use code <strong style="font-size: 15px; letter-spacing: 2px; color: #7c3aed;">STUDENTREC</strong> for 1 month free
        </p>
      </div>

      <div style="background: #f8fafc; border-radius: 0 0 16px 16px; padding: 20px 24px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          Curriculate — AI-powered interactive learning for classrooms<br/>
          <a href="https://www.curriculate.net" style="color: #3b82f6; text-decoration: none;">curriculate.net</a>
        </p>
      </div>
    </div>
  `;

  const emailOpts = {
    to: teacherEmail,
    subject: `⭐ ${studentName} recommended you try Curriculate!`,
    html,
  };

  // Attach sample teacher report PDF if available
  const samplePdf = getSampleReportPdf();
  if (samplePdf) {
    emailOpts.attachments = [
      { filename: "Curriculate-Sample-Report.pdf", content: samplePdf },
    ];
  }

  await sendSystemEmail(emailOpts);

  console.log(`[demo/recommend] ✅ Recommendation email sent to ${teacherEmail} from ${studentName} (pdf: ${!!samplePdf})`);
}

export default router;
