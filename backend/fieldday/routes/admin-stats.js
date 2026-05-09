/**
 * Curriculate-internal admin stats: aggregations across ALL Field Day schools.
 *
 *   GET /stats
 *
 * Authorization: this router does NOT require a Field Day session token.
 * It's intended to be mounted behind your existing Curriculate admin
 * middleware in backend/index.js, e.g.:
 *
 *     const requireCuriculateAdmin = require("./middleware/admin");
 *     const fdAdminStats = require("./fieldday/routes/admin-stats");
 *     app.use("/admin/api/fieldday", requireCuriculateAdmin, fdAdminStats);
 *
 * If you accidentally mount it without auth, anyone with the URL gets your
 * org-wide aggregations. So: do mount it behind admin auth.
 */
const express = require("express");
const { School, Event, Backup } = require("../models");
const { asyncH, errResp } = require("../utils");

const router = express.Router();

// Optional shared-secret check that matches the existing Curriculate admin
// pattern (x-admin-token header). If FIELDDAY_ADMIN_TOKEN is set, the
// header must match. If unset, we assume you're mounting this behind your
// own admin middleware separately and skip the check.
function requireAdminToken(req, res, next) {
  const expected = process.env.FIELDDAY_ADMIN_TOKEN;
  if (!expected) return next();
  const got = req.headers["x-admin-token"] || "";
  if (got !== expected) return errResp(res, 401, "unauthorized");
  next();
}
router.use(requireAdminToken);

const MS_DAY   = 24 * 60 * 60 * 1000;
const MS_MONTH = 30 * MS_DAY;

router.get("/stats", asyncH(async (req, res) => {
  const now = Date.now();
  const monthAgo = new Date(now - MS_MONTH);
  const weekAgo  = new Date(now - 7 * MS_DAY);

  /* ---------- Schools ---------- */
  const totalSchools = await School.countDocuments();
  const schoolsThisMonth = await School.countDocuments({ createdAt: { $gte: monthAgo } });
  const schoolIdsWithEvents = await Event.distinct("schoolId");
  const schoolsWithEvents = schoolIdsWithEvents.length;

  /* ---------- Events ---------- */
  const totalEvents      = await Event.countDocuments();
  const completedEvents  = await Event.countDocuments({ status: "completed" });
  const inProgressEvents = await Event.countDocuments({ status: "in_progress" });
  const eventsThisWeek   = await Event.countDocuments({ createdAt: { $gte: weekAgo } });
  const eventsByType = await Event.aggregate([
    { $group: { _id: "$type", count: { $sum: 1 } } }
  ]);
  const byType = Object.fromEntries(eventsByType.map(r => [r._id || "unknown", r.count]));

  /* ---------- Competitors ---------- */
  const competitorAgg = await Event.aggregate([
    { $project: { schoolId: 1, comps: { $size: { $ifNull: ["$competitors", []] } }, names: "$competitors.name" } },
    { $unwind: { path: "$names", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalEntries: { $sum: 1 },
        uniqueKeys: { $addToSet: { $concat: [
          { $toString: "$schoolId" }, "|",
          { $toLower: { $trim: { input: { $ifNull: ["$names", ""] } } } }
        ] } }
      }
    },
    { $project: { _id: 0, totalEntries: 1, uniqueByName: { $size: "$uniqueKeys" } } }
  ]);
  const competitors = competitorAgg[0] || { totalEntries: 0, uniqueByName: 0 };

  /* ---------- Records ---------- */
  const recordsAgg = await School.aggregate([
    { $project: { records: { $ifNull: ["$records", []] } } },
    { $unwind: { path: "$records", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        total:    { $sum: { $cond: [{ $ifNull: ["$records", false] }, 1, 0] } },
        recent:   { $sum: { $cond: [
          { $gte: [ { $toDate: { $ifNull: ["$records.dateSet", "1970-01-01"] } }, monthAgo ] },
          1, 0
        ] } }
      }
    }
  ]);
  const records = recordsAgg[0] || { total: 0, recent: 0 };

  /* ---------- Houses ---------- */
  const schoolsWithHouses = await School.countDocuments({ "houses.0": { $exists: true } });

  /* ---------- Top schools ---------- */
  const topSchools = await Event.aggregate([
    { $group: {
        _id: "$schoolId",
        events: { $sum: 1 },
        competitors: { $sum: { $size: { $ifNull: ["$competitors", []] } } }
    } },
    { $sort: { competitors: -1 } },
    { $limit: 10 },
    { $lookup: { from: "fieldday_schools", localField: "_id", foreignField: "_id", as: "school" } },
    { $unwind: "$school" },
    { $project: {
        _id: 0,
        id:   { $toString: "$_id" },
        name: "$school.name",
        code: "$school.code",
        events: 1,
        competitors: 1
    } }
  ]);

  /* ---------- Recent activity ---------- */
  const recentEvents = await Event.find({ status: "completed" })
    .sort({ completedAt: -1 })
    .limit(20)
    .select("title age gender completedAt schoolId")
    .lean();
  const involvedSchoolIds = [...new Set(recentEvents.map(e => String(e.schoolId)))];
  const involvedSchools = await School.find({ _id: { $in: involvedSchoolIds } })
    .select("_id name code").lean();
  const schoolMap = Object.fromEntries(involvedSchools.map(s => [String(s._id), s]));
  const recentActivity = recentEvents.map(e => ({
    ts: e.completedAt,
    kind: "event_completed",
    title: e.title,
    age: e.age,
    gender: e.gender,
    schoolName: schoolMap[String(e.schoolId)]?.name || "(deleted school)",
    schoolCode: schoolMap[String(e.schoolId)]?.code || ""
  }));

  /* ---------- Backups storage ---------- */
  const totalBackups = await Backup.countDocuments();

  res.json({
    generatedAt: now,
    schools: {
      total: totalSchools,
      withEvents: schoolsWithEvents,
      newThisMonth: schoolsThisMonth,
      withHouses: schoolsWithHouses
    },
    events: {
      total: totalEvents,
      completed: completedEvents,
      inProgress: inProgressEvents,
      newThisWeek: eventsThisWeek,
      byType
    },
    competitors,
    records: {
      total: records.total || 0,
      newThisMonth: records.recent || 0
    },
    backups: {
      total: totalBackups
    },
    topSchools,
    recentActivity
  });
}));

module.exports = router;
