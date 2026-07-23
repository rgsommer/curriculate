// backend/services/stocksJournalReconstruct.js
//
// The definitive "expected vs actual" audit. Walks every applied trade
// in the journal, sums BUY - SELL shares per (account, ticker, subCcy)
// and cash deltas per (account, currency), and compares the reconstruction
// against the current portfolio.positions + portfolio.accounts state.
//
// Value proposition: any drift here = a bug or an unexplained manual
// edit. Fixing every drift closes the "why do I keep reconciling?"
// loop for good.
//
// The audit does NOT know about pre-journal baseline positions. If the
// trader had holdings before this app started tracking, those show up
// as "actual > 0, implied = 0" — which is fine and gets tagged
// "pre-journal / manual" rather than "drift". True drift is when actual
// AND implied are both nonzero but differ — that's a double-application,
// or an unreverted deletion, or a stray manual edit.

import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

const CLEAN_MULTIPLE_TOLERANCE = 0.05; // ratio within 5% of an integer counts as "clean multiple"

function keyPos(acctId, ticker, subCcy) {
  const t = String(ticker || "").toUpperCase();
  const s = subCcy || "USD";
  return `${acctId}|${t}|${s}`;
}

function tagForDelta(implied, actual) {
  const delta = actual - implied;
  if (Math.abs(delta) < 0.0001) return { level: "ok", label: "clean · matches journal" };
  if (Math.abs(implied) < 0.0001) return { level: "pre-journal", label: "pre-journal / manual entry (implied = 0)" };
  if (Math.abs(actual) < 0.0001) return { level: "drift", label: "actual = 0 but journal implies you own some — deletion without reversal?" };
  // Check if delta is a clean multiple of implied — smells like N× duplicate.
  const ratio = actual / implied;
  const near = (x) => Math.abs(x - Math.round(x)) < CLEAN_MULTIPLE_TOLERANCE;
  if (ratio > 1.5 && near(ratio)) return { level: "duplicate", label: `looks like ${Math.round(ratio)}× duplicate application` };
  return { level: "drift", label: `journal implies ${implied.toFixed(0)}, actual is ${actual.toFixed(0)} — investigate` };
}

