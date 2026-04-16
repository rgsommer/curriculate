// backend/controllers/adminFeedbackController.js
import FeedbackMessage from "../models/FeedbackMessage.js";

export async function archiveFeedback(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await FeedbackMessage.findByIdAndUpdate(id, { archived: true }, { new: true });
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("archiveFeedback error:", e);
    res.status(500).json({ error: "Failed to archive feedback" });
  }
}

export async function restoreFeedback(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await FeedbackMessage.findByIdAndUpdate(id, { archived: false }, { new: true });
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("restoreFeedback error:", e);
    res.status(500).json({ error: "Failed to restore feedback" });
  }
}

export async function deleteFeedback(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const result = await FeedbackMessage.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteFeedback error:", e);
    res.status(500).json({ error: "Failed to delete feedback" });
  }
}

export async function listFeedback(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 10));
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const showArchived = req.query.archived === "true";
    const filter = showArchived ? { archived: true } : { $or: [{ archived: { $exists: false } }, { archived: false }] };
    const items = await FeedbackMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
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