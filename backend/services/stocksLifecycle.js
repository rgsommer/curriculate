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

  return { rows, tlhCandidates, capGainsCandidates, totalUnrealizedCad };
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
    }
    lines.push("  ⚠ Canadian superficial-loss rule: do NOT repurchase the same security within 30 days (calendar) before or after the sale, OR the loss is denied. To maintain similar exposure, use a CORRELATED but non-identical name (e.g. RUM → GOOGL/SNAP, DJT → no equivalent — accept the gap).");
  }
  if (lc.capGainsCandidates.length > 0) {
    lines.push("");
    lines.push("📈 LARGE UNREALIZED GAINS in non-registered (capital-gains planning):");
    for (const r of lc.capGainsCandidates) {
      lines.push(`  • ${r.ticker} in ${r.account}: +$${r.unrealizedCad.toFixed(0)} CAD gain (${r.unrealizedPct.toFixed(1)}%) — selling in this calendar year creates a tax event`);
    }
  }

  lines.push("");
  lines.push(`Total unrealized P&L: ${lc.totalUnrealizedCad >= 0 ? "+" : "−"}$${Math.abs(lc.totalUnrealizedCad).toFixed(0)} CAD`);
  lines.push("");
  lines.push("How to use this in recs:");
  lines.push("- Don't recommend SELLs of large winners in non-registered without flagging the tax implication.");
  lines.push("- Actively recommend TLH swaps for non-registered losers when listed above.");
  lines.push("- When recommending a SELL of a position currently down >50%, acknowledge the psychological asymmetry (the loss is realized whether you sell or not).");
  lines.push("- When a position has NO COST BASIS recorded, note that the P&L story is incomplete — but the trade can still proceed.");
  return lines.join("\n");
}