// Walk applied trades and reconstruct positions + cash.
export async function reconstructFromJournal(email) {
  const [portfolio, trades] = await Promise.all([
    StocksPortfolio.findOne({ email }).lean(),
    StocksTradeJournal.find({ email, positionApplied: true }).sort({ executedAt: 1 }).lean(),
  ]);
  if (!portfolio) throw new Error("No portfolio");
  const fx = portfolio.fxUsdCad || 1.37;

  // Implied maps
  const impliedShares = new Map(); // "acct|ticker|subCcy" → shares
  const impliedCashByAcctCcy = new Map(); // "acct|currency" → cash delta

  for (const t of trades) {
    const acctId = t.account || "";
    for (const leg of t.legs || []) {
      if (!leg.ticker) continue;
      const settleCcy = leg.settleCcy || leg.currency || "USD";
      // Position side
      if (leg.side === "BUY" || leg.side === "SELL") {
        const sign = leg.side === "BUY" ? 1 : -1;
        const k = keyPos(acctId, leg.ticker, settleCcy);
        impliedShares.set(k, (impliedShares.get(k) || 0) + sign * (leg.shares || 0));
      }
      // Cash side — same as adjustAccountCash in the applier.
      const gross = leg.currency === settleCcy
        ? Number(leg.grossValue) || (leg.pricePerShare || 0) * (leg.shares || 0)
        : (leg.currency === "USD"
            ? (Number(leg.grossValue) || (leg.pricePerShare || 0) * (leg.shares || 0)) * fx
            : (Number(leg.grossValue) || (leg.pricePerShare || 0) * (leg.shares || 0)) / fx);
      const cashSign = (leg.side === "SELL" || leg.side === "DEPOSIT") ? 1 : -1;
      const cashKey = `${acctId}|${settleCcy}`;
      impliedCashByAcctCcy.set(cashKey, (impliedCashByAcctCcy.get(cashKey) || 0) + cashSign * gross);
    }
  }

  // Actual maps
  const actualShares = new Map();
  const actualCashByAcctCcy = new Map();
  for (const p of portfolio.positions || []) {
    const sub = p.subCcy || p.ccy || "USD";
    const k = keyPos(p.acct, p.ticker, sub);
    actualShares.set(k, (actualShares.get(k) || 0) + (p.qty || 0));
  }
  for (const a of portfolio.accounts || []) {
    actualCashByAcctCcy.set(`${a.id}|CAD`, (actualCashByAcctCcy.get(`${a.id}|CAD`) || 0) + (a.cashCad || 0));
    actualCashByAcctCcy.set(`${a.id}|USD`, (actualCashByAcctCcy.get(`${a.id}|USD`) || 0) + (a.cashUsd || 0));
  }

  // Build the position diff rows.
  const positionRows = [];
  const posKeys = new Set([...impliedShares.keys(), ...actualShares.keys()]);
  for (const k of posKeys) {
    const [acctId, ticker, subCcy] = k.split("|");
    const implied = impliedShares.get(k) || 0;
    const actual = actualShares.get(k) || 0;
    if (Math.abs(implied) < 0.0001 && Math.abs(actual) < 0.0001) continue;
    const tag = tagForDelta(implied, actual);
    const acct = (portfolio.accounts || []).find(a => a.id === acctId);
    positionRows.push({
      account: acct?.name || acctId,
      accountId: acctId,
      ticker, subCcy,
      impliedShares: implied,
      actualShares: actual,
      delta: actual - implied,
      tag,
    });
  }

  const cashRows = [];
  const cashKeys = new Set([...impliedCashByAcctCcy.keys(), ...actualCashByAcctCcy.keys()]);
  for (const k of cashKeys) {
    const [acctId, currency] = k.split("|");
    const implied = impliedCashByAcctCcy.get(k) || 0;
    const actual = actualCashByAcctCcy.get(k) || 0;
    if (Math.abs(implied) < 1 && Math.abs(actual) < 1) continue;
    // For cash the tag is simpler: implied is the NET cashflow of applied
    // trades; actual is CURRENT cash. delta = actual - implied MEANS
    // "unexplained cash inflow" (deposits, dividends, etc.) OR "unexplained
    // outflow" (fees, withdrawals not journaled).
    const delta = actual - implied;
    const acct = (portfolio.accounts || []).find(a => a.id === acctId);
    let level = "ok";
    let label = "matches journal (cash delta explained by trades)";
    // Any delta > $5 in absolute terms deserves a note.
    if (Math.abs(delta) > 5) {
      // Positive delta could be deposits / dividends (normal). Negative could
      // be fees / withdrawals / a phantom debit. Both flag, different tone.
      if (delta > 0) { level = "info"; label = "actual cash > journal implies — likely dividends / deposits not journaled"; }
      else { level = "drift"; label = "actual cash < journal implies — fees or phantom debit; check for unreversed deletions"; }
    }
    cashRows.push({
      account: acct?.name || acctId,
      accountId: acctId,
      currency,
      impliedCash: implied,
      actualCash: actual,
      delta,
      tag: { level, label },
    });
  }

  // Sort: drifts + duplicates first, then pre-journal (info), then clean.
  const order = { drift: 0, duplicate: 1, "pre-journal": 2, info: 3, ok: 4 };
  positionRows.sort((a, b) => (order[a.tag.level] ?? 9) - (order[b.tag.level] ?? 9));
  cashRows.sort((a, b) => (order[a.tag.level] ?? 9) - (order[b.tag.level] ?? 9));

  const summary = {
    tradesConsidered: trades.length,
    positionRows: positionRows.length,
    positionDriftCount: positionRows.filter(r => r.tag.level === "drift" || r.tag.level === "duplicate").length,
    cashRows: cashRows.length,
    cashDriftCount: cashRows.filter(r => r.tag.level === "drift").length,
  };
  return { summary, positionRows, cashRows, generatedAt: new Date() };
}
