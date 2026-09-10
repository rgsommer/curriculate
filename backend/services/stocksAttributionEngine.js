// backend/services/stocksAttributionEngine.js
//
// P3.5 (2026-09-09) — portfolio attribution engine, correctness pass.
//
// v3.5 changes vs 3.0:
//   • Portfolio return uses computePortfolioReturn (simple / Modified
//     Dietz / TWR depending on external cash-flow presence + snapshot
//     density) instead of naive (end−start)/start, which was wrong
//     whenever deposits or withdrawals occurred in the window.
//   • CAD PnL and FX decomposition come from stocksFxDecomposition
//     (full-value method, not native × exit FX).
//   • Fees are aggregated per leg with a feeSource stamp so the
//     waterfall row can be labeled "actual" vs "estimated".
//   • Cash attribution is chain-linked daily (chained (1+drag) per
//     interval, from stocksCashAttributionDaily) instead of the
//     coarse avgCashShare × totalReturn.
//   • Replacement pairing goes through stocksReplacementPairing —
//     provenance first (EXPLICIT_REDEPLOY, SAME_MANDATE_BATCH,
//     LINKED_ADVICE_REC, DECISION_ENGINE_TAG), TEMPORAL only as
//     LOW-confidence fallback and reported separately.
//   • Entry-timing attribution comes from
//     stocksEntryTimingAttribution and is labelled DESCRIPTIVE.
//   • Waterfall separates ADDITIVE contributions (they sum to the
//     portfolio-minus-passive gap up to a small residual) from
//     DESCRIPTIVE diagnostics (selection alpha, entry-timing,
//     exit-forward, replacement value-add). Weights and pp figures
//     never mix across the two categories in the aggregate roll-ups.
//   • Two selection alphas are produced:
//       (a) recommendation-quality  — how did our recs perform vs
//                                     benchmark, ignoring what we
//                                     actually filled at?
//       (b) actual-position         — how did our actual fills
//                                     perform vs benchmark?
//     The gap between the two is IMPLEMENTATION_ALPHA (how much did
//     the fill / no-fill / late-fill process cost).
//   • Sleeve attribution reports CAPITAL-WEIGHTED contribution to
//     TOTAL portfolio return in pp (sleeveShare × sleeveReturn),
//     not raw CAD PnL, so it sums cleanly to a whole-portfolio pp.
//
// The engine is DIAGNOSTIC only — it never modifies picks, decisions,
// or portfolio state.

import StocksAttributionReport from "../models/StocksAttributionReport.js";
import StocksPositionLedgerEntry from "../models/StocksPositionLedgerEntry.js";
import StocksExitForwardMetric from "../models/StocksExitForwardMetric.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { buildPortfolioLedger } from "./stocksPositionLedger.js";
import { stampExitForwardOnClose, backfillExitForwardMetrics } from "./stocksExitForward.js";
import { pickBenchmarkFor, getMatchedReturnPct, getMatchedAlphaPct } from "./stocksBenchmarkMatched.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { computePortfolioReturn } from "./stocksPortfolioReturn.js";
import { computeDailyCashAttribution } from "./stocksCashAttributionDaily.js";
import { pairReplacementTrades } from "./stocksReplacementPairing.js";
import { computeEntryTimingAttribution } from "./stocksEntryTimingAttribution.js";
import { runDataRescue, classifyUnattributableRows } from "./stocksDataRescue.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksDailyPositionSnapshot from "../models/StocksDailyPositionSnapshot.js";

const ENGINE_VERSION = "3.6.0";

