// backend/models/StocksSpecialSituation.js
//
// Corporate-action / special-situation flag store — global (per-ticker),
// not per-user. Rows are populated by stocksSpecialSituationsPoll and
// read by the daily-pick preflight gate + the daily-briefing renderer.
//
// One doc per (ticker, dealKey). dealKey is a stable identifier derived
// from source + announced date + acquirer + target so multiple deals on
// the same ticker (a spin-off *and* a subsequent acquisition, or an
// amended offer) don't collide. Idempotent upsert on the composite key.
//
// The invariant that gates everything else: `active === true` means
// this ticker CANNOT be recommended as an ordinary swing/spec/core BUY.
// Downstream code either drops the candidate (SCREENED — ACTIVE M&A) or
// re-routes it to the event-driven arbitrage branch. Neither path is
// allowed to price an ordinary technical setup.
//
// Lifecycle: ANNOUNCED → PENDING → APPROVED → COMPLETED
//                    ↘ AMENDED (re-enters PENDING)
//                    ↘ TERMINATED / EXPIRED (active goes false; the
//                      ticker becomes eligible again)

import mongoose from "mongoose";

// Provenanced numeric — same shape as StocksExternalNomination so the
// audit layer can reason about numbers uniformly. `asOf` timestamps
// what the value represents; `source` names where it came from so a
// bad feed can be traced. Never trust these values without a source.
const ProvenancedNumberSchema = new mongoose.Schema(
  {
    value: { type: Number, default: null },
    unit: { type: String, default: null },       // "USD"|"CAD"|"shares_per_share"|"pct"
    currency: { type: String, default: null },
    asOf: { type: Date, default: null },
    source: { type: String, default: null },
    sourceType: { type: String, default: null }, // "FMP_MA_RSS"|"FMP_DEALS"|"SEC_8K_1_01"
  },
  { _id: false }
);

export const SPECIAL_SITUATION_KINDS = [
  "MERGER_TARGET",       // this ticker is being acquired
  "MERGER_ACQUIRER",     // this ticker is the acquirer (informational — not a gate)
  "TENDER_OFFER",        // hostile / cash tender
  "SPINOFF",             // parent is spinning off a subsidiary
  "GOING_PRIVATE",       // LBO / take-private
  "REVERSE_MERGER",      // shell-based
  "DELISTING",           // exchange delisting event
  "MATERIAL_LITIGATION", // reserved; not populated in Stage 1
];

export const SPECIAL_SITUATION_STATUSES = [
  "ANNOUNCED",   // definitive agreement signed but no shareholder / regulatory movement yet
  "PENDING",     // regulatory / shareholder approvals in flight
  "APPROVED",    // approvals cleared; awaiting close
  "AMENDED",     // deal terms modified — re-verify before pricing
  "COMPLETED",   // deal closed; ticker likely delisted or continues as acquirer
  "TERMINATED",  // deal called off — ticker returns to ordinary eligibility
  "EXPIRED",     // tender / offer expired without close
];

const StocksSpecialSituationSchema = new mongoose.Schema(
  {
    // ── identity ─────────────────────────────────────────────────
    ticker: { type: String, required: true, uppercase: true, index: true },
    exchange: { type: String, default: null },
    currency: { type: String, default: null },
    // Stable per-deal id: hash of source + announced + acquirer + target.
    // Ensures amendments/republishes upsert into the same doc.
    dealKey: { type: String, required: true },

    // ── classification ───────────────────────────────────────────
    kind: {
      type: String,
      enum: SPECIAL_SITUATION_KINDS,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: SPECIAL_SITUATION_STATUSES,
      required: true,
      index: true,
    },
    // Convenience — `active` is the single boolean the pick-engine
    // preflight gate reads. Kept in sync with `status`: any status
    // other than COMPLETED / TERMINATED / EXPIRED is `active: true`.
    active: { type: Boolean, required: true, default: true, index: true },

    // ── deal parties ─────────────────────────────────────────────
    acquirer: { type: String, default: null },        // display name
    acquirerTicker: { type: String, default: null },  // when publicly traded (for price verify)
    target: { type: String, default: null },          // display name

    // ── consideration terms ──────────────────────────────────────
    // Cash-only: cashPerShare set, stockRatio null.
    // Stock-only: stockRatio set, cashPerShare null.
    // Mixed: both set — implied value = cash + stockRatio × verified acquirer price.
    // No consideration terms: both null → fail-closed SCREENED (no arbitrage math on a stub).
    cashPerShare: { type: ProvenancedNumberSchema, default: null },
    stockRatio: { type: ProvenancedNumberSchema, default: null }, // acquirer shares PER target share

    // ── timeline ─────────────────────────────────────────────────
    announcedAt: { type: Date, default: null, index: true },
    expectedClose: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null }, // upstream feed's own last-modified

    // ── provenance ───────────────────────────────────────────────
    source: { type: String, default: null },     // "FMP_MA_RSS" | "FMP_DEALS" | "SEC_8K_1_01"
    sourceUrl: { type: String, default: null },
    sourceHeadline: { type: String, default: null },
    // 0..1 float. 1.0 == SEC 8-K Item 1.01 (definitive agreement); 0.8
    // == FMP structured deal record; 0.5 == RSS-only mention.
    // The preflight gate uses confidence to distinguish "SCREENED — ACTIVE M&A
    // (definitive)" from "flagged — unverified rumor".
    confidence: { type: Number, default: 0, min: 0, max: 1 },

    // Auto-expiry — refreshed each poll. When a deal completes or is
    // terminated, the poll sets active=false and expiresAt=now+90d so
    // downstream lookups get a clean falsey result once the tail
    // stops being interesting.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Composite unique: one doc per (ticker, dealKey). Multiple deals on
// the same ticker (spin-off + acquisition) coexist as distinct dealKeys.
StocksSpecialSituationSchema.index({ ticker: 1, dealKey: 1 }, { unique: true });
// Fast preflight lookup: "is this ticker currently in an active M&A?"
StocksSpecialSituationSchema.index({ ticker: 1, active: 1, status: 1 });
StocksSpecialSituationSchema.index({ announcedAt: -1 });

const StocksSpecialSituation =
  mongoose.models.StocksSpecialSituation ||
  mongoose.model("StocksSpecialSituation", StocksSpecialSituationSchema);

export default StocksSpecialSituation;
