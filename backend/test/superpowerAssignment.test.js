// backend/test/superpowerAssignment.test.js
//
// Contracts under test:
//   - 25% roll probability threshold
//   - Sticky per (fingerprint + roomCode): same key ALWAYS yields the
//     same result, even after multiple calls with different opts
//   - Different roomCode = fresh roll for the same device
//   - Empty pool = null even at a winning roll (dev safety net)
//   - Fingerprint is deterministic + case-normalizes the roomCode

import {
  assignSuperpower,
  computeFingerprint,
  __testing,
} from "../services/superpowerAssignment.js";
import { getSuperpower } from "../../shared/superpowers.js";

const A_POOL = ["free_clue"];
const B_POOL = ["free_clue", "bonus_booster"];

beforeEach(() => __testing.clearCache());

describe("computeFingerprint", () => {
  test("is deterministic for the same inputs", () => {
    const info = { userAgent: "UA/1.0", deviceType: "tablet", cameraFacingModes: ["environment"], supportsTouch: true };
    const a = computeFingerprint({ clientDeviceInfo: info, roomCode: "ABCD" });
    const b = computeFingerprint({ clientDeviceInfo: info, roomCode: "ABCD" });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  test("changes when roomCode changes", () => {
    const info = { userAgent: "UA/1.0", deviceType: "tablet" };
    const a = computeFingerprint({ clientDeviceInfo: info, roomCode: "ABCD" });
    const b = computeFingerprint({ clientDeviceInfo: info, roomCode: "EFGH" });
    expect(a).not.toBe(b);
  });

  test("normalizes roomCode case", () => {
    const info = { userAgent: "UA/1.0" };
    const upper = computeFingerprint({ clientDeviceInfo: info, roomCode: "abcd" });
    const lower = computeFingerprint({ clientDeviceInfo: info, roomCode: "ABCD" });
    expect(upper).toBe(lower);
  });

  test("survives missing clientDeviceInfo via userAgent fallback", () => {
    const a = computeFingerprint({ clientDeviceInfo: null, roomCode: "ABCD", userAgent: "Fallback/1" });
    expect(a).toHaveLength(16);
    // Same userAgent + roomCode = same fingerprint
    const b = computeFingerprint({ clientDeviceInfo: null, roomCode: "ABCD", userAgent: "Fallback/1" });
    expect(a).toBe(b);
  });
});

describe("assignSuperpower — roll gating", () => {
  test("returns null when roll >= 0.25 (miss)", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-a", roomCode: "R1" },
      { roll: 0.5, pool: A_POOL, pick: 0 }
    );
    expect(out).toBeNull();
  });

  test("returns a superpower when roll < 0.25 (hit)", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-b", roomCode: "R1" },
      { roll: 0.1, pool: A_POOL, pick: 0 }
    );
    expect(out).not.toBeNull();
    expect(out.id).toBe("free_clue");
  });

  test("exactly 0.25 is a miss (strictly less than)", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-c", roomCode: "R1" },
      { roll: 0.25, pool: A_POOL, pick: 0 }
    );
    expect(out).toBeNull();
  });
});

describe("assignSuperpower — stickiness", () => {
  test("same (fingerprint, roomCode) always yields the same result", () => {
    const key = { fingerprint: "fp-sticky", roomCode: "STICKY" };
    // First call: winning roll, pick index 1 → bonus_booster
    const first = assignSuperpower(key, { roll: 0.1, pool: B_POOL, pick: 0.6 });
    expect(first.id).toBe("bonus_booster");
    // Second call with a LOSING roll and different pool: still returns the cached winner
    const second = assignSuperpower(key, { roll: 0.9, pool: A_POOL, pick: 0 });
    expect(second.id).toBe("bonus_booster");
    // Third call with no opts at all: still returns the cached winner
    const third = assignSuperpower(key);
    expect(third.id).toBe("bonus_booster");
  });

  test("initial miss stays a miss on subsequent calls, even with a winning roll", () => {
    const key = { fingerprint: "fp-miss", roomCode: "MISS" };
    const first = assignSuperpower(key, { roll: 0.99, pool: A_POOL });
    expect(first).toBeNull();
    const second = assignSuperpower(key, { roll: 0.01, pool: A_POOL, pick: 0 });
    expect(second).toBeNull();
  });

  test("different roomCode yields an independent fresh roll", () => {
    const fp = "fp-shared-device";
    const winKey = { fingerprint: fp, roomCode: "ROOM_A" };
    const first = assignSuperpower(winKey, { roll: 0.1, pool: B_POOL, pick: 0.6 });
    expect(first.id).toBe("bonus_booster");

    // Same fingerprint, new room — the cache is (fp+room), so this is a fresh roll.
    const freshKey = { fingerprint: fp, roomCode: "ROOM_B" };
    const second = assignSuperpower(freshKey, { roll: 0.99, pool: B_POOL });
    expect(second).toBeNull();
  });
});

describe("assignSuperpower — safety", () => {
  test("empty pool at a winning roll returns null (not a crash)", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-empty", roomCode: "R1" },
      { roll: 0.1, pool: [], pick: 0 }
    );
    expect(out).toBeNull();
  });

  test("pick=0 selects pool[0]", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-picka", roomCode: "R1" },
      { roll: 0.05, pool: B_POOL, pick: 0 }
    );
    expect(out.id).toBe("free_clue");
  });

  test("pick=0.99 selects the last pool entry", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-pickb", roomCode: "R1" },
      { roll: 0.05, pool: B_POOL, pick: 0.99 }
    );
    expect(out.id).toBe("bonus_booster");
  });
});

describe("catalog integration", () => {
  test("returned object carries expected metadata for the badge", () => {
    const out = assignSuperpower(
      { fingerprint: "fp-badge", roomCode: "R1" },
      { roll: 0.01, pool: ["free_clue"], pick: 0 }
    );
    expect(out).toEqual(expect.objectContaining({
      id: "free_clue",
      emoji: "🔍",
      name: "Free Clue",
      flavor: "help",
    }));
  });

  test("getSuperpower resolves known ids", () => {
    expect(getSuperpower("free_clue").name).toBe("Free Clue");
    expect(getSuperpower("does_not_exist")).toBeNull();
  });
});
