// backend/services/stocksHorizonReview.js
//
// Horizon review — for every open BUY rec, computes where the position
// stands relative to its stated 10/14/30-day window. Used by:
//   1. The morning briefing (adds a "## 📅 Horizon review" section)
//   2. The horizon-expiry cron (fires an email + status update the day
//      a rec hits horizonDays without target/stop firing)
//
// On-pace heuristic (BUY recs only — SELL exits are binary, not
// progressive):
//   expected pace   = daysElapsed / horizonDays  (linear fraction of
//                                                 the window used)
//   actual pace     = (current - entry) / (target - entry) — how much
//                     of the round-trip toward target has been captured
//   status:
//     🟢 on-pace       actual >= expected * 0.85
//     🟡 lagging       actual >= expected * 0.4
//     🔴 well-behind   below that OR gone negative
//     ✅ hit-target    actual >= 1
//     ⌛ expired       daysElapsed >= horizonDays (regardless of pace)
//     🛑 hit-stop      current <= stop (rec status will already say
//                     stop-hit, but included for completeness)

import StocksAdviceRec from "../models/StocksAdviceRec.js";

// Resolve rec → exchange symbol (CAD rec → .TO if not already suffixed).
function symbolFor(rec) {
  const t = String(rec.ticker || "").toUpperCase();
  return rec.entryCurrency === "CAD" && !/\.[A-Z]+$/.test(t) ? `${t}.TO` : t;
}

// Inline copy of the Yahoo current-price fetcher — mirror of the
// helpers in stocksDailyBriefing / stocksAdvice / stocksDiscover.
// Kept local so this service has no cross-cutting import order issues.
async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate Horizon)" } });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return Number.isFinite(px) ? px : null;
  } catch { return null; }
}

function classifyStatus({ daysElapsed, horizonDays, entry, current, target, stop }) {
  // Time expiry is checked BEFORE the price-required checks so a Yahoo
  // whiff (thin ticker, delisted, transient 429) doesn't leave the rec
  // permanently open. Users saw BBAI (Jul 18) and DJT (Jul 20) sitting
  // in "Next 7 days" three weeks past their horizon because the fetcher
  // returned null and the classifier short-circuited to "unknown" —
  // which the expiry cron skips.
  if (daysElapsed >= horizonDays) return "expired";
  if (!Number.isFinite(current)) return "unknown";
  if (Number.isFinite(stop) && current <= stop) return "hit-stop";
  if (Number.isFinite(target) && current >= target) return "hit-target";
  if (!Number.isFinite(entry) || !Number.isFinite(target) || target <= entry) return "unknown";

  // Pace = actual progress toward target ÷ expected progress at this
  // elapsed fraction of the horizon.
  //   expectedFraction = daysElapsed / horizonDays   (linear expectation)
  //   actualFraction   = (current - entry) / (target - entry)
  //   pace             = actualFraction / expectedFraction
  //
  // Per audit feedback: NEVER label a position "well-behind" purely
  // because distance remains to target — it's about pace, not raw
  // distance. Two guardrails:
  //   1) During the first 40% of the horizon, a poor pace is downgraded
  //      to "lagging" at worst (never "well-behind"). Early flat is not
  //      thesis-broken.
  //   2) A position that's above entry (actualFraction > 0) but running
  //      slow is at worst "lagging", never "well-behind" — well-behind
  //      requires the position to have regressed AGAINST entry.
  const expectedFraction = daysElapsed / horizonDays;
  const actualFraction = (current - entry) / (target - entry);
  const pace = expectedFraction > 0 ? actualFraction / expectedFraction : 1;
  if (pace >= 0.85) return "on-pace";
  if (expectedFraction < 0.4) return "lagging";        // guardrail #1
  if (actualFraction > 0 && pace >= 0.4) return "lagging";
  if (actualFraction > 0) return "lagging";            // guardrail #2
  return "well-behind";                                 // actualFraction ≤ 0 AND past 40% of horizon
}

function emojiFor(status) {
  return {
    "on-pace": "🟢",
    "lagging": "🟡",
    "well-behind": "🔴",
    "hit-target": "✅",
    "hit-stop": "🛑",
    "expired": "⌛",
    "unknown": "⚪",
  }[status] || "⚪";
}

