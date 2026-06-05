/**
 * Campfire feedback export/clear for feedback.py.
 *
 *   GET /api/campfire/feedback-export?key=...  plain-text dump → feedback-campfire.txt
 *   GET /api/campfire/feedback-clear?key=...   wipes campfire rows
 *
 * Campfire's in-app widget posts to the shared /feedback ingest (FeedbackMessage)
 * tagged meta.product="campfire" / meta.source="campfire-feedback", so we just
 * read that collection filtered to campfire. Mirrors routes/subsFeedback.js so
 * feedback.py treats every product uniformly. Export/clear gated by ADMIN_API_TOKEN.
 */
import express from "express";
import FeedbackMessage from "../models/FeedbackMessage.js";

const router = express.Router();

const CAMPFIRE_Q = {
  $or: [{ "meta.product": "campfire" }, { "meta.source": "campfire-feedback" }],
};

function authed(req, res) {
  const key = req.query.key;
  const expected = process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_KEY;
  if (!expected || key !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ---------- GET /api/campfire/feedback-export ----------
router.get("/feedback-export", async (req, res) => {
  try {
    if (!authed(req, res)) return;

    const q = { ...CAMPFIRE_Q };
    if (req.query.since) {
      const d = new Date(req.query.since);
      if (!isNaN(d.getTime())) q.createdAt = { $gte: d };
    }

    const all = await FeedbackMessage.find(q).sort({ createdAt: -1 }).lean();

    const fmt = (f) => {
      const when = f.createdAt ? new Date(f.createdAt).toISOString() : "?";
      const m = f.meta || {};
      const who = m.email ? `<${m.email}>` : "(anon)";
      const id = f._id?.toString().slice(-6) || "------";
      const page = m.page ? `  page=${m.page}` : "";
      return `  [${id}] ${when}  ${who}${page}\n    ${(f.message || "").replace(/\n/g, "\n    ")}`;
    };

    const lines = [
      "=== CAMPFIRE (group engagement) FEEDBACK REPORT ===",
      `Generated: ${new Date().toISOString()}`,
      `Total: ${all.length}`,
      `Since:  ${req.query.since || "(all time)"}`,
      "",
      ...(all.length ? all.map(fmt) : ["  (none)"]),
      "",
    ];
    res.type("text/plain").send(lines.join("\n"));
  } catch (err) {
    console.error("[campfire/feedback-export] error", err);
    res.status(500).json({ error: "export_failed" });
  }
});

// ---------- GET /api/campfire/feedback-clear ----------
router.get("/feedback-clear", async (req, res) => {
  try {
    if (!authed(req, res)) return;
    const result = await FeedbackMessage.deleteMany(CAMPFIRE_Q);
    res.json({ ok: true, deletedCount: result.deletedCount || 0, scope: "campfire" });
  } catch (err) {
    console.error("[campfire/feedback-clear] error", err);
    res.status(500).json({ error: "clear_failed" });
  }
});

export default router;
