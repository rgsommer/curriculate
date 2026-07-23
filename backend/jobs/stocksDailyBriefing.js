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
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksAdviceSnapshot from "../models/StocksAdviceSnapshot.js";
import { getTechnicals, formatTechnicalsLine } from "../services/stocksTechnicals.js";
import { getFundamentals, formatFundamentalsLine } from "../services/stocksFundamentals.js";
import { getCatalysts, formatCatalystsLine } from "../services/stocksCatalystsFmp.js";
import { getShortInterest, formatShortInterestLine } from "../services/stocksShortInterest.js";
import { enrichRecsWithExitDefaults, insertAutoSellTrail } from "../services/stocksRecTrail.js";
import { generateDailyPicksForUser } from "../services/stocksDailyPickEngine.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import { getSectorRotation, formatSectorRotationBlock } from "../services/stocksSectorRotation.js";
import { computeCorrelations, formatCorrelationBlock } from "../services/stocksPortfolioCorrelation.js";
import { getFedLiquidity, formatFedLiquidityBlock } from "../services/stocksFedLiquidity.js";
import { getCongressionalTradesForTickers, formatCongressionalBlock } from "../services/stocksCongressional.js";
import { getOptionsMetrics, formatOptionsLine } from "../services/stocksOptionsMetrics.js";
import { monitorPositionStops, formatPositionStopBlock } from "../services/stocksPositionStopMonitor.js";
import { computeSleeveBalance, formatSleeveBalanceBlock, classifyPosition } from "../services/stocksSleeveEnforcer.js";
import { computeCalibration, formatCalibrationBlock } from "../services/stocksScoreCalibration.js";
import { computeHorizonReview, formatHorizonReviewBlock } from "../services/stocksHorizonReview.js";
import { computeTwrr } from "../services/stocksTwrr.js";
import { computeBenchmarkReturns, formatBenchmarkBlock } from "../services/stocksBenchmark.js";
import { computeSizingAdjustments, formatSizingAdjustmentBlock } from "../services/stocksCorrelationSizing.js";
import { computeOverlaySuggestions, formatOverlayBlock } from "../services/stocksOptionsOverlay.js";
import { computeCompliance, formatComplianceBlock } from "../services/stocksCompliance.js";
import { computeAttribution, formatAttributionBlock } from "../services/stocksAttribution.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import { getMacroContext, formatMacroBlock } from "../services/stocksMacroContext.js";
import { computeLifecycle, formatLifecycleBlock } from "../services/stocksLifecycle.js";
import { computeFactorTilts, formatFactorBlock } from "../services/stocksFactorAnalysis.js";
import { computeLessons, formatLessonsBlock } from "../services/stocksLessonsLearned.js";
import { computeDeterministicFactors, deterministicComposite, fetchYahooDaily } from "../services/stocksDiscoveryScore.js";

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
      const exit = rec.action === "BUY"
        ? `Thesis invalidated. **SELL the position** at market unless you have a high-conviction reason to override.`
        : `Position is moving against you. **Cover / re-evaluate the SHORT thesis** now.`;
      stopAlerts.push(
        `🛑 **${rec.ticker} hit stop.** Rec from ${dateStr}: ${rec.action} @ $${rec.entryPrice} with stop $${rec.stopPrice}. Current $${px.toFixed(2)} ${ccyMarker}. ${exit}`
      );
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
  return { alerts, hits: alerts.length, inRange: inRangeCount };
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

export function portfolioSummary(profile) {
  const fx = profile.fxUsdCad || 1.37;
  const agg = {};
  // Track native currency + last price per ticker (first position wins)
  const nativeCcy = {};
  const nativePrice = {};
  for (const p of profile.positions || []) {
    if (!nativeCcy[p.ticker]) {
      nativeCcy[p.ticker] = p.ccy;
      nativePrice[p.ticker] = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    }
    const val =
      p.ccy === "USD"
        ? (p.priceCad ?? (p.priceUsd ? p.priceUsd * fx : 0)) * (p.qty || 0)
        : (p.priceCad || 0) * (p.qty || 0);
    if (!agg[p.ticker]) agg[p.ticker] = { ticker: p.ticker, qty: 0, cad: 0 };
    agg[p.ticker].qty += p.qty || 0;
    agg[p.ticker].cad += val;
  }
  const sorted = Object.values(agg).sort((a, b) => b.cad - a.cad);
  const total = sorted.reduce((s, a) => s + a.cad, 0);

  // Cash totals
  let cashUsd = 0, cashCad = 0;
  const perAccountCash = [];
  for (const a of profile.accounts || []) {
    cashUsd += a.cashUsd || 0;
    cashCad += a.cashCad || 0;
    if ((a.cashUsd || 0) > 0 || (a.cashCad || 0) > 0) {
      perAccountCash.push(`  ${a.name}: $${(a.cashCad || 0).toFixed(0)} CAD, $${(a.cashUsd || 0).toFixed(0)} USD`);
    }
  }
  const cashCadEquiv = cashCad + cashUsd * fx;

  return {
    total,
    table: sorted
      .map((a) => {
        const ccy = nativeCcy[a.ticker] || "USD";
        const px = nativePrice[a.ticker];
        const pxStr = px ? `@ $${px.toFixed(2)} ${ccy}` : "";
        return `${a.ticker} (${ccy}): ${a.qty.toLocaleString()} sh ${pxStr} ≈ $${Math.round(a.cad).toLocaleString()} CAD (${total > 0 ? ((a.cad / total) * 100).toFixed(1) : "0"}%)`;
      })
      .join("\n"),
    cashUsd, cashCad, cashCadEquiv, perAccountCash,
  };
}

