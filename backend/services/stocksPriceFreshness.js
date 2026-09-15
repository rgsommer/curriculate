// backend/services/stocksPriceFreshness.js
//
// P4.3 (2026-09-14) — never call a stale price "live".
//
// Every actionable trade price in the briefing must be labeled
// accurately. Freshness classes:
//   LIVE            — quote timestamp ≤ 60s old AND market OPEN
//   INTRADAY_DELAYED— quote 61s..15min OR delayed feed (FMP free tier)
//   PREV_CLOSE      — market CLOSED and price is prior session close
//   STALE           — quote > 15min old AND market OPEN
//   UNKNOWN         — timestamp missing
//
// Label rendered next to the price:
//   LIVE          → " (live)"
//   INTRADAY_DELAYED → ` (as of ${HH:MM} ET, delayed)`
//   PREV_CLOSE    → ` (previous close ${YYYY-MM-DD})`
//   STALE         → ` (STALE — last quote ${HH:MM} ET, ${age}s old)`
//   UNKNOWN       → ` (latest available)`
//
// Persist: price, priceAsOf, priceSource, priceFreshnessSeconds,
// marketSession, freshnessClass. The mandate composer consumes
// freshnessClass to decide the label + whether to gate the action.

const LIVE_MAX_AGE_SEC = 60;
const DELAYED_MAX_AGE_SEC = 15 * 60;

export const FRESHNESS = {
  LIVE: "LIVE",
  INTRADAY_DELAYED: "INTRADAY_DELAYED",
  PREV_CLOSE: "PREV_CLOSE",
  STALE: "STALE",
  UNKNOWN: "UNKNOWN",
};

// PUBLIC — infer US market session at a given instant, America/New_York.
export function marketSessionAt(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const wd = parts.weekday;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (wd === "Sat" || wd === "Sun") return "CLOSED_WEEKEND";
  const minsET = hour * 60 + minute;
  if (minsET >= 9 * 60 + 30 && minsET < 16 * 60) return "OPEN";
  if (minsET >= 4 * 60 && minsET < 9 * 60 + 30) return "PRE_MARKET";
  if (minsET >= 16 * 60 && minsET < 20 * 60) return "AFTER_HOURS";
  return "CLOSED";
}

// PUBLIC — classify one price snapshot.
export function classifyPriceFreshness({ priceAsOf, marketSession, now = new Date() } = {}) {
  const session = marketSession || marketSessionAt(now);
  if (!priceAsOf) {
    return { freshnessClass: FRESHNESS.UNKNOWN, ageSec: null, session, label: "(latest available)" };
  }
  const ageSec = Math.max(0, Math.round((now - new Date(priceAsOf)) / 1000));
  if (session === "OPEN") {
    if (ageSec <= LIVE_MAX_AGE_SEC) return { freshnessClass: FRESHNESS.LIVE, ageSec, session, label: "(live)" };
    if (ageSec <= DELAYED_MAX_AGE_SEC) {
      const hhmm = fmtEtHhmm(priceAsOf);
      return { freshnessClass: FRESHNESS.INTRADAY_DELAYED, ageSec, session, label: `(as of ${hhmm} ET, delayed)` };
    }
    const hhmm = fmtEtHhmm(priceAsOf);
    return { freshnessClass: FRESHNESS.STALE, ageSec, session, label: `(STALE — last quote ${hhmm} ET, ${ageSec}s old)` };
  }
  // Market closed / weekend / pre / after-hours → use "previous close" wording.
  const ymd = String(new Date(priceAsOf).toISOString()).slice(0, 10);
  return { freshnessClass: FRESHNESS.PREV_CLOSE, ageSec, session, label: `(previous close ${ymd})` };
}

function fmtEtHhmm(d) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return fmt.format(new Date(d));
}

// PUBLIC — bundle for persisting alongside every actionable price.
export function priceProvenanceBundle({ price, priceAsOf, priceSource = "unknown", now = new Date() } = {}) {
  const c = classifyPriceFreshness({ priceAsOf, now });
  return {
    price,
    priceAsOf: priceAsOf ? new Date(priceAsOf).toISOString() : null,
    priceSource,
    priceFreshnessSeconds: c.ageSec,
    marketSession: c.session,
    freshnessClass: c.freshnessClass,
    label: c.label,
  };
}
