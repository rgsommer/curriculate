// backend/services/stocksRiskBudget.js
//
// Formal risk-budget layer. Two related but independent controls:
//
// (a) PORTFOLIO 1-day VaR (Value-at-Risk).
//     Computes each held position's 1-day 95% and 99% VaR using its
//     annualized volatility (from stocksTechnicals). Portfolio VaR is
//     the sum of position VaRs — deliberately conservative (assumes
//     zero diversification benefit; a real risk system would use the
//     correlation matrix). Compared against a book-wide budget:
//       LIMIT_VAR_PCT_95 = 2%      "no single day should risk >2% of book"
//       LIMIT_VAR_PCT_99 = 4%      "even in a bad tail we cap at 4%"
//     Headroom = LIMIT − USED. Breach when USED > LIMIT.
//
// (b) LOSS COOLDOWN.
//     Two triggers can pause new positions:
//       • Recent-losses streak: last N closed round-trips are all losers
//         (default N=3) → 2 trading day pause
//       • Daily drawdown: WoW change or 1-day snapshot delta below
//         -X% (default -2%) → 1 trading day pause
//     A pause doesn't block orders — it's an ADVISORY that the briefing
//     surfaces so the trader knows the discipline signal fired.
//
// Both feed the daily briefing and a Dashboard chip.

import StocksTradeJournal from "../models/StocksTradeJournal.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";

const LIMIT_VAR_PCT_95 = 2.0;   // % of book
const LIMIT_VAR_PCT_99 = 4.0;
const Z_95 = 1.645;
const Z_99 = 2.326;

const LOSS_STREAK_N = 3;
const LOSS_STREAK_COOLDOWN_DAYS = 2;
const DAILY_DRAWDOWN_PCT = -2.0;
const DAILY_DRAWDOWN_COOLDOWN_DAYS = 1;

// Compute per-position VaR + portfolio VaR + budget headroom.
// techByTicker is an OPTIONAL { ticker → { annualizedVolPct, last } }
// map — when not passed, positions with no vol data get skipped.
export function computePortfolioVar({ positions, fxUsdCad = 1.37, techByTicker = {} }) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { positionVars: [], portfolioVar95Cad: 0, portfolioVar99Cad: 0, bookValueCad: 0 };
  }
  let bookValueCad = 0;
  const positionVars = [];
  for (const p of positions) {
    const t = String(p.ticker || "").toUpperCase();
    const qty = p.qty || 0;
    if (qty <= 0) continue;
    const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    if (!(price > 0)) continue;
    const valueCcy = price * qty;
    const valueCad = p.ccy === "USD" ? valueCcy * fxUsdCad : valueCcy;
    bookValueCad += valueCad;
    // Look up annualized vol either by exact ticker or by base ticker
    const base = t.replace(/\..*$/, "");
    const tech = techByTicker[t] || techByTicker[base];
    const annualizedVolPct = tech?.annualizedVolPct;
    if (!Number.isFinite(annualizedVolPct)) continue;
    const dailyVolPct = annualizedVolPct / Math.sqrt(252);
    const oneDayVar95Cad = valueCad * (dailyVolPct / 100) * Z_95;
    const oneDayVar99Cad = valueCad * (dailyVolPct / 100) * Z_99;
    positionVars.push({
      ticker: t, valueCad, dailyVolPct, annualizedVolPct,
      oneDayVar95Cad, oneDayVar99Cad,
      pctOfBook: null, // filled after we know the total
    });
  }
  const portfolioVar95Cad = positionVars.reduce((s, r) => s + r.oneDayVar95Cad, 0);
  const portfolioVar99Cad = positionVars.reduce((s, r) => s + r.oneDayVar99Cad, 0);
  for (const r of positionVars) r.pctOfBook = bookValueCad > 0 ? (r.valueCad / bookValueCad) * 100 : null;
  // Sort by VaR contribution descending — the risk hogs first.
  positionVars.sort((a, b) => b.oneDayVar95Cad - a.oneDayVar95Cad);
  const budgetLimit95Cad = bookValueCad * (LIMIT_VAR_PCT_95 / 100);
  const budgetLimit99Cad = bookValueCad * (LIMIT_VAR_PCT_99 / 100);
  const usedPct95 = bookValueCad > 0 ? (portfolioVar95Cad / bookValueCad) * 100 : 0;
  const usedPct99 = bookValueCad > 0 ? (portfolioVar99Cad / bookValueCad) * 100 : 0;
  return {
    positionVars,
    portfolioVar95Cad,
    portfolioVar99Cad,
    bookValueCad,
    limits: { pct95: LIMIT_VAR_PCT_95, pct99: LIMIT_VAR_PCT_99, cad95: budgetLimit95Cad, cad99: budgetLimit99Cad },
    used: { pct95: usedPct95, pct99: usedPct99 },
    headroomCad95: budgetLimit95Cad - portfolioVar95Cad,
    headroomCad99: budgetLimit99Cad - portfolioVar99Cad,
    breach95: usedPct95 > LIMIT_VAR_PCT_95,
    breach99: usedPct99 > LIMIT_VAR_PCT_99,
    coverageCount: positionVars.length,
    totalCount: (positions || []).filter(p => (p.qty || 0) > 0).length,
  };
}

