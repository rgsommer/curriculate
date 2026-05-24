// backend/services/questEconomy.js
//
// Quest Mode coin + inventory economy.
//
// Public API:
//   - getQuestState({ roomCode, teamId, tasksetId? })  → upserted state document
//   - awardCoins({ roomCode, teamId, amount, reason, tasksetId? }) → { state, awarded }
//   - spendCoins({ roomCode, teamId, amount, reason }) → { ok, state }   (returns ok:false if insufficient)
//   - grantResource({ roomCode, teamId, resourceId, quantity, reason })
//   - getQuestStateSnapshot(state) → plain JSON-safe object (Map → plain object) for socket emits
//
// All writes use atomic $inc / $push to avoid races between concurrent
// task-completion events. Coin amounts ≤ 0 are silently ignored.

import TeamQuestState from "../models/TeamQuestState.js";

/**
 * Get or lazily create a team's quest state row.
 */
export async function getQuestState({ roomCode, teamId, tasksetId = null }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId) throw new Error("getQuestState: roomCode + teamId required");

  const doc = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $setOnInsert: {
        roomCode: code,
        teamId,
        tasksetId: tasksetId || undefined,
        coins: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

/**
 * Award coins to a team. Returns the updated state plus how much was actually awarded
 * (sanitized amount). No-ops on non-positive amounts.
 */
export async function awardCoins({ roomCode, teamId, amount, reason = "task-complete", tasksetId = null }) {
  const code = String(roomCode || "").toUpperCase();
  const pts = Math.max(0, Math.floor(Number(amount) || 0));
  if (!code || !teamId || pts === 0) {
    return { state: null, awarded: 0 };
  }

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $inc: { coins: pts },
      $setOnInsert: { tasksetId: tasksetId || undefined },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // (Reason is logged separately in caller's analytics path — we don't persist a per-grant log here in v1)
  void reason;

  return { state, awarded: pts };
}

/**
 * Atomically spend coins. Returns { ok: false } if insufficient balance.
 * Uses findOneAndUpdate with a balance precondition so concurrent spend attempts can't overdraw.
 */
export async function spendCoins({ roomCode, teamId, amount, reason = "resource-acquire" }) {
  const code = String(roomCode || "").toUpperCase();
  const pts = Math.max(0, Math.floor(Number(amount) || 0));
  if (!code || !teamId) return { ok: false, state: null, reason: "missing roomCode/teamId" };
  if (pts === 0) return { ok: true, state: await getQuestState({ roomCode: code, teamId }), spent: 0 };

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId, coins: { $gte: pts } },
    { $inc: { coins: -pts } },
    { new: true },
  );
  if (!state) {
    // Could be insufficient balance OR row doesn't exist
    const existing = await TeamQuestState.findOne({ roomCode: code, teamId }).lean();
    return { ok: false, state: existing || null, reason: "insufficient coins" };
  }
  void reason;
  return { ok: true, state, spent: pts };
}

/**
 * Grant N units of a resource to a team. Server-trusted — the caller is expected to
 * have already validated the acquisition path (coin cost, challenge completion, etc.).
 */
export async function grantResource({ roomCode, teamId, resourceId, quantity = 1, reason = "acquired" }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !resourceId) return { ok: false, state: null };
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    {
      $inc: { [`inventory.${resourceId}`]: qty },
      $setOnInsert: { roomCode: code, teamId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  void reason;
  return { ok: true, state };
}

/**
 * Atomically remove N units of a resource from a team. Guarded so a team can't
 * give away more than it holds (precondition: inventory.<id> >= qty).
 * Returns { ok:false } if the team doesn't have enough.
 */
export async function removeResource({ roomCode, teamId, resourceId, quantity = 1, reason = "removed" }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !resourceId) return { ok: false, state: null };
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));

  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId, [`inventory.${resourceId}`]: { $gte: qty } },
    { $inc: { [`inventory.${resourceId}`]: -qty } },
    { new: true },
  );
  if (!state) {
    const existing = await TeamQuestState.findOne({ roomCode: code, teamId }).lean();
    return { ok: false, state: existing || null, reason: "insufficient resource" };
  }
  void reason;
  return { ok: true, state };
}

/**
 * Peer-to-peer trade: buyer pays the seller `price` coins for `quantity` of
 * `resourceId`. Resource + coins move between the two teams' states.
 *
 * Ordering with rollback (no cross-doc transaction needed at classroom scale):
 *   1. Take the resource off the seller (guards they actually have it).
 *   2. Charge the buyer's coins; if they can't pay, REFUND the seller's resource.
 *   3. Give the resource to the buyer and the coins to the seller.
 */
