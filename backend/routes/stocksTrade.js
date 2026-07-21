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
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDailyPick from "../models/StocksDailyPick.js";

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
function getSessionToken(req) {
  const cookie = req.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)stocks_session=([^;]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  const a = req.headers?.authorization || req.headers?.Authorization || "";
  return typeof a === "string" && a.startsWith("Bearer ") ? a.slice(7).trim() : null;
}
function requireStocksAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Missing session credential" });
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

// Convert a gross amount from the trade currency into the settle currency.
// fxUsdCad is CAD per USD, so USD→CAD multiplies and CAD→USD divides.
function toSettleCcy(gross, tradeCcy, settleCcy, fx) {
  if (tradeCcy === settleCcy) return gross;
  return tradeCcy === "USD" ? gross * fx : gross / fx;
}

// Mutates the account row's cash balance.
//   BUY/WITHDRAW  → cash[bucket] -= grossValue
//   SELL/DEPOSIT  → cash[bucket] += grossValue
//
// `bucket` is the SUB-ACCOUNT cash bucket the trade settles in. Defaults to
// the leg's currency, but a leg can pass `settleCcy` to settle a USD trade
// out of CAD cash (cross-currency purchase) and vice versa. When settleCcy
// differs from the trade currency, gross is converted at `fx` so the cash
// bucket matches the journal's CAD value.
function adjustAccountCash(account, leg, fx) {
  if (!account) return;
  const settleCcy = leg.settleCcy || leg.currency;
  const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
  const gross = toSettleCcy(Number(leg.grossValue) || 0, leg.currency, settleCcy, fx);
  const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
  account[cashKey] = (account[cashKey] || 0) + sign * gross;
}

