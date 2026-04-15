// backend/routes/adminUsageSummary.js
import express from "express";
import GradingUsage from "../models/GradingUsage.js";
import PublishedResult from "../models/PublishedResult.js";

const router = express.Router();

const CACHE_TTL_MS = Number(process.env.USAGE_SUMMARY_CACHE_TTL_MS || 60_000);
let cache = { expiresAt: 0, value: null };

function requireAdminToken(req, res, next) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return next();

  const got =
    req.headers["x-admin-token"] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : null);

  if (!got || String(got) !== String(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function monthStart(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 0, 0, 0, 0);
}
function monthKey(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function getMoMRange() {
  const now = new Date();
  const currentMonthStart = monthStart(now);
  const previousMonthStart = addMonths(currentMonthStart, -1);

  const day = now.getDate();
  const currentEnd = new Date(now.getFullYear(), now.getMonth(), day, 23, 59, 59, 999);
  const prevEnd = new Date(previousMonthStart.getFullYear(), previousMonthStart.getMonth(), day, 23, 59, 59, 999);

  return { currentMonthStart, previousMonthStart, currentEnd, prevEnd };
}

router.get("/usage-summary", requireAdminToken, async (req, res) => {
  try {
    const nowMs = Date.now();
    const force = String(req.query.force || "").toLowerCase() === "true";

    if (!force && cache.value && cache.expiresAt > nowMs) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "no-store");
      return res.json(cache.value);
    }

    const today = startOfDay(new Date());
    const since7 = daysAgo(7);
    const since30 = daysAgo(30);
    const twelveMonthsAgo = addMonths(monthStart(new Date()), -11);
    const { currentMonthStart, previousMonthStart, currentEnd, prevEnd } = getMoMRange();

    const POWER_USER_THRESHOLD = Number(process.env.POWER_USER_THRESHOLD || 5);

    const [
      totalSubmissions,
      submissionsToday,
      submissions7d,
      submissions30d,

      uniqueUsersTotal,
      uniqueUsers30d,

      dailyCounts30d,
      monthlyCountsAll,
      monthlyCounts12,
      yearlyCountsAll,

      userSubmissionCounts30d,

      submissionsCurrentMTD,
      submissionsPrevMTD,

      topSubjects30d,
      topAssessmentTypes30d,
      topGradeLevels30d,

      repeatUsersMonthly12,

      latencyStats30d,

      resultsPublished,
      resultsTotalViewsAgg,
      resultsViewedAgg,
      resultsViewed30dAgg,
    ] = await Promise.all([
      GradingUsage.countDocuments({}),
      GradingUsage.countDocuments({ timestamp: { $gte: today } }),
      GradingUsage.countDocuments({ timestamp: { $gte: since7 } }),
      GradingUsage.countDocuments({ timestamp: { $gte: since30 } }),

      GradingUsage.distinct("sessionId", { sessionId: { $ne: null } }).then((a) => a.length),
      GradingUsage.distinct("sessionId", { sessionId: { $ne: null }, timestamp: { $gte: since30 } }).then((a) => a.length),

      // Daily last 30
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 } } },
        {
          $group: {
            _id: {
              y: { $year: "$timestamp" },
              m: { $month: "$timestamp" },
              d: { $dayOfMonth: "$timestamp" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
      ]),

      // Monthly all-time
      GradingUsage.aggregate([
        { $group: { _id: { y: { $year: "$timestamp" }, m: { $month: "$timestamp" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),

      // Monthly last 12 months
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: twelveMonthsAgo } } },
        { $group: { _id: { y: { $year: "$timestamp" }, m: { $month: "$timestamp" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),

      // Yearly all-time
      GradingUsage.aggregate([
        { $group: { _id: { y: { $year: "$timestamp" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1 } },
      ]),

      // Per-user counts (30d)
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 }, sessionId: { $ne: null } } },
        { $group: { _id: "$sessionId", count: { $sum: 1 } } },
      ]),

      // MoM current MTD
      GradingUsage.countDocuments({ timestamp: { $gte: currentMonthStart, $lte: currentEnd } }),

      // MoM prev MTD
      GradingUsage.countDocuments({ timestamp: { $gte: previousMonthStart, $lte: prevEnd } }),

      // top subjects 30d
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 }, subject: { $ne: null } } },
        { $group: { _id: "$subject", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // top assessment types 30d
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 }, assessmentType: { $ne: null } } },
        { $group: { _id: "$assessmentType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // top grade levels 30d
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 }, gradeLevel: { $ne: null } } },
        { $group: { _id: "$gradeLevel", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Repeat users by month (last 12 months)
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: twelveMonthsAgo }, sessionId: { $ne: null } } },
        {
          $group: {
            _id: { y: { $year: "$timestamp" }, m: { $month: "$timestamp" }, sid: "$sessionId" },
            submissions: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: { y: "$_id.y", m: "$_id.m" },
            activeUsers: { $sum: 1 },
            repeatUsers: { $sum: { $cond: [{ $gte: ["$submissions", 2] }, 1, 0] } },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),

      // latency 30d (safe fail)
      GradingUsage.aggregate([
        { $match: { timestamp: { $gte: since30 }, responseTimeMs: { $ne: null } } },
        {
          $group: {
            _id: null,
            avg: { $avg: "$responseTimeMs" },
            p95: { $percentile: { input: "$responseTimeMs", p: [0.95], method: "approximate" } },
            max: { $max: "$responseTimeMs" },
          },
        },
      ]).catch(() => []),

      // Results page view stats
      PublishedResult.countDocuments({}).catch(() => 0),
      PublishedResult.aggregate([
        { $group: { _id: null, totalViews: { $sum: "$viewCount" } } },
      ]).catch(() => []),
      PublishedResult.aggregate([
        { $match: { viewCount: { $gte: 1 } } },
        { $group: { _id: null, count: { $sum: 1 }, avgViews: { $avg: "$viewCount" }, maxViews: { $max: "$viewCount" } } },
      ]).catch(() => []),
      PublishedResult.aggregate([
        { $match: { lastViewedAt: { $gte: since30 } } },
        { $group: { _id: null, totalViews: { $sum: "$viewCount" }, viewed: { $sum: 1 } } },
      ]).catch(() => []),
    ]);

    const dailySubmissions30d = dailyCounts30d.map((x) => {
      const mm = String(x._id.m).padStart(2, "0");
      const dd = String(x._id.d).padStart(2, "0");
      return { date: `${x._id.y}-${mm}-${dd}`, count: x.count };
    });

    const monthlyAll = monthlyCountsAll.map((x) => ({
      month: monthKey(x._id.y, x._id.m),
      year: x._id.y,
      monthNumber: x._id.m,
      count: x.count,
    }));

    const monthlyLast12 = monthlyCounts12.map((x) => ({
      month: monthKey(x._id.y, x._id.m),
      year: x._id.y,
      monthNumber: x._id.m,
      count: x.count,
    }));

    const yearlyAll = yearlyCountsAll.map((x) => ({ year: x._id.y, count: x.count }));

    // Repeat / power users (30d)
    const activeUsers30d = userSubmissionCounts30d.length;
    const repeatUsers30d = userSubmissionCounts30d.filter((u) => u.count >= 2).length;
    const repeatUserPercentage30d =
      activeUsers30d === 0 ? 0 : Math.round((repeatUsers30d / activeUsers30d) * 1000) / 10;

    const powerUsers30d = userSubmissionCounts30d.filter((u) => u.count >= POWER_USER_THRESHOLD).length;
    const powerUserPercentage30d =
      activeUsers30d === 0 ? 0 : Math.round((powerUsers30d / activeUsers30d) * 1000) / 10;

    // MoM Growth (MTD vs prev MTD)
    const momGrowthPct =
      submissionsPrevMTD === 0
        ? (submissionsCurrentMTD > 0 ? null : 0)
        : Math.round(((submissionsCurrentMTD - submissionsPrevMTD) / submissionsPrevMTD) * 1000) / 10;

    const monthOverMonth = {
      method: "month-to-date vs previous month-to-date (same day-of-month span)",
      currentMTD: { from: currentMonthStart.toISOString(), to: currentEnd.toISOString(), submissions: submissionsCurrentMTD },
      previousMTD: { from: previousMonthStart.toISOString(), to: prevEnd.toISOString(), submissions: submissionsPrevMTD },
      growthPercent: momGrowthPct,
    };

    const repeatUsersMonthlyLast12 = (repeatUsersMonthly12 || []).map((x) => {
      const month = monthKey(x._id.y, x._id.m);
      const activeUsers = x.activeUsers || 0;
      const repeatUsers = x.repeatUsers || 0;
      const repeatPct = activeUsers === 0 ? 0 : Math.round((repeatUsers / activeUsers) * 1000) / 10;
      return { month, year: x._id.y, monthNumber: x._id.m, activeUsers, repeatUsers, repeatPct };
    });

    const latency = latencyStats30d?.[0]
      ? {
          avgMs: Math.round(latencyStats30d[0].avg || 0),
          p95Ms: Math.round((latencyStats30d[0].p95?.[0] ?? 0) || 0),
          maxMs: Math.round(latencyStats30d[0].max || 0),
        }
      : null;

    const payload = {
      generatedAt: new Date().toISOString(),

      totals: { submissions: totalSubmissions, uniqueUsers: uniqueUsersTotal },

      activity: { submissionsToday, submissions7d, submissions30d, uniqueUsers30d },

      charts: {
        dailySubmissions30d,
        monthlySubmissionsAll: monthlyAll,
        monthlySubmissionsLast12: monthlyLast12,
        yearlySubmissionsAll: yearlyAll,
        repeatUsersMonthlyLast12,
      },

      derived: {
        repeatUserPercentage30d,
        repeatUsers30d,
        activeUsers30d,

        powerUserThreshold: POWER_USER_THRESHOLD,
        powerUsers30d,
        powerUserPercentage30d,

        monthOverMonth,
      },

      breakdowns30d: {
        topSubjects: topSubjects30d.map((x) => ({ subject: x._id, count: x.count })),
        topAssessmentTypes: topAssessmentTypes30d.map((x) => ({ assessmentType: x._id, count: x.count })),
        topGradeLevels: topGradeLevels30d.map((x) => ({ gradeLevel: x._id, count: x.count })),
      },

      performance30d: { latency },

      resultsPageViews: {
        published: resultsPublished || 0,
        totalViews: resultsTotalViewsAgg?.[0]?.totalViews || 0,
        resultsViewed: resultsViewedAgg?.[0]?.count || 0,
        avgViewsPerResult: Math.round((resultsViewedAgg?.[0]?.avgViews || 0) * 10) / 10,
        maxViews: resultsViewedAgg?.[0]?.maxViews || 0,
        viewedLast30d: resultsViewed30dAgg?.[0]?.viewed || 0,
      },

      cache: { ttlMs: CACHE_TTL_MS },
    };

    cache = { expiresAt: nowMs + CACHE_TTL_MS, value: payload };

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "no-store");
    return res.json(payload);
  } catch (err) {
    console.error("usage-summary failed:", err);
    return res.status(500).json({ error: "usage-summary failed" });
  }
});

export default router;
