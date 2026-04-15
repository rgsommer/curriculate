// routes/resultsRoutes.js
import express from "express";
import rateLimit from "express-rate-limit";
import PublishedResult from "../models/PublishedResult.js";
import FeedbackMessage from "../models/FeedbackMessage.js";
import { genAA123, normalizeCode } from "../utils/refCode.js";

const router = express.Router();

/**
 * Public lookup limiter: keep it *tight* to stop guessing.
 * - 10 requests / hour / IP
 * - generic message
 */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many lookup attempts. Please wait a few minutes and try again." },
});

// Optional: slightly higher limit for create endpoint (teacher side)
// (You can also protect this with your existing auth later.)
const createLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});

/**
 * POST /results
 * Body: { payload, meta?, teacherId?, sessionId? }
 * Returns: { code, expiresAt }
 */
router.post("/", createLimiter, async (req, res) => {
  try {
    const { payload, meta, teacherId, sessionId } = req.body || {};
    if (payload == null) return res.status(400).json({ error: "Missing payload." });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Retry on collision
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = genAA123();
      try {
        await PublishedResult.create({
          code,
          payload,
          meta,
          teacherId,
          sessionId,
          expiresAt,
        });
        return res.json({ code, expiresAt });
      } catch (e) {
        // Duplicate code -> retry
        if (String(e?.code) === "11000") continue;
        throw e;
      }
    }

    return res.status(503).json({ error: "Could not generate code. Try again." });
  } catch (err) {
    console.error("POST /results error:", err);
    return res.status(500).json({ error: "Server error." });
  }
});

/**
 * POST /results/feedback
 * Body: { role: "student"|"parent", message: string, refCode?: string }
 * Saves feedback from students/parents viewing results
 */
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many feedback submissions. Please wait a few minutes." },
});

router.post("/feedback", feedbackLimiter, async (req, res) => {
  try {
    const { role, message, refCode } = req.body || {};
    const msg = String(message || "").trim();
    if (!msg) return res.status(400).json({ error: "Missing message" });

    const validRoles = ["student", "parent"];
    const cleanRole = validRoles.includes(role) ? role : "unknown";

    const saved = await FeedbackMessage.create({
      message: `[Results Feedback — ${cleanRole}] ${msg}`,
      meta: {
        source: "results-page",
        role: cleanRole,
        refCode: refCode ? normalizeCode(refCode) : null,
        submittedAt: new Date().toISOString(),
      },
    });

    return res.json({ ok: true, id: saved._id });
  } catch (e) {
    console.error("POST /results/feedback error:", e);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
});

/**
 * GET /results/:code
 * Returns: { payload, meta, createdAt, expiresAt } or generic not found
 */
router.get("/:code", lookupLimiter, async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    if (code.length !== 5) return res.status(404).json({ error: "Code not found." });

    const doc = await PublishedResult.findOneAndUpdate(
      { code },
      { $inc: { viewCount: 1 }, $set: { lastViewedAt: new Date() } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: "Code not found." });

    // TTL will remove expired docs, but keep this as belt + suspenders.
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
      return res.status(404).json({ error: "Code not found." });
    }

    return res.json({
      payload: doc.payload,
      meta: doc.meta || null,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
      viewCount: doc.viewCount || 1,
    });
  } catch (err) {
    console.error("GET /results/:code error:", err);
    return res.status(500).json({ error: "Server error." });
  }
});

export default router;