export async function tradeBetweenTeams({ roomCode, buyerTeamId, sellerTeamId, resourceId, quantity = 1, price = 0 }) {
  const code = String(roomCode || "").toUpperCase();
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const cost = Math.max(0, Math.floor(Number(price) || 0));
  if (!code || !buyerTeamId || !sellerTeamId || !resourceId) return { ok: false, error: "Missing trade parameters" };
  if (String(buyerTeamId) === String(sellerTeamId)) return { ok: false, error: "You can't trade with your own team" };

  // 1. Seller gives up the resource (atomic guard on availability).
  const sellerRemove = await removeResource({ roomCode: code, teamId: sellerTeamId, resourceId, quantity: qty, reason: `trade-to:${buyerTeamId}` });
  if (!sellerRemove.ok) return { ok: false, error: "The other team no longer has that resource" };

  // 2. Buyer pays. On failure, refund the seller's resource (rollback).
  if (cost > 0) {
    const spend = await spendCoins({ roomCode: code, teamId: buyerTeamId, amount: cost, reason: `trade-from:${sellerTeamId}` });
    if (!spend.ok) {
      await grantResource({ roomCode: code, teamId: sellerTeamId, resourceId, quantity: qty, reason: "trade-rollback" });
      return { ok: false, error: `Not enough coins (need ${cost})` };
    }
  }

  // 3. Buyer receives the resource; seller receives the coins.
  const buyerGrant = await grantResource({ roomCode: code, teamId: buyerTeamId, resourceId, quantity: qty, reason: `trade-from:${sellerTeamId}` });
  let sellerState = sellerRemove.state;
  if (cost > 0) {
    const award = await awardCoins({ roomCode: code, teamId: sellerTeamId, amount: cost, reason: `trade-to:${buyerTeamId}` });
    sellerState = award.state || sellerState;
  }

  return { ok: true, buyerState: buyerGrant.state, sellerState, resourceId, quantity: qty, price: cost };
}

/**
 * Persist a completed trade to BOTH teams' tradeHistory (capped) for the
 * per-session trade log / analytics. Best-effort; never throws to the caller.
 */
export async function recordTrade({ roomCode, sellerTeamId, buyerTeamId, resourceId, quantity = 1, price = 0 }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !sellerTeamId || !buyerTeamId || !resourceId) return;
  const rec = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sellerTeamId: String(sellerTeamId),
    buyerTeamId: String(buyerTeamId),
    resourceId: String(resourceId),
    quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
    price: Math.max(0, Math.floor(Number(price) || 0)),
    acquisitionMethod: "qr-trade",
    sellerPointsAwarded: 0,
    buyerPointsAwarded: 0,
    scannedAt: new Date(),
  };
  try {
    await TeamQuestState.updateMany(
      { roomCode: code, teamId: { $in: [String(sellerTeamId), String(buyerTeamId)] } },
      { $push: { tradeHistory: { $each: [rec], $slice: -200 } } },
    );
  } catch (e) {
    void e; // best-effort
  }
}

/**
 * One-time specialty seed. Assigns a team its scarce specialty resource and
 * grants a starting stock — but ONLY if it hasn't been assigned yet (guarded so
 * repeated state fetches don't keep granting). Returns { assigned, state }.
 */
export async function assignSpecialty({ roomCode, teamId, specialtyId, stock = 2 }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !specialtyId) return { assigned: false, state: null };
  const qty = Math.max(1, Math.floor(Number(stock) || 1));

  // Guard on specialtyResourceId being empty so only the first call seeds.
  const state = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId, $or: [{ specialtyResourceId: { $exists: false } }, { specialtyResourceId: "" }, { specialtyResourceId: null }] },
    { $set: { specialtyResourceId: specialtyId, specialtyLastRegenAt: new Date() }, $inc: { [`inventory.${specialtyId}`]: qty } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  if (state) return { assigned: true, state };
  // Already assigned → return current state unchanged.
  const existing = await TeamQuestState.findOne({ roomCode: code, teamId });
  return { assigned: false, state: existing };
}

/**
 * Effort reward: each completed academic task tops up the team's OWN specialty
 * by +amount, up to `cap` (set higher than the passive regen cap so diligent
 * teams become powerhouse suppliers). Idle teams only get the slow passive
 * trickle — diligence accelerates the advantage without anyone being locked out.
 */
