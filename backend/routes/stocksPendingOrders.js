// backend/routes/stocksPendingOrders.js
//
// Pending-order lifecycle endpoints.
//   POST /api/stocks-pending-orders             — create a pending order
//   GET  /api/stocks-pending-orders             — list this user's pending
//   POST /api/stocks-pending-orders/:id/fill    — convert to a real trade
//   DELETE /api/stocks-pending-orders/:id       — cancel/remove

import express from "express";
import crypto from "crypto";
import StocksPendingOrder from "../models/StocksPendingOrder.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";

const router = express.Router();

// ── auth (same HMAC session scheme used elsewhere) ────────────────
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

// ── handlers ──────────────────────────────────────────────────────
router.use(express.json({ limit: "16kb" }));

router.get("/", requireStocksAuth, async (req, res) => {
  try {
    const orders = await StocksPendingOrder
      .find({ email: req.stocksUser.email })
      .sort({ submittedAt: -1 })
      .limit(100)
      .lean();
    res.json({ orders });
  } catch (err) {
    console.error("pending-orders GET error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/", requireStocksAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const num = (v) => Number.isFinite(+v) ? +v : null;
    const side = String(b.side || "").toUpperCase();
    const ticker = String(b.ticker || "").toUpperCase().trim().replace(/\.+$/, "");
    const qty = num(b.qty);
    const limitPrice = num(b.limitPrice);
    const currency = b.currency === "CAD" ? "CAD" : "USD";

    if (!["BUY", "SELL"].includes(side)) return res.status(400).json({ error: "side must be BUY or SELL" });
    if (!/^[A-Z0-9.\-]{1,16}$/.test(ticker)) return res.status(400).json({ error: "Bad ticker" });
    if (qty == null || qty <= 0) return res.status(400).json({ error: "qty must be > 0" });
    if (limitPrice == null || limitPrice < 0) return res.status(400).json({ error: "limitPrice required" });
    if (!b.account) return res.status(400).json({ error: "account required" });

    const order = await StocksPendingOrder.create({
      email: req.stocksUser.email,
      submittedAt: b.submittedAt ? new Date(b.submittedAt) : new Date(),
      side, ticker, qty, limitPrice, currency,
      settleCcy: b.settleCcy === "CAD" || b.settleCcy === "USD" ? b.settleCcy : null,
      account: String(b.account).slice(0, 64),
      targetPrice: num(b.targetPrice),
      stopPrice: num(b.stopPrice),
      sourceRecId: b.sourceRecId || null,
      notes: String(b.notes || "").slice(0, 500),
    });
    res.json({ order: order.toObject() });
  } catch (err) {
    console.error("pending-orders POST error:", err);
    res.status(500).json({ error: `Internal: ${err?.message || err}` });
  }
});

// Convert a pending order into a real trade journal entry. Body can override
// the actual fill data (qty/price/executedAt) — if not provided, falls back
// to the submitted values.
router.post("/:id/fill", requireStocksAuth, async (req, res) => {
  try {
    const order = await StocksPendingOrder.findOne({ _id: req.params.id, email: req.stocksUser.email });
    if (!order) return res.status(404).json({ error: "Pending order not found" });

    const num = (v) => Number.isFinite(+v) ? +v : null;
    const fillQty = num(req.body?.qty) ?? order.qty;
    const fillPrice = num(req.body?.price) ?? order.limitPrice;
    const fillAt = req.body?.executedAt ? new Date(req.body.executedAt) : new Date();

    // Validate the fill against the order — reject zero/negative price, and
    // never let a fill exceed the ordered quantity (partial fills are fine).
    // Without this the client could corrupt cost basis/cash with an arbitrary
    // qty or a free (price 0) fill.
    if (fillQty == null || fillQty <= 0) return res.status(400).json({ error: "Fill qty must be > 0" });
    if (fillPrice == null || fillPrice <= 0) return res.status(400).json({ error: "Fill price must be > 0" });
    if (fillQty > order.qty + 1e-6) {
      return res.status(400).json({ error: `Fill qty ${fillQty} exceeds ordered ${order.qty}` });
    }

    // Apply the trade to positions + cash + journal (mirrors stocksTrade.js)
    const portfolio = await StocksPortfolio.findOne({ email: req.stocksUser.email });
    if (!portfolio) return res.status(404).json({ error: "No portfolio" });
    const acctRow = portfolio.accounts.find(a => a.id === order.account);
    if (!acctRow) return res.status(400).json({ error: "Unknown account on this order" });

    const fx = portfolio.fxUsdCad || 1.37;
    const settleCcy = order.settleCcy || order.currency;
    const grossValue = fillQty * fillPrice; // in the trade's currency

    // Position update
    const positions = portfolio.positions.map(p => ({ ...(p.toObject?.() || p) }));
    applyOrderToPositions(positions, order.account, order.side, order.ticker, fillQty, fillPrice, order.currency, settleCcy);

    // Cash adjustment — settle in the settleCcy bucket. When the trade's
    // currency differs from the settle currency (e.g. a USD buy paid from CAD
    // cash), convert gross into the settle currency first so the cash bucket
    // and the journal's CAD value stay consistent. fxUsdCad is CAD per USD.
    const cashKey = settleCcy === "USD" ? "cashUsd" : "cashCad";
    let settleValue = grossValue;
    if (order.currency !== settleCcy) {
      settleValue = order.currency === "USD" ? grossValue * fx : grossValue / fx;
    }
    const sign = order.side === "SELL" ? 1 : -1;
    acctRow[cashKey] = (acctRow[cashKey] || 0) + sign * settleValue;

    portfolio.positions = positions;
    portfolio.markModified("accounts");
    portfolio.lastSyncedAt = new Date();
    await portfolio.save();

    // Journal entry
    const cadValue = order.currency === "USD" ? grossValue * fx : grossValue;
    const journal = await StocksTradeJournal.create({
      email: req.stocksUser.email,
      executedAt: fillAt,
      account: order.account,
      accountName: acctRow.name,
      legs: [{
        side: order.side,
        ticker: order.ticker,
        shares: fillQty,
        pricePerShare: fillPrice,
        currency: order.currency,
        grossValue,
      }],
      netCashCad: (order.side === "SELL" ? 1 : -1) * cadValue,
      fxUsdCadAtTrade: fx,
      notes: `Filled from pending order #${order._id}` + (order.notes ? ` · ${order.notes}` : ""),
    });

    // Remove the pending order — it's now realized
    await StocksPendingOrder.deleteOne({ _id: order._id });

    res.json({ ok: true, portfolio: portfolio.toObject(), trade: journal.toObject() });
  } catch (err) {
    console.error("pending-orders fill error:", err);
    res.status(500).json({ error: `Internal: ${err?.message || err}` });
  }
});

router.delete("/:id", requireStocksAuth, async (req, res) => {
  try {
    const out = await StocksPendingOrder.deleteOne({ _id: req.params.id, email: req.stocksUser.email });
    if (out.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("pending-orders DELETE error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Apply a fill to the positions array (FIFO for SELL, weighted-avg for BUY)
function applyOrderToPositions(positions, accountId, side, ticker, shares, price, currency, settleCcy) {
  if (side === "BUY") {
    const idx = positions.findIndex(
      (p) => p.acct === accountId && p.ticker === ticker && p.ccy === currency && (p.subCcy || p.ccy) === settleCcy
    );
    if (idx >= 0) {
      const existing = positions[idx];
      const oldQty = existing.qty || 0;
      const costKey = currency === "USD" ? "costBasisUsd" : "costBasisCad";
      const newQty = oldQty + shares;
      let newCost = existing[costKey];
      if (existing[costKey] != null && oldQty > 0) {
        newCost = (existing[costKey] * oldQty + price * shares) / newQty;
      } else if (existing[costKey] == null) {
        newCost = price;
      }
      // Existing position: update qty + weighted-average cost basis.
      // Do NOT overwrite priceUsd/priceCad (current market price is
      // owned by the refresh path — task #120 fix).
      positions[idx] = {
        ...existing,
        qty: newQty,
        [costKey]: newCost,
      };
    } else {
      positions.push({
        acct: accountId, ticker, name: "", qty: shares, ccy: currency, subCcy: settleCcy,
        ...(currency === "USD"
          ? { priceUsd: price, priceCad: null, costBasisUsd: price, costBasisCad: null }
          : { priceCad: price, priceUsd: null, costBasisCad: price, costBasisUsd: null }),
      });
    }
    return;
  }
  // SELL — FIFO across matching lots
  const matchIdxs = positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.acct === accountId && p.ticker === ticker && p.ccy === currency && (p.subCcy || p.ccy) === settleCcy)
    .map(({ i }) => i);
  if (matchIdxs.length === 0) throw new Error(`No matching position for SELL ${ticker}`);
  const totalAvail = matchIdxs.reduce((s, i) => s + (positions[i].qty || 0), 0);
  if (totalAvail < shares - 1e-6) throw new Error(`Trying to sell ${shares} of ${ticker} but only ${totalAvail} available`);
  let remaining = shares;
  for (const i of matchIdxs) {
    if (remaining <= 1e-6) break;
    const row = positions[i];
    if (row.qty <= remaining + 1e-6) {
      remaining -= row.qty;
      positions[i] = { ...row, qty: 0 };
    } else {
      // SELL: reduce qty only; don't touch market price (task #120 fix).
      positions[i] = { ...row, qty: row.qty - remaining };
      remaining = 0;
    }
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    if ((positions[i].qty || 0) <= 1e-6) positions.splice(i, 1);
  }
}

export default router;