// Detect a loss cooldown from recent trade history + snapshot deltas.
// Returns { active, reason, cooldownUntil, streak, dailyDrawdownPct }.
export async function computeLossCooldown(email) {
  const now = Date.now();
  const streakSince = new Date(now - 30 * 86400000);
  // Look at recent trades in reverse-chronological order. Count SELL
  // trades whose linked-rec's pnlPct is negative — this is an approximation
  // (a true round-trip P&L would compare against enteredPrice), but good
  // enough as a first-order streak detector.
  let recentTrades = [];
  try {
    recentTrades = await StocksTradeJournal.find({
      email,
      executedAt: { $gte: streakSince },
    }).sort({ executedAt: -1 }).limit(20).lean();
  } catch { /* best-effort */ }
  // Streak counting: walk backward through SELL trades, break at the
  // first non-negative outcome. Use notes.match for pnl detection.
  let streak = 0;
  const streakSamples = [];
  for (const t of recentTrades) {
    const sellLeg = (t.legs || []).find(l => l.side === "SELL");
    if (!sellLeg) continue;
    // Attempt to derive P&L from linkedAdviceRecId's entry vs sell fill,
    // or from the recorded notes. As a MVP just look at whether the SELL
    // fill was below the linked-rec entry. Missing → treat as "unknown"
    // and stop counting (don't count unknowns toward or against streak).
    // For the FIRST cut we simply count SELLs with a note containing
    // "-<digit>" or "$-" as losers. Refinement is fair game later.
    const notesStr = String(t.notes || "");
    const looksLikeLoss = /(-\d+(\.\d+)?%|loss|stopped out|hit stop|below basis)/i.test(notesStr);
    const looksLikeWin = /(\+\d+(\.\d+)?%|gain|profit|target hit)/i.test(notesStr);
    if (looksLikeLoss && !looksLikeWin) {
      streak++;
      streakSamples.push({ ticker: sellLeg.ticker, executedAt: t.executedAt });
      if (streak >= LOSS_STREAK_N + 2) break; // no need to walk further
    } else if (looksLikeWin) {
      break;
    }
    // notes without a clear outcome → continue walking (don't break, don't count)
  }

  // Daily drawdown: compare the two most-recent portfolio snapshots.
  let dailyDrawdownPct = null;
  try {
    const snaps = await StocksPortfolioSnapshot.find({ email }).sort({ takenAt: -1 }).limit(2).lean();
    if (snaps.length === 2 && snaps[0].totalCad > 0 && snaps[1].totalCad > 0) {
      dailyDrawdownPct = ((snaps[0].totalCad - snaps[1].totalCad) / snaps[1].totalCad) * 100;
    }
  } catch { /* best-effort */ }

  const reasons = [];
  let cooldownDays = 0;
  if (streak >= LOSS_STREAK_N) {
    reasons.push(`${streak} losing trades in a row — LOSS_STREAK_N=${LOSS_STREAK_N} threshold reached`);
    cooldownDays = Math.max(cooldownDays, LOSS_STREAK_COOLDOWN_DAYS);
  }
  if (dailyDrawdownPct != null && dailyDrawdownPct <= DAILY_DRAWDOWN_PCT) {
    reasons.push(`portfolio down ${dailyDrawdownPct.toFixed(2)}% day-over-day (≤ ${DAILY_DRAWDOWN_PCT}% threshold)`);
    cooldownDays = Math.max(cooldownDays, DAILY_DRAWDOWN_COOLDOWN_DAYS);
  }
  return {
    active: cooldownDays > 0,
    reasons,
    cooldownDays,
    cooldownUntil: cooldownDays > 0 ? new Date(now + cooldownDays * 86400000) : null,
    streak,
    streakSamples: streakSamples.slice(0, 5),
    dailyDrawdownPct,
    thresholds: {
      streakN: LOSS_STREAK_N,
      dailyDrawdownPct: DAILY_DRAWDOWN_PCT,
    },
  };
}