// Signals checklist — what the AI MUST web_search for and incorporate
const SIGNALS_CHECKLIST = `
Mandatory signals to search and weigh for EACH top-holding before writing recs.
Use web_search calls — don't guess. If a signal isn't found, say "no signal" rather than skipping.

A. NEWS (last 24h):
   - Breaking corporate news, M&A, regulatory action, lawsuits
   - Material announcements (product launches, partnerships)
   - CEO/leadership changes

B. PERIODIC REPORTING:
   - Next earnings date (within 14 days = high-attention; flag in briefing)
   - Most recent earnings: revenue/EPS vs consensus (beat/miss/in-line)
   - Guidance changes (raised/lowered/maintained)
   - Conference call commentary highlights

C. CORPORATE ACTIONS:
   - Ex-dividend dates upcoming (within 14 days)
   - Dividend changes (raises/cuts/suspensions)
   - Splits, special distributions, buybacks
   - Spin-offs / mergers / tender offers (DJT/Truth Social spin-off is live)

D. ANALYST ACTION:
   - Upgrades / downgrades in last 7 days from top-tier shops (Goldman, JPM, MS, Wells, BofA, Wedbush, Piper Sandler)
   - Price target changes >10% in either direction
   - Initiation of coverage

E. INSIDER + OWNERSHIP:
   - Form 4 filings (insider buys/sells) in last 30 days — flag clusters
   - 13F changes (institutional ownership swings, e.g., Berkshire/Buffett, Burry)
   - Short interest changes (>20% of float = signal; rising short = pressure)

F. TECHNICAL / FLOW (web_search for these — sources include Finviz, StockAnalysis, TradingView):
   - 50-day and 200-day moving averages (price vs MA, golden/death crosses recently)
   - RSI: <30 (oversold) or >70 (overbought)
   - Unusual options flow (large call/put sweeps)
   - Volume spikes vs 20-day average

G. MACRO:
   - Fed/BoC rate decisions or commentary today
   - Oil price moves (matters for ENB, SU, CNQ)
   - USD/CAD daily move (matters for any USD-denominated holding)
   - VIX level (>20 = elevated; >25 = risk-off mode)

For each top-7 holding, the briefing must NAME at least one specific signal from the categories above that informs the call (BUY/HOLD/TRIM/SELL). Don't write generic prose — cite the actual signal.
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
- Default to LIMIT orders, not market — protects vs overnight gaps at the open.
- BUY limit = upper end of entry zone (or current ask + ~0.3% liquid / ~1% thin), never above the target.
- SELL limit = lower end of exit zone (or current bid − small buffer), never below the stop.
- After every BUY fill, recommend a GTC STOP-LIMIT SELL to enter at the rec's stop level (stop = stop price, limit = stop − 1-2% as gap protection).
- Note duration: "Day" cancels EOD; "GTC" persists.

REC HEADER FORMAT — every Action line must start with: "Action: <VERB> <N> sh <TICKER>". The token after the verb MUST be a real ticker symbol (DJT, ENB, NVDA, etc.). NEVER write "Action: SELL ENTIRE", "Action: HOLD CURRENT", "Action: HOLD BOTH", "Action: SELL ALL", "Action: HOLD BUT raise stop", or any English word in the ticker slot. If you mean "sell the entire position" write "Action: SELL 1267 sh DJT" with the actual share count.

QUANTITY MUST MATCH THE HOLDINGS TABLE. If the user holds 1267 sh of DJT in RRSP and you want to exit fully, write "SELL 1267 sh DJT". Do not pick a partial number like 900 unless you explicitly intend a partial trim AND state that clearly. Within ONE briefing, all references to a position's size must use the same number — don't say "1,267-share RRSP position" in the narrative and then "Sell 900 shares" in the order ticket.

FIELD FORMATTING — every named field (Entry, Target, Stop, Horizon, Account, Order ticket, After fill, Cost note, Rationale, Uses) must END WITH A PERIOD on its own logical line. Do not chain fields with commas or semicolons. Parenthetical notes are allowed inside a field's value (e.g. "Stop: $69 CAD (2.5×ATR pullback)."), but the field ends at the closing paren + period. Bad: "Stop: $69 CAD (2.5×ATR, GTC). Horizon..." — the comma inside parens confuses parsers. Good: "Stop: $69 CAD (2.5×ATR). Horizon: 12 months. Order ticket: GTC STOP-LIMIT...".

Required addition per rec body (EVERY BUY/SELL/TRIM rec, no exceptions):
  Order ticket: LIMIT BUY/SELL <N> <TICKER> @ $<limit> <CCY> <max/min>, Day/GTC.
  Order timing: pre-market | at-open | post-10am | gtc.
  After fill: GTC STOP-LIMIT SELL <N> <TICKER>, stop $<stop> / limit $<stop-1%> <CCY>.
  Account: <Non-Spousal | RRSP | TFSA | RESP | FHSA> · uses $<X> of $<Y> pro-forma <CCY> · leaves $<Z>.

Order timing guidance (default to "post-10am" unless the setup calls for something else):
  pre-market  → Only when the thesis is a gap-and-go / earnings-morning move and a missed open kills the setup.
  at-open     → Only when opening-auction volatility IS the setup (climax reversal, earnings-day gap fill).
  post-10am   → The default. Waits for 9:30-9:45 spreads to tighten. Reduces slippage on swing entries.
  gtc         → Use for pullback / mean-reversion setups where the level may not trigger today. Order works until filled or cancelled.
Cite the choice in the rec's narrative rationale ONE short sentence (e.g. "Timing: post-10am — spreads at open are 3× normal on this small-cap; letting the auction clear protects the entry price.").

The "Account:" line is MANDATORY. If you omit it the rec is invalid. The account named MUST have enough PRO-FORMA cash in the trade's currency to cover the size you proposed — see the CASH PRO-FORMA rule below for how to compute pro-forma. Verify against the per-account cash inventory + your own SELL recs for the same account/currency before writing the rec.

CASH PRO-FORMA (mandatory — apply this before sizing any BUY rec):
- Treat every SELL / TRIM you're recommending as if it EXECUTES and releases proceeds to the account it's coming from, in the trade's currency (US-listed → USD bucket, TSX → CAD bucket).
- For each (account, currency) pair, compute a running pro-forma balance in this order:
    1. Start with the current balance from the per-account cash inventory below.
    2. Add: sum of gross proceeds from your recommended SELL/TRIM recs in that (account, currency).
    3. Subtract: sum of gross cost from your recommended BUY recs already sized in that (account, currency).
- Every BUY rec's "Account:" line must reference PRO-FORMA cash — the "uses $X of $Y pro-forma <CCY>" figure is that running balance right BEFORE this BUY is sized, and "leaves $Z" is the balance right AFTER.
- In the BUY's Rationale (or a dedicated "Cash source:" line), explicitly cite what makes the cash available: "Cash source: $8,200 CAD current + $3,500 CAD from ENB SELL rec above". If a BUY relies entirely on current cash (no SELL prerequisite), say so: "Cash source: existing $Y CAD balance."
- If the pro-forma balance would go negative after all recommended trades in ANY (account, currency), DOWNSIZE BUYs (or add a further TRIM) so nothing lands short. Never propose a BUY that exceeds pro-forma cash — the account will refuse to settle it.
- SELL proceeds fund BUYs ONLY WITHIN THE SAME ACCOUNT + CURRENCY. A SELL in RRSP-CAD does not fund a BUY in Non-Spousal-USD. If the user needs cross-account cash movement, propose an explicit WITHDRAW→DEPOSIT transfer rec (both legs recorded).
- Order the recs in the narrative so that same-account SELLs appear BEFORE the BUYs whose pro-forma cash they enable — a reader scanning the briefing should see the source of funds before the destination.

MANDATORY MACHINE-READABLE REC BLOCK — at the very end of your briefing, emit an exact block for automated parsing. Format:

<RECS>
[
  {"action":"BUY","ticker":"NVDA","entry":145.20,"target":160.00,"stop":138.50,"horizonDays":14,"currency":"USD","shares":100,"orderTiming":"post-10am"},
  {"action":"SELL","ticker":"ENB","entry":75.80,"target":72.00,"stop":78.00,"horizonDays":30,"currency":"CAD","shares":500,"orderTiming":"gtc"}
]
</RECS>

Rules for the block:
- Include one JSON object per actionable BUY / SELL / TRIM rec that appears in the narrative above. HOLD entries may be omitted.
- ticker is the exact exchange symbol (never a brand name).
- entry is the recommended entry price you cited in the narrative, in the security's native currency.
- target and stop are REQUIRED numbers for every BUY (not null). Use the same values you cited in the narrative.
- currency is "USD" or "CAD" — must match the security's native listing.
- horizonDays is an integer (days). Convert weeks→×7, months→×30.
- orderTiming is REQUIRED. One of:
    "pre-market"  — queue for the 9:30 opening auction; ONLY when the thesis is a gap-and-go / earnings-morning move where a missed open kills the setup
    "at-open"     — first 15 min of trading; use RARELY, only when opening volatility itself is the setup (volume climax, earnings-day gap fill, etc.)
    "post-10am"   — wait until ~10:00-10:30 ET so opening-auction spreads tighten first; THIS IS THE DEFAULT for most swing entries
    "gtc"         — no timing urgency; leave the LIMIT order working until filled or cancelled; use for pullback-entry setups where the level might not hit today
  When in doubt, choose "post-10am". Cite the timing choice in the narrative rationale (one short sentence) so the user understands WHY.
- Do not wrap the block in code fences. No prose inside <RECS>...</RECS>. Nothing else after </RECS>.
- If there are ZERO actionable recs, emit "<RECS>[]</RECS>" — never omit the block.
`;

