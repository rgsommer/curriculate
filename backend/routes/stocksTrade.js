// backend/routes/stocksTrade.js
//
// POST /api/stocks-trade
//   Body: {
//     account: "<account.id>",
//     executedAt: ISO date (optional, defaults to now),
//     legs: [
//       { side: "SELL", ticker: "DJT", shares: 250, price: 8.85, currency: "USD" },
//       { side: "BUY",  ticker: "ENB", shares: 40,  price: 75.50, currency: "CAD" }
//     ],
//     notes: "Reduce DJT concentration",
//     linkedAdviceRecId: "..." (optional)
//   }
//
//   Atomically:
//     • Updates the position rows in StocksPortfolio
//     • Adjusts cost basis on BUYs (weighted average)
//     • Removes positions whose qty hits 0
//     • Writes a StocksTradeJournal entry
//
// GET /api/stocks-trade?days=90
//   Returns recent trade journal entries for the authenticated user.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

const router = express.Router();

// ── auth (same HMAC session-token scheme as the rest of /api/stocks-*) ──
function getSecret() {
  return process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || "";
}
function b64urlDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function b64url(buf) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function verifySessionToken(token) {
  const secret = getSecret();
  if (!secret) return null;
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (payload?.sub !== "stocks-session") return null;
    if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
function requireStocksAuth(req, res, next) {
  const a = req.headers?.authorization || req.headers?.Authorization || "";
  const token = typeof a === "string" && a.startsWith("Bearer ") ? a.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });
  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired session" });
  req.stocksUser = { email: payload.email.toLowerCase() };
  next();
}

// ── helpers ────────────────────────────────────────────────────────
function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Apply a single leg to the portfolio's positions array (mutates).
//
// BUY: if a matching position exists (same account+ticker+currency), increase qty
//   and update price; recompute weighted-average cost basis. Otherwise create a
//   new row.
//
// SELL: deduct FIFO from all matching position rows (handles the case where the
//   same ticker is held across multiple lots in the same account, e.g. DJT in
//   both the CAD-sub and USD-sub of an RRSP). Refuses over-selling against the
//   aggregate. Removes rows that hit zero.
function applyLeg(positions, accountId, leg) {
  const { side, ticker, shares, price, currency } = leg;

  // settleCcy = which CASH SUB the trade settles through; subCcy on the
  // position row is the SAME as settleCcy (since that's where the holding
  // is "parked"). Defaults to the trading currency.
  const settleCcy = leg.settleCcy || currency;

  if (side === "BUY") {
    // Match existing rows by acct + ticker + currency + subCcy so a USD stock
    // bought in CAD sub remains separate from the same stock bought in USD sub.
    const idx = positions.findIndex(
      (p) =>
        p.acct === accountId &&
        p.ticker === ticker &&
        p.ccy === currency &&
        (p.subCcy || p.ccy) === settleCcy
    );
    if (idx >= 0) {
      const existing = positions[idx];
      const oldQty = existing.qty || 0;
      const oldCostKey = currency === "USD" ? "costBasisUsd" : "costBasisCad";
      const newQty = oldQty + shares;
      let newCost = existing[oldCostKey];
      if (existing[oldCostKey] != null && oldQty > 0) {
        newCost = (existing[oldCostKey] * oldQty + price * shares) / newQty;
      } else if (existing[oldCostKey] == null) {
        newCost = price;
      }
      positions[idx] = {
        ...existing,
        qty: newQty,
        [oldCostKey]: newCost,
        ...(currency === "USD" ? { priceUsd: price } : { priceCad: price }),
      };
    } else {
      positions.push({
        acct: accountId,
        ticker,
        name: "",
        qty: shares,
        ccy: currency,
        subCcy: settleCcy,
        ...(currency === "USD"
          ? { priceUsd: price, priceCad: null, costBasisUsd: price, costBasisCad: null }
          : { priceCad: price, priceUsd: null, costBasisCad: price, costBasisUsd: null }),
      });
    }
    return;
  }

  // SELL — aggregate across matching lots (same acct + ticker + currency +
  // matching sub). FIFO deduction within those lots.
  const matchIdxs = positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) =>
      p.acct === accountId &&
      p.ticker === ticker &&
      p.ccy === currency &&
      (p.subCcy || p.ccy) === settleCcy
    )
    .map(({ i }) => i);

  if (matchIdxs.length === 0) {
    throw new Error(`Can't sell ${ticker}: no matching position in this account/currency.`);
  }
  const totalAvail = matchIdxs.reduce((s, i) => s + (positions[i].qty || 0), 0);
  if (totalAvail < shares - 1e-6) {
    throw new Error(`Can't sell ${shares} sh of ${ticker}: only ${totalAvail} on file across all lots.`);
  }

  let remaining = shares;
  // Deduct in array order (first stored = first sold)
  for (const i of matchIdxs) {
    if (remaining <= 1e-6) break;
    const row = positions[i];
    if (row.qty <= remaining + 1e-6) {
      remaining -= row.qty;
      positions[i] = { ...row, qty: 0 }; // mark empty; we'll prune after
    } else {
      positions[i] = {
        ...row,
        qty: row.qty - remaining,
        ...(currency === "USD" ? { priceUsd: price } : { priceCad: price }),
      };
      remaining = 0;
    }
  }
  // Prune zero-qty rows
  for (let i = positions.length - 1; i >= 0; i--) {
    if ((positions[i].qty || 0) <= 1e-6) positions.splice(i, 1);
  }
}

