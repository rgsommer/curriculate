// backend/services/stocksTradingDate.js
//
// P4.1 (2026-09-11) — trading-date helper.
// Given a UTC instant, return the YYYY-MM-DD of the most recent
// COMPLETED US market session, computed in America/Toronto.
//
// Rules:
//   • Mon-Fri BEFORE 16:00 ET → prior trading session (yesterday's
//     close is the last completed one; today's session is in progress).
//   • Mon-Fri AT/AFTER 16:00 ET → today.
//   • Saturday / Sunday / Monday pre-16:00-ET → previous Friday.
//   • US market holiday → previous business day (a small hardcoded
//     list keeps this dependency-free; extend as needed).

const HOLIDAYS_ISO = new Set([
  // 2026 US market holidays
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027 top-of-year for boundary safety
  "2027-01-01",
]);

const CLOSE_HOUR_ET = 16; // 4:00 PM

function isWeekend(day) { return day === 0 || day === 6; } // 0=Sun 6=Sat
function isHoliday(iso) { return HOLIDAYS_ISO.has(iso); }

// Parse a Date into Toronto-time components without depending on Intl
// (which is available in Node 20+; we still use it for correctness).
function torontoParts(d) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayIndex = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[parts.weekday];
  const hour = Number(parts.hour);
  return { iso, hour, weekdayIndex };
}

function isoAddDays(iso, delta) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function torontoWeekdayForIso(iso) {
  const d = new Date(iso + "T12:00:00-04:00"); // safe noon ET
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short" });
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[fmt.format(d)];
}

// PUBLIC — last completed US market session (America/Toronto).
export function lastCompletedTradingDate(now = new Date()) {
  const { iso, hour, weekdayIndex } = torontoParts(now);
  let candidate = iso;
  // If it's a weekday BEFORE close (i.e. before 4pm ET), step back one day.
  if (!isWeekend(weekdayIndex) && hour < CLOSE_HOUR_ET) {
    candidate = isoAddDays(candidate, -1);
  }
  // Walk backwards until we land on a non-weekend, non-holiday day.
  let safety = 10;
  while (safety-- > 0) {
    const wd = torontoWeekdayForIso(candidate);
    if (!isWeekend(wd) && !isHoliday(candidate)) return candidate;
    candidate = isoAddDays(candidate, -1);
  }
  return candidate;
}

// PUBLIC — the wall-clock local date the row was created (America/Toronto).
export function localExperimentDate(now = new Date()) {
  return torontoParts(now).iso;
}

// PUBLIC — one-shot bundle for experiment/pick records.
export function tradingDateBundle(now = new Date()) {
  const tradingDate = lastCompletedTradingDate(now);
  return {
    tradingDate,
    referenceTradingDate: tradingDate,
    localExperimentDate: localExperimentDate(now),
    createdAtUtc: new Date(now).toISOString(),
  };
}
