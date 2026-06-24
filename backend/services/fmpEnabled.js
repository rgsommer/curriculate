// backend/services/fmpEnabled.js
//
// Single source of truth for whether FMP is active. Lets us keep all the
// FMP code in place — services, schemas, prompt formatters — and toggle
// the entire dependency off cleanly when the subscription lapses or we
// just want to pause it.
//
// FMP is enabled when:
//   - FMP_API_KEY is set AND non-empty, AND
//   - FMP_DISABLED is NOT "1" (kill-switch even if the key is present)
//
// All services should call isFmpEnabled() at the top of their hot paths
// and return a graceful "not available" payload instead of throwing or
// hitting the network when FMP is off.
export function isFmpEnabled() {
  if (process.env.FMP_DISABLED === "1") return false;
  const key = (process.env.FMP_API_KEY || "").trim();
  return key.length > 0;
}

// Short human-readable reason — surfaced in degraded payloads so the UI
// can distinguish "no subscription" from a transient network error.
export function fmpDisabledReason() {
  if (process.env.FMP_DISABLED === "1") return "fmp_kill_switch";
  if (!(process.env.FMP_API_KEY || "").trim()) return "no_fmp_key";
  return null;
}
