// backend/controllers/feedbackController.js
import FeedbackMessage from "../models/FeedbackMessage.js";

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