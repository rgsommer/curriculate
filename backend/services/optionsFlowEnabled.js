// backend/services/optionsFlowEnabled.js
//
// Kill-switch for the options-flow signal service. Follows the same
// pattern as fmpEnabled.js / fredEnabled.js.
//
// NOTE: the underlying Yahoo fallback path in stocksUnusualOptionsFlow.js
// is FREE and always works — so "disabled" here specifically means:
//
//   • Do NOT hit the Unusual Whales REST API (skip the paid data
//     source; the caller can still choose to fall back to Yahoo).
//
// The switch is enabled when:
//   - UNUSUAL_WHALES_API_KEY is set AND non-empty, AND
//   - OPTIONS_FLOW_DISABLED is NOT "1"
//
// The disabled state applies to the paid UW path only. Callers that
// want Yahoo-only behavior should just import stocksUnusualOptionsFlow
// directly; the unified stocksOptionsFlow service dispatches based on
// this switch.

export function isOptionsFlowEnabled() {
  if (process.env.OPTIONS_FLOW_DISABLED === "1") return false;
  const key = (process.env.UNUSUAL_WHALES_API_KEY || "").trim();
  return key.length > 0;
}

export function optionsFlowDisabledReason() {
  if (process.env.OPTIONS_FLOW_DISABLED === "1") return "options_flow_kill_switch";
  if (!(process.env.UNUSUAL_WHALES_API_KEY || "").trim()) return "no_uw_key";
  return null;
}
