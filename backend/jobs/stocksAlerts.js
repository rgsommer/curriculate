// backend/jobs/stocksAlerts.js
//
// Alerts cron worker. Runs every 5 minutes during US market hours
// (09:30-16:00 ET, Mon-Fri). For each active alert, fetches the last
// price + volume via getTechnicals (already cached 4h so no thrash),
// checks the condition, fires a Resend email + marks inactive when
// triggered.
//
// Design:
//   - Batched by ticker so 20 alerts on the same symbol = 1 fetch.
//   - Fail-open: if Yahoo hiccups on a ticker, that alert is skipped
//     this tick but stays active for the next.
//   - Alert emails are plain, fast, and include a note the user set
//     when creating the alert so the trigger has context.

import cron from "node-cron";
import { Resend } from "resend";
import StocksAlert from "../models/StocksAlert.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksPositionStopFire from "../models/StocksPositionStopFire.js";
import { getTechnicals } from "../services/stocksTechnicals.js";
import { getRealtimeQuote } from "../services/stocksIntradayFmp.js";
import { monitorPositionStops } from "../services/stocksPositionStopMonitor.js";

const FROM = process.env.STOCKS_BRIEFING_FROM || "Stocks Advisor <noreply@curriculate.net>";
const TZ = "America/New_York";

// Trading-hours gate: Mon-Fri 09:30-16:00 ET. Cron fires every 5min
// year-round; we short-circuit outside these windows so we don't
// hammer Yahoo overnight/on weekends.
function isMarketHoursNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const dow = parts.find((p) => p.type === "weekday")?.value;
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(dow)) return false;
  const minsSinceMidnight = h * 60 + m;
  return minsSinceMidnight >= 9 * 60 + 30 && minsSinceMidnight <= 16 * 60;
}

async function fireAlertEmail(alert, current) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const arrow = alert.condition === "above" ? "↑" : "↓";
  const subject = `🔔 ${alert.ticker} ${arrow} ${alert.condition === "above" ? "broke above" : "dropped below"} $${alert.price}${alert.rvolMin ? ` on ${current.rvol.toFixed(2)}x RVOL` : ""}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; padding: 20px;">
      <h2 style="margin: 0 0 4px; color: ${alert.condition === "above" ? "#166534" : "#991b1b"};">${arrow} ${alert.ticker} alert triggered</h2>
      <div style="color: #6b7280; font-size: 13px; margin-bottom: 16px;">${new Date().toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} ET</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #6b7280;">Condition</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${alert.condition} $${alert.price} ${alert.currency}${alert.rvolMin ? ` with RVOL ≥ ${alert.rvolMin}` : ""}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Current price</td><td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 16px;">$${current.price.toFixed(2)} ${alert.currency}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Current RVOL</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${current.rvol != null ? current.rvol.toFixed(2) + "x" : "—"}</td></tr>
        ${alert.note ? `<tr><td colspan="2" style="padding: 12px 0 0; color: #374151;"><b>Note:</b> ${alert.note.replace(/</g, "&lt;")}</td></tr>` : ""}
      </table>
      <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">This alert has been marked inactive. To re-arm it, open the Alerts panel on <a href="https://www.curriculate.net/stocks">curriculate.net/stocks</a>.</div>
    </div>
  `;
  await resend.emails.send({ from: FROM, to: alert.email, subject, html });
}