function netCashCadOfTrade(legs, fx) {
  // Cash in: SELL, DEPOSIT. Cash out: BUY, WITHDRAW. Positive net = cash inflow.
  let net = 0;
  for (const leg of legs) {
    const gross = Number(leg.grossValue) || 0;
    const cadValue = leg.currency === "USD" ? gross * fx : gross;
    const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
    net += sign * cadValue;
  }
  return Number.isFinite(net) ? net : 0;
}

// Mutates the account row's cash balance.
//   BUY/WITHDRAW  → cash[bucket] -= grossValue
//   SELL/DEPOSIT  → cash[bucket] += grossValue
//
// `bucket` is the SUB-ACCOUNT cash bucket the trade settles in. Defaults to
// the leg's currency, but a leg can pass `settleCcy` to settle a USD trade
// out of CAD cash (cross-currency purchase) and vice versa.
function adjustAccountCash(account, leg) {
  if (!account) return;
  const settleCcy = leg.settleCcy || leg.currency;
  const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
  const gross = Number(leg.grossValue) || 0;
  const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
  account[cashKey] = (account[cashKey] || 0) + sign * gross;
}

// ── handlers ───────────────────────────────────────────────────────
router.post("/", express.json({ limit: "32kb" }), requireStocksAuth, async (req, res) => {
  try {
    const { account, legs, notes, executedAt, linkedAdviceRecId } = req.body || {};
    if (!account || !Array.isArray(legs) || legs.length < 1 || legs.length > 4) {
      return res.status(400).json({ error: "Provide account and 1-4 legs" });
    }

    // Normalize and validate each leg
    const normLegs = [];
    for (const raw of legs) {
      const side = String(raw?.side || "").toUpperCase();
      const currency = raw?.currency === "CAD" ? "CAD" : "USD";

      if (side === "DEPOSIT" || side === "WITHDRAW") {
        const amount = num(raw?.amount);
        if (amount == null || amount <= 0) return res.status(400).json({ error: `Bad amount for ${side}` });
        normLegs.push({
          side, ticker: null, shares: null, pricePerShare: null,
          currency, grossValue: amount,
        });
        continue;
      }

      if (!["BUY", "SELL"].includes(side)) return res.status(400).json({ error: `Bad side: ${side}` });
      const ticker = String(raw?.ticker || "").toUpperCase().trim().replace(/\.+$/, "");
      const shares = num(raw?.shares);
      const price = num(raw?.price);
      if (!/^[A-Z0-9.\-]{1,16}$/.test(ticker)) return res.status(400).json({ error: `Bad ticker: ${ticker}` });
      if (shares == null || shares <= 0) return res.status(400).json({ error: `Bad shares for ${ticker}` });
      if (price == null || price < 0) return res.status(400).json({ error: `Bad price for ${ticker}` });
      // Optional settleCcy: which sub-account cash bucket this trade settles
      // through. Defaults to currency. Lets BUY of USD stock be settled out
      // of CAD cash (with the FX friction the user accepts).
      const settleCcy = raw?.settleCcy === "USD" || raw?.settleCcy === "CAD" ? raw.settleCcy : currency;
      normLegs.push({
        side, ticker, shares,
        pricePerShare: price,
        currency,
        settleCcy,
        grossValue: shares * price,
      });
    }

    // Load portfolio
    const portfolio = await StocksPortfolio.findOne({ email: req.stocksUser.email });
    if (!portfolio) return res.status(404).json({ error: "No portfolio yet — set one up first." });

    const acctRow = portfolio.accounts.find((a) => a.id === account);
    if (!acctRow) return res.status(400).json({ error: "Unknown account id" });

    // Apply legs to a copy of the positions array (and adjust cash inline)
    const newPositions = [...portfolio.positions.map((p) => ({ ...(p.toObject?.() || p) }))];
    try {
      for (const leg of normLegs) {
        // Position update only for BUY/SELL
        if (leg.side === "BUY" || leg.side === "SELL") {
          applyLeg(newPositions, account, {
            side: leg.side, ticker: leg.ticker, shares: leg.shares,
            price: leg.pricePerShare, currency: leg.currency,
            settleCcy: leg.settleCcy,
          });
        }
        // Cash adjustment for ALL leg types
        adjustAccountCash(acctRow, leg);
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    portfolio.positions = newPositions;
    portfolio.markModified("accounts");
    portfolio.lastSyncedAt = new Date();
    await portfolio.save();

    // Journal the trade
    const fx = portfolio.fxUsdCad || 1.37;
    const entry = await StocksTradeJournal.create({
      email: req.stocksUser.email,
      executedAt: executedAt ? new Date(executedAt) : new Date(),
      account,
      accountName: acctRow.name,
      legs: normLegs,
      netCashCad: netCashCadOfTrade(normLegs, fx),
      fxUsdCadAtTrade: fx,
      notes: String(notes || "").slice(0, 500),
      linkedAdviceRecId: linkedAdviceRecId || null,
    });

    res.json({ ok: true, portfolio: portfolio.toObject(), trade: entry.toObject() });
  } catch (err) {
    console.error("stocks-trade POST error:", err);
    res.status(500).json({ error: `Internal: ${err?.message || err}` });
  }
});

router.get("/", requireStocksAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 7), 1825);
    const since = new Date(Date.now() - days * 86400 * 1000);
    const trades = await StocksTradeJournal.find({
      email: req.stocksUser.email,
      executedAt: { $gte: since },
    }).sort({ executedAt: -1 }).limit(250).lean();
    res.json({ trades });
  } catch (err) {
    console.error("stocks-trade GET error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
