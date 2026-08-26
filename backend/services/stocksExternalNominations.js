// backend/services/stocksExternalNominations.js
//
// External Recommendation / Conviction Discovery Layer — orchestrator.
//
// Contract with the rest of the system (from the design spec):
//
//   • External sources NOMINATE, Stocks Advisor DECIDES.
//   • baseComposite is FROZEN — no changes to existing weights.
//   • enhancedComposite = baseComposite + externalAdjustment, where
//     externalAdjustment is capped at +5 and derived from a signed,
//     freshness-decayed, category-deduplicated externalConvictionScore
//     (0-10 raw). External can NEVER change SCREENED to BUY because
//     every hard gate (R/R, price-verify, MTF, sleeve, canonical,
//     funding, kill-switch) runs on values unchanged by this layer.
//   • Category dedup: five sites repeating one upgrade collapses to
//     one SELL_SIDE observation. Confluence requires DIFFERENT
//     categories agreeing.
//   • Signed strength: EXIT / DOWNGRADE / TARGET_CUT are negative;
//     the layer can DEDUCT from enhancedComposite when signals
//     collectively lean negative.
//   • 13F is heavily freshness-discounted because of the 45-day filing
//     lag baseline — a "new position" surfaced in a Q3 filing landing
//     in mid-Q4 is still 90+ days stale.
//
// Three launch adapters:
//   • INSIDER      — SEC Form 4 cluster buys (stocksInsiderSignals.js)
//   • SELL_SIDE    — FMP /stable/grades (stocksCatalystsFmp.js)
//   • INSTITUTIONAL — 13F whale filings (stocks13F.js)
//
// Adapter interface (generic so EDITORIAL / QUANTITATIVE etc. slot in
// later without schema changes):
//
//   async function adapter_fetch_${sourceKey}(ticker) → [{
//     sourceKey, sourceCategory, action, strengthRaw (signed, roughly -10..+10),
//     publishedAt, priceAtNomination?, thesis?, catalyst?,
//     citation?, adapterDetail?
//   }, ...]
//
// The aggregator applies freshness decay, per-category dedup, then
// sums into a bounded [-10, 10] rawExternalScore. externalConvictionScore
// = max(0, rawExternalScore). externalAdjustment = clamp(0, 5,
// round(rawExternalScore / 2)) — half the raw score, hard-capped at 5.
// A negative rawExternalScore does NOT contribute to enhancedComposite
// (adjustment floors at 0) but IS surfaced separately so the operator
// sees "external signals net negative" in the display.

import StocksExternalNomination, { NOMINATION_CATEGORIES } from "../models/StocksExternalNomination.js";
import { getRecentInsiderSignals } from "./stocksInsiderSignals.js";
import { getCatalysts } from "./stocksCatalystsFmp.js";
import { getLatestWhaleFilings } from "./stocks13F.js";

// ─── Tunables (kept module-local so the ablation test can flip them) ──
export const EXTERNAL_ADJUSTMENT_CAP = 5;           // enhancedComposite = base + [0..CAP]
export const EXTERNAL_RAW_SCORE_CAP = 10;           // absolute per-category
export const CATEGORY_DEDUP_STRATEGY = "average-then-sum-across-categories";

// Freshness half-life in DAYS by category. INSIDER is short — cluster
// buys lose meaning fast because the info leaks. INSTITUTIONAL is
// heavily discounted because of the 13F 45-day lag (see stocks13F.js
// comments). SELL_SIDE upgrades decay over the analyst-refresh cycle.
const FRESHNESS_HALFLIFE_DAYS = {
  INSIDER: 30,
  SELL_SIDE: 21,
  INSTITUTIONAL: 15,        // aggressive — 13F is stale by the time we see it
  EDITORIAL: 14,
  QUANTITATIVE: 30,
  FUNDAMENTAL: 60,
  TECHNICAL_MOMENTUM: 5,
  ALTERNATIVE_DATA: 30,
};

