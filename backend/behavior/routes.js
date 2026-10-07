// backend/behavior/routes.js
//
// Compass API (brief §6, §3, §5d, §7). Mounted at /api/behavior in index.js.
// Reuses the existing JWT auth (authAny) — every route is behind it. School
// membership + role are loaded from BehaviorTeacher.
//
// The append-only incident model + cross-teacher aggregation live in
// ./lib/triggerLogic.js; delivery + failover in ./lib/notify.js; the AI note in
// ./lib/aiNote.js. This file is the orchestration glue.

import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import multer from "multer";

import authAny from "../middleware/authAny.js";
import { requireAdminToken } from "../middleware/requireAdminToken.js";
import { sendEmail } from "./lib/sendEmail.js";

import BehaviorSchool from "./models/BehaviorSchool.js";
import BehaviorTeacher from "./models/BehaviorTeacher.js";
import BehaviorInvite from "./models/BehaviorInvite.js";
import BehaviorStudent from "./models/BehaviorStudent.js";
import Behavior from "./models/Behavior.js";
import BehaviorIncident from "./models/BehaviorIncident.js";
import BehaviorNotice from "./models/BehaviorNotice.js";
import BehaviorConfig from "./models/BehaviorConfig.js";
import BehaviorAuditLog from "./models/BehaviorAuditLog.js";
import BehaviorFollowup from "./models/BehaviorFollowup.js";
import BehaviorConsequence from "./models/BehaviorConsequence.js";
import { HonourRollSnapshot, HonourRollConfig } from "./models/HonourRoll.js";
import { edsbyGetJson, extractZoomStudentsRaw, buildIxlRoster } from "./lib/edsbyRead.js";
import BehaviorHouse from "./models/BehaviorHouse.js";
import HousePointEvent from "./models/HousePointEvent.js";
import HousesVisit from "./models/HousesVisit.js";
import MerchRedemption from "./models/MerchRedemption.js";
import { awardGuddAndReset } from "./lib/guddAward.js";
import { awardMonthlyConduct } from "./lib/monthlyConductAward.js";
import { readFoodDriveSheets } from "./lib/foodDriveVision.js";
import HomeworkAssignment from "./models/HomeworkAssignment.js";
import HomeworkScore from "./models/HomeworkScore.js";
import BehaviorCompetition from "./models/BehaviorCompetition.js";

import { evaluateIncident, activeThresholdIncidents, evaluatePositive } from "./lib/triggerLogic.js";
import { nextSchoolDay } from "./lib/schoolCalendar.js";
import { encrypt, decrypt } from "./lib/secretBox.js";
import { EdsbyProvider } from "./lib/providers/EdsbyProvider.js";
import { seedBehaviorDocs, recommendedHousePoints } from "./lib/seedBehaviors.js";
import { parseRoster, parseRosterFile } from "./lib/rosterImport.js";
import { DEFAULT_PARENT_TEMPLATES, fillTemplate } from "./lib/parentTemplates.js";
import { STANDARD_BEHAVIORS } from "./lib/standardBehaviors.js";
import { composeNotice, composePositiveNotice, makeDefaultAiClient, deterministicNote, deterministicPositiveNote, composeParentMessage, hasBibleVerse, stripMarkdown } from "./lib/aiNote.js";
import { buildAvgsRouter } from "./avgsRoutes.js";
import { emailShell, emailButton, noteToHtml, mdToHtml, monthlyKindChartHtml, pasteableNote } from "./lib/emailTemplate.js";
import { scheduleDispatch, dispatchNotice, sendHomeworkMessage, recordNoticeAsSent } from "./lib/notify.js";
import { uploadEvidence, signEvidenceKey, deleteEvidenceKey, isAllowedType, evidenceStorageAvailable } from "./lib/evidenceStore.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
// Photo/video evidence — larger cap (short phone clips), held in memory only
// long enough to push to S3. 30 MB covers photos + brief videos.
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 5 } });
// Food Drive class sheets (photos/scans or a PDF) for AI handwriting read.
const uploadSheets = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 25 } });

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function emailDomain(email) {
  const e = String(email || "").toLowerCase().replace(/[<>]/g, "").trim();
  const at = e.lastIndexOf("@");
  return at === -1 ? "" : e.slice(at + 1).trim();
}

// Sanitise an offence-category array to the allowed set; positives carry none.
// Clamp an incident intensity weight to the allowed set {0.5, 1, 1.5, 2}.
function clampWeight(w) {
  const n = Number(w);
  if (!n || isNaN(n)) return 1;
  return [0.5, 1, 1.5, 2].reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 1);
}

const OFFENCE_CATEGORIES = ["preparedness", "behaviour", "uniform"];
function cleanCategories(arr, kind) {
  if (kind === "positive" || !Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s || "").toLowerCase().trim()).filter((c) => OFFENCE_CATEGORIES.includes(c)))];
}
// A white slip is a "behaviour"-category consequence, so an immediate-white-slip
// behaviour is always at least "behaviour" category.
function withBehaviourIfWhiteSlip(arr, immediateWhiteSlip) {
  const a = Array.isArray(arr) ? [...arr] : [];
  if (immediateWhiteSlip && !a.includes("behaviour")) a.push("behaviour");
  return a;
}

// GUDD status for a student from their incidents + config. Counts uniform-flagged
// infractions within the GUDD-specific fade window. Returns null when GUDD is off.
//   count   uniform infractions in the window
//   lost    count >= threshold (GUDD forfeited for this period)
//   atRisk  some infractions but not yet lost
//   consequence    the escalation already incurred at this count (after the loss)
//   nextConsequence the consequence the NEXT infraction would trigger
function guddStatus(incidents, config) {
  const g = config?.gudd || {};
  if (g.enabled === false) return null;
  const threshold = g.threshold ?? 3;
  const fadeDays = g.fadeWindowDays ?? 30;
  const escalations = (Array.isArray(g.escalations) ? g.escalations : []).map((s) => String(s || "").trim()).filter(Boolean);
  // Count only infractions since the later of the fade window and the last period
  // reset ("clear the list"), so a cleared list starts the new period fresh.
  const resetAt = g.resetAt ? new Date(g.resetAt).getTime() : 0;
  const cutoff = Math.max(Date.now() - fadeDays * DAY_MS, resetAt);
  const count = (incidents || []).filter(
    (i) => i.behaviorSnapshot?.uniform && new Date(i.timestamp).getTime() > cutoff
  ).length;
  const lost = count >= threshold;
  const overBy = Math.max(0, count - threshold); // infractions beyond the loss point
  const lastEsc = escalations.length ? escalations[escalations.length - 1] : "";
  const consequence = overBy > 0 ? (escalations[overBy - 1] || lastEsc) : "";
  const nextConsequence = lost ? (escalations[overBy] || lastEsc) : "";
  return {
    enabled: true, name: g.name || "GUDD",
    count, threshold, fadeDays,
    lost, atRisk: count > 0 && !lost,
    consequence, nextConsequence,
  };
}

// Immediate white slip: record it as a consequence and email the logging teacher
// School-local timezone for rendering dates/times in server-sent emails. The
// server runs in UTC, so without this a 3:34pm occurrence prints as "7:34pm".
// Override per deployment with SCHOOL_TZ; defaults to Ontario.
const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

// (CC the VP) — "White Slip: reason, teacher, date". Never sent to a parent.
async function fireWhiteSlip({ req, student, config, behaviorName, detailText, at, relatedIncidentId = null }) {
  const studentName = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
  const first = student.preferredName || student.firstName || studentName;
  const teacherEmail = req.user?.email || "";
  // Always identify the issuing teacher. When they haven't set a display name we
  // derive one from their email (rgsommer@me.com → "rgsommer"), never the bare
  // word "Teacher", so the VP can always see who issued it.
  const teacherName = actorName(req);
  const loggedByLabel = teacherEmail && !teacherName.includes("@") ? `${teacherName} (${teacherEmail})` : teacherName;
  const vpEmail = (config?.vp?.email || "").trim();
  const when = new Date(at || Date.now());
  let consId = "";
  try {
    const cons = await BehaviorConsequence.create({
      schoolId: req.schoolId, studentId: student._id,
      type: "White slip", detail: behaviorName + (detailText ? ` — ${detailText}` : ""),
      byTeacherId: req.membership._id, byName: teacherName, relatedIncidentId, at: when,
      status: "recommended", // awaits a staff "issued? Yes" confirmation
    });
    consId = String(cons._id);
  } catch (e) { console.warn("[behavior] white-slip consequence log failed:", e?.message || e); }

  // Optional one-off house-point penalty for a white slip. Meant for schools that
  // don't deduct per-infraction, so only applied when negative deductions are off
  // (avoids double-counting the white-slip offence's own points).
  try {
    const pen = Number(config?.houseWhiteSlipPoints) || 0;
    if (config?.houseWhiteSlipDeduct && !config?.houseNegativePoints && pen > 0 && student.houseId) {
      await HousePointEvent.create({
        schoolId: req.schoolId, houseId: student.houseId, studentId: student._id,
        points: -Math.abs(pen), reason: `White slip — ${behaviorName}`, incidentId: relatedIncidentId || null,
        awardedByTeacherId: req.membership?._id || null, at: when,
      });
    }
  } catch (e) { console.warn("[behavior] white-slip house penalty failed:", e?.message || e); }

  if (!teacherEmail && !vpEmail) return;

  // Handbook ladder: how many white slips this term (incl. this one) and what the
  // handbook says should follow (3/4/5 → detention, 6th → suspension).
  let ladderLineHtml = "", ladderLineText = "";
  if (config?.whiteSlipLadder?.enabled) {
    try {
      const prior = (await periodWhiteSlipsByStudent(req.schoolId, [student._id], config))[String(student._id)] || 0;
      const nth = prior + 1;
      const next = whiteSlipLadderRecommendation(config, { periodWhiteSlips: nth });
      const ordinalish = nth === 1 ? "1st" : nth === 2 ? "2nd" : nth === 3 ? "3rd" : `${nth}th`;
      ladderLineText = `\nThis is white slip #${nth} this term${next ? ` → recommended: ${next}` : ""}.`;
      ladderLineHtml = `<p style="margin:12px 0 0;padding:10px 12px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;color:#334155;font-size:14px">` +
        `This is the <strong>${ordinalish} white slip this term</strong>${next ? ` — the handbook calls for <strong>${escapeHtml(next)}</strong>.` : "."}</p>`;
    } catch { /* ignore */ }
  }

  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await sendEmail({
      from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
      to: teacherEmail || vpEmail,
      cc: teacherEmail && vpEmail ? vpEmail : undefined,
      subject: `White Slip — ${studentName}`,
      text:
        `WHITE SLIP\n\nStudent: ${studentName}${student.classGroup ? ` (${student.classGroup})` : ""}\n` +
        `Reason: ${behaviorName}${detailText ? `\nDetail: ${detailText}` : ""}\n` +
        `Logged by: ${loggedByLabel}\nDate: ${when.toLocaleString("en-CA", { timeZone: SCHOOL_TZ })}${ladderLineText}\n\n— Compass`,
      html: emailShell({
        title: "White Slip",
        schoolName: config?.branding?.schoolName || "Compass",
        preheader: `White slip — ${studentName}`,
        contentHtml:
          `<table style="width:100%;border-collapse:collapse;color:#334155;font-size:14px">` +
          `<tr><td style="padding:4px 0;width:90px;color:#64748b">Student</td><td style="padding:4px 0"><strong>${escapeHtml(studentName)}</strong>${student.classGroup ? ` (${escapeHtml(student.classGroup)})` : ""}</td></tr>` +
          `<tr><td style="padding:4px 0;color:#64748b">Reason</td><td style="padding:4px 0">${escapeHtml(behaviorName)}</td></tr>` +
          (detailText ? `<tr><td style="padding:4px 0;color:#64748b">Detail</td><td style="padding:4px 0">${escapeHtml(detailText)}</td></tr>` : "") +
          `<tr><td style="padding:4px 0;color:#64748b">Logged by</td><td style="padding:4px 0">${escapeHtml(loggedByLabel)}</td></tr>` +
          `<tr><td style="padding:4px 0;color:#64748b">Date</td><td style="padding:4px 0">${escapeHtml(when.toLocaleString("en-CA", { timeZone: SCHOOL_TZ }))}</td></tr>` +
          `</table>` +
          ladderLineHtml +
          (consId ? (() => {
            const tok = consequenceActionToken(String(req.schoolId), consId, "issue");
            const url = `${appBase()}/behavior/consequence-action?school=${req.schoolId}&id=${consId}&action=issue&token=${encodeURIComponent(tok)}`;
            return `<p style="margin:12px 0 4px;color:#334155;font-size:14px">Once the white slip has been issued, you can confirm it right here — no need to open the app:</p>` +
              emailButton("✓ Mark white slip as issued", url, "#2563eb");
          })() : "") +
          emailButton(`View ${first} & strikes`, `${appBase()}/behavior/student/${student._id}#incident-log`, "#0f172a"),
      }),
    });
  } catch (e) { console.warn("[behavior] white-slip email failed:", e?.message || e); }
}

// Auto-recommend a white slip when a student reaches the threshold of active
// behaviour-category strikes — the same action as the manual "Recommend White
// slip" button (records it + emails the teacher, CC the VP). Fires at most once
// until the pending recommendation is resolved. Returns true if it fired.
async function maybeAutoRecommendWhiteSlip({ req, student, config, incidents }) {
  const triggerCount = config?.triggerCount ?? 3;
  const fadeDays = config?.fadeWindowDays ?? 30;
  const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
  const cutoff = Date.now() - fadeDays * DAY_MS;
  const activeBehaviour = (incidents || []).filter((inc) => {
    const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
    return mode === "THRESHOLD" && !inc.whiteSlip && !inc.countedInNoticeId &&
      new Date(inc.timestamp).getTime() > resetAt && new Date(inc.timestamp).getTime() > cutoff &&
      (inc.behaviorSnapshot?.categories || []).includes("behaviour");
  });
  if (activeBehaviour.length < triggerCount) return false;
  const already = await BehaviorConsequence.exists({ schoolId: req.schoolId, studentId: student._id, type: "White slip", status: "recommended" });
  if (already) return false;
  const n = activeBehaviour.length;
  await fireWhiteSlip({ req, student, config, behaviorName: `Recommended (${n} behaviour offence${n === 1 ? "" : "s"})`, detailText: "", at: new Date() });
  await audit(req.schoolId, "white_slip.auto_recommended", req, { studentId: String(student._id) });
  return true;
}

// Compose a short, STUDENT-directed message spelling out the consequence, to
// post to Edsby now — so a strike-1/2 consequence is communicated to the family
// straight away, not only when the threshold notice fires. It states the actual
// task ("write the following 10×", "hand-write an apology by 9am") from the
// behaviour's consequenceText, plus the follow-up deadline. Deterministic: normal
// logging is high-volume, so no AI cost.
function buildConsequenceMessage({ studentName, behaviorName, detailText, consequenceText, when, followUpType, teacherName, schoolName, reported = false }) {
  const date = new Date(when || Date.now()).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ });
  const deadline =
    followUpType === "next_school_day" ? "Please complete this and hand it in by 9:00 AM the next school day." :
    followUpType === "custom_deadline" ? "Please complete this by the deadline your teacher gave." : "";
  const lines = [];
  lines.push(`Dear ${studentName} (and parents),`);
  lines.push("");
  const first = (studentName || "").split(" ")[0] || "your child";
  if (reported) {
    lines.push(`I have reason to believe that ${first} may have been involved in ${behaviorName} on ${date}.`);
    lines.push("");
    lines.push(`Unless my information is inaccurate, ${first} is required to:`);
  } else {
    lines.push(`This is to let you know about a consequence from ${date} for ${behaviorName}${detailText ? ` — ${detailText}` : ""}.`);
    lines.push("");
    lines.push(`What to do:`);
  }
  lines.push(`  • ${consequenceText}`);
  if (deadline) { lines.push(""); lines.push(deadline); }
  lines.push("");
  lines.push(`Thank you,`);
  lines.push(`${teacherName}${schoolName ? `\n${schoolName}` : ""}`);
  return lines.join("\n");
}

// AI-polished version of the consequence message (warm but firm, Christian tone,
// student-directed with parents reading), falling back to the deterministic text
// if the AI is unavailable. Used by both the auto-email and the Copy-message button.
async function composeConsequenceMessageAI(opts) {
  // Protect other students named in the teacher's note, and word second-hand
  // reports tentatively. (opts.schoolId/studentId enable the roster scrub.)
  const scrub = opts.schoolId ? await familyNameScrubber(opts.schoolId, opts.studentId) : null;
  const prep = prepareFamilyDetail(scrub, opts.detailText);
  opts = { ...opts, detailText: prep.detail, reported: prep.reported };
  // Template fallback: leave out a note that named another student entirely.
  const det = (scrub || ((t) => t))(buildConsequenceMessage({ ...opts, detailText: prep.mentionedOther ? "" : prep.detail }));
  const aiClient = makeDefaultAiClient(opts.config || {});
  if (!aiClient) return det;
  const first = (opts.studentName || "the student").split(" ")[0] || "the student";
  const dayPhrase = relativeSchoolDay(opts.when || Date.now());
  const deadline =
    opts.followUpType === "next_school_day" ? "It must be handed in by 9:00 AM the next school day." :
    opts.followUpType === "custom_deadline" ? "It must be done by the deadline the teacher gave." : "";
  const prompt = [
    `Write a brief, warm-but-firm message from a Christian-school teacher to a student (with parents reading too), to post in Edsby. Address the student directly as "you".`,
    `Begin with the greeting: "Dear ${first} and parents,".`,
    `The student's name is ${opts.studentName} — use it where natural; NEVER output a bracketed placeholder.`,
    `Note that ${dayPhrase} there was a concern — ${opts.behaviorName}${opts.detailText ? `: ${opts.detailText}` : ""}. Then clearly state what the student must now do: ${opts.consequenceText}. ${deadline}`,
    FAMILY_PRIVACY_RULES,
    opts.reported ? REPORTED_RULE(first) : "",
    `You are writing AS ${opts.teacherName}: write in the first person ("I"). Never refer to ${opts.teacherName} in the third person.`,
    `For any deadline, keep the wording EXACTLY "the next school day" — do NOT say "tomorrow", "Saturday", a weekday, or a date (the next school day may be after the weekend or a holiday).`,
    `Close with a brief encouraging "fresh start / from now on" line and sign off exactly as: ${opts.teacherName}.`,
    `FORMAT: do NOT write one block. Use short paragraphs separated by a blank line: (1) the greeting on its own line; (2) a sentence on what happened; (3) the task SET OFF on its own line(s) — the action, the exact words to write in quotation marks, and the deadline; (4) the encouraging line; (5) the sign-off. Plain text with real line breaks, no bullets, no invented facts, no placeholders.`,
  ].filter(Boolean).join("\n");
  try {
    const out = await Promise.race([
      aiClient.complete(prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error("AI timeout")), 15000)),
    ]);
    let t = stripMarkdown(String(out || "").trim());
    t = t.replace(/\[[^\]]*\b(student|name|pupil|child)\b[^\]]*\]/gi, opts.studentName || "").replace(/\[[^\]]*\]/g, "")
      .replace(/[ \t]{2,}/g, " ")   // tidy runs of spaces WITHOUT collapsing line breaks
      .replace(/\n{3,}/g, "\n\n")    // at most one blank line between paragraphs
      .trim();
    // Guardrail: a deadline must never read "tomorrow" (could be a weekend/holiday).
    t = t.replace(/\bby\s+tomorrow\b/gi, "by the next school day").replace(/\btomorrow\b/gi, "the next school day");
    if (scrub) t = scrub(t); // last line of defence: no other student's name survives
    return t || det;
  } catch (e) { console.warn("[behavior] consequence message AI failed:", e?.message || e); return det; }
}

// Record a logged (non-white-slip) consequence on the student record so it shows
// immediately and can be marked done. Returns the created doc (or null on error).
async function recordLoggedConsequence({ req, student, behavior, detailText, at, incidentId }) {
  // Always attributable — derive from email when no display name, never "Teacher".
  const teacherName = actorName(req);
  try {
    return await BehaviorConsequence.create({
      schoolId: req.schoolId, studentId: student._id,
      type: behavior.consequenceText, detail: behavior.name + (detailText ? ` — ${detailText}` : ""),
      byTeacherId: req.membership._id, byName: teacherName, relatedIncidentId: incidentId || null,
      at: new Date(at || Date.now()),
      status: "issued", kind: "corrective",
    });
  } catch (e) { console.warn("[behavior] logged-consequence record failed:", e?.message || e); return null; }
}

// Email the logging teacher a rich, ready-to-paste Edsby message informing the
// student/parents of the consequence. Never sent to a parent directly.
async function sendConsequenceMessage({ req, student, config, behavior, detailText, at }) {
  const teacherEmail = req.user?.email || "";
  if (!teacherEmail) return;
  const studentName = `${student.preferredName || student.firstName} ${student.lastName || ""}`.trim();
  const teacherName = (req.membership?.courtesyName || "").trim() || actorName(req);
  const schoolName = config?.branding?.schoolName || "";
  const message = await composeConsequenceMessageAI({
    schoolId: req.schoolId, studentId: student._id,
    studentName, behaviorName: behavior.name, detailText,
    consequenceText: behavior.consequenceText, when: at,
    followUpType: behavior.followUpType, teacherName, schoolName, config,
  });
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await sendEmail({
      from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
      to: teacherEmail,
      subject: `Consequence to post — ${studentName} (${behavior.name})`,
      text: message,
      html: emailShell({
        title: `Consequence — ${escapeHtml(studentName)}`,
        schoolName: schoolName || "Compass",
        preheader: `Ready to paste into Edsby — ${behavior.name}`,
        footnote: "This copy goes only to you. Paste it into Edsby so the student and parents see the consequence now, rather than waiting for a notice home.",
        contentHtml: pasteableNote(noteToHtml(message)),
      }),
    });
  } catch (e) { console.warn("[behavior] consequence message email failed:", e?.message || e); }
}

// Does logging this behaviour carry a consequence the family should hear about
// now? THRESHOLD offences with a consequence, that aren't white slips (those have
// their own flow). IMMEDIATE offences already fire a notice; INTERACTION never
// notifies; positives have no consequence.
function shouldSendConsequenceNote(behavior) {
  return (
    behavior?.kind !== "positive" &&
    behavior?.triggerMode === "THRESHOLD" &&
    !behavior?.immediateWhiteSlip &&
    !!String(behavior?.consequenceText || "").trim()
  );
}

// Positive reinforcement: an encouraging note home also earns the student a few
// house points. No-op unless the message is encouraging and the student has a
// house. The per-student positive cap (if set) is applied when totals are read.
const ENCOURAGING_MSG_POINTS = 5; // fallback when the school hasn't set a value
async function awardEncouragingMessagePoints({ schoolId, student, teacherId, kind, template, points }) {
  const pts = Number.isFinite(points) ? points : ENCOURAGING_MSG_POINTS;
  if (kind !== "encouraging" || !student?.houseId || pts <= 0) return;
  try {
    await HousePointEvent.create({
      schoolId, houseId: student.houseId, studentId: student._id,
      points: pts,
      reason: `Encouraging note home${template ? ` (${template})` : ""}`,
      awardedByTeacherId: teacherId, at: new Date(),
    });
  } catch (e) { console.warn("[behavior] encouraging-message points failed:", e?.message || e); }
}

function appBase() {
  return (process.env.APP_BASE_URL || "https://www.curriculate.net").replace(/\/+$/, "");
}

// A readable name for a teacher who hasn't set a display name: the email's local
// part (e.g. "rgsommer@me.com" → "rgsommer"). "" when there's no email.
function emailLocalName(email) {
  const s = String(email || "").trim();
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, i) : "";
}
// Best available name for the acting teacher: their set display name, else a name
// derived from their email, else a safe placeholder. Never the bare "Teacher".
function actorName(req) {
  return (req?.membership?.name || req?.user?.name || "").trim() || emailLocalName(req?.user?.email) || "Unknown teacher";
}

// Whether an individual behaviour's house points should apply, by sign:
// positives gated by housePositivePoints, negatives by houseNegativePoints.
// Falls back to the legacy houseIndividualPoints switch when the granular ones
// aren't set, so existing schools behave as before until they choose.
function applyIndividualPoints(config, pts) {
  if (pts > 0) {
    return config?.housePositivePoints !== undefined
      ? config.housePositivePoints !== false
      : config?.houseIndividualPoints !== false;
  }
  if (pts < 0) {
    return config?.houseNegativePoints !== undefined
      ? !!config.houseNegativePoints
      : config?.houseIndividualPoints !== false;
  }
  return false;
}

// Start of the current "notices home" period (school year by default: most
// recent Sept 1). Notices sent before this stay in history but don't count
// toward the current period's sequence number, CC-VP rule, or escalation.
function periodStartMs(config, now = Date.now()) {
  const mode = config?.noticesResetMode || "year";
  if (mode === "term" && Array.isArray(config?.termStartDates) && config.termStartDates.length) {
    const past = config.termStartDates.map((t) => new Date(t).getTime()).filter((t) => !isNaN(t) && t <= now).sort((a, b) => b - a);
    if (past.length) return past[0];
  }
  if (mode === "fade") return now - (config?.fadeWindowDays ?? 30) * DAY_MS;
  const d = new Date(now);
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; // Sept (month 8) = school-year start
  return new Date(y, 8, 1).getTime();
}
// Count of disciplinary notices actually sent home THIS PERIOD for one student.
async function countPeriodNotices(schoolId, studentId, config) {
  return BehaviorNotice.countDocuments({
    schoolId, studentId, reason: { $ne: "positive" }, status: "sent",
    sentAt: { $gte: new Date(periodStartMs(config)) },
  });
}
// Bulk: notices sent this period per student (for the list + insights).
async function periodNoticesByStudent(schoolId, studentIds, config) {
  const rows = await BehaviorNotice.aggregate([
    { $match: { schoolId, studentId: { $in: studentIds }, reason: { $ne: "positive" }, status: "sent", sentAt: { $gte: new Date(periodStartMs(config)) } } },
    { $group: { _id: "$studentId", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

// Bulk: white slips given this period (issued or resolved-as-other) per student —
// for the handbook escalation ladder (3/4/5 → detention, 6th → suspension).
async function periodWhiteSlipsByStudent(schoolId, studentIds, config) {
  const rows = await BehaviorConsequence.aggregate([
    { $match: { schoolId, studentId: { $in: studentIds }, type: "White slip", status: { $in: ["issued", "other"] }, at: { $gte: new Date(periodStartMs(config)) } } },
    { $group: { _id: "$studentId", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

// The recommended consequence per the handbook's two numeric escalation rules.
// Returns null when the ladder is off or no rule applies (fall back to the
// admin's consequence ladder). `nthWhiteSlip` is the count INCLUDING a slip
// about to be issued, when relevant.
function whiteSlipLadderRecommendation(config, { periodNotices = 0, periodWhiteSlips = 0 } = {}) {
  const l = config?.whiteSlipLadder || {};
  if (!l.enabled) return null;
  if (l.suspensionAtCount && periodWhiteSlips >= l.suspensionAtCount) return `${l.suspensionDays || 2}-day suspension`;
  if (l.detentionFromCount && periodWhiteSlips >= l.detentionFromCount) return "After-school detention";
  if (l.emailsPerTermToWhiteSlip && periodNotices >= l.emailsPerTermToWhiteSlip) return "White slip";
  return null;
}

// A signed, unauthenticated capability link for the "Reset the GUDD list" button
// in the admin digest — so the VP can reset without logging in. Bound to the
// school AND the current week, so an old email's link stops working after ~3
// weeks. Low-stakes + reversible (it just stamps a fresh period start).
function guddResetSecret() {
  return process.env.BEHAVIOR_SECRET_KEY || process.env.JWT_SECRET || "";
}
function guddResetToken(schoolId, wk = mondayKey()) {
  const secret = guddResetSecret();
  if (!secret) return "";
  const sig = crypto.createHmac("sha256", secret).update(`gudd-reset:${schoolId}:${wk}`).digest("hex").slice(0, 32);
  return `${wk}.${sig}`;
}
function verifyGuddResetToken(schoolId, token) {
  const secret = guddResetSecret();
  if (!secret || !token) return false;
  const [wk, sig] = String(token).split(".");
  if (!wk || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(`gudd-reset:${schoolId}:${wk}`).digest("hex").slice(0, 32);
  let ok = false;
  try { ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { ok = false; }
  if (!ok) return false;
  const wkTime = Date.parse(wk + "T00:00:00Z");
  return !isNaN(wkTime) && Date.now() - wkTime <= 21 * DAY_MS; // link valid ~3 weeks
}

// Signed one-tap link for "I've talked to this student" in the homeroom check-in
// email — logs a homeroom follow-up without logging in. Bound to school+student+
// week; valid ~4 weeks. Same low-stakes, reversible spirit as the GUDD link.
function hrFollowupToken(schoolId, studentId, wk = mondayKey()) {
  const secret = guddResetSecret();
  if (!secret) return "";
  const sig = crypto.createHmac("sha256", secret).update(`hr-fu:${schoolId}:${studentId}:${wk}`).digest("hex").slice(0, 32);
  return `${wk}.${sig}`;
}
function verifyHrFollowupToken(schoolId, studentId, token) {
  const secret = guddResetSecret();
  if (!secret || !token) return false;
  const [wk, sig] = String(token).split(".");
  if (!wk || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(`hr-fu:${schoolId}:${studentId}:${wk}`).digest("hex").slice(0, 32);
  let ok = false;
  try { ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { ok = false; }
  if (!ok) return false;
  const wkTime = Date.parse(wk + "T00:00:00Z");
  return !isNaN(wkTime) && Date.now() - wkTime <= 28 * DAY_MS;
}

// Signed one-tap link for the VP to action a consequence from the email itself —
// "mark white slip issued" (issue) or "mark done" (complete) — without logging
// in. Bound to school+consequence+action+week; valid ~4 weeks.
function consequenceActionToken(schoolId, consequenceId, action, wk = mondayKey()) {
  const secret = guddResetSecret();
  if (!secret) return "";
  const sig = crypto.createHmac("sha256", secret).update(`cons-act:${schoolId}:${consequenceId}:${action}:${wk}`).digest("hex").slice(0, 32);
  return `${wk}.${sig}`;
}
function verifyConsequenceActionToken(schoolId, consequenceId, action, token) {
  const secret = guddResetSecret();
  if (!secret || !token) return false;
  const [wk, sig] = String(token).split(".");
  if (!wk || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(`cons-act:${schoolId}:${consequenceId}:${action}:${wk}`).digest("hex").slice(0, 32);
  let ok = false;
  try { ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { ok = false; }
  if (!ok) return false;
  const wkTime = Date.parse(wk + "T00:00:00Z");
  return !isNaN(wkTime) && Date.now() - wkTime <= 28 * DAY_MS;
}

// Record a homeroom follow-up (a neutral documented interaction — never a strike,
// sends nothing home). Shared by the in-app button and the emailed one-tap link.
async function logHomeroomFollowup({ schoolId, student, teacherId = null, byName = "" }) {
  let beh = await Behavior.findOne({ schoolId, name: "Homeroom follow-up" });
  if (!beh) {
    beh = await Behavior.create({
      schoolId, name: "Homeroom follow-up", keyword: "homeroom", kind: "negative", triggerMode: "INTERACTION",
      description: "A relational check-in: the homeroom teacher discusses the situation with the student to steer them right. Supportive — does not count as a strike and sends nothing home.",
      consequenceText: "", points: 0,
    });
  }
  const note = `Homeroom follow-up${byName ? ` by ${byName}` : ""} — homeroom teacher discussed the situation with the student to steer them in the right direction.`;
  return BehaviorIncident.create({
    schoolId, studentId: student._id, teacherId,
    behaviorId: beh._id,
    behaviorSnapshot: { name: beh.name, description: beh.description, triggerMode: "INTERACTION", kind: "negative", consequenceText: "", points: 0 },
    detailText: note, immediateFlag: false, timestamp: new Date(),
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// INTERACTION-mode incidents come in a few flavours. For parent-facing notes we
// distinguish a real parent contact from a teacher↔student conversation (which
// often IS the concern the teacher wants to raise), and from internal support/
// meta records that should never be surfaced to parents.
const PARENT_CONTACT_NAME = "Parent meeting / contact";
// "Offence withdrawn" is an internal record of a reversal — never framed to parents as a concern.
const SUPPORT_INTERACTION_NAMES = new Set(["Homeroom follow-up", "Whole-picture note recommended", "Offence withdrawn"]);
// A teacher↔student conversation worth telling parents about: INTERACTION mode,
// not a parent-contact log, and not an internal support/meta record.
function isConcernConversation(inc) {
  if (inc?.behaviorSnapshot?.triggerMode !== "INTERACTION") return false;
  const n = inc?.behaviorSnapshot?.name || "";
  return n !== PARENT_CONTACT_NAME && !SUPPORT_INTERACTION_NAMES.has(n);
}

// The Monday (UTC, YYYY-MM-DD) of the week containing `d` — a stable weekly key
// for the lightweight app-usage counter.
function mondayKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

// The pronoun to use in a note home: the student's explicit pronoun if set,
// otherwise derived from their gender. Returns "" when unknown — the note then
// uses the student's name rather than guessing or defaulting to singular "they".
function derivePronoun(student) {
  const explicit = String(student?.pronoun || "").trim();
  if (explicit) return explicit;
  const g = String(student?.gender || "").trim().toLowerCase();
  if (["m", "male", "boy", "man", "he", "him"].includes(g)) return "he/him";
  if (["f", "female", "girl", "woman", "she", "her"].includes(g)) return "she/her";
  return "";
}

// Insert a warm "new student" welcome after the greeting of a filled encouraging
// note, using the student's pronoun (they/them when unknown) and school name.
function injectWelcome(filled, { student, studentName, schoolName }) {
  const pron = derivePronoun(student);
  const him = pron.startsWith("he") ? "him" : pron.startsWith("she") ? "her" : "them";
  const welcome = `We're so glad to have ${studentName} join us${schoolName ? ` at ${schoolName}` : ""} — it's a real joy to have ${him} in our class.`;
  return String(filled || "").includes("\n\n") ? String(filled).replace("\n\n", `\n\n${welcome}\n\n`) : `${welcome}\n\n${filled}`;
}

/** Load the caller's school membership; 404 if they have none yet. */
async function loadMembership(req, res, next) {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) {
      return res.status(404).json({ ok: false, error: "No Compass school for this account", needsSetup: true });
    }
    req.membership = membership;
    req.schoolId = membership.schoolId;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  const role = req.membership?.role;
  if (role !== "originator" && role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

function canLog(req, res, next) {
  const role = req.membership?.role;
  if (role === "principal") {
    return res.status(403).json({ ok: false, error: "Principal role is read-only" });
  }
  next();
}

// Houses management: admins/originator OR a designated houses-committee member.
function canManageHouses(req, res, next) {
  const m = req.membership || {};
  if (m.role === "originator" || m.role === "admin" || m.housesCommittee) return next();
  return res.status(403).json({ ok: false, error: "Houses committee or admin only" });
}

async function audit(schoolId, type, req, extra = {}) {
  try {
    await BehaviorAuditLog.create({
      schoolId,
      type,
      actorUserId: req?.userId || null,
      actorEmail: req?.user?.email || "",
      ...extra,
    });
  } catch (err) {
    console.warn("[behavior] audit write failed:", err?.message || err);
  }
}

// ── Identity / setup ─────────────────────────────────────────────────────────

// Who am I in the Compass app (membership + role + config summary).
// Never expose the encrypted Edsby cookie to the client; surface a boolean.
function sanitizeConfig(config) {
  if (!config) return config;
  const c = { ...config };
  if (c.edsby) {
    c.edsby = {
      enabled: !!c.edsby.enabled,
      baseUrl: c.edsby.baseUrl || "",
      userNid: c.edsby.userNid || "",
      jver: c.edsby.jver || "",
      cver: c.edsby.cver || "",
      zoomId: c.edsby.zoomId || "",
      cookieConfigured: !!c.edsby.cookieEnc,
      formkeyConfigured: !!c.edsby.formkeyEnc,
      ingestTokenSet: !!c.edsby.ingestToken,
      updatedAt: c.edsby.updatedAt || null,
    };
  }
  return c;
}

router.get("/me", authAny, async (req, res, next) => {
  try {
    let membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    // Auto-accept a pending invite for this signed-in user, so an invited teacher
    // who just logs in (without clicking the emailed link again) is joined to
    // their school instead of dead-ending on "no school".
    if (!membership) {
      const myEmail = String(req.user?.email || "").toLowerCase();
      const invite = myEmail ? await BehaviorInvite.findOne({ email: myEmail, status: "pending" }) : null;
      if (invite) {
        membership = await BehaviorTeacher.findOneAndUpdate(
          { schoolId: invite.schoolId, userId: req.userId },
          { $set: { email: myEmail, name: req.user?.name || "", role: invite.role, status: "accepted", ...(invite.homeroom ? { homeroom: invite.homeroom } : {}) } },
          { upsert: true, new: true }
        ).lean();
        invite.status = "accepted";
        await invite.save();
        await audit(invite.schoolId, "invite.accepted", req, { meta: { email: myEmail, role: invite.role, via: "auto-on-signin" } });
      }
    }
    if (!membership) return res.json({ ok: true, membership: null, needsSetup: true });
    // Lightweight usage signal: count this week's page loads (best-effort).
    try {
      const wk = mondayKey();
      if (membership.usage?.weekKey === wk) {
        await BehaviorTeacher.updateOne({ _id: membership._id }, { $inc: { "usage.loads": 1 }, $set: { "usage.lastSeenAt": new Date() } });
      } else {
        await BehaviorTeacher.updateOne({ _id: membership._id }, { $set: { "usage.weekKey": wk, "usage.loads": 1, "usage.lastSeenAt": new Date() } });
      }
    } catch { /* never block /me on the counter */ }
    const school = await BehaviorSchool.findById(membership.schoolId).lean();
    const config = await BehaviorConfig.findOne({ schoolId: membership.schoolId }).lean();
    const admins = await BehaviorTeacher.find({ schoolId: membership.schoolId, role: { $in: ["originator", "admin"] } })
      .select("name email role")
      .lean();
    res.json({ ok: true, membership, school, config: sanitizeConfig(config), admins });
  } catch (err) {
    next(err);
  }
});

// Originator creates the school + seeds config + standard behaviours (§5).
router.post("/setup", authAny, async (req, res, next) => {
  try {
    const existing = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (existing) return res.status(409).json({ ok: false, error: "Account already belongs to a Compass school" });

    // If this person was invited to an existing school, JOIN that school rather
    // than creating a parallel one. Without this, an invited teacher who reaches
    // the first-run setup screen (e.g. before clicking their invite link) spins
    // up a duplicate empty school and gets stranded on its "import roster" page.
    const myEmail = String(req.user?.email || "").toLowerCase();
    const pendingInvite = myEmail
      ? await BehaviorInvite.findOne({ email: myEmail, status: "pending" }).lean()
      : null;
    if (pendingInvite) {
      await BehaviorTeacher.findOneAndUpdate(
        { schoolId: pendingInvite.schoolId, userId: req.userId },
        { $set: { email: myEmail, name: req.user.name || "", role: pendingInvite.role, status: "accepted", ...(pendingInvite.homeroom ? { homeroom: pendingInvite.homeroom } : {}) } },
        { upsert: true }
      );
      await BehaviorInvite.updateOne({ _id: pendingInvite._id }, { $set: { status: "accepted" } });
      await audit(pendingInvite.schoolId, "invite.accepted", req, { meta: { email: myEmail, role: pendingInvite.role, via: "setup" } });
      return res.json({ ok: true, schoolId: pendingInvite.schoolId, joined: true });
    }

    const schoolName = String(req.body?.schoolName || "").trim();
    if (!schoolName) return res.status(400).json({ ok: false, error: "schoolName required" });

    const domain = emailDomain(req.user?.email);
    if (!domain) return res.status(400).json({ ok: false, error: "Could not determine your email domain" });

    const school = await BehaviorSchool.create({
      name: schoolName,
      originatorUserId: req.userId,
      emailDomain: domain,
    });

    await BehaviorConfig.create({
      schoolId: school._id,
      branding: { schoolName },
    });

    await BehaviorTeacher.create({
      schoolId: school._id,
      userId: req.userId,
      email: String(req.user.email).toLowerCase(),
      name: req.user.name || "",
      role: "originator",
      status: "accepted",
    });

    await Behavior.insertMany(seedBehaviorDocs(school._id));
    await audit(school._id, "school.created", req, { meta: { schoolName, domain } });

    res.json({ ok: true, schoolId: school._id });
  } catch (err) {
    next(err);
  }
});

// ── Config (§5b/§5c) ─────────────────────────────────────────────────────────

router.get("/config", authAny, loadMembership, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

router.put("/config", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      "triggerCount", "fadeWindowDays", "vp", "branding", "channels",
      "aiSendMode", "cancelWindowSeconds", "aiProvider", "aiModel",
      "noticesResetMode", "termStartDates", "repeatScopeDays",
      "reminderTime", "manualNonSchoolDays", "houseReport", "housesEnabled", "housePointsResetAt",
      "homework", "vpNotify", "teacherDraft", "thresholdNotice", "consequenceLadder", "consequenceWhitelist", "adminDigest", "houseCaps", "houseEvents", "houseRewards",
      "encouragingMessagePoints", "houseIndividualPoints", "autoRecommendWhiteSlipAtThreshold",
      "housePositivePoints", "houseNegativePoints", "houseWhiteSlipDeduct", "houseWhiteSlipPoints",
    ];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    // Merge gudd by field (dot notation) so a settings save never clobbers the
    // period reset (resetAt) or the auto-Friday flag it didn't send.
    if (req.body?.gudd && typeof req.body.gudd === "object") {
      for (const [k, v] of Object.entries(req.body.gudd)) update[`gudd.${k}`] = v;
    }
    // Same field-merge for the month-end conduct award, so saving its toggle/
    // points never clobbers lastAwardMonth (the idempotency marker).
    if (req.body?.monthlyConductAward && typeof req.body.monthlyConductAward === "object") {
      for (const [k, v] of Object.entries(req.body.monthlyConductAward)) update[`monthlyConductAward.${k}`] = v;
    }
    // Handbook white-slip escalation ladder (field-merge).
    if (req.body?.whiteSlipLadder && typeof req.body.whiteSlipLadder === "object") {
      for (const [k, v] of Object.entries(req.body.whiteSlipLadder)) update[`whiteSlipLadder.${k}`] = v;
    }
    // Daily VP consequence-digest settings (field-merge, so toggling never
    // clobbers lastSentAt, the once-a-day idempotency marker).
    if (req.body?.consequenceDigest && typeof req.body.consequenceDigest === "object") {
      for (const [k, v] of Object.entries(req.body.consequenceDigest)) update[`consequenceDigest.${k}`] = v;
    }
    const config = await BehaviorConfig.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: update },
      { new: true }
    ).lean();
    await audit(req.schoolId, "config.updated", req, { meta: { fields: Object.keys(update) } });
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

// Connect Edsby (admin): store the base URL + session cookie (encrypted). The
// cookie is write-only — it's never returned. Posting per-parent happens via
// the EdsbyProvider once channels.edsby is enabled.
router.put("/config/edsby", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const update = { "edsby.updatedAt": new Date() };
    if ("enabled" in b) update["edsby.enabled"] = !!b.enabled;
    if ("baseUrl" in b) update["edsby.baseUrl"] = String(b.baseUrl || "").trim().replace(/\/+$/, "");
    // Non-secret identifiers stored plainly.
    for (const k of ["userNid", "jver", "cver", "zoomId"]) {
      if (k in b) update[`edsby.${k}`] = String(b[k] || "").trim();
    }
    // Secrets encrypted; only updated when a fresh value is supplied.
    if (b.cookie) update["edsby.cookieEnc"] = encrypt(String(b.cookie));
    if (b.formkey) update["edsby.formkeyEnc"] = encrypt(String(b.formkey));
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: update });
    await audit(req.schoolId, "config.edsby_updated", req, {
      meta: { enabled: update["edsby.enabled"], baseUrl: update["edsby.baseUrl"], cookieSet: !!b.cookie, formkeySet: !!b.formkey },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Scrape Edsby's jver/cver from a fetched page. jver is the engine bundle hash
// (engine.min.js?..._i=<hash>); cver is the bundle version. Tolerant of layout.
function extractEdsbyVersions(html) {
  const grab = (k) => {
    for (const re of [
      new RegExp(`["']?${k}["']?\\s*[:=]\\s*["']([A-Za-z0-9._-]+)["']`, "i"), // jver:"abc"
      new RegExp(`[?&]${k}=([A-Za-z0-9._-]+)`, "i"), // ...?jver=abc
    ]) {
      const m = html.match(re);
      if (m && m[1]) return m[1];
    }
    return "";
  };
  let jver = grab("jver");
  let cver = grab("cver");
  if (!jver) {
    const m =
      html.match(/engine(?:\.min)?\.js\?[^"'<> ]*?[?&]_i=([A-Za-z0-9._-]+)/i) ||
      html.match(/[?&]_i=([A-Za-z0-9._-]{6,})/i);
    if (m) jver = m[1];
  }
  // The formkey is often embedded in a logged-in page (window._cf.formkey /
  // _formkey). Scraping it from the authenticated HTML beats the openSesame call.
  let formkey = "";
  const fm =
    html.match(/["']?_?formkey["']?\s*[:=]\s*["']([A-Za-z0-9._\-]+)["']/i) ||
    html.match(/name=["']_formkey["'][^>]*value=["']([^"']+)["']/i);
  if (fm) formkey = fm[1];
  return { jver, cver, formkey };
}

// One-tap "Refresh from Edsby": auto-detects jver/cver from the public bootstrap
// AND, if a session cookie is stored, refreshes the (short-lived) formkey. Saves
// whatever it can and reports what was updated / what's still missing. The cookie
// itself can't be fetched (login-gated / HttpOnly) — it stays a manual paste.
router.post("/edsby/refresh", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const baseUrl = String(req.body?.baseUrl || e.baseUrl || "").trim().replace(/\/+$/, "");
    const updated = [];
    const notes = [];
    let jver = e.jver || "";
    let cver = e.cver || "";
    const cookie = e.cookieEnc ? decrypt(e.cookieEnc) : "";

    // 1) Read jver/cver (and maybe the formkey) from the Edsby page. Fetch it
    // WITH the cookie when we have one — the anonymous landing page is just a
    // login shell, but the authenticated page embeds the bundle hash + formkey.
    let scrapedFormkey = "";
    if (/^https:\/\//i.test(baseUrl)) {
      try {
        const headers = { "User-Agent": "Mozilla/5.0", Accept: "text/html" };
        if (cookie) headers.Cookie = cookie;
        const r = await fetch(baseUrl, { redirect: "follow", headers });
        const found = extractEdsbyVersions(await r.text());
        if (found.jver) jver = found.jver;
        if (found.cver) cver = found.cver;
        if (found.formkey) scrapedFormkey = found.formkey;
        if (!found.jver && !found.cver) {
          notes.push(cookie
            ? "couldn't read jver/cver even when signed in — copy them from a request's x-xds-jver / x-xds-cver headers, or run the Cookie Sync extension"
            : "couldn't read jver/cver from the public page — save the cookie first, then Refresh again");
        } else if (!cver) {
          // cver lives only in the x-xds-cver request header, never the HTML —
          // the formkey call 403s without it.
          notes.push("got jver but cver isn't on the page — paste x-xds-cver from a request header (DevTools), or run the Cookie Sync extension to capture it");
        }
      } catch (err) {
        notes.push(`version fetch failed: ${err?.message || err}`);
      }
    } else {
      notes.push("set the Edsby base URL (https://…) first");
    }

    const set = {};
    if (jver && jver !== e.jver) { set["edsby.jver"] = jver; updated.push("jver"); }
    if (cver && cver !== e.cver) { set["edsby.cver"] = cver; updated.push("cver"); }

    // 2) Formkey: prefer the one scraped from the authenticated page; otherwise
    // fall back to the openSesame refresh (needs a cookie + correct jver/cver).
    let formkeyOk = null;
    let formkeyError = "";
    if (scrapedFormkey) {
      set["edsby.formkeyEnc"] = encrypt(scrapedFormkey);
      updated.push("formkey");
      formkeyOk = true;
    } else if (cookie) {
      const provider = new EdsbyProvider({
        baseUrl, cookie, formkey: decrypt(e.formkeyEnc), jver, cver, userNid: e.userNid,
      });
      const r = await provider.testConnection(e.zoomId);
      formkeyOk = r.ok;
      if (r.ok && r.formkey) { set["edsby.formkeyEnc"] = encrypt(r.formkey); updated.push("formkey"); }
      else formkeyError = r.error || r.message || "";
    } else {
      notes.push("no session cookie saved yet — paste it from DevTools, Save, then Refresh again");
    }

    if (Object.keys(set).length) {
      set["edsby.updatedAt"] = new Date();
      await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: set });
    }
    await audit(req.schoolId, "edsby.refresh", req, { meta: { updated, formkeyOk } });
    res.json({ ok: true, jver, cver, updated, formkeyOk, formkeyError, notes });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// Generate (or rotate) the ingest token a browser script uses to push fresh
// Edsby creds in. Returns the token ONCE — store it in your script; regenerating
// invalidates the previous one.
router.post("/edsby/ingest-token", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const token = crypto.randomBytes(24).toString("hex");
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "edsby.ingestToken": token } });
    await audit(req.schoolId, "edsby.ingest_token_rotated", req, {});
    res.json({ ok: true, token, url: "/api/behavior/edsby/ingest" });
  } catch (err) {
    next(err);
  }
});

// Token-authenticated credential push — NO login required (the token IS the
// auth), so a browser userscript on the Edsby page can POST fresh creds here.
// Accepts any of: cookie, formkey, jver, cver, userNid, zoomId, baseUrl. Secrets
// are encrypted at rest. Only the fields supplied are updated.
router.post("/edsby/ingest", async (req, res) => {
  try {
    const token = String(req.headers["x-ingest-token"] || req.body?.token || "").trim();
    if (!token) return res.status(401).json({ ok: false, error: "missing token" });
    const config = await BehaviorConfig.findOne({ "edsby.ingestToken": token }).select("_id schoolId").lean();
    if (!config) return res.status(401).json({ ok: false, error: "invalid token" });

    const b = req.body || {};

    // One-shot mode: push the cookie into a short-lived run slot (used by an
    // honour-roll run and auto-expired), NOT the persistent session. Keeps the
    // admin session from sitting warm on the server.
    if (b.oneShot === true) {
      if (!b.cookie) return res.status(400).json({ ok: false, error: "no cookie" });
      const ttlMin = Math.min(60, Math.max(1, parseInt(b.ttlMinutes, 10) || 10));
      await BehaviorConfig.updateOne({ _id: config._id }, {
        $set: {
          "edsby.runCookieEnc": encrypt(String(b.cookie)),
          "edsby.runCookieExpiresAt": new Date(Date.now() + ttlMin * 60 * 1000),
          "edsby.updatedAt": new Date(),
        },
      });
      await audit(config.schoolId, "edsby.run_session_pushed", req, { meta: { ttlMin, via: "ingest-token" } });
      return res.json({ ok: true, oneShot: true, expiresInMinutes: ttlMin });
    }

    const set = { "edsby.updatedAt": new Date() };
    const updated = [];
    for (const k of ["userNid", "jver", "cver", "zoomId"]) {
      if (k in b && String(b[k] || "").trim()) { set[`edsby.${k}`] = String(b[k]).trim(); updated.push(k); }
    }
    if (b.baseUrl) { set["edsby.baseUrl"] = String(b.baseUrl).trim().replace(/\/+$/, ""); updated.push("baseUrl"); }
    if (b.cookie) { set["edsby.cookieEnc"] = encrypt(String(b.cookie)); updated.push("cookie"); }
    if (b.formkey) { set["edsby.formkeyEnc"] = encrypt(String(b.formkey)); updated.push("formkey"); }
    if (updated.length <= 0) return res.status(400).json({ ok: false, error: "no fields to update" });

    await BehaviorConfig.updateOne({ _id: config._id }, { $set: set });
    await audit(config.schoolId, "edsby.ingested", req, { meta: { updated, via: "ingest-token" } });
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Token-authenticated ALL-FIELDS student export — for the Google Sheet script,
// so the sheet never needs the Edsby cookie. Uses the session the Cookie Sync
// extension keeps fresh here (BehaviorConfig.edsby), reads ZoomMyStudents
// stage=1 for the configured node(s), and returns every field per student.
// The ingest token already controls the Edsby connection, so it may read the
// students that connection can see.
router.post("/edsby/students-export", async (req, res) => {
  try {
    const token = String(req.headers["x-ingest-token"] || req.body?.token || "").trim();
    if (!token) return res.status(401).json({ ok: false, error: "missing token" });
    const config = await BehaviorConfig.findOne({ "edsby.ingestToken": token }).lean();
    if (!config) return res.status(401).json({ ok: false, error: "invalid token" });

    const e = config.edsby || {};
    if (!e.baseUrl || !e.cookieEnc) {
      return res.status(400).json({ ok: false, error: "Edsby isn't connected for this school. Run the Cookie Sync extension (or connect Edsby in Behaviours Setup) first." });
    }
    const session = { baseUrl: e.baseUrl, cookie: decrypt(e.cookieEnc), jver: e.jver || "", cver: e.cver || "", userNid: e.userNid || "" };

    const hr = await HonourRollConfig.findOne({ schoolId: config.schoolId }).select("zoomNid").lean();
    const nodeSpec = String(req.body?.node || hr?.zoomNid || e.zoomId || "").trim();
    const nodeIds = nodeSpec.split(",").map((s) => s.trim()).filter(Boolean);
    if (!nodeIds.length) {
      return res.status(400).json({ ok: false, error: "No Edsby “My Students” node id set. Pass one as { node } or set it in the honour-roll setup." });
    }

    const byNid = new Map();
    const allFields = new Set();
    const edsbyErrors = [];
    for (const node of nodeIds) {
      const r = await edsbyGetJson(session, node, "ZoomMyStudents", "&stage=1");
      if (r.status === 401 || r.text === "session-expired") {
        return res.status(409).json({ ok: false, error: "Edsby session expired. Open Edsby so the Cookie Sync extension refreshes it, then retry." });
      }
      if (!r.ok) {
        // Surface Edsby's own error (e.g. 1030 "denied nodetype") for this node.
        const j = r.json || {};
        const code = j.errorcode ?? j.error;
        const str = j.errorstr || j.errorStr || "";
        edsbyErrors.push({ node, status: r.status, code: code ?? null, message: str || `HTTP ${r.status}` });
        continue;
      }
      const { students, fields } = extractZoomStudentsRaw(r.json);
      fields.forEach((f) => allFields.add(f));
      for (const s of students) if (s.nid && !byNid.has(s.nid)) byNid.set(s.nid, s);
    }
    const students = [...byNid.values()];
    if (!students.length) {
      const e0 = edsbyErrors[0];
      let error = "Edsby returned no students. Check that the node has stage=1 student rows.";
      if (e0) {
        error = `Edsby refused node ${e0.node}` + (e0.code ? ` (error ${e0.code})` : "") + (e0.message ? `: ${e0.message}` : "") + ".";
        if (String(e0.code) === "1030" || /denied nodetype/i.test(e0.message)) {
          error += ' That node isn\'t a "My Students" the connected Edsby session can open. Use the number from THAT account\'s own Edsby URL /p/ZoomMyStudents/NUMBER (not a class or formkey id), and make sure the extension synced that same account\'s session.';
        }
      }
      return res.status(502).json({ ok: false, error, edsbyErrors });
    }
    // Column order: the raw preferred columns first, then the rest sorted.
    const PREF = ["nid", "SID", "MinistryID", "FirstName", "PrefName", "MName", "LastName", "Gender", "Grade", "Average", "accountStatus", "haveiep", "_HomeroomTeacher", "_Classes"];
    const rest = [...allFields].filter((f) => !PREF.includes(f)).sort();
    const fields = PREF.filter((f) => allFields.has(f)).concat(rest);

    await audit(config.schoolId, "edsby.students_exported", req, { meta: { count: students.length, via: "ingest-token" } });
    res.json({ ok: true, fields, students });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// IXL import roster — token-authed, uses the extension-synced session (same as
// students-export) so no cookie ever touches the sheet. Walks each student's
// Panorama → parents → ParentDetails to fill parent emails. Returns the 14 IXL
// columns + rows. Student email / race / home language aren't in Edsby (blank).
router.post("/edsby/ixl-roster", async (req, res) => {
  try {
    const token = String(req.headers["x-ingest-token"] || req.body?.token || "").trim();
    if (!token) return res.status(401).json({ ok: false, error: "missing token" });
    const config = await BehaviorConfig.findOne({ "edsby.ingestToken": token }).lean();
    if (!config) return res.status(401).json({ ok: false, error: "invalid token" });

    const e = config.edsby || {};
    if (!e.baseUrl || !e.cookieEnc) {
      return res.status(400).json({ ok: false, error: "Edsby isn't connected for this school. Run the Cookie Sync extension (or connect Edsby in Behaviours Setup) first." });
    }
    const session = { baseUrl: e.baseUrl, cookie: decrypt(e.cookieEnc), jver: e.jver || "", cver: e.cver || "", userNid: e.userNid || "" };

    const hr = await HonourRollConfig.findOne({ schoolId: config.schoolId }).select("zoomNid").lean();
    const nodeSpec = String(req.body?.node || hr?.zoomNid || e.zoomId || "").trim();
    const nodeIds = nodeSpec.split(",").map((s) => s.trim()).filter(Boolean);
    if (!nodeIds.length) {
      return res.status(400).json({ ok: false, error: "No Edsby “My Students” node id set. Pass one as { node } or set it in the honour-roll setup." });
    }

    const out = await buildIxlRoster(session, nodeIds, { teacher: req.body?.teacher || "" });
    if (out.sessionExpired) {
      return res.status(409).json({ ok: false, error: "Edsby session expired. Open Edsby so the Cookie Sync extension refreshes it, then retry." });
    }
    if (!out.rows.length) {
      const e0 = (out.edsbyErrors || [])[0];
      let error = "Edsby returned no students. Check that the node has stage=1 student rows.";
      if (e0) {
        error = `Edsby refused node ${e0.node}` + (e0.code ? ` (error ${e0.code})` : "") + (e0.message ? `: ${e0.message}` : "") + ".";
        if (String(e0.code) === "1030" || /denied nodetype/i.test(e0.message || "")) {
          error += ' Use the number from that account\'s own Edsby URL /p/ZoomMyStudents/NUMBER, and make sure the extension synced that same account.';
        }
      }
      return res.status(502).json({ ok: false, error, edsbyErrors: out.edsbyErrors });
    }

    await audit(config.schoolId, "edsby.ixl_exported", req, { meta: { ...out.stats, via: "ingest-token" } });
    res.json({ ok: true, columns: out.columns, rows: out.rows, sections: out.sections, stats: out.stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// A teacher's OWN Edsby identity (any member — NOT admin-gated). So a notice
// posts AS the teacher who sent it: they enter their Edsby user nid + paste
// their session cookie; jver/cver/baseUrl come from the school config. Secrets
// are stored encrypted and never returned. Unset → falls back to the school's
// shared Edsby connection.
router.get("/my-edsby", authAny, loadMembership, async (req, res, next) => {
  try {
    const me = await BehaviorTeacher.findById(req.membership._id).select("edsbyUserNid edsbyCookieEnc edsbyZoomNid").lean();
    const cfg = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("edsby.baseUrl edsby.enabled").lean();
    res.json({
      ok: true,
      userNid: me?.edsbyUserNid || "",
      hasCookie: !!me?.edsbyCookieEnc,
      zoomNid: me?.edsbyZoomNid || "",
      baseUrl: cfg?.edsby?.baseUrl || "",
      edsbyEnabled: !!cfg?.edsby?.enabled,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/my-edsby", authAny, loadMembership, async (req, res, next) => {
  try {
    const b = req.body || {};
    const set = {};
    if (b.clear === true) {
      set.edsbyUserNid = "";
      set.edsbyCookieEnc = "";
      set.edsbyFormkeyEnc = "";
      set.edsbyZoomNid = "";
    } else {
      if ("userNid" in b) set.edsbyUserNid = String(b.userNid || "").replace(/[^\d]/g, "").slice(0, 32);
      if (b.cookie && String(b.cookie).trim()) set.edsbyCookieEnc = encrypt(String(b.cookie).trim());
      if ("zoomNid" in b) set.edsbyZoomNid = String(b.zoomNid || "").replace(/[^\d,]/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "").slice(0, 200);
    }
    if (!Object.keys(set).length) return res.status(400).json({ ok: false, error: "Nothing to update." });
    await BehaviorTeacher.updateOne({ _id: req.membership._id }, { $set: set });
    await audit(req.schoolId, "edsby.my_identity_updated", req, { meta: { fields: Object.keys(set) } });
    const me = await BehaviorTeacher.findById(req.membership._id).select("edsbyUserNid edsbyCookieEnc edsbyZoomNid").lean();
    res.json({ ok: true, userNid: me.edsbyUserNid || "", hasCookie: !!me.edsbyCookieEnc, zoomNid: me.edsbyZoomNid || "" });
  } catch (err) {
    next(err);
  }
});

// ── Parent message templates (per teacher) ──────────────────────────────────

// The teacher's editable parent-message templates + subject label. Seeds the
// generalized defaults when the teacher hasn't saved any yet.
router.get("/my-templates", authAny, loadMembership, async (req, res, next) => {
  try {
    const me = await BehaviorTeacher.findById(req.membership._id).select("subject parentTemplates").lean();
    const templates = (me?.parentTemplates && me.parentTemplates.length) ? me.parentTemplates : DEFAULT_PARENT_TEMPLATES;
    res.json({ ok: true, subject: me?.subject || "", templates, teacherName: req.membership.name || req.user?.name || "" });
  } catch (err) {
    next(err);
  }
});

router.put("/my-templates", authAny, loadMembership, async (req, res, next) => {
  try {
    const b = req.body || {};
    const set = {};
    if ("subject" in b) set.subject = String(b.subject || "").trim().slice(0, 120);
    if (Array.isArray(b.templates)) {
      set.parentTemplates = b.templates
        .map((t) => ({
          name: String(t?.name || "").trim().slice(0, 80),
          body: String(t?.body || "").slice(0, 4000),
          kind: t?.kind === "corrective" ? "corrective" : "encouraging",
        }))
        .filter((t) => t.name || t.body)
        .slice(0, 40);
    }
    if (!Object.keys(set).length) return res.status(400).json({ ok: false, error: "Nothing to update." });
    await BehaviorTeacher.updateOne({ _id: req.membership._id }, { $set: set });
    const me = await BehaviorTeacher.findById(req.membership._id).select("subject parentTemplates").lean();
    res.json({ ok: true, subject: me.subject || "", templates: me.parentTemplates || [] });
  } catch (err) {
    next(err);
  }
});

// Generate a parent message for a student from one of the teacher's templates:
// fill the placeholders, LOG it as a documented action, and return the text for
// the teacher to paste into their own email. Never sends anything itself.
router.post("/students/:id/parent-message", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const name = String(req.body?.name || "").trim();
    const me = await BehaviorTeacher.findById(req.membership._id).select("subject parentTemplates name").lean();
    const templates = (me?.parentTemplates && me.parentTemplates.length) ? me.parentTemplates : DEFAULT_PARENT_TEMPLATES;
    const tpl = templates.find((t) => t.name === name) || templates[0];
    if (!tpl) return res.status(400).json({ ok: false, error: "No template selected." });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("branding.schoolName aiProvider aiModel encouragingMessagePoints").lean();
    const school = await BehaviorSchool.findById(req.schoolId).select("name").lean();
    const teacherName = req.membership.name || req.user?.name || "";
    const kind = tpl.kind === "encouraging" ? "encouraging" : "corrective";
    const studentName = student.preferredName || student.firstName || "";

    // Don't let the same encouraging message go to a student twice in a year —
    // alert the teacher (they can still send with force after confirming). Keeps
    // praise from ringing hollow / looking like a form letter.
    if (kind === "encouraging" && req.body?.force !== true) {
      const prior = await BehaviorConsequence.findOne({
        schoolId: req.schoolId, studentId: student._id,
        type: `Parent message: ${tpl.name}`,
        at: { $gt: new Date(Date.now() - 365 * DAY_MS) },
      }).sort({ at: -1 }).select("at").lean();
      if (prior) return res.json({ ok: true, duplicate: true, lastSentAt: prior.at, template: tpl.name });
    }

    let filled = fillTemplate(tpl.body, {
      student,
      teacher: teacherName,
      subject: me?.subject || "",
      schoolName: config?.branding?.schoolName || school?.name || "",
    });
    // New student on an encouraging note: add a warm welcome saying how glad we
    // are to have them. Inserted after the greeting so the AI rewrite keeps it.
    if (req.body?.newStudent === true && kind === "encouraging") {
      filled = injectWelcome(filled, { student, studentName, schoolName: config?.branding?.schoolName || school?.name || "" });
    }
    // Rewrite the filled template so each note is unique (not an obvious form
    // letter), keeping its Christian character — a verse in, a verse out.
    const aiClient = makeDefaultAiClient(config || {});
    const { text: message } = await composeParentMessage(
      { filled, studentName, teacherName, keepVerse: hasBibleVerse(tpl.body) },
      { aiClient }
    );

    // Log that the teacher sent a parent message. Encouraging notes are recorded
    // as "encouraging" (shown under the student's Encouragements); corrective ones
    // as "corrective" (shown under Consequences). Never a strike.
    await BehaviorConsequence.create({
      schoolId: req.schoolId, studentId: student._id,
      type: `Parent message: ${tpl.name}`, detail: "Copied to send by the teacher",
      byTeacherId: req.membership._id, byName: teacherName, status: "issued", kind,
      issuedByTeacherId: req.membership._id, issuedByName: teacherName, issuedAt: new Date(),
    });
    await awardEncouragingMessagePoints({ schoolId: req.schoolId, student, teacherId: req.membership._id, kind, template: tpl.name, points: config?.encouragingMessagePoints });
    await audit(req.schoolId, "parent_message.generated", req, { studentId: String(student._id), meta: { template: tpl.name } });
    // `html` is a rich version of the same message: the UI copies it to the
    // clipboard as text/html so pasting into Edsby keeps the bold + bullets.
    res.json({ ok: true, message, html: noteToHtml(message), template: tpl.name });
  } catch (err) {
    next(err);
  }
});

// Bulk parent messages: for each selected student, fill the template, EMAIL the
// filled message to the teacher (one email per student, ready to forward), and
// log it separately. Never emails a parent directly.
router.post("/parent-message/bulk", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const ids = (Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map((x) => String(x)).slice(0, 60);
    if (!ids.length) return res.status(400).json({ ok: false, error: "No students selected." });

    const teacherEmail = String(req.user?.email || "").trim();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "No email on your account to send to." });

    const me = await BehaviorTeacher.findById(req.membership._id).select("subject parentTemplates name").lean();
    const templates = (me?.parentTemplates && me.parentTemplates.length) ? me.parentTemplates : DEFAULT_PARENT_TEMPLATES;
    const tpl = templates.find((t) => t.name === name) || templates[0];
    if (!tpl) return res.status(400).json({ ok: false, error: "No template selected." });
    const kind = tpl.kind === "encouraging" ? "encouraging" : "corrective";

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("branding.schoolName aiProvider aiModel encouragingMessagePoints").lean();
    const school = await BehaviorSchool.findById(req.schoolId).select("name").lean();
    const schoolName = config?.branding?.schoolName || school?.name || "";
    const teacherName = req.membership.name || req.user?.name || "";
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    const aiClient = makeDefaultAiClient(config || {});
    const keepVerse = hasBibleVerse(tpl.body);

    const students = await BehaviorStudent.find({ _id: { $in: ids }, schoolId: req.schoolId, active: true }).lean();

    // Skip students who already got this encouraging message in the last year
    // (unless the teacher forces it), and report them so nothing goes silently.
    let alreadySent = new Set();
    if (kind === "encouraging" && req.body?.force !== true) {
      const priors = await BehaviorConsequence.find({
        schoolId: req.schoolId, studentId: { $in: students.map((s) => s._id) },
        type: `Parent message: ${tpl.name}`, at: { $gt: new Date(Date.now() - 365 * DAY_MS) },
      }).select("studentId").lean();
      alreadySent = new Set(priors.map((p) => String(p.studentId)));
    }

    let sent = 0, logged = 0;
    const skipped = [];
    for (const student of students) {
      const studentName = `${student.preferredName || student.firstName} ${student.lastName || ""}`.trim();
      if (alreadySent.has(String(student._id))) { skipped.push({ id: String(student._id), name: studentName }); continue; }
      const firstName = student.preferredName || student.firstName || "";
      let filled = fillTemplate(tpl.body, { student, teacher: teacherName, subject: me?.subject || "", schoolName });
      // "These are all new students": add the warm welcome to each encouraging note.
      if (req.body?.newStudent === true && kind === "encouraging") {
        filled = injectWelcome(filled, { student, studentName: firstName, schoolName });
      }
      const { text: message } = await composeParentMessage(
        { filled, studentName: firstName, teacherName, keepVerse },
        { aiClient }
      );
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to: teacherEmail,
          subject: `Parent message — ${studentName} (${tpl.name})`,
          text: message,
          html: emailShell({
            title: `Parent message — ${escapeHtml(studentName)}`,
            schoolName: schoolName || "Compass",
            preheader: `Ready to paste into Edsby — ${tpl.name}`,
            accent: kind === "encouraging" ? "#16a34a" : "#0f172a",
            footnote: "This copy goes only to you. Paste it into Edsby to send it to the family.",
            contentHtml: pasteableNote(noteToHtml(message)),
          }),
        });
        sent += 1;
      } catch (e) { console.warn("[behavior] bulk parent-message email failed:", e?.message || e); }
      try {
        await BehaviorConsequence.create({
          schoolId: req.schoolId, studentId: student._id,
          type: `Parent message: ${tpl.name}`, detail: "Emailed to the teacher to send",
          byTeacherId: req.membership._id, byName: teacherName, status: "issued", kind,
          issuedByTeacherId: req.membership._id, issuedByName: teacherName, issuedAt: new Date(),
        });
        logged += 1;
      } catch (e) { console.warn("[behavior] bulk parent-message log failed:", e?.message || e); }
      await awardEncouragingMessagePoints({ schoolId: req.schoolId, student, teacherId: req.membership._id, kind, template: tpl.name, points: config?.encouragingMessagePoints });
    }
    await audit(req.schoolId, "parent_message.bulk", req, { meta: { template: tpl.name, requested: ids.length, sent, logged, skipped: skipped.length } });
    // `skipped` carries {id,name} so the UI can re-send only those on a force.
    res.json({ ok: true, template: tpl.name, requested: ids.length, matched: students.length, sent, logged, skipped, to: teacherEmail });
  } catch (err) {
    next(err);
  }
});

// Send a test email (admin) to verify SMTP delivery. Returns the SMTP error in
// the body (still 200) so the UI can show exactly why it failed.
router.post("/test-email", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const to = String(req.body?.to || req.user?.email || "").trim();
    if (!to) return res.status(400).json({ ok: false, error: "No recipient address" });
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    try {
      await sendEmail({
        from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
        to,
        subject: "Compass — test email ✓",
        text: `This is a test from Compass. If you received it, email delivery is working.\n\nSent ${new Date().toLocaleString("en-CA", { timeZone: SCHOOL_TZ })}.`,
        html: emailShell({
          title: "Email delivery is working ✓",
          contentHtml:
            `<p style="margin:0 0 10px;color:#334155;line-height:1.6">This is a test from Compass. If you can read this, your email delivery is set up correctly.</p>` +
            `<p style="margin:0;color:#94a3b8;font-size:13px">Sent ${escapeHtml(new Date().toLocaleString("en-CA", { timeZone: SCHOOL_TZ }))}.</p>`,
        }),
      });
      await audit(req.schoolId, "email.test_sent", req, { meta: { to } });
      return res.json({ ok: true, to, fromConfigured: !!fromAddr });
    } catch (mailErr) {
      return res.json({ ok: false, to, fromConfigured: !!fromAddr, error: mailErr?.message || String(mailErr) });
    }
  } catch (err) {
    next(err);
  }
});

// Build a SAMPLE parent notice (with your branding + signature) so you can see
// exactly what families receive. Returns the rendered HTML for an in-app preview
// and, when { email:true }, sends it to you. Uses the deterministic template
// (no AI cost) and made-up incidents — nothing is logged or sent to a parent.
router.post("/test-notice", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const kind = req.body?.kind === "positive" ? "positive" : "negative";
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("branding").lean();
    const schoolName = config?.branding?.schoolName || "";
    // Sign the sample as the teacher viewing it would be signed — their name —
    // so the preview matches a real notice.
    const myName = (req.membership?.name || "").trim();
    const signature =
      (req.membership?.signature || "").trim() ||
      (myName ? `Sincerely,\n${myName}${schoolName ? `\nTeacher, ${schoolName}` : ", Teacher"}` : (config?.branding?.signatureBlock || `Sincerely,\n${schoolName}`).trim());
    const studentName = "Alex";
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let text;
    if (kind === "positive") {
      text = deterministicPositiveNote({
        studentName, schoolName, signature,
        incidents: [
          { behaviorName: "Helped a classmate", teacherName: "Ms. Lee", date: new Date(now - 6 * DAY) },
          { behaviorName: "Great effort in math", teacherName: "Mr. Patel", date: new Date(now - 3 * DAY) },
          { behaviorName: "Showed leadership at recess", teacherName: "Ms. Lee", date: new Date(now - 1 * DAY) },
        ],
      });
    } else {
      text = deterministicNote({
        studentName, schoolName, signature, sequenceNo: 1, daysSinceFirst: 3,
        consequences: ["Write out the expectation 10× and return it signed."],
        incidents: [
          { behaviorName: "Talking during instruction", teacherName: "Ms. Lee", date: new Date(now - 3 * DAY) },
          { behaviorName: "Disrupting the lesson", teacherName: "Mr. Patel", date: new Date(now - 1 * DAY) },
          { behaviorName: "Out of seat repeatedly", teacherName: "Ms. Lee", date: new Date(now) },
        ],
        positives: [],
      });
    }

    const subject = kind === "positive" ? `Good news about ${studentName} 🎉 (sample)` : `Behaviour notice — ${studentName} (sample)`;
    const html = emailShell({
      title: kind === "positive" ? "A note of good news" : "A note from school",
      schoolName,
      preheader: "Sample notice — preview only.",
      accent: kind === "positive" ? "#16a34a" : "#0f172a",
      footnote: "This is a SAMPLE preview — no incident was logged and no parent was contacted.",
      contentHtml: noteToHtml(text),
    });

    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to: req.user.email,
          subject,
          text,
          html,
        });
        emailed = true;
      } catch (e) {
        emailError = e?.message || String(e);
      }
    }

    res.json({ ok: true, kind, subject, html, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Test the Edsby connection (admin): authenticates with the stored cookie and
// refreshes the formkey. Saves the fresh formkey on success. Doesn't message a
// parent. The actual broadcast is exercised when a real notice sends via Edsby.
router.post("/test-edsby", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const provider = new EdsbyProvider({
      baseUrl: e.baseUrl,
      cookie: decrypt(e.cookieEnc),
      formkey: decrypt(e.formkeyEnc),
      jver: e.jver,
      cver: e.cver,
      userNid: e.userNid,
    });
    const r = await provider.testConnection(e.zoomId);
    if (r.ok && r.formkey) {
      await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "edsby.formkeyEnc": encrypt(r.formkey) } });
    }
    await audit(req.schoolId, "edsby.test", req, { meta: { ok: r.ok } });
    res.json({ ok: r.ok, message: r.message, error: r.error });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// End-to-end Edsby test: actually POST a broadcast to a nid (defaults to your
// own Edsby user nid) so you can confirm a message lands in Edsby.
router.post("/test-edsby-send", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const toNid = String(req.body?.toNid || "").trim() || String(e.userNid || "").trim();
    if (!toNid) return res.json({ ok: false, error: "No target nid — set your Edsby user nid, or enter one." });
    // Edsby links a parent broadcast to a student context (Panorama Referer).
    // Only set it if a real student nid is given — defaulting it to the recipient
    // builds an invalid Panorama referer (and 1042s) when the recipient is a
    // teacher/colleague rather than a parent.
    const studentNid = String(req.body?.studentNid || "").trim();
    const provider = new EdsbyProvider({
      baseUrl: e.baseUrl, cookie: decrypt(e.cookieEnc), formkey: decrypt(e.formkeyEnc),
      jver: e.jver, cver: e.cver, userNid: e.userNid, studentNid,
    });
    const message = String(req.body?.message || "").trim() ||
      "Test broadcast from Compass — if you can see this in Edsby, posting works.";
    const r = await provider.send({ recipient: { edsbyParentId: toNid }, body: message });
    await audit(req.schoolId, "edsby.test_send", req, { meta: { toNid, ok: r.ok } });
    res.json({ ok: r.ok, error: r.error });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// ── Invites (§5d) ────────────────────────────────────────────────────────────

// Any member can invite a teacher (domain-restricted); only the originator can
// grant the admin role (guarded below).
router.post("/invite", authAny, loadMembership, async (req, res, next) => {
  try {
    const role = ["admin", "teacher", "principal"].includes(req.body?.role) ? req.body.role : "teacher";
    // Only the originator may grant admin.
    if (role === "admin" && req.membership.role !== "originator") {
      return res.status(403).json({ ok: false, error: "Only the originator can grant admin" });
    }
    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email])
      .map((e) => {
        const m = String(e || "").match(/[\w.+-]+@[\w.-]+\.\w{2,}/); // pull addr from "Name <email>"
        return m ? m[0].toLowerCase() : String(e || "").trim().toLowerCase().replace(/[<>]/g, "");
      })
      .filter(Boolean);
    if (!emails.length) return res.status(400).json({ ok: false, error: "No email addresses provided" });

    const created = [];
    const rejected = [];
    for (const email of emails) {
      // Domain restriction (§5d): must match the school's domain.
      if (emailDomain(email) !== school.emailDomain) {
        rejected.push({ email, reason: `outside school domain @${school.emailDomain}` });
        continue;
      }
      const token = crypto.randomBytes(24).toString("hex");
      await BehaviorInvite.findOneAndUpdate(
        { schoolId: req.schoolId, email },
        { $set: { token, role, status: "pending", invitedByEmail: req.user.email, lastSentAt: new Date() } },
        { upsert: true, new: true }
      );
      const link = `${appBase()}/behavior/accept?token=${token}`;
      const inviter = (req.user?.name || "").trim();
      const inviterEmail = req.user?.email || "";
      const by = inviter ? `${inviter}${inviterEmail ? ` (${inviterEmail})` : ""}` : "A colleague";
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to: email,
          cc: inviterEmail || undefined, // copy the inviter so they see what was sent
          replyTo: inviterEmail || undefined,
          subject: `${inviter || "You're"} invited you to Compass`,
          text:
            `Hi,\n\n` +
            `${by} has invited you to Compass at ${school?.name || "our school"}.\n\n` +
            `If you teach on rotary, you see dozens of students across many classes — and a single off day can look small in each room while really being a pattern. Compass fixes that: every teacher's logs pool into ONE shared picture per student, so you're never the only one noticing, and no one is fighting it alone.\n\n` +
            `What you can do:\n` +
            `• Log any student in seconds from any device or desktop — positives as well as concerns.\n` +
            `• See a student's full cross-teacher history before you say a word to them.\n` +
            `• When a pattern reaches the threshold, you get a ready-to-send, pastoral note home — you review and send it (nothing is ever auto-sent), with recommended next steps.\n` +
            `• Catch the good too: positives earn house points and can send a good-news note home.\n` +
            `• Award house points for house events (trivia, clean-ups, competitions) right from the dashboard.\n` +
            `• Track uniform infractions (GUDD) — they count as a strike and toward losing the Good Uniform Dress Down, with escalating consequences.\n` +
            `• Record the consequences you give (detention, call home, white slip) and get a ready-to-send white-slip note when a student is eligible.\n` +
            `• Dial an incident's intensity up or down (×0.5–×2) when it's more or less serious than usual — it scales house points and reporting.\n` +
            `• Track homework, class work and formal discussions, with end-of-term grades that export to Edsby.\n` +
            `• A Tour walks you through it, and a Feedback button is always there if you want something changed.\n\n` +
            `Set your password and get started:\n${link}\n\n` +
            `If you didn't expect this, you can ignore this email.\n\n— Compass`,
          html: emailShell({
            title: "You're invited to Compass",
            schoolName: school?.name || "Compass",
            preheader: `${by} invited you to Compass — one shared picture of every student.`,
            contentHtml:
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6"><strong>${escapeHtml(by)}</strong> has invited you to <strong>Compass</strong> at ${escapeHtml(school?.name || "our school")}.</p>` +
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6">If you teach on <strong>rotary</strong>, you see dozens of students across many classes — and one off day can look small in each room while really being a pattern. Compass pools every teacher's logs into <strong>one shared picture per student</strong>, so you're never the only one noticing, and no one is fighting it alone.</p>` +
              `<p style="margin:0 0 6px;color:#0f172a;font-weight:600">What you can do</p>` +
              `<ul style="margin:0 0 14px;padding-left:18px;color:#334155;line-height:1.6">` +
              `<li><strong>Log any student in seconds</strong> from any device or desktop — positives as well as concerns.</li>` +
              `<li>See a student's <strong>full cross-teacher history</strong> before you say a word.</li>` +
              `<li>When a pattern hits the threshold you get a <strong>ready-to-send, pastoral note home</strong> — you review and send it (<strong>nothing is auto-sent</strong>), with recommended next steps.</li>` +
              `<li><strong>Catch the good too:</strong> positives earn house points and can send a good-news note home.</li>` +
              `<li><strong>House events:</strong> award house points to a whole house (trivia, clean-ups, competitions) from the dashboard.</li>` +
              `<li><strong>Uniform infractions (GUDD):</strong> count as a strike <em>and</em> toward losing the Good Uniform Dress Down, with escalating consequences.</li>` +
              `<li><strong>Record consequences &amp; white slips:</strong> log what you gave (detention, call home, white slip), with a ready-to-send white-slip note when a student is eligible.</li>` +
              `<li><strong>Intensity dial:</strong> nudge an incident up or down (×0.5&ndash;×2) when it's more or less serious than usual — it scales house points and reporting.</li>` +
              `<li>Track <strong>homework, class work &amp; formal discussions</strong>, with end-of-term grades that export to Edsby.</li>` +
              `<li>A <strong>Tour</strong> walks you through it, and a <strong>Feedback</strong> button is always there if you want something changed.</li>` +
              `</ul>` +
              emailButton("Accept & set your password", link) +
              `<p style="color:#94a3b8;font-size:13px;word-break:break-all;margin:8px 0 0">Or paste this link: ${escapeHtml(link)}</p>` +
              `<p style="color:#94a3b8;font-size:13px;margin:12px 0 0">If you didn't expect this, you can ignore this email.</p>`,
          }),
        });
      } catch (mailErr) {
        console.warn("[behavior] invite email failed:", mailErr?.message || mailErr);
      }
      created.push({ email, role });
    }
    await audit(req.schoolId, "invite.sent", req, { meta: { created, rejected } });
    res.json({ ok: true, invited: created, rejected });
  } catch (err) {
    next(err);
  }
});

// "Tell a colleague" — an informational email about Compass to a teacher or
// admin at ANY school, so they can try it for their own division. This is NOT a
// join-invite (no token, no membership, no domain restriction); it just points
// them at the overview + setup pages. Admin-only to keep it from being abused.
router.post("/refer", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email])
      .map((e) => {
        const m = String(e || "").match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
        return m ? m[0].toLowerCase() : "";
      })
      .filter(Boolean);
    if (!emails.length) return res.status(400).json({ ok: false, error: "Enter a valid email address." });
    if (emails.length > 10) return res.status(400).json({ ok: false, error: "Up to 10 recipients at a time." });

    const note = String(req.body?.note || "").trim().slice(0, 600);
    const sender = (req.user?.name || "").trim();
    const senderEmail = req.user?.email || "";
    const by = sender ? `${sender}${senderEmail ? ` (${senderEmail})` : ""}` : "A colleague";
    const learnUrl = `${appBase()}/behavior/features`;
    const startUrl = `${appBase()}/behavior`;
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

    const blurb =
      "Compass is a school-wide, pastoral approach to student conduct. It tracks the positive AND the negative across every teacher (one shared picture per student), catches patterns early, and keeps clear, defensible records. When it's time to involve home, it PREPARES a tailored, respectful note that the teacher reviews, edits and sends — nothing is ever auto-sent, and it goes through Edsby so families recognise the sender. It also offers recommended consequences (an admin-defined ladder plus AI coaching from a school-approved list), an optional Houses system with merit-based rewards, a Homework tab (completion, formal discussions, term reports), and AI summaries for leadership.";
    const sent = [];
    const failed = [];
    for (const email of emails) {
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to: email,
          cc: senderEmail || undefined, // copy the sender so they see what went out
          replyTo: senderEmail || undefined,
          subject: `${sender || "A colleague"} thought you'd like Compass`,
          text:
            `Hi,\n\n` +
            `${by} thought Compass might be useful for you.\n\n` +
            `${blurb}\n\n` +
            (note ? `Their note: "${note}"\n\n` : "") +
            `See what it does: ${learnUrl}\n` +
            `Try it / set up your division: ${startUrl}\n\n` +
            `— Compass (curriculate.net)`,
          html: emailShell({
            title: "A colleague thought you'd like Compass",
            schoolName: "Compass",
            preheader: `${by} thought you'd like Compass.`,
            contentHtml:
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6"><strong>${escapeHtml(by)}</strong> thought Compass might be useful for you.</p>` +
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6">${escapeHtml(blurb)}</p>` +
              (note ? `<blockquote style="margin:0 0 14px;padding:8px 14px;border-left:3px solid #cbd5e1;color:#475569;font-style:italic">${escapeHtml(note)}</blockquote>` : "") +
              emailButton("See what it does", learnUrl) +
              `<p style="margin:14px 0 0;color:#475569;line-height:1.6">Ready to try it for your own division? <a href="${startUrl}" style="color:#0f172a">Set it up here</a>.</p>` +
              `<p style="color:#94a3b8;font-size:13px;margin:12px 0 0">You received this because a colleague shared it with you; no account has been created. You can ignore this email.</p>`,
          }),
        });
        sent.push(email);
      } catch (mailErr) {
        failed.push({ email, error: mailErr?.message || String(mailErr) });
      }
    }
    await audit(req.schoolId, "refer.sent", req, { meta: { sent, failed } });
    res.json({ ok: true, sent, failed });
  } catch (err) {
    next(err);
  }
});

// "Invite an admin" — a leadership-focused pitch a teacher can send to a
// principal/VP at any school to consider adopting Compass. CC's the sender.
router.post("/invite-admin", authAny, loadMembership, async (req, res, next) => {
  try {
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email])
      .map((e) => { const m = String(e || "").match(/[\w.+-]+@[\w.-]+\.\w{2,}/); return m ? m[0].toLowerCase() : ""; })
      .filter(Boolean);
    if (!emails.length) return res.status(400).json({ ok: false, error: "Enter a valid email address." });
    if (emails.length > 10) return res.status(400).json({ ok: false, error: "Up to 10 recipients at a time." });

    const note = String(req.body?.note || "").trim().slice(0, 600);
    const sender = (req.user?.name || "").trim();
    const senderEmail = req.user?.email || "";
    const by = sender ? `${sender}${senderEmail ? ` (${senderEmail})` : ""}` : "A teacher";
    const learnUrl = `${appBase()}/behavior/features`;
    const startUrl = `${appBase()}/behavior`;
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

    // Feature set grouped by category, with a few notes in each — so an admin
    // sees the full breadth at a glance.
    const sections = [
      ["Shared tracking &amp; early intervention", [
        "One shared count per student, pooled across every teacher — no more slipping through the cracks, and no teacher left fighting a pattern alone.",
        "Positives and negatives side by side; a fade window so old incidents stop counting over time (full history kept).",
        "Dashboard flags students at — or one step from — a threshold, for a quiet word before escalation.",
      ]],
      ["Offence types &amp; categories", [
        "Each offence is categorised (class preparedness, behaviour, uniform) so reporting and rules are consistent — teachers just log; admins set the categories.",
        "An intensity dial (×0.5–×2, note required) lets staff weight a one-off as more or less serious — scaling house points and how it reads in reports.",
        "Defensible records: every incident time-stamped, attributed, snapshotted and audit-logged.",
      ]],
      ["Communication home (pastoral, never automatic)", [
        "Nothing is auto-sent: at a threshold the app prepares a tailored, teacher-reviewed note; the teacher edits and sends.",
        "Reaches families over a channel they recognise (Edsby by default); direct parent email is off unless an admin enables it.",
        "Leadership looped in on your schedule (off / first notice / second-and-later).",
      ]],
      ["Consequences &amp; follow-through", [
        "An objective consequence ladder by notice number, plus AI coaching that only ever suggests from your approved list.",
        "Staff can document real consequences applied (work detention, white slip, call home, …); morning reminders so follow-ups aren't forgotten.",
        "White slips: a recommended-note button for eligible students (copies a parent note, CCs the VP), plus an 'immediate white slip' flag for serious behaviours that notifies the teacher and VP on the spot.",
      ]],
      ["Uniform &amp; the GUDD (Good Uniform Dress Down)", [
        "Uniform infractions count as a strike AND toward losing the GUDD, with an admin-set threshold, its own fade window, and escalating consequences.",
        "An always-visible indicator on the teacher and admin views shows who's lost it or is at risk.",
      ]],
      ["Houses &amp; school culture", [
        "Optional house system ties everyday conduct to shared team spirit, with a live leaderboard and merit-based rewards.",
        "Any teacher can award points to a whole house for events (trivia, clean-ups, competitions) — with preset point values; for booster events houses split into balanced #1/#2 room groups, and students look up their house, group and room by last name.",
        "Fair by design: per-student caps stop any one student dominating the standings, and house/room formation spreads grade, gender, behaviour-concern and sports-skilled students evenly.",
      ]],
      ["Homework, class work &amp; discussions", [
        "Track completion per class/subject, live-scored formal discussions, outstanding-work reminders, and end-of-term reports that export to Edsby.",
      ]],
      ["Leadership insights &amp; reporting", [
        "School-wide insights: trends, who to get ahead of, which teachers may welcome support, and app-usage; an optional weekly admin digest.",
        "Flags students who aren't responding to discipline (repeated notices home yet still offending) so you can step in early.",
        "Fair AI summaries per student / teacher / division — useful for supporting staff and for defensible documentation.",
      ]],
    ];
    const textPoints = sections.map(([h, items]) => `${String(h).replace(/&amp;/g, "&")}\n${items.map((b) => `  • ${b.replace(/&amp;/g, "&")}`).join("\n")}`).join("\n\n");
    const htmlPoints = sections.map(([h, items]) =>
      `<p style="margin:14px 0 4px;color:#0f172a;font-weight:600">${h}</p>` +
      `<ul style="margin:0 0 6px;padding-left:18px;color:#334155;line-height:1.6">${items.map((b) => `<li style="margin:3px 0">${b}</li>`).join("")}</ul>`
    ).join("");

    const sent = [];
    const failed = [];
    for (const email of emails) {
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to: email,
          cc: senderEmail || undefined,
          replyTo: senderEmail || undefined,
          subject: `${sender || "A teacher"} — a behaviour tool worth a look for our school`,
          text:
            `Hello,\n\n` +
            `${by} thought Compass might be worth considering for your school.\n\n` +
            `It's a school-wide, pastoral approach to student conduct that helps with:\n\n${textPoints}\n\n` +
            (note ? `Their note: "${note}"\n\n` : "") +
            `A short overview: ${learnUrl}\nSet it up for your division: ${startUrl}\n\n— Compass (curriculate.net)`,
          html: emailShell({
            title: "A behaviour tool worth a look",
            schoolName: "Compass",
            preheader: `${by} suggested Compass for your school.`,
            contentHtml:
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6"><strong>${escapeHtml(by)}</strong> thought <strong>Compass</strong> might be worth considering for your school — a school-wide, pastoral approach to student conduct.</p>` +
              (note ? `<blockquote style="margin:0 0 14px;padding:8px 14px;border-left:3px solid #cbd5e1;color:#475569;font-style:italic">${escapeHtml(note)}</blockquote>` : "") +
              `<p style="margin:0 0 6px;color:#0f172a;font-weight:600">Why it helps a school</p>` +
              `<ul style="margin:0 0 14px;padding-left:18px;color:#334155;line-height:1.6">${htmlPoints}</ul>` +
              emailButton("Read the overview", learnUrl) +
              `<p style="margin:14px 0 0;color:#475569">Or set it up for your division: <a href="${startUrl}" style="color:#0f172a">${escapeHtml(startUrl)}</a></p>`,
          }),
        });
        sent.push(email);
      } catch (mailErr) {
        failed.push({ email, error: mailErr?.message || String(mailErr) });
      }
    }
    await audit(req.schoolId, "invite_admin.sent", req, { meta: { sent, failed } });
    res.json({ ok: true, sent, failed });
  } catch (err) {
    next(err);
  }
});

// Feedback / feature requests from any member → emailed to the school's admins
// (originator + admins), CC the sender so they have a copy. Lightweight: no model.
router.post("/feedback", authAny, loadMembership, async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "Please write your feedback first." });
    const page = String(req.body?.page || "").trim().slice(0, 200);
    const sender = (req.membership?.name || req.user?.name || "").trim();
    const senderEmail = req.user?.email || "";

    const admins = await BehaviorTeacher.find({ schoolId: req.schoolId, role: { $in: ["originator", "admin"] }, status: { $ne: "pending" } }).select("email").lean();
    const to = [...new Set(admins.map((a) => a.email).filter(Boolean))];
    // Always reach the product owner even if no admin email is on file.
    if (!to.length) to.push(process.env.BEHAVIOR_FEEDBACK_EMAIL || "rgsommer@me.com");
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

    let sent = false, error = "";
    try {
      await sendEmail({
        from: fromAddr ? { name: "Compass feedback", address: fromAddr } : undefined,
        to,
        cc: senderEmail || undefined,
        replyTo: senderEmail || undefined,
        subject: `Compass feedback from ${sender || "a teacher"}`,
        text:
          `${sender || "A teacher"}${senderEmail ? ` (${senderEmail})` : ""} sent feedback / a request:\n\n${message}\n\n` +
          (page ? `From page: ${page}\n` : "") + `— Compass`,
        html: emailShell({
          title: "Feedback / feature request",
          schoolName: "Compass",
          preheader: `Feedback from ${sender || "a teacher"}`,
          contentHtml:
            `<p style="margin:0 0 8px;color:#334155"><strong>${escapeHtml(sender || "A teacher")}</strong>${senderEmail ? ` (${escapeHtml(senderEmail)})` : ""} sent feedback / a request:</p>` +
            `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #cbd5e1;color:#334155;white-space:pre-wrap">${escapeHtml(message)}</blockquote>` +
            (page ? `<p style="margin:0;color:#94a3b8;font-size:13px">From page: ${escapeHtml(page)}</p>` : ""),
        }),
      });
      sent = true;
    } catch (e) { error = e?.message || String(e); }
    await audit(req.schoolId, "feedback.sent", req, { meta: { sent, page } });
    res.json({ ok: sent, sent, error });
  } catch (err) {
    next(err);
  }
});

router.get("/invites", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const invites = await BehaviorInvite.find({ schoolId: req.schoolId }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, invites });
  } catch (err) {
    next(err);
  }
});

// Resend a pending invite — fresh token + a (reminder) branded email.
router.post("/invites/resend", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });
    const invite = await BehaviorInvite.findOne({ schoolId: req.schoolId, email, status: "pending" });
    if (!invite) return res.status(404).json({ ok: false, error: "No pending invite for that address" });
    invite.token = crypto.randomBytes(24).toString("hex");
    invite.lastSentAt = new Date();
    await invite.save();

    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const link = `${appBase()}/behavior/accept?token=${invite.token}`;
    const inviter = (req.user?.name || "").trim();
    const inviterEmail = req.user?.email || "";
    const by = inviter ? `${inviter}${inviterEmail ? ` (${inviterEmail})` : ""}` : "A colleague";
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    let emailed = false;
    let emailError = "";
    try {
      await sendEmail({
        from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
        to: email,
        replyTo: inviterEmail || undefined,
        subject: `Reminder: you're invited to Compass`,
        text: `Reminder — ${by} invited you to Compass.\n\nSet your password and get started:\n${link}\n`,
        html: emailShell({
          title: "Reminder: you're invited to Compass",
          schoolName: school?.name || "Compass",
          preheader: `${by} invited you to Compass.`,
          contentHtml:
            `<p style="margin:0 0 12px;color:#334155;line-height:1.6">Just a reminder — <strong>${escapeHtml(by)}</strong> invited you to Compass. Here's your link again.</p>` +
            emailButton("Accept & set your password", link) +
            `<p style="color:#94a3b8;font-size:13px;word-break:break-all;margin:8px 0 0">Or paste this link: ${escapeHtml(link)}</p>`,
        }),
      });
      emailed = true;
    } catch (e) {
      emailError = e?.message || String(e);
    }
    await audit(req.schoolId, "invite.resent", req, { meta: { email, emailed } });
    res.json({ ok: true, emailed, emailError, lastSentAt: invite.lastSentAt });
  } catch (err) {
    next(err);
  }
});

// Revoke a pending invite so it stops counting / showing.
router.post("/invites/revoke", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });
    const r = await BehaviorInvite.updateOne(
      { schoolId: req.schoolId, email, status: "pending" },
      { $set: { status: "revoked" } }
    );
    await audit(req.schoolId, "invite.revoked", req, { meta: { email } });
    res.json({ ok: r.modifiedCount > 0 });
  } catch (err) {
    next(err);
  }
});

// Team & usage overview (admins + principal): who's a member, who was invited
// but hasn't joined, and per-teacher activity. "Last active" is the most recent
// of a logged incident or an audited action (we don't track raw logins).
router.get("/team", authAny, loadMembership, async (req, res, next) => {
  try {
    if (!["originator", "admin", "principal"].includes(req.membership.role)) {
      return res.status(403).json({ ok: false, error: "Admins and principals only" });
    }
    const teachers = await BehaviorTeacher.find({ schoolId: req.schoolId })
      .select("name email role status createdAt userId housesCommittee homeroom courtesyName monthlySummary")
      .lean();

    const incAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId } },
      { $group: { _id: "$teacherId", n: { $sum: 1 }, last: { $max: "$timestamp" } } },
    ]);
    const incById = Object.fromEntries(incAgg.map((a) => [String(a._id), a]));

    const notAgg = await BehaviorNotice.aggregate([
      { $match: { schoolId: req.schoolId } },
      { $group: { _id: "$sentByTeacherId", n: { $sum: 1 } } },
    ]);
    const notById = Object.fromEntries(notAgg.map((a) => [String(a._id), a.n]));

    // Earlier/legacy offences often exist ONLY as a historical notice home (a
    // one-time import of past paper records), with no itemised incident row.
    // Count those standalone offences per teacher so the Incidents column
    // reflects the FULL history, not just what's been logged in the app — the
    // same reconciliation the AI summaries use.
    const legNotAgg = await BehaviorNotice.aggregate([
      {
        $match: {
          schoolId: req.schoolId,
          $or: [{ legacyImport: true }, { triggeringIncidentIds: { $exists: false } }, { triggeringIncidentIds: { $size: 0 } }],
        },
      },
      { $group: { _id: "$sentByTeacherId", n: { $sum: 1 } } },
    ]);
    const legOffByTeacher = Object.fromEntries(legNotAgg.map((a) => [String(a._id), a.n]));

    const auditAgg = await BehaviorAuditLog.aggregate([
      { $match: { schoolId: req.schoolId, actorUserId: { $ne: null } } },
      { $group: { _id: "$actorUserId", last: { $max: "$createdAt" } } },
    ]);
    const auditByUser = Object.fromEntries(auditAgg.map((a) => [String(a._id), a.last]));

    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rows = teachers
      .map((t) => {
        const inc = incById[String(t._id)];
        const lastIncident = inc?.last ? new Date(inc.last).getTime() : 0;
        const lastAudit = auditByUser[String(t.userId)] ? new Date(auditByUser[String(t.userId)]).getTime() : 0;
        const lastActive = Math.max(lastIncident, lastAudit);
        const legOff = legOffByTeacher[String(t._id)] || 0;
        return {
          _id: String(t._id),
          userId: String(t.userId || ""),
          name: t.name,
          email: t.email,
          role: t.role,
          status: t.status,
          homeroom: t.homeroom || "",
          courtesyName: t.courtesyName || "",
          monthlySummary: t.monthlySummary !== false,
          joinedAt: t.createdAt,
          // History-inclusive: itemised incidents + standalone legacy offences.
          incidents: (inc?.n || 0) + legOff,
          legacyOffences: legOff,
          notices: notById[String(t._id)] || 0,
          lastActiveAt: lastActive ? new Date(lastActive) : null,
        };
      })
      .sort((a, b) => new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime());

    // Pending invites — exclude anyone who has already joined (e.g. the
    // originator, or someone invited then created/accepted separately).
    const memberEmails = new Set(teachers.map((t) => (t.email || "").toLowerCase()));
    const pendingInvites = (await BehaviorInvite.find({ schoolId: req.schoolId, status: "pending" })
      .select("email role invitedByEmail createdAt lastSentAt homeroom")
      .sort({ createdAt: -1 })
      .lean()
    ).filter((p) => !memberEmails.has((p.email || "").toLowerCase()));

    const activeLast30 = rows.filter((r) => r.lastActiveAt && now - new Date(r.lastActiveAt).getTime() < 30 * DAY).length;
    const totalIncidents = incAgg.reduce((s, a) => s + a.n, 0) + legNotAgg.reduce((s, a) => s + a.n, 0);
    const totalNotices = notAgg.reduce((s, a) => s + a.n, 0);

    res.json({
      ok: true,
      teachers: rows,
      pending: pendingInvites.map((p) => ({ email: p.email, role: p.role, invitedBy: p.invitedByEmail, invitedAt: p.createdAt, lastSentAt: p.lastSentAt || p.createdAt, homeroom: p.homeroom || "" })),
      stats: { members: rows.length, pending: pendingInvites.length, activeLast30, totalIncidents, totalNotices },
      // Who's viewing — the UI shows the setup-access toggle only to the originator.
      viewerRole: req.membership.role,
      viewerUserId: String(req.userId || ""),
    });
  } catch (err) {
    next(err);
  }
});

// Grant/revoke a member's ability to edit Setup (toggles role admin↔teacher).
// Originator-only — mirrors the invite rule that only the originator mints admins.
router.put("/team/role", authAny, loadMembership, async (req, res, next) => {
  try {
    if (req.membership.role !== "originator") {
      return res.status(403).json({ ok: false, error: "Only the originator can change who edits Setup." });
    }
    const userId = String(req.body?.userId || "").trim();
    const canEditSetup = req.body?.canEditSetup === true;
    if (!userId) return res.status(400).json({ ok: false, error: "Missing userId." });

    const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
    if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
    if (target.role === "originator") {
      return res.status(400).json({ ok: false, error: "The originator always has Setup access." });
    }
    if (target.role === "principal") {
      return res.status(400).json({ ok: false, error: "Principal is a read-only role — change it via a new invite instead." });
    }
    const role = canEditSetup ? "admin" : "teacher";
    await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { role } });
    await audit(req.schoolId, "team.setup_access_changed", req, { meta: { target: target.email, role } });
    res.json({ ok: true, userId, role });
  } catch (err) {
    next(err);
  }
});

// Toggle a member's houses-committee status (admins/originator). Committee members
// can manage the Houses aspect without full Setup access.
router.put("/team/houses-committee", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const on = req.body?.on === true;
    if (!userId) return res.status(400).json({ ok: false, error: "Missing userId." });
    const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
    if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
    await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { housesCommittee: on } });
    await audit(req.schoolId, "team.houses_committee_changed", req, { meta: { target: target.email, on } });
    res.json({ ok: true, userId, housesCommittee: on });
  } catch (err) {
    next(err);
  }
});

// Set MY own display name in Compass (the name shown as "logged by …" etc.).
// Any member can set it — handy for a teacher invited by email with no name.
router.put("/my-name", authAny, loadMembership, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ ok: false, error: "Please enter a name." });
    const $set = { name };
    // Optionally set the parent-facing official name in the same call (first sign-in prompt).
    if (req.body?.courtesyName !== undefined) $set.courtesyName = String(req.body.courtesyName || "").trim().slice(0, 60);
    await BehaviorTeacher.updateOne({ _id: req.membership._id }, { $set });
    await audit(req.schoolId, "team.self_name_set", req, { meta: { name, courtesyName: $set.courtesyName } });
    res.json({ ok: true, name, courtesyName: $set.courtesyName });
  } catch (err) { next(err); }
});

// Admin: set a member's display name (e.g. for someone who never set their own).
router.put("/team/name", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!userId || !name) return res.status(400).json({ ok: false, error: "Missing userId or name." });
    const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
    if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
    await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { name } });
    await audit(req.schoolId, "team.name_changed", req, { meta: { target: target.email, name } });
    res.json({ ok: true, userId, name });
  } catch (err) { next(err); }
});

// Set a member's (or a pending invitee's) homeroom class group(s). Admin-only.
// Accepts { userId } for a joined member or { email } for a pending invite.
router.put("/team/homeroom", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const homeroom = String(req.body?.homeroom || "").trim().slice(0, 60);
    const userId = String(req.body?.userId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (userId) {
      const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
      if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
      await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { homeroom } });
      await audit(req.schoolId, "team.homeroom_changed", req, { meta: { target: target.email, homeroom } });
      return res.json({ ok: true, userId, homeroom });
    }
    if (email) {
      const r = await BehaviorInvite.updateOne({ schoolId: req.schoolId, email, status: "pending" }, { $set: { homeroom } });
      // Also set it on a member with that email, if one exists.
      await BehaviorTeacher.updateOne({ schoolId: req.schoolId, email }, { $set: { homeroom } });
      if (!r.matchedCount) { /* member-only update still fine */ }
      await audit(req.schoolId, "team.homeroom_changed", req, { meta: { target: email, homeroom } });
      return res.json({ ok: true, email, homeroom });
    }
    return res.status(400).json({ ok: false, error: "Missing userId or email." });
  } catch (err) { next(err); }
});

// Set a member's courtesy name (e.g. "Mr. Sommer") for parent-facing notices.
router.put("/team/courtesy", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const courtesyName = String(req.body?.courtesyName || "").trim().slice(0, 60);
    const userId = String(req.body?.userId || "").trim();
    if (!userId) return res.status(400).json({ ok: false, error: "Missing userId." });
    const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
    if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
    await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { courtesyName } });
    await audit(req.schoolId, "team.courtesy_changed", req, { meta: { target: target.email, courtesyName } });
    res.json({ ok: true, userId, courtesyName });
  } catch (err) { next(err); }
});

// Toggle a member's monthly "your month in Compass" encouragement email (admin).
router.put("/team/monthly-summary", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const on = !!req.body?.on;
    if (!userId) return res.status(400).json({ ok: false, error: "Missing userId." });
    const target = await BehaviorTeacher.findOne({ schoolId: req.schoolId, userId });
    if (!target) return res.status(404).json({ ok: false, error: "Member not found in this school." });
    await BehaviorTeacher.updateOne({ _id: target._id }, { $set: { monthlySummary: on } });
    await audit(req.schoolId, "team.monthly_summary_changed", req, { meta: { target: target.email, on } });
    res.json({ ok: true, userId, monthlySummary: on });
  } catch (err) { next(err); }
});

// Accept an invite: the signed-in user (who set a password via the existing
// signup flow) becomes a member. Their email must match the invite.
// Public: look up a pending invite by its token so the accept/sign-in flow can
// prefill the invited email + school and route straight to setting a password.
// The token IS the secret (it comes from the emailed invite link), so returning
// the invited email to whoever holds it is fine; nothing else is exposed.
router.get("/invite/info", async (req, res, next) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "token required" });
    const invite = await BehaviorInvite.findOne({ token, status: "pending" }).lean();
    if (!invite) return res.json({ ok: false, error: "Invite not found or already used" });
    let schoolName = "";
    try { const sc = await BehaviorSchool.findById(invite.schoolId).select("name").lean(); schoolName = sc?.name || ""; } catch { /* ignore */ }
    res.json({ ok: true, email: invite.email, role: invite.role, schoolName });
  } catch (err) { next(err); }
});

router.post("/invite/accept", authAny, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "token required" });
    const invite = await BehaviorInvite.findOne({ token, status: "pending" });
    if (!invite) return res.status(404).json({ ok: false, error: "Invite not found or already used" });

    const myEmail = String(req.user?.email || "").toLowerCase();
    if (myEmail !== invite.email) {
      return res.status(403).json({ ok: false, error: "Signed-in email does not match the invite" });
    }

    await BehaviorTeacher.findOneAndUpdate(
      { schoolId: invite.schoolId, userId: req.userId },
      {
        $set: {
          email: myEmail,
          name: req.user.name || "",
          role: invite.role,
          status: "accepted",
        },
      },
      { upsert: true, new: true }
    );
    invite.status = "accepted";
    await invite.save();
    await audit(invite.schoolId, "invite.accepted", req, { meta: { email: myEmail, role: invite.role } });
    res.json({ ok: true, schoolId: invite.schoolId });
  } catch (err) {
    next(err);
  }
});

router.post("/invite/:id/revoke", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    await BehaviorInvite.updateOne(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: "revoked" } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Roster import (§3) ───────────────────────────────────────────────────────

// Strip parent identity the school has no way to use, per enabled channels.
// Mutates each student's parents[] in place:
//   - edsbyParentId  → kept only if Edsby posting is on
//   - name           → kept only if SOME channel is on (Edsby or email)
//   - email          → kept only if email-to-parents is on
// A parent left with no usable field is removed. With every channel off, no
// parent identity is stored at all.
function sanitizeParentsByChannel(students, cfg) {
  const edsbyOn = !!cfg?.edsby?.enabled;
  const emailOn = !!cfg?.channels?.emailToParents;
  for (const s of students) {
    if (!s || !Array.isArray(s.parents)) continue;
    s.parents = s.parents
      .map((p) =>
        p
          ? {
              name: edsbyOn || emailOn ? p.name || "" : "",
              email: emailOn ? p.email || "" : "",
              edsbyParentId: edsbyOn ? p.edsbyParentId || "" : "",
            }
          : null
      )
      .filter((p) => p && (p.name || p.email || p.edsbyParentId));
  }
}

router.post("/roster/import", authAny, loadMembership, requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    // Accept either an uploaded file (CSV or XLSX) or raw CSV text in the body.
    let parsed;
    if (req.file) {
      parsed = await parseRosterFile(req.file.buffer, req.file.originalname || "");
    } else if (req.body?.csv) {
      parsed = parseRoster(String(req.body.csv));
    } else {
      return res.status(400).json({ ok: false, error: "No file or CSV provided" });
    }
    const { students, skipped, headerMap } = parsed;

    // Privacy: store parent identity only to the extent the system can actually
    // contact the parent. NID needs Edsby posting; name needs SOME delivery
    // channel (Edsby or email); email needs email-to-parents. With every channel
    // off there's no way to reach parents, so we store no parent data at all.
    // Re-importing with a channel off also strips data stored before, because
    // parents[] is overwritten on update below.
    const cfg = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("edsby.enabled channels.emailToParents").lean();
    sanitizeParentsByChannel(students, cfg);

    // Resolve any "House" column to a houseId, matching existing houses by name
    // (case-insensitive) and creating any that are new to this school.
    const existingHouses = await BehaviorHouse.find({ schoolId: req.schoolId }).select("name active").lean();
    const houseByName = new Map(existingHouses.map((h) => [h.name.trim().toLowerCase(), h]));
    let housesCreated = 0;
    async function resolveHouseId(name) {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return null;
      let h = houseByName.get(key);
      if (!h) {
        h = (await BehaviorHouse.create({ schoolId: req.schoolId, name: String(name).trim() })).toObject();
        houseByName.set(key, h);
        housesCreated += 1;
      } else if (h.active === false) {
        await BehaviorHouse.updateOne({ _id: h._id }, { $set: { active: true } });
      }
      return h._id;
    }

    let imported = 0;
    let updated = 0;
    const touchedIds = []; // every student present in this file (matched or created)
    for (const s of students) {
      // Resolve + strip the parsed house name into a real houseId. A BLANK House
      // column never clears an existing house/room — houseId is only set when the
      // CSV actually names a house (so re-importing an export that omits House
      // leaves assignments untouched).
      const { houseName, ...fields } = s;
      if (houseName) fields.houseId = await resolveHouseId(houseName);

      // Match on Student ID first, then FALL BACK to full name — so a roster that
      // has gained Student IDs still updates the existing (previously no-ID)
      // records instead of creating duplicates. A name match then adopts the ID.
      let existing = null;
      if (fields.externalId) existing = await BehaviorStudent.findOne({ schoolId: req.schoolId, externalId: fields.externalId });
      if (!existing && fields.lastName && fields.firstName) {
        existing = await BehaviorStudent.findOne({ schoolId: req.schoolId, lastName: fields.lastName, firstName: fields.firstName });
      }

      if (existing) {
        // Update in place (same _id), so all incident/notice history stays
        // attached, and re-activate in case a prior partial import deactivated them.
        Object.assign(existing, fields, { schoolId: req.schoolId, active: true });
        await existing.save();
        touchedIds.push(existing._id);
        updated += 1;
      } else {
        const created = await BehaviorStudent.create({ ...fields, schoolId: req.schoolId });
        touchedIds.push(created._id);
        imported += 1;
      }
    }

    // Students no longer in the roster (e.g. last year's graduating grade) are
    // deactivated — NOT deleted: their full history is retained and they still
    // open from the management view. This is fully reversible: re-importing the
    // complete roster matches them again and flips active back to true (above).
    // Guarded on touchedIds.length so an empty/garbage file never wipes the list.
    // Safety: never let a partial/mismatched file deactivate most of the roster
    // (the classic footgun). Only run the deactivation sweep when the file
    // matched at least half of the currently-active students.
    let deactivated = 0;
    let deactivateSkipped = false;
    if (touchedIds.length) {
      const currentActive = await BehaviorStudent.countDocuments({ schoolId: req.schoolId, active: true });
      const matchedActive = await BehaviorStudent.countDocuments({ schoolId: req.schoolId, active: true, _id: { $in: touchedIds } });
      if (currentActive === 0 || matchedActive >= currentActive * 0.5) {
        const r = await BehaviorStudent.updateMany(
          { schoolId: req.schoolId, active: true, _id: { $nin: touchedIds } },
          { $set: { active: false } }
        );
        deactivated = r.modifiedCount ?? r.nModified ?? 0;
      } else {
        deactivateSkipped = true; // too few matched — likely a partial file; leave everyone active
      }
    }

    await audit(req.schoolId, "roster.imported", req, {
      meta: { imported, updated, deactivated, skippedCount: skipped.length, housesCreated, headerMap },
    });
    res.json({ ok: true, imported, updated, deactivated, deactivateSkipped, skipped, housesCreated, headerMap });
  } catch (err) {
    next(err);
  }
});

// ── Students (§3, §6) ────────────────────────────────────────────────────────

// Search any student in the school (no teacher↔student permission layer).
router.get("/students", authAny, loadMembership, async (req, res, next) => {
  try {
    const q = String(req.query.query || "").trim();
    const cls = String(req.query.class || "").trim();
    const filter = { schoolId: req.schoolId };
    if (req.query.includeInactive !== "1") filter.active = true; // mgmt view can see deactivated
    if (cls) filter.classGroup = cls;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ lastName: rx }, { firstName: rx }, { preferredName: rx }];
    }
    // Sorted grade → class → name so the client can group by grade directly.
    // Returns the whole roster when there's no query (for the grouped picker).
    const students = await BehaviorStudent.find(filter)
      .select("lastName firstName preferredName classGroup grade gender active houseId houseGroup houseCaptain behaviourConcern sportsSkilled academic noticesHomeCount")
      .sort({ grade: 1, classGroup: 1, lastName: 1, firstName: 1 })
      .limit(q ? 50 : 2000)
      .lean();

    // Per-student active THRESHOLD count (for list colouring). Unspent incidents
    // within the fade window — spent ones already carry countedInNoticeId.
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const triggerCount = config?.triggerCount ?? 3;
    const cutoff = new Date(Date.now() - fadeDays * DAY_MS);
    const agg = await BehaviorIncident.aggregate([
      {
        $match: {
          schoolId: req.schoolId,
          studentId: { $in: students.map((s) => s._id) },
          countedInNoticeId: null,
          whiteSlip: { $ne: true }, // a white-slip incident isn't a strike
          "behaviorSnapshot.triggerMode": "THRESHOLD",
          timestamp: { $gt: cutoff },
        },
      },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const cnt = Object.fromEntries(agg.map((a) => [String(a._id), a.n]));

    // Per-student uniform-infraction count within the GUDD-specific fade window
    // (independent of the strike fade), for the GUDD chip on the student list.
    const gcfg = config?.gudd || {};
    const guddOn = gcfg.enabled !== false;
    let gcnt = {};
    if (guddOn) {
      const gReset = gcfg.resetAt ? new Date(gcfg.resetAt).getTime() : 0;
      const gCutoff = new Date(Math.max(Date.now() - (gcfg.fadeWindowDays ?? 30) * DAY_MS, gReset));
      const gagg = await BehaviorIncident.aggregate([
        { $match: { schoolId: req.schoolId, studentId: { $in: students.map((s) => s._id) }, "behaviorSnapshot.uniform": true, timestamp: { $gt: gCutoff } } },
        { $group: { _id: "$studentId", n: { $sum: 1 } } },
      ]);
      gcnt = Object.fromEntries(gagg.map((a) => [String(a._id), a.n]));
    }
    // Recommended-but-not-yet-issued white slips → an "issued? Yes" indicator any
    // teacher can confirm. Newest pending slip per student.
    const pendAgg = await BehaviorConsequence.aggregate([
      { $match: { schoolId: req.schoolId, studentId: { $in: students.map((s) => s._id) }, type: "White slip", status: "recommended" } },
      { $sort: { at: -1 } },
      { $group: { _id: "$studentId", id: { $first: "$_id" } } },
    ]);
    const pend = Object.fromEntries(pendAgg.map((a) => [String(a._id), String(a.id)]));

    // Consequences given but not yet marked done → a "Mark done" to-do surfaced
    // on the dashboard. Corrective, issued, not completed; parent-message records
    // aren't tasks, so exclude them.
    const openCons = await BehaviorConsequence.find({
      schoolId: req.schoolId,
      studentId: { $in: students.map((s) => s._id) },
      kind: "corrective",
      completed: false,
      status: { $in: ["issued", "other"] },
      type: { $not: /^Parent message/i },
    }).select("studentId type at").sort({ at: -1 }).lean();
    const consByStudent = {};
    for (const c of openCons) {
      const k = String(c.studentId);
      (consByStudent[k] ||= []).push({ id: String(c._id), type: c.type });
    }

    // Homeroom follow-ups logged THIS WEEK (since Monday) → drives the dashboard
    // HR button's red (not yet) / green (done) flag, resetting each week.
    const weekStart = new Date(mondayKey() + "T00:00:00Z");
    const hrAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, studentId: { $in: students.map((s) => s._id) }, "behaviorSnapshot.name": "Homeroom follow-up", timestamp: { $gte: weekStart } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const hrWeek = new Set(hrAgg.map((a) => String(a._id)));

    // Notices home THIS PERIOD per student (prior-year notices don't count).
    const noticesPeriod = await periodNoticesByStudent(req.schoolId, students.map((s) => s._id), config);
    // White slips THIS PERIOD per student (for the handbook escalation ladder).
    const wsLadderOn = !!config?.whiteSlipLadder?.enabled;
    const wsPeriod = wsLadderOn ? await periodWhiteSlipsByStudent(req.schoolId, students.map((s) => s._id), config) : {};

    const out = students.map((s) => {
      const periodNotices = noticesPeriod[String(s._id)] || 0;
      const periodWhiteSlips = wsPeriod[String(s._id)] || 0;
      return {
        ...s,
        noticesHomeCount: periodNotices,
        activeCount: cnt[String(s._id)] || 0,
        guddCount: gcnt[String(s._id)] || 0,
        pendingWhiteSlipId: pend[String(s._id)] || null,
        pendingConsequences: (consByStudent[String(s._id)] || []).slice(0, 6),
        hrFollowedUpThisWeek: hrWeek.has(String(s._id)),
        whiteSlipCount: periodWhiteSlips,
        // Handbook-consistent recommendation (null → client falls back to the ladder).
        recommendedConsequence: whiteSlipLadderRecommendation(config, { periodNotices, periodWhiteSlips }),
      };
    });
    res.json({
      ok: true, students: out, triggerCount,
      gudd: guddOn ? { enabled: true, name: gcfg.name || "GUDD", threshold: gcfg.threshold ?? 3 } : { enabled: false },
    });
  } catch (err) {
    next(err);
  }
});

// Full cross-teacher status + history for a student.
router.get("/students/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    const cutoff = Date.now() - fadeDays * DAY_MS;

    const incidents = await BehaviorIncident.find({ studentId: student._id })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    // Active count = THRESHOLD incidents within window, after reset, unspent.
    const activeCount = incidents.filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      return (
        mode === "THRESHOLD" &&
        !inc.whiteSlip && // its white slip was the consequence — not a strike
        !inc.countedInNoticeId &&
        new Date(inc.timestamp).getTime() > resetAt &&
        new Date(inc.timestamp).getTime() > cutoff
      );
    }).length;

    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: -1 }).lean();
    const consequences = await BehaviorConsequence.find({ studentId: student._id }).sort({ at: -1 }).lean();

    // Notices home THIS PERIOD (school year by default). Earlier notices stay in
    // the record + history but don't count toward the current period.
    const psMs = periodStartMs(config);
    const noticesThisPeriod = notices.filter((n) => n.reason !== "positive" && n.status === "sent" && new Date(n.sentAt || n.createdAt).getTime() >= psMs).length;

    const triggerCount = config?.triggerCount ?? 3;
    // White-slip eligibility: active BEHAVIOUR-category strikes have reached the
    // trigger (white slips apply to behaviour offences). Reasons = those offences.
    const activeBehaviour = incidents.filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      return mode === "THRESHOLD" && !inc.whiteSlip && !inc.countedInNoticeId &&
        new Date(inc.timestamp).getTime() > resetAt && new Date(inc.timestamp).getTime() > cutoff &&
        (inc.behaviorSnapshot?.categories || []).includes("behaviour");
    });
    // White slips come from logging a handbook offence (fires immediately) or, per
    // the handbook accumulation rule, after enough notices home in a term. When the
    // ladder is on, the manual "Recommend a white slip" button only appears once
    // that notices threshold is reached — NOT merely at the strike trigger (which
    // now recommends a detention). Falls back to the old strike basis when off.
    const wsL = config?.whiteSlipLadder || {};
    const whiteSlipEligible = (wsL.enabled && wsL.emailsPerTermToWhiteSlip)
      ? noticesThisPeriod >= wsL.emailsPerTermToWhiteSlip
      : activeBehaviour.length >= triggerCount;
    const whiteSlipReasons = activeBehaviour.slice(0, 6).map((i) => ({
      name: i.behaviorSnapshot?.name || "", detail: i.detailText || "", date: i.timestamp,
    }));

    // Suggests escalating support (VP meeting / behaviour plan) when SEVERAL
    // measures (notices home + documented consequences) have been applied yet the
    // student is still offending AFTER the most recent one. Threshold kept at 3+
    // so it doesn't fire after just an early notice + consequence.
    const interventions = noticesThisPeriod + consequences.length;
    const lastInterventionAt = Math.max(
      0,
      ...notices.map((n) => new Date(n.sentAt || n.createdAt).getTime()).filter((t) => t && !isNaN(t)),
      ...consequences.map((c) => new Date(c.at).getTime()).filter((t) => t && !isNaN(t)),
    );
    const offencesSince = incidents.filter((inc) => {
      const isPos = inc.behaviorSnapshot?.kind === "positive" || (inc.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = !isPos && inc.behaviorSnapshot?.triggerMode === "INTERACTION";
      return !isPos && !isInteraction && new Date(inc.timestamp).getTime() > lastInterventionAt;
    }).length;
    const notResponding = interventions >= 3 && offencesSince >= 1
      ? { flag: true, interventions, offencesSince }
      : { flag: false };

    // Enrich incidents with the logging teacher's name for display.
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const incidentsOut = await Promise.all(
      incidents.map(async (i) => ({
        ...i,
        teacherName: tName[String(i.teacherId)] || "",
        // Sign each evidence key into a short-lived URL for display (private S3).
        attachments: await Promise.all(
          (i.attachments || []).map(async (a) => ({ key: a.key, kind: a.kind, contentType: a.contentType, at: a.at, url: await signEvidenceKey(a.key) }))
        ),
      }))
    );

    res.json({
      ok: true,
      student,
      activeCount,
      triggerCount: config?.triggerCount ?? 3,
      noticesHomeCount: noticesThisPeriod,
      gudd: guddStatus(incidents, config),
      whiteSlipEligible,
      whiteSlipReasons,
      notResponding,
      incidents: incidentsOut,
      notices,
      consequences,
    });
  } catch (err) {
    next(err);
  }
});

// Add a single student (admin) — used by the Setup "Add test student" button
// and any one-off addition outside a bulk import.
// Add a single student mid-year — open to any teacher (not just admins). The
// bulk roster import stays admin-only (it can replace the whole roster).
router.post("/students", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.lastName && !b.firstName && !b.preferredName) {
      return res.status(400).json({ ok: false, error: "A name is required" });
    }
    // Store parent identity only to the extent the enabled channels can use it
    // (same rule as the roster import via sanitizeParentsByChannel).
    const cfgEdsby = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("edsby.enabled channels.emailToParents").lean();
    const wrap = {
      parents: (Array.isArray(b.parents) ? b.parents : [])
        .filter((p) => p && (p.email || p.name || p.edsbyParentId))
        .map((p) => ({
          name: String(p.name || "").trim(),
          email: String(p.email || "").trim().toLowerCase(),
          edsbyParentId: String(p.edsbyParentId || "").trim(),
        })),
    };
    sanitizeParentsByChannel([wrap], cfgEdsby);
    const parents = wrap.parents;
    const student = await BehaviorStudent.create({
      schoolId: req.schoolId,
      externalId: String(b.externalId || "").trim(),
      lastName: String(b.lastName || "").trim(),
      firstName: String(b.firstName || "").trim(),
      preferredName: String(b.preferredName || "").trim(),
      gender: String(b.gender || "").trim(),
      classGroup: String(b.classGroup || "").trim(),
      grade: String(b.grade || "").trim(),
      dob: b.dob ? new Date(b.dob) : null,
      parents,
    });
    await audit(req.schoolId, "student.created", req, {
      studentId: student._id,
      meta: { name: `${student.firstName} ${student.lastName}`.trim(), test: !!b.test },
    });
    res.json({ ok: true, student });
  } catch (err) {
    next(err);
  }
});

// Deactivate / reactivate a student (admin). Deactivating keeps the record +
// history but hides them from rosters/search — the safe default for a student
// who has left. Reversible.
router.patch("/students/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    if ("active" in b) $set.active = !!b.active;
    if ("houseId" in b) $set.houseId = b.houseId || null;
    if ("houseCaptain" in b) $set.houseCaptain = !!b.houseCaptain;
    if ("behaviourConcern" in b) $set.behaviourConcern = !!b.behaviourConcern;
    if ("sportsSkilled" in b) $set.sportsSkilled = !!b.sportsSkilled;
    if ("academic" in b) $set.academic = !!b.academic;
    if ("houseGroup" in b) $set.houseGroup = [1, 2].includes(Number(b.houseGroup)) ? Number(b.houseGroup) : 0;
    if ("photoUrl" in b) $set.photoUrl = String(b.photoUrl || "").trim();
    if (!Object.keys($set).length) return res.status(400).json({ ok: false, error: "Nothing to update" });
    const student = await BehaviorStudent.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set },
      { new: true }
    ).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    if ("active" in b) await audit(req.schoolId, $set.active ? "student.reactivated" : "student.deactivated", req, { studentId: student._id });
    res.json({ ok: true, active: student.active, houseId: student.houseId, houseCaptain: student.houseCaptain, behaviourConcern: student.behaviourConcern, sportsSkilled: student.sportsSkilled, academic: student.academic, houseGroup: student.houseGroup });
  } catch (err) {
    next(err);
  }
});

// Flag academically strong students from the latest Edsby overall-average
// snapshot (run a refresh in the Honour-roll / avgs panel first). Sets academic
// = true for students at/above the threshold; never auto-clears (manual unchecks
// stick). Edsby is admin-managed, so this is admin-only.
router.post("/students/flag-academics", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const threshold = Number(req.body?.threshold) > 0 ? Number(req.body.threshold) : 80;
    const snap = await HonourRollSnapshot.findOne({ schoolId: req.schoolId }).sort({ takenAt: -1 }).lean();
    if (!snap || !(snap.students || []).length) {
      return res.json({ ok: false, error: "No Edsby averages yet — refresh them in the Honour-roll (averages) panel first.", flagged: 0, matched: 0 });
    }
    const avgByNid = new Map();
    for (const s of snap.students) {
      const a = typeof s.edsbyAverage === "number" ? s.edsbyAverage : s.weightedAvg;
      if (typeof a === "number") avgByNid.set(String(s.edsbyNid), a);
    }
    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true, edsbyStudentId: { $nin: ["", null] } })
      .select("edsbyStudentId academic").lean();
    const updates = [];
    let matched = 0;
    for (const s of students) {
      const a = avgByNid.get(String(s.edsbyStudentId));
      if (a === undefined) continue;
      matched++;
      if (a >= threshold && !s.academic) updates.push({ updateOne: { filter: { _id: s._id }, update: { $set: { academic: true } } } });
    }
    if (updates.length) await BehaviorStudent.bulkWrite(updates);
    await audit(req.schoolId, "students.flag_academics", req, { meta: { threshold, flagged: updates.length, matched } });
    res.json({ ok: true, flagged: updates.length, matched, threshold, snapshotAt: snap.takenAt });
  } catch (err) {
    next(err);
  }
});

// PERMANENTLY delete a student (admin) + cascade their incidents and notices.
// Irreversible — prefer PATCH deactivate for a student who simply left.
router.delete("/students/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const inc = await BehaviorIncident.deleteMany({ studentId: student._id });
    const not = await BehaviorNotice.deleteMany({ studentId: student._id });
    await BehaviorStudent.deleteOne({ _id: student._id });
    await audit(req.schoolId, "student.deleted", req, {
      studentId: student._id,
      meta: {
        name: `${student.firstName} ${student.lastName}`.trim(),
        incidentsRemoved: inc.deletedCount,
        noticesRemoved: not.deletedCount,
      },
    });
    res.json({ ok: true, incidentsRemoved: inc.deletedCount, noticesRemoved: not.deletedCount });
  } catch (err) {
    next(err);
  }
});

// ── Compass (§5a) ─────────────────────────────────────────────────────────

// Standard behaviours + this teacher's own custom ones (custom is private).
router.get("/behaviors", authAny, loadMembership, async (req, res, next) => {
  try {
    const behaviors = await Behavior.find({
      schoolId: req.schoolId,
      active: true,
      $or: [{ scope: "standard" }, { scope: "custom", ownerTeacherId: req.membership._id }],
    })
      .sort({ scope: 1, sortOrder: 1, name: 1 })
      .lean();
    res.json({ ok: true, behaviors });
  } catch (err) {
    next(err);
  }
});

// Add a behaviour. Admin may add a standard (shared) one; any teacher may add a
// custom (private) one.
// Upsert the standard behaviour set (admin) — adds any that are missing by name
// (case-insensitive), leaves existing ones untouched.
router.post("/behaviors/seed-standard", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const existing = await Behavior.find({ schoolId: req.schoolId }).select("name").lean();
    const have = new Set(existing.map((b) => String(b.name || "").trim().toLowerCase()));
    let created = 0;
    for (const b of STANDARD_BEHAVIORS) {
      if (have.has(b.name.trim().toLowerCase())) continue;
      await Behavior.create({
        schoolId: req.schoolId,
        name: b.name,
        keyword: b.keyword || "",
        description: b.description || "",
        consequenceText: b.consequenceText || "",
        triggerMode: b.triggerMode || "THRESHOLD",
        followUpType: b.followUpType || "none",
        kind: "negative",
        points: recommendedHousePoints({ ...b, kind: "negative" }),
        scope: "standard",
        ownerTeacherId: null,
      });
      created += 1;
    }
    await audit(req.schoolId, "behaviors.seed_standard", req, { meta: { created } });
    res.json({ ok: true, created, total: STANDARD_BEHAVIORS.length, skipped: STANDARD_BEHAVIORS.length - created });
  } catch (err) {
    next(err);
  }
});

// Apply the standard house-point scheme (auto add/deduct on logging): fills in a
// recommended value for each behaviour still at 0, without clobbering any the
// admin has already customised. Positives add, negatives deduct by severity.
router.post("/behaviors/apply-house-points", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const overwrite = req.body?.overwrite === true;
    const behs = await Behavior.find({ schoolId: req.schoolId }).select("name keyword kind triggerMode points").lean();
    let updated = 0;
    for (const b of behs) {
      if (!overwrite && (b.points || 0) !== 0) continue; // keep custom values
      const pts = recommendedHousePoints(b);
      if ((b.points || 0) === pts) continue;
      await Behavior.updateOne({ _id: b._id }, { $set: { points: pts } });
      updated += 1;
    }
    await audit(req.schoolId, "behaviors.apply_house_points", req, { meta: { updated, overwrite } });
    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
});

router.post("/behaviors", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const isAdmin = ["originator", "admin"].includes(req.membership.role);
    const wantStandard = req.body?.scope === "standard" && isAdmin;
    const kind = req.body?.kind === "positive" ? "positive" : "negative";
    // A positive behaviour is a reward: it documents + awards points but never
    // counts as a strike or notifies, so its mode is always INTERACTION.
    const triggerMode = kind === "positive"
      ? "INTERACTION"
      : ["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(req.body?.triggerMode) ? req.body.triggerMode : "THRESHOLD";
    // Every offence must carry at least one category — it drives reporting + the
    // white-slip/GUDD rules. Positive behaviours never have categories.
    const categories = cleanCategories(withBehaviourIfWhiteSlip(req.body?.categories, req.body?.immediateWhiteSlip), kind);
    if (kind === "negative" && !categories.length) {
      return res.status(400).json({ ok: false, error: "Pick at least one category (Class preparedness, Behaviour and/or Uniform)." });
    }
    const doc = await Behavior.create({
      schoolId: req.schoolId,
      name: String(req.body?.name || "").trim(),
      description: String(req.body?.description || ""),
      keyword: String(req.body?.keyword || "").trim(),
      kind,
      triggerMode,
      consequenceText: kind === "positive" ? "" : String(req.body?.consequenceText || ""),
      consequenceTiming: req.body?.consequenceTiming === "after_first" ? "after_first" : "first",
      points: Number(req.body?.points) || 0,
      categories,
      uniform: kind === "negative" && Array.isArray(req.body?.categories) && req.body.categories.includes("uniform"),
      immediateWhiteSlip: kind === "negative" && !!req.body?.immediateWhiteSlip,
      followUpType: ["none", "next_school_day", "custom_deadline"].includes(req.body?.followUpType)
        ? req.body.followUpType
        : "none",
      scope: wantStandard ? "standard" : "custom",
      ownerTeacherId: wantStandard ? null : req.membership._id,
    });
    if (!doc.name) {
      await Behavior.deleteOne({ _id: doc._id });
      return res.status(400).json({ ok: false, error: "name required" });
    }
    await audit(req.schoolId, "behavior.created", req, { meta: { name: doc.name, scope: doc.scope } });
    res.json({ ok: true, behavior: doc });
  } catch (err) {
    next(err);
  }
});

// Can the caller manage this behaviour? Admin/originator for standard; the owner
// for a custom one. (Edits don't rewrite history — incidents snapshot at log time.)
function canManageBehavior(membership, beh) {
  if (beh.scope === "standard") return ["originator", "admin"].includes(membership.role);
  return String(beh.ownerTeacherId) === String(membership._id);
}

// Edit a behaviour (name, mode, consequence, follow-up, description).
router.put("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to edit this behaviour" });
    }
    const b = req.body || {};
    if ("name" in b) beh.name = String(b.name || "").trim();
    if ("description" in b) beh.description = String(b.description || "");
    if ("keyword" in b) beh.keyword = String(b.keyword || "").trim();
    if (b.kind === "positive" || b.kind === "negative") beh.kind = b.kind;
    if ("consequenceText" in b) beh.consequenceText = String(b.consequenceText || "");
    if (["first", "after_first"].includes(b.consequenceTiming)) beh.consequenceTiming = b.consequenceTiming;
    if (["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(b.triggerMode)) beh.triggerMode = b.triggerMode;
    if ("points" in b) beh.points = Number(b.points) || 0;
    if ("immediateWhiteSlip" in b) beh.immediateWhiteSlip = !!b.immediateWhiteSlip;
    if ("categories" in b || "immediateWhiteSlip" in b) {
      beh.categories = cleanCategories(withBehaviourIfWhiteSlip("categories" in b ? b.categories : beh.categories, beh.immediateWhiteSlip), beh.kind);
      beh.uniform = beh.categories.includes("uniform");
    }
    // Positive behaviours never count/notify → force INTERACTION + no consequence,
    // and carry no offence categories (incl. uniform/GUDD) or white-slip flag.
    if (beh.kind === "positive") { beh.triggerMode = "INTERACTION"; beh.consequenceText = ""; beh.uniform = false; beh.categories = []; beh.immediateWhiteSlip = false; }
    if (["none", "next_school_day", "custom_deadline"].includes(b.followUpType)) beh.followUpType = b.followUpType;
    if (typeof b.sortOrder === "number") beh.sortOrder = b.sortOrder;
    if (!beh.name) return res.status(400).json({ ok: false, error: "name required" });
    if (beh.kind === "negative" && !(beh.categories || []).length) {
      return res.status(400).json({ ok: false, error: "Pick at least one category (Class preparedness, Behaviour and/or Uniform)." });
    }
    await beh.save();
    await audit(req.schoolId, "behavior.updated", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true, behavior: beh });
  } catch (err) {
    next(err);
  }
});

// Remove a behaviour (soft delete — keeps history snapshots intact).
router.delete("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to remove this behaviour" });
    }
    beh.active = false;
    await beh.save();
    await audit(req.schoolId, "behavior.removed", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Incident logging + trigger (§6, §7) ──────────────────────────────────────

router.post("/incidents", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const studentId = req.body?.studentId;
    const behaviorIds = Array.isArray(req.body?.behaviorIds)
      ? req.body.behaviorIds
      : req.body?.behaviorId
      ? [req.body.behaviorId]
      : [];
    const detailText = String(req.body?.detailText || "");
    const weight = clampWeight(req.body?.weight);
    // Optional event time (teacher may set/adjust when the incident occurred).
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();
    if (!studentId || !behaviorIds.length) {
      return res.status(400).json({ ok: false, error: "studentId and behaviorIds required" });
    }
    if (weight !== 1 && !detailText.trim()) {
      return res.status(400).json({ ok: false, error: "Please add a note explaining the changed intensity (×" + weight + ")." });
    }

    const student = await BehaviorStudent.findOne({ _id: studentId, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    // Sequence numbering counts only THIS PERIOD's notices — prior-year notices
    // stay in history but don't escalate this year. (In-memory only; the stored
    // lifetime counter is untouched.)
    student.noticesHomeCount = await countPeriodNotices(req.schoolId, student._id, config);

    // Create one append-only incident per selected behaviour, snapshotting the
    // behaviour wording so later edits don't rewrite history (§5a).
    const createdIncidents = [];
    const consequenceNotes = []; // non-white-slip consequences to post to Edsby
    for (const bId of behaviorIds) {
      const behavior = await Behavior.findOne({ _id: bId, schoolId: req.schoolId }).lean();
      if (!behavior) continue;
      const inc = await BehaviorIncident.create({
        schoolId: req.schoolId,
        studentId: student._id,
        teacherId: req.membership._id,
        behaviorId: behavior._id,
        behaviorSnapshot: {
          name: behavior.name,
          description: behavior.description,
          triggerMode: behavior.triggerMode,
          kind: behavior.kind || "negative",
          consequenceText: behavior.consequenceText,
          points: behavior.points || 0,
          uniform: behavior.uniform || false,
          categories: behavior.categories || [],
        },
        detailText,
        weight,
        immediateFlag: behavior.triggerMode === "IMMEDIATE",
        whiteSlip: !!behavior.immediateWhiteSlip,
        timestamp,
      });
      createdIncidents.push(inc.toObject());

      // Immediate white slip: email the teacher (CC VP) + record the consequence.
      if (behavior.immediateWhiteSlip) {
        await fireWhiteSlip({ req, student, config, behaviorName: behavior.name, detailText, at: timestamp, relatedIncidentId: inc._id });
      } else if (shouldSendConsequenceNote(behavior)) {
        // "After first occasion": the first time is a warning only — the
        // consequence applies from the second occurrence of THIS behaviour onward.
        let applyConsequence = true;
        if (behavior.consequenceTiming === "after_first") {
          const priorSame = await BehaviorIncident.countDocuments({ schoolId: req.schoolId, studentId: student._id, behaviorId: behavior._id, _id: { $ne: inc._id } });
          applyConsequence = priorSame > 0;
        }
        if (applyConsequence) {
          // A non-white-slip consequence: record it now (shows on the record, can be
          // marked done) and queue a "post to Edsby" message so the family hears
          // about it now — not only if/when the threshold notice fires.
          await recordLoggedConsequence({ req, student, behavior, detailText, at: timestamp, incidentId: inc._id });
          consequenceNotes.push({ incidentId: inc._id, behavior, detailText, at: timestamp });
        }
      }

      // House points: this behaviour's value scaled by the intensity weight.
      // Positives add / negatives deduct, each gated by its own school switch.
      const pts = Math.round((behavior.points || 0) * weight);
      if (pts && student.houseId && applyIndividualPoints(config, pts)) {
        await HousePointEvent.create({
          schoolId: req.schoolId, houseId: student.houseId, studentId: student._id,
          points: pts, reason: weight !== 1 ? `${behavior.name} (×${weight})` : behavior.name, behaviorId: behavior._id,
          incidentId: inc._id, awardedByTeacherId: req.membership._id, at: timestamp,
        });
      }
    }
    if (!createdIncidents.length) {
      return res.status(400).json({ ok: false, error: "No valid behaviours" });
    }

    // Evaluate the trigger across ALL of the student's incidents (cross-teacher).
    const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
    let notice = null;
    if (req.body?.sendImmediately) {
      // Teacher chose "send now": fire a notice for these incidents PLUS any
      // accumulated queue, regardless of the behaviour's normal trigger mode.
      const createdIds = new Set(createdIncidents.map((i) => String(i._id)));
      const queued = activeThresholdIncidents(priorIncidents, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      }).filter((q) => !createdIds.has(String(q._id)));
      const sequenceNo = (student.noticesHomeCount || 0) + 1;
      notice = await fireNotice({
        req, student, config,
        decision: {
          shouldNotify: true,
          reason: "immediate",
          contributingIncidents: [...createdIncidents, ...queued],
          sequenceNo,
          ccVp: config?.vpNotify === "off" ? false : config?.vpNotify === "first" ? true : sequenceNo >= 2,
        },
        awaitDecision: true,
      });
    } else {
      // Don't stack a second notice while one is still awaiting send: its strikes
      // aren't consumed until it goes home, so a fresh evaluation would re-fire.
      const pending = await BehaviorNotice.exists({
        schoolId: req.schoolId, studentId: student._id,
        reason: { $ne: "positive" }, status: { $in: ["queued", "failed"] },
      });
      if (!pending) {
        for (const inc of createdIncidents) {
          const others = priorIncidents.filter((p) => String(p._id) !== String(inc._id));
          const decision = evaluateIncident({
            newIncident: inc,
            priorIncidents: others,
            config: { triggerCount: config?.triggerCount ?? 3, fadeWindowDays: config?.fadeWindowDays ?? 30, vpNotify: config?.vpNotify },
            student,
          });
          if (decision.shouldNotify) {
            notice = await fireNotice({ req, student, config, decision, awaitDecision: true });
            break; // one notice per submission; strikes are consumed on send
          }
        }
      }
    }

    // Event-driven homeroom check-in: the moment a student crosses to 2 active
    // strikes (climbing from fewer — including again after a notice/white-slip
    // reset), nudge the homeroom teacher for an encouraging talk. Not the notice
    // threshold itself (that's handled above). Fire-and-forget.
    try {
      const trig = config?.triggerCount ?? 3;
      const fw = config?.fadeWindowDays ?? 30;
      const createdSet = new Set(createdIncidents.map((i) => String(i._id)));
      const afterN = activeThresholdIncidents(priorIncidents, { fadeWindowDays: fw, thresholdResetAt: student.thresholdResetAt }).length;
      const beforeN = activeThresholdIncidents(priorIncidents.filter((i) => !createdSet.has(String(i._id))), { fadeWindowDays: fw, thresholdResetAt: student.thresholdResetAt }).length;
      if (beforeN < 2 && afterN >= 2 && afterN < trig) {
        sendHomeroomCheckinForStudent({ schoolId: req.schoolId, student, config }).catch(() => {});
      }
    } catch { /* never block logging on the check-in */ }

    // Independent POSITIVE trigger: when a positive was just logged, check whether
    // the student has accumulated enough positives for a good-news note home.
    let positiveNotice = null;
    if (createdIncidents.some((i) => (i.behaviorSnapshot?.points || 0) > 0)) {
      positiveNotice = await maybeFirePositiveNotice({ req, student, config });
    }

    // Post-to-Edsby consequence messages. Skip any incident whose consequence is
    // already carried by a notice firing now (it would list the same consequence),
    // so the family isn't told twice.
    const noticeCovered = notice ? new Set((notice.triggeringIncidentIds || []).map(String)) : new Set();
    for (const cn of consequenceNotes) {
      if (noticeCovered.has(String(cn.incidentId))) continue;
      // Fire-and-forget: the AI compose shouldn't delay the logging response.
      sendConsequenceMessage({ req, student, config, behavior: cn.behavior, detailText: cn.detailText, at: cn.at }).catch(() => {});
    }

    // Auto-recommend a white slip at the behaviour-strike threshold ONLY if the
    // school has opted in. Off by default: white slips are reserved for handbook
    // offences (immediateWhiteSlip behaviours), while the threshold still surfaces
    // a recommended consequence via the ladder / AI coach.
    if (config?.autoRecommendWhiteSlipAtThreshold) {
      await maybeAutoRecommendWhiteSlip({ req, student, config, incidents: priorIncidents });
    }

    // The incidents that make up the CURRENT trigger, for the teacher to review:
    // if a notice just fired, the incidents that fed it; otherwise the running
    // set still accumulating toward the threshold (cross-teacher). Enriched with
    // teacher name so the teacher sees who logged each one.
    let triggerRaw;
    if (notice) {
      // The incidents that fed this notice — by its triggering set, since strikes
      // aren't marked counted until the notice actually sends.
      triggerRaw = await BehaviorIncident.find({ _id: { $in: notice.triggeringIncidentIds || [] } })
        .sort({ timestamp: 1 })
        .lean();
    } else {
      const all = await BehaviorIncident.find({ studentId: student._id }).lean();
      triggerRaw = activeThresholdIncidents(all, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      });
    }
    const tIds = [...new Set(triggerRaw.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const triggerIncidents = triggerRaw.map((i) => ({
      date: i.timestamp,
      teacher: tName[String(i.teacherId)] || "",
      offense: i.behaviorSnapshot?.name || "",
      comment: i.detailText || "",
    }));

    res.json({
      ok: true,
      incidents: createdIncidents.map((i) => ({ _id: i._id, behaviorName: i.behaviorSnapshot.name })),
      notice: notice ? { _id: notice._id, status: notice.status, cancelUntil: notice.cancelUntil, ccVp: notice.ccVp, renderedText: notice.renderedText, reason: notice.reason, autoDispatch: notice.autoDispatch } : null,
      positiveNotice: positiveNotice ? { _id: positiveNotice._id, status: positiveNotice.status } : null,
      triggerIncidents,
      triggerCount: config?.triggerCount ?? 3,
    });
  } catch (err) {
    next(err);
  }
});

// Reverse/batch flow (§6): one behaviour applied to several students at once
// ("not ready for class — these 5"). Each student gets their own append-only
// incident, house-point deduction, and independent trigger evaluation; a notice
// that fires is queued for review on that student's page (no inline send dance).
router.post("/incidents/batch", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const behaviorId = req.body?.behaviorId;
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const detailText = String(req.body?.detailText || "");
    const weight = clampWeight(req.body?.weight);
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();
    if (!behaviorId || !studentIds.length) {
      return res.status(400).json({ ok: false, error: "behaviorId and studentIds required" });
    }
    if (weight !== 1 && !detailText.trim()) {
      return res.status(400).json({ ok: false, error: "Please add a note explaining the changed intensity (×" + weight + ")." });
    }

    const behavior = await Behavior.findOne({ _id: behaviorId, schoolId: req.schoolId }).lean();
    if (!behavior) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    const results = [];
    for (const sid of studentIds) {
      const student = await BehaviorStudent.findOne({ _id: sid, schoolId: req.schoolId });
      if (!student) continue;
      student.noticesHomeCount = await countPeriodNotices(req.schoolId, student._id, config); // this-period sequence only

      const inc = await BehaviorIncident.create({
        schoolId: req.schoolId,
        studentId: student._id,
        teacherId: req.membership._id,
        behaviorId: behavior._id,
        behaviorSnapshot: {
          name: behavior.name,
          description: behavior.description,
          triggerMode: behavior.triggerMode,
          kind: behavior.kind || "negative",
          consequenceText: behavior.consequenceText,
          points: behavior.points || 0,
          uniform: behavior.uniform || false,
          categories: behavior.categories || [],
        },
        detailText,
        weight,
        immediateFlag: behavior.triggerMode === "IMMEDIATE",
        whiteSlip: !!behavior.immediateWhiteSlip,
        timestamp,
      });

      const pts = Math.round((behavior.points || 0) * weight);
      if (pts && student.houseId && applyIndividualPoints(config, pts)) {
        await HousePointEvent.create({
          schoolId: req.schoolId, houseId: student.houseId, studentId: student._id,
          points: pts, reason: weight !== 1 ? `${behavior.name} (×${weight})` : behavior.name, behaviorId: behavior._id,
          incidentId: inc._id, awardedByTeacherId: req.membership._id, at: timestamp,
        });
      }

      const wantConsequenceNote = !behavior.immediateWhiteSlip && shouldSendConsequenceNote(behavior);
      if (behavior.immediateWhiteSlip) {
        await fireWhiteSlip({ req, student, config, behaviorName: behavior.name, detailText, at: timestamp, relatedIncidentId: inc._id });
      } else if (wantConsequenceNote) {
        await recordLoggedConsequence({ req, student, behavior, detailText, at: timestamp, incidentId: inc._id });
      }

      const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
      const others = priorIncidents.filter((p) => String(p._id) !== String(inc._id));
      const decision = evaluateIncident({
        newIncident: inc.toObject(),
        priorIncidents: others,
        config: { triggerCount: config?.triggerCount ?? 3, fadeWindowDays: config?.fadeWindowDays ?? 30, vpNotify: config?.vpNotify },
        student,
      });
      let notice = null;
      if (decision.shouldNotify) {
        // Skip if a notice for this student is already awaiting send (its strikes
        // aren't consumed until it goes home).
        const pending = await BehaviorNotice.exists({
          schoolId: req.schoolId, studentId: student._id,
          reason: { $ne: "positive" }, status: { $in: ["queued", "failed"] },
        });
        if (!pending) notice = await fireNotice({ req, student, config, decision, awaitDecision: true });
      }

      // Positive note home if this batch behaviour is a positive and the student
      // has now accumulated enough.
      let positiveNotice = null;
      if ((behavior.points || 0) > 0) {
        positiveNotice = await maybeFirePositiveNotice({ req, student, config });
      }

      // Post-to-Edsby consequence message, unless a notice firing now already
      // carries this consequence (avoids telling the family twice).
      if (wantConsequenceNote) {
        const covered = notice && (notice.triggeringIncidentIds || []).some((x) => String(x) === String(inc._id));
        if (!covered) sendConsequenceMessage({ req, student, config, behavior, detailText, at: timestamp }).catch(() => {}); // fire-and-forget (AI compose)
      }

      // Auto-recommend a white slip at the threshold ONLY if opted in (see above).
      if (config?.autoRecommendWhiteSlipAtThreshold) {
        await maybeAutoRecommendWhiteSlip({ req, student, config, incidents: priorIncidents });
      }

      results.push({
        studentId: String(student._id),
        name: `${student.preferredName || student.firstName} ${student.lastName}`.trim(),
        notice: notice ? { _id: notice._id, status: notice.status, ccVp: notice.ccVp } : null,
        positiveNotice: positiveNotice ? { _id: positiveNotice._id, status: positiveNotice.status } : null,
      });
    }

    await audit(req.schoolId, "incident.batch", req, { meta: { behavior: behavior.name, count: results.length } });
    res.json({ ok: true, logged: results.length, behaviorName: behavior.name, points: behavior.points || 0, results });
  } catch (err) {
    next(err);
  }
});

// Resolve the channels for a send: per-notice override, else the school default.
// Which channels deliver a notice to PARENTS/VP. Edsby is the default. Emailing
// a family is gated behind an explicit admin opt-in (channels.emailToParents),
// which is OFF unless an admin deliberately turns it on — so a misconfigured or
// legacy school never emails AI-written notes to parents by accident. A
// per-notice override may only NARROW to already-enabled channels; it can never
// add email when the division hasn't opted in (so a teacher can't enable it).
function resolveChannels(config, override) {
  const enabled = [];
  if (config?.channels?.edsby) enabled.push("edsby");
  if (config?.channels?.emailToParents) enabled.push("email");
  if (Array.isArray(override) && override.length) {
    const narrowed = override.filter((x) => enabled.includes(x));
    if (narrowed.length) return narrowed;
  }
  return enabled; // may be empty → notice won't deliver (safe); teacher still gets their copy
}

// Double the first integer in a consequence string ("10× lines" -> "20× lines").
// Returns { text, changed } — changed=false for non-countable consequences.
function doubleConsequence(text) {
  const s = String(text || "");
  const m = s.match(/\d+/);
  if (!m) return { text: s, changed: false };
  const doubled = String(Number(m[0]) * 2);
  return { text: s.slice(0, m.index) + doubled + s.slice(m.index + m[0].length), changed: true };
}

/**
 * Shared core: compose the AI (or template) note, persist a queued notice, and
 * schedule its dispatch after the cancellable window. Used by both the incident
 * trigger path and the missed-consequence escalation.
 */
async function composeAndCreateNotice({
  schoolId, student, config, reason, sequenceNo, ccVp, sentByTeacherId,
  channels, consequenceTexts, fromTeachers, contextIncidents, triggeringIncidentIds, kind = "discipline",
  awaitDecision = false,
}) {
  const isPositive = kind === "positive";
  const recipients = (student.parents || [])
    .filter((p) => p.email || p.edsbyParentId)
    .map((p) => ({ role: "parent", name: p.name, email: p.email, edsbyParentId: p.edsbyParentId }));
  if (ccVp && (config?.vp?.edsbyId || config?.vp?.email)) {
    // VP is CC'd over the same channel policy as parents (Edsby unless the admin
    // has explicitly opted into email) — never silently emailed.
    recipients.push({ role: "vp", name: config.vp.name, email: config.vp.email, edsbyParentId: config.vp.edsbyId || "" });
  }

  const firstTs = contextIncidents.length ? new Date(contextIncidents[0].timestamp).getTime() : Date.now();
  const daysSinceFirst = Math.max(0, Math.round((Date.now() - firstTs) / DAY_MS));

  // Threshold-notice policy: a pattern of notes (not a handbook offence) can be
  // routed to the student's HOMEROOM teacher to author & send (their voice), with
  // the VP copied the recommendation — and, when configured, no consequence is
  // stated (left to the VP's discretion). Positive notes are never re-routed.
  const tn = (config?.thresholdNotice) || {};
  let hrTeacher = null;
  let effectiveSenderId = sentByTeacherId;
  if (!isPositive && tn.sender === "homeroom" && student.classGroup) {
    hrTeacher = await BehaviorTeacher.findOne({ schoolId, homeroom: student.classGroup }).lean();
    if (hrTeacher) effectiveSenderId = hrTeacher._id;
  }
  const omitConsequence = !isPositive && !!tn.omitConsequence;
  const effectiveConsequenceTexts = omitConsequence ? [] : consequenceTexts;

  const sender = await BehaviorTeacher.findById(effectiveSenderId).lean();
  // Sign with the SENDING TEACHER's name so a parent always knows who it's from.
  // Only fall back to the division block when there's no teacher name at all —
  // never sign a note "Teachers at …" when we know the individual teacher.
  const senderName = (sender?.courtesyName || sender?.name || "").trim();
  const schoolName = config?.branding?.schoolName || "";
  const signature =
    (sender?.signature || "").trim() ||
    (senderName
      ? `Sincerely,\n${senderName}${schoolName ? `\nTeacher, ${schoolName}` : ", Teacher"}`
      : (config?.branding?.signatureBlock || `Sincerely,\n${schoolName}`).trim());

  // Replace the legacy "nnn" name placeholder with the student's name; the AI
  // otherwise handles naming/pronouns naturally from studentName + pronoun.
  const studentName = student.preferredName || student.firstName || "your child";

  // Greeting addresses the STUDENT and their parents (the note is read by both).
  // Includes the parents' names when we have them on file. Both AI + template
  // notes start with exactly this line.
  const parentNames = (student.parents || []).map((p) => (p.name || "").trim()).filter(Boolean);
  const greeting =
    parentNames.length >= 2 ? `Dear ${studentName}, and ${parentNames[0]} and ${parentNames[1]},`
    : parentNames.length === 1 ? `Dear ${studentName}, and ${parentNames[0]},`
    : `Dear ${studentName} and Parents,`;
  const personalize = (t) => String(t || "").replace(/\bnnn\b/gi, studentName);
  // Protect other students named in teachers' notes; flag second-hand reports.
  const famScrub = await familyNameScrubber(schoolId, student._id);
  const famDetail = (t) => prepareFamilyDetail(famScrub, personalize(t));

  // Background history + recent positives are only relevant to the disciplinary
  // note. A positive (good-news) note is built purely from its own incidents.
  let history = null;
  let positives = [];
  if (!isPositive) {
    const contribIds = new Set((triggeringIncidentIds || []).map(String));
    const allInc = await BehaviorIncident.find({ studentId: student._id })
      .select("behaviorSnapshot.name timestamp")
      .lean();
    const priorInc = allInc.filter((i) => !contribIds.has(String(i._id)));
    const behaviourTypes = [...new Set(priorInc.map((i) => i.behaviorSnapshot?.name).filter(Boolean))];
    const lastPriorTs = priorInc.length ? Math.max(...priorInc.map((i) => new Date(i.timestamp).getTime())) : null;
    history = {
      priorNotices: Math.max(0, sequenceNo - 1),
      priorIncidentCount: priorInc.length,
      behaviourTypes,
      lastBeforeDays: lastPriorTs ? Math.round((Date.now() - lastPriorTs) / DAY_MS) : null,
    };

    // Recent POSITIVE behaviours (points > 0) to acknowledge as a balancing,
    // encouraging note within the disciplinary note.
    const positiveWindowDays = Math.max(30, (config?.fadeWindowDays ?? 30) * 2);
    const positiveInc = await BehaviorIncident.find({
      studentId: student._id,
      "behaviorSnapshot.points": { $gt: 0 },
      timestamp: { $gt: new Date(Date.now() - positiveWindowDays * DAY_MS) },
    })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();
    positives = positiveInc.map((i) => ({
      behaviorName: i.behaviorSnapshot?.name || "",
      date: i.timestamp,
      detail: famDetail(i.detailText || "").detail,
    }));
  }

  const ctx = {
    studentName,
    greeting,
    pronoun: derivePronoun(student),
    history,
    positives,
    incidents: contextIncidents.map((i) => {
      const fd = famDetail(i.detailText || "");
      return {
        behaviorName: i.behaviorSnapshot?.name,
        teacherName: i.__teacherName || "",
        // Logged by the teacher who signs the note → written in the first person.
        isWriter: !!effectiveSenderId && String(i.teacherId) === String(effectiveSenderId),
        date: i.timestamp,
        detail: fd.detail,
        templateDetail: fd.mentionedOther ? "" : fd.detail,
        reported: fd.reported,
        uniform: !!i.behaviorSnapshot?.uniform,
      };
    }),
    writerName: senderName,
    consequences: effectiveConsequenceTexts.map(personalize),
    sequenceNo,
    daysSinceFirst,
    schoolName: config?.branding?.schoolName || "",
    signature,
    toneGuidance: [
      config?.branding?.toneGuidance || "",
      hrTeacher ? `Write in the first person AS ${studentName}'s homeroom teacher bringing together what ${studentName}'s teachers have observed; attribute each concern to the teacher who noted it, and do not imply you personally witnessed them all.` : "",
      omitConsequence ? "Do NOT state or recommend a specific consequence; this note simply makes the family aware of the pattern." : "",
    ].filter(Boolean).join(" "),
    ccVp,
  };
  const aiClient = makeDefaultAiClient(config || {});
  // `text` is clean plain prose (stored + dispatched to parents); `markdown`
  // keeps the composer's **bold** for the teacher's rich, pasteable copy only.
  const composed = isPositive
    ? await composePositiveNotice(ctx, { aiClient })
    : await composeNotice(ctx, { aiClient });
  // Last line of defence: no other student's name reaches this family.
  const text = famScrub(composed.text);
  const markdown = composed.markdown ? famScrub(composed.markdown) : composed.markdown;
  const aiUsed = composed.aiUsed;
  const richText = markdown || text;

  const cancelWindow = config?.cancelWindowSeconds ?? 60;
  // A teacher-triggered notice waits for an explicit Send decision — it NEVER
  // auto-sends to a parent. Only no-teacher-present paths (e.g. the missed-
  // consequence cron) auto-dispatch, and only when the school isn't in draft.
  const autoDispatch = !awaitDecision && config?.aiSendMode !== "draft";
  const notice = await BehaviorNotice.create({
    schoolId, studentId: student._id, periodNo: 1, sequenceNo, reason,
    fromTeachers, triggeringIncidentIds, consequenceTexts: effectiveConsequenceTexts, channels, recipients, ccVp,
    renderedText: text, aiUsed, status: "queued", sentByTeacherId: effectiveSenderId,
    cancelUntil: new Date(Date.now() + cancelWindow * 1000),
    autoDispatch,
  });
  // Send the SENDING TEACHER a copy of the queued note to their OWN email, before
  // it reaches any parent — so they see exactly what will go out and can cancel
  // or edit it on the dashboard first. Independent of the parent channel policy;
  // a failure here never blocks the notice.
  try {
    if (sender?.email && config?.teacherDraft !== false) {
      const recipNames = recipients.map((r) => r.name || r.role).filter(Boolean).join(", ") || "the parent(s)";
      const chanLabel = (channels || []).includes("edsby") ? "Edsby" : ((channels || []).length ? channels.join(", ") : "no channel configured yet");
      const willSend = (awaitDecision || config?.aiSendMode === "draft")
        ? "Nothing is sent automatically — it will go to the parent ONLY if you choose Send. Otherwise it stays as a pending decision and the strikes remain."
        : `Unless you cancel or edit it on the dashboard, it will be delivered to ${recipNames} via ${chanLabel} after the short review window.`;
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      await sendEmail({
        from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
        to: sender.email,
        subject: `📋 Your copy — ${isPositive ? "good-news note" : "notice"} for ${studentName} (review before it sends)`,
        text:
          `This is YOUR copy of a ${isPositive ? "good-news note" : "behaviour notice"} just queued for ${studentName}. ${willSend}\n\n` +
          `Recipients: ${recipNames}\nChannel: ${chanLabel}\n\n----- NOTE -----\n${text}`,
        html: emailShell({
          title: `Your copy — ${isPositive ? "good-news note" : "notice"} for ${escapeHtml(studentName)}`,
          schoolName: schoolName || "Compass",
          preheader: "Review it before it goes out.",
          accent: isPositive ? "#16a34a" : "#0f172a",
          footnote: "This copy goes only to you (the logging teacher). Parents are contacted over the school's chosen channel.",
          contentHtml:
            `<p style="margin:0 0 10px;color:#334155">This is <strong>your copy</strong> of a ${isPositive ? "good-news note" : "notice"} just queued for <strong>${escapeHtml(studentName)}</strong>. ${escapeHtml(willSend)}</p>` +
            `<p style="margin:0 0 12px;color:#64748b;font-size:13px"><strong>Recipients:</strong> ${escapeHtml(recipNames)} &middot; <strong>Channel:</strong> ${escapeHtml(chanLabel)}</p>` +
            `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">` +
            pasteableNote(noteToHtml(richText), { channel: chanLabel.includes("Edsby") ? "Edsby" : "your message" }),
        }),
      });
    }
  } catch (e) {
    console.warn("[behavior] teacher copy email failed:", e?.message || e);
  }

  // VP recommendation copy: at a threshold pattern (not a handbook offence), send
  // the VP the proposed parent note as a recommendation for awareness — the HR
  // teacher is asked to send it; whether any further consequence follows is the
  // VP's call. No white slip is implied. Best-effort; never blocks the notice.
  if (!isPositive && tn.notifyVp && (config?.vp?.email || "").trim()) {
    try {
      const hrLabel = (hrTeacher?.courtesyName || hrTeacher?.name || senderName || "the homeroom teacher").trim();
      const cls = student.classGroup ? ` (${student.classGroup})` : "";
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      await sendEmail({
        from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
        to: config.vp.email.trim(),
        subject: `For your awareness — recommended parent note for ${studentName}${cls}`,
        text:
          `A pattern of notes has reached the threshold for ${studentName}${cls}.\n\n` +
          `Below is a proposed note home, recommended for ${hrLabel} (homeroom) to review and send. ` +
          `No white slip has been issued — those are reserved for handbook offences. ` +
          `Whether any further consequence should follow is left to your discretion.\n\n----- PROPOSED NOTE -----\n${text}`,
        html: emailShell({
          title: `Recommended parent note — ${escapeHtml(studentName)}${escapeHtml(cls)}`,
          schoolName: schoolName || "Compass",
          preheader: `A proposed note for ${escapeHtml(hrLabel)} to send — for your awareness.`,
          footnote: "No white slip is implied (those are reserved for handbook offences). Any further consequence is at your discretion.",
          contentHtml:
            `<p style="margin:0 0 10px;color:#334155">A pattern of notes has reached the threshold for <strong>${escapeHtml(studentName)}${escapeHtml(cls)}</strong>.</p>` +
            `<p style="margin:0 0 12px;color:#334155">Below is a proposed note home, recommended for <strong>${escapeHtml(hrLabel)}</strong> (homeroom) to review and send. No white slip has been issued — those are reserved for handbook offences — and whether any further consequence should follow is left to your discretion.</p>` +
            `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">` +
            pasteableNote(noteToHtml(richText), { channel: "Edsby" }),
        }),
      });
    } catch (e) {
      console.warn("[behavior] VP recommendation email failed:", e?.message || e);
    }
  }

  if (autoDispatch) scheduleDispatch(notice._id, cancelWindow);
  return notice;
}

// Create open follow-up tasks for the behaviours in a notice that carry a
// follow-up type (brief §8b). Due = next school day at 9am.
async function createFollowups({ schoolId, student, config, contributingIncidents, sentByTeacherId, noticeId, multiplier = 1, missLevel = 0 }) {
  const byBehavior = new Map();
  for (const inc of contributingIncidents) if (inc.behaviorId) byBehavior.set(String(inc.behaviorId), inc);
  const due = nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] });
  const created = [];
  for (const [bid, inc] of byBehavior) {
    const beh = await Behavior.findById(bid).lean();
    if (!beh || beh.followUpType === "none") continue;
    created.push(
      await BehaviorFollowup.create({
        schoolId, studentId: student._id, behaviorId: bid, behaviorName: beh.name,
        consequenceText: inc.behaviorSnapshot?.consequenceText || beh.consequenceText,
        multiplier, missLevel,
        // Prompt the teacher who LOGGED the offence (not just the notice sender).
        assignedByTeacherId: inc.teacherId || sentByTeacherId,
        incidentId: inc._id || null, incidentAt: inc.timestamp || null,
        noticeId, dueDate: due, status: "open",
      })
    );
  }
  return created;
}

/**
 * Fire a notice home from a trigger decision. Composes + queues the note, marks
 * contributing incidents spent, resets the shared threshold counter (threshold
 * notices only), and opens follow-up tasks for any consequence with a follow-up.
 */
async function fireNotice({ req, student, config, decision, awaitDecision = false }) {
  const contributing = decision.contributingIncidents;
  const contribIds = contributing.map((i) => i._id);

  const teacherIds = [...new Set(contributing.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  const tdisplay = (t) => (t?.courtesyName || t?.name || "").trim();
  for (const i of contributing) i.__teacherName = tdisplay(teacherById[String(i.teacherId)]);
  const fromTeachers = contributing.map((i) => ({
    teacherId: i.teacherId,
    name: tdisplay(teacherById[String(i.teacherId)]),
    behaviorName: i.behaviorSnapshot?.name || "",
  }));
  // List the consequences, preferring the actually-logged consequence records
  // (so completion shows) and falling back to the snapshotted wording. A
  // consequence marked done is annotated "(already completed)" for the note.
  const consRecs = await BehaviorConsequence.find({ schoolId: req.schoolId, relatedIncidentId: { $in: contribIds } }).lean();
  const recByInc = new Map(consRecs.map((r) => [String(r.relatedIncidentId), r]));
  const consequenceTexts = [...new Set(contributing.map((i) => {
    const rec = recByInc.get(String(i._id));
    const base = String(rec?.type || i.behaviorSnapshot?.consequenceText || "").trim();
    if (!base) return "";
    return rec?.completed ? `${base} (already completed)` : base;
  }).filter(Boolean))];
  const channels = resolveChannels(config, req.body?.channelOverride);

  const notice = await composeAndCreateNotice({
    schoolId: req.schoolId, student, config, reason: decision.reason, sequenceNo: decision.sequenceNo,
    ccVp: decision.ccVp, sentByTeacherId: req.membership._id, channels, consequenceTexts, fromTeachers,
    contextIncidents: contributing, triggeringIncidentIds: contribIds, awaitDecision,
  });

  // NB: the student's strikes are NOT consumed here. They are consumed when the
  // notice actually goes home (see dispatchNotice), so a queued/edited/cancelled
  // notice never resets a student before a parent is told. A pending notice
  // blocks a second one from stacking (guarded at the trigger-evaluation sites).

  await createFollowups({
    schoolId: req.schoolId, student, config, contributingIncidents: contributing,
    sentByTeacherId: req.membership._id, noticeId: notice._id,
  });
  return notice;
}

/**
 * Fire a good-news note home when a student's accumulated positives cross the
 * positive threshold. Marks the celebrated positives so they don't re-fire; does
 * NOT touch the disciplinary counters, the VP, or follow-ups.
 */
async function firePositiveNotice({ req, student, config, contributingIncidents }) {
  const contribIds = contributingIncidents.map((i) => i._id);
  const teacherIds = [...new Set(contributingIncidents.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  for (const i of contributingIncidents) i.__teacherName = teacherById[String(i.teacherId)]?.name || "";
  const fromTeachers = contributingIncidents.map((i) => ({
    teacherId: i.teacherId,
    name: teacherById[String(i.teacherId)]?.name || "",
    behaviorName: i.behaviorSnapshot?.name || "",
  }));

  const notice = await composeAndCreateNotice({
    schoolId: req.schoolId, student, config, reason: "positive", sequenceNo: 1, ccVp: false,
    sentByTeacherId: req.membership._id, channels: resolveChannels(config, req.body?.channelOverride),
    consequenceTexts: [], fromTeachers, contextIncidents: contributingIncidents,
    triggeringIncidentIds: contribIds, kind: "positive",
  });

  // Mark these positives celebrated so the next positive note starts fresh.
  await BehaviorIncident.updateMany(
    { _id: { $in: contribIds }, countedInNoticeId: null },
    { $set: { countedInNoticeId: notice._id } }
  );
  return notice;
}

// Evaluate + fire a positive note home if the student has crossed the positive
// threshold. Returns the notice (or null). Safe to call after any submission
// that logged at least one positive incident.
async function maybeFirePositiveNotice({ req, student, config }) {
  const all = await BehaviorIncident.find({ studentId: student._id }).lean();
  const decision = evaluatePositive({ incidents: all, config, student });
  if (!decision.shouldNotify) return null;
  return firePositiveNotice({ req, student, config, contributingIncidents: decision.contributingIncidents });
}

// Send a queued notice now — bypasses the auto-send window (and is the manual
// send for draft mode). "Don't send" is the cancel route below.
router.post("/notices/:id/send", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (!["queued", "failed"].includes(notice.status)) {
      return res.status(409).json({ ok: false, error: `Notice is already ${notice.status}` });
    }
    // Optional: weave in a request to meet with the parents, just before the
    // signature (idempotent).
    if (req.body?.requestMeeting && !/arrange a (?:brief )?meeting/i.test(notice.renderedText || "")) {
      const line = "We would also like to arrange a brief meeting to discuss this. Please reply with a few times that would work for you, and we'll do our best to accommodate.";
      const parts = String(notice.renderedText || "").split(/\n\n+/);
      if (parts.length >= 2) parts.splice(parts.length - 1, 0, line);
      else parts.push(line);
      notice.renderedText = parts.join("\n\n");
      await notice.save();
    }
    // Teacher's per-send choice: include the incident's photo/video evidence, or
    // keep it teacher-side (default). Persist before dispatch reads it.
    if ("includeEvidence" in (req.body || {})) {
      notice.includeEvidence = !!req.body.includeEvidence;
      await notice.save();
    }
    // With no automatic parent channel, the teacher sends the note themselves and
    // this just RECORDS it as sent (consuming strikes, advancing the counter) —
    // rather than attempting a delivery that would only "fail".
    const cfg = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("edsby.enabled channels.emailToParents").lean();
    const autoSend = !!cfg?.edsby?.enabled || !!cfg?.channels?.emailToParents;
    let result;
    if (req.body?.recordOnly === true || !autoSend) {
      result = await recordNoticeAsSent(notice._id);
      await audit(req.schoolId, "notice.recorded_sent", req, { studentId: notice.studentId, noticeId: notice._id });
    } else {
      result = await dispatchNotice(notice._id, { force: true }); // explicit send — bypass the edit-defer window
      await audit(req.schoolId, "notice.sent_manual", req, { studentId: notice.studentId, noticeId: notice._id });
    }
    res.json({ ok: result.ok !== false, status: result.status || (result.ok ? "sent" : "failed"), recorded: !!result.recorded });
  } catch (err) {
    next(err);
  }
});

// Cancel a queued notice during its cancellable window (§8 send model).
router.post("/notices/:id/cancel", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (notice.status !== "queued") {
      return res.status(409).json({ ok: false, error: `Cannot cancel a ${notice.status} notice` });
    }
    notice.status = "cancelled";
    await notice.save();
    await audit(req.schoolId, "notice.cancelled", req, { studentId: notice.studentId, noticeId: notice._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Notices the current teacher queued that are awaiting their explicit send
// decision (never auto-send). Drives the dashboard "awaiting your decision" card
// so a triggered notice is never silently forgotten. Declared BEFORE
// "/notices/:id" so "pending" isn't matched as an id.
router.get("/notices/pending", authAny, loadMembership, async (req, res, next) => {
  try {
    const notices = await BehaviorNotice.find({
      schoolId: req.schoolId,
      status: "queued",
      autoDispatch: false,
      reason: { $ne: "positive" },
      sentByTeacherId: req.membership._id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const sIds = [...new Set(notices.map((n) => String(n.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: sIds } })
      .select("firstName lastName preferredName classGroup")
      .lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    // How many photo/video files sit on each notice's triggering incidents.
    const allIncIds = [...new Set(notices.flatMap((n) => (n.triggeringIncidentIds || []).map(String)))];
    const incs = allIncIds.length
      ? await BehaviorIncident.find({ _id: { $in: allIncIds } }).select("attachments").lean()
      : [];
    const attCountById = Object.fromEntries(incs.map((i) => [String(i._id), (i.attachments || []).length]));
    res.json({
      ok: true,
      notices: notices.map((n) => {
        const s = sById[String(n.studentId)];
        return {
          _id: String(n._id),
          studentId: String(n.studentId),
          studentName: s ? `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() : "student",
          classGroup: s?.classGroup || "",
          reason: n.reason,
          ccVp: n.ccVp,
          sequenceNo: n.sequenceNo,
          count: (n.triggeringIncidentIds || []).length,
          evidenceCount: (n.triggeringIncidentIds || []).reduce((sum, id) => sum + (attCountById[String(id)] || 0), 0),
          createdAt: n.createdAt,
          renderedText: n.renderedText,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Single notice (communication-history detail view).
router.get("/notices/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    res.json({ ok: true, notice });
  } catch (err) {
    next(err);
  }
});

// ── Consequence follow-ups + morning reminders (§8b) ─────────────────────────

// A teacher's open follow-ups (default: mine). ?due=today limits to due-by-today.
router.get("/followups", authAny, loadMembership, async (req, res, next) => {
  try {
    const filter = { schoolId: req.schoolId, status: "open" };
    if (req.query.mine !== "0") filter.assignedByTeacherId = req.membership._id;
    if (req.query.due === "today") {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filter.dueDate = { $lte: end };
    }
    const followups = await BehaviorFollowup.find(filter).sort({ dueDate: 1 }).limit(200).lean();
    const sIds = [...new Set(followups.map((f) => String(f.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: sIds } })
      .select("firstName lastName preferredName classGroup")
      .lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    res.json({ ok: true, followups: followups.map((f) => ({ ...f, student: sById[String(f.studentId)] || null })) });
  } catch (err) {
    next(err);
  }
});

// Mark a follow-up Done / Not done / Waived. "Not done" escalates (§8b).
router.post("/followups/:id/status", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!["done", "not_done", "waived"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status must be done | not_done | waived" });
    }
    const fu = await BehaviorFollowup.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!fu) return res.status(404).json({ ok: false, error: "Follow-up not found" });
    if (fu.status !== "open") return res.status(409).json({ ok: false, error: `Already ${fu.status}` });

    fu.status = status;
    fu.resolvedAt = new Date();
    fu.resolvedByTeacherId = req.membership._id;
    await fu.save();

    let escalation = null;
    if (status === "not_done") escalation = await escalateMissedConsequence(fu, req);
    await audit(req.schoolId, "followup.resolved", req, { studentId: fu.studentId, meta: { status, escalated: !!escalation } });
    res.json({ ok: true, escalation });
  } catch (err) {
    next(err);
  }
});

/**
 * Missed-consequence escalation (§8b): log a new incident, re-issue the
 * consequence doubled (once, capped at 2×), and send a new note home. A first
 * miss goes to parents; a second-or-later miss also CCs the VP. A fresh
 * follow-up is opened so the loop can be tracked.
 */
async function escalateMissedConsequence(fu, req) {
  const config = await BehaviorConfig.findOne({ schoolId: fu.schoolId }).lean();
  const student = await BehaviorStudent.findOne({ _id: fu.studentId });
  if (!student) return null;
  student.noticesHomeCount = await countPeriodNotices(fu.schoolId, student._id, config); // this-period sequence only
  const beh = fu.behaviorId ? await Behavior.findById(fu.behaviorId).lean() : null;
  const sender = await BehaviorTeacher.findById(fu.assignedByTeacherId).lean();

  const newMissLevel = (fu.missLevel || 0) + 1;
  const firstMiss = newMissLevel === 1;

  // (a) Log a new (system-generated) incident for the missed consequence.
  const snapshot = {
    name: fu.behaviorName || beh?.name || "Missed consequence",
    description: beh?.description || "",
    triggerMode: "THRESHOLD",
    consequenceText: fu.consequenceText,
  };
  const sysInc = await BehaviorIncident.create({
    schoolId: fu.schoolId, studentId: student._id, teacherId: fu.assignedByTeacherId,
    behaviorId: fu.behaviorId || undefined, behaviorSnapshot: snapshot,
    detailText: `Missed consequence: ${fu.behaviorName}`, immediateFlag: false, systemGenerated: true,
  });

  // (b) Re-issue the consequence: double once (cap 2×); don't double again.
  let consequenceText = fu.consequenceText;
  let multiplier = fu.multiplier || 1;
  if (firstMiss) {
    const dbl = doubleConsequence(fu.consequenceText);
    consequenceText = dbl.text;
    if (dbl.changed) multiplier = Math.min(2, multiplier * 2);
  }

  // First miss → parents; second-or-later → parent + VP.
  const ccVp = newMissLevel >= 2;
  const sequenceNo = (student.noticesHomeCount || 0) + 1;
  const incObj = sysInc.toObject();
  incObj.__teacherName = sender?.name || "";

  const notice = await composeAndCreateNotice({
    schoolId: fu.schoolId, student, config, reason: "missed_consequence", sequenceNo, ccVp,
    sentByTeacherId: fu.assignedByTeacherId, channels: resolveChannels(config, null),
    consequenceTexts: [consequenceText],
    fromTeachers: [{ teacherId: fu.assignedByTeacherId, name: sender?.name || "", behaviorName: fu.behaviorName }],
    contextIncidents: [incObj], triggeringIncidentIds: [sysInc._id],
  });

  await BehaviorIncident.updateOne({ _id: sysInc._id }, { $set: { countedInNoticeId: notice._id } });
  await BehaviorStudent.updateOne({ _id: student._id }, { $inc: { noticesHomeCount: 1 }, $set: { lastNoticeAt: new Date() } });

  // (c) Open a fresh follow-up so the re-issued consequence is tracked too.
  const newFu = await BehaviorFollowup.create({
    schoolId: fu.schoolId, studentId: student._id, behaviorId: fu.behaviorId, behaviorName: fu.behaviorName,
    consequenceText, multiplier, missLevel: newMissLevel, assignedByTeacherId: fu.assignedByTeacherId,
    noticeId: notice._id, dueDate: nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] }),
    status: "open",
  });

  return { noticeId: notice._id, followupId: newFu._id, missLevel: newMissLevel, multiplier, ccVp, consequenceText };
}

// Edit a queued notice's text before it sends (auto-send mode gives a window;
// editing extends that window so the edit isn't immediately swept out).
router.put("/notices/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (!["queued", "failed", "sent"].includes(notice.status)) {
      return res.status(409).json({ ok: false, error: `This notice can't be edited (it is ${notice.status})` });
    }
    const editingSent = notice.status === "sent";
    if (typeof req.body?.renderedText === "string") {
      // Preserve what the parent actually received, the first time a sent notice is edited.
      if (editingSent && !notice.sentTextSnapshot) notice.sentTextSnapshot = notice.renderedText;
      notice.renderedText = req.body.renderedText;
    }
    if (editingSent) {
      // Editing a delivered notice only updates the on-file record — it does NOT
      // re-send or re-open a cancel window.
      notice.editedAfterSendAt = new Date();
    } else {
      const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
      notice.cancelUntil = new Date(Date.now() + (config?.cancelWindowSeconds ?? 60) * 1000);
    }
    await notice.save();
    await audit(req.schoolId, editingSent ? "notice.edited_after_send" : "notice.edited", req, { noticeId: notice._id, studentId: notice.studentId });
    res.json({ ok: true, notice: { _id: notice._id, renderedText: notice.renderedText, status: notice.status, cancelUntil: notice.cancelUntil, editedAfterSendAt: notice.editedAfterSendAt } });
  } catch (err) {
    next(err);
  }
});

// Append a PRIVATE teacher note to an incident — internal documentation, never
// sent to parents, but included in the AI Admin Summary (§ teacher request).
router.post("/incidents/:id/notes", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "text required" });
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    inc.teacherNotes.push({ teacherId: req.membership._id, name: req.membership.name || "", text, at: new Date() });
    await inc.save();
    await audit(req.schoolId, "incident.note_added", req, { studentId: inc.studentId });
    res.json({ ok: true, teacherNotes: inc.teacherNotes });
  } catch (err) {
    next(err);
  }
});

// Can this teacher edit/delete this incident? The teacher who logged it, or an
// admin/originator.
function canEditIncident(membership, inc) {
  if (["originator", "admin"].includes(membership.role)) return true;
  return String(inc.teacherId) === String(membership._id);
}

// Edit an incident's detail text and/or its date/time (corrections).
router.put("/incidents/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    if (!canEditIncident(req.membership, inc)) return res.status(403).json({ ok: false, error: "Only the teacher who logged it (or an admin) can edit it." });
    if ("detailText" in (req.body || {})) inc.detailText = String(req.body.detailText || "");
    if (req.body?.occurredAt) {
      const d = new Date(req.body.occurredAt);
      if (!isNaN(d.getTime())) inc.timestamp = d;
    }
    await inc.save();
    await audit(req.schoolId, "incident.edited", req, { studentId: inc.studentId });
    res.json({ ok: true, incident: { _id: inc._id, detailText: inc.detailText, timestamp: inc.timestamp } });
  } catch (err) {
    next(err);
  }
});

// Delete an incident (a mis-log) and BACKPEDAL everything it set in motion, so
// the escalation steps back as if it never happened:
//  - house points it awarded/deducted (incl. a white-slip penalty)
//  - consequences tied to it that weren't carried out yet (incl. a recommended
//    white slip); ones already completed stay on record (they really happened)
//  - open follow-ups created from it
//  - notices it triggered: a queued one is cancelled; a sent one is VOIDED and
//    the other offences it had spent go back to being active strikes
// Strikes recompute automatically since they're derived from the incident rows.
//
// Two reasons to remove one (body/query `mode`):
//  - "error" (default): logged in error (wrong student / behaviour) — removed
//    completely, no trace beyond the audit log.
//  - "withdrawn": the teacher's judgment to reverse it. Same backpedal, but an
//    "Offence withdrawn" interaction is logged so the record shows what was
//    withdrawn, by whom, when and why (documentation only — never a strike).
router.delete("/incidents/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    if (!canEditIncident(req.membership, inc)) return res.status(403).json({ ok: false, error: "Only the teacher who logged it (or an admin) can delete it." });
    const mode = String(req.body?.mode || req.query.mode || "error") === "withdrawn" ? "withdrawn" : "error";
    const why = String(req.body?.reason || req.query.reason || "").trim().slice(0, 500);
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, incidentId: inc._id });
    const reversed = await backpedalIncident(req.schoolId, inc);
    if (mode === "withdrawn") {
      try { await logOffenceWithdrawn({ schoolId: req.schoolId, inc, teacherId: req.membership._id, byName: actorName(req), why, reversed }); }
      catch (e) { console.warn("[behavior] withdrawn log failed:", e?.message || e); }
    }
    // Remove any stored photo/video evidence so it doesn't outlive the incident.
    for (const a of inc.attachments || []) await deleteEvidenceKey(a.key);
    await BehaviorIncident.deleteOne({ _id: inc._id });
    await audit(req.schoolId, mode === "withdrawn" ? "incident.withdrawn" : "incident.deleted", req, { studentId: inc.studentId, meta: { behavior: inc.behaviorSnapshot?.name, reversed, mode, why } });
    res.json({ ok: true, mode, reversed });
  } catch (err) {
    next(err);
  }
});

// Undo what an incident triggered (see the DELETE route above). Returns a summary
// so the UI can tell the teacher what was reversed.
async function backpedalIncident(schoolId, inc) {
  const out = { consequences: 0, whiteSlip: false, keptCompleted: 0, followups: 0, noticesCancelled: 0, noticesVoided: 0, voidedSentNotice: false };
  const cons = await BehaviorConsequence.find({ schoolId, relatedIncidentId: inc._id });
  for (const c of cons) {
    if (c.completed) {
      out.keptCompleted += 1;
      if (!/offence later deleted/i.test(c.detail || "")) { c.detail = `${c.detail || ""} (offence later deleted)`.trim(); await c.save(); }
      continue;
    }
    if (c.type === "White slip") out.whiteSlip = true;
    await BehaviorConsequence.deleteOne({ _id: c._id });
    out.consequences += 1;
  }
  const fu = await BehaviorFollowup.deleteMany({ schoolId, incidentId: inc._id, status: "open" });
  out.followups = fu.deletedCount || 0;

  const notices = await BehaviorNotice.find({ schoolId, triggeringIncidentIds: inc._id, status: { $in: ["queued", "sent", "failed"] } });
  for (const n of notices) {
    const wasSent = n.status === "sent";
    n.status = "cancelled";
    if (wasSent) { n.voidedAt = new Date(); n.voidReason = "An offence that triggered it was deleted."; }
    await n.save();
    // Offences this notice had spent count as active strikes again.
    await BehaviorIncident.updateMany({ schoolId, countedInNoticeId: n._id, _id: { $ne: inc._id } }, { $set: { countedInNoticeId: null } });
    if (wasSent) { out.noticesVoided += 1; if (n.reason !== "positive") out.voidedSentNotice = true; }
    else out.noticesCancelled += 1;
  }
  if (notices.length) {
    const config = await BehaviorConfig.findOne({ schoolId }).lean();
    const last = await BehaviorNotice.findOne({ schoolId, studentId: inc.studentId, status: "sent", reason: { $ne: "positive" } }).sort({ sentAt: -1 }).select("sentAt").lean();
    await BehaviorStudent.updateOne({ _id: inc.studentId }, { $set: {
      noticesHomeCount: await countPeriodNotices(schoolId, inc.studentId, config),
      lastNoticeAt: last?.sentAt || null,
    } });
  }
  return out;
}

// "Offence withdrawn": the record of a teacher's judgment call to reverse an
// offence (the offence itself is removed and its effects undone). Documentation
// only — never a strike, nothing sent home.
async function logOffenceWithdrawn({ schoolId, inc, teacherId = null, byName = "", why = "", reversed = {} }) {
  let beh = await Behavior.findOne({ schoolId, name: "Offence withdrawn" });
  if (!beh) {
    beh = await Behavior.create({
      schoolId, name: "Offence withdrawn", keyword: "intervention", kind: "negative", triggerMode: "INTERACTION",
      description: "A teacher reversed a logged offence on reflection. Its strike, consequence and any notice were undone; this keeps a record of the decision. Documentation only — not a strike.",
      consequenceText: "", points: 0,
    });
  }
  const when = new Date(inc.timestamp).toLocaleDateString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric" });
  const undone = [];
  if (reversed.consequences) undone.push(reversed.whiteSlip ? "the white slip" : "its consequence");
  if (reversed.noticesVoided || reversed.noticesCancelled) undone.push("the notice it triggered");
  const note = `${byName || "A teacher"} withdrew “${inc.behaviorSnapshot?.name || "an offence"}” (logged ${when})` +
    (undone.length ? `; ${undone.join(" and ")} undone` : "") + "." + (why ? ` Reason: ${why}` : "");
  return BehaviorIncident.create({
    schoolId, studentId: inc.studentId, teacherId,
    behaviorId: beh._id,
    behaviorSnapshot: { name: beh.name, description: beh.description, triggerMode: "INTERACTION", kind: "negative", consequenceText: "", points: 0 },
    detailText: note, immediateFlag: false, timestamp: new Date(),
  });
}

// "Discussed with student": the teacher resolves a consequence with a
// conversation instead. Logged as an intervention (documentation only — never a
// strike, nothing sent home) and the consequence is marked resolved that way.
async function logDiscussedWithStudent({ schoolId, student, teacherId = null, byName = "", insteadOf = "" }) {
  let beh = await Behavior.findOne({ schoolId, name: "Discussed with student" });
  if (!beh) {
    beh = await Behavior.create({
      schoolId, name: "Discussed with student", keyword: "intervention", kind: "negative", triggerMode: "INTERACTION",
      description: "The teacher talked the situation through with the student. An intervention — documentation only; not a strike and nothing is sent home.",
      consequenceText: "", points: 0,
    });
  }
  const note = `${byName || "A teacher"} discussed the situation with the student${insteadOf ? ` (in place of: ${insteadOf})` : ""}.`;
  return BehaviorIncident.create({
    schoolId, studentId: student._id, teacherId,
    behaviorId: beh._id,
    behaviorSnapshot: { name: beh.name, description: beh.description, triggerMode: "INTERACTION", kind: "negative", consequenceText: "", points: 0 },
    detailText: note, immediateFlag: false, timestamp: new Date(),
  });
}

// Attach photo/video evidence to an incident (camera capture at log time).
// Stored privately in S3; only the logging teacher or an admin may attach.
router.post("/incidents/:id/attachments", authAny, loadMembership, canLog, uploadMedia.array("files", 5), async (req, res, next) => {
  try {
    if (!evidenceStorageAvailable()) return res.status(503).json({ ok: false, error: "Evidence storage isn't configured on the server." });
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    if (!canEditIncident(req.membership, inc)) return res.status(403).json({ ok: false, error: "Only the teacher who logged it (or an admin) can add evidence." });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No files uploaded." });

    const added = [];
    for (const f of files) {
      if (!isAllowedType(f.mimetype)) continue; // skip non image/video
      const meta = await uploadEvidence({ buffer: f.buffer, contentType: f.mimetype, schoolId: req.schoolId });
      added.push({ ...meta, uploadedByTeacherId: req.membership._id, at: new Date() });
    }
    if (!added.length) return res.status(400).json({ ok: false, error: "Only images or videos can be attached." });

    inc.attachments.push(...added);
    await inc.save();
    await audit(req.schoolId, "incident.evidence_added", req, { studentId: inc.studentId, meta: { count: added.length } });

    // Return freshly signed URLs so the client can show what it just uploaded.
    const out = await Promise.all(
      inc.attachments.map(async (a) => ({ key: a.key, kind: a.kind, contentType: a.contentType, at: a.at, url: await signEvidenceKey(a.key) }))
    );
    res.json({ ok: true, attachments: out });
  } catch (err) {
    // multer file-size errors surface as err.code === "LIMIT_FILE_SIZE"
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ ok: false, error: "A file is too large (max 30 MB each). Try a shorter video." });
    next(err);
  }
});

// AI "Admin Summary" for a student — scope "all" (full history) or "current"
// (just the active trigger incidents). Includes private teacher notes. Returns
// text for the client to copy to the clipboard. Fails safe to a plain digest.
// Email a behaviour summary to the requester (+ optional extra recipients, e.g.
// the VP). Confidential — branded shell, markdown-rendered, never to parents.
async function sendAdminSummaryEmail(req, name, schoolName, text, toRaw, studentId) {
  const extra = String(toRaw || "")
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(e));
  const to = [...new Set([req.user?.email, ...extra].filter(Boolean))];
  if (!to.length) return { emailed: false, emailError: "no recipient" };

  // Build the red/green timeline across the WHOLE record (incidents by kind +
  // legacy/notices-only offences as negative).
  const byMonth = {};
  const bump = (d, kind) => {
    const k = new Date(d).toISOString().slice(0, 7);
    byMonth[k] = byMonth[k] || { neg: 0, pos: 0 };
    byMonth[k][kind] += 1;
  };
  const incs = await BehaviorIncident.find({ studentId }).select("timestamp behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode").lean();
  for (const i of incs) {
    const pos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
    // Documented interactions (e.g. a logged parent meeting) are neutral — keep
    // them off the red/green chart so they don't read as offences.
    if (!pos && i.behaviorSnapshot?.triggerMode === "INTERACTION") continue;
    bump(i.timestamp, pos ? "pos" : "neg");
  }
  const nots = await BehaviorNotice.find({ studentId }).select("sentAt createdAt legacyImport triggeringIncidentIds").lean();
  for (const n of nots) {
    const backed = Array.isArray(n.triggeringIncidentIds) && n.triggeringIncidentIds.length > 0;
    if (n.legacyImport || !backed) bump(n.sentAt || n.createdAt, "neg");
  }
  // Positive tracking is new — caption the graph so a lone green bar isn't read
  // as a lack of positive recognition.
  const firstPositive = await BehaviorIncident.findOne({
    schoolId: req.schoolId,
    $or: [{ "behaviorSnapshot.kind": "positive" }, { "behaviorSnapshot.points": { $gt: 0 } }],
  }).sort({ timestamp: 1 }).select("timestamp").lean();
  const positivesNew = !firstPositive || Date.now() - new Date(firstPositive.timestamp).getTime() < 90 * DAY_MS;
  const chartCaption = positivesNew
    ? `<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">Positive recognition was recently introduced, so green is still ramping up.</p>`
    : "";

  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await sendEmail({
      from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
      to,
      subject: `Behaviour summary — ${name}`,
      text,
      html: emailShell({
        title: `Behaviour summary — ${name}`,
        schoolName: schoolName || "Compass",
        preheader: `Confidential behaviour summary for ${name}.`,
        footnote: "Confidential — includes private teacher notes. For VP/principal; not sent to parents.",
        contentHtml:
          mdToHtml(text) +
          `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">` +
          `<h3 style="margin:0 0 6px;font-size:15px;color:#0f172a">Timeline (red = negative, green = positive)</h3>` +
          monthlyKindChartHtml(byMonth) +
          chartCaption,
      }),
    });
    return { emailed: true, emailError: "", recipients: to };
  } catch (e) {
    return { emailed: false, emailError: e?.message || String(e) };
  }
}

router.post("/students/:id/admin-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    const scope = req.body?.scope === "current" ? "current" : "all";
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    // Email an already-generated summary without re-running the AI.
    if (req.body?.email && req.body?.summaryText) {
      const nm = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
      const r = await sendAdminSummaryEmail(req, nm, config?.branding?.schoolName || "", String(req.body.summaryText), req.body.to, student._id);
      return res.json({ ok: true, summary: String(req.body.summaryText), emailed: r.emailed, emailError: r.emailError });
    }

    let incidents = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: 1 }).lean();
    if (scope === "current") {
      const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
      const cutoff = Date.now() - (config?.fadeWindowDays ?? 30) * DAY_MS;
      incidents = incidents.filter((i) => {
        const mode = i.behaviorSnapshot?.triggerMode || (i.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
        return mode === "THRESHOLD" && !i.countedInNoticeId &&
          new Date(i.timestamp).getTime() > resetAt && new Date(i.timestamp).getTime() > cutoff;
      });
    }
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const lines = incidents.map((i) => {
      const d = new Date(i.timestamp).toLocaleString("en-CA", { timeZone: SCHOOL_TZ });
      const notes = (i.teacherNotes || []).map((n) => `    • teacher note (${n.name || "teacher"}): ${n.text}`).join("\n");
      const w = i.weight && i.weight !== 1 ? ` [intensity ×${i.weight}]` : "";
      return `- ${d} — ${i.behaviorSnapshot?.name || ""}${i.detailText ? `: ${i.detailText}` : ""}${w} [logged by ${tName[String(i.teacherId)] || "teacher"}]${notes ? `\n${notes}` : ""}`;
    });
    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: 1 }).lean();
    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const schoolDomain = (school?.emailDomain || "").toLowerCase();
    const vpEmail = (config?.vp?.email || "").toLowerCase();
    const EMAIL_RX = /[\w.+-]+@[\w.-]+\.\w{2,}/g;
    // Who a notice went to, by ROLE — note-worthy that the parent and (where
    // applicable) the VP were contacted, WITHOUT printing raw email addresses.
    // Pulls from the structured recipients/ccVp first, then from any leaked
    // To-line in legacy renderedText (addresses before the salutation).
    const describeRecipients = (n) => {
      const emails = new Set();
      (n.recipients || []).forEach((r) => { if (r.email) emails.add(String(r.email).toLowerCase()); });
      const head = String(n.renderedText || "").split(/\bdear\b/i)[0];
      (head.match(EMAIL_RX) || []).forEach((e) => emails.add(e.toLowerCase()));
      let parent = false, vp = false, staff = false;
      for (const e of emails) {
        if (vpEmail && e === vpEmail) vp = true;
        else if (schoolDomain && e.endsWith("@" + schoolDomain)) staff = true;
        else parent = true;
      }
      if (n.ccVp || (n.recipients || []).some((r) => r.role === "vp")) vp = true;
      const bits = [];
      if (parent) bits.push("parent/guardian");
      if (vp) bits.push("VP");
      if (staff) bits.push("school staff");
      return bits;
    };
    // Strip a leaked recipient/To prefix (emails / "undefined" / commas before
    // the salutation) so the body reads as the actual message.
    const cleanNoticeBody = (raw) =>
      String(raw || "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(?:\s*(?:[\w.+-]+@[\w.-]+\.\w{2,}|undefined|,)\s*)+/i, "")
        .trim();
    // For "all", include the FULL note content — earlier/legacy offences often
    // exist only as notices home, so the note text is the record of what
    // happened. For "current", a brief line is enough.
    const noticeLines = notices.map((n) => {
      const date = new Date(n.sentAt || n.createdAt).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ });
      const to = describeRecipients(n);
      const toLabel = to.length ? ` → emailed ${to.join(" + ")}` : "";
      if (scope !== "all") return `- ${date}: notice #${n.sequenceNo} (${n.reason}, ${n.status})${toLabel}`;
      const body = cleanNoticeBody(n.renderedText).slice(0, 600);
      return `- ${date} (notice #${n.sequenceNo}, ${n.status})${toLabel}: ${body || `(${n.reason})`}`;
    });

    const name = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
    const studentFirst = student.preferredName || student.firstName || name;
    // Span across BOTH incidents and notices (legacy offences live in notices).
    const allTs = [
      ...incidents.map((i) => new Date(i.timestamp).getTime()),
      ...notices.map((n) => new Date(n.sentAt || n.createdAt).getTime()),
    ].filter((t) => t && !isNaN(t)).sort((a, b) => a - b);
    const span = allTs.length
      ? `${new Date(allTs[0]).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })} to ${new Date(allTs[allTs.length - 1]).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })}`
      : "—";

    // How staff have MANAGED this student — the diligence record. This summary
    // may be used to show a parent/administrator that the behaviour was handled
    // conscientiously, so surface every form of staff response, not just the
    // offences. Computed over the FULL student record regardless of scope, since
    // it describes the overall handling.
    const allIncs = scope === "all"
      ? incidents
      : await BehaviorIncident.find({ studentId: student._id }).select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode behaviorSnapshot.uniform teacherNotes timestamp").lean();
    let offenceCount = 0, positiveCount = 0, interactionCount = 0, teacherNoteCount = 0, uniformCount = 0;
    for (const i of allIncs) {
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = !isPositive && (i.behaviorSnapshot?.triggerMode === "INTERACTION");
      if (isPositive) positiveCount += 1;
      else if (isInteraction) interactionCount += 1;
      else offenceCount += 1;
      if (i.behaviorSnapshot?.uniform) uniformCount += 1;
      teacherNoteCount += i.teacherNotes?.length || 0;
    }
    const noticesSent = notices.filter((n) => n.status === "sent").length;
    // Documented consequences actually applied (work detention, white slip, …).
    const consequencesLogged = await BehaviorConsequence.find({ studentId: student._id }).sort({ at: 1 }).lean();
    const conseqByType = {};
    for (const c of consequencesLogged) conseqByType[c.type] = (conseqByType[c.type] || 0) + 1;
    const conseqSummary = Object.entries(conseqByType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ×${n}`).join(", ");
    const fuAgg = await BehaviorFollowup.aggregate([
      { $match: { schoolId: req.schoolId, studentId: student._id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const fu = { open: 0, done: 0, not_done: 0, waived: 0 };
    for (const f of fuAgg) fu[f._id] = f.n;
    const fuTotal = fu.open + fu.done + fu.not_done + fu.waived;
    const fuResolved = fu.done + fu.waived;
    const managementText =
      `\nHOW STAFF MANAGED THIS STUDENT (the diligence record — give this due weight; it shows the behaviour was handled, not ignored):\n` +
      `- Staff involved: ${tIds.length} teacher(s).\n` +
      `- Positive recognition given to this student: ${positiveCount}.\n` +
      `- Documented interactions / parent meetings logged: ${interactionCount}.\n` +
      `- Private documentation notes on incidents: ${teacherNoteCount}.\n` +
      `- Notices home to parents: ${notices.length} (${noticesSent} sent) — parents were kept informed.\n` +
      (consequencesLogged.length ? `- Consequences applied & documented: ${consequencesLogged.length}${conseqSummary ? ` (${conseqSummary})` : ""}.\n` : "") +
      (uniformCount ? `- Uniform infractions (count toward the Good Uniform Dress Down): ${uniformCount}.\n` : "") +
      (fuTotal ? `- Consequence follow-through: ${fuResolved}/${fuTotal} consequence(s) with a follow-up were resolved (${fu.done} completed, ${fu.waived} waived), ${fu.not_done} missed, ${fu.open} still open.\n` : "");

    // GENERAL PRACTICE of the teacher most involved with this student — context
    // that the same standards are applied consistently across students, so the
    // handling of THIS student isn't read as singling them out or as poor
    // discipline. The teacher's own aggregate (counts only, no other names).
    const primaryAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, studentId: student._id } },
      { $group: { _id: "$teacherId", n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 1 },
    ]);
    const primaryTeacherId = primaryAgg[0]?._id || null;
    let practiceText = "";
    let practiceConsistency = "";
    if (primaryTeacherId) {
      const pSince = new Date(); pSince.setMonth(pSince.getMonth() - 12);
      const gincs = await BehaviorIncident.find({ schoolId: req.schoolId, teacherId: primaryTeacherId, timestamp: { $gt: pSince } })
        .select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode studentId").lean();
      let gOff = 0, gPos = 0, gInt = 0; const gStudents = new Set();
      for (const i of gincs) {
        const isPos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
        const isInt = !isPos && i.behaviorSnapshot?.triggerMode === "INTERACTION";
        if (isPos) gPos += 1; else if (isInt) gInt += 1; else gOff += 1;
        gStudents.add(String(i.studentId));
      }
      const gfu = { done: 0, waived: 0, not_done: 0, open: 0 };
      const gfuAgg = await BehaviorFollowup.aggregate([
        { $match: { schoolId: req.schoolId, assignedByTeacherId: primaryTeacherId, createdAt: { $gt: pSince } } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]);
      for (const f of gfuAgg) gfu[f._id] = f.n;
      const gfuTotal = gfu.done + gfu.waived + gfu.not_done + gfu.open;
      const gfuPct = gfuTotal ? Math.round(((gfu.done + gfu.waived) / gfuTotal) * 100) : 0;
      const pName = tName[String(primaryTeacherId)] || (await BehaviorTeacher.findById(primaryTeacherId).select("name").lean())?.name || "this teacher";
      if (gincs.length || gfuTotal) {
        practiceText =
          `\nGENERAL PRACTICE of ${pName} (last 12 months, across ALL their students — for the 1-2 consistency sentences only):\n` +
          `- ${gOff} offence(s) handled across ${gStudents.size} different student(s), alongside ${gPos} positive recognition(s) and ${gInt} documented interaction(s).\n` +
          (gfuTotal ? `- Followed through on ${gfuPct}% of ${gfuTotal} consequence(s) that carried a follow-up.\n` : "");
        practiceConsistency =
          `This sits within ${pName}'s consistent approach across ${gStudents.size} student(s) over the past year` +
          `${gfuTotal && gfuPct >= 50 ? ` (with ${gfuPct}% consequence follow-through)` : ""}, so ${studentFirst} was held to the same standard as everyone else.`;
      }
    }

    // A plain-language summative lead — the student's behaviour at a glance AND
    // how staff handled it — so the summary opens with the overall picture before
    // the detailed record. Mirrors the executive summary's "Overall picture".
    const joinList = (arr) => arr.length <= 1 ? (arr[0] || "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
    const handledBits = [];
    if (positiveCount) handledBits.push(`${positiveCount} positive recognition(s)`);
    if (interactionCount) handledBits.push(`${interactionCount} documented interaction(s)`);
    if (teacherNoteCount) handledBits.push(`${teacherNoteCount} private documentation note(s)`);
    if (consequencesLogged.length) handledBits.push(`${consequencesLogged.length} documented consequence(s)${conseqSummary ? ` (${conseqSummary})` : ""}`);
    handledBits.push(`${notices.length} notice(s) home (${noticesSent} sent) keeping parents informed`);
    const uniformClause = uniformCount ? ` ${uniformCount} of the offences were uniform infractions (counting toward the Good Uniform Dress Down).` : "";
    const fuClause = fuTotal ? `, and ${fuResolved} of ${fuTotal} consequence(s) with a follow-up were resolved` : "";
    const overview =
      (scope === "current"
        ? `Overall summary: this covers ${studentFirst}'s current active trigger — ${incidents.length} recent incident(s) counting toward a notice home. `
        : `Overall summary: ${name}${student.classGroup ? ` (${student.classGroup})` : ""} has a behaviour record spanning ${span}, comprising ${incidents.length} individually-logged incident(s) and ${notices.length} notice(s) home${notices.length ? " — earlier offences are captured in those notices" : ""}. `) +
      `Across the record, staff actively handled the behaviour rather than letting it go: ${joinList(handledBits)}${fuClause}.` +
      uniformClause +
      (practiceConsistency ? ` ${practiceConsistency}` : "");

    const ctxText =
      `Student: ${name}${student.classGroup ? ` (${student.classGroup})` : ""}.\n` +
      `Records on file: ${incidents.length} individually-logged incident(s) + ${notices.length} notice(s) home, spanning ${span}.\n` +
      (scope === "all" ? `NOTE: earlier offences may exist ONLY as notices home — treat each notice below as a record of past behaviour, not just a communication.\n` : "") +
      managementText +
      practiceText +
      `\n${scope === "current" ? "CURRENT trigger incidents" : "FULL incident history"} (incl. private teacher notes):\n${lines.join("\n") || "(none)"}\n\n` +
      (consequencesLogged.length
        ? `Consequences applied & documented by staff:\n${consequencesLogged.map((c) => `- ${new Date(c.at).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })} — ${c.type}${c.detail ? `: ${c.detail}` : ""}${c.byName ? ` [by ${c.byName}]` : ""}`).join("\n")}\n\n`
        : "") +
      `Notices home${scope === "all" ? " (full content = the record of earlier offences)" : ""}:\n${noticeLines.join("\n") || "(none)"}`;
    const prompt =
      `Write a thorough, objective summary of a student's behaviour record for a school administrator (VP/principal). ` +
      `It may be used to show — to an administrator or a parent — that staff have managed this student's behaviour conscientiously and fairly, so be comprehensive: cover BOTH the behaviour itself AND how staff responded (positive recognition given, parent meetings/interactions logged, notices home keeping parents informed, consequences followed through, and documentation kept). Give the staff-response record genuine weight; do not reduce the summary to a list of offences. ` +
      `Base your assessment on ALL the records below — BOTH the individually-logged incidents AND the notices home (which, especially for earlier events, are the only record of past offences). ` +
      `State the overall date range and the number of events on file (counting notices that describe offences), then cover the pattern, frequency, types of behaviour, any escalation, and what has been communicated home. ` +
      (practiceText ? `Also weave in 1-2 sentences (no more) — using the GENERAL PRACTICE figures — situating how this student was handled within the teacher's consistent, balanced approach across their other students (the same standards and follow-through applied to everyone, not singling this student out). Keep it factual; do not dump the raw practice numbers as a separate section. ` : "") +
      `OPEN with a single summative paragraph giving the overall picture of this student's behaviour AND how it was handled (the pattern at a glance plus the conscientious staff response), before going into the specifics. ` +
      `Be factual and tight: 2-3 short flowing paragraphs (~200 words) of continuous prose — NOT a headed report with section titles or bullet lists. You need not list every event, but the assessment must reflect the WHOLE record back to the earliest date. Use ONLY the data below — do not invent.\n\n${ctxText}`;

    // Deterministic fallback opens with the same summative lead, then the record.
    let summary = `Behaviour summary — ${name}\n\n${overview}\n\n${ctxText}`;
    let aiUsed = false;
    try {
      const client = makeDefaultAiClient(config || {});
      if (client) {
        const out = await Promise.race([
          client.complete(prompt, { maxTokens: 1300 }),
          new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 30000)),
        ]);
        if (out && String(out).trim()) { summary = String(out).trim(); aiUsed = true; }
      }
    } catch {
      /* fall back to the deterministic digest */
    }
    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const r = await sendAdminSummaryEmail(req, name, config?.branding?.schoolName || "", summary, req.body.to, student._id);
      emailed = r.emailed;
      emailError = r.emailError;
    }
    await audit(req.schoolId, "admin_summary.generated", req, { studentId: student._id, meta: { scope, aiUsed, emailed } });
    res.json({ ok: true, summary, aiUsed, scope, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// PARENT-FACING "whole picture" summary. When a student has accumulated a
// pattern across several teachers, this pulls it together into one warm,
// honest, upbuilding note the teacher can review and post to Edsby — grouped
// by teacher, solution-focused, inviting partnership. Record-only / clipboard:
// never sent automatically (BCS has no auto parent channel).
//
// Window (scope):
//   "period" (default) — back to when the slate was last wiped
//      (student.thresholdResetAt, e.g. after a prior VP meeting/behaviour plan
//      that cleared the strikes); full record if there's been no such reset.
//   "all" — the entire record.
//
// SAFETY: this is parent-facing, so the prompt forbids naming any OTHER student
// and forbids quoting slurs/profanity (describe sensitively instead). Private
// teacher notes are NOT fed in verbatim. The teacher reviews before posting.
router.post("/students/:id/parent-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    const scope = req.body?.scope === "all" ? "all" : "period";
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    const name = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
    const studentFirst = student.preferredName || student.firstName || name;
    // Other students named in teachers' notes never reach this family.
    const famScrub = await familyNameScrubber(req.schoolId, student._id);

    // Window cutoff: the current behaviour period (since strikes were last
    // cleared) by default; the whole record for "all".
    const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    const cutoff = scope === "period" ? resetAt : 0;
    const resetDateLabel = resetAt && scope === "period"
      ? new Date(resetAt).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ }) : "";

    let incidents = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: 1 }).lean();
    if (cutoff) incidents = incidents.filter((i) => new Date(i.timestamp).getTime() >= cutoff);

    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name courtesyName").lean();
    // Parent-facing → prefer the official/courtesy name.
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), (t.courtesyName || t.name || "a teacher")]));

    // Who is writing this — and how they relate to the student, so the framing
    // is honest. The homeroom teacher (or anyone who didn't personally witness
    // every incident) writes as a coordinator pulling colleagues' observations
    // together, NOT as if it all happened "in my class."
    const writerId = String(req.membership?._id || "");
    const isHomeroom = !!(req.membership?.homeroom && student.classGroup &&
      String(req.membership.homeroom).trim().toLowerCase() === String(student.classGroup).trim().toLowerCase());

    // Split positives (to keep the note balanced & upbuilding) from concerns,
    // and group the concerns BY TEACHER, as requested.
    const positives = [];
    const byTeacher = {}; // teacherId -> { name, isWriter, lines[] }
    for (const i of incidents) {
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = i.behaviorSnapshot?.triggerMode === "INTERACTION";
      const d = new Date(i.timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ });
      const tid = String(i.teacherId);
      const who = tName[tid] || "a teacher";
      const what = i.behaviorSnapshot?.name || "";
      const fd = prepareFamilyDetail(famScrub, (i.detailText || "").trim());
      const detail = fd.detail;
      const line = `${d} — ${what}${detail ? `: ${detail}` : ""}${fd.reported ? " [reported to the teacher, not witnessed — word tentatively, say 'at school' rather than 'in class' unless stated, never mention the source]" : ""}`;
      if (isPositive) { positives.push(`${d} — ${what}${detail ? `: ${detail}` : ""} (noted by ${who})`); continue; }
      if (isInteraction) {
        // A teacher↔student conversation is often the very concern to convey —
        // include it (marked "conversation") so the note acknowledges it. Parent
        // contacts and internal support/meta records stay out.
        if (isConcernConversation(i)) {
          (byTeacher[tid] ||= { name: who, isWriter: tid === writerId, lines: [] }).lines.push(`${d} — conversation: ${detail || what}`);
        }
        continue;
      }
      (byTeacher[tid] ||= { name: who, isWriter: tid === writerId, lines: [] }).lines.push(line);
    }
    const writerLoggedCount = (byTeacher[writerId]?.lines || []).length;
    const concernGroups = Object.values(byTeacher)
      .map((g) => `From ${g.name}${g.isWriter ? " (THIS IS YOU, the writer — your own class)" : ""}:\n${g.lines.map((l) => `  - ${l}`).join("\n")}`)
      .join("\n\n");

    // Partnership / staff-response context — shows parents the school has been
    // engaged (keeps the tone collaborative, not accusatory).
    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: 1 }).lean();
    const noticesInWindow = notices.filter((n) => !cutoff || new Date(n.sentAt || n.createdAt).getTime() >= cutoff);
    // Real parent contacts only (not teacher↔student conversations) for the
    // "the school has been in touch" partnership line.
    const meetings = await BehaviorIncident.find({ studentId: student._id, "behaviorSnapshot.name": PARENT_CONTACT_NAME })
      .sort({ timestamp: 1 }).select("timestamp detailText teacherId").lean();
    const meetingsInWindow = meetings.filter((m) => !cutoff || new Date(m.timestamp).getTime() >= cutoff);
    const consequences = await BehaviorConsequence.find({ studentId: student._id, kind: "corrective" }).sort({ at: 1 }).lean();
    const consInWindow = consequences.filter((c) => !cutoff || new Date(c.at).getTime() >= cutoff);
    // Map a consequence to the incident it was given for (when linked), so the
    // factual record can show "what consequence, if any" per offence.
    const consByIncident = new Map();
    for (const c of consequences) if (c.relatedIncidentId) consByIncident.set(String(c.relatedIncidentId), c);

    // Deterministic factual record: date · offence · teacher · consequence (if
    // any). Built from the data, NOT the AI, so it's always accurate. Offences
    // only (positives and parent-contact logs are summarised elsewhere).
    const history = [];
    for (const i of incidents) {
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      if (isPositive) continue;
      const isConvo = isConcernConversation(i);
      if (i.behaviorSnapshot?.triggerMode === "INTERACTION" && !isConvo) continue; // skip parent-contact/support logs
      const c = consByIncident.get(String(i._id));
      history.push({
        date: new Date(i.timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ }),
        kind: isConvo ? "conversation" : "offense",
        offense: isConvo ? "Conversation" : (i.behaviorSnapshot?.name || "—"),
        teacher: tName[String(i.teacherId)] || "a teacher",
        consequence: isConvo ? "" : famScrub(c ? (c.detail && c.detail.length <= 70 ? `${c.type} — ${c.detail}` : c.type) : ""),
      });
    }
    const historyText = history
      .map((h) => h.kind === "conversation"
        ? `• ${h.date} — Conversation with ${studentFirst} — ${h.teacher}`
        : `• ${h.date} — ${h.offense} — ${h.teacher}${h.consequence ? ` — consequence: ${h.consequence}` : " — (no consequence recorded)"}`)
      .join("\n");

    // Partnership facts — ONLY what's actually on record, stated with exact
    // counts (the AI must not round or invent these). Parent "contacts" are
    // logged calls/meetings; we don't claim more than one unless there is more.
    const partnershipBits = [];
    if (meetingsInWindow.length) partnershipBits.push(`${meetingsInWindow.length} parent contact${meetingsInWindow.length === 1 ? "" : "s"} logged with the family`);
    if (noticesInWindow.length) partnershipBits.push(`${noticesInWindow.length} notice${noticesInWindow.length === 1 ? "" : "s"} sent home this period`);
    if (consInWindow.length) partnershipBits.push(`${consInWindow.length} consequence${consInWindow.length === 1 ? "" : "s"} applied at school`);

    const teacherSig = (req.membership?.courtesyName || "").trim() || actorName(req);
    const schoolName = config?.branding?.schoolName || "";
    const concernCount = Object.values(byTeacher).reduce((a, g) => a + g.lines.length, 0);
    const spanTs = incidents.map((i) => new Date(i.timestamp).getTime()).filter(Boolean).sort((a, b) => a - b);
    const span = spanTs.length
      ? `${new Date(spanTs[0]).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })} to ${new Date(spanTs[spanTs.length - 1]).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })}`
      : "recently";

    // How the writer relates to the student → how the letter should be framed.
    const writerRole = isHomeroom
      ? `The writer (${teacherSig}) is ${studentFirst}'s HOMEROOM teacher. Write as the homeroom teacher who is bringing together observations from ${studentFirst}'s teachers. ` +
        (writerLoggedCount
          ? `Some concerns are the writer's own (marked "THIS IS YOU" above) — those may be in the first person ("in my own class"); attribute all others to the colleague by name (third person). `
          : `The writer did not personally log these — attribute each concern to the colleague who observed it, by name (third person); do NOT write as if they happened "in my class." `)
      : writerLoggedCount && Object.keys(byTeacher).length <= 1
        ? `The writer (${teacherSig}) personally observed these concerns in their own class — the first person ("in my class") is appropriate. `
        : `The writer (${teacherSig}) is one of ${studentFirst}'s teachers. Speak in the first person only for the concerns marked "THIS IS YOU" above; attribute every other teacher's observations to that colleague by name (third person). Do NOT imply the writer witnessed concerns they did not log. `;

    const ctxText =
      `Student first name: ${studentFirst}.\n` +
      `WRITER / PERSPECTIVE: ${writerRole}\n` +
      `Window: ${scope === "period" ? `current behaviour period${resetDateLabel ? ` (since ${resetDateLabel})` : ""}` : "full record"} — ${span}.\n` +
      `Number of concerns in this window: ${concernCount}, observed by ${tIds.length} teacher(s).\n\n` +
      `CONCERNS GROUPED BY TEACHER:\n${concernGroups || "(none in this window)"}\n\n` +
      (positives.length
        ? `POSITIVE / ENCOURAGING moments actually on record in this window (you MAY reference these honestly):\n${positives.map((p) => `  - ${p}`).join("\n")}\n\n`
        : `POSITIVE / ENCOURAGING moments on record in this window: NONE. Do NOT invent any, and do NOT mention their absence — simply omit any positives section entirely (never write "I have not noted any positive moments" or similar).\n\n`) +
      (partnershipBits.length
        ? `WHAT THE SCHOOL HAS ACTUALLY DONE (these exact facts only — do not round up, add, or embellish): ${partnershipBits.join("; ")}.\n\n`
        : `WHAT THE SCHOOL HAS ACTUALLY DONE: nothing is recorded yet in this window — do NOT claim any meetings, calls, notices, or consequences happened.\n\n`) +
      `Signed by: ${teacherSig}${schoolName ? `, ${schoolName}` : ""}.`;

    const prompt =
      `You are writing a warm, honest, and up-building letter to the PARENTS/GUARDIANS of a junior-high student, from their teacher, to bring the whole picture together in one place. ` +
      `This is pastoral and partnership-minded — the goal is to help the parents understand the pattern and to invite them to work WITH the school, never to shame the child. ` +
      `TONE: caring, respectful, hopeful, specific, and truthful. Do not exaggerate, but do not downplay genuine safety concerns either. Assume the best about the student and the family. ` +
      `PERSPECTIVE: Write in the first person AS the writer described under "WRITER / PERSPECTIVE" below, and follow that framing exactly — if the writer is the homeroom teacher pulling colleagues' observations together, do NOT write as though everything happened in the writer's own class; attribute each concern to the teacher who observed it. ` +
      `An item marked "conversation:" is a talk the teacher ALREADY had directly with the student about that concern — acknowledge it naturally and in the first person where the writer had it (e.g. "I spoke with ${studentFirst} about…"), as the reason for reaching out; it is the concern itself, not an offence tally. ` +
      `STRUCTURE: (1) a warm, genuine opening that greets the student and parents (a homeroom/coordinating writer can say they're writing as ${studentFirst}'s homeroom teacher on behalf of ${studentFirst}'s teachers; you may say you're glad to have the student at the school — a relational affirmation — but do NOT assert specific talents or traits as fact); (2) a concise, factual recap of the concerns and conversations ORGANISED BY TEACHER and correctly attributed (e.g. "In Mr. X's class…", "Miss Y noted…", or "In my own class…" / "I spoke with ${studentFirst} about…" only where marked THIS IS YOU), kept brief; (3) encouraging moments ONLY IF they are listed on record above; (4) a short note on what the school has ALREADY done, using the exact facts above (omit this if nothing is recorded); (5) a forward-looking close that invites a conversation and expresses confidence in the student. ` +
      `HARD RULES — these override tone: (a) Use ONLY the information below. Do NOT invent, infer, round, or embellish ANY fact — not events, dates, consequences, quotes, meetings, calls, OR praise. (b) Do NOT attribute specific strengths/talents (e.g. "creativity", "leadership", "enthusiasm") unless such a positive is explicitly listed on record above; if none are listed, keep affirmation purely relational and general, and do not mention the absence of positives. (c) If no meetings/calls/notices/consequences are listed, do NOT say the school has met with, called, or contacted the family. (d) Never name, describe, or hint at any OTHER student (write "a classmate"). (e) Never quote slurs, profanity, or crude language — describe it sensitively (e.g. "used hurtful language toward a classmate"). (f) Do not reproduce private staff notes verbatim. (g) Do NOT claim the writer personally witnessed concerns that another teacher logged. (h) This is a pastoral note to RAISE A CONCERN and invite partnership — do NOT mention consequences, interventions, white slips, disciplinary steps, or the ABSENCE of any of them (never write "no interventions/consequences recorded yet" or similar); simply share the concern and the conversation, and invite the parents to partner. ` +
      `A precise factual record (date · offence · teacher · consequence) will be appended beneath your letter automatically, so you do NOT need to reproduce a table of every date — write the narrative and let the record carry the details. ` +
      `Address the parents and the student (e.g. "Dear ${studentFirst} and parents,"). Sign off as ${teacherSig}${schoolName ? `, ${schoolName}` : ""}. ` +
      `LENGTH: about 200–280 words of flowing prose.\n\n${ctxText}`;

    // Deterministic fallback (no AI key): a plain, kind, teacher-grouped note,
    // framed from the writer's actual relationship to the student.
    const fallbackOpen = isHomeroom
      ? `As ${studentFirst}'s homeroom teacher, I wanted to bring together, in one place, what ${studentFirst}'s teachers have observed, so we can support ${studentFirst} together.`
      : `I wanted to bring together, in one place, how things have been going for ${studentFirst} so we can support ${studentFirst} together.`;
    let summary =
      `Dear ${studentFirst} and parents,\n\n` +
      `${fallbackOpen}\n\n` +
      (concernGroups ? `${concernGroups}\n\n` : `There have been a few things we've been working through.\n\n`) +
      (positives.length ? `We've also seen encouraging moments:\n${positives.map((p) => `  - ${p}`).join("\n")}\n\n` : "") +
      (partnershipBits.length ? `The school has stayed engaged: ${partnershipBits.join("; ")}.\n\n` : "") +
      `We'd welcome the chance to talk this through with you and partner on next steps. We believe in ${studentFirst} and are confident we can help ${studentFirst} thrive.\n\n` +
      `Warm regards,\n${teacherSig}${schoolName ? `\n${schoolName}` : ""}`;
    let aiUsed = false;
    try {
      const client = makeDefaultAiClient(config || {});
      if (client) {
        const out = await Promise.race([
          client.complete(prompt, { maxTokens: 1200 }),
          new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 30000)),
        ]);
        if (out && String(out).trim()) { summary = stripMarkdown(String(out).trim()); aiUsed = true; }
      }
    } catch {
      /* fall back to the deterministic note */
    }
    summary = famScrub(summary); // last line of defence: no other student's name

    await audit(req.schoolId, "parent_summary.generated", req, { studentId: student._id, meta: { scope, aiUsed, concerns: concernCount } });
    res.json({ ok: true, summary, history, historyText, aiUsed, scope, concernCount, teacherGroups: Object.keys(byTeacher).length });
  } catch (err) {
    next(err);
  }
});

// Send the student's HOMEROOM teacher a ready-to-post "whole picture" parent
// note (in their voice), CC the VP for awareness. The HR teacher reviews, edits,
// and posts it to Edsby — nothing reaches parents automatically. No white slip
// is implied and no consequence is stated (the VP's discretion). This is the
// on-demand version of the threshold flow, for catching up or any student.
router.post("/students/:id/hr-note", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const first = student.preferredName || student.firstName || "the student";
    const cls = (student.classGroup || "").trim();

    // The student's homeroom teacher authors & receives it.
    const hr = cls ? await BehaviorTeacher.findOne({ schoolId: req.schoolId, homeroom: cls }).lean() : null;
    if (!hr?.email) {
      return res.status(400).json({ ok: false, error: `No homeroom teacher with an email is set for ${cls || "this class"}. Set the homeroom on the Team page first.` });
    }
    const hrName = (hr.courtesyName || hr.name || "").trim() || "the homeroom teacher";

    // Whole picture by default (parents may only know part of it); grouped by teacher.
    const scope = req.body?.scope === "period" ? "period" : "all";
    const cutoff = scope === "period" && student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    let incidents = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: 1 }).lean();
    if (cutoff) incidents = incidents.filter((i) => new Date(i.timestamp).getTime() >= cutoff);
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name courtesyName").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), (t.courtesyName || t.name || "a teacher")]));

    const byTeacher = {}; const history = [];
    for (const i of incidents) {
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      if (isPositive) continue;
      const who = tName[String(i.teacherId)] || "a teacher";
      const d = new Date(i.timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ });
      if (i.behaviorSnapshot?.triggerMode === "INTERACTION") {
        // Include a teacher↔student conversation (often the very concern to raise);
        // skip parent-contact logs and internal support/meta records.
        if (isConcernConversation(i)) {
          (byTeacher[who] ||= []).push(`${d} — conversation: ${(i.detailText || "").trim() || i.behaviorSnapshot?.name || ""}`);
          history.push({ date: d, kind: "conversation", offense: "Conversation", teacher: who });
        }
        continue;
      }
      (byTeacher[who] ||= []).push(`${d} — ${i.behaviorSnapshot?.name || ""}${i.detailText ? `: ${i.detailText}` : ""}`);
      history.push({ date: d, kind: "offense", offense: i.behaviorSnapshot?.name || "—", teacher: who });
    }
    const concernCount = Object.values(byTeacher).reduce((a, l) => a + l.length, 0);
    if (!concernCount) return res.status(400).json({ ok: false, error: "No concerns on record to write about." });
    const groups = Object.entries(byTeacher).map(([w, l]) => `From ${w}:\n${l.map((x) => `  - ${x}`).join("\n")}`).join("\n\n");

    const parentNames = (student.parents || []).map((p) => (p.name || "").trim()).filter(Boolean);
    const greeting = parentNames.length ? `Dear ${first} and ${parentNames.join(" and ")},` : `Dear ${first} and parents,`;
    const schoolName = config?.branding?.schoolName || "";

    const prompt =
      `You are ${first}'s HOMEROOM teacher (${hrName}) writing a warm, honest, up-building note to ${first}'s PARENTS to bring the whole picture together, since concerns have come from several teachers. ` +
      `Write in the first person as the homeroom teacher COORDINATING what ${first}'s teachers have observed — attribute each concern to the teacher who noted it (e.g. "In Mr. X's class…"); do not imply you witnessed them all. ` +
      `An item marked "conversation:" is a talk a teacher ALREADY had with ${first} about that concern — acknowledge it as the reason for reaching out (e.g. "Mr. X spoke with ${first} about…"); it is the concern itself, not an offence tally. ` +
      `HARD RULES: use ONLY the facts below; do not invent events, praise, meetings, or consequences. Never name or hint at any OTHER student (write "a classmate"). Never quote slurs/profanity — describe sensitively. Do NOT mention consequences, interventions, white slips, disciplinary steps, or the ABSENCE of any of them (never "no interventions/consequences recorded yet"); do NOT mention the absence of positives. This is a pastoral note to raise the concern and invite partnership. ` +
      `Open with the greeting exactly: "${greeting}". ~220-280 words of flowing prose, organised by teacher, ending with an invitation to partner and confidence in ${first}. Sign as ${hrName}${schoolName ? `, ${schoolName}` : ""}.\n\nCONCERNS BY TEACHER:\n${groups}`;

    let note = `${greeting}\n\nI wanted to bring together what ${first}'s teachers have observed so we can support ${first} together.\n\n${groups}\n\nI'd welcome the chance to partner with you on next steps. Warm regards,\n${hrName}${schoolName ? `\n${schoolName}` : ""}`;
    let aiUsed = false;
    try {
      const client = makeDefaultAiClient(config || {});
      if (client) {
        const out = await Promise.race([
          client.complete(prompt, { maxTokens: 1100 }),
          new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 30000)),
        ]);
        if (out && String(out).trim()) { note = stripMarkdown(String(out).trim()); aiUsed = true; }
      }
    } catch { /* keep deterministic */ }

    const historyText = history.map((h) => `• ${h.date} — ${h.offense} — ${h.teacher}`).join("\n");
    const fullText = note + (historyText ? `\n\n— Behaviour record —\n${historyText}` : "");

    const vpEmail = (config?.vp?.email || "").trim();
    const hrFirst = (hr.name || hrName).trim().split(/\s+/)[0];
    const intro = `${first} has reached the point where it helps to bring the whole picture together for the family. Here's a proposed note for you to review, edit, and post to Edsby${vpEmail ? " — John is copied for awareness" : ""}.`;
    const note2 = `No white slip is implied, and no consequence is stated — that's left to the VP's discretion.`;
    const recordHtml = history.length
      ? `<p style="margin:14px 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#64748b">Behaviour record</p><ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6;font-size:13px">${history.map((h) => `<li>${escapeHtml(h.date)} — ${escapeHtml(h.offense)} <span style="color:#94a3b8">· ${escapeHtml(h.teacher)}</span></li>`).join("")}</ul>`
      : "";
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    await sendEmail({
      from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
      to: hr.email, cc: vpEmail || undefined, replyTo: (req.user?.email || "").trim() || undefined,
      subject: `Proposed note for ${first} ${student.lastName} (${cls}) — review & post to Edsby`,
      text: `Hi ${hrFirst},\n\n${intro} ${note2}\n\n----- PROPOSED NOTE -----\n${fullText}`,
      html: emailShell({
        title: `Proposed note for ${escapeHtml(first)} ${escapeHtml(student.lastName || "")} (${escapeHtml(cls)})`,
        schoolName: schoolName || "Compass",
        preheader: `A whole-picture note to review and post to Edsby${vpEmail ? " — John is copied" : ""}.`,
        footnote: "Nothing reaches parents automatically — post it to Edsby when you're happy with it. No white slip is implied; any consequence is at the VP's discretion.",
        contentHtml:
          `<p style="margin:0 0 8px;color:#334155">Hi ${escapeHtml(hrFirst)},</p>` +
          `<p style="margin:0 0 12px;color:#334155">${escapeHtml(intro)} ${escapeHtml(note2)}</p>` +
          `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">` +
          pasteableNote(noteToHtml(note), { channel: "Edsby" }) +
          recordHtml,
      }),
    });

    // Log the send itself as a documented INTERVENTION on the student's record.
    // Compass's responsibility ends here: this is the intervention. There is no
    // nagging and no confirmation chase — acting on it is the HR teacher's / VP's.
    try {
      let beh = await Behavior.findOne({ schoolId: req.schoolId, name: "Whole-picture note recommended" });
      if (!beh) beh = await Behavior.create({
        schoolId: req.schoolId, name: "Whole-picture note recommended", keyword: "intervention", kind: "negative", triggerMode: "INTERACTION",
        description: "A whole-picture parent note was prepared and sent to the homeroom teacher (VP copied) to review and post to Edsby. A documented intervention — not a strike, nothing auto-sent home.",
        consequenceText: "", points: 0,
      });
      await BehaviorIncident.create({
        schoolId: req.schoolId, studentId: student._id, teacherId: req.membership._id,
        behaviorId: beh._id,
        behaviorSnapshot: { name: beh.name, description: beh.description, triggerMode: "INTERACTION", kind: "negative", consequenceText: "", points: 0 },
        detailText: `Whole-picture note sent to ${hrName} (homeroom)${vpEmail ? ", cc VP," : ""} to review and post to Edsby.`,
        immediateFlag: false, timestamp: new Date(),
      });
    } catch (e) { console.warn("[behavior/hr-note] intervention log failed:", e?.message || e); }

    await audit(req.schoolId, "hr_note.sent", req, { studentId: student._id, meta: { to: hr.email, cc: vpEmail, aiUsed, concerns: concernCount } });
    res.json({ ok: true, sentTo: hr.email, hrName, cc: vpEmail || null, preview: fullText, aiUsed });
  } catch (err) {
    next(err);
  }
});

// Division/teacher EXECUTIVE summary — an AI overview over a 6/12-month window,
// scoped to me (this teacher) or all teachers. Behaviour trend, interaction
// patterns, notices home, current strike load. Copied to clipboard by the UI.
router.post("/executive-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    // Default to the CURRENT SCHOOL YEAR (since Sept 1), matching the Reports
    // page; a numeric `months` still gives a rolling 3/6/12-month view.
    const raw = String(req.body?.months || "year");
    const scope = req.body?.scope === "me" ? "me" : "all";
    let months, cutoff, windowShort, windowFull;
    if (raw === "year" || raw === "") {
      months = "year";
      const now = new Date();
      const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // Sept = month 8
      cutoff = new Date(startYear, 8, 1);
      windowShort = "this school year";
      windowFull = `this school year (since ${cutoff.toISOString().slice(0, 10)})`;
    } else {
      months = [3, 6, 12].includes(Number(raw)) ? Number(raw) : 12;
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      windowShort = `the last ${months} months`;
      windowFull = `last ${months} months (since ${cutoff.toISOString().slice(0, 10)})`;
    }
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const triggerCount = config?.triggerCount ?? 3;
    const fadeDays = config?.fadeWindowDays ?? 30;

    const incMatch = { schoolId: req.schoolId, timestamp: { $gt: cutoff } };
    if (scope === "me") incMatch.teacherId = req.membership._id;
    const incidents = await BehaviorIncident.find(incMatch)
      .select("behaviorSnapshot.name behaviorSnapshot.triggerMode behaviorSnapshot.kind behaviorSnapshot.points timestamp studentId teacherNotes")
      .lean();

    // Classify every event into one of three distinct threads so the summary
    // reflects the whole picture, not just discipline:
    //   • offence     — a negative behaviour that counts toward strikes
    //   • positive     — a reward / good behaviour (kind positive or points > 0)
    //   • interaction  — a documented conversation/parent-meeting (INTERACTION
    //                    mode, not positive): kept for the record, no strike,
    //                    nothing sent home.
    const byType = {};          // offence types
    const posByType = {};       // positive types
    const byMonth = {};         // OFFENCE monthly volume (the discipline trend)
    const byWeek = {};          // OFFENCE weekly volume — used when the window spans a single month
    const byMonthKind = {};     // { "YYYY-MM": { neg, pos } } red/green chart — offences vs positives only
    const weekKey = (d) => {
      const dt = new Date(d); dt.setUTCHours(0, 0, 0, 0);
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday
      return dt.toISOString().slice(0, 10);
    };
    const bumpKind = (d, kind) => {
      const k = new Date(d).toISOString().slice(0, 7);
      byMonthKind[k] = byMonthKind[k] || { neg: 0, pos: 0 };
      byMonthKind[k][kind] += 1;
    };
    const students = new Set();
    let teacherNoteCount = 0;
    let offenceCount = 0, positiveCount = 0, interactionCount = 0;
    for (const i of incidents) {
      const nm = i.behaviorSnapshot?.name || "Other";
      const mode = i.behaviorSnapshot?.triggerMode || "THRESHOLD";
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = !isPositive && mode === "INTERACTION";
      students.add(String(i.studentId));
      teacherNoteCount += i.teacherNotes?.length || 0;
      if (isPositive) {
        positiveCount += 1;
        posByType[nm] = (posByType[nm] || 0) + 1;
        bumpKind(i.timestamp, "pos");
      } else if (isInteraction) {
        // Documented interaction — neutral; not an offence and not on the chart.
        interactionCount += 1;
      } else {
        offenceCount += 1;
        byType[nm] = (byType[nm] || 0) + 1;
        const mk = new Date(i.timestamp).toISOString().slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + 1;
        byWeek[weekKey(i.timestamp)] = (byWeek[weekKey(i.timestamp)] || 0) + 1;
        bumpKind(i.timestamp, "neg");
      }
    }
    const notMatch = { schoolId: req.schoolId, createdAt: { $gt: cutoff } };
    if (scope === "me") notMatch.sentByTeacherId = req.membership._id;
    const notices = await BehaviorNotice.find(notMatch)
      .select("reason status studentId sentAt createdAt legacyImport triggeringIncidentIds")
      .lean();
    const noticeByReason = {};
    for (const n of notices) noticeByReason[n.reason] = (noticeByReason[n.reason] || 0) + 1;
    const noticesSent = notices.filter((n) => n.status === "sent").length;

    // Earlier/legacy offences often exist ONLY as notices home (no individual
    // incident row). Fold those into the monthly trend + student set so the
    // history isn't undercounted — but skip notices backed by counted incidents
    // (modern flow) to avoid double-counting.
    let legacyOffences = 0;
    for (const n of notices) {
      const backed = Array.isArray(n.triggeringIncidentIds) && n.triggeringIncidentIds.length > 0;
      if (n.legacyImport || !backed) {
        legacyOffences += 1;
        const mk = new Date(n.sentAt || n.createdAt).toISOString().slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + 1;
        byWeek[weekKey(n.sentAt || n.createdAt)] = (byWeek[weekKey(n.sentAt || n.createdAt)] || 0) + 1;
        bumpKind(n.sentAt || n.createdAt, "neg");
        if (n.studentId) students.add(String(n.studentId));
      }
    }
    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const monthly = Object.keys(byMonth).sort().map((k) => `${k}: ${byMonth[k]}`);

    // Division current strike load (shared count — not per-teacher).
    const agg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, countedInNoticeId: null, "behaviorSnapshot.triggerMode": "THRESHOLD", timestamp: { $gt: new Date(Date.now() - fadeDays * DAY_MS) } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const atThreshold = agg.filter((a) => a.n >= triggerCount - 1).length;

    // Follow-through diligence: of consequences that carried a follow-up, how
    // many did the teacher/division actually resolve vs let slip. This is a
    // record of conscientiousness — valuable when the summary is used to
    // represent how thoroughly someone manages behaviour.
    const fuMatch = { schoolId: req.schoolId, createdAt: { $gt: cutoff } };
    if (scope === "me") fuMatch.assignedByTeacherId = req.membership._id;
    const fuAgg = await BehaviorFollowup.aggregate([
      { $match: fuMatch },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const fu = { open: 0, done: 0, not_done: 0, waived: 0 };
    for (const f of fuAgg) fu[f._id] = f.n;
    const fuTotal = fu.open + fu.done + fu.not_done + fu.waived;
    const fuResolved = fu.done + fu.waived;
    const fuResolvedPct = fuTotal ? Math.round((fuResolved / fuTotal) * 100) : 0;

    // Distinct active months — a span of steady engagement, not a one-off burst.
    const activeMonths = Object.keys(byMonth).length;

    // Positive behaviours are a new feature — flag it so a low positive count
    // isn't read as the teacher/division being "unbalanced".
    const firstPositive = await BehaviorIncident.findOne({
      schoolId: req.schoolId,
      $or: [{ "behaviorSnapshot.kind": "positive" }, { "behaviorSnapshot.points": { $gt: 0 } }],
    }).sort({ timestamp: 1 }).select("timestamp").lean();
    const positivesNew = !firstPositive || Date.now() - new Date(firstPositive.timestamp).getTime() < 90 * DAY_MS;
    const positiveNote = positivesNew
      ? `\nNOTE: positive-behaviour recognition was only recently introduced${firstPositive ? ` (first positive logged ${new Date(firstPositive.timestamp).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })})` : ""}. The small number of positive events (${positiveCount}) reflects that it is NEW — do NOT characterise the teacher/division as unbalanced, lacking positives, or skewed toward discipline; if anything, note that positive tracking is just getting underway.`
      : "";

    const who = scope === "me" ? (req.membership.name || "this teacher") : "all teachers (division-wide)";
    const totalOffences = offenceCount + legacyOffences;
    const topPosTypes = Object.entries(posByType).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // ── Synthesised "overall picture" — a plain-language read of the numbers, so
    // the summary opens with the gestalt before the line-by-line figures. Used in
    // the deterministic fallback and required of the AI version too.
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const fmtMonth = (k) => { const [y, m] = String(k).split("-"); return MONTH_NAMES[+m - 1] ? `${MONTH_NAMES[+m - 1]} ${y}` : k; };
    const listJoin = (arr) => arr.length <= 1 ? (arr[0] || "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
    const monthsSorted = Object.keys(byMonth).sort();
    // The current calendar month is still in progress — its lower count must NOT
    // be read as a trend/improvement (e.g. "great improvement in October" on Oct 2).
    const nowDt = new Date();
    const curMonthKey = `${nowDt.getFullYear()}-${String(nowDt.getMonth() + 1).padStart(2, "0")}`;
    const curMonthInProgress = monthsSorted.includes(curMonthKey);
    const dayOfMonth = nowDt.getDate();
    // Trend uses COMPLETE months only, so the partial current month can't skew it.
    const trendMonths = monthsSorted.filter((k) => k !== curMonthKey);
    const trendVols = trendMonths.map((k) => byMonth[k]);
    let trendVerb = "held roughly steady";
    if (trendVols.length >= 4) {
      const mid = Math.floor(trendVols.length / 2);
      const firstAvg = trendVols.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const lastAvg = trendVols.slice(mid).reduce((a, b) => a + b, 0) / (trendVols.length - mid);
      if (lastAvg > firstAvg * 1.2) trendVerb = "risen";
      else if (lastAvg < firstAvg * 0.8) trendVerb = "eased";
    }
    // Peak over COMPLETE months (a partial current month shouldn't define the peak).
    const peakPool = trendMonths.length ? trendMonths : monthsSorted;
    const peakMonth = peakPool.length ? peakPool.reduce((a, b) => (byMonth[b] > byMonth[a] ? b : a)) : "";
    const peakVol = peakMonth ? byMonth[peakMonth] : 0;
    const topTypeNames = topTypes.slice(0, 3).map(([k]) => k);
    const subject = scope === "me" ? (req.membership.name || "This teacher") : "Across the division, staff";
    const fuQuality = fuResolvedPct >= 80 ? "strong" : fuResolvedPct >= 50 ? "moderate" : "an area to tighten";

    // With a single calendar month of data (common early in a school year), a
    // "monthly trend" is meaningless — break the offence volume down by week
    // instead, and don't assert a trend the data can't support.
    const useWeekly = activeMonths <= 1;
    const weekKeysSorted = Object.keys(byWeek).sort();
    const weeklySeries = weekKeysSorted.map((k) => { const d = new Date(k); return `wk of ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}: ${byWeek[k]}`; });
    // Tag the current month as in-progress so a partial count isn't misread.
    const monthlyTagged = monthsSorted.map((k) => `${k}: ${byMonth[k]}${k === curMonthKey && curMonthInProgress ? " (month in progress)" : ""}`);
    const volumeSeries = useWeekly ? weeklySeries : monthlyTagged;
    const volumeLabel = useWeekly ? "Weekly offence volume (this term)" : "Monthly offence volume";
    const curMonthName = fmtMonth(curMonthKey);
    const currentMonthNote = (!useWeekly && curMonthInProgress)
      ? ` The most recent month, ${curMonthName}, is still in progress (only ${dayOfMonth} day(s) so far), so its lower count reflects an incomplete month — it is NOT an improvement or a downward trend, and must not be described as one.`
      : "";
    const trendClause = useWeekly
      ? (weekKeysSorted.length >= 2
          ? `and week to week the offence load reads ${weeklySeries.join("; ")}`
          : `and it is early in the term (${totalOffences} offence(s) so far), so it is too soon to read a trend`)
      : `and the monthly offence load has ${trendVerb} on average across complete months${peakMonth ? `; the busiest month was ${fmtMonth(peakMonth)} (${peakVol})` : ""}${currentMonthNote}`;
    const overview =
      `Overall picture: over ${windowShort}, ${subject} engaged with ${students.size} student(s) — ` +
      `${totalOffences} offence(s), ${positiveCount} positive recognition(s) and ${interactionCount} documented interaction(s). ` +
      (topTypeNames.length ? `Offences are concentrated in ${listJoin(topTypeNames)}, ` : "") +
      `${trendClause}. ` +
      (fuTotal ? `Consequence follow-through is ${fuQuality} (${fuResolvedPct}% of ${fuTotal} resolved), ` : "") +
      `with the record kept across ${activeMonths} active month(s)${teacherNoteCount ? ` and ${teacherNoteCount} private note(s)` : ""}. ` +
      (atThreshold ? `Division-wide, ${atThreshold} student(s) sit at or one away from the ${triggerCount}-strike trigger. ` : "") +
      (positivesNew ? `Positive recognition was only recently introduced, so that thread is still getting underway.` : "");

    const ctxText =
      `Window: ${windowFull}. Scope: ${who}.\n` +
      `Students involved (any event type): ${students.size}.\n` +
      `\nThree DISTINCT threads — keep them separate, do not conflate:\n` +
      `1) OFFENCES (negative behaviour, counts toward strikes): ${totalOffences} total — ${offenceCount} logged as individual incidents in the app` +
      `${legacyOffences ? `, plus ${legacyOffences} earlier offence(s) that exist ONLY as historical notices home (from a one-time import of past paper records)` : ""}.\n` +
      (legacyOffences
        ? `   RECONCILIATION (important — do not contradict): those ${legacyOffences} historical notices ARE offences and are already counted in the ${totalOffences} offence total and the monthly volume below. The "${notices.length} notices home" figure overlaps with them — it is NOT additional events. Do NOT state there were more notices than offences, and do NOT headline the small "${offenceCount}" logged-incident number as the year's total; use ${totalOffences} total offences.\n`
        : "") +
      `2) POSITIVE recognitions (rewards / good behaviour — NEVER a strike): ${positiveCount}${topPosTypes.length ? ` — e.g. ${topPosTypes.map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}.\n` +
      `3) Documented INTERACTIONS (conversations & parent meetings logged for the record — no note home, no strike; relationship-building / proactive engagement): ${interactionCount}.\n` +
      `\nBy offence type: ${topTypes.map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n` +
      `Engagement span: activity recorded across ${activeMonths} distinct month(s) of the window.\n` +
      `Documentation diligence: ${teacherNoteCount} private teacher note(s) recorded alongside incidents.\n` +
      `${volumeLabel}${useWeekly ? "" : " (incidents + historical notices)"}: ${volumeSeries.join("; ") || "n/a"}.\n` +
      `Parent communication: ${notices.length} notice(s) home created (${noticesSent} sent) — by reason: ${Object.entries(noticeByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n` +
      `Consequence follow-through: of ${fuTotal} consequence(s) that carried a follow-up, ${fuResolved} were resolved (${fu.done} completed, ${fu.waived} waived) — ${fuResolvedPct}% — with ${fu.not_done} missed and ${fu.open} still open.\n` +
      `Current strike load (division, shared count): ${atThreshold} student(s) at or one away from the ${triggerCount}-strike trigger.` +
      positiveNote;
    const prompt =
      `You are writing a COMPREHENSIVE executive summary about a teacher's classroom-behaviour management over the period, addressed to school leadership for SUPPORTIVE purposes. ` +
      `Frame it as a supervisor would when championing and supporting a staff member: lead with what is going well and the diligence shown; present challenges (a heavy offence load, a difficult class, a rough month) as where the teacher may benefit from support, resources, mentoring or co-planning — never as a failing. Be encouraging, fair and constructive; this is for backing the teacher up, not evaluating or disciplining them. Give due weight to every form of engagement, not just discipline, and don't omit a thread because its number is small. ` +
      `Cover, as distinct threads: (1) how things are going overall and the OFFENCE trend across the window (improving / worsening / steady, citing the ${useWeekly ? "weekly" : "monthly"} volumes — use the ${totalOffences} total offences, not just the logged-incident count)${useWeekly ? ". IMPORTANT: the data spans a single calendar month — do NOT describe a monthly trend; use the weekly volumes above, or simply state the total so far this term, and never imply a longer trend than the data supports" : ""}${currentMonthNote ? `. IMPORTANT:${currentMonthNote}` : ""}; ` +
      `(2) POSITIVE recognition — how positives are being used to reinforce good behaviour (${positiveCount} in the window); ` +
      `(3) documented INTERACTIONS (${interactionCount}) such as conversations and parent meetings logged for the record — proactive, relationship-building engagement that is NOT discipline; ` +
      `(4) thoroughness and follow-through — parent communication (${notices.length} notice(s) home), consequence follow-through (${fuResolvedPct}% of ${fuTotal} resolved), documentation via ${teacherNoteCount} private note(s), and steady engagement across ${activeMonths} month(s); ` +
      `${scope === "me" ? "this teacher's overall engagement style, including the balance of positives and documented interactions vs. discipline, and the diligence shown in following process through;" : "patterns across the division and which behaviours dominate;"} ` +
      `and the current load. Keep the figures internally consistent (never more notices than total offences; positives and interactions are NOT offences and must not be added into the offence count). Be fair, professional and constructive — suitable for leadership to read in support of this teacher. Do not exaggerate or editorialise; let the comprehensiveness come from covering every thread accurately, not from length. ` +
      `Close with one short sentence on how the school could best support this teacher going forward (e.g. recognising their consistency, easing a heavy load, or helping ramp up positives). ` +
      `Write 3-4 short flowing paragraphs (~250-300 words) — continuous prose, NOT a headed report with section titles or bullet lists, and no separate "Conclusion" heading. ` +
      `OPEN with a single 2-3 sentence "overall picture" paragraph that synthesises the whole period — the gestalt (volume of engagement, offence trend, balance of positives/interactions, and follow-through) — before going into the individual threads. Use ONLY the data; do not invent.\n\n${ctxText}`;

    // Clean, reader-facing version used when the AI isn't available — the same
    // figures as ctxText but WITHOUT the AI-only directives ("do not contradict",
    // "three distinct threads", etc.), which must never reach a reader.
    const fallbackText =
      `${overview}\n\n` +
      `Window: ${windowFull}. Scope: ${who}.\n` +
      `Students involved (any event type): ${students.size}.\n\n` +
      `Offences (negative behaviour): ${totalOffences} total` +
      (legacyOffences ? ` — ${offenceCount} logged in the app, plus ${legacyOffences} earlier offence(s) carried in from historical notices home.` : ".") + `\n` +
      `Positive recognitions: ${positiveCount}${topPosTypes.length ? ` — e.g. ${topPosTypes.map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}.\n` +
      `Documented interactions (conversations & parent meetings): ${interactionCount}.\n\n` +
      `By offence type: ${topTypes.map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n` +
      `Activity across ${activeMonths} month(s); ${teacherNoteCount} private teacher note(s) on file.\n` +
      `${volumeLabel}: ${volumeSeries.join("; ") || "n/a"}.\n` +
      `Parent communication: ${notices.length} notice(s) home (${noticesSent} sent)` +
      (legacyOffences ? " — these include the historical notices already counted in the offence total above, not additional events." : ".") + `\n` +
      `Consequence follow-through: ${fuResolved} of ${fuTotal} resolved (${fuResolvedPct}%), ${fu.not_done} missed, ${fu.open} still open.\n` +
      `Current strike load (division): ${atThreshold} student(s) at or one away from the ${triggerCount}-strike trigger.` +
      (positivesNew ? `\n\nNote: positive-behaviour recognition was only recently introduced${firstPositive ? ` (first positive logged ${new Date(firstPositive.timestamp).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })})` : ""}, so the small number of positives simply reflects that it's just getting underway.` : "");

    let summary = `Executive summary — ${who} (${windowShort})\n\n${fallbackText}`;
    let aiUsed = false;
    const provided = String(req.body?.summaryText || "").trim();
    if (provided) {
      summary = provided; // emailing an already-generated summary — skip the AI re-call
      aiUsed = true;
    } else {
      try {
        const client = makeDefaultAiClient(config || {});
        if (client) {
          const out = await Promise.race([client.complete(prompt, { maxTokens: 1300 }), new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 30000))]);
          if (out && String(out).trim()) { summary = String(out).trim(); aiUsed = true; }
        }
      } catch {
        /* deterministic digest fallback */
      }
    }

    // Email path — HTML with a red/green monthly timeline so the graph +
    // formatting are preserved (clipboard text can't carry either).
    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const html = emailShell({
        title: "Executive summary",
        schoolName: config?.branding?.schoolName || "Compass",
        preheader: `${who} · ${windowShort}`,
        contentHtml:
          `<p style="color:#64748b;margin:0 0 16px">${escapeHtml(who)} · ${windowShort}</p>` +
          mdToHtml(summary) +
          `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">` +
          `<h3 style="margin:0 0 6px;font-size:15px;color:#0f172a">Monthly volume (red = negative, green = positive)</h3>${monthlyKindChartHtml(byMonthKind)}` +
          (positivesNew ? `<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">Positive recognition was recently introduced, so green is still ramping up.</p>` : ""),
      });
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      const extra = String(req.body?.to || "")
        .split(/[,\s;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(e));
      const to = [...new Set([req.user.email, ...extra].filter(Boolean))];
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to,
          subject: `Compass executive summary — ${who} (${windowShort})`,
          text: summary,
          html,
        });
        emailed = true;
      } catch (mailErr) {
        emailError = mailErr?.message || String(mailErr);
      }
    }

    await audit(req.schoolId, "executive_summary.generated", req, { meta: { scope, months, aiUsed, emailed } });
    res.json({ ok: true, summary, aiUsed, scope, months, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Aggregated stats for the in-app reports/charts (Phase 4).
router.get("/stats", authAny, loadMembership, async (req, res, next) => {
  try {
    // Default to the CURRENT SCHOOL YEAR (since Sept 1) rather than a rolling
    // window, so the report doesn't fold in last year's data. A numeric `months`
    // still gives a rolling 6/12/24-month view.
    const raw = String(req.query.months || "year");
    let months, cutoff;
    if (raw === "year" || raw === "") {
      months = "year";
      const now = new Date();
      const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // Sept = month 8
      cutoff = new Date(startYear, 8, 1); // Sept 1 of the current school year
    } else {
      months = [6, 12, 24].includes(Number(raw)) ? Number(raw) : 12;
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      cutoff.setDate(1);
    }
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const triggerCount = config?.triggerCount ?? 3;
    const fadeDays = config?.fadeWindowDays ?? 30;
    const pad = (n) => String(n).padStart(2, "0");

    const incidents = await BehaviorIncident.find({ schoolId: req.schoolId, timestamp: { $gt: cutoff } })
      .select("behaviorSnapshot.name behaviorSnapshot.triggerMode behaviorSnapshot.kind behaviorSnapshot.points timestamp studentId")
      .lean();
    const studentsAll = await BehaviorStudent.find({ schoolId: req.schoolId }).select("classGroup").lean();
    const classById = Object.fromEntries(studentsAll.map((s) => [String(s._id), s.classGroup || "—"]));

    const incByMonth = {};
    const posByMonth = {};
    const byType = {};
    const byClass = {};
    const byMode = { THRESHOLD: 0, IMMEDIATE: 0, INTERACTION: 0 };
    let posCount = 0;
    for (const i of incidents) {
      const mk = new Date(i.timestamp).toISOString().slice(0, 7);
      incByMonth[mk] = (incByMonth[mk] || 0) + 1;
      if (i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0) {
        posByMonth[mk] = (posByMonth[mk] || 0) + 1;
        posCount += 1;
      }
      const nm = i.behaviorSnapshot?.name || "Other";
      byType[nm] = (byType[nm] || 0) + 1;
      const cls = classById[String(i.studentId)] || "—";
      byClass[cls] = (byClass[cls] || 0) + 1;
      const mode = i.behaviorSnapshot?.triggerMode || "THRESHOLD";
      byMode[mode] = (byMode[mode] || 0) + 1;
    }

    // Consequences (white slips, detentions, calls home, …) by month.
    const consequences = await BehaviorConsequence.find({ schoolId: req.schoolId, at: { $gt: cutoff } }).select("at").lean();
    const consByMonth = {};
    for (const c of consequences) {
      const mk = new Date(c.at).toISOString().slice(0, 7);
      consByMonth[mk] = (consByMonth[mk] || 0) + 1;
    }

    const notices = await BehaviorNotice.find({ schoolId: req.schoolId, createdAt: { $gt: cutoff } }).select("createdAt status").lean();
    const notByMonth = {};
    let noticesSent = 0;
    for (const n of notices) {
      notByMonth[new Date(n.createdAt).toISOString().slice(0, 7)] = (notByMonth[new Date(n.createdAt).toISOString().slice(0, 7)] || 0) + 1;
      if (n.status === "sent") noticesSent++;
    }

    // Continuous month axis (fill gaps with zeros).
    const axis = [];
    const d = new Date(cutoff);
    const now = new Date();
    while (d <= now) {
      axis.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
      d.setMonth(d.getMonth() + 1);
    }
    const monthly = axis.map((mk) => ({
      month: mk,
      incidents: incByMonth[mk] || 0,
      positives: posByMonth[mk] || 0,
      notices: notByMonth[mk] || 0,
      consequences: consByMonth[mk] || 0,
    }));

    // Weekly buckets (by Monday) — the frontend uses these for a real trend when
    // only a month or two is in, where a monthly line is just a dot or two.
    const incByWeek = {}, posByWeek = {}, consByWeek = {}, notByWeek = {};
    for (const i of incidents) {
      const wk = mondayKey(new Date(i.timestamp));
      incByWeek[wk] = (incByWeek[wk] || 0) + 1;
      if (i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0) posByWeek[wk] = (posByWeek[wk] || 0) + 1;
    }
    for (const c of consequences) { const wk = mondayKey(new Date(c.at)); consByWeek[wk] = (consByWeek[wk] || 0) + 1; }
    for (const n of notices) { const wk = mondayKey(new Date(n.createdAt)); notByWeek[wk] = (notByWeek[wk] || 0) + 1; }
    const weekAxis = [];
    for (let t = new Date(mondayKey(cutoff) + "T00:00:00Z"); t <= now; t.setUTCDate(t.getUTCDate() + 7)) {
      weekAxis.push(t.toISOString().slice(0, 10));
    }
    const weekly = weekAxis.map((wk) => ({
      week: new Date(wk + "T00:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }),
      incidents: incByWeek[wk] || 0,
      positives: posByWeek[wk] || 0,
      notices: notByWeek[wk] || 0,
      consequences: consByWeek[wk] || 0,
    }));

    // Current strike load (shared count).
    const agg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, countedInNoticeId: null, "behaviorSnapshot.triggerMode": "THRESHOLD", timestamp: { $gt: new Date(Date.now() - fadeDays * DAY_MS) } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const strikeBuckets = [];
    for (let k = 1; k <= triggerCount; k++) {
      strikeBuckets.push({
        strikes: k >= triggerCount ? `${triggerCount}+` : String(k),
        students: agg.filter((a) => (k >= triggerCount ? a.n >= triggerCount : a.n === k)).length,
      });
    }
    const activeStudents = await BehaviorStudent.countDocuments({ schoolId: req.schoolId, active: true });

    res.json({
      ok: true,
      months,
      triggerCount,
      totals: {
        incidents: incidents.length,
        positives: posCount,
        consequences: consequences.length,
        notices: notices.length,
        noticesSent,
        students: activeStudents,
        atOrNearThreshold: agg.filter((a) => a.n >= triggerCount - 1).length,
        interactions: byMode.INTERACTION,
      },
      monthly,
      weekly,
      topTypes: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count })),
      classCounts: Object.entries(byClass).sort((a, b) => a[0].localeCompare(b[0])).map(([cls, count]) => ({ class: cls, count })),
      modePie: [
        { name: "Threshold", value: byMode.THRESHOLD },
        { name: "Immediate", value: byMode.IMMEDIATE },
        { name: "Interaction", value: byMode.INTERACTION },
      ],
      strikeBuckets,
    });
  } catch (err) {
    next(err);
  }
});

// ── Parent meeting / contact log (no strike, no note home) ───────────────────
// A teacher records that a meeting or contact happened. Logged as an
// INTERACTION incident so it lives in the student's history for context but
// never counts toward a notice and never sends anything home (§5a).
// Recommended actions for a student: objective rule-based consequences (the
// admin's escalation ladder, keyed to the notice count) + AI "coaching"
// suggestions drawn ONLY from the school's approved whitelist. Read-only; the
// teacher decides. The AI never invents consequences outside the whitelist.
router.get("/students/:id/recommend", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const noticesHomeCount = await countPeriodNotices(req.schoolId, student._id, config); // this period only

    // Objective ladder: the step at the student's current notice level, + next.
    const ladder = (config?.consequenceLadder || []).slice().sort((a, b) => a.noticeNumber - b.noticeNumber);
    const current = ladder.filter((l) => l.noticeNumber <= noticesHomeCount).pop() || null;
    const next = ladder.find((l) => l.noticeNumber === noticesHomeCount + 1) || null;

    // Offence context for the coach (recent THRESHOLD/IMMEDIATE incidents).
    const since = new Date(Date.now() - 120 * DAY_MS);
    const incidents = await BehaviorIncident.find({ studentId: student._id, timestamp: { $gt: since } })
      .select("behaviorSnapshot.name behaviorSnapshot.kind timestamp").sort({ timestamp: -1 }).limit(40).lean();
    const offences = incidents.filter((i) => i.behaviorSnapshot?.kind !== "positive");
    const byType = {};
    for (const i of offences) { const n = i.behaviorSnapshot?.name || "Other"; byType[n] = (byType[n] || 0) + 1; }
    const typeSummary = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`);

    const whitelist = config?.consequenceWhitelist || [];
    let ai = [];
    let aiUsed = false;
    if (whitelist.length && offences.length) {
      try {
        const clientAi = makeDefaultAiClient(config || {});
        if (clientAi) {
          const name = student.preferredName || student.firstName || "the student";
          const occ = noticesHomeCount + 1; // current occurrence # (drives magnitude)
          // Number the list so the AI MUST pick an approved item by index — it can
          // fill in the specifics (the exact line + how many times, the word count
          // + topic, the verses theme) but can never invent a new consequence.
          const numbered = whitelist.map((w, i) => `${i + 1}. ${w}`).join("\n");
          const prompt =
            `You are a supportive behaviour COACH advising a teacher (not the student) at a Christian school. ` +
            `This is roughly occurrence #${occ} of concern for ${name}; recent offences (last ~4 months): ${typeSummary.join(", ") || "none"}.\n\n` +
            `Approved consequences (choose ONLY from these by number — never invent another):\n${numbered}\n\n` +
            `Suggest up to 3 fitting next steps. Where an item asks you to specify something (the exact line and how many times, the essay word-count and topic, the apology focus, the reflection theme/verses), FILL IT IN appropriately for this pattern and occurrence number — heavier specifics for repeat occurrences. ` +
            `Output each on its own line EXACTLY as:  N || specifics || why\n` +
            `where N is the item number, "specifics" is the instantiated detail (or "—" if none needed), and "why" is one short, warm, restorative coaching sentence. Be encouraging, not punitive.`;
          const out = await Promise.race([clientAi.complete(prompt, { maxTokens: 600 }), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 20000))]);
          const lines = String(out || "").split("\n").map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            const parts = line.replace(/^[-*\s]+/, "").split("||").map((p) => p.trim());
            const n = parseInt(parts[0], 10);
            if (!n || n < 1 || n > whitelist.length) continue; // must be an approved index
            const action = whitelist[n - 1];
            const detail = parts[1] && parts[1] !== "—" ? parts[1] : "";
            const why = parts[2] || "";
            if (!ai.some((x) => x.action === action && x.detail === detail)) ai.push({ action, detail, why });
          }
          ai = ai.slice(0, 3);
          aiUsed = ai.length > 0;
        }
      } catch { /* coaching is best-effort */ }
    }

    res.json({ ok: true, noticesHomeCount, current, next, ladder, offences: typeSummary, whitelist, ai, aiUsed });
  } catch (err) {
    next(err);
  }
});

router.post("/students/:id/meeting", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const detailText = String(req.body?.detailText || "").trim();
    if (!detailText) return res.status(400).json({ ok: false, error: "Please add a short note about the meeting." });
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();

    // Find-or-create the shared "Parent meeting / contact" interaction behaviour.
    let beh = await Behavior.findOne({ schoolId: req.schoolId, name: "Parent meeting / contact" });
    if (!beh) {
      beh = await Behavior.create({
        schoolId: req.schoolId,
        name: "Parent meeting / contact",
        keyword: "meeting",
        kind: "negative",
        triggerMode: "INTERACTION",
        description: "A logged meeting or contact with a parent/guardian — kept for the record. Does not count as a strike and sends nothing home.",
        consequenceText: "",
        points: 0,
      });
    }

    const inc = await BehaviorIncident.create({
      schoolId: req.schoolId,
      studentId: student._id,
      teacherId: req.membership._id,
      behaviorId: beh._id,
      behaviorSnapshot: {
        name: beh.name,
        description: beh.description,
        triggerMode: "INTERACTION",
        kind: "negative",
        consequenceText: "",
        points: 0,
      },
      detailText,
      immediateFlag: false,
      timestamp,
    });
    await audit(req.schoolId, "meeting.log", req, { studentId: String(student._id), incidentId: String(inc._id) });
    res.json({ ok: true, incident: inc.toObject() });
  } catch (err) {
    next(err);
  }
});

// One-click homeroom follow-up: log that the homeroom teacher will discuss the
// situation with the student to steer them right — a supportive, relational step
// taken before formal consequences. Recorded as a neutral documented interaction
// (like a meeting): it shows in the record + AI summary as a staff response, does
// NOT count as a strike, sends nothing home, and never escalates the student.
router.post("/students/:id/homeroom-followup", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const who = req.membership?.name || req.user?.name || "";
    const inc = await logHomeroomFollowup({ schoolId: req.schoolId, student, teacherId: req.membership._id, byName: who });
    await audit(req.schoolId, "homeroom_followup.log", req, { studentId: String(student._id), incidentId: String(inc._id) });
    res.json({ ok: true, incident: inc.toObject() });
  } catch (err) {
    next(err);
  }
});

// Staff view of a student's merch wallet: balance + the catalog + recent
// redemptions, for the Redeem control on the student page.
router.get("/students/:id/merch", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).select("_id").lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("merchStore").lean();
    const enabled = !!config?.merchStore?.enabled;
    const balance = (await merchBalances(req.schoolId, [student._id]))[String(student._id)] || 0;
    const items = enabled ? (config.merchStore.items || []).slice().sort((a, b) => (a.points || 0) - (b.points || 0)) : [];
    const history = await MerchRedemption.find({ schoolId: req.schoolId, studentId: student._id }).sort({ at: -1 }).limit(20).select("item points byName at").lean();
    res.json({ ok: true, enabled, balance, items, history });
  } catch (err) { next(err); }
});

// Redeem merch for a student — spends from their personal points wallet (a
// separate ledger; never touches house standings). Staff-only. Rejects if the
// balance is too low. Returns the new balance.
router.post("/students/:id/redeem", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const item = String(req.body?.item || "").trim();
    const points = Math.max(0, Math.round(Number(req.body?.points) || 0));
    if (!item || !points) return res.status(400).json({ ok: false, error: "Item and points are required." });
    const bal = (await merchBalances(req.schoolId, [student._id]))[String(student._id)] || 0;
    if (points > bal) return res.status(400).json({ ok: false, error: `Not enough points — balance is ${bal}.` });
    const who = req.membership?.name || req.user?.name || "";
    await MerchRedemption.create({ schoolId: req.schoolId, studentId: student._id, item, points, byTeacherId: req.membership._id, byName: who });
    await audit(req.schoolId, "merch.redeemed", req, { studentId: String(student._id), meta: { item, points } });
    const balance = (await merchBalances(req.schoolId, [student._id]))[String(student._id)] || 0;
    res.json({ ok: true, balance });
  } catch (err) { next(err); }
});

// Public one-tap "I've talked to them" from the homeroom check-in email. The
// confirm page reads /info to show the student, then POSTs /log to record it.
router.get("/hr-followup/info", async (req, res, next) => {
  try {
    const schoolId = String(req.query.school || "").trim();
    const studentId = String(req.query.student || "").trim();
    const token = String(req.query.token || "").trim();
    const valid = !!schoolId && !!studentId && verifyHrFollowupToken(schoolId, studentId, token);
    let studentName = "", schoolName = "";
    if (valid) {
      try {
        const s = await BehaviorStudent.findOne({ _id: studentId, schoolId }).select("firstName preferredName lastName").lean();
        studentName = s ? `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() : "";
        const sc = await BehaviorSchool.findById(schoolId).select("name").lean();
        schoolName = sc?.name || "";
      } catch { /* ignore */ }
    }
    res.json({ ok: true, valid, studentName, schoolName });
  } catch (err) { next(err); }
});

router.post("/hr-followup/log", async (req, res, next) => {
  try {
    const schoolId = String(req.body?.school || "").trim();
    const studentId = String(req.body?.student || "").trim();
    const token = String(req.body?.token || "").trim();
    const byName = String(req.body?.by || "").trim().slice(0, 80);
    if (!schoolId || !studentId || !verifyHrFollowupToken(schoolId, studentId, token)) {
      return res.status(403).json({ ok: false, error: "This link is invalid or has expired. Please tap the blue button in the app instead." });
    }
    const student = await BehaviorStudent.findOne({ _id: studentId, schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found." });
    const inc = await logHomeroomFollowup({ schoolId, student, teacherId: null, byName });
    await audit(schoolId, "homeroom_followup.log_via_link", { userId: null, user: { email: "" } }, { studentId, incidentId: String(inc._id) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Public one-tap consequence action from the VP's email: confirm a white slip was
// issued, or mark a consequence done — without logging in. Confirm page reads
// /info then POSTs /log. action ∈ { "issue", "complete" }.
router.get("/consequence-action/info", async (req, res, next) => {
  try {
    const schoolId = String(req.query.school || "").trim();
    const id = String(req.query.id || "").trim();
    const action = String(req.query.action || "").trim();
    const token = String(req.query.token || "").trim();
    const valid = !!schoolId && !!id && ["issue", "complete"].includes(action) && verifyConsequenceActionToken(schoolId, id, action, token);
    let studentName = "", type = "", schoolName = "", status = "", completed = false;
    if (valid) {
      try {
        const c = await BehaviorConsequence.findOne({ _id: id, schoolId }).lean();
        if (c) {
          type = c.type || ""; status = c.status || ""; completed = !!c.completed;
          const s = await BehaviorStudent.findOne({ _id: c.studentId, schoolId }).select("firstName preferredName lastName").lean();
          studentName = s ? `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() : "";
        }
        const sc = await BehaviorSchool.findById(schoolId).select("name").lean();
        schoolName = sc?.name || "";
      } catch { /* ignore */ }
    }
    res.json({ ok: true, valid, action, studentName, type, schoolName, status, completed });
  } catch (err) { next(err); }
});

router.post("/consequence-action/log", async (req, res, next) => {
  try {
    const schoolId = String(req.body?.school || "").trim();
    const id = String(req.body?.id || "").trim();
    const action = String(req.body?.action || "").trim();
    const token = String(req.body?.token || "").trim();
    const byName = String(req.body?.by || "").trim().slice(0, 80);
    if (!schoolId || !id || !["issue", "complete"].includes(action) || !verifyConsequenceActionToken(schoolId, id, action, token)) {
      return res.status(403).json({ ok: false, error: "This link is invalid or has expired. Please action it in the app instead." });
    }
    const c = await BehaviorConsequence.findOne({ _id: id, schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "That item was not found." });
    if (action === "issue") {
      if (c.status === "recommended") {
        c.status = "issued"; c.issuedByName = byName || "Confirmed via email"; c.issuedAt = new Date();
        await c.save();
        await audit(schoolId, "consequence.issued_via_link", { userId: null, user: { email: "" } }, { studentId: String(c.studentId), meta: { type: c.type } });
      }
    } else {
      if (!c.completed) {
        c.completed = true; c.completedByName = byName || "Confirmed via email"; c.completedAt = new Date();
        await c.save();
        await audit(schoolId, "consequence.completed_via_link", { userId: null, user: { email: "" } }, { studentId: String(c.studentId), meta: { type: c.type } });
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Document a consequence actually applied to a student (work detention, white
// slip, call home, …). Separate from the consequence wording auto-included in a
// notice. White-slip rule: when tied to an incident, that incident must be a
// "behaviour"-category offence.
router.post("/students/:id/consequence", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const type = String(req.body?.type || "").trim();
    if (!type) return res.status(400).json({ ok: false, error: "Pick or enter a consequence." });
    const detail = String(req.body?.detail || "").trim();
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const at = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();

    let relatedIncidentId = null;
    if (req.body?.relatedIncidentId) {
      const inc = await BehaviorIncident.findOne({ _id: req.body.relatedIncidentId, studentId: student._id }).select("behaviorSnapshot.categories").lean();
      if (inc) {
        relatedIncidentId = inc._id;
        // White-slip rule: only valid against a "behaviour"-category offence.
        if (/white\s*slip/i.test(type) && !(inc.behaviorSnapshot?.categories || []).includes("behaviour")) {
          return res.status(400).json({ ok: false, error: "A white slip can only be applied to a 'Behaviour'-type offence." });
        }
      }
    }

    const c = await BehaviorConsequence.create({
      schoolId: req.schoolId, studentId: student._id,
      type, detail, relatedIncidentId,
      byTeacherId: req.membership._id, byName: req.membership.name || req.user?.name || "",
      at,
    });
    await audit(req.schoolId, "consequence.log", req, { studentId: String(student._id), meta: { type } });
    res.json({ ok: true, consequence: c.toObject() });
  } catch (err) {
    next(err);
  }
});

router.delete("/consequences/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const isAdmin = ["originator", "admin"].includes(req.membership.role);
    if (!isAdmin && String(c.byTeacherId) !== String(req.membership._id)) {
      return res.status(403).json({ ok: false, error: "Only the staff member who logged it (or an admin) can remove it." });
    }
    await BehaviorConsequence.deleteOne({ _id: c._id });
    await audit(req.schoolId, "consequence.delete", req, { studentId: String(c.studentId), meta: { type: c.type } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Confirm a recommended white slip was actually issued. ANY staff member who can
// log may click "issued? Yes"; the first click registers it (records who/when)
// and later clicks are a harmless no-op — it doesn't matter who confirms.
router.post("/consequences/:id/issue", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const other = String(req.body?.other || "").trim();
    const who = req.membership.name || req.user?.name || "";
    if (c.status === "recommended") {
      if (other) {
        // A DIFFERENT consequence was applied instead of the recommended white
        // slip: close the recommendation as "other" and log the actual one.
        c.status = "other";
        c.issuedByTeacherId = req.membership._id;
        c.issuedByName = who;
        c.issuedAt = new Date();
        await c.save();
        await BehaviorConsequence.create({
          schoolId: req.schoolId, studentId: c.studentId,
          type: other, detail: "Given instead of the recommended white slip",
          byTeacherId: req.membership._id, byName: who,
          relatedIncidentId: c.relatedIncidentId || null, status: "issued",
          issuedByTeacherId: req.membership._id, issuedByName: who, issuedAt: new Date(),
        });
        await audit(req.schoolId, "consequence.other", req, { studentId: String(c.studentId), meta: { instead: other } });
      } else {
        c.status = "issued";
        c.issuedByTeacherId = req.membership._id;
        c.issuedByName = who;
        c.issuedAt = new Date();
        await c.save();
        await audit(req.schoolId, "consequence.issued", req, { studentId: String(c.studentId), meta: { type: c.type } });
      }
    }
    res.json({ ok: true, consequence: c.toObject() });
  } catch (err) {
    next(err);
  }
});

// A human day phrase for a date, school-local: "today" / "yesterday" / "on Oct 1".
function relativeSchoolDay(d) {
  const dt = new Date(d);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(dt)) / DAY_MS);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `on ${dt.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ })}`;
}

// Compose a student + parent directed message for a recorded consequence — explains
// what happened and the action taken, ready to paste into Edsby. AI-polished with a
// deterministic fallback; retains the school's Christian, firm-but-warm tone.
router.post("/consequences/:id/message", authAny, loadMembership, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const student = await BehaviorStudent.findOne({ _id: c.studentId, schoolId: req.schoolId }).lean();
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const studentName = student ? `${student.preferredName || student.firstName} ${student.lastName || ""}`.trim() : "the student";
    const teacherName = (req.membership?.courtesyName || "").trim() || actorName(req);
    let incident = null;
    if (c.relatedIncidentId) incident = await BehaviorIncident.findOne({ _id: c.relatedIncidentId, schoolId: req.schoolId }).select("behaviorSnapshot detailText timestamp").lean();
    const behaviourName = incident?.behaviorSnapshot?.name || c.detail || c.type;
    const incidentDetail = incident?.detailText || "";

    const message = await composeConsequenceMessageAI({
      schoolId: req.schoolId, studentId: c.studentId,
      studentName, behaviorName: behaviourName, detailText: incidentDetail,
      consequenceText: `${c.type}${c.detail ? ` — ${c.detail}` : ""}`,
      when: incident?.timestamp || c.at, followUpType: incident ? "next_school_day" : "none",
      teacherName, schoolName: config?.branding?.schoolName || "", config,
    });
    res.json({ ok: true, message, html: noteToHtml(message) });
  } catch (err) { next(err); }
});

// Mark a consequence as completed (or not). Any teacher can confirm follow-
// through; the threshold notice then shows the consequence as already done.
router.post("/consequences/:id/discussed", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const student = await BehaviorStudent.findOne({ _id: c.studentId, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const who = actorName(req);
    const inc = await logDiscussedWithStudent({ schoolId: req.schoolId, student, teacherId: req.membership._id, byName: who, insteadOf: c.type });
    c.completed = true; c.resolution = "discussed";
    c.completedByTeacherId = req.membership._id; c.completedByName = who; c.completedAt = new Date();
    await c.save();
    await audit(req.schoolId, "consequence.discussed", req, { studentId: String(c.studentId), incidentId: String(inc._id), meta: { type: c.type } });
    res.json({ ok: true, consequence: c.toObject() });
  } catch (err) {
    next(err);
  }
});

router.post("/consequences/:id/complete", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const done = req.body?.completed === false ? false : true;
    const who = req.membership.name || req.user?.name || "";
    c.completed = done;
    c.resolution = done ? "completed" : "";
    c.completedByTeacherId = done ? req.membership._id : null;
    c.completedByName = done ? who : "";
    c.completedAt = done ? new Date() : null;
    await c.save();
    await audit(req.schoolId, "consequence.completed", req, { studentId: String(c.studentId), meta: { type: c.type, completed: done } });
    res.json({ ok: true, consequence: c.toObject() });
  } catch (err) {
    next(err);
  }
});

// Stage 1: mark that the family has been notified (the message was posted to
// Edsby / sent). Distinct from "completed" (the student carried the consequence
// out). The Copy-message action sets this, and it can be toggled manually.
router.post("/consequences/:id/notified", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const c = await BehaviorConsequence.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!c) return res.status(404).json({ ok: false, error: "Not found" });
    const sent = req.body?.sent === false ? false : true;
    c.notifiedAt = sent ? new Date() : null;
    c.notifiedByName = sent ? actorName(req) : "";
    await c.save();
    await audit(req.schoolId, "consequence.notified", req, { studentId: String(c.studentId), meta: { type: c.type, sent } });
    res.json({ ok: true, consequence: c.toObject() });
  } catch (err) {
    next(err);
  }
});

// White-slip recommendation: compose a parent-facing note recommending a white
// slip (with the behaviour-category reasons), return it for the clipboard, AND
// email a copy to the teacher (CC the VP). Records the recommendation as a
// consequence. Never auto-sends to a parent — the teacher posts it themselves.
router.post("/students/:id/white-slip", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    const cutoff = Date.now() - fadeDays * DAY_MS;

    const incs = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: -1 }).limit(200).lean();
    const reasons = incs.filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      return mode === "THRESHOLD" && !inc.countedInNoticeId &&
        new Date(inc.timestamp).getTime() > resetAt && new Date(inc.timestamp).getTime() > cutoff &&
        (inc.behaviorSnapshot?.categories || []).includes("behaviour");
    }).slice(0, 8);
    if (!reasons.length) return res.status(400).json({ ok: false, error: "No active behaviour-category offences to base a white slip on." });

    const studentName = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
    const first = student.preferredName || student.firstName || studentName;
    const teacherName = req.membership?.name || req.user?.name || "Teacher";
    const schoolName = config?.branding?.schoolName || "";
    const parentNames = (student.parents || []).map((p) => (p.name || "").trim()).filter(Boolean);
    const greeting = parentNames.length === 1 ? `Dear ${parentNames[0]},`
      : parentNames.length >= 2 ? `Dear ${parentNames[0]} and ${parentNames[1]},`
      : "Dear Parent/Guardian,";
    const reasonLines = reasons.map((i) => `  • ${new Date(i.timestamp).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })}: ${i.behaviorSnapshot?.name}${i.detailText ? ` — ${i.detailText}` : ""}`).join("\n");
    const note =
      `${greeting}\n\n` +
      `I'm writing to let you know that a white slip is being recommended for ${first} in light of the following behavioural matters:\n\n${reasonLines}\n\n` +
      `A white slip is a formal record of a behavioural concern at school. We're asking for your partnership in addressing this with ${first} at home, as a conversation or support there often makes a real difference. Please don't hesitate to reach out if you'd like to discuss it.\n\n` +
      `Sincerely,\n${teacherName}${schoolName ? `\nTeacher, ${schoolName}` : ", Teacher"}`;

    // Record the recommendation + email the teacher (CC VP).
    await fireWhiteSlip({ req, student, config, behaviorName: `Recommended (${reasons.length} behaviour offence${reasons.length === 1 ? "" : "s"})`, detailText: "", at: new Date() });

    await audit(req.schoolId, "white_slip.recommended", req, { studentId: String(student._id) });
    const vpEmail = (config?.vp?.email || "").trim();
    res.json({ ok: true, note, emailedTo: req.user?.email || "", ccVp: !!vpEmail });
  } catch (err) {
    next(err);
  }
});

// ── Intervention view (admin/VP read-only, school-wide) ──────────────────────
// Who needs attention right now: students at/near the strike threshold, the
// most-logged students, and a per-class breakdown. Read-only, admin only.
// School-wide admin insights: who needs attention, behaviour trends, teachers
// who may welcome support, and students to get ahead of. Shared by the
// intervention view + the weekly admin digest. All signals are objective counts
// presented supportively — never a judgement.
async function buildSchoolInsights(schoolId, config) {
  const triggerCount = config?.triggerCount ?? 3;
  const fadeDays = config?.fadeWindowDays ?? 30;
  const now = Date.now();
  const fadeCutoff = now - fadeDays * DAY_MS;
  const d180 = new Date(now - 180 * DAY_MS);
  const d60 = now - 60 * DAY_MS; // rolling window for most-logged / by-class /
  // staff-support stats: tighter than 90d so a new term's counts aren't inflated
  // by last term's logs (the summer gap separates the terms cleanly)
  const d14 = now - 14 * DAY_MS;
  const d28 = now - 28 * DAY_MS;

  const students = await BehaviorStudent.find({ schoolId, active: true })
    .select("firstName preferredName lastName grade classGroup noticesHomeCount").lean();
  // Count notices THIS PERIOD only (prior-year notices stay in history).
  const noticesPeriodMap = await periodNoticesByStudent(schoolId, students.map((s) => s._id), config);
  for (const s of students) s.noticesHomeCount = noticesPeriodMap[String(s._id)] || 0;
  const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
  const nameOf = (s) => (s ? `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() : "—");

  // One pull of recent incidents; everything below is computed in memory.
  const incs = await BehaviorIncident.find({ schoolId, timestamp: { $gt: d180 } })
    .select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode behaviorSnapshot.uniform studentId teacherId timestamp countedInNoticeId").lean();
  const isPos = (i) => i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
  const isInteraction = (i) => !isPos(i) && i.behaviorSnapshot?.triggerMode === "INTERACTION";
  const isOffence = (i) => !isPos(i) && !isInteraction(i);

  // Monthly trend (last 6 months): offences vs positives.
  const trendMap = {};
  for (const i of incs) {
    const k = new Date(i.timestamp).toISOString().slice(0, 7);
    (trendMap[k] ||= { neg: 0, pos: 0 });
    if (isPos(i)) trendMap[k].pos += 1; else if (isOffence(i)) trendMap[k].neg += 1;
  }
  const trends = Object.keys(trendMap).sort().slice(-6).map((m) => ({ month: m, ...trendMap[m] }));

  // Current strike load → at/near the threshold.
  const strikes = {}; const lastStrike = {};
  for (const i of incs) {
    if (i.whiteSlip || i.countedInNoticeId || i.behaviorSnapshot?.triggerMode !== "THRESHOLD" || new Date(i.timestamp).getTime() <= fadeCutoff) continue;
    const sid = String(i.studentId);
    strikes[sid] = (strikes[sid] || 0) + 1;
    const t = new Date(i.timestamp).getTime();
    if (!lastStrike[sid] || t > lastStrike[sid]) lastStrike[sid] = t;
  }
  const atThreshold = Object.keys(strikes).filter((sid) => strikes[sid] >= triggerCount - 1 && sById[sid])
    .map((sid) => ({ studentId: sid, name: nameOf(sById[sid]), classGroup: sById[sid].classGroup || "—", grade: sById[sid].grade || "—", strikes: strikes[sid], triggerCount, lastAt: new Date(lastStrike[sid]) }))
    .sort((a, b) => b.strikes - a.strikes || b.lastAt - a.lastAt);

  // Most-logged (60d) + per-class counts (60d).
  const count90 = {}; const last90 = {}; const classCounts = {};
  for (const i of incs) {
    if (new Date(i.timestamp).getTime() <= d60) continue;
    const sid = String(i.studentId);
    count90[sid] = (count90[sid] || 0) + 1;
    const t = new Date(i.timestamp).getTime();
    if (!last90[sid] || t > last90[sid]) last90[sid] = t;
    const cls = sById[sid]?.classGroup || "—";
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  const topRepeat = Object.keys(count90).filter((sid) => sById[sid])
    .map((sid) => ({ studentId: sid, name: nameOf(sById[sid]), classGroup: sById[sid].classGroup || "—", count: count90[sid], lastAt: new Date(last90[sid]) }))
    .sort((a, b) => b.count - a.count).slice(0, 15);
  const byClass = Object.entries(classCounts).map(([classGroup, count]) => ({ classGroup, count }))
    .sort((a, b) => b.count - a.count || a.classGroup.localeCompare(b.classGroup));

  // Teachers who may welcome support: high offence volume + low positive share
  // (60d). Objective counts, framed supportively — not a performance verdict.
  const tStats = {};
  for (const i of incs) {
    if (new Date(i.timestamp).getTime() <= d60) continue;
    const t = String(i.teacherId);
    (tStats[t] ||= { neg: 0, pos: 0, students: new Set() });
    tStats[t].students.add(String(i.studentId));
    if (isPos(i)) tStats[t].pos += 1; else if (isOffence(i)) tStats[t].neg += 1;
  }
  const tDocs = await BehaviorTeacher.find({ _id: { $in: Object.keys(tStats) } }).select("name").lean();
  const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
  let teachers = Object.entries(tStats).map(([t, v]) => ({
    teacherId: t, name: tName[t] || "teacher", negatives: v.neg, positives: v.pos, students: v.students.size,
    posRatio: v.neg + v.pos ? Math.round((v.pos / (v.neg + v.pos)) * 100) : null,
  })).sort((a, b) => b.negatives - a.negatives);
  const avgNeg = teachers.length ? teachers.reduce((s, t) => s + t.negatives, 0) / teachers.length : 0;
  for (const t of teachers) t.flag = t.negatives >= Math.max(8, avgNeg * 1.5) && (t.posRatio == null || t.posRatio < 25);

  // Students to get ahead of: offences rising in the last 14 days vs the prior
  // 14, where it's not yet at the formal threshold — a chance to act early.
  const recent = {}; const prior = {};
  for (const i of incs) {
    if (!isOffence(i)) continue;
    const t = new Date(i.timestamp).getTime();
    const sid = String(i.studentId);
    if (t > d14) recent[sid] = (recent[sid] || 0) + 1;
    else if (t > d28) prior[sid] = (prior[sid] || 0) + 1;
  }
  const proactive = Object.keys(recent)
    .filter((sid) => sById[sid] && recent[sid] >= 2 && recent[sid] >= (prior[sid] || 0))
    .map((sid) => ({ studentId: sid, name: nameOf(sById[sid]), classGroup: sById[sid].classGroup || "—", recent: recent[sid], prior: prior[sid] || 0, notices: sById[sid].noticesHomeCount || 0 }))
    .sort((a, b) => b.recent - a.recent || b.notices - a.notices).slice(0, 15);

  // App usage this week (are staff actually using it?) — page loads per member.
  const wk = mondayKey();
  const members = await BehaviorTeacher.find({ schoolId, status: { $ne: "pending" } }).select("name email role usage").lean();
  const usage = members
    .map((m) => ({
      name: m.name || m.email || "teacher",
      role: m.role,
      loads: m.usage?.weekKey === wk ? (m.usage.loads || 0) : 0,
      lastSeenAt: m.usage?.lastSeenAt || null,
    }))
    .sort((a, b) => b.loads - a.loads || new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
  const activeThisWeek = usage.filter((u) => u.loads > 0).length;

  // GUDD — students who've lost (or are at risk of losing) their Good Uniform
  // Dress Down: uniform infractions within the GUDD fade window, with the next
  // escalation consequence for those past the threshold.
  let gudd = { enabled: false, students: [] };
  const gcfg = config?.gudd || {};
  if (gcfg.enabled !== false) {
    const gThreshold = gcfg.threshold ?? 3;
    const gCutoff = Math.max(now - (gcfg.fadeWindowDays ?? 30) * DAY_MS, gcfg.resetAt ? new Date(gcfg.resetAt).getTime() : 0);
    const gEsc = (Array.isArray(gcfg.escalations) ? gcfg.escalations : []).map((s) => String(s || "").trim()).filter(Boolean);
    const gCount = {}; const gLast = {};
    for (const i of incs) {
      if (!i.behaviorSnapshot?.uniform || new Date(i.timestamp).getTime() <= gCutoff) continue;
      const sid = String(i.studentId);
      gCount[sid] = (gCount[sid] || 0) + 1;
      const t = new Date(i.timestamp).getTime();
      if (!gLast[sid] || t > gLast[sid]) gLast[sid] = t;
    }
    const gStudents = Object.keys(gCount).filter((sid) => sById[sid])
      .map((sid) => {
        const count = gCount[sid];
        const lost = count >= gThreshold;
        const overBy = Math.max(0, count - gThreshold);
        const lastEsc = gEsc.length ? gEsc[gEsc.length - 1] : "";
        const consequence = overBy > 0 ? (gEsc[overBy - 1] || lastEsc) : "";
        return { studentId: sid, name: nameOf(sById[sid]), classGroup: sById[sid].classGroup || "—", grade: sById[sid].grade || "—", count, threshold: gThreshold, lost, atRisk: count > 0 && !lost, consequence, lastAt: new Date(gLast[sid]) };
      })
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    gudd = { enabled: true, name: gcfg.name || "GUDD", threshold: gThreshold, students: gStudents };
  }

  // Not responding to discipline: ≥2 notices home yet still carrying ≥2 active
  // strikes — repeated contact home hasn't shifted the pattern, so it may need a
  // different approach (meeting, plan, VP involvement).
  const notResponding = Object.keys(strikes)
    .filter((sid) => sById[sid] && (sById[sid].noticesHomeCount || 0) >= 2 && strikes[sid] >= 2)
    .map((sid) => ({ studentId: sid, name: nameOf(sById[sid]), classGroup: sById[sid].classGroup || "—", grade: sById[sid].grade || "—", notices: sById[sid].noticesHomeCount || 0, strikes: strikes[sid], lastAt: new Date(lastStrike[sid]) }))
    .sort((a, b) => b.notices - a.notices || b.strikes - a.strikes).slice(0, 15);

  return { triggerCount, fadeDays, atThreshold, topRepeat, byClass, trends, teachers, proactive, usage, activeThisWeek, gudd, notResponding };
}

router.get("/intervention", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const insights = await buildSchoolInsights(req.schoolId, config);
    res.json({ ok: true, ...insights });
  } catch (err) {
    next(err);
  }
});

// ── GUDD disqualification report + period reset (admins) ─────────────────────

// On-demand list of who has lost the GUDD this period (and who's at risk).
router.get("/gudd/report", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const g = config?.gudd || {};
    if (g.enabled === false) return res.json({ ok: true, enabled: false, lost: [], atRisk: [] });
    const threshold = g.threshold ?? 3;
    const escalations = (Array.isArray(g.escalations) ? g.escalations : []).map((s) => String(s || "").trim()).filter(Boolean);
    const lastEsc = escalations.length ? escalations[escalations.length - 1] : "";
    const resetAt = g.resetAt ? new Date(g.resetAt).getTime() : 0;
    const cutoff = new Date(Math.max(Date.now() - (g.fadeWindowDays ?? 30) * DAY_MS, resetAt));

    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true })
      .select("firstName preferredName lastName classGroup grade").lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    const agg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, studentId: { $in: students.map((s) => s._id) }, "behaviorSnapshot.uniform": true, timestamp: { $gt: cutoff } } },
      { $group: { _id: "$studentId", n: { $sum: 1 }, last: { $max: "$timestamp" } } },
    ]);
    const rows = agg
      .filter((a) => sById[String(a._id)])
      .map((a) => {
        const s = sById[String(a._id)];
        const overBy = Math.max(0, a.n - threshold);
        return {
          studentId: String(a._id),
          name: `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim(),
          classGroup: s.classGroup || "", grade: s.grade || "",
          count: a.n, threshold, lost: a.n >= threshold,
          consequence: overBy > 0 ? (escalations[overBy - 1] || lastEsc) : "",
          lastAt: a.last,
        };
      })
      .sort((x, y) => y.count - x.count || new Date(y.lastAt) - new Date(x.lastAt) || x.name.localeCompare(y.name));

    res.json({
      ok: true, enabled: true, name: g.name || "GUDD", threshold,
      since: cutoff, resetAt: g.resetAt || null, autoResetFriday: !!g.autoResetFriday,
      lost: rows.filter((r) => r.lost), atRisk: rows.filter((r) => !r.lost),
      generatedAt: new Date(),
    });
  } catch (err) {
    next(err);
  }
});

// Clear the GUDD list — starts a fresh period. Earlier uniform infractions stay
// in history but stop counting toward the GUDD.
router.post("/gudd/reset", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const { resetAt, awarded } = await awardGuddAndReset(req.schoolId, config);
    await audit(req.schoolId, "gudd.cleared", req, { awarded });
    res.json({ ok: true, resetAt, awarded });
  } catch (err) {
    next(err);
  }
});

// Run the month-end conduct award on demand (admin) — a manual fallback, and a
// way to grant it whenever the school wants to announce it. Forces past the
// per-month idempotency guard so a deliberate click always awards.
router.post("/house/monthly-conduct-award", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const result = await awardMonthlyConduct(req.schoolId, config, { force: true });
    await audit(req.schoolId, "house.monthly_conduct_award", req, { awarded: result.awarded, monthKey: result.monthKey });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Public (signed-link) GUDD reset for the button in the admin digest — no login.
// The confirm page fetches this to show the school name + whether the link is
// still valid, then POSTs to /gudd/reset-link to actually reset.
router.get("/gudd/reset-info", async (req, res, next) => {
  try {
    const schoolId = String(req.query.school || "").trim();
    const token = String(req.query.token || "").trim();
    const valid = !!schoolId && verifyGuddResetToken(schoolId, token);
    let schoolName = "";
    if (valid) {
      try { const sc = await BehaviorSchool.findById(schoolId).select("name").lean(); schoolName = sc?.name || ""; } catch { /* ignore */ }
    }
    res.json({ ok: true, valid, schoolName, name: "GUDD" });
  } catch (err) { next(err); }
});

router.post("/gudd/reset-link", async (req, res, next) => {
  try {
    const schoolId = String(req.body?.school || "").trim();
    const token = String(req.body?.token || "").trim();
    if (!schoolId || !verifyGuddResetToken(schoolId, token)) {
      return res.status(403).json({ ok: false, error: "This reset link is invalid or has expired. Reset the list from Setup instead." });
    }
    const config = await BehaviorConfig.findOne({ schoolId }).lean();
    const { resetAt, awarded } = await awardGuddAndReset(schoolId, config);
    await audit(schoolId, "gudd.cleared_via_link", { userId: null, user: { email: "" } }, { awarded });
    res.json({ ok: true, resetAt, awarded });
  } catch (err) { next(err); }
});

// Compose the weekly admin digest email (subject/text/html) for a school.
// A short, grounded AI overview for the top of the weekly digest — makes clear
// to the VP which students are on the verge of a notice or need attention, plus
// staff to support and a positive to acknowledge. Fed ONLY the computed lists;
// fails safe to a deterministic sentence when the AI is unavailable.
async function composeDigestOverview({ config, schoolName, counts, insights }) {
  const verge = (insights.atThreshold || []).slice(0, 10).map((r) => `${r.name} (${r.strikes}/${r.triggerCount})`);
  const notResp = (insights.notResponding || []).slice(0, 10).map((r) => `${r.name} (${r.notices} notices, ${r.strikes} strikes)`);
  const rising = (insights.proactive || []).slice(0, 10).map((r) => `${r.name} (${r.recent} in 2 wks)`);
  const guddLost = insights.gudd?.enabled ? (insights.gudd.students || []).filter((s) => s.lost).map((s) => s.name) : [];
  const flagged = (insights.teachers || []).filter((t) => t.flag).map((t) => t.name);

  const det = (() => {
    const bits = [`This week: ${counts.neg} incident(s), ${counts.pos} encouragement(s), ${counts.notices} notice(s) home.`];
    if (notResp.length) bits.push(`Needs attention: ${notResp.join(", ")}.`);
    if (verge.length) bits.push(`On the verge of a notice: ${verge.join(", ")}.`);
    if (rising.length) bits.push(`Rising lately: ${rising.join(", ")}.`);
    if (guddLost.length) bits.push(`Lost the ${insights.gudd?.name || "GUDD"}: ${guddLost.join(", ")}.`);
    if (flagged.length) bits.push(`Staff who may welcome support: ${flagged.join(", ")}.`);
    if (verge.length + notResp.length + rising.length === 0) bits.push("No students stand out as needing attention right now.");
    return bits.join(" ");
  })();

  const aiClient = makeDefaultAiClient(config || {});
  if (!aiClient) return det;
  const prompt = [
    `You are writing a short overview paragraph at the top of a weekly behaviour briefing for a school Vice-Principal about ${schoolName || "the school"}.`,
    `Write 3–5 plain sentences. It must make CLEAR which students are on the verge of a notice home or otherwise need attention (name them), note any staff who may welcome support, and acknowledge one positive if there is one. Warm, factual, and concise — no bullet points, no heading.`,
    `Use ONLY the data below. Do NOT invent students, numbers, or events. If a list is empty, don't mention it. Do not output placeholders.`,
    ``,
    `This week (last 7 days): ${counts.neg} incidents, ${counts.pos} encouragements, ${counts.whiteSlips} white slips, ${counts.notices} notices sent home.`,
    `Already had notices home yet still accumulating strikes (needs attention): ${notResp.join("; ") || "none"}.`,
    `At or near the ${insights.triggerCount}-strike notice threshold (on the verge): ${verge.join("; ") || "none"}.`,
    `Rising in the last two weeks (get ahead of): ${rising.join("; ") || "none"}.`,
    guddLost.length ? `Lost the ${insights.gudd?.name || "GUDD"}: ${guddLost.join(", ")}.` : "",
    `Staff logging many incidents with few encouragements (may welcome support): ${flagged.join(", ") || "none"}.`,
  ].filter(Boolean).join("\n");
  try {
    const text = await Promise.race([
      aiClient.complete(prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error("AI timeout")), 15000)),
    ]);
    const trimmed = String(text || "").trim();
    return trimmed || det;
  } catch (e) {
    console.warn("[behavior] digest overview AI failed, using template:", e?.message || e);
    return det;
  }
}

async function composeAdminDigest(schoolId, config) {
  const insights = await buildSchoolInsights(schoolId, config);
  const school = await BehaviorSchool.findById(schoolId).select("name").lean();
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const wk = await BehaviorIncident.find({ schoolId, timestamp: { $gt: since7 } })
    .select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode").lean();
  let wkPos = 0, wkNeg = 0, wkInt = 0;
  for (const i of wk) {
    const pos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
    const intr = !pos && i.behaviorSnapshot?.triggerMode === "INTERACTION";
    if (pos) wkPos += 1; else if (intr) wkInt += 1; else wkNeg += 1;
  }
  const wkNotices = await BehaviorNotice.countDocuments({ schoolId, sentAt: { $gt: since7 }, status: "sent" });

  // Consequences issued (white slips, detentions, calls home, …) in the last 7
  // days. These aren't incident-threshold events, so they'd otherwise never show
  // in this digest — an admin should still see them.
  const consRows = await BehaviorConsequence.find({ schoolId, at: { $gt: since7 }, kind: { $ne: "encouraging" } })
    .select("type detail byName studentId at").sort({ at: -1 }).lean();
  const consStudents = consRows.length
    ? await BehaviorStudent.find({ _id: { $in: consRows.map((c) => c.studentId) } })
        .select("firstName preferredName lastName classGroup").lean()
    : [];
  const cName = Object.fromEntries(consStudents.map((s) =>
    [String(s._id), `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() + (s.classGroup ? ` (${s.classGroup})` : "")]));
  const wkWhiteSlips = consRows.filter((c) => /white slip/i.test(c.type || "")).length;

  // Positive recognitions logged in the last 7 days — celebrate the good, by name.
  const posIncs = await BehaviorIncident.find({
    schoolId, timestamp: { $gt: since7 },
    $or: [{ "behaviorSnapshot.kind": "positive" }, { "behaviorSnapshot.points": { $gt: 0 } }],
  }).select("behaviorSnapshot.name studentId teacherId timestamp").sort({ timestamp: -1 }).lean();
  const posStudents = posIncs.length
    ? await BehaviorStudent.find({ _id: { $in: posIncs.map((i) => i.studentId) } }).select("firstName preferredName lastName classGroup").lean()
    : [];
  const pName = Object.fromEntries(posStudents.map((s) =>
    [String(s._id), `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() + (s.classGroup ? ` (${s.classGroup})` : "")]));
  const posTeachers = posIncs.length
    ? await BehaviorTeacher.find({ _id: { $in: [...new Set(posIncs.map((i) => String(i.teacherId)))] } }).select("name").lean()
    : [];
  const ptName = Object.fromEntries(posTeachers.map((t) => [String(t._id), t.name]));

  // Encouraging parent messages are logged as "encouraging" consequences — they
  // belong in the Encouragements list, not under Consequences.
  const encRows = await BehaviorConsequence.find({ schoolId, at: { $gt: since7 }, kind: "encouraging" })
    .select("type byName studentId at").sort({ at: -1 }).lean();
  const encStudents = encRows.length
    ? await BehaviorStudent.find({ _id: { $in: encRows.map((c) => c.studentId) } }).select("firstName preferredName lastName classGroup").lean()
    : [];
  const eName = Object.fromEntries(encStudents.map((s) =>
    [String(s._id), `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() + (s.classGroup ? ` (${s.classGroup})` : "")]));
  // Combined encouragements: positive behaviours + encouraging parent messages.
  const encItems = [
    ...posIncs.map((i) => ({ name: pName[String(i.studentId)] || "—", label: i.behaviorSnapshot?.name || "Encouragement", by: ptName[String(i.teacherId)] || "" })),
    ...encRows.map((c) => ({ name: eName[String(c.studentId)] || "—", label: c.type || "Parent message", by: c.byName || "" })),
  ];

  const li = (s) => `<li style="margin:3px 0">${s}</li>`;
  const section = (title, inner) => `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a">${title}</h3>${inner}`;
  const flagged = insights.teachers.filter((t) => t.flag);
  const suggestions = flagged.length
    ? `<ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6">` +
        flagged.map((t) => li(`<strong>${escapeHtml(t.name)}</strong> logged ${t.negatives} incident(s) and only ${t.positives} encouragement(s) in the last 60 days — a supportive check-in or co-planning may help, and encourage logging the good too.`)).join("") +
      `</ul>`
    : `<p style="margin:0;color:#64748b">No staff stand out as needing support this week. 👍</p>`;

  const top = (arr, fmt) => arr.length ? `<ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6">${arr.slice(0, 6).map((x) => li(fmt(x))).join("")}</ul>` : `<p style="margin:0;color:#64748b">None.</p>`;

  // GUDD (uniform standing) section + a "Reset the list" button that resets
  // without logging in (signed link → confirm page). Only when GUDD is on.
  const gName = insights.gudd?.name || "GUDD";
  const gStuds = insights.gudd?.enabled ? (insights.gudd.students || []) : [];
  const gLost = gStuds.filter((s) => s.lost);
  const gRisk = gStuds.filter((s) => s.atRisk);
  const gList = (arr) => `<ul style="margin:0 0 4px;padding-left:18px;color:#334155;line-height:1.6">${arr.map((s) => li(`<strong>${escapeHtml(s.name)}</strong> <span style="color:#94a3b8">${escapeHtml(s.classGroup)}</span> — ${s.count}/${s.threshold}${s.consequence ? ` · next: ${escapeHtml(s.consequence)}` : ""}`)).join("")}</ul>`;
  const gResetToken = guddResetToken(String(schoolId));
  const gResetUrl = `${appBase()}/behavior/gudd-reset?school=${schoolId}&token=${encodeURIComponent(gResetToken)}`;
  const guddSection = !insights.gudd?.enabled ? "" : section(`${escapeHtml(gName)} — uniform standing`,
    gStuds.length
      ? (gLost.length ? `<p style="margin:6px 0 2px;font-size:13px;font-weight:600;color:#b91c1c">Lost the ${escapeHtml(gName)}</p>${gList(gLost)}` : "") +
        (gRisk.length ? `<p style="margin:8px 0 2px;font-size:13px;font-weight:600;color:#b45309">At risk</p>${gList(gRisk)}` : "") +
        (gResetToken ? emailButton(`Reset the ${gName} list`, gResetUrl, "#0f172a") +
          `<p style="margin:2px 0 0;font-size:12px;color:#94a3b8">Starts a fresh period — earlier infractions stay in history but stop counting.</p>` : "")
      : `<p style="margin:0;color:#64748b">No uniform infractions this period. 👍</p>`);

  // AI overview paragraph (grounded in the lists above) — leads the briefing so
  // it's immediately clear who's on the verge / needs attention.
  const overview = await composeDigestOverview({
    config, schoolName: school?.name,
    counts: { neg: wkNeg, pos: wkPos, whiteSlips: wkWhiteSlips, notices: wkNotices },
    insights,
  });
  const overviewHtml = `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px">` +
    `<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin:0 0 6px">This week at a glance</div>` +
    noteToHtml(overview) + `</div>`;

  const contentHtml =
    `<p style="margin:0 0 4px;color:#334155">Week in review for <strong>${escapeHtml(school?.name || "your school")}</strong>.</p>` +
    `<p style="margin:0 0 12px;color:#64748b;font-size:13px">${wkNeg} incident(s) · ${wkPos} encouragement(s) · ${wkInt} documented interaction(s) · ${wkWhiteSlips} white slip(s) · ${wkNotices} notice(s) sent home (last 7 days).</p>` +
    overviewHtml +
    section("At or near a notice", top(insights.atThreshold, (r) => `${escapeHtml(r.name)} <span style="color:#94a3b8">${escapeHtml(r.classGroup)}</span> — ${r.strikes}/${r.triggerCount} strikes`)) +
    section("Consequences issued / recommended (last 7 days)",
      consRows.length
        ? `<ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6">${consRows.slice(0, 15).map((c) => li(`<strong>${escapeHtml(cName[String(c.studentId)] || "—")}</strong> — ${escapeHtml(c.type || "consequence")}${c.detail ? `: ${escapeHtml(c.detail)}` : ""} <span style="color:#94a3b8">· ${escapeHtml(c.byName || "")}</span>`)).join("")}</ul>`
        : `<p style="margin:0;color:#64748b">None.</p>`) +
    section("Encouragements (last 7 days)",
      encItems.length
        ? `<ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6">${encItems.slice(0, 15).map((e) => li(`<strong>${escapeHtml(e.name)}</strong> — ${escapeHtml(e.label)}${e.by ? ` <span style="color:#94a3b8">· ${escapeHtml(e.by)}</span>` : ""}`)).join("")}</ul>`
        : `<p style="margin:0;color:#64748b">None logged — encourage staff to catch the good too.</p>`) +
    section("Students to get ahead of (rising lately)", top(insights.proactive, (r) => `${escapeHtml(r.name)} <span style="color:#94a3b8">${escapeHtml(r.classGroup)}</span> — ${r.recent} in 2 weeks${r.prior ? ` (was ${r.prior})` : ""}`)) +
    guddSection +
    section("Most-logged (60 days)", top(insights.topRepeat, (r) => `${escapeHtml(r.name)} <span style="color:#94a3b8">${escapeHtml(r.classGroup)}</span> — ${r.count}`)) +
    section("Suggested support for staff", suggestions) +
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">` +
    `<p style="margin:0;font-size:13px;color:#64748b">Open the dashboard → <strong>School insights</strong> for trends, the full staff view, and to act on any of the above.</p>` +
    `<p style="margin:12px 0 0;font-size:12px;color:#94a3b8"><strong>P.S.</strong> Compass is fully aligned with the most recent BCS Staff Handbook — white-slip offences, minor-infraction handling, and the GUDD dress-down policy all follow it.</p>`;

  const text =
    `Week in review for ${school?.name || "your school"}.\n` +
    `${wkNeg} incidents · ${wkPos} encouragements · ${wkInt} interactions · ${wkWhiteSlips} white slips · ${wkNotices} notices sent (last 7 days).\n\n` +
    `${overview}\n\n` +
    `At/near a notice: ${insights.atThreshold.slice(0, 6).map((r) => `${r.name} (${r.strikes}/${r.triggerCount})`).join(", ") || "none"}.\n` +
    `Consequences issued / recommended: ${consRows.slice(0, 8).map((c) => `${cName[String(c.studentId)] || "—"} — ${c.type}`).join("; ") || "none"}.\n` +
    `Encouragements: ${encItems.slice(0, 8).map((e) => `${e.name} — ${e.label}`).join("; ") || "none"}.\n` +
    `Rising lately: ${insights.proactive.slice(0, 6).map((r) => `${r.name} (${r.recent}/2wk)`).join(", ") || "none"}.\n` +
    (insights.gudd?.enabled ? `${gName}: ${gStuds.length ? `${gLost.length} lost, ${gRisk.length} at risk — reset the list from the emailed report.` : "no infractions this period."}\n` : "") +
    `Staff who may welcome support: ${flagged.map((t) => t.name).join(", ") || "none"}.\n\n` +
    `Open the dashboard → School insights for the full picture.\n\n` +
    `P.S. Compass is fully aligned with the most recent BCS Staff Handbook — white-slip offences, minor-infraction handling, and the GUDD dress-down policy all follow it.`;

  return {
    subject: `Compass weekly digest — ${school?.name || "your school"}`,
    html: emailShell({ title: "Weekly behaviour digest", schoolName: school?.name || "Compass", preheader: `${wkNeg} incidents · ${wkPos} encouragements · ${wkNotices} notices this week`, contentHtml }),
    text,
  };
}

// Send the digest to a school's configured recipient (or its admins). force=true
// ignores the once-a-week guard (used by the "send now" button).
export async function sendAdminDigestForSchool(schoolId, { force = false } = {}) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  if (!config) return { ok: false, error: "no config" };
  if (!force && !config.adminDigest?.enabled) return { ok: false, skipped: "disabled" };
  if (!force && config.adminDigest?.lastSentAt && Date.now() - new Date(config.adminDigest.lastSentAt).getTime() < 6 * DAY_MS) {
    return { ok: false, skipped: "already sent this week" };
  }
  // Recipient: configured address, else all originator/admin emails.
  let to = [];
  const explicit = (config.adminDigest?.recipientEmail || "").trim();
  if (explicit) to = [explicit];
  else {
    const admins = await BehaviorTeacher.find({ schoolId, role: { $in: ["originator", "admin"] } }).select("email").lean();
    to = [...new Set(admins.map((a) => a.email).filter(Boolean))];
  }
  // Always include the VP: the digest carries the GUDD list + its "Reset the
  // list" button, which is the VP's to action — so the VP gets it regardless of
  // who the digest recipient is set to.
  const vpEmail = (config.vp?.email || "").trim().toLowerCase();
  if (vpEmail) to = [...new Set([...to, vpEmail])];
  if (!to.length) return { ok: false, error: "no recipient" };

  const { subject, html, text } = await composeAdminDigest(schoolId, config);
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  await sendEmail({ from: fromAddr ? { name: "Compass", address: fromAddr } : undefined, to, subject, text, html });
  await BehaviorConfig.updateOne({ schoolId }, { $set: { "adminDigest.lastSentAt": new Date() } });
  return { ok: true, to };
}

// Bi-weekly teacher nudges: a proactive "students in your homeroom to check in
// with" email to homeroom teachers, and a gentle "how's it going?" note to
// teachers who've been quiet. Composite per teacher; each flagged student gets a
// one-tap "I've talked to them" button (signed link) plus what to discuss, so
// the teacher never has to dig in the app — though the same blue button is there.
// Daily VP accountability digest: consequences teachers were to carry out that
// aren't done yet, grouped by the logging teacher, flagging ones past the fade
// window as "missed" (a late consequence loses its effect). Builds follow-through
// habits; VP always, each teacher optionally. Toggle in Setup.
export async function sendConsequenceDigestForSchool(schoolId, { force = false } = {}) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  if (!config) return { ok: false, error: "no config" };
  const cd = config.consequenceDigest || {};
  if (!force && cd.enabled === false) return { ok: false, skipped: "disabled" };
  if (!force && cd.lastSentAt && Date.now() - new Date(cd.lastSentAt).getTime() < 20 * 60 * 60 * 1000) {
    return { ok: false, skipped: "already sent today" };
  }
  const fadeDays = cd.fadeDays ?? 2;
  const now = Date.now();
  const lookback = new Date(now - 10 * DAY_MS); // show recent outstanding only
  const missedCutoff = now - fadeDays * DAY_MS;

  const cons = await BehaviorConsequence.find({
    schoolId, kind: "corrective", completed: false,
    status: { $in: ["issued", "recommended", "other"] },
    type: { $not: /^Parent message/i },
    at: { $gte: lookback },
  }).select("studentId type detail byTeacherId byName at").sort({ at: 1 }).lean();
  if (!cons.length && !force) { await BehaviorConfig.updateOne({ schoolId }, { $set: { "consequenceDigest.lastSentAt": new Date() } }); return { ok: true, sent: 0, items: 0 }; }

  const sIds = [...new Set(cons.map((c) => String(c.studentId)))];
  const tIds = [...new Set(cons.map((c) => String(c.byTeacherId)).filter((x) => x && x !== "null"))];
  const [students, teachers, school] = await Promise.all([
    BehaviorStudent.find({ _id: { $in: sIds } }).select("firstName preferredName lastName classGroup").lean(),
    BehaviorTeacher.find({ _id: { $in: tIds } }).select("name courtesyName email").lean(),
    BehaviorSchool.findById(schoolId).select("name").lean(),
  ]);
  const sName = Object.fromEntries(students.map((s) => [String(s._id), `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() + (s.classGroup ? ` (${s.classGroup})` : "")]));
  const tById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  const tLabel = (t) => (t?.name || "").trim() || emailLocalName(t?.email) || "A teacher";

  // Group by teacher.
  const byTeacher = {};
  for (const c of cons) {
    const k = String(c.byTeacherId || "none");
    (byTeacher[k] ||= []).push({
      student: sName[String(c.studentId)] || "a student",
      type: c.type || "consequence", detail: c.detail || "",
      at: c.at, missed: new Date(c.at).getTime() < missedCutoff,
    });
  }
  const fmtItem = (it) => {
    const d = new Date(it.at).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ });
    return `${escapeHtml(it.student)} — ${escapeHtml(it.type)}${it.detail ? `: ${escapeHtml(it.detail)}` : ""} <span style="color:#94a3b8">(${d})</span>${it.missed ? ` <span style="color:#b91c1c;font-weight:600">· missed</span>` : ""}`;
  };
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = fromAddr ? { name: "Compass", address: fromAddr } : undefined;
  const schoolName = config.branding?.schoolName || school?.name || "";
  const followThrough = `<p style="margin:12px 0 0;font-size:12px;color:#64748b">A consequence works best when it follows the offence promptly — within a day or two. Items marked <b style="color:#b91c1c">missed</b> are past that window; they fade off the active to-do list, but please close the loop and keep the habit of timely follow-through.</p>`;

  let sent = 0, totalItems = cons.length;

  // VP (+ admins) digest — everything, grouped by teacher.
  const vpEmail = (config.vp?.email || "").trim().toLowerCase();
  const adminList = await BehaviorTeacher.find({ schoolId, role: { $in: ["originator", "admin"] } }).select("email").lean();
  const to = [...new Set([vpEmail, ...adminList.map((a) => (a.email || "").toLowerCase())].filter(Boolean))];
  if (to.length) {
    const groupsHtml = Object.entries(byTeacher).map(([tid, items]) => {
      const name = tid === "none" ? "Unassigned" : tLabel(tById[tid]);
      return `<div style="margin:0 0 12px"><div style="font-weight:700;color:#0f172a">${escapeHtml(name)} <span style="font-weight:400;color:#94a3b8;font-size:12px">(${items.length})</span></div>` +
        `<ul style="margin:4px 0 0;padding-left:18px;color:#334155;line-height:1.6">${items.map((it) => `<li>${fmtItem(it)}</li>`).join("")}</ul></div>`;
    }).join("");
    const missedCount = cons.filter((c) => new Date(c.at).getTime() < missedCutoff).length;
    try {
      await sendEmail({
        from, to,
        subject: `Consequences to follow up — ${schoolName || "today"} (${totalItems}${missedCount ? `, ${missedCount} missed` : ""})`,
        text: `Consequences not yet carried out, by teacher:\n\n` + Object.entries(byTeacher).map(([tid, items]) => `${tid === "none" ? "Unassigned" : tLabel(tById[tid])}:\n` + items.map((it) => `  • ${it.student} — ${it.type}${it.detail ? `: ${it.detail}` : ""} (${new Date(it.at).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })})${it.missed ? " · MISSED" : ""}`).join("\n")).join("\n\n"),
        html: emailShell({ title: "Consequences to follow up", schoolName: schoolName || "Compass", preheader: `${totalItems} outstanding${missedCount ? `, ${missedCount} missed` : ""}`,
          contentHtml: `<p style="margin:0 0 12px;color:#334155">These consequences were logged but aren't marked done yet, grouped by the teacher who logged them. A quick nudge helps them land while they still matter.</p>${groupsHtml}${followThrough}` }),
      });
      sent += 1;
    } catch (e) { console.warn("[behavior/consq-digest] VP send failed:", e?.message || e); }
  }

  // Each teacher their own list (optional).
  if (cd.emailTeachers !== false) {
    for (const [tid, items] of Object.entries(byTeacher)) {
      if (tid === "none") continue;
      const t = tById[tid];
      const email = (t?.email || "").trim();
      if (!email) continue;
      try {
        await sendEmail({
          from, to: email,
          subject: `Your consequences to follow up (${items.length})`,
          text: `Hi ${tLabel(t).split(" ")[0]},\n\nThese consequences you logged aren't marked done yet:\n\n` + items.map((it) => `  • ${it.student} — ${it.type}${it.detail ? `: ${it.detail}` : ""} (${new Date(it.at).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })})${it.missed ? " · past the follow-up window" : ""}`).join("\n") + `\n\nA consequence works best right after the offence — please close these out. Mark them done on your Compass dashboard.`,
          html: emailShell({ title: "Your consequences to follow up", schoolName: schoolName || "Compass", preheader: `${items.length} to close out`,
            contentHtml: `<p style="margin:0 0 10px">Hi ${escapeHtml(tLabel(t).split(" ")[0])},</p><p style="margin:0 0 10px;color:#334155">These consequences you logged aren't marked done yet:</p>` +
              `<ul style="margin:0;padding-left:18px;color:#334155;line-height:1.6">${items.map((it) => `<li>${fmtItem(it)}</li>`).join("")}</ul>${followThrough}` +
              emailButton("Open Compass", `${appBase()}/behavior`, "#0f172a") }),
        });
        sent += 1;
      } catch (e) { console.warn("[behavior/consq-digest] teacher send failed:", e?.message || e); }
    }
  }

  await BehaviorConfig.updateOne({ schoolId }, { $set: { "consequenceDigest.lastSentAt": new Date() } });
  return { ok: true, sent, items: totalItems };
}

// Monthly "your month in Compass" encouragement email to each teacher — their
// own This-school-year recap (positives, concerns, interactions, notices,
// follow-through) with the red/green monthly chart. Positive reinforcement to
// keep staff using Compass. Per-teacher opt-out: BehaviorTeacher.monthlySummary.
export async function sendMonthlyTeacherSummaries(schoolId, { force = false } = {}) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  if (!config) return { ok: false, error: "no config" };
  if (!force && config.monthlyTeacherSummary?.enabled === false) return { ok: false, skipped: "disabled" };
  const monthKey = new Date().toISOString().slice(0, 7);
  if (!force && config.monthlyTeacherSummary?.lastRunMonth === monthKey) return { ok: false, skipped: "already ran this month" };

  const now = new Date();
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // Sept = month 8
  const cutoff = new Date(startYear, 8, 1);
  const windowShort = "this school year";
  const school = await BehaviorSchool.findById(schoolId).select("name").lean();
  const schoolName = config.branding?.schoolName || school?.name || "";
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = fromAddr ? { name: "Compass", address: fromAddr } : undefined;
  const teachers = await BehaviorTeacher.find({ schoolId, status: "accepted" }).select("name courtesyName email monthlySummary").lean();

  let sent = 0;
  for (const t of teachers) {
    if (t.monthlySummary === false) continue;
    const email = (t.email || "").trim();
    if (!email) continue;

    const incs = await BehaviorIncident.find({ schoolId, teacherId: t._id, timestamp: { $gt: cutoff } })
      .select("behaviorSnapshot timestamp studentId").lean();
    let off = 0, pos = 0, intx = 0; const studs = new Set(); const byMonthKind = {}; const byType = {};
    for (const i of incs) {
      const isPos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInt = !isPos && i.behaviorSnapshot?.triggerMode === "INTERACTION";
      studs.add(String(i.studentId));
      const k = new Date(i.timestamp).toISOString().slice(0, 7);
      byMonthKind[k] = byMonthKind[k] || { neg: 0, pos: 0 };
      if (isPos) { pos += 1; byMonthKind[k].pos += 1; }
      else if (isInt) { intx += 1; }
      else { off += 1; byMonthKind[k].neg += 1; const n = i.behaviorSnapshot?.name || "Other"; byType[n] = (byType[n] || 0) + 1; }
    }
    const notices = await BehaviorNotice.find({ schoolId, sentByTeacherId: t._id, createdAt: { $gt: cutoff } }).select("status").lean();
    const noticesSent = notices.filter((n) => n.status === "sent").length;
    const fus = await BehaviorFollowup.find({ schoolId, assignedByTeacherId: t._id, createdAt: { $gt: cutoff } }).select("status").lean();
    const fuTotal = fus.length;
    const fuResolved = fus.filter((f) => f.status === "done" || f.status === "waived").length;
    const fuPct = fuTotal ? Math.round((fuResolved / fuTotal) * 100) : 0;

    const totalActivity = off + pos + intx + notices.length;
    if (!force && totalActivity === 0) continue; // nothing to celebrate yet (inactivity nudge covers that)

    const first = (t.courtesyName || t.name || "there").trim().split(/\s+/)[0] || "there";
    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", ");
    const headline = `You've recognised ${pos} positive(s), logged ${off} concern(s) and had ${intx} documented interaction(s) across ${studs.size} student(s) ${windowShort}.`;
    const li = (s) => `<li style="margin:2px 0">${s}</li>`;
    const statsHtml = `<ul style="margin:6px 0 0;padding-left:18px;color:#334155;line-height:1.7">` +
      li(`<strong>Positives recognised:</strong> ${pos}`) +
      li(`<strong>Concerns logged:</strong> ${off}${topTypes ? ` <span style="color:#94a3b8">(${escapeHtml(topTypes)})</span>` : ""}`) +
      li(`<strong>Documented interactions:</strong> ${intx}`) +
      li(`<strong>Notices home:</strong> ${notices.length} (${noticesSent} sent)`) +
      (fuTotal ? li(`<strong>Consequence follow-through:</strong> ${fuPct}% of ${fuTotal}`) : "") +
      li(`<strong>Students supported:</strong> ${studs.size}`) + `</ul>`;
    const contentHtml =
      `<p style="margin:0 0 10px">Hi ${escapeHtml(first)},</p>` +
      `<p style="margin:0 0 12px;color:#334155">Thank you for the care you've put into your students this year. Here's your month-by-month picture in Compass (${windowShort}):</p>` +
      statsHtml +
      `<h3 style="margin:16px 0 6px;font-size:14px;color:#0f172a">Monthly volume (red = concerns, green = positives)</h3>` +
      monthlyKindChartHtml(byMonthKind) +
      `<p style="margin:14px 0 0;color:#334155">Every note you add — a quick positive as much as a concern — builds the shared picture that helps each student and backs up your colleagues. Thank you for keeping it up.</p>` +
      emailButton("Open Compass", `${appBase()}/behavior`, "#16a34a");
    const text = `Hi ${first},\n\n${headline}\n\n` +
      `Positives recognised: ${pos}\nConcerns logged: ${off}${topTypes ? ` (${topTypes})` : ""}\nDocumented interactions: ${intx}\nNotices home: ${notices.length} (${noticesSent} sent)\n` +
      (fuTotal ? `Consequence follow-through: ${fuPct}% of ${fuTotal}\n` : "") +
      `Students supported: ${studs.size}\n\nThank you for keeping the shared picture up to date.\n${appBase()}/behavior`;
    try {
      await sendEmail({ from, to: email, subject: `Your month in Compass${schoolName ? ` — ${schoolName}` : ""}`, text,
        html: emailShell({ title: "Your month in Compass", schoolName: schoolName || "Compass", preheader: headline, accent: "#16a34a", contentHtml }) });
      sent += 1;
    } catch (e) { console.warn("[behavior/monthly-summary] send failed for", email, e?.message || e); }
  }
  await BehaviorConfig.updateOne({ schoolId }, { $set: { "monthlyTeacherSummary.lastRunMonth": monthKey } });
  return { ok: true, sent };
}

// Event-driven homeroom check-in: email the student's homeroom teacher a
// proactive "have an encouraging word" nudge for ONE student (dated incidents +
// one-tap "I've talked to them"). Fired when a student crosses to 2 active
// strikes — climbing from fewer, or again after a notice/white-slip reset.
// Best-effort; never blocks logging. Returns true if an email was sent.
export async function sendHomeroomCheckinForStudent({ schoolId, student, config }) {
  if (config?.teacherNudge?.enabled === false) return false;
  const cls = String(student.classGroup || "").trim();
  if (!cls) return false;
  const hr = await BehaviorTeacher.findOne({ schoolId, homeroom: cls, status: "accepted" }).lean();
  if (!hr?.email) return false;

  const fadeDays = config?.fadeWindowDays ?? 30;
  const incs = await BehaviorIncident.find({ studentId: student._id, timestamp: { $gt: new Date(Date.now() - Math.max(fadeDays, 60) * DAY_MS) } })
    .select("behaviorSnapshot timestamp immediateFlag whiteSlip countedInNoticeId teacherId detailText").lean();
  const active = activeThresholdIncidents(incs, { fadeWindowDays: fadeDays, thresholdResetAt: student.thresholdResetAt });
  if (active.length < 2) return false;

  const tIds = [...new Set(active.map((i) => String(i.teacherId)).filter(Boolean))];
  const tdocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name courtesyName").lean();
  const tn = Object.fromEntries(tdocs.map((t) => [String(t._id), (t.courtesyName || t.name || "").trim()]));
  const occ = active.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8).map((i) => ({
    date: new Date(i.timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ }),
    name: i.behaviorSnapshot?.name || "Offence", detail: (i.detailText || "").trim(), teacher: tn[String(i.teacherId)] || "",
  }));
  const name = `${student.preferredName || student.firstName} ${student.lastName || ""}`.trim();
  const hrFirst = (hr.courtesyName || hr.name || "there").split(" ")[0];
  const schoolName = config?.branding?.schoolName || (await BehaviorSchool.findById(schoolId).select("name").lean())?.name || "";
  const tok = hrFollowupToken(String(schoolId), String(student._id));
  const link = `${appBase()}/behavior/hr-followup?school=${schoolId}&student=${student._id}&token=${encodeURIComponent(tok)}`;
  const occHtml = `<ul style="margin:6px 0 2px;padding-left:18px;color:#475569;font-size:13px;line-height:1.6">` +
    occ.map((o) => `<li><span style="color:#94a3b8">${escapeHtml(o.date)}</span> — ${escapeHtml(o.name)}${o.detail ? `: ${escapeHtml(o.detail)}` : ""}${o.teacher ? ` <span style="color:#94a3b8">(${escapeHtml(o.teacher)})</span>` : ""}</li>`).join("") + `</ul>`;
  const subject = `A quick check-in idea — ${name}`;
  const contentHtml =
    `<p style="margin:0 0 10px">Hi ${escapeHtml(hrFirst)},</p>` +
    `<p style="margin:0 0 12px;color:#334155">${escapeHtml(name)} has picked up a couple of notes lately. A quick, early check-in now is one of the best ways to steer ${escapeHtml((student.preferredName || student.firstName || "them"))} back on track before things escalate.</p>` +
    `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:8px 0">` +
    `<div style="font-weight:700">${escapeHtml(name)} <span style="font-weight:400;color:#64748b;font-size:13px">— ${active.length} recent offences</span></div>` +
    `<div style="color:#64748b;font-size:12px;margin-top:4px">What to talk about:</div>` + occHtml +
    emailButton("✓ I've talked to them", link, "#2563eb") + `</div>` +
    `<p style="margin:14px 0 6px;color:#334155">Once you've had the conversation, just tap <strong>“I've talked to them”</strong> above — it's logged as a supportive check-in (never a strike, nothing goes home).</p>`;
  const text = `Hi ${hrFirst},\n\n${name} could use a proactive check-in (${active.length} recent offences):\n` +
    occ.map((o) => `  - ${o.date} — ${o.name}${o.detail ? `: ${o.detail}` : ""}${o.teacher ? ` (${o.teacher})` : ""}`).join("\n") +
    `\n\nAfter you've talked with them, tap the link in the email version, or the blue homeroom follow-up button in Compass.\n\n${appBase()}/behavior`;
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = fromAddr ? { name: "Compass", address: fromAddr } : undefined;
  try {
    await sendEmail({ from, to: hr.email, subject, text, html: emailShell({ title: subject, schoolName: schoolName || "Compass", preheader: subject, contentHtml }) });
    return true;
  } catch (e) { console.warn("[behavior/checkin] send failed:", e?.message || e); return false; }
}

export async function sendTeacherNudgesForSchool(schoolId, { force = false } = {}) {
  const config = await BehaviorConfig.findOne({ schoolId }).lean();
  if (!config) return { ok: false, error: "no config" };
  if (!force && config.teacherNudge?.enabled === false) return { ok: false, skipped: "disabled" };
  const intervalDays = config.teacherNudge?.intervalDays ?? 14;
  if (!force && config.teacherNudge?.lastRunAt && Date.now() - new Date(config.teacherNudge.lastRunAt).getTime() < (intervalDays - 1) * DAY_MS) {
    return { ok: false, skipped: "too soon" };
  }
  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = fromAddr ? { name: "Compass", address: fromAddr } : undefined;
  const schoolName = config.branding?.schoolName || (await BehaviorSchool.findById(schoolId).select("name").lean())?.name || "";
  const fadeDays = config.fadeWindowDays ?? 30;
  const triggerCount = config.triggerCount ?? 3;

  const teachers = await BehaviorTeacher.find({ schoolId, status: "accepted", role: { $ne: "principal" } }).lean();
  const students = await BehaviorStudent.find({ schoolId, active: true }).select("firstName preferredName lastName classGroup grade thresholdResetAt").lean();
  const byId = Object.fromEntries(students.map((s) => [String(s._id), s]));

  // Recent incidents for strike counting + "what to talk about".
  const since = new Date(Date.now() - Math.max(fadeDays, 60) * DAY_MS);
  const incs = await BehaviorIncident.find({ schoolId, timestamp: { $gt: since } })
    .select("studentId behaviorSnapshot timestamp immediateFlag whiteSlip countedInNoticeId teacherId detailText").lean();
  const incByStudent = {};
  for (const i of incs) (incByStudent[String(i.studentId)] ||= []).push(i);
  // Teacher names for attributing each occurrence in the "what to talk about" list.
  const nudgeTeacherName = Object.fromEntries(teachers.map((t) => [String(t._id), (t.courtesyName || t.name || "").trim()]));

  // Students already followed-up within this period drop off the list.
  const fuSince = new Date(Date.now() - intervalDays * DAY_MS);
  const recentFu = await BehaviorIncident.find({ schoolId, timestamp: { $gt: fuSince }, "behaviorSnapshot.name": "Homeroom follow-up" }).select("studentId").lean();
  const fuSet = new Set(recentFu.map((f) => String(f.studentId)));

  let sent = 0;
  for (const t of teachers) {
    const email = (t.email || "").trim();
    if (!email) continue;

    // Homeroom students who are accumulating offences and haven't been checked in with.
    const rooms = String(t.homeroom || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const watch = [];
    if (rooms.length) {
      for (const s of students) {
        if (!rooms.includes(String(s.classGroup || "").trim().toLowerCase())) continue;
        if (fuSet.has(String(s._id))) continue;
        const active = activeThresholdIncidents(incByStudent[String(s._id)] || [], { fadeWindowDays: fadeDays, thresholdResetAt: s.thresholdResetAt });
        if (active.length < 2) continue; // only those genuinely racking up
        const byType = {};
        for (const i of active) { const n = i.behaviorSnapshot?.name || "Other"; byType[n] = (byType[n] || 0) + 1; }
        const about = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v > 1 ? ` ×${v}` : ""}`).slice(0, 4).join(", ");
        // Dated occurrence list (most recent first) so the HR teacher walks into
        // the chat with specifics, not just a summary.
        const occurrences = active
          .slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8)
          .map((i) => ({
            date: new Date(i.timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: SCHOOL_TZ }),
            name: i.behaviorSnapshot?.name || "Offence",
            detail: (i.detailText || "").trim(),
            teacher: nudgeTeacherName[String(i.teacherId)] || "",
          }));
        watch.push({ id: String(s._id), name: `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim(), strikes: active.length, about, occurrences });
      }
      watch.sort((a, b) => b.strikes - a.strikes);
    }

    // Inactivity: no incidents logged by this teacher in the interval.
    const loggedRecently = await BehaviorIncident.exists({ schoolId, teacherId: t._id, timestamp: { $gt: fuSince } });
    const inactive = !loggedRecently;

    let subject = "", contentHtml = "", text = "";
    const first = (t.name || "").split(" ")[0] || "there";

    // Per-student check-ins are now EVENT-DRIVEN (fired on crossing 2 strikes —
    // see sendHomeroomCheckinForStudent), so the automatic cron no longer sends
    // them. A manual run (force) can still send the batch for a catch-up/preview.
    if (force && watch.length) {
      subject = `A quick check-in idea for ${watch.length} student${watch.length === 1 ? "" : "s"} in your homeroom`;
      const rowsHtml = watch.map((w) => {
        const tok = hrFollowupToken(String(schoolId), w.id);
        const link = `${appBase()}/behavior/hr-followup?school=${schoolId}&student=${w.id}&token=${encodeURIComponent(tok)}`;
        const occHtml = (w.occurrences || []).length
          ? `<ul style="margin:6px 0 2px;padding-left:18px;color:#475569;font-size:13px;line-height:1.6">` +
            w.occurrences.map((o) =>
              `<li><span style="color:#94a3b8">${escapeHtml(o.date)}</span> — ${escapeHtml(o.name)}` +
              `${o.detail ? `: ${escapeHtml(o.detail)}` : ""}` +
              `${o.teacher ? ` <span style="color:#94a3b8">(${escapeHtml(o.teacher)})</span>` : ""}</li>`
            ).join("") + `</ul>`
          : (w.about ? `<div style="color:#475569;font-size:13px;margin-top:2px">What to talk about: ${escapeHtml(w.about)}</div>` : "");
        return (
          `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:8px 0">` +
          `<div style="font-weight:700">${escapeHtml(w.name)} <span style="font-weight:400;color:#64748b;font-size:13px">— ${w.strikes} recent offences</span></div>` +
          `<div style="color:#64748b;font-size:12px;margin-top:4px">What to talk about:</div>` +
          occHtml +
          emailButton("✓ I've talked to them", link, "#2563eb") +
          `</div>`
        );
      }).join("");
      contentHtml =
        `<p style="margin:0 0 10px">Hi ${escapeHtml(first)},</p>` +
        `<p style="margin:0 0 12px;color:#334155">A quick, proactive note — checking in early with students who are starting to rack up a few offences is one of the best ways to steer them back on track before things escalate. Here are a few of your homeroom students who might appreciate a chat:</p>` +
        rowsHtml +
        `<p style="margin:14px 0 6px;color:#334155">Once you've had a conversation, just tap <strong>“I've talked to them”</strong> above — or tap the blue homeroom-follow-up button beside their name on your Compass dashboard. Either way it's logged as a supportive check-in (never a strike, nothing goes home).</p>` +
        emailButton("Open Compass", `${appBase()}/behavior`, "#0f172a");
      text = `Hi ${first},\n\nA few of your homeroom students could use a proactive check-in:\n\n` +
        watch.map((w) => `• ${w.name} — ${w.strikes} recent offences\n` +
          (w.occurrences || []).map((o) => `    - ${o.date} — ${o.name}${o.detail ? `: ${o.detail}` : ""}${o.teacher ? ` (${o.teacher})` : ""}`).join("\n")
        ).join("\n") +
        `\n\nAfter you've talked with them, tap the blue homeroom follow-up button in Compass, or the link in the email version of this message.\n\n${appBase()}/behavior`;
    } else if (inactive) {
      subject = "How are things going in your class?";
      contentHtml =
        `<p style="margin:0 0 10px">Hi ${escapeHtml(first)},</p>` +
        `<p style="margin:0 0 12px;color:#334155">We haven't seen any Compass entries from you lately — which may well mean things are running smoothly, and that's wonderful! 🎉</p>` +
        `<p style="margin:0 0 12px;color:#334155">Just a friendly reminder that Compass is quickest when it's part of the daily rhythm: a few seconds to note something a student did well, or to flag a concern early, keeps everyone in the loop and helps kids before small things grow. Even the positives are worth logging — they build a student's record and their house points.</p>` +
        emailButton("Open Compass", `${appBase()}/behavior`, "#0f172a");
      text = `Hi ${first},\n\nWe haven't seen any Compass entries from you lately — hopefully that means all is well! Just a nudge that logging a quick positive or an early concern keeps everyone in the loop.\n\n${appBase()}/behavior`;
    } else {
      continue; // active teacher, nothing flagged → no email
    }

    try {
      await sendEmail({ from, to: email, subject, text, html: emailShell({ title: subject, schoolName, contentHtml, preheader: subject }) });
      sent += 1;
    } catch (e) {
      console.warn("[behavior/nudge] send failed for", email, e?.message || e);
    }
  }

  await BehaviorConfig.updateOne({ schoolId }, { $set: { "teacherNudge.lastRunAt": new Date() } });
  return { ok: true, sent };
}

// Send teacher nudges now (admin) — manual trigger / preview.
router.post("/teacher-nudge/run", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const r = await sendTeacherNudgesForSchool(req.schoolId, { force: true });
    await audit(req.schoolId, "teacher_nudge.run", req, { meta: { sent: r.sent, ok: r.ok } });
    res.json(r);
  } catch (err) { next(err); }
});

// Send the monthly per-teacher "your month in Compass" summaries now (admin).
router.post("/monthly-summary/run", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const r = await sendMonthlyTeacherSummaries(req.schoolId, { force: true });
    await audit(req.schoolId, "monthly_summary.run", req, { meta: { sent: r.sent, ok: r.ok } });
    res.json(r);
  } catch (err) { next(err); }
});

// Send the daily VP consequence digest now (admin) — preview/test.
router.post("/consequence-digest/run", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const r = await sendConsequenceDigestForSchool(req.schoolId, { force: true });
    await audit(req.schoolId, "consequence_digest.run", req, { meta: { sent: r.sent, items: r.items, ok: r.ok } });
    res.json(r);
  } catch (err) { next(err); }
});

// Send the weekly digest now (admin) — also used to preview/test.
router.post("/admin-digest", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    if (req.body?.recipientEmail !== undefined) {
      await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "adminDigest.recipientEmail": String(req.body.recipientEmail || "").trim().toLowerCase() } });
    }
    const r = await sendAdminDigestForSchool(req.schoolId, { force: true });
    await audit(req.schoolId, "admin_digest.sent", req, { meta: { to: r.to, ok: r.ok } });
    res.json(r.ok ? { ok: true, to: r.to } : { ok: false, error: r.error || r.skipped || "failed" });
  } catch (err) {
    next(err);
  }
});

// ── Houses + points ──────────────────────────────────────────────────────────

// House point totals, applying per-student caps (config.houseCaps). A single
// student's positive and negative contributions are each capped (0 = unlimited);
// house-level awards (no studentId — e.g. house events) are never capped.
async function houseTotals(schoolId, cfg, { positivesOnly = false } = {}) {
  // Points earned by students no longer on the roster (graduated/withdrawn) drop
  // out of the standings; whole-house awards (no studentId) always count.
  const activeIds = (await BehaviorStudent.find({ schoolId, active: true }).select("_id").lean()).map((s) => s._id);
  const match = { schoolId, $or: [{ studentId: null }, { studentId: { $in: activeIds } }] };
  if (cfg?.housePointsResetAt) match.at = { $gt: new Date(cfg.housePointsResetAt) };
  // "Reset negatives only": drop negative events on/before the negative-reset.
  if (cfg?.houseNegativeResetAt) {
    (match.$and ||= []).push({ $or: [{ points: { $gte: 0 } }, { at: { $gt: new Date(cfg.houseNegativeResetAt) } } ] });
  }
  // Public/positives-only view: ignore deductions entirely.
  if (positivesOnly) match.points = { $gt: 0 };
  const posCap = Number(cfg?.houseCaps?.positive) || 0;
  const negCap = Number(cfg?.houseCaps?.negative) || 0;
  const rows = await HousePointEvent.aggregate([
    { $match: match },
    { $group: {
      _id: { h: "$houseId", s: "$studentId" },
      pos: { $sum: { $cond: [{ $gt: ["$points", 0] }, "$points", 0] } },
      neg: { $sum: { $cond: [{ $lt: ["$points", 0] }, "$points", 0] } },
    } },
  ]);
  const byHouse = {};
  for (const r of rows) {
    let pos = r.pos, neg = r.neg;
    if (r._id.s) { // per-student → cap
      if (posCap > 0) pos = Math.min(pos, posCap);
      if (negCap > 0) neg = Math.max(neg, -negCap);
    }
    const hid = String(r._id.h);
    byHouse[hid] = (byHouse[hid] || 0) + pos + neg;
  }
  return byHouse;
}

// A student's personal merch wallet: all-time positive individual points earned
// minus all-time redemptions (never below 0). Kept separate from house standings
// so spending on merch doesn't lower the house total. Returns a {id: balance} map.
async function merchBalances(schoolId, studentIds) {
  if (!studentIds.length) return {};
  const [earned, spent] = await Promise.all([
    HousePointEvent.aggregate([
      { $match: { schoolId, studentId: { $in: studentIds }, points: { $gt: 0 } } },
      { $group: { _id: "$studentId", v: { $sum: "$points" } } },
    ]),
    MerchRedemption.aggregate([
      { $match: { schoolId, studentId: { $in: studentIds } } },
      { $group: { _id: "$studentId", v: { $sum: "$points" } } },
    ]),
  ]);
  const earnedBy = Object.fromEntries(earned.map((e) => [String(e._id), e.v]));
  const spentBy = Object.fromEntries(spent.map((e) => [String(e._id), e.v]));
  const out = {};
  for (const id of studentIds) {
    const k = String(id);
    out[k] = Math.max(0, (earnedBy[k] || 0) - (spentBy[k] || 0));
  }
  return out;
}

// Daily Movers — students with the most behaviour movement TODAY: net house
// points and the count of incidents/positives logged since local midnight.
router.get("/daily-movers", authAny, loadMembership, async (req, res, next) => {
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [pts, incs] = await Promise.all([
      HousePointEvent.aggregate([
        { $match: { schoolId: req.schoolId, studentId: { $ne: null }, at: { $gt: start } } },
        { $group: { _id: "$studentId", net: { $sum: "$points" } } },
      ]),
      BehaviorIncident.aggregate([
        { $match: { schoolId: req.schoolId, timestamp: { $gt: start } } },
        { $group: {
          _id: "$studentId",
          count: { $sum: 1 },
          pos: { $sum: { $cond: [{ $or: [{ $eq: ["$behaviorSnapshot.kind", "positive"] }, { $gt: ["$behaviorSnapshot.points", 0] }] }, 1, 0] } },
        } },
      ]),
    ]);
    const byId = {};
    for (const p of pts) (byId[String(p._id)] ||= { net: 0, count: 0, pos: 0 }).net = p.net;
    for (const i of incs) { const e = (byId[String(i._id)] ||= { net: 0, count: 0, pos: 0 }); e.count = i.count; e.pos = i.pos; }
    const ids = Object.keys(byId);
    if (!ids.length) return res.json({ ok: true, movers: [] });
    const students = await BehaviorStudent.find({ _id: { $in: ids }, schoolId: req.schoolId })
      .select("firstName preferredName lastName classGroup houseId").lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId }).select("name color").lean();
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));
    const movers = students.map((s) => {
      const e = byId[String(s._id)];
      const h = s.houseId ? houseById[String(s.houseId)] : null;
      return {
        studentId: String(s._id),
        name: `${s.preferredName || s.firstName} ${s.lastName}`.trim(),
        classGroup: s.classGroup || "",
        house: h?.name || "", color: h?.color || "#0f172a",
        net: e.net || 0, incidents: e.count || 0, positives: e.pos || 0,
      };
    }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.incidents - a.incidents).slice(0, 10);
    res.json({ ok: true, movers });
  } catch (err) {
    next(err);
  }
});

// Houses-only config (caps, events, enable, report, term reset) — editable by the
// houses committee as well as admins, without granting full Setup access.
router.put("/houses/config", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    if ("housesEnabled" in b) $set.housesEnabled = !!b.housesEnabled;
    if ("housePointsResetAt" in b) $set.housePointsResetAt = b.housePointsResetAt ? new Date(b.housePointsResetAt) : null;
    if (b.houseCaps) $set.houseCaps = { positive: Math.max(0, Number(b.houseCaps.positive) || 0), negative: Math.max(0, Number(b.houseCaps.negative) || 0) };
    if (Array.isArray(b.houseEvents)) $set.houseEvents = b.houseEvents.map((e) => ({ name: String(e.name || "").trim(), points: Number(e.points) || 0 })).filter((e) => e.name);
    if (Array.isArray(b.houseRewards)) $set.houseRewards = b.houseRewards.map((r) => ({ points: Number(r.points) || 0, reward: String(r.reward || "").trim() })).filter((r) => r.reward && r.points);
    if (b.houseReport) $set.houseReport = { enabled: !!b.houseReport.enabled, recipientEmail: String(b.houseReport.recipientEmail || "").trim().toLowerCase() };
    if ("encouragingMessagePoints" in b) $set.encouragingMessagePoints = Math.max(0, Number(b.encouragingMessagePoints) || 0);
    if ("housesPublicShowPositives" in b) $set.housesPublicShowPositives = !!b.housesPublicShowPositives;
    if ("housesPublicShowNegatives" in b) $set.housesPublicShowNegatives = !!b.housesPublicShowNegatives;
    if ("houseNegativeResetAt" in b) $set.houseNegativeResetAt = b.houseNegativeResetAt ? new Date(b.houseNegativeResetAt) : null;
    if (b.merchStore && typeof b.merchStore === "object") {
      if ("enabled" in b.merchStore) $set["merchStore.enabled"] = !!b.merchStore.enabled;
      if (Array.isArray(b.merchStore.items)) {
        $set["merchStore.items"] = b.merchStore.items
          .map((i) => ({ name: String(i.name || "").trim(), points: Math.max(0, Number(i.points) || 0), image: String(i.image || "") }))
          .filter((i) => i.name && i.points);
      }
    }
    if (!Object.keys($set).length) return res.status(400).json({ ok: false, error: "Nothing to update" });
    const config = await BehaviorConfig.findOneAndUpdate({ schoolId: req.schoolId }, { $set }, { new: true, upsert: true }).lean();
    await audit(req.schoolId, "houses.config_updated", req, { meta: { keys: Object.keys($set) } });
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

// "Reset negatives only": stamp the negative-reset marker at now, so conduct
// deductions logged up to this moment stop dragging the standings while every
// positive point earned is kept. Reversible by clearing the marker.
router.post("/houses/reset-negatives", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const at = new Date();
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { houseNegativeResetAt: at } }, { upsert: true });
    await audit(req.schoolId, "houses.reset_negatives", req, { meta: { at } });
    res.json({ ok: true, houseNegativeResetAt: at });
  } catch (err) { next(err); }
});

// Set/unset a house captain (committee or admin) — houses-scoped, so it doesn't
// need the broader admin-only student PATCH.
router.put("/houses/captain", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const studentId = String(req.body?.studentId || "").trim();
    const on = req.body?.on === true;
    if (!studentId) return res.status(400).json({ ok: false, error: "Missing studentId." });
    const s = await BehaviorStudent.findOneAndUpdate({ _id: studentId, schoolId: req.schoolId }, { $set: { houseCaptain: on } }, { new: true }).select("houseCaptain").lean();
    if (!s) return res.status(404).json({ ok: false, error: "Student not found" });
    res.json({ ok: true, houseCaptain: s.houseCaptain });
  } catch (err) {
    next(err);
  }
});

// Houses with their point totals + member counts (for the leaderboard).
router.get("/houses", authAny, loadMembership, async (req, res, next) => {
  try {
    // Master switch: when Houses is off, the whole aspect is hidden — report no
    // houses so every consumer surface (leaderboard, assignment dropdown) hides.
    const cfg = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("housesEnabled housePointsResetAt houseNegativeResetAt houseCaps").lean();
    if (!cfg?.housesEnabled) return res.json({ ok: true, enabled: false, houses: [] });

    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const totalById = await houseTotals(req.schoolId, cfg);
    const members = await BehaviorStudent.aggregate([
      { $match: { schoolId: req.schoolId, active: true, houseId: { $ne: null } } },
      { $group: { _id: "$houseId", n: { $sum: 1 } } },
    ]);
    const memberById = Object.fromEntries(members.map((m) => [String(m._id), m.n]));
    res.json({
      ok: true,
      enabled: true,
      resetAt: cfg.housePointsResetAt || null,
      houses: houses
        .map((h) => ({ ...h, points: totalById[String(h._id)] || 0, members: memberById[String(h._id)] || 0 }))
        .sort((a, b) => b.points - a.points),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/houses", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const house = await BehaviorHouse.create({
      schoolId: req.schoolId, name, color: req.body?.color || "#0f172a", sortOrder: Number(req.body?.sortOrder) || 0,
    });
    await audit(req.schoolId, "house.created", req, { meta: { name } });
    res.json({ ok: true, house });
  } catch (err) {
    next(err);
  }
});

router.put("/houses/:id", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    if ("name" in b) $set.name = String(b.name || "").trim();
    if ("color" in b) $set.color = String(b.color || "#0f172a");
    if ("sortOrder" in b) $set.sortOrder = Number(b.sortOrder) || 0;
    if ("roomGroup1" in b) $set.roomGroup1 = String(b.roomGroup1 || "").trim();
    if ("roomGroup2" in b) $set.roomGroup2 = String(b.roomGroup2 || "").trim();
    if ("teacher1" in b) $set.teacher1 = String(b.teacher1 || "").trim().slice(0, 80);
    if ("teacher2" in b) $set.teacher2 = String(b.teacher2 || "").trim().slice(0, 80);
    if ("image" in b) {
      const img = String(b.image || "");
      if (img === "") $set.image = "";
      else if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(img)) return res.status(400).json({ ok: false, error: "Image must be a PNG/JPEG/WebP/GIF." });
      else if (img.length > 400000) return res.status(400).json({ ok: false, error: "Image is too large — please use a smaller crest." });
      else $set.image = img;
    }
    const house = await BehaviorHouse.findOneAndUpdate({ _id: req.params.id, schoolId: req.schoolId }, { $set }, { new: true }).lean();
    if (!house) return res.status(404).json({ ok: false, error: "House not found" });
    res.json({ ok: true, house });
  } catch (err) {
    next(err);
  }
});

router.delete("/houses/:id", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const house = await BehaviorHouse.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!house) return res.status(404).json({ ok: false, error: "House not found" });
    await audit(req.schoolId, "house.removed", req, { meta: { name: house.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Award (or deduct) house points — to a whole house, or to a student (whose
// house gets the points). Positive or negative.
router.post("/house-points", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const points = Number(req.body?.points);
    if (!points || isNaN(points)) return res.status(400).json({ ok: false, error: "points must be a non-zero number" });
    let houseId = req.body?.houseId || null;
    let studentId = req.body?.studentId || null;
    if (studentId) {
      const stu = await BehaviorStudent.findOne({ _id: studentId, schoolId: req.schoolId }).select("houseId").lean();
      if (!stu) return res.status(404).json({ ok: false, error: "Student not found" });
      houseId = houseId || stu.houseId;
      if (!houseId) return res.status(400).json({ ok: false, error: "That student isn't assigned to a house" });
    }
    if (!houseId) return res.status(400).json({ ok: false, error: "houseId or a student with a house required" });
    const event = await HousePointEvent.create({
      schoolId: req.schoolId, houseId, studentId, points,
      reason: String(req.body?.reason || ""), awardedByTeacherId: req.membership._id,
    });
    await audit(req.schoolId, "house.points", req, { studentId, meta: { houseId: String(houseId), points } });
    res.json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});

// ── Food Drive import (AI handwriting read of class sheets) ───────────────────
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z\s'-]/g, "").replace(/\s+/g, " ").trim();
// Match a sheet name ("First Last" or "Last, First"/"Last First") to a student.
function matchStudent(raw, index) {
  const n = normName(raw);
  if (!n) return null;
  if (index.exact[n]) return index.exact[n];
  // try swapping order (handles "Last First" vs "First Last")
  const parts = n.split(" ");
  if (parts.length >= 2) {
    const swapped = [parts.slice(1).join(" "), parts[0]].join(" ");
    if (index.exact[swapped]) return index.exact[swapped];
    // last + first-initial fallback
    const li = `${parts[parts.length - 1]} ${parts[0][0]}`;
    if (index.liLast[li]) return index.liLast[li];
  }
  return null;
}
function buildStudentIndex(students) {
  const exact = {}, liLast = {};
  for (const s of students) {
    const first = s.preferredName || s.firstName || "";
    const names = new Set([`${first} ${s.lastName}`, `${s.firstName} ${s.lastName}`, `${s.lastName} ${first}`, `${s.lastName} ${s.firstName}`]);
    for (const nm of names) { const k = normName(nm); if (k) exact[k] = s; }
    const li = normName(`${s.lastName} ${(first || "")[0] || ""}`);
    if (li) liLast[li] = s;
  }
  return { exact, liLast };
}

// 1) Read the sheets → return parsed rows matched to students (for review).
router.post("/house/food-drive/parse", authAny, loadMembership, canLog, uploadSheets.array("files", 25), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ ok: false, error: "Upload at least one sheet (photo, scan, or PDF)." });
    const { rows, images } = await readFoodDriveSheets(req.files);
    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true }).select("firstName preferredName lastName classGroup houseId").lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId }).select("name color").lean();
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));
    const index = buildStudentIndex(students);
    const out = rows.map((r) => {
      const s = matchStudent(r.name, index);
      const h = s?.houseId ? houseById[String(s.houseId)] : null;
      return {
        name: r.name,
        items: Number.isFinite(r.items) ? r.items : null,
        studentId: s ? String(s._id) : null,
        studentLabel: s ? `${s.preferredName || s.firstName} ${s.lastName}${s.classGroup ? ` (${s.classGroup})` : ""}` : null,
        house: h?.name || null,
        houseColor: h?.color || null,
      };
    });
    const roster = students
      .map((s) => ({ id: String(s._id), label: `${s.preferredName || s.firstName} ${s.lastName}${s.classGroup ? ` (${s.classGroup})` : ""}`, house: s.houseId ? (houseById[String(s.houseId)]?.name || "") : "" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({ ok: true, images, rows: out, roster, unmatched: out.filter((r) => !r.studentId).length });
  } catch (err) {
    next(err);
  }
});

// 2) Apply: award top donors + house placements from the confirmed rows.
router.post("/house/food-drive/apply", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const rows = (req.body?.rows || []).filter((r) => r.studentId && Number(r.items) > 0).map((r) => ({ studentId: String(r.studentId), items: Math.round(Number(r.items)) }));
    if (!rows.length) return res.status(400).json({ ok: false, error: "No rows with a matched student and a positive count." });
    const indPts = Array.isArray(req.body?.individual) ? req.body.individual.map(Number) : [30, 20, 10];
    const housePts = Array.isArray(req.body?.house) ? req.body.house.map(Number) : [100, 60, 30];
    const label = String(req.body?.label || "Food Drive").trim() || "Food Drive";
    const at = new Date();

    const ids = rows.map((r) => new mongoose.Types.ObjectId(r.studentId));
    const students = await BehaviorStudent.find({ _id: { $in: ids }, schoolId: req.schoolId }).select("firstName preferredName lastName houseId").lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));

    // House totals (sum of items by each student's house).
    const houseTotalsMap = {};
    for (const r of rows) { const s = sById[r.studentId]; if (!s?.houseId) continue; const k = String(s.houseId); houseTotalsMap[k] = (houseTotalsMap[k] || 0) + r.items; }
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId }).select("name").lean();
    const houseName = Object.fromEntries(houses.map((h) => [String(h._id), h.name]));
    const rankedHouses = Object.entries(houseTotalsMap).map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total);

    const awardedHouses = [];
    for (let i = 0; i < rankedHouses.length && i < housePts.length; i++) {
      const p = Math.round(housePts[i]) || 0;
      if (!p) continue;
      const hid = rankedHouses[i].id;
      await HousePointEvent.create({ schoolId: req.schoolId, houseId: new mongoose.Types.ObjectId(hid), studentId: null, points: p, reason: `${label} — ${["1st","2nd","3rd","4th","5th"][i]||`#${i+1}`} most items (${rankedHouses[i].total})`, awardedByTeacherId: req.membership._id, at });
      awardedHouses.push({ house: houseName[hid] || "—", place: i + 1, points: p, items: rankedHouses[i].total });
    }

    // Top individual donors (regardless of house) → bonus points to their house.
    const rankedStudents = rows.slice().sort((a, b) => b.items - a.items);
    const awardedStudents = [];
    for (let i = 0; i < rankedStudents.length && i < indPts.length; i++) {
      const p = Math.round(indPts[i]) || 0;
      if (!p) continue;
      const r = rankedStudents[i]; const s = sById[r.studentId];
      if (!s?.houseId) continue;
      await HousePointEvent.create({ schoolId: req.schoolId, houseId: s.houseId, studentId: new mongoose.Types.ObjectId(r.studentId), points: p, reason: `${label} — top donor ${["1st","2nd","3rd"][i]||`#${i+1}`} (${r.items} items)`, awardedByTeacherId: req.membership._id, at });
      awardedStudents.push({ name: `${s.preferredName || s.firstName} ${s.lastName}`.trim(), place: i + 1, points: p, items: r.items });
    }

    // Save a celebratory banner for /houses (first name + last initial for the
    // donors — minimal PII on a public wall board), shown for ~2 weeks.
    const bannerStudents = [];
    for (let i = 0; i < rankedStudents.length && i < Math.max(indPts.length, 3); i++) {
      const r = rankedStudents[i]; const s = sById[r.studentId];
      if (!s) continue;
      bannerStudents.push({ name: `${s.preferredName || s.firstName} ${(s.lastName || "").charAt(0)}.`.trim(), place: i + 1, items: r.items });
    }
    const eventResult = {
      label, at,
      houses: awardedHouses.map((h) => ({ name: h.house, place: h.place, items: h.items, points: h.points })),
      students: bannerStudents,
    };
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { houseEventResult: eventResult } });

    await audit(req.schoolId, "house.food_drive", req, { meta: { label, rows: rows.length, houses: awardedHouses.length, donors: awardedStudents.length } });
    res.json({ ok: true, houses: awardedHouses, students: awardedStudents, totalItems: rows.reduce((a, b) => a + b.items, 0) });
  } catch (err) {
    next(err);
  }
});

// Population variance of a list of numbers (for balancing).
function variance(arr) {
  const n = arr.length || 1;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  return arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
}

// Balanced house assignment. Two modes:
//   full (default)     — (re)create the four starter houses, deactivate others,
//                        and reassign ALL active students from scratch.
//   mode:"unassigned"  — keep current assignments + houses; only place students
//                        who have no house, fitting them into the existing
//                        houses to keep things balanced. Siblings (same surname)
//                        join the house their family is already in.
// In both modes families (same last name) stay together and placement greedily
// minimises imbalance across total size, grade spread, and gender mix.
router.post("/houses/backfill", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const onlyUnassigned = req.body?.mode === "unassigned" || req.body?.onlyUnassigned === true;
    const NAMES = Array.isArray(req.body?.names) && req.body.names.length
      ? req.body.names.map((n) => String(n).trim()).filter(Boolean)
      : ["Alpha", "Beta", "Delta", "Gamma"];
    const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

    // Choose the houses to assign into.
    let houses = [];
    let deactivatedCount = 0;
    if (onlyUnassigned) {
      houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).sort({ sortOrder: 1, name: 1 });
      if (!houses.length) {
        for (let i = 0; i < NAMES.length; i++) {
          houses.push(await BehaviorHouse.create({ schoolId: req.schoolId, name: NAMES[i], color: COLORS[i % COLORS.length], sortOrder: i }));
        }
      }
    } else {
      for (let i = 0; i < NAMES.length; i++) {
        const name = NAMES[i];
        let h = await BehaviorHouse.findOne({ schoolId: req.schoolId, name });
        if (!h) h = await BehaviorHouse.create({ schoolId: req.schoolId, name, color: COLORS[i % COLORS.length], sortOrder: i });
        else if (!h.active) { h.active = true; await h.save(); }
        houses.push(h);
      }
      const r = await BehaviorHouse.updateMany(
        { schoolId: req.schoolId, active: true, name: { $nin: NAMES } },
        { $set: { active: false } }
      );
      deactivatedCount = r.modifiedCount;
    }
    const houseIds = houses.map((h) => h._id);
    const idxById = Object.fromEntries(houseIds.map((id, i) => [String(id), i]));
    const K = houseIds.length;

    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true })
      .select("lastName grade gender houseId behaviourConcern sportsSkilled academic")
      .lean();

    const surnameKey = (s) => (s.lastName || "").trim().toLowerCase() || `__solo_${s._id}`;
    const gradeKey = (s) => (String(s.grade || "").trim() || "?");
    const sexKey = (s) => {
      const g = String(s.gender || "").trim().toLowerCase();
      if (g.startsWith("m")) return "M";
      if (g.startsWith("f")) return "F";
      return "U";
    };
    const allGrades = [...new Set(students.map(gradeKey))];
    const tally = (h, s) => {
      h.total++;
      h.grade[gradeKey(s)] = (h.grade[gradeKey(s)] || 0) + 1;
      h.gender[sexKey(s)] = (h.gender[sexKey(s)] || 0) + 1;
      if (s.behaviourConcern) h.concern++;
      if (s.sportsSkilled) h.sports++;
      if (s.academic) h.academic++;
    };

    // Per-house tallies; seed with already-assigned students in unassigned mode
    // so balancing accounts for the current distribution.
    const H = houseIds.map(() => ({ total: 0, grade: {}, gender: {}, concern: 0, sports: 0, academic: 0 }));
    const familyHouse = {}; // surname -> house index a family is already in
    if (onlyUnassigned) {
      for (const s of students) {
        const hi = s.houseId ? idxById[String(s.houseId)] : undefined;
        if (hi != null) {
          tally(H[hi], s);
          const key = surnameKey(s);
          if (familyHouse[key] == null) familyHouse[key] = hi;
        }
      }
    }

    const toAssign = onlyUnassigned
      ? students.filter((s) => !(s.houseId && idxById[String(s.houseId)] != null))
      : students;
    const skipped = students.length - toAssign.length;

    // Group the students-to-assign by surname (families together).
    const fam = new Map();
    for (const s of toAssign) {
      const key = surnameKey(s);
      if (!fam.has(key)) fam.set(key, []);
      fam.get(key).push(s);
    }
    const groups = [...fam.values()].sort((a, b) => b.length - a.length);

    const scoreIfAdded = (hi, group) => {
      const sim = H.map((h) => ({ total: h.total, grade: { ...h.grade }, gender: { ...h.gender }, concern: h.concern, sports: h.sports, academic: h.academic }));
      for (const s of group) {
        sim[hi].total++;
        sim[hi].grade[gradeKey(s)] = (sim[hi].grade[gradeKey(s)] || 0) + 1;
        sim[hi].gender[sexKey(s)] = (sim[hi].gender[sexKey(s)] || 0) + 1;
        if (s.behaviourConcern) sim[hi].concern++;
        if (s.sportsSkilled) sim[hi].sports++;
        if (s.academic) sim[hi].academic++;
      }
      let score = variance(sim.map((x) => x.total)) * 3;
      for (const g of allGrades) score += variance(sim.map((x) => x.grade[g] || 0));
      for (const sx of ["M", "F", "U"]) score += variance(sim.map((x) => x.gender[sx] || 0));
      score += variance(sim.map((x) => x.concern)) * 2;
      score += variance(sim.map((x) => x.sports)) * 2;
      score += variance(sim.map((x) => x.academic)) * 2;
      return score;
    };

    const assignments = [];
    for (const group of groups) {
      const key = surnameKey(group[0]);
      let best;
      if (onlyUnassigned && familyHouse[key] != null) {
        best = familyHouse[key]; // join siblings already placed
      } else {
        best = 0;
        let bestScore = Infinity;
        for (let hi = 0; hi < K; hi++) {
          const sc = scoreIfAdded(hi, group);
          if (sc < bestScore) { bestScore = sc; best = hi; }
        }
      }
      for (const s of group) {
        assignments.push({ updateOne: { filter: { _id: s._id }, update: { $set: { houseId: houseIds[best] } } } });
        tally(H[best], s);
      }
    }

    if (assignments.length) await BehaviorStudent.bulkWrite(assignments);
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });

    const summary = houses.map((h, i) => ({ name: h.name, total: H[i].total, byGrade: H[i].grade, byGender: H[i].gender }));
    await audit(req.schoolId, "houses.backfilled", req, {
      meta: { mode: onlyUnassigned ? "unassigned" : "full", assigned: assignments.length, skipped, deactivated: deactivatedCount },
    });
    res.json({ ok: true, mode: onlyUnassigned ? "unassigned" : "full", assigned: assignments.length, skipped, deactivated: deactivatedCount, houses: summary });
  } catch (err) {
    next(err);
  }
});

// Split each house into two balanced sub-groups (#1 / #2) for booster events that
// need two rooms — balancing grade + gender within the house, keeping siblings
// together. Sets BehaviorStudent.houseGroup (1 or 2).
router.post("/houses/split-groups", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true, houseId: { $ne: null } })
      .select("lastName grade gender houseId behaviourConcern sportsSkilled academic").lean();

    const gradeKey = (s) => String(s.grade || "").trim() || "?";
    const sexKey = (s) => {
      const g = String(s.gender || "").trim().toLowerCase();
      if (g.startsWith("m")) return "M";
      if (g.startsWith("f")) return "F";
      return "U";
    };
    const surnameKey = (s) => (s.lastName || "").trim().toLowerCase() || `__solo_${s._id}`;
    const allGrades = [...new Set(students.map(gradeKey))];

    const updates = [];
    const summary = [];
    // Group students by house.
    const byHouse = new Map();
    for (const s of students) {
      const k = String(s.houseId);
      if (!byHouse.has(k)) byHouse.set(k, []);
      byHouse.get(k).push(s);
    }

    for (const house of houses) {
      const roster = byHouse.get(String(house._id)) || [];
      // Families together → bigger groups placed first (greedy, lowest variance).
      const fam = new Map();
      for (const s of roster) {
        const key = surnameKey(s);
        if (!fam.has(key)) fam.set(key, []);
        fam.get(key).push(s);
      }
      const groups = [...fam.values()].sort((a, b) => b.length - a.length);
      const B = [{ total: 0, grade: {}, gender: {}, concern: 0, sports: 0, academic: 0 }, { total: 0, grade: {}, gender: {}, concern: 0, sports: 0, academic: 0 }];
      const score = (bi, group) => {
        const sim = B.map((b) => ({ total: b.total, grade: { ...b.grade }, gender: { ...b.gender }, concern: b.concern, sports: b.sports, academic: b.academic }));
        for (const s of group) {
          sim[bi].total++;
          sim[bi].grade[gradeKey(s)] = (sim[bi].grade[gradeKey(s)] || 0) + 1;
          sim[bi].gender[sexKey(s)] = (sim[bi].gender[sexKey(s)] || 0) + 1;
          if (s.behaviourConcern) sim[bi].concern++;
          if (s.sportsSkilled) sim[bi].sports++;
          if (s.academic) sim[bi].academic++;
        }
        let sc = variance(sim.map((x) => x.total)) * 3;
        for (const g of allGrades) sc += variance(sim.map((x) => x.grade[g] || 0));
        for (const sx of ["M", "F", "U"]) sc += variance(sim.map((x) => x.gender[sx] || 0));
        sc += variance(sim.map((x) => x.concern)) * 2;
        sc += variance(sim.map((x) => x.sports)) * 2;
        sc += variance(sim.map((x) => x.academic)) * 2;
        return sc;
      };
      for (const group of groups) {
        const bi = score(0, group) <= score(1, group) ? 0 : 1;
        for (const s of group) {
          updates.push({ updateOne: { filter: { _id: s._id }, update: { $set: { houseGroup: bi + 1 } } } });
          B[bi].total++;
          B[bi].grade[gradeKey(s)] = (B[bi].grade[gradeKey(s)] || 0) + 1;
          B[bi].gender[sexKey(s)] = (B[bi].gender[sexKey(s)] || 0) + 1;
          if (s.behaviourConcern) B[bi].concern++;
          if (s.sportsSkilled) B[bi].sports++;
          if (s.academic) B[bi].academic++;
        }
      }
      summary.push({
        name: house.name,
        group1: { total: B[0].total, byGrade: B[0].grade, byGender: B[0].gender, room: house.roomGroup1 || "" },
        group2: { total: B[1].total, byGrade: B[1].grade, byGender: B[1].gender, room: house.roomGroup2 || "" },
      });
    }

    if (updates.length) await BehaviorStudent.bulkWrite(updates);
    await audit(req.schoolId, "houses.split_groups", req, { meta: { students: updates.length, houses: houses.length } });
    res.json({ ok: true, students: updates.length, houses: summary });
  } catch (err) {
    next(err);
  }
});

// House standings report: each house's running total + its TOP 3 contributing
// students (by positive points earned). Returns the data for an in-app preview
// and, when { email: true }, sends it as an HTML standings email.
router.post("/house-report", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).lean();
    const resetAt = config?.housePointsResetAt ? new Date(config.housePointsResetAt) : null;
    const sinceMatch = resetAt ? { at: { $gt: resetAt } } : {};

    // House totals (all events, +/-), with per-student caps applied.
    const totalById = await houseTotals(req.schoolId, config);

    // Top contributors: POSITIVE points only, summed per (house, student),
    // globally sorted so the first 3 seen per house are its top 3.
    const contribAgg = await HousePointEvent.aggregate([
      { $match: { schoolId: req.schoolId, points: { $gt: 0 }, studentId: { $ne: null }, ...sinceMatch } },
      { $group: { _id: { houseId: "$houseId", studentId: "$studentId" }, points: { $sum: "$points" } } },
      { $sort: { points: -1 } },
    ]);
    const studentIds = [...new Set(contribAgg.map((c) => String(c._id.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: studentIds } })
      .select("firstName lastName preferredName")
      .lean();
    const nameById = Object.fromEntries(
      students.map((s) => [String(s._id), `${s.preferredName || s.firstName} ${s.lastName}`.trim()])
    );
    const topByHouse = {};
    for (const c of contribAgg) {
      const hid = String(c._id.houseId);
      topByHouse[hid] = topByHouse[hid] || [];
      if (topByHouse[hid].length < 3) {
        topByHouse[hid].push({ name: nameById[String(c._id.studentId)] || "Student", points: c.points });
      }
    }

    // House captains.
    const captainDocs = await BehaviorStudent.find({ schoolId: req.schoolId, active: true, houseCaptain: true, houseId: { $ne: null } })
      .select("firstName preferredName lastName houseId")
      .lean();
    const captainsByHouse = {};
    for (const c of captainDocs) {
      const k = String(c.houseId);
      (captainsByHouse[k] ||= []).push(`${c.preferredName || c.firstName} ${c.lastName || ""}`.trim());
    }

    const report = houses
      .map((h) => ({
        _id: String(h._id),
        name: h.name,
        color: h.color || "#0f172a",
        image: h.image || "",
        points: totalById[String(h._id)] || 0,
        top: topByHouse[String(h._id)] || [],
        captains: captainsByHouse[String(h._id)] || [],
      }))
      .sort((a, b) => b.points - a.points);

    const max = Math.max(1, ...report.map((h) => Math.abs(h.points)));
    const rows = report
      .map((h, i) => {
        const w = Math.max(2, Math.round((Math.abs(h.points) / max) * 100));
        const top = h.top.length
          ? h.top.map((t, j) => `${j + 1}. ${escapeHtml(t.name)} (${t.points})`).join(" &middot; ")
          : "&mdash;";
        return (
          `<div style="margin:12px 0">` +
          `<div style="display:flex;align-items:center;gap:8px">` +
          (h.image
            ? `<img src="${h.image}" width="20" height="20" style="border-radius:4px;object-fit:cover;vertical-align:middle"/>`
            : `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${h.color}"></span>`) +
          `<strong>${i + 1}. ${escapeHtml(h.name)}</strong>` +
          (h.captains.length ? `<span style="font-size:11px;color:#94a3b8">© ${escapeHtml(h.captains.join(", "))}</span>` : "") +
          `<span style="margin-left:auto;font-variant-numeric:tabular-nums;color:#0f172a">${h.points} pts</span>` +
          `</div>` +
          `<div style="background:#f1f5f9;border-radius:4px;height:8px;margin:5px 0"><div style="background:${h.color};height:8px;border-radius:4px;width:${w}%"></div></div>` +
          `<div style="font-size:12px;color:#475569">Top contributors: ${top}</div>` +
          `</div>`
        );
      })
      .join("");
    const html = emailShell({
      title: "House standings",
      schoolName: config?.branding?.schoolName || "Compass",
      preheader: "Current house point standings.",
      accent: "#16a34a",
      contentHtml: rows || "<p style='color:#94a3b8'>No houses defined yet.</p>",
    });

    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const to = config?.houseReport?.recipientEmail || req.user.email;
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      const text = report
        .map((h, i) => `${i + 1}. ${h.name}: ${h.points} pts — top: ${h.top.map((t) => `${t.name} (${t.points})`).join(", ") || "—"}`)
        .join("\n");
      try {
        await sendEmail({
          from: fromAddr ? { name: "Compass", address: fromAddr } : undefined,
          to,
          subject: `House standings — ${config?.branding?.schoolName || "Compass"}`,
          text,
          html,
        });
        emailed = true;
      } catch (e) {
        emailError = e?.message || String(e);
      }
    }

    await audit(req.schoolId, "house_report.generated", req, { meta: { emailed } });
    res.json({ ok: true, report, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// ── House competitions (Sept–June calendar) ─────────────────────────────────

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// List the competition calendar with each event's results mapped to houses.
router.get("/competitions", authAny, loadMembership, async (req, res, next) => {
  try {
    const comps = await BehaviorCompetition.find({ schoolId: req.schoolId, active: true }).sort({ monthOrder: 1, createdAt: 1 }).lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).select("name color").lean();
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));
    const out = comps.map((c) => ({
      _id: String(c._id),
      name: c.name,
      description: c.description,
      monthOrder: c.monthOrder,
      monthLabel: c.monthLabel,
      placementPoints: c.placementPoints,
      scoredAt: c.scoredAt,
      results: (c.results || [])
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((r) => ({
          place: r.place,
          houseId: String(r.houseId),
          houseName: houseById[String(r.houseId)]?.name || "",
          houseColor: houseById[String(r.houseId)]?.color || "#0f172a",
          points: c.placementPoints[r.place - 1] || 0,
        })),
    }));
    res.json({ ok: true, competitions: out });
  } catch (err) {
    next(err);
  }
});

// Seed the default Sept–June calendar (upsert: only adds the events that are
// missing, so it's safe to run again).
router.post("/competitions/seed", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const DEFAULTS = [
      { monthOrder: 0, monthLabel: "September", name: "Spirit Week" },
      { monthOrder: 1, monthLabel: "October", name: "Quiz Bowl" },
      { monthOrder: 2, monthLabel: "November", name: "Food Drive" },
      { monthOrder: 3, monthLabel: "December", name: "Choir / Christmas Concert" },
      { monthOrder: 4, monthLabel: "January", name: "STEM Day" },
      { monthOrder: 5, monthLabel: "February", name: "Kindness Marathon" },
      { monthOrder: 6, monthLabel: "March", name: "Trivia Challenge" },
      { monthOrder: 7, monthLabel: "April", name: "Mini-Olympics" },
      { monthOrder: 8, monthLabel: "May", name: "Arts Festival" },
      { monthOrder: 9, monthLabel: "June", name: "Field Day" },
    ];
    let created = 0;
    for (const d of DEFAULTS) {
      const exists = await BehaviorCompetition.findOne({ schoolId: req.schoolId, name: d.name, active: true });
      if (!exists) {
        await BehaviorCompetition.create({ schoolId: req.schoolId, ...d, placementPoints: [500, 300, 200, 100] });
        created += 1;
      }
    }
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });
    await audit(req.schoolId, "competitions.seeded", req, { meta: { created } });
    res.json({ ok: true, created });
  } catch (err) {
    next(err);
  }
});

// Create or edit a competition.
router.post("/competitions", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const placementPoints = Array.isArray(b.placementPoints) && b.placementPoints.length
      ? b.placementPoints.map((n) => Number(n) || 0)
      : [500, 300, 200, 100];
    if (b._id) {
      const comp = await BehaviorCompetition.findOne({ _id: b._id, schoolId: req.schoolId });
      if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
      comp.name = name;
      comp.description = String(b.description || "");
      if (typeof b.monthOrder === "number") comp.monthOrder = b.monthOrder;
      if (b.monthLabel != null) comp.monthLabel = String(b.monthLabel);
      comp.placementPoints = placementPoints;
      await comp.save();
      return res.json({ ok: true, competition: comp });
    }
    const comp = await BehaviorCompetition.create({
      schoolId: req.schoolId, name, description: String(b.description || ""),
      monthOrder: Number(b.monthOrder) || 0, monthLabel: String(b.monthLabel || ""), placementPoints,
    });
    res.json({ ok: true, competition: comp });
  } catch (err) {
    next(err);
  }
});

// Score a competition: set placements + award (capped) placement points to the
// houses. Idempotent — re-scoring deletes the prior award and re-applies.
router.post("/competitions/:id/score", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const comp = await BehaviorCompetition.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
    const raw = Array.isArray(req.body?.results) ? req.body.results : [];
    const validHouses = new Set(
      (await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).select("_id").lean()).map((h) => String(h._id))
    );
    const results = raw
      .map((r) => ({ houseId: r.houseId, place: Number(r.place) }))
      .filter((r) => r.houseId && validHouses.has(String(r.houseId)) && r.place >= 1);

    // Re-award cleanly.
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, competitionId: comp._id });
    const events = results
      .map((r) => ({
        schoolId: req.schoolId, houseId: r.houseId, points: comp.placementPoints[r.place - 1] || 0,
        reason: `${comp.name} — ${ordinal(r.place)} place`, competitionId: comp._id, awardedByTeacherId: req.membership._id,
      }))
      .filter((e) => e.points);
    if (events.length) await HousePointEvent.insertMany(events);

    comp.results = results;
    comp.scoredAt = new Date();
    await comp.save();
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });
    await audit(req.schoolId, "competition.scored", req, { meta: { name: comp.name, awarded: events.length } });
    res.json({ ok: true, awarded: events.reduce((s, e) => s + e.points, 0) });
  } catch (err) {
    next(err);
  }
});

// Remove a competition + reverse its awarded points.
router.delete("/competitions/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const comp = await BehaviorCompetition.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, competitionId: comp._id });
    await audit(req.schoolId, "competition.removed", req, { meta: { name: comp.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Generate (or rotate) the 4-digit student-portal code (admin). Returned once;
// share it with students. Unique across schools.
router.post("/houses/portal-code", authAny, loadMembership, canManageHouses, async (req, res, next) => {
  try {
    let code = "";
    const wanted = String(req.body?.code || "").trim();
    if (wanted) {
      // Custom code: 3–6 digits, not already used by another school.
      if (!/^\d{3,6}$/.test(wanted)) return res.status(400).json({ ok: false, error: "Code must be 3–6 digits." });
      const taken = await BehaviorConfig.findOne({ housePortalCode: wanted, schoolId: { $ne: req.schoolId } }).select("_id").lean();
      if (taken) return res.status(409).json({ ok: false, error: "That code is taken by another school — pick another." });
      code = wanted;
    } else {
      // Auto: random unique 4-digit.
      for (let attempt = 0; attempt < 20; attempt++) {
        const c = String(1000 + (crypto.randomBytes(2).readUInt16BE(0) % 9000));
        const t = await BehaviorConfig.findOne({ housePortalCode: c, schoolId: { $ne: req.schoolId } }).select("_id").lean();
        if (!t) { code = c; break; }
      }
      if (!code) return res.status(500).json({ ok: false, error: "Could not allocate a code — try again" });
    }
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housePortalCode: code, housesEnabled: true } });
    await audit(req.schoolId, "houses.portal_code", req, {});
    res.json({ ok: true, code });
  } catch (err) {
    next(err);
  }
});

// ── Public student portal (no auth) — house standings only, never PII ────────

// Public house standings + competition results, gated by the 4-digit code so the
// portal isn't openly browseable. House-level only — no student data.
router.get("/public/houses", async (req, res, next) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!/^\d{3,6}$/.test(code)) return res.status(400).json({ ok: false, error: "Enter your school code." });
    const config = await BehaviorConfig.findOne({ housePortalCode: code, housesEnabled: true }).select("schoolId housePointsResetAt houseNegativeResetAt housesPublicShowNegatives housesPublicShowPositives houseCaps houseRewards merchStore houseEventResult").lean();
    if (!config) return res.status(404).json({ ok: false, error: "No school matches that code." });
    const schoolId = config.schoolId;
    const sid = new mongoose.Types.ObjectId(schoolId);
    const school = await BehaviorSchool.findById(schoolId).select("name").lean();

    const houses = await BehaviorHouse.find({ schoolId, active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const pointMatch = { schoolId: sid };
    if (config.housePointsResetAt) pointMatch.at = { $gt: new Date(config.housePointsResetAt) };
    // Students see a positive standings board unless the school opts to show
    // conduct deductions publicly.
    const totalById = await houseTotals(sid, config, { positivesOnly: config.housesPublicShowNegatives !== true });
    // Only currently-enrolled students appear in the per-student displays —
    // graduated/withdrawn (deactivated) students keep their history but drop off
    // the leaderboards. Also track each active student's CURRENT house so points
    // earned before a (re)assignment resolve to the right house today.
    const activeStudents = await BehaviorStudent.find({ schoolId: sid, active: true }).select("_id houseId").lean();
    const activeIds = activeStudents.map((s) => s._id);
    const activeIdSet = new Set(activeIds.map((id) => String(id)));
    const houseByStudent = Object.fromEntries(activeStudents.map((s) => [String(s._id), s.houseId ? String(s.houseId) : null]));
    const members = await BehaviorStudent.aggregate([
      { $match: { schoolId: sid, active: true, houseId: { $ne: null } } },
      { $group: { _id: "$houseId", n: { $sum: 1 } } },
    ]);
    const memberById = Object.fromEntries(members.map((m) => [String(m._id), m.n]));
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));

    // PUBLIC PAGE RULE: no student data of any kind — no names, initials or
    // photos (captains, top students, contributors). Composite totals only.
    const houseOut = houses
      .map((h) => ({
        id: String(h._id), name: h.name, color: h.color || "#0f172a", image: h.image || "",
        points: totalById[String(h._id)] || 0, members: memberById[String(h._id)] || 0,
      }))
      .sort((a, b) => b.points - a.points);

    const comps = await BehaviorCompetition.find({ schoolId, active: true }).sort({ monthOrder: 1 }).lean();
    const compOut = comps.map((c) => ({
      name: c.name,
      monthLabel: c.monthLabel,
      scored: !!c.scoredAt,
      results: (c.results || [])
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((r) => ({ place: r.place, houseName: houseById[String(r.houseId)]?.name || "", houseColor: houseById[String(r.houseId)]?.color || "#0f172a" })),
    }));

    // Recent point activity — last ~12 POSITIVE awards (no deductions, no names).
    // Exclude awards to students no longer on the roster (graduated students'
    // canned reasons looked like duplicates of current students'), and resolve
    // each award's house from the student's CURRENT assignment when the stored
    // one is stale (e.g. points earned before a house (re)assignment).
    const recentRaw = await HousePointEvent.find({ ...pointMatch, points: { $gt: 0 } })
      .sort({ at: -1 }).limit(40).select("houseId studentId points reason at").lean();
    const activity = [];
    const scrub = await publicNameScrubber(sid);
    for (const e of recentRaw) {
      if (e.studentId && !activeIdSet.has(String(e.studentId))) continue; // not on the roster
      let hid = e.houseId && houseById[String(e.houseId)] ? String(e.houseId) : null;
      if (!hid && e.studentId) { const cur = houseByStudent[String(e.studentId)]; if (cur && houseById[cur]) hid = cur; }
      if (!hid) continue;
      const h = houseById[hid];
      activity.push({ house: h.name, color: h.color || "#0f172a", points: e.points, reason: scrub(e.reason || ""), at: e.at });
      if (activity.length >= 12) break;
    }

    // Daily winner (today): the house that earned the most net points since
    // local midnight. (No "top student" — the public page shows no student data.)
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const topHouseAgg = await HousePointEvent.aggregate([
      { $match: { schoolId: sid, at: { $gt: dayStart } } },
      { $group: { _id: "$houseId", pts: { $sum: "$points" } } },
      { $sort: { pts: -1 } }, { $limit: 1 },
    ]);
    let dailyTopHouse = null;
    if (topHouseAgg[0] && houseById[String(topHouseAgg[0]._id)]) {
      const h = houseById[String(topHouseAgg[0]._id)];
      dailyTopHouse = { name: h.name, color: h.color || "#0f172a", image: h.image || "", points: topHouseAgg[0].pts };
    }
    const rewards = (config.houseRewards || []).slice().sort((a, b) => a.points - b.points);

    const merch = config.merchStore?.enabled
      ? (config.merchStore.items || []).slice().sort((a, b) => (a.points || 0) - (b.points || 0)).map((i) => ({ name: i.name, points: i.points, image: i.image || "" }))
      : [];
    // Latest tally-event banner — shown for ~14 days after upload.
    let eventResult = null;
    const er = config.houseEventResult;
    if (er?.at && Date.now() - new Date(er.at).getTime() < 14 * DAY_MS) {
      // Houses only — top contributors' names stay staff-side (Tally import page).
      eventResult = { label: er.label || "Results", at: er.at, houses: er.houses || [], students: [] };
    }
    res.json({ ok: true, enabled: true, schoolName: school?.name || "", houses: houseOut, competitions: compOut, activity, dailyTopStudent: null, dailyTopHouse, topStudents: [], rewards, merch, eventResult });
  } catch (err) {
    next(err);
  }
});

// Student self-lookup ("Find your house") was REMOVED on purpose (2026-10-05):
// even an exact-name lookup shows the public page holds student names. The
// public portal takes no student input and returns no student data. Old clients
// get a plain 410.
router.get("/public/houses/lookup", (req, res) => {
  res.status(410).json({ ok: false, error: "This feature has been removed. Ask your homeroom teacher which house you’re in." });
});

// Visit beacon for the House Standings portal. The public page fires this once
// per browser tab session (not on its 30s auto-refresh), so one row per school
// per local day tallies how many people opened the standings. Code-gated so it
// only counts real portal opens; failures are swallowed (never block the page).
router.post("/public/houses/visit", async (req, res) => {
  try {
    const code = String(req.query.code || req.body?.code || "").trim();
    if (!/^\d{3,6}$/.test(code)) return res.json({ ok: true }); // ignore junk, never error the page
    const config = await BehaviorConfig.findOne({ housePortalCode: code, housesEnabled: true }).select("schoolId").lean();
    if (!config) return res.json({ ok: true });
    const day = new Date(); day.setHours(0, 0, 0, 0);
    await HousesVisit.updateOne({ schoolId: config.schoolId, day }, { $inc: { views: 1 } }, { upsert: true });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

// Public per-house point breakdown — powers "tap a house to see where its
// points came from". Strictly composite: points are grouped by reason and split
// into individual Compass points (studentId set — good/bad behaviour) vs team &
// house events (whole-house awards, studentId null). NEVER returns any student
// name — only summed totals and per-reason lines, mirroring the leaderboard's
// active-student + reset-date scope.
// Public pages show no student data. Point "reasons" can be free text typed by
// a teacher (manual awards), so before a reason goes to a public page, replace
// any roster name in it (first, preferred or last, plus a trailing initial like
// "Mia A.") with "a student". Words that are also behaviour / keyword / house /
// competition names (e.g. "Faith", "Joy") are left alone so reasons still read.
async function publicNameScrubber(schoolId) {
  return rosterNameScrubber(schoolId);
}

// Family-facing messages are about ONE student; any OTHER student named in a
// teacher's private note (who reported it, a witness, a target) must never reach
// that family. Same matcher as the public scrubber, but the subject student's
// own names are left alone. `.mentions(text)` tells whether a name was present.
async function familyNameScrubber(schoolId, subjectStudentId) {
  return rosterNameScrubber(schoolId, { exceptStudentId: subjectStudentId, replacement: "another student" });
}

async function rosterNameScrubber(schoolId, { exceptStudentId = null, replacement = "a student" } = {}) {
  const sid = new mongoose.Types.ObjectId(String(schoolId));
  const [students, behaviours, houses, comps] = await Promise.all([
    BehaviorStudent.find({ schoolId: sid }).select("firstName preferredName lastName").lean(),
    Behavior.find({ schoolId: sid }).select("name keyword").lean(),
    BehaviorHouse.find({ schoolId: sid }).select("name").lean(),
    BehaviorCompetition.find({ schoolId: sid }).select("name").lean(),
  ]);
  const words = (v) => String(v || "").toLowerCase().split(/[^\p{L}'’-]+/u).filter(Boolean);
  const keep = new Set();
  for (const b of behaviours) { words(b.name).forEach((w) => keep.add(w)); words(b.keyword).forEach((w) => keep.add(w)); }
  for (const h of houses) words(h.name).forEach((w) => keep.add(w));
  for (const c of comps) words(c.name).forEach((w) => keep.add(w));
  // The subject student's own name words are never scrubbed.
  if (exceptStudentId) {
    const me = students.find((st) => String(st._id) === String(exceptStudentId));
    if (me) for (const n of [me.firstName, me.preferredName, me.lastName]) words(n).forEach((w) => keep.add(w));
  }
  const names = new Set();
  for (const st of students) {
    if (exceptStudentId && String(st._id) === String(exceptStudentId)) continue;
    for (const n of [st.firstName, st.preferredName, st.lastName]) {
      for (const w of words(n)) if (w.length >= 2 && !keep.has(w)) names.add(w);
    }
  }
  if (!names.size) { const id = (r) => String(r || ""); id.mentions = () => false; return id; }
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alt = [...names].sort((a, b) => b.length - a.length).map(esc).join("|");
  // A name, optionally followed by more name words and/or an initial ("A.").
  const rx = new RegExp(`(?<![\\p{L}])(?:${alt})(?:\\s+(?:${alt}))*(?:\\s+\\p{L}\\.)?(?![\\p{L}])`, "giu");
  const test = new RegExp(rx.source, "iu");
  const fn = (text) => String(text || "").replace(rx, replacement);
  fn.mentions = (text) => test.test(String(text || ""));
  return fn;
}

// Did the teacher LEARN of this second-hand (vs. witness it)? A note that names
// another student or uses reporting language. Such incidents are written
// tentatively to the family ("I suspect … may have", "Unless my information is
// inaccurate, … is required to …") and never say who reported it.
const REPORTED_RX = /\b(report(?:ed|s|ing)?|told me|informed|heard|overheard|said that|according to|claim(?:ed|s)?|apparently|allegedly|witness(?:ed)?)\b/i;
function prepareFamilyDetail(scrub, detail) {
  const raw = String(detail || "");
  const mentionedOther = !!scrub?.mentions?.(raw);
  return { detail: scrub ? scrub(raw) : raw, mentionedOther, reported: mentionedOther || REPORTED_RX.test(raw) };
}

// Rules every family-facing AI message follows (consequence messages, notices).
const FAMILY_PRIVACY_RULES =
  `PRIVACY (overrides everything): Never name, describe, or hint at any OTHER student — not who reported it, who saw it, or who was affected — and never say how the teacher found out (no "I was informed by…", "a student reported…", "I received a report…"). ` +
  `Never quote slurs or crude words; describe them sensitively.`;
const REPORTED_RULE = (first) =>
  `This concern was REPORTED to the teacher, not witnessed first-hand. Word it tentatively — e.g. "I have reason to believe that ${first} may have…" or "I suspect that ${first} may have…" — and introduce the task with "Unless my information is inaccurate, ${first} is required to…". Do not mention the source. ` +
  `Keep the setting broad: say "at school" (and "our school" rather than "our classroom") unless the teacher's note says exactly where it happened — never assume it was in class.`;

// Composite breakdown of where a house's points came from (NEVER any names).
// `includeNegatives`/`includePositives` gate what's returned: the public page
// hides conduct (negatives) from students by default; a teacher sees it all.
async function computeHouseDetail(sid, houseId, cfg, { includeNegatives = true, includePositives = true, scrubNames = false } = {}) {
  const house = await BehaviorHouse.findOne({ _id: houseId, schoolId: sid }).select("name color").lean();
  if (!house) return null;
  const activeIds = (await BehaviorStudent.find({ schoolId: sid, active: true }).select("_id").lean()).map((s) => s._id);
  const match = { schoolId: sid, houseId: new mongoose.Types.ObjectId(String(houseId)), $or: [{ studentId: null }, { studentId: { $in: activeIds } }] };
  if (cfg?.housePointsResetAt) match.at = { $gt: new Date(cfg.housePointsResetAt) };
  // Honour "reset negatives only": drop negative events on/before the cutoff.
  if (cfg?.houseNegativeResetAt) {
    (match.$and ||= []).push({ $or: [{ points: { $gte: 0 } }, { at: { $gt: new Date(cfg.houseNegativeResetAt) } } ] });
  }

  const rows = await HousePointEvent.aggregate([
    { $match: match },
    { $group: {
      _id: { team: { $eq: ["$studentId", null] }, reason: { $ifNull: ["$reason", ""] } },
      points: { $sum: "$points" },
      count: { $sum: 1 },
    } },
  ]);

  const indMap = {}, teamMap = {};
  let indPos = 0, indNeg = 0, teamTotal = 0;
  const scrub = scrubNames ? await publicNameScrubber(sid) : (x) => x;
  for (const r of rows) {
    const reason = scrub((r._id.reason || "").trim()) || "Other";
    if (r._id.team) {
      teamMap[reason] = (teamMap[reason] || { reason, points: 0, count: 0 });
      teamMap[reason].points += r.points; teamMap[reason].count += r.count;
      teamTotal += r.points;
    } else {
      indMap[reason] = (indMap[reason] || { reason, points: 0, count: 0 });
      indMap[reason].points += r.points; indMap[reason].count += r.count;
      if (r.points >= 0) indPos += r.points; else indNeg += r.points;
    }
  }
  const byImpact = (a, b) => Math.abs(b.points) - Math.abs(a.points);
  // Filter the per-reason items by sign per the viewer's permissions.
  let individualItems = Object.values(indMap)
    .filter((it) => (it.points >= 0 ? includePositives : includeNegatives))
    .sort(byImpact);
  let teamItems = Object.values(teamMap)
    .filter((it) => (it.points >= 0 ? includePositives : includeNegatives))
    .sort(byImpact);
  const shownPos = includePositives ? indPos : 0;
  const shownNeg = includeNegatives ? indNeg : 0;
  const individualTotal = shownPos + shownNeg;
  const teamShown = teamItems.reduce((a, it) => a + it.points, 0);

  return {
    house: { id: String(house._id), name: house.name, color: house.color || "#0f172a" },
    total: individualTotal + teamShown,
    individual: { total: individualTotal, positive: shownPos, negative: shownNeg, items: individualItems },
    team: { total: teamShown, items: teamItems },
  };
}

router.get("/public/houses/detail", async (req, res, next) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!/^\d{3,6}$/.test(code)) return res.status(400).json({ ok: false, error: "Enter your school code." });
    const houseId = String(req.query.houseId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(houseId)) return res.status(400).json({ ok: false, error: "Bad house." });
    const config = await BehaviorConfig.findOne({ housePortalCode: code, housesEnabled: true })
      .select("schoolId housePointsResetAt houseNegativeResetAt housesPublicShowPositives housesPublicShowNegatives").lean();
    if (!config) return res.status(404).json({ ok: false, error: "No school matches that code." });
    const sid = new mongoose.Types.ObjectId(config.schoolId);
    // Student-facing: conduct (negatives) hidden unless the school opts in.
    const includeNegatives = config.housesPublicShowNegatives === true;
    const includePositives = config.housesPublicShowPositives !== false;
    const detail = await computeHouseDetail(sid, houseId, config, { includeNegatives, includePositives, scrubNames: true });
    if (!detail) return res.status(404).json({ ok: false, error: "House not found." });
    res.json({ ok: true, ...detail, teacherView: false });
  } catch (err) {
    next(err);
  }
});

// Authenticated teacher view of the same breakdown — always full (positives AND
// negatives), with a teacherView flag so the UI can note students don't see the
// negative detail. Used by the /houses page when a teacher is logged in.
router.get("/houses/detail", authAny, loadMembership, async (req, res, next) => {
  try {
    const houseId = String(req.query.houseId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(houseId)) return res.status(400).json({ ok: false, error: "Bad house." });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("housePointsResetAt houseNegativeResetAt").lean();
    const detail = await computeHouseDetail(new mongoose.Types.ObjectId(String(req.schoolId)), houseId, config || {}, { includeNegatives: true, includePositives: true });
    if (!detail) return res.status(404).json({ ok: false, error: "House not found." });
    res.json({ ok: true, ...detail, teacherView: true });
  } catch (err) {
    next(err);
  }
});

// Curriculate-internal: House Standings portal traffic, for the admin dashboard.
// Guarded by the shared ADMIN_API_TOKEN (x-admin-token), same as other internal
// admin stats. Returns totals + a 14-day daily series and a per-school split.
router.get("/admin/houses-visits", requireAdminToken, async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d7 = new Date(today); d7.setDate(d7.getDate() - 6);
    const d30 = new Date(today); d30.setDate(d30.getDate() - 29);
    const d14 = new Date(today); d14.setDate(d14.getDate() - 13);

    const [all, schools] = await Promise.all([
      HousesVisit.find({}).select("schoolId day views").lean(),
      BehaviorSchool.find({}).select("name").lean(),
    ]);
    const nameById = Object.fromEntries(schools.map((s) => [String(s._id), s.name || ""]));

    let total = 0, todayN = 0, last7 = 0, last30 = 0;
    const seriesMap = {};       // dayKey -> views (last 14 days)
    const bySchoolMap = {};     // schoolId -> total views
    for (const r of all) {
      const v = r.views || 0;
      total += v;
      bySchoolMap[String(r.schoolId)] = (bySchoolMap[String(r.schoolId)] || 0) + v;
      const dt = new Date(r.day);
      if (dt >= today) todayN += v;
      if (dt >= d7) last7 += v;
      if (dt >= d30) last30 += v;
      if (dt >= d14) {
        const key = dt.toISOString().slice(0, 10);
        seriesMap[key] = (seriesMap[key] || 0) + v;
      }
    }
    // Dense 14-day series (zero-filled) so the chart doesn't skip quiet days.
    const series = [];
    for (let i = 0; i < 14; i++) {
      const dt = new Date(d14); dt.setDate(dt.getDate() + i);
      const key = dt.toISOString().slice(0, 10);
      series.push({ day: key, views: seriesMap[key] || 0 });
    }
    const bySchool = Object.entries(bySchoolMap)
      .map(([id, views]) => ({ school: nameById[id] || "—", views }))
      .sort((a, b) => b.views - a.views);

    res.json({ ok: true, total, today: todayN, last7, last30, series, bySchool });
  } catch (err) {
    next(err);
  }
});

// ── Honour roll (weighted averages from Edsby) — backs the /avgs panel ───────
router.use("/avgs", authAny, loadMembership, buildAvgsRouter({ requireAdmin }));

// ── Homework tab ─────────────────────────────────────────────────────────────
// Assignments per class with tap-to-score completion, Formal Discussion live
// scoring, category averages, "fallen behind" posting, and CSV export.

const round1 = (n) => Math.round(n * 10) / 10;

// Single-tap auto score for homework/work, by how late it's shown:
//   ≤3 days → full · >3 days → 72% · older than lateWeeks → 62% (do-half rule).
function autoHomeworkScore(assignment, config, prefs) {
  const denom = assignment.denom || 10;
  const ageDays = Math.floor((Date.now() - new Date(assignment.date).getTime()) / DAY_MS);
  // The scoring teacher's own "older than" weeks if set, else the school default.
  const lateWeeks = (prefs?.lateWeeks ?? null) != null ? prefs.lateWeeks : (config?.homework?.lateWeeks ?? 3);
  if (ageDays <= 3) return round1(denom);
  if (ageDays <= lateWeeks * 7) return round1(denom * 0.72);
  return round1(denom * 0.62);
}

// Score out of 10 for a Formal Discussion from +/- tallies (baseline 5 on the
// first +). Absent → null (excused). No participation → null.
function discussionScore({ plus = 0, minus = 0, absent = false }) {
  if (absent) return null;
  if (plus <= 0) return null;
  return Math.max(0, Math.min(10, round1(4 + plus - minus)));
}

// Earliest date whose outstanding work we still surface: the start of the
// PREVIOUS term (so Term 3 reaches back to Term 2). Epoch if terms aren't set.
function outstandingCutoff(config) {
  const ts = (config?.homework?.termStarts || []).map((d) => new Date(d)).sort((a, b) => a - b);
  if (!ts.length) return new Date(0);
  const cur = config?.homework?.currentTerm ?? 0;
  return ts[Math.max(0, cur - 1)] || new Date(0);
}

// Append a subject to the shared list (any teacher may add one).
router.post("/homework/subjects", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const subject = String(req.body?.subject || "").trim();
    if (!subject) return res.status(400).json({ ok: false, error: "Subject required." });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId });
    if (!config) return res.status(404).json({ ok: false, error: "No config" });
    const list = config.homework?.subjects || [];
    if (!list.some((s) => s.toLowerCase() === subject.toLowerCase())) {
      config.homework = config.homework || {};
      config.homework.subjects = [...list, subject];
      await config.save();
    }
    res.json({ ok: true, subjects: config.homework.subjects });
  } catch (err) {
    next(err);
  }
});

// Create an assignment for a class.
router.post("/homework/assignments", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const b = req.body || {};
    const classGroup = String(b.classGroup || "").trim();
    if (!classGroup) return res.status(400).json({ ok: false, error: "Pick a class." });
    const type = ["homework", "work", "discussion"].includes(b.type) ? b.type : "homework";
    const date = b.date ? new Date(b.date) : new Date();
    const a = await HomeworkAssignment.create({
      schoolId: req.schoolId,
      teacherId: req.membership._id,
      classGroup,
      subject: String(b.subject || "").trim(),
      type,
      description: String(b.description || "").trim(),
      denom: Number(b.denom) > 0 ? Number(b.denom) : 10,
      date: isNaN(date.getTime()) ? new Date() : date,
    });
    res.json({ ok: true, assignment: a.toObject() });
  } catch (err) {
    next(err);
  }
});

router.delete("/homework/assignments/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const a = await HomeworkAssignment.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!a) return res.status(404).json({ ok: false, error: "Not found" });
    if (req.membership.role !== "originator" && req.membership.role !== "admin" && String(a.teacherId) !== String(req.membership._id)) {
      return res.status(403).json({ ok: false, error: "Only the teacher who created it (or an admin) can delete it." });
    }
    await HomeworkScore.deleteMany({ assignmentId: a._id });
    await HomeworkAssignment.deleteOne({ _id: a._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// All assignments + scores + roster for one class (the grading grid).
router.get("/homework/class/:classGroup", authAny, loadMembership, async (req, res, next) => {
  try {
    const classGroup = String(req.params.classGroup || "").trim();
    const assignments = await HomeworkAssignment.find({ schoolId: req.schoolId, classGroup }).sort({ date: -1 }).lean();
    const students = await BehaviorStudent.find({ schoolId: req.schoolId, classGroup, active: true })
      .select("firstName lastName preferredName externalId")
      .sort({ lastName: 1, firstName: 1 })
      .lean();
    const aIds = assignments.map((a) => a._id);
    const scores = aIds.length ? await HomeworkScore.find({ assignmentId: { $in: aIds } }).lean() : [];
    res.json({
      ok: true,
      assignments,
      students: students.map((s) => ({ _id: String(s._id), name: `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim(), lastName: s.lastName, firstName: s.firstName, externalId: s.externalId })),
      scores: scores.map((sc) => ({
        assignmentId: String(sc.assignmentId), studentId: String(sc.studentId),
        score: sc.score, manual: sc.manual, excused: sc.excused, messagedAt: sc.messagedAt, discussion: sc.discussion,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Tap to score (auto) or double-tap edit (explicit score), or clear.
router.post("/homework/score", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const { assignmentId, studentId } = req.body || {};
    const a = await HomeworkAssignment.findOne({ _id: assignmentId, schoolId: req.schoolId });
    if (!a) return res.status(404).json({ ok: false, error: "Assignment not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    if (req.body?.clear) {
      await HomeworkScore.updateOne(
        { assignmentId: a._id, studentId },
        { $set: { score: null, manual: false, scoredAt: null, excused: false } }
      );
      return res.json({ ok: true, score: null });
    }

    // Excused toggle ("E"): no grade, dropped from totals/averages.
    if ("excused" in (req.body || {})) {
      const excused = !!req.body.excused;
      await HomeworkScore.updateOne(
        { assignmentId: a._id, studentId, schoolId: req.schoolId },
        { $set: excused ? { excused: true, score: null, manual: false, scoredAt: null } : { excused: false } },
        { upsert: true }
      );
      return res.json({ ok: true, excused });
    }

    let score;
    let manual = false;
    if (req.body?.score !== undefined && req.body?.score !== null && req.body?.score !== "") {
      score = round1(Number(req.body.score));
      manual = true;
    } else {
      score = autoHomeworkScore(a, config, req.membership?.homeworkPrefs); // single-tap auto (teacher's own threshold)
    }
    await HomeworkScore.updateOne(
      { assignmentId: a._id, studentId, schoolId: req.schoolId },
      { $set: { score, manual, excused: false, scoredByTeacherId: req.membership._id, scoredAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, score, manual });
  } catch (err) {
    next(err);
  }
});

// Save a Formal Discussion's results in one go.
router.post("/homework/discussion/:assignmentId", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const a = await HomeworkAssignment.findOne({ _id: req.params.assignmentId, schoolId: req.schoolId });
    if (!a) return res.status(404).json({ ok: false, error: "Assignment not found" });
    const results = Array.isArray(req.body?.results) ? req.body.results : [];
    for (const r of results) {
      const plus = Number(r.plus) || 0;
      const minus = Number(r.minus) || 0;
      const absent = !!r.absent;
      const score = discussionScore({ plus, minus, absent });
      await HomeworkScore.updateOne(
        { assignmentId: a._id, studentId: r.studentId, schoolId: req.schoolId },
        { $set: { score, manual: false, scoredByTeacherId: req.membership._id, scoredAt: new Date(), discussion: { plus, minus, absent } } },
        { upsert: true }
      );
    }
    res.json({ ok: true, saved: results.length });
  } catch (err) {
    next(err);
  }
});

// Category averages for a class: per subject × type, average of score/denom×10.
router.get("/homework/averages/:classGroup", authAny, loadMembership, async (req, res, next) => {
  try {
    const classGroup = String(req.params.classGroup || "").trim();
    const assignments = await HomeworkAssignment.find({ schoolId: req.schoolId, classGroup }).lean();
    const aById = Object.fromEntries(assignments.map((a) => [String(a._id), a]));
    const scores = assignments.length
      ? await HomeworkScore.find({ assignmentId: { $in: assignments.map((a) => a._id) }, score: { $ne: null } }).lean()
      : [];
    const buckets = {}; // "subject||type" → { sum, n }
    for (const sc of scores) {
      const a = aById[String(sc.assignmentId)];
      if (!a) continue;
      const key = `${a.subject || "—"}||${a.type}`;
      const pct10 = (sc.score / (a.denom || 10)) * 10;
      (buckets[key] ||= { subject: a.subject || "—", type: a.type, sum: 0, n: 0 });
      buckets[key].sum += pct10;
      buckets[key].n += 1;
    }
    const averages = Object.values(buckets)
      .map((b) => ({ subject: b.subject, type: b.type, average: round1(b.sum / b.n), count: b.n }))
      .sort((x, y) => x.subject.localeCompare(y.subject) || x.type.localeCompare(y.type));
    res.json({ ok: true, averages });
  } catch (err) {
    next(err);
  }
});

// Build each student's outstanding (unshown) work for current + previous term.
async function buildOutstanding(schoolId, classGroup, config) {
  const cutoff = outstandingCutoff(config);
  const assignments = await HomeworkAssignment.find({
    schoolId, classGroup, type: { $in: ["homework", "work"] }, date: { $gte: cutoff },
  }).sort({ date: 1 }).lean();
  const aById = Object.fromEntries(assignments.map((a) => [String(a._id), a]));
  const students = await BehaviorStudent.find({ schoolId, classGroup, active: true })
    .select("firstName lastName preferredName parents edsbyStudentId").lean();
  const aIds = assignments.map((a) => a._id);
  const scores = aIds.length ? await HomeworkScore.find({ assignmentId: { $in: aIds } }).lean() : [];
  // Map (assignment+student) → score row.
  const scoreMap = {};
  for (const sc of scores) scoreMap[`${sc.assignmentId}|${sc.studentId}`] = sc;

  // Category grade per student per subject||type (over ALL scored work, any term).
  const allScores = aIds.length ? scores.filter((s) => s.score != null) : [];
  const catByStudent = {}; // studentId → { "subject||type": {sum,n} }
  for (const sc of allScores) {
    const a = aById[String(sc.assignmentId)];
    if (!a) continue;
    const k = `${a.subject || "—"}||${a.type}`;
    (catByStudent[String(sc.studentId)] ||= {});
    (catByStudent[String(sc.studentId)][k] ||= { sum: 0, n: 0 });
    catByStudent[String(sc.studentId)][k].sum += (sc.score / (a.denom || 10)) * 10;
    catByStudent[String(sc.studentId)][k].n += 1;
  }

  const out = [];
  for (const s of students) {
    const missing = assignments.filter((a) => {
      const sc = scoreMap[`${a._id}|${s._id}`];
      return !sc || sc.score == null; // no score yet = outstanding
    });
    if (!missing.length) continue;
    out.push({
      student: s,
      items: missing.map((a) => {
        const cat = catByStudent[String(s._id)]?.[`${a.subject || "—"}||${a.type}`];
        return {
          assignmentId: String(a._id),
          subject: a.subject, type: a.type, date: a.date, description: a.description,
          categoryGrade: cat ? round1(cat.sum / cat.n) : null,
          messagedAt: scoreMap[`${a._id}|${s._id}`]?.messagedAt || null,
        };
      }),
    });
  }
  return out;
}

router.get("/homework/outstanding/:classGroup", authAny, loadMembership, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const list = await buildOutstanding(req.schoolId, String(req.params.classGroup || "").trim(), config);
    res.json({
      ok: true,
      students: list.map((o) => ({
        studentId: String(o.student._id),
        name: `${o.student.preferredName || o.student.firstName} ${o.student.lastName || ""}`.trim(),
        items: o.items,
        lastMessagedAt: o.items.reduce((m, it) => (it.messagedAt && (!m || it.messagedAt > m) ? it.messagedAt : m), null),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Compose + send a "fallen behind" message to selected students (or the whole
// class, respecting the resend cooldown), then mark those items as messaged.
router.post("/homework/outstanding/post", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const classGroup = String(req.body?.classGroup || "").trim();
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const cooldownDays = config?.homework?.messageCooldownDays ?? 7;
    const whole = !!req.body?.whole;
    const picked = new Set((Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map(String));
    const all = await buildOutstanding(req.schoolId, classGroup, config);
    const teacherName = (req.membership?.name || "").trim();

    const sent = [];
    const skipped = [];
    for (const o of all) {
      const sid = String(o.student._id);
      if (!whole && !picked.has(sid)) continue;
      // Whole-class send respects the per-student cooldown.
      if (whole) {
        const last = o.items.reduce((m, it) => (it.messagedAt && (!m || new Date(it.messagedAt) > new Date(m)) ? it.messagedAt : m), null);
        if (last && Date.now() - new Date(last).getTime() < cooldownDays * DAY_MS) { skipped.push({ name: o.student.preferredName || o.student.firstName, reason: "messaged recently" }); continue; }
      }
      const name = o.student.preferredName || o.student.firstName || "your child";
      // Group outstanding by subject + type, with the category grade.
      const groups = {};
      for (const it of o.items) {
        const k = `${it.subject || "—"} ${it.type === "work" ? "(class work)" : ""}`.trim();
        (groups[k] ||= { grade: it.categoryGrade, lines: [] });
        groups[k].lines.push(`  • ${new Date(it.date).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ })} — ${it.description || "(no description)"}`);
      }
      const blocks = Object.entries(groups).map(([k, g]) =>
        `${k}${g.grade != null ? ` — current grade ${g.grade}/10` : ""}:\n${g.lines.join("\n")}`
      );
      const body =
        `Dear Parent/Guardian,\n\n` +
        `This is a note to let you know that ${name} has fallen behind on some work and has the following outstanding:\n\n` +
        `${blocks.join("\n\n")}\n\n` +
        `Students are to show their work in person on completion; partial credit can be given if shown within 7 days. ` +
        `Please encourage ${name} to catch up.\n\n` +
        `Sincerely,\n${teacherName || config?.branding?.schoolName || "School"}`;

      const r = await sendHomeworkMessage({
        schoolId: req.schoolId, student: o.student, sentByTeacherId: req.membership._id,
        subject: `${name}: outstanding work`, body,
      });
      if (r.ok) {
        // Mark each outstanding item as messaged (creates a score row, score null).
        for (const it of o.items) {
          await HomeworkScore.updateOne(
            { assignmentId: it.assignmentId, studentId: sid, schoolId: req.schoolId },
            { $set: { messagedAt: new Date() } },
            { upsert: true }
          );
        }
        sent.push({ name });
      } else {
        skipped.push({ name, reason: r.error || "send failed" });
      }
    }
    await audit(req.schoolId, "homework.outstanding_posted", req, { meta: { classGroup, sent: sent.length, skipped: skipped.length } });
    res.json({ ok: true, sent, skipped });
  } catch (err) {
    next(err);
  }
});

const HW_TYPE_LABEL = { homework: "Homework", work: "Work", discussion: "Formal Discussion" };

// End-of-term summary for one (term, subject, type): each student's grade summed
// across that type's assignments. Blanks count as 0; "E" excused work is dropped
// from both the grade and the denominator. "outstanding" = blank OR below the
// setup threshold (out of 10). Shared by the report view + the CSV export.
async function buildTermReport(schoolId, { classGroup, term, subject, type, belowOverride }, config) {
  const ts = (config?.homework?.termStarts || []).map((d) => new Date(d)).sort((a, b) => a - b);
  const q = { schoolId, classGroup };
  if (subject) q.subject = subject;
  if (type) q.type = type;
  if (term != null && ts[term]) q.date = { $gte: ts[term], ...(ts[term + 1] ? { $lt: ts[term + 1] } : {}) };
  const assignments = await HomeworkAssignment.find(q).sort({ date: 1 }).lean();
  const students = await BehaviorStudent.find({ schoolId, classGroup, active: true })
    .select("firstName lastName preferredName externalId").sort({ lastName: 1, firstName: 1 }).lean();
  const scores = assignments.length
    ? await HomeworkScore.find({ assignmentId: { $in: assignments.map((a) => a._id) } }).lean()
    : [];
  const scMap = {};
  for (const sc of scores) scMap[`${sc.assignmentId}|${sc.studentId}`] = sc;
  const below = (belowOverride ?? null) != null ? belowOverride : (config?.homework?.outstandingBelow ?? 6);

  const rows = students.map((s) => {
    let total = 0, outOf = 0, outstanding = 0, excused = 0;
    for (const a of assignments) {
      const sc = scMap[`${a._id}|${s._id}`];
      const denom = a.denom || 10;
      if (sc?.excused) { excused += 1; continue; }
      outOf += denom;
      const raw = sc?.score; // null/undefined = blank → counts as 0
      total += raw == null ? 0 : raw;
      const score10 = raw == null ? null : (raw / denom) * 10;
      if (raw == null || score10 < below) outstanding += 1;
    }
    return {
      studentId: String(s._id), name: `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim(),
      firstName: s.firstName, lastName: s.lastName, externalId: s.externalId,
      total: round1(total), outOf, average: outOf > 0 ? round1((total / outOf) * 10) : null,
      outstanding, excused,
    };
  });
  const graded = rows.filter((r) => r.average != null);
  const classAverage = graded.length ? round1(graded.reduce((p, r) => p + r.average, 0) / graded.length) : null;
  return { assignmentCount: assignments.length, rows, classAverage, below };
}

// Per-student term report (list of averages + outstanding counts). Term defaults
// to the current term from config.
router.get("/homework/report", authAny, loadMembership, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const term = req.query.term !== undefined && req.query.term !== "" ? Number(req.query.term) : (config?.homework?.currentTerm ?? 0);
    const r = await buildTermReport(req.schoolId, {
      classGroup: String(req.query.classGroup || "").trim(),
      term,
      subject: String(req.query.subject || "").trim(),
      type: String(req.query.type || "").trim(),
      belowOverride: req.membership?.homeworkPrefs?.outstandingBelow,
    }, config);
    res.json({ ok: true, term, ...r });
  } catch (err) {
    next(err);
  }
});

// Each teacher's own homework grading thresholds (null = use school default).
router.put("/homework/my-prefs", authAny, loadMembership, async (req, res, next) => {
  try {
    const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const set = {};
    if ("lateWeeks" in (req.body || {})) set["homeworkPrefs.lateWeeks"] = num(req.body.lateWeeks);
    if ("outstandingBelow" in (req.body || {})) set["homeworkPrefs.outstandingBelow"] = num(req.body.outstandingBelow);
    if (Object.keys(set).length) await BehaviorTeacher.updateOne({ _id: req.membership._id }, { $set: set });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// End-of-term CSV in Edsby's import shape — one file per (term, subject, type),
// one summed row per student (grade out of the type's combined denominator).
router.get("/homework/export", authAny, loadMembership, async (req, res, next) => {
  try {
    const classGroup = String(req.query.classGroup || "").trim();
    const subject = String(req.query.subject || "").trim();
    const type = String(req.query.type || "").trim();
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const term = req.query.term !== undefined && req.query.term !== "" ? Number(req.query.term) : (config?.homework?.currentTerm ?? 0);
    const r = await buildTermReport(req.schoolId, { classGroup, term, subject, type, belowOverride: req.membership?.homeworkPrefs?.outstandingBelow }, config);

    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const assessmentName = `${classGroup} ${subject} ${HW_TYPE_LABEL[type] || type}`.replace(/\s+/g, " ").trim();
    const today = new Date().toISOString().slice(0, 10);
    const out = [["Student ID", "First Name", "Last Name", "Assessment Name", "Date", "Grade", "Out Of", "Comment"].join(",")];
    for (const row of r.rows) {
      if (row.outOf <= 0) continue; // no applicable (non-excused) work → nothing to import
      out.push([row.externalId || "", row.firstName || "", row.lastName || "", assessmentName, today, row.total, row.outOf, ""].map(esc).join(","));
    }
    const fname = `${assessmentName} T${term + 1}.csv`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(out.join("\n"));
  } catch (err) {
    next(err);
  }
});

export default router;
