// backend/routes/stocksNews.js
//
// GET /api/stocks-news  — News tab data. Returns:
//   {
//     perTicker: { TICKER: [{title, url, publisher, publishedAt, snippet, image}, ...] },
//     general: [ ... ],           // shared market wire
//     tickersRequested: [ ... ],  // held tickers we ran through the fetch
//     generatedAt, fmpEnabled
//   }
//
// Auth: reuses the same HMAC session-cookie/Bearer flow as
// /api/stocks-portfolio (imports `requireStocksAuth` inline here to
// avoid a circular route import). Cache is inside the news service —
// 15 min per (ticker, limit) — so hammering this route is cheap.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import { getPortfolioTickerNews, getGeneralMarketNews } from "../services/stocksNews.js";
import { isFmpEnabled } from "../services/fmpEnabled.js";

const router = express.Router();

// ── Auth (mirror of stocksPortfolio.js — kept local so this route is
//    a self-contained module) ────────────────────────────────────────
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

// ── GET /api/stocks-news ──────────────────────────────────────────
router.get("/", requireStocksAuth, async (req, res) => {
  try {
    const perTickerLimit = Math.max(1, Math.min(15, parseInt(req.query.perTicker, 10) || 6));
    const generalLimit = Math.max(1, Math.min(40, parseInt(req.query.general, 10) || 20));
    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).select({ positions: 1 }).lean();
    const positions = Array.isArray(profile?.positions) ? profile.positions : [];
    const [perTicker, general] = await Promise.all([
      getPortfolioTickerNews(positions, { perTickerLimit }).catch(() => ({})),
      getGeneralMarketNews({ limit: generalLimit }).catch(() => []),
    ]);
    const tickersRequested = Object.keys(perTicker).sort();
    res.json({
      ok: true,
      fmpEnabled: isFmpEnabled(),
      perTicker,
      general,
      tickersRequested,
      generatedAt: new Date(),
    });
  } catch (err) {
    console.error("stocks-news error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
