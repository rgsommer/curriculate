// backend/services/superpowerAssignment.js
//
// Server-authoritative superpower assignment. Two contracts hold:
//
//   1. Deterministic per (device-fingerprint + roomCode). Same key
//      always resolves to the same result. This is what stops a
//      student from refreshing / re-joining under a new team name
//      to farm a better power — the roll is anchored to the device,
//      not the team name.
//
//   2. Fresh key = fresh roll. A new session (different roomCode)
//      resets eligibility for that device. This is deliberate so
//      the second class of the day on the same shared device still
//      has a chance.
//
// The cache is in-process and rebuilt on server restart. That's
// intentional: refreshes / rejoins within one session hit the same
// cache entry; across restarts the fingerprint hash still contains
// the roomCode, and rooms are ephemeral, so the same student in a
// new room would roll fresh anyway.

import crypto from "crypto";
import {
  getRollPool,
  getSuperpower,
  SUPERPOWER_ROLL_PROBABILITY,
} from "../../shared/superpowers.js";

// key: `${fingerprint}:${roomCode}` → { superpowerId: string|null }
// null value means "we already rolled for this key and they got nothing"
// so a rejoin doesn't get a second chance to win.
const assignmentCache = new Map();

/**
 * Build a stable 16-char hex fingerprint from whatever advisory device
 * info the student's browser reported at join time, plus the roomCode
 * so different rooms yield different fingerprints for the same device.
 *
 * If clientDeviceInfo is null (older client, or student before we
 * shipped device detection), we fall back to userAgent+roomCode from
 * the socket handshake — worse fidelity but still stable per-refresh.
 */
export function computeFingerprint({ clientDeviceInfo, roomCode, userAgent }) {
  const parts = [
    String(roomCode || "").toUpperCase(),
    String(clientDeviceInfo?.userAgent || userAgent || ""),
    String(clientDeviceInfo?.deviceType || "unknown"),
    (clientDeviceInfo?.cameraFacingModes || []).join(","),
    clientDeviceInfo?.supportsTouch ? "t" : "f",
  ];
  return crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Roll (or return the cached result of a prior roll) for the given
 * (fingerprint, roomCode) pair. Returns a full superpower object OR
 * null when no power was assigned.
 *
 * opts.roll / opts.pick — injectable for deterministic tests (0..1).
 * opts.pool          — override roll pool (test seam).
 */
export function assignSuperpower({ fingerprint, roomCode }, opts = {}) {
  const key = `${fingerprint}:${String(roomCode || "").toUpperCase()}`;
  if (assignmentCache.has(key)) {
    const cachedId = assignmentCache.get(key);
    return cachedId ? getSuperpower(cachedId) : null;
  }

  const roll = typeof opts.roll === "number" ? opts.roll : Math.random();
  if (roll >= SUPERPOWER_ROLL_PROBABILITY) {
    assignmentCache.set(key, null);
    return null;
  }

  const pool = opts.pool || getRollPool();
  if (pool.length === 0) {
    // Nothing implemented yet; treat as a miss so callers don't ship a
    // "coming soon" badge that reads worse than no badge at all.
    assignmentCache.set(key, null);
    return null;
  }
  const pick = typeof opts.pick === "number" ? opts.pick : Math.random();
  const chosen = pool[Math.floor(pick * pool.length) % pool.length];
  assignmentCache.set(key, chosen);
  return getSuperpower(chosen);
}

/**
 * Test-only helpers. Deliberately not exported to server startup code —
 * callers can import when writing suites. Runtime code should never
 * clear the cache; the whole point is that it's sticky per key.
 */
export const __testing = {
  clearCache: () => assignmentCache.clear(),
  cacheSize: () => assignmentCache.size,
  peek: (key) => assignmentCache.get(key),
};
