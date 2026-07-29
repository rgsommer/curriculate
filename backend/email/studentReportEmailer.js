// ====================================================================
//  studentReportEmailer.js
//  Curriculate — Student Session Report Emailer
//
//  Sends a student-focused report email after a session ends.
//  Shows: their team score, personal task breakdown, AI feedback,
//  and a "what you learned" recap. No other teams' data.
// ====================================================================

import { sendSystemEmail } from "./shareInviteEmailer.js";

const BRAND_NAME = "Curriculate";

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pct(n, d) {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 100);
}

/**
 * Send a student-focused session report email.
 *
 * @param {Object} opts
 * @param {string} opts.to                   – student email
 * @param {string} opts.cc                   – CC address (e.g. admin)
 * @param {string} opts.roomCode
 * @param {string} opts.className
 * @param {string} opts.taskSetName
 * @param {string} opts.teamName
 * @param {number} opts.teamScore
 * @param {number} opts.teamScorePercent
 * @param {number} opts.teamRank             – 1-based rank
 * @param {number} opts.totalTeams
 * @param {Array}  opts.members              – team member names
 * @param {Array}  opts.perTask              – per-task evidence for this team
 * @param {Object} opts.feedback             – team exit feedback (rating, learned, etc.)
 * @param {Array}  opts.participantSummaries – AI-generated per-participant summaries for this team
 * @param {Object} opts.aiSummary            – session-level AI summary (keyConcepts, skillsDeveloped, etc.)
 * @param {string} opts.selfieUrl            – team selfie photo URL (signed S3 URL)
 * @param {string} opts.themedSelfieUrl      – AI-themed version of the team selfie (if available)
 */
