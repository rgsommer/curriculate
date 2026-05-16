// backend/services/stocksLifecycle.js
//
// Per-position lifecycle summary the AI gets injected into every advice
// prompt. Surfaces what a senior analyst would think about reflexively:
//   - "you bought DJT at avg $24, you're down 63% — accept the loss"
//   - "RUM down 56% in non-registered = $4.4K harvestable loss"
//   - "Watch the Canadian superficial-loss rule (30 days) before buying back"
//
// No external API calls — works entirely off StocksPortfolio + the trade
// journal that's already in Mongo.

import StocksTradeJournal from "../models/StocksTradeJournal.js";

const NON_REGISTERED_KEYWORDS = ["non-spousal", "margin", "cash", "non-registered", "taxable"];
const RRSP_KEYWORDS = ["rrsp"];
const TFSA_KEYWORDS = ["tfsa"];

// Static map of "close-enough" substitutes for TLH swap suggestions. The
// goal is to maintain similar exposure for the 30-day superficial-loss
// window without violating the rule (which requires the security to NOT be
// "substantially identical"). These are picks the AI can then validate.
const TLH_SWAP_SUGGESTIONS = {
  // US growth / AI / tech
  TSLA: ["RIVN", "LCID", "F (cycical proxy)"],
  NVDA: ["AMD", "AVGO", "TSM", "SMH (ETF)"],
  AMD:  ["NVDA", "INTC", "AVGO", "SMH (ETF)"],
  PLTR: ["AI (C3.ai)", "SNOW", "MDB"],
  RKLB: ["LMT (broader defense)", "ASTS", "ITA (defense ETF)"],
  BBAI: ["AI (C3.ai)", "PLTR", "ITA (defense ETF)"],
  SOUN: ["AI (C3.ai)", "BBAI", "MTTR"],

  // Social / content / right-of-center internet
  RUM:  ["ROKU", "PARA", "SNAP", "META"],
  DJT:  ["(no clean equivalent — DJT is idiosyncratic; consider IWM or QQQ as broad re-entry vehicle)"],

  // Fintech
  SOFI: ["LC (LendingClub)", "AFRM", "PYPL"],

  // Canadian dividend (sector-similar swaps)
  ENB:  ["PPL.TO", "TRP.TO", "KEY.TO", "ZWU.TO (utility ETF)"],
  BCE:  ["T.TO", "RCI-B.TO", "QCOM (US telco-adjacent)"],
  TD:   ["RY.TO", "BNS.TO", "BMO.TO", "CM.TO", "NA.TO"],
  RY:   ["TD.TO", "BNS.TO", "BMO.TO", "ZEB.TO (bank ETF)"],
  BNS:  ["RY.TO", "TD.TO", "BMO.TO"],
  SU:   ["CNQ.TO", "IMO.TO", "TOU.TO", "XEG.TO (energy ETF)"],
  CNQ:  ["SU.TO", "IMO.TO", "TOU.TO"],

  // Junior miners / spec
  "SLV.V": ["SIL (silver miners ETF)", "PAAS.TO", "FNV.TO"],
};

function getSwapSuggestions(ticker) {
  return TLH_SWAP_SUGGESTIONS[ticker.toUpperCase()] || null;
}

function isYearEndZone() {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan
  // Nov 1 onwards = year-end planning is timely
  return month >= 10; // November or December
}

function daysUntilYearEnd() {
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  return Math.max(0, Math.ceil((yearEnd - now) / 86400000));
}

function classifyAccount(accountName) {
  const lc = String(accountName || "").toLowerCase();
  if (NON_REGISTERED_KEYWORDS.some(k => lc.includes(k))) return "non-registered";
  if (RRSP_KEYWORDS.some(k => lc.includes(k))) return "rrsp";
  if (TFSA_KEYWORDS.some(k => lc.includes(k))) return "tfsa";
  return "other";
}

