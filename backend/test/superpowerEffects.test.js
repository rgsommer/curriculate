// backend/test/superpowerEffects.test.js
//
// Tier 1 activation guarantees:
//   armSuperpower — refuses when the team wasn't assigned this power,
//                   refuses when the team already used their power,
//                   accepts client-owned powers (slow_time, etc.)
//                   without setting pendingSuperpower.
//
//   applyBonusOrShield — 2× on positive with bonus_booster armed,
//                        absorb-to-zero on negative with point_shield armed,
//                        no-op when pending doesn't match the sign,
//                        one-shot: fires once then clears the pending flag.
//
//   applyMysteryGift — returns bonus + reveal on scan; clears the flag.

import {
  armSuperpower,
  applyBonusOrShield,
  applyMysteryGift,
  applySecondChance,
} from "../services/superpowerEffects.js";

const teamWith = (powerId, opts = {}) => ({
  teamId: "t1",
  superpower: powerId,
  superpowerUsedAt: opts.usedAt || null,
  pendingSuperpower: opts.pending || null,
});

describe("armSuperpower", () => {
  test("refuses if the team wasn't assigned this power", () => {
    const team = teamWith("free_clue");
    const r = armSuperpower(team, "bonus_booster");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not-assigned-this-power");
    expect(team.pendingSuperpower).toBeNull();
  });

  test("refuses if the team already used their power", () => {
    const team = teamWith("bonus_booster", { usedAt: "2026-01-01T00:00:00Z" });
    const r = armSuperpower(team, "bonus_booster");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("already-used");
  });

  test("accepts a client-owned power without setting pendingSuperpower", () => {
    const team = teamWith("slow_time");
    const r = armSuperpower(team, "slow_time");
    expect(r.ok).toBe(true);
    expect(r.clientOnly).toBe(true);
    expect(team.pendingSuperpower).toBeNull();
    expect(team.superpowerUsedAt).not.toBeNull();
  });

  test("arms a server-enforced power on the team record", () => {
    const team = teamWith("bonus_booster");
    const r = armSuperpower(team, "bonus_booster");
    expect(r.ok).toBe(true);
    expect(team.pendingSuperpower?.id).toBe("bonus_booster");
    expect(team.superpowerUsedAt).not.toBeNull();
  });

  test("refuses when team is null / missing", () => {
    expect(armSuperpower(null, "bonus_booster").ok).toBe(false);
    expect(armSuperpower(undefined, "bonus_booster").ok).toBe(false);
  });

  test("refuses when powerId is empty", () => {
    const team = teamWith("bonus_booster");
    expect(armSuperpower(team, "").ok).toBe(false);
  });
});

describe("applyBonusOrShield", () => {
  test("bonus_booster doubles positive points and clears the flag", () => {
    const team = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const r = applyBonusOrShield(team, 25);
    expect(r.pointsOut).toBe(50);
    expect(r.triggered).toBe("bonus_booster");
    expect(team.pendingSuperpower).toBeNull();
  });

  test("bonus_booster does NOT fire on zero or negative points", () => {
    const teamA = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const rA = applyBonusOrShield(teamA, 0);
    expect(rA.pointsOut).toBe(0);
    expect(rA.triggered).toBeNull();
    expect(teamA.pendingSuperpower).not.toBeNull(); // still armed

    const teamB = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const rB = applyBonusOrShield(teamB, -10);
    expect(rB.triggered).toBeNull();
    expect(teamB.pendingSuperpower).not.toBeNull(); // still armed
  });

  test("point_shield absorbs negative points to zero and clears the flag", () => {
    const team = teamWith("point_shield", { pending: { id: "point_shield" } });
    const r = applyBonusOrShield(team, -20);
    expect(r.pointsOut).toBe(0);
    expect(r.triggered).toBe("point_shield");
    expect(team.pendingSuperpower).toBeNull();
  });

  test("point_shield does NOT fire on positive or zero points", () => {
    const team = teamWith("point_shield", { pending: { id: "point_shield" } });
    const r = applyBonusOrShield(team, 15);
    expect(r.pointsOut).toBe(15);
    expect(r.triggered).toBeNull();
    expect(team.pendingSuperpower).not.toBeNull();
  });

  test("no-op when no pending power", () => {
    const team = teamWith("free_clue");
    const r = applyBonusOrShield(team, 25);
    expect(r).toEqual({ pointsOut: 25, triggered: null });
  });

  test("bonus is single-shot — second call does nothing", () => {
    const team = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    applyBonusOrShield(team, 25);
    const r2 = applyBonusOrShield(team, 25);
    expect(r2.pointsOut).toBe(25);
    expect(r2.triggered).toBeNull();
  });

  test("handles non-numeric point input gracefully", () => {
    const team = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const r = applyBonusOrShield(team, "not-a-number");
    expect(r.pointsOut).toBe(0);
    expect(r.triggered).toBeNull();
  });
});

describe("applySecondChance", () => {
  test("triggers on a wrong submission and clears the flag", () => {
    const team = teamWith("second_chance", { pending: { id: "second_chance" } });
    const r = applySecondChance(team, false);
    expect(r.triggered).toBe(true);
    expect(r.revealText).toMatch(/didn't count/);
    expect(team.pendingSuperpower).toBeNull();
  });

  test("does NOT fire on a correct submission (charge stays armed)", () => {
    const team = teamWith("second_chance", { pending: { id: "second_chance" } });
    const r = applySecondChance(team, true);
    expect(r.triggered).toBe(false);
    expect(team.pendingSuperpower).not.toBeNull();
  });

  test("does NOT fire when correctness is unresolved (correct === null)", () => {
    const team = teamWith("second_chance", { pending: { id: "second_chance" } });
    const r = applySecondChance(team, null);
    expect(r.triggered).toBe(false);
    expect(team.pendingSuperpower).not.toBeNull();
  });

  test("no-op when the team doesn't have Second Chance armed", () => {
    const team = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const r = applySecondChance(team, false);
    expect(r.triggered).toBe(false);
    expect(team.pendingSuperpower).not.toBeNull();
  });

  test("no-op when there's no pending superpower at all", () => {
    const team = teamWith("second_chance");
    const r = applySecondChance(team, false);
    expect(r.triggered).toBe(false);
  });

  test("one-shot semantics — second call is a no-op after the first fires", () => {
    const team = teamWith("second_chance", { pending: { id: "second_chance" } });
    applySecondChance(team, false);
    const r2 = applySecondChance(team, false);
    expect(r2.triggered).toBe(false);
  });
});

describe("applyMysteryGift", () => {
  test("returns +50 bonus and clears the flag", () => {
    const team = teamWith("mystery_gift", { pending: { id: "mystery_gift" } });
    const r = applyMysteryGift(team);
    expect(r.triggered).toBe(true);
    expect(r.bonus).toBe(50);
    expect(r.revealText).toMatch(/50 points/);
    expect(team.pendingSuperpower).toBeNull();
  });

  test("no-op when pending is not mystery_gift", () => {
    const team = teamWith("bonus_booster", { pending: { id: "bonus_booster" } });
    const r = applyMysteryGift(team);
    expect(r.triggered).toBe(false);
    expect(r.bonus).toBe(0);
    expect(team.pendingSuperpower).not.toBeNull(); // untouched
  });

  test("no-op when no pending power", () => {
    const team = teamWith("free_clue");
    const r = applyMysteryGift(team);
    expect(r).toEqual({ bonus: 0, revealText: "", triggered: false });
  });
});
