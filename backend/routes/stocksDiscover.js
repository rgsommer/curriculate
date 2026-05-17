// backend/routes/stocksDiscover.js
//
// Discovery endpoints — finds high-potential candidate stocks NOT in the
// user's portfolio and asks the AI to write an investment thesis on each.
//
// Routes (all gated by requireStocksAuth, mounted at /api/stocks-discover):
//   POST /scan                       — run a fresh discovery scan
//   GET  /candidates                 — list saved candidates (latest scan)
//   POST /candidates/:id/star        — toggle starred
//   POST /candidates/:id/dismiss     — toggle dismissed
//   POST /candidates/:id/refresh-price — pull latest price for tracking
//
// On-demand only for now. Heavy: ~10 Anthropic calls per scan plus FMP
// hits. A weekly cron is a future task; for now the user triggers manually.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import { runDiscoveryScan } from "../services/stocksDiscoveryService.js";

const router = express.Router();

// ── token verification (same scheme as other stocks routes) ────────────
function getSecret() { return process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || ""; }
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

// Shared current-price fetcher (Yahoo, server-side, no CORS). Used to
// refresh tracking prices.
async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate)" } });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

// POST /api/stocks-discover/scan — run a fresh scan
router.post("/scan", requireStocksAuth, async (req, res) => {
  try {
    if (!process.env.FMP_API_KEY) {
      return res.status(503).json({ error: "Discovery requires FMP_API_KEY in env." });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "Discovery requires ANTHROPIC_API_KEY in env." });
    }

    // Build exclude list from current portfolio
    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    const heldTickers = profile?.positions?.map((p) => p.ticker) || [];

    // Optional knobs from the body: sectors, topN, market-cap band
    const {
      sectors = null,
      topN = 8,
      marketCapMin,
      marketCapMax,
    } = req.body || {};

    const result = await runDiscoveryScan({
      email: req.stocksUser.email,
      excludeTickers: heldTickers,
      sectors,
      topN: Math.min(Math.max(parseInt(topN, 10) || 8, 1), 15),
      opts: {
        ...(typeof marketCapMin === "number" ? { marketCapMin } : {}),
        ...(typeof marketCapMax === "number" ? { marketCapMax } : {}),
      },
    });
    res.json(result);
  } catch (err) {
    console.error("stocks-discover /scan error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// GET /api/stocks-discover/candidates — list candidates for this user
//
// Returns the candidates from the user's MOST RECENT scan, plus any
// previously-starred candidates from older scans so user-flagged ideas
// don't fall off the page.
router.get("/candidates", requireStocksAuth, async (req, res) => {
  try {
    // Latest scan date for this user
    const latest = await StocksDiscoveryCandidate
      .findOne({ email: req.stocksUser.email })
      .sort({ scanDate: -1 })
      .select("scanDate")
      .lean();

    if (!latest) {
      return res.json({ candidates: [], starred: [], scanDate: null });
    }

    const candidates = await StocksDiscoveryCandidate
      .find({ email: req.stocksUser.email, scanDate: latest.scanDate, dismissed: { $ne: true } })
      .sort({ score: -1 })
      .lean();

    const starred = await StocksDiscoveryCandidate
      .find({ email: req.stocksUser.email, starred: true, scanDate: { $ne: latest.scanDate } })
      .sort({ scanDate: -1 })
      .limit(20)
      .lean();

    res.json({ candidates, starred, scanDate: latest.scanDate });
  } catch (err) {
    console.error("stocks-discover /candidates error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// POST /api/stocks-discover/candidates/:id/star
router.post("/candidates/:id/star", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksDiscoveryCandidate.findOneAndUpdate(
      { _id: req.params.id, email: req.stocksUser.email },
      [{ $set: { starred: { $not: "$starred" } } }],
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, starred: doc.starred });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// POST /api/stocks-discover/candidates/:id/dismiss
router.post("/candidates/:id/dismiss", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksDiscoveryCandidate.findOneAndUpdate(
      { _id: req.params.id, email: req.stocksUser.email },
      { $set: { dismissed: true } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// POST /api/stocks-discover/candidates/:id/refresh-price — pull current
// price and record it. Used by the (future) hit-rate scorecard.
router.post("/candidates/:id/refresh-price", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksDiscoveryCandidate.findOne({ _id: req.params.id, email: req.stocksUser.email });
    if (!doc) return res.status(404).json({ error: "Not found" });
    const px = await fetchCurrentPrice(doc.ticker);
    if (px == null) return res.status(502).json({ error: "Couldn't fetch current price" });
    doc.lastPrice = px;
    doc.lastPriceCheckedAt = new Date();
    await doc.save();
    res.json({ ok: true, lastPrice: px });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

export default router;
