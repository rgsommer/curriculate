#!/usr/bin/env node
// test-p26-signal-integrity.mjs
//
// P2.6 SIGNAL-INTEGRITY PATCH regression tests.
//
// Covers every acceptance criterion in the P2.6 spec:
//   1. Earnings-timing alignment is correct across pre/after/during/unknown
//   2. Post-earnings drift never uses a pre-release price as post-release
//   3. Catalyst hydration produces material scores + deduplicates by canonical key
//   4. Model E subtype provenance identifies POST_EARNINGS / CATALYST / BOTH
//   5. EPS-revision handles near-zero denominator, sign-flip, both-negative
//   6. Wide-funnel shadow env parsing works and StocksShadowFunnelRun schema is valid
//   7. Engine version bumped to 2.2.0

import fs from "fs";
import {
  normalizeReleaseTiming, alignReactionBars,
} from "../services/stocksEarningsSurprise.js";
import { pctChangeStructured } from "../services/stocksRealEpsRevisions.js";
import { classifyCatalystItem } from "../services/stocksCatalystClassifier.js";
import { dedupeKey } from "../services/stocksCatalystIngest.js";
import { requestedShadowWidths } from "../services/stocksShadowFunnel.js";

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; failures.push({ name, detail }); console.error("  ✗", name, detail ? "— " + detail : ""); }
}

// ─── Synthetic trading-day fixtures ─────────────────────────────────
// Build a bars array. Trading days only — Sat/Sun skipped.
function bar(date, open, close, volume = 1_000_000) { return { date, open, close, volume }; }
const barsBase = [
  // Late-August through mid-September 2026 (weekdays only)
  bar("2026-08-28", 100, 101), bar("2026-08-31", 101, 102),
  bar("2026-09-01", 102, 103), bar("2026-09-02", 103, 104), bar("2026-09-03", 104, 105),
  bar("2026-09-04", 105, 106),
  // Friday Sep 4 close = 106. Weekend. Monday Sep 7 (fictional holiday-free).
  bar("2026-09-07", 110, 112),   // reaction if Friday AMC
  bar("2026-09-08", 112, 114),
  bar("2026-09-09", 114, 116),
  bar("2026-09-10", 116, 118),
  bar("2026-09-11", 118, 120),
];
// Benchmark: modest positive drift.
const benchBase = barsBase.map((b, i) => bar(b.date, 100 + i * 0.5, 100 + (i + 1) * 0.5));

// ─── 1. Timing normalization ────────────────────────────────────────
function test1_timingNormalization() {
  assert(normalizeReleaseTiming("bmo") === "pre-market", "1. bmo → pre-market");
  assert(normalizeReleaseTiming("amc") === "after-market", "1b. amc → after-market");
  assert(normalizeReleaseTiming("BMO") === "pre-market", "1c. case-insensitive BMO");
  assert(normalizeReleaseTiming("Before Market Open") === "pre-market", "1d. free-text prose");
  assert(normalizeReleaseTiming("") === "unknown", "1e. missing → unknown");
  assert(normalizeReleaseTiming("dmt") === "during-market", "1f. dmt → during-market");
}

// ─── 2. After-market release on a Friday → Monday reaction ─────────
function test2_afterMarketFridayMondayReaction() {
  const r = alignReactionBars({
    bars: barsBase, benchBars: benchBase,
    earningsDate: "2026-09-04",
    releaseTiming: "after-market",
  });
  assert(r?.preEventTradingDate === "2026-09-04",
    "2. AMC Fri → preEvent = Fri Sep 4", `got ${r?.preEventTradingDate}`);
  assert(r?.reactionTradingDate === "2026-09-07",
    "2b. Reaction = Mon Sep 7 (skips weekend)", `got ${r?.reactionTradingDate}`);
  assert(Math.abs(r?.preEventClose - 106) < 1e-6, "2c. preEventClose = Friday close 106");
  assert(Math.abs(r?.reactionOpen - 110) < 1e-6, "2d. reactionOpen = Monday open 110");
  assert(r?.gapOpenPct > 3 && r?.gapOpenPct < 4.5, "2e. Gap opens ~+3.77%", `got ${r?.gapOpenPct}`);
  assert(r?.day1ReturnPct > 5 && r?.day1ReturnPct < 6.5, "2f. Day-1 return ~+5.66%");
}