// Per-metric confidence contract — every metric stands independently
// so a low daily-cash confidence never suppresses a valid 90d
// portfolio-vs-XEQT comparison.
const CONFIDENCE = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", UNAVAILABLE: "UNAVAILABLE" };

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — produce the report for a user over a window.
// windowDays default 90; asOf defaults to today.
// Pass windowDays = "ytd" for calendar-YTD; "max" for the longest
// window with ≥ 2 snapshots.
export async function computeAttributionReport({
  email, windowDays = 90, asOf = new Date(),
} = {}) {
  if (!email) throw new Error("email required");
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const asOfYmd = ymd(asOfDate);

  // Snapshots first — needed both for the window boundary and for
  // portfolio-return method selection.
  const allSnaps = await StocksPortfolioSnapshot.find({
    email, accountId: "__total__",
    date: { $lte: asOfYmd },
  }).sort({ date: 1 }).lean();

  // Resolve window bounds
  let windowStart, effectiveWindowDays;
  if (windowDays === "ytd") {
    windowStart = `${asOfDate.getUTCFullYear()}-01-01`;
    effectiveWindowDays = Math.max(1, Math.round((asOfDate - new Date(windowStart)) / 86400_000));
  } else if (windowDays === "max") {
    windowStart = allSnaps.length > 0 ? ymd(allSnaps[0].date) : ymd(new Date(asOfDate.getTime() - 365 * 86400_000));
    effectiveWindowDays = Math.max(1, Math.round((asOfDate - new Date(windowStart)) / 86400_000));
  } else {
    effectiveWindowDays = Number(windowDays) || 90;
    windowStart = ymd(new Date(asOfDate.getTime() - effectiveWindowDays * 86400_000));
  }
  const snaps = allSnaps.filter(s => ymd(s.date) >= windowStart && ymd(s.date) <= asOfYmd);

  // 1) Ledger — build full ledger, filter to window
  const { rows: allLedgerRows, coverage: legCov } = await buildPortfolioLedger({
    email, priceAsOf: asOfDate,
  });
  const rows = allLedgerRows.filter(r =>
    !r.entryDate || ymd(r.entryDate) >= windowStart ||
    (r.exitDate && ymd(r.exitDate) >= windowStart) || r.isOpen
  );

  // Seed exit-forward metrics for every closed row we just saw.
  for (const r of rows) {
    if (r.exitDate && r.dataQuality !== "UNATTRIBUTABLE") {
      await stampExitForwardOnClose({ email, row: { ...r, exitAction: "SELL" } }).catch(() => null);
    }
  }
  const backfill = await backfillExitForwardMetrics({ email, asOf: asOfDate }).catch(() => null);

  // 2) Portfolio return via cash-flow-aware method selector.
  const returnResult = await computePortfolioReturn({
    email, snaps, windowStartYmd: windowStart, windowEndYmd: asOfYmd,
  });
  const portfolioReturnPct = returnResult.portfolioReturnPct;

  // P3.6 §14 — when snap span < requested window (YTD-with-3mo-snaps
  // case), compare against the benchmark over the SAME reduced window,
  // not the full requested one. Otherwise alpha is meaningless.
  const benchFromYmd = returnResult.reducedFromWindow?.snapSpanFromYmd || windowStart;
  const benchToYmd = returnResult.reducedFromWindow?.snapSpanToYmd || asOfYmd;

  // 3) Passive alternatives over the same window. Every entry carries
  //    provenance from the market-data adapter — bench return NEVER
  //    coerces to zero when data is missing (P3.6).
  const passiveTargets = ["XEQT.TO", "XIC.TO", "SPY", "VTI"];
  const passiveRows = [];
  for (const t of passiveTargets) {
    const bres = await getMatchedReturnPct({ ticker: t, fromDate: benchFromYmd, toDate: benchToYmd });
    passiveRows.push({
      ticker: t,
      returnPct: bres.pct,                 // null when DATA_UNAVAILABLE
      status: bres.status,
      note: bres.note,
      marketDataSource: bres.marketDataSource || null,
      fallbackUsed: bres.fallbackUsed || false,
      actualRange: bres.actualRange || null,
      fetchAsOf: bres.fetchAsOf || null,
    });
  }
  const passiveBaseline = passiveRows.find(p => p.ticker === "XEQT.TO" && Number.isFinite(p.returnPct))?.returnPct
                       ?? passiveRows.find(p => p.ticker === "SPY" && Number.isFinite(p.returnPct))?.returnPct
                       ?? null;

  // 4) Sleeve attribution — capital-weighted contribution to TOTAL
  // portfolio return in pp. Formula:
  //   sleeveContribPp = (sleeveCapitalCad / totalCapitalCad) × sleeveReturnPct
  // where sleeveReturnPct is the capital-weighted average security
  // return across all rows in that sleeve. This sums cleanly to the
  // capital-weighted portfolio return.
  const attributable = rows.filter(r => r.dataQuality !== "UNATTRIBUTABLE" && Number.isFinite(r.matchedAlphaPct));
  const entryCapitalCad = (r) => {
    if (Number.isFinite(r.entryValueCad)) return r.entryValueCad;
    if (r.entryPrice > 0 && r.entryShares > 0) {
      return r.entryPrice * r.entryShares * (r.entryCurrency === "CAD" ? 1 : (r.entryFx || 1.37));
    }
    return 0;
  };
  const totalCapital = attributable.reduce((s, r) => s + entryCapitalCad(r), 0);

  const sleeveMap = new Map();
  for (const r of attributable) {
    const s = r.sleeve || "unknown";
    const cap = entryCapitalCad(r);
    const ret = r.securityReturnPct || 0;
    const bucket = sleeveMap.get(s) || {
      capitalCad: 0, capWeightedReturnSum: 0, pnlCad: 0,
      alphaSum: 0, alphaCount: 0, tickers: [],
    };
    bucket.capitalCad += cap;
    bucket.capWeightedReturnSum += cap * ret;
    bucket.pnlCad += (r.realizedPnLCad || 0) + (r.unrealizedPnLCad || 0);
    bucket.tickers.push(r.ticker);
    if (Number.isFinite(r.matchedAlphaPct)) { bucket.alphaSum += r.matchedAlphaPct; bucket.alphaCount++; }
    sleeveMap.set(s, bucket);
  }
  const sleeveAttribution = [...sleeveMap.entries()].map(([sleeve, b]) => {
    const sleeveReturnPct = b.capitalCad > 0 ? b.capWeightedReturnSum / b.capitalCad : null;
    const sleeveWeight = totalCapital > 0 ? b.capitalCad / totalCapital : null;
    const sleeveContribPp = (Number.isFinite(sleeveReturnPct) && Number.isFinite(sleeveWeight))
      ? sleeveWeight * sleeveReturnPct : null;
    return {
      sleeve,
      positions: b.tickers.length,
      capitalCad: b.capitalCad,
      sleeveWeight,
      sleeveReturnPct,
      sleeveContribPp,
      pnlCad: b.pnlCad,
      meanAlphaPct: b.alphaCount > 0 ? b.alphaSum / b.alphaCount : null,
    };
  }).sort((a, b) => (b.sleeveContribPp || 0) - (a.sleeveContribPp || 0));

  // 5) Selection alpha — TWO measures:
  //    (a) recommendation-quality: for every rec in the window, alpha
  //        of rec.entryPrice → benchmark-matched return of rec ticker
  //        vs matched-benchmark. Answers: "if we'd filled at the rec
  //        price and held for the intended horizon, did we beat?"
  //    (b) actual-position: mean matched alpha across attributable
  //        rows (what we ACTUALLY filled at, weighted or not).
  //    The gap = IMPLEMENTATION_ALPHA.
  const meanActualAlphaPp = attributable.length > 0
    ? attributable.reduce((s, r) => s + r.matchedAlphaPct, 0) / attributable.length : null;

  const recQualityAlphaResult = await computeRecommendationQualityAlpha({
    email, fromYmd: windowStart, toYmd: asOfYmd, asOf: asOfDate,
  });

  // Capital-weighted actual alpha (better contribution measure than
  // simple mean when position sizes vary widely).
  const capWeightedActualAlphaPp = totalCapital > 0
    ? attributable.reduce((s, r) => s + (r.matchedAlphaPct || 0) * (entryCapitalCad(r) / totalCapital), 0)
    : null;

  const implementationAlphaPp = (Number.isFinite(recQualityAlphaResult.meanRecAlphaPp) && Number.isFinite(meanActualAlphaPp))
    ? meanActualAlphaPp - recQualityAlphaResult.meanRecAlphaPp : null;

  const winners = attributable.filter(r => r.matchedAlphaPct > 0);
  const losers  = attributable.filter(r => r.matchedAlphaPct < 0);
  const hitRatePct = attributable.length > 0 ? (winners.length / attributable.length) * 100 : null;
  const avgWinner  = winners.length ? winners.reduce((s, r) => s + r.matchedAlphaPct, 0) / winners.length : null;
  const avgLoser   = losers.length  ? losers.reduce((s, r)  => s + r.matchedAlphaPct, 0) / losers.length : null;

  // 6) Exit-forward summary — unchanged from P3, DESCRIPTIVE.
  const exitMetrics = await StocksExitForwardMetric.find({
    email: String(email).toLowerCase(),
    exitDate: { $gte: new Date(windowStart), $lte: asOfDate },
  }).lean();
  const exitByClass = { GOOD_EXIT: 0, NEUTRAL: 0, PREMATURE_EXIT: 0, LATE_EXIT: 0, PENDING: 0 };
  const exitAlphaAvg = { d1: [], d5: [], d10: [], d20: [], d60: [] };
  for (const m of exitMetrics) {
    exitByClass[m.classification || "PENDING"] = (exitByClass[m.classification || "PENDING"] || 0) + 1;
    for (const h of (m.horizons || [])) {
      const bucket = ({1:"d1",5:"d5",10:"d10",20:"d20",60:"d60"})[h.horizonDays];
      if (bucket && h.status === "FILLED" && Number.isFinite(h.exitAlphaPct)) exitAlphaAvg[bucket].push(h.exitAlphaPct);
    }
  }
  const exitAlphaMean = Object.fromEntries(Object.entries(exitAlphaAvg).map(([k, xs]) =>
    [k, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null]));
  const exitCoverageEligible = exitMetrics.length > 0
    ? Math.round(exitMetrics.filter(m => m.classification !== "PENDING").length / exitMetrics.length * 100) : 0;

  // 7) Sizing effect — actual (capital-weighted) vs equal-weight.
  //    ADDITIVE — real "did we bet more on the winners" test.
  const eqWeightPct = attributable.length > 0
    ? attributable.reduce((s, r) => s + (r.securityReturnPct || 0), 0) / attributable.length : null;
  const capWeightedPct = totalCapital > 0
    ? attributable.reduce((s, r) => {
        const cap = entryCapitalCad(r);
        return s + (r.securityReturnPct || 0) * (cap / totalCapital);
      }, 0)
    : null;
  const sizingEffectPp = (Number.isFinite(capWeightedPct) && Number.isFinite(eqWeightPct))
    ? capWeightedPct - eqWeightPct : null;

  // 8) Replacement pairing — provenance-based, LOW-confidence pairs
  //    reported separately.
  const replacement = await pairReplacementTrades({
    email, fromYmd: windowStart, toYmd: asOfYmd, asOf: asOfDate,
  });

  // 9) FX attribution — sum fxReturnPct + interactionPct contribution
  //    over USD holdings weighted by USD capital share. ADDITIVE.
  const usdRows = rows.filter(r => r.entryCurrency === "USD" && Number.isFinite(r.fxReturnPct));
  const usdCapitalCad = usdRows.reduce((s, r) => s + entryCapitalCad(r), 0);
  const usdFxContribPp = totalCapital > 0 && usdCapitalCad > 0
    ? usdRows.reduce((s, r) => {
        const cap = entryCapitalCad(r);
        const fx = r.fxReturnPct || 0;
        const inter = r.interactionPct || 0;
        return s + (fx + inter) * (cap / totalCapital);
      }, 0)
    : null;

  // 10) Churn / fees — sum feesCad (from ledger, aggregated per leg).
  const closedRows = rows.filter(r => r.exitDate && r.dataQuality !== "UNATTRIBUTABLE");
  const avgHoldingDays = closedRows.length > 0
    ? closedRows.reduce((s, r) => s + (r.holdingPeriodDays || 0), 0) / closedRows.length : null;
  const feesCadTotal = rows.reduce((s, r) => s + (Number(r.feesCad) || 0), 0);
  const feeSources = [...new Set(rows.map(r => r.feeSource).filter(Boolean))];
  const worstFeeSource = feeSources.includes("UNKNOWN") ? "UNKNOWN"
                       : feeSources.includes("ESTIMATED") ? "ESTIMATED" : "ACTUAL";
  const startCapitalCad = snaps.length > 0 ? Number(snaps[0].totalCad) : null;
  const feesEffectPp = (portfolioReturnPct != null && startCapitalCad > 0)
    ? -(feesCadTotal / startCapitalCad) * 100 : null;
  const numTrades = rows.length;

  // 11) Cash attribution — daily chain-linked (P3.5). Falls back to
  //     coarse estimate if snapshot density is too low.
  const cashResult = await computeDailyCashAttribution({ snaps, benchmarkTicker: "XEQT.TO" });
  const cashEffectPp = cashResult.cumulativeCashDragPp;

  // 12) Sector attribution — capital-weighted contribution in pp,
  //     mirrors sleeve treatment.
  const sectorMap = new Map();
  for (const r of attributable) {
    const sec = r.sector || "unknown";
    if (!sectorMap.has(sec)) sectorMap.set(sec, {
      capitalCad: 0, capWeightedReturnSum: 0, alphaSum: 0, alphaCount: 0, pnlCad: 0, count: 0,
    });
    const b = sectorMap.get(sec);
    const cap = entryCapitalCad(r);
    b.capitalCad += cap;
    b.capWeightedReturnSum += cap * (r.securityReturnPct || 0);
    b.count++;
    b.alphaSum += r.matchedAlphaPct;
    b.pnlCad += (r.realizedPnLCad || 0) + (r.unrealizedPnLCad || 0);
  }
  const sectorAttribution = [...sectorMap.entries()].map(([sector, b]) => ({
    sector, positions: b.count,
    capitalCad: b.capitalCad,
    sectorWeight: totalCapital > 0 ? b.capitalCad / totalCapital : null,
    sectorReturnPct: b.capitalCad > 0 ? b.capWeightedReturnSum / b.capitalCad : null,
    sectorContribPp: (totalCapital > 0 && b.capitalCad > 0)
      ? (b.capitalCad / totalCapital) * (b.capWeightedReturnSum / b.capitalCad) : null,
    meanAlphaPct: b.count > 0 ? b.alphaSum / b.count : null,
    pnlCad: b.pnlCad,
  })).sort((a, b) => (b.sectorContribPp || 0) - (a.sectorContribPp || 0));

  // 13) Real vs passive table (spec §14). Passive returns carry
  //     provenance; alpha is null (never zero) when either side missing.
  const realVsPassive = passiveRows.map(p => ({
    ticker: p.ticker,
    passiveReturnPct: p.returnPct,            // null when DATA_UNAVAILABLE
    passiveStatus: p.status,                  // "OK" | "DATA_UNAVAILABLE"
    marketDataSource: p.marketDataSource,
    fallbackUsed: p.fallbackUsed,
    portfolioReturnPct,
    alphaPp: Number.isFinite(portfolioReturnPct) && Number.isFinite(p.returnPct)
      ? portfolioReturnPct - p.returnPct : null,
    alphaStatus: (Number.isFinite(portfolioReturnPct) && Number.isFinite(p.returnPct)) ? "OK" : "DATA_UNAVAILABLE",
  }));

  // 14) Waterfall — separated additive vs descriptive per P3.5 §7.
  const additiveContributions = [
    { label: "Sizing effect (vs equal-weight)", pp: sizingEffectPp, confidence: "HIGH" },
    { label: "Cash drag (daily chain-linked)", pp: cashEffectPp, confidence: cashResult.coverage === "COMPLETE" ? "HIGH" : cashResult.coverage === "PARTIAL" ? "MEDIUM" : "LOW" },
    { label: "FX (USD holdings, incl. interaction)", pp: usdFxContribPp, confidence: usdCapitalCad > 0 ? "HIGH" : "LOW" },
    { label: `Fees / churn (${worstFeeSource.toLowerCase()})`, pp: feesEffectPp, confidence: worstFeeSource === "ACTUAL" ? "HIGH" : "MEDIUM" },
  ].filter(x => Number.isFinite(x.pp));

  const descriptiveDiagnostics = [
    Number.isFinite(recQualityAlphaResult.meanRecAlphaPp) ? {
      label: "Recommendation-quality alpha (mean, per-rec matched window)",
      pp: recQualityAlphaResult.meanRecAlphaPp,
      coveragePct: recQualityAlphaResult.coveragePct,
      note: "How our recs performed at recommended entry price. NOT additive.",
    } : null,
    Number.isFinite(meanActualAlphaPp) ? {
      label: "Actual-position alpha (mean, per-fill matched window)",
      pp: meanActualAlphaPp,
      coveragePct: attributable.length > 0
        ? Math.round(attributable.length / Math.max(1, rows.length) * 100) : 0,
      note: "How our actual fills performed vs matched benchmark. NOT additive.",
    } : null,
    Number.isFinite(capWeightedActualAlphaPp) ? {
      label: "Actual-position alpha (capital-weighted)",
      pp: capWeightedActualAlphaPp,
      note: "Weighted by entry capital — reflects the sizes actually deployed.",
    } : null,
    Number.isFinite(implementationAlphaPp) ? {
      label: "Implementation alpha (actual − rec)",
      pp: implementationAlphaPp,
      note: "Cost of fill quality: negative = worse than recs, positive = execution beat the rec.",
    } : null,
    Number.isFinite(exitAlphaMean.d20) ? {
      label: "Exit-forward alpha (mean, 20d)",
      pp: -exitAlphaMean.d20,
      note: "Return of underlying 20d AFTER exit, negated. Positive = we sold at a good time.",
    } : null,
  ].filter(Boolean);

  const waterfall = {
    passiveBenchmarkTicker: "XEQT.TO",
    passiveReturnPct: passiveBaseline,
    portfolioReturnPct,
    portfolioReturnMethod: returnResult.returnMethod,
    portfolioReturnMethodReason: returnResult.returnMethodReason,
    externalCashFlowCad: returnResult.externalCashFlowCad,
    additiveComponents: additiveContributions,
    descriptiveComponents: descriptiveDiagnostics,
    residualPp: null,
    residualNote: "Residual is portfolio − passive − Σ(additive). Absorbs selection quality, market timing, and any reconstruction gaps not captured above.",
  };
  if (Number.isFinite(portfolioReturnPct) && Number.isFinite(passiveBaseline)) {
    const additive = additiveContributions.reduce((s, x) => s + x.pp, 0);
    waterfall.residualPp = (portfolioReturnPct - passiveBaseline) - additive;
  }

  // 15) Root cause — ranked by absolute pp within additive; descriptive
  //     items are tagged and NOT summed with additive.
  const additiveDrags = [...additiveContributions].filter(x => x.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 3);
  const additiveOffsets = [...additiveContributions].filter(x => x.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 3);
  const descriptiveWorst = [...descriptiveDiagnostics].filter(x => x.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 3);
  const descriptiveBest = [...descriptiveDiagnostics].filter(x => x.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 3);

  // 16) Entry-timing attribution — DESCRIPTIVE.
  const entryTiming = await computeEntryTimingAttribution({
    email, fromYmd: windowStart, toYmd: asOfYmd,
  });

  // 17) Worst / best actual decisions — top 5 alpha winners, top 5
  //     alpha losers, weighted by entry capital so the ranking
  //     reflects portfolio impact rather than a single-share bet.
  const ranked = [...attributable].map(r => ({
    ticker: r.ticker,
    account: r.account,
    entryDate: r.entryDate,
    exitDate: r.exitDate,
    isOpen: r.isOpen,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    entryShares: r.entryShares,
    entryCapitalCad: entryCapitalCad(r),
    securityReturnPct: r.securityReturnPct,
    benchmarkTicker: r.benchmarkTicker,
    benchmarkReturnPctMatched: r.benchmarkReturnPctMatched,
    matchedAlphaPct: r.matchedAlphaPct,
    realizedPnLCad: r.realizedPnLCad,
    unrealizedPnLCad: r.unrealizedPnLCad,
    contribPp: totalCapital > 0 ? (entryCapitalCad(r) / totalCapital) * (r.securityReturnPct || 0) : null,
    holdingPeriodDays: r.holdingPeriodDays,
    sleeve: r.sleeve,
    recommendationId: r.recommendationId,
  }));
  const bestDecisions = [...ranked].filter(r => Number.isFinite(r.contribPp))
    .sort((a, b) => (b.contribPp || 0) - (a.contribPp || 0)).slice(0, 5);
  const worstDecisions = [...ranked].filter(r => Number.isFinite(r.contribPp))
    .sort((a, b) => (a.contribPp || 0) - (b.contribPp || 0)).slice(0, 5);

  // Data quality summary.
  const dataQuality = {
    tradeLegCoveragePct: legCov.coveragePct,
    portfolioSnapshotDays: snaps.length,
    exitForwardEligiblePct: exitCoverageEligible,
    attributableRows: attributable.length,
    unattributableRows: rows.filter(r => r.dataQuality === "UNATTRIBUTABLE").length,
    fxCoveragePct: rows.length > 0
      ? Math.round((usdRows.length + rows.filter(r => r.entryCurrency === "CAD").length) / rows.length * 100) : 0,
    windowDays: effectiveWindowDays,
    windowStart,
    asOfDate: asOfYmd,
    cashFlowCoverage: returnResult.cashFlowCoverage,
    cashAttributionCoverage: cashResult.coverage,
    replacementPairingCoverage: replacement.coverage,
    entryTimingCoverage: entryTiming.coverage,
    feeSource: worstFeeSource,
  };

  // 18) P3.6 — data rescue + per-metric confidence.
  const trades = await StocksTradeJournal.find({ email: String(email).toLowerCase() }).sort({ executedAt: 1 }).lean();
  const [rescueResult, unattribBreakdown] = await Promise.all([
    runDataRescue({ email }),
    Promise.resolve(classifyUnattributableRows({ ledgerRows: rows, trades })),
  ]);

  // Per-metric confidence — each stands on its own so a LOW cash-attribution
  // does not suppress a valid portfolio-vs-passive comparison.
  const metricConfidence = {
    portfolioReturn: returnResult.returnMethod == null ? CONFIDENCE.UNAVAILABLE
                    : returnResult.returnMethod === "time-weighted" ? CONFIDENCE.HIGH
                    : returnResult.returnMethod === "modified-dietz" ? CONFIDENCE.MEDIUM
                    : snaps.length >= 3 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    passiveRelativeReturn: (portfolioReturnPct != null && Number.isFinite(passiveBaseline))
                    ? (snaps.length >= 5 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM)
                    : CONFIDENCE.UNAVAILABLE,
    recommendationSelectionAlpha: recQualityAlphaResult.meanRecAlphaPp == null ? CONFIDENCE.UNAVAILABLE
                    : recQualityAlphaResult.coveragePct >= 60 ? CONFIDENCE.HIGH
                    : recQualityAlphaResult.coveragePct >= 30 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    actualPositionAlpha: attributable.length === 0 ? CONFIDENCE.UNAVAILABLE
                    : attributable.length >= 20 ? CONFIDENCE.HIGH
                    : attributable.length >= 5 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    entryTiming: entryTiming.coverage.eligibleBuys === 0 ? CONFIDENCE.UNAVAILABLE
                    : entryTiming.coverage.coveragePct >= 60 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    exitTiming: exitCoverageEligible >= 60 ? CONFIDENCE.MEDIUM
                    : exitCoverageEligible >= 20 ? CONFIDENCE.LOW : CONFIDENCE.UNAVAILABLE,
    sizingEffect: Number.isFinite(sizingEffectPp) ? CONFIDENCE.MEDIUM : CONFIDENCE.UNAVAILABLE,
    sleeveAttribution: sleeveAttribution.length === 0 ? CONFIDENCE.UNAVAILABLE
                    : attributable.length >= 5 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    replacementTrades: replacement.coverage.highConfidencePairs > 0 ? CONFIDENCE.MEDIUM
                    : replacement.coverage.matchedPairs > 0 ? CONFIDENCE.LOW : CONFIDENCE.UNAVAILABLE,
    cashEffect: cashResult.coverage === "COMPLETE" ? CONFIDENCE.HIGH
                    : cashResult.coverage === "PARTIAL" ? CONFIDENCE.MEDIUM
                    : cashResult.coverage === "LOW_COVERAGE" ? CONFIDENCE.LOW : CONFIDENCE.UNAVAILABLE,
    fxEffect: usdCapitalCad > 0 && Number.isFinite(usdFxContribPp) ? CONFIDENCE.MEDIUM : CONFIDENCE.UNAVAILABLE,
  };

  // Sufficiency is now DIAGNOSTIC only — never suppresses valid metrics.
  const insufficientEvidence = [];
  if (snaps.length < 3) insufficientEvidence.push("Portfolio snapshot history too short (<3 rows in window).");
  if (attributable.length === 0 && (unattribBreakdown.total > 0 || rescueResult.openingBalanceLots.length > 0)) {
    insufficientEvidence.push(`${unattribBreakdown.total} unattributable ledger rows — trade history is a partial reconstruction; see unattributableReasonBreakdown for per-row reasons.`);
  } else if (attributable.length === 0) {
    insufficientEvidence.push("No attributable ledger rows — cannot compute selection alpha.");
  }
  if (returnResult.returnMethod == null) insufficientEvidence.push("Portfolio return method could not be selected.");
  if (passiveBaseline == null) insufficientEvidence.push("Passive baseline benchmark unavailable.");

  // Classify overall diagnostic power (A/B/C per spec §16). Metrics-first:
  // if we can measure portfolio-vs-passive reliably, we are at least B.
  let diagnosticClassification;
  if (metricConfidence.passiveRelativeReturn === CONFIDENCE.HIGH
      && metricConfidence.actualPositionAlpha !== CONFIDENCE.UNAVAILABLE
      && metricConfidence.sleeveAttribution !== CONFIDENCE.UNAVAILABLE) {
    diagnosticClassification = { class: "A", label: "SUFFICIENT FOR PRELIMINARY DIAGNOSIS" };
  } else if (metricConfidence.passiveRelativeReturn === CONFIDENCE.HIGH
             || metricConfidence.passiveRelativeReturn === CONFIDENCE.MEDIUM) {
    diagnosticClassification = { class: "B", label: "PARTIALLY SUFFICIENT — relative performance measurable, decomposition incomplete" };
  } else {
    diagnosticClassification = { class: "C", label: "INSUFFICIENT — cannot measure relative portfolio performance reliably" };
  }

  // Count distinct daily-position-snapshot trading days for this user.
  const dailySnapDates = await StocksDailyPositionSnapshot.distinct("date", {
    email: String(email).toLowerCase(),
    date: { $lte: asOfYmd },
  }).catch(() => []);

  // Data-quality dashboard (§12) — compact, coverage % + confidence tags.
  const dataQualityDashboard = {
    marketPricePct: passiveRows.filter(p => p.status === "OK").length / passiveRows.length * 100 | 0,
    benchmarkCoveragePct: passiveRows.filter(p => Number.isFinite(p.returnPct)).length / passiveRows.length * 100 | 0,
    portfolioSnapshotDays: snaps.length,
    tradeReconstructionCoveragePct: legCov.coveragePct,
    recommendationLinkageBeforePct: (rescueResult.recLinkReconciliation.before.explicit /
      Math.max(1, rescueResult.recLinkReconciliation.before.explicit + rescueResult.recLinkReconciliation.before.none) * 100) | 0,
    recommendationLinkageAfterPct: ((rescueResult.recLinkReconciliation.after.explicit
      + rescueResult.recLinkReconciliation.after.reconciledMandate
      + rescueResult.recLinkReconciliation.after.reconciledTime) /
      Math.max(1, rescueResult.recLinkReconciliation.after.explicit
        + rescueResult.recLinkReconciliation.after.reconciledMandate
        + rescueResult.recLinkReconciliation.after.reconciledTime
        + rescueResult.recLinkReconciliation.after.none) * 100) | 0,
    fxCoveragePct: rows.length > 0
      ? Math.round((usdRows.length + rows.filter(r => r.entryCurrency === "CAD").length) / rows.length * 100) : 0,
    dailyPositionSnapshotTradingDays: dailySnapDates.length,
  };

  const sufficient = diagnosticClassification.class !== "C";

  const report = {
    email, asOfDate: asOfYmd, windowStart,
    engineVersion: ENGINE_VERSION,
    sufficient,
    diagnosticClassification,
    metricConfidence,
    dataQualityDashboard,
    dataRescue: {
      unattributableReasonBreakdown: unattribBreakdown,
      openingBalanceLots: rescueResult.openingBalanceLots,
      openingBalanceNote: rescueResult.openingBalanceNote,
      recLinkReconciliation: rescueResult.recLinkReconciliation,
      transferCandidates: rescueResult.transferCandidates,
    },
    insufficientEvidence,
    header: {
      windowDays: effectiveWindowDays,
      windowStart,
      asOfDate: asOfYmd,
      portfolioReturnPct,
      portfolioReturnMethod: returnResult.returnMethod,
      externalCashFlowCad: returnResult.externalCashFlowCad,
      reducedFromWindow: returnResult.reducedFromWindow,
      returnNote: returnResult.note,
      benchmarkFromYmd: benchFromYmd,
      benchmarkToYmd: benchToYmd,
      passiveReturnPct: passiveBaseline,
      passiveBenchmarkTicker: "XEQT.TO",
      alphaVsPassivePp: Number.isFinite(portfolioReturnPct) && Number.isFinite(passiveBaseline)
        ? portfolioReturnPct - passiveBaseline : null,
    },
    waterfall,
    rootCause: {
      additiveDrags,
      additiveOffsets,
      descriptiveWorst,
      descriptiveBest,
    },
    details: {
      sleeveAttribution,
      selectionAlpha: {
        recommendationQualityMeanAlphaPp: recQualityAlphaResult.meanRecAlphaPp,
        recommendationQualityCoveragePct: recQualityAlphaResult.coveragePct,
        actualPositionMeanAlphaPp: meanActualAlphaPp,
        actualPositionCapWeightedAlphaPp: capWeightedActualAlphaPp,
        implementationAlphaPp,
        hitRatePct, avgWinner, avgLoser,
        winnerCount: winners.length, loserCount: losers.length,
        note: "Two selection measures. recommendation-quality = rec price → matched benchmark. actual-position = fill price → matched benchmark. Gap = implementation alpha.",
      },
      entryTiming,
      exitForward: {
        classificationCounts: exitByClass,
        meanExitAlphaPct: exitAlphaMean,
        eligiblePct: exitCoverageEligible,
      },
      sizingEffect: {
        capitalWeightedReturnPct: capWeightedPct,
        equalWeightedReturnPct: eqWeightPct,
        sizingEffectPp,
      },
      replacementTrades: {
        pairs: replacement.pairs,
        coverage: replacement.coverage,
        methodCounts: replacement.methodCounts,
        note: replacement.note,
      },
      sectorAttribution,
      fxAttribution: {
        usdCapitalCad, usdFxContribPp,
        note: "Contribution to portfolio return in pp, weighted by USD capital share. Includes local × FX interaction cross term.",
      },
      churnEffect: {
        numTrades, avgHoldingDays,
        feesCadTotal, feesEffectPp, feeSource: worstFeeSource,
      },
      cashEffect: {
        cumulativeCashDragPp: cashResult.cumulativeCashDragPp,
        benchmarkTicker: cashResult.benchmarkTicker,
        intervals: cashResult.dailyIntervals,
        coverage: cashResult.coverage,
        note: cashResult.note,
      },
      realVsPassive,
      bestDecisions,
      worstDecisions,
    },
    dataQuality,
    notes: [
      "P3.5: additive components (sizing, cash drag, FX, fees) SUM to explain portfolio − passive up to a small residual. Descriptive components (selection alpha, entry-timing, exit-forward) are DIAGNOSTIC ONLY and NEVER added to the waterfall.",
      "Selection alpha is reported in two forms: recommendation-quality (rec price → benchmark) AND actual-position (fill price → benchmark). Their gap is implementation alpha.",
      "Sleeve and sector attribution report CAPITAL-WEIGHTED CONTRIBUTION IN PP (sleeveWeight × sleeveReturn), which sum to the whole-portfolio return. Raw CAD PnL is retained alongside for context but is NOT the additive number.",
      "UNATTRIBUTABLE ledger rows (SELL with no matching BUY) are EXCLUDED from all alpha computations.",
      "Exit-forward classification is PENDING until all five horizons elapse. Wait for classification before drawing conclusions.",
      "Portfolio return method: " + String(returnResult.returnMethod) + " (" + String(returnResult.returnMethodReason) + "). External cash flow over window: " + String(Math.round((returnResult.externalCashFlowCad || 0) * 100) / 100) + " CAD.",
      backfill ? `Exit-forward backfill: filled ${backfill.filledHorizons} horizons across ${backfill.updatedRows} rows.` : null,
    ].filter(Boolean),
  };

  try {
    await StocksAttributionReport.updateOne(
      { email, asOfDate: asOfYmd, windowDays: effectiveWindowDays },
      { $set: { ...report, windowDays: effectiveWindowDays, generatedAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    console.warn(`[attribution] persist warn for ${email}:`, e?.message);
  }
  return report;
}

// PUBLIC — recommendation-quality alpha. For every rec generated in
// the window, computes the matched-benchmark alpha of holding the rec
// ticker from rec.generatedAt for a horizon (rec.horizonDays or 20)
// versus its benchmark, using rec.entryPrice (not the actual fill).
async function computeRecommendationQualityAlpha({ email, fromYmd, toYmd, asOf }) {
  const recs = await StocksAdviceRec.find({
    email: String(email || "").toLowerCase(),
    generatedAt: { $gte: new Date(fromYmd), $lte: new Date(toYmd + "T23:59:59Z") },
    action: { $in: ["BUY", "ADD", "REDEPLOY"] },
    entryPrice: { $gt: 0 },
  }).lean().catch(() => []);
  if (!Array.isArray(recs) || recs.length === 0) {
    return { meanRecAlphaPp: null, coveragePct: 0, perRec: [] };
  }
  const barsCache = new Map();
  async function getBars(t, range = "6mo") {
    const k = `${t}::${range}`;
    if (barsCache.has(k)) return barsCache.get(k);
    const b = await fetchYahooDaily(t, range).catch(() => null);
    barsCache.set(k, b);
    return b;
  }
  const perRec = [];
  for (const r of recs) {
    const ticker = (r.ticker || "").toUpperCase();
    if (!ticker) continue;
    const horizon = Math.max(5, Math.min(60, Number(r.horizonDays) || 20));
    const from = ymd(r.generatedAt);
    const targetToDate = new Date(new Date(from).getTime() + horizon * 86400_000);
    const to = ymd(targetToDate > asOf ? asOf : targetToDate);
    if (from > to) continue;
    const bars = await getBars(ticker);
    if (!Array.isArray(bars) || bars.length === 0) continue;
    // Read forward price at the horizon end.
    const closeAt = (targetYmd) => {
      const rev = [...bars].reverse();
      return rev.find(b => (b.date || "").slice(0, 10) <= targetYmd)?.close || null;
    };
    const priceAtHorizon = closeAt(to);
    if (!(priceAtHorizon > 0)) continue;
    const recEntry = Number(r.entryPrice);
    if (!(recEntry > 0)) continue;
    const recTickerReturnPct = ((priceAtHorizon - recEntry) / recEntry) * 100;
    const bench = pickBenchmarkFor({ ticker, currency: r.currency });
    const benchBars = await getBars(bench);
    const bres = await getMatchedReturnPct({ ticker: bench, fromDate: from, toDate: to, bars: benchBars });
    const alpha = getMatchedAlphaPct({ securityReturnPct: recTickerReturnPct, benchmarkReturnPct: bres.pct });
    perRec.push({
      recId: String(r._id), ticker, from, to,
      recEntryPrice: recEntry, priceAtHorizon,
      recTickerReturnPct, benchmarkTicker: bench, benchmarkReturnPct: bres.pct,
      alphaPp: alpha,
    });
  }
  const withAlpha = perRec.filter(x => Number.isFinite(x.alphaPp));
  const meanRecAlphaPp = withAlpha.length > 0
    ? withAlpha.reduce((s, x) => s + x.alphaPp, 0) / withAlpha.length : null;
  const coveragePct = recs.length > 0 ? Math.round((withAlpha.length / recs.length) * 100) : 0;
  return { meanRecAlphaPp, coveragePct, perRec };
}

// PUBLIC — root-cause text render. Consumers can wrap this in a UI or
// email footer.
export function renderRootCauseText(report) {
  if (!report?.rootCause) return "No attribution data.";
  const additiveDrags = report.rootCause.additiveDrags || report.rootCause.drags || [];
  const additiveOffsets = report.rootCause.additiveOffsets || report.rootCause.offsets || [];
  const descriptiveWorst = report.rootCause.descriptiveWorst || [];
  const descriptiveBest = report.rootCause.descriptiveBest || [];
  const lines = [];
  lines.push("PORTFOLIO DIAGNOSIS");
  lines.push("");
  const alpha = report.header?.alphaVsPassivePp;
  const bench = report.waterfall?.passiveBenchmarkTicker || report.header?.passiveBenchmarkTicker || "XEQT.TO";
  const wd = report.header?.windowDays;
  if (Number.isFinite(alpha)) {
    const sign = alpha >= 0 ? "+" : "";
    lines.push(`Actual portfolio: ${sign}${alpha.toFixed(1)}pp vs ${bench} over ${wd}d`);
    lines.push(`Method: ${report.header?.portfolioReturnMethod || "unknown"} · Snapshots: ${report.dataQuality?.portfolioSnapshotDays ?? "n/a"}`);
    lines.push("");
  }
  if (report.insufficientEvidence?.length > 0) {
    lines.push("WE DO NOT YET HAVE ENOUGH CLEAN HISTORY TO KNOW.");
    for (const r of report.insufficientEvidence) lines.push(`  · ${r}`);
    lines.push("");
  }
  if (additiveDrags.length > 0) {
    lines.push("Additive drag (sums to the gap):");
    additiveDrags.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}: ${d.pp.toFixed(1)}pp  [${d.confidence || "?"}]`));
  }
  if (additiveOffsets.length > 0) {
    lines.push("");
    lines.push("Additive offsets:");
    additiveOffsets.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}: +${d.pp.toFixed(1)}pp  [${d.confidence || "?"}]`));
  }
  if (descriptiveWorst.length > 0 || descriptiveBest.length > 0) {
    lines.push("");
    lines.push("Descriptive diagnostics (NOT additive):");
    for (const d of descriptiveWorst) lines.push(`  · ${d.label}: ${d.pp.toFixed(1)}pp`);
    for (const d of descriptiveBest) lines.push(`  · ${d.label}: +${d.pp.toFixed(1)}pp`);
  }
  if (report.dataQuality) {
    const dq = report.dataQuality;
    lines.push("");
    lines.push(`Trade-leg coverage: ${dq.tradeLegCoveragePct}%  ·  Exit-forward eligible: ${dq.exitForwardEligiblePct}%  ·  Snapshots: ${dq.portfolioSnapshotDays}  ·  Fee source: ${dq.feeSource}`);
    lines.push(`Cash flow: ${dq.cashFlowCoverage}  ·  Cash attribution: ${dq.cashAttributionCoverage}  ·  Replacement pairs: ${dq.replacementPairingCoverage?.matchedPairs || 0} matched, ${dq.replacementPairingCoverage?.highConfidencePairs || 0} high-confidence`);
  }
  return lines.join("\n");
}

// LEGACY — kept for backwards compatibility with earlier tests. The
// engine now delegates to pairReplacementTrades from
// stocksReplacementPairing.js which is provenance-aware.
export async function computeReplacementPairs({ email, asOf, windowStart }) {
  const r = await pairReplacementTrades({
    email, fromYmd: windowStart, toYmd: ymd(asOf), asOf,
  });
  return r.pairs;
}
