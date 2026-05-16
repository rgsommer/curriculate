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
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import { getTechnicals, formatTechnicalsLine } from "../services/stocksTechnicals.js";
import { getFundamentals, formatFundamentalsLine } from "../services/stocksFundamentals.js";
import { getMacroContext, formatMacroBlock } from "../services/stocksMacroContext.js";
import { computeLifecycle, formatLifecycleBlock } from "../services/stocksLifecycle.js";
import { computeFactorTilts, formatFactorBlock } from "../services/stocksFactorAnalysis.js";
import { computeLessons, formatLessonsBlock } from "../services/stocksLessonsLearned.js";

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

  // De-dupe tickers and fetch one price per ticker
  const tickers = [...new Set(openRecs.map(r => r.ticker))];
  const priceMap = {};
  await Promise.all(tickers.map(async t => { priceMap[t] = await fetchCurrentPrice(t); }));

  const targetAlerts = [];
  const stopAlerts = [];
  const updates = [];
  let inRangeCount = 0;
  const now = new Date();

  for (const rec of openRecs) {
    const px = priceMap[rec.ticker];
    if (px == null) continue;

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
      const dir = rec.action === "BUY" ? "above target" : "below target";
      const exit = rec.action === "BUY" ? "Consider TRIMming to lock in gains." : "Consider re-entering the position.";
      targetAlerts.push(
        `🎯 **${rec.ticker} hit target.** Rec from ${dateStr}: ${rec.action} ${rec.shares || ""} sh @ $${rec.entryPrice} → target $${rec.targetPrice}. Current $${px.toFixed(2)} ${ccyMarker} (${dir}). ${exit}`
      );
    } else if (stopHit) {
      updates.push({ id: rec._id, set: { status: "stop-hit", hitAt: now, hitPrice: px, lastCheckedAt: now, lastCheckedPrice: px } });
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
  let h = md
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
  // links
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' style='color:#1d4ed8;text-decoration:none'>$1</a>");
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
      if (/^Cost note:/i.test(line)) {
        out.push(`<div style="margin-top:2px;font-size:11.5px;color:#6b7280"><b style="color:#374151">Cost:</b> ${line.replace(/^Cost note:\s*/i, "")}</div>`);
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
const CANADIAN_TAX_BLOCK = `
Account-placement & tax notes (Canadian investor):
- Eligible Canadian-corp dividends (ENB, BCE, TD, RY, BNS, T, CNQ, SU, etc.) receive the Canadian dividend tax credit when held in non-registered accounts. ENB's ~6% yield is materially more tax-efficient than the headline number suggests for the Non-Spousal account.
- US dividend stocks held in an RRSP are EXEMPT from US 15% withholding tax under the Canada–US tax treaty (Article XXI). In TFSA or Non-Spousal, the withholding applies (15%; recoverable as foreign tax credit only in Non-Spousal).
- Therefore: prefer US dividend payers (broad index ETFs, ENB cross-listing aside, dividend aristocrats) in RRSP. Prefer Canadian eligible dividend payers in Non-Spousal or TFSA.
- TFSA: tax-free capital gains — best home for high-conviction high-volatility growth bets (NVDA, PLTR, RKLB) where you expect big multiples.
- Non-Spousal: capital gains taxable at 50% inclusion rate; capital losses harvestable. Avoid US dividends here unless deliberate.
- Suggest the specific account (Non-Spousal / RRSP / TFSA) for any new BUY rec, especially Canadian-corp dividend payers vs US growth names.
`;

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
      const [tech, fund] = await Promise.all([
        getTechnicals(ticker).catch(() => ({ ok: false })),
        getFundamentals(ticker, ccy).catch(() => ({ ok: false })),
      ]);
      out[ticker] = { tech, fund, ccy };
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
  }
  return `\nQUANT SIGNALS PER HOLDING (pre-computed — use THESE numbers, don't guess):\n${lines.join("\n")}\n`;
}

