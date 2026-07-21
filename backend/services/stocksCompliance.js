// backend/services/stocksCompliance.js
//
// Discipline compliance report. The tool has rules — sleeve caps, -8%
// hard stop, no-repeat holdings, "take the pick" — and the operator
// can ignore them. This service quietly measures how often that
// happens, so the briefing can hold up the mirror once a week.
//
// The metrics are deliberately narrow and honest:
//
//   Take rate (BUY recs): what % of BUY recs generated in the last 90d
//     got acted on within 5 trading days? (Trade journal has
//     linkedAdviceRecId + linkedDailyPickId; a BUY leg matching a rec's
//     ticker within the window counts as taken.)
//
//   Hard-stop compliance: how many times in the last 90d did a
//     position close a session at ≤-8% vs its cost basis? Of those,
//     how many had a SELL leg within 2 trading days? (Compliance
//     score = fired-and-exited / fired.)
//
//   No-repeat violations: how many BUY legs in the last 90d added to
//     a ticker the user was already holding (≥1 share) at the moment
//     of the trade? This is looser than the briefing's per-briefing
//     "no repeat" rule, but flags the specific pattern (dollar-cost-
//     averaging into losers) that showed up in the journal analysis.
//
// The report intentionally does NOT try to compute the hypothetical
// "what would you have made if you'd taken every rec" number — that
// belongs in the attribution report where the P&L math is honest.

import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDailyPick from "../models/StocksDailyPick.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksPositionStopFire from "../models/StocksPositionStopFire.js";
import StocksRecIntent from "../models/StocksRecIntent.js";

const LOOKBACK_DAYS = 90;
const TAKE_WINDOW_DAYS = 5;
const EXIT_WINDOW_DAYS = 2;

