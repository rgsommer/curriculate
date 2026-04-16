// backend/controllers/feedbackController.js
import FeedbackMessage from "../models/FeedbackMessage.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const ADMIN_EMAIL = "admin@curriculate.net";

export async function createFeedback(req, res) {
  try {
    const { anonId = null, sessionId = null, message, uses = 0, meta = {} } = req.body || {};
    const msg = String(message || "").trim();
    if (!msg) return res.status(400).json({ error: "Missing message" });

    const saved = await FeedbackMessage.create({
      anonId: anonId ? String(anonId) : null,
      sessionId: sessionId ? String(sessionId) : null,
      message: msg,
      uses: Number(uses) || 0,
      meta: meta && typeof meta === "object" ? meta : {},
    });

    return res.json({ ok: true, id: saved._id, createdAt: saved.createdAt });
  } catch (e) {
    console.error("createFeedback error:", e);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
}

/* ------------------------------------------------------------------ */
/*  Student in-session feedback  — saves to DB + emails admin         */
/* ------------------------------------------------------------------ */
export async function createStudentFeedback(req, res) {
  try {
    const {
      roomCode, teamName, members, tasksetName,
      taskTitle, taskType, taskIndex, totalTasks,
      feedbackType, message,
      deviceInfo,
    } = req.body || {};

    const feedbackTypeStr = String(feedbackType || "").trim();
    if (!feedbackTypeStr) return res.status(400).json({ error: "Missing feedbackType" });

    const now = new Date();
    const membersArr = Array.isArray(members) ? members : [];
    // Normalize member names — members may be strings or {name, email} objects
    const memberNamesList = membersArr.map((m) => typeof m === "object" && m !== null ? m.name || "" : String(m || "")).filter(Boolean);
    const teamLabel = teamName ? `Team "${teamName}"` : "";
    const taskLabel = taskTitle || taskType || "";

    // Save to DB — include context in the message for quick scanning in admin
    const contextParts = [teamLabel, memberNamesList.join(", "), taskLabel].filter(Boolean);
    const contextStr = contextParts.length ? ` [${contextParts.join(" · ")}]` : "";
    const saved = await FeedbackMessage.create({
      message: `[Student Feedback] ${feedbackTypeStr}:${contextStr} ${String(message || "").trim() || "(no details)"}`,
      meta: {
        source: "student-app",
        roomCode, teamName, memberNames: memberNamesList,
        tasksetName, taskTitle, taskType,
        taskIndex, totalTasks, feedbackType: feedbackTypeStr,
        deviceInfo: deviceInfo || null,
        submittedAt: now.toISOString(),
      },
    });

    // Build + send email
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    const deviceStr = deviceInfo
      ? `<tr><td style="padding:6px 12px;color:#64748b">Device</td><td style="padding:6px 12px">${esc(deviceInfo.platform || "?")} &mdash; ${esc(deviceInfo.browser || "?")} (${esc(deviceInfo.screenSize || "?")})</td></tr>`
      : "";

    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1e293b;margin-bottom:4px">Student Feedback</h2>
        <p style="color:#64748b;margin-top:0">${dateStr} at ${timeStr}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="background:#f1f5f9"><td style="padding:6px 12px;color:#64748b;width:120px">Type</td><td style="padding:6px 12px;font-weight:600">${esc(feedbackTypeStr)}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b">Room Code</td><td style="padding:6px 12px">${esc(roomCode)}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:6px 12px;color:#64748b">Team</td><td style="padding:6px 12px">${esc(teamName)}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b">Members</td><td style="padding:6px 12px">${memberNamesList.length ? memberNamesList.map(esc).join(", ") : "—"}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:6px 12px;color:#64748b">Taskset</td><td style="padding:6px 12px">${esc(tasksetName)}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b">Task</td><td style="padding:6px 12px">${esc(taskTitle)} (${esc(taskType)})${taskIndex != null ? ` — #${taskIndex}/${totalTasks || "?"}` : ""}</td></tr>
          ${deviceStr}
        </table>
        ${message ? `<div style="margin-top:16px;padding:12px 16px;background:#f8fafc;border-left:3px solid #3b82f6;border-radius:4px;font-size:14px;color:#1e293b">${esc(String(message))}</div>` : ""}
      </div>
    `;

    try {
      await sendSystemEmail({
        to: ADMIN_EMAIL,
        subject: `[Student Feedback] ${feedbackTypeStr} — Room ${roomCode || "?"}`,
        html,
      });
    } catch (emailErr) {
      console.error("Student feedback email failed (saved to DB):", emailErr.message);
    }

    return res.json({ ok: true, id: saved._id });
  } catch (e) {
    console.error("createStudentFeedback error:", e);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}