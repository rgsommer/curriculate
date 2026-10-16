// backend/behavior/lib/whiteSlipPenalty.js
//
// The optional white-slip house-point deduction (config.houseWhiteSlipDeduct /
// houseWhiteSlipPoints). It applies only once a white slip is CONFIRMED ISSUED —
// never at the recommendation, since the VP may decide on another consequence or
// another chance. Idempotent per white slip (HousePointEvent.consequenceId).

import mongoose from "mongoose";
import BehaviorConfig from "../models/BehaviorConfig.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import HousePointEvent from "../models/HousePointEvent.js";

export async function applyWhiteSlipPenalty(consequence, { awardedByTeacherId = null } = {}) {
  try {
    if (!consequence || consequence.type !== "White slip" || consequence.status !== "issued") return false;
    const config = await BehaviorConfig.findOne({ schoolId: consequence.schoolId })
      .select("houseWhiteSlipDeduct houseWhiteSlipPoints houseNegativePoints").lean();
    const pen = Number(config?.houseWhiteSlipPoints) || 0;
    // Only for schools that don't already deduct per offence (avoids double-counting).
    if (!config?.houseWhiteSlipDeduct || config?.houseNegativePoints || pen <= 0) return false;
    const exists = await HousePointEvent.exists({ schoolId: consequence.schoolId, consequenceId: consequence._id });
    if (exists) return false;
    const student = await BehaviorStudent.findById(consequence.studentId).select("houseId").lean();
    if (!student?.houseId) return false;
    const behaviorName = String(consequence.detail || "").split(" — ")[0] || "white slip";
    await HousePointEvent.create({
      schoolId: consequence.schoolId, houseId: student.houseId, studentId: consequence.studentId,
      points: -Math.abs(pen), reason: `White slip — ${behaviorName}`,
      incidentId: consequence.relatedIncidentId || null,
      consequenceId: new mongoose.Types.ObjectId(String(consequence._id)),
      awardedByTeacherId, at: new Date(),
    });
    return true;
  } catch (e) {
    console.warn("[behavior] white-slip penalty failed:", e?.message || e);
    return false;
  }
}
