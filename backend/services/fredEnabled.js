// backend/services/fredEnabled.js
//
// Kill-switch for the FRED macro dashboard. Follows the same pattern as
// fmpEnabled.js: enabled when the API key is present AND the disable
// flag is NOT "1". Callers should short-circuit to a graceful
// { ok: false, reason: ... } payload when disabled instead of hitting
// the network.
//
// Enabled when:
//   - FRED_API_KEY is set AND non-empty, AND
//   - FRED_DISABLED is NOT "1"

export function isFredEnabled() {
  if (process.env.FRED_DISABLED === "1") return false;
  const key = (process.env.FRED_API_KEY || "").trim();
  return key.length > 0;
}

export function fredDisabledReason() {
  if (process.env.FRED_DISABLED === "1") return "fred_kill_switch";
  if (!(process.env.FRED_API_KEY || "").trim()) return "no_fred_key";
  return null;
}