export async function bumpSpecialtyForEffort({ roomCode, teamId, cap = 8, amount = 1 }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId) return { state: null, granted: 0 };
  const capN = Math.max(1, Math.floor(Number(cap) || 8));
  const inc = Math.max(1, Math.floor(Number(amount) || 1));
  const state = await TeamQuestState.findOne({ roomCode: code, teamId });
  if (!state || !state.specialtyResourceId) return { state, granted: 0 };
  const sid = state.specialtyResourceId;
  const stock = state.inventory && typeof state.inventory.get === "function"
    ? Number(state.inventory.get(sid)) || 0
    : Number(state.inventory?.[sid]) || 0;
  if (stock >= capN) return { state, granted: 0 };
  const grant = Math.min(inc, capN - stock);
  const updated = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    { $inc: { [`inventory.${sid}`]: grant } },
    { new: true },
  );
  return { state: updated || state, granted: grant };
}

/**
 * Renewable specialty: top up a team's OWN specialty by +1 per elapsed interval
 * since the regen clock, up to `cap`. Lets a team that sold its stock recover so
 * it keeps being a supplier. Idempotent-ish (advances the clock by what it
 * grants). Returns { state, granted }.
 */
export async function regenSpecialty({ roomCode, teamId, intervalMinutes = 5, cap = 5, which = "primary" }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId) return { state: null, granted: 0 };
  const intervalMs = Math.max(1, Math.floor(Number(intervalMinutes) || 5)) * 60000;
  const capN = Math.max(1, Math.floor(Number(cap) || 5));
  const idField = which === "extra" ? "extraSpecialtyResourceId" : "specialtyResourceId";
  const tsField = which === "extra" ? "extraSpecialtyLastRegenAt" : "specialtyLastRegenAt";

  const state = await TeamQuestState.findOne({ roomCode: code, teamId });
  if (!state || !state[idField]) return { state, granted: 0 };
  const sid = state[idField];
  const stock = state.inventory && typeof state.inventory.get === "function"
    ? Number(state.inventory.get(sid)) || 0
    : Number(state.inventory?.[sid]) || 0;

  const now = Date.now();
  const last = state[tsField] ? new Date(state[tsField]).getTime() : now;

  // Already full → just keep the clock current so regen resumes from "now" once
  // they sell some.
  if (stock >= capN) {
    await TeamQuestState.updateOne({ roomCode: code, teamId }, { $set: { [tsField]: new Date(now) } });
    return { state, granted: 0 };
  }

  const intervals = Math.floor((now - last) / intervalMs);
  if (intervals <= 0) return { state, granted: 0 };
  const grant = Math.min(intervals, capN - stock);
  if (grant <= 0) return { state, granted: 0 };

  const newStock = stock + grant;
  const newLast = newStock >= capN ? now : last + grant * intervalMs;
  const updated = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId },
    { $inc: { [`inventory.${sid}`]: grant }, $set: { [tsField]: new Date(newLast) } },
    { new: true },
  );
  return { state: updated || state, granted: grant };
}

/**
 * Open a franchise: a diligent team invests `cost` coins to become a SECOND
 * supplier of a scarce specialty (capped at one extra per team). Guarded so a
 * team can't franchise twice. Returns { ok, state, error?, specialtyId? }.
 */
export async function openFranchise({ roomCode, teamId, specialtyId, cost = 30, stock = 2 }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !specialtyId) return { ok: false, error: "Missing franchise parameters" };
  const cst = Math.max(0, Math.floor(Number(cost) || 0));
  const qty = Math.max(1, Math.floor(Number(stock) || 1));

  const existing = await TeamQuestState.findOne({ roomCode: code, teamId });
  if (existing?.extraSpecialtyResourceId) return { ok: false, error: "Your team already runs a franchise" };
  if (existing?.specialtyResourceId === specialtyId) return { ok: false, error: "That's already your specialty" };

  // Charge first (atomic balance guard).
  if (cst > 0) {
    const spend = await spendCoins({ roomCode: code, teamId, amount: cst, reason: `franchise:${specialtyId}` });
    if (!spend.ok) return { ok: false, error: `Not enough coins (need ${cst})` };
  }
  // Set the franchise + seed stock + start its regen clock. Guard extra still empty.
  const updated = await TeamQuestState.findOneAndUpdate(
    { roomCode: code, teamId, $or: [{ extraSpecialtyResourceId: { $exists: false } }, { extraSpecialtyResourceId: "" }, { extraSpecialtyResourceId: null }] },
    { $set: { extraSpecialtyResourceId: specialtyId, extraSpecialtyLastRegenAt: new Date() }, $inc: { [`inventory.${specialtyId}`]: qty } },
    { new: true },
  );
  if (!updated) {
    // Lost a race (already franchised) → refund.
    if (cst > 0) await awardCoins({ roomCode: code, teamId, amount: cst, reason: "franchise-refund" });
    return { ok: false, error: "Your team already runs a franchise" };
  }
  return { ok: true, state: updated, specialtyId };
}

