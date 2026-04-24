// backend/email/gradeNotification.js
// Sends grade notification emails to students/parents
import StudentAccount from "../models/StudentAccount.js";
import { sendSystemEmail } from "./shareInviteEmailer.js";

/**
 * Send "new grade" notification to all opted-in emails for a student.
 * Fire-and-forget — errors are logged but never thrown.
 *
 * @param {string} studentId
 * @param {{ title?: string, subject?: string, code: string }} gradeInfo
 */
export async function notifyNewGrade(studentId, gradeInfo) {
  try {
    if (!studentId) return;

    const account = await StudentAccount.findOne({ studentId }).lean();
    if (!account || !account.emails?.length) return;

    const prefs = account.emailPrefs || {};
    const recipients = account.emails.filter((em) => {
      const pref = prefs[em] || "on-new";
      return pref === "on-new";
    });

    if (recipients.length === 0) return;

    const studentName = [account.firstName, account.lastName].filter(Boolean).join(" ") || "Your student";
    const title = gradeInfo.title || gradeInfo.subject || "New assignment";
    const code = gradeInfo.code || "";
    const resultsUrl = code ? `https://www.curriculate.net/results/${code}` : "https://www.curriculate.net/progress";
    const progressUrl = "https://www.curriculate.net/progress";

    // Extract score from payload if available
    const scoreText = gradeInfo.scoreText || "";

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
          <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">Curriculate</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 4px;">New Grade Notification</div>
        </div>

        <div style="background: #ffffff; padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
          <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b; line-height: 1.6;">
            A new grade has been posted for <strong>${esc(studentName)}</strong>.
          </p>

          <!-- Grade card -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">${esc(title)}</div>
            ${scoreText ? `<div style="font-size: 14px; color: #64748b;">${esc(scoreText)}</div>` : ""}
          </div>

          <!-- CTA -->
          <div style="text-align: center; margin-bottom: 8px;">
            <a href="${resultsUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
              View Result
            </a>
          </div>
          <div style="text-align: center; margin-top: 12px;">
            <a href="${progressUrl}" style="font-size: 13px; color: #2563eb; text-decoration: none;">View all grades →</a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; padding: 18px 24px; text-align: center;">
          <p style="margin: 0 0 6px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
            This email was sent via <a href="https://www.curriculate.net" style="color: #2563eb; text-decoration: none; font-weight: 600;">Curriculate</a> because you are subscribed to grade notifications.
          </p>
          <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
            To change notification settings, visit <a href="${progressUrl}" style="color: #94a3b8;">curriculate.net/progress</a> and tap the settings icon.
          </p>
        </div>
      </div>
    `;

    // Send to all recipients in parallel
    const promises = recipients.map((to) =>
      sendSystemEmail({
        to,
        subject: `New grade: ${title} — ${studentName}`,
        html,
      }).catch((err) => {
        console.error(`[grade-notify] Failed to send to ${to}:`, err.message);
      })
    );

    await Promise.all(promises);
    console.log(`[grade-notify] Sent to ${recipients.length} recipient(s) for student ${studentId}, code ${code}`);
  } catch (err) {
    console.error("[grade-notify] Error:", err.message);
  }
}

/**
 * Send weekly digest to all students with "weekly" preference.
 * Called by a scheduled task / cron endpoint.
 *
 * @param {{ since?: Date }} options — only include results since this date (default: 7 days ago)
 */
export async function sendWeeklyDigests(options = {}) {
  const { default: PublishedResult } = await import("../models/PublishedResult.js");

  const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find all student accounts that have at least one email set to "weekly"
  const accounts = await StudentAccount.find({
    emails: { $exists: true, $ne: [] },
  }).lean();

  let totalSent = 0;

  for (const account of accounts) {
    const prefs = account.emailPrefs || {};
    const weeklyRecipients = (account.emails || []).filter((em) => prefs[em] === "weekly");
    if (weeklyRecipients.length === 0) continue;

    // Find this student's results from the past week
    const results = await PublishedResult.find({
      "meta.studentId": account.studentId,
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 }).lean();

    if (results.length === 0) continue;

    const studentName = [account.firstName, account.lastName].filter(Boolean).join(" ") || "Your student";
    const progressUrl = "https://www.curriculate.net/progress";

    // Build results summary
    const resultRows = results.map((r) => {
      const title = r.meta?.title || r.meta?.subject || "Assignment";
      let scoreText = "";
      if (typeof r.payload === "string") {
        const m = r.payload.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
        if (m) scoreText = `${m[1]}/${m[2]}`;
      }
      const date = new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `
        <tr>
          <td style="padding: 8px 12px; font-size: 14px; color: #1e293b; border-bottom: 1px solid #f1f5f9;">${esc(title)}</td>
          <td style="padding: 8px 12px; font-size: 14px; color: #64748b; border-bottom: 1px solid #f1f5f9; text-align: center;">${scoreText || "—"}</td>
          <td style="padding: 8px 12px; font-size: 13px; color: #94a3b8; border-bottom: 1px solid #f1f5f9; text-align: right;">${date}</td>
        </tr>
      `;
    }).join("");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
        <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 16px 16px 0 0; padding: 28px 24px; text-align: center;">
          <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">Curriculate</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 4px;">Weekly Grade Summary</div>
        </div>

        <div style="background: #ffffff; padding: 28px 24px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
          <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b; line-height: 1.6;">
            Here's what was graded for <strong>${esc(studentName)}</strong> this week:
          </p>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <thead>
              <tr style="background: #f8fafc;">
                <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; color: #64748b; text-align: left; text-transform: uppercase;">Assignment</th>
                <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; color: #64748b; text-align: center; text-transform: uppercase;">Score</th>
                <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; color: #64748b; text-align: right; text-transform: uppercase;">Date</th>
              </tr>
            </thead>
            <tbody>${resultRows}</tbody>
          </table>

          <div style="text-align: center;">
            <a href="${progressUrl}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
              View All Grades
            </a>
          </div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; padding: 18px 24px; text-align: center;">
          <p style="margin: 0 0 6px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
            This weekly summary was sent via <a href="https://www.curriculate.net" style="color: #2563eb; text-decoration: none; font-weight: 600;">Curriculate</a>.
          </p>
          <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
            To change notification settings, visit <a href="${progressUrl}" style="color: #94a3b8;">curriculate.net/progress</a> and tap the settings icon.
          </p>
        </div>
      </div>
    `;

    const promises = weeklyRecipients.map((to) =>
      sendSystemEmail({
        to,
        subject: `Weekly grades: ${results.length} new result${results.length !== 1 ? "s" : ""} for ${studentName}`,
        html,
      }).catch((err) => {
        console.error(`[weekly-digest] Failed to send to ${to}:`, err.message);
      })
    );

    await Promise.all(promises);
    totalSent += weeklyRecipients.length;

    // Update lastWeeklyDigestAt
    await StudentAccount.updateOne({ _id: account._id }, { $set: { lastWeeklyDigestAt: new Date() } });
  }

  console.log(`[weekly-digest] Sent ${totalSent} digest email(s).`);
  return { sent: totalSent };
}

function esc(s) {
  return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
