/**
 * Refer-to-school endpoint.
 *
 *   POST /refer { teacherName, teacherEmail, schoolName, senderName, senderSchool? }
 *
 * No auth required — any user (admin, leader, or even an anonymous visitor)
 * can recommend Field Day to a teacher at another school. Lightweight rate
 * limit prevents abuse: 5 referrals per IP per 10 minutes.
 */
const express = require("express");
const { sendReferEmail, sendReportEmail } = require("../email");
const { errResp, asyncH } = require("../utils");

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
  let sent = true;
  try { await sendReportEmail(payload); }
  catch (e) { console.warn("[fieldday] report email failed", e); sent = false; }
  res.json({ sent });
}));

module.exports = router;
