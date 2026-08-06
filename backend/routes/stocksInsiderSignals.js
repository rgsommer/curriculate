// backend/routes/stocksInsiderSignals.js
//
// GET /api/stocks-insider-signals/recent?days=30
// Returns recent Form-4 cluster signals for tickers the caller holds
// or has starred on the Discover screen. Signals are pre-computed by
// the nightly `stocksInsiderSync` job; this route just reads them.
//
// Auth model matches the rest of the stocks routes: HMAC session token
// via cookie or Bearer header.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import StocksInsiderSignal from "../models/StocksInsiderSignal.js";

const router = express.Router();

// ─── Session-token verifier (same shape as stocksPortfolio.js) ────────
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
    if (typeof payload?.email !== "string") return null;
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

// GET /recent?days=30
router.get("/recent", requireStocksAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days || 30)));
    const email = req.stocksUser.email;

    const [portfolio, starred] = await Promise.all([
      StocksPortfolio.findOne({ email }).select({ positions: 1 }).lean(),
      StocksDiscoveryCandidate.find({ email, starred: true, dismissed: { $ne: true } })
        .select({ ticker: 1 }).lean(),
    ]);
    const tickers = new Set();
    for (const p of portfolio?.positions || []) {
      if (p?.ticker) tickers.add(String(p.ticker).toUpperCase().replace(/\..*$/, ""));
    }
    for (const s of starred || []) if (s.ticker) tickers.add(String(s.ticker).toUpperCase().replace(/\..*$/, ""));

    if (tickers.size === 0) return res.json({ ok: true, signals: [], tickers: [] });

    const since = new Date(Date.now() - days * 86400 * 1000);
    const signals = await StocksInsiderSignal.find({
      ticker: { $in: [...tickers] },
      detectedAt: { $gte: since },
    }).sort({ strength: -1, detectedAt: -1 }).limit(50).lean();

    // Trim insiders array in the response so the payload stays compact.
    const compact = signals.map(s => ({
      _id: s._id,
      ticker: s.ticker,
      kind: s.kind,
      strength: s.strength,
      uniqueInsiderCount: s.uniqueInsiderCount,
      execCount: s.execCount,
      directorCount: s.directorCount,
      totalSharesTraded: s.totalSharesTraded,
      totalValueUsd: s.totalValueUsd,
      avgPricePerShare: s.avgPricePerShare,
      windowDays: s.windowDays,
      detectedAt: s.detectedAt,
      insiders: (s.insiders || []).slice(0, 8),
    }));
    res.json({ ok: true, signals: compact, tickers: [...tickers], days });
  } catch (e) {
    console.warn("[insider-signals] recent error:", e?.message);
    res.status(500).json({ error: "insider signals lookup failed" });
  }
});

export default router;
