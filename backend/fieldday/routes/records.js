/**
 * Records, Standards, Archives — all stored as embedded subdocs on School.
 * (Splitting into their own collections would also be reasonable, but
 *  the data is small and per-school, so subdocs keep reads cheap.)
 *
 *   POST   /schools/me/records
 *   PATCH  /schools/me/records/:id
 *   DELETE /schools/me/records/:id
 *
 *   POST   /schools/me/standards
 *   PATCH  /schools/me/standards/:id
 *   DELETE /schools/me/standards/:id
 *
 *   POST   /schools/me/archives          — start a new year
 *   POST   /schools/me/archives/:id/restore
 *   DELETE /schools/me/archives/:id
 */
import express from "express";
import { Types } from "mongoose";
import { School, Event } from "../models.js";
import { errResp, asyncH } from "../utils.js";
import { requireSchool, requireAdmin } from "../auth.js";

const router = express.Router();
router.use(requireSchool);

/* ------------------- Records -------------------
 * NOTE: POST is intentionally available to any signed-in leader at the
 * school. When a kid sets a new record, the leader running the event
 * is the one whose browser detects the break and writes it. If we
 * required admin here, record-break celebrations would silently fail
 * for leaders (the previous bug). PATCH/DELETE stay admin-only so
 * leaders can't edit historical records. */
router.post("/schools/me/records", asyncH(async (req, res) => {
  const r = req.body || {};
  if (!r.title || !r.age || !r.gender || r.value == null) return errResp(res, 400, "missing_fields");
  const rec = {
    id: new Types.ObjectId().toString(),
    title: r.title, age: String(r.age), gender: r.gender,
    type: r.type || "timed", unit: r.unit || "",
    value: Number(r.value),
    holderName: r.holderName || "",
    dateSet: r.dateSet || new Date().toISOString().slice(0, 10),
    eventId: r.eventId || "",
    competitorId: r.competitorId || "",
    createdAt: Date.now()
  };
  await School.updateOne({ _id: req.fdSchoolId }, { $push: { records: rec } });
  res.json({ record: rec });
}));

router.patch("/schools/me/records/:id", requireAdmin, asyncH(async (req, res) => {
  const id = req.params.id;
  const set = {};
  Object.entries(req.body || {}).forEach(([k, v]) => {
    if (["title","age","gender","type","unit","value","holderName","dateSet","eventId","competitorId"].includes(k)) {
      set[`records.$.${k}`] = (k === "value") ? Number(v) : v;
    }
  });
  if (Object.keys(set).length === 0) return errResp(res, 400, "nothing_to_update");
  const r = await School.updateOne({ _id: req.fdSchoolId, "records.id": id }, { $set: set });
  if (!r.matchedCount) return errResp(res, 404, "not_found");
  const school = await School.findById(req.fdSchoolId).lean();
  const rec = (school.records || []).find(r => r.id === id);
  res.json({ record: rec });
}));

router.delete("/schools/me/records/:id", requireAdmin, asyncH(async (req, res) => {
  const r = await School.updateOne({ _id: req.fdSchoolId }, { $pull: { records: { id: req.params.id } } });
  if (!r.modifiedCount) return errResp(res, 404, "not_found");
  res.status(204).end();
}));

/* ------------------- Standards (admin-only) ------------------- */
router.post("/schools/me/standards", requireAdmin, asyncH(async (req, res) => {
  const s = req.body || {};
  if (!s.title || !s.ageBand || !s.gender) return errResp(res, 400, "missing_fields");
  const std = {
    id: new Types.ObjectId().toString(),
    title: s.title, ageBand: s.ageBand, gender: s.gender,
    type: s.type || "timed", unit: s.unit || "",
    gold: s.gold == null ? null : Number(s.gold),
    silver: s.silver == null ? null : Number(s.silver),
    bronze: s.bronze == null ? null : Number(s.bronze)
  };
  await School.updateOne({ _id: req.fdSchoolId }, { $push: { standards: std } });
  res.json({ standard: std });
}));

router.patch("/schools/me/standards/:id", requireAdmin, asyncH(async (req, res) => {
  const id = req.params.id;
  const set = {};
  Object.entries(req.body || {}).forEach(([k, v]) => {
    if (["title","ageBand","gender","type","unit","gold","silver","bronze"].includes(k)) {
      const num = ["gold","silver","bronze"].includes(k);
      set[`standards.$.${k}`] = num ? (v == null ? null : Number(v)) : v;
    }
  });
  if (Object.keys(set).length === 0) return errResp(res, 400, "nothing_to_update");
  const r = await School.updateOne({ _id: req.fdSchoolId, "standards.id": id }, { $set: set });
  if (!r.matchedCount) return errResp(res, 404, "not_found");
  const school = await School.findById(req.fdSchoolId).lean();
  const std = (school.standards || []).find(s => s.id === id);
  res.json({ standard: std });
}));

router.delete("/schools/me/standards/:id", requireAdmin, asyncH(async (req, res) => {
  const r = await School.updateOne({ _id: req.fdSchoolId }, { $pull: { standards: { id: req.params.id } } });
  if (!r.modifiedCount) return errResp(res, 404, "not_found");
  res.status(204).end();
}));

/* ------------------- Archives (admin-only) ------------------- */
router.post("/schools/me/archives", requireAdmin, asyncH(async (req, res) => {
  const label = String(req.body?.label || "").trim();
  if (!label) return errResp(res, 400, "missing_label");

  const events = await Event.find({ schoolId: req.fdSchoolId }).lean();
  const archive = {
    id: new Types.ObjectId().toString(),
    label,
    archivedAt: Date.now(),
    events,
    announceQueue: events.filter(e => e.status === "completed" && !e.announcedAt).map(e => e._id.toString())
  };
  await School.updateOne({ _id: req.fdSchoolId }, { $push: { archives: archive } });
  await Event.deleteMany({ schoolId: req.fdSchoolId });
  res.json({ archive });
}));

router.post("/schools/me/archives/:id/restore", requireAdmin, asyncH(async (req, res) => {
  const school = await School.findById(req.fdSchoolId);
  if (!school) return errResp(res, 404, "school_not_found");
  const archive = (school.archives || []).find(a => a.id === req.params.id);
  if (!archive) return errResp(res, 404, "not_found");

  // Recreate event docs (with fresh ObjectIds to avoid clashes)
  const restoredCount = (archive.events || []).length;
  const docs = (archive.events || []).map(e => {
    const d = { ...e };
    delete d._id;
    d.schoolId = req.fdSchoolId;
    return d;
  });
  if (docs.length > 0) await Event.insertMany(docs);

  school.archives = school.archives.filter(a => a.id !== req.params.id);
  await school.save();
  res.json({ archive, eventsRestored: restoredCount });
}));

router.delete("/schools/me/archives/:id", requireAdmin, asyncH(async (req, res) => {
  const r = await School.updateOne({ _id: req.fdSchoolId }, { $pull: { archives: { id: req.params.id } } });
  if (!r.modifiedCount) return errResp(res, 404, "not_found");
  res.status(204).end();
}));

export default router;