const PRICE_CURRENCY_RULES = `
PRICE CURRENCY CONVENTION (strict):
- Every position has a native trading currency shown in the Holdings list (e.g., "TSLA (USD)", "ENB (CAD)").
- Always state prices in the security's NATIVE currency. Never convert US-listed prices to CAD for price discussion.
  ✓ "TSLA at $442 USD" · ✗ "TSLA at $607 CAD"
  ✓ "ENB at $75.58 CAD" · ✗ "ENB at $55.10 USD"
- Entry/Target/Stop in trade recs MUST be in the security's native currency.
- CAD/USD conversions in parentheses are OK only for portfolio totals or cash-sizing math, not for stock prices.

CANONICAL TICKER RULE (read carefully):
- ALWAYS use the actual exchange ticker, never the brand-name acronym. Common errors:
  • Royal Bank = "RY" (NYSE) or "RY.TO" (TSX) — NEVER "RBC" (RBC is RBC Bearings, an unrelated US company).
  • TD Bank = "TD" (NYSE, ~$80 USD) or "TD.TO" (TSX, ~$154 CAD).
  • Scotia = "BNS"/"BNS.TO". CIBC = "CM"/"CM.TO". National = "NA"/"NA.TO".
  • Block (formerly Square) = "XYZ", not "SQ". Meta = "META", not "FB".
- When in doubt, web_search "<company name> stock ticker" before recommending.

PRICE INTEGRITY (mandatory — accuracy over completeness):
- HELD-POSITION TICKERS ARE PRE-VERIFIED. Any ticker in the user's current holdings table is REAL, TRADABLE, and ALREADY VALIDATED by the backend before this prompt was built. NEVER produce a "Ticker Not Found", "UNABLE TO VERIFY", or similar cautionary card for a ticker the user already owns. Household names like PLTR, NVDA, TSLA, SOUN, RUM, DJT, ENB are all real. If web_search fails on a held ticker, use the holdings-table price as authoritative and move on.
- For ANY ticker NOT in the user's current holdings table, web_search "<TICKER> stock price" and use ONLY the retrieved live quote. NEVER quote a price from memory — training data is stale, you will be wrong by 30-200%.
- Verify ticker is currently tradable before recommending a NEW name. Beware renamed/delisted symbols: SQ (Square) was renamed XYZ in early 2025; FB → META; TWTR → delisted. Any sub-mega-cap ticker from training — verify first.
- If web_search can't confirm a live quote for a NEW ticker, do NOT recommend it. Pick a different name. Do NOT emit a card about the failure — silently move on.
- State retrieved prices with "(verified)" inline. Example: "ROKU at $128 USD (verified)" — not "$67.50".
- Known prior failures the user has caught: SQ at $79 (deprecated), ROKU at $67 (stale ~50%), META at $525 (stale, actual ~$608). Don't repeat.
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
1. Read the MACRO REGIME block FIRST and frame the briefing through that lens (risk-on vs risk-off, rising vs falling rates, USD/CAD direction).
2. Use ATR-based stops from the technicals block, not flat percentages.
3. Reference per-position cost basis from the LIFECYCLE block when proposing sells (acknowledge tax impact / loss realization).
4. Surface TAX-LOSS HARVEST candidates when present — these are free money in non-registered accounts.
5. Cite SPECIFIC numbers (RSI 32, P/E 87, ATR $14, 2.5×ATR stop = $407) not vague descriptors.
5b. FIB RETRACEMENT: technicals block shows Fibonacci levels from the last 6mo swing. Anchor entry/exit targets to REAL Fib levels — "add on pullback to 61.8% Fib at $X". If ticker is IN THE GOLDEN POCKET (61.8-65% retrace) and other signals confirm, high-conviction reversal — say so. Never invent Fib levels.
5c. VOLUME (swing edge): RVOL >2 = unusual attention; DRY-UP = pre-breakout compression; CLIMAX BAR up = blow-off or breakout; CLIMAX BAR down = capitulation; POCKET PIVOT = O'Neil early-buy; OBV accumulation/distribution = smart money direction. Cite specifically — "RVOL 2.4x + pocket pivot + OBV accumulation → institutional accumulation" not "volume looks good."
5d. NAMED SETUPS: if a "Setup [...]" block appears under a ticker, USE THE EVIDENCE BULLETS. They carry exact trigger price + pattern mechanics + framework name (Minervini VCP, O'Neil pocket pivot, bull flag). Cite name + score + trigger verbatim. Never fabricate a pattern that isn't in the block.
5e. MTF CONFLUENCE: "🟢🟢🟢 ALIGNED UP" = highest-conviction; "🔴🔴🔴 ALIGNED DOWN" = same conviction bearish; "🟡 CONFLICTING" = downgrade sizing; "⚪ mixed" = neutral. Cite and adjust sizing.
5f. CATALYSTS: earnings 🔥 (≤3d) = do NOT enter new positions; ⚡ (≤7d) = tighten stops. Recent Goldman/JPM/MS/Barclays upgrades — cite firm + date + PT. Fresh downgrade within 3d = warning.
5g. SHORT SQUEEZE: "🎯 SQUEEZE SETUP score ≥60" + confirming trend + RVOL = tactical long. "⚠ high-SI" without squeeze flag = gap-down risk. Cite score + SI% + DTC.
5h. TRAILING STOP: technicals shows "Trailing stop N% from 60d high $X → $Y · Z% slack · limit offset $O". Cite ALL THREE numbers verbatim in section 2: "Trail stop: N% ($Y trigger, $O limit offset — enter both in broker) · Z% slack". Slack ≤3% → "⚠ approaching trail stop." STOP HIT → SELL at market.
5i. OPTIONS FLOW: P/C OI >1.3 = bearish crowd; <0.7 = bullish. IV rank ≥80 (🔥 rich) = SELL premium (covered calls); ≤20 (💤 cheap) = BUY premium (protective puts). Cite when discussing hedging.
5j. FED LIQUIDITY REGIME: 🔴 RISK-OFF OVERRULES individual signals — trim size, tighten stops, no new spec. 🟢 RISK-ON = full size, take breakouts. Cite regime + top contributor when calling full size.
5k. CONGRESSIONAL TRADES: multiple purchases = potential positive catalyst (committee-derived info); multiple sales = warning. Cite filer + date when strong.
5l. TICKERS NOT FOUND: never emit "Ticker Not Found" / "UNABLE TO VERIFY" cards for held positions. Ownership IS verification. If web_search fails, use the holdings-table price.
5m. CALIBRATION: when a CALIBRATION block appears, it summarizes THIS user's closed-pick outcomes bucketed by score band × setup × MTF. Weight recommendations toward the combinations with the highest win rate + avg P/L. A proposed rec that lands in a bucket with sub-baseline win rate should be downgraded or replaced. Cite the specific bucket + n + win rate when making a full-size call (e.g. "this VCP × 70-79 score bucket is 5-of-7 winners at +8.4% for you — full size"). Buckets missing from the block are undertested (n<5), not proven — treat as unknown.
5n. BENCHMARK ALPHA: when a PORTFOLIO vs BENCHMARK block appears, it compares this user's TWRR to SPY (US sleeve) and XIC (Canadian sleeve) over the same window. Positive alpha = beating the passive alternative; negative alpha over YTD or since-start is the honest signal to trade less and lean on CORE broad ETFs. Cite the specific alpha figure when defending an active swing rec ("YTD alpha +4.1pp vs SPY, so this active trade is earning its keep"). If alpha is deeply negative, propose SPY/XIC/XEQT rotation in section 4 instead of another swing.
5o. CORRELATION-ADJUSTED SIZING: when a CORRELATION-ADJUSTED SIZING block lists a candidate ticker with a "SIZE X%" tag, respect it. Multiply the recommended share count (and cash allocation) by that fraction so total factor exposure doesn't compound with an already-large correlated holding. Cite the pairing verbatim: "half-size (SIZE 50%) — 0.78 correlated with your ENB position at 22% of book, so full size would double your energy-rates factor exposure." Rows without a size tag are safely independent.
5p. OPTIONS OVERLAY (covered calls — narrow subset only): when an OPTIONS OVERLAY block lists suggestions, emit a section-6a "Options overlay" heading with the top 1-2 suggestions verbatim (strike, expiration, mid premium, monthly yield %). The block is pre-filtered to the trader's agreed narrow subset — covered calls only, on Canadian large-cap (SWING-sleeve) holdings inside a Non-Spousal account (TFSA / RRSP / RESP / FHSA are deliberately excluded for CRA / broker-restriction reasons). Never propose overlays outside this subset even if you think you see one; the pipeline handles filtering. Rec format: "SELL to open <N> <TICKER> <exp> $<K> CALL @ limit $<mid>" plus a one-line justification citing IV rank + delta approx + upside cap. If the underlying has an earnings date inside the expiration window (visible in the CATALYSTS line), SKIP the overlay — IV crush post-earnings is the specific case where "sell rich premium" reverses. Overlay recs also belong in the <RECS> block with action="SELL", orderTiming="gtc", and a currency matching the underlying; ticker should carry the underlying symbol (the option-specific fields go in the narrative). If the OPTIONS OVERLAY block is EMPTY (either the user hasn't enabled options trading, or nothing meets the narrow subset today), SKIP section 6a entirely — do NOT invent covered-call ideas outside the block.
5q. DISCIPLINE COMPLIANCE: when a DISCIPLINE COMPLIANCE block appears, it summarizes THIS user's rule-following over the last 90 days. Emit a "## ⚖ Discipline check" section (numbered 0e in the layout) only when the block shows any 🚨 or ⚠ item, or when it's the weekly heartbeat (Monday). Cite specific numbers matter-of-factly ("acted on 4 of 12 setups this month"). If any hard-stop violation is STILL HELD past the exit window, elevate it into section 0c (Position P&L stop check) with an EXIT AT MARKET instruction and reference the compliance metric. Do not moralize or lecture — one line, then move on.
5r. RETURN ATTRIBUTION: when a RETURN ATTRIBUTION block appears, it's the Monday retrospective showing where actual $ P&L has come from. Use it to defend or cut specific bucket types. "This setup has printed +$3,400 CAD YTD in your book, so full size on the pattern" or "This bucket has bled -$1,200 CAD; downgrading to half-size or skipping." Compare AI-sourced vs manual $ totals honestly — the operator is often the source of the edge; the AI is a check. Attribution belongs in an optional "## 💰 Attribution snapshot" section, ONE paragraph max, cited from the block verbatim.
5t. HORIZON REVIEW: when a HORIZON REVIEW block appears, emit a "## 📅 Horizon review" section (numbered 0f in the layout, before section 1). The review shows every open BUY rec's status vs its stated window. Rules:
   - ⌛ EXPIRED — one-line recommendation per row: EXIT, ROLL (state the specific new-evidence reason, no defaults), or TRIM. NEVER say "hold" without justification — doing nothing on an expired rec is a passive ROLL, and passive ROLL is what the horizon window was designed to prevent. "Hold because I like it" is not a reason; "Hold because MSFT reported an earnings beat yesterday and analyst PTs revised +5%" is.
   - 🔴 WELL-BEHIND — one-line assessment: has the thesis broken (exit signal), or is time still on our side (patience)? Cite distance-to-target vs distance-to-stop.
   - 🟡 LAGGING — one-line noted-no-action; still within window, within stop.
   - 🟢 ON-PACE / ✅ HIT-TARGET — one-line acknowledgement; ✅ triggers auto-sell-trail elsewhere so just mention it.
   - Cite numbers verbatim from the block (day X/Y, entry, current, target, delta, required-daily). Do NOT paraphrase or round.
   - If ALL open recs are 🟢/🟡 with no ⌛/🔴, output a single line: "All open positions on-pace within their horizons — no exits or rolls needed today." Skip the section otherwise.
5s. SUB-CURRENCY BUCKETS (mandatory — accounts hold CAD and USD cash SEPARATELY, not as a single pool): the per-account cash inventory shows BOTH cashCad and cashUsd for every account. A trade in the security's native currency MUST settle out of the SAME-CURRENCY bucket. A TSX-listed CAD stock (e.g. ENB.TO, RY.TO, XIC) can only be bought from that account's cashCad bucket — even if the account has plentiful cashUsd, that USD cash is INELIGIBLE without an explicit FX conversion. Same in reverse: a US-listed USD stock (NVDA, AAPL) can only be bought from cashUsd. NEVER propose a BUY whose currency doesn't match the settle bucket you're drawing from. If the tax-optimal account has cash in the wrong currency, options: (a) pick a different currency-matched name in that account, (b) use a different account that has the right currency, (c) propose an explicit FX conversion first (WITHDRAW from wrong-currency bucket + DEPOSIT to right-currency bucket, both legs recorded), noting the FX friction cost. The pro-forma cash computation from rule 5 also runs PER (account, currency), never pooled across currencies.
6. **DO NOT RESTATE P/L PERCENTAGES OR DOLLAR GAINS/LOSSES IN PROSE.** Holdings table already shows actual P/L. If you write "BBAI down -7.7%" and the app shows BBAI +333%, you mislead. Refer to lifecycle cost-basis for tax reasoning; do NOT narrate "down X%" unless it matches Holdings EXACTLY.
${PRICE_CURRENCY_RULES}
${ORDER_TICKET_RULES}
${MULTI_DAY_EXECUTION_RULES}
${CANADIAN_TAX_BLOCK}
${SIGNALS_CHECKLIST}
${OUTPUT_FORMAT_RULES}

Use the web_search tool aggressively — at least 6-10 searches across signal categories above for the top holdings.

Write a markdown briefing with these sections (details for section-specific rules and required blocks are provided in the per-call context that follows this system prompt):
0. **🚨 Open recommendation alerts** — surface verbatim if ALERTS block non-empty; else "No targets or stops hit overnight."
0b. **✅ Trades you executed since last briefing** — REQUIRED when the executed-trades block is non-empty. One line per BUY/SELL leg per per-call section rules.
0c. **🚨 Position P&L stop check** — REQUIRED when position-stop block non-empty. Hard-stop (≤-8%) = EXIT AT MARKET. Within-stop (-8% to -6%) = TIGHTEN. Watch (-6% to -5%) = keep on radar.
0d. **⚖ Sleeve balance** — REQUIRED when sleeve block shows 🚨 or ⚠. SPEC OVER LIMIT → no new spec in sections 4/7/8.
1. **Overnight & pre-market** — futures, VIX, USD/CAD, oil, Fed/BoC.
2. **Signals per holding** — 2-3 lines per top-7 ticker: news + earnings + analyst + insider + technicals + call.
3. **Performance snapshot** — week/month/3M moves on top names.
4. **Today's one action** — single highest-conviction trade, full 4 levels + account.
5. **💵 Cash deployment** — per-call rules below.
6. **Watch list** — 2-3 price triggers.
7. **Aggressive new ideas (SPEC sleeve)** — ONLY from DISCOVERY POOL spec candidates; skip if SPEC over cap.
8. **🎯 Today's Swing-Trade Picks (SWING sleeve)** — primary source Test A picks, secondary Discovery swing candidates.

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
  const out = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      const ccy = tickerInfo[ticker].ccy;
      // Pass currency so a CAD holding resolves to its TSX listing (ENB →
      // ENB.TO) — without it the technicals/last-price come from the US ADR
      // and the briefing reasons on the wrong market/currency.
      const [tech, fund, catalysts, options] = await Promise.all([
        getTechnicals(ticker, ccy).catch(() => ({ ok: false })),
        getFundamentals(ticker, ccy).catch(() => ({ ok: false })),
        getCatalysts(ticker, ccy).catch(() => null),
        getOptionsMetrics(ticker).catch(() => null),
      ]);
      // Short interest reads bimonthly FINRA data (cheap Yahoo call, 24h
      // cache) and takes optional tech context to compute the squeeze
      // score — so it goes AFTER tech resolves.
      const shortInterest = await getShortInterest(ticker, ccy, tech).catch(() => null);
      out[ticker] = { tech, fund, catalysts, shortInterest, options, ccy };
    })
  );
  return out;
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

function formatDailyPicksBlock(dailyPicks) {
  if (!Array.isArray(dailyPicks) || dailyPicks.length === 0) return "";
  const lines = dailyPicks.map((p, i) => {
    const sleeveTag = classifyPosition({ ticker: p.ticker });
    return `Pick ${i + 1} [sleeve=${sleeveTag}]: ${p.ticker} @ $${p.entryPrice.toFixed(2)} · target $${p.targetPrice.toFixed(2)} · stop $${p.stopPrice.toFixed(2)} · score ${p.deterministicScore}${p.setupName ? ` · setup: ${p.setupName}` : ""}${p.mtfConfluence ? ` · MTF ${p.mtfConfluence}` : ""}\n    · ${p.rationale}`;
  });
  return `\nTODAY'S ${dailyPicks.length} SWING-TRADE PICKS (deterministic composite, sleeve-tagged — must appear in briefing under a "## 🎯 Today's Swing-Trade Picks" section, one narrative paragraph per pick, and MUST appear in the trailing <RECS> block):