// One tick: pull all active alerts, group by ticker, fetch each ticker
// ONCE, evaluate each grouped alert, fire+persist as needed.
export async function processAlertsOnce() {
  const alerts = await StocksAlert.find({ active: true }).lean();
  if (alerts.length === 0) return { checked: 0, fired: 0 };

  const byTicker = new Map();
  for (const a of alerts) {
    const key = `${a.ticker}|${a.currency}`;
    if (!byTicker.has(key)) byTicker.set(key, []);
    byTicker.get(key).push(a);
  }

  let fired = 0;
  const nowIso = new Date();

  for (const [key, group] of byTicker.entries()) {
    const [ticker, currency] = key.split("|");
    // Real-time quote from FMP (60s cache) — the whole point of the
    // alerts cron. Falls back to Yahoo's cached daily close only if
    // FMP is unavailable, so alerts still fire (just less timely).
    let price = null;
    let rvol = null;
    let source = null;
    try {
      const rt = await getRealtimeQuote(ticker, currency);
      if (rt?.price != null) {
        price = rt.price;
        source = "fmp-realtime";
        // Compute RVOL from FMP's day volume vs avg volume.
        if (rt.volume != null && rt.avgVolume) rvol = rt.volume / rt.avgVolume;
      }
    } catch (e) { console.warn(`[stocks-alerts] FMP quote ${ticker} failed: ${e?.message}`); }
    if (price == null) {
      try {
        const tech = await getTechnicals(ticker, currency);
        if (tech?.ok && tech.last != null) {
          price = tech.last;
          rvol = tech.volume?.rvol ?? null;
          source = "yahoo-daily";
        }
      } catch (e) { console.warn(`[stocks-alerts] Yahoo fallback ${ticker} failed: ${e?.message}`); continue; }
    }
    if (price == null) continue;

    for (const a of group) {
      const priceHit = a.condition === "above" ? price >= a.price : price <= a.price;
      const rvolHit = a.rvolMin == null || (rvol != null && rvol >= a.rvolMin);
      const shouldFire = priceHit && rvolHit;

      if (!shouldFire) {
        // Just bookkeep the last-check time.
        await StocksAlert.updateOne({ _id: a._id }, { $set: { lastCheckedAt: nowIso } }).catch(() => {});
        continue;
      }
      try {
        await fireAlertEmail(a, { price, rvol });
        await StocksAlert.updateOne(
          { _id: a._id },
          { $set: { active: false, triggeredAt: nowIso, triggeredPrice: price, triggeredRvol: rvol, lastCheckedAt: nowIso } }
        );
        fired++;
        console.log(`[stocks-alerts] 🔔 ${a.email} · ${a.ticker} ${a.condition} $${a.price} @ $${price.toFixed(2)}${rvol != null ? ` (RVOL ${rvol.toFixed(2)}x)` : ""} via ${source}`);
      } catch (e) {
        console.warn(`[stocks-alerts] email/persist ${a.ticker} failed: ${e?.message}`);
      }
    }
  }
  return { checked: alerts.length, fired };
}

// ── Real-time P&L stop watch ─────────────────────────────────────
// Same 5min cadence as user-armed alerts, but drives off the -8%
// hard-stop rule the trader adopted from the journal analysis. Every
// user's positions are checked live vs cost basis. Emails fire when
// a position crosses into WATCH (-5%), WITHIN (-6%), or HARD STOP
// (-8%) tiers, dedup'd via StocksPositionStopFire so the trader
// gets at most ONE email per (position, tier) per day. Tier
// escalations (WATCH → WITHIN → HARD_STOP) each fire fresh so a
// deteriorating position sends progressive warnings.

function ymdET(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function firePositionStopEmail({ email, row, tier }) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const emoji = tier === "hard-stop-hit" ? "🚨" : tier === "within-stop" ? "⚠" : "👀";
  const label = tier === "hard-stop-hit" ? "HARD STOP HIT" : tier === "within-stop" ? "WITHIN 2% OF STOP" : "WATCH";
  const actionLine = tier === "hard-stop-hit"
    ? `<b style="color:#991b1b">EXIT AT MARKET</b> unless a specific NEW-INFO reason overrides. The -8% rule exists because narrative overrides at this level cost you money before (DJT: -$3,128).`
    : tier === "within-stop"
      ? `<b style="color:#a16207">TIGHTEN OR TRIM</b> — move stop to break-even at $${row.costBasis?.toFixed(2)} OR trim 50% now. Don't let this become another DJT.`
      : `<b>WATCH</b> — 3% from hard stop. Keep on radar.`;
  const subject = `${emoji} ${row.ticker} · pnl ${row.pnlPct.toFixed(1)}% · ${label}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;padding:20px;">
      <h2 style="margin:0 0 4px;color:${tier === "hard-stop-hit" ? "#991b1b" : tier === "within-stop" ? "#a16207" : "#374151"}">${emoji} ${row.ticker}: ${label}</h2>
      <div style="color:#6b7280;font-size:13px;margin-bottom:16px">${new Date().toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} ET</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b7280">Account</td><td style="padding:6px 0;text-align:right;font-weight:600">${row.account || "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Position</td><td style="padding:6px 0;text-align:right;font-weight:600">${row.qty} sh</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Cost basis</td><td style="padding:6px 0;text-align:right;font-weight:600">$${row.costBasis?.toFixed(2)} ${row.currency}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Current price</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:16px;color:#991b1b">$${row.currentPrice?.toFixed(2)} ${row.currency}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">P&amp;L</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:16px;color:#991b1b">${row.pnlPct.toFixed(1)}%</td></tr>
      </table>
      <div style="margin-top:16px;padding:12px 14px;background:${tier === "hard-stop-hit" ? "#fef2f2" : tier === "within-stop" ? "#fefce8" : "#f3f4f6"};border-radius:8px;font-size:13px">${actionLine}</div>
      <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">You are receiving this because you adopted the -8% hard-stop rule from the trade journal AI analysis. Position stop-watch runs every 5 min during US market hours. Manage on <a href="https://www.curriculate.net/stocks">curriculate.net/stocks</a>.</div>
    </div>
  `;
  await resend.emails.send({ from: FROM, to: email, subject, html });
}

