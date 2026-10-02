// backend/behavior/lib/monthlyConductAward.js
//
// Month-end conduct competition: on the last school day of each month, the
// houses with the FEWEST infractions that month win 1st/2nd/3rd and are awarded
// house points. This is a POSITIVE, all-upside signal that sits ON TOP of the
// small per-infraction deductions (which stay for immediate, specific feedback).
//
// To avoid double-counting the same behaviour, ranking is by infraction COUNT
// (not points) — a genuinely different measure from the severity-weighted
// running total. Uniform infractions are excluded by default (they have their
// own GUDD dress-down award); set includeUniform to fold them in.
//
// Ties share a place (all tied houses get that place's points). Idempotent per
// month via monthlyConductAward.lastAwardMonth.

import mongoose from "mongoose";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import BehaviorHouse from "../models/BehaviorHouse.js";
import BehaviorIncident from "../models/BehaviorIncident.js";
import HousePointEvent from "../models/HousePointEvent.js";
import { isNonSchoolDay, nextSchoolDay } from "./schoolCalendar.js";

const ORDINAL = ["1st", "2nd", "3rd"];
export const MONTHLY_CONDUCT_DEFAULTS = { enabled: true, first: 100, second: 60, third: 30, includeUniform: false };

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthName(d) {
  return d.toLocaleString("en-US", { month: "long" });
}

/** True when `today` is a school day and the next school day is in another month. */
export function isLastSchoolDayOfMonth(today, manualNonSchoolDays = []) {
  const manualSet = new Set(manualNonSchoolDays);
  if (isNonSchoolDay(today, manualSet)) return false;
  const nxt = nextSchoolDay(today, { manualNonSchoolDays });
  return nxt.getMonth() !== today.getMonth() || nxt.getFullYear() !== today.getFullYear();
}

/**
 * Award month-end conduct house points for the calendar month containing `now`.
 * @returns {{ awarded: Array, monthKey: string, skipped?: string }}
 */
export async function awardMonthlyConduct(schoolId, config, { now = new Date(), force = false } = {}) {
  const sid = typeof schoolId === "string" ? new mongoose.Types.ObjectId(schoolId) : schoolId;
  const cfg = config || (await BehaviorConfig.findOne({ schoolId: sid }).lean()) || {};
  const mc = { ...MONTHLY_CONDUCT_DEFAULTS, ...(cfg.monthlyConductAward || {}) };
  const mk = monthKey(now);

  if (mc.enabled === false) return { awarded: [], monthKey: mk, skipped: "disabled" };
  if (!force && cfg.monthlyConductAward?.lastAwardMonth === mk) return { awarded: [], monthKey: mk, skipped: "already-awarded" };

  const pts = [Number(mc.first) || 0, Number(mc.second) || 0, Number(mc.third) || 0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  const students = await BehaviorStudent.find({ schoolId: sid, active: true, houseId: { $ne: null } }).select("_id houseId").lean();
  const studentIds = students.map((s) => s._id);
  const houseOf = Object.fromEntries(students.map((s) => [String(s._id), String(s.houseId)]));
  const memberCount = {};
  for (const s of students) memberCount[String(s.houseId)] = (memberCount[String(s.houseId)] || 0) + 1;

  const houses = await BehaviorHouse.find({ schoolId: sid, active: true }).select("name").lean();
  const metricBy = {};
  for (const h of houses) metricBy[String(h._id)] = 0;

  const byPositive = mc.basis === "most_positive";
  if (byPositive) {
    // Greatest positive individual points earned this month wins.
    const agg = await HousePointEvent.aggregate([
      { $match: { schoolId: sid, studentId: { $in: studentIds }, points: { $gt: 0 }, at: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: "$studentId", v: { $sum: "$points" } } },
    ]);
    for (const a of agg) {
      const hid = houseOf[String(a._id)];
      if (hid && hid in metricBy) metricBy[hid] += a.v;
    }
  } else {
    // Fewest infractions wins: real deductions (points < 0), excluding documented
    // interactions (0 pts) and positives; uniform excluded unless configured in.
    const match = {
      schoolId: sid,
      studentId: { $in: studentIds },
      timestamp: { $gte: monthStart, $lt: monthEnd },
      "behaviorSnapshot.points": { $lt: 0 },
    };
    if (!mc.includeUniform) match["behaviorSnapshot.uniform"] = { $ne: true };
    const agg = await BehaviorIncident.aggregate([
      { $match: match },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    for (const a of agg) {
      const hid = houseOf[String(a._id)];
      if (hid && hid in metricBy) metricBy[hid] += a.n;
    }
  }

  // Rank houses that have members. most_positive → highest metric wins;
  // fewest_infractions → lowest metric wins. Ties share a place.
  const ranked = houses
    .filter((h) => memberCount[String(h._id)])
    .map((h) => ({ id: String(h._id), name: h.name, metric: metricBy[String(h._id)] || 0 }))
    .sort((a, b) => (byPositive ? b.metric - a.metric : a.metric - b.metric));
  const placeOf = (row) => 1 + ranked.filter((x) => (byPositive ? x.metric > row.metric : x.metric < row.metric)).length;
  const reasonSuffix = byPositive ? "most positive points" : "fewest infractions";

  const awarded = [];
  const at = now;
  if (ranked.length) {
    for (const row of ranked) {
      const place = placeOf(row);
      if (place > 3) continue;
      const p = pts[place - 1] || 0;
      if (!p) continue;
      await HousePointEvent.create({
        schoolId: sid,
        houseId: new mongoose.Types.ObjectId(row.id),
        studentId: null,
        points: p,
        reason: `Conduct — ${monthName(now)}: ${ORDINAL[place - 1]} (${reasonSuffix})`,
        at,
      });
      awarded.push({ house: row.name, place, points: p, metric: row.metric });
    }
  }

  await BehaviorConfig.updateOne({ schoolId: sid }, { $set: { "monthlyConductAward.lastAwardMonth": mk, "monthlyConductAward.lastAwardAt": at } });
  return { awarded, monthKey: mk };
}