${lines.join("\n")}
`;
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

function buildBriefingPrompt(profile, summary, monitorAlerts = [], quantSignals = null, macro = null, lifecycle = null, factors = null, lessons = null, transcripts = null, watchListBlock = "", dailyPicks = [], recentTrades = [], sectorRotation = null, correlations = null, fedLiquidity = null, congressional = null, discoveryPool = [], calibration = null, benchmarkBundle = null, sizingAdjustments = [], overlaySuggestions = [], compliance = null, isMondayEt = false, attribution = null, horizonRows = []) {
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
  const cashBlock = hasCash
    ? `\nAvailable cash:
  $${summary.cashCad.toFixed(2)} CAD
  $${summary.cashUsd.toFixed(2)} USD
  Total ≈ $${Math.round(summary.cashCadEquiv).toLocaleString()} CAD
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
${alertsBlock}
${formatLessonsBlock(lessons)}
${formatMacroBlock(macro)}
${formatFactorBlock(factors)}
${formatLifecycleBlock(lifecycle)}
${formatQuantSignalsBlock(quantSignals)}
${formatRecentTradesBlock(recentTrades)}
${formatDailyPicksBlock(dailyPicks)}
${formatDiscoveryPoolBlock(discoveryPool)}
${formatSectorRotationBlock(sectorRotation)}
${formatCorrelationBlock(correlations)}
${formatFedLiquidityBlock(fedLiquidity)}
${formatCongressionalBlock(congressional)}
${formatPositionStopBlock(monitorPositionStops(profile.positions || []))}
${formatSleeveBalanceBlock(computeSleeveBalance(profile.positions || [], profile.fxUsdCad || 1.37, profile.sleeveTargets))}
${formatCalibrationBlock(calibration)}
${formatBenchmarkBlock(benchmarkBundle?.userTwrr, benchmarkBundle?.benchmarks)}
${formatSizingAdjustmentBlock(sizingAdjustments)}
${formatOverlayBlock(overlaySuggestions)}
${formatComplianceBlock(compliance, { weeklyHeartbeat: isMondayEt })}
${formatAttributionBlock(attribution)}
${formatHorizonReviewBlock(horizonRows)}
${formatTranscriptsBlock(transcripts)}
${tradingCostsBlock}

