// backend/behavior/jobs/morningReminders.js
//
// Morning reminder digest (brief §8b). Every minute we check which schools have
// a reminderTime matching the current local HH:MM, and email each teacher their
// outstanding follow-ups due today. Teachers opt in via morningReminderPrefs
// (the in-app "Reminder for today" list is served separately by GET /followups).
//
// Registered once from index.js via startMorningReminders().

import cron from "node-cron";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorFollowup from "../models/BehaviorFollowup.js";
import BehaviorTeacher from "../models/BehaviorTeacher.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import { mailer } from "../../email/mailer.js";

function appBase() {
  return (process.env.APP_BASE_URL || "https://www.curriculate.net").replace(/\/+$/, "");
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Send digests for every school whose reminderTime equals `now` (HH:MM). */
export async function runDueReminders(now = new Date()) {
  const configs = await BehaviorConfig.find({ reminderTime: hhmm(now) }).lean();
  for (const cfg of configs) {
    try {
      await sendSchoolDigests(cfg, now);
    } catch (err) {
      console.error("[behavior/reminders] school digest failed:", err?.message || err);
    }
  }
}

async function sendSchoolDigests(cfg, now) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const open = await BehaviorFollowup.find({ schoolId: cfg.schoolId, status: "open", dueDate: { $lte: end } }).lean();
  if (!open.length) return;

  const byTeacher = new Map();
  for (const f of open) {
    const k = String(f.assignedByTeacherId);
    if (!byTeacher.has(k)) byTeacher.set(k, []);
    byTeacher.get(k).push(f);
  }
  const teachers = await BehaviorTeacher.find({ _id: { $in: [...byTeacher.keys()] } }).lean();
  const students = await BehaviorStudent.find({ _id: { $in: [...new Set(open.map((f) => String(f.studentId)))] } })
    .select("firstName lastName preferredName")
    .lean();
  const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));

  for (const t of teachers) {
    if (!t.morningReminderPrefs?.email) continue; // email-digest opt-in (in-app is separate)
    const list = byTeacher.get(String(t._id)) || [];
    const lines = list.map((f) => {
      const s = sById[String(f.studentId)];
      const name = s ? `${s.preferredName || s.firstName} ${s.lastName}` : "student";
      return `• ${name} — ${f.behaviorName}: ${f.consequenceText}`;
    });
    const body =
      `Reminder for today — ${list.length} consequence(s) to check:\n\n` +
      `${lines.join("\n")}\n\n` +
      `Mark each Done / Not done / Waived in the app:\n${appBase()}/behavior`;
    try {
      await mailer.sendMail({
        from: process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER,
        to: t.email,
        subject: "Reminder for today — behaviour follow-ups",
        text: body,
      });
    } catch (err) {
      console.warn("[behavior/reminders] mail failed for", t.email, err?.message || err);
    }
  }
}

/** Register the minute-by-minute scheduler (call once at startup). */
export function startMorningReminders() {
  cron.schedule("* * * * *", () => {
    runDueReminders(new Date()).catch((err) =>
      console.error("[behavior/reminders] tick failed:", err?.message || err)
    );
  });
  console.log("[behavior] morning reminder scheduler started");
}