function freshnessDecay(publishedAt, category) {
  if (!publishedAt) return 0.25;
  const halflife = FRESHNESS_HALFLIFE_DAYS[category] || 30;
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  if (ageDays < 0) return 1.0;
  // Simple exponential: 1.0 at t=0, 0.5 at halflife, 0.25 at 2×halflife.
  return Math.max(0.05, Math.pow(0.5, ageDays / halflife));
}

// ─── Adapter: INSIDER (SEC Form 4 clusters) ────────────────────────────
// Reads StocksInsiderSignal via the existing service. cluster_buy →
// CLUSTER_BUY (positive strength), cluster_sell → CLUSTER_SELL (negative).
async function fetchInsiderNominations(ticker) {
  try {
    const base = String(ticker).toUpperCase().replace(/\..*$/, "");
    const signals = await getRecentInsiderSignals([base], { days: 45, limit: 20 });
    return (signals || []).map(s => {
      const isBuy = s.kind === "cluster_buy";
      // Strength derived from the signal's own strength score (0-100 scale)
      // then normalized to -10..+10. Bounded so a single monster buy
      // can't dominate the aggregate.
      const normalized = Math.min(10, (s.strength || 0) / 10);
      return {
        sourceKey: "sec-form4-cluster",
        sourceCategory: "INSIDER",
        action: isBuy ? "CLUSTER_BUY" : "CLUSTER_SELL",
        strengthRaw: isBuy ? normalized : -normalized,
        publishedAt: s.detectedAt || s.transactionDate || null,
        thesis: s.summary || null,
        adapterDetail: {
          insiderCount: s.insiderCount,
          totalValueUsd: s.totalValueUsd,
          roles: s.roles,
          strengthScore: s.strength,
        },
        citation: { title: `SEC Form 4 cluster (${s.insiderCount || "?"} insiders)`, publisher: "SEC EDGAR" },
      };
    });
  } catch (e) {
    console.warn(`[external-nominations] insider adapter failed for ${ticker}:`, e?.message);
    return [];
  }
}

// ─── Adapter: SELL_SIDE (FMP analyst grades) ───────────────────────────
// Reads the same /stable/grades response getCatalysts already fetches
// (30-day window). Distinguishes UPGRADE / DOWNGRADE / TARGET_RAISE /
// TARGET_CUT / INITIATION so downstream analytics can measure which
// action type is most predictive.
//
// Dedup: multiple actions on the SAME calendar day for the same
// ticker/action-type are averaged into one nomination, not summed.
// So 5 firms upgrading MU on the same day count as ONE SELL_SIDE
// UPGRADE signal at averaged strength, not five independent ones.
async function fetchSellSideNominations(ticker, currency = "USD") {
  try {
    const cat = await getCatalysts(ticker, currency);
    if (!cat?.ok || !Array.isArray(cat.analysts)) return [];
    const nominations = [];
    // Group by (day, action-type) for dedup.
    const bucketMap = new Map();
    for (const a of cat.analysts) {
      const action = classifySellSideAction(a);
      if (!action) continue;
      const key = `${a.date}|${action}`;
      if (!bucketMap.has(key)) bucketMap.set(key, { action, date: a.date, actions: [] });
      bucketMap.get(key).actions.push(a);
    }
    for (const bucket of bucketMap.values()) {
      const count = bucket.actions.length;
      const rawStrength = actionStrength(bucket.action);
      // Averaging: multiple firms same day = one nomination at same
      // magnitude (not additive). Log the count in adapterDetail so
      // consumers can see there was consensus.
      nominations.push({
        sourceKey: "fmp-analyst-grades",
        sourceCategory: "SELL_SIDE",
        action: bucket.action,
        strengthRaw: rawStrength, // signed
        publishedAt: bucket.date ? new Date(bucket.date) : null,
        thesis: `${bucket.action.toLowerCase().replace("_", " ")} — ${bucket.actions.map(a => a.firm).slice(0, 3).join(", ")}${count > 3 ? ` +${count - 3} more` : ""}`,
        adapterDetail: {
          firmsCount: count,
          firms: bucket.actions.map(a => a.firm),
          priceTargets: bucket.actions.map(a => a.priceTarget).filter(x => Number.isFinite(x)),
        },
        citation: { title: `FMP analyst ${bucket.action.toLowerCase()}`, publisher: "FMP grades feed" },
      });
    }
    return nominations;
  } catch (e) {
    console.warn(`[external-nominations] sell-side adapter failed for ${ticker}:`, e?.message);
    return [];
  }
}