// Build per-position lifecycle records from the portfolio.
// For each position with cost basis, compute unrealized P&L and TLH eligibility.
export async function computeLifecycle(profile) {
  const positions = profile?.positions || [];
  const accounts = profile?.accounts || [];
  const fx = profile?.fxUsdCad || 1.37;

  // Aggregate by (account, ticker) so we have one row per holding lot
  const rows = [];
  for (const p of positions) {
    if (!p.qty || p.qty <= 0) continue;
    const acctRow = accounts.find(a => a.id === p.acct);
    const acctName = acctRow?.name || "—";
    const acctKind = classifyAccount(acctName);
    const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    const cost = p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
    if (price == null) continue;
    const valueNative = price * p.qty;
    const valueCad = p.ccy === "USD" ? valueNative * fx : valueNative;
    let unrealizedNative = null, unrealizedPct = null, unrealizedCad = null;
    if (cost != null && cost > 0) {
      unrealizedNative = (price - cost) * p.qty;
      unrealizedPct = ((price - cost) / cost) * 100;
      unrealizedCad = p.ccy === "USD" ? unrealizedNative * fx : unrealizedNative;
    }
    rows.push({
      ticker: p.ticker,
      account: acctName,
      acctKind,
      ccy: p.ccy,
      subCcy: p.subCcy || p.ccy,
      qty: p.qty,
      currentPrice: price,
      costBasis: cost,
      valueCad,
      unrealizedPct,
      unrealizedCad,
      unrealizedNative,
    });
  }

  // Identify TLH candidates: positions in non-registered accounts with
  // unrealized loss ≥ 5% AND ≥ $200 CAD in absolute value (else not worth
  // the friction).
  const tlhCandidates = rows
    .filter(r => r.acctKind === "non-registered"
              && r.unrealizedPct != null
              && r.unrealizedPct <= -5
              && r.unrealizedCad <= -200)
    .sort((a, b) => a.unrealizedCad - b.unrealizedCad);

  // Find big winners in non-registered to flag for tax planning
  const capGainsCandidates = rows
    .filter(r => r.acctKind === "non-registered"
              && r.unrealizedPct != null
              && r.unrealizedPct >= 20
              && r.unrealizedCad >= 1000)
    .sort((a, b) => b.unrealizedCad - a.unrealizedCad);

  // Pull first-purchase dates per (email, ticker) from the trade journal
  // so we can estimate days held. Best effort — not every position has a
  // trade record (seed data doesn't).
  const journalByTicker = {};
  try {
    const trades = await StocksTradeJournal
      .find({ email: profile.email, "legs.side": "BUY" })
      .sort({ executedAt: 1 })
      .lean();
    for (const t of trades) {
      for (const leg of t.legs || []) {
        if (leg.side !== "BUY") continue;
        const k = `${leg.ticker}`;
        if (!journalByTicker[k]) {
          journalByTicker[k] = { firstBuyAt: t.executedAt, firstPrice: leg.pricePerShare };
        }
      }
    }
  } catch {}

  for (const r of rows) {
    const j = journalByTicker[r.ticker];
    if (j?.firstBuyAt) {
      r.firstBuyAt = j.firstBuyAt;
      const days = Math.max(0, Math.floor((Date.now() - new Date(j.firstBuyAt).getTime()) / 86400000));
      r.daysHeld = days;
    }
  }

  // Total unrealized across the book
  const totalUnrealizedCad = rows.reduce((s, r) => s + (r.unrealizedCad || 0), 0);

  // Attach swap suggestions to each TLH candidate (for the AI to validate)
  for (const r of tlhCandidates) {
    r.swapSuggestions = getSwapSuggestions(r.ticker);
  }

  // Pull recently-realized losses from the journal (SELLs in the last 30
  // days where the sell price was below the avg cost basis of the position).
  // These create a superficial-loss window — buying the same security back
  // within 30 days denies the loss.
  const recentSellLosses = [];
  try {
    const recentSells = await StocksTradeJournal.find({
      email: profile.email,
      executedAt: { $gte: new Date(Date.now() - 30 * 86400 * 1000) },
      "legs.side": "SELL",
    }).lean();
    for (const t of recentSells) {
      for (const leg of t.legs || []) {
        if (leg.side !== "SELL") continue;
        const daysAgo = Math.ceil((Date.now() - new Date(t.executedAt).getTime()) / 86400000);
        const expiresInDays = Math.max(0, 30 - daysAgo);
        recentSellLosses.push({
          ticker: leg.ticker,
          executedAt: t.executedAt,
          daysAgo,
          expiresInDays,
          accountName: t.accountName,
        });
      }
    }
  } catch {}

  // Year-end tax timing
  const yearEnd = isYearEndZone();
  const daysToYearEnd = daysUntilYearEnd();

  return {
    rows, tlhCandidates, capGainsCandidates, totalUnrealizedCad,
    recentSellLosses, yearEnd, daysToYearEnd,
  };
}