// ─── 3. Pre-market release on Monday → Monday reaction ─────────────
function test3_preMarketMondayReaction() {
  // Same bars, but earnings released BMO on Monday Sep 7.
  const r = alignReactionBars({
    bars: barsBase, benchBars: benchBase,
    earningsDate: "2026-09-07",
    releaseTiming: "pre-market",
  });
  assert(r?.preEventTradingDate === "2026-09-04",
    "3. BMO Mon → preEvent = Fri Sep 4 (last close BEFORE release)");
  assert(r?.reactionTradingDate === "2026-09-07",
    "3b. Reaction day = Monday Sep 7 itself");
  assert(Math.abs(r?.preEventClose - 106) < 1e-6, "3c. preEventClose = Friday close 106");
  assert(Math.abs(r?.reactionOpen - 110) < 1e-6, "3d. reactionOpen = Monday open 110");
  assert(r?.gapOpenPct > 3 && r?.gapOpenPct < 4.5, "3e. Gap opens ~+3.77% same as AMC alignment");
}

// ─── 4. Unknown timing → conservative after-market treatment ───────
function test4_unknownTimingConservative() {
  const rUnk = alignReactionBars({
    bars: barsBase, benchBars: benchBase,
    earningsDate: "2026-09-04",
    releaseTiming: "unknown",
  });
  const rAmc = alignReactionBars({
    bars: barsBase, benchBars: benchBase,
    earningsDate: "2026-09-04",
    releaseTiming: "after-market",
  });
  assert(rUnk?.reactionTradingDate === rAmc?.reactionTradingDate,
    "4. UNKNOWN timing uses SAME conservative alignment as AMC (never uses pre-release price)");
}

// ─── 5. Holiday: earnings on a non-trading day still picks the next open bar ─
function test5_holidayEarnings() {
  // Earnings on Saturday 2026-09-05 (non-trading). AMC treatment
  // should use Friday close as preEvent and Monday open as reaction.
  const r = alignReactionBars({
    bars: barsBase, benchBars: benchBase,
    earningsDate: "2026-09-05",
    releaseTiming: "after-market",
  });
  assert(r?.preEventTradingDate === "2026-09-04",
    "5. Non-trading-day earnings → preEvent falls to last trading day",
    `got ${r?.preEventTradingDate}`);
  assert(r?.reactionTradingDate === "2026-09-07",
    "5b. Reaction is next trading day after the non-trading earnings date");
}

// ─── 6. Missing bars → null (no fabricated reaction) ───────────────
function test6_missingBars() {
  const shortBars = barsBase.slice(0, 3); // not enough for day-5
  const r = alignReactionBars({
    bars: shortBars, benchBars: benchBase,
    earningsDate: "2026-09-01",
    releaseTiming: "after-market",
  });
  assert(!r || r.reactionDay5Close == null,
    "6. Missing post-reaction bars → reactionDay5Close stays null (never fabricated)");
}

// ─── 7. EPS-revision edge cases ────────────────────────────────────
function test7_nearZeroDenominator() {
  const s = pctChangeStructured(0.02, 0.10);   // <0.05 baseline
  assert(s.pct == null && s.flavor === "near-zero",
    "7. |old| < 0.05 → pct null and flavor=near-zero (avoid explosion)");
}
function test8_signFlipUp() {
  const s = pctChangeStructured(-0.02, 0.30);
  assert(s.flavor === "sign-flip-up" && s.pct == null,
    "8. Negative → positive tiny denominator flagged sign-flip-up");
}
function test9_bothNegative() {
  const s = pctChangeStructured(-2.0, -1.2);
  assert(s.flavor === "both-negative" && s.pct > 0,
    "9. Both negative and less-negative → flavor=both-negative, pct>0",
    `got pct=${s.pct}`);
}
function test10_pctCapped() {
  const s = pctChangeStructured(0.5, 200);
  assert(s.capped === true, "10. Extreme change caps at ±500 (no infinities)",
    `got pct=${s.pct} capped=${s.capped}`);
}

