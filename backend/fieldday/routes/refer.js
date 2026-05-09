/**
 * Refer-to-school endpoint.
 *
 *   POST /refer { teacherName, teacherEmail, schoolName, senderName, senderSchool? }
 *
 * No auth required — any user (admin, leader, or even an anonymous visitor)
 * can recommend Field Day to a teacher at another school. Lightweight rate
 * limit prevents abuse: 5 referrals per IP per 10 minutes.
 */
import express from "express";
import { sendReferEmail, sendReportEmail } from "../email.js";
import { errResp, asyncH } from "../utils.js";
import { Feedback, School } from "../models.js";

const router = express.Router();

// In-memory rate limiter (good enough for this; swap for Redis at scale)
const RATE = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const arr = (RATE.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return errResp(res, 429, "rate_limit");
  arr.push(now);
  RATE.set(ip, arr);
  next();
}

router.post("/refer", rateLimit, asyncH(async (req, res) => {
  const teacherName  = String(req.body?.teacherName  || "").trim();
  const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
  const schoolName   = String(req.body?.schoolName   || "").trim();
  const senderName   = String(req.body?.senderName   || "").trim();
  const senderSchool = String(req.body?.senderSchool || "").trim();
  const products     = Array.isArray(req.body?.products) ? req.body.products : null;
  if (!teacherName || !teacherEmail || !senderName) return errResp(res, 400, "missing_fields");
  if (!teacherEmail.includes("@"))                   return errResp(res, 400, "bad_email");

  let sent = true;
  try { await sendReferEmail({ teacherName, teacherEmail, schoolName, senderName, senderSchool, products }); }
  catch (e) { console.warn("[fieldday] refer email failed", e); sent = false; }

  res.json({ sent });
}));

router.post("/report", rateLimit, asyncH(async (req, res) => {
  const kind = ["problem", "suggestion"].includes(req.body?.kind) ? req.body.kind : "suggestion";
  const message = String(req.body?.message || "").trim().slice(0, 4000);
  if (!message) return errResp(res, 400, "missing_message");

  const payload = {
    kind, message,
    fromName:   String(req.body?.fromName  || "").trim(),
    fromEmail:  String(req.body?.fromEmail || "").trim().toLowerCase(),
    schoolCode: String(req.body?.schoolCode || "").trim().toUpperCase(),
    context:    req.body?.context || {}
  };

  // Persist to MongoDB so the export script can dump them later. Best-effort —
  // if the write fails (e.g. transient DB blip) we still email so nothing is lost.
  let savedId = null;
  try {
    let schoolId = null;
    if (payload.schoolCode) {
      const sc = await School.findOne({ code: payload.schoolCode }).lean();
      schoolId = sc?._id || null;
    }
    const fb = await Feedback.create({ ...payload, schoolId });
    savedId = fb._id.toString();
  } catch (e) {
    console.warn("[fieldday] feedback persist failed", e?.message || e);
  }

  // Loud server log so PM2 / Render logs make new bug reports easy to spot.
  // Each line stands out enough that `grep "FIELDDAY-FEEDBACK"` in the logs
  // tail surfaces every report quickly.
  const tag = kind === "problem" ? "🐞 BUG" : "💡 IDEA";
  console.log(`[FIELDDAY-FEEDBACK] ${tag} from ${payload.fromName || "(anon)"}${payload.fromEmail ? " <"+payload.fromEmail+">" : ""} school=${payload.schoolCode || "-"}: ${message.slice(0, 200).replace(/\s+/g, " ")}${message.length > 200 ? "…" : ""}`);

  let sent = true;
  try { await sendReportEmail(payload); }
  catch (e) { console.warn("[fieldday] report email failed", e); sent = false; }
  res.json({ sent, savedId });
}));

/* ------------------------------------------------------------------ */
/*  GET /feedback-clear                                               */
/*  Wipes Field Day feedback. By default deletes ONLY items already   */
/*  marked status=fixed (safe cleanup). Pass ?all=1 to nuke every     */
/*  feedback row regardless of status (use with care). Same admin     */
/*  token gate as /feedback-export.                                   */
/* ------------------------------------------------------------------ */
router.get("/feedback-clear", asyncH(async (req, res) => {
  const key = req.query.key;
  const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
  if (!expected || key !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const all = req.query.all === "1" || req.query.all === "true";
  const filter = all ? {} : { status: "fixed" };
  const result = await Feedback.deleteMany(filter);
  res.json({
    ok: true,
    deletedCount: result.deletedCount || 0,
    scope: all ? "all" : "fixed-only"
  });
}));

/* ------------------------------------------------------------------ */
/*  GET /feedback-export                                              */
/*  Plain-text dump of every Field Day report (problems + suggestions)*/
/*  for pasting into chat with an AI / triage tool.                   */
/*  Auth: query param key= must match ADMIN_API_TOKEN env var.        */
/* ------------------------------------------------------------------ */
router.get("/feedback-export", asyncH(async (req, res) => {
  const key = req.query.key;
  const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
  if (!expected || key !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Optional filters: ?status=open or ?since=2026-05-01
  const q = {};
  if (req.query.status && ["open","in_progress","fixed","wontfix"].includes(req.query.status)) {
    q.status = req.query.status;
  }
  if (req.query.since) {
    const d = new Date(req.query.since);
    if (!isNaN(d.getTime())) q.createdAt = { $gte: d };
  }

  const all = await Feedback.find(q).sort({ createdAt: -1 }).lean();
  const problems = all.filter(f => f.kind === "problem");
  const ideas    = all.filter(f => f.kind === "suggestion");

  const fmt = (f) => {
    const when = f.createdAt ? new Date(f.createdAt).toISOString() : "?";
    const who = `${f.fromName || "(anon)"}${f.fromEmail ? " <"+f.fromEmail+">" : ""}`;
    const where = f.schoolCode || "(no school)";
    const id = f._id?.toString().slice(-6) || "------";
    const ctx = f.context && Object.keys(f.context).length
      ? "\n      context: " + JSON.stringify(f.context).slice(0, 400)
      : "";
    return `  [${id}] ${when}  ${who}  school=${where}  status=${f.status||"open"}\n    ${(f.message||"").replace(/\n/g, "\n    ")}${ctx}`;
  };

  const lines = [
    "=== CURRICULATE FIELD DAY FEEDBACK REPORT ===",
    `Generated: ${new Date().toISOString()}`,
    `Total: ${all.length} (${problems.length} problems, ${ideas.length} ideas)`,
    `Status filter: ${q.status || "(all)"}`,
    `Since:         ${req.query.since || "(all time)"}`,
    "",
    `--- 🐞 PROBLEMS (${problems.length}) ---`,
    "",
    ...(problems.length ? problems.map(fmt) : ["  (none)"]),
    "",
    `--- 💡 SUGGESTIONS (${ideas.length}) ---`,
    "",
    ...(ideas.length ? ideas.map(fmt) : ["  (none)"]),
    ""
  ];
  res.type("text/plain").send(lines.join("\n"));
}));

export default router;