// Format as a prompt block. Compact but information-dense.
export function formatLifecycleBlock(lc) {
  if (!lc || !lc.rows || lc.rows.length === 0) return "";
  const lines = [];
  lines.push("POSITION LIFECYCLE (per-position cost basis, unrealized P&L, tax considerations):");

  // Compact per-position table
  for (const r of lc.rows) {
    const ccy = r.ccy;
    if (r.costBasis == null) {
      lines.push(`  ${r.ticker} (${r.account}, ${r.subCcy}-sub): ${r.qty} sh @ $${r.currentPrice.toFixed(2)} ${ccy} · NO COST BASIS — P&L unknown`);
    } else {
      const sign = (r.unrealizedPct ?? 0) >= 0 ? "+" : "";
      const heldStr = r.daysHeld != null ? ` · held ${r.daysHeld}d` : "";
      lines.push(`  ${r.ticker} (${r.account}, ${r.subCcy}-sub): ${r.qty} sh @ $${r.currentPrice.toFixed(2)} ${ccy} · cost $${r.costBasis.toFixed(2)} → ${sign}${r.unrealizedPct.toFixed(1)}% ($${(r.unrealizedCad >= 0 ? "+" : "−")}${Math.abs(r.unrealizedCad).toFixed(0)} CAD)${heldStr}`);
    }
  }

  if (lc.tlhCandidates.length > 0) {
    lines.push("");
    lines.push("🍂 TAX-LOSS HARVEST CANDIDATES (non-registered positions with losses ≥ 5% and ≥ $200 CAD):");
    for (const r of lc.tlhCandidates) {
      lines.push(`  • ${r.ticker} in ${r.account}: $${Math.abs(r.unrealizedCad).toFixed(0)} CAD harvestable loss (${r.unrealizedPct.toFixed(1)}% drawdown on $${(r.valueCad).toFixed(0)})`);
      if (r.swapSuggestions && r.swapSuggestions.length) {
        lines.push(`    → Maintain exposure during the 30-day window via a swap: ${r.swapSuggestions.join(", ")}`);
      }
    }
    lines.push("");
    lines.push("  ⚠ Canadian superficial-loss rule: do NOT repurchase the same security within 30 calendar days before OR after the sale (also applies to your spouse's purchases) — otherwise the loss is denied. Suggested swap candidates above maintain similar exposure without violating the rule. Always confirm the swap isn't \"substantially identical\" per CRA.");
  }
  if (lc.capGainsCandidates.length > 0) {
    lines.push("");
    lines.push("📈 LARGE UNREALIZED GAINS in non-registered (capital-gains planning):");
    for (const r of lc.capGainsCandidates) {
      lines.push(`  • ${r.ticker} in ${r.account}: +$${r.unrealizedCad.toFixed(0)} CAD gain (${r.unrealizedPct.toFixed(1)}%) — selling triggers capital gains tax (50% inclusion at marginal rate)`);
    }
  }

  // Recently-realized losses — anything within 30 days is "in the window"
  if (lc.recentSellLosses && lc.recentSellLosses.length > 0) {
    lines.push("");
    lines.push("⏳ RECENT SELLS — 30-DAY SUPERFICIAL-LOSS WINDOW ACTIVE:");
    for (const s of lc.recentSellLosses) {
      lines.push(`  • Sold ${s.ticker} ${s.daysAgo}d ago in ${s.accountName} — window closes in ${s.expiresInDays}d. Re-buying ${s.ticker} before then will DENY any harvested loss.`);
    }
  }

  // Year-end timing flag
  if (lc.yearEnd) {
    lines.push("");
    lines.push(`📅 YEAR-END TAX TIMING: ${lc.daysToYearEnd} days until Dec 31 — last opportunity to realize losses or gains in the current tax year. After this date, harvested losses count for NEXT year's return.`);
    if (lc.tlhCandidates.length > 0) {
      lines.push("    ACT NOW on TLH candidates above if you want them to offset current-year gains.");
    }
  }

  lines.push("");
  lines.push(`Total unrealized P&L: ${lc.totalUnrealizedCad >= 0 ? "+" : "−"}$${Math.abs(lc.totalUnrealizedCad).toFixed(0)} CAD`);
  lines.push("");
  lines.push("How to use this in recs:");
  lines.push("- Don't recommend SELLs of large winners in non-registered without flagging the tax implication.");
  lines.push("- ACTIVELY recommend TLH swaps for non-registered losers — when a candidate is listed above, propose: (a) the SELL with $ proceeds, (b) the SWAP target chosen from the suggestions to maintain exposure, (c) the buy-back date (sell date + 31 days) when the original name can be re-entered without violating the superficial-loss rule.");
  lines.push("- If a 30-day window is ACTIVE on a ticker, do NOT recommend buying it back. Wait.");
  lines.push("- In year-end zone (Nov-Dec), prioritize TLH ahead of other moves — it's a once-a-year opportunity.");
  lines.push("- When recommending a SELL of a position down >50%, acknowledge the psychological asymmetry: the unrealized loss is real whether you sell or not.");
  lines.push("- When a position has NO COST BASIS recorded, note that the P&L story is incomplete — but the trade can still proceed.");
  return lines.join("\n");
}