// ─── 11. Catalyst hydration dedupe key ─────────────────────────────
function test11_dedupeKeyCollapses() {
  const k1 = dedupeKey({ ticker: "ACME", eventDate: "2026-09-09",
    headline: "Acme raises FY guidance after Q3 earnings beat!" });
  const k2 = dedupeKey({ ticker: "ACME", eventDate: "2026-09-09",
    headline: "Acme raises FY guidance after Q3 earnings beat (report)" });
  const k3 = dedupeKey({ ticker: "BETA", eventDate: "2026-09-09",
    headline: "Acme raises FY guidance after Q3 earnings beat" });
  assert(k1 === k2, "11. Same event by two outlets collapses to one dedupeKey",
    `k1=${k1} k2=${k2}`);
  assert(k1 !== k3, "11b. Different ticker → different dedupeKey");
}

// ─── 12. Persist-with-dedupeKey path via classifier persistence ────
function test12_classifierAcceptsDedupeKey() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksCatalystClassifier.js", "utf-8");
  assert(src.includes("dedupeKey: item.dedupeKey || null"),
    "12. persistCatalyst() writes dedupeKey field");
}

// ─── 13. Wide-funnel env parsing ───────────────────────────────────
function test13_shadowFunnelEnvParsing() {
  const prev = process.env.STOCKS_SHADOW_FUNNEL_WIDTHS;
  process.env.STOCKS_SHADOW_FUNNEL_WIDTHS = "medium,wide";
  const rs = requestedShadowWidths();
  process.env.STOCKS_SHADOW_FUNNEL_WIDTHS = prev || "";
  assert(rs.length === 2 && rs.includes("medium") && rs.includes("wide"),
    "13. env medium,wide → both widths requested",
    `got ${JSON.stringify(rs)}`);
}
function test14_shadowFunnelEnvEmpty() {
  const prev = process.env.STOCKS_SHADOW_FUNNEL_WIDTHS;
  delete process.env.STOCKS_SHADOW_FUNNEL_WIDTHS;
  const rs = requestedShadowWidths();
  process.env.STOCKS_SHADOW_FUNNEL_WIDTHS = prev || "";
  assert(rs.length === 0, "14. No env → shadow experiment disabled (nothing runs)");
}
function test15_shadowFunnelEnvBadWidth() {
  const prev = process.env.STOCKS_SHADOW_FUNNEL_WIDTHS;
  process.env.STOCKS_SHADOW_FUNNEL_WIDTHS = "medium,bogus";
  const rs = requestedShadowWidths();
  process.env.STOCKS_SHADOW_FUNNEL_WIDTHS = prev || "";
  assert(rs.length === 1 && rs[0] === "medium",
    "15. Unknown width is silently dropped (only valid entries survive)");
}