// ── handlers ───────────────────────────────────────────────────────
router.post("/", express.json({ limit: "32kb" }), requireStocksAuth, async (req, res) => {
  try {
    const { account, legs, notes, executedAt } = req.body || {};
    // Accept the source advice rec id from the caller — when a trade is
    // executed via the Advice tab's Execute button, the rec _id is passed
    // through so the scorecard can link followed-recs to actual trades.
    const linkedAdviceRecId = (req.body?.linkedAdviceRecId && /^[a-f0-9]{24}$/i.test(String(req.body.linkedAdviceRecId)))
      ? req.body.linkedAdviceRecId
      : null;
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
          // Per-leg account override — lets a single trade move cash between
          // accounts (transfer = WITHDRAW leg in one account + DEPOSIT leg
          // in another, possibly in different currencies).
          account: typeof raw?.account === "string" ? raw.account : null,
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

    const fx = portfolio.fxUsdCad || 1.37;

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
        adjustAccountCash(acctRow, leg, fx);
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Per-leg account override (for transfers). We already applied cash
    // adjustments to acctRow above using the default account; re-do them
    // for any legs that specified their own account.
    for (const leg of normLegs) {
      if (leg.account && leg.account !== account) {
        // Undo the adjustment we made to acctRow for this leg
        const settleCcy = leg.settleCcy || leg.currency;
        const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
        const gross = toSettleCcy(Number(leg.grossValue) || 0, leg.currency, settleCcy, fx);
        const sign = leg.side === "SELL" || leg.side === "DEPOSIT" ? 1 : -1;
        acctRow[cashKey] = (acctRow[cashKey] || 0) - sign * gross; // undo

        // Apply to the leg's actual account
        const targetAcct = portfolio.accounts.find(a => a.id === leg.account);
        if (!targetAcct) return res.status(400).json({ error: `Unknown leg account: ${leg.account}` });
        targetAcct[cashKey] = (targetAcct[cashKey] || 0) + sign * gross;
      }
    }

    portfolio.positions = newPositions;
    portfolio.markModified("accounts");
    portfolio.lastSyncedAt = new Date();
    await portfolio.save();

    // If the caller didn't tell us which rec this trade fulfills, try to
    // auto-link: for each BUY/SELL leg, find the newest OPEN rec of the
    // matching action + ticker + currency in the last 30 days.
    // First match wins — the linkage is nice-to-have (drives the
    // "trades executed since last briefing" narration), not critical, so
    // we prefer a best-effort single-shot rather than a per-leg fanout.
    // Base ticker (strip exchange suffix like ".TO") so a trade in SU.TO
    // still matches an AI rec written as "SU". CIBC alerts send the base
    // symbol; the AI rec output may include or omit the suffix; users
    // recording manually often paste one or the other. Every code path
    // that JOINS a trade to a rec needs the same normalization.
    const baseTicker = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");

    let autoLinkedRecId = linkedAdviceRecId || null;
    if (!autoLinkedRecId) {
      try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        // Load recent open recs once; match in JS on base ticker so we
        // don't have to store a base-ticker index on the collection.
        const recentRecs = await StocksAdviceRec.find({
          email: req.stocksUser.email,
          status: "open",
          generatedAt: { $gte: cutoff },
        }).sort({ generatedAt: -1 }).select({ _id: 1, ticker: 1, action: 1, entryCurrency: 1 }).lean();
        for (const leg of normLegs) {
          if (!(leg.side === "BUY" || leg.side === "SELL") || !leg.ticker) continue;
          const legBase = baseTicker(leg.ticker);
          const legCcy = leg.currency || "USD";
          const match = recentRecs.find(r =>
            baseTicker(r.ticker) === legBase &&
            r.action === leg.side &&
            (r.entryCurrency || "USD") === legCcy
          );
          if (match) { autoLinkedRecId = match._id; break; }
        }
      } catch (e) { console.warn("[stocks-trade] auto-link warn:", e?.message); }
    }

    // Also try to link a matching StocksDailyPick — that's a swing rec too,
    // just persisted in a different collection. Without this, buying AMZN
    // after a daily-pick swing rec lands as "no linked AI rec" in the
    // briefing, which is misleading. Same base-ticker normalization.
    let autoLinkedDailyPickId = null;
    try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const recentPicks = await StocksDailyPick.find({
        email: req.stocksUser.email,
        status: "open",
        pickDate: { $gte: cutoff },
      }).sort({ pickDate: -1 }).select({ _id: 1, ticker: 1 }).lean();
      for (const leg of normLegs) {
        if (leg.side !== "BUY" || !leg.ticker) continue;
        const legBase = baseTicker(leg.ticker);
        const pick = recentPicks.find(p => baseTicker(p.ticker) === legBase);
        if (pick) { autoLinkedDailyPickId = pick._id; break; }
      }
    } catch (e) { console.warn("[stocks-trade] auto-link daily-pick warn:", e?.message); }

    // Journal the trade
    const entry = await StocksTradeJournal.create({
      email: req.stocksUser.email,
      executedAt: executedAt ? new Date(executedAt) : new Date(),
      account,
      accountName: acctRow.name,
      legs: normLegs,
      netCashCad: netCashCadOfTrade(normLegs, fx),
      fxUsdCadAtTrade: fx,
      notes: String(notes || "").slice(0, 500),
      linkedAdviceRecId: autoLinkedRecId,
      linkedDailyPickId: autoLinkedDailyPickId,
    });

    // Mark any open DailyPick on the same ticker as ENTERED so the Daily
    // Picks card visually acknowledges that the user acted on the pick.
    // Pick stays status="open" — target/stop monitoring continues from
    // the actual fill. Matches on BASE ticker so a leg for "SU" matches
    // a pick for "SU.TO" and vice versa. First matching open pick per
    // BUY leg wins.
    try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const openPicks = await StocksDailyPick.find({
        email: req.stocksUser.email,
        status: "open",
        enteredAt: null,
        pickDate: { $gte: cutoff },
      }).select({ _id: 1, ticker: 1 }).lean();
      for (const leg of normLegs) {
        if (leg.side !== "BUY" || !leg.ticker) continue;
        const legBase = baseTicker(leg.ticker);
        const match = openPicks.find(p => baseTicker(p.ticker) === legBase);
        if (!match) continue;
        await StocksDailyPick.updateOne(
          { _id: match._id, enteredAt: null }, // guard against races
          {
            $set: {
              enteredAt: entry.executedAt,
              enteredPrice: leg.pricePerShare,
              enteredShares: leg.shares,
              enteredTradeId: entry._id,
            },
          }
        );
      }
    } catch (e) { console.warn("[stocks-trade] daily-pick entry-stamp warn:", e?.message); }

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

