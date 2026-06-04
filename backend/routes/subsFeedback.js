/**
 * /subs bug-reports, suggestions, and auto-captured client errors.
 *
 *   POST /api/subs-feedback/report                  { kind, message, fromName?, fromEmail?, surface?, context? }
 *   GET  /api/subs-feedback/feedback-export?key=... plain-text dump → feedback-subs.txt
 *   GET  /api/subs-feedback/feedback-clear?key=...  wipes all rows
 *
 * Mirrors backend/routes/gradingFeedback.js so feedback.py treats every
 * product uniformly. Report is public (rate-limited per IP); export/clear
 * are gated by ADMIN_API_TOKEN.
 */
import express from "express";
import SubsFeedback from "../models/SubsFeedback.js";

const router = express.Router();

// ---------- rate limiter (in-memory) ----------
const RATE = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20; // a touch higher than grading since errors auto-report
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const arr = (RATE.get(ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return res.status(429).json({ error: "rate_limit" });
  arr.push(now);
  RATE.set(ip, arr);
  next();
}

// ---------- POST /api/subs-feedback/report ----------
router.post("/report", rateLimit, express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const kind = ["problem", "suggestion", "error"].includes(req.body?.kind) ? req.body.kind : "suggestion";
    const message = String(req.body?.message || "").trim().slice(0, 4000);
    if (!message) return res.status(400).json({ error: "missing_message" });

    const payload = {
      kind,
      message,
      fromName: String(req.body?.fromName || "").trim(),
      fromEmail: String(req.body?.fromEmail || "").trim().toLowerCase(),
      surface: String(req.body?.surface || "").trim().slice(0, 80),
      context: req.body?.context || {},
    };

    let savedId = null;
    try {
      const fb = await SubsFeedback.create(payload);
      savedId = fb._id.toString();
    } catch (e) {
      console.warn("[subs] feedback persist failed", e?.message || e);
    }

    const tag = kind === "problem" ? "🐞 BUG" : kind === "error" ? "⚠️ ERROR" : "💡 IDEA";
    const surfaceTag = payload.surface ? ` (${payload.surface})` : "";
    console.log(
      `[SUBS-FEEDBACK] ${tag}${surfaceTag} from ${payload.fromName || "(anon)"}${payload.fromEmail ? " <" + payload.fromEmail + ">" : ""}: ${message.slice(0, 200).replace(/\s+/g, " ")}${message.length > 200 ? "…" : ""}`
    );

    res.json({ ok: true, savedId });
  } catch (err) {
    console.error("[subs/report] error", err);
    res.status(500).json({ error: "report_failed" });
  }
});

// ---------- GET /api/subs-feedback/feedback-export ----------
router.get("/feedback-export", async (req, res) => {
  try {
    const key = req.query.key;
    const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
    if (!expected || key !== expected) return res.status(401).json({ error: "Unauthorized" });

    const q = {};
    if (req.query.status && ["open", "in_progress", "fixed", "wontfix"].includes(req.query.status)) {
      q.status = req.query.status;
    }
    if (req.query.since) {
      const d = new Date(req.query.since);
      if (!isNaN(d.getTime())) q.createdAt = { $gte: d };
    }

    const all = await SubsFeedback.find(q).sort({ createdAt: -1 }).lean();
    const problems = all.filter((f) => f.kind === "problem");
    const ideas = all.filter((f) => f.kind === "suggestion");
    const errors = all.filter((f) => f.kind === "error");

    const fmt = (f) => {
      const when = f.createdAt ? new Date(f.createdAt).toISOString() : "?";
      const who = `${f.fromName || "(anon)"}${f.fromEmail ? " <" + f.fromEmail + ">" : ""}`;
      const id = f._id?.toString().slice(-6) || "------";
      const surface = f.surface ? `  surface=${f.surface}` : "";
      const ctx = f.context && Object.keys(f.context).length ? "\n      context: " + JSON.stringify(f.context).slice(0, 400) : "";
      return `  [${id}] ${when}  ${who}${surface}  status=${f.status || "open"}\n    ${(f.message || "").replace(/\n/g, "\n    ")}${ctx}`;
    };

    const lines = [
      "=== CURRICULATE SUBS (substitute staffing) FEEDBACK REPORT ===",
      `Generated: ${new Date().toISOString()}`,
      `Total: ${all.length} (${problems.length} problems, ${ideas.length} ideas, ${errors.length} errors)`,
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
      "",
      `--- ⚠️ ERRORS (auto-reported) (${errors.length}) ---`,
      "",
      ...(errors.length ? errors.map(fmt) : ["  (none)"]),
      "",
    ];
    res.type("text/plain").send(lines.join("\n"));
  } catch (err) {
    console.error("[subs/feedback-export] error", err);
    res.status(500).json({ error: "export_failed" });
  }
});

// ---------- GET /api/subs-feedback/feedback-clear ----------
router.get("/feedback-clear", async (req, res) => {
  try {
    const key = req.query.key;
    const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
    if (!expected || key !== expected) return res.status(401).json({ error: "Unauthorized" });

    const result = await SubsFeedback.deleteMany({});
    res.json({ ok: true, deletedCount: result.deletedCount || 0, scope: "all" });
  } catch (err) {
    console.error("[subs/feedback-clear] error", err);
    res.status(500).json({ error: "clear_failed" });
  }
});

export default router;
