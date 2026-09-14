// backend/services/stocksBriefingDataFreshness.js
//
// P4.2 (2026-09-14) — one place to describe the freshness of every
// data source the briefing renders from. The mandate composer, the
// staleness gate, and the scanner-wording block all consult this.
//
// Contract (returned object):
//   {
//     holdingsAsOf, pricesAsOf, sleeveAsOf,
//     hardStopInputAsOf,
//     portfolioSnapshotAsOf, dailyPositionSnapshotAsOf,
//     snapshotCronHealthy, snapshotCronLastTickAt, snapshotCronLastError,
//     hardRulesEvaluable,   // true iff every input the hard-rule
//                           // check needs is fresh enough
//     recapEvaluable,       // true iff historical recap can be trusted
//     mandateLineText,      // the exact wording for §1 when no
//                           // mandates fire (per spec §3)
//   }
//
// Timestamps are ISO strings; `null` means never / unknown. All
// staleness thresholds live in one place so future tuning is easy.

const HOLDINGS_STALE_HOURS = 24;
const SNAPSHOT_STALE_BUSINESS_DAYS = 3;
const CRON_STALE_HOURS = 96;   // Mon-Fri cron + weekend gap tolerance

function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }
function isoParse(s) { return s ? new Date(s) : null; }
function businessDaysBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  let d = new Date(a); let count = 0;
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

// PUBLIC — compute every source's freshness and derive the correct
// §1 wording. Reads Mongo directly.
export async function describeBriefingDataFreshness({ email, now = new Date() } = {}) {
  const em = String(email || "").toLowerCase();
  // Lazy-load to avoid pulling Mongo models when unused.
  const [
    { default: StocksPortfolio },
    { default: StocksPortfolioSnapshot },
    { default: StocksDailyPositionSnapshot },
    { default: StocksSystemHeartbeat },
  ] = await Promise.all([
    import("../models/StocksPortfolio.js"),
    import("../models/StocksPortfolioSnapshot.js"),
    import("../models/StocksDailyPositionSnapshot.js"),
    import("../models/StocksSystemHeartbeat.js"),
  ]);

  const [portfolio, latestTotal, latestDaily, snapHb] = await Promise.all([
    StocksPortfolio.findOne({ email: em }).lean().catch(() => null),
    StocksPortfolioSnapshot.findOne({ email: em, accountId: "__total__" }).sort({ date: -1 }).lean().catch(() => null),
    StocksDailyPositionSnapshot.findOne({ email: em }).sort({ date: -1 }).lean().catch(() => null),
    StocksSystemHeartbeat.findOne({ name: "stocks-portfolio-snapshot" }).lean().catch(() => null),
  ]);

  const holdingsAsOf = portfolio?.updatedAt ? new Date(portfolio.updatedAt).toISOString() : null;
  const holdingsAgeH = holdingsAsOf ? (now - new Date(holdingsAsOf)) / 3_600_000 : Infinity;
  const holdingsFresh = holdingsAgeH < HOLDINGS_STALE_HOURS;

  // Prices live inside the portfolio doc — refreshed by the snapshot
  // cron + UI Refresh + record-trade write. Same freshness signal.
  const pricesAsOf = holdingsAsOf;
  const pricesFresh = holdingsFresh;

  // Sleeve percentages are recomputed from current positions on every
  // briefing render. Their freshness == the freshness of holdings +
  // prices used to compute them.
  const sleeveAsOf = holdingsAsOf;

  // Hard-stop check reads live prices + saved stops. Fresh iff prices are.
  const hardStopInputAsOf = holdingsAsOf;

  const portfolioSnapshotAsOf = latestTotal?.date || null;
  const snapAgeBd = portfolioSnapshotAsOf ? businessDaysBetween(new Date(portfolioSnapshotAsOf), now) : Infinity;
  const snapFresh = snapAgeBd < SNAPSHOT_STALE_BUSINESS_DAYS;

  const dailyPositionSnapshotAsOf = latestDaily?.date || null;

  const cronLastTickAt = snapHb?.lastTickAt ? new Date(snapHb.lastTickAt).toISOString() : null;
  const cronAgeH = cronLastTickAt ? (now - new Date(cronLastTickAt)) / 3_600_000 : Infinity;
  const cronHealthy = cronAgeH < CRON_STALE_HOURS && !snapHb?.lastError;

  const hardRulesEvaluable = holdingsFresh && pricesFresh;
  const recapEvaluable = snapFresh;

  // Spec §3 wording. Composed here so every callsite gets the same
  // exact string.
  let mandateLineText;
  if (!hardRulesEvaluable) {
    mandateLineText = `DATA STALE — hard-rule status cannot be verified. Holdings/prices last updated ${holdingsAsOf || "never"}; ${HOLDINGS_STALE_HOURS}h staleness threshold breached. Do NOT act on this briefing until Refresh Prices succeeds.`;
  } else if (!recapEvaluable) {
    mandateLineText = `Current holdings/risk checks are fresh and no hard rules are triggered. Historical portfolio recap unavailable because its snapshot series is stale (last __total__ snapshot ${portfolioSnapshotAsOf || "never"}).`;
  } else {
    mandateLineText = `None. Portfolio is inside all hard rules today.`;
  }

  return {
    holdingsAsOf, pricesAsOf, sleeveAsOf,
    hardStopInputAsOf,
    portfolioSnapshotAsOf, dailyPositionSnapshotAsOf,
    snapshotCronHealthy: cronHealthy,
    snapshotCronLastTickAt: cronLastTickAt,
    snapshotCronLastError: snapHb?.lastError || null,
    holdingsFresh, pricesFresh, snapFresh,
    hardRulesEvaluable, recapEvaluable,
    mandateLineText,
    thresholds: {
      holdingsStaleHours: HOLDINGS_STALE_HOURS,
      snapshotStaleBusinessDays: SNAPSHOT_STALE_BUSINESS_DAYS,
      cronStaleHours: CRON_STALE_HOURS,
    },
  };
}
