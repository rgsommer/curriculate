// backend/services/stocksAttributionEngine.js
//
// P3 (2026-09-09) — portfolio attribution engine. Ties the ledger,
// matched-benchmark, exit-forward, and passive-comparison pieces
// into a single report and produces the ROOT-CAUSE ranking.
//
// The engine emits a StocksAttributionReport row per (email, asOfDate)
// with:
//   • header            — window bounds, coverage %
//   • waterfall         — additive attribution (only defensible parts)
//   • rootCause         — top 3 drags + top 3 offsets, ranked by pp
//   • details           — sleeve · selection · entry · exit · sizing ·
//                          replacement · sector · FX · churn · cash ·
//                          realVsPassive
//   • dataQuality       — per-component coverage
//   • notes             — "DESCRIPTIVE / NON-ADDITIVE" flags per §16
//
// The output is intentionally VERBOSE — a UI can pull any slice; a
// text renderer can produce the root-cause statement §17 wants.
//
// This is a DIAGNOSTIC engine. It never modifies picks, decisions, or
// portfolio state.

import StocksAttributionReport from "../models/StocksAttributionReport.js";
import StocksPositionLedgerEntry from "../models/StocksPositionLedgerEntry.js";
import StocksExitForwardMetric from "../models/StocksExitForwardMetric.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import { buildPortfolioLedger } from "./stocksPositionLedger.js";
import { stampExitForwardOnClose, backfillExitForwardMetrics } from "./stocksExitForward.js";
import { pickBenchmarkFor, getMatchedReturnPct } from "./stocksBenchmarkMatched.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";

const ENGINE_VERSION = "3.0.0";

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }

