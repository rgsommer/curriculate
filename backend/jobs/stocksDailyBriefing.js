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
import StocksAdviceSnapshot from "../models/StocksAdviceSnapshot.js";
import { getTechnicals, formatTechnicalsLine } from "../services/stocksTechnicals.js";
import { getFundamentals, formatFundamentalsLine } from "../services/stocksFundamentals.js";
import { getMacroContext, formatMacroBlock } from "../services/stocksMacroContext.js";
import { computeLifecycle, formatLifecycleBlock } from "../services/stocksLifecycle.js";
import { computeFactorTilts, formatFactorBlock } from "../services/stocksFactorAnalysis.js";
import { computeLessons, formatLessonsBlock } from "../services/stocksLessonsLearned.js";
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

function buildBriefingPrompt(profile, summary, monitorAlerts = [], quantSignals = null, macro = null, lifecycle = null, factors = null, lessons = null, transcripts = null, watchListBlock = "") {
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

REC HEADER FORMAT — every Action line must start with: "Action: <VERB> <N> sh <TICKER>". The token after the verb MUST be a real ticker symbol (DJT, ENB, NVDA, etc.). NEVER write "Action: SELL ENTIRE", "Action: HOLD CURRENT", "Action: HOLD BOTH", "Action: SELL ALL", "Action: HOLD BUT raise stop", or any English word in the ticker slot. If you mean "sell the entire position" write "Action: SELL 1267 sh DJT" with the actual share count.

QUANTITY MUST MATCH THE HOLDINGS TABLE. If the user holds 1267 sh of DJT in RRSP and you want to exit fully, write "SELL 1267 sh DJT". Do not pick a partial number like 900 unless you explicitly intend a partial trim AND state that clearly. Within ONE briefing, all references to a position's size must use the same number — don't say "1,267-share RRSP position" in the narrative and then "Sell 900 shares" in the order ticket.

FIELD FORMATTING — every named field (Entry, Target, Stop, Horizon, Account, Order ticket, After fill, Cost note, Rationale, Uses) must END WITH A PERIOD on its own logical line. Do not chain fields with commas or semicolons. Parenthetical notes are allowed inside a field's value (e.g. "Stop: $69 CAD (2.5×ATR pullback)."), but the field ends at the closing paren + period. Bad: "Stop: $69 CAD (2.5×ATR, GTC). Horizon..." — the comma inside parens confuses parsers. Good: "Stop: $69 CAD (2.5×ATR). Horizon: 12 months. Order ticket: GTC STOP-LIMIT...".

Required addition per rec body (EVERY BUY/SELL/TRIM rec, no exceptions):
  Order ticket: LIMIT BUY/SELL <N> <TICKER> @ $<limit> <CCY> <max/min>, Day/GTC.
  After fill: GTC STOP-LIMIT SELL <N> <TICKER>, stop $<stop> / limit $<stop-1%> <CCY>.
  Account: <Non-Spousal | RRSP | TFSA | RESP | FHSA> · uses $<X> of $<Y> <CCY> available · leaves $<Z>.

The "Account:" line is MANDATORY. If you omit it the rec is invalid. The account named MUST be one that holds enough cash in the trade's currency to cover the size you proposed — verify against the per-account cash inventory below before writing the rec.
`;

  const priceCurrencyBlock = `
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
- For ANY ticker not in the user's current holdings table, web_search "<TICKER> stock price" and use ONLY the retrieved live quote. NEVER quote a price from memory — training data is stale, you will be wrong by 30-200%.
- Verify ticker is currently tradable before recommending. Beware renamed/delisted symbols:
   • SQ (Square) was renamed XYZ in early 2025 — recommend XYZ not SQ
   • FB → META, TWTR → delisted
   • Any sub-mega-cap ticker from your training — VERIFY first
- If web_search can't confirm a live quote for a ticker, do NOT recommend it. Pick a different name.
- State retrieved prices with "(verified)" inline. Example: "ROKU at $128 USD (verified)" — not "$67.50".
- Known prior failures the user has caught: SQ at $79 (deprecated ticker), ROKU at $67 (stale ~50%), META at $525 (stale, actual ~$608). Don't repeat.
`;

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
    ? `5. **💵 Cash deployment — PER ACCOUNT** — REQUIRED. Generate EXACTLY ONE sub-section per account below that has free cash. Do NOT emit two separate "Cash deployment — RRSP" blocks (one for ENB, one for RY) — combine them into a SINGLE RRSP block with multiple recs inside it. Each account's recs must fit that account's own cash bucket — no cross-account pooling.

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
    : `5. **💵 Cash deployment** — He has $0 cash across all accounts. Either (a) skip this section, or (b) for ONE specific account, recommend a TRIM that would FREE UP cash for redeployment in THAT same account, with both legs spec'd in the rec format and the Account tag.`;

  const goalsBlock = profile.goals && profile.goals.trim().length > 0
    ? `\n🎯 USER GOALS & CONSTRAINTS (read FIRST — every rec must be coherent with these):\n${profile.goals.trim()}\n\nHow to factor goals into recs:\n- Recommendations conflicting with goals must be REJECTED or modified — don't silently override.\n- If a goal implies a withdrawal date, size positions and stops to make cash available by that date.\n- If a goal designates capital as long-term, don't redeploy it for short-horizon trades.\n- If a goal sets an account limit ("RRSP limit X"), prioritize filling that account when new cash is available.\n- Surface goal/opportunity tradeoffs explicitly; reference goals by name in rec rationale.\n`
    : "";

  return `You are Richard's personal stock advisor at SENIOR-ANALYST level. Generate today's morning briefing for ${profile.email}.

Today: ${today}
Risk tolerance: ${profile.riskTolerance}${goalsBlock}

SENIOR-ANALYST EXPECTATIONS:
1. Read the MACRO REGIME block FIRST and frame the briefing through that lens (risk-on vs risk-off, rising vs falling rates, USD/CAD direction).
2. Use ATR-based stops from the technicals block, not flat percentages.
3. Reference per-position cost basis from the LIFECYCLE block when proposing sells (acknowledge tax impact / loss realization).
4. Surface TAX-LOSS HARVEST candidates when present — these are free money in non-registered accounts.
5. Cite SPECIFIC numbers (RSI 32, P/E 87, ATR $14, 2.5×ATR stop = $407) not vague descriptors.
6. **DO NOT RESTATE P/L PERCENTAGES OR DOLLAR GAINS/LOSSES IN PROSE.** The Holdings table and the rec rows already show the user's actual P/L computed from their real cost basis. If you write "BBAI down -7.7%" in your card body and the app's data shows BBAI is actually +333%, you will mislead the user into selling a winner. Refer to the LIFECYCLE block's cost-basis numbers when reasoning about tax impact, but do NOT narrate "down X%" or "up Y%" or "unrealized loss of $Z" in prose unless the number you write matches the Holdings table EXACTLY. If unsure, just say "current position" without restating P/L.
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
${formatTranscriptsBlock(transcripts)}
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
4. **Today's one action** — single trade, all four levels (Entry/Target/Stop/Horizon), plus the specific account (Non-Spousal / RRSP / TFSA) per the Canadian tax notes above. This is the SINGLE highest-conviction trade for today. Section 5 must NOT repeat this trade — see rule below.
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

// Convert briefing markdown into an array of {title, body} cards by
// splitting on H2/H3 headings. Used to populate the in-app Advice tab from
// the latest briefing without a separate Anthropic call.
export function briefingToAdviceCards(md) {
  if (!md || typeof md !== "string") return [];
  const cards = [];
  // Split on lines beginning with ## or ### (preserves the marker via lookahead)
  const parts = md.split(/\n(?=##{1,2}\s)/);
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

export function parseRecsFromBriefing(text) {
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
  const [monitorRes, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock] = await Promise.all([
    monitorOpenRecs(profile.email).catch((e) => { console.warn("[monitorOpenRecs] warn:", e?.message); return { alerts: [] }; }),
    computeQuantSignals(profile).catch((e) => { console.warn("[computeQuantSignals] warn:", e?.message); return {}; }),
    getMacroContext().catch((e) => { console.warn("[getMacroContext] warn:", e?.message); return null; }),
    computeLifecycle(profile).catch((e) => { console.warn("[computeLifecycle] warn:", e?.message); return null; }),
    computeFactorTilts(profile).catch((e) => { console.warn("[computeFactorTilts] warn:", e?.message); return null; }),
    computeLessons(profile.email).catch((e) => { console.warn("[computeLessons] warn:", e?.message); return null; }),
    getTranscriptsForTopHoldings(profile).catch((e) => { console.warn("[getTranscriptsForTopHoldings] warn:", e?.message); return null; }),
    buildStarredWatchListBlock(profile.email).catch(() => ""),
  ]);
  const monitorAlerts = monitorRes?.alerts || [];
  const prompt = buildBriefingPrompt(profile, summary, monitorAlerts, quantSignals, macro, lifecycle, factors, lessons, transcripts, watchListBlock);

  // Anthropic call with retry-on-truncation. When the response stops
  // because we hit max_tokens (rather than because the model finished),
  // ask Claude to continue from where it left off and stitch.
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
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
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
  let j = await callClaude([{ role: "user", content: prompt }], 8192);
  let raw = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!raw) throw new Error("Empty briefing");

  // If the response was cut off because of max_tokens, ask for a
  // continuation and append. Anthropic's `stop_reason` tells us this
  // directly. We feed the partial response back as an assistant turn so
  // the model continues exactly where it stopped (no re-summarization).
  let attempts = 0;
  while (j?.stop_reason === "max_tokens" && attempts < 2) {
    attempts++;
    console.warn(`[stocks-briefing] truncated — requesting continuation (attempt ${attempts})`);
    const continuation = await callClaude([
      { role: "user", content: prompt },
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
      const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      await emailBriefing({ to: p.email, subject, md });
      // Persist as the in-app advice snapshot so the Advice tab reflects
      // the same content the user just got in email (no extra AI call).
      await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron" });

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
async function sendBriefingForUser(p, sendKey) {
  try {
    const includeMonthly = isLastTradingDayOfMonth(new Date());
    let md = await generateBriefing(p);
    if (includeMonthly) {
      const reports = await buildAllAccountReports(p).catch((e) => { console.warn("[monthly-report] warn:", e?.message); return []; });
      const block = formatAllReportsMarkdown(reports);
      if (block) md = `${block}\n\n---\n\n${md}`;
    }
    const subject = `Daily briefing — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    await emailBriefing({ to: p.email, subject, md });
    await saveAdviceSnapshot({ email: p.email, markdown: md, source: "cron" });

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

    // Stamp idempotency key
    await StocksPortfolio.updateOne(
      { email: p.email },
      { $set: { lastBriefingSentKey: sendKey } }
    );

    console.log(`[stocks-briefing] ✓ ${p.email} @ ${sendKey} — ${recs.length} recs tracked`);
  } catch (err) {
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