export async function sendStudentReportEmail({
  to,
  cc,
  roomCode,
  className,
  taskSetName,
  teamName,
  teamScore,
  teamScorePercent,
  teamRank,
  totalTeams,
  members,
  perTask,
  feedback,
  participantSummaries,
  aiSummary,
  selfieUrl,
  themedSelfieUrl,
}) {
  if (!to) return;

  const safeRoom = escHtml(roomCode || "");
  const safeClass = escHtml(className || "Class");
  const safeTaskSet = escHtml(taskSetName || "Session");
  const safeTeam = escHtml(teamName || "Your Team");
  const safeTo = String(to).trim().toLowerCase();

  // Build per-task rows
  const taskRows = Array.isArray(perTask) && perTask.length > 0
    ? perTask.map((t, i) => {
        const type = escHtml(t?.type || t?.taskType || "");
        const title = escHtml(t?.title || t?.taskTitle || `Task ${i + 1}`);
        const pts = Number(t?.pointsEarned ?? t?.points ?? 0);
        const max = Number(t?.maxPoints ?? 0);
        const correct = t?.isCorrect === true ? "✅" : t?.isCorrect === false ? "❌" : "—";
        const aiFeedback = escHtml(t?.aiFeedback || t?.feedback || "");
        return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">
              <strong>${title}</strong><br/>
              <span style="font-size:11px;color:#94a3b8;">${type}</span>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;">
              ${correct}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;color:#334155;">
              ${pts}${max ? ` / ${max}` : ""}
            </td>
          </tr>
          ${aiFeedback ? `
          <tr>
            <td colspan="3" style="padding:4px 12px 10px;font-size:12px;color:#64748b;font-style:italic;">
              💬 ${aiFeedback}
            </td>
          </tr>` : ""}`;
      }).join("")
    : `<tr><td colspan="3" style="padding:12px;color:#94a3b8;text-align:center;">No task data available</td></tr>`;

  // Participant summaries
  const summaryHtml = Array.isArray(participantSummaries) && participantSummaries.length > 0
    ? participantSummaries.map((p) => {
        const name = escHtml(p?.studentName || p?.name || "Student");
        const summary = escHtml(p?.summary || "");
        return summary
          ? `<div style="margin-bottom:12px;">
               <strong style="color:#1e293b;">${name}</strong>
               <p style="margin:4px 0 0;font-size:13px;color:#475569;line-height:1.5;">${summary}</p>
             </div>`
          : "";
      }).join("")
    : "";

  // Key concepts
  const concepts = Array.isArray(aiSummary?.keyConcepts) && aiSummary.keyConcepts.length
    ? aiSummary.keyConcepts.slice(0, 8).map((c) => escHtml(c)).join(" • ")
    : "";

  // Skills developed
  const skills = Array.isArray(aiSummary?.skillsDeveloped) && aiSummary.skillsDeveloped.length
    ? aiSummary.skillsDeveloped.slice(0, 6).map((s) => escHtml(s)).join(" • ")
    : "";

  // What they learned (from feedback)
  const learnedText = escHtml(feedback?.learned || feedback?.whatILearned || "");

  const rankText = teamRank && totalTeams
    ? `#${teamRank} of ${totalTeams} teams`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0ea5e9,#06b6d4);border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Your Session Report</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
        ${safeClass} — ${safeTaskSet}
      </p>
    </div>

    <!-- Body -->
    <div style="background:#fff;padding:24px;border-radius:0 0 16px 16px;box-shadow:0 4px 12px rgba(0,0,0,0.06);">

      <!-- Team summary card -->
      <div style="background:linear-gradient(135deg,#f0f9ff,#ecfeff);border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #bae6fd;">
        ${(themedSelfieUrl || selfieUrl) ? `
        <div style="text-align:center;margin-bottom:16px;">
          <img src="${escHtml(themedSelfieUrl || selfieUrl)}" alt="Team photo" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid #0ea5e9;box-shadow:0 4px 12px rgba(14,165,233,0.2);" />
          ${themedSelfieUrl ? `<div style="font-size:10px;color:#0369a1;margin-top:4px;">AI-themed team image ✨</div>` : ""}
        </div>
        ` : ""}
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:18px;font-weight:800;color:#0c4a6e;">🏆 ${safeTeam}</div>
            <div style="font-size:13px;color:#0369a1;margin-top:4px;">
              ${Array.isArray(members) ? members.filter(Boolean).map(escHtml).join(", ") : ""}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:28px;font-weight:900;color:#0ea5e9;">${teamScorePercent != null ? `${teamScorePercent}%` : (teamScore != null ? teamScore : "—")}</div>
            ${rankText ? `<div style="font-size:12px;color:#0369a1;margin-top:2px;">${rankText}</div>` : ""}
          </div>
        </div>
      </div>

      <!-- Task breakdown -->
      <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 12px;">Your Tasks</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Task</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;color:#94a3b8;text-transform:uppercase;">Result</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;color:#94a3b8;text-transform:uppercase;">Points</th>
          </tr>
        </thead>
        <tbody>
          ${taskRows}
        </tbody>
      </table>

      ${summaryHtml ? `
      <!-- AI Feedback -->
      <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 12px;">Your Feedback</h2>
      <div style="background:#fefce8;border-radius:12px;padding:16px;margin-bottom:24px;border:1px solid #fde68a;">
        ${summaryHtml}
      </div>
      ` : ""}

      ${learnedText ? `
      <!-- What you learned -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border-radius:12px;padding:16px;margin-bottom:24px;border:1px solid #bbf7d0;">
        <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:6px;">🧠 What You Learned</div>
        <p style="margin:0;font-size:13px;color:#15803d;line-height:1.5;">${learnedText}</p>
      </div>
      ` : ""}

      ${concepts ? `
      <!-- Key Concepts -->
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Key Concepts</div>
        <div style="font-size:13px;color:#475569;line-height:1.6;">${concepts}</div>
      </div>
      ` : ""}

      ${skills ? `
      <!-- Skills Practiced -->
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Skills Practiced</div>
        <div style="font-size:13px;color:#475569;line-height:1.6;">${skills}</div>
      </div>
      ` : ""}
    </div>

    <!-- Get the app CTA -->
    <div style="text-align:center;padding:8px 0 20px;">
      <a href="https://curriculate.net/app" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:999px;">📲 Get the Curriculate app</a>
      <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">Jump into your next class game in seconds — on iPhone, iPad, or Android.</p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;color:#94a3b8;font-size:11px;">
      <p style="margin:0;">Powered by ${BRAND_NAME} — Engage • Learn • Reflect</p>
      <p style="margin:4px 0 0;">Room ${safeRoom}</p>
    </div>
  </div>
</body>
</html>`;

  await sendSystemEmail({
    to: safeTo,
    cc: cc || undefined,
    subject: `Your ${BRAND_NAME} Report — ${taskSetName || className || "Session"}`,
    html,
  });
  console.log(`[studentReport] Sent student report to ${safeTo}${cc ? ` (cc: ${cc})` : ""}`);
}