function classifySellSideAction(a) {
  const action = String(a.action || "").toLowerCase();
  const priorHasTarget = a.priorGrade && String(a.priorGrade).match(/\$?\d/);
  const newHasTarget = Number.isFinite(a.priceTarget);
  if (/initiat/.test(action)) return "INITIATION";
  if (/upgrade/.test(action)) return "UPGRADE";
  if (/downgrade/.test(action)) return "DOWNGRADE";
  // Target changes without grade change fold in.
  if (newHasTarget && /raise|increas/.test(action)) return "TARGET_RAISE";
  if (newHasTarget && /cut|reduc|lower/.test(action)) return "TARGET_CUT";
  return null;
}

function actionStrength(action) {
  switch (action) {
    case "UPGRADE": return 6;
    case "DOWNGRADE": return -6;
    case "INITIATION": return 4;
    case "TARGET_RAISE": return 3;
    case "TARGET_CUT": return -3;
    case "NEW_POSITION": return 5;
    case "INCREASE": return 3;
    case "DECREASE": return -3;
    case "EXIT": return -5;
    case "CLUSTER_BUY": return 6;
    case "NOTABLE_BUY": return 3;
    case "CLUSTER_SELL": return -6;
    case "NOTABLE_SELL": return -3;
    case "RECOMMENDATION": return 4;
    case "REVISED_RECOMMENDATION": return 2;
    case "COVERAGE": return 1;
    default: return 0;
  }
}

