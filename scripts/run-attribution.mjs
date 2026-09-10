#!/usr/bin/env node
// scripts/run-attribution.mjs
//
// P3.5 §12 — actually run computeAttributionReport against Richard's
// live Mongo data over four windows (30d, 90d, YTD, max), print each
// report as JSON + a rendered root-cause block.
//
// Usage:
//   MONGO_URI="mongodb+srv://…" node scripts/run-attribution.mjs
//   MONGO_URI="…" node scripts/run-attribution.mjs --email other@x.com
//   MONGO_URI="…" node scripts/run-attribution.mjs --windows 30,90,ytd,max
//   MONGO_URI="…" node scripts/run-attribution.mjs --format text
//
// The script:
//   1. Connects to Mongo (readOnly credentials are fine; the engine
//      upserts one row into StocksAttributionReport per window — pass
//      --dry-run to skip persistence).
//   2. For each requested window, calls computeAttributionReport and
//      prints:
//        · a JSON blob (the full report),
//        · the human-readable rootCauseText block,
//        · the top 5 best / worst decisions ranked by contribPp.
//   3. Refuses false confidence: if the report is `sufficient: false`,
//      prints "WE DO NOT YET HAVE ENOUGH CLEAN HISTORY TO KNOW" with
//      the specific reasons.
//
// This script is safe to run any time — it is pure read + a bounded
// per-window upsert of a diagnostic report.

// Note: no dotenv import — export MONGO_URI in the shell before
// running. Keeps the script dependency-free so it works from any dir.
//
// CRITICAL: import mongoose from the SAME node_modules the backend's
// engine + models use — otherwise each side sees a different default
// connection and every query buffers forever. We resolve mongoose
// via the backend's package by importing a backend file first.
import "../backend/node_modules/mongoose/index.js";
import mongoose from "../backend/node_modules/mongoose/index.js";