// POST /api/stocks-trade/backfill-daily-pick-links
// One-off retro-link: for every unlinked recent BUY trade the user has,
// find a matching open StocksDailyPick and populate linkedDailyPickId.
// Used to fix trades that were recorded BEFORE auto-link learned about
// daily picks. Safe to run multiple times — idempotent (skips already-
// linked rows).
router.post("/backfill-daily-pick-links", requireStocksAuth, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const trades = await StocksTradeJournal.find({
      email: req.stocksUser.email,
      executedAt: { $gte: cutoff },
      linkedDailyPickId: null,
    }).lean();
    let linked = 0;
    for (const t of trades) {
      const buyLegs = (t.legs || []).filter((l) => l.side === "BUY" && l.ticker);
      for (const leg of buyLegs) {
        const pickCutoff = new Date(new Date(t.executedAt).getTime() - 14 * 24 * 60 * 60 * 1000);
        const pickCap = new Date(new Date(t.executedAt).getTime() + 24 * 60 * 60 * 1000);
        const pick = await StocksDailyPick.findOne({
          email: req.stocksUser.email,
          ticker: leg.ticker,
          pickDate: { $gte: pickCutoff, $lte: pickCap },
        }).sort({ pickDate: -1 }).select({ _id: 1 }).lean();
        if (pick) {
          await StocksTradeJournal.updateOne({ _id: t._id }, { $set: { linkedDailyPickId: pick._id } });
          linked++;
          break; // one link per trade is enough
        }
      }
    }
    res.json({ ok: true, scanned: trades.length, linked });
  } catch (err) {
    console.error("stocks-trade backfill error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /api/stocks-trade/:id
// Body: { legs: [{ shares?, price? }, ...] }
// One-index-aligned patch — the ith incoming leg patches the ith stored
// leg. Only shares and pricePerShare are patchable; side/ticker/currency
// stay locked (change those by deleting + re-recording).
//
// Reverses each old leg's effect on positions + cash, then applies the
// new leg, so the net portfolio state = "what it would have been if the
// corrected leg had been what was recorded originally." Netcashcad on
// the journal entry is recomputed.
router.patch("/:id", express.json({ limit: "16kb" }), requireStocksAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: "Bad id" });
    const patch = Array.isArray(req.body?.legs) ? req.body.legs : null;
    if (!patch) return res.status(400).json({ error: "legs[] required" });

    const trade = await StocksTradeJournal.findOne({ _id: id, email: req.stocksUser.email });
    if (!trade) return res.status(404).json({ error: "Not found" });
    if (patch.length !== trade.legs.length) return res.status(400).json({ error: "legs length must match" });

    const portfolio = await StocksPortfolio.findOne({ email: req.stocksUser.email });
    if (!portfolio) return res.status(404).json({ error: "No portfolio" });
    const fx = portfolio.fxUsdCad || 1.37;
    const account = trade.account;
    const acctRow = portfolio.accounts.find((a) => a.id === account);
    if (!acctRow) return res.status(400).json({ error: "Original account not found on portfolio" });

    // Build the new leg array by folding each patch on top of the stored leg.
    const newLegs = trade.legs.map((oldLeg, i) => {
      const p = patch[i] || {};
      const shares = Number.isFinite(+p.shares) && +p.shares > 0 ? +p.shares : oldLeg.shares;
      const price = Number.isFinite(+p.price) && +p.price >= 0 ? +p.price : oldLeg.pricePerShare;
      const grossValue = (oldLeg.side === "DEPOSIT" || oldLeg.side === "WITHDRAW")
        ? (Number.isFinite(+p.amount) && +p.amount > 0 ? +p.amount : oldLeg.grossValue)
        : shares * price;
      return {
        side: oldLeg.side,
        ticker: oldLeg.ticker,
        currency: oldLeg.currency,
        settleCcy: oldLeg.settleCcy || oldLeg.currency,
        shares: (oldLeg.side === "DEPOSIT" || oldLeg.side === "WITHDRAW") ? null : shares,
        pricePerShare: (oldLeg.side === "DEPOSIT" || oldLeg.side === "WITHDRAW") ? null : price,
        grossValue,
        account: oldLeg.account || null,
      };
    });

    // Reverse each OLD leg's effect on positions + cash.
    const positions = [...portfolio.positions.map((p) => ({ ...(p.toObject?.() || p) }))];
    try {
      for (const oldLeg of trade.legs) {
        if (oldLeg.side === "BUY" || oldLeg.side === "SELL") {
          const inverse = { ...oldLeg.toObject?.() || oldLeg, side: oldLeg.side === "BUY" ? "SELL" : "BUY", price: oldLeg.pricePerShare };
          applyLeg(positions, oldLeg.account || account, inverse);
        }
        // Cash: flip the sign
        const targetAcct = portfolio.accounts.find((a) => a.id === (oldLeg.account || account));
        if (targetAcct) {
          const inverseLeg = { ...oldLeg.toObject?.() || oldLeg, side: {
            BUY: "SELL", SELL: "BUY", DEPOSIT: "WITHDRAW", WITHDRAW: "DEPOSIT",
          }[oldLeg.side] };
          adjustAccountCash(targetAcct, inverseLeg, fx);
        }
      }
      // Apply each NEW leg.
      for (const newLeg of newLegs) {
        if (newLeg.side === "BUY" || newLeg.side === "SELL") {
          applyLeg(positions, newLeg.account || account, { ...newLeg, price: newLeg.pricePerShare });
        }
        const targetAcct = portfolio.accounts.find((a) => a.id === (newLeg.account || account));
        if (targetAcct) adjustAccountCash(targetAcct, newLeg, fx);
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Save the corrected portfolio + journal.
    portfolio.positions = positions;
    portfolio.markModified("accounts");
    portfolio.lastSyncedAt = new Date();
    await portfolio.save();

    trade.legs = newLegs;
    trade.netCashCad = netCashCadOfTrade(newLegs, fx);
    await trade.save();

    res.json({ ok: true, portfolio: portfolio.toObject(), trade: trade.toObject() });
  } catch (err) {
    console.error("stocks-trade PATCH error:", err);
    res.status(500).json({ error: `Internal: ${err?.message || err}` });
  }
});

// DELETE /api/stocks-trade/:id
// Removes ONE journal entry the caller owns. Deliberately does NOT undo
// the leg's effects on positions or cash — the user reconciles those on
// the Positions tab if needed. Silent no-op if the id doesn't exist or
// belongs to another user (never leaks existence).
router.delete("/:id", requireStocksAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: "Bad id" });
    const result = await StocksTradeJournal.deleteOne({
      _id: id,
      email: req.stocksUser.email,
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("stocks-trade DELETE error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