// ─── Adapter: INSTITUTIONAL (13F whale filings) ────────────────────────
// Reads the latest 13F for every tracked whale and diffs. Distinguishes
// NEW_POSITION / INCREASE (>20%) / DECREASE (<-20%) / EXIT so a full
// Berkshire liquidation is captured as negative. Freshness decay is
// aggressive (halflife 15d) because the 45-day filing lag means every
// 13F signal is already stale by baseline.
async function fetchInstitutionalNominations(ticker) {
  try {
    const base = String(ticker).toUpperCase().replace(/\..*$/, "");
    const filings = await getLatestWhaleFilings();
    const nominations = [];
    for (const f of (filings || [])) {
      const holdings = Array.isArray(f.holdings) ? f.holdings : [];
      const match = holdings.find(h => String(h.ticker || "").toUpperCase().replace(/\..*$/, "") === base);
      if (!match) continue;
      // Classify the change.
      let action = null;
      if (match.isNewPosition) action = "NEW_POSITION";
      else if (match.changePct != null && match.changePct >= 20) action = "INCREASE";
      else if (match.changePct != null && match.changePct <= -20) action = "DECREASE";
      else if ((match.sharesHeld || 0) === 0) action = "EXIT";
      if (!action) continue;
      const strength = actionStrength(action);
      // Effective published date is the quarter-end, per SEC filing
      // convention. Quarter-end is what governs freshness decay —
      // adapter date (filing acceptance date, 45d later) would let
      // stale 13Fs masquerade as fresh signals.
      nominations.push({
        sourceKey: `13f-${(f.name || "unknown").toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
        sourceCategory: "INSTITUTIONAL",
        action,
        strengthRaw: strength,
        publishedAt: f.quarterEnd ? new Date(f.quarterEnd) : (f.filedAt ? new Date(f.filedAt) : null),
        thesis: `${f.name || "whale"} — ${action}${Number.isFinite(match.changePct) ? ` (${match.changePct >= 0 ? "+" : ""}${match.changePct.toFixed(0)}%)` : ""}`,
        adapterDetail: {
          whaleCik: f.cik,
          whaleName: f.name,
          quarterEnd: f.quarterEnd,
          sharesHeld: match.sharesHeld,
          changePct: match.changePct,
        },
        citation: { title: `13F-HR — ${f.name || "whale"} Q${quarterOf(f.quarterEnd)}`, publisher: "SEC EDGAR" },
      });
    }
    return nominations;
  } catch (e) {
    console.warn(`[external-nominations] institutional adapter failed for ${ticker}:`, e?.message);
    return [];
  }
}

function quarterOf(dateLike) {
  if (!dateLike) return "?";
  const d = new Date(dateLike);
  const m = d.getUTCMonth();
  return `${d.getUTCFullYear()}Q${Math.floor(m / 3) + 1}`;
}

// ─── Aggregator ───────────────────────────────────────────────────────
// Returns the layer's public contract:
//
//   {
//     externalConvictionScore,   // 0-10, raw external agreement magnitude (positive-only)
//     externalAdjustment,        // 0-5, capped additive on enhancedComposite
//     rawExternalScore,          // -10..+10, signed — negative surfaces "net negative external"
//     categoriesAgreeing,        // integer count of DIFFERENT categories contributing positively
//     categoryContributions,     // per-category signed strengths (post-decay, post-dedup)
//     nominations,               // raw nomination array for display + persistence
//     attribution,               // {externallyDiscovered, alreadyInInternalUniverse,
//                                //  externalConfirmed, externalContradicted}
//   }
//
// caller passes:
//   ticker: the symbol to query
//   opts.baseComposite: (optional) internal composite for attribution flag
//   opts.internalUniverse: (optional) Set of tickers our own screens surfaced,
//                          for externallyDiscovered vs alreadyInInternalUniverse
export async function getExternalConvictionForTicker(ticker, opts = {}) {
  const currency = opts.currency || "USD";
  const [insider, sellSide, institutional] = await Promise.all([
    fetchInsiderNominations(ticker),
    fetchSellSideNominations(ticker, currency),
    fetchInstitutionalNominations(ticker),
  ]);
  const all = [...insider, ...sellSide, ...institutional];

  // Category dedup + freshness decay. Within a category, the STRONGEST
  // decayed signal wins (not summed) so 5 upgrades on 5 different days
  // don't stack. This is intentional — we want confluence ACROSS
  // categories, not within.
  const byCategory = new Map();
  for (const n of all) {
    const decay = freshnessDecay(n.publishedAt, n.sourceCategory);
    const decayedStrength = n.strengthRaw * decay;
    const existing = byCategory.get(n.sourceCategory);
    if (!existing || Math.abs(decayedStrength) > Math.abs(existing.decayed)) {
      byCategory.set(n.sourceCategory, {
        category: n.sourceCategory,
        decayed: decayedStrength,
        rawStrength: n.strengthRaw,
        decay,
        winningNomination: n,
        countInCategory: (existing?.countInCategory || 0) + 1,
      });
    } else {
      existing.countInCategory += 1;
    }
  }

  const categoryContributions = [...byCategory.values()];
  const rawExternalScore = clamp(
    categoryContributions.reduce((s, c) => s + c.decayed, 0),
    -EXTERNAL_RAW_SCORE_CAP,
    EXTERNAL_RAW_SCORE_CAP
  );
  const externalConvictionScore = Math.max(0, rawExternalScore);
  // externalAdjustment is HALF the raw score, capped at CAP. Half so
  // 10/10 raw external gives +5 composite (design cap); 6/10 gives +3.
  // Floored at 0 — negative external never DEDUCTS from enhancedComposite
  // (surfaced separately so the operator sees "external net negative"
  // without breaking the base composite's contract).
  const externalAdjustment = Math.max(0, Math.min(
    EXTERNAL_ADJUSTMENT_CAP,
    Math.round(rawExternalScore / 2)
  ));
  const categoriesAgreeing = categoryContributions.filter(c => c.decayed > 0).length;

  // Attribution flags.
  const attribution = {
    externallyDiscovered: !!opts.internalUniverse && !opts.internalUniverse.has(String(ticker).toUpperCase().replace(/\..*$/, "")),
    alreadyInInternalUniverse: !!opts.internalUniverse && opts.internalUniverse.has(String(ticker).toUpperCase().replace(/\..*$/, "")),
    externalConfirmed: opts.baseComposite != null && opts.baseComposite >= 60 && rawExternalScore > 0,
    externalContradicted: opts.baseComposite != null && opts.baseComposite >= 60 && rawExternalScore < 0,
  };

  return {
    ticker: String(ticker).toUpperCase(),
    externalConvictionScore,
    externalAdjustment,
    rawExternalScore,
    categoriesAgreeing,
    categoryContributions,
    nominations: all,
    attribution,
  };
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ─── Persistence ──────────────────────────────────────────────────────
// Persist nominations for source-performance tracking. Idempotent on
// (ticker, sourceKey, publishedAt) so re-runs don't dupe. Called from
// the daily sync cron; can also be called ad-hoc from the discovery
// pipeline to snapshot nominations at scan time.
export async function persistNominations(nominations, opts = {}) {
  if (!Array.isArray(nominations) || nominations.length === 0) return 0;
  let inserted = 0;
  for (const n of nominations) {
    try {
      const doc = await StocksExternalNomination.findOneAndUpdate(
        {
          ticker: n.ticker || opts.ticker,
          sourceKey: n.sourceKey,
          publishedAt: n.publishedAt,
        },
        {
          $setOnInsert: {
            ticker: (n.ticker || opts.ticker || "").toUpperCase(),
            sourceKey: n.sourceKey,
            sourceCategory: n.sourceCategory,
            action: n.action,
            strengthRaw: n.strengthRaw,
            publishedAt: n.publishedAt,
            discoveredAt: new Date(),
            thesis: n.thesis,
            citation: n.citation,
            adapterDetail: n.adapterDetail,
            externallyDiscovered: !!(opts.internalUniverse && !opts.internalUniverse.has((n.ticker || opts.ticker || "").toUpperCase().replace(/\..*$/, ""))),
            alreadyInInternalUniverse: !!(opts.internalUniverse && opts.internalUniverse.has((n.ticker || opts.ticker || "").toUpperCase().replace(/\..*$/, ""))),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (doc?.createdAt && Math.abs(Date.now() - new Date(doc.createdAt).getTime()) < 5000) inserted++;
    } catch (e) {
      if (e?.code !== 11000) console.warn(`[external-nominations] persist failed:`, e?.message);
    }
  }
  return inserted;
}

// ─── Renderer for briefing / discovery cards ──────────────────────────
// Deterministic operator-facing block. No LLM, no fabricated values —
// every number cited traces back to a stored nomination with a
// citation. When rawExternalScore < 0, prints the net-negative badge.
export function formatExternalDiscoveryBlock(conviction) {
  if (!conviction || !Array.isArray(conviction.nominations) || conviction.nominations.length === 0) return "";
  const lines = ["", "**External Discovery**"];
  for (const c of conviction.categoryContributions) {
    const n = c.winningNomination;
    const strength = c.decayed >= 0 ? `+${c.decayed.toFixed(1)}` : c.decayed.toFixed(1);
    const ageDays = n.publishedAt ? Math.round((Date.now() - new Date(n.publishedAt).getTime()) / 86400000) : "?";
    lines.push(`   • ${c.category} (${n.action || "?"}) · strength ${strength} · ${ageDays}d old · ${c.winningNomination.thesis || c.winningNomination.citation?.title || "no thesis"}`);
  }
  lines.push(`   Categories agreeing: **${conviction.categoriesAgreeing}** · raw external score: **${conviction.rawExternalScore.toFixed(1)}/${EXTERNAL_RAW_SCORE_CAP}** · adjustment: **+${conviction.externalAdjustment}** (cap +${EXTERNAL_ADJUSTMENT_CAP})`);
  if (conviction.rawExternalScore < 0) {
    lines.push(`   ⚠ External signals NET NEGATIVE — surfaced for transparency; adjustment floored at 0 (does not deduct from composite).`);
  }
  return lines.join("\n");
}
