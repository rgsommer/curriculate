// backend/routes/savedRubrics.js
//
// A teacher's rubric library, shared across their devices. Everything is
// scoped to teacherEmail, which is the same identity the rosters, published
// results and homework batches use.
//
// No tier gate: a rubric is the teacher's own text, and putting it behind a
// plan would make the free tool worse on a second device than on the first
// for no reason anyone could defend.
import express from "express";
import SavedRubric from "../models/SavedRubric.js";

const router = express.Router();

const MAX_RUBRICS = 60;
const MAX_TEXT = 20000;   // a rubric, not a textbook

function emailOf(req) {
  const raw = req.query.teacherEmail ?? req.body?.teacherEmail ?? "";
  const e = String(raw).trim().toLowerCase();
  return e.includes("@") ? e : "";
}

// GET /saved-rubrics?teacherEmail=...
router.get("/", async (req, res) => {
  try {
    const teacherEmail = emailOf(req);
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "Valid teacherEmail is required." });
    const docs = await SavedRubric.find({ teacherEmail })
      .select("name text updatedAt").sort({ name: 1 }).lean();
    return res.json({
      ok: true,
      rubrics: docs.map((d) => ({ name: d.name, text: d.text, updatedAt: d.updatedAt })),
    });
  } catch (err) {
    console.error("[saved-rubrics list]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not load rubrics." });
  }
});

// PUT /saved-rubrics  { teacherEmail, rubrics: [{name, text}] }
//
// The whole library in one call. The client owns the list — it adds, renames
// and deletes locally and then states the result — so a set replace keeps the
// two in step without a per-item protocol. Merging instead would resurrect a
// rubric the teacher had just deleted.
router.put("/", async (req, res) => {
  try {
    const teacherEmail = emailOf(req);
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "Valid teacherEmail is required." });

    const incoming = Array.isArray(req.body?.rubrics) ? req.body.rubrics : null;
    if (!incoming) return res.status(400).json({ ok: false, error: "rubrics array is required." });
    if (incoming.length > MAX_RUBRICS) {
      return res.status(400).json({ ok: false, error: `Too many rubrics (max ${MAX_RUBRICS}).` });
    }

    // Last one wins on a duplicate name, matching the local behaviour.
    const byName = new Map();
    for (const r of incoming) {
      const name = String(r?.name || "").trim().slice(0, 120);
      if (!name) continue;
      byName.set(name.toLowerCase(), { name, text: String(r?.text || "").slice(0, MAX_TEXT) });
    }
    const clean = [...byName.values()];

    const ops = clean.map((r) => ({
      updateOne: {
        filter: { teacherEmail, name: r.name },
        update: { $set: { teacherEmail, name: r.name, text: r.text } },
        upsert: true,
      },
    }));
    // Anything not in the list has been deleted on the client.
    ops.push({
      deleteMany: { filter: { teacherEmail, name: { $nin: clean.map((r) => r.name) } } },
    });
    if (ops.length) await SavedRubric.bulkWrite(ops, { ordered: false });

    return res.json({ ok: true, count: clean.length });
  } catch (err) {
    console.error("[saved-rubrics save]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not save rubrics." });
  }
});

export default router;
