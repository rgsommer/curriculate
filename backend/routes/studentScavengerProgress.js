// backend/routes/studentScavengerProgress.js
//
// Public read-only endpoint used by the student-app's join screen to
// surface "Welcome back! 🔥 N-day streak · X sessions · Y pts" once a
// student has picked themselves from the bound class roster.
//
// Lookup is by edsbyId (the only stable identifier the student-app has
// at peek/join time). When a teacher launches sessions for the same
// student under multiple classes/emails, we aggregate across them so
// the student's total reflects all of their Curriculate activity.

import express from "express";
import StudentScavengerProgress from "../models/StudentScavengerProgress.js";

const router = express.Router();

router.get("/:edsbyId", async (req, res) => {
  try {
    const edsbyId = String(req.params.edsbyId || "").trim();
    if (!edsbyId) return res.status(400).json({ ok: false, error: "edsbyId required" });

    const docs = await StudentScavengerProgress.find({ edsbyId }).lean();
    if (!docs.length) {
      return res.json({ ok: true, progress: { totalSessions: 0, totalPoints: 0, streakDays: 0 } });
    }

    // Aggregate across teachers (same student under multiple emails)
    let totalSessions = 0;
    let totalPoints = 0;
    let streakDays = 0;
    let longestStreakDays = 0;
    let lastPlayedAt = null;
    let firstName = "";
    let lastName = "";
    let className = "";

    for (const d of docs) {
      totalSessions += Number(d.totalSessions) || 0;
      totalPoints += Number(d.totalPoints) || 0;
      streakDays = Math.max(streakDays, Number(d.streakDays) || 0);
      longestStreakDays = Math.max(longestStreakDays, Number(d.longestStreakDays) || 0);
      const lp = d.lastPlayedAt ? new Date(d.lastPlayedAt) : null;
      if (lp && (!lastPlayedAt || lp > lastPlayedAt)) lastPlayedAt = lp;
      if (!firstName && d.firstName) firstName = d.firstName;
      if (!lastName && d.lastName) lastName = d.lastName;
      if (!className && d.className) className = d.className;
    }

    return res.json({
      ok: true,
      progress: {
        firstName,
        lastName,
        className,
        totalSessions,
        totalPoints,
        streakDays,
        longestStreakDays,
        lastPlayedAt,
      },
    });
  } catch (err) {
    console.error("GET /student-scavenger-progress/:edsbyId error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Lookup failed." });
  }
});

export default router;