// PUBLIC — produce the report for a user over a window.
// windowDays default 90; asOf defaults to today.
export async function computeAttributionReport({
  email, windowDays = 90, asOf = new Date(),
} = {}) {
  if (!email) throw new Error("email required");
  const asOfYmd = ymd(asOf);
  const windowStart = ymd(new Date(asOf.getTime() - windowDays * 86400_000));

  // 1) Ledger
  const { rows: allLedgerRows, coverage: legCov } = await buildPortfolioLedger({
    email, priceAsOf: asOf,
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
  // Trigger a lightweight backfill; if the horizons haven't elapsed
  // they stay PENDING (no fake data).
  const backfill = await backfillExitForwardMetrics({ email, asOf }).catch(() => null);

  // 2) Real portfolio return over window (from snapshots).
  const snaps = await StocksPortfolioSnapshot.find({
    email, accountId: "__total__",
    date: { $gte: windowStart, $lte: asOfYmd },
  }).sort({ date: 1 }).lean();
  const portfolioReturnPct = snaps.length >= 2 && snaps[0].totalCad > 0
    ? ((snaps[snaps.length - 1].totalCad - snaps[0].totalCad) / snaps[0].totalCad) * 100
    : null;

  // 3) Passive alternatives over the same window.
  const passiveTargets = ["XEQT.TO", "XIC.TO", "SPY", "VTI"];
  const passiveRows = [];
  for (const t of passiveTargets) {
    const bres = await getMatchedReturnPct({ ticker: t, fromDate: windowStart, toDate: asOfYmd });
    passiveRows.push({ ticker: t, returnPct: bres.pct, note: bres.note });
  }

  // 4) Sleeve attribution — sum realized+unrealized CAD PnL by sleeve.
  const sleeveMap = new Map(); // sleeve → { capitalCad, pnlCad, alphaSum, alphaCount }
  for (const r of rows) {
    const s = r.sleeve || "unknown";
    const capital = (r.entryPrice || 0) * (r.entryShares || 0) * (r.entryCurrency === "CAD" ? 1 : (r.entryFx || 1.37));
    const pnl = (r.realizedPnLCad || 0) + (r.unrealizedPnLCad || 0);
    const bucket = sleeveMap.get(s) || { capitalCad: 0, pnlCad: 0, alphaSum: 0, alphaCount: 0, tickers: [] };
    bucket.capitalCad += capital; bucket.pnlCad += pnl;
    bucket.tickers.push(r.ticker);
    if (Number.isFinite(r.matchedAlphaPct)) { bucket.alphaSum += r.matchedAlphaPct; bucket.alphaCount++; }
    sleeveMap.set(s, bucket);
  }
  const sleeveAttribution = [...sleeveMap.entries()].map(([sleeve, b]) => ({
    sleeve, capitalCad: b.capitalCad, pnlCad: b.pnlCad,
    positions: b.tickers.length,
    meanAlphaPct: b.alphaCount > 0 ? b.alphaSum / b.alphaCount : null,
  })).sort((a, b) => (b.pnlCad || 0) - (a.pnlCad || 0));

  // 5) Selection alpha — mean matched alpha across attributable rows.
  const attributable = rows.filter(r => r.dataQuality !== "UNATTRIBUTABLE" && Number.isFinite(r.matchedAlphaPct));
  const meanSelectionAlphaPp = attributable.length > 0
    ? attributable.reduce((s, r) => s + r.matchedAlphaPct, 0) / attributable.length : null;
  const winners = attributable.filter(r => r.matchedAlphaPct > 0);
  const losers  = attributable.filter(r => r.matchedAlphaPct < 0);
  const hitRatePct = attributable.length > 0 ? (winners.length / attributable.length) * 100 : null;
  const avgWinner  = winners.length ? winners.reduce((s, r) => s + r.matchedAlphaPct, 0) / winners.length : null;
  const avgLoser   = losers.length  ? losers.reduce((s, r)  => s + r.matchedAlphaPct, 0) / losers.length : null;

  // 6) Exit-forward summary.
  const exitMetrics = await StocksExitForwardMetric.find({
    email: String(email).toLowerCase(),
    exitDate: { $gte: new Date(windowStart), $lte: asOf },
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

  // 7) Sizing effect — actual vs equal-weight over the SAME rows.
  const eqWeightPct = attributable.length > 0
    ? attributable.reduce((s, r) => s + (r.securityReturnPct || 0), 0) / attributable.length : null;
  const totalCapital = attributable.reduce((s, r) => s + ((r.entryPrice || 0) * (r.entryShares || 0)) *
    (r.entryCurrency === "CAD" ? 1 : (r.entryFx || 1.37)), 0);
  const capWeightedPct = totalCapital > 0
    ? attributable.reduce((s, r) => {
        const cap = ((r.entryPrice || 0) * (r.entryShares || 0)) *
          (r.entryCurrency === "CAD" ? 1 : (r.entryFx || 1.37));
        return s + (r.securityReturnPct || 0) * (cap / totalCapital);
      }, 0)
    : null;
  const sizingEffectPp = (Number.isFinite(capWeightedPct) && Number.isFinite(eqWeightPct))
    ? capWeightedPct - eqWeightPct : null;

  // 8) Replacement-trade effect — pair each SELL with a same-day BUY
  // within the same account, compare forward 20d return delta.
  const replacementPairs = await computeReplacementPairs({ email, asOf, windowStart });

  // 9) FX attribution — sum fxReturnPct contribution over USD holdings
  // weighted by USD capital share.
  const usdRows = rows.filter(r => r.entryCurrency === "USD" && Number.isFinite(r.fxReturnPct));
  const usdCapitalCad = usdRows.reduce((s, r) => s + (r.entryPrice || 0) * (r.entryShares || 0) * (r.entryFx || 1.37), 0);
  const usdFxContribPp = totalCapital > 0 && usdCapitalCad > 0
    ? usdRows.reduce((s, r) => {
        const cap = (r.entryPrice || 0) * (r.entryShares || 0) * (r.entryFx || 1.37);
        return s + (r.fxReturnPct || 0) * (cap / totalCapital);
      }, 0)
    : null;

  // 10) Churn effect — trade count, avg holding days, estimated fees.
  const closedRows = rows.filter(r => r.exitDate && r.dataQuality !== "UNATTRIBUTABLE");
  const avgHoldingDays = closedRows.length > 0
    ? closedRows.reduce((s, r) => s + (r.holdingPeriodDays || 0), 0) / closedRows.length : null;
  const feesCadEstimate = rows.reduce((s, r) => s + (r.feesEstimatedNative || 0) *
    (r.entryCurrency === "CAD" ? 1 : (r.entryFx || 1.37)), 0);
  const feesEffectPp = (portfolioReturnPct != null && snaps.length >= 2 && snaps[0].totalCad > 0)
    ? -(feesCadEstimate / snaps[0].totalCad) * 100 : null;
  const numTrades = rows.length;

  // 11) Cash effect — measure whether portfolio held cash during
  // window when passive-alt was up or down. Descriptive: average cash
  // share across snapshots × passive return over window.
  const avgCashShare = snaps.length > 0
    ? snaps.reduce((s, x) => s + ((x.cashCad || 0) + (x.cashUsd || 0) * (x.fxUsdCad || 1.37)) / (x.totalCad || 1), 0) / snaps.length : null;
  const passiveBaseline = passiveRows.find(p => p.ticker === "XEQT.TO")?.returnPct
                        ?? passiveRows.find(p => p.ticker === "SPY")?.returnPct
                        ?? null;
  const cashEffectPp = (Number.isFinite(avgCashShare) && Number.isFinite(passiveBaseline))
    ? -(avgCashShare * passiveBaseline) : null;

  // 12) Sector attribution — per-sector alpha (nulls if sector not stamped).
  const sectorMap = new Map();
  for (const r of attributable) {
    const sec = r.sector || "unknown";
    if (!sectorMap.has(sec)) sectorMap.set(sec, { count: 0, alphaSum: 0, pnlCad: 0 });
    const b = sectorMap.get(sec);
    b.count++;
    b.alphaSum += r.matchedAlphaPct;
    b.pnlCad += (r.realizedPnLCad || 0) + (r.unrealizedPnLCad || 0);
  }
  const sectorAttribution = [...sectorMap.entries()].map(([sector, b]) => ({
    sector, positions: b.count,
    meanAlphaPct: b.count > 0 ? b.alphaSum / b.count : null,
    pnlCad: b.pnlCad,
  })).sort((a, b) => (b.pnlCad || 0) - (a.pnlCad || 0));

  // 13) Real vs passive table (spec §14).
  const realVsPassive = passiveRows.map(p => ({
    ticker: p.ticker,
    passiveReturnPct: p.returnPct,
    portfolioReturnPct,
    alphaPp: Number.isFinite(portfolioReturnPct) && Number.isFinite(p.returnPct) ? portfolioReturnPct - p.returnPct : null,
  }));

  // 14) Waterfall — only ADDITIVE components. Sizing / cash / fees /
  // FX / churn are legitimately additive vs a passive benchmark;
  // selection / entry / exit are cast as DESCRIPTIVE only because
  // they double-count with sizing and each other.
  const waterfall = {
    passiveBenchmarkTicker: "XEQT.TO",
    passiveReturnPct: passiveBaseline,
    portfolioReturnPct,
    additiveComponents: [
      { label: "Sizing effect (vs equal-weight)", pp: sizingEffectPp },
      { label: "Cash drag", pp: cashEffectPp },
      { label: "FX (USD holdings)", pp: usdFxContribPp },
      { label: "Fees / churn (estimated)", pp: feesEffectPp },
    ].filter(x => Number.isFinite(x.pp)),
    residualPp: null, // filled below
    residualNote: "Residual is the unexplained gap between portfolio and passive after the additive components. Includes selection quality, market timing, and reconstruction gaps.",
  };
  if (Number.isFinite(portfolioReturnPct) && Number.isFinite(passiveBaseline)) {
    const additive = waterfall.additiveComponents.reduce((s, x) => s + x.pp, 0);
    waterfall.residualPp = (portfolioReturnPct - passiveBaseline) - additive;
  }

  // 15) Root cause — top 3 drags + top 3 offsets, mixing additive +
  // descriptive components. Descriptive items include selection alpha
  // and exit-forward alpha averages so the operator sees what MIGHT
  // be driving results even when we can't cleanly additive-attribute.
  const rootCandidates = [
    ...(waterfall.additiveComponents || []),
    Number.isFinite(meanSelectionAlphaPp) ? { label: "Mean selection alpha (descriptive)", pp: meanSelectionAlphaPp, descriptive: true } : null,
    Number.isFinite(exitAlphaMean.d20) ? { label: "Exit-forward alpha (20d, descriptive)", pp: -exitAlphaMean.d20, descriptive: true } : null,
  ].filter(Boolean);
  const drags   = [...rootCandidates].filter(x => x.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 3);
  const offsets = [...rootCandidates].filter(x => x.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 3);

  // Data quality summary.
  const dataQuality = {
    tradeLegCoveragePct: legCov.coveragePct,
    portfolioSnapshotDays: snaps.length,
    exitForwardEligiblePct: exitCoverageEligible,
    attributableRows: attributable.length,
    unattributableRows: rows.filter(r => r.dataQuality === "UNATTRIBUTABLE").length,
    fxCoveragePct: rows.length > 0 ? Math.round((usdRows.length + rows.filter(r => r.entryCurrency === "CAD").length) / rows.length * 100) : 0,
    windowDays,
    windowStart,
    asOfDate: asOfYmd,
  };

  const report = {
    email, asOfDate: asOfYmd, windowStart,
    engineVersion: ENGINE_VERSION,
    header: {
      windowDays, windowStart, asOfDate: asOfYmd,
      portfolioReturnPct,
      passiveReturnPct: passiveBaseline,
      alphaVsPassivePp: Number.isFinite(portfolioReturnPct) && Number.isFinite(passiveBaseline)
        ? portfolioReturnPct - passiveBaseline : null,
    },
    waterfall,
    rootCause: { drags, offsets },
    details: {
      sleeveAttribution,
      selectionAlpha: {
        meanAlphaPp: meanSelectionAlphaPp,
        hitRatePct, avgWinner, avgLoser,
        winnerCount: winners.length, loserCount: losers.length,
      },
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
      replacementTrades: replacementPairs,
      sectorAttribution,
      fxAttribution: {
        usdCapitalCad, usdFxContribPp,
        note: "Contribution to portfolio return in pp, weighted by USD capital share.",
      },
      churnEffect: {
        numTrades, avgHoldingDays, feesCadEstimate, feesEffectPp,
      },
      cashEffect: {
        avgCashShare, passiveBenchmarkForCash: "XEQT.TO", cashEffectPp,
      },
      realVsPassive,
    },
    dataQuality,
    notes: [
      "Selection / entry / exit alpha are DESCRIPTIVE / NON-ADDITIVE. The waterfall's residual absorbs their combined effect vs the passive benchmark.",
      "UNATTRIBUTABLE ledger rows (SELL with no matching BUY) are EXCLUDED from all alpha computations.",
      "Exit-forward classification is PENDING until all five horizons elapse. Wait for classification before drawing conclusions.",
      backfill ? `Exit-forward backfill: filled ${backfill.filledHorizons} horizons across ${backfill.updatedRows} rows.` : null,
    ].filter(Boolean),
  };

  try {
    await StocksAttributionReport.updateOne(
      { email, asOfDate: asOfYmd },
      { $set: { ...report, generatedAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    console.warn(`[attribution] persist warn for ${email}:`, e?.message);
  }
  return report;
}

// PUBLIC — root-cause text render. Consumers can wrap this in a UI or
// email footer.
export function renderRootCauseText(report) {
  if (!report?.rootCause) return "No attribution data.";
  const drags = (report.rootCause.drags || []);
  const offsets = (report.rootCause.offsets || []);
  const lines = [];
  lines.push("PORTFOLIO DIAGNOSIS");
  lines.push("");
  const alpha = report.header?.alphaVsPassivePp;
  if (Number.isFinite(alpha)) {
    const sign = alpha >= 0 ? "+" : "";
    lines.push(`Actual portfolio: ${sign}${alpha.toFixed(1)}pp vs ${report.waterfall.passiveBenchmarkTicker} over ${report.header.windowDays}d`);
    lines.push("");
  }
  if (drags.length > 0) {
    lines.push("Primary drag:");
    drags.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}: ${d.pp.toFixed(1)}pp${d.descriptive ? "  (descriptive)" : ""}`));
  }
  if (offsets.length > 0) {
    lines.push("");
    lines.push("Offsets:");
    offsets.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}: +${d.pp.toFixed(1)}pp${d.descriptive ? "  (descriptive)" : ""}`));
  }
  if (report.dataQuality) {
    const dq = report.dataQuality;
    lines.push("");
    lines.push(`Trade-leg coverage: ${dq.tradeLegCoveragePct}%  ·  Exit-forward eligible: ${dq.exitForwardEligiblePct}%  ·  Snapshots: ${dq.portfolioSnapshotDays}`);
  }
  return lines.join("\n");
}

// Helper: replacement-trade pairing. Same-day (±3d) SELL + BUY in same
// account. Compare 20d forward returns.
async function computeReplacementPairs({ email, asOf, windowStart }) {
  const trades = await StocksTradeJournal.find({
    email: String(email).toLowerCase(),
    executedAt: { $gte: new Date(windowStart), $lte: asOf },
  }).sort({ executedAt: 1 }).lean();
  const pairs = [];
  const sellByAccount = new Map();
  for (const t of trades) {
    for (const leg of (t.legs || [])) {
      if (!leg.ticker) continue;
      const acct = t.account || "";
      if (leg.side === "SELL") {
        if (!sellByAccount.has(acct)) sellByAccount.set(acct, []);
        sellByAccount.get(acct).push({ leg, t });
      }
      if (leg.side === "BUY") {
        const list = sellByAccount.get(acct) || [];
        // find a SELL within 3 days
        const idx = list.findIndex(s => Math.abs(new Date(t.executedAt) - new Date(s.t.executedAt)) <= 3 * 86400_000);
        if (idx < 0) continue;
        const s = list.splice(idx, 1)[0];
        pairs.push({
          soldTicker: s.leg.ticker, boughtTicker: leg.ticker,
          soldOn: ymd(s.t.executedAt), boughtOn: ymd(t.executedAt),
          soldPrice: s.leg.pricePerShare, boughtPrice: leg.pricePerShare,
        });
      }
    }
  }
  // Compute 20d forward returns for each pair.
  const HORIZON_D = 20;
  for (const p of pairs) {
    const forwardYmd = ymd(new Date(new Date(p.boughtOn).getTime() + HORIZON_D * 86400_000));
    if (forwardYmd > ymd(asOf)) { p.replacementValueAddedPp = null; p.note = "horizon not yet elapsed"; continue; }
    const [oldBars, newBars] = await Promise.all([
      fetchYahooDaily(p.soldTicker, "6mo").catch(() => null),
      fetchYahooDaily(p.boughtTicker, "6mo").catch(() => null),
    ]);
    const readAt = (bars, targetYmd) => {
      if (!Array.isArray(bars)) return null;
      const rev = [...bars].reverse();
      const bar = rev.find(b => (b.date || "").slice(0, 10) <= targetYmd);
      return bar ? bar.close : null;
    };
    const oldFwd = readAt(oldBars, forwardYmd);
    const newFwd = readAt(newBars, forwardYmd);
    const oldR = oldFwd && p.soldPrice ? ((oldFwd - p.soldPrice) / p.soldPrice) * 100 : null;
    const newR = newFwd && p.boughtPrice ? ((newFwd - p.boughtPrice) / p.boughtPrice) * 100 : null;
    p.oldReturn20dPct = oldR;
    p.newReturn20dPct = newR;
    p.replacementValueAddedPp = Number.isFinite(oldR) && Number.isFinite(newR) ? newR - oldR : null;
  }
  return pairs;
}
