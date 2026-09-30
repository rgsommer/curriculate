// backend/behavior/lib/guddAward.js
//
// Recycling the GUDD (Good Uniform Dress-Down) list for a new period doubles as
// a house competition: the house with the FEWEST excluded ("lost") members wins
// 1st, then 2nd and 3rd, and those houses are awarded house points. Ties share a
// place (all tied houses get that place's points); ties are broken by fewest
// total uniform infractions so near-equal houses still separate.
//
// Called by every reset path (Setup button, digest signed link, Friday cron) so
// the award always happens as part of clearing the list — then gudd.resetAt is
// stamped to start the fresh period.

import mongoose from "mongoose";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import BehaviorHouse from "../models/BehaviorHouse.js";
import BehaviorIncident from "../models/BehaviorIncident.js";
import HousePointEvent from "../models/HousePointEvent.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDINAL = ["1st", "2nd", "3rd"];

// Default placement points if the school hasn't customized them.
export const GUDD_AWARD_DEFAULTS = { enabled: true, first: 100, second: 60, third: 30 };

/**
 * Award GUDD placement house points for the period being closed, then stamp the
 * reset. Idempotent against accidental double-clicks: if the closing period has
 * no uniform infractions (e.g. a reset was just done), nothing is awarded.
 *
 * @returns {{ resetAt: Date, awarded: Array<{house,place,points,lost,infractions}>, enabled: boolean }}
 */
export async function awardGuddAndReset(schoolId, config) {
  const sid = typeof schoolId === "string" ? new mongoose.Types.ObjectId(schoolId) : schoolId;
  const cfg = config || (await BehaviorConfig.findOne({ schoolId: sid }).lean()) || {};
  const gcfg = cfg.gudd || {};
  const at = new Date();
  const awarded = [];

  if (gcfg.enabled === false) {
    await BehaviorConfig.updateOne({ schoolId: sid }, { $set: { "gudd.resetAt": at } });
    return { resetAt: at, awarded, enabled: false };
  }

  const award = { ...GUDD_AWARD_DEFAULTS, ...(gcfg.award || {}) };
  const pts = [Number(award.first) || 0, Number(award.second) || 0, Number(award.third) || 0];
  const threshold = gcfg.threshold ?? 3;
  const cutoff = new Date(Math.max(Date.now() - (gcfg.fadeWindowDays ?? 30) * DAY_MS, gcfg.resetAt ? new Date(gcfg.resetAt).getTime() : 0));

  // Active students grouped by house.
  const students = await BehaviorStudent.find({ schoolId: sid, active: true, houseId: { $ne: null } }).select("_id houseId").lean();
  const houseOf = Object.fromEntries(students.map((s) => [String(s._id), String(s.houseId)]));
  const memberCount = {};
  for (const s of students) memberCount[String(s.houseId)] = (memberCount[String(s.houseId)] || 0) + 1;

  // Uniform infractions per student in the closing period.
  const agg = await BehaviorIncident.aggregate([
    { $match: { schoolId: sid, studentId: { $in: students.map((s) => s._id) }, "behaviorSnapshot.uniform": true, timestamp: { $gt: cutoff } } },
    { $group: { _id: "$studentId", n: { $sum: 1 } } },
  ]);
  const totalInfractions = agg.reduce((a, b) => a + (b.n || 0), 0);

  const houses = await BehaviorHouse.find({ schoolId: sid, active: true }).select("name").lean();
  const lostBy = {}, infBy = {};
  for (const h of houses) { lostBy[String(h._id)] = 0; infBy[String(h._id)] = 0; }
  for (const a of agg) {
    const hid = houseOf[String(a._id)];
    if (!hid || !(hid in lostBy)) continue;
    infBy[hid] += a.n;
    if (a.n >= threshold) lostBy[hid] += 1;
  }

  // Rank houses that have members: fewest lost, then fewest total infractions.
  const ranked = houses
    .filter((h) => memberCount[String(h._id)])
    .map((h) => ({ id: String(h._id), name: h.name, lost: lostBy[String(h._id)] || 0, inf: infBy[String(h._id)] || 0 }))
    .sort((a, b) => a.lost - b.lost || a.inf - b.inf);
  const placeOf = (row) => 1 + ranked.filter((x) => x.lost < row.lost || (x.lost === row.lost && x.inf < row.inf)).length;

  // Only award when there was something to compete over this period. This also
  // makes an immediate second reset a no-op (no new infractions → no re-award).
  if (award.enabled !== false && totalInfractions > 0 && ranked.length) {
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
        reason: `${gcfg.name || "GUDD"} dress-down — ${ORDINAL[place - 1]} (fewest uniform infractions)`,
        at,
      });
      awarded.push({ house: row.name, place, points: p, lost: row.lost, infractions: row.inf });
    }
  }

  await BehaviorConfig.updateOne({ schoolId: sid }, { $set: { "gudd.resetAt": at, "gudd.lastAwardAt": at } });
  return { resetAt: at, awarded, enabled: true };
}