function parseArgs(argv) {
  const out = { email: "rgsommer@me.com", windows: ["30", "90", "ytd", "max"], format: "both", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--windows") out.windows = argv[++i].split(",").map(s => s.trim().toLowerCase());
    else if (a === "--format") out.format = argv[++i]; // json | text | both
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function normalizeWindow(w) {
  if (w === "ytd" || w === "max") return w;
  const n = Number(w);
  if (Number.isFinite(n) && n > 0) return n;
  throw new Error(`Bad window value: ${w} (expected 30, 90, 180, 365, ytd, or max)`);
}

async function main() {
  const args = parseArgs(process.argv);
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI is not set. Source .env or export it before running.");
    console.error("   Example:  MONGO_URI=\"mongodb+srv://…\" node scripts/run-attribution.mjs");
    process.exit(1);
  }

  // StocksAdvisor's prod data lives in the `test` DB (Mongoose default
  // in backend/index.js which doesn't set dbName). Override with
  // MONGO_DB env if you moved it elsewhere.
  const dbName = process.env.MONGO_DB || "test";
  console.log(`[run-attribution] Connecting to Mongo (db=${dbName})…`);
  // Do NOT buffer — surface real errors instead of the 10s misleading
  // "buffering timed out" message. Set BEFORE connect so it takes effect.
  mongoose.set("bufferCommands", false);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 60_000,
    dbName,
  });
  // Wait for the connection to be truly ready before running queries.
  await new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once("connected", resolve);
    mongoose.connection.once("error", reject);
  });
  console.log(`[run-attribution] Connected (readyState=${mongoose.connection.readyState}, host=${mongoose.connection.host}, db=${mongoose.connection.name}). Running attribution for ${args.email}.`);

  // Now import the engine — models register against the already-open
  // default connection so their queries never buffer.
  const engineUrl = new URL("../backend/services/stocksAttributionEngine.js", import.meta.url);
  const { computeAttributionReport, renderRootCauseText } = await import(engineUrl.href);

  // P3.6 §11 — verify the daily snapshot writer once, right now, so we
  // establish a real Sept-10 forward baseline instead of waiting until
  // 16:35 ET.
  if (!process.env.SKIP_SNAPSHOT_VERIFY) {
    console.log(`\n[run-attribution] Verifying daily snapshot writer for ${args.email}…`);
    const snapUrl = new URL("../backend/jobs/stocksDailyPositionSnapshot.js", import.meta.url);
    const { writeDailyPositionSnapshotForUser } = await import(snapUrl.href);
    const snapStart = Date.now();
    const snapResult = await writeDailyPositionSnapshotForUser(args.email);
    console.log(`[snapshot-verify] ${JSON.stringify(snapResult)} (${Date.now() - snapStart}ms)`);
  }

  const asOf = new Date();
  const results = [];
  for (const w of args.windows) {
    const wd = normalizeWindow(w);
    process.stdout.write(`\n\n═══════════════════════════════════════════════════════════════════\n`);
    process.stdout.write(`WINDOW: ${w} (asOf ${asOf.toISOString().slice(0, 10)})\n`);
    process.stdout.write(`═══════════════════════════════════════════════════════════════════\n`);
    let report;
    try {
      report = await computeAttributionReport({ email: args.email, windowDays: wd, asOf });
    } catch (e) {
      console.error(`[run-attribution] window=${w} FAILED:`, e?.stack || e?.message || e);
      results.push({ window: w, error: e?.message || String(e) });
      continue;
    }
    results.push({ window: w, report });

    if (report.insufficientEvidence?.length > 0) {
      console.log(`\nWE DO NOT YET HAVE ENOUGH CLEAN HISTORY TO KNOW.`);
      for (const r of report.insufficientEvidence) console.log(`  · ${r}`);
    }

    if (args.format === "text" || args.format === "both") {
      console.log(`\n---- ROOT CAUSE ----\n`);
      console.log(renderRootCauseText(report));
      console.log(`\n---- BEST / WORST ACTUAL DECISIONS ----\n`);
      const fmtRow = (r) => `  ${r.ticker.padEnd(8)} sleeve=${(r.sleeve || "?").padEnd(6)} ret=${(r.securityReturnPct ?? 0).toFixed(2)}%  contrib=${(r.contribPp ?? 0).toFixed(2)}pp  pnlCad=${((r.realizedPnLCad || 0) + (r.unrealizedPnLCad || 0)).toFixed(0)}  open=${r.isOpen}  ${r.entryDate ? new Date(r.entryDate).toISOString().slice(0, 10) : "?"}→${r.exitDate ? new Date(r.exitDate).toISOString().slice(0, 10) : "open"}`;
      console.log("BEST:");
      for (const r of (report.details?.bestDecisions || [])) console.log(fmtRow(r));
      console.log("\nWORST:");
      for (const r of (report.details?.worstDecisions || [])) console.log(fmtRow(r));
      console.log(`\n---- SLEEVE ATTRIBUTION (capital-weighted pp) ----\n`);
      for (const s of (report.details?.sleeveAttribution || [])) {
        console.log(`  ${(s.sleeve || "?").padEnd(10)} weight=${((s.sleeveWeight || 0) * 100).toFixed(1)}%  ret=${(s.sleeveReturnPct || 0).toFixed(2)}%  contrib=${(s.sleeveContribPp || 0).toFixed(2)}pp  pnlCad=${(s.pnlCad || 0).toFixed(0)}  positions=${s.positions}`);
      }
      console.log(`\n---- SELECTION ALPHA (rec vs actual) ----\n`);
      const sa = report.details?.selectionAlpha || {};
      console.log(`  Recommendation-quality: ${(sa.recommendationQualityMeanAlphaPp ?? 0).toFixed(2)}pp  (coverage ${sa.recommendationQualityCoveragePct ?? 0}%)`);
      console.log(`  Actual-position mean:   ${(sa.actualPositionMeanAlphaPp ?? 0).toFixed(2)}pp`);
      console.log(`  Actual-position cap-wt: ${(sa.actualPositionCapWeightedAlphaPp ?? 0).toFixed(2)}pp`);
      console.log(`  Implementation alpha:   ${(sa.implementationAlphaPp ?? 0).toFixed(2)}pp  (actual − rec; negative = execution cost)`);
      console.log(`  Hit rate: ${(sa.hitRatePct ?? 0).toFixed(1)}%  (${sa.winnerCount} winners / ${sa.loserCount} losers)`);
      console.log(`\n---- REPLACEMENT PAIRS (provenance-first) ----\n`);
      const rt = report.details?.replacementTrades || {};
      console.log(`  Method counts: ${JSON.stringify(rt.methodCounts || {})}`);
      console.log(`  High-confidence pairs: ${rt.coverage?.highConfidencePairs || 0}  ·  Low-confidence: ${rt.coverage?.lowConfidencePairs || 0}`);
      for (const p of (rt.pairs || []).slice(0, 5)) {
        console.log(`    ${p.soldTicker}→${p.boughtTicker}  ${p.pairingMethod} [${p.pairingConfidence}]  addedPp=${p.replacementValueAddedPp == null ? "pending" : p.replacementValueAddedPp.toFixed(2)}pp`);
      }
      console.log(`\n---- CASH ATTRIBUTION (daily chain-linked) ----\n`);
      const ce = report.details?.cashEffect || {};
      console.log(`  Cumulative drag: ${(ce.cumulativeCashDragPp ?? 0).toFixed(2)}pp  (bench=${ce.benchmarkTicker}, coverage=${ce.coverage})`);
      console.log(`\n---- REAL VS PASSIVE ----\n`);
      for (const rvp of (report.details?.realVsPassive || [])) {
        const passive = Number.isFinite(rvp.passiveReturnPct)
          ? `${rvp.passiveReturnPct.toFixed(2)}%` : "DATA_UNAVAILABLE";
        const portfolio = Number.isFinite(rvp.portfolioReturnPct)
          ? `${rvp.portfolioReturnPct.toFixed(2)}%` : "DATA_UNAVAILABLE";
        const alpha = Number.isFinite(rvp.alphaPp)
          ? `${rvp.alphaPp.toFixed(2)}pp` : "DATA_UNAVAILABLE";
        const src = rvp.marketDataSource ? ` [${rvp.marketDataSource}${rvp.fallbackUsed ? "-fallback" : ""}]` : "";
        console.log(`  ${rvp.ticker.padEnd(9)} passive=${passive}${src}  portfolio=${portfolio}  alpha=${alpha}`);
      }
      console.log(`\n---- METRIC CONFIDENCE ----\n`);
      for (const [k, v] of Object.entries(report.metricConfidence || {})) {
        console.log(`  ${k.padEnd(30)} ${v}`);
      }
      console.log(`\n---- DATA-QUALITY DASHBOARD ----\n`);
      for (const [k, v] of Object.entries(report.dataQualityDashboard || {})) {
        console.log(`  ${k.padEnd(35)} ${v}${typeof v === "number" && !k.includes("Days") ? "%" : ""}`);
      }
      console.log(`\n---- DATA RESCUE ----\n`);
      const dr = report.dataRescue || {};
      console.log(`  Unattributable breakdown: ${JSON.stringify(dr.unattributableReasonBreakdown?.byReason || {})}`);
      console.log(`  Opening-balance lots recovered: ${dr.openingBalanceLots?.length || 0}`);
      for (const l of (dr.openingBalanceLots || []).slice(0, 10)) {
        console.log(`    ${l.ticker.padEnd(8)} ${l.account || "-"} shares=${l.shares} avgCost=${l.entryPrice || "?"} provenance=${l.entryProvenance} confidence=${l.confidence}`);
      }
      console.log(`  Rec link reconciliation: before=${JSON.stringify(dr.recLinkReconciliation?.before)}  after=${JSON.stringify(dr.recLinkReconciliation?.after)}`);
      console.log(`  Transfer candidates: ${dr.transferCandidates?.length || 0}`);
      for (const tc of (dr.transferCandidates || []).slice(0, 5)) {
        console.log(`    ${tc.ticker} ${tc.shares}sh ${tc.soldAccount}→${tc.boughtAccount} ${tc.soldOn}→${tc.boughtOn}  ${tc.classification}`);
      }
      console.log(`\n---- DIAGNOSTIC CLASSIFICATION ----\n`);
      console.log(`  ${report.diagnosticClassification?.class}: ${report.diagnosticClassification?.label}`);
      console.log(`\n---- DATA QUALITY ----\n`);
      console.log(JSON.stringify(report.dataQuality, null, 2));
    }

    if (args.format === "json" || args.format === "both") {
      console.log(`\n---- FULL REPORT JSON ----\n`);
      console.log(JSON.stringify(report, null, 2));
    }
  }

  await mongoose.disconnect();
  console.log(`\n[run-attribution] Disconnected. Wrote ${results.filter(r => !r.error).length} / ${results.length} reports.`);
  process.exit(0);
}

main().catch(e => {
  console.error(`[run-attribution] fatal:`, e?.stack || e?.message || e);
  process.exit(2);
});
