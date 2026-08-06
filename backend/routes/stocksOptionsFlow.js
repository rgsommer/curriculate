// backend/routes/stocksOptionsFlow.js
//
// GET /api/stocks-options-flow/recent?days=5
// Returns persisted options-flow signals for tickers the caller holds
// or has starred on the Discover screen. Signals come from the
// stocksOptionsFlow scanner (UW-primary + Yahoo-fallback); this route
// only reads them — the on-demand scan runs from the briefing pipeline.
//
// Auth model matches the rest of the stocks routes: HMAC session token
// via cookie or Bearer header.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import StocksOptionsSignal from "../models/StocksOptionsSignal.js";

const router = express.Router();

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

router.get("/recent", requireStocksAuth, async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days || 5)));
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
    const signals = await StocksOptionsSignal.find({
      ticker: { $in: [...tickers] },
      detectedAt: { $gte: since },
    }).sort({ detectedAt: -1, strength: -1 }).limit(80).lean();

    res.json({ ok: true, signals, tickers: [...tickers], days });
  } catch (e) {
    console.warn("[options-flow] recent error:", e?.message);
    res.status(500).json({ error: "options flow lookup failed" });
  }
});

export default router;