Section-specific per-call rules (system prompt has the general shape 0–8; the rules below tune it to THIS briefing's blocks):
0. **🚨 Open recommendation alerts** — surface verbatim the ALERTS block above if non-empty. Otherwise write "No targets or stops hit overnight."
0b. **✅ Trades you executed since last briefing** — REQUIRED when the "TRADES YOU EXECUTED SINCE LAST BRIEFING" block above is non-empty. Heading must be exactly "## ✅ Trades you executed". Write ONE line per BUY/SELL leg from the block, in this format:
   • For a BUY fulfilling an AI rec: "**BOUGHT** N sh TICKER @ $entry_actual CCY on YYYY-MM-DD — this fulfills the [target-hit/AI rec/high-conviction] BUY. Current price $X (Y% vs entry). Target $target, stop $stop. Position on track [OR: past halfway to target, tighten trailing stop / or: pulled back to entry, still valid]."
   • For a BUY without a linked rec: "**BOUGHT** N sh TICKER @ $entry_actual — no linked AI rec; treat as a fresh position. Current $X. Consider a stop at 2.5×ATR below entry."
   • For a SELL: "**SOLD** N sh TICKER @ $exit_price — [closed the (BUY-rec-date) position / partial trim / rebalance]. Realized ~$Y or ~Z% vs original basis."
   Skip this section entirely if the block is empty (write nothing, do not include a "no trades" placeholder).
   **NO-REPEAT INVARIANT**: any BUY leg in the executed-trades block turns that ticker into a MANAGE-EXISTING-POSITION line item in section 2 for the rest of this briefing. Sections 4 (Today's one action), 7 (Aggressive new ideas), and 8 (Today's Swing-Trade Picks) MUST NOT propose a fresh BUY on that ticker — the user already owns it. If you would have picked the same name again, upgrade the section-2 line for it to an "ADD to position at $X, target $Y" instruction instead. Every ticker in the current portfolio's positions list is subject to the same rule.
0d. **⚖ Sleeve balance** — REQUIRED any day the "SLEEVE BALANCE" block above shows a 🚨 or ⚠ flag. Heading must be exactly "## ⚖ Sleeve balance". Rules the whole briefing must obey:
   • **SPEC OVER LIMIT** (🚨 flag present) → sections 4/7/8 MUST NOT propose any high-vol / meme / unknown US name as a new BUY. Only Canadian large-caps and broad ETFs are eligible. If the deterministic engine's Swing Pick is a spec-classified ticker, replace it with "SPEC sleeve full — no new spec entries today. Trim [largest spec name] first." Trim recommendation counts as an action; propose it in section 4.
   • **SWING UNDERWEIGHT** (💡 sleeve has room note) → prefer Canadian large-caps in sections 4/7. Frame as "SWING sleeve has $X available for a fresh RY/ENB-template entry."
   • **CORE UNDERWEIGHT** (⚠ flag) → close section 4 with a "consider $X into XIC/VUN/XEQT to restore the anchor" note.
   Write ONE line per active flag with the specific $ amount and action. Skip section if all three sleeves within ±5pp of target.
0c. **🚨 Position P&L stop check** — REQUIRED when the "POSITION P&L STOP MONITOR" block above is non-empty. Heading exactly "## 🚨 Position P&L stop check". Write ONE line per position in the block, most severe first. **The ticker string you write MUST appear verbatim on one of the raw block's lines above; if you cannot find the ticker there, do not write the line — the section is a formatting pass over that block, not a place to invent positions.**
   • **HARD STOP TRIGGERED** (pnl ≤ -8%): "🚨 **EXIT AT MARKET**: <ticker-from-block> in <account> · basis $X, now $Y, pnl -N% · sell N sh unless a specific NEW-INFO reason overrides." Do NOT hedge on hard-stop calls.
   • **WITHIN 2% OF STOP** (-8% to -6%): "⚠ **TIGHTEN**: <ticker-from-block> in <account> · pnl -N% · move stop to break-even at $basis OR trim 50% of the position now."
   • **WATCH** (-6% to -5%): "👀 **WATCH**: <ticker-from-block> · pnl -N% · 3% from hard stop."
   CORE-exempt tickers (RY, ENB) may skip WATCH but STILL apply for hard-stop hits. Skip section if block empty.
1. **Overnight & pre-market** — ES/NQ futures, VIX, USD/CAD, oil, Fed/BoC actions
2. **Signals per holding** — for EACH top-7 ticker, 2-3 line block. Format: "**TICKER**: news=... · earnings=... · analyst=... · insider=... · technicals=... · call: [HOLD/TRIM/ADD/EXIT at $X]"
   **THEN** — after the top-7 blocks, add a "### Quiet holdings" subsection that emits ONE line for EVERY remaining held ticker from the current-holdings table that hasn't been named elsewhere in the briefing (not in top-7, not in stop check, not in trades-executed, not in horizon review). Format: "**TICKER** (N sh @ $basis, current $X, W% of book) — [HOLD / TRIM / EXIT / ADD $Y] · one-sentence reason (fundamental note, technical setup, or sleeve rationale)". Do not skip any held ticker — small weights and sleepy defensives (utilities ETFs, precious-metal juniors, cash-like bond funds) still deserve a one-line disposition so the trader knows the model saw them.

   **THESIS DISCIPLINE — MANDATORY, applies to sections 2, 4, and 8:**
   A recommendation to TRIM or EXIT a position that was itself opened on a Curriculate rec (SWING pick, high-conviction, or open advice rec — anything the "HORIZON REVIEW" block shows) is INVALID unless AT LEAST ONE of the following triggers fired:
   - Target hit ("HIT-TARGET" in horizon review).
   - Stop breached ("HIT-STOP" in horizon review).
   - Horizon expired ("EXPIRED" in horizon review).
   - Well-behind pace at ≥60% of horizon ("WELL-BEHIND" + horizon day ≥60% of stated window).
   - Material NEW information (earnings surprise, guidance cut/raise, downgrade to Sell, FDA rejection, executive resignation, deal breakup, regulatory action, macro regime flip from RISK-ON→RISK-OFF).
   None of "small profit locked in", "up 0.1% capture the gains", "de-risk into the weekend", "capture some now, let rest run" qualify. Recs come with a plan (entry/target/stop/horizon). Deviating from that plan requires a stated trigger; there is no default trigger. If none of the above triggers fired, the correct call is **HOLD** — even at +5% mid-horizon on a 20% target. Cite the horizon-review row and the day/horizon fraction when confirming HOLD ("day 1/10, on-pace, no thesis change → HOLD").
   TRIMs proposed WITHOUT a cited trigger are noise trading; they will be counted against the strategy in the compliance report as churn.
3. **Performance snapshot** — week/month/3M moves on top names
4. **Today's one action** — single highest-conviction trade, all four levels + specific account (per Canadian tax notes). Section 5 must NOT repeat this trade.
${cashSection}
6. **Watch list** — 2-3 levels to monitor today (specific price triggers)
7. **Aggressive new ideas (SPEC sleeve)** — 1-2 unowned names SOURCED EXCLUSIVELY from the DISCOVERY POOL block's "SPEC-sleeve candidates" list. Do NOT propose a name that isn't in the discovery pool. If SPEC OVER LIMIT (🚨), skip section. If pool has zero spec candidates, write "No pre-vetted SPEC candidates today — pass" and skip. For each pick: quote entry/target/stop verbatim, cite sleeve tag, suggest optimal account.
8. **🎯 Today's Swing-Trade Picks (SWING sleeve)** — REQUIRED (heading exactly "## 🎯 Today's Swing-Trade Picks"). PRIMARY: TODAY'S SWING-TRADE PICKS block (Test A). SECONDARY: SWING-sleeve candidates in DISCOVERY POOL (supplement when Test A produced fewer than 2 swing-classified picks). ONE narrative paragraph per pick, entry/target/stop verbatim, setup + score in plain English, 10-day horizon. Every pick MUST also appear in trailing <RECS> block with action="BUY". If both pools empty or all picks spec-classified and SPEC sleeve full, write "No SWING-sleeve picks today" and skip.

Use web_search aggressively — 6-10 searches for top holdings.`;

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
export async function saveAdviceSnapshot({ email, markdown, source }) {
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
    out.push({
      action,
      ticker,
      shares: Number.isFinite(+r.shares) ? Math.floor(+r.shares) : null,
      entryPrice,
      targetPrice: Number.isFinite(+r.target) ? +r.target
        : Number.isFinite(+r.targetPrice) ? +r.targetPrice : null,
      stopPrice: Number.isFinite(+r.stop) ? +r.stop
        : Number.isFinite(+r.stopPrice) ? +r.stopPrice : null,
      horizonDays: Number.isFinite(+r.horizonDays) ? +r.horizonDays : 30,
      entryCurrency: ["USD", "CAD"].includes(String(r.currency || r.entryCurrency || "").toUpperCase())
        ? String(r.currency || r.entryCurrency).toUpperCase()
        : "USD",
      orderTiming,
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
  const summary = portfolioSummary(profile);
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
  const [monitorRes, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock, dailyPicks, recentTrades, sectorRotation, correlations, fedLiquidity, congressional, discoveryPool, calibration] = await Promise.all([
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
      const tickers = (profile.positions || []).map((p) => String(p.ticker || "").toUpperCase()).filter(Boolean);
      const currencies = {};
      const weights = {};
      const fx = profile.fxUsdCad || 1.37;
      for (const p of profile.positions || []) {
        currencies[String(p.ticker || "").toUpperCase()] = p.ccy || "USD";
        const cad = (p.ccy === "USD" ? (p.priceUsd || 0) * fx : (p.priceCad || 0)) * (p.qty || 0);
        weights[String(p.ticker || "").toUpperCase()] = (weights[String(p.ticker || "").toUpperCase()] || 0) + cad;
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
  ]);
  const monitorAlerts = monitorRes?.alerts || [];
  // Horizon review — per-open-rec status against its stated window.
  // Runs in a separate step because it fetches prices per rec symbol
  // and benefits from the priceMap that monitorOpenRecs already
  // computed; we recompute here for isolation.
  const horizonRows = await computeHorizonReview(profile.email).catch((e) => {
    console.warn("[computeHorizonReview] warn:", e?.message);
    return [];
  });
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

  const { system: staticSystem, user: userPrompt } = buildBriefingPrompt(profile, summary, monitorAlerts, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock, dailyPicks, recentTrades, sectorRotation, correlations, fedLiquidity, congressional, discoveryPool, calibration, benchmarkBundle, sizingAdjustments, overlaySuggestions, compliance, isMondayEt, attribution, horizonRows);

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
  // sections don't truncate the way they did at 4096.
  let j = await callClaude([{ role: "user", content: userPrompt }], 8192);
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
  return md.trim();
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
      let md = await generateBriefing(p);
      if (includeMonthly) {
        const reports = await buildAllAccountReports(p).catch((e) => { console.warn("[monthly-report] warn:", e?.message); return []; });
        const block = formatAllReportsMarkdown(reports);
        if (block) md = `${block}\n\n---\n\n${md}`;
      }

      md = await validateAndCorrectBriefing(md, p);

      const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      await emailBriefing({ to: p.email, subject, md });
      // Persist as the in-app advice snapshot so the Advice tab reflects
      // the same content the user just got in email (no extra AI call).
      await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron" });

      // Persist actionable recs for the scorecard
      const recs = parseRecsFromBriefing(md);
      if (recs.length) {
        // Ensure every BUY ships with target + stop — auto-fill from ATR
        // if the AI omitted them so no rec goes un-monitorable.
        await enrichRecsWithExitDefaults(recs);
        await StocksAdviceRec.insertMany(
          recs.map((r) => ({
            email: p.email,
            generatedAt: new Date(),
            source: "ai",
            ...r,
            rationale: "Daily briefing — server-side cron",
          }))
        );
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
    if (!Array.isArray(p.briefingTimes) || !p.briefingTimes.includes(hhmm)) continue;
    const ymd = dateInTz(now, tz);
    const key = `${ymd}|${hhmm}`;
    if (p.lastBriefingSentKey === key) continue; // already sent this slot
    due.push({ portfolio: p, sendKey: key });
  }
  return due;
}

// Send the briefing for a single user, then stamp lastBriefingSentKey so
// the same slot doesn't fire again within the same minute window.
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
    try { md = await generateBriefing(p); }
    catch (e) { await recordFail("generateBriefing", e); throw e; }
    if (includeMonthly) {
      const reports = await buildAllAccountReports(p).catch((e) => { console.warn("[monthly-report] warn:", e?.message); return []; });
      const block = formatAllReportsMarkdown(reports);
      if (block) md = `${block}\n\n---\n\n${md}`;
    }
    // Same price-validation + correction pass the manual /send-briefing uses.
    // Never throws — returns the (corrected or as-is) markdown.
    md = await validateAndCorrectBriefing(md, p);

    const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    try { await emailBriefing({ to: p.email, subject, md }); }
    catch (e) { await recordFail("emailBriefing", e); throw e; }
    try { await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron" }); }
    catch (e) { await recordFail("saveAdviceSnapshot", e); throw e; }

    const recs = parseRecsFromBriefing(md);
    if (recs.length) {
      // Fill missing exit levels before persisting so every BUY is
      // monitorable and trail-eligible.
      try { await enrichRecsWithExitDefaults(recs); } catch { /* ignore */ }
      try {
        await StocksAdviceRec.insertMany(
          recs.map((r) => ({
            email: p.email,
            generatedAt: new Date(),
            source: "ai",
            ...r,
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

    console.log(`[stocks-briefing] ✓ ${p.email} @ ${sendKey} — ${recs.length} recs tracked`);
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

  console.log(`[stocks-outcome-tracker] checked ${cands.length}, updated ${updated}, conviction ${convictionUpdated}`);
  return { checked: cands.length, updated, convictionUpdated };
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
  let ok = 0, fail = 0;
  for (const doc of docs) {
    try { await writeDailySnapshot(doc); ok++; } catch (e) { fail++; console.warn("[stocks-portfolio-snapshot] fail:", doc.email, e?.message); }
  }
  console.log(`[stocks-portfolio-snapshot] wrote ${ok}, failed ${fail}`);
  return { ok, fail };
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
