/**
 * Backups: a snapshot of an entire school + its events at a point in time.
 *
 *   POST   /schools/me/backups          — admin triggers a manual snapshot
 *   GET    /schools/me/backups          — list snapshots (most recent first)
 *   POST   /schools/me/backups/:id/restore — replace current state with a snapshot
 *   DELETE /schools/me/backups/:id      — delete a snapshot
 *
 * Cron usage: schedule a job that POSTs `/internal/snapshot-all` (you'd add
 * that endpoint behind your own auth) which calls `snapshotSchool()` for
 * every school. The function is exported so any internal cron worker can
 * use it directly.
 */
const express = require("express");
const { School, Event, Backup } = require("../models");
const { errResp, asyncH } = require("../utils");
const { requireSchool, requireAdmin } = require("../auth");

const router = express.Router();
router.use(requireSchool, requireAdmin);

async function snapshotSchool(schoolId, label = "manual") {
  const school = await School.findById(schoolId).lean();
  if (!school) return null;
  const events = await Event.find({ schoolId }).lean();
  return Backup.create({
    schoolId,
    label,
    snapshot: { school, events }
  });
}

router.post("/schools/me/backups", asyncH(async (req, res) => {
  const label = String(req.body?.label || "manual").slice(0, 64);
  const b = await snapshotSchool(req.fdSchoolId, label);
  res.json({ backup: { id: b._id.toString(), label: b.label, takenAt: b.takenAt } });
}));

router.get("/schools/me/backups", asyncH(async (req, res) => {
  const list = await Backup.find({ schoolId: req.fdSchoolId })
    .sort({ takenAt: -1 }).limit(100)
    .select("_id label takenAt").lean();
  res.json({ backups: list.map(b => ({ id: b._id.toString(), label: b.label, takenAt: b.takenAt })) });
}));

router.post("/schools/me/backups/:id/restore", asyncH(async (req, res) => {
  const b = await Backup.findOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!b) return errResp(res, 404, "not_found");
  // Snapshot current state into a "pre-restore" backup before clobbering
  await snapshotSchool(req.fdSchoolId, "pre-restore");
  // Apply
  const snap = b.snapshot || {};
  if (snap.school) {
    const allowed = ["name","ageCategories","ageBands","ageCutoffDate","eventLibrary","eventDefaults",
                     "eventRules","eventStaff","divisions","houses","tieMethod","scoring",
                     "records","standards","personalBests","archives"];
    const set = {};
    allowed.forEach(k => { if (k in snap.school) set[k] = snap.school[k]; });
    await School.updateOne({ _id: req.fdSchoolId }, { $set: set });
  }
  await Event.deleteMany({ schoolId: req.fdSchoolId });
  if (Array.isArray(snap.events) && snap.events.length > 0) {
    const docs = snap.events.map(e => { const d = { ...e }; delete d._id; d.schoolId = req.fdSchoolId; return d; });
    await Event.insertMany(docs);
  }
  res.json({ ok: true });
}));

router.delete("/schools/me/backups/:id", asyncH(async (req, res) => {
  const r = await Backup.deleteOne({ _id: req.params.id, schoolId: req.fdSchoolId });
  if (!r.deletedCount) return errResp(res, 404, "not_found");
  res.status(204).end();
}));

router.snapshotSchool = snapshotSchool; // exported for cron usage
module.exports = router;
module.exports.snapshotSchool = snapshotSchool;