// ─── 16. Shadow-funnel model + engine wiring ───────────────────────
function test16_shadowFunnelModelDeclared() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksShadowFunnelRun.js", "utf-8");
  assert(/mongoose\.model\("StocksShadowFunnelRun"/.test(src),
    "16. StocksShadowFunnelRun model declared");
  assert(/ShadowFunnelRunSchema\.index\(\{\s*pickDate:\s*1,\s*funnel:\s*1,\s*ticker:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/.test(src),
    "16b. Unique (pickDate, funnel, ticker) index — idempotent shadow persistence");
  for (const f of ["opportunityScore", "entryScore", "combined", "scoreByModel",
                    "compositeRank", "technicalScore", "engineVersion", "dataAsOf"]) {
    assert(src.includes(f), `16-${f}. Shadow-run schema declares ${f}`);
  }
}
function test17_engineHydratesCatalystAndSubtype() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("hydrateCatalystEventsForTicker"),
    "17. Pick engine imports/uses hydrateCatalystEventsForTicker");
  assert(src.includes("cand.catalystHydrate"),
    "17b. Hydrate result stored on candidate");
  assert(src.includes("catalystQualityScore: catalystHydrate?.catalystQualityScore"),
    "17c. catalystQualityScore hydrated into OQ input");
  assert(src.includes("cand.postEarningsSubtype"),
    "17d. postEarningsSubtype computed and attached to candidate");
  assert(src.includes('driftPresent && catalystPresent ? "BOTH"'),
    "17e. Subtype logic distinguishes POST_EARNINGS / CATALYST / BOTH");
}
function test18_engineFiresShadowFunnels() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/services/stocksDailyPickEngine.js", "utf-8");
  assert(src.includes("runShadowFunnels(scored"),
    "18. Engine invokes runShadowFunnels after production top-K is picked");
  assert(/const ENGINE_VERSION = "2\.2\.0"/.test(src),
    "18b. Engine version bumped to 2.2.0 (P2.6)");
}

// ─── 19. Distribution schema carries subtype ───────────────────────
function test19_distributionSchemaSubtype() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksPickDistribution.js", "utf-8");
  assert(src.includes("postEarningsSubtype"),
    "19. StocksPickDistribution.candidates carries postEarningsSubtype");
}

// ─── 20. Earnings-surprise schema carries timing metadata ──────────
function test20_earningsSurpriseSchemaTiming() {
  const src = fs.readFileSync(
    "/Users/richardsommer/dev/curriculate/backend/models/StocksEarningsSurpriseCache.js", "utf-8");
  for (const f of ["releaseTiming", "timingConfident", "preEventTradingDate",
                    "reactionTradingDate", "preEventClose", "reactionOpen",
                    "reactionDay1Close", "reactionDay5Close", "gapRetentionPct"]) {
    assert(src.includes(f), `20-${f}. Earnings-surprise schema declares ${f}`);
  }
}

// ─── 21. AMC guidance still lands as EARNINGS_GUIDANCE ─────────────
function test21_classifierGuidanceStillFires() {
  const c = classifyCatalystItem({
    ticker: "ACME", eventDate: "2026-09-09", source: "sec-8k", sourceId: "x",
    headline: "Acme raises FY guidance",
  });
  assert(c.category === "EARNINGS_GUIDANCE",
    "21. Guidance-raise still fires EARNINGS_GUIDANCE after P2.6 changes");
}

function run() {
  console.log("\n═══ P2.6 SIGNAL-INTEGRITY PATCH regression ═══\n");
  test1_timingNormalization();
  test2_afterMarketFridayMondayReaction();
  test3_preMarketMondayReaction();
  test4_unknownTimingConservative();
  test5_holidayEarnings();
  test6_missingBars();
  test7_nearZeroDenominator();
  test8_signFlipUp();
  test9_bothNegative();
  test10_pctCapped();
  test11_dedupeKeyCollapses();
  test12_classifierAcceptsDedupeKey();
  test13_shadowFunnelEnvParsing();
  test14_shadowFunnelEnvEmpty();
  test15_shadowFunnelEnvBadWidth();
  test16_shadowFunnelModelDeclared();
  test17_engineHydratesCatalystAndSubtype();
  test18_engineFiresShadowFunnels();
  test19_distributionSchemaSubtype();
  test20_earningsSurpriseSchemaTiming();
  test21_classifierGuidanceStillFires();
  console.log(`\n──────── ${passed} passed · ${failed} failed ────────\n`);
  if (failed > 0) {
    console.log("Failed tests:");
    for (const f of failures) console.log(`  • ${f.name}${f.detail ? " — " + f.detail : ""}`);
    process.exit(1);
  }
}

run();