// Build the full review dataset for one user's OPEN recs. `priceMap`
// is optional — pass it when the caller already has fresh prices,
// otherwise the service fetches them.
export async function computeHorizonReview(email, { priceMap = null } = {}) {
  const rawRecs = await StocksAdviceRec.find({
    email,
    status: "open",
    action: "BUY",
    horizonDays: { $gt: 0 },
    entryPrice: { $gt: 0 },
  }).sort({ generatedAt: 1 }).lean();
  if (rawRecs.length === 0) return [];
  // Held-position filter — a rec whose base ticker no longer matches any
  // held position is a stale open rec (the user sold but nothing closed
  // the linked rec). Surfacing those as "well-behind" is noise. User
  // Aug 8: "DUOL / ENB / XLU keep showing well-behind but I don't hold
  // them". Cheap to fetch the profile positions here; keeps this
  // service self-contained.
  let recs = rawRecs;
  try {
    const { default: StocksPortfolio } = await import("../models/StocksPortfolio.js");
    const profile = await StocksPortfolio.findOne({ email }).select({ positions: 1 }).lean();
    const heldBases = new Set(
      (profile?.positions || [])
        .filter(p => (p?.qty || 0) > 0)
        .map(p => String(p.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean)
    );
    if (heldBases.size > 0) {
      const baseOf = t => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
      recs = rawRecs.filter(r => heldBases.has(baseOf(r.ticker)));
    }
  } catch { /* fail-open — if the portfolio fetch fails, show everything (old behavior) */ }
  if (recs.length === 0) return [];

  // Fetch prices per unique resolved symbol if not provided.
  const symbols = [...new Set(recs.map(symbolFor).filter(Boolean))];
  const localPriceMap = priceMap || {};
  if (!priceMap) {
    await Promise.all(symbols.map(async (sym) => {
      try { localPriceMap[sym] = await fetchCurrentPrice(sym); }
      catch { localPriceMap[sym] = null; }
    }));
  }

  const now = Date.now();
  return recs.map((rec) => {
    const daysElapsed = Math.max(0, Math.round((now - new Date(rec.generatedAt).getTime()) / 86400000));
    const horizonDays = rec.horizonDays || 30;
    const currentPrice = localPriceMap[symbolFor(rec)];
    const status = classifyStatus({
      daysElapsed,
      horizonDays,
      entry: rec.entryPrice,
      current: currentPrice,
      target: rec.targetPrice,
      stop: rec.stopPrice,
    });
    const deltaToTargetPct = (Number.isFinite(rec.targetPrice) && Number.isFinite(currentPrice) && currentPrice > 0)
      ? ((rec.targetPrice - currentPrice) / currentPrice) * 100
      : null;
    const daysRemaining = Math.max(0, horizonDays - daysElapsed);
    const dailyRequiredPct = (deltaToTargetPct != null && daysRemaining > 0)
      ? deltaToTargetPct / daysRemaining
      : null;
    return {
      recId: String(rec._id),
      ticker: rec.ticker,
      currency: rec.entryCurrency || "USD",
      entry: rec.entryPrice,
      current: currentPrice,
      target: rec.targetPrice,
      stop: rec.stopPrice,
      daysElapsed,
      horizonDays,
      daysRemaining,
      horizonPct: horizonDays > 0 ? (daysElapsed / horizonDays) * 100 : null,
      deltaToTargetPct,
      dailyRequiredPct,
      status,
      emoji: emojiFor(status),
    };
  });
}

export function formatHorizonReviewBlock(rows) {
  if (!rows || rows.length === 0) return "";
  // Sort: expired/hit-stop/well-behind first, then lagging, then on-pace/hit-target
  const priority = { expired: 0, "hit-stop": 1, "well-behind": 2, lagging: 3, "on-pace": 4, "hit-target": 5, unknown: 6 };
  const sorted = rows.slice().sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  const lines = [
    `\nHORIZON REVIEW (open BUY recs — where each stands vs its stated window):`,
  ];
  for (const r of sorted) {
    const cur = r.current != null ? `$${r.current.toFixed(2)}` : "n/a";
    const tgt = r.target != null ? `$${r.target.toFixed(2)}` : "n/a";
    const delta = r.deltaToTargetPct != null ? `${r.deltaToTargetPct >= 0 ? "+" : ""}${r.deltaToTargetPct.toFixed(1)}%` : "n/a";
    const daily = r.dailyRequiredPct != null ? `~${r.dailyRequiredPct >= 0 ? "+" : ""}${r.dailyRequiredPct.toFixed(2)}%/d` : "";
    lines.push(
      `  ${r.emoji} ${r.ticker} · day ${r.daysElapsed}/${r.horizonDays} · entry $${r.entry?.toFixed(2)} → now ${cur} · target ${tgt} (Δ ${delta}${daily ? `, needs ${daily}` : ""}) · status: ${r.status}`
    );
  }
  const expiredCount = sorted.filter(r => r.status === "expired").length;
  const wellBehindCount = sorted.filter(r => r.status === "well-behind").length;
  lines.push(`\nHow to use in section 4 or a dedicated "## 📅 Horizon review" section:`);
  lines.push(`  - ⌛ EXPIRED (${expiredCount}) — surface each with a one-line recommendation: EXIT, ROLL (with a specific reason), or TRIM. Doing nothing is a ROLL by default; make the choice explicit.`);
  lines.push(`  - 🔴 WELL-BEHIND (${wellBehindCount}) — the position hasn't tracked toward target. Ask: has the thesis broken, or is time still on our side? If today's price is closer to STOP than target, discuss the exit criteria.`);
  lines.push(`  - 🟡 LAGGING — noted but no action; still within stop, still has runway.`);
  lines.push(`  - 🟢 ON-PACE / ✅ HIT-TARGET — one line acknowledgement, no action items.`);
  lines.push(`  - Cite specific numbers verbatim from the block above (day, entry, current, target, delta, required-daily) — don't paraphrase.`);
  return lines.join("\n");
}
