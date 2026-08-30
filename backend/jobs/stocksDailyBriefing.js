// backend/jobs/stocksDailyBriefing.js
//
// Server-side daily briefing job. Runs 24/7 on the Curriculate backend
// (no dependence on Cowork being open on Richard's laptop).
//
// Schedule: 7:30 AM Eastern, weekdays (set via STOCKS_BRIEFING_CRON env).
//
// For each user with a stored portfolio + risk tolerance:
//   1. Build a portfolio summary
//   2. Call Anthropic Messages API with web_search tool → get briefing markdown
//   3. Save actionable recs to StocksAdviceRec for the scorecard
//   4. Convert markdown → HTML and email via Resend
//
// Required env:
//   ANTHROPIC_API_KEY       — for AI briefing generation
//   RESEND_API_KEY          — already set
//   STOCKS_BRIEFING_CRON    — optional, default "30 7 * * 1-5" (NY-local interpreted)
//   STOCKS_BRIEFING_FROM    — optional, default "Stocks Advisor <noreply@curriculate.net>"
//   STOCKS_BRIEFING_ENABLED — set to "1" to enable. Off by default for safety.

import cron from "node-cron";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksSystemHeartbeat from "../models/StocksSystemHeartbeat.js";
import { writeDailySnapshot } from "../routes/stocksPortfolio.js";
import { getRealtimeQuote } from "../services/stocksIntradayFmp.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksAdviceSnapshot from "../models/StocksAdviceSnapshot.js";
import StocksBriefingHistory from "../models/StocksBriefingHistory.js";
import { runDisciplineCritic, formatCriticBanner } from "../services/stocksDisciplineCritic.js";
import { getTechnicals, formatTechnicalsLine } from "../services/stocksTechnicals.js";
import { getFundamentals, formatFundamentalsLine } from "../services/stocksFundamentals.js";
import { getCatalysts, formatCatalystsLine } from "../services/stocksCatalystsFmp.js";
import { getShortInterest, formatShortInterestLine } from "../services/stocksShortInterest.js";
import { enrichRecsWithExitDefaults, insertAutoSellTrail } from "../services/stocksRecTrail.js";
import { generateDailyPicksForUser, getPickEngineStatus } from "../services/stocksDailyPickEngine.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import { getSectorRotation, formatSectorRotationBlock, formatSectorTiltLine, getSectorLaggards, computeSectorTransitions, formatSectorTransitionLine, formatPerHoldingSectorMap } from "../services/stocksSectorRotation.js";
import { computeCorrelations, formatCorrelationBlock } from "../services/stocksPortfolioCorrelation.js";
import { getFedLiquidity, formatFedLiquidityBlock } from "../services/stocksFedLiquidity.js";
import { getCongressionalTradesForTickers, formatCongressionalBlock } from "../services/stocksCongressional.js";
import { getLatestWhaleFilings, format13FBlock } from "../services/stocks13F.js";
import { getOptionsMetrics, formatOptionsLine } from "../services/stocksOptionsMetrics.js";
import { monitorPositionStops, formatPositionStopBlock } from "../services/stocksPositionStopMonitor.js";
import { computeSleeveBalance, formatSleeveBalanceBlock, classifyPosition } from "../services/stocksSleeveEnforcer.js";
import { validateRecs, buildValidatorContext, fetchLivePricesForRecs, computeUserExpectancy, fetchLiquidityForRecs } from "../services/stocksRecValidator.js";
import { computeCalibration, formatCalibrationBlock } from "../services/stocksScoreCalibration.js";
import { computeHorizonReview, formatHorizonReviewBlock } from "../services/stocksHorizonReview.js";
import { computeTwrr } from "../services/stocksTwrr.js";
import { computeBenchmarkReturns, formatBenchmarkBlock } from "../services/stocksBenchmark.js";
import { computeSizingAdjustments, formatSizingAdjustmentBlock } from "../services/stocksCorrelationSizing.js";
import { computeOverlaySuggestions, formatOverlayBlock, formatOverlayFunnelForEmail } from "../services/stocksOptionsOverlay.js";
import { computeOptimalSize, formatSizingBlock, getSetupExpectancyMap } from "../services/stocksPositionSizing.js";
import { computePyramidingSignals, formatPyramidingBlock } from "../services/stocksPyramidingMonitor.js";
import { computeTradingRegime, formatTradingRegimeBlock } from "../services/stocksTradingRegime.js";
import { scanUnusualOptionsFlow, formatUnusualOptionsBlock } from "../services/stocksUnusualOptionsFlow.js";
import { computePortfolioVar, computeLossCooldown, formatRiskBudgetBlock } from "../services/stocksRiskBudget.js";
import { computeCompliance, formatComplianceBlock } from "../services/stocksCompliance.js";
import { computeAttribution, formatAttributionBlock } from "../services/stocksAttribution.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import { getMacroContext, formatMacroBlock } from "../services/stocksMacroContext.js";
import { getMacroFred, formatMacroFredBlock } from "../services/stocksMacroFred.js";
import { getInsiderSignalsForUser, formatInsiderSignalsBlock } from "../services/stocksInsiderSignals.js";
import { getOptionsFlowForUser, formatOptionsFlowBlock } from "../services/stocksOptionsFlow.js";
import { computeLifecycle, formatLifecycleBlock } from "../services/stocksLifecycle.js";
import { computeFactorTilts, formatFactorBlock } from "../services/stocksFactorAnalysis.js";
import { computeLessons, formatLessonsBlock } from "../services/stocksLessonsLearned.js";
import { computeDeterministicFactors, deterministicComposite, fetchYahooDaily } from "../services/stocksDiscoveryScore.js";
import { computeMarketPulse, formatMarketPulseBlock } from "../services/stocksMarketPulse.js";

// Lazy dynamic import for the four validators — routes/stocksAdvice.js also
// imports from THIS file (generateBriefing, emailBriefing, etc), so a static
// `import` would create a circular dependency that some Node versions handle
// fragilely at boot. Loading on first use breaks the cycle cleanly.
let _validatorsPromise = null;
function getBriefingValidators() {
  if (!_validatorsPromise) {
    _validatorsPromise = import("../routes/stocksAdvice.js").then((m) => ({
      validateTextPrices: m.validateTextPrices,
      correctBriefingWithVerifiedPrices: m.correctBriefingWithVerifiedPrices,
      validateRecSizing: m.validateRecSizing,
      buildTickerCurrencyHints: m.buildTickerCurrencyHints,
    })).catch((e) => {
      console.warn("[stocks-briefing] validator import failed:", e?.message);
      return { validateTextPrices: null, correctBriefingWithVerifiedPrices: null, validateRecSizing: null, buildTickerCurrencyHints: null };
    });
  }
  return _validatorsPromise;
}

// Shared validation + correction pass for a briefing markdown. Used by both
// the one-shot runDailyBriefing (admin) AND the per-minute sendBriefingForUser
// (cron) — previously only the manual path had it. Never throws; returns the
// (possibly-corrected, possibly-banner-prepended) markdown.
// Independent post-generation audit — routes the finished briefing
// through a small OpenAI model (gpt-4o-mini) against a strict rubric
// (unjustified TRIM, unknown ticker, price >10% off, contradicts
// yesterday, liquidation card on held ticker). If violations exist,
// prepends an amber banner. Never throws; never blocks. Gated by
// STOCKS_CRITIC_ENABLED=1 + OPENAI_API_KEY.
async function auditBriefingWithCritic(md, portfolio) {
  // Per-user opt-in. The deploy-level STOCKS_CRITIC_ENABLED gate
  // inside runDisciplineCritic is still respected — this just adds
  // a second, per-user knob so different users on the same deploy
  // can independently opt in or out.
  //
  // Returns { markdown, violations }. Callers persist violations on the
  // briefing-history row (for compliance trend + next-briefing feedback)
  // and use the possibly-bannered markdown for send + snapshot.
  if (!portfolio?.disciplineCriticEnabled) return { markdown: md, violations: [] };
  try {
    let previousCalls = "";
    try {
      const prior = await StocksBriefingHistory.find({ email: portfolio.email.toLowerCase() })
        .sort({ generatedAt: -1 }).limit(1).lean();
      previousCalls = prior?.[0]?.callsExcerpt || "";
    } catch { /* best-effort */ }
    let horizonRows = [];
    try {
      horizonRows = await computeHorizonReview(portfolio.email);
    } catch { /* best-effort */ }
    const { violations, skipped } = await runDisciplineCritic({
      markdown: md,
      holdings: portfolio.positions || [],
      horizonRows,
      previousCalls,
    });
    if (skipped) return { markdown: md, violations: [] };
    if (!violations.length) return { markdown: md, violations: [] };
    console.log(`[discipline-critic] ${portfolio.email}: ${violations.length} violation(s) flagged`);
    return { markdown: formatCriticBanner(violations) + md, violations };
  } catch (e) {
    console.warn("[discipline-critic] wrapper failed:", e?.message);
    return { markdown: md, violations: [] };
  }
}

async function validateAndCorrectBriefing(md, portfolio) {
  const v = await getBriefingValidators();
  if (!v.validateTextPrices) return md; // validators unavailable — send as-is
  let priceWarnings = [];
  let sizingWarnings = [];
  try {
    const ccyHints = v.buildTickerCurrencyHints(portfolio.positions);
    priceWarnings = await v.validateTextPrices(md, ccyHints);
  } catch (e) { console.warn("[stocks-briefing] validateTextPrices warn:", e?.message); }
  try { sizingWarnings = v.validateRecSizing(md, portfolio); } catch (e) { console.warn("[stocks-briefing] validateRecSizing warn:", e?.message); }

  if (!priceWarnings.length && !sizingWarnings.length) return md;

  console.log(`[stocks-briefing] correction pass for ${portfolio.email}: ${priceWarnings.length} price + ${sizingWarnings.length} sizing`);
  let corrected = null;
  try { corrected = await v.correctBriefingWithVerifiedPrices(md, priceWarnings, sizingWarnings); } catch (e) { console.warn("[stocks-briefing] correction failed:", e?.message); }
  if (corrected && corrected !== md) return corrected;

  // Fail-LOUD: banner so an unverified briefing never goes out looking verified.
  const flagged = [...new Set((priceWarnings || []).map((w) => w?.ticker).filter(Boolean))];
  const banner = `> ⚠️ **Price-validation banner:** automatic price-correction did not complete for this briefing. Independently verify any live price before acting${flagged.length ? ` (flagged tickers: ${flagged.join(", ")})` : ""}. The numeric "verified" tags below were NOT confirmed against the live feed for this run.\n\n`;
  return banner + md;
}
import { getTranscriptsForTopHoldings, formatTranscriptsBlock } from "../services/stocksEarningsTranscripts.js";
import { buildAllAccountReports, formatAllReportsMarkdown, formatAccountReportMarkdown, isLastTradingDayOfMonth } from "../services/stocksMonthlyReport.js";
import { auditBriefingBeforeSend, summarizeAuditFailure } from "../services/briefingAudit.js";
import { computeCanonicalPortfolio } from "../services/portfolioCalcEngine.js";
import { formatUpswitchBlock as formatUpswitchBlockImpl } from "../services/stocksUpswitch.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";

// Pull the user's starred discovery candidates and format them as a
// "WATCH LIST" block for the AI advice/briefing prompts. The AI is told
// to comment on each starred name alongside portfolio holdings — closes
// the loop from Discover → Advice so flagged ideas get tracked over time.
export async function buildStarredWatchListBlock(email) {
  try {
    const starred = await StocksDiscoveryCandidate
      .find({ email: email.toLowerCase(), starred: true, dismissed: { $ne: true } })
      .sort({ scanDate: -1 })
      .limit(10)
      .lean();
    if (starred.length === 0) return "";
    const lines = starred.map((c) => {
      const tgt = c.thesis?.priceTarget ? ` target $${c.thesis.priceTarget.toFixed(2)}` : "";
      const conv = c.thesis?.conviction ? ` (${c.thesis.conviction} conviction)` : "";
      const summary = (c.thesis?.bullCase || "").slice(0, 120);
      return `  - ${c.ticker}${conv}${tgt} — ${summary}`;
    });
    return `\nUSER-STARRED WATCH LIST (Discover candidates the user has flagged — comment on each in your briefing/advice alongside portfolio holdings; flag any that have hit their target or invalidated their thesis):\n${lines.join("\n")}\n`;
  } catch (e) {
    return "";
  }
}

// Shared current-price fetcher (server-side; no CORS) — used by the
// open-recommendation monitor below.
async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate)" } });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

// Infer a rec's native currency (Canadian suffix is decisive; else an explicit
// "$NN CAD/USD" near the price). Null → model default (USD) applies on save.
function detectRecCurrency(text, ticker) {
  if (/\.(TO|V|NE|CN)$/i.test(ticker || "")) return "CAD";
  const m = (text || "").match(/\$\s*[\d.,]+(?:\s*[-–]\s*\$?\s*[\d.,]+)?\s*(CAD|USD)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Exchange symbol to quote a stored rec on: CAD recs → .TO so target/stop
// alerts are checked on the right market, not the US ADR.
function recSymbol(rec) {
  const t = String(rec?.ticker || "").toUpperCase();
  if (t.includes(".")) return t;
  return rec?.entryCurrency === "CAD" ? `${t}.TO` : t;
}

// ─────────────────────────────────────────────────────────────────────
// Monitor every still-open AI rec for this user. For each rec, check
// whether the live price has crossed its target or stop. Update the
// rec's status in Mongo and return an array of alert strings (markdown)
// that the briefing will prepend to the AI-generated body.
//
// Direction-aware:
//   BUY  : target hit when price ≥ target ; stop hit when price ≤ stop
//   SELL/TRIM : target hit when price ≤ target ; stop hit when price ≥ stop
// ─────────────────────────────────────────────────────────────────────
export async function monitorOpenRecs(email) {
  const openRecs = await StocksAdviceRec.find({ email, status: "open" }).lean();
  if (openRecs.length === 0) return { alerts: [], hits: 0, inRange: 0 };

  // De-dupe and fetch one price per resolved exchange symbol — a CAD rec
  // (entryCurrency "CAD") must be checked on its TSX listing (ENB → ENB.TO),
  // not the US ADR, or target/stop alerts fire on the wrong market.
  const symbols = [...new Set(openRecs.map(r => recSymbol(r)))];
  const priceMap = {};
  await Promise.all(symbols.map(async sym => { priceMap[sym] = await fetchCurrentPrice(sym); }));

  // Load recent BUY trade legs so we can silence recs superseded by a
  // fresh purchase. Common case: an old MSFT rec's stop of $370 was hit
  // weeks ago (rec correctly went "stop-hit"). Then the user re-entered
  // MSFT at $398 on a fresh rec. Or the rec somehow stayed "open" while
  // a fresh position was taken. Either way, alerting "MSFT hit stop"
  // when the trader just bought is nonsense — the old stop is stale
  // relative to the current position.
  const recentBuysByBase = new Map();
  try {
    const cutoff = new Date(Date.now() - 90 * 86400000);
    const journal = await StocksTradeJournal.find({
      email,
      executedAt: { $gte: cutoff },
      "legs.side": "BUY",
    }).select({ executedAt: 1, legs: 1 }).lean();
    const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    for (const t of journal) {
      for (const leg of t.legs || []) {
        if (leg.side !== "BUY" || !leg.ticker) continue;
        const k = baseOf(leg.ticker);
        const prior = recentBuysByBase.get(k);
        if (!prior || new Date(t.executedAt) > prior.date) {
          recentBuysByBase.set(k, { date: new Date(t.executedAt), price: leg.pricePerShare, currency: leg.currency });
        }
      }
    }
  } catch (e) { console.warn("[monitorOpenRecs] journal load warn:", e?.message); }

  const targetAlerts = [];
  const stopAlerts = [];
  const stopHitRecs = [];
  const updates = [];
  const supersededIds = [];
  let inRangeCount = 0;
  const now = new Date();
  const baseTicker = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");

  for (const rec of openRecs) {
    const px = priceMap[recSymbol(rec)];
    if (px == null) continue;

    // Supersession check — only applies to BUY-side recs. If a fresh
    // BUY on the same base ticker executed AFTER this rec was
    // generated AT A PRICE ABOVE this rec's stop, this rec's stop is
    // definitionally stale: the trader has already bought back higher.
    if (rec.action === "BUY") {
      const freshBuy = recentBuysByBase.get(baseTicker(rec.ticker));
      const recDate = rec.generatedAt ? new Date(rec.generatedAt) : null;
      if (
        freshBuy && recDate &&
        freshBuy.date > recDate &&
        rec.stopPrice != null &&
        Number.isFinite(freshBuy.price) &&
        freshBuy.price > rec.stopPrice
      ) {
        supersededIds.push(rec._id);
        updates.push({ id: rec._id, set: { status: "expired", hitAt: now, lastCheckedAt: now, lastCheckedPrice: px, exitLevelsFilledBy: "atr-defaults" } });
        continue; // no alert
      }
    }

    let targetHit = false;
    let stopHit = false;
    if (rec.action === "BUY") {
      if (rec.targetPrice != null && px >= rec.targetPrice) targetHit = true;
      else if (rec.stopPrice != null && px <= rec.stopPrice) stopHit = true;
    } else if (rec.action === "SELL" || rec.action === "TRIM") {
      if (rec.targetPrice != null && px <= rec.targetPrice) targetHit = true;
      else if (rec.stopPrice != null && px >= rec.stopPrice) stopHit = true;
    }

    const ccyMarker = rec.entryCurrency === "CAD" ? "CAD" : "USD";
    const dateStr = new Date(rec.generatedAt).toISOString().slice(0, 10);

    if (targetHit) {
      updates.push({ id: rec._id, set: { status: "target-hit", hitAt: now, hitPrice: px, lastCheckedAt: now, lastCheckedPrice: px } });
      // Auto-emit a companion SELL rec so the BUY→SELL trail is complete
      // in the /advice history — no orphan BUYs marked "target-hit" with
      // no persisted exit action.
      if (rec.action === "BUY") {
        await insertAutoSellTrail({ buyRec: rec, hitPrice: px, hitAt: now, reason: "target-hit" });
      }
      const dir = rec.action === "BUY" ? "above target" : "below target";
      const exit = rec.action === "BUY" ? "Consider TRIMming to lock in gains." : "Consider re-entering the position.";
      targetAlerts.push(
        `🎯 **${rec.ticker} hit target.** Rec from ${dateStr}: ${rec.action} ${rec.shares || ""} sh @ $${rec.entryPrice} → target $${rec.targetPrice}. Current $${px.toFixed(2)} ${ccyMarker} (${dir}). ${exit}`
      );
    } else if (stopHit) {
      updates.push({ id: rec._id, set: { status: "stop-hit", hitAt: now, hitPrice: px, lastCheckedAt: now, lastCheckedPrice: px } });
      if (rec.action === "BUY") {
        await insertAutoSellTrail({ buyRec: rec, hitPrice: px, hitAt: now, reason: "stop-hit" });
      }
      // SEMANTIC FIX: a SELL/EXIT/TRIM rec on an existing long is NOT
      // an open short — it's an exit. Stops on exit-side recs are
      // "if price rebounds back above X, exit didn't fill and we're
      // still in the position" markers, not short-position stops.
      // Prior wording "cover / re-evaluate the SHORT thesis" would
      // trigger even for a plain SELL on a long. Only tag as a short
      // when the rec was explicitly a SELL_SHORT / OPEN_SHORT action.
      const isBuy = rec.action === "BUY";
      const isExitOnLong = ["SELL", "EXIT", "TRIM"].includes(String(rec.action).toUpperCase());
      const isShortOpen = ["SELL_SHORT", "OPEN_SHORT", "SHORT"].includes(String(rec.action).toUpperCase());
      let exit;
      if (isBuy) {
        exit = `Thesis invalidated. **SELL the position** at market unless you have a high-conviction reason to override.`;
      } else if (isShortOpen) {
        exit = `Position is moving against you. **Cover / re-evaluate the SHORT thesis** now.`;
      } else if (isExitOnLong) {
        exit = `The exit-side rec's stop level was crossed on the way back up. The exit did NOT open a short position; treat this as informational — reassess whether to re-enter the long or leave it flat.`;
      } else {
        exit = `Stop crossed. Reassess the position.`;
      }
      stopAlerts.push(
        `🛑 **${rec.ticker} hit stop.** Rec from ${dateStr}: ${rec.action} @ $${rec.entryPrice} with stop $${rec.stopPrice}. Current $${px.toFixed(2)} ${ccyMarker}. ${exit}`
      );
      // Structured record so the §1 renderer can cross-check against
      // held positions and emit a concrete SELL AT MARKET mandate for
      // any actually-held ticker that a stop-hit rec names. Grok Aug 5
      // audit: ENB stop-hit alert lived only in §3 — if a position
      // exists it belongs in §1 mandatory.
      stopHitRecs.push({
        ticker: rec.ticker,
        base: baseTicker(rec.ticker),
        action: rec.action,
        entryPrice: rec.entryPrice,
        stopPrice: rec.stopPrice,
        currentPrice: px,
        currency: ccyMarker,
      });
    } else {
      updates.push({ id: rec._id, set: { lastCheckedAt: now, lastCheckedPrice: px } });
      inRangeCount++;
    }
  }

  // Best-effort writeback
  if (updates.length) {
    await Promise.all(
      updates.map(u => StocksAdviceRec.updateOne({ _id: u.id }, { $set: u.set }).catch(() => null))
    );
  }

  const alerts = [...stopAlerts, ...targetAlerts]; // stops first — more urgent
  return { alerts, hits: alerts.length, inRange: inRangeCount, stopHitRecs };
}

// Lightweight markdown → HTML for email bodies, with a second pass that
// recognises briefing-specific patterns (trade recs, order tickets, etc.)
// and applies real visual structure.
export function md2html(md) {
  if (!md) return "";
  // Strip the machine-parseable rec block before HTML rendering — the
  // block belongs in persisted markdown for parseRecsFromBriefing, not
  // in the human-readable email/card.
  let h = stripRecsBlock(md)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // headings — visually distinct h2 / h3 with separators
  h = h.replace(/^######\s+(.+)$/gm, "<h6 style='margin:18px 0 6px;font-size:13px;color:#0b1220'>$1</h6>")
       .replace(/^#####\s+(.+)$/gm, "<h5 style='margin:18px 0 6px;font-size:14px;color:#0b1220'>$1</h5>")
       .replace(/^####\s+(.+)$/gm, "<h4 style='margin:20px 0 8px;font-size:15px;color:#0b1220'>$1</h4>")
       .replace(/^###\s+(.+)$/gm, "<h3 style='margin:22px 0 10px;font-size:16px;font-weight:600;color:#0b1220'>$1</h3>")
       .replace(/^##\s+(.+)$/gm, "<h2 style='margin:30px 0 12px;font-size:19px;font-weight:700;color:#0b1220;letter-spacing:-.01em;padding-bottom:8px;border-bottom:2px solid #e4e8ef'>$1</h2>")
       .replace(/^#\s+(.+)$/gm, "<h1 style='margin:24px 0 14px;font-size:22px;font-weight:700;color:#0b1220'>$1</h1>");
  // bold / italic / code
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
       .replace(/`([^`]+)`/g, "<code style='background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:90%;font-family:SF Mono,Menlo,Consolas,monospace'>$1</code>");
  // links — allowlist safe schemes and neutralize attribute-breaking quotes
  // so a javascript: URL or a stray ' in a web-search-derived link can't
  // inject markup if this HTML is ever rendered outside the sandboxed iframe.
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    const u = String(url).trim();
    const safe = /^(https?:|mailto:)/i.test(u) ? u.replace(/'/g, "%27") : "#";
    return `<a href='${safe}' style='color:#1d4ed8;text-decoration:none'>${text}</a>`;
  });
  // tables
  h = h.replace(/((?:^\|.*\|\s*\n)+)/gm, (block) => {
    const rows = block.trim().split("\n").map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    if (rows.length < 2) return block;
    const [header, sep, ...body] = rows;
    if (!sep || !sep.every((c) => /^[-: ]+$/.test(c))) return block;
    const th = header.map((c) => `<th style='text-align:left;border-bottom:2px solid #e4e8ef;padding:10px 12px;font-size:11px;color:#7a8499;text-transform:uppercase;letter-spacing:.06em;font-weight:600'>${c}</th>`).join("");
    const tr = body.map((r) => `<tr>${r.map((c) => `<td style='border-bottom:1px solid #f1f5f9;padding:10px 12px;font-variant-numeric:tabular-nums'>${c}</td>`).join("")}</tr>`).join("");
    return `<table style='border-collapse:collapse;width:100%;margin:16px 0;font-size:13px'><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  });
  // unordered lists
  h = h.replace(/(?:^- .+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split("\n").map((l) => l.replace(/^-\s+/, "")).map((i) => `<li style='margin:6px 0'>${i}</li>`).join("");
    return `<ul style='margin:10px 0;padding-left:24px;color:#374151'>${items}</ul>`;
  });
  // paragraphs (blank-line separated)
  h = h.split(/\n{2,}/).map((b) => {
    if (b.match(/^<(h[1-6]|ul|table|p|div|hr)/i)) return b;
    return `<p style='margin:10px 0;line-height:1.65;color:#1f2937'>${b.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  // ─── PRETTIFY pass: recognise briefing patterns and apply real structure ───
  h = prettifyBriefing(h);
  return h;
}

// Briefing-specific HTML prettifier. Looks for known textual patterns the AI
// emits inside <p> blocks and rewrites them into visually structured blocks:
//   • Action: BUY/SELL/TRIM ... → header card with colored side badge
//   • Order ticket: ...         → monospaced blue block
//   • After fill: ...           → monospaced amber block
//   • Source: ...               → small muted line
//   • Cost note: ...            → small muted line
// Each "Action:" starts a new trade-rec card; subsequent Order/After/Source/
// Cost lines that follow within the same <p> are pulled into the card.
function prettifyBriefing(html) {
  // First, split paragraphs that contain multiple Action: lines so each rec
  // gets its own block. (The AI sometimes packs several into one paragraph.)
  html = html.replace(/<p ([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, inner) => {
    // Split inner at "Action: " boundaries while preserving the marker
    const parts = inner.split(/(?=Action:\s*(?:BUY|SELL|TRIM|HOLD))/i);
    if (parts.length <= 1) return match;
    return parts.map(p => p.trim() ? `<p ${attrs}>${p.trim()}</p>` : "").join("\n");
  });

  // Now process each <p> that starts with "Action:" — render as a rec card.
  html = html.replace(/<p [^>]*>(\s*Action:\s*(BUY|SELL|TRIM|HOLD)[\s\S]*?)<\/p>/gi, (m, body, side) => {
    const sideUp = side.toUpperCase();
    const palette =
      sideUp === "BUY"
        ? { bg: "#ecfdf5", border: "#bbf7d0", text: "#065f46", badge: "#059669" }
        : sideUp === "SELL" || sideUp === "TRIM"
          ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", badge: "#dc2626" }
          : { bg: "#fffbeb", border: "#fde68a", text: "#92400e", badge: "#b45309" };

    // Extract the Action line itself plus any extra labeled fields that follow.
    const lines = body.replace(/<br\s*\/?>/g, "\n").split(/\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      // Action: header
      const mA = line.match(/^Action:\s*(BUY|SELL|TRIM|HOLD)\s*(\d[\d,]*)?\s*(?:sh)?\s*([A-Z][A-Z0-9.\-]{0,15})\b\.?\s*(.*)$/i);
      if (mA) {
        const [, action, shares, ticker, rest] = mA;
        out.push(`
          <div style="margin-top:6px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
            <span style="background:${palette.badge};color:#fff;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em">${action.toUpperCase()}</span>
            <span style="font-size:16px;font-weight:700;color:#0b1220">${shares ? shares + " sh " : ""}${ticker.toUpperCase()}</span>
          </div>
          <div style="color:${palette.text};font-size:13px;margin-top:6px;line-height:1.55">${rest || ""}</div>`);
        continue;
      }
      if (/^Order ticket:/i.test(line)) {
        out.push(`<div style="margin-top:10px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-family:SF Mono,Menlo,Consolas,monospace;font-size:12px;color:#1e3a8a"><b style="font-family:inherit;font-size:10px;letter-spacing:.06em;color:#1d4ed8">📋 ORDER TICKET</b><br>${line.replace(/^Order ticket:\s*/i, "")}</div>`);
        continue;
      }
      if (/^After fill:/i.test(line)) {
        out.push(`<div style="margin-top:6px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-family:SF Mono,Menlo,Consolas,monospace;font-size:12px;color:#78350f"><b style="font-family:inherit;font-size:10px;letter-spacing:.06em;color:#b45309">🛡 AFTER FILL</b><br>${line.replace(/^After fill:\s*/i, "")}</div>`);
        continue;
      }
      if (/^Source:/i.test(line)) {
        out.push(`<div style="margin-top:8px;font-size:11.5px;color:#6b7280"><b style="color:#374151">Source:</b> ${line.replace(/^Source:\s*/i, "")}</div>`);
        continue;
      }
      if (/^Account:/i.test(line)) {
        // Account: RRSP · uses $X of $Y CCY available · leaves $Z
        // Render the account name as a colored pill, the rest as muted detail.
        const rest = line.replace(/^Account:\s*/i, "");
        const acctMatch = rest.match(/^([A-Za-z][A-Za-z0-9\s\-]{0,30})/);
        const acctName = acctMatch ? acctMatch[1].trim() : "";
        const detail = acctName ? rest.slice(acctMatch[1].length).replace(/^[\s·•|-]+/, "") : rest;
        out.push(`<div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11.5px;color:#6b7280">${acctName ? `<span style="display:inline-block;background:#eef2ff;color:#3730a3;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600">${acctName}</span>` : ""}<span>${detail}</span></div>`);
        continue;
      }
      if (/^Cost note:/i.test(line) || /^Cost:/i.test(line)) {
        out.push(`<div style="margin-top:2px;font-size:11.5px;color:#6b7280"><b style="color:#374151">Cost:</b> ${line.replace(/^(Cost note|Cost):\s*/i, "")}</div>`);
        continue;
      }
      if (/^Rationale[^:]*:/i.test(line)) {
        out.push(`<div style="margin-top:8px;padding:8px 12px;background:rgba(255,255,255,0.6);border-left:3px solid ${palette.badge};border-radius:4px;font-size:12px;color:#374151;font-style:italic">${line.replace(/^Rationale[^:]*:\s*/i, "")}</div>`);
        continue;
      }
      if (/^Tax-fit:/i.test(line)) {
        out.push(`<div style="margin-top:4px;font-size:11.5px;color:#6b7280"><b style="color:#374151">Tax fit:</b> ${line.replace(/^Tax-fit:\s*/i, "")}</div>`);
        continue;
      }
      // Fall-through: plain prose inside the card
      out.push(`<div style="margin-top:6px;font-size:13px;line-height:1.6;color:#1f2937">${line}</div>`);
    }

    return `<div style="margin:14px 0;padding:14px 16px;background:${palette.bg};border:1px solid ${palette.border};border-left:4px solid ${palette.badge};border-radius:10px">${out.join("")}</div>`;
  });

  // Highlight the open-rec alerts at the top (🎯 target, 🛑 stop)
  html = html.replace(/<li[^>]*>(🎯[^<]*)<\/li>/g, `<li style="margin:8px 0;padding:8px 12px;background:#ecfdf5;border-left:3px solid #059669;border-radius:6px;list-style:none">$1</li>`);
  html = html.replace(/<li[^>]*>(🛑[^<]*)<\/li>/g, `<li style="margin:8px 0;padding:8px 12px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;list-style:none">$1</li>`);

  // Color-code h2 section headers by emoji / keyword so the eye finds
  // open alerts vs cash deployment vs new ideas without reading.
  html = html.replace(/<h2 ([^>]*?)>([\s\S]*?)<\/h2>/g, (m, attrs, inner) => {
    const txt = inner.replace(/<[^>]+>/g, "");
    let accent = "#1d4ed8"; // default blue
    let bg = "linear-gradient(90deg,#eef2ff 0%,#fafbff 100%)";
    if (/🚨|alert/i.test(txt)) { accent = "#dc2626"; bg = "linear-gradient(90deg,#fef2f2 0%,#fff 100%)"; }
    else if (/💵|cash deployment/i.test(txt)) { accent = "#059669"; bg = "linear-gradient(90deg,#ecfdf5 0%,#fff 100%)"; }
    else if (/today.?s.{0,5}action/i.test(txt)) { accent = "#7c3aed"; bg = "linear-gradient(90deg,#f5f3ff 0%,#fff 100%)"; }
    else if (/signals/i.test(txt)) { accent = "#0891b2"; bg = "linear-gradient(90deg,#ecfeff 0%,#fff 100%)"; }
    else if (/performance|snapshot/i.test(txt)) { accent = "#0284c7"; bg = "linear-gradient(90deg,#f0f9ff 0%,#fff 100%)"; }
    else if (/watch/i.test(txt)) { accent = "#ea580c"; bg = "linear-gradient(90deg,#fff7ed 0%,#fff 100%)"; }
    else if (/aggressive|new ideas/i.test(txt)) { accent = "#9333ea"; bg = "linear-gradient(90deg,#faf5ff 0%,#fff 100%)"; }
    else if (/overnight|pre-?market/i.test(txt)) { accent = "#4f46e5"; bg = "linear-gradient(90deg,#eef2ff 0%,#fff 100%)"; }
    return `<h2 style='margin:32px 0 14px;font-size:18px;font-weight:700;color:#0b1220;letter-spacing:-.01em;padding:12px 16px;background:${bg};border-left:5px solid ${accent};border-radius:6px 6px 0 0'>${inner}</h2>`;
  });

  // Recognize per-account sub-headers ("**TFSA — $2,300 CAD · $0 USD**" emitted
  // by the cash-deployment block) and render with an account chip.
  html = html.replace(/<p ([^>]*)>(\s*<strong>([A-Za-z][A-Za-z0-9\s\-]{1,30}?)\s*[—–-]\s*([^<]+)<\/strong>\s*)<\/p>/g,
    (m, attrs, full, acct, detail) => {
      return `<div style="margin:16px 0 8px;padding:10px 14px;background:#eef2ff;border-radius:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline">
        <span style="background:#4f46e5;color:#fff;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em">${acct.trim().toUpperCase()}</span>
        <span style="font-size:14px;color:#3730a3;font-weight:600">${detail.trim()}</span>
      </div>`;
    });

  return html;
}

// Phase 3+ retrofit: portfolioSummary is now a thin adapter over the
// canonical portfolio calculation engine. Same return shape (callers
// keep working) but every number traces to computeCanonicalPortfolio —
// no more local weight math that could disagree with the audit gate,
// alpha dashboard, or Health tab.
export function portfolioSummary(profile) {
  const canonical = computeCanonicalPortfolio(profile);
  const fx = profile.fxUsdCad || 1.37;

  if (!canonical) {
    return {
      total: 0, table: "", cashUsd: 0, cashCad: 0, cashCadEquiv: 0,
      perAccountCash: [], canonical: null,
    };
  }

  // Aggregate canonical positions by ticker for the display table
  // (same ticker in different accounts merges — matches legacy
  // display behavior). Native currency + native price come from the
  // first canonical position for that ticker in the sorted list.
  const byTicker = new Map();
  for (const pos of canonical.positions) {
    const key = pos.ticker;
    if (!byTicker.has(key)) {
      byTicker.set(key, {
        ticker: key,
        qty: 0,
        cad: 0,
        pct: 0,
        ccy: pos.currency,
        price: pos.price,
      });
    }
    const agg = byTicker.get(key);
    agg.qty += pos.qty || 0;
    agg.cad += pos.cad_value || 0;
    agg.pct += pos.position_weight_pct || 0;
  }
  const rows = [...byTicker.values()].sort((a, b) => b.cad - a.cad);

  // Total = book equity (positions only), matches the legacy
  // semantics of summary.total — cash lives in cashCadEquiv.
  const total = canonical.totals.book_cad;

  // Per-account cash strings — same format as before.
  const perAccountCash = [];
  for (const a of profile.accounts || []) {
    if ((a.cashUsd || 0) > 0 || (a.cashCad || 0) > 0) {
      perAccountCash.push(`  ${a.name}: $${(a.cashCad || 0).toFixed(0)} CAD, $${(a.cashUsd || 0).toFixed(0)} USD`);
    }
  }

  return {
    total,
    table: rows.map(r => {
      const pxStr = r.price ? `@ $${r.price.toFixed(2)} ${r.ccy}` : "";
      // Weight denominator is portfolio_total (positions+cash) per
      // canonical engine — makes cash-inclusive vs cash-exclusive
      // weights consistent across every section.
      return `${r.ticker} (${r.ccy}): ${r.qty.toLocaleString()} sh ${pxStr} ≈ $${Math.round(r.cad).toLocaleString()} CAD (${r.pct.toFixed(1)}%)`;
    }).join("\n"),
    cashUsd: canonical.cash.cash_usd_raw,
    cashCad: canonical.cash.cash_cad_raw,
    cashCadEquiv: canonical.cash.cash_cad_equiv,
    perAccountCash,
    // Attach the full canonical object so downstream code (validators,
    // audit, structured reports) can pull authoritative fields without
    // recomputing.
    canonical,
    fxUsdCad: fx,
  };
}

// Signals checklist — what the AI MUST web_search for and incorporate
const SIGNALS_CHECKLIST = `
Mandatory signals to search and weigh for EACH top-holding before writing recs.
Use web_search — don't guess. If a signal isn't found, say "no signal", don't skip.

A. NEWS (24h): breaking corporate news, M&A, regulatory action, lawsuits, product/partnership announcements, CEO/leadership changes.
B. PERIODIC REPORTING: next earnings date (≤14d = high-attention, flag it); most-recent revenue/EPS vs consensus (beat/miss/in-line); guidance change; call-commentary highlights.
C. CORPORATE ACTIONS: ex-dividend dates ≤14d; dividend raises/cuts/suspensions; splits, buybacks, special distributions; spin-offs/mergers/tender offers.
D. ANALYST ACTION: upgrades/downgrades in last 7d from top-tier shops (Goldman, JPM, MS, Wells, BofA, Wedbush, Piper Sandler); PT changes >10%; initiation of coverage.
E. INSIDER + OWNERSHIP: Form 4 filings ≤30d (flag clusters); 13F swings (Berkshire, Burry, etc.); short-interest changes (>20% of float = signal, rising short = pressure).
F. TECHNICAL / FLOW (web_search Finviz / StockAnalysis / TradingView): 50/200-day MAs (price vs MA, recent golden/death cross); RSI <30 oversold or >70 overbought; unusual options flow (large call/put sweeps); volume spikes vs 20d average.
G. MACRO: Fed/BoC rate decisions or commentary today; oil moves (ENB, SU, CNQ); USD/CAD daily move (any USD holding); VIX level (>20 elevated, >25 risk-off).

Each top-7 holding must NAME at least one specific signal from A-G that informs the BUY/HOLD/TRIM/SELL call. No generic prose — cite the actual signal.

Cross-reference insider transactions (INSIDER TRANSACTIONS block) and options flow (OPTIONS FLOW block) against the per-holding signals — a cluster buy PLUS unusual call volume PLUS positive sector rotation is a much stronger conviction signal than any one alone. Say so explicitly when two or more of these align on the same ticker.
`;

// Canadian tax + account-placement guidance — applied to every prompt
// ── Static instruction blocks — extracted to module scope so they can be
// sent as an Anthropic SYSTEM PROMPT with cache_control, letting Anthropic
// cache the ~10K tokens of unchanging rules across every briefing call.
// Only truly-static text lives here; anything that references profile-
// specific values (commission, fx, cashSection, portfolio total) stays in
// buildBriefingPrompt's per-call output.
const MULTI_DAY_EXECUTION_RULES = `
MULTI-DAY EXECUTION (for any BUY > ~$1,500 CAD):
- Scale the entry over 3 layers: 40% at thesis-trigger, 30% at -1×ATR pullback, 30% at -2×ATR pullback.
- Each layer gets its own order ticket. Layers 2 & 3 are GTC.
- Cancel unfilled layers if ticker breaks the rec's Stop.
- For < $1,500 CAD, single-shot entry is fine.
`;

const ORDER_TICKET_RULES = `
ORDER-TICKET GUIDANCE (gap-protection — every BUY/SELL rec must include):
- Default to LIMIT orders, not market — protects vs overnight gaps.
- BUY limit = upper end of entry zone (or current ask + ~0.3% liquid / ~1% thin), never above target.
- SELL limit = lower end of exit zone (or current bid − small buffer), never below stop.
- After every BUY fill, recommend a GTC STOP-LIMIT SELL at the rec's stop level (stop = stop price, limit = stop − 1-2% as gap protection).
- Duration: "Day" cancels EOD; "GTC" persists.

REC HEADER FORMAT — every Action line: "Action: <VERB> <N> sh <TICKER>". The token after the verb MUST be a real ticker symbol. NEVER write "Action: SELL ENTIRE", "HOLD CURRENT", "SELL ALL", "HOLD BUT raise stop", or any English word in the ticker slot. If you mean "sell the whole position", write "Action: SELL 1267 sh DJT" with the exact share count.

QUANTITY MUST MATCH THE HOLDINGS TABLE. Full exit → use the exact holdings-table qty. Partial trim only when explicitly stated. Within one briefing, all references to a position's size use the same number.

FIELD FORMATTING — every named field (Entry, Target, Stop, Horizon, Account, Order ticket, After fill, Cost note, Rationale, Uses) ENDS WITH A PERIOD on its own logical line. Do not chain fields with commas / semicolons. Parenthetical notes inside a value are fine ("Stop: $69 CAD (2.5×ATR).") but the field ends at ")." — no comma inside the parens for the parser's sake.

Required lines per rec body (EVERY BUY/SELL/TRIM, no exceptions):
  Order ticket: LIMIT BUY/SELL <N> <TICKER> @ $<limit> <CCY> <max/min>, Day/GTC.
  Order timing: pre-market | at-open | post-10am | gtc.
  After fill: GTC STOP-LIMIT SELL <N> <TICKER>, stop $<stop> / limit $<stop-1%> <CCY>.
  Account: <Non-Spousal | RRSP | TFSA | RESP | FHSA> · uses $<X> of $<Y> pro-forma <CCY> · leaves $<Z>.

The "Account:" line is MANDATORY — omit it and the rec is invalid. The named account MUST have enough PRO-FORMA cash in the trade's currency to cover the proposed size (see CASH PRO-FORMA below).

CASH PRO-FORMA (mandatory — apply before sizing any BUY):
- Treat every recommended SELL / TRIM as if it EXECUTES and releases proceeds to the same (account, currency).
- Per (account, currency) running balance: current cash + your SELL/TRIM proceeds − your already-sized BUY costs, in that order down the briefing.
- Every BUY's "Account:" line references the pro-forma balance right BEFORE that BUY ("uses $X of $Y pro-forma <CCY> · leaves $Z").
- The BUY's Rationale (or a dedicated "Cash source:" line) cites what makes the cash available ("Cash source: $8,200 CAD current + $3,500 CAD from ENB SELL rec above"). If BUY relies entirely on current cash, say so.
- Pro-forma balance MUST NEVER go negative in any (account, currency). Downsize BUYs or add a further TRIM if needed.
- SELL proceeds fund BUYs ONLY within the SAME (account, currency). Cross-account moves need an explicit WITHDRAW→DEPOSIT transfer rec (both legs).
- Narrative order: same-account SELLs appear BEFORE the BUYs they fund.

ORDER-TIMING VOCABULARY (used by both the rec-body "Order timing:" line and the JSON block below):
  pre-market  → Queue for the 9:30 opening auction. ONLY for gap-and-go / earnings-morning theses where missing the open kills the setup.
  at-open     → First 15 min. RARE — only when opening volatility IS the setup (climax reversal, earnings-day gap fill).
  post-10am   → DEFAULT for most swing entries. Waits for 9:30-9:45 spreads to tighten.
  gtc         → Pullback / mean-reversion setups where the level may not hit today. Works until filled or cancelled.
Cite the choice in the rec's narrative rationale in ONE short sentence.

MANDATORY MACHINE-READABLE REC BLOCK — at the very end of the briefing, emit exactly:

<RECS>
[
  {"action":"BUY","ticker":"NVDA","account":"Non-Spousal USD","sleeve":"swing","entry":145.20,"target":160.00,"stop":138.50,"horizonDays":14,"currency":"USD","shares":100,"orderTiming":"post-10am"},
  {"action":"SELL","ticker":"ENB","account":"RRSP","sleeve":"income","entry":75.80,"target":72.00,"stop":78.00,"horizonDays":30,"currency":"CAD","shares":500,"orderTiming":"gtc"}
]
</RECS>

Block rules:
- One JSON object per actionable BUY / SELL / TRIM in the narrative. HOLD may be omitted.
- ticker = exact exchange symbol, never a brand name.
- account = REQUIRED — the exact account name from the per-account cash inventory block above (e.g. "RRSP", "TFSA", "Non-Spousal"). This is what activates the same-account SELL↔BUY pairing checks and the cross-account fragmentation gate. Missing account → validator treats the rec as unassigned and cannot pair it with sibling recs by account.
- sleeve = REQUIRED — one of "core" | "swing" | "income" | "spec". Must match the classifier's assignment for the ticker (CORE_ETFS / INCOME_TICKERS / SWING_TICKERS / SPEC_TICKERS lists in stocksSleeveEnforcer). Validator rejects missing OR mismatched sleeve. If you can't state the sleeve you haven't decided where the rec fits.
- horizonDays = REQUIRED integer (weeks × 7, months × 30). No silent default. Missing horizonDays = missing exit plan → validator rejects.
- entry / target / stop = the numbers cited in the narrative, native currency. target and stop are REQUIRED for every BUY (not null).
- currency = "USD" or "CAD", matches native listing.
- orderTiming = one of the four values above (REQUIRED — same vocabulary the narrative uses).
- thesisHorizonMonths = REQUIRED for any BUY where sleeve = "spec". Integer months (≥ 3) the thesis is expected to play out independent of intraday noise. Prevents chart patterns from being sold as multi-quarter theses. Missing or < 3 → validator rejects the rec.
- structuralDriver = REQUIRED for any BUY where sleeve = "spec". Short string (≥ 15 chars) naming the durable catalyst: regulatory tailwind, secular demand shift, macro regime shift, new product cycle, etc. "Pocket pivot scored 84" / "bull flag" / "RSI oversold" are NOT structural drivers — they are chart patterns. If the SPEC bet doesn't have a multi-quarter forcing function, don't emit it.
- signalSource = OPTIONAL, one of "congressional-follow" | "insider-cluster-buy" | "unusual-options-flow". Set this ONLY when the SPEC BUY thesis IS literally "follow the smart money" — the CONGRESSIONAL TRADES / INSIDER SIGNALS / OPTIONS FLOW blocks above surfaced a real signal on THIS ticker and you're piggybacking that filing. When set, the SPEC gate bypasses thesisHorizonMonths + structuralDriver (the smart-money signal IS the thesis), BUT the position is HARD-CAPPED at 0.5% of book per rec and 2% of book aggregate across all smart-money-follow BUYs in the batch. Do NOT set signalSource when the thesis is your own analysis — only when literally piggybacking a public smart-money filing. Do NOT set it to sneak a chart-pattern pick past the SPEC gate — the size cap makes it not worth it, and mislabelling is process fraud.
- No code fences, no prose inside <RECS>...</RECS>, nothing after </RECS>.
- Zero actionable recs → emit "<RECS>[]</RECS>". Never omit the block.
`;

const PRICE_CURRENCY_RULES = `
PRICE CURRENCY CONVENTION (strict):
- Always state prices in the security's NATIVE currency (shown in Holdings, e.g. "TSLA (USD)", "ENB (CAD)"). Never convert US-listed prices to CAD (or vice versa) for price discussion.
  ✓ "TSLA at $442 USD" · ✗ "TSLA at $607 CAD"
- Entry/Target/Stop in trade recs MUST be in the security's native currency.
- CAD/USD conversions in parens are OK only for portfolio totals or cash-sizing math, not for stock prices.

CANONICAL TICKER RULE (use exchange tickers, not brand acronyms):
  • Royal Bank = RY (NYSE) or RY.TO (TSX) — NEVER "RBC" (RBC is RBC Bearings, an unrelated US company).
  • TD Bank = TD / TD.TO. Scotia = BNS / BNS.TO. CIBC = CM / CM.TO. National = NA / NA.TO.
  • Block (formerly Square) = XYZ, not SQ. Meta = META, not FB. Twitter is delisted.
- In doubt → web_search "<company name> stock ticker" before recommending.

PRICE INTEGRITY (mandatory — accuracy over completeness):
- HELD-POSITION TICKERS ARE PRE-VERIFIED. Any ticker in the holdings table is REAL and TRADABLE — the backend validated it before this prompt was built. NEVER produce a "Ticker Not Found" / "UNABLE TO VERIFY" card for a held name (PLTR, NVDA, TSLA, SOUN, RUM, DJT, ENB, etc. are all real). If web_search fails on a held ticker, use the holdings-table price as authoritative and move on.
- CURRENCY CONSISTENCY on held names. When you cite a current price for a held position, use the currency of the ticker's PRIMARY listing (the currency shown for that ticker in the holdings table and QUANT_SIGNALS block). NEVER mix currencies in the same narrative — e.g. don't cite "CNQ $44.75 USD" while the holdings table and stop math are in CAD ($63.35 CAD). The two values are the US ADR vs the TSX listing of the same company and using the wrong one silently corrupts the stop / target / P/L math the reader is going to reason from. Rule: if the holdings-table row says "CAD", every current-price quote in that ticker's narrative is CAD. Period.
- For ANY ticker NOT in holdings, web_search "<TICKER> stock price" and use ONLY the retrieved live quote. NEVER quote a price from memory — training data is stale by 30-200%.
- Verify a new name is currently tradable before recommending. Watch renamed/delisted symbols (SQ→XYZ 2025, FB→META, TWTR delisted). Any sub-mega-cap from training → verify first.
- If web_search can't confirm a live quote for a NEW ticker → don't recommend it, pick a different name, don't emit a failure card. Silently move on.
- State retrieved prices with "(verified)" inline. Prior failures the user caught: SQ at $79, ROKU at $67, META at $525. Don't repeat.
`;

const OUTPUT_FORMAT_RULES = `
CRITICAL OUTPUT FORMAT RULES:
- START the briefing DIRECTLY with the markdown title heading (e.g. "# Daily Briefing — May 22, 2026"). Do NOT preamble with "I'll search the web for...", "Let me pull the latest news...", "Now let me write your briefing.", or any other chatty narration. The user is reading an email, not chatting.
- Do NOT include any sentence describing what you're about to do. Just do it.
- End with the disclaimer: "Research and education only. Not licensed investment advice."

Return ONLY the markdown briefing. No JSON, no wrapping prose. First character of your response must be a # symbol.
`;

const CANADIAN_TAX_BLOCK = `
Account-placement & tax notes (Canadian investor):
- Eligible Canadian-corp dividends (ENB, BCE, TD, RY, BNS, T, CNQ, SU, etc.) receive the Canadian dividend tax credit when held in non-registered accounts. ENB's ~6% yield is materially more tax-efficient than the headline number suggests for the Non-Spousal account.
- US dividend stocks held in an RRSP are EXEMPT from US 15% withholding tax under the Canada–US tax treaty (Article XXI). In TFSA or Non-Spousal, the withholding applies (15%; recoverable as foreign tax credit only in Non-Spousal).
- Therefore: prefer US dividend payers (broad index ETFs, ENB cross-listing aside, dividend aristocrats) in RRSP. Prefer Canadian eligible dividend payers in Non-Spousal or TFSA.
- TFSA: tax-free capital gains — best home for high-conviction high-volatility growth bets (NVDA, PLTR, RKLB) where you expect big multiples.
- Non-Spousal: capital gains taxable at 50% inclusion rate; capital losses harvestable. Avoid US dividends here unless deliberate.
- Suggest the specific account (Non-Spousal / RRSP / TFSA) for any new BUY rec, especially Canadian-corp dividend payers vs US growth names.
`;

// STATIC_SYSTEM_PROMPT — concatenation of every truly-static rules block
// used by the briefing. Sent as an Anthropic system prompt with
// cache_control so ~10K tokens of unchanging instructions cache across
// every briefing call (~90% cost reduction on repeats). Only rules that
// don't depend on profile-specific values live here; anything with
// commission / fx / cashSection / portfolio-$ interpolation stays in
// the per-call user message.
const STATIC_SYSTEM_PROMPT = `You are a personal stock advisor at SENIOR-ANALYST level generating a morning briefing.

SENIOR-ANALYST EXPECTATIONS:
1. Read the MACRO REGIME block FIRST; frame the briefing through it (risk-on/off, rates, USD/CAD).
2. Use ATR-based stops from the technicals block, not flat percentages.
3. Reference per-position cost basis from LIFECYCLE when proposing sells (tax impact / loss realization).
4. Surface TAX-LOSS HARVEST candidates when present — free money in non-registered accounts.
5. Cite SPECIFIC numbers (RSI 32, P/E 87, ATR $14, 2.5×ATR stop = $407), not vague descriptors.
5b. FIB: cite real levels from the technicals block; "add on pullback to 61.8% Fib at $X". Golden pocket (61.8-65%) + other-signal confirm = high-conviction. Never invent levels.
5c. VOLUME: cite specifically from the block (RVOL, dry-up, climax bar, pocket pivot, OBV) — not "volume looks good".
5d. NAMED SETUPS: when a "Setup [...]" block appears, cite name + score + trigger verbatim from its evidence bullets. Never fabricate a pattern.
5e. MTF CONFLUENCE: 🟢🟢🟢 ALIGNED UP = highest conviction; 🔴🔴🔴 ALIGNED DOWN = same bearish; 🟡 CONFLICTING = downgrade sizing; ⚪ mixed = neutral.
5f. CATALYSTS: earnings 🔥 (≤3d) = no new entries; ⚡ (≤7d) = tighten stops. Cite recent upgrades/downgrades with firm + date + PT.
5g. SHORT SQUEEZE: 🎯 score ≥60 + confirming trend + RVOL = tactical long; ⚠ high-SI without squeeze flag = gap-down risk. Cite score + SI% + DTC.
5h. TRAILING STOP: cite all three numbers from the block verbatim in section 2 — "Trail stop: N% ($Y trigger, $O limit offset — enter both in broker) · Z% slack". Slack ≤3% → "⚠ approaching trail stop." STOP HIT → SELL at market.
5i. OPTIONS FLOW: P/C OI >1.3 = bearish; <0.7 = bullish. IV rank ≥80 (🔥 rich) → sell premium; ≤20 (💤 cheap) → buy premium. Cite when discussing hedging.
5j. FED LIQUIDITY REGIME: 🔴 RISK-OFF OVERRULES individual signals (trim, tighten, no new spec). 🟢 RISK-ON = full size, take breakouts. Cite regime + top contributor.
5k. CONGRESSIONAL TRADES: multiple purchases = potential positive catalyst; multiple sales = warning. Cite filer + date when strong.
5l. TICKERS NOT FOUND: NEVER emit "Ticker Not Found" / "UNABLE TO VERIFY" for held positions — ownership IS verification. If web_search fails, use the holdings-table price.
5m. CALIBRATION: weight recs toward the highest-win-rate score×setup×MTF buckets. Cite bucket + n + win rate on full-size calls. n<5 = unknown, not proven.
5n. BENCHMARK ALPHA: cite the alpha figure when defending an active swing ("YTD alpha +4.1pp vs SPY"). Deeply negative alpha over YTD/since-start → propose SPY/XIC/XEQT rotation in section 4 instead of another swing.
5o. CORRELATION-ADJUSTED SIZING: respect any "SIZE X%" tag by multiplying share count + cash allocation by that fraction; cite the pairing (correlation + factor + book weight of the correlated holding). Untagged rows = safely independent.
5p. OPTIONS OVERLAY (covered calls — narrow subset ONLY, pre-filtered by pipeline): if OPTIONS OVERLAY block non-empty, emit section 6a with top 1-2 suggestions verbatim (strike/exp/mid premium/monthly yield %). Format: "SELL to open <N> <TICKER> <exp> $<K> CALL @ limit $<mid>" + one-line justification (IV rank + delta approx + upside cap). SKIP any suggestion whose underlying has an earnings date inside the expiration window (IV crush post-earnings reverses "sell rich premium"). Overlay recs also go in the trailing <RECS> block: action="SELL", orderTiming="gtc", currency matches underlying, ticker = underlying symbol. If OVERLAY block empty → skip 6a entirely; never invent covered-call ideas outside the block.
5q. DISCIPLINE COMPLIANCE: emit "## ⚖ Discipline check" (numbered 0e) only when the block shows 🚨/⚠ or on the weekly Monday heartbeat. Cite numbers matter-of-factly ("acted on 4 of 12 setups this month"). Any hard-stop violation still held → elevate into section 0c EXIT AT MARKET with the compliance metric. One line, no lecture.
5r. RETURN ATTRIBUTION: when block appears (Monday retrospective), use it to defend/cut specific bucket types. Emit as an optional "## 💰 Attribution snapshot" section, ONE paragraph, cited from the block verbatim.
5t. HORIZON REVIEW: when the HORIZON REVIEW block appears, emit "## 📅 Horizon review" (numbered 0f, before section 1). One line per row citing (day X/Y, entry, current, target, delta, required-daily) verbatim:
   - ⌛ EXPIRED → EXIT / ROLL / TRIM. Passive ROLL is what horizons were designed to prevent; "hold because I like it" is not a reason. State a specific new-evidence reason for any hold.
   - 🔴 WELL-BEHIND → assess: thesis broken (exit) or time still on our side (patience)? Cite distance-to-target vs distance-to-stop.
   - 🟡 LAGGING → noted, no action.
   - 🟢 ON-PACE / ✅ HIT-TARGET → one-line acknowledgement (✅ triggers auto-sell-trail elsewhere).
   If ALL rows are 🟢/🟡 → single line "All open positions on-pace within their horizons — no exits or rolls needed today", then skip the section.
5s. SUB-CURRENCY BUCKETS (mandatory — CAD and USD cash held SEPARATELY per account): a trade in the security's native currency MUST settle out of the same-currency bucket. TSX-listed CAD stock ← cashCad; US-listed USD stock ← cashUsd. Wrong-currency cash is INELIGIBLE without an explicit FX conversion. NEVER propose a BUY whose currency doesn't match the settle bucket. When the tax-optimal account has wrong-currency cash: (a) pick a currency-matched name there, (b) use a different account with the right currency, or (c) propose an explicit WITHDRAW + DEPOSIT FX conversion, noting the friction cost. Pro-forma cash computation runs PER (account, currency), never pooled.
6. **DO NOT RESTATE P/L PERCENTAGES OR DOLLAR GAINS/LOSSES IN PROSE.** Holdings table already shows actual P/L. If you write "BBAI down -7.7%" and the app shows BBAI +333%, you mislead. Reference lifecycle cost-basis for tax reasoning only; do NOT narrate "down X%" unless it matches Holdings EXACTLY.
${PRICE_CURRENCY_RULES}
${ORDER_TICKET_RULES}
${MULTI_DAY_EXECUTION_RULES}
${CANADIAN_TAX_BLOCK}
${SIGNALS_CHECKLIST}
${OUTPUT_FORMAT_RULES}

Use the web_search tool aggressively — at least 6-10 searches across signal categories above for the top holdings.

Write a markdown briefing following the per-call section outline that immediately follows this system prompt (sections 0 → 8, with 0b/0c/0d/0f as conditional prefix sections tied to their input blocks). The per-call outline is the source of truth for section headings, ordering, and format; this system prompt provides only analytical guidance.

Length: 700-1100 words. Date-stamp the top.`;

// Build a "QUANT SIGNALS" block for the briefing prompt — pre-computed
// fundamentals (FMP) + technicals (local) for the top holdings, so the AI
// has reliable numbers instead of guessing from search results.
async function computeQuantSignals(profile, topN = 8) {
  const tickerInfo = {};
  for (const p of profile.positions || []) {
    if (!tickerInfo[p.ticker]) tickerInfo[p.ticker] = { ccy: p.ccy };
  }
  const tickers = Object.keys(tickerInfo).slice(0, topN);
  // Position-book prices per ticker, in each ticker's native currency —
  // the ground truth after the user's reconciliation. Used below to
  // sanity-check whatever getTechnicals returns.
  const bookPriceByTicker = {};
  for (const p of profile.positions || []) {
    const t = String(p.ticker || "").toUpperCase();
    if (!t) continue;
    const px = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    if (Number.isFinite(px) && !bookPriceByTicker[t]) bookPriceByTicker[t] = px;
  }
  const out = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      const ccy = tickerInfo[ticker].ccy;
      // Pass currency so a CAD holding resolves to its TSX listing (ENB →
      // ENB.TO) — without it the technicals/last-price come from the US ADR
      // and the briefing reasons on the wrong market/currency.
      let [tech, fund, catalysts, options] = await Promise.all([
        getTechnicals(ticker, ccy).catch(() => ({ ok: false })),
        getFundamentals(ticker, ccy).catch(() => ({ ok: false })),
        getCatalysts(ticker, ccy).catch(() => null),
        getOptionsMetrics(ticker).catch(() => null),
      ]);

      // Sanity check — if getTechnicals returned a last price that
      // disagrees with the user's reconciled position book by more than
      // 30%, treat the WHOLE tech block as suspect and drop it. The
      // user's book reconciles to CIBC daily; a data-provider that
      // returns e.g. NVDA at $42.89 when the book says $206.81 is
      // almost certainly serving stale / wrong / pre-split data, and
      // any anchoring the AI does off tech.last (ATR stop, RSI, SMA
      // deltas, Fib levels) will compound the error. Better a "tech
      // unavailable" line than a confidently-wrong exit signal.
      const bookPx = bookPriceByTicker[String(ticker).toUpperCase()];
      if (tech && tech.ok && Number.isFinite(tech.last) && Number.isFinite(bookPx) && bookPx > 0) {
        const drift = Math.abs(tech.last - bookPx) / bookPx;
        if (drift > 0.30) {
          console.warn(`[quant-signals] ${ticker}: tech.last=$${tech.last.toFixed(2)} vs position-book $${bookPx.toFixed(2)} (${(drift * 100).toFixed(0)}% drift) — dropping tech block`);
          tech = {
            ok: false,
            reason: `data-feed returned $${tech.last.toFixed(2)} but the reconciled position book has $${bookPx.toFixed(2)} (${(drift * 100).toFixed(0)}% drift). Book overrides — use $${bookPx.toFixed(2)} as the current price. RSI / SMA / ATR / Fib suppressed to avoid anchoring on suspect data.`,
          };
        }
      }

      // Short interest reads bimonthly FINRA data (cheap Yahoo call, 24h
      // cache) and takes optional tech context to compute the squeeze
      // score — so it goes AFTER tech resolves (and the sanity-check
      // above already replaced tech with an ok:false stub when suspect).
      const shortInterest = await getShortInterest(ticker, ccy, tech).catch(() => null);
      out[ticker] = { tech, fund, catalysts, shortInterest, options, ccy };
    })
  );
  return out;
}
// Phase 3+4 retrofit: render the canonical portfolio snapshot as a
// clearly-labeled block the LLM must consume verbatim. Per spec §24
// "LLM Separation" — the AI may explain these numbers but MUST NOT
// invent its own. Every percentage the AI cites downstream should
// trace back to a field in this block.
// Compact variant for intraday / EOD prompts — sleeves + top-5 positions
// + reconciliation only. Same binding rule ("narrate, don't recompute")
// but keeps token count down for the ~1k-token intraday call.
export function formatCanonicalPortfolioBlockCompact(canonical) {
  if (!canonical) return "";
  const parts = [];
  parts.push("CANONICAL PORTFOLIO (source of truth — cite these numbers, don't invent your own):");
  parts.push(`  portfolio_total_cad: $${Math.round(canonical.totals.portfolio_total_cad).toLocaleString()} · cash_pct: ${canonical.cash.cash_pct.toFixed(2)}%`);
  const topN = canonical.positions.slice(0, 5);
  if (topN.length > 0) {
    parts.push("  Top positions (weight · sleeve · sector · dist_to_stop):");
    for (const p of topN) {
      const stop = Number.isFinite(p.distance_to_hard_stop_pct)
        ? ` · stop ${p.distance_to_hard_stop_pct.toFixed(1)}%`
        : "";
      parts.push(`    ${p.ticker}: ${p.position_weight_pct.toFixed(1)}% · ${p.sleeve} · ${p.sector}${stop}`);
    }
  }
  parts.push("  Sleeves (weight vs target):");
  for (const s of canonical.sleeves) {
    if (s.sleeve_target_pct == null) continue;
    const varStr = s.sleeve_variance_pp != null
      ? `${s.sleeve_variance_pp >= 0 ? "+" : ""}${s.sleeve_variance_pp.toFixed(1)}pp`
      : "—";
    parts.push(`    ${s.sleeve}: ${s.sleeve_weight_pct.toFixed(1)}% (target ${s.sleeve_target_pct}%, var ${varStr})`);
  }
  if ((canonical.reconciliation.warnings || []).length > 0) {
    parts.push("  ⚠ Reconciliation warnings:");
    for (const w of canonical.reconciliation.warnings.slice(0, 3)) {
      parts.push(`    - [${w.code}] ${w.message}`);
    }
  }
  parts.push("BINDING RULE: every % you cite in the recap must equal a value above; do not restate weights differently.");
  return parts.join("\n");
}

function formatCanonicalPortfolioBlock(canonical) {
  if (!canonical) return "";
  const parts = [];
  parts.push("CANONICAL PORTFOLIO SNAPSHOT (source of truth — every % you cite MUST match this):");
  parts.push(`  book_cad: $${Math.round(canonical.totals.book_cad).toLocaleString()}`);
  parts.push(`  cash_cad_equiv: $${Math.round(canonical.totals.cash_cad_equiv).toLocaleString()}  (cash_pct: ${canonical.cash.cash_pct.toFixed(2)}%)`);
  parts.push(`  portfolio_total_cad: $${Math.round(canonical.totals.portfolio_total_cad).toLocaleString()}`);
  parts.push(`  fx_usd_cad: ${canonical.fxUsdCad.toFixed(4)}`);
  parts.push("");
  parts.push("POSITIONS (each: ticker, account, cad_value, position_weight_pct, sleeve, sector, position_return_pct):");
  for (const p of canonical.positions) {
    const stop = Number.isFinite(p.distance_to_hard_stop_pct)
      ? ` · dist_to_stop=${p.distance_to_hard_stop_pct.toFixed(1)}%`
      : "";
    const trailStop = Number.isFinite(p.distance_to_trailing_stop_pct)
      ? ` · dist_to_trail=${p.distance_to_trailing_stop_pct.toFixed(1)}%`
      : "";
    const ret = Number.isFinite(p.position_return_pct)
      ? ` · ret=${p.position_return_pct >= 0 ? "+" : ""}${p.position_return_pct.toFixed(1)}%`
      : "";
    parts.push(`  ${p.ticker} · ${p.account_name || "?"} · $${Math.round(p.cad_value).toLocaleString()} CAD · ${p.position_weight_pct.toFixed(1)}% · sleeve=${p.sleeve} · sector=${p.sector}${ret}${stop}${trailStop}`);
  }
  parts.push("");
  parts.push("SLEEVES (weight, target, variance in pp, remaining capacity):");
  for (const s of canonical.sleeves) {
    if (s.sleeve_target_pct == null) continue;
    const varStr = s.sleeve_variance_pp != null ? `${s.sleeve_variance_pp >= 0 ? "+" : ""}${s.sleeve_variance_pp.toFixed(1)}pp` : "—";
    parts.push(`  ${s.sleeve}: ${s.sleeve_weight_pct.toFixed(1)}% (target ${s.sleeve_target_pct}%, var ${varStr}, remaining_capacity ${s.sleeve_remaining_capacity_pct?.toFixed(1) ?? "—"}%)`);
  }
  parts.push("");
  parts.push("CONCENTRATION (aggregated same-base across accounts):");
  for (const c of canonical.concentration.filter(c => c.level !== "clean").slice(0, 8)) {
    parts.push(`  ${c.base}: ${c.weight_pct.toFixed(1)}% [${c.level}]${c.tickers.length > 1 ? " (" + c.tickers.join(", ") + ")" : ""}`);
  }
  parts.push("");
  parts.push("RECONCILIATION:");
  parts.push(`  Σ position_weight_pct = ${canonical.reconciliation.sum_of_position_weights_pct.toFixed(2)}% (expected non-cash ${canonical.reconciliation.expected_non_cash_pct.toFixed(2)}%)`);
  parts.push(`  Σ sleeve_weight_pct   = ${canonical.reconciliation.sum_of_sleeve_weights_pct.toFixed(2)}%`);
  parts.push(`  Σ account_weight_pct  = ${canonical.reconciliation.sum_of_account_weights_pct.toFixed(2)}%`);
  if ((canonical.reconciliation.warnings || []).length > 0) {
    parts.push("  Warnings:");
    for (const w of canonical.reconciliation.warnings) parts.push(`    - [${w.code}] ${w.message}`);
  }
  parts.push("");
  parts.push("BINDING RULE (per §24 LLM Separation): You may narrate and interpret these numbers. You MAY NOT recompute, restate with different values, or invent new %-values. Every percentage you write in the briefing must equal a value from this block (or be the direct sum of specific values from it). If you need a % not here, say so; do not fabricate one.");
  return parts.join("\n");
}

// Thin wrapper — swallows errors so the briefing pipeline never dies
// on an upswitch-format bug. Safe to call with null/undefined; returns
// empty string. The actual formatter is statically imported at the
// top of this file.
function formatUpswitchBlockSafe(upswitchResult) {
  if (!upswitchResult) return "";
  try { return formatUpswitchBlockImpl(upswitchResult); }
  catch (e) { console.warn("[upswitch-format] warn:", e?.message); return ""; }
}

function formatQuantSignalsBlock(quantSignals) {
  if (!quantSignals || Object.keys(quantSignals).length === 0) return "";
  const lines = [];
  for (const [ticker, sig] of Object.entries(quantSignals)) {
    lines.push(`${ticker} (${sig.ccy}):`);
    lines.push(`  Fundamentals: ${formatFundamentalsLine(sig.fund)}`);
    lines.push(`  Technicals:   ${formatTechnicalsLine(sig.tech)}`);
    const catLine = formatCatalystsLine(sig.catalysts);
    if (catLine) lines.push(`  ${catLine}`);
    const siLine = formatShortInterestLine(sig.shortInterest);
    if (siLine) lines.push(`  ${siLine}`);
    const optLine = formatOptionsLine(sig.options);
    if (optLine) lines.push(`  ${optLine}`);
    // Named setups — emit full evidence per detected pattern so the AI
    // can quote specific trigger prices and pattern mechanics, not just
    // "there's a bull flag."
    if (Array.isArray(sig.tech?.setups) && sig.tech.setups.length > 0) {
      for (const s of sig.tech.setups) {
        lines.push(`  Setup [${s.type} ${s.score}]: ${s.name}`);
        for (const e of s.evidence) lines.push(`    · ${e}`);
      }
    }
    // Recent analyst actions — surface top 5 verbatim so the AI can cite
    // specific firms/targets (not just aggregate up/down counts).
    if (Array.isArray(sig.catalysts?.analysts) && sig.catalysts.analysts.length > 0) {
      const top = sig.catalysts.analysts.slice(0, 5);
      for (const a of top) {
        const pt = a.priceTarget != null ? ` → PT $${a.priceTarget}` : "";
        lines.push(`    · Analyst ${a.date}: ${a.firm} ${a.action}${a.priorGrade ? ` (${a.priorGrade}→${a.newGrade})` : (a.newGrade ? ` (${a.newGrade})` : "")}${pt}`);
      }
    }
  }
  return `\nQUANT SIGNALS PER HOLDING (pre-computed — use THESE numbers, don't guess):\n${lines.join("\n")}\n`;
}

function formatRecentTradesBlock(recentTrades) {
  if (!Array.isArray(recentTrades) || recentTrades.length === 0) return "";
  const lines = [];
  for (const t of recentTrades) {
    const when = new Date(t.executedAt).toISOString().slice(0, 10);
    for (const leg of t.legs || []) {
      if (leg.side !== "BUY" && leg.side !== "SELL") continue;
      const linkedRec = t.linkedAdviceRecId;
      const linkedPick = t.linkedDailyPickId;
      let linkedStr = "";
      if (linkedRec && linkedRec.ticker === leg.ticker && linkedRec.action === leg.side) {
        linkedStr = ` [fulfilled AI rec: entry $${linkedRec.entryPrice}, target $${linkedRec.targetPrice ?? "—"}, stop $${linkedRec.stopPrice ?? "—"}, horizon ${linkedRec.horizonDays ?? "?"}d]`;
      } else if (linkedPick && linkedPick.ticker === leg.ticker && leg.side === "BUY") {
        linkedStr = ` [fulfilled SWING pick (${linkedPick.setupName || "deterministic"}): entry $${linkedPick.entryPrice}, target $${linkedPick.targetPrice ?? "—"}, stop $${linkedPick.stopPrice ?? "—"}, horizon ${linkedPick.horizonDays ?? "?"}d, score ${linkedPick.deterministicScore ?? "?"}]`;
      }
      const notesStr = t.notes ? ` — "${String(t.notes).slice(0, 120)}"` : "";
      lines.push(`  ${when}: ${leg.side} ${leg.shares || "?"} sh ${leg.ticker} @ $${leg.pricePerShare?.toFixed?.(2) || leg.pricePerShare} ${leg.currency} in ${t.accountName || t.account}${linkedStr}${notesStr}`);
    }
  }
  if (lines.length === 0) return "";
  return `\nTRADES YOU EXECUTED SINCE LAST BRIEFING — you must acknowledge each of these explicitly (see instruction below):\n${lines.join("\n")}\n`;
}

// Operator-facing daily-picks section for deterministic (no-AI)
// briefing mode. Renders each pick as a compact bullet with all
// numbers coming straight from the pick engine (composite score,
// entry, target, stop, setup, rationale). No prose, no LLM narrative,
// no chance of hallucinated numbers.
//
// PRICE-VERIFICATION GATE: every pick is independently re-verified
// against the market-data integrity layer before rendering. If the
// pick's entryPrice differs from the fresh verified quote by more
// than 5%, the pick is SUPPRESSED with "PRICE VERIFICATION FAILED".
// Real defect: MU appeared at $967.74 (should be ~$110) — a data-
// feed adjustment/split artifact that the pick engine let through.
// Any pick whose price cannot be verified cannot ship.
async function renderDailyPicksDeterministic(dailyPicks, ctx = {}) {
  if (!Array.isArray(dailyPicks) || dailyPicks.length === 0) return "";
  const { verifyRecPrice } = await import("../services/marketDataIntegrity.js");
  const { auditPickReconciliation } = await import("../services/briefingAudit.js");
  // Tier 3.1/3.2 (audit Aug-28): adversarial verify + chart vision
  // add real wall-clock (~15-25s of Anthropic calls) that killed the
  // preview endpoint's frontend fetch timeout (Aug-29). Two guards:
  //   1. ctx.fastPreview=true skips both entirely (on-demand path).
  //   2. Even in cron mode, each call has a hard timeout so a hung
  //      Anthropic can't stall the briefing indefinitely.
  const fastPreview = ctx?.fastPreview === true;
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
  let adversarialByTicker = {};
  if (!fastPreview) {
    try {
      // Only pay for verify on BUY-candidate picks (composite ≥ 70).
      // WATCH / SCREENED / MONITOR are already blocked from actionable
      // BUY; no LLM call needed on those.
      const buyCandidates = dailyPicks.filter(p => !p.blockedReason
        && !p.specialSituation?.active
        && Number.isFinite(p.deterministicScore) && p.deterministicScore >= 70);
      if (buyCandidates.length > 0) {
        const { verifyDailyPicksBatch } = await import("../services/stocksAdversarialVerify.js");
        adversarialByTicker = await withTimeout(
          verifyDailyPicksBatch(buyCandidates, { concurrency: 2 }),
          25_000,
          "adversarial-verify-batch",
        ).catch((e) => {
          console.warn("[daily-picks-adversarial] batch verify failed:", e?.message);
          return {};
        });
      }
    } catch (e) {
      console.warn("[daily-picks-adversarial] batch verify threw:", e?.message);
    }
  }
  let chartVisionByTicker = {};
  if (!fastPreview) {
    try {
      const topBuy = dailyPicks
        .filter(p => !p.blockedReason && !p.specialSituation?.active
          && Number.isFinite(p.deterministicScore) && p.deterministicScore >= 70)
        .sort((a, b) => (b.compositeRank ?? b.deterministicScore) - (a.compositeRank ?? a.deterministicScore))
        .slice(0, 1);
      if (topBuy.length > 0) {
        const [{ getChartVisionAnalysis, chartVisionVetoVerdict }] = await Promise.all([
          import("../services/stocksChartVision.js"),
        ]);
        const top = topBuy[0];
        const analysis = await withTimeout(
          getChartVisionAnalysis(top.ticker, top.currency || "USD"),
          12_000,
          "chart-vision",
        ).catch(() => null);
        if (analysis) {
          const verdict = chartVisionVetoVerdict(analysis);
          chartVisionByTicker[top.ticker] = { analysis, verdict };
        }
      }
    } catch (e) {
      console.warn("[daily-picks-chart-vision] failed:", e?.message);
    }
  }
  const PICK_PRICE_DRIFT_MAX_PCT = 5.0;
  // Per-pick reconciliation audit — strip any pick whose displayed
  // composite doesn't reconcile to the sum of its contributions (hidden
  // adjustment, duplicate contribution, float artifact, or NaN leak).
  // Failure is per-pick: a single bad row is dropped from the list, not
  // the whole briefing. Rejected picks land in `reconciliationFailed`
  // and are printed at the end so the operator can see WHY.
  const reconciliationFailed = [];
  const passesReconciliation = (p) => {
    const r = auditPickReconciliation(p);
    if (!r.ok) {
      reconciliationFailed.push({ ticker: p?.ticker || "?", issues: r.issues });
      return false;
    }
    return true;
  };
  // Verify every allowed pick concurrently but cap concurrency so
  // we don't burst the market-data provider.
  const allowedRaw = dailyPicks.filter(p => !p.blockedReason && passesReconciliation(p));
  const blockedRaw = dailyPicks.filter(p => p.blockedReason);
  const verified = [];
  const suppressed = [];
  const CONC = 4;
  for (let i = 0; i < allowedRaw.length; i += CONC) {
    const slice = allowedRaw.slice(i, i + CONC);
    const results = await Promise.all(slice.map(async (p) => {
      try {
        const v = await verifyRecPrice({
          ticker: p.ticker,
          entryCurrency: p.currency || "USD",
          entryPrice: p.entryPrice,
        });
        return { p, v };
      } catch (e) {
        return { p, v: { ok: false, rejectionReason: `verify-threw:${e?.message || "unknown"}` } };
      }
    }));
    for (const { p, v } of results) {
      if (v.ok) {
        verified.push({ ...p, verifiedPrice: v.verifiedPrice });
      } else {
        const detail = v.rejectionReason || "market-data-unavailable";
        const driftDetail = v.detail || "";
        suppressed.push({ ticker: p.ticker, reason: `${detail}${driftDetail ? ` — ${driftDetail}` : ""}` });
      }
    }
  }
  if (verified.length === 0 && blockedRaw.length === 0 && suppressed.length === 0) return "";
  const lines = ["", "## 4. 💡 Daily picks (deterministic, price-verified)", ""];
  if (verified.length > 0) {
    lines.push(`_${verified.length} pick${verified.length === 1 ? "" : "s"} passed every screen AND independent live-price verification (drift < ${PICK_PRICE_DRIFT_MAX_PCT}%)._`);
    lines.push("");
    for (let i = 0; i < verified.length; i++) {
      const p = verified[i];
      const sleeveTag = classifyPosition({ ticker: p.ticker }) || "spec";
      const setupTag = p.setupName ? ` · setup: **${p.setupName}**` : "";
      const mtfTag = p.mtfConfluence ? ` · MTF ${p.mtfConfluence}` : "";
      // Derived risk metrics — upside %, downside %, reward/risk.
      const entry = p.entryPrice;
      const upsidePct = entry > 0 ? ((p.targetPrice - entry) / entry) * 100 : 0;
      const downsidePct = entry > 0 ? ((entry - p.stopPrice) / entry) * 100 : 0;
      const rewardRisk = downsidePct > 0 ? (upsidePct / downsidePct) : null;
      const rrStr = rewardRisk != null ? `${rewardRisk.toFixed(2)}:1` : "n/a";
      // Tier the pick by (composite score AND MTF confluence AND R/R
      // gate). A sub-60 composite OR conflicting MTF OR sub-1.5 R/R
      // is a watchlist candidate, not an actionable BUY. Reviewer
      // caught QSR.TO at composite 84 but R/R 0.34:1 being labeled
      // BUY — the composite doesn't override the execution-quality
      // gate. Match the validator's ruleMinRewardRisk threshold (1.5)
      // for consistency across producers.
      const MIN_RR_FOR_BUY = 1.5;
      const isConflict = String(p.mtfConfluence || "").toLowerCase() === "conflicting";
      const rrOk = rewardRisk != null && rewardRisk >= MIN_RR_FOR_BUY;
      // Special-situation preflight — the pick engine already screens
      // active M&A/tender/take-private tickers, but the renderer must
      // fail-closed on ANY specialSituation-tagged pick reaching this
      // block. Priceable deals (independently-verified acquirer price)
      // route to EVENT-DRIVEN ANALYSIS; anything else is SCREENED —
      // ACTIVE M&A with a plain-English explanation.
      const situation = p.specialSituation || null;
      const situationActive = situation && situation.active;
      // Tier 3.1 (audit Aug-28): adversarial verify verdict lookup. A
      // "reject" verdict downgrades an otherwise-BUY tier to SCREENED-
      // BEAR; "risk_flagged" annotates but doesn't change tier (the
      // deterministic R/R + MTF + regime gates already provide the
      // structural protection; the bear pass is an editorial layer).
      const adversarial = adversarialByTicker[p.ticker] || null;
      const adversarialReject = adversarial && adversarial.verdict === "reject";
      // Chart-vision veto (Tier 3.2). Only the top-1 gets a vision
      // pass to bound cost; verdict.veto=true blocks BUY.
      const chartVisionEntry = chartVisionByTicker[p.ticker] || null;
      const chartVeto = chartVisionEntry && chartVisionEntry.verdict?.veto;
      let tier;
      let priceableDeal = false;
      if (situationActive) {
        // Priceability check — the service already computed
        // impliedDealValue when the store row was read.
        priceableDeal = !!(situation.impliedDealValue && Number.isFinite(situation.impliedDealValue.impliedValue));
        tier = priceableDeal ? "EVENT-DRIVEN" : "SCREENED-MA";
      } else if (adversarialReject) {
        // Bear case wins — do not label as BUY regardless of composite/R/R.
        tier = "SCREENED-BEAR";
      } else if (chartVeto) {
        // Chart clearly bearish (stage-3/4 or bearish pattern + low
        // conviction) — no BUY regardless of composite. New tier so
        // the operator can trace exactly why.
        tier = "SCREENED-CHART";
      } else if (p.deterministicScore >= 70 && !isConflict && rrOk) {
        tier = "BUY";
      } else if (p.deterministicScore >= 70 && !isConflict && !rrOk) {
        // High-quality composite but the current entry/target/stop can't
        // meet the R/R floor. Distinct tier so the operator sees WHY.
        tier = "SCREENED";
      } else if (p.deterministicScore >= 60 && p.watchTrigger && Number.isFinite(p.watchTrigger.price)) {
        // WATCH is a real waiting-order tier — reserved for names where
        // there IS a specific price at which R/R would clear the BUY
        // floor. Without a valid watchTrigger, WATCH is meaningless
        // aspirational filler; demote to SCREENED so the operator
        // doesn't act on a name whose structure can never clear R/R
        // even on a pullback.
        tier = "WATCH";
      } else if (p.deterministicScore >= 60) {
        tier = "SCREENED";
      } else {
        tier = "MONITOR";
      }
      const tierColor = tier === "BUY" ? "✅"
                      : tier === "EVENT-DRIVEN" ? "🎯"
                      : tier === "SCREENED-MA" || tier === "SCREENED" || tier === "SCREENED-BEAR" || tier === "SCREENED-CHART" ? "⛔"
                      : tier === "WATCH" ? "⚠️"
                      : "🔍";
      // Identity line: ticker · currency · verified live price · tier.
      const compositeLabel = p.deterministicScore == null ? "n/a" : p.deterministicScore;
      const tierDisplayLabel = tier === "SCREENED-MA" ? "SCREENED — ACTIVE M&A"
        : tier === "SCREENED-BEAR" ? "SCREENED — BEAR CASE"
        : tier === "SCREENED-CHART" ? "SCREENED — CHART BEARISH"
        : tier;
      lines.push(`**${i + 1}. ${p.ticker}** [${sleeveTag.toUpperCase()}] · ${p.currency || "USD"} · composite ${compositeLabel}${setupTag}${mtfTag} · ${tierColor} **${tierDisplayLabel}**`);
      if (situationActive) {
        // Special-situation branch — skip the ordinary entry/target/stop
        // line entirely; those numbers don't apply once the deal terms
        // are pricing the security. Print the situation block instead.
        try {
          const { formatSpecialSituationBlock } = await import("../services/stocksSpecialSituations.js");
          const block = formatSpecialSituationBlock(situation, { livePrice: p.verifiedPrice });
          if (block) for (const l of block.split("\n")) lines.push(`   ${l.replace(/^\s+/, "")}`);
        } catch (e) {
          lines.push(`   ⚠ special-situation formatter failed: ${e?.message || "unknown"}`);
        }
        if (tier === "SCREENED-MA") {
          lines.push(`   ⛔ SCREENED — ACTIVE M&A. Ordinary technical setups don't price a name subject to a definitive corporate agreement. Not actionable as a swing/spec BUY. See event-driven analysis if you want to trade the spread.`);
        } else {
          lines.push(`   🎯 EVENT-DRIVEN. Ordinary technical rules do not apply — the acquirer's consideration prices this security. Evaluate as an arbitrage / event-driven play only.`);
        }
      } else {
        const targetSrcLabel = p.targetSource
          ? ` [${p.targetSource === "swing-high" ? "prior resistance"
                : p.targetSource === "measured-move" ? "measured move"
                : p.targetSource === "atr-2x" ? "2×ATR extension"
                : p.targetSource === "pct-floor" ? "pct-floor"
                : p.targetSource}]`
          : "";
        lines.push(`   Entry ~$${p.entryPrice.toFixed(2)} · target $${p.targetPrice.toFixed(2)} (+${upsidePct.toFixed(1)}%)${targetSrcLabel} · stop $${p.stopPrice.toFixed(2)} (−${downsidePct.toFixed(1)}%) · R/R ${rrStr} · verified live $${p.verifiedPrice.toFixed(2)}`);
        if (tier === "SCREENED") {
          lines.push(`   ⛔ SCREENED — composite ${p.deterministicScore} is strong but current entry/target/stop only yields R/R ${rrStr} (BUY floor: ${MIN_RR_FOR_BUY}:1). Wait for pullback or improved target structure before treating as actionable.`);
        } else if (tier === "SCREENED-BEAR") {
          lines.push(`   ⛔ SCREENED — BEAR CASE. Adversarial verify verdict: **reject**. ${adversarial?.bearThesis || ""}`);
          if (adversarial?.weakestPoint) lines.push(`   Weakest point of bull thesis: ${adversarial.weakestPoint}`);
          if (adversarial?.hiddenRisk) lines.push(`   Hidden risk: ${adversarial.hiddenRisk}`);
        } else if (tier === "SCREENED-CHART") {
          lines.push(`   ⛔ SCREENED — CHART BEARISH. Chart-vision veto: ${chartVisionEntry?.verdict?.reason || "bearish structure"}.`);
          if (chartVisionEntry?.analysis?.gestalt) lines.push(`   Chartist gestalt: ${chartVisionEntry.analysis.gestalt}`);
          if (chartVisionEntry?.analysis?.trendStage) lines.push(`   Trend stage: ${chartVisionEntry.analysis.trendStage} · conviction ${chartVisionEntry.analysis.conviction || "?"}`);
        } else if (tier === "WATCH") {
          const trig = p.watchTrigger;
          lines.push(`   ⚠ WATCH — requires ${trig.why} to reach ≥${MIN_RR_FOR_BUY}:1. Set alert @ $${trig.price.toFixed(2)}${p.currency ? ` ${p.currency}` : ""}. Not actionable until the trigger fires.`);
        }
        if (isConflict) {
          lines.push(`   ⚠ MTF conflicting — treat as watchlist entry, wait for confluence to align before committing size.`);
        }
        // Adversarial "risk_flagged" verdict — pick stays actionable
        // but the bear case gets surfaced so the operator can size
        // accordingly.
        if (tier !== "SCREENED-BEAR" && adversarial?.verdict === "risk_flagged") {
          lines.push(`   ⚠ Adversarial verify: risk flagged — ${adversarial.bearThesis}`);
          if (adversarial.weakestPoint) lines.push(`   Weakest point: ${adversarial.weakestPoint}`);
        } else if (tier !== "SCREENED-BEAR" && adversarial?.verdict === "confirmed_long") {
          lines.push(`   ✓ Adversarial verify: bear-case attack failed — thesis holds under stress.`);
        }
        // Chart-vision soft warning (non-veto)
        if (tier !== "SCREENED-CHART" && chartVisionEntry?.verdict?.softWarning) {
          lines.push(`   ⚠ Chart vision: ${chartVisionEntry.verdict.reason}`);
        } else if (tier === "BUY" && chartVisionEntry?.analysis?.gestalt) {
          // On confirmed BUY, surface the chartist gestalt as a
          // positive framing.
          lines.push(`   ✓ Chart vision: ${chartVisionEntry.analysis.gestalt}`);
        }
        if (p.rationale) lines.push(`   ${p.rationale}`);
      }
      // External Recommendation Discovery Layer — surface confluence
      // signals per pick. Purely additive presentation; no gate change.
      // baseComposite = deterministicScore (unchanged). Both the base
      // and the enhanced values are shown so the operator can see the
      // external layer's contribution and it can be measured over time.
      try {
        const { getExternalConvictionForTicker, formatExternalDiscoveryBlock } = await import("../services/stocksExternalNominations.js");
        const conviction = await getExternalConvictionForTicker(p.ticker, {
          currency: p.currency || "USD",
          baseComposite: p.deterministicScore,
        });
        if (conviction && conviction.nominations && conviction.nominations.length > 0) {
          const enhanced = (p.deterministicScore || 0) + (conviction.externalAdjustment || 0);
          if (conviction.externalAdjustment > 0) {
            lines.push(`   base composite ${p.deterministicScore} + external adjustment +${conviction.externalAdjustment} → enhanced composite ${enhanced}`);
          }
          const externalBlock = formatExternalDiscoveryBlock(conviction);
          if (externalBlock) {
            for (const l of externalBlock.split("\n")) {
              // Indent under the pick block for visual grouping.
              lines.push(l.startsWith("   ") || l.trim() === "" ? l : `   ${l}`);
            }
          }
        }
      } catch (e) {
        // Never let external-signal fetch break the picks block.
        console.warn(`[external-discovery-render] ${p.ticker}:`, e?.message);
      }
      lines.push("");
    }
  } else if (suppressed.length === 0 && blockedRaw.length === 0) {
    lines.push("_None passed today's screens._");
    lines.push("");
  }
  if (suppressed.length > 0) {
    lines.push(`⚠ **${suppressed.length} pick${suppressed.length === 1 ? "" : "s"} SUPPRESSED — PRICE VERIFICATION FAILED** (independent quote disagreed with pick-engine price beyond tolerance). Do NOT act on these tickers until the data source is investigated:`);
    for (const s of suppressed) {
      lines.push(`- **${s.ticker}** — ${s.reason}`);
    }
    lines.push("");
  }
  if (blockedRaw.length > 0) {
    lines.push(`_${blockedRaw.length} candidate${blockedRaw.length === 1 ? "" : "s"} blocked by validator — informational only:_`);
    for (const p of blockedRaw) {
      lines.push(`- **${p.ticker}** @ ~$${p.entryPrice.toFixed(2)} — ${p.blockedReason}`);
    }
    lines.push("");
  }
  if (reconciliationFailed.length > 0) {
    lines.push(`⚠ **${reconciliationFailed.length} pick${reconciliationFailed.length === 1 ? "" : "s"} STRIPPED — RECONCILIATION AUDIT FAILED** (composite arithmetic did not reconcile to displayed value):`);
    for (const f of reconciliationFailed) {
      lines.push(`- **${f.ticker}** — ${f.issues.map(i => `[${i.code}] ${i.detail}`).join(" · ")}`);
    }
    lines.push("");
  }
  // Tier 3.2 (audit Aug-28): append labeled moonshot row when a
  // fresh (≤14d) asymmetric-upside pick exists in the discovery
  // corpus. Purely additive to the briefing — deterministic picks
  // above are unaffected. Small-position language + calibrated base
  // rates enforce lottery-ticket sizing discipline.
  if (ctx?.email) {
    try {
      const { getLatestMoonshotForBriefing, formatMoonshotBriefingBlock } = await import("../services/stocksMoonshot.js");
      const latest = await getLatestMoonshotForBriefing({ email: ctx.email, maxAgeDays: 14 });
      if (latest) {
        const block = formatMoonshotBriefingBlock(latest);
        if (block) {
          lines.push(block);
          lines.push("");
        }
      }
    } catch (e) {
      console.warn("[daily-picks-moonshot-append] failed:", e?.message);
    }
  }
  return lines.join("\n");
}

function formatDailyPicksBlock(dailyPicks) {
  if (!Array.isArray(dailyPicks) || dailyPicks.length === 0) return "";
  // Split into allowed vs blocked. Blocked picks are demoted to a
  // one-line Watch List entry in §A3 only — no §4 narrative, no
  // scoring paragraph, no <RECS> entry. Per user Aug 5 directive:
  // "recommending something and simultaneously saying it's forbidden"
  // creates cognitive noise + encourages override — silent surface
  // as Watch List only.
  const allowed = dailyPicks.filter(p => !p.blockedReason);
  const blocked = dailyPicks.filter(p => p.blockedReason);
  const parts = [];
  if (allowed.length > 0) {
    const lines = allowed.map((p, i) => {
      const sleeveTag = classifyPosition({ ticker: p.ticker });
      return `Pick ${i + 1} [sleeve=${sleeveTag}]: ${p.ticker} @ $${p.entryPrice.toFixed(2)} · target $${p.targetPrice.toFixed(2)} · stop $${p.stopPrice.toFixed(2)} · score ${p.deterministicScore}${p.setupName ? ` · setup: ${p.setupName}` : ""}${p.mtfConfluence ? ` · MTF ${p.mtfConfluence}` : ""}\n    · ${p.rationale}`;
    });
    parts.push(`\nTODAY'S ${allowed.length} SWING-TRADE PICKS (deterministic composite, sleeve-tagged — must appear in briefing under a "## 🎯 Today's Swing-Trade Picks" section, one narrative paragraph per pick, and MUST appear in the trailing <RECS> block):
${lines.join("\n")}`);
  }
  if (blocked.length > 0) {
    const lines = blocked.map(p => `  ${p.ticker} @ ~$${p.entryPrice.toFixed(2)} — BLOCKED (${p.blockedReason}).`);
    parts.push(`\nBLOCKED DAILY-PICK CANDIDATES — DO NOT SURFACE AS SWING PICKS. For each, emit EXACTLY ONE line inside §A3 Watch List: "TICKER — set GTC alert near ~$X, unblocks when [condition]." NO §4 narrative, NO §7/§8 SPEC/SWING entry, NO scoring rationale, NO setup-name paragraph, NO entry in the trailing <RECS> block. If they wouldn't already have a Watch List entry, this is their ONLY appearance in the brief. Emitting these as anything other than a one-line Watch List alert is a compliance violation.
${lines.join("\n")}`);
  }
  return parts.join("\n") + "\n";
}

// Top Discovery candidates — sourcing pool for the SPEC sleeve in
// section 7. These are the picks that survived the full high-conviction
// pipeline (deterministic composite → AI thesis → adversarial verify →
// chart vision). Sleeve-tagged so the AI knows which fit spec vs swing.
function formatDiscoveryPoolBlock(discoveryPool) {
  if (!Array.isArray(discoveryPool) || discoveryPool.length === 0) return "";
  const enriched = discoveryPool.map((c) => ({ ...c, sleeve: classifyPosition({ ticker: c.ticker }) }));
  const spec = enriched.filter((c) => c.sleeve === "spec").slice(0, 6);
  const swing = enriched.filter((c) => c.sleeve === "swing").slice(0, 4);
  if (spec.length === 0 && swing.length === 0) return "";
  const line = (c) => `  ${c.ticker} [${c.sleeve}] · score ${c.score}${c.multiFactor?.riskRating ? ` · ${c.multiFactor.riskRating}` : ""}${c.priceAtDiscovery ? ` · disc $${c.priceAtDiscovery} ${c.currencyAtDiscovery || "USD"}` : ""}${c.multiFactor?.projection?.entryZone ? ` · entry zone ${c.multiFactor.projection.entryZone}` : ""}${c.multiFactor?.projection?.target ? ` · target $${c.multiFactor.projection.target}` : ""}${c.multiFactor?.projection?.stop ? ` · stop $${c.multiFactor.projection.stop}` : ""}${c.thesis?.bullCase ? ` · "${String(c.thesis.bullCase).slice(0, 140)}"` : ""}`;
  const lines = [
    `\nDISCOVERY POOL (last 45d, score ≥ 60, unowned — pre-vetted candidates for sections 7/8):`,
  ];
  if (spec.length > 0) {
    lines.push(`  ${spec.length} SPEC-sleeve candidates (use ONLY these for section 7 aggressive-new-ideas when SPEC sleeve has room):`);
    lines.push(...spec.map(line));
  }
  if (swing.length > 0) {
    lines.push(`  ${swing.length} SWING-sleeve candidates (use these to supplement Test A daily picks in section 8 when the top daily pick doesn't fit SWING):`);
    lines.push(...swing.map(line));
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic prefix renderer — replaces the AI on the mechanical
// sections at the top of the briefing (0 / 0c / 0d).
//
// These three sections are pure formatting passes over input blocks
// the backend already computed. Prior to this refactor the AI was
// asked to restate them in a fixed format, and it occasionally slipped
// — e.g. renaming a ticker, dropping a stop-tier line, or (worst)
// inventing an EXIT-AT-MARKET for a ticker whose basis was already
// corrupted upstream. Rendering them here means the section text is
// guaranteed to match the underlying data byte-for-byte.
//
// SCOPE: only sections that are purely mechanical. Left to the AI:
//   • Section 0b (Trades you executed) — the "on-track / halfway to
//     target / stop tightening" language per BUY leg is analytical.
//   • Section 0f (Horizon review) — per-row EXIT / ROLL / TRIM /
//     PATIENCE calls are analytical judgment.
//
// The behavioural rules that FLOW from these sections (SPEC over
// limit → no new spec in 4/7/8, CORE underweight → close section 4
// with a XIC/VUN/XEQT nudge) stay in the AI prompt; only the
// section-body formatting moves out.
//
// Returns "" when none of the three sections have anything to
// surface, so the AI-generated briefing renders unchanged in the
// quiet-tape case.
// ─────────────────────────────────────────────────────────────────────
// Daily Orders — the new briefing structure (task #133 follow-on).
// Discipline-enforcing header that comes BEFORE the AI's narrative:
//   1. MANDATORY ACTIONS  — every non-discretionary decision, priority-ordered
//   2. FORBIDDEN TODAY    — every hard rule blocking new ideas
//   3. ONE-LINE STATUS    — 5-second scannable summary
//   4. OPTIONAL           — placeholder for AI-generated ideas below
//
// Everything in sections 1/2/3 is derived deterministically from monitors
// the app already runs (stopMonitor, sleeveBalance, horizonRows). The AI
// writes section 4 beneath (compact TICKER|ACTION|... table format) and
// pushes monthly reports, macro, per-holding essays into an Appendix at
// the very bottom.
//
// Design goals baked in:
//   • Actionable part (§1-2) readable in ≤90 seconds.
//   • Corrupted/low-confidence prices can never generate a SELL order —
//     implausible-loss (≤-50%) hard-stops are converted to VERIFY MANUALLY.
//   • CORE-under-70% locks new discretionary buys via §2.
//   • Sleeve/concentration rules are structural, not advisory.
// Concentration cap thresholds — single source of truth. Both the
// prefix mandate emitter and the post-gen canonical re-computer read
// these so the tolerance band applies consistently across paths.
// SINGLE_NAME_CAP_PCT = hard target the trim tries to bring you to.
// SINGLE_NAME_CAP_TOLERANCE_PP = don't fire the mandate until the
// position is materially over (avoids a $700 trim on 20.9% that
// would land 19.8% and rack up commission + FX drag for nothing).
// SINGLE_NAME_CAP_FIRING_PCT = threshold that actually triggers.
const SINGLE_NAME_CAP_PCT = 20;
// User Aug 8: "the 20% should be for the setup, but trim recs should
// have a 2% tolerance." So the mandate fires only when a position
// crosses 22% (materially over) and then trims to bring it back to
// ≤ 20% (the setup target). The 20-22% band is a no-fire dead zone.
const SINGLE_NAME_CAP_TOLERANCE_PP = 2.0;
const SINGLE_NAME_CAP_FIRING_PCT = SINGLE_NAME_CAP_PCT + SINGLE_NAME_CAP_TOLERANCE_PP;

// One-line description of every ticker the mandate emitters can
// suggest via pickDefaultTicket. Rendered inline in the mandate so
// the operator sees WHAT the ETF actually is (holdings, MER,
// geography, thesis) instead of a bare symbol. User Aug 8: "if you
// are going to make a rec like XEQT, then at least say what it is
// and why it is a good setup!" — this closes that gap.
const MANDATE_TICKER_DESCRIPTIONS = {
  // CORE CAD-listed — hoped-for return ≈ global/US/CDN equity long-term averages; horizon multi-decade
  "XEQT.TO": { what: "iShares Core Equity ETF Portfolio — all-equity global mix (~45% US, 25% CAD, 25% intl, 5% EM), 0.20% MER, one-ticker diversified equity core", ret: "~7-9% annualized (global equity long-term)", horizon: "10+ yrs · buy-and-hold; expect -20 to -40% drawdowns" },
  "VUN.TO": { what: "Vanguard US Total Market (CAD-listed unhedged) — full US market ~3600 stocks, 0.16% MER, US exposure without FX conversion", ret: "~8-10% annualized (US equity long-term)", horizon: "10+ yrs · buy-and-hold; unhedged FX is +/-" },
  "XIU.TO": { what: "iShares S&P/TSX 60 — Canada's 60 largest, 0.18% MER, home-market large-cap core", ret: "~6-8% annualized (TSX long-term, ~1/3 financials + energy)", horizon: "10+ yrs · buy-and-hold" },
  "XIC.TO": { what: "iShares Core S&P/TSX Capped Composite — broader Canadian market (~230 names), 0.06% MER", ret: "~6-8% annualized (TSX long-term)", horizon: "10+ yrs · buy-and-hold" },
  // CORE USD-listed
  "VOO": { what: "Vanguard S&P 500 ETF — 500 largest US companies, 0.03% MER, cheapest S&P vehicle", ret: "~8-10% annualized (S&P long-term)", horizon: "10+ yrs · buy-and-hold" },
  "VTI": { what: "Vanguard Total US Market — ~3600 US stocks, 0.03% MER, broader than S&P", ret: "~8-10% annualized (US equity)", horizon: "10+ yrs · buy-and-hold" },
  "QQQ": { what: "Invesco QQQ Trust — NASDAQ-100 (AAPL/MSFT/NVDA/GOOG/AMZN weight ~40%), 0.20% MER, tech-heavy", ret: "~10-13% annualized long-term but higher vol (tech beta)", horizon: "10+ yrs · higher-vol equity core" },
  // INCOME CAD-listed dividend payers
  "RY.TO": { what: "Royal Bank of Canada — largest Canadian bank, eligible dividend, dividend growth 20+ yrs", ret: "~4% yield + ~4-6% growth = ~8-10% total", horizon: "5-10+ yrs · income compounder" },
  "TD.TO": { what: "Toronto-Dominion Bank — Canada's #2 bank + major US retail, eligible dividend", ret: "~5% yield + ~3-5% growth = ~8-10% total", horizon: "5-10+ yrs · income compounder" },
  "BMO.TO": { what: "Bank of Montreal — Canada's 4th largest bank, eligible dividend", ret: "~4.5% yield + ~3-5% growth = ~7-9% total", horizon: "5-10+ yrs · income compounder" },
  "BNS.TO": { what: "Bank of Nova Scotia — international footprint (Latin America), eligible dividend, higher yield reflects LatAm risk", ret: "~6% yield + ~2-4% growth = ~8-10% total, higher variance", horizon: "5-10+ yrs · income + turnaround" },
  "TRP.TO": { what: "TC Energy — pipeline/midstream infrastructure, eligible dividend, regulated rate base", ret: "~7% yield + ~2-3% growth = ~9-10% total", horizon: "5-10+ yrs · regulated income" },
  "ENB.TO": { what: "Enbridge — largest North American pipeline network, eligible dividend, 28+ yrs of hikes", ret: "~7% yield + ~3% growth = ~10% total", horizon: "5-10+ yrs · regulated income compounder" },
  // INCOME USD-listed dividend aristocrats
  "KO": { what: "Coca-Cola — dividend aristocrat 60+ yrs, defensive consumer staples", ret: "~3% yield + ~5% growth = ~8% total", horizon: "5-10+ yrs · defensive compounder" },
  "PEP": { what: "PepsiCo — dividend aristocrat 50+ yrs, snacks + beverages", ret: "~3% yield + ~5% growth = ~8% total", horizon: "5-10+ yrs · defensive compounder" },
  "JNJ": { what: "Johnson & Johnson — dividend aristocrat 60+ yrs, healthcare defensive", ret: "~3% yield + ~4-6% growth = ~7-9% total", horizon: "5-10+ yrs · defensive healthcare" },
  "PG": { what: "Procter & Gamble — dividend aristocrat 65+ yrs, consumer staples", ret: "~2.5% yield + ~5-7% growth = ~8-10% total", horizon: "5-10+ yrs · quality compounder" },
  "MO": { what: "Altria — high-yield tobacco, dividend aristocrat", ret: "~8% yield + 0-2% growth = ~8-10% total, terminal-decline risk", horizon: "5+ yrs · yield-heavy, low growth" },
  "ABBV": { what: "AbbVie — pharma with Humira patent risk mitigated by Skyrizi/Rinvoq ramp, dividend aristocrat via Abbott spinoff", ret: "~4% yield + ~3-5% growth = ~7-9% total", horizon: "5-10+ yrs · large pharma" },
  "MRK": { what: "Merck — pharma with Keytruda oncology franchise", ret: "~3% yield + ~5-8% growth = ~8-11% total, Keytruda LOE 2028", horizon: "5-10+ yrs · large pharma" },
  "XOM": { what: "ExxonMobil — integrated oil major, dividend aristocrat", ret: "~3.5% yield + ~3-5% growth = ~7-9% total, oil-price sensitive", horizon: "5-10+ yrs · energy defensive" },
  "CVX": { what: "Chevron — integrated oil major, dividend aristocrat 35+ yrs", ret: "~4% yield + ~3-5% growth = ~7-9% total", horizon: "5-10+ yrs · energy defensive" },
  "O": { what: "Realty Income — monthly-pay REIT, retail net-lease", ret: "~5.5% yield + ~2-4% growth = ~8-10% total, rate-sensitive", horizon: "5-10+ yrs · income" },
  "VZ": { what: "Verizon — telecom, high yield reflects modest growth outlook", ret: "~6.5% yield + ~0-2% growth = ~7-9% total", horizon: "3-7 yrs · yield-heavy" },
  "MMM": { what: "3M — dividend aristocrat, industrial conglomerate with litigation overhang", ret: "~6% yield + uncertain growth (litigation drag)", horizon: "5+ yrs · turnaround/yield" },
};

function describeTicker(ticker) {
  const t = MANDATE_TICKER_DESCRIPTIONS[ticker];
  if (!t) return "";
  return `\n     ↳ **What:** ${t.what}\n     ↳ **Expected return:** ${t.ret}\n     ↳ **Horizon:** ${t.horizon}`;
}

// Every BUY-ticket emitter appends this so the operator never has to
// place a rec without a stop level. Sleeve-derived pct is on the
// ticket already (pickDefaultTicket adds derivedStop + label). User
// Aug 8: "in all BUY recs, I want the stop to be stated as well."
function stopClause(ticket) {
  if (!ticket || !(ticket.derivedStop > 0)) return "";
  return ` · **Stop:** $${ticket.derivedStop.toFixed(2)} ${ticket.liveCcy} (${ticket.derivedStopPctLabel})`;
}

// Pre-LLM funding validator. Post-processes the deterministic prefix
// output to strip any BUY mandate whose (account, currency) bucket
// can't fund it from starting cash + same-bucket SELL/TRIM proceeds.
// The AI never sees the stripped ticket, so the impossible redeploy
// can't survive into the briefing text or the audit gate.
//
// Contract:
//   input : md (deterministic prefix), mandateRecs (structured recs),
//           canonical portfolio (source of truth for per-account cash)
//   output: filtered md + filtered mandateRecs + fundingStripped[]
//           (audit trail — what got removed and why)
export function validateMandateFunding({ md, mandateRecs, canonical }) {
  const fundingStripped = [];
  if (!canonical || !Array.isArray(mandateRecs) || mandateRecs.length === 0) {
    return { md, mandateRecs, fundingStripped };
  }
  // Bucket every mandate rec by (account_name, currency). SELL/TRIM
  // in a bucket generates proceeds; BUY/ADD spends. A bucket clears
  // only when starting cash + proceeds >= cost.
  const buckets = new Map();
  for (const r of mandateRecs) {
    const acct = String(r.account || "").trim();
    const ccy  = String(r.entryCurrency || "").toUpperCase();
    if (!acct || !ccy) continue; // no bucket → skip (audit will still catch)
    const key = `${acct}|${ccy}`;
    if (!buckets.has(key)) buckets.set(key, { account: acct, currency: ccy, recs: [] });
    buckets.get(key).recs.push(r);
  }
  const droppedRecs = new Set();
  for (const [, bucket] of buckets) {
    // Starting cash for this bucket from canonical accounts.
    const acctRow = (canonical.accounts || []).find(a =>
      String(a.account_name || "").trim().toLowerCase() === bucket.account.toLowerCase()
    );
    const startingCash = bucket.currency === "CAD"
      ? (acctRow?.cash_cad || 0)
      : bucket.currency === "USD" ? (acctRow?.cash_usd || 0)
      : 0;
    let proceeds = 0;
    let cost = 0;
    for (const r of bucket.recs) {
      const shares = Number(r.sizeShares) || 0;
      const price  = Number(r.entryPrice) || 0;
      if (shares <= 0 || price <= 0) continue;
      const val = shares * price;
      if (["SELL", "EXIT", "TRIM"].includes(r.action)) proceeds += val;
      else if (["BUY", "ADD"].includes(r.action)) cost += val;
    }
    const available = startingCash + proceeds;
    if (cost <= available + 1) continue; // clears with $1 rounding tolerance
    // Bucket is underfunded — drop BUY recs one-at-a-time (LIFO)
    // until cost fits available. LIFO because the LAST BUY added
    // is the marginal one that pushed the bucket over.
    let remainingCost = cost;
    const buysReversed = bucket.recs
      .filter(r => ["BUY", "ADD"].includes(r.action))
      .reverse();
    for (const buy of buysReversed) {
      if (remainingCost <= available + 1) break;
      const val = (Number(buy.sizeShares) || 0) * (Number(buy.entryPrice) || 0);
      remainingCost -= val;
      droppedRecs.add(buy);
      fundingStripped.push({
        ticker: buy.ticker,
        account: bucket.account,
        currency: bucket.currency,
        shortfall: cost - available,
        droppedShares: buy.sizeShares,
        droppedCost: val,
        sourceLabel: buy.sourceLabel,
      });
    }
  }
  if (droppedRecs.size === 0) return { md, mandateRecs, fundingStripped };
  // Strip the corresponding mandate LINES from the prefix text.
  // Each mandate rec has ticker + sizeShares; the mandate line
  // contains "BUY <N> sh <TICKER>" (or ADD). Match and delete the
  // whole line so the AI never sees the ticket. If we can't match,
  // leave the line — the audit gate will still catch it.
  let filteredMd = md;
  for (const dropped of droppedRecs) {
    const t = String(dropped.ticker || "").replace(/[.^$*+?()[\]{}|\\]/g, "\\$&");
    const n = Number(dropped.sizeShares) || 0;
    if (!t || !n) continue;
    // Match a whole line containing e.g. "BUY 33 sh DPM.TO" or "ADD 12 sh AAPL".
    const lineRe = new RegExp(`^.*\\b(?:BUY|ADD)\\s+${n}\\s+sh\\s+${t}\\b.*$`, "gmi");
    filteredMd = filteredMd.replace(lineRe, `_[funding-stripped] ${dropped.ticker} BUY dropped — bucket underfunded_`);
  }
  const filteredRecs = mandateRecs.filter(r => !droppedRecs.has(r));
  return { md: filteredMd, mandateRecs: filteredRecs, fundingStripped };
}

function renderDeterministicPrefix({ monitorAlerts, monitorStopHitRecs = [], stopMonitor, sleeveBalance, positions, cashAccounts, fxUsdCad, horizonRows, tradingRegime, sectorRotation, sectorTransitions = null, recentExits, mandateLivePrices, riskVar, quantSignals, pickGateStatus = null, dailyPicks = [] }) {
  // Concentration mandate metadata (populated inside the §1 loop below).
  // Returned alongside the rendered markdown so the caller can enforce
  // these lines as the authoritative version in the final briefing —
  // even if the AI mimics the mandate format with downscaled numbers.
  const concentrationMandates = [];
  // Mandate BUYs the prefix emits (CORE REBALANCE, CASH DEPLOY, paired
  // CORE DEPLOY / REDEPLOY, IF-EXIT REDEPLOY, TRIM SPEC CORE DEPLOY).
  // Persisted by the caller as StocksAdviceRec docs so the CIBC trade
  // linker (findMatchingOpenRec) can attach a subsequent user-executed
  // BUY to the mandate that told them to do it. User Aug 8: bought 74
  // sh XEQT after the CORE REBALANCE mandate and briefing said "no
  // linked rec" — because mandate BUYs lived only in markdown, never
  // as searchable rec docs.
  const mandateRecs = [];
  // Base-ticker set for stops classified TRAIL_SOFT — surfaced up to
  // the caller so DO TODAY / AI-accepted SELL recs on these tickers
  // can be filtered out before they hit the reader. TRAIL_SOFT means
  // "REVIEW only — no MANDATORY EXIT".
  const trailSoftTickers = new Set();
  const addMandateRec = (ticket, kind, accountName = null) => {
    if (!ticket || !ticket.ticker || !(ticket.livePrice > 0)) return;
    mandateRecs.push({
      ticker: ticket.ticker,
      action: "BUY",
      entryPrice: ticket.livePrice,
      entryCurrency: ticket.liveCcy,
      stopPrice: ticket.derivedStop ?? null,
      targetPrice: null, // mandates are structural rebalance BUYs, not target-hunts
      horizonDays: 30,   // reasonable default; linker uses ±30d window anyway
      sizeShares: ticket.shares,
      account: accountName,
      sourceLabel: `mandate:${kind}`,
    });
  };
  // Alias — kept as ctxRecentExits inside so callers don't have to
  // rebind if the param name changes later.
  const ctxRecentExits = recentExits || [];
  const ctxLivePrices = mandateLivePrices || {};

  // Pick a concrete default ticker + compute share count for a mandate.
  // Grok clarity rule #3: every mandatory action becomes ONE executable
  // order ticket. Falls back to null when we can't pick a specific
  // ticker (no live price, all candidates recently exited, etc.) —
  // caller then keeps the older list-of-options wording.
  //
  // list: ordered by preference; first available wins.
  // targetCad: total CAD budget for the buy.
  // deployCurrency: "CAD" or "USD" — determines whether we FX-convert.
  // Per-ticker sanity floors mirror marketDataIntegrity's SANITY_FLOORS.
  // Local copy so a broken live price for VTI/VOO/etc. can never appear
  // in a mandate — the integrity layer catches it too, but this is a
  // second, independent line of defence at the render layer. Was
  // producing "BUY 5 sh VTI @ $0.38 USD" mandates in a real briefing.
  const PICK_SANITY_FLOORS = {
    VTI: 100, VOO: 200, SPY: 300, QQQ: 300, IWM: 100, VUG: 200, SCHG: 20,
    "XEQT.TO": 20, "XIU.TO": 30, "XIC.TO": 25, "VUN.TO": 60, "VFV.TO": 100,
    "AAPL": 80, "MSFT": 200, "GOOGL": 100, "AMZN": 100, "META": 200, "NVDA": 50,
  };
  const passSanityFloor = (ticker, price) => {
    const floor = PICK_SANITY_FLOORS[String(ticker || "").toUpperCase()];
    return !Number.isFinite(floor) || price >= floor;
  };
  const pickDefaultTicket = (list, targetCad, deployCurrency) => {
    if (!(targetCad > 0)) return null;
    const wantCcy = String(deployCurrency || "").toUpperCase();
    const rawFiltered = (list || [])
      .filter(t => !ctxRecentExits.includes(t))
      .filter(t => ctxLivePrices[t]?.price > 0)
      // STRICT same-currency gate. Cross-currency picks implied an
      // FX conversion / cross-account transfer that the operator was
      // then expected to arrange. That produced "buy $1186 CAD of X"
      // orders in RRSP/CAD buckets with no CAD cash, because the SELL
      // proceeds were USD in a different account. Same currency only
      // — no fallback. If no eligible ticker exists in the caller's
      // currency, return null so the caller can degrade the mandate
      // rather than shipping an unfundable ticket.
      .filter(t => {
        if (!wantCcy) return true; // caller didn't specify — permissive
        const liveCcy = String(ctxLivePrices[t]?.currency || "USD").toUpperCase();
        if (liveCcy !== wantCcy) {
          console.warn(`[pickDefaultTicket] REJECT ${t} — live currency ${liveCcy} ≠ deploy currency ${wantCcy} (no cross-currency fallback)`);
          return false;
        }
        return true;
      });
    // Sanity-floor filter — drop any candidate whose live price
    // dropped below its known-good floor. A failure here means the
    // integrity layer would have caught this on the way to a rec,
    // but we belt-and-brace at render time too.
    const filtered = rawFiltered.filter(t => {
      const p = ctxLivePrices[t]?.price;
      if (!passSanityFloor(t, p)) {
        console.warn(`[pickDefaultTicket] REJECT ${t} — live price $${p} below sanity floor`);
        return false;
      }
      return true;
    });
    if (filtered.length === 0) return null;
    const ticker = filtered[0];
    const live = ctxLivePrices[ticker];
    const liveCcy = String(live.currency || deployCurrency || "USD").toUpperCase();
    // Post-gate assertion — the filter above should have caught this,
    // but a defense-in-depth check is cheap.
    if (wantCcy && liveCcy !== wantCcy) {
      console.warn(`[pickDefaultTicket] REJECT ${ticker} — currency assertion failed (${liveCcy} vs ${wantCcy})`);
      return null;
    }
    const fx = fxUsdCad || 1.37;
    // Convert budget from the caller's supplied unit to the live
    // price's currency so share count is correct. Historical callers
    // pass a CAD-equivalent budget even when deploying into USD (or
    // vice versa); the strict same-currency gate above ensures the
    // picked ticker matches wantCcy, so this conversion is purely
    // caller-convenience — the trade itself never crosses currency.
    let budgetInNative;
    if (liveCcy === deployCurrency) budgetInNative = targetCad;
    else if (liveCcy === "USD" && deployCurrency === "CAD") budgetInNative = targetCad / fx;
    else if (liveCcy === "CAD" && deployCurrency === "USD") budgetInNative = targetCad * fx;
    else budgetInNative = targetCad;
    const shares = Math.floor(budgetInNative / live.price);
    if (!(shares > 0)) return null;
    const usedNative = shares * live.price;
    const usedCad = liveCcy === "CAD" ? usedNative
      : liveCcy === "USD" ? usedNative * fx : usedNative;
    const alternatives = filtered.slice(1, 4).join(" / ");
    // Derived stop for every default-ticket BUY. Sleeve-aware because
    // "if this breaks I'm wrong" means different things for a broad
    // ETF vs a dividend bank vs a swing name. User Aug 8: "in all
    // BUY recs, I want the stop to be stated as well." Percentage
    // below live price:
    //   CORE ETF   → -15% (regime-level break)
    //   INCOME     → -12% (dividend cut / cost-basis broken)
    //   SWING/SPEC → -8%  (matches sleeve enforcer hard stop)
    const stopSleeve = classifyPosition({ ticker });
    const stopPct = stopSleeve === "core" ? 0.15
                  : stopSleeve === "income" ? 0.12
                  : 0.08;
    const derivedStop = live.price * (1 - stopPct);
    const derivedStopPctLabel = `-${(stopPct * 100).toFixed(0)}%`;
    return {
      ticker,
      livePrice: live.price,
      liveCcy,
      shares,
      usedNative,
      usedCad,
      alternatives,
      derivedStop,
      derivedStopPctLabel,
    };
  };
  const chunks = [];
  const m = (v) => `$${Math.round(v).toLocaleString()} CAD`;
  const IMPLAUSIBLE_LOSS_PCT = -50;
  const CORE_LOCK_GAP_PP = 10; // if CORE is >10pp under target, block new non-CORE buys

  // ─── Split hard-stops into confirmed vs implausible-suspect ───
  const stopHits = stopMonitor?.hardStopHit || [];
  const confirmedStops = [];
  const suspectStops = [];
  for (const r of stopHits) {
    if (r.pnlPct <= IMPLAUSIBLE_LOSS_PCT) {
      suspectStops.push(r);
      console.warn(`[stop-check] SUPPRESSED implausible EXIT for ${r.ticker}: pnl ${r.pnlPct.toFixed(1)}% (basis $${r.costBasis}, now $${r.currentPrice}) — likely data-feed corruption`);
    } else {
      confirmedStops.push(r);
    }
  }
  const withinStops = stopMonitor?.withinStop || [];

  // ─── Stop severity classifier (user spec 2026-08-11) ───
  // Single source of truth so §1 mandate, DO TODAY, and prose can't
  // contradict each other on the same ticker.
  //   HARD        = cost-basis breach (position-monitor hardStopHit)
  //   TRAIL_HARD  = trail hit AND drawdown from 60d peak ≥ TRAIL_HARD_DRAWDOWN_PCT
  //   TRAIL_SOFT  = trail hit, drawdown < TRAIL_HARD_DRAWDOWN_PCT, no hard-stop breach
  //
  // TRAIL_SOFT is a REVIEW event ONLY — never emits SELL AT MARKET,
  // never populates DO TODAY, never triggers CORE DEPLOY pairing.
  // The RY case 2026-08-07 / 2026-08-11 (through trail by <1%,
  // drawdown ~4%): current code emitted SELL AT MARKET via the
  // rec-stop path AND TRAIL STOP REVIEW via the trail path — three
  // contradictory instructions for one ticker.
  const TRAIL_HARD_DRAWDOWN_PCT = 6; // ≥ 6% drawdown from 60d peak
  const classifyStopSeverity = ({ ticker, drawdownPct, isHardStopHit }) => {
    if (isHardStopHit) return "HARD";
    const dd = Number.isFinite(drawdownPct) ? Math.abs(drawdownPct) : null;
    if (dd != null && dd >= TRAIL_HARD_DRAWDOWN_PCT) return "TRAIL_HARD";
    return "TRAIL_SOFT";
  };
  // Look up 60d drawdown for a ticker from quantSignals (already
  // gathered for the trailReviews loop). Returns null if unavailable.
  const drawdownForTicker = (ticker) => {
    const key = String(ticker || "").toUpperCase();
    const sig = (quantSignals || {})[key] || (quantSignals || {})[key.replace(/\..*$/, "")];
    return sig?.tech?.drawdownFromHigh60dPct ?? null;
  };
  // Base-ticker set of positions already in the hardStopHit list — used
  // to decide whether a rec-stop hit is HARD (position-monitor also
  // fired) or a trail-level breach.
  const hardStopHitBaseSet = new Set(
    confirmedStops.map(r => String(r.ticker || "").toUpperCase().replace(/\..*$/, ""))
  );

  // ─── Sleeve status flags ───
  const b = sleeveBalance;
  const coreGapPp = b?.actualPct?.core != null && b?.targetsPct?.core != null
    ? b.targetsPct.core - b.actualPct.core : 0;
  const coreLockActive = coreGapPp > CORE_LOCK_GAP_PP;
  const specOver = !!b?.specOverLimit;
  const swingHasRoom = !!b?.swingUnderweight;

  // ─── Horizon expiries needing action ───
  const expiredRecs = (horizonRows || []).filter(r => r.status === "expired");
  const wellBehindRecs = (horizonRows || []).filter(r => r.status === "well-behind" && r.daysElapsed / r.horizonDays >= 0.6);

  // ─── § 1. MANDATORY ACTIONS ───
  chunks.push("## 1. 🚨 MANDATORY ACTIONS (do these today)");
  // Two buckets: `mandatory` for exits (SELL / TRIM / EXIT) and their
  // tightly-paired REDEPLOY lines; `mandatoryLater` for standalone
  // BUY-only mandates (DEPLOY CASH from existing balance, CORE
  // REBALANCE). Concatenated `mandatory + mandatoryLater` at render
  // time so SELLs land above BUYs — the operator places trims first,
  // proceeds settle, then places the standalone buys. Prevents the
  // "buy first, but the cash from those buys hasn't landed yet" trap.
  const mandatory = [];
  const mandatoryLater = [];

  // Rebalance if CORE is severely under. Emits a specific default
  // ticket (XEQT for CAD, VOO for USD) sized to close the gap, with
  // the raw gap and no-new-non-CORE rule stated after.
  // Pushed to `mandatoryLater` — this is a standalone BUY, must land
  // below the SELL/TRIM section so proceeds are available.
  if (coreLockActive) {
    const gap = Math.abs(b.rebalanceCad?.core || 0);
    // Cap the buy at available CAD cash across accounts. Negative
    // per-account balances (margin / debit) don't offset positive cash
    // in sibling accounts — brokerage cash can't cross registered ↔
    // taxable borders freely. Sum ONLY positive cashCad. XEQT/VUN/XIU
    // are CAD-listed so USD cash needs an FX conversion; the mandate
    // discipline is "no forced FX", so exclude USD too. User reported
    // Aug 8: "where does it think this $11k CAD is coming from?" when
    // total deployable CAD was ~$427 across accounts.
    const cadAvailable = (cashAccounts || [])
      .reduce((s, a) => s + Math.max(0, a?.cashCad || 0), 0);
    const CORE_REBAL_CASH_FLOOR = 500;   // below this, a naked BUY is undeliverable
    const CORE_REBAL_BUFFER = 0.95;      // leave 5% for FX / settlement drift
    if (cadAvailable < CORE_REBAL_CASH_FLOOR) {
      // "Fund first" variant — no usable cash today. Emit a mandate
      // that acknowledges the gap AND names the real next step (raise
      // cash via a SELL). Otherwise the operator sees an $11k BUY
      // mandate with no plausible source and either ignores it or
      // funds it via margin.
      mandatoryLater.push(
        `**CORE REBALANCE (fund first)** — CORE is ${b.actualPct.core.toFixed(1)}% of book vs ${b.targetsPct.core.toFixed(0)}% target (gap ${coreGapPp.toFixed(1)}pp, ~${m(gap)}). **Total deployable CAD cash across accounts: $${Math.round(cadAvailable).toLocaleString()}** — below the $${CORE_REBAL_CASH_FLOOR} floor. **Cannot fund a CORE BUY today without raising cash first.** Next step: trim a laggard SWING/SPEC position (see §A2 for candidates on cooling sectors or negative P/L) to raise CAD, then BUY XEQT / VUN / XIU with the proceeds. **No new SWING/SPEC/INCOME buys until CORE ≥ 70%.**`
      );
    } else {
      const cappedGap = Math.min(gap, cadAvailable * CORE_REBAL_BUFFER);
      const rebalTicket = pickDefaultTicket(["XEQT.TO", "VUN.TO", "XIU.TO"], cappedGap, "CAD");
      const cashCapped = cappedGap < gap - 100; // ignore rounding noise
      if (rebalTicket) {
        const altStr = rebalTicket.alternatives ? ` · Alternatives: ${rebalTicket.alternatives}` : "";
        const capNote = cashCapped
          ? ` **Cash-capped** at ~$${Math.round(cadAvailable).toLocaleString()} CAD available across accounts — remaining ~${m(gap - rebalTicket.usedCad)} of gap needs a laggard SELL to fund.`
          : "";
        mandatoryLater.push(
          `**CORE REBALANCE** — BUY **${rebalTicket.shares} sh ${rebalTicket.ticker}** @ ~$${rebalTicket.livePrice.toFixed(2)} ${rebalTicket.liveCcy} (live) to close CORE gap ${coreGapPp.toFixed(1)}pp (~${m(gap)}). Currently CORE is ${b.actualPct.core.toFixed(1)}% vs ${b.targetsPct.core.toFixed(0)}% target. Uses ~${m(rebalTicket.usedCad)}.${capNote}${stopClause(rebalTicket)} **No new SWING/SPEC/INCOME buys until CORE ≥ 70%.**${altStr}${describeTicker(rebalTicket.ticker)}`
        );
        addMandateRec(rebalTicket, "core-rebalance");
      } else {
        mandatoryLater.push(
          `**CORE REBALANCE** — CORE is ${b.actualPct.core.toFixed(1)}% of book vs ${b.targetsPct.core.toFixed(0)}% target (gap ${coreGapPp.toFixed(1)}pp, ~${m(gap)}). Direct available CAD cash (~$${Math.round(cadAvailable).toLocaleString()}) AND proceeds from any sale today into XEQT / VUN / XIU. **No new SWING or SPEC buys until CORE ≥ 70%.** (No live price for default ticker — pick one manually.)`
        );
      }
    }
  }

  // Cash-deploy mandate: when dry powder is high AND an auto-routable
  // sleeve is meaningfully under target, direct the deployment
  // explicitly. Fills the gap between "trivial drift, do nothing" and
  // "severe gap, force-trim to fund" — the common case where cash is
  // just sitting because no other mandate is telling the operator
  // where to put it. Trigger thresholds are deliberately looser than
  // force-trim (5pp vs 15pp) because deploying idle cash is much
  // lower-friction than trimming a held position.
  const CASH_HIGH_PCT = 15;
  const CASH_DEPLOY_GAP_PP = 5;
  const fx = fxUsdCad || 1.37;
  const totalCashCad = (cashAccounts || []).reduce(
    (s, a) => s + (a?.cashCad || 0) + (a?.cashUsd || 0) * fx, 0
  );
  const totalBookCad = (b?.book || 0) + totalCashCad;
  const cashPct = totalBookCad > 0 ? (totalCashCad / totalBookCad) * 100 : 0;
  if (cashPct > CASH_HIGH_PCT && b?.deviations) {
    const AUTO_ROUTE = new Set(["core", "income"]);
    const underweight = [
      { sleeve: "core",   gap: -b.deviations.core },
      { sleeve: "income", gap: -b.deviations.income },
    ]
      .filter(x => AUTO_ROUTE.has(x.sleeve) && x.gap > CASH_DEPLOY_GAP_PP)
      .sort((a, b) => b.gap - a.gap)[0];
    if (underweight) {
      // Emit ONE ticket per (account, currency) with meaningful cash.
      // Each ticket deploys into a ticker that MATCHES the currency
      // (no forced FX conversion). Sleeve mapping:
      //   • CAD cash → INCOME (if underweight) else CORE-CAD
      //   • USD cash → CORE-USD (no INCOME-USD list today)
      // Reserve per pool: max($200, 10% of pool). Total deployment
      // capped by sleeve gap so we don't overshoot into overweight.
      // Ticker lists match what MANDATE_DEFAULT_TICKERS fetched (with
      // .TO suffix for TSX names). ctxLivePrices is keyed by the same
      // string used to fetch, so mismatched suffixes would return no
      // price → skip. INCOME-USD list added so USD cash can fill the
      // INCOME sleeve via US-listed dividend payers (previously USD
      // always routed to CORE-USD even when INCOME was underweight).
      const incomeCadList = ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO"];
      const incomeUsdList = ["KO", "PEP", "JNJ", "PG", "MO", "ABBV", "MRK", "XOM", "CVX", "O", "VZ", "MMM"];
      const coreCadList = ["XEQT.TO", "VUN.TO", "XIU.TO"];
      const coreUsdList = ["VOO", "VTI", "QQQ"];
      const sleeveGapCad = (underweight.gap / 100) * totalBookCad;
      // Debug log — one line summarising the whole deploy plan.
      console.log(`[cash-deploy] sleeve=${underweight.sleeve} gap=${underweight.gap.toFixed(1)}pp · sleeveGapCad=$${sleeveGapCad.toFixed(0)} · pools=${(cashAccounts || []).length}`);

      // Rank pools by CAD-equivalent value so bigger pools get first
      // claim on the (possibly-limited) sleeve gap budget.
      const pools = [];
      for (const a of (cashAccounts || [])) {
        const cad = a?.cashCad || 0;
        const usd = a?.cashUsd || 0;
        if (cad >= 500) pools.push({ acct: a, ccy: "CAD", cashInCcy: cad, cadEquivalent: cad });
        if (usd >= 500) pools.push({ acct: a, ccy: "USD", cashInCcy: usd, cadEquivalent: usd * fx });
      }
      pools.sort((a, b) => b.cadEquivalent - a.cadEquivalent);

      // Deploy each pool up to (cash - reserve), independently. No
      // global sleeve-gap cap — with cash at 31% and target near 5%,
      // there's more excess cash than any single sleeve can absorb.
      // INCOME target gets filled first from CAD cash; overflow and
      // all USD cash route to CORE ETFs. Reserve = max($200, 10% of
      // pool) so no single account gets fully drained.
      const tickets = [];
      for (const pool of pools) {
        const reserveInCcy = Math.max(200, pool.cashInCcy * 0.10);
        const availableInCcy = pool.cashInCcy - reserveInCcy;
        if (availableInCcy < 500) continue;
        const deployNative = Math.floor(availableInCcy / 100) * 100;
        const deployCadThisPool = pool.ccy === "CAD" ? deployNative : deployNative * fx;
        // Sleeve routing per currency:
        //   CAD cash → INCOME (if underweight sleeve is INCOME) else CORE-CAD
        //   USD cash → INCOME-USD (if underweight sleeve is INCOME) else CORE-USD
        // INCOME-USD list is US-listed dividend payers (KO/PG/JNJ/etc.)
        // so USD cash isn't forced into CORE ETFs when the INCOME sleeve
        // actually needs the fill.
        let list;
        let effectiveSleeve;
        if (pool.ccy === "CAD") {
          list = underweight.sleeve === "income" ? incomeCadList : coreCadList;
          effectiveSleeve = underweight.sleeve === "income" ? "INCOME" : "CORE";
        } else {
          list = underweight.sleeve === "income" ? incomeUsdList : coreUsdList;
          effectiveSleeve = underweight.sleeve === "income" ? "INCOME" : "CORE";
        }
        const ticket = pickDefaultTicket(list, deployCadThisPool, pool.ccy);
        if (!ticket) continue;
        tickets.push({ pool, ticket, deployNative, effectiveSleeve, reserveInCcy });
      }

      if (tickets.length > 0) {
        // Header line describing the total plan. Routed to
        // `mandatoryLater` so DEPLOY CASH (BUY-side) lands below all
        // SELL/TRIM mandates in §1 — operator sells first, then buys.
        const totalDeployCad = tickets.reduce((s, t) => s + (t.pool.ccy === "CAD" ? t.deployNative : t.deployNative * fx), 0);
        const headerParts = [
          `**DEPLOY CASH** — ${cashPct.toFixed(0)}% of book in cash while ${underweight.sleeve.toUpperCase()} sleeve is ${underweight.gap.toFixed(1)}pp under target. Deploying ~${m(totalDeployCad)} across ${tickets.length} cash pool${tickets.length === 1 ? "" : "s"} (no FX conversion; each ticket uses same-currency cash):`
        ];
        mandatoryLater.push(headerParts.join("\n"));
        tickets.forEach((t, i) => {
          const acctLabel = t.pool.acct.name || t.pool.acct.id || "account";
          const usedNative = t.ticket.shares * t.ticket.livePrice;
          const altStr = t.ticket.alternatives ? ` · Alternatives: ${t.ticket.alternatives}` : "";
          mandatoryLater.push(
            `   ${i + 1}. BUY **${t.ticket.shares} sh ${t.ticket.ticker}** in **${acctLabel}** (${t.effectiveSleeve} sleeve) @ ~$${t.ticket.livePrice.toFixed(2)} ${t.ticket.liveCcy} (live). Uses ~$${Math.round(usedNative).toLocaleString()} ${t.pool.ccy} · reserve ~$${Math.round(t.reserveInCcy).toLocaleString()} ${t.pool.ccy} kept in ${acctLabel}.${stopClause(t.ticket)}${altStr}${describeTicker(t.ticket.ticker)}`
          );
          addMandateRec(t.ticket, "cash-deploy", acctLabel);
        });
      } else if (pools.length > 0) {
        // Fallback: had pools but no ticket generated (no live prices).
        mandatoryLater.push(
          `**DEPLOY CASH** — ${cashPct.toFixed(0)}% of book in cash while ${underweight.sleeve.toUpperCase()} sleeve is ${underweight.gap.toFixed(1)}pp under target. Live prices unavailable for default deploy tickers — pick manually per account: CAD cash → INCOME (RY/TD/BMO/BNS/TRP), USD cash → CORE-USD (VOO/VTI). Reserve ~10% of each pool.`
        );
      }
    }
  }

  // VaR breach mandate: portfolio 1-day 95% VaR is over the user's
  // hard cap. Grok Aug 5 audit — §1 was saying "None. Portfolio is
  // inside all hard rules" while the Dashboard was showing ACT NOW on
  // VaR breach. §1 needs its own gate for VaR so the two never
  // disagree. Non-CORE positions are the usual driver; guidance
  // suggests trimming largest non-CORE contributor by ~10-15%.
  if (riskVar?.breach95 && riskVar?.used?.pct95 != null) {
    const varPct = riskVar.used.pct95;
    const cap = riskVar.limits?.pct95 || 2;
    const headroomCad = Math.abs(riskVar.headroomCad95 || 0);
    // Suppress if the breach is trivial (< $100 CAD headroom deficit).
    // Same tolerance the Dashboard PortfolioHealthChip uses so the two
    // stay consistent — no false urgency on rounding-error breaches.
    if (headroomCad >= 100) {
      // Largest non-CORE-ETF contributor by CAD value — that's the
      // one whose trim moves the needle. Skip CORE ETFs (diversified
      // internally, trimming them shifts sleeve balance the wrong way).
      const nonCoreLargest = (b?.byPosition || [])
        .filter(row => row.sleeve !== "core" && row.cadValue > 1000)
        .sort((a, b) => b.cadValue - a.cadValue)[0];
      const target = nonCoreLargest?.ticker || "the largest non-CORE position";
      mandatory.push(
        `**REDUCE VAR** — portfolio 1-day 95% VaR is ${varPct.toFixed(2)}% vs the ${cap}% hard cap (breach; headroom ~−${m(headroomCad)}). Trim ~10-15% of **${target}** (largest non-CORE contributor by \\$) to bring VaR back under cap. Non-CORE first — trimming a CORE ETF shifts sleeve balance the wrong way.`
      );
    }
  }

  // Single-name concentration mandate: any base ticker over 20% of
  // book. Strict 20% cap across ALL sleeves including CORE ETFs — per
  // user directive after Aug 5 audit. Rationale: even a broad-market
  // ETF at 26% is 26% correlated exposure to one specific market/
  // regime (TSX 60 for XIU, S&P for VOO, Russell 2000 for IWM). Two
  // ETFs at 25%+ each concentrates the same beta twice. Better to
  // spread CORE across 3-4 ETFs so no single one is >20%.
  // Constants sourced from module scope (SINGLE_NAME_CAP_PCT +
  // SINGLE_NAME_CAP_TOLERANCE_PP + SINGLE_NAME_CAP_FIRING_PCT) so
  // the prefix and post-gen recompute paths share one source of
  // truth. Aug 8 bug: post-gen re-enforcer had its own hardcoded
  // `pct <= 20` check which fired mandates for e.g. XIU at 20.4%
  // even though the prefix's tolerance-adjusted filter correctly
  // skipped them.
  const concByBase = {};
  for (const row of (b?.byPosition || [])) {
    if (!(row.cadValue > 0)) continue;
    const base = String(row.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
    if (!base) continue;
    if (!concByBase[base]) concByBase[base] = { cad: 0, sleeve: row.sleeve };
    concByBase[base].cad += row.cadValue;
  }
  const bookForConc = b?.book || 0;
  if (bookForConc > 0) {
    // Detect the most-underweight sleeve so trim proceeds can be
    // routed there instead of defaulting to the trimmed name's own
    // sleeve. Per user directive after Aug 5 audit: if INCOME is
    // >5pp under target when a concentration trim fires, the mandate
    // should say "Redeploy into RY / TD / BMO / BNS (INCOME sleeve —
    // 7.7pp underweight)" instead of same-sleeve CORE ETFs.
    // SPEC intentionally excluded — never redirect a concentration
    // trim into SPEC (defeats the point of trimming risk).
    const routableGaps = b?.deviations ? [
      { sleeve: "income", gap: -b.deviations.income, ccy: "CAD",
        list: ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO"] },
      { sleeve: "core", gap: -b.deviations.core, ccy: "CAD",
        list: ["XEQT.TO", "VUN.TO", "XIU.TO"] },
    ]
      .filter(x => x.gap > 5)
      .sort((a, b) => b.gap - a.gap) : [];
    const underweightRedirect = routableGaps[0] || null;

    // Build per-base-ticker ccy + primary account maps so the paired
    // REDEPLOY line can name a concrete ticket in the right currency /
    // account. Primary account = the one holding the largest slice of
    // this ticker (most proceeds land there → keep FX unchanged).
    const baseTickerToCcy = {};
    const baseTickerToPrimaryAcct = {};
    for (const p of (positions || [])) {
      const base = String(p.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
      if (!base) continue;
      const posCad = (p.ccy === "USD" ? (p.priceUsd || 0) * (fxUsdCad || 1.37) : (p.priceCad || 0)) * (p.qty || 0);
      if (!baseTickerToCcy[base] && p.ccy) baseTickerToCcy[base] = p.ccy;
      const prior = baseTickerToPrimaryAcct[base];
      if (!prior || posCad > prior.cad) baseTickerToPrimaryAcct[base] = { acct: p.acct, cad: posCad };
    }
    const acctNameForBase = (base) => {
      const acctId = baseTickerToPrimaryAcct[base]?.acct;
      if (!acctId) return null;
      const a = (cashAccounts || []).find(x => String(x.id) === String(acctId));
      return a?.name || String(acctId);
    };

    // Sort worst-first so the largest concentration lands at the top of §1.
    const overCap = Object.entries(concByBase)
      .map(([base, info]) => ({ base, info, pct: (info.cad / bookForConc) * 100 }))
      .filter(x => x.pct > SINGLE_NAME_CAP_FIRING_PCT)
      .sort((a, b) => b.pct - a.pct);
    for (const { base, info, pct } of overCap) {
      const excessCad = info.cad - (SINGLE_NAME_CAP_PCT / 100) * bookForConc;
      // Debug log so trim-size fluctuations are traceable across briefs.
      // book + info.cad + pct + excess all logged per name each run.
      console.log(`[concentration] base=${base} sleeve=${info.sleeve} cad=$${info.cad.toFixed(0)} book=$${bookForConc.toFixed(0)} pct=${pct.toFixed(1)}% excess=$${excessCad.toFixed(0)} redirect=${underweightRedirect?.sleeve || "none"}`);
      if (excessCad < 100) continue; // trivial breach, skip
      let sleeveNote;
      let destList = null;
      let destSleeveLabel = null;
      const positionCcy = baseTickerToCcy[base] || "CAD";
      if (underweightRedirect && underweightRedirect.sleeve !== info.sleeve) {
        // Prefer the underweight sleeve — kills two birds: reduces
        // concentration AND closes the sleeve gap on the same trim.
        const listStr = underweightRedirect.list.slice(0, 4).join(" / ");
        sleeveNote = ` Redeploy proceeds into **${underweightRedirect.sleeve.toUpperCase()} sleeve** (${listStr}) — ${underweightRedirect.sleeve.toUpperCase()} is ${underweightRedirect.gap.toFixed(1)}pp underweight, so this trim closes two gaps at once.`;
        // Currency-match the destination list so proceeds stay in the
        // same currency (no forced FX). CAD sale → CAD destination
        // list; USD sale → USD destination list.
        if (underweightRedirect.sleeve === "income") {
          destList = positionCcy === "CAD"
            ? ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO"]
            : ["KO", "PEP", "JNJ", "PG", "MO", "ABBV", "MRK", "XOM", "CVX", "O", "VZ", "MMM"];
        } else if (underweightRedirect.sleeve === "core") {
          destList = positionCcy === "CAD"
            ? ["XEQT.TO", "VUN.TO", "XIU.TO"]
            : ["VOO", "VTI", "QQQ"];
        }
        destSleeveLabel = underweightRedirect.sleeve.toUpperCase();
      } else if (info.sleeve === "core") {
        sleeveNote = ` CORE ETFs are not exempt — ${pct.toFixed(1)}% in one broad-market ETF is still ${pct.toFixed(1)}% of book tied to one index. Redeploy the trim into a DIFFERENT CORE ETF (prefer a different geography — trimming a US ETF like VOO/VTI/QQQ into another US ETF just rotates the same beta; route to XEQT / VUN / XIU for real diversification) rather than a new sleeve.`;
        // Cross-currency CORE routing: when trimming a US CORE ETF for
        // concentration, prefer a CAD-listed global/Canadian CORE ETF
        // to actually reduce US-market beta. Accepts the FX conversion
        // cost — it's a one-time hit vs the ongoing risk of doubled US
        // beta by rotating VOO → VTI (both US total-market). Trimming
        // a CAD CORE ETF keeps the current same-currency routing.
        destList = positionCcy === "CAD"
          ? ["XEQT.TO", "VUN.TO", "XIU.TO"].filter(t => t.split(".")[0] !== base)
          : ["XEQT.TO", "VUN.TO", "XIU.TO"]; // USD sale → CAD non-US CORE (FX-convert)
        destSleeveLabel = "CORE";
      } else {
        sleeveNote = " Single-name blow-ups are the loss zone.";
      }
      const line = `**TRIM CONCENTRATION** — **${base}** is ${pct.toFixed(1)}% of book, over the ${SINGLE_NAME_CAP_PCT}% single-name cap. Trim ~${m(excessCad)} to bring it to ≤ ${SINGLE_NAME_CAP_PCT}%.${sleeveNote}`;
      mandatory.push(line);
      // Stash the exact canonical string so the caller can force it into
      // the final briefing post-generation. AI has been observed mimicking
      // this line's format with hallucinated (much smaller) trim amounts
      // that fail to actually bring the position under the cap.
      concentrationMandates.push({ base, canonical: line });

      // Paired REDEPLOY ticket — concrete buy order matching the SELL
      // proceeds, in the same account and currency so no FX / transfer
      // is needed. User previously reported: took the two TRIM/SELL
      // recs but had no direction on where to deploy the freed cash.
      // This closes the loop.
      if (destList && destList.length > 0) {
        const excessNative = positionCcy === "CAD" ? excessCad : excessCad / (fxUsdCad || 1.37);
        const pairTicket = pickDefaultTicket(destList, excessNative, positionCcy);
        if (pairTicket) {
          const acctLabel = acctNameForBase(base);
          const acctStr = acctLabel ? ` in **${acctLabel}**` : "";
          const altStr = pairTicket.alternatives ? ` · Alternatives: ${pairTicket.alternatives}` : "";
          const usedNative = pairTicket.shares * pairTicket.livePrice;
          const pairedLine = `   → **REDEPLOY (paired with TRIM above)** — After settle, BUY **${pairTicket.shares} sh ${pairTicket.ticker}**${acctStr} @ ~$${pairTicket.livePrice.toFixed(2)} ${pairTicket.liveCcy} (live). Uses ~$${Math.round(usedNative).toLocaleString()} ${positionCcy} of the ~$${Math.round(excessNative).toLocaleString()} ${positionCcy} proceeds from ${base} TRIM. ${destSleeveLabel} sleeve — required destination.${stopClause(pairTicket)}${altStr}${describeTicker(pairTicket.ticker)}`;
          mandatory.push(pairedLine);
          addMandateRec(pairTicket, "trim-redeploy", acctLabel);
        }
      }
    }
  }

  // Trail-stop review mandate: any held position whose current price
  // is at or below its 60d-peak-minus-2.5×ATR trailing stop. Turns a
  // passive ⚠ flag into a forced decision: EXIT (lock the remaining
  // gain / cut the drawdown), TIGHTEN (move hard stop to break-even
  // or 1×ATR), or DOCUMENT WHY (specific new-evidence trigger + a
  // new review date). Does NOT emit a SELL — the hard-stop rule
  // (cost basis −8% / −15% by sleeve) is a separate discipline;
  // this is the trail-stop layer per user's rule spec:
  //   "Turns a passive warning into an active decision point without
  //    over-riding the hard-stop logic."
  // Skips positions already in confirmedStops (§1 SELL AT MARKET
  // already handles those) so we don't double-mandate the same ticker.
  //
  // ALSO skips positions that will be sold by the rec-stop-hit path
  // below (line ~2164). Real defect surfaced by audit:
  //     "DJT appears in both DO TODAY (SELL) AND TRAIL STOP REVIEW"
  // DJT had both a hard-stop-hit SELL AT MARKET AND a TRAIL STOP
  // REVIEW mandate. Two contradictory instructions on one ticker.
  // We pre-compute the base-ticker set that WILL emit SELL AT MARKET
  // from any path (position-monitor, rec-stop-hit) and skip trail
  // reviews for those tickers.
  const stopHitTickerSet = new Set(
    (stopMonitor?.hardStopHit || []).map(r => String(r.ticker || "").toUpperCase())
  );
  // Add base-tickers from rec-stop-hit recs that will actually emit
  // SELL AT MARKET (non-TRAIL_SOFT severity). Mirrors the gate at
  // line ~2180 so the two decisions can't diverge.
  const willEmitSellBases = new Set(
    (stopMonitor?.hardStopHit || []).map(r => String(r.ticker || "").toUpperCase().replace(/\..*$/, ""))
  );
  for (const stopRec of (monitorStopHitRecs || [])) {
    if (stopRec.action !== "BUY") continue;
    // Held check — no SELL if not held.
    const held = (positions || []).some(p =>
      String(p.ticker || "").toUpperCase().replace(/\..*$/, "") === stopRec.base && (p.qty || 0) > 0
    );
    if (!held) continue;
    const sev = classifyStopSeverity({
      ticker: stopRec.base,
      drawdownPct: drawdownForTicker(stopRec.base),
      isHardStopHit: hardStopHitBaseSet.has(stopRec.base),
    });
    if (sev !== "TRAIL_SOFT") willEmitSellBases.add(stopRec.base);
  }
  const trailReviews = [];
  const coreTrailInformational = []; // CORE positions that breached — surfaced as A2 line only
  for (const p of (positions || [])) {
    const ticker = String(p.ticker || "").toUpperCase();
    if (!ticker || !(p.qty > 0)) continue;
    if (stopHitTickerSet.has(ticker)) continue; // already a hard-stop SELL mandate
    const posBase = ticker.replace(/\..*$/, "");
    if (willEmitSellBases.has(posBase)) continue; // will emit SELL AT MARKET below — no REVIEW
    const sig = (quantSignals || {})[ticker] || (quantSignals || {})[ticker.replace(/\..*$/, "")];
    const tech = sig?.tech;
    if (!tech || !tech.trailStopBreach) continue;

    // Sleeve-specific policy (audit fix — no more XEQT MANDATORY EXIT):
    //   CORE   → informational only. A 60d-peak-minus-2.5×ATR breach on
    //            a long-horizon ETF like XEQT/VOO/XIU is mechanical
    //            noise, not a decision trigger. Surface as one A2 line;
    //            do NOT create a §1 mandatory review.
    //   INCOME → thesis-review framing (dividend/valuation angle), not
    //            an "EXIT/TIGHTEN/HOLD" action mandate.
    //   SWING  → mandatory action review (DJT-style EXIT/TIGHTEN/HOLD).
    //   SPEC   → mandatory action review (same).
    const posSleeve = classifyPosition(p) || "spec";
    if (posSleeve === "core") {
      coreTrailInformational.push({
        ticker: p.ticker,
        drawdownPct: tech.drawdownFromHigh60dPct,
        last: tech.last,
        high60d: tech.high60d,
      });
      continue; // don't put on the mandatory list
    }

    // Drawdown / HWM invariants — a mandate line based on internally
    // inconsistent math should never render. Three checks:
    //  a) trailStop > high60d — the trail can't sit above its own HWM
    //  b) current >= high60d but drawdownPct < 0 — arithmetically impossible
    //  c) stated drawdownPct doesn't match (current/high60d - 1) within
    //     0.5pp — either the high, the current, or the drawdown is bad
    // Any of these = tech-signal corruption; silently drop the position
    // from trail-review so we don't emit a mandate against bad numbers.
    // Trail invariant a): the trail stop must sit BELOW the 60d high
    // whenever ATR > 0. Real-world "trail stop = high60d exactly" is
    // arithmetically impossible for a `high - 2.5*ATR` stop unless
    // ATR is 0 — a stuck / stale technical read. Reject.
    if (Number.isFinite(tech.trailStopAtrAdjusted) && Number.isFinite(tech.high60d)
        && Number.isFinite(tech.atr14) && tech.atr14 > 0
        && tech.trailStopAtrAdjusted >= tech.high60d - 0.001) {
      console.warn(`[trail-review invariant] ${p.ticker} — trailStop $${tech.trailStopAtrAdjusted.toFixed(2)} >= high60d $${tech.high60d.toFixed(2)} with ATR $${tech.atr14.toFixed(2)} > 0 — suppressing (arithmetic invariant)`);
      continue;
    }
    // Trail invariant b): current >= high with negative drawdown is
    // impossible. drawdown = (current - high) / high; if current >=
    // high, drawdown >= 0.
    if (Number.isFinite(tech.last) && Number.isFinite(tech.high60d) && Number.isFinite(tech.drawdownFromHigh60dPct)
        && tech.last >= tech.high60d && tech.drawdownFromHigh60dPct < 0) {
      console.warn(`[trail-review invariant] ${p.ticker} — last $${tech.last} >= high60d $${tech.high60d} but drawdown ${tech.drawdownFromHigh60dPct.toFixed(2)}% — suppressing`);
      continue;
    }
    // Trail invariant c): stated drawdown must match (current/high)-1
    // within tight tolerance.
    if (Number.isFinite(tech.last) && Number.isFinite(tech.high60d) && tech.high60d > 0
        && Number.isFinite(tech.drawdownFromHigh60dPct)) {
      const impliedDrawdownPct = ((tech.last - tech.high60d) / tech.high60d) * 100;
      const drift = Math.abs(impliedDrawdownPct - tech.drawdownFromHigh60dPct);
      if (drift > 0.5) {
        console.warn(`[trail-review invariant] ${p.ticker} — stated drawdown ${tech.drawdownFromHigh60dPct.toFixed(2)}% vs implied ${impliedDrawdownPct.toFixed(2)}% from ($${tech.last}/$${tech.high60d}) — suppressing`);
        continue;
      }
    }
    // Trail invariant d): if current is at the 60d high (within 0.5%),
    // there IS no drawdown — this is not a legitimate trail-stop
    // review. RY / BNS bug: briefing showed "trail-breached" for
    // positions sitting on their 60d peak with drawdown = -0.0%.
    if (Number.isFinite(tech.last) && Number.isFinite(tech.high60d) && tech.high60d > 0) {
      const pctFromHigh = Math.abs(tech.last - tech.high60d) / tech.high60d * 100;
      if (pctFromHigh < 0.5) {
        console.warn(`[trail-review invariant] ${p.ticker} — last $${tech.last} within 0.5% of high60d $${tech.high60d}; no meaningful drawdown — suppressing`);
        continue;
      }
    }
    trailReviews.push({
      ticker: p.ticker,
      account: p.acct,
      qty: p.qty,
      last: tech.last,
      high60d: tech.high60d,
      trailStop: tech.trailStopAtrAdjusted,
      drawdownPct: tech.drawdownFromHigh60dPct,
      currency: p.ccy || "USD",
      sleeve: posSleeve,  // downstream copy chooses framing (INCOME vs SWING/SPEC)
    });
  }
  // De-dup mandatory reviews by base ticker so XEQT in 3 accounts isn't
  // 3 identical §1 mandates. Keep the worst-drawdown row; caller can
  // list per-account holdings underneath from p.acct via `positions`
  // if it wants the breakout.
  const seenBase = new Set();
  const trailReviewsDeduped = [];
  const baseOfT = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
  trailReviews.sort((a, b) => (a.drawdownPct ?? 0) - (b.drawdownPct ?? 0));
  for (const r of trailReviews) {
    const b = baseOfT(r.ticker);
    if (seenBase.has(b)) continue;
    seenBase.add(b);
    trailReviewsDeduped.push(r);
  }
  trailReviews.length = 0;
  for (const r of trailReviewsDeduped) trailReviews.push(r);
  // Sort worst-first by drawdown magnitude (most-negative first).
  trailReviews.sort((a, b) => (a.drawdownPct ?? 0) - (b.drawdownPct ?? 0));
  for (const r of trailReviews) {
    // Register the base-ticker to block any AI-emitted SELL for it —
    // if we're emitting a REVIEW mandate (three-way choice: EXIT /
    // TIGHTEN / HOLD), the operator hasn't yet decided, and no
    // automatic SELL ticket should coexist with it. Previously we
    // ONLY registered TRAIL_SOFT tickers, which let INCOME reviews
    // (RY, drawdown 7.6%, classified TRAIL_HARD) coexist with an AI
    // SELL rec in DO TODAY — a direct contradiction. Fix: register
    // every emitted trail-review ticker regardless of severity.
    // willEmitSellBases has already filtered out cases where a hard
    // SELL AT MARKET is the correct action; anything reaching this
    // loop is genuinely a REVIEW.
    const base = String(r.ticker || "").toUpperCase().replace(/\..*$/, "");
    trailSoftTickers.add(base);
    const drawdownStr = r.drawdownPct != null
      ? `${r.drawdownPct.toFixed(1)}%` : "n/a";
    const trailStopStr = r.trailStop != null
      ? `$${r.trailStop.toFixed(2)} ${r.currency}` : "n/a";
    const highStr = r.high60d != null
      ? `$${r.high60d.toFixed(2)} ${r.currency}` : "n/a";
    // Sleeve-specific mandate copy. INCOME gets a thesis-review
    // framing (dividend/valuation angle, no forced EXIT/TIGHTEN
    // decision); SWING/SPEC gets the DJT-style tactical decision
    // review. CORE was already filtered out above.
    if (r.sleeve === "income") {
      mandatory.push(
        `**TRAIL STOP REVIEW (INCOME)** — **${r.ticker}**. Current price below the 60d-peak-minus-2.5×ATR trailing stop (${trailStopStr}). 60d high: ${highStr}. Drawdown from peak: ${drawdownStr}. **INCOME framing — review the dividend/thesis, not an automatic exit:** (1) is the payout still safe (payout ratio, coverage)? (2) has the valuation multiple compressed structurally? (3) is the sector view intact? Document ONE of: **HOLD — thesis and yield intact**, **TRIM to reduce single-name weight**, or **EXIT — thesis broken**. HOLD requires a specific yield/coverage number and a review date, not "long-term dividend payer".`
      );
    } else {
      mandatory.push(
        `**TRAIL STOP REVIEW** — **${r.ticker}**. Current price is below the 60d-peak-minus-2.5×ATR trailing stop (${trailStopStr}). 60d high: ${highStr}. Drawdown from peak: ${drawdownStr}. **Decide today and record ONE of:** (1) **EXIT** — lock in the remaining gain or cut the drawdown; (2) **TIGHTEN** — move hard stop to break-even or 1×ATR below current; (3) **HOLD with documented reason** — must include a concrete new-evidence trigger AND a new review date. No fourth option. "Hold through earnings" or "thesis intact" alone are NOT acceptable — write out the specific trigger.`
      );
    }
    // Paired IF-EXIT REDEPLOY hint. TRAIL STOP REVIEW is a decision
    // mandate (three options) so no forced SELL — but if the operator
    // picks EXIT, there's real cash to redeploy. User Aug 6: "I took
    // the SU sell; why no BUY rec for the freed cash?" Compute the
    // hypothetical proceeds + emit a specific redeploy ticket right
    // under the review so the redeploy is visible in the same brief,
    // not deferred until tomorrow's DEPLOY CASH mandate.
    if (r.qty > 0 && r.last > 0) {
      const proceedsNative = r.qty * r.last;
      const proceedsCad = r.currency === "CAD" ? proceedsNative : proceedsNative * (fxUsdCad || 1.37);
      // Route to the most-underweight sleeve, currency-matched. Same
      // logic as TRIM CONCENTRATION paired REDEPLOY.
      const routableGaps = sleeveBalance?.deviations ? [
        { sleeve: "income", gap: -sleeveBalance.deviations.income },
        { sleeve: "core",   gap: -sleeveBalance.deviations.core },
      ].filter(x => x.gap > 5).sort((a, b) => b.gap - a.gap) : [];
      const redirect = routableGaps[0] || { sleeve: "core", gap: 0 };
      const incomeCadList = ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO"];
      const incomeUsdList = ["KO", "PEP", "JNJ", "PG", "MO", "ABBV", "MRK", "XOM", "CVX", "O", "VZ", "MMM"];
      const coreCadList = ["XEQT.TO", "VUN.TO", "XIU.TO"];
      const coreUsdList = ["VOO", "VTI", "QQQ"];
      let destList;
      if (redirect.sleeve === "income") {
        destList = r.currency === "CAD" ? incomeCadList : incomeUsdList;
      } else {
        destList = r.currency === "CAD" ? coreCadList : coreUsdList;
      }
      // Guard against sell-X → buy-X self-swap. If the destination
      // list contains the very ticker being reviewed (base-ticker
      // match, exchange-suffix agnostic), strip it. Was producing
      // "SELL 21 sh XEQT.TO … BUY 21 sh XEQT.TO" for CORE ETFs
      // before we filtered CORE out entirely; keep this guard as a
      // second layer so any future non-CORE redeploy can't self-swap
      // either (e.g. a swing XLK trail-review shouldn't redeploy to XLK).
      const reviewBase = baseOfT(r.ticker);
      destList = destList.filter(t => baseOfT(t) !== reviewBase);
      // Also drop destinations already at/above the single-name
      // concentration cap. Redeploying into a name that's already
      // 20%+ of the book pushes it further over — the concentration
      // validator would reject the resulting BUY, so we shouldn't
      // suggest it in the first place. Uses the aggregated same-base
      // weight (RY in RRSP + RY in Non-Spousal counts as one).
      const CONC_CAP_PCT = 20;
      const concentrationByBase = new Map();
      if (b?.byPosition) {
        for (const bp of b.byPosition) {
          const bBase = baseOfT(bp.ticker);
          concentrationByBase.set(bBase, (concentrationByBase.get(bBase) || 0) + (bp.cadValue || 0));
        }
      }
      const bookForConc = b?.book || 0;
      destList = destList.filter(t => {
        if (bookForConc <= 0) return true; // no book data — don't over-filter
        const cadInBase = concentrationByBase.get(baseOfT(t)) || 0;
        const pct = (cadInBase / bookForConc) * 100;
        return pct < CONC_CAP_PCT;
      });
      const redeployTicket = pickDefaultTicket(destList, proceedsCad, r.currency);
      if (redeployTicket) {
        const acctLabel = (cashAccounts || []).find(a => String(a.id) === String(r.account))?.name || String(r.account || "account");
        const usedNative = redeployTicket.shares * redeployTicket.livePrice;
        const altStr = redeployTicket.alternatives ? ` · Alternatives: ${redeployTicket.alternatives}` : "";
        const gapNote = redirect.gap > 5
          ? ` ${redirect.sleeve.toUpperCase()} sleeve is ${redirect.gap.toFixed(1)}pp underweight — this closes two gaps at once.`
          : "";
        mandatory.push(
          `   → **IF EXIT — REDEPLOY** — Selling ${r.qty} sh ${r.ticker} at ~$${r.last.toFixed(2)} ${r.currency} raises ~$${Math.round(proceedsNative).toLocaleString()} ${r.currency}. After settle, BUY **${redeployTicket.shares} sh ${redeployTicket.ticker}** in **${acctLabel}** @ ~$${redeployTicket.livePrice.toFixed(2)} ${redeployTicket.liveCcy} (live). Uses ~$${Math.round(usedNative).toLocaleString()} ${r.currency} of the proceeds. ${redirect.sleeve.toUpperCase()} sleeve — required destination.${stopClause(redeployTicket)}${gapNote}${altStr}${describeTicker(redeployTicket.ticker)}`
        );
        addMandateRec(redeployTicket, "trail-stop-if-exit-redeploy", acctLabel);
      }
    }
  }

  // SWAP mandate — replace a weak SWING/SPEC holding with a fresh
  // high-conviction Test A pick in one paired order. Answers the user
  // question "if a Test A pick is truly that good, why not exit a
  // laggard swing/spec and rotate in?" Conservative gates so this
  // fires rarely and only when both sides are decisively lopsided:
  //
  //   Weak-holder side (SELL):
  //     • sleeve ∈ {swing, spec} (CORE / INCOME are never candidates)
  //     • unrealized P/L ≤ -5%
  //     • horizon-review status ∈ {well-behind, hit-stop, expired}
  //
  //   Pick side (BUY):
  //     • Test A open pick, not blocked, deterministicScore ≥ 70
  //     • mtfConfluence === "aligned" (trend confirmed across timeframes)
  //     • same currency as the weak-holder (avoid forced FX)
  //     • not a ticker we already hold (would be add-to-position, not swap)
  //
  // Cap: 3 swap mandates per brief so a laggard-heavy week doesn't
  // turn into a churn factory. Sorted worst-P/L first.
  const heldBaseSet = new Set(
    (positions || [])
      .filter(p => p.qty > 0)
      .map(p => String(p.ticker || "").toUpperCase().replace(/\..*$/, ""))
  );
  const swapCandidates = [];
  for (const p of (positions || [])) {
    if (!p.ticker || !(p.qty > 0)) continue;
    const sleeve = classifyPosition({ ticker: p.ticker });
    if (sleeve !== "swing" && sleeve !== "spec") continue;
    const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    if (!(price > 0) || !(p.avgCost > 0)) continue;
    const pnlPct = ((price - p.avgCost) / p.avgCost) * 100;
    if (pnlPct > -5) continue;
    const baseHeld = String(p.ticker).toUpperCase().replace(/\..*$/, "");
    const horizonRow = (horizonRows || []).find(r =>
      String(r.ticker || "").toUpperCase().replace(/\..*$/, "") === baseHeld
    );
    if (!horizonRow || !["well-behind", "hit-stop", "expired"].includes(horizonRow.status)) continue;
    swapCandidates.push({
      weakTicker: p.ticker,
      weakBase: baseHeld,
      weakAccount: p.acct,
      weakQty: p.qty,
      weakPrice: price,
      weakCcy: p.ccy || "USD",
      weakPnlPct: pnlPct,
      weakStatus: horizonRow.status,
      weakSleeve: sleeve,
    });
  }
  const usedPickTickers = new Set();
  let swapEmitCount = 0;
  for (const cand of swapCandidates.sort((a, b) => a.weakPnlPct - b.weakPnlPct)) {
    if (swapEmitCount >= 3) break;
    const pick = (dailyPicks || []).find(pk => {
      if (!pk || !pk.ticker || pk.blockedReason) return false;
      if ((pk.deterministicScore || 0) < 70) return false;
      if (pk.mtfConfluence !== "aligned") return false;
      if ((pk.currency || "USD") !== cand.weakCcy) return false;
      if (usedPickTickers.has(pk.ticker)) return false;
      const pickBase = String(pk.ticker).toUpperCase().replace(/\..*$/, "");
      if (heldBaseSet.has(pickBase)) return false;
      return true;
    });
    if (!pick) continue;
    const pickLive = pick.entryPrice; // fresh at generation time — the
    // pick engine runs at 09:15 ET each briefing so this is same-day
    // close-of-yesterday, close enough for sizing.
    if (!(pickLive > 0)) continue;
    const proceedsNative = cand.weakQty * cand.weakPrice;
    const shares = Math.floor(proceedsNative / pickLive);
    if (!(shares > 0)) continue;
    usedPickTickers.add(pick.ticker);
    swapEmitCount++;
    const usedNative = shares * pickLive;
    const acctLabel = (cashAccounts || []).find(a => String(a.id) === String(cand.weakAccount))?.name
      || String(cand.weakAccount || "account");
    // Sleeve-derived stop for the pick (same rule as pickDefaultTicket).
    const pickSleeve = classifyPosition({ ticker: pick.ticker });
    const pickStopPct = pickSleeve === "core" ? 0.15
                      : pickSleeve === "income" ? 0.12
                      : 0.08;
    const pickStop = pickLive * (1 - pickStopPct);
    const pickStopStr = `**Stop:** $${pickStop.toFixed(2)} ${cand.weakCcy} (-${(pickStopPct * 100).toFixed(0)}%)`;
    const pickTarget = pick.targetPrice > pickLive
      ? ` · **Target:** $${pick.targetPrice.toFixed(2)} ${cand.weakCcy} (+${(((pick.targetPrice - pickLive) / pickLive) * 100).toFixed(1)}%)`
      : "";
    mandatory.push(
      `**SWAP** — SELL all **${cand.weakQty} sh ${cand.weakTicker}** in **${acctLabel}** at market (P/L ${cand.weakPnlPct >= 0 ? "+" : ""}${cand.weakPnlPct.toFixed(1)}% · horizon **${cand.weakStatus}**). Raises ~$${Math.round(proceedsNative).toLocaleString()} ${cand.weakCcy}. Then BUY **${shares} sh ${pick.ticker}** @ ~$${pickLive.toFixed(2)} ${cand.weakCcy} (live). Uses ~$${Math.round(usedNative).toLocaleString()} ${cand.weakCcy}. Test A conviction **${pick.deterministicScore}** · MTF aligned${pick.setupName ? ` · ${pick.setupName}` : ""}. · ${pickStopStr}${pickTarget}${describeTicker(pick.ticker)}`
    );
  }

  // Force-shrink mandate: when ANY sleeve is severely underweight
  // (>15pp), route trim proceeds to that sleeve — not blindly to
  // CORE. Original version always deployed to CORE ETFs, which was
  // wrong for portfolios where CORE was at target but another sleeve
  // (typically INCOME) had a huge gap. Now the mandate picks:
  //
  //   • which sleeve is most underweight (biggest negative gap)
  //   • which oversize position to trim (largest not in the
  //     most-underweight sleeve, skipping stop-hits already flagged)
  //   • which ETF / ticker set to deploy into, matching the
  //     underweight sleeve's currency and hold-style
  //
  // SPEC is never a routing destination — never trim INTO the loss
  // zone. If SPEC is the most underweight (rare), skip. SWING is
  // also not auto-routable because SWING entries are discretionary
  // technical setups, not fill-a-bucket buys.
  const FORCE_SHRINK_GAP_PP = 15;
  const sleeveGaps = b?.deviations ? [
    { sleeve: "core",   gap: -b.deviations.core },
    { sleeve: "income", gap: -b.deviations.income },
    { sleeve: "swing",  gap: -b.deviations.swing },
    { sleeve: "spec",   gap: -b.deviations.spec },
  ].sort((a, b) => b.gap - a.gap) : [];
  const mostUnderweight = sleeveGaps[0];
  const AUTO_ROUTE_SLEEVES = new Set(["core", "income"]);
  if (mostUnderweight && mostUnderweight.gap > FORCE_SHRINK_GAP_PP
      && AUTO_ROUTE_SLEEVES.has(mostUnderweight.sleeve)
      && b?.byPosition) {
    const stopHitTickers = new Set(confirmedStops.map(r => String(r.ticker || "").toUpperCase()));
    // Trim candidates: any position NOT in the underweight sleeve
    // (can't trim from what you're trying to fill) and not already
    // scheduled to exit via a hard stop.
    const candidates = (b.byPosition || [])
      .filter(row => row.sleeve !== mostUnderweight.sleeve && row.cadValue > 0)
      .filter(row => !stopHitTickers.has(String(row.ticker || "").toUpperCase()))
      .sort((a, b) => b.cadValue - a.cadValue);
    const largest = candidates[0];
    if (largest && largest.cadValue > 1000) {
      const trimCad = largest.cadValue * 0.25;
      const heldPos = (positions || []).find(p => String(p.ticker || "").toUpperCase() === String(largest.ticker || "").toUpperCase());
      const acctStr = heldPos?.acct ? ` in ${heldPos.acct}` : "";
      const sleeveStr = largest.sleeve ? ` (${largest.sleeve.toUpperCase()} sleeve)` : "";
      // Per-sleeve deploy ETF suggestions. INCOME picks are TSX-CAD
      // dividend payers (the Canadian book is where the trader's own
      // edge lives, per the journal); CORE picks are broad-market
      // ETFs matched to the SELL's currency where possible.
      const heldCurrency = heldPos?.ccy || "CAD";
      const deployTickers = mostUnderweight.sleeve === "income"
        ? "RY / TD / BMO / BNS / ENB / TRP (dividend payers, same account & CAD)"
        : (heldCurrency === "CAD" ? "XEQT / VUN / XIU" : "VOO / VTI / QQQ") + " (broad-market ETF, same account & currency)";
      mandatory.push(
        `**FORCE-TRIM 25% of ${largest.ticker}**${acctStr}${sleeveStr} — ~${m(trimCad)} proceeds. ${mostUnderweight.sleeve.toUpperCase()} sleeve is ${mostUnderweight.gap.toFixed(1)}pp underweight (severe); organic attrition isn't fast enough. Trim 25% of the largest non-${mostUnderweight.sleeve.toUpperCase()} position, deploy proceeds into ${deployTickers}. If the trimmed ticker is high-conviction, this doesn't kill the thesis — it right-sizes it while ${mostUnderweight.sleeve.toUpperCase()} catches up.`
      );
    }
  }

  // Confirmed hard stops. Each SELL is auto-paired with a CORE DEPLOY
  // line when CORE is >10pp underweight — proceeds should not sit as
  // idle cash while the sleeve gap is wide.
  for (const r of confirmedStops) {
    const proceeds = (r.qty || 0) * (r.currentPrice || 0);
    const sleeveStop = r.sleeve && r.hardStopPct != null
      ? ` [${r.sleeve.toUpperCase()} stop ${r.hardStopPct}%]` : "";
    mandatory.push(
      `**SELL AT MARKET** — ${r.ticker} in ${r.account}: ${r.qty} sh · basis $${r.costBasis?.toFixed(2)} ${r.currency}, now $${r.currentPrice?.toFixed(2)} ${r.currency} (${r.pnlPct.toFixed(1)}%)${sleeveStop}. Hard-stop rule triggered. Sell at market or LIMIT at ~1% below current.`
    );
    if (coreLockActive && proceeds > 0) {
      const proceedsCad = r.currency === "CAD" ? proceeds : proceeds * (fxUsdCad || 1.37);
      // .TO suffix on CAD tickers so price lookup matches how
      // MANDATE_DEFAULT_TICKERS pre-fetches them; bare "XEQT" would
      // miss and fall through to the "pick manually" degrade path.
      const coreList = r.currency === "CAD" ? ["XEQT.TO", "VUN.TO", "XIU.TO"] : ["VOO", "VTI", "QQQ"];
      const pairTicket = pickDefaultTicket(coreList, proceedsCad, r.currency);
      if (pairTicket) {
        const altStr = pairTicket.alternatives ? ` · Alternatives: ${pairTicket.alternatives}` : "";
        mandatory.push(
          `   → **CORE DEPLOY (paired with SELL above)** — After settle, BUY **${pairTicket.shares} sh ${pairTicket.ticker}** in **${r.account}** @ ~$${pairTicket.livePrice.toFixed(2)} ${pairTicket.liveCcy} (live). Uses ~$${Math.round(proceeds).toLocaleString()} ${r.currency} proceeds from ${r.ticker} SELL (pro-forma). CORE gap ${coreGapPp.toFixed(1)}pp — required destination.${stopClause(pairTicket)}${altStr}${describeTicker(pairTicket.ticker)}`
        );
        addMandateRec(pairTicket, "confirmed-stop-core-deploy", r.account);
      } else {
        const coreTicker = r.currency === "CAD" ? "XEQT / VUN / XIU" : "VOO / QQQ / VTI";
        mandatory.push(
          `   → **CORE DEPLOY (paired with SELL above)** — After the ${r.ticker} SELL settles, use the ~$${Math.round(proceeds).toLocaleString()} ${r.currency} proceeds to BUY ${coreTicker} in **${r.account}** (same account, same currency). CORE gap is ${coreGapPp.toFixed(1)}pp — required destination.`
        );
      }
    }
  }

  // Rec-stop-hit mandate: any open rec whose stopPrice was breached AND
  // whose ticker is actually held right now → emit a §1 SELL AT MARKET.
  // Grok Aug 5 audit: "ENB stop-hit alert lived only in §3 Open rec
  // alerts. It should sit in the Mandatory Actions section, not only as
  // an Open rec alert." Rationale — when a rec's stop is hit and the
  // user IS holding the ticker, the position-monitor's cost-basis-based
  // check may not fire (missing basis data), but the rec's own stop is
  // authoritative for that thesis. Cross-reference here so §1 catches
  // it. Skip if the position-monitor already flagged this ticker
  // (confirmedStops handles it) or if the ticker isn't held (rec alert
  // in §3 is sufficient — nothing to SELL).
  const stopHitTickersInConfirmed = new Set(
    confirmedStops.map(r => String(r.ticker || "").toUpperCase().replace(/\..*$/, ""))
  );
  const acctNameById = new Map();
  for (const a of (cashAccounts || [])) {
    if (a?.id && a?.name) acctNameById.set(String(a.id), String(a.name));
  }
  for (const stopRec of (monitorStopHitRecs || [])) {
    if (stopRec.action !== "BUY") continue; // SELL/TRIM stops are re-entry signals, not exit mandates
    if (stopHitTickersInConfirmed.has(stopRec.base)) continue; // already in §1 via position monitor
    // Severity gate — a rec-stop breach that's really a trail-level
    // tick (drawdown from 60d peak < TRAIL_HARD_DRAWDOWN_PCT and not a
    // cost-basis hard-stop hit) is TRAIL_SOFT: it belongs in the
    // TRAIL STOP REVIEW block below, NOT here as a MANDATORY EXIT.
    // The RY case 2026-08-07: rec-set stop $294.15, current $292.94,
    // drawdown from 60d peak ~4.1% — was emitting both SELL AT MARKET
    // (from this loop) and TRAIL STOP REVIEW (from trailReviews),
    // three different instructions to the reader.
    const stopSeverity = classifyStopSeverity({
      ticker: stopRec.base,
      drawdownPct: drawdownForTicker(stopRec.base),
      isHardStopHit: hardStopHitBaseSet.has(stopRec.base),
    });
    if (stopSeverity === "TRAIL_SOFT") {
      console.log(`[stop-severity] ${stopRec.base}: TRAIL_SOFT (drawdown ${drawdownForTicker(stopRec.base)?.toFixed(1) ?? "?"}%, no cost-basis hit) — skipping SELL AT MARKET, TRAIL STOP REVIEW will handle`);
      trailSoftTickers.add(stopRec.base);
      continue;
    }
    // Find held position matching this rec's base ticker.
    const matchingPositions = (positions || []).filter(p => {
      const posBase = String(p.ticker || "").toUpperCase().replace(/\..*$/, "");
      return posBase === stopRec.base && (p.qty || 0) > 0;
    });
    if (matchingPositions.length === 0) continue; // no position → §3 alert is enough
    for (const p of matchingPositions) {
      const acctLabel = acctNameById.get(String(p.acct || "")) || String(p.acct || "account");
      const px = stopRec.currentPrice;
      const basisPx = stopRec.currency === "USD" ? p.costBasisUsd : p.costBasisCad;
      const basisStr = Number.isFinite(basisPx) && basisPx > 0
        ? ` · basis $${basisPx.toFixed(2)} ${stopRec.currency}, now $${px.toFixed(2)} ${stopRec.currency} (${(((px - basisPx) / basisPx) * 100).toFixed(1)}%)`
        : ` · rec entry $${stopRec.entryPrice} ${stopRec.currency}, now $${px.toFixed(2)} ${stopRec.currency}`;
      mandatory.push(
        `**SELL AT MARKET** — ${p.ticker} in ${acctLabel}: ${p.qty} sh${basisStr}. **Rec-stop breached** (stop $${stopRec.stopPrice}, now $${px.toFixed(2)}). Thesis invalidated per the ${stopRec.ticker} rec. Sell at market or LIMIT at ~1% below current.`
      );
    }
  }

  // Price-integrity failures (implausible losses).
  for (const r of suspectStops) {
    mandatory.push(
      `**VERIFY MANUALLY in broker** — ${r.ticker} in ${r.account}: position book shows basis $${r.costBasis?.toFixed(2)} → now $${r.currentPrice?.toFixed(2)} ${r.currency} (${r.pnlPct.toFixed(1)}%). A loss this large is almost always data-feed corruption, not a real move. **Do NOT act on the system price.** Refresh Prices, cross-check the broker balance, and edit the position row directly if the stored price is wrong.`
    );
  }

  // Horizon expiries.
  for (const r of expiredRecs.slice(0, 5)) {
    const cur = r.current != null ? `$${r.current.toFixed(2)}` : "n/a";
    mandatory.push(
      `**HORIZON EXPIRED** — ${r.ticker} rec from day ${r.daysElapsed}/${r.horizonDays}: entry $${r.entry?.toFixed(2)} → now ${cur}. Decide: EXIT, ROLL (name a specific new-evidence trigger), or TRIM. Passive hold no longer allowed.`
    );
  }

  // Sleeve compliance trim mandate (SPEC over). Same auto-pairing as
  // above: if CORE is underweight, the freed CAD from a SPEC trim
  // routes to CORE by default.
  if (specOver) {
    const excessCad = (b.totals?.spec || 0) - (b.targetsCad?.spec || 0);
    const specByBase = {};
    for (const row of b.byPosition || []) {
      if (row.sleeve !== "spec" || !(row.cadValue > 0)) continue;
      const base = String(row.ticker || "").toUpperCase().replace(/\..*$/, "");
      specByBase[base] = (specByBase[base] || 0) + row.cadValue;
    }
    const largest = Object.entries(specByBase).sort((a, b) => b[1] - a[1])[0];
    mandatory.push(
      `**TRIM SPEC** — SPEC sleeve is ${m(excessCad)} over the ${b.targetsPct.spec.toFixed(0)}% cap (currently ${b.actualPct.spec.toFixed(1)}%).${largest ? ` Largest spec name: **${largest[0]}** (${m(largest[1])}) — trim first.` : ""} Proceeds route to CORE (see rebalance mandate) or cash.`
    );
    if (coreLockActive) {
      const trimTicket = pickDefaultTicket(["XEQT.TO", "VUN.TO", "XIU.TO"], excessCad, "CAD");
      if (trimTicket) {
        const altStr = trimTicket.alternatives ? ` · Alternatives: ${trimTicket.alternatives}` : "";
        mandatory.push(
          `   → **CORE DEPLOY (paired with TRIM above)** — After the SPEC trim settles, BUY **${trimTicket.shares} sh ${trimTicket.ticker}** @ ~$${trimTicket.livePrice.toFixed(2)} ${trimTicket.liveCcy} (live). Uses ~${m(excessCad)} trim proceeds. Same-account CAD deploy. CORE gap ${coreGapPp.toFixed(1)}pp — required destination, not cash.${stopClause(trimTicket)}${altStr}${describeTicker(trimTicket.ticker)}`
        );
        addMandateRec(trimTicket, "trim-spec-core-deploy");
      } else {
        mandatory.push(
          `   → **CORE DEPLOY (paired with TRIM above)** — Route the SPEC-trim proceeds (~${m(excessCad)} needed to reach cap) into XEQT / VUN / XIU in the same account and currency as the SELL. CORE gap is ${coreGapPp.toFixed(1)}pp — required destination, not cash.`
        );
      }
    }
  }

  // Within-stop tightens (secondary but still non-discretionary).
  for (const r of withinStops) {
    mandatory.push(
      `**TIGHTEN STOP** — ${r.ticker} in ${r.account}: pnl ${r.pnlPct.toFixed(1)}% (within 2% of hard stop). Move stop to break-even at $${r.costBasis?.toFixed(2)} ${r.currency} OR trim 50% of the position.`
    );
  }

  // Concatenate SELL/TRIM/EXIT mandates first, then BUY-only mandates
  // (DEPLOY CASH, CORE REBALANCE). Keeps the "sell to free cash before
  // you buy" ordering the operator expects when placing orders top-down.
  const combinedMandatory = [...mandatory, ...mandatoryLater];
  if (combinedMandatory.length === 0) {
    chunks.push("None. Portfolio is inside all hard rules today.");
  } else {
    // Paired sub-items (REDEPLOY, CORE DEPLOY, etc.) are emitted as
    // separate mandatory[] entries but MUST render as indented children
    // of the preceding numbered mandate, not as their own top-level
    // items. Detect them by their leading whitespace + arrow and skip
    // renumbering.
    let n = 0;
    combinedMandatory.forEach(line => {
      const isPairedSub = /^\s+→\s/.test(line);
      if (isPairedSub) {
        chunks.push(line); // preserve leading indent
      } else {
        n += 1;
        chunks.push(`${n}. ${line}`);
      }
    });
  }
  // CORE trail-breach informational block — appears BELOW mandatory items,
  // clearly labeled "informational only" so it can't be misread as a
  // required action. A 2-3% dip on XEQT/VOO/XIU from a 60d peak is
  // mechanical noise on a 10+ year holding, not a decision trigger.
  // Aggregated by base ticker so XEQT-in-3-accounts is ONE line, not three.
  if (coreTrailInformational.length > 0) {
    const byBase = new Map();
    for (const r of coreTrailInformational) {
      const b = String(r.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
      if (!byBase.has(b)) byBase.set(b, { ticker: r.ticker, worstDrawdownPct: r.drawdownPct, count: 0 });
      const agg = byBase.get(b);
      agg.count += 1;
      if ((r.drawdownPct ?? 0) < (agg.worstDrawdownPct ?? 0)) agg.worstDrawdownPct = r.drawdownPct;
    }
    chunks.push("");
    chunks.push("_Informational only — CORE trail-breach (no action; 60d-peak-minus-2.5×ATR is a tactical metric, not a long-horizon exit trigger):_");
    for (const [, agg] of byBase) {
      const dd = Number.isFinite(agg.worstDrawdownPct) ? agg.worstDrawdownPct.toFixed(1) + "%" : "n/a";
      const acctNote = agg.count > 1 ? ` (${agg.count} accts)` : "";
      chunks.push(`- ${agg.ticker}${acctNote}: drawdown ${dd} from 60d peak — long-horizon CORE, HOLD.`);
    }
  }
  chunks.push("");

  // ─── § 2. FORBIDDEN TODAY ───
  const forbidden = [];
  if (specOver) {
    forbidden.push(`**No new SPEC positions** — sleeve at ${b.actualPct.spec.toFixed(1)}%, cap ${b.targetsPct.spec.toFixed(0)}%.`);
  }
  if (coreLockActive) {
    forbidden.push(`**No new discretionary SWING or SPEC buys** — CORE is ${coreGapPp.toFixed(1)}pp underweight. Only CORE ETF buys (XEQT / VUN / XIU) allowed until CORE ≥ 70%.`);
  }
  if (suspectStops.length > 0) {
    const tickers = suspectStops.map(r => r.ticker).join(", ");
    forbidden.push(`**No SELL orders on ${tickers}** — price-integrity failure. Verify manually before any trade on these names.`);
  }
  // Averaging-down block on any position ≤ −5% (a specific concern per Grok's list).
  const decliners = new Set();
  for (const r of [...(stopMonitor?.watch || []), ...withinStops, ...confirmedStops]) {
    if (r.pnlPct <= -5) decliners.add(r.ticker);
  }
  if (decliners.size > 0) {
    forbidden.push(`**No averaging down on ${[...decliners].join(", ")}** — position(s) already down ≥ 5%; adding to a losing name violates the risk-per-trade discipline.`);
  }
  // Regime-hostile gate: when the regime module flags an unfavourable
  // tape ("risk-off" / "hostile" / negative bias), block new SWING/SPEC
  // entries entirely — only CORE ETF buys allowed. Regime module lives
  // outside this renderer, so we consult label/regime fields defensively.
  const regimeLabel = String(tradingRegime?.label || tradingRegime?.regime || "").toLowerCase();
  const regimeHostile = /risk[- ]?off|hostile|bear|contract|distribut/i.test(regimeLabel);
  if (regimeHostile) {
    forbidden.push(`**No new SWING or SPEC entries** — regime detector flags **${tradingRegime?.label || tradingRegime?.regime}**. Only CORE ETF adds allowed until regime turns constructive.`);
  }
  // Cash cap by regime (user Aug 5 overhaul §5). Trending regime =
  // 12% cash max; risk-off = 18% max. Above the cap → deploy per §1
  // DEPLOY CASH (auto-fired above CASH_HIGH_PCT). Cap here is a hard
  // rule surface so the reader sees "you're over the cap" explicitly.
  // Uses cashPct + regimeHostile computed above.
  const cashCapPct = regimeHostile ? 18 : 12;
  if (cashPct > cashCapPct) {
    forbidden.push(`**Cash over ${cashCapPct}% cap** — currently ${cashPct.toFixed(1)}% (${regimeHostile ? "risk-off" : "trending"} regime cap: ${cashCapPct}%). Idle cash is opportunity-cost drag; deploy per §1 DEPLOY CASH mandate, do not accumulate more.`);
  }
  // Sector-hostile gate: when regime is hostile AND we have sector
  // rotation data, block any new BUY whose sector is in the bottom-3
  // by 60d RS (CORE ETFs still allowed — sector tilt never overrides
  // the CORE mandate). Same "sectorHardAvoid" mode below can be
  // triggered by other future signals (Fed tightening, VIX spike).
  const laggards = getSectorLaggards(sectorRotation, 3);
  const sectorHardAvoid = regimeHostile;
  if (sectorHardAvoid && laggards.length > 0) {
    const laggardStr = laggards.map(l => `${l.symbol} (${l.name})`).join(", ");
    forbidden.push(`**No new BUYs in laggard sectors** (${laggardStr}) — regime is hostile AND these sectors are in the bottom 3 by 60d RS vs SPY. CORE ETFs (XEQT/VUN/XIU/VOO) still allowed regardless of sector.`);
  }
  // Always emit §2, even when no rule is active — a missing section
  // makes numbers jump 1 → 3 and readers assume the block was skipped
  // for a reason. "None." is unambiguous. User Aug 11: "§2 FORBIDDEN
  // often missing (section numbers jump 1 → 3)."
  chunks.push("## 2. 🛑 FORBIDDEN TODAY");
  if (forbidden.length > 0) {
    for (const line of forbidden) chunks.push(`- ${line}`);
  } else {
    chunks.push("- None.");
  }
  chunks.push("");

  // ─── § 3. ONE-LINE STATUS (5-second scan) ───
  // Moved above §4 Optional so the reader can glance at portfolio
  // posture before deciding whether to read any AI ideas.
  // All four sleeves must appear on the Status line — omitting even one
  // (typically SWING or INCOME) is a display bug that hides real
  // allocation, and the audit gate blocks it. Numbers come straight
  // from canonical sleeveBalance; no AI touch.
  // Rescale sleeve %s from book-only to portfolio-total denominator so
  // they align with cashPct (same fix as the reconciliation check below).
  // Otherwise sleeve %s + cash % = 100 + cash% instead of 100.
  const _bookFrac = totalBookCad > 0 ? (b?.book || 0) / totalBookCad : 1;
  const rescale = (pct) => Number.isFinite(pct) ? pct * _bookFrac : pct;
  const _coreP = rescale(b?.actualPct?.core);
  const _swingP = rescale(b?.actualPct?.swing);
  const _incomeP = rescale(b?.actualPct?.income);
  const _specP = rescale(b?.actualPct?.spec);
  const corePct = Number.isFinite(_coreP) ? `${_coreP.toFixed(1)}%` : "n/a";
  const swingPct = Number.isFinite(_swingP) ? `${_swingP.toFixed(1)}%` : "n/a";
  const incomePct = Number.isFinite(_incomeP) ? `${_incomeP.toFixed(1)}%` : "n/a";
  const specPct = Number.isFinite(_specP) ? `${_specP.toFixed(1)}%` : "n/a";
  const coreGapStr = coreGapPp > 0.5 ? ` (gap −${coreGapPp.toFixed(1)}pp)` : "";
  const incomeGapPp = b?.actualPct?.income != null && b?.targetsPct?.income != null
    ? b.targetsPct.income - b.actualPct.income : 0;
  const incomeGapStr = incomeGapPp > 0.5 ? ` (gap −${incomeGapPp.toFixed(1)}pp)` : "";
  const cashPctStr = cashPct != null && Number.isFinite(cashPct) ? `${cashPct.toFixed(1)}%` : "n/a";
  const stopsTotal = confirmedStops.length;
  const suspectStr = suspectStops.length > 0 ? ` (${suspectStops.length} suspect)` : "";
  const regimeStr = tradingRegime?.label || tradingRegime?.regime || "neutral";
  const newIdeasAllowed = (!coreLockActive && !specOver && !regimeHostile) ? "YES" : "BLOCKED";
  // Reconciliation check — the four sleeve %s + cash % must land within
  // rounding tolerance of 100. If they don't, canonical itself is
  // inconsistent and the Status line is suppressed rather than shipped
  // with wrong numbers. Per user directive: "If canonical itself does
  // not reconcile, suppress the status rather than asking the LLM to
  // repair it."
  // ROOT-CAUSE FIX for the "103.6%" false reconciliation failure that
  // was blocking the operator for days: sleeveBalance.actualPct is
  // denominated on BOOK ONLY (positions), so those four values sum to
  // exactly 100. cashPct is denominated on BOOK + CASH. Adding them
  // together produces 100 + cash% = 103.6% for a portfolio with 3.6%
  // cash. Not a real reconciliation issue — it's an arithmetic bug
  // in the check itself.
  //
  // Fix: compute portfolio-total-denominated sleeve %s by rescaling
  // sleeveBalance.actualPct by (book / (book + cash)). Then all five
  // parts share the same denominator and sum to 100 for a well-formed
  // portfolio.
  const bookFraction = totalBookCad > 0 ? (b?.book || 0) / totalBookCad : 1;
  const partsForSum = [b?.actualPct?.core, b?.actualPct?.swing, b?.actualPct?.income, b?.actualPct?.spec]
    .map(pct => Number.isFinite(pct) ? pct * bookFraction : pct);
  partsForSum.push(cashPct);
  const partsPresent = partsForSum.filter(x => Number.isFinite(x));
  const sleeveSum = partsPresent.reduce((s, x) => s + x, 0);
  const reconcilesToHundred = partsPresent.length === 5 && Math.abs(sleeveSum - 100) <= 2.5;
  chunks.push("## 3. 📊 Status");
  if (reconcilesToHundred) {
    chunks.push(`CORE: ${corePct}${coreGapStr} · SWING: ${swingPct} · INCOME: ${incomePct}${incomeGapStr} · SPEC: ${specPct} · Cash: ${cashPctStr} · Hard stops: ${stopsTotal}${suspectStr} · Regime: ${regimeStr} · New ideas: **${newIdeasAllowed}**`);
  } else {
    // Suppress the mix line — but keep the operationally-critical
    // stops/regime/new-ideas info visible so the operator isn't blind
    // just because sleeve numbers happen to disagree with cash today.
    chunks.push(`_Sleeve mix suppressed — canonical did not reconcile to 100% (sum=${sleeveSum.toFixed(1)}%, missing fields=${5 - partsForSum.length}). Fix upstream cash/position math before this line ships._`);
    chunks.push(`Hard stops: ${stopsTotal}${suspectStr} · Regime: ${regimeStr} · New ideas: **${newIdeasAllowed}**`);
  }
  // Sector tilt one-liner — deterministic, no AI prose needed. Empty
  // when sector data is unavailable (silent, not a "n/a" line).
  const sectorTilt = formatSectorTiltLine(sectorRotation);
  if (sectorTilt) chunks.push(sectorTilt);
  // Week-over-week rotation callout. Empty when there are no material
  // transitions (or when the prior snapshot is missing). Fail-open —
  // the SECTOR TILT line above always renders regardless.
  const sectorTransitionLine = formatSectorTransitionLine(sectorRotation, sectorTransitions);
  if (sectorTransitionLine) chunks.push(sectorTransitionLine);
  // Pick-engine gates status line — makes the invisible visible even
  // on quiet days when no new pick fires. Grok Aug 6: "an external
  // reader can't confirm the gates are live from the briefing alone."
  // Now they can: this line names the active gates, the current
  // kill-switch state (SUPPRESSED / CANARY / CLEAR), and any setup
  // names currently banned by the per-setup expectancy filter.
  if (pickGateStatus && pickGateStatus.active) {
    const bannedStr = pickGateStatus.bannedSetups?.length
      ? pickGateStatus.bannedSetups.join(", ")
      : "none";
    const ksTone = pickGateStatus.killSwitch === "CLEAR" ? "🟢"
                 : pickGateStatus.killSwitch === "CANARY" ? "🟡"
                 : pickGateStatus.killSwitch === "SUPPRESSED" ? "🔴"
                 : "⚪";
    // Filter out "kill-switch" from the active-gates list because the
    // dedicated kill-switch chip below already renders its state — a
    // duplicate name in the active list produced "... · kill-switch ·
    // canary · kill-switch 🟢 CLEAR" in production output.
    const activeFiltered = pickGateStatus.active.filter(a => String(a).toLowerCase() !== "kill-switch");
    chunks.push(`GATES: ${activeFiltered.join(" · ")} · kill-switch ${ksTone} ${pickGateStatus.killSwitch} · banned setups: ${bannedStr}`);
  }
  chunks.push("");

  // ─── § 4. OPTIONAL ideas — placeholder heading, AI fills below ───
  chunks.push("## 4. 💡 OPTIONAL ideas");
  chunks.push("_(Only surface if all hard rules above are satisfied. AI writes compact TICKER | ACTION | SIZE | TRIGGER | STOP | NOTES table beneath this heading. Routine HOLDs stay one line each.)_");
  chunks.push("");

  // ─── § 0 (bottom) — Open alerts (kept for continuity, moved out of primary flow) ───
  if (Array.isArray(monitorAlerts) && monitorAlerts.length > 0) {
    chunks.push("### 🔔 Open rec alerts");
    for (const a of monitorAlerts) chunks.push(`- ${a}`);
    chunks.push("");
  }

  return {
    md: chunks.join("\n").trim(),
    concentrationMandates,
    mandateRecs,
    trailSoftTickers: [...trailSoftTickers],
  };
}

function buildBriefingPrompt(profile, summary, monitorAlerts = [], quantSignals = null, macro = null, lifecycle = null, factors = null, lessons = null, transcripts = null, watchListBlock = "", dailyPicks = [], recentTrades = [], sectorRotation = null, correlations = null, fedLiquidity = null, congressional = null, discoveryPool = [], calibration = null, benchmarkBundle = null, sizingAdjustments = [], overlaySuggestions = [], compliance = null, isMondayEt = false, attribution = null, horizonRows = [], briefingHistory = [], sizedPicks = [], pyramidingSignals = [], tradingRegime = null, unusualOptions = [], riskVar = null, lossCooldown = null, macroFred = null, insiderSignals = null, optionsFlow = null, marketPulse = null, whale13F = []) {
  const today = new Date().toISOString().slice(0, 10);
  const commission = Number(profile.commissionPerTrade ?? 9.95);
  const fxSpread = Number(profile.fxSpreadPct ?? 1.5);
  const fx = Number(profile.fxUsdCad || 1.37);

  // Per-account cash inventory — same hard-to-miss treatment as the advice endpoint
  // Includes per-account risk override when set (lets a single portfolio run a
  // speculative TFSA next to a moderate RRSP without changing the global risk).
  const accountCashTable = (profile.accounts || [])
    .map(a => {
      const risk = a.riskTolerance || `inherits global (${profile.riskTolerance})`;
      return `  ${a.name}: $${(a.cashCad || 0).toFixed(0)} CAD · $${(a.cashUsd || 0).toFixed(0)} USD · risk: ${risk}`;
    })
    .join("\n") || "  (no accounts configured)";

  // Contribution goals — RRSP/RESP/TFSA. Each goal is { amount, period }.
  // Surfaced so the AI can recommend filling registered-account room when
  // cash is available — especially important in Jan/Feb for the RRSP Mar 1
  // deadline. Legacy flat-number values are coerced to yearly. We display
  // the user's chosen cadence and the annual equivalent.
  const cgoalsRaw = profile.annualContributionGoals || {};
  const normGoal = (v) => {
    if (typeof v === "number") return { amount: v || 0, period: "yearly" };
    if (v && typeof v === "object") return { amount: v.amount || 0, period: v.period || "yearly" };
    return { amount: 0, period: "yearly" };
  };
  const formatGoalLine = (label, g) => {
    if (!g.amount || g.amount <= 0) return null;
    const annual = g.period === "monthly" ? g.amount * 12 : g.amount;
    const cadence = g.period === "monthly"
      ? `$${g.amount.toLocaleString()}/month (≈ $${annual.toLocaleString()}/year)`
      : `$${annual.toLocaleString()}/year`;
    return `  ${label} target: ${cadence}`;
  };
  const goalLines = [
    formatGoalLine("RRSP", normGoal(cgoalsRaw.rrsp)),
    formatGoalLine("RESP", normGoal(cgoalsRaw.resp)),
    formatGoalLine("TFSA", normGoal(cgoalsRaw.tfsa)),
  ].filter(Boolean);
  const contributionGoalsBlock = goalLines.length > 0
    ? `\nCONTRIBUTION GOALS (registered-account targets):\n${goalLines.join("\n")}\nUse these in cash-deployment recs: if uncontributed room remains in a tax-advantaged account, prefer deploying new cash there over Non-Spousal. When the user has chosen a monthly cadence, suggest contributing at that pace as cash arrives. In Jan-Feb, flag the RRSP Mar 1 deadline if the annual RRSP target isn't on track.\n`
    : "";

  const pending = (profile.plannedWithdrawals || [])
    .map(w => {
      const days = Math.max(0, Math.round((new Date(w.targetDate).getTime() - Date.now()) / 86400000));
      const accountName = w.account ? (profile.accounts.find(a => a.id === w.account)?.name || w.account) : null;
      return `  $${w.amount.toFixed(0)} ${w.currency} in ${days}d${accountName ? ` from ${accountName}` : ""}${w.notes ? ` · ${w.notes}` : ""}`;
    });
  const plannedWithdrawalsBlock = pending.length
    ? `\nPLANNED WITHDRAWALS (cash that MUST be available by target date):\n${pending.join("\n")}\nSubtract these from deployable cash. If short, recommend SPECIFIC TRIMS by date to raise the needed cash. Do not lock new BUYs past these dates.\n`
    : "";

  // Static rules (multi-day exec, order ticket, price/currency, senior-
  // analyst rubric, tax, signals checklist, output format) live in
  // STATIC_SYSTEM_PROMPT (Anthropic prompt cache). Only per-call
  // (profile-specific) blocks stay below.
  const tradingCostsBlock = `
Trading-cost frictions (factor into every recommendation):
- Commission: $${commission.toFixed(2)} per trade. Each leg counts separately (Swap = $${(commission * 2).toFixed(2)}).
- FX spread on USD↔CAD: ~${fxSpread}% one-way; round-trip ${(fxSpread * 2).toFixed(1)}%.
- Minimum efficient trade: ~$${(commission * 100).toFixed(0)}.
- PREFER currency-matched trades.

Per-account cash inventory (CRITICAL):
${accountCashTable}
${contributionGoalsBlock}${plannedWithdrawalsBlock}${watchListBlock}

ACCOUNT-SOURCE RULE (mandatory):
- Every BUY rec names ONE source account (Non-Spousal / RRSP / TFSA).
- The trade size MUST fit within that account's PRO-FORMA cash — the current balance PLUS proceeds from any SELL/TRIM recs you're recommending in the SAME (account, currency), MINUS any prior BUYs you've already sized in that same bucket in this briefing. See the CASH PRO-FORMA rule in the system prompt for the computation.
- NO cross-account transfers implicit in a rec; a transfer must be its own explicit WITHDRAW→DEPOSIT rec pair (both legs recorded).
- If the tax-optimal account is short on pro-forma cash even after your recommended SELLs, either: (a) downsize to fit, (b) recommend an ADDITIONAL trim in that account first, (c) use a different account and note the tax tradeoff, or (d) recommend depositing first.
- Every BUY rec includes a "Source: <account> · uses $X of $Y pro-forma available" line, a "Cash source: existing $A + $B from <TICKER> SELL rec above" line when SELL proceeds are being relied on, and a "Cost note: commission ~$${commission.toFixed(2)}, FX: <impact>" line.
`;

  const alertsBlock = monitorAlerts.length
    ? `\n⚠️ OPEN RECOMMENDATION ALERTS (computed deterministically from current prices — include these verbatim at the very top of the briefing):\n${monitorAlerts.map(a => `- ${a}`).join("\n")}\n`
    : `\nOpen-recommendation monitor: no targets or stops hit since last check.\n`;

  const hasCash = summary.cashUsd > 5 || summary.cashCad > 5;
  // Dry-powder framing so the AI stops saying "no dry powder" when the
  // trader actually has 8-15% in cash. Ratio is against equity+cash book.
  const bookForRatio = (summary.total || 0) + (summary.cashCadEquiv || 0);
  const cashPctOfBook = bookForRatio > 0 ? (summary.cashCadEquiv / bookForRatio) * 100 : 0;
  // Three rules per tag — WHAT the AI must say about the cash, so the
  // AI can't (a) recommend adding more cash when there's enough already
  // NOR (b) go silent on cash when there's a real per-account balance
  // to deploy. The section-5 rules downstream check the tag and REQUIRE
  // a deployment plan for HEALTHY / AMPLE / HIGH.
  const dryPowderTag = cashPctOfBook < 3
    ? "LEAN — under-cashed vs the 5-10% recommended dry-powder range. Section 5 must propose ONE TRIM/SELL first to raise cash BEFORE any BUY, since there's not enough cash on hand to deploy."
    : cashPctOfBook <= 10
      ? "HEALTHY — inside the 5-10% recommended dry-powder range. Section 5 MUST propose deployment for every funded account with >$200 free cash; do NOT recommend adding CASH.TO / HISA equivalents; do NOT go silent — the trader is holding deployable cash and expects a plan."
      : cashPctOfBook <= 20
        ? "AMPLE — above the 5-10% range. Section 5 MUST propose deployment into named picks; if you can't find enough eligible names, explicitly SAY so and defer the excess to a specific dated target (e.g. 'defer $3k to the next SWING breakout ≥ score 60'). Do not just hold cash silently."
        : "HIGH — trader is running heavy cash (>20% of book). Section 5 MUST propose a multi-name deployment plan across the top 3 funded accounts; if the tape regime is CHOPPY, split entries into layered scale-ins rather than one lump.";
  const cashBlock = hasCash
    ? `\nAvailable cash:
  $${summary.cashCad.toFixed(2)} CAD
  $${summary.cashUsd.toFixed(2)} USD
  Total ≈ $${Math.round(summary.cashCadEquiv).toLocaleString()} CAD (${cashPctOfBook.toFixed(1)}% of book — ${dryPowderTag})
${summary.perAccountCash.length ? "Per account:\n" + summary.perAccountCash.join("\n") : ""}
`
    : `\nAvailable cash: $0 (no cash to deploy).\n`;

  // List of accounts with free cash > $50 in EITHER currency — used to drive
  // the per-account cash-deployment section. The AI must produce a separate
  // sub-section for EACH funded account (e.g. Non-Spousal, RRSP, TFSA) so
  // Richard sees what to do with the money sitting in each one, rather than
  // a single "you have $X total" plan that ignores where the cash actually lives.
  const fundedAccounts = (profile.accounts || []).filter(a =>
    (a.cashCad || 0) > 50 || (a.cashUsd || 0) > 50
  );
  const fundedAccountLines = fundedAccounts.length
    ? fundedAccounts.map(a => `   - **${a.name}**: $${(a.cashCad || 0).toFixed(0)} CAD · $${(a.cashUsd || 0).toFixed(0)} USD${a.riskTolerance ? ` (risk: ${a.riskTolerance})` : ""}`).join("\n")
    : "   (no account has > $50 free cash in either currency)";

  // Section 5 changes based on whether cash is on hand
  const cashSection = hasCash
    ? `5. **💵 Cash deployment — PER ACCOUNT** — REQUIRED. Generate EXACTLY ONE sub-section per account below that has free cash OR whose PRO-FORMA cash (current + proceeds from your recommended SELL/TRIM recs in the same account) is > $0. Do NOT emit two separate "Cash deployment — RRSP" blocks (one for ENB, one for RY) — combine them into a SINGLE RRSP block with multiple recs inside it. Each account's recs must fit that account's own PRO-FORMA cash bucket — no cross-account pooling. When a BUY in this section is funded partly or wholly by a SELL rec above, cite the source explicitly: "Uses $2,244 of $2,300 CAD pro-forma (current $500 + $1,800 from ENB SELL rec above)."

   Accounts with cash to deploy (EMIT ONE BLOCK FOR EACH, no more, no fewer):
${fundedAccountLines}

   **ONE-CARD-PER-ACCOUNT RULE:** If you want to recommend multiple trades for the same account (e.g. RRSP gets ENB + XLU), list both inside the SAME "Cash deployment — RRSP" block as separate Action lines. Do not split into "Cash deployment — RRSP: ENB" and "Cash deployment — RRSP: XLU" as two cards.

   **DO-NOT-DUPLICATE RULE (critical):** Section 4 ("Today's one action") already proposed ONE trade. In Section 5, if the Section-4 trade lives in one of these accounts, acknowledge it on ONE line — "Section-4 ENB BUY ($2,274 of $7,766 used) — see above for full ticket" — and then propose DIFFERENT names for the remaining cash. Do NOT restate the same ticker with the same entry/target/stop as a new "Action 2" just to consume more cash. If you genuinely want a layered scale-in for the same ticker, use the MULTI-DAY EXECUTION format (one rec with Layer 1/2/3 at staggered prices), not two separate rec blocks at the same price.

   For EACH funded account, write a clearly-titled block like:
     **TFSA — $2,300 CAD · $0 USD**
     - Action: BUY 30 sh ENB. Entry: $74.80 CAD (current $75.58 verified). Target: $84 CAD (12mo). Stop: $69. Horizon: 12 months.
       Account: TFSA · uses $2,244 of $2,300 CAD available · leaves $56 CAD.
       Rationale (tax-fit): Canadian dividend payer + growth — TFSA shelters dividend + cap gain. Better than RRSP for dividend tax credit considerations.

   Rules per account:
   - Pick recs whose tax treatment ACTUALLY MATCHES that account (US growth → TFSA; US-listed dividend payer → RRSP for treaty exemption; Canadian dividend payer → Non-Spousal for the dividend tax credit; speculation → Non-Spousal so losses are claimable).
   - Pick DIFFERENT names from Section 4 when possible — diversification, not concentration.
   - No fractional shares; do not exceed that account's cash.
   - If an account has very small cash (<$200 in either currency), either say "wait for more cash" or suggest depositing more — don't force a tiny trade that's all commission.
   - Tilt AWAY from current concentration (DJT/DJTWW/RUM) regardless of which account you're deploying to.`
    : `5. **💵 Cash deployment** — He has $0 cash across all accounts. Options: (a) skip this section, (b) for ONE specific account, recommend a TRIM/SELL first and then a BUY sized against the trim's PRO-FORMA proceeds in the SAME account/currency (both legs spec'd, SELL rec appears before the BUY, "Cash source: $X from <TICKER> SELL above" cited on the BUY), or (c) recommend a deposit first. Cross-account pooling still forbidden.`;

  const goalsBlock = profile.goals && profile.goals.trim().length > 0
    ? `\n🎯 USER GOALS & CONSTRAINTS (read FIRST — every rec must be coherent with these):\n${profile.goals.trim()}\n\nHow to factor goals into recs:\n- Recommendations conflicting with goals must be REJECTED or modified — don't silently override.\n- If a goal implies a withdrawal date, size positions and stops to make cash available by that date.\n- If a goal designates capital as long-term, don't redeploy it for short-horizon trades.\n- If a goal sets an account limit ("RRSP limit X"), prioritize filling that account when new cash is available.\n- Surface goal/opportunity tradeoffs explicitly; reference goals by name in rec rationale.\n`
    : "";

  const noTouchBlock = profile.noTouchMode
    ? `\n🕗 NO-TOUCH MODE (mandatory — this user queues every order before ~8:45 AM ET and cannot adjust during the session):
- orderTiming rules OVERRIDE the general defaults below:
    • DEFAULT for BUY/SELL recs: "gtc" (limit order works until filled or manually cancelled, survives multiple sessions).
    • Only use "pre-market" when the thesis is a gap-and-go / earnings-morning trade where a missed open kills the setup.
    • NEVER emit orderTiming="post-10am" or orderTiming="at-open" — those windows are non-actionable for this user.
- ADD A REQUIRED SECTION AT THE VERY TOP OF THE BRIEFING (before section 0), heading exactly "## 🕗 Queue before 8:45 AM ET":
    Write a compact, copy-paste-ready order list. One numbered line per queued order plus its after-fill stop, in this exact format:

    1. LIMIT BUY 40 sh NVDA @ $145.20 USD · GTC (Non-Spousal)
       After fill: GTC STOP-LIMIT SELL 40 sh NVDA, stop $138.50 / limit $137.10
    2. LIMIT SELL 500 sh ENB @ $75.80 CAD · GTC (RRSP)
       (no after-fill line — this is a closing SELL)
    3. SELL to open 2 × 2026-08-15 $85 CALL @ $1.85 USD · GTC (Non-Spousal covered call over 200 NVDA sh)

    Rules for this section:
    - Include ONE numbered entry per actionable rec that appears in sections 4 / 5 / 7 / 8 / 6a of the briefing. Skip HOLD entries and skip anything not orderable via a broker ticket.
    - LIMIT price = the exact numeric limit from the rec's Order ticket line, in native currency.
    - Duration = Day OR GTC — pick whichever matches the rec's orderTiming ("pre-market" → Day, "gtc" → GTC).
    - Account tag in parentheses at the end (Non-Spousal | RRSP | TFSA | RESP | FHSA).
    - After-fill line ONLY for BUY orders (open a new position or scale in). SELL that closes an existing position needs no after-fill line.
    - If there are zero actionable orders today, write ONE line: "No orders to queue today — hold current positions." then move to section 0.
    - Do not add explanation/prose inside this section; explanation belongs in the narrative sections below.
- Intraday briefings for this user are already downgraded to hard-stop-only alerts server-side, so DO NOT include "monitor for entry zone" or "watch for intraday breakout" instructions in the morning briefing — those are dead letters.
- Section 6 "Watch list" should be reframed as "GTC alerts to consider" — levels the user might want a GTC alert set at, not intraday triggers to monitor.
`
    : "";

  // The static senior-analyst rubric, PRICE/ORDER/MULTI-DAY/TAX/SIGNALS
  // blocks and OUTPUT FORMAT rules now live in STATIC_SYSTEM_PROMPT
  // (Anthropic prompt cache). Only per-call dynamic context is below.
  const userMessage = `Today's morning briefing for ${profile.email}.

Today: ${today}
Risk tolerance: ${profile.riskTolerance}${goalsBlock}${noTouchBlock}

Total portfolio (CAD): ~$${Math.round(summary.total).toLocaleString()} ← FOR YOUR REFERENCE ONLY. DO NOT INCLUDE this aggregate dollar figure in the briefing output.

Holdings:
${summary.table}
${cashBlock}
${formatCanonicalPortfolioBlock(summary?.canonical)}
${formatUpswitchBlockSafe(summary?.upswitch)}
${alertsBlock}
${formatLessonsBlock(lessons)}
${formatMacroFredBlock(macroFred)}
${formatMacroBlock(macro)}
${formatFactorBlock(factors)}
${formatLifecycleBlock(lifecycle)}
${formatMarketPulseBlock(marketPulse)}
${formatQuantSignalsBlock(quantSignals)}
${formatInsiderSignalsBlock(insiderSignals)}
${formatOptionsFlowBlock(optionsFlow)}
${formatRecentTradesBlock(recentTrades)}
${formatDailyPicksBlock(dailyPicks)}
${formatDiscoveryPoolBlock(discoveryPool)}
${formatSectorRotationBlock(sectorRotation)}
${formatPerHoldingSectorMap(profile.positions || [], sectorRotation)}
${formatCorrelationBlock(correlations)}
${formatFedLiquidityBlock(fedLiquidity)}
${formatCongressionalBlock(congressional)}
${format13FBlock(whale13F)}
${formatPositionStopBlock(monitorPositionStops(profile.positions || [], profile.accounts || []))}
${formatSleeveBalanceBlock(computeSleeveBalance(profile.positions || [], profile.fxUsdCad || 1.37, profile.sleeveTargets))}
${formatCalibrationBlock(calibration)}
${formatBenchmarkBlock(benchmarkBundle?.userTwrr, benchmarkBundle?.benchmarks)}
${formatSizingAdjustmentBlock(sizingAdjustments)}
${formatOverlayBlock(overlaySuggestions)}
${formatSizingBlock(sizedPicks)}
${formatPyramidingBlock(pyramidingSignals)}
${formatTradingRegimeBlock(tradingRegime)}
${formatUnusualOptionsBlock(unusualOptions)}
${formatRiskBudgetBlock(riskVar, lossCooldown)}
${formatComplianceBlock(compliance, { weeklyHeartbeat: isMondayEt })}
${formatAttributionBlock(attribution)}
${formatHorizonReviewBlock(horizonRows)}
${formatBriefingHistoryBlock(briefingHistory)}
${formatCriticFeedbackBlock(briefingHistory)}
${formatTranscriptsBlock(transcripts)}
${tradingCostsBlock}

STRUCTURAL DIRECTIVE — the briefing now uses a Daily Orders format. The backend prepends four DETERMINISTIC sections before you write anything:

   §1. MANDATORY ACTIONS   (hard stops, price-verify flags, horizon expiries, sleeve rebalances, TRIM SPEC)
   §2. FORBIDDEN TODAY     (which new-BUY types are blocked by sleeve / concentration / price-integrity rules)
   §3. ONE-LINE STATUS     (5-second scannable summary — CORE / SPEC / stops / regime / new-ideas allowed)
   §4. OPTIONAL ideas      (heading only — YOU write beneath)

YOU WRITE FROM SECTION 4 DOWNWARD. Do NOT write §1, §2, or §3 — they're pre-rendered from monitors and would be duplicated / contradicted if you re-emit them. Your output is:

   §4 body (compact table + optional narrative for any TRUE new ideas)
   §0b. ✅ Trades you executed since last briefing  (only when executed-trades block is non-empty)
   ---
   ## 📎 Appendix — research & context
   §A1. Overnight & macro
   §A2. Per-holding signals (compact TICKER | STATUS | NOTES table)
   §A3. Watch list (GTC alerts, not intraday triggers)
   §A4. Performance snapshot
   §A5. Any deeper research

Behavioural rules the pre-rendered §1/§2 imply that you must respect:
   • If §1 shows a CORE REBALANCE mandate — §4 has ONE allowed BUY class: CORE ETFs (XEQT / VUN / XIU). Any SWING/SPEC "new idea" you'd have proposed is REPLACED with the rebalance. No exceptions.
   • If §1 shows a SELL AT MARKET hard-stop hit — §4 acknowledges the exit and cites the proceeds destination (either the CORE rebalance or explicit next allowed BUY).
   • If §1 shows a VERIFY MANUALLY price-integrity flag — the flagged ticker gets ONE line in the Appendix per-holding table saying "PRICE SUSPECT — do not act". No SELL, no rec, no analysis of the fake number.
   • If §2 forbids new SPEC / new SWING — do NOT surface any such rec in §4, even from Test A / Discovery pools. Replace with "SPEC/SWING blocked today per §2 forbidden list."
   • The §3 Status line includes a SECTOR TILT (Leaders / Laggards by 60d RS vs SPY). §4 new ideas MUST prefer leader-sector tickers; a laggard-sector name is only allowed with an explicit one-line exception reason ("earnings beat, RS turning"). CORE ETFs are always allowed regardless of sector tilt. Do NOT re-emit the sector ranking or write multi-paragraph sector commentary — the tilt line above is enough.
   • **NO HEDGE VOCAB IN §1–§4.** Banned phrases in the primary action sections: "consider", "or cash", "cleanest path", "patience > forcing", "better:", "actually:", "wait for a clean setup", "skip today", "pending a...", "or FX convert". If a rec doesn't qualify, DON'T write it and DON'T narrate the alternatives — just omit. Multi-account "deliberation" sections that walk through NVDA→IWM→CNQ→"actually skip TFSA" are forbidden. §1 already says exactly what to deploy where; §4 executes with one order ticket per accepted line and NO alternative-narratives.
   • **DO NOT WRITE A "## 5. 💵 Cash deployment" SECTION.** §1 DEPLOY CASH is the single source of truth for cash deployment. Any per-account tickets go directly in §4 as compact order lines (no §5 header, no hedgy per-account walkthrough).
   • **NEVER OVERRIDE §1 STOP MANDATES IN PROSE.** If §1 emits SELL AT MARKET for a ticker, §A2 / Appendix must NOT write "acknowledge stop hit but DO NOT exit" or "hold despite stop" or any variant that argues against the mandated exit. Long-horizon or dividend theses do NOT override the hard-stop rule — if that framing applies to a name, the name belongs in a different sleeve with wider stops, not in narrative loopholes. Reframing a stop hit as "monitor, do not churn" is a compliance violation.
   • **TRAIL STOP REVIEW ≠ MANDATORY EXIT.** If §1 shows "TRAIL STOP REVIEW" for a ticker (three-way choice: EXIT / TIGHTEN / HOLD-with-trigger) — do NOT emit a SELL rec for it in §4, do NOT write "mandatory exit at market" for it, and do NOT queue a DO TODAY ticket. TRAIL_SOFT means drawdown from 60d peak is <6% and no cost-basis hard-stop hit — this is a decision review, not an automatic fundamental sell. If you were about to write a SELL rec on that ticker: don't. Note in §A2 that trail is under review, one line.
   • **BLOCKED TICKERS ARE DEAD FOR THIS BRIEFING.** If the validator BLOCKS a rec for a ticker (surfaces in §5 as BLOCKED), do NOT re-suggest that ticker in §4 OPTIONAL, §A3 Watch list, layer/pullback entry plans, or anywhere else as an action. Not "when it dips to $X we could layer", not "funded by TICKER proceeds", not "would be a great pullback add." Blocked = one line under §5 only; the ticker vanishes from all action language until the next briefing.
   • **NO SWING/SPEC FUNDING FROM MANDATORY CORE-GAP EXITS.** If §1 shows a mandatory SELL (HARD or TRAIL_HARD severity) AND CORE is >5pp underweight, the proceeds MUST be routed to CORE ETFs (XEQT / VUN / XIU / VOO / VTI by account currency) — never to a SWING or SPEC name. Do NOT write "SELL X → BUY GOOGL with the proceeds" or similar. §1 already emits the CORE DEPLOY paired ticket; §4 executes exactly that, no substitutions.
   • **DO NOT INVENT ANALYST NUMBERS.** If you can't cite a specific EPS beat / miss / analyst PT with confidence, OMIT the number — write "beat" / "raised guidance" without a fake precise figure. Do NOT write "EPS $2.00 vs $20.59 estimate" (the estimate is not that). Better silent than confidently wrong.

§4 OPTIONAL ideas — **BULLETED / TABLE ONLY. NO PROSE PARAGRAPHS.**
   ONE line per idea, priority-ordered, compact table format:
   TICKER | ACTION | SIZE | TRIGGER / LEVEL | STOP | NOTES (1 line, max ~15 words)
   Example:
   TRP.TO | BUY | 45 sh | $99.60 max, GTC | $94.78 | Pocket pivot 59, SWING sleeve; funded by 53-sh ENB trim.
   XEQT   | BUY | 60 sh | at market post-10am | — | CORE rebalance mandate (§1) — buy on any tap.

   **Format enforcement — every one violates this section:**
   • NO framing/preamble paragraph before the table ("Given the current regime…", "Here are today's ideas…").
   • NO between-row commentary paragraphs — put reasoning in the NOTES cell, one line, or leave the row out.
   • NO trailing wrap-up paragraph after the table ("Overall, these ideas balance…").
   • NO multi-sentence NOTES cells — one sentence, one clause preferred.
   • NO section commentary about §4 itself ("This section is bulleted for clarity" is still prose — omit).
   • If the pipe-table format doesn't render for your row, use a single bullet — "- TICKER: ACTION N sh @ LEVEL, stop STOP (NOTES)." — still one line.

   If nothing survives the §2 forbidden list, write EXACTLY: "No new ideas today — every allowed slot is being spent on the §1 mandates above." Nothing else. Do NOT invent a rec to fill space and do NOT narrate the absence.

0b. **✅ Trades you executed since last briefing** — REQUIRED when the "TRADES YOU EXECUTED SINCE LAST BRIEFING" block above is non-empty. ONE line per BUY/SELL leg, format unchanged:
   • BUY fulfilling AI rec: "**BOUGHT** N sh TICKER @ $entry CCY on YYYY-MM-DD — fulfills the [rec-type] BUY. Current $X (Y% vs entry). On track / past halfway / pulled back."
   • BUY without linked rec: "**BOUGHT** N sh TICKER @ $entry — no linked rec; treat as fresh."
   • SELL: "**SOLD** N sh TICKER @ $exit — [closed/trim/rebal]. Realized ~$Y."
   **NO-REPEAT INVARIANT**: any ticker in the current-holdings table can ONLY appear as ADD / HOLD / TRIM / EXIT in §4 or the Appendix — never as a fresh BUY.

APPENDIX (## 📎 Appendix — research & context) — comes AFTER §4 + §0b, before the trailing <RECS> block. Everything below is optional depth for readers who want it, NOT primary action content:

   §A1. Overnight & macro (1 short paragraph — futures, VIX, USD/CAD, oil, Fed/BoC)
   §A2. Per-holding signals — ONE BULLET per held ticker. **BULLETED LIST, NOT A PIPE TABLE** — pipe tables reliably collapse into a single unreadable line in the email renderer. Format each row as:
        - **TICKER** [SLEEVE · WEIGHT · P/L · stop-dist] — STATUS
        Example: - **ENB** [SWING · 14.4% · +2% · 4.4% slack] — HOLD — earnings intact
        Each ticker gets its own bullet on its own line. Blank line between bullets is optional. Only expand into paragraph form for tickers that had NEW material info today (earnings result, downgrade, headline). Everything else stays one bullet.

        **SECTOR-COOLING FLAG (rotation-triggered reconsideration):** For each held SWING or SPEC position whose sector is currently in the bottom 3 (see the SECTOR TILT laggards above and the PER-HOLDING SECTOR MAP block for exact ticker→sector→rank mapping), tag the bullet with \`⚠ sector cooling — reconsider hold\` at the end of the STATUS clause. CORE and INCOME positions are exempt (they're either diversified across sectors or picked for yield, not sector momentum). Do NOT tag if the position was ALREADY a laggard-sector name at entry — the tag is a rotation-triggered reconsideration, not a permanent scarlet letter. If unsure, still tag — false positives on a held-review flag are cheap; false negatives silently keep money in cooling positions.
   §A3. Watch list — 2-3 GTC-alert levels the user might set (NOT intraday triggers).
   §A4. Performance snapshot — 1 line week/month/YTD alpha vs SPY/XIC.
   §A5. Any THESIS DISCIPLINE flag from horizon review that didn't already surface in §1.

THESIS DISCIPLINE — MANDATORY, applies to §4 and §A2:
   A TRIM/EXIT on a Curriculate-rec position is INVALID unless one of these fired: target-hit / stop-breached / horizon-expired / well-behind at ≥60% of horizon / material NEW information (earnings surprise, guidance change, downgrade, deal breakup, regulatory action, regime flip). Vague reasons ("small profit locked", "de-risk into the weekend") do NOT qualify.

APPENDIX + <RECS> BLOCK ARE MANDATORY. Emit them EVERY briefing. If some holdings show data anomalies, FLAG each in §A2 with "PRICE SUSPECT" one-liners and CONTINUE — anomalies never truncate the briefing.
${cashSection}

Use web_search aggressively — 6-10 searches focused on tickers that appear in §1 (need current context to justify or refute the mandated action) or §4 (any new idea needs current price/news verification). Skip web_search on quiet holdings in §A2.`;

  return { system: STATIC_SYSTEM_PROMPT, user: userMessage };
}

// Convert briefing markdown into an array of {title, body} cards by
// splitting on H2/H3 headings. Used to populate the in-app Advice tab from
// the latest briefing without a separate Anthropic call.
// The machine-parseable <RECS>[...]</RECS> block belongs in the persisted
// markdown so parseRecsFromBriefing can consume it, but it shouldn't render
// inside the user-facing narrative. Everything downstream that produces
// HUMAN output strips it first; parsing paths keep the full markdown.
export function stripRecsBlock(md) {
  if (!md) return md;
  // Also drop the "---" horizontal-rule separator that often precedes the
  // block so we don't leave an orphan divider.
  return md.replace(/\n?-{3,}\s*\n?\s*<RECS>[\s\S]*?<\/RECS>\s*$/i, "")
           .replace(/<RECS>[\s\S]*?<\/RECS>/gi, "")
           .trim();
}

export function briefingToAdviceCards(md) {
  if (!md || typeof md !== "string") return [];
  const cleaned = stripRecsBlock(md);
  const cards = [];
  // Split on lines beginning with ## or ### (preserves the marker via lookahead)
  const parts = cleaned.split(/\n(?=##{1,2}\s)/);
  for (const part of parts) {
    const m = part.match(/^#{2,3}\s+(.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim().replace(/^[\d.\s]+/, "");
    const body = m[2].trim();
    if (title.length > 0) cards.push({ title, body });
  }
  return cards;
}

// Persist (or upsert) the latest briefing's cards + raw markdown as the
// per-user advice snapshot. Best-effort — never throws.
export async function saveAdviceSnapshot({ email, markdown, source, criticViolations = [] }) {
  try {
    const cards = briefingToAdviceCards(markdown);
    await StocksAdviceSnapshot.findOneAndUpdate(
      { email: email.toLowerCase() },
      {
        $set: {
          generatedAt: new Date(),
          source: source || "cron",
          advice: cards,
          markdown,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.warn("[advice-snapshot] save failed:", e?.message);
  }
  // Also append to briefing history so the next briefing's prompt can
  // reference yesterday's calls. Separate model on purpose — snapshot
  // overwrites; history keeps. Extract just section 2's per-ticker
  // calls (that's where HOLD/TRIM/ADD/EXIT rationale lives) so the
  // replay stays small. Also persist any critic violations flagged
  // against this briefing so (a) the compliance surface can trend
  // repeat-offender patterns and (b) tomorrow's prompt can inject
  // "your last briefing was flagged for X — don't repeat these."
  try {
    const callsExcerpt = extractSignalsPerHoldingSection(markdown).slice(0, 4000);
    await StocksBriefingHistory.create({
      email: email.toLowerCase(),
      generatedAt: new Date(),
      source: source || "cron",
      markdown: markdown.slice(0, 20000),
      callsExcerpt,
      criticViolations: Array.isArray(criticViolations) ? criticViolations : [],
    });
  } catch (e) {
    console.warn("[briefing-history] save failed:", e?.message);
  }
}

// Pull section 2 ("Signals per holding") out of a briefing markdown —
// that's where the AI writes the per-ticker HOLD/TRIM/ADD/EXIT calls +
// rationale we want to replay into the next briefing. Falls back to
// the full text truncated if the header isn't found.
function extractSignalsPerHoldingSection(md) {
  if (!md) return "";
  const startPatterns = [
    /## +2\..*Signals per holding[^\n]*\n/i,
    /## +Signals per holding[^\n]*\n/i,
    /##.*Signals per holding[^\n]*\n/i,
  ];
  let startIdx = -1;
  for (const p of startPatterns) {
    const m = md.match(p);
    if (m) { startIdx = m.index + m[0].length; break; }
  }
  if (startIdx < 0) return md.slice(0, 3000);
  const rest = md.slice(startIdx);
  const nextHeader = rest.match(/\n## +/);
  const end = nextHeader ? nextHeader.index : Math.min(rest.length, 4000);
  return rest.slice(0, end).trim();
}

// Pull the last N briefings for a user, newest first. Returns an array
// of { generatedAt, callsExcerpt, source }. Used by the prompt builder
// to inject continuity context. Never throws — just returns [].
export async function getRecentBriefingHistory(email, limit = 2) {
  try {
    const rows = await StocksBriefingHistory.find({ email: email.toLowerCase() })
      .sort({ generatedAt: -1 })
      .limit(limit)
      .lean();
    return rows;
  } catch (e) {
    console.warn("[briefing-history] fetch failed:", e?.message);
    return [];
  }
}

// Format the recent-briefings block for injection into the next prompt.
function formatBriefingHistoryBlock(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const now = Date.now();
  const lines = ["\nPREVIOUS BRIEFINGS (your recent per-ticker calls — REFERENCE these before writing today's calls):"];
  for (const r of rows) {
    const ageH = Math.max(1, Math.round((now - new Date(r.generatedAt).getTime()) / 3600000));
    const when = new Date(r.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    lines.push(`\n--- ${when} (${ageH}h ago, ${r.source}) ---`);
    lines.push(r.callsExcerpt || "(no signals excerpt captured)");
  }
  lines.push("\nWhen your call on a ticker today matches your prior call above, say so briefly (\"still HOLD — no thesis change\"). When you're changing your call from what you said yesterday or the day before, name the specific NEW information that justifies the change. Reversing without a stated new trigger is the churn pattern we're eliminating.");
  return lines.join("\n");
}

// Format the prior briefing's critic violations as a "don't repeat"
// instruction block. Fed into the next prompt so repeat offenders
// become explicit — the AI sees "yesterday you were flagged for
// unjustified TRIM on CNQ; do NOT do that again unless a specific
// trigger fired." Empty string when there's nothing to feed back.
function formatCriticFeedbackBlock(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  // Collect violations across the last 2 briefings (most recent first
  // — already sorted that way by getRecentBriefingHistory).
  const bucket = [];
  for (const r of rows) {
    for (const v of (r.criticViolations || [])) {
      if (bucket.length >= 8) break;
      bucket.push({
        rule: v.rule, ticker: v.ticker, quote: (v.quote || "").slice(0, 120),
        reason: (v.reason || "").slice(0, 200),
        ageH: Math.max(1, Math.round((Date.now() - new Date(r.generatedAt).getTime()) / 3600000)),
      });
    }
    if (bucket.length >= 8) break;
  }
  if (bucket.length === 0) return "";
  const ruleNames = {
    1: "unjustified TRIM/EXIT",
    2: "unknown-ticker rec",
    3: "price >10% off reference",
    4: "reverses prior briefing without trigger",
    5: "liquidation card on held ticker",
  };
  const lines = ["\nDISCIPLINE-CRITIC FEEDBACK (an independent auditor flagged the following on your recent briefings — do NOT repeat these patterns today):"];
  for (const v of bucket) {
    const label = ruleNames[v.rule] || `rule ${v.rule}`;
    const tk = v.ticker ? ` (${v.ticker})` : "";
    lines.push(`  - [${v.ageH}h ago] ${label}${tk}: "${v.quote}" — ${v.reason}`);
  }
  lines.push("\nIf a similar situation applies today, either (a) don't emit the flagged call at all, or (b) emit it with an explicit, verifiable trigger that resolves the rule (e.g., \"target hit\", \"stop breached\", \"earnings surprise\"). Prose about \"capturing gains\" or \"de-risking\" without a concrete trigger will be flagged again.");
  return lines.join("\n");
}

// Parse trade recommendations from the briefing text and save them for the
// /performance scorecard. Same regex as routes/stocksAdvice.js — kept here
// so this job stays self-contained.
// Same stop-word rejection list as parseRec in stocksAdvice.js — kept
// inline so this file is self-contained.
const BRIEFING_REC_STOP_WORDS = new Set([
  "ALL","ANY","BOTH","BUT","CURRENT","ENTIRE","EVERY","NONE",
  "POSITION","POSITIONS","LOT","LOTS","REMAINING","RESERVE",
  "STOP","TARGET","ENTRY","ACTION","HORIZON","SOURCE",
  "USING","USES","INTO","FROM","BUY","SELL","HOLD","TRIM",
  "NEW","OLD","MORE","LESS","EITHER","NEITHER",
  "THE","AT","ON","TO","OF","FOR","WITH",
  "USD","CAD","EUR","GBP","RRSP","TFSA","RESP","FHSA",
  "MARKET","LIMIT","GTC","DAY","OCO",
]);

// Extract the trailing machine-readable rec block the AI is instructed to
// emit — `<RECS>[{...}, ...]</RECS>` (with optional whitespace). Tolerant
// of code fences, extra whitespace, and trailing commas inside the JSON.
// Returns an array of {action, ticker, entryPrice, targetPrice, stopPrice,
// horizonDays, entryCurrency, shares} — same shape as the regex path.
function extractRecsFromJsonBlock(text) {
  if (!text) return null;
  const m = text.match(/<RECS>\s*([\s\S]*?)\s*<\/RECS>/i);
  if (!m) return null;
  let raw = m[1].trim();
  // Strip optional code fences the model sometimes adds around JSON.
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  // Tolerate trailing commas.
  raw = raw.replace(/,\s*(\}|\])/g, "$1");
  let arr;
  try { arr = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const action = String(r.action || "").toUpperCase();
    if (!["BUY", "SELL", "TRIM", "HOLD"].includes(action)) continue;
    const ticker = String(r.ticker || "").toUpperCase().replace(/\.+$/, "");
    if (!ticker || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(ticker)) continue;
    const entryPrice = Number.isFinite(+r.entry) ? +r.entry
      : Number.isFinite(+r.entryPrice) ? +r.entryPrice : null;
    if (!(entryPrice > 0)) continue;
    const rawTiming = String(r.orderTiming || "").toLowerCase().trim();
    const orderTiming = ["pre-market", "at-open", "post-10am", "gtc"].includes(rawTiming)
      ? rawTiming : null;
    // Account: free-string, whatever name the AI emitted. Trimmed +
    // preserved as-is so downstream comparisons can match the profile's
    // account labels. Null when omitted so legacy briefings keep
    // working; validator rules that need account degrade gracefully.
    const account = typeof r.account === "string" && r.account.trim()
      ? r.account.trim() : null;
    // Sleeve declaration handling — two-tier per Grok clarity rules:
    //   • AI declared a valid sleeve → preserve as-is; validator
    //     cross-checks with classifier and REJECTS on mismatch (the
    //     signal that AI got confused about where the trade fits).
    //   • AI omitted / invalid sleeve → auto-fill from classifier so
    //     the AI can stay terse without triggering false rejections.
    //     Flagged via _sleeveAutoFilled so the mismatch check skips
    //     these (the classifier can't disagree with itself).
    // Net effect: classifier is the single source of truth for sleeve;
    // AI's declaration is only used as a signal of confusion.
    const rawSleeve = typeof r.sleeve === "string" ? r.sleeve.trim().toLowerCase() : "";
    const declaredSleeve = ["core", "swing", "income", "spec"].includes(rawSleeve) ? rawSleeve : null;
    const sleeveWasAutoFilled = !declaredSleeve;
    const sleeve = declaredSleeve || classifyPosition({ ticker });
    // horizonDays: PRESERVE null when AI omitted the field so the
    // validator can reject "no stated holding period." Persist sites
    // apply a default of 30 only AFTER the rec passes validation.
    const horizonDays = Number.isFinite(+r.horizonDays) ? +r.horizonDays : null;
    out.push({
      action,
      ticker,
      account,
      sleeve,
      _sleeveAutoFilled: sleeveWasAutoFilled,
      shares: Number.isFinite(+r.shares) ? Math.floor(+r.shares) : null,
      entryPrice,
      // targetPrice / stopPrice: require > 0 not just finite —
      // otherwise `+"0"` = 0 passes the finite check and gets stored
      // as $0.00, which renders as garbage in the Positions view
      // Target/Stop columns and collapses the position-bar scale.
      // User Aug 13 flagged XEQT rendering "target $0.00".
      targetPrice: (Number.isFinite(+r.target) && +r.target > 0) ? +r.target
        : (Number.isFinite(+r.targetPrice) && +r.targetPrice > 0) ? +r.targetPrice : null,
      stopPrice: (Number.isFinite(+r.stop) && +r.stop > 0) ? +r.stop
        : (Number.isFinite(+r.stopPrice) && +r.stopPrice > 0) ? +r.stopPrice : null,
      horizonDays,
      entryCurrency: ["USD", "CAD"].includes(String(r.currency || r.entryCurrency || "").toUpperCase())
        ? String(r.currency || r.entryCurrency).toUpperCase()
        : "USD",
      orderTiming,
      // High-conviction SPEC gate fields — validator uses these to
      // reject SPEC BUYs that lack a multi-quarter thesis. Preserved
      // as-parsed so `null` / missing = rejection signal (per spec).
      thesisHorizonMonths: Number.isFinite(+r.thesisHorizonMonths) ? +r.thesisHorizonMonths : null,
      structuralDriver: typeof r.structuralDriver === "string" && r.structuralDriver.trim()
        ? r.structuralDriver.trim() : null,
      // Smart-money-follow bypass field. Set only when the SPEC thesis
      // IS piggybacking a public smart-money filing (congressional
      // trade / Form 4 cluster / unusual options flow). When present
      // (and a member of the whitelist), the validator bypasses the
      // SPEC gate but hard-caps position size at 0.5% of book per rec
      // + 2% aggregate across the batch. Anything not in the
      // whitelist parses to null so the bypass can't be triggered
      // with an arbitrary string.
      signalSource: (function () {
        const s = typeof r.signalSource === "string" ? r.signalSource.trim().toLowerCase() : "";
        return ["congressional-follow", "insider-cluster-buy", "unusual-options-flow"].includes(s) ? s : null;
      })(),
    });
  }
  return out;
}

export function parseRecsFromBriefing(text) {
  // Prefer the machine-parseable JSON block emitted at the end of the
  // briefing. If it's present and well-formed, we're done.
  const jsonRecs = extractRecsFromJsonBlock(text);
  if (Array.isArray(jsonRecs) && jsonRecs.length > 0) return jsonRecs;

  const recs = [];
  const re = /Action:\s*(BUY|SELL|TRIM|HOLD)\s*(\d[\d,]*)?\s*(?:sh)?\s*([A-Z][A-Z0-9.\-]{0,15})\b[^.]*?(?:Entry:\s*\$?([\d.]+))?[^.]*?(?:Target:\s*\$?([\d.]+))?[^.]*?(?:Stop:\s*\$?([\d.]+))?[^.]*?(?:Horizon:\s*([^.\n]+))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const [, action, sharesStr, tickerRaw, entry, target, stop, horizon] = m;
    let ticker = String(tickerRaw || "").toUpperCase().replace(/\.+$/, "");
    // Reject English stop-words; try to find a real ticker in the same chunk.
    if (BRIEFING_REC_STOP_WORDS.has(ticker)) {
      // Look ahead in the next ~200 chars for a proper ticker
      const chunk = text.slice(m.index, m.index + 200);
      const scan = /\b([A-Z]{2,5}(?:\.[A-Z]{1,3})?)\b/g;
      let s, real = null;
      while ((s = scan.exec(chunk)) !== null) {
        const cand = s[1].toUpperCase().replace(/\.+$/, "");
        if (!BRIEFING_REC_STOP_WORDS.has(cand)) { real = cand; break; }
      }
      if (!real) continue; // drop this rec
      ticker = real;
    }
    let horizonDays = 30;
    if (horizon) {
      const h = horizon.toLowerCase();
      const num = parseInt(h.match(/(\d+)/)?.[1] || "0", 10) || 1;
      if (h.includes("day")) horizonDays = num;
      else if (h.includes("week")) horizonDays = num * 7;
      else if (h.includes("month")) horizonDays = num * 30;
      else if (h.includes("year")) horizonDays = num * 365;
    }
    if (entry) {
      const entryCurrency = detectRecCurrency(text.slice(m.index, m.index + 200), ticker);
      recs.push({
        action: action.toUpperCase(),
        ticker,
        shares: sharesStr ? parseInt(sharesStr.replace(/,/g, ""), 10) : null,
        entryPrice: parseFloat(entry),
        targetPrice: target ? parseFloat(target) : null,
        stopPrice: stop ? parseFloat(stop) : null,
        horizonDays,
        ...(entryCurrency ? { entryCurrency } : {}),
      });
    }
  }
  return recs;
}

export async function generateBriefing(profile) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  // Compute the canonical portfolio ONCE at the top of the briefing
  // pipeline. Every downstream call that needs a position weight, sleeve
  // weight, sector weight, or cash % now reads from `canonical` instead
  // of recomputing. `summary` is a thin adapter over the same canonical
  // (see portfolioSummary above) so all its .total/.table/.cashCadEquiv
  // values are guaranteed consistent with `canonical.totals.book_cad`,
  // canonical.cash.cash_cad_equiv, etc.
  const summary = portfolioSummary(profile);
  const canonical = summary.canonical; // may be null on empty portfolios
  // Trades executed since the last successful briefing (or last 3 days if
  // none yet). Feeds the "TRADES YOU EXECUTED" prompt block so the AI can
  // acknowledge what the user actually took vs what was just recommended.
  const lastBriefingAt = profile.lastBriefingSuccessAt
    ? new Date(profile.lastBriefingSuccessAt)
    : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  // Compute TWRR + benchmark returns over WoW / YTD / since-start
  // windows so the briefing can cite alpha vs SPY / XIC. Done as its
  // own tiny bundle before Promise.all so the benchmark call gets the
  // TWRR values it compares against.
  const benchmarkBundle = await (async () => {
    try {
      const now = new Date();
      const wowStart = new Date(now); wowStart.setDate(wowStart.getDate() - 7);
      const ytdStart = new Date(`${now.getUTCFullYear()}-01-01T00:00:00Z`);
      const startWindow = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const [wow, ytd, all] = await Promise.all([
        computeTwrr(profile.email, wowStart, now).catch(() => null),
        computeTwrr(profile.email, ytdStart, now).catch(() => null),
        computeTwrr(profile.email, startWindow, now).catch(() => null),
      ]);
      if (!wow && !ytd && !all) return null;
      const userTwrr = {
        wowPct: wow?.twrrPct ?? null,
        ytdPct: ytd?.twrrPct ?? null,
        sinceStartPct: all?.twrrPct ?? null,
      };
      const bench = await computeBenchmarkReturns({
        oldestSnapshotDate: all?.startDate || wow?.startDate || ytd?.startDate,
        latestSnapshotDate: all?.endDate || wow?.endDate || ytd?.endDate,
      }).catch(() => null);
      return { userTwrr, benchmarks: bench };
    } catch { return null; }
  })();

  // Run all upstream signals in parallel
  const [monitorRes, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock, dailyPicks, recentTrades, sectorRotation, correlations, fedLiquidity, congressional, discoveryPool, calibration, macroFred, insiderSignals, optionsFlow, marketPulse, whale13F] = await Promise.all([
    monitorOpenRecs(profile.email).catch((e) => { console.warn("[monitorOpenRecs] warn:", e?.message); return { alerts: [] }; }),
    computeQuantSignals(profile).catch((e) => { console.warn("[computeQuantSignals] warn:", e?.message); return {}; }),
    getMacroContext().catch((e) => { console.warn("[getMacroContext] warn:", e?.message); return null; }),
    computeLifecycle(profile).catch((e) => { console.warn("[computeLifecycle] warn:", e?.message); return null; }),
    computeFactorTilts(profile).catch((e) => { console.warn("[computeFactorTilts] warn:", e?.message); return null; }),
    computeLessons(profile.email).catch((e) => { console.warn("[computeLessons] warn:", e?.message); return null; }),
    getTranscriptsForTopHoldings(profile).catch((e) => { console.warn("[getTranscriptsForTopHoldings] warn:", e?.message); return null; }),
    buildStarredWatchListBlock(profile.email).catch(() => ""),
    // Deterministic swing-trade picks — feed the AI so it can narrate them
    // in a dedicated section, AND persist them to StocksDailyPick so Test A
    // tracking works whether or not the daily-pick cron ran independently.
    // Exclude tickers the user already holds so we don't propose a fresh
    // entry on a position they just took (or took a while ago) — the
    // "Signals per holding" section manages those instead.
    generateDailyPicksForUser({
      email: profile.email,
      n: 2,
      excludeTickers: (profile.positions || []).map((p) => String(p.ticker || "").toUpperCase().replace(/\..*$/, "")),
    }).catch((e) => { console.warn("[generateDailyPicksForUser] warn:", e?.message); return []; }),
    // Trades the user actually executed since the last successful briefing.
    // Populated with each trade's linked rec (if any) so the AI can quote
    // the target/stop of the rec that was taken.
    StocksTradeJournal.find({ email: profile.email, executedAt: { $gte: lastBriefingAt } })
      .populate("linkedAdviceRecId", "ticker action entryPrice targetPrice stopPrice horizonDays")
      .populate("linkedDailyPickId", "ticker entryPrice targetPrice stopPrice horizonDays setupName deterministicScore")
      .sort({ executedAt: -1 })
      .lean()
      .catch((e) => { console.warn("[recentTrades] warn:", e?.message); return []; }),
    // 11-sector rotation ranking — cached 4h across all users.
    getSectorRotation().catch((e) => { console.warn("[sectorRotation] warn:", e?.message); return null; }),
    // Pairwise correlation across the user's holdings — flags hidden
    // concentration ("three names but one bet") that raw diversification-
    // count metrics miss. Compact: computed off held tickers only.
    (async () => {
      // Retrofit: pull tickers / currencies / weights from the canonical
      // portfolio so correlations use exactly the CAD-value weights the
      // briefing (and every other section) is going to report. Previously
      // this recomputed weights inline — a duplicate-calc site that could
      // drift from portfolioSummary.
      if (!canonical) return null;
      const tickers = [];
      const currencies = {};
      const weights = {};
      for (const pos of canonical.positions) {
        const t = String(pos.ticker || "").toUpperCase();
        if (!t) continue;
        tickers.push(t);
        currencies[t] = pos.currency || "USD";
        weights[t] = (weights[t] || 0) + (pos.cad_value || 0);
      }
      return await computeCorrelations({ tickers, currencies, weights });
    })().catch((e) => { console.warn("[correlations] warn:", e?.message); return null; }),
    // Fed liquidity regime — cached 12h, free from FRED
    getFedLiquidity().catch((e) => { console.warn("[fedLiquidity] warn:", e?.message); return null; }),
    // Congressional trades matching user's holdings (last 45d)
    (async () => {
      const tickers = (profile.positions || []).map((p) => String(p.ticker || "").toUpperCase().replace(/\..*$/, "")).filter(Boolean);
      return await getCongressionalTradesForTickers(tickers, { maxAgeDays: 45 });
    })().catch((e) => { console.warn("[congressional] warn:", e?.message); return null; }),
    // Top Discovery candidates from the last 45 days (score ≥ 60,
    // excluding already-held tickers). Feeds the SPEC-sleeve source
    // pool in section 7 — "aggressive new ideas" now pulls from
    // adversarially-verified Discovery picks instead of the AI
    // inventing them cold.
    (async () => {
      const heldSet = new Set((profile.positions || []).map((p) => String(p.ticker || "").toUpperCase().replace(/\..*$/, "")));
      const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      const cands = await StocksDiscoveryCandidate.find({
        email: profile.email,
        scanDate: { $gte: since },
        score: { $gte: 60 },
      }).sort({ score: -1, scanDate: -1 }).limit(20).lean();
      return (cands || []).filter((c) => !heldSet.has(String(c.ticker || "").toUpperCase().replace(/\..*$/, "")));
    })().catch((e) => { console.warn("[discoveryPool] warn:", e?.message); return []; }),
    // Score → outcome calibration — buckets THIS user's closed picks by
    // score band + setup + MTF confluence so the AI can tilt toward
    // combinations that have historically paid off for them.
    computeCalibration(profile.email).catch((e) => { console.warn("[computeCalibration] warn:", e?.message); return null; }),
    // Phase 2: FRED macro regime — deterministic yield-curve / credit /
    // vol / FX numbers. Gated by FRED_API_KEY + FRED_DISABLED kill-switch;
    // returns ok:false when off and formatter silent-omits.
    getMacroFred().catch((e) => { console.warn("[macroFred] warn:", e?.message); return null; }),
    // Phase 1: SEC Form 4 cluster-buy / cluster-sell signals for held +
    // starred tickers. Signals are pre-computed by the nightly
    // insider-sync cron; this just reads recent rows.
    getInsiderSignalsForUser(profile).catch((e) => { console.warn("[insiderSignals] warn:", e?.message); return null; }),
    // Phase 4: options-flow signals (UW-primary + Yahoo-fallback). Scans
    // held + starred universe and persists results. Formatter silent-omits
    // when no signals returned.
    getOptionsFlowForUser(profile).catch((e) => { console.warn("[optionsFlow] warn:", e?.message); return null; }),
    // Time-of-day-aware price pulse — pre-market gap / intraday last-few-hours /
    // last-session-into-close, per holding, with %chg + momentum + rel-volume.
    computeMarketPulse(profile).catch((e) => { console.warn("[computeMarketPulse] warn:", e?.message); return null; }),
    // 13F institutional whale filings (curated list, weekly-sync'd from SEC EDGAR,
    // 45-day filing lag). Read-only here; the stocks13FSync cron populates the
    // collection. Formatter silent-omits when no whales persisted yet.
    getLatestWhaleFilings().catch((e) => { console.warn("[whale13F] warn:", e?.message); return []; }),
  ]);
  const monitorAlerts = monitorRes?.alerts || [];
  const monitorStopHitRecs = monitorRes?.stopHitRecs || [];

  // Portfolio upswitch engine — every held position scored on the same
  // multi-factor composite as candidates, then each weakest incumbent
  // paired with strongest challenger under a sleeve-specific hurdle
  // (SWING +15, SPEC +20, INCOME +25, CORE +40). Renders §1b in the
  // briefing OR an explicit "NONE — no challenger cleared the hurdle"
  // line, so the briefing proves the engine actually looked rather
  // than silently omitting the section. Fire-and-forget on error —
  // upswitch is additive, never blocks the briefing.
  let upswitchResult = null;
  try {
    const { computeUpswitchOpportunities } = await import("../services/stocksUpswitch.js");
    upswitchResult = await computeUpswitchOpportunities({
      canonical,
      candidates: dailyPicks || [],
    });
    if (upswitchResult?.summary) {
      console.log(`[upswitch] scored=${upswitchResult.summary.heldScored} vs ${upswitchResult.summary.candidatesConsidered} → upswitch=${upswitchResult.summary.upswitchCount} exit-to-cash=${upswitchResult.summary.exitToCashCount} keep=${upswitchResult.summary.keepCount}`);
    }
    // Attach to summary so buildBriefingPrompt can inject it into the
    // AI prompt via ${summary?.upswitch}. Same pattern the canonical
    // portfolio uses (summary.canonical).
    if (summary) summary.upswitch = upswitchResult;
  } catch (e) { console.warn("[upswitch] warn:", e?.message); }
  // Horizon review — per-open-rec status against its stated window.
  // Runs in a separate step because it fetches prices per rec symbol
  // and benefits from the priceMap that monitorOpenRecs already
  // computed; we recompute here for isolation.
  const horizonRows = await computeHorizonReview(profile.email).catch((e) => {
    console.warn("[computeHorizonReview] warn:", e?.message);
    return [];
  });
  // Recent briefing history — so the AI can cite yesterday's calls
  // instead of pivoting arbitrarily. Pulls the last 2 briefings for
  // this user (source-agnostic — cron, on-demand, intraday all count).
  const briefingHistory = await getRecentBriefingHistory(profile.email, 2);
  // Idempotently persist daily picks. The daily-pick cron may have already
  // written today's rows, and briefing preview may fire multiple times
  // per day — dedupe by (email, ticker, ymd) so a scanning user doesn't
  // see the same pick 4× on the Daily Picks card.
  try {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    for (const p of dailyPicks) {
      const dupe = await StocksDailyPick.exists({
        email: profile.email,
        ticker: p.ticker,
        pickDate: { $gte: dayStart, $lte: dayEnd },
      });
      if (dupe) continue;
      await StocksDailyPick.create({
        email: profile.email,
        pickDate: now,
        ticker: p.ticker,
        currency: p.currency || "USD",
        entryPrice: p.entryPrice,
        targetPrice: p.targetPrice,
        stopPrice: p.stopPrice,
        horizonDays: 10,
        deterministicScore: p.deterministicScore,
        scoreContributors: p.scoreContributors,
        setupName: p.setupName,
        mtfConfluence: p.mtfConfluence,
        rationale: `Injected from morning briefing · ${p.rationale}`,
        viaCanary: p.viaCanary === true,
      });
    }
  } catch (e) { console.warn("[daily-picks briefing persist]:", e?.message); }

  // Correlation-adjusted sizing for today's candidate tickers (Test A
  // picks + Discovery pool). If the candidate is highly correlated
  // with a chunky existing position, the sizing multiplier tells the
  // AI to half-/quarter-size the rec rather than double the exposure.
  const sizingCandidates = [
    ...(dailyPicks || []).map(p => ({ ticker: p.ticker, currency: p.currency || "USD" })),
    ...(discoveryPool || []).map(c => ({ ticker: c.ticker, currency: c.currency || "USD" })),
  ];
  const sizingAdjustments = sizingCandidates.length > 0
    ? await computeSizingAdjustments({
        candidates: sizingCandidates,
        positions: profile.positions || [],
        fxUsdCad: profile.fxUsdCad || 1.37,
      }).catch(e => { console.warn("[computeSizingAdjustments] warn:", e?.message); return []; })
    : [];

  // Options overlay — concrete covered-call suggestions. Gated by the
  // per-user optionsTradingEnabled toggle (default OFF). When on, the
  // overlay is narrowed to the trader-approved subset: covered calls
  // only, on SWING-sleeve (Canadian large-cap) holdings inside a
  // Non-Spousal-type account, IV rank ≥ 70.
  const overlaySuggestions = await computeOverlaySuggestions({
    positions: profile.positions || [],
    fxUsdCad: profile.fxUsdCad || 1.37,
    enabled: !!profile.optionsTradingEnabled,
    accounts: profile.accounts || [],
    narrowSubset: true,
  }).catch(e => { console.warn("[computeOverlaySuggestions] warn:", e?.message); return []; });

  // Discipline compliance + return attribution — the weekly-Monday
  // pair. Compliance always runs but silences unless there's a hit;
  // attribution runs only on Mondays (once/week is plenty).
  const isMondayEt = (() => {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: profile.briefingTz || "America/New_York", weekday: "short" });
      return fmt.format(new Date()) === "Mon";
    } catch { return false; }
  })();
  const [compliance, attribution] = await Promise.all([
    computeCompliance(profile.email).catch(e => { console.warn("[computeCompliance] warn:", e?.message); return null; }),
    isMondayEt
      ? computeAttribution(profile.email).catch(e => { console.warn("[computeAttribution] warn:", e?.message); return null; })
      : Promise.resolve(null),
  ]);

  // Vol-scaled / Kelly position sizing for today's daily picks (Test A).
  // Gated by profile.volSizingEnabled — off by default. When on, each
  // pick is run through computeOptimalSize using the setup-scorecard
  // expectancy map and the pick's own ATR context (already in the
  // pick's scoreContributors when the deterministic scorer set it,
  // otherwise re-fetched cheaply per pick). The block instructs the
  // AI to emit the computed share counts VERBATIM instead of picking
  // round numbers.
  let sizedPicks = [];
  if (profile.volSizingEnabled && Array.isArray(dailyPicks) && dailyPicks.length > 0) {
    try {
      const setupStats = await getSetupExpectancyMap(profile.email, 365);
      const bookValueCad = summary.total + summary.cashCadEquiv;
      const fx = profile.fxUsdCad || 1.37;
      sizedPicks = await Promise.all(dailyPicks.map(async (p) => {
        try {
          const { getTechnicals } = await import("../services/stocksTechnicals.js");
          const tech = await getTechnicals(p.ticker, p.currency || "USD").catch(() => null);
          const atrPctOfPrice = tech?.atrPctOfPrice;
          if (!Number.isFinite(atrPctOfPrice)) return { ...p, sizing: null };
          const sizing = computeOptimalSize({
            bookValueCad,
            entryPrice: p.entryPrice,
            stopPrice: p.stopPrice,
            currency: p.currency || "USD",
            fxUsdCad: fx,
            atrPctOfPrice,
            setupName: p.setupName,
            setupStats,
            riskPerTradePct: profile.riskPerTradePct || 1.0,
            kellyFractionCap: profile.kellyFractionCap || 0.25,
          });
          return { ...p, sizing };
        } catch (e) {
          console.warn(`[sizing] warn on ${p.ticker}:`, e?.message);
          return { ...p, sizing: null };
        }
      }));
    } catch (e) { console.warn("[sizing] pipeline warn:", e?.message); }
  }

  // Pyramiding add-on signals. Gated by profile.pyramidingEnabled —
  // off by default. When on, scans open entered picks for +1R / +2R
  // triggers and emits an ADD-ON SIGNALS block the AI must surface.
  const pyramidingSignals = profile.pyramidingEnabled
    ? await computePyramidingSignals(profile.email).catch(e => {
        console.warn("[pyramiding] warn:", e?.message); return [];
      })
    : [];

  // Trading regime — synthesizes VIX + SPY + Fed liquidity into a
  // trending / choppy / neutral bias so the AI can prefer the setups
  // most likely to work today. Reuses macro + fedLiquidity already
  // fetched above — zero additional latency.
  let tradingRegime = null;
  try { tradingRegime = computeTradingRegime({ macroContext: macro, fedLiquidity }); }
  catch (e) { console.warn("[trading-regime] warn:", e?.message); }

  // Unusual options activity (UOA) — heuristic institutional flow
  // signal on held tickers + top discovery-pool + today's daily picks.
  // Capped to 20 unique tickers to keep the Yahoo option-chain fan-out
  // sane. Scanner concurrency-bounded to 5. Cached 30 min per ticker.
  const uoaTickers = new Set();
  for (const p of (profile.positions || []).slice(0, 15)) {
    if (p.ticker) uoaTickers.add(String(p.ticker).toUpperCase().replace(/\..*$/, ""));
  }
  for (const c of (discoveryPool || []).slice(0, 3)) if (c.ticker) uoaTickers.add(String(c.ticker).toUpperCase());
  for (const p of (dailyPicks || [])) if (p.ticker) uoaTickers.add(String(p.ticker).toUpperCase().replace(/\..*$/, ""));
  const unusualOptions = await scanUnusualOptionsFlow([...uoaTickers].slice(0, 20))
    .catch(e => { console.warn("[uoa] warn:", e?.message); return []; });

  // Risk budget — portfolio 1-day 95%/99% VaR + loss cooldown detector.
  // Uses quantSignals for per-ticker annualized vol (already computed
  // above for the SIGNALS PER HOLDING block) so no fresh fetch needed.
  const riskVar = (() => {
    try {
      const techByTicker = {};
      for (const [ticker, sig] of Object.entries(quantSignals || {})) {
        if (Number.isFinite(sig?.annualizedVolPct)) techByTicker[ticker] = { annualizedVolPct: sig.annualizedVolPct };
      }
      return computePortfolioVar({ positions: profile.positions || [], fxUsdCad: profile.fxUsdCad || 1.37, techByTicker });
    } catch (e) { console.warn("[risk-var] warn:", e?.message); return null; }
  })();
  const lossCooldown = await computeLossCooldown(profile.email).catch(e => {
    console.warn("[loss-cooldown] warn:", e?.message); return null;
  });

  // Deterministic prefix — sections 0, 0c, and 0d are rendered here
  // from the same input blocks the prompt already carries. Prepended
  // to the AI output at return time. See renderDeterministicPrefix
  // for the scope + rationale.
  const stopMonitor = monitorPositionStops(profile.positions || [], profile.accounts || []);
  const sleeveBalanceForPrefix = computeSleeveBalance(profile.positions || [], profile.fxUsdCad || 1.37, profile.sleeveTargets);

  // Annotate each daily pick with a blockedReason if the current
  // portfolio state would prevent it being placed today. Blocked
  // picks are demoted to Watch List one-liners only — no §4/§7
  // narrative, no <RECS> entry. Same gates the prefix uses:
  // coreLockActive (>10pp under target), specOver (over cap),
  // regime hostile. Sleeve derived from ticker classifier so no
  // AI declaration needed. Mutates dailyPicks in place — the same
  // array is passed to buildBriefingPrompt below and to persisted
  // pick storage elsewhere, so annotation is visible everywhere.
  {
    const _b = sleeveBalanceForPrefix;
    const _coreGapPp = _b?.actualPct?.core != null && _b?.targetsPct?.core != null
      ? _b.targetsPct.core - _b.actualPct.core : 0;
    const _coreLockActive = _coreGapPp > 10;
    const _specOver = !!_b?.specOverLimit;
    const _regimeLabel = String(tradingRegime?.label || tradingRegime?.regime || "").toLowerCase();
    const _regimeHostile = /risk[- ]?off|hostile|bear|contract|distribut/i.test(_regimeLabel);
    let blockedCount = 0;
    for (const pick of (dailyPicks || [])) {
      const sleeve = classifyPosition({ ticker: pick.ticker });
      let reason = null;
      if (_coreLockActive && sleeve !== "core") reason = `CORE ${_coreGapPp.toFixed(1)}pp underweight — only CORE ETF buys allowed today`;
      else if (_specOver && sleeve === "spec") reason = `SPEC sleeve at/over 5% cap`;
      else if (_regimeHostile && (sleeve === "swing" || sleeve === "spec")) reason = `regime ${tradingRegime?.label || tradingRegime?.regime} — no new SWING/SPEC entries`;
      if (reason) { pick.blockedReason = reason; blockedCount++; }
    }
    if (blockedCount > 0) {
      console.log(`[pick-gate] ${blockedCount}/${(dailyPicks || []).length} daily picks demoted to Watch List — ${(dailyPicks || []).filter(p => p.blockedReason).map(p => `${p.ticker}=${p.blockedReason}`).join("; ")}`);
    }
  }
  // Derive base-ticker list of names the operator SOLD in the last
  // ~7 days so the DEPLOY CASH mandate doesn't suggest a ticker they
  // just hard-stopped out of. Same-day recommend-what-you-just-exited
  // reads as tone-deaf and undermines trust in the mandate.
  const recentExits = (() => {
    const out = new Set();
    const cutoff = Date.now() - 7 * 86400 * 1000;
    for (const t of (recentTrades || [])) {
      const when = new Date(t.executedAt).getTime();
      if (!(when >= cutoff)) continue;
      for (const leg of t.legs || []) {
        if (leg.side !== "SELL") continue;
        const base = String(leg.ticker || "").toUpperCase().replace(/\..*$/, "");
        if (base) out.add(base);
      }
    }
    return [...out];
  })();
  // Pre-fetch live prices for the fixed set of default deploy tickers
  // used by §1 mandates (CASH DEPLOY / CORE REBALANCE / paired CORE
  // DEPLOY). Enables mandates to emit ONE specific order ticket with
  // computed share count instead of a list of options. Small handful
  // of tickers so it's cheap; each mandate then picks the first
  // available (not on recentExits, has live price).
  const MANDATE_DEFAULT_TICKERS = [
    // INCOME (CAD-TSX) — force .TO suffix so Yahoo returns TSX price
    // (~$148 CAD for RY) instead of NYSE ADR (~$208 USD). Bare "RY"
    // resolves to the US listing which was producing the wrong-currency
    // deploy amounts observed in the Aug 4 on-demand brief.
    "RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO",
    // CORE (CAD-TSX) — same .TO discipline
    "XEQT.TO", "VUN.TO", "XIU.TO",
    // CORE (USD) — bare symbols resolve to US listing (correct)
    "VOO", "VTI", "QQQ",
    // INCOME (USD) — dividend payers. Bare symbols resolve to US listing.
    "KO", "PEP", "JNJ", "PG", "MO", "ABBV", "MRK", "XOM", "CVX", "O", "VZ", "MMM",
  ];
  let mandateLivePrices = {};
  try {
    mandateLivePrices = await fetchLivePricesForRecs(
      MANDATE_DEFAULT_TICKERS.map(t => ({ ticker: t }))
    );
  } catch (e) { console.warn("[mandate-live-prices] fetch warn:", e?.message); }
  // Pick-engine gates status for §3 Status "GATES" line — makes the
  // filters visible to auditors even on quiet days when no pick
  // fires. Kill-switch state + banned setup names + always-active
  // gate list. Never throws.
  const pickGateStatus = await getPickEngineStatus(profile.email)
    .catch(e => { console.warn("[pick-gate-status] warn:", e?.message); return null; });
  // Week-over-week sector transitions — compare current ranking to the
  // most recent weekly snapshot older than 6 days. Feeds the "🔄
  // Rotation:" line in §3 Status. Never throws — fail-open returns null
  // and the transition line is silently omitted.
  const sectorTransitions = sectorRotation?.rows?.length
    ? await computeSectorTransitions(sectorRotation.rows).catch(e => {
        console.warn("[sector-transitions] warn:", e?.message);
        return null;
      })
    : null;
  const {
    md: deterministicPrefixRaw,
    concentrationMandates: prefixConcentrationMandates,
    mandateRecs: prefixMandateRecsRaw,
    trailSoftTickers: prefixTrailSoftTickers,
  } = renderDeterministicPrefix({
    monitorAlerts,
    monitorStopHitRecs,
    stopMonitor,
    sleeveBalance: sleeveBalanceForPrefix,
    positions: profile.positions || [],
    cashAccounts: profile.accounts || [],
    fxUsdCad: profile.fxUsdCad || 1.37,
    horizonRows,
    tradingRegime,
    sectorRotation,
    sectorTransitions,
    recentExits,
    mandateLivePrices,
    riskVar,
    quantSignals,
    pickGateStatus,
    dailyPicks,
  });

  // ─── Pre-LLM funding validation ───
  // Group mandate BUYs by (account, currency) and verify each bucket is
  // self-funding: BUY cost ≤ starting cash in that bucket + SELL/TRIM
  // proceeds generated inside the same bucket. Any BUY that can't be
  // funded is STRIPPED from the prefix text AND from the mandateRecs
  // list before the AI is asked to describe the redeployment. Prevents
  // "RRSP/CAD BUY $1186 with $0 cash + $0 proceeds" recs from surviving
  // to the audit gate or, worse, to the operator.
  const { md: deterministicPrefix, mandateRecs: prefixMandateRecs, fundingStripped } = validateMandateFunding({
    md: deterministicPrefixRaw,
    mandateRecs: prefixMandateRecsRaw,
    canonical: summary?.canonical || null,
  });
  if (fundingStripped.length > 0) {
    console.warn(`[funding-validator] stripped ${fundingStripped.length} unfundable BUY mandate(s):`, fundingStripped.map(f => `${f.ticker} in ${f.account}/${f.currency} (short $${Math.round(f.shortfall)})`).join("; "));
  }

  // ─── DETERMINISTIC-ONLY MODE (short-circuit) ───
  // When the user hasn't opted in to AI narrative, ship the briefing
  // built entirely from canonical portfolio data + deterministic
  // pick-engine output. NO Anthropic call, NO critic, NO free-form
  // AI narrative. Every number in the email traces to a renderer
  // whose inputs are canonical or FMP-verified. Cost = zero LLM
  // tokens. Zero-hallucination guarantee for the operator's action
  // set (§1 mandates, §1b upswitch, §2 forbidden, §3 status, §4
  // daily picks). The pre-send audit still runs — if canonical
  // itself is inconsistent, the audit blocks and the degraded-
  // fallback (already wired) ships the safest slice.
  if (profile?.aiNarrativeEnabled !== true) {
    console.log(`[stocks-briefing] ${profile.email}: aiNarrativeEnabled=false → deterministic-only mode (no LLM call)`);
    // Weekend/holiday awareness. Use the user's briefingTz to compute
    // "today" in their timezone; if the resulting day is Saturday or
    // Sunday, the header + §1 language switches from "do these today"
    // to "planning for the next trading session". Regular market
    // holidays (Christmas, New Year's Day, etc.) would need a full
    // NYSE calendar; for now, weekend is the common case that was
    // shipping wrong (Aug-22-Saturday briefing saying "do these today").
    const briefingTz = profile?.briefingTz || "America/Toronto";
    let dayName = "";
    let isWeekend = false;
    try {
      const now = new Date();
      dayName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: briefingTz }).format(now);
      isWeekend = dayName === "Saturday" || dayName === "Sunday";
    } catch {}
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: briefingTz });
    const dowDateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: briefingTz });

    // FAIL-CLOSED CASCADE: when canonical reconciliation fails, no
    // downstream section can claim compliance or emit sizing. Rewrite
    // §1 to a DATA ACTION mandate, suppress §4 daily picks (or mark
    // them research-only), and strip any "inside all hard rules"
    // language so the operator doesn't act on a portfolio the engine
    // itself hasn't reconciled.
    const canonical = summary?.canonical || null;
    // Use the SAME sleeveBalance + cashPct the prefix's §3 uses so the
    // two checks can never disagree. Prior attempt read from
    // canonical.sleeves which is derived by a different code path
    // (portfolioCalcEngine) — the two summed to different totals and
    // §3 could suppress the sleeve line while the short-circuit still
    // believed reconciliation was OK. This mirrors line 2684's
    // partsForSum exactly.
    let reconciliationOk = canonical?.reconciliation?.passed === true;
    let sleeveCashSum = null;
    try {
      const b = sleeveBalanceForPrefix;
      const fxLocal = profile.fxUsdCad || 1.37;
      const totalCashCadLocal = (profile.accounts || []).reduce(
        (s, a) => s + (a?.cashCad || 0) + (a?.cashUsd || 0) * fxLocal, 0
      );
      const totalBookCadLocal = (b?.book || 0) + totalCashCadLocal;
      const cashPctLocal = totalBookCadLocal > 0 ? (totalCashCadLocal / totalBookCadLocal) * 100 : 0;
      // Same fix as §3: rescale sleeveBalance.actualPct (book-only
      // denominator) to portfolio-total denominator so it aligns with
      // cashPct. Otherwise the sum is always 100 + cash%, producing a
      // permanent false "reconciliation failed" that suppressed the
      // sleeve mix line for days.
      const bookFracLocal = totalBookCadLocal > 0 ? (b?.book || 0) / totalBookCadLocal : 1;
      const scaledSleeves = ["core", "swing", "income", "spec"]
        .map(k => b?.actualPct?.[k])
        .map(pct => Number.isFinite(pct) ? pct * bookFracLocal : pct);
      const parts = [...scaledSleeves, cashPctLocal].filter(x => Number.isFinite(x));
      if (parts.length === 5) {
        sleeveCashSum = parts.reduce((s, x) => s + x, 0);
        if (Math.abs(sleeveCashSum - 100) > 2.5) reconciliationOk = false;
      } else {
        reconciliationOk = false;
      }
    } catch { reconciliationOk = false; }
    let mdPrefixForShip = deterministicPrefix;
    if (canonical && !reconciliationOk) {
      const sumStr = Number.isFinite(sleeveCashSum) ? `${sleeveCashSum.toFixed(1)}%` : "n/a";
      const dataMandate = `**⚠ MANDATORY DATA ACTION** — canonical portfolio reconciliation failed (sleeves + cash = ${sumStr}, expected 100%). Trading recommendations that require portfolio sizing, sleeve headroom, or hard-rule compliance are **SUSPENDED** for this slot. Fix the upstream cash/position math (see Advice diagnostics), then re-run the briefing. Everything below is informational only — do not treat as actionable orders.`;
      mdPrefixForShip = mdPrefixForShip
        .replace(/None\.\s*Portfolio is inside all hard rules today\./g, dataMandate)
        .replace(/(##\s*1\.[^\n]*MANDATORY[^\n]*\n(?:[^\n]*\n)*?)-?\s*None\.?(\s*\n)/i, `$1${dataMandate}$2`);
    }
    // Strip the §4 OPTIONAL ideas placeholder and its "AI writes..."
    // template caption — deterministic mode has no AI to fill it in,
    // and leaving the placeholder produces a duplicate §4 heading
    // above the real "Daily picks" section below. Removes the block
    // wholesale so the deterministic §4 sits cleanly on its own.
    mdPrefixForShip = mdPrefixForShip.replace(
      /##\s*4\.\s*💡?\s*OPTIONAL ideas[^\n]*\n_\(Only surface if all hard rules[^\n]*\)_\n?/g,
      ""
    );
    // When canonical reconciliation fails, security-specific mandates
    // (like a TRAIL STOP REVIEW based on price + technicals) are
    // still valid — but any PAIRED redeployment ("IF EXIT — REDEPLOY
    // — After settle, BUY N sh XEQT…") depends on portfolio-level
    // sizing/sleeve headroom that we can't trust while sleeves+cash
    // don't sum to 100. Strip those sub-items and replace with a
    // suspension note. Also strips the CORE DEPLOY sub-items paired
    // with SELL AT MARKET mandates.
    if (!reconciliationOk) {
      const suspensionNote = `   → **REDEPLOY SUSPENDED** — portfolio reconciliation failed; sizing and CORE/sleeve routing cannot be trusted. Reassess redeployment manually after canonical reconciles, or run the briefing again once the underlying cash/position math is fixed.`;
      mdPrefixForShip = mdPrefixForShip
        .replace(/\s*→\s*\*\*IF EXIT — REDEPLOY\*\*[^\n]*\n?/g, `\n${suspensionNote}\n`)
        .replace(/\s*→\s*\*\*REDEPLOY \(paired with TRIM above\)\*\*[^\n]*\n?/g, `\n${suspensionNote}\n`)
        .replace(/\s*→\s*\*\*CORE DEPLOY \(paired with SELL above\)\*\*[^\n]*\n?/g, `\n${suspensionNote}\n`);
    }

    // Rewrite "(do these today)" and similar today-execution language
    // when the current day is a weekend — the market isn't open, so
    // §1 mandates are planning for the next trading session, not
    // "execute now" orders.
    if (isWeekend) {
      mdPrefixForShip = mdPrefixForShip
        .replace(/\(do these today\)/gi, "(plan for next trading session)")
        .replace(/Decide today and record/gi, "By the next trading session, decide and record")
        .replace(/execute today/gi, "execute at next open");
    }

    const headerTitle = isWeekend
      ? `# 📅 Weekend planning briefing — ${dowDateStr}`
      : `# 📉 Daily briefing — ${dowDateStr}`;
    const modeLine = isWeekend
      ? `_Weekend planning mode — regular market is closed today. All §1 mandates are planning for the next trading session, not "do today" orders. Every number below comes from canonical portfolio data or the pick engine._`
      : `_Deterministic mode — every number below comes from canonical portfolio data or the pick engine. To enable AI narrative sections, flip **AI narrative** on in Settings._`;
    const parts = [
      headerTitle,
      "",
      modeLine,
      "",
      mdPrefixForShip,
    ];

    if (reconciliationOk) {
      // Daily picks only ship when the portfolio itself is trustworthy.
      // If canonical fails, the picks are still computed but not
      // included in the send (they'd risk being interpreted as
      // portfolio-aware sizing).
      const picksBlock = await renderDailyPicksDeterministic(dailyPicks, {
        email: profile?.email,
        fastPreview: profile?._fastPreview === true,
      });
      if (picksBlock) parts.push(picksBlock);
    } else {
      parts.push(
        "",
        "## 4. 💡 Daily picks — SUPPRESSED",
        "",
        "_Daily picks are suppressed while canonical portfolio reconciliation fails. Position sizing, sleeve compliance, and cash-availability checks all depend on canonical totals; publishing picks against an unreconciled portfolio would produce misleading order tickets. Picks will resume automatically once reconciliation passes._"
      );
    }

    // Do NOT append our own "Research and education only" disclaimer —
    // the email template appends its own footer. Duplicating it produced
    // two consecutive disclaimer lines in production output.
    const md = parts.join("\n").trim();
    return {
      md,
      sectorRotation,
      tradingRegime,
      acceptedRecs: [],
      rejectedRecs: [],
      mandateRecs: prefixMandateRecs,
      deterministicPrefix: mdPrefixForShip,
    };
  }

  const { system: staticSystem, user: userPrompt } = buildBriefingPrompt(profile, summary, monitorAlerts, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock, dailyPicks, recentTrades, sectorRotation, correlations, fedLiquidity, congressional, discoveryPool, calibration, benchmarkBundle, sizingAdjustments, overlaySuggestions, compliance, isMondayEt, attribution, horizonRows, briefingHistory, sizedPicks, pyramidingSignals, tradingRegime, unusualOptions, riskVar, lossCooldown, macroFred, insiderSignals, optionsFlow, marketPulse, whale13F);

  // Anthropic call with retry-on-truncation + prompt caching. The static
  // rules block (~10K tokens) is sent as a cached system prompt so repeat
  // briefings hit the cache and save ~90% of input tokens on the static
  // portion. Cache TTL is Anthropic-managed (~5 min for ephemeral).
  const callClaude = async (messages, tokens) => {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.STOCKS_ADVICE_MODEL || "claude-sonnet-4-6",
        max_tokens: tokens,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, parseInt(process.env.STOCKS_ADVICE_MAX_SEARCHES, 10) || 8) }],
        system: [{ type: "text", text: staticSystem, cache_control: { type: "ephemeral" } }],
        messages,
      }),
    });
    if (!resp.ok) {
      const e = await resp.text().catch(() => "");
      throw new Error(`Anthropic ${resp.status}: ${e.slice(0, 200)}`);
    }
    return resp.json();
  };

  // First call — generous max_tokens so the per-account cash deployment
  // sections don't truncate. Bumped from 8192 → 12288 after a real
  // briefing came back missing sections 5-8 and RECS: the AI padded
  // every corrupted-price holding with defensive "⚠ PRICE DIVERGENCE"
  // prose (~500 tokens per holding × 5 holdings), which ate into the
  // budget for downstream sections. 12288 gives ~4k headroom over the
  // normal ~8k briefing without needing a continuation call.
  let j = await callClaude([{ role: "user", content: userPrompt }], 12288);
  let raw = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!raw) throw new Error("Empty briefing");
  // Log cache stats so we can confirm the cache is warming.
  const u = j?.usage || {};
  if (u.cache_creation_input_tokens || u.cache_read_input_tokens) {
    console.log(`[stocks-briefing] cache: created=${u.cache_creation_input_tokens || 0} read=${u.cache_read_input_tokens || 0} input=${u.input_tokens || 0}`);
  }

  // If the response was cut off because of max_tokens, ask for a
  // continuation and append. Anthropic's `stop_reason` tells us this
  // directly. We feed the partial response back as an assistant turn so
  // the model continues exactly where it stopped (no re-summarization).
  let attempts = 0;
  while (j?.stop_reason === "max_tokens" && attempts < 2) {
    attempts++;
    console.warn(`[stocks-briefing] truncated — requesting continuation (attempt ${attempts})`);
    const continuation = await callClaude([
      { role: "user", content: userPrompt },
      { role: "assistant", content: raw },
      { role: "user", content: "Continue exactly where you stopped. Do not repeat what you've already written. Do not add a preamble. Just resume the next character." },
    ], 4096);
    const more = (continuation?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!more) break;
    raw = raw + more;
    j = continuation;
  }

  // Targeted RECS-missing continuation. Even at stop_reason="end_turn"
  // the AI sometimes stops before emitting the mandatory <RECS>...</RECS>
  // block — usually when data anomalies made it defensive about
  // recommending anything (a real briefing came back last week with
  // every position flagged "⚠ PRICE DIVERGENCE" and the AI voluntarily
  // stopped at section 4 without emitting sections 5-8 or RECS). Ask
  // for a completion focused strictly on what's missing. Cheap: only
  // fires when the block is genuinely absent.
  if (!/<RECS>[\s\S]*?<\/RECS>/i.test(raw)) {
    console.warn("[stocks-briefing] RECS block absent — requesting targeted completion");
    try {
      const completion = await callClaude([
        { role: "user", content: userPrompt },
        { role: "assistant", content: raw },
        {
          role: "user",
          content: "Your last response ended without the mandatory sections 5 (💵 Cash deployment), 6 (Watch list), 7 (Aggressive new ideas — SPEC sleeve), 8 (🎯 Today's Swing-Trade Picks) or the trailing <RECS>...</RECS> block. Emit exactly what's missing, in order, starting from whichever section you stopped at. Do NOT repeat sections you've already written. End with the <RECS> block — emit `<RECS>[]</RECS>` if there are zero actionable recs today. No preamble.",
        },
      ], 4096);
      const tail = (completion?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      if (tail) raw = raw + "\n\n" + tail;
    } catch (e) {
      console.warn("[stocks-briefing] RECS completion failed:", e?.message);
    }
  }

  // Strip Claude web_search citation markers AND any chatty preamble before
  // the first markdown heading (e.g. "I'll search the web for...", "Let me
  // pull the latest news...", "Now let me write your briefing.").
  let md = raw
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/\[(?:cite[:_]?)?\d+(?:[-,]\d+)*\]/g, "");
  // Drop everything before the first '#' heading line — that's the title.
  const firstHeading = md.search(/^#{1,6}\s/m);
  if (firstHeading > 0) {
    md = md.slice(firstHeading);
  }
  // Append the options-overlay funnel as a user-visible section when
  // the AI produced no covered-call ideas today. Returns "" for the
  // suggestions-present case (already rendered inside AI section 6a)
  // and for options-off with no positions.
  const overlayFunnel = formatOverlayFunnelForEmail(overlaySuggestions);
  if (overlayFunnel) {
    // Insert BEFORE the trailing <RECS> block if present so the
    // machine-readable rec parser stays anchored at end-of-doc.
    const recsIdx = md.search(/\n?-{3,}\s*\n\s*<RECS>/i);
    if (recsIdx > 0) {
      md = md.slice(0, recsIdx) + "\n" + overlayFunnel + md.slice(recsIdx);
    } else {
      md = md.trim() + "\n\n" + overlayFunnel;
    }
  }

  // Prepend the deterministic prefix (sections 0, 0c, 0d) that the AI
  // is instructed to skip. Defensive strip: if the AI still restated
  // one of those sections, drop the AI's version so the deterministic
  // one is the only copy in the final briefing.
  if (deterministicPrefix) {
    const stripHeaderBlock = (source, headerRe) => {
      const match = source.match(headerRe);
      if (!match) return source;
      const start = match.index;
      const rest = source.slice(start + match[0].length);
      // Section ends at the next H2 heading or end of doc.
      const nextH2 = rest.search(/\n##\s/);
      const end = nextH2 === -1 ? source.length : start + match[0].length + nextH2;
      return source.slice(0, start) + source.slice(end);
    };
    // Legacy strips (pre-Daily-Orders renderer) — kept in case the AI
    // regresses to the old section headings from prompt-cache staleness.
    md = stripHeaderBlock(md, /^##\s*🚨\s*Open recommendation alerts.*$/m);
    md = stripHeaderBlock(md, /^##\s*🚨\s*Position P&L stop check.*$/m);
    md = stripHeaderBlock(md, /^##\s*⚖\s*Sleeve balance.*$/m);
    // New Daily Orders strips — §1/§2/§4 are pre-rendered; strip any AI
    // attempt to duplicate them so the prepended deterministic version
    // is the only copy in the final briefing.
    //
    // Broadened HEAVILY — AI has been observed renaming the section
    // ("## 0a. ✅ Mandatory actions", "## 1️⃣ MANDATORY ACTIONS", etc)
    // and slipping past narrower regex. The new pattern matches ANY H2
    // heading whose text contains the key words, regardless of numbering
    // scheme, emoji prefix, or bold markup — up to a newline. Case-
    // insensitive so "Mandatory Actions" / "MANDATORY ACTIONS" both hit.
    md = stripHeaderBlock(md, /^##[^\n]*?\bMandatory\s+Actions?\b[^\n]*$/im);
    md = stripHeaderBlock(md, /^##[^\n]*?\bForbidden\s+Today\b[^\n]*$/im);
    // Status: only strip if paired with the 📊 emoji OR a leading "3." /
    // "1." numeric prefix — avoids nuking anything ad-hoc like a per-
    // rec "Status" header the AI might legitimately write.
    md = stripHeaderBlock(md, /^##\s*(?:📊|(?:0[a-z]?|[1-9])\.).*?\bStatus\b[^\n]*$/im);
    md = stripHeaderBlock(md, /^##\s*📊[^\n]*\bStatus\b[^\n]*$/im);
    // Strip any AI-written "## 5. Cash deployment" / "§5. Cash..." —
    // it duplicates §1 DEPLOY CASH with hedgy per-account narrative
    // ("better: IWM...", "actually skip, TFSA cash pending clean
    // setup...") that competes with the deterministic mandate.
    // §1 is authoritative. §5 slot is reserved for blocked-recs.
    md = stripHeaderBlock(md, /^##\s*5\.\s*💵?\s*Cash\s*deployment.*$/im);
    md = stripHeaderBlock(md, /^#*\s*§\s*5[abcd]?\.\s*💵?\s*Cash\s*deployment.*$/im);

    // §4 dedupe + relocation. My prefix already emits
    // "## 4. 💡 OPTIONAL ideas" as a heading with an italic placeholder,
    // expecting the AI to write body content beneath it. In practice AI
    // often writes a SECOND ## 4. heading much later in its response
    // (after the Appendix), leaving my heading up top with the ugly
    // placeholder still visible. Extract the AI's §4 body, remove the
    // AI's whole block, and splice the body in place of my placeholder
    // so there's exactly one clean §4 with real content.
    {
      const aiOptRe = /^##[^\n]*?\bOPTIONAL\s+ideas?\b[^\n]*$/im;
      const aiOptMatch = md.match(aiOptRe);
      if (aiOptMatch) {
        const start = aiOptMatch.index;
        const rest = md.slice(start + aiOptMatch[0].length);
        const nextH2 = rest.search(/\n##\s/);
        const end = nextH2 === -1 ? md.length : start + aiOptMatch[0].length + nextH2;
        const aiBody = md.slice(start + aiOptMatch[0].length, end).trim();
        // Only relocate if my prefix's §4 heading + placeholder is still
        // present and the AI's body has actual content.
        const placeholderRe = /(^##[^\n]*?\bOPTIONAL\s+ideas?\b[^\n]*\n)(_\([^\n]*\)_\s*\n?)?/im;
        if (aiBody.length > 0 && placeholderRe.test(md)) {
          // Remove AI's block first (or we'd hit its heading with the
          // placeholder-replace regex).
          md = md.slice(0, start) + md.slice(end);
          // Replace my prefix's §4 heading + placeholder with the same
          // heading + AI's body.
          md = md.replace(placeholderRe, (m, headingLine) => `${headingLine}${aiBody}\n`);
        } else if (aiBody.length === 0) {
          // Empty AI block — just drop the duplicate heading.
          md = md.slice(0, start) + md.slice(end);
        }
      }
    }

    // Bogus mid-body "Daily Briefing — <date>" headers. AI sometimes
    // interleaves a full re-titled document into its response. Drop any
    // line that looks like a stray daily-briefing title.
    md = md.split("\n").filter(line => {
      return !/^\s*#{0,3}\s*Daily\s+Briefing\b[^\n]*$/i.test(line);
    }).join("\n");
    md = md.replace(/\n{3,}/g, "\n\n");
    // Strip AI-written stop-override sentences that contradict §1
    // stop mandates. Pattern: any sentence that pairs "STOP HIT" (or
    // similar) with "DO NOT exit" / "hold despite" / "monitor, do not
    // churn" / "acknowledge ... but hold" language. Applied per-line
    // so a single override doesn't nuke the whole per-holding row.
    // Prompt directive above tells AI not to write these; this is
    // defense-in-depth against prompt-cache staleness.
    md = md.split("\n").filter(line => {
      const hasStopFlag = /(?:stop\s*hit|STOP\s*HIT|hard[\s-]*stop|trailing\s*stop)/i.test(line);
      if (!hasStopFlag) return true;
      const hasOverride = /(?:do\s*not\s*exit|don['’]?t\s*exit|do\s*not\s*sell|don['’]?t\s*sell|hold\s+despite|monitor,?\s*do\s*not\s*churn|acknowledge[^.]*but\s*(?:hold|do\s*not)|no\s+exit\s+(?:action\s+)?today|(?:hold|held|holding).{0,40}(?:because|due\s+to|given|until|before)\s+(?:earnings|catalyst|event|announcement|q[1-4]|guidance)|earnings.{0,30}(?:hold|no\s+exit|monitor)|(?:catalyst|earnings).{0,40}intact)/i.test(line);
      return !hasOverride;
    }).join("\n");
    // Unconditional strip of the two override phrases the TRAIL STOP
    // REVIEW mandate literally bans by name. Grok Aug 6: "AI still
    // writes 'HOLD through earnings' and 'thesis intact' in §A5
    // despite the mandate forbidding them." The stop-flag-gated strip
    // above misses these because §A5 narrative can carry the phrase
    // without co-locating "stop hit" on the same line. These phrases
    // have zero legitimate use in the brief — the mandate says
    // exactly that. Any line containing either gets dropped.
    md = md.split("\n").filter(line => {
      const banned = /\bhold\s+through\s+earnings\b|\bthesis\s+intact\b/i.test(line);
      return !banned;
    }).join("\n");
    // Strip AI-written meta-commentary on my §1 mandates. AI was
    // observed appending lines like "Revised deployment: Deploy 17 sh
    // RY only..." or "0 sh SKIP — insufficient cash" that rewrite my
    // deterministic tickets with hallucinated numbers. My §1 is
    // authoritative; AI has nothing to add there.
    //
    // Also strip AI-written "portfolio is fine / inside all hard rules"
    // narrative — my §1 mandates already tell the truth about which
    // rules fired. AI reassurance contradicts the deterministic §1
    // when concentration/VaR/sleeve breaches are actively mandating
    // action. Grok Aug 6 audit: "Status says 'inside all hard rules
    // today' in spirit, yet the mandatory section is full of
    // concentration breaches. The language should explicitly say the
    // concentration rules are the reason for action."
    md = md.split("\n").filter(line => {
      const isMandateRewrite = /^\s*(?:revised\s+deployment|deferring\s+.*deploy|deploy\s+of\s+[^:]+deferred|reduced\s+deploy|adjust(?:ed|ing)\s+deploy)/i.test(line);
      if (isMandateRewrite) return false;
      const isFalseReassurance = /(?:portfolio\s+(?:is\s+)?(?:inside|within|healthy|fine|clean|OK)\s+(?:all\s+)?(?:hard\s+)?rules|inside\s+all\s+(?:hard\s+)?rules\s+today|no\s+(?:mandatory\s+)?actions?\s+(?:required|needed)\s+today|nothing\s+to\s+act\s+on\s+today|process\s+running\s+cleanly)/i.test(line);
      return !isFalseReassurance;
    }).join("\n");
    // Strip AI-written "consider re-entering" / "watch for pullback"
    // / "await better setup" language. Grok clarity rule #4: on a day
    // when a trim/sell is mandated, hedge language about re-entering
    // the same ticker later undermines the finality of the exit and
    // trains the reader to ignore mandates. Ban it entirely from the
    // primary sections; if genuine re-entry timing matters, it goes
    // on the Watch List with a concrete trigger, not as hedge prose.
    md = md.split("\n").filter(line => {
      const hasHedge = /(?:consider\s+re-?enter|watch(?:list)?\s+for\s+(?:a?\s*)?pullback|await\s+(?:a?\s*)?(?:better\s+setup|entry|clean\s+setup|pullback)|re-?enter\s+on\s+(?:a?\s*)?pullback|re-?entry\s+once|monitor\s+for\s+re-?entry|pending\s+a\s+clean|patience\s+>\s*forcing)/i.test(line);
      return !hasHedge;
    }).join("\n");
    md = deterministicPrefix + "\n\n" + md.trim();

    // Force my concentration mandate lines to be the authoritative
    // version in the final briefing. Grok Aug 5 09:42 audit — the AI
    // was mimicking my mandate format ("TRIM CONCENTRATION — TICKER is
    // XX% of book…") with downscaled dollar amounts and share counts
    // that DID NOT actually bring the position under the 20% cap. E.g.
    // XIU at 26.6% should trim ~$5,839 to hit the cap; AI was writing
    // "Trim ~$1,084 CAD (~20 sh @ $54.20)" — a token gesture, not the
    // real cap-satisfying trim. This pass finds every TRIM CONCENTRATION
    // line naming any ticker in my precomputed mandate set, replaces the
    // first with my exact canonical string, and deletes the rest.
    // Defense-in-depth against the strip missing a variant AI heading.
    // Rebuild the concentration mandate lines FRESH from sleeveBalance
    // right here, so the enforcement is independent of whether the
    // prefix's own loop populated concentrationMandates. Two failure
    // modes we're covering:
    //   (1) prefix loop didn't fire (data race / empty positions) →
    //       AI's fabricated numbers would otherwise survive
    //   (2) prefix DID fire, but the AI mimicked its format with
    //       downscaled dollar amounts and my line-by-line replace was
    //       matching the AI's line first
    // Now we compute the authoritative canonicals from the same
    // sleeveBalance the prefix uses, then scan md for EVERY TRIM
    // CONCENTRATION line (whoever wrote it) and force our value.
    const canonicalsByBase = new Map();
    for (const cm of (prefixConcentrationMandates || [])) {
      canonicalsByBase.set(cm.base, cm.canonical);
    }
    // Fill in any that the prefix missed by recomputing from the same
    // sleeveBalance snapshot.
    if (sleeveBalanceForPrefix?.book > 0) {
      const bookForRebuild = sleeveBalanceForPrefix.book;
      const perBase = {};
      for (const row of (sleeveBalanceForPrefix.byPosition || [])) {
        if (!(row.cadValue > 0)) continue;
        const b = String(row.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
        if (!b) continue;
        if (!perBase[b]) perBase[b] = { cad: 0, sleeve: row.sleeve };
        perBase[b].cad += row.cadValue;
      }
      const routableGaps = sleeveBalanceForPrefix.deviations ? [
        { sleeve: "income", gap: -sleeveBalanceForPrefix.deviations.income,
          list: ["RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "TRP.TO", "ENB.TO"] },
        { sleeve: "core", gap: -sleeveBalanceForPrefix.deviations.core,
          list: ["XEQT.TO", "VUN.TO", "XIU.TO"] },
      ].filter(x => x.gap > 5).sort((a, b) => b.gap - a.gap) : [];
      const redirect = routableGaps[0] || null;
      const mCad = (v) => `$${Math.round(v).toLocaleString()} CAD`;
      for (const [base, info] of Object.entries(perBase)) {
        const pct = (info.cad / bookForRebuild) * 100;
        // Use the same tolerance-adjusted firing threshold the prefix
        // uses, not a hardcoded 20% — otherwise this recompute silently
        // re-adds mandates the prefix correctly skipped as trivial.
        if (pct <= SINGLE_NAME_CAP_FIRING_PCT) continue;
        const excessCad = info.cad - (SINGLE_NAME_CAP_PCT / 100) * bookForRebuild;
        if (excessCad < 100) continue;
        let sleeveNote;
        if (redirect && redirect.sleeve !== info.sleeve) {
          const listStr = redirect.list.slice(0, 4).join(" / ");
          sleeveNote = ` Redeploy proceeds into **${redirect.sleeve.toUpperCase()} sleeve** (${listStr}) — ${redirect.sleeve.toUpperCase()} is ${redirect.gap.toFixed(1)}pp underweight, so this trim closes two gaps at once.`;
        } else if (info.sleeve === "core") {
          sleeveNote = ` CORE ETFs are not exempt — ${pct.toFixed(1)}% in one broad-market ETF is still ${pct.toFixed(1)}% of book tied to one index. Redeploy the trim into a different CORE ETF (XEQT / VUN / XIC) rather than a new sleeve.`;
        } else {
          sleeveNote = " Single-name blow-ups are the loss zone.";
        }
        const line = `**TRIM CONCENTRATION** — **${base}** is ${pct.toFixed(1)}% of book, over the ${SINGLE_NAME_CAP_PCT}% single-name cap (${SINGLE_NAME_CAP_TOLERANCE_PP}pp tolerance). Trim ~${mCad(excessCad)} to bring it to ≤ ${SINGLE_NAME_CAP_PCT}%.${sleeveNote}`;
        // Prefix's canonical wins if it exists (already stored above);
        // otherwise use this freshly-computed one.
        if (!canonicalsByBase.has(base)) canonicalsByBase.set(base, line);
      }
    }

    if (canonicalsByBase.size > 0) {
      for (const [base, canonical] of canonicalsByBase.entries()) {
        // Match ANY line containing "TRIM CONCENTRATION" and the base
        // ticker in the same line — regardless of leading list markers
        // ("1.", "-", "*"), bold markers ("**"), or preceding numbering.
        const re = new RegExp(`^.*?TRIM\\s+CONCENTRATION\\b.*?\\b${base}\\b.*$`, "gim");
        let replaced = false;
        md = md.replace(re, () => {
          if (!replaced) { replaced = true; return canonical; }
          return ""; // drop duplicates
        });
        if (!replaced) {
          console.warn(`[concentration] canonical for ${base} vanished from md — reinserting`);
          const anchor = md.match(/^##[^\n]*?\bMandatory\s+Actions?\b[^\n]*$/im);
          if (anchor) {
            const insertAt = anchor.index + anchor[0].length;
            md = md.slice(0, insertAt) + "\n" + canonical + md.slice(insertAt);
          } else {
            md = canonical + "\n\n" + md;
          }
        }
      }
      // Final belt-and-braces: any leftover TRIM CONCENTRATION line
      // naming a ticker NOT in our canonical map is AI-invented (ticker
      // isn't actually over cap per sleeveBalance) → drop it. Prevents
      // stale AI narration surviving after positions moved back under
      // the cap. Also drops any TRIM CONCENTRATION whose numbers still
      // look wrong for a ticker we DO have — the per-base loop above
      // should have caught these, but a matching failure on some regex
      // edge case would leave stragglers.
      const remainingKeys = [...canonicalsByBase.keys()];
      md = md.split("\n").filter(line => {
        if (!/TRIM\s+CONCENTRATION\b/i.test(line)) return true;
        // Keep only lines that MATCH one of our canonical strings verbatim.
        for (const canonical of canonicalsByBase.values()) {
          if (line.includes(canonical) || line.trim() === canonical.trim()) return true;
        }
        // Line names a TRIM CONCENTRATION but doesn't match any canonical
        // → AI hallucination or duplicate → drop.
        return false;
      }).join("\n");
      md = md.replace(/\n{3,}/g, "\n\n");
      // Anti-drift telemetry (user Aug 5 overhaul §5 — "make sizing
      // stable"). Log the exact excess dollar figure enforced for each
      // ticker so any future divergence between briefs is immediately
      // visible in log grep, not inferred from the email output.
      const summaryParts = [];
      for (const [base, canonical] of canonicalsByBase.entries()) {
        const excessMatch = canonical.match(/Trim\s+~\$([\d,]+)\s+CAD/i);
        summaryParts.push(`${base}=${excessMatch ? "$" + excessMatch[1] : "?"}`);
      }
      console.log(`[concentration] enforced ${canonicalsByBase.size} canonical mandate line(s) — ${summaryParts.join(" · ")}`);
    }

    // Phantom-ticker guard: drop any line whose SELL/EXIT/TRIM action
    // verb names only tickers the user does NOT hold. Aug 5 user report:
    // a briefing said "exit XLU" but the user holds XIU (TSX 60), not
    // XLU (US utilities sector ETF). The AI conflated XLU on the sector-
    // laggard tag with the XIU concentration mandate — one letter apart,
    // both start with X. Any sell-side mandate for a name the user
    // doesn't hold is by definition phantom (nothing to sell / exit /
    // trim), so scrub the line regardless of how confidently the AI
    // narrated it.
    const heldBasesForPhantomGuard = new Set();
    for (const p of (profile.positions || [])) {
      const base = String(p.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
      if (base) heldBasesForPhantomGuard.add(base);
    }
    // Common uppercase words that look like tickers but aren't. Include
    // finance jargon (RSI/OBV/ATR/MTF/RVOL/IV), currencies (USD/CAD),
    // order types (GTC/OCO/OTO), sleeve labels (CORE/SWING/INCOME/SPEC),
    // action verbs, section names, exchange codes, and generic prepositions.
    const TICKER_STOPWORDS = new Set([
      "BUY","SELL","TRIM","EXIT","HOLD","ADD","LIMIT","MARKET","GTC","OCO","OTO",
      "USD","CAD","EUR","GBP","JPY","AUD","CHF","INR","MXN","BRL",
      "CORE","SWING","INCOME","SPEC","INCOMES","SLEEVE","SLEEVES",
      "AT","OR","AND","THE","TO","FROM","INTO","VS","IF","IS","AS","ON","IN","BY","OF","PER","ANY","ALL",
      "RSI","OBV","ATR","MTF","MA","SMA","EMA","MACD","VWAP","IV","RVOL","VOL","OI","PP",
      "TRAIL","STOP","STOPS","REVIEW","MANDATORY","ACTIONS","FORBIDDEN","TODAY","STATUS","OPTIONAL","IDEAS",
      "TSX","NYSE","NASDAQ","AMEX","LSE","BATS","SPX","NDX","DJI",
      "ETF","ETN","ADR","SPAC","REIT","MLP",
      "TFSA","RRSP","RESP","LIRA","LIF","NON","SPOUSAL","JOINT","CASH","MARGIN",
      "YOY","QOQ","WOW","MOM","YTD","MTD","QTD","YTD","EOD","EOW","EOM","EOY",
      "OK","NO","YES","NA","TBD","ETC","IE","EG",
      "AI","ML","API","SDK","CEO","CFO","CIO","IPO","SEC","FED","BOC","ECB","BOJ",
      "PT","EPS","P","E","B","V","H","L","O","C","N","S","U","Y","Z","G","T","D","J","K","Q","R","W","X","F","M",
      "RS","LB","KG","OZ",
    ]);
    let phantomDropped = 0;
    const phantomDroppedTickers = new Set();
    md = md.split("\n").filter(line => {
      const hasSellVerb = /\b(?:SELL|EXIT|TRIM)\b/i.test(line);
      if (!hasSellVerb) return true;
      // Extract candidate uppercase 2–5-letter tokens, optionally with an
      // exchange suffix. Filter out stopwords so finance jargon doesn't
      // register as a phantom ticker.
      const candidates = [...line.matchAll(/\b([A-Z]{2,5})(?:\.(?:TO|V|NE))?\b/g)]
        .map(m => m[1].toUpperCase())
        .filter(t => !TICKER_STOPWORDS.has(t));
      if (candidates.length === 0) return true; // no ticker mentioned → generic prose, keep
      const anyHeld = candidates.some(t => heldBasesForPhantomGuard.has(t));
      if (anyHeld) return true; // at least one held ticker referenced → keep
      // Every named ticker is non-held AND the line has a sell verb →
      // phantom mandate. Drop.
      for (const t of candidates) phantomDroppedTickers.add(t);
      phantomDropped++;
      return false;
    }).join("\n");
    if (phantomDropped > 0) {
      md = md.replace(/\n{3,}/g, "\n\n");
      console.warn(`[phantom-sell] dropped ${phantomDropped} line(s) mandating SELL/EXIT/TRIM on non-held ticker(s): ${[...phantomDroppedTickers].join(", ")}`);
    }
    // Second guard — §A2 per-holding bullets whose LEADING ticker isn't
    // held. User Aug 8: "I do not own HIT" — a phantom "HIT [INCOME
    // 0.9% · +4.1%] — HOLD" bullet had appeared in A2. Sell-verb guard
    // above doesn't catch this because the line is a HOLD. Match the
    // A2 format:
    //     * TICKER [SLEEVE · N.N% · +X.X%] — HOLD — ...
    //     * TICKER.TO [SLEEVE ...] — HOLD/action —
    // If the leading token isn't in the held set (or the known-ETF
    // fallback list for defensible mentions), drop the whole bullet.
    let phantomHoldDropped = 0;
    const phantomHoldTickers = new Set();
    md = md.split("\n").filter(line => {
      // A2 bullet with a TICKER-then-[SLEEVE...] prefix. Anchor loose
      // enough to survive optional bold/italic markdown around the
      // ticker (`* **AAPL** [...]`) while precise enough not to eat
      // ordinary narrative bullets.
      const m = line.match(/^\s*[*-]\s+(?:\*\*|__)?([A-Z]{1,6})(?:\.(?:TO|V|NE))?(?:\*\*|__)?\s*\[/);
      if (!m) return true;
      const base = m[1].toUpperCase();
      if (TICKER_STOPWORDS.has(base)) return true;
      if (heldBasesForPhantomGuard.has(base)) return true;
      phantomHoldTickers.add(base);
      phantomHoldDropped++;
      return false;
    }).join("\n");
    if (phantomHoldDropped > 0) {
      md = md.replace(/\n{3,}/g, "\n\n");
      console.warn(`[phantom-hold] dropped ${phantomHoldDropped} A2 bullet(s) for non-held ticker(s): ${[...phantomHoldTickers].join(", ")}`);
    }
  }

  // ─── Post-generation validation ───
  // Parse the AI's <RECS> block, run the validator once here so every
  // consumer sees the same accepted/rejected split — no more silent
  // per-persist-site validation with divergent context or dropped recs
  // that never make it back to the reader. Rejected recs get surfaced
  // as a §5 block in the email so the user sees WHAT was proposed and
  // WHY it was blocked, instead of learning "the AI proposed 5 recs
  // and 3 disappeared" only from server logs.
  let acceptedRecs = [];
  let rejectedRecs = [];
  const rawRecs = parseRecsFromBriefing(md);
  if (Array.isArray(rawRecs) && rawRecs.length > 0) {
    try { await enrichRecsWithExitDefaults(rawRecs); } catch { /* ignore */ }
    // Pre-fetch live cross-checked prices for every ticker in the batch
    // so ruleLivePriceDrift can compare rec.entryPrice against a fresh
    // Yahoo+FMP consensus. Missing prices → the rule silently no-ops
    // for that ticker (fetch failure never blocks the whole batch).
    // Parallel-fetch everything the validator needs from the network:
    //   • Live prices (Yahoo+FMP cross-check) → drift gate
    //   • Liquidity (FMP realtime quote avgVolume) → liquidity gate
    //   • User expectancy (Mongo aggregation) → expectancy gate
    // All optional — rules no-op on missing data individually.
    const [livePrices, liquidity, userExpectancy] = await Promise.all([
      fetchLivePricesForRecs(rawRecs).catch(e => {
        console.warn("[briefing] livePrices fetch warn:", e?.message); return {};
      }),
      fetchLiquidityForRecs(rawRecs).catch(e => {
        console.warn("[briefing] liquidity fetch warn:", e?.message); return {};
      }),
      computeUserExpectancy({ email: profile.email, days: 90 }).catch(e => {
        console.warn("[briefing] userExpectancy fetch warn:", e?.message); return null;
      }),
    ]);
    const validatorCtx = buildValidatorContext({
      positions: profile.positions,
      cashAccounts: profile.accounts,
      fxUsdCad: profile.fxUsdCad,
      sleeveTargets: profile.sleeveTargets,
      computeSleeveBalance,
      sectorRotation,
      tradingRegime,
      livePrices,
      liquidity,
      userExpectancy,
    });
    const result = validateRecs(rawRecs, validatorCtx);
    acceptedRecs = result.accepted || [];
    rejectedRecs = result.rejected || [];

    // Stop-severity gate — per user spec 2026-08-11 single-authority
    // rule. Any AI-accepted SELL/EXIT/TRIM rec on a TRAIL_SOFT ticker
    // gets demoted to the rejected list with a review-only reason.
    // Prevents §1 TRAIL STOP REVIEW ("choose EXIT / TIGHTEN / HOLD")
    // from coexisting with a DO TODAY "SELL AT MARKET" ticket for
    // the same name.
    if (Array.isArray(prefixTrailSoftTickers) && prefixTrailSoftTickers.length > 0) {
      const softSet = new Set(prefixTrailSoftTickers.map(t => String(t || "").toUpperCase().replace(/\..*$/, "")));
      const kept = [];
      const demoted = [];
      for (const r of acceptedRecs) {
        const base = String(r.ticker || "").toUpperCase().replace(/\..*$/, "");
        const isExit = r.action === "SELL" || r.action === "EXIT" || r.action === "TRIM";
        if (isExit && softSet.has(base)) {
          demoted.push({
            rec: r,
            rejections: [{
              reason: "trail-soft-review-only",
              detail: `${r.action} ${r.ticker} rejected — ticker is under a trail-stop REVIEW mandate (drawdown-triggered decision point; not a forced exit). Choose one of EXIT / TIGHTEN / HOLD-with-trigger in the §1 review; do not queue an automatic SELL ticket in parallel.`,
            }],
          });
        } else {
          kept.push(r);
        }
      }
      if (demoted.length > 0) {
        console.warn(`[stop-severity] demoted ${demoted.length} AI-accepted SELL/EXIT/TRIM rec(s) on TRAIL_SOFT tickers to REVIEW-only`);
        acceptedRecs = kept;
        rejectedRecs = [...rejectedRecs, ...demoted];
      }
    }

    // Same-ticker dedupe: if any rec for TICKER was blocked, suppress
    // ALL accepted recs for that same TICKER. Mixed signals for one
    // ticker in one briefing almost always mean the AI got confused —
    // safest response is "no ticket, operator must resolve." Moved-
    // to-rejected entries carry a "conflicts-with-blocked-sibling"
    // reason so the user sees why. Per Grok clarity rule #2.
    const rejectedTickers = new Set(
      rejectedRecs.map(x => String(x.rec?.ticker || "").toUpperCase()).filter(Boolean)
    );
    if (rejectedTickers.size > 0 && acceptedRecs.length > 0) {
      const cleanAccepted = [];
      const movedToRejected = [];
      for (const r of acceptedRecs) {
        const t = String(r.ticker || "").toUpperCase();
        if (t && rejectedTickers.has(t)) {
          movedToRejected.push({
            rec: r,
            rejections: [{
              reason: "conflicts-with-blocked-sibling",
              detail: `${r.action} ${r.ticker} was accepted, but another rec for the same ticker in this batch was BLOCKED. Mixed signals on one ticker = do not act. Resolve manually and re-emit.`,
            }],
          });
        } else {
          cleanAccepted.push(r);
        }
      }
      if (movedToRejected.length > 0) {
        console.warn(`[dedupe] hid ${movedToRejected.length} accepted recs conflicting with blocked siblings on same ticker`);
        acceptedRecs = cleanAccepted;
        rejectedRecs = [...rejectedRecs, ...movedToRejected];
      }
    }
    // Rewrite <RECS> to accepted-only every time recs went through
    // validation (was previously only rewritten when there were
    // rejections — but even zero-rejection paths benefit from a
    // canonicalised block that matches what persisted).
    const rewrittenRecsBlock = rewriteRecsBlock(acceptedRecs);
    md = md.replace(/<RECS>[\s\S]*?<\/RECS>/i, rewrittenRecsBlock);

    // Post-validation strip: kill AI-written §4 "Today's one action"
    // tables/lines that name any BLOCKED ticker. My existing dedupe
    // catches conflicts inside <RECS> JSON, but the AI can still
    // narrate rejected tickers as prose in §4 tables — Aug 5 briefing
    // had "AYA.TO" and "CNQ" as trade tickets in the §4 table even
    // though both were in §5 BLOCKED. This filter removes any line
    // that mentions a blocked ticker AND looks like an action row
    // (contains BUY/SELL/TRIM/EXIT keyword near the ticker).
    //
    // MUST run BEFORE the DO TODAY / BLOCKED injection below —
    // otherwise the filter eats my own §3 BLOCKED "**BUY N sh TICKER**"
    // header lines (which contain both an action verb AND the blocked
    // ticker by construction). That was why the Aug 5 evening brief
    // showed only the plain-English fix line without the ticket header.
    if (rejectedRecs.length > 0) {
      const blockedTickers = new Set(
        rejectedRecs.map(x => String(x.rec?.ticker || "").toUpperCase()).filter(Boolean)
      );
      if (blockedTickers.size > 0) {
        // Widened action / entry patterns — the earlier regex only caught
        // BUY/SELL/TRIM/EXIT/ADD verbs but let through "GOOGL layer
        // $199/$196", "GOOGL pullback add", "GOOGL breakout trigger",
        // "GOOGL entry", or "GOOGL funded by RY proceeds". User Aug 11:
        // "OPTIONAL / TODAY'S IDEAS still pitches GOOGL after validator
        // blocked it". Also strips any line where a blocked ticker
        // appears with a dollar price pattern (`$NNN`) — that's an
        // action row by construction, whatever the verb.
        const ACTION_RE = /\b(?:BUY|SELL|TRIM|EXIT|LIMIT\s+(?:BUY|SELL)|ADD|LAYER|ENTRY|PULLBACK|BREAKOUT|POCKET\s*PIVOT|TRIGGER|GTC|FUND(?:ED|ING)?\s+BY|FUND\s+FROM|ROUTE\s+INTO|INTO\s+[A-Z]{2,5}|WITH\s+[A-Z]{2,5}\s+PROCEEDS)\b/;
        md = md.split("\n").filter(line => {
          const upperLine = line.toUpperCase();
          // Does the line reference any blocked ticker?
          let hitTicker = null;
          for (const t of blockedTickers) {
            const re = new RegExp(`\\b${t.replace(/\./g, "\\.")}\\b`);
            if (re.test(upperLine)) { hitTicker = t; break; }
          }
          if (!hitTicker) return true;
          // Ticker referenced — kill if it has an action verb OR a
          // dollar-price pattern near it (both are actionable-idea
          // markers). Pure prose that mentions the ticker in an
          // analytical bullet (e.g. "GOOGL earnings Aug 20") survives.
          if (ACTION_RE.test(upperLine)) return false;
          if (/\$\s?\d/.test(line)) return false;
          return true;
        }).join("\n");
      }
    }

    // Sleeve mis-label rewriter: AI narrative sometimes labels held
    // tickers with the wrong sleeve (Aug 5 audit — Grok flagged XIC
    // written as "(SWING)" in the per-holding table while the
    // deterministic sleeve enforcer correctly classifies it as CORE).
    // Rewrite any "TICKER (SLEEVE)" / "TICKER — SLEEVE" / "TICKER in
    // SLEEVE sleeve" pattern for a held ticker where the AI-asserted
    // sleeve disagrees with sleeveEnforcer's classification. Preserves
    // the useful signal (the ticker line) but corrects the label so the
    // reader isn't second-guessing the truth. Keyed by base ticker
    // (XIC and XIC.TO both hit the same map entry).
    const heldSleeveByBase = {};
    for (const row of (sleeveBalanceForPrefix?.byPosition || [])) {
      const base = String(row.ticker || "").toUpperCase().replace(/\..*$/, "");
      if (!base) continue;
      if (!heldSleeveByBase[base]) heldSleeveByBase[base] = String(row.sleeve || "").toUpperCase();
    }
    const heldBases = Object.keys(heldSleeveByBase);
    if (heldBases.length > 0) {
      let relabels = 0;
      for (const base of heldBases) {
        const correct = heldSleeveByBase[base];
        if (!correct || !["CORE", "SWING", "SPEC", "INCOME"].includes(correct)) continue;
        // TICKER ( WRONGSLEEVE ...) — parenthetical label right after the ticker
        // Matches: TICKER (SWING), TICKER (SWING sleeve), TICKER (SWING —…)
        const parenRe = new RegExp(
          `\\b(${base}(?:\\.TO|\\.V|\\.NE)?)\\s*\\(\\s*(CORE|SWING|SPEC|INCOME)\\b`,
          "gi"
        );
        md = md.replace(parenRe, (match, tickerPart, sleeveWord) => {
          if (sleeveWord.toUpperCase() === correct) return match;
          relabels++;
          return `${tickerPart} (${correct}`;
        });
        // TICKER — WRONGSLEEVE  |  TICKER - WRONGSLEEVE  |  TICKER: WRONGSLEEVE
        const dashRe = new RegExp(
          `\\b(${base}(?:\\.TO|\\.V|\\.NE)?)\\s*[—\\-:]\\s*(CORE|SWING|SPEC|INCOME)\\b(?!\\w)`,
          "gi"
        );
        md = md.replace(dashRe, (match, tickerPart, sleeveWord) => {
          if (sleeveWord.toUpperCase() === correct) return match;
          relabels++;
          return match.replace(new RegExp(sleeveWord, "i"), correct);
        });
        // TICKER in WRONGSLEEVE sleeve  |  TICKER (a WRONGSLEEVE hold)
        const inSleeveRe = new RegExp(
          `\\b(${base}(?:\\.TO|\\.V|\\.NE)?)\\b([^\\n]{0,30}?)\\b(CORE|SWING|SPEC|INCOME)\\s+sleeve\\b`,
          "gi"
        );
        md = md.replace(inSleeveRe, (match, tickerPart, mid, sleeveWord) => {
          if (sleeveWord.toUpperCase() === correct) return match;
          relabels++;
          return match.replace(new RegExp(`\\b${sleeveWord}\\s+sleeve\\b`, "i"), `${correct} sleeve`);
        });
      }
      if (relabels > 0) {
        console.log(`[sleeve-relabel] corrected ${relabels} mis-labelled sleeve reference(s) in AI narrative`);
      }
    }

    // Grok clarity: put DO TODAY (accepted tickets) and BLOCKED (do
    // NOT place) sections at the TOP of the AI body, right after
    // the deterministic §3 Status heading + sector tilt. Reader sees
    // concrete accepted tickets first, then rejected tickets with
    // fix-instructions, then optional narrative. Runs AFTER the
    // blocked-ticker strip so my ticket-header lines aren't eaten.
    const doTodaySection = renderDoTodaySection({
      accepted: acceptedRecs,
      positions: profile.positions || [],
    });
    const blockedSection = renderBlockedRecsSection({ rejected: rejectedRecs });
    const injectBlock = [doTodaySection, blockedSection]
      .filter(x => x && x.length > 0)
      .join("\n\n");
    if (injectBlock) {
      const anchor = md.match(/^##\s*3\.\s*📊?\s*Status[^\n]*\n[^\n]+\n(?:SECTOR TILT:[^\n]*\n)?/im);
      if (anchor) {
        const insertAt = anchor.index + anchor[0].length;
        md = md.slice(0, insertAt) + "\n" + injectBlock + "\n\n" + md.slice(insertAt);
      } else {
        md = injectBlock + "\n\n" + md;
      }
    }
    // If §1 MANDATORY still says "None. Portfolio is inside all hard
    // rules today." AND we just injected a DO TODAY section with
    // accepted-rec tickets, that's an internal contradiction the
    // audit catches (MANDATORY none + DO TODAY tickets). Rewrite the
    // None sentence to reference the ticket count so §1 accurately
    // reflects what the operator has to do. Prevents the "None" line
    // from surviving to the audit and blocking the whole briefing.
    if (Array.isArray(acceptedRecs) && acceptedRecs.length > 0 && doTodaySection) {
      const noneLineRe = /None\.\s*Portfolio is inside all hard rules today\./;
      if (noneLineRe.test(md)) {
        const n = acceptedRecs.length;
        md = md.replace(noneLineRe, `No structural §1 mandate today, but ${n} accepted-rec order ticket${n === 1 ? "" : "s"} follow in **DO TODAY** below — treat those as the mandatory actions for this slot.`);
      }
    }
  }

  // Deterministic upswitch injection — the §1b PORTFOLIO UPGRADE
  // OPPORTUNITIES block must ALWAYS render, whether or not the AI
  // chose to include it. Prior approach embedded the block in the
  // AI prompt template, which the AI could drop silently. Now the
  // block is injected into md AFTER §1 MANDATORY (or right at the
  // top if no §1 exists), so the operator always sees either the
  // upswitch recommendation or the explicit "NONE — no challenger
  // cleared the hurdle" line.
  try {
    const upswitchBlock = formatUpswitchBlockSafe(summary?.upswitch);
    if (upswitchBlock) {
      // Find the end of §1 (up to but not including the next "## " heading).
      const s1Re = /(##\s*1\.[^\n]*\n[\s\S]*?)(?=\n##\s)/;
      const m = md.match(s1Re);
      if (m) {
        md = md.replace(s1Re, m[1] + "\n" + upswitchBlock + "\n");
      } else {
        // No §1 header found — prepend the block.
        md = upswitchBlock + "\n\n" + md;
      }
    }
  } catch (e) { console.warn("[upswitch-inject] warn:", e?.message); }

  // ─── Strip resolved TRAIL STOP REVIEW blocks ───
  // If a TRAIL STOP REVIEW block for a ticker survives to this point
  // AND the AI's later prose contains a resolution for that ticker
  // (SELL / EXIT / TIGHTEN stop / HOLD-with-trigger — the four legal
  // outcomes of a review), the review block is redundant and creates
  // a contradiction. Strip it.
  // Resolution language patterns include mandate-echo phrases and
  // explicit action verbs applied to the review ticker.
  try {
    const trailBlockRe = /\*\*TRAIL STOP REVIEW(?:\s*\(INCOME\))?\*\*\s*—\s*\*\*([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\*\*[\s\S]*?(?=\n\n|\n\*\*|\n## |\n### |$)/g;
    const RESOLUTION_ACTIONS = /(SELL AT MARKET|MANDATORY EXIT|EXIT NOW|EXITING PER §|TIGHTEN STOP|TIGHTEN TO|HOLD WITH TRIGGER|HOLD — thesis|per §\s*1|as resolved above|resolved above)/i;
    const reviewMatches = [...md.matchAll(trailBlockRe)];
    for (const m of reviewMatches) {
      const reviewTicker = String(m[1] || "").toUpperCase();
      if (!reviewTicker) continue;
      // Scan the rest of the md AFTER this review block for a
      // resolution mentioning the ticker.
      const afterIdx = m.index + m[0].length;
      const laterMd = md.slice(afterIdx);
      const tickerLineRe = new RegExp(`\\b${reviewTicker}(?:\\.[A-Z]{1,3})?\\b[^\\n]*`, "g");
      let resolved = false;
      let lm;
      while ((lm = tickerLineRe.exec(laterMd)) !== null) {
        const lineStart = laterMd.lastIndexOf("\n", lm.index);
        const lineEnd = laterMd.indexOf("\n", lm.index);
        const line = laterMd.slice(lineStart >= 0 ? lineStart + 1 : 0, lineEnd > 0 ? lineEnd : laterMd.length);
        if (RESOLUTION_ACTIONS.test(line)) { resolved = true; break; }
      }
      if (resolved) {
        md = md.replace(m[0], `_[trail-review resolved — see later mandate for **${reviewTicker}**]_`);
      }
    }
  } catch (e) { console.warn("[trail-review-strip] warn:", e?.message); }

  // ─── Strip cross-ticker-contaminated analyst PT sentences ───
  // AI has been observed hallucinating analyst PTs by pasting another
  // held ticker's current price into a ticker's PT field ("TD PT
  // raised to C$283.47" — where $283.47 was RY's current price, not
  // TD's actual target). The audit gate catches this and blocks the
  // whole briefing. Better: strip the offending sentence at the
  // producer layer so the audit passes and the rest of the briefing
  // ships. Sentence-level scalpel — leaves surrounding narrative alone.
  try {
    if (summary?.canonical) {
      const heldPrices = new Map();
      for (const p of summary.canonical.positions || []) {
        const lp = Number(p.price);
        if (Number.isFinite(lp) && lp > 0) heldPrices.set(p.base, lp);
      }
      if (heldPrices.size >= 2) {
        // Sentence delimiter: split on ". " / newline. Rebuild only
        // sentences that survive the contamination test.
        const sentences = md.split(/(?<=[.!?])\s+|\n/);
        const filtered = [];
        let stripped = 0;
        for (const s of sentences) {
          // Only inspect sentences that mention a PT-like phrase.
          if (!/\b(?:PT|price target|target)\s+(?:raised|of|at|to)/i.test(s)) {
            filtered.push(s);
            continue;
          }
          const ptMatch = s.match(/\b(?:PT|price target|target)\s+(?:raised to|of|at|to)\s+\$?(?:C|CA|CAD|USD|US)?\$?\s*(\d+(?:\.\d+)?)/i);
          if (!ptMatch) { filtered.push(s); continue; }
          const ptVal = Number(ptMatch[1]);
          if (!Number.isFinite(ptVal)) { filtered.push(s); continue; }
          // Which ticker is the sentence talking about? Nearest preceding
          // all-caps token OR the first mentioned held ticker.
          const tickersInSentence = [...s.matchAll(/\b([A-Z]{1,5})\b/g)]
            .map(x => x[1].replace(/\..*$/, ""))
            .filter(t => heldPrices.has(t));
          const contextBase = tickersInSentence[0];
          if (!contextBase) { filtered.push(s); continue; }
          // Check the PT against every OTHER held ticker's current price.
          let contaminated = false;
          for (const [otherBase, otherPrice] of heldPrices) {
            if (otherBase === contextBase) continue;
            const drift = Math.abs(ptVal - otherPrice) / otherPrice;
            if (drift < 0.005) {
              contaminated = true;
              break;
            }
          }
          if (contaminated) {
            stripped++;
            filtered.push(`_[research suppressed — cited PT $${ptVal.toFixed(2)} for **${contextBase}** matched another holding's current price; likely field contamination]_`);
          } else {
            filtered.push(s);
          }
        }
        if (stripped > 0) {
          md = filtered.join(" ");
          console.warn(`[pt-contamination-strip] removed ${stripped} PT sentence(s) that matched other-ticker prices`);
        }
      }
    }
  } catch (e) { console.warn("[pt-contamination-strip] warn:", e?.message); }

  // Return signals + accepted/rejected recs alongside the markdown so
  // persist sites can insertMany directly without re-parsing or
  // re-validating. Callers that only want the string use `.md`.
  // `deterministicPrefix` is exposed separately so callers can ship a
  // degraded briefing when the AI portion is blocked by the audit —
  // the prefix is pure canonical data (sleeves / status / mandates /
  // trail reviews) and can safely go out on its own.
  return { md: md.trim(), sectorRotation, tradingRegime, acceptedRecs, rejectedRecs, mandateRecs: prefixMandateRecs, deterministicPrefix };
}

// Plain-English fix instructions per validator reason slug. Reader
// shouldn't need to interpret "price-drift-stale" — they need to know
// "the system used your cost basis; use current ~$X and re-issue."
// Missing slug → falls back to the machine-readable detail.
function plainEnglishFix(reason, detail) {
  const map = {
    "price-drift-stale":
      "Stale entry price. The system's live cross-check disagrees with what the AI wrote. Refresh the price and re-emit with a limit ≈ live.",
    "gap-extension":
      "Ticker already gapped ≥8% today. Setup consumed. Skip today; wait for digestion.",
    "min-reward-risk":
      "Reward-to-risk below 1.5. Either tighten the stop, widen the target, or drop the idea.",
    "single-name-cap":
      "Position would exceed 20% single-name cap. Cut the share count to fit, or trim the existing lot first.",
    "sleeve-spec-cap-hard":
      "SPEC sleeve is already at/over cap. No new SPEC BUYs until sleeve shrinks.",
    "sleeve-core-gap-widening":
      "CORE is >10pp under target. Only CORE ETF BUYs (XEQT / VUN / XIU / VOO) are allowed until the gap closes.",
    "regime-hostile-no-new-swing-spec":
      "Regime is hostile. Only CORE ETF BUYs allowed until it turns constructive.",
    "sector-laggard-hard-avoid":
      "Sector is bottom-3 by 60d RS in a hostile regime. Pick a leader-sector ticker or a CORE ETF.",
    "sell-no-redeploy-core-underweight":
      "SELL with no companion CORE BUY in the same batch. Pair with a CORE BUY (same account & currency) or drop the SELL.",
    "sell-redeploy-account-mismatch":
      "Proceeds don't cross accounts. Pair SELL and BUY within the same account.",
    "buy-not-core-while-core-underweight":
      "CORE gap open. Only CORE ETFs allowed as new BUYs today.",
    "cross-account-fragmentation":
      "You already hold this ticker in another account. Add to the existing lot to avoid paying commission per-account on future exits.",
    "expectancy-floor-negative":
      "Recent AI-rec expectancy is negative. Discretionary BUYs paused until expectancy recovers; CORE rebalances still OK.",
    "liquidity-floor":
      "Average daily $ volume below the sleeve floor. Pick a more liquid name.",
    "conflicts-with-blocked-sibling":
      "Another rec for this ticker was blocked in the same batch. Mixed signals for one ticker = do not act. Resolve manually and re-emit.",
    "missing-sleeve":
      "Sleeve field missing. Every rec must declare its sleeve (core/swing/income/spec). Parser will normally auto-fill from classifier; this means the classifier also failed to map the ticker.",
    "sleeve-mismatch":
      "AI's declared sleeve disagrees with the classifier's mapping for this ticker. Fix the declaration or update the classifier list.",
    "missing-horizon":
      "horizonDays field missing. Every rec needs an intended holding period as integer days.",
  };
  return map[reason] || detail;
}

// Render the §5 "Blocked by validator" section for the email.
// Empty string when nothing rejected — callers should suppress the
// injection entirely rather than emitting a "0 blocked today" line.
// Reader-first format: ticket-shaped ticker line, then one plain-
// English fix line per reason (not a raw slug + detail dump).
function renderBlockedRecsSection({ rejected }) {
  if (!Array.isArray(rejected) || rejected.length === 0) return "";
  const preface = rejected.length === 1
    ? "One AI-emitted rec was rejected before persist — do not place it."
    : `${rejected.length} AI-emitted recs were rejected before persist — do not place them.`;
  const lines = [
    `## 5. ⛔ BLOCKED — do not place these (${rejected.length})`,
    "",
    preface,
    "",
  ];
  for (const item of rejected) {
    const r = item.rec || {};
    const acctStr = r.account ? ` · ${r.account}` : "";
    const sizeStr = r.shares ? ` ${r.shares} sh` : "";
    const entryStr = r.entryPrice != null ? ` @ $${r.entryPrice}` : "";
    const ccyStr = r.entryCurrency ? ` ${r.entryCurrency}` : "";
    lines.push(`- **${r.action}${sizeStr} ${r.ticker}**${entryStr}${ccyStr}${acctStr}`);
    for (const rej of (item.rejections || [])) {
      lines.push(`  - ${plainEnglishFix(rej.reason, rej.detail)}`);
    }
  }
  return lines.join("\n");
}

// Render the "DO TODAY" order-ticket section — accepted-only recs in
// fixed-field format. Reader sees the concrete tickets FIRST, before
// any narrative deliberation. Grok clarity rules E + A: one line per
// order, no prose, no hedging. Empty string when no accepted recs
// (some briefings only have §1 mandates and no AI-emitted tickets).
function renderDoTodaySection({ accepted, positions }) {
  if (!Array.isArray(accepted) || accepted.length === 0) return "";
  const posByTicker = new Map();
  for (const p of (positions || [])) {
    const base = String(p.ticker || "").toUpperCase().replace(/\..*$/, "");
    if (base) posByTicker.set(base, p);
  }
  const lines = [
    `## 🎯 DO TODAY — order tickets (${accepted.length})`,
    "",
    "One line per accepted rec. Fixed fields, no narrative. Place these in the broker in order.",
    "",
  ];
  accepted.forEach((r, idx) => {
    const acctStr = r.account || "—";
    const shares = r.shares || "?";
    const isBuy = r.action === "BUY";
    const priceCap = isBuy ? "max" : "min";
    const limitStr = r.entryPrice != null
      ? `limit $${r.entryPrice} ${r.entryCurrency || ""} ${priceCap}`
      : "limit —";
    const timingStr = r.orderTiming || "post-10am";
    const stopStr = r.stopPrice != null ? ` · stop $${r.stopPrice}` : "";
    const targetStr = r.targetPrice != null ? ` · target $${r.targetPrice}` : "";
    lines.push(
      `**${idx + 1}. ${r.action} ${shares} ${r.ticker}** · ${acctStr} · ${limitStr} · ${timingStr}${stopStr}${targetStr}`
    );
  });
  return lines.join("\n");
}

// Rewrite the <RECS> JSON block from the accepted-only rec list. Keeps
// the same shape the parser reads (action / ticker / account / entry /
// target / stop / horizonDays / currency / shares / orderTiming) so
// any downstream code that re-parses the archived md gets a truthful
// list matching what actually persisted.
function rewriteRecsBlock(accepted) {
  const arr = (accepted || []).map(r => {
    const o = { action: r.action, ticker: r.ticker };
    if (r.account) o.account = r.account;
    if (r.entryPrice != null) o.entry = r.entryPrice;
    if (r.targetPrice != null) o.target = r.targetPrice;
    if (r.stopPrice != null) o.stop = r.stopPrice;
    if (r.horizonDays) o.horizonDays = r.horizonDays;
    if (r.entryCurrency) o.currency = r.entryCurrency;
    if (r.shares != null) o.shares = r.shares;
    if (r.orderTiming) o.orderTiming = r.orderTiming;
    return o;
  });
  return `<RECS>\n${JSON.stringify(arr, null, 2)}\n</RECS>`;
}

export async function emailBriefing({ to, subject, md }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const inner = md2html(md);
  // Strip the first H1 from the rendered inner if present — we replace it
  // with a branded hero header below so we don't get a double title.
  const innerNoH1 = inner.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(15,23,42,0.06);overflow:hidden">
      <!-- Hero -->
      <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#ec4899 100%);padding:28px 32px;color:#fff">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.14em;opacity:0.82;font-weight:600">📈 Stocks Advisor</div>
        <div style="font-size:24px;font-weight:700;margin-top:8px;letter-spacing:-.01em">Daily briefing</div>
        <div style="font-size:13px;opacity:0.88;margin-top:4px">${dateStr}</div>
      </div>
      <!-- Body -->
      <div style="padding:24px 32px 8px;color:#0b1220;line-height:1.65">
        ${innerNoH1}
      </div>
      <!-- Footer -->
      <div style="padding:16px 32px 28px;border-top:1px solid #eef0f5;background:#fafbfd">
        <div style="font-size:11px;color:#7a8499;line-height:1.5">
          Research and education only. Not licensed investment advice. Generated by Stocks Advisor at <a href="https://curriculate.net/stocks" style="color:#4f46e5;text-decoration:none">curriculate.net/stocks</a>.
        </div>
      </div>
    </div>
  </div>
</body></html>`;
  const from = process.env.STOCKS_BRIEFING_FROM || "Stocks Advisor <noreply@curriculate.net>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${body.slice(0, 200)}`);
  }
  // Return Resend's response so callers can log/surface the message ID
  // (useful for diagnosing "I clicked Send but never got the email" issues —
  // the user can look up the message in the Resend dashboard).
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* keep raw */ }
  return { id: parsed?.id || null, raw: body, from, to, subject };
}

export async function runDailyBriefing(opts = {}) {
  const only = opts.onlyEmail ? opts.onlyEmail.toLowerCase() : null;
  const query = only ? { email: only } : {};
  const portfolios = await StocksPortfolio.find({
    ...query,
    riskTolerance: { $ne: null },
    "positions.0": { $exists: true },
  }).lean();

  console.log(`[stocks-briefing] Generating for ${portfolios.length} user(s)`);

  // On the last trading day of the month, prepend the per-account monthly
  // report block to the briefing body (only for accounts with
  // monthlyReportEnabled=true).
  const includeMonthly = isLastTradingDayOfMonth(new Date());

  for (const p of portfolios) {
    try {
      const gen = await generateBriefing(p);
      let md = gen.md;
      if (includeMonthly) {
        const reports = await buildAllAccountReports(p).catch((e) => { console.warn("[monthly-report] warn:", e?.message); return []; });
        const block = formatAllReportsMarkdown(reports);
        if (block) md = `${block}\n\n---\n\n${md}`;
      }

      md = await validateAndCorrectBriefing(md, p);
      const audit = await auditBriefingWithCritic(md, p);
      md = audit.markdown;

      const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      await emailBriefing({ to: p.email, subject, md });
      // Persist as the in-app advice snapshot so the Advice tab reflects
      // the same content the user just got in email (no extra AI call).
      await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron", criticViolations: audit.violations });

      // Persist actionable recs — generateBriefing already ran the
      // validator so we just persist the accepted list. Rejected recs
      // are already surfaced as §5 in the email that just went out.
      const acceptedRecs = gen.acceptedRecs || [];
      const rejectedRecs = gen.rejectedRecs || [];
      if (acceptedRecs.length > 0) {
        await StocksAdviceRec.insertMany(
          acceptedRecs.map((r) => ({
            email: p.email,
            generatedAt: new Date(),
            source: "ai",
            sourceLabel: "sonnet-briefing-cron",
            ...r,
            horizonDays: r.horizonDays ?? 30, // defensive; validator rejects null but schema needs a number
            rationale: "Daily briefing — server-side cron",
          }))
        );
      }
      if (rejectedRecs.length > 0) {
        console.warn(`[stocks-briefing] ${p.email}: ${rejectedRecs.length} rec(s) rejected by validator, ${acceptedRecs.length} accepted`);
      }
      // Persist mandate BUYs (CORE REBALANCE / CASH DEPLOY / paired
      // REDEPLOYs / CORE DEPLOYs / TRIM SPEC CORE DEPLOY) as
      // searchable AdviceRec docs so the CIBC trade linker
      // (findMatchingOpenRec) can attach a user-executed BUY to the
      // mandate that told them to do it. Otherwise these mandates
      // live only in briefing markdown and every trade against them
      // shows "no linked rec". User Aug 8: bought 74 sh XEQT after
      // the CORE REBALANCE mandate; briefing had no idea they were
      // linked.
      const mandateRecs = gen.mandateRecs || [];
      if (mandateRecs.length > 0) {
        try {
          await StocksAdviceRec.insertMany(
            mandateRecs.map((r) => ({
              email: p.email,
              generatedAt: new Date(),
              status: "open",
              source: "mandate",
              sourceLabel: r.sourceLabel || "mandate",
              action: r.action,
              ticker: r.ticker,
              entryPrice: r.entryPrice,
              entryCurrency: r.entryCurrency,
              stopPrice: r.stopPrice ?? undefined,
              targetPrice: r.targetPrice ?? undefined,
              horizonDays: r.horizonDays ?? 30,
              account: r.account || undefined,
              rationale: `Deterministic ${r.sourceLabel || "mandate"} — briefing cron`,
            })),
            { ordered: false } // one insert failure shouldn't block the rest
          );
          console.log(`[stocks-briefing] ${p.email}: persisted ${mandateRecs.length} mandate rec(s) for trade-linking`);
        } catch (e) {
          console.warn(`[stocks-briefing] ${p.email}: mandate-rec persistence warn: ${e?.message}`);
        }
      }
      console.log(`[stocks-briefing] ✓ ${p.email} — ${recs.length} recs tracked`);
    } catch (err) {
      console.error(`[stocks-briefing] ✗ ${p.email}:`, err?.message);
    }
  }
}

// Format Date → "HH:MM" in given IANA timezone (24-hour).
function timeOfDayInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
  });
  // "07:30" or "07:30" (intl can return "07:30" or with leading zero variations)
  const parts = fmt.formatToParts(date);
  const hh = parts.find(p => p.type === "hour")?.value ?? "00";
  const mm = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

// Format Date → "YYYY-MM-DD" in given IANA timezone.
function dateInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  // en-CA gives "YYYY-MM-DD" natively
  return fmt.format(date);
}

// Find every user whose configured briefingTimes contains the current
// minute (in their own timezone) and hasn't been sent for that
// (date, time) tuple yet. Used by the per-minute scheduler tick.
//
// Self-healing catch-up (added 2026-08-13): a slot missed because
// the server was restarting / redeploying at exactly the scheduled
// minute gets caught up on the next healthy tick, provided we're
// still within CATCHUP_MAX_MIN of the scheduled time. Diagnosed
// after user's 07:30 ET brief silently skipped on a Render redeploy
// day; every other tick was healthy and diagnostics all-green, but
// that one minute happened to overlap the process restart.
//
// Retry cooldown prevents error hammering: if a slot has been
// attempted recently (within RETRY_COOLDOWN_MIN) and hasn't
// succeeded, we skip it. So at most ~20 attempts across the whole
// 60-min catch-up window even if Anthropic is down the whole time.
const CATCHUP_MAX_MIN = 60;
const RETRY_COOLDOWN_MIN = 3;

async function findUsersDueForBriefing(now) {
  // Only users with at least one configured time + non-empty positions
  const portfolios = await StocksPortfolio.find({
    "briefingTimes.0": { $exists: true },
    "positions.0": { $exists: true },
  }).lean();

  const due = [];
  for (const p of portfolios) {
    const tz = p.briefingTz || "America/New_York";
    const hhmm = timeOfDayInTz(now, tz);
    const ymd = dateInTz(now, tz);
    if (!Array.isArray(p.briefingTimes) || p.briefingTimes.length === 0) continue;
    const [nowH, nowM] = hhmm.split(":").map(Number);
    const nowMinutes = nowH * 60 + nowM;

    // Walk configured slots. Pick the most-recent past slot still
    // within the catch-up window that hasn't been sent yet. Preferring
    // the freshest slot means an all-day outage recovered at noon
    // catches up on the noon-ish slot (if any), not the 07:30 one —
    // sending yesterday-morning's advice to someone reading it 5 hours
    // later would be worse than skipping.
    let best = null;
    for (const slot of p.briefingTimes) {
      if (!/^\d{2}:\d{2}$/.test(slot)) continue;
      const [sh, sm] = slot.split(":").map(Number);
      const slotMinutes = sh * 60 + sm;
      const delta = nowMinutes - slotMinutes;
      if (delta < 0 || delta > CATCHUP_MAX_MIN) continue;
      const key = `${ymd}|${slot}`;
      if (p.lastBriefingSentKey === key) continue;
      // Retry cooldown — don't hammer on persistent failures.
      if (p.lastBriefingAttemptKey === key && p.lastBriefingAttemptAt) {
        const attemptAgeMs = now.getTime() - new Date(p.lastBriefingAttemptAt).getTime();
        if (attemptAgeMs < RETRY_COOLDOWN_MIN * 60 * 1000) continue;
      }
      if (!best || delta < best.delta) best = { slot, key, delta };
    }
    if (!best) continue;
    // Log catch-up events distinctly so they're greppable in Render
    // logs. delta === 0 is the normal current-minute case — silent
    // to keep the log volume sane.
    if (best.delta > 0) {
      console.log(`[stocks-briefing] catch-up: ${p.email} slot ${best.slot} (${best.delta}min late)`);
    }
    due.push({ portfolio: p, sendKey: best.key });
  }
  return due;
}

// Send the briefing for a single user, then stamp lastBriefingSentKey so
// the same slot doesn't fire again within the same minute window.
// Assemble a degraded briefing that goes out when the deterministic
// pre-send audit blocks the full briefing. Contains ONLY canonical
// data (sleeve status, mandates, positions, trail reviews) + a banner
// naming the exact blockers. AI-generated ideas are dropped. Better
// than silence — the operator still receives the actionable canonical
// picture, and the banner tells them exactly what stopped the full
// briefing so the upstream defect can be traced.
function buildDegradedBriefing({ deterministicPrefix, blockers = [], summary, dateStr }) {
  const banner = [
    "> ⚠ **DEGRADED BRIEFING — AI section suppressed by pre-send audit.**",
    ">",
    "> The deterministic pre-send audit found data-integrity or logic problems",
    "> that would have made the full briefing misleading. The canonical portion",
    "> below (mandates, stops, sleeves, positions) is safe to act on — the AI",
    "> commentary and Optional Ideas section have been removed.",
    ">",
    `> **Blocker summary:** ${summary || `${blockers.length} check(s) failed.`}`,
    ">",
    "> **Individual blockers:**",
  ];
  for (const b of (blockers || []).slice(0, 20)) {
    banner.push(`> - **${b.check}** — ${b.reason}`);
    if (b.detail) banner.push(`>   ${String(b.detail).replace(/\n/g, " ").slice(0, 300)}`);
  }
  const header = `# 📉 Daily briefing — ${dateStr} (degraded)`;
  const body = deterministicPrefix && deterministicPrefix.trim().length > 0
    ? deterministicPrefix
    : "_(Deterministic prefix unavailable — canonical engine returned no data. Check portfolio state.)_";
  return [header, "", banner.join("\n"), "", body, "", "---", "_This is a degraded briefing. Fix the upstream issue named in the blocker list; the next cron slot will retry the full briefing._"].join("\n");
}

export async function sendBriefingForUser(p, sendKey) {
  // Stamp attempt-time FIRST thing so the diagnostic can prove the function
  // was actually entered (vs. the trigger's fire-and-forget never running,
  // or the dyno napping through the scheduled slot).
  try {
    await StocksPortfolio.updateOne(
      { email: p.email },
      { $set: { lastBriefingAttemptAt: new Date(), lastBriefingAttemptKey: sendKey } }
    );
  } catch (e) { console.warn("[stocks-briefing] attempt-stamp failed:", e?.message); }

  // Persist the exact stage + message of any failure so the diagnostic
  // endpoint can show WHY silently-failing sends silently-failed.
  let recorded = false;
  const recordFail = async (stage, err) => {
    recorded = true;
    try {
      await StocksPortfolio.updateOne(
        { email: p.email },
        { $set: {
            lastBriefingErrorAt: new Date(),
            lastBriefingErrorStage: stage,
            lastBriefingErrorMessage: String(err?.message || err).slice(0, 500),
          } }
      );
    } catch { /* ignore */ }
  };

  let md;
  try {
    const includeMonthly = isLastTradingDayOfMonth(new Date());
    let genResult = { acceptedRecs: [], rejectedRecs: [] };
    try {
      genResult = await generateBriefing(p);
      md = genResult.md;
    }
    catch (e) { await recordFail("generateBriefing", e); throw e; }
    if (includeMonthly) {
      const reports = await buildAllAccountReports(p).catch((e) => { console.warn("[monthly-report] warn:", e?.message); return []; });
      const block = formatAllReportsMarkdown(reports);
      if (block) md = `${block}\n\n---\n\n${md}`;
    }
    // Same price-validation + correction pass the manual /send-briefing uses.
    // Never throws — returns the (corrected or as-is) markdown.
    md = await validateAndCorrectBriefing(md, p);

    // Phase 1 (spec §20 + §24): deterministic pre-send audit gate.
    // Every price verified against the market-data integrity layer;
    // every stop/target > 0; no phantom SELL; no BUY of a blocked
    // ticker; no ticker contradicting itself across DO TODAY and
    // TRAIL STOP REVIEW. Runs BEFORE the critic so a costly OpenAI
    // call is not spent on a briefing that is going to be blocked.
    // If anything blocks, we ship a DEGRADED briefing (deterministic
    // prefix only + blocker list) rather than silently dropping the
    // slot — the operator is never left with zero output.
    let preSendAudit = null;
    let auditCrashed = false;
    try {
      preSendAudit = await auditBriefingBeforeSend({
        email: p.email,
        md,
        acceptedRecs: genResult.acceptedRecs || [],
        rejectedRecs: genResult.rejectedRecs || [],
        positions: p.positions || [],
        profile: p, // Phase 3+4: canonical portfolio checks need full profile (accounts, fx, sleeveTargets)
      });
    } catch (e) {
      // The audit itself crashed — that's a bug, but not one we want
      // to convert into a permanent send-block. Log loudly and let
      // the send proceed; the critic + validator gates upstream still
      // apply.
      auditCrashed = true;
      console.error(`[stocks-briefing] pre-send audit crashed for ${p.email}:`, e?.message);
    }

    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    // Discipline critic (OpenAI). Skipped when audit blocked (no point
    // paying to critique a briefing we're not shipping in full) OR
    // when there are no accepted recs to critique (nothing for the
    // critic to flag). Cost saved: 1 OpenAI call per suppressed or
    // no-rec briefing.
    const acceptedForCritic = genResult.acceptedRecs || [];
    const shouldRunCritic = (preSendAudit?.ok || auditCrashed) && acceptedForCritic.length > 0;
    let criticViolations = [];
    if (shouldRunCritic) {
      const audit = await auditBriefingWithCritic(md, p);
      md = audit.markdown;
      criticViolations = audit.violations || [];
    } else {
      const reason = !preSendAudit?.ok ? "audit-blocked" : "no-accepted-recs";
      console.log(`[stocks-briefing] critic skipped for ${p.email} — ${reason}`);
    }

    if (preSendAudit && !preSendAudit.ok) {
      const summary = summarizeAuditFailure(preSendAudit);
      await recordFail("preSendAudit", new Error(summary));
      console.warn(`[stocks-briefing] ⛔ ${p.email} @ ${sendKey} — suppressed by pre-send audit (${preSendAudit.blockers.length} blocker(s)); sending DEGRADED fallback`);
      for (const b of preSendAudit.blockers.slice(0, 5)) {
        console.warn(`  [${b.check}] ${b.reason}`);
      }
      // Degraded briefing: deterministic prefix (fully canonical —
      // stops, mandates, sleeve status, positions, trail reviews) +
      // an amber banner listing the audit blockers. The AI portion
      // is dropped. Better than zero output — operator can still act
      // on mandates and see the specific data-integrity issue.
      const degradedMd = buildDegradedBriefing({
        deterministicPrefix: genResult.deterministicPrefix || "",
        blockers: preSendAudit.blockers,
        summary,
        dateStr,
      });
      const subject = `Daily briefing — ${dateStr} — degraded (audit suppressed AI section)`;
      try { await emailBriefing({ to: p.email, subject, md: degradedMd }); }
      catch (e) { console.warn(`[stocks-briefing] degraded email failed for ${p.email}:`, e?.message); }
      try { await saveAdviceSnapshot({ email: p.email, markdown: degradedMd, source: "cron-degraded", criticViolations: [] }); }
      catch (e) { /* best-effort snapshot */ }
      // Stamp idempotency key so we don't loop on the same slot every
      // minute — a degraded send still counts as "handled".
      try {
        await StocksPortfolio.updateOne(
          { email: p.email },
          { $set: { lastBriefingSentKey: sendKey } }
        );
      } catch { /* best-effort */ }
      return;
    }
    if ((preSendAudit?.warnings || []).length > 0) {
      console.log(`[stocks-briefing] audit warnings for ${p.email}: ${preSendAudit.warnings.length}`);
    }

    const subject = `Daily briefing — ${dateStr}`;
    try { await emailBriefing({ to: p.email, subject, md }); }
    catch (e) { await recordFail("emailBriefing", e); throw e; }
    try { await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron", criticViolations }); }
    catch (e) { await recordFail("saveAdviceSnapshot", e); throw e; }

    // generateBriefing already ran parse + enrich + validate; §5
    // section is in the email that just went out. Persist the
    // accepted list directly.
    const acceptedRecs = genResult.acceptedRecs || [];
    const rejectedRecs = genResult.rejectedRecs || [];
    if (rejectedRecs.length > 0) {
      console.warn(`[stocks-briefing/dispatch] ${p.email}: ${rejectedRecs.length} rec(s) rejected, ${acceptedRecs.length} accepted`);
    }
    if (acceptedRecs.length > 0) {
      try {
        await StocksAdviceRec.insertMany(
          acceptedRecs.map((r) => ({
            email: p.email,
            generatedAt: new Date(),
            source: "ai",
            sourceLabel: "sonnet-briefing-cron",
            ...r,
            horizonDays: r.horizonDays ?? 30, // defensive; validator rejects null but schema needs a number
            rationale: "Daily briefing — server-side cron",
          }))
        );
      } catch (e) { await recordFail("insertRecs", e); throw e; }
    }

    // Stamp idempotency key + clear any prior error state (this send succeeded).
    try {
      await StocksPortfolio.updateOne(
        { email: p.email },
        {
          $set: { lastBriefingSentKey: sendKey, lastBriefingSuccessAt: new Date() },
          $unset: { lastBriefingErrorAt: 1, lastBriefingErrorStage: 1, lastBriefingErrorMessage: 1 },
        }
      );
    } catch (e) { await recordFail("stampSuccess", e); throw e; }

    // FIXED: was `recs.length` — undefined identifier that threw a
    // ReferenceError after every successful send, then the outer catch
    // re-stamped lastBriefingErrorAt as "unknown", making the diagnostic
    // panel report failures for every send that actually delivered.
    console.log(`[stocks-briefing] ✓ ${p.email} @ ${sendKey} — ${acceptedRecs.length} recs tracked`);
  } catch (err) {
    // If none of the inner catches labeled the stage, this outer catch
    // records it as "unknown" — the message still tells us what actually
    // threw (e.g. a null-deref inside validateAndCorrectBriefing).
    if (!recorded) await recordFail("unknown", err);
    console.error(`[stocks-briefing] ✗ ${p.email}:`, err?.message);
  }
}

export function scheduleDailyBriefing() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") {
    console.log("[stocks-briefing] disabled (set STOCKS_BRIEFING_ENABLED=1 to turn on)");
    return null;
  }
  // Per-minute tick — each user has their own list of up-to-4 send times
  // stored on their portfolio (briefingTimes + briefingTz). Tick checks
  // every user against the current minute in their own timezone.
  console.log(`[stocks-briefing] scheduled: per-user (every minute scan)`);
  return cron.schedule("* * * * *", async () => {
    try {
      const due = await findUsersDueForBriefing(new Date());
      // Heartbeat FIRST, so a stale heartbeat unambiguously means "the tick
      // isn't firing" (server dead) vs "the tick is firing but no one is due".
      try {
        await StocksSystemHeartbeat.findOneAndUpdate(
          { name: "daily-briefing-tick" },
          { $set: { lastTickAt: new Date(), lastTickDueCount: due.length } },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch (e) { console.warn("[stocks-briefing] heartbeat write failed:", e?.message); }
      if (due.length === 0) return;
      console.log(`[stocks-briefing] tick: ${due.length} user(s) due`);
      for (const { portfolio, sendKey } of due) {
        await sendBriefingForUser(portfolio, sendKey);
      }
    } catch (e) { console.error("[stocks-briefing] tick error:", e); }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Dedicated end-of-month report job. Runs after market close (5pm ET by
// default) every weekday, but emits only on the last trading day of the
// month. Produces a focused email containing JUST the per-account monthly
// reports (no AI advice, no recs) for users with monthlyReportEnabled
// accounts.
// ─────────────────────────────────────────────────────────────────────
export async function runMonthlyReportJob(opts = {}) {
  const force = opts.force === true;
  if (!force && !isLastTradingDayOfMonth(new Date())) {
    console.log("[stocks-monthly-report] skip — not last trading day of month");
    return;
  }
  const only = opts.onlyEmail ? opts.onlyEmail.toLowerCase() : null;
  const query = only ? { email: only } : {};
  // Only users with at least one account that has monthlyReportEnabled
  const portfolios = await StocksPortfolio.find({
    ...query,
    "accounts.monthlyReportEnabled": true,
  }).lean();

  console.log(`[stocks-monthly-report] generating for ${portfolios.length} user(s)`);
  for (const p of portfolios) {
    try {
      const reports = await buildAllAccountReports(p);
      const block = formatAllReportsMarkdown(reports);
      if (!block) continue;
      const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const md = `# 📊 Monthly account report — ${monthLabel}\n\n${block}\n\n---\n\nResearch and education only. Not licensed investment advice.`;
      const subject = `Monthly account report — ${monthLabel}`;
      const ownerResp = await emailBriefing({ to: p.email, subject, md });
      console.log(`[stocks-monthly-report] ✓ owner ${p.email} id=${ownerResp?.id}`);

      // Per-account cc emails — each external recipient sees ONLY their
      // account's section, not the rest of the portfolio. Useful when an
      // account is held for a beneficiary who is entitled to see their
      // own performance but should not see other accounts.
      const flagged = (p.accounts || []).filter(a => a.monthlyReportEnabled);
      for (let i = 0; i < flagged.length; i++) {
        const acct = flagged[i];
        const cc = acct.monthlyReportCcEmail && acct.monthlyReportCcEmail.trim();
        if (!cc) continue;
        // Match the report to THIS account by id — never by array index.
        // buildAllAccountReports can drop entries (a missing account yields
        // null), so positional pairing risks emailing a beneficiary another
        // account's financials.
        const accountReport = reports.find(r => r && r.accountId === acct.id);
        if (!accountReport) continue;
        const singleBlock = formatAccountReportMarkdown(accountReport);
        const ccSubject = `${acct.name} monthly report — ${monthLabel}`;
        const ccMd = `# ${acct.name} — ${monthLabel}\n\n${singleBlock}\n\n---\n\nResearch and education only. Not licensed investment advice.`;
        try {
          const ccResp = await emailBriefing({ to: cc, subject: ccSubject, md: ccMd });
          console.log(`[stocks-monthly-report] ✓ cc ${cc} (${acct.name}) id=${ccResp?.id}`);
        } catch (e) {
          console.error(`[stocks-monthly-report] ✗ cc ${cc} (${acct.name}):`, e?.message);
        }
      }
    } catch (err) {
      console.error(`[stocks-monthly-report] ✗ ${p.email}:`, err?.message);
    }
  }
}

export function scheduleMonthlyReport() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") return null;
  // Default: 5:15 PM ET weekdays — 15 min after typical close to let
  // intraday snapshots settle. The job no-ops unless it's actually the
  // last trading day of the month.
  const expr = process.env.STOCKS_MONTHLY_REPORT_CRON || "15 17 * * 1-5";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-monthly-report] scheduled: "${expr}" ${tz} (runs only on last trading day)`);
  return cron.schedule(expr, async () => {
    try { await runMonthlyReportJob(); } catch (e) { console.error("[stocks-monthly-report] tick error:", e); }
  }, { timezone: tz });
}

// ─────────────────────────────────────────────────────────────────────
// Weekly Discovery scan job. For each user with a portfolio, run the
// FMP screener + AI thesis writer pipeline and email the top candidates.
// Default schedule: Sundays 7 PM ET (markets closed; user has time to
// digest before Monday open).
// ─────────────────────────────────────────────────────────────────────
export async function runWeeklyDiscoveryJob(opts = {}) {
  const only = opts.onlyEmail ? opts.onlyEmail.toLowerCase() : null;
  const query = only ? { email: only } : {};

  // Lazy imports — these models / services are only needed inside this job
  const { default: StocksPortfolio } = await import("../models/StocksPortfolio.js");
  const { runDiscoveryScan } = await import("../services/stocksDiscoveryService.js");

  const portfolios = await StocksPortfolio.find({
    ...query,
    "positions.0": { $exists: true },
  }).lean();

  console.log(`[stocks-weekly-discovery] running for ${portfolios.length} user(s)`);

  for (const p of portfolios) {
    try {
      const result = await runDiscoveryScan({
        email: p.email,
        excludeTickers: (p.positions || []).map((pos) => pos.ticker),
        topN: 6,
      });
      const candidates = result?.candidates || [];
      if (candidates.length === 0) {
        console.log(`[stocks-weekly-discovery] ${p.email} — no candidates`);
        continue;
      }
      // Build the email
      const monthLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const lines = [];
      lines.push(`# 🔍 Weekly Discovery — ${monthLabel}`);
      lines.push("");
      lines.push(`Top ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} from this week's universe scan. **Open the Discover tab on curriculate.net/stocks** to star, dismiss, or expand the full thesis on any of these. Most leads underperform; a small number 5-10× — the kill thesis is the most important line on each.`);
      lines.push("");
      for (const c of candidates) {
        const upside = (c.thesis?.priceTarget && c.priceAtDiscovery)
          ? ` · target $${c.thesis.priceTarget.toFixed(2)} (${(((c.thesis.priceTarget - c.priceAtDiscovery) / c.priceAtDiscovery) * 100).toFixed(0)}% upside)`
          : "";
        lines.push(`### ${c.ticker} — ${c.name || ""}`);
        lines.push(`**${(c.thesis?.conviction || "medium").toUpperCase()} conviction** · score ${c.score}/100 · ${c.sector || "—"} · $${(c.marketCap / 1_000_000).toFixed(0)}M cap · price $${c.priceAtDiscovery?.toFixed(2)}${upside}`);
        lines.push("");
        lines.push(`**Bull case:** ${c.thesis?.bullCase || "—"}`);
        lines.push("");
        lines.push(`**Kill thesis:** ${c.thesis?.killThesis || "—"}`);
        if (c.thesis?.catalysts?.length > 0) {
          lines.push("");
          lines.push(`**Catalysts:**`);
          for (const cat of c.thesis.catalysts) lines.push(`- ${cat}`);
        }
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      lines.push("Research and education only. Not licensed investment advice.");
      const md = lines.join("\n");
      const subject = `🔍 Weekly Discovery — ${candidates.length} candidates (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
      await emailBriefing({ to: p.email, subject, md });
      console.log(`[stocks-weekly-discovery] ✓ ${p.email} — ${candidates.length} candidates`);
    } catch (err) {
      console.error(`[stocks-weekly-discovery] ✗ ${p.email}:`, err?.message);
    }
  }
}

export function scheduleWeeklyDiscovery() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") return null;
  // Default: Sundays 7 PM ET. Markets closed; user has all of Sunday
  // evening + Monday morning to digest before any trading decisions.
  const expr = process.env.STOCKS_WEEKLY_DISCOVERY_CRON || "0 19 * * 0";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-weekly-discovery] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    console.log(`[stocks-weekly-discovery] tick: ${new Date().toISOString()}`);
    try { await runWeeklyDiscoveryJob(); } catch (e) { console.error("[stocks-weekly-discovery] tick error:", e); }
  }, { timezone: tz });
}

// ─────────────────────────────────────────────────────────────────────
// Discovery OUTCOME tracker — point-in-time tracking of every discovered
// candidate over time, regardless of action taken on it. Each run:
//   • refreshes lastPrice
//   • updates running peak / trough (max gain / max drawdown since tracking)
//   • freezes the 30/90/180/365-day outcome bucket once that horizon matures
// Candidates stop being tracked after ~400 days (all horizons captured).
// ─────────────────────────────────────────────────────────────────────
function resolveDiscSymbol(ticker, currency) {
  const s = String(ticker || "").toUpperCase();
  if (s.includes(".")) return s;
  return currency === "CAD" ? `${s}.TO` : s;
}

export async function runDiscoveryOutcomeTracker(opts = {}) {
  const horizons = [[30, "outcome30d"], [90, "outcome90d"], [180, "outcome180d"], [365, "outcome365d"]];
  const cutoff = new Date(Date.now() - 400 * 86400 * 1000);
  const query = { scanDate: { $gte: cutoff } };
  if (opts.onlyEmail) query.email = opts.onlyEmail.toLowerCase();
  const cands = await StocksDiscoveryCandidate.find(query).lean();
  if (!cands.length) return { checked: 0, updated: 0 };

  // One live price per resolved exchange symbol (CAD discoveries → .TO).
  const symbols = [...new Set(cands.map((c) => resolveDiscSymbol(c.ticker, c.currencyAtDiscovery)))];
  const priceMap = {};
  await Promise.all(symbols.map(async (s) => { priceMap[s] = await fetchCurrentPrice(s); }));

  const now = new Date();
  let updated = 0;
  for (const c of cands) {
    const px = priceMap[resolveDiscSymbol(c.ticker, c.currencyAtDiscovery)];
    if (px == null || !c.priceAtDiscovery) continue;
    const pct = ((px - c.priceAtDiscovery) / c.priceAtDiscovery) * 100;
    const daysOld = (Date.now() - new Date(c.scanDate).getTime()) / 86400000;
    const set = { lastPrice: px, lastPriceCheckedAt: now, lastOutcomeCheckAt: now };
    if (c.peakPrice == null || px > c.peakPrice) { set.peakPrice = px; set.peakPct = pct; set.peakAt = now; }
    if (c.troughPrice == null || px < c.troughPrice) { set.troughPrice = px; set.troughPct = pct; set.troughAt = now; }
    for (const [h, field] of horizons) {
      // Freeze the bucket at the first tracking run on/after the horizon.
      if (daysOld >= h && !c[field]) set[field] = { pct, dollars: px - c.priceAtDiscovery, atPrice: px };
    }
    try { await StocksDiscoveryCandidate.updateOne({ _id: c._id }, { $set: set }); updated++; } catch { /* skip */ }
  }

  // ── Daily conviction snapshot (AI-free) ──────────────────────────────
  // Append a deterministic "structural conviction" point so the trend updates
  // automatically every day, even when no scan is run. Bounded to the names
  // the user actually cares about (starred OR scanned in the last 21 days),
  // deduped by ticker, capped — no AI/web_search cost.
  const recent = new Date(Date.now() - 21 * 86400 * 1000);
  const trackSeen = new Set();
  const toTrack = [];
  for (const c of cands.sort((a, b) => new Date(b.scanDate) - new Date(a.scanDate))) {
    if (!(c.starred || new Date(c.scanDate) >= recent)) continue;
    const k = `${c.email}|${c.ticker}`;
    if (trackSeen.has(k)) continue;
    trackSeen.add(k);
    toTrack.push(c);
    if (toTrack.length >= 30) break;
  }
  let convictionUpdated = 0;
  if (toTrack.length) {
    const spyPoints = await fetchYahooDaily("SPY", "1y").catch(() => null);
    for (const c of toTrack) {
      try {
        const det = await computeDeterministicFactors({ ticker: c.ticker, currency: c.currencyAtDiscovery, marketCap: c.marketCap, fmpFundamentals: null, spyPoints });
        const score = deterministicComposite(det.sub, "balanced");
        if (score == null) continue;
        await StocksDiscoveryCandidate.updateOne(
          { _id: c._id },
          { $push: { scoreHistory: { $each: [{ date: now, score, source: "auto" }], $slice: -90 } } }
        );
        convictionUpdated++;
      } catch { /* skip */ }
    }
  }

  // ── Second pass: freeze forward-return horizons on external
  // nomination docs using the exact same frozen methodology (freeze-
  // once, benchmark-period-matched to publishedAt). Uses the same
  // fetchCurrentPrice + fetchYahooDaily helpers already exercised
  // above so any cache warmed by the discovery pass is reused.
  // Health: stamps its own heartbeat so the diagnostics endpoint can
  // separately observe the two passes even though they share a cron.
  let externalPass = { checked: 0, frozen: 0, skipped: 0 };
  const externalPassStart = Date.now();
  try {
    const { runExternalNominationOutcomePass } = await import("../services/stocksExternalNominations.js");
    externalPass = await runExternalNominationOutcomePass({
      fetchCurrentPriceFn: (t) => fetchCurrentPrice(t),
      fetchBenchmarkSeriesFn: (sym) => fetchYahooDaily(sym, "1y").catch(() => null),
    });
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: "external-nominations-outcome-pass" },
      { $set: {
          lastTickAt: new Date(),
          lastRunSummary: { ...externalPass, elapsedMs: Date.now() - externalPassStart },
          lastError: null, lastErrorAt: null,
        } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.warn("[external-nomination-outcome-pass] warn:", errMsg);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: "external-nominations-outcome-pass" },
      { $set: {
          lastTickAt: new Date(),
          lastError: errMsg, lastErrorAt: new Date(),
          lastRunSummary: { failed: true, elapsedMs: Date.now() - externalPassStart },
        } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
  }
  console.log(`[stocks-outcome-tracker] checked ${cands.length}, updated ${updated}, conviction ${convictionUpdated}, external{checked=${externalPass.checked}, frozen=${externalPass.frozen}, skipped=${externalPass.skipped}}`);
  return { checked: cands.length, updated, convictionUpdated, externalPass };
}

// ─────────────────────────────────────────────────────────────────────
// Daily portfolio-value snapshot — captures total value (+ per-account)
// every weekday after the US close, regardless of whether the user saved
// the portfolio that day. Without this the Performance chart is flat at the
// most recent PUT (snapshots are otherwise only written on PUT).
// ─────────────────────────────────────────────────────────────────────
export async function runDailyPortfolioSnapshotJob(opts = {}) {
  const query = opts.onlyEmail ? { email: opts.onlyEmail.toLowerCase() } : {};
  const docs = await StocksPortfolio.find(query);
  let ok = 0, fail = 0, priceRefreshes = 0;
  for (const doc of docs) {
    try {
      // Refresh live prices BEFORE snapshotting — otherwise the snapshot
      // freezes at whatever priceUsd/priceCad happened to be persisted the
      // last time the user clicked "Refresh prices" in the UI. That leaves
      // Performance-tab tiles (WoW, Max Growth, 14d avg) reading 0.0%
      // because every daily snapshot writes the same totalCad. The
      // intraday poller, stop monitor, and rec-applier deliberately keep
      // their refreshes in-memory — this cron is the one place we DO want
      // to persist the fresh quote to disk. Same fail-open pattern as
      // processPositionStopsOnce in stocksAlerts.js.
      const positions = doc.positions || [];
      let refreshedCount = 0;
      for (const pos of positions) {
        if (!pos?.ticker || !(pos.qty > 0)) continue;
        const ccy = pos.ccy || "USD";
        try {
          const rt = await getRealtimeQuote(pos.ticker, ccy);
          const live = rt?.price;
          if (Number.isFinite(live) && live > 0) {
            if (ccy === "USD") pos.priceUsd = live;
            else pos.priceCad = live;
            refreshedCount++;
          } else {
            const tech = await getTechnicals(pos.ticker, ccy);
            if (tech?.ok && Number.isFinite(tech.last) && tech.last > 0) {
              if (ccy === "USD") pos.priceUsd = tech.last;
              else pos.priceCad = tech.last;
              refreshedCount++;
            }
          }
        } catch { /* fall through — writeDailySnapshot will use stored price */ }
      }
      if (refreshedCount > 0) {
        doc.markModified("positions");
        await doc.save();
        priceRefreshes += refreshedCount;
      }
      await writeDailySnapshot(doc);
      ok++;
    } catch (e) {
      fail++;
      console.warn("[stocks-portfolio-snapshot] fail:", doc.email, e?.message);
    }
  }
  console.log(`[stocks-portfolio-snapshot] wrote ${ok}, failed ${fail}, refreshed ${priceRefreshes} prices`);
  return { ok, fail, priceRefreshes };
}

export function scheduleDailyPortfolioSnapshot() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") return null;
  // ~4:30 PM ET on weekdays — just after the US market close.
  const expr = process.env.STOCKS_PORTFOLIO_SNAPSHOT_CRON || "30 16 * * 1-5";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-portfolio-snapshot] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    console.log(`[stocks-portfolio-snapshot] tick: ${new Date().toISOString()}`);
    try { await runDailyPortfolioSnapshotJob(); } catch (e) { console.error("[stocks-portfolio-snapshot] tick error:", e); }
  }, { timezone: tz });
}

// ─── External-nomination daily sync (05:00 ET) ────────────────────────
// Runs once daily to refresh nominations for the eligible Discover
// universe. Idempotent — the persistNominations upsert on
// (ticker, sourceKey, publishedAt) means re-runs never dupe.
//
// Health: every fire stamps StocksSystemHeartbeat with lastTickAt +
// lastRunSummary + (on failure) lastError. Diagnostics endpoint can
// distinguish "cron hasn't fired" from "cron fired but scanned 0
// tickers" from "cron fired and errored".
export async function runExternalNominationsSync(opts = {}) {
  const heartbeatName = "external-nominations-sync";
  const startedAt = Date.now();
  try {
    const { syncExternalNominationsForUniverse } = await import("../services/stocksExternalNominations.js");
    const summary = await syncExternalNominationsForUniverse(opts);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastRunSummary: summary, lastError: null, lastErrorAt: null } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return summary;
  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.error("[external-nominations sync] fatal:", e);
    await StocksSystemHeartbeat.findOneAndUpdate(
      { name: heartbeatName },
      { $set: { lastTickAt: new Date(), lastError: errMsg, lastErrorAt: new Date(),
                lastRunSummary: { failed: true, elapsedMs: Date.now() - startedAt } } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => {});
    return { error: errMsg };
  }
}

export function scheduleExternalNominationsSync() {
  if (process.env.STOCKS_EXTERNAL_NOMINATIONS_SYNC_ENABLED === "0") {
    console.log("[external-nominations sync] disabled (STOCKS_EXTERNAL_NOMINATIONS_SYNC_ENABLED=0)");
    return null;
  }
  const expr = process.env.STOCKS_EXTERNAL_SYNC_CRON || "0 5 * * *"; // 05:00 America/Toronto
  console.log(`[external-nominations sync] scheduled: ${expr} America/Toronto`);
  return cron.schedule(expr, async () => {
    console.log("[external-nominations sync] tick");
    try { await runExternalNominationsSync({ verbose: true }); }
    catch (e) { console.error("[external-nominations sync] tick error:", e); }
  }, { timezone: "America/Toronto" });
}

export function scheduleDiscoveryOutcomeTracker() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") return null;
  // Once daily, after the US close (default 6 PM ET) so peak/trough capture
  // reflects the day's settled price.
  const expr = process.env.STOCKS_OUTCOME_TRACKER_CRON || "0 18 * * 1-5";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-outcome-tracker] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    console.log(`[stocks-outcome-tracker] tick: ${new Date().toISOString()}`);
    try { await runDiscoveryOutcomeTracker(); } catch (e) { console.error("[stocks-outcome-tracker] tick error:", e); }
  }, { timezone: tz });
}