// Format the risk-budget block for the AI briefing prompt.
export function formatRiskBudgetBlock(varState, cooldownState) {
  const parts = [];
  if (varState && varState.bookValueCad > 0) {
    const b = varState;
    parts.push(`\nRISK BUDGET (portfolio 1-day VaR — assumes zero diversification benefit; a real-world number is 20-40% lower after correlation adjustment):`);
    parts.push(`  95% VaR: $${Math.round(b.portfolioVar95Cad).toLocaleString()} CAD (${b.used.pct95.toFixed(2)}% of $${Math.round(b.bookValueCad).toLocaleString()} book) · budget limit ${b.limits.pct95}% · headroom $${Math.round(b.headroomCad95).toLocaleString()} CAD${b.breach95 ? " · 🚨 BREACHED" : ""}`);
    parts.push(`  99% VaR: $${Math.round(b.portfolioVar99Cad).toLocaleString()} CAD (${b.used.pct99.toFixed(2)}% of book) · budget limit ${b.limits.pct99}% · headroom $${Math.round(b.headroomCad99).toLocaleString()} CAD${b.breach99 ? " · 🚨 BREACHED" : ""}`);
    parts.push(`  Coverage: ${b.coverageCount}/${b.totalCount} positions have vol data (the rest are skipped from the sum — treat the number as a lower bound).`);
    if (b.positionVars.length > 0) {
      parts.push(`  Top VaR contributors:`);
      for (const r of b.positionVars.slice(0, 5)) {
        parts.push(`    ${r.ticker}: $${Math.round(r.oneDayVar95Cad).toLocaleString()} CAD (${(r.oneDayVar95Cad / b.portfolioVar95Cad * 100).toFixed(1)}% of VaR) · position $${Math.round(r.valueCad).toLocaleString()} (${r.pctOfBook?.toFixed(1)}% of book) · annualized vol ${r.annualizedVolPct.toFixed(0)}%`);
      }
    }
    if (b.breach95 || b.breach99) {
      parts.push(`  When BREACHED: section 4 (Today's one action) and section 7 (SPEC ideas) must NOT propose new BUY positions until VaR headroom returns. Only defensive TRIM/EXIT recs on the top VaR contributors above.`);
    }
  }
  if (cooldownState?.active) {
    parts.push(`\n🚨 LOSS COOLDOWN ACTIVE — no new positions until ${cooldownState.cooldownUntil?.toISOString().slice(0, 10)}:`);
    for (const r of cooldownState.reasons) parts.push(`  - ${r}`);
    parts.push(`  Sections 4, 7, 8 must ONLY produce MANAGE-EXISTING calls (HOLD / TRIM / EXIT) on held positions. NO new BUY recs, NO fresh SPEC ideas, NO fresh SWING picks. Recite the cooldown reason in the briefing so the trader knows why nothing new was proposed.`);
  } else if (cooldownState) {
    if (cooldownState.streak > 0) parts.push(`\n(Loss streak monitor: ${cooldownState.streak}/${cooldownState.thresholds.streakN} losing trades — under the cooldown trigger.)`);
    if (cooldownState.dailyDrawdownPct != null && cooldownState.dailyDrawdownPct < 0) parts.push(`(Daily drawdown: ${cooldownState.dailyDrawdownPct.toFixed(2)}% — cooldown fires at ≤ ${cooldownState.thresholds.dailyDrawdownPct}%.)`);
  }
  return parts.join("\n");
}
