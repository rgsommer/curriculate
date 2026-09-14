// backend/services/stocksActionAuthorization.js
//
// P4.1 (2026-09-11) — production action-authorization guard.
//
// Closes the original P0 concern for real (P4.1 spec §8): a BUY/SELL
// action emitted anywhere in the pipeline MUST NOT reach production
// unless its source is on this allowlist.
//
// Authorized BUY sources:
//   DAILY_PICK_VALIDATED      — deterministic daily pick that passed
//                               the pre-render BUY validator
//   MANDATE                   — validated mandate/redeploy target
//   MANDATE_REDEPLOY          — paired redeploy carrier for the above
//
// EVERYTHING ELSE is rejected: discoveryPool membership, P4 pick
// record membership (any classification, including BUY_CANDIDATE),
// watchlist rows, shadow-model qualification, external nominations
// alone — none of these authorize an actionable BUY.
//
// Authorized SELL / TRIM / EXIT / HOLD sources:
//   HOLD_CLASSIFIER           — deterministic HOLD/TRIM/EXIT classifier
//   MANDATE_TRIM_SELL_EXIT    — mandate factory (e.g. TRAIL STOP REVIEW)
//   REC_STOP_TRIGGERED        — a rec-owned stop firing on a held pos
//
// Additionally the ticker MUST correspond to a currently held position
// (checked when a `heldTickers` set is provided), and the classifier
// output MUST match the requested action.
//
// This module is a PURE FUNCTION — no Mongo, no network — so it drops
// straight into every rec-emission site (mandate factory, briefing
// deterministic renderer, AI post-generation critic).

export const AUTHORIZED_BUY_SOURCES = new Set([
  "DAILY_PICK_VALIDATED",
  "MANDATE",
  "MANDATE_REDEPLOY",
]);
export const AUTHORIZED_SELL_SOURCES = new Set([
  "HOLD_CLASSIFIER",
  "MANDATE_TRIM_SELL_EXIT",
  "REC_STOP_TRIGGERED",
]);
export const UNAUTHORIZED_SOURCES = new Set([
  "DISCOVERY_POOL",
  "P4_PICK_RECORD",
  "P4_BUY_CANDIDATE",
  "P4_SHADOW_QUALIFIED",
  "WATCHLIST",
  "EXTERNAL_NOMINATION",
  "AI_FREEFORM",
]);

// PUBLIC — the guard. Returns { authorized: bool, reason: string }.
// Never throws — callers can log and drop the recommendation.
export function authorizeRecommendation({
  action,               // "BUY" | "SELL" | "TRIM" | "EXIT" | "HOLD"
  ticker,
  source,               // one of the constants above OR unknown/free-form
  classifierAction,     // for SELL/TRIM/EXIT/HOLD: what the classifier said
  heldTickers,          // optional Set of currently held tickers
} = {}) {
  const act = String(action || "").toUpperCase();
  const src = String(source || "").toUpperCase();
  const t = String(ticker || "").toUpperCase();
  if (!t) return { authorized: false, reason: "missing-ticker" };
  if (!act) return { authorized: false, reason: "missing-action" };

  if (act === "BUY" || act === "ADD" || act === "REDEPLOY") {
    if (!AUTHORIZED_BUY_SOURCES.has(src)) {
      return { authorized: false, reason: `unauthorized-BUY-source:${src || "UNKNOWN"}` };
    }
    return { authorized: true, reason: `authorized-BUY:${src}` };
  }

  if (act === "SELL" || act === "TRIM" || act === "EXIT" || act === "HOLD") {
    // The ticker must be currently held.
    if (heldTickers instanceof Set && !heldTickers.has(t)) {
      return { authorized: false, reason: `${act}-on-non-held-ticker:${t}` };
    }
    if (!AUTHORIZED_SELL_SOURCES.has(src)) {
      return { authorized: false, reason: `unauthorized-${act}-source:${src || "UNKNOWN"}` };
    }
    // Action must match classifier output when the source is the
    // classifier. TRIM cannot silently become SELL.
    if (src === "HOLD_CLASSIFIER" && classifierAction) {
      const clf = String(classifierAction).toUpperCase();
      if (clf !== act) {
        return { authorized: false, reason: `action-mismatch:classifier=${clf}-vs-ai=${act}` };
      }
    }
    return { authorized: true, reason: `authorized-${act}:${src}` };
  }

  return { authorized: false, reason: `unknown-action:${act}` };
}

// PUBLIC — batch guard for a list of recommendations. Returns a
// parallel array of { rec, authorized, reason }.
export function authorizeBatch(recs, { heldTickers } = {}) {
  return (recs || []).map(rec => ({
    rec,
    ...authorizeRecommendation({ ...rec, heldTickers }),
  }));
}
