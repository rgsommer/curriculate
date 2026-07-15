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
import { getTechnicals } from "../services/stocksTechnicals.js";
import { getRealtimeQuote } from "../services/stocksIntradayFmp.js";

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

export function scheduleStocksAlerts() {
  if (process.env.STOCKS_ALERTS_ENABLED !== "1") {
    console.log("[stocks-alerts] disabled (set STOCKS_ALERTS_ENABLED=1 to turn on)");
    return null;
  }
  console.log("[stocks-alerts] scheduled: every 5min during US market hours");
  return cron.schedule("*/5 * * * *", async () => {
    if (!isMarketHoursNow()) return;
    try {
      const { checked, fired } = await processAlertsOnce();
      if (checked > 0 || fired > 0) console.log(`[stocks-alerts] tick: ${checked} checked, ${fired} fired`);
    } catch (e) { console.error("[stocks-alerts] tick error:", e?.message); }
  });
}