function buildBriefingPrompt(profile, summary, monitorAlerts = [], quantSignals = null, macro = null, lifecycle = null, factors = null, lessons = null) {
  const today = new Date().toISOString().slice(0, 10);
  const commission = Number(profile.commissionPerTrade ?? 9.95);
  const fxSpread = Number(profile.fxSpreadPct ?? 1.5);
  const fx = Number(profile.fxUsdCad || 1.37);

  // Per-account cash inventory — same hard-to-miss treatment as the advice endpoint
  const accountCashTable = (profile.accounts || [])
    .map(a => `  ${a.name}: $${(a.cashCad || 0).toFixed(0)} CAD · $${(a.cashUsd || 0).toFixed(0)} USD`)
    .join("\n") || "  (no accounts configured)";

  const pending = (profile.plannedWithdrawals || [])
    .map(w => {
      const days = Math.max(0, Math.round((new Date(w.targetDate).getTime() - Date.now()) / 86400000));
      const accountName = w.account ? (profile.accounts.find(a => a.id === w.account)?.name || w.account) : null;
      return `  $${w.amount.toFixed(0)} ${w.currency} in ${days}d${accountName ? ` from ${accountName}` : ""}${w.notes ? ` · ${w.notes}` : ""}`;
    });
  const plannedWithdrawalsBlock = pending.length
    ? `\nPLANNED WITHDRAWALS (cash that MUST be available by target date):\n${pending.join("\n")}\nSubtract these from deployable cash. If short, recommend SPECIFIC TRIMS by date to raise the needed cash. Do not lock new BUYs past these dates.\n`
    : "";

  const multiDayBlock = `
MULTI-DAY EXECUTION (for any BUY > ~$1,500 CAD):
- Scale the entry over 3 layers: 40% at thesis-trigger, 30% at -1×ATR pullback, 30% at -2×ATR pullback.
- Each layer gets its own order ticket. Layers 2 & 3 are GTC.
- Cancel unfilled layers if ticker breaks the rec's Stop.
- For < $1,500 CAD, single-shot entry is fine.
`;

  const orderTicketBlock = `
ORDER-TICKET GUIDANCE (gap-protection — every BUY/SELL rec must include):
- Default to LIMIT orders, not market — protects vs overnight gaps at the open.
- BUY limit = upper end of entry zone (or current ask + ~0.3% liquid / ~1% thin), never above the target.
- SELL limit = lower end of exit zone (or current bid − small buffer), never below the stop.
- After every BUY fill, recommend a GTC STOP-LIMIT SELL to enter at the rec's stop level (stop = stop price, limit = stop − 1-2% as gap protection).
- Note duration: "Day" cancels EOD; "GTC" persists.

Required addition per rec body:
  Order ticket: LIMIT BUY/SELL <N> <TICKER> @ $<limit> <CCY> <max/min>, Day/GTC.
  After fill: GTC STOP-LIMIT SELL <N> <TICKER>, stop $<stop> / limit $<stop-1%> <CCY>.
`;

  const priceCurrencyBlock = `
PRICE CURRENCY CONVENTION (strict):
- Every position has a native trading currency shown in the Holdings list (e.g., "TSLA (USD)", "ENB (CAD)").
- Always state prices in the security's NATIVE currency. Never convert US-listed prices to CAD for price discussion.
  ✓ "TSLA at $442 USD" · ✗ "TSLA at $607 CAD"
  ✓ "ENB at $75.58 CAD" · ✗ "ENB at $55.10 USD"
- Entry/Target/Stop in trade recs MUST be in the security's native currency.
- CAD/USD conversions in parentheses are OK only for portfolio totals or cash-sizing math, not for stock prices.
`;

  const tradingCostsBlock = `
Trading-cost frictions (factor into every recommendation):
- Commission: $${commission.toFixed(2)} per trade. Each leg counts separately (Swap = $${(commission * 2).toFixed(2)}).
- FX spread on USD↔CAD: ~${fxSpread}% one-way; round-trip ${(fxSpread * 2).toFixed(1)}%.
- Minimum efficient trade: ~$${(commission * 100).toFixed(0)}.
- PREFER currency-matched trades.

Per-account cash inventory (CRITICAL):
${accountCashTable}
${plannedWithdrawalsBlock}

ACCOUNT-SOURCE RULE (mandatory):
- Every BUY rec names ONE source account (Non-Spousal / RRSP / TFSA).
- The trade size MUST fit within that account's cash balance in the trade's currency.
- NO cross-account transfers, NO splits across multiple accounts.
- If the tax-optimal account is short on cash, either: (a) downsize to fit, (b) use a different account and note the tax tradeoff, or (c) recommend depositing first.
- Every BUY rec includes a "Source: <account> · uses $X of $Y available" line and a "Cost note: commission ~$${commission.toFixed(2)}, FX: <impact>" line.
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

  // Section 5 changes based on whether cash is on hand
  const cashSection = hasCash
    ? `5. **💵 Cash deployment — your actual cash** — REQUIRED. He has $${summary.cashCad.toFixed(0)} CAD + $${summary.cashUsd.toFixed(0)} USD ready. Recommend specific BUYs sized to actually use that cash. Compute exact share counts from the cash budget at the Entry price you propose. Format each: "Action: BUY N sh TICKER. Entry: $X (current $Y). Target: $Z (timeframe). Stop: $W. Horizon: N months. Uses ~$A of $B available." Do not recommend buys that exceed available cash; do not propose fractional shares; tilt AWAY from current concentration (DJT/DJTWW/RUM)`
    : `5. **💵 Cash deployment** — He has $0 cash. Either (a) skip this section, or (b) recommend a specific TRIM that would FREE UP cash for a redeploy, with both legs spec'd in the rec format.`;

  return `You are Richard's personal stock advisor at SENIOR-ANALYST level. Generate today's morning briefing for ${profile.email}.

Today: ${today}
Risk tolerance: ${profile.riskTolerance}

SENIOR-ANALYST EXPECTATIONS:
1. Read the MACRO REGIME block FIRST and frame the briefing through that lens (risk-on vs risk-off, rising vs falling rates, USD/CAD direction).
2. Use ATR-based stops from the technicals block, not flat percentages.
3. Reference per-position cost basis from the LIFECYCLE block when proposing sells (acknowledge tax impact / loss realization).
4. Surface TAX-LOSS HARVEST candidates when present — these are free money in non-registered accounts.
5. Cite SPECIFIC numbers (RSI 32, P/E 87, ATR $14, 2.5×ATR stop = $407) not vague descriptors.
Total portfolio (CAD): ~$${Math.round(summary.total).toLocaleString()} ← FOR YOUR REFERENCE ONLY. DO NOT INCLUDE this aggregate dollar figure in the briefing output. Discuss percentages, % of book, and individual position values, but never echo the total portfolio dollar amount.

Holdings:
${summary.table}
${cashBlock}
${alertsBlock}
${formatLessonsBlock(lessons)}
${formatMacroBlock(macro)}
${formatFactorBlock(factors)}
${formatLifecycleBlock(lifecycle)}
${formatQuantSignalsBlock(quantSignals)}
${priceCurrencyBlock}
${orderTicketBlock}
${multiDayBlock}
${tradingCostsBlock}
${CANADIAN_TAX_BLOCK}
${SIGNALS_CHECKLIST}

Use the web_search tool aggressively — at least 6-10 searches across the signal categories above for the top holdings.

Write a markdown briefing with these sections:
0. **🚨 Open recommendation alerts** — surface verbatim the ALERTS block above if non-empty. Otherwise write "No targets or stops hit overnight."
1. **Overnight & pre-market** — ES/NQ futures, VIX, USD/CAD, oil, Fed/BoC actions
2. **Signals per holding** — for EACH top-7 ticker, a 2-3 line block citing specific signals you found via web_search (news + earnings + corporate actions + analyst moves + insider activity + technical setup + applicable macro). Format: "**TICKER**: news=... · earnings=... · analyst=... · insider=... · technicals=... · call: [HOLD/TRIM/ADD/EXIT at $X]"
3. **Performance snapshot** — week/month/3M moves on top names
4. **Today's one action** — single trade, all four levels (Entry/Target/Stop/Horizon), plus the specific account (Non-Spousal / RRSP / TFSA) per the Canadian tax notes above.
${cashSection}
6. **Watch list** — 2-3 levels to monitor today (specific price triggers)
7. **Aggressive new ideas** — 1-2 unowned names with price targets. For each, suggest the optimal account based on Canadian tax treatment (e.g., "US growth name → TFSA"; "Canadian dividend payer → Non-Spousal for the dividend tax credit").

Length: 700-1100 words. Date-stamp the top.

CRITICAL OUTPUT FORMAT RULES:
- START the briefing DIRECTLY with the markdown title heading (e.g. "# Daily Briefing — May 22, 2026"). Do NOT preamble with "I'll search the web for...", "Let me pull the latest news...", "Now let me write your briefing.", or any other chatty narration. The user is reading an email, not chatting.
- Do NOT include any sentence describing what you're about to do. Just do it.
- End with the disclaimer: "Research and education only. Not licensed investment advice."

Return ONLY the markdown briefing. No JSON, no wrapping prose. First character of your response must be a # symbol.`;
}

