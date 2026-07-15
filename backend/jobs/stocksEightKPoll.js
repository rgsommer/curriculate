// backend/jobs/stocksEightKPoll.js
//
// Polls SEC 8-K filings for tickers users care about (their portfolio +
// their active alerts) every 15 min during market hours, 60 min otherwise.
// Dedup via unique accessionNumber index. Fires email on high-signal items.
//
// The ticker universe is the union of {portfolio.positions} ∪ {active
// alerts} — only user-tracked names, not the entire market. Scales with
// user count, not universe size.

import cron from "node-cron";
import { Resend } from "resend";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAlert from "../models/StocksAlert.js";
import StocksEightK from "../models/StocksEightK.js";
import { getRecent8Ks, classifyItems } from "../services/stocks8K.js";

const FROM = process.env.STOCKS_BRIEFING_FROM || "Stocks Advisor <noreply@curriculate.net>";

function isMarketHoursNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const dow = parts.find((p) => p.type === "weekday")?.value;
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(dow)) return false;
  const mins = h * 60 + m;
  return mins >= 9 * 60 && mins <= 16 * 60 + 30;
}

// Build ticker → set-of-emails map from all user data. Used to decide who
// gets an email when a filing lands.
async function buildTickerWatchers() {
  const portfolios = await StocksPortfolio.find({ "positions.0": { $exists: true } })
    .select({ email: 1, "positions.ticker": 1 })
    .lean();
  const alerts = await StocksAlert.find({ active: true }).select({ email: 1, ticker: 1 }).lean();

  const watchers = new Map(); // TICKER (upper, no exchange suffix) → Set<email>
  const norm = (t) => String(t || "").toUpperCase().replace(/\..*$/, "");

  for (const p of portfolios) {
    for (const pos of p.positions || []) {
      const t = norm(pos.ticker);
      if (!t) continue;
      if (!watchers.has(t)) watchers.set(t, new Set());
      watchers.get(t).add(p.email);
    }
  }
  for (const a of alerts) {
    const t = norm(a.ticker);
    if (!t) continue;
    if (!watchers.has(t)) watchers.set(t, new Set());
    watchers.get(t).add(a.email);
  }
  return watchers;
}

async function fireEightKEmail(to, ticker, filing) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const itemLines = filing.itemLabels.map((l, i) => `<li><b>Item ${filing.itemNumbers[i]}</b>: ${l}</li>`).join("");
  const subject = `📄 ${ticker} filed 8-K: ${filing.itemLabels[0] || "material event"}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; padding: 20px;">
      <h2 style="margin: 0 0 4px;">${ticker} — Material Event (8-K)</h2>
      <div style="color: #6b7280; font-size: 13px; margin-bottom: 16px;">Filed ${new Date(filing.filedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET</div>
      <ul style="padding-left: 20px; margin: 0 0 16px; font-size: 14px; line-height: 1.5;">${itemLines}</ul>
      ${filing.url ? `<a href="${filing.url}" style="display: inline-block; padding: 8px 14px; background: #111827; color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px;">Read the filing on SEC.gov →</a>` : ""}
      <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">You're getting this because ${ticker} is in your portfolio or on an active alert on <a href="https://www.curriculate.net/stocks">curriculate.net/stocks</a>.</div>
    </div>
  `;
  await resend.emails.send({ from: FROM, to, subject, html });
}

export async function processEightKsOnce({ sinceDaysBack = 3 } = {}) {
  const watchers = await buildTickerWatchers();
  if (watchers.size === 0) return { tickersChecked: 0, newFilings: 0, emails: 0 };

  const since = new Date(Date.now() - sinceDaysBack * 24 * 60 * 60 * 1000);
  let newFilings = 0;
  let emails = 0;

  for (const [ticker, emailSet] of watchers.entries()) {
    let filings;
    try { filings = await getRecent8Ks(ticker, since); }
    catch (e) { console.warn(`[stocks-8k] ${ticker} failed: ${e?.message}`); continue; }
    if (!filings || filings.length === 0) continue;

    for (const f of filings) {
      const { labels, highSignal } = classifyItems(f.itemNumbers);
      // Try to insert (dedup on accessionNumber unique index).
      let doc;
      try {
        doc = await StocksEightK.findOneAndUpdate(
          { accessionNumber: f.accessionNumber },
          {
            $setOnInsert: {
              ticker,
              cik: f.cik,
              accessionNumber: f.accessionNumber,
              filedAt: f.filedAt,
              itemNumbers: f.itemNumbers,
              itemLabels: labels,
              highSignal,
              primaryDocument: f.primaryDocument,
              url: f.url,
              emailedTo: [],
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (e) {
        // Duplicate key = we already saw this filing; move on.
        if (e.code === 11000) doc = await StocksEightK.findOne({ accessionNumber: f.accessionNumber });
        else { console.warn(`[stocks-8k] upsert ${ticker} ${f.accessionNumber} failed: ${e?.message}`); continue; }
      }
      // Fresh insert if createdAt matches updatedAt.
      const isNew = doc?.createdAt && doc?.updatedAt && Math.abs(doc.updatedAt - doc.createdAt) < 500;
      if (isNew) newFilings++;

      if (!highSignal) continue; // low-signal (regulatory admin) — persist but don't email

      const alreadyEmailed = new Set(doc.emailedTo || []);
      const targets = [...emailSet].filter((e) => !alreadyEmailed.has(e));
      if (targets.length === 0) continue;

      for (const to of targets) {
        try {
          await fireEightKEmail(to, ticker, { ...f, itemLabels: labels });
          emails++;
          await StocksEightK.updateOne({ _id: doc._id }, { $addToSet: { emailedTo: to } });
          console.log(`[stocks-8k] 📄 ${to} · ${ticker} · items ${f.itemNumbers.join(",")}`);
        } catch (e) {
          console.warn(`[stocks-8k] email ${ticker} → ${to} failed: ${e?.message}`);
        }
      }
    }
  }
  return { tickersChecked: watchers.size, newFilings, emails };
}

export function scheduleEightKPoll() {
  if (process.env.STOCKS_8K_ENABLED !== "1") {
    console.log("[stocks-8k] disabled (set STOCKS_8K_ENABLED=1 to turn on)");
    return null;
  }
  console.log("[stocks-8k] scheduled: every 15min market hours, 60min off-hours");
  // Every 15 min — the inner isMarketHoursNow gate turns off-hours ticks
  // into no-ops (except one hourly check for delayed after-close filings).
  return cron.schedule("*/15 * * * *", async () => {
    const marketOn = isMarketHoursNow();
    const isTopOfHour = new Date().getMinutes() < 15;
    if (!marketOn && !isTopOfHour) return; // off-hours: only run at :00
    try {
      const stats = await processEightKsOnce({ sinceDaysBack: marketOn ? 3 : 1 });
      if (stats.newFilings > 0 || stats.emails > 0) {
        console.log(`[stocks-8k] tick: ${stats.tickersChecked} tickers, ${stats.newFilings} new filings, ${stats.emails} emails sent`);
      }
    } catch (e) { console.error("[stocks-8k] tick error:", e?.message); }
  });
}
