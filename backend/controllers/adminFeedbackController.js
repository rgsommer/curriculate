// backend/controllers/adminFeedbackController.js
import FeedbackMessage from "../models/FeedbackMessage.js";

export async function listFeedback(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = await FeedbackMessage.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      items: items.map((x) => ({
        id: String(x._id),
        createdAt: x.createdAt,
        message: x.message,
        uses: x.uses ?? 0,
        anonId: x.anonId ?? null,
        sessionId: x.sessionId ?? null,
        meta: x.meta ?? {},
      })),
    });
  } catch (e) {
    console.error("listFeedback error:", e);
    res.status(500).json({ error: "Failed to load feedback" });
  }
}