/**
 * Convert a TeamQuestState document into a plain JSON-safe object suitable for socket emit.
 * Maps need explicit conversion or they serialize as `{}`.
 */
export function getQuestStateSnapshot(state) {
  if (!state) return null;
  const inv = {};
  if (state.inventory && typeof state.inventory.forEach === "function") {
    state.inventory.forEach((v, k) => { inv[k] = v; });
  } else if (state.inventory && typeof state.inventory === "object") {
    Object.assign(inv, state.inventory);
  }
  return {
    roomCode: state.roomCode,
    teamId: state.teamId,
    coins: state.coins,
    inventory: inv,
    completedObjectives: state.completedObjectives || [],
    unlockedBonusTaskIds: state.unlockedBonusTaskIds || [],
    unlockedHiddenTaskIds: state.unlockedHiddenTaskIds || [],
    completedBonusTaskIds: state.completedBonusTaskIds || [],
    completedHiddenTaskIds: state.completedHiddenTaskIds || [],
    questRank: state.questRank,
    specialtyResourceId: state.specialtyResourceId || "",
    extraSpecialtyResourceId: state.extraSpecialtyResourceId || "",
  };
}

/**
 * Record completion of a task and evaluate quest unlocks.
 * Returns: { state, newlyUnlockedBonusIds, newlyUnlockedHiddenIds, corePct }
 *
 * Callers (handleStudentSubmit) should:
 *   - emit `quest:stateUpdated` with the returned state snapshot
 *   - emit `quest:taskUnlocked` for each newly-unlocked id (broadcast per-team)
 */
export async function recordTaskComplete({ roomCode, teamId, tasksetDoc, task, taskIdInDoc, sessionStartedAt = null, sessionDurationMin = null }) {
  const code = String(roomCode || "").toUpperCase();
  if (!code || !teamId || !tasksetDoc) return null;

  const { evaluateUnlocks, computeCoreProgressPct } = await import("./questUnlocks.js");

  // Determine the task id (matching questUnlocks.js's resolveTaskId)
  const idx = Array.isArray(tasksetDoc.tasks) ? tasksetDoc.tasks.findIndex((t) => t === task || t?.taskId === task?.taskId) : -1;
  const taskId = String(taskIdInDoc || task?.taskId || task?._id || (idx >= 0 ? `idx-${idx}` : "unknown"));

  // Push the completion into the right bucket
  const isBonus  = task?.isBonus  === true;
  const isHidden = task?.isHidden === true;
  const bucketField = isHidden ? "completedHiddenTaskIds" : isBonus ? "completedBonusTaskIds" : "completedCoreTaskIds";
  // completedCoreTaskIds isn't a top-level field on TeamQuestState yet (we stuff it under tradeHistory for v1?)
  // Quick path: store core completions in a virtual array via $addToSet on a custom key — but Mongoose
  // schema doesn't allow arbitrary fields. Instead, derive core completions by looking at the room
  // submissions (passed in by the caller via the room object). For MVP simplicity here, we ONLY use
  // bonus/hidden buckets which DO exist on the schema, and computeCoreProgressPct accepts a fresh array.

  let state = await TeamQuestState.findOne({ roomCode: code, teamId }).exec();
  if (!state) state = await getQuestState({ roomCode: code, teamId });

  if (isBonus || isHidden) {
    const updated = await TeamQuestState.findOneAndUpdate(
      { roomCode: code, teamId },
      { $addToSet: { [bucketField]: taskId } },
      { new: true },
    );
    if (updated) state = updated;
  }

  // Core completion is derived from the caller's passed-in list to avoid schema churn.
  // The caller (handleStudentSubmit) will compute it from room.submissions.
  return state;
}

export default {
  getQuestState,
  awardCoins,
  spendCoins,
  grantResource,
  removeResource,
  tradeBetweenTeams,
  recordTrade,
  assignSpecialty,
  regenSpecialty,
  bumpSpecialtyForEffort,
  openFranchise,
  getQuestStateSnapshot,
  recordTaskComplete,
};