// Parse trade recommendations from the briefing text and save them for the
// /performance scorecard. Same regex as routes/stocksAdvice.js — kept here
// so this job stays self-contained.
export function parseRecsFromBriefing(text) {
  const recs = [];
  const re = /Action:\s*(BUY|SELL|TRIM|HOLD)\s*(\d[\d,]*)?\s*(?:sh)?\s*([A-Z][A-Z0-9.\-]{0,15})\b[^.]*?(?:Entry:\s*\$?([\d.]+))?[^.]*?(?:Target:\s*\$?([\d.]+))?[^.]*?(?:Stop:\s*\$?([\d.]+))?[^.]*?(?:Horizon:\s*([^.\n]+))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const [, action, sharesStr, tickerRaw, entry, target, stop, horizon] = m;
    const ticker = String(tickerRaw || "").toUpperCase().replace(/\.+$/, "");
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
      recs.push({
        action: action.toUpperCase(),
        ticker,
        shares: sharesStr ? parseInt(sharesStr.replace(/,/g, ""), 10) : null,
        entryPrice: parseFloat(entry),
        targetPrice: target ? parseFloat(target) : null,
        stopPrice: stop ? parseFloat(stop) : null,
        horizonDays,
      });
    }
  }
  return recs;
}

export async function generateBriefing(profile) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const summary = portfolioSummary(profile);
  // Run all upstream signals in parallel
  const [monitorRes, quantSignals, macro, lifecycle, factors, lessons] = await Promise.all([
    monitorOpenRecs(profile.email).catch((e) => { console.warn("[monitorOpenRecs] warn:", e?.message); return { alerts: [] }; }),
    computeQuantSignals(profile).catch((e) => { console.warn("[computeQuantSignals] warn:", e?.message); return {}; }),
    getMacroContext().catch((e) => { console.warn("[getMacroContext] warn:", e?.message); return null; }),
    computeLifecycle(profile).catch((e) => { console.warn("[computeLifecycle] warn:", e?.message); return null; }),
    computeFactorTilts(profile).catch((e) => { console.warn("[computeFactorTilts] warn:", e?.message); return null; }),
    computeLessons(profile.email).catch((e) => { console.warn("[computeLessons] warn:", e?.message); return null; }),
  ]);
  const monitorAlerts = monitorRes?.alerts || [];
  const prompt = buildBriefingPrompt(profile, summary, monitorAlerts, quantSignals, macro, lifecycle, factors, lessons);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.STOCKS_ADVICE_MODEL || "claude-sonnet-4-5",
      max_tokens: 4096,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const e = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${e.slice(0, 200)}`);
  }
  const j = await r.json();
  const raw = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!raw) throw new Error("Empty briefing");
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
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:24px auto;padding:24px;line-height:1.6;color:#0b1220;background:#fff">${inner}<hr style="border:none;border-top:1px solid #e4e8ef;margin:24px 0"><div style="font-size:11px;color:#7a8499">Research and education only. Not licensed investment advice.</div></body></html>`;
  const from = process.env.STOCKS_BRIEFING_FROM || "Stocks Advisor <noreply@curriculate.net>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!r.ok) {
    const e = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${e.slice(0, 200)}`);
  }
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

  for (const p of portfolios) {
    try {
      const md = await generateBriefing(p);
      const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      await emailBriefing({ to: p.email, subject, md });

      // Persist actionable recs for the scorecard
      const recs = parseRecsFromBriefing(md);
      if (recs.length) {
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

export function scheduleDailyBriefing() {
  if (process.env.STOCKS_BRIEFING_ENABLED !== "1") {
    console.log("[stocks-briefing] disabled (set STOCKS_BRIEFING_ENABLED=1 to turn on)");
    return null;
  }
  const expr = process.env.STOCKS_BRIEFING_CRON || "30 7 * * 1-5";
  const tz = process.env.STOCKS_BRIEFING_TZ || "America/New_York";
  console.log(`[stocks-briefing] scheduled: "${expr}" ${tz}`);
  return cron.schedule(expr, async () => {
    console.log(`[stocks-briefing] tick: ${new Date().toISOString()}`);
    try { await runDailyBriefing(); } catch (e) { console.error("[stocks-briefing] tick error:", e); }
  }, { timezone: tz });
}