export async function processPositionStopsOnce() {
  const profiles = await StocksPortfolio.find({ "positions.0": { $exists: true } })
    .select({ email: 1, positions: 1 })
    .lean();
  const today = ymdET(new Date());
  let checked = 0, fired = 0;
  for (const p of profiles) {
    // Refresh prices for held positions BEFORE computing P&L — cost basis
    // is stored, but priceUsd/priceCad on the position may be stale between
    // user-initiated refreshes. Best-effort per ticker.
    const refreshed = [];
    for (const pos of p.positions || []) {
      const ccy = pos.ccy || "USD";
      let livePrice = null;
      try {
        const rt = await getRealtimeQuote(pos.ticker, ccy);
        if (rt?.price != null) livePrice = rt.price;
      } catch { /* fall back to stored */ }
      if (livePrice == null) {
        try {
          const tech = await getTechnicals(pos.ticker, ccy);
          if (tech?.ok && tech.last != null) livePrice = tech.last;
        } catch { /* still fall back */ }
      }
      const refreshedPos = { ...pos };
      if (livePrice != null) {
        if (ccy === "USD") refreshedPos.priceUsd = livePrice;
        else refreshedPos.priceCad = livePrice;
      }
      refreshed.push(refreshedPos);
    }
    const monitor = monitorPositionStops(refreshed);
    checked += (p.positions || []).length;
    const flagged = [
      ...monitor.hardStopHit.map((r) => ({ ...r, tier: "hard-stop-hit" })),
      ...monitor.withinStop.map((r) => ({ ...r, tier: "within-stop" })),
      ...monitor.watch.map((r) => ({ ...r, tier: "watch" })),
    ];
    for (const row of flagged) {
      try {
        // Insert dedup row first — unique index rejects re-fires for the
        // same (email, ticker, account, tier, dateStr). If insert succeeds,
        // this is the first fire today for this tier; send the email.
        await StocksPositionStopFire.create({
          email: p.email,
          ticker: row.ticker,
          account: row.account || "",
          tier: row.tier,
          dateStr: today,
          priceAtFire: row.currentPrice,
          pnlPctAtFire: row.pnlPct,
          currency: row.currency,
        });
        await firePositionStopEmail({ email: p.email, row, tier: row.tier });
        fired++;
        console.log(`[stocks-alerts] 🚨 ${p.email} · ${row.ticker} ${row.tier} @ ${row.pnlPct.toFixed(1)}%`);
      } catch (e) {
        // Duplicate key = already fired for this tier today; skip silently.
        if (e.code !== 11000) console.warn(`[stocks-alerts] pos-stop fire failed ${p.email}/${row.ticker}: ${e?.message}`);
      }
    }
  }
  return { checked, fired };
}

export function scheduleStocksAlerts() {
  if (process.env.STOCKS_ALERTS_ENABLED !== "1") {
    console.log("[stocks-alerts] disabled (set STOCKS_ALERTS_ENABLED=1 to turn on)");
    return null;
  }
  console.log("[stocks-alerts] scheduled: every 5min during US market hours · user alerts + position P&L stop watch");
  return cron.schedule("*/5 * * * *", async () => {
    if (!isMarketHoursNow()) return;
    try {
      const [alertRes, stopRes] = await Promise.all([
        processAlertsOnce().catch((e) => { console.error("[stocks-alerts] alerts phase:", e?.message); return { checked: 0, fired: 0 }; }),
        processPositionStopsOnce().catch((e) => { console.error("[stocks-alerts] pos-stops phase:", e?.message); return { checked: 0, fired: 0 }; }),
      ]);
      if (alertRes.checked > 0 || alertRes.fired > 0 || stopRes.fired > 0) {
        console.log(`[stocks-alerts] tick: user-alerts ${alertRes.checked} checked ${alertRes.fired} fired · pos-stops ${stopRes.checked} checked ${stopRes.fired} fired`);
      }
    } catch (e) { console.error("[stocks-alerts] tick error:", e?.message); }
  });
}