function since(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysBetween(a, b) {
  return Math.abs(Math.round((new Date(a) - new Date(b)) / 86400000));
}

// Take rate on BUY-side AI recs + Test A daily picks.
async function measureTakeRate(email) {
  const cutoff = since(LOOKBACK_DAYS);

  const [buyRecs, dailyPicks, trades, intents] = await Promise.all([
    StocksAdviceRec.find({ email, action: "BUY", generatedAt: { $gte: cutoff } }).lean(),
    StocksDailyPick.find({ email, pickDate: { $gte: cutoff } }).lean(),
    StocksTradeJournal.find({
      email,
      executedAt: { $gte: cutoff },
      "legs.side": "BUY",
    }).lean(),
    // User-stated intents on any rec — used to split "consciously
    // skipped" (a decision) from "not yet acted on" (drift). Skipping
    // ISN'T a compliance failure — it's a data point.
    StocksRecIntent.find({ email, markedAt: { $gte: cutoff } }).lean(),
  ]);
  const intentByRecId = new Map();
  for (const i of intents) intentByRecId.set(String(i.recId), i.intent);

  // A rec is "taken" if there's a BUY leg on the same ticker within
  // TAKE_WINDOW_DAYS of the rec's generatedAt.
  const buyLegsByTicker = new Map();
  for (const t of trades) {
    for (const leg of t.legs || []) {
      if (leg.side !== "BUY") continue;
      const k = String(leg.ticker || "").toUpperCase().replace(/\..*$/, "");
      if (!buyLegsByTicker.has(k)) buyLegsByTicker.set(k, []);
      buyLegsByTicker.get(k).push(new Date(t.executedAt));
    }
  }

  // Three-way classification per rec:
  //   • taken       — a broker BUY leg on the same ticker within
  //                   TAKE_WINDOW_DAYS. Broker truth wins over intent.
  //   • skipped     — user marked intent="skipped" AND no matching leg.
  //   • unmarked    — everything else. These are the ones drifting.
  // "Take rate" excludes skipped from the denominator, since skipping
  // consciously isn't a compliance failure.
  const check = (items, dateField) => {
    let taken = 0, skipped = 0, unmarked = 0;
    for (const it of items) {
      const t = String(it.ticker || "").toUpperCase().replace(/\..*$/, "");
      const legs = buyLegsByTicker.get(t) || [];
      const recDate = new Date(it[dateField]);
      const hasLeg = legs.some((legDate) =>
        legDate >= recDate && daysBetween(legDate, recDate) <= TAKE_WINDOW_DAYS
      );
      if (hasLeg) { taken++; continue; }
      const intent = intentByRecId.get(String(it._id));
      if (intent === "skipped") skipped++;
      else unmarked++;
    }
    return { total: items.length, taken, skipped, unmarked };
  };

  const aiRecStats = check(buyRecs, "generatedAt");
  const pickStats = check(dailyPicks, "pickDate");

  const totalRecs = aiRecStats.total + pickStats.total;
  const totalTaken = aiRecStats.taken + pickStats.taken;
  const totalSkipped = aiRecStats.skipped + pickStats.skipped;
  const totalUnmarked = aiRecStats.unmarked + pickStats.unmarked;
  const decidedDenom = totalTaken + totalUnmarked; // exclude conscious skips

  return {
    lookbackDays: LOOKBACK_DAYS,
    aiBuyRecs: aiRecStats.total,
    aiBuyRecsTaken: aiRecStats.taken,
    dailyPicks: pickStats.total,
    dailyPicksTaken: pickStats.taken,
    combinedRecs: totalRecs,
    combinedTaken: totalTaken,
    combinedSkipped: totalSkipped,
    combinedUnmarked: totalUnmarked,
    // Take rate over decided-only denominator (broker fills + drifts,
    // excluding conscious skips). Falls back to raw ratio when we have
    // no intents so the metric is still populated on cold-start.
    takeRatePct: decidedDenom > 0 ? (totalTaken / decidedDenom) * 100
      : (totalRecs > 0 ? (totalTaken / totalRecs) * 100 : null),
    takeRateRawPct: totalRecs > 0 ? (totalTaken / totalRecs) * 100 : null,
  };
}

// Hard-stop compliance from the StocksPositionStopFire log (which
// dedups by (email,ticker,account,tier,day) — one row per unique
// alert). "hard-stop-hit" tier = -8% or worse.
async function measureHardStopCompliance(email) {
  const cutoff = since(LOOKBACK_DAYS);

  const [fires, trades] = await Promise.all([
    StocksPositionStopFire.find({
      email,
      tier: "hard-stop-hit",
      firedAt: { $gte: cutoff },
    }).lean(),
    StocksTradeJournal.find({
      email,
      executedAt: { $gte: cutoff },
      "legs.side": "SELL",
    }).lean(),
  ]);

  const sellsByTicker = new Map();
  for (const t of trades) {
    for (const leg of t.legs || []) {
      if (leg.side !== "SELL") continue;
      const k = String(leg.ticker || "").toUpperCase().replace(/\..*$/, "");
      if (!sellsByTicker.has(k)) sellsByTicker.set(k, []);
      sellsByTicker.get(k).push(new Date(t.executedAt));
    }
  }

  let exited = 0;
  const violations = [];
  for (const fire of fires) {
    const k = String(fire.ticker || "").toUpperCase().replace(/\..*$/, "");
    const sells = sellsByTicker.get(k) || [];
    const firedAt = new Date(fire.firedAt);
    const inWindow = sells.some((s) => s >= firedAt && daysBetween(s, firedAt) <= EXIT_WINDOW_DAYS);
    if (inWindow) exited++;
    else violations.push({ ticker: k, firedAt: firedAt.toISOString().slice(0, 10), pnlPct: fire.pnlPctAtFire });
  }

  return {
    lookbackDays: LOOKBACK_DAYS,
    hardStopFires: fires.length,
    exitedWithinWindow: exited,
    windowDays: EXIT_WINDOW_DAYS,
    compliancePct: fires.length > 0 ? (exited / fires.length) * 100 : null,
    violations: violations.slice(0, 5),
  };
}

// No-repeat pattern: BUY legs on tickers where the user was already
// holding ≥ 1 share at the moment of the trade. We rely on the trade
// journal to reconstruct running share counts per ticker.
async function measureNoRepeatViolations(email) {
  const cutoff = since(LOOKBACK_DAYS);
  const trades = await StocksTradeJournal.find({
    email,
    executedAt: { $gte: new Date(cutoff.getTime() - 365 * 86400000) }, // pull older too so opening lot is counted
  })
    .sort({ executedAt: 1 })
    .lean();

  const runningShares = new Map();
  const violations = [];
  for (const t of trades) {
    for (const leg of t.legs || []) {
      const k = String(leg.ticker || "").toUpperCase().replace(/\..*$/, "");
      if (!k) continue;
      const prior = runningShares.get(k) || 0;
      if (leg.side === "BUY" && prior >= 1 && new Date(t.executedAt) >= cutoff) {
        violations.push({
          ticker: k,
          date: new Date(t.executedAt).toISOString().slice(0, 10),
          priorShares: prior,
          addShares: leg.shares || 0,
        });
      }
      if (leg.side === "BUY") runningShares.set(k, prior + (leg.shares || 0));
      else if (leg.side === "SELL") runningShares.set(k, Math.max(0, prior - (leg.shares || 0)));
    }
  }

  return {
    lookbackDays: LOOKBACK_DAYS,
    violations: violations.length,
    examples: violations.slice(0, 5),
  };
}

export async function computeCompliance(email) {
  if (!email) return null;
  const [takeRate, hardStop, noRepeat] = await Promise.all([
    measureTakeRate(email).catch(() => null),
    measureHardStopCompliance(email).catch(() => null),
    measureNoRepeatViolations(email).catch(() => null),
  ]);
  return { takeRate, hardStop, noRepeat };
}

// Format a compact COMPLIANCE block for the briefing prompt. Only
// emits when it's Monday (weekly heartbeat) OR when a hard-stop
// violation occurred — those are the two moments this report earns
// space in the daily briefing.
export function formatComplianceBlock(cmp, { weeklyHeartbeat = false } = {}) {
  if (!cmp) return "";
  const hardStopViolations = (cmp.hardStop?.hardStopFires || 0) - (cmp.hardStop?.exitedWithinWindow || 0);
  const showByViolation = hardStopViolations > 0 || (cmp.noRepeat?.violations || 0) > 0;
  if (!weeklyHeartbeat && !showByViolation) return "";

  const lines = [`\nDISCIPLINE COMPLIANCE (last ${cmp.takeRate?.lookbackDays || LOOKBACK_DAYS} days):`];

  if (cmp.takeRate?.combinedRecs > 0) {
    const rate = cmp.takeRate.takeRatePct != null
      ? `${cmp.takeRate.takeRatePct.toFixed(0)}%`
      : "n/a";
    const skipped = cmp.takeRate.combinedSkipped || 0;
    const unmarked = cmp.takeRate.combinedUnmarked || 0;
    lines.push(`  Take rate: ${cmp.takeRate.combinedTaken}/${cmp.takeRate.combinedTaken + unmarked} decided recs actioned within ${TAKE_WINDOW_DAYS} trading days (${rate})`);
    lines.push(`    Breakdown: ${cmp.takeRate.combinedTaken} taken · ${skipped} consciously skipped · ${unmarked} unmarked (drift)`);
    lines.push(`    AI BUY recs: ${cmp.takeRate.aiBuyRecsTaken}/${cmp.takeRate.aiBuyRecs} · Test A daily picks: ${cmp.takeRate.dailyPicksTaken}/${cmp.takeRate.dailyPicks}`);
  }

  if (cmp.hardStop?.hardStopFires > 0) {
    const rate = cmp.hardStop.compliancePct != null
      ? `${cmp.hardStop.compliancePct.toFixed(0)}%`
      : "n/a";
    lines.push(`  -8% hard-stop compliance: ${cmp.hardStop.exitedWithinWindow}/${cmp.hardStop.hardStopFires} exited within ${cmp.hardStop.windowDays} trading days (${rate})`);
    if (cmp.hardStop.violations?.length) {
      lines.push(`    ⚠ Still-held violations: ${cmp.hardStop.violations.map(v => `${v.ticker} (fired ${v.firedAt}${v.pnlPct != null ? `, ${v.pnlPct.toFixed(1)}%` : ""})`).join(" · ")}`);
    }
  }

  if (cmp.noRepeat?.violations > 0) {
    lines.push(`  🚨 No-repeat pattern: ${cmp.noRepeat.violations} BUY(s) added to an already-held ticker (dollar-cost-averaging pattern the journal analysis flagged)`);
    if (cmp.noRepeat.examples?.length) {
      lines.push(`    Recent: ${cmp.noRepeat.examples.map(v => `${v.ticker} ${v.date} (+${v.addShares} on top of ${v.priorShares})`).join(" · ")}`);
    }
  }

  lines.push(`\nHow to use:`);
  lines.push(`  - Emit a section-0e "⚖ Discipline check" heading when the block above shows any 🚨 or ⚠ item, or when it's the ${weeklyHeartbeat ? "weekly heartbeat" : "compliance section"}. Otherwise skip the section (silence = good day).`);
  lines.push(`  - If hard-stop violations are open (still held past exit window), instruct EXIT AT MARKET on the specific ticker(s) in section 0c and re-cite the compliance number.`);
  lines.push(`  - If take rate is <40%, note it once matter-of-factly ("acted on 4 of 12 setups this month") — the operator is the binding constraint at low take rates.`);
  return lines.join("\n");
}
