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
import { runDiscoveryScan, runHighConvictionScan, runMosaicForTickers } from "../services/stocksDiscoveryService.js";

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

// POST /api/stocks-discover/high-conviction — multi-factor screen, top 2-3.
// Works with or without FMP (AI-only fallback); only ANTHROPIC_API_KEY is hard-
// required. Body: { riskMode, sectors, marketCapMin, marketCapMax }.
router.post("/high-conviction", requireStocksAuth, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "High-conviction screen requires ANTHROPIC_API_KEY in env." });
    }
    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    const heldTickers = profile?.positions?.map((p) => p.ticker) || [];

    const { riskMode = "balanced", sectors = null, marketCapMin, marketCapMax, includeMosaic = false, mosaicMode = "balanced", market = "both" } = req.body || {};

    const result = await runHighConvictionScan({
      email: req.stocksUser.email,
      riskMode,
      sectors,
      topN: 3,
      includeMosaic: !!includeMosaic,
      mosaicMode,
      market,
      opts: {
        excludeTickers: heldTickers,
        ...(typeof marketCapMin === "number" ? { marketCapMin } : {}),
        ...(typeof marketCapMax === "number" ? { marketCapMax } : {}),
      },
    });
    res.json(result);
  } catch (err) {
    console.error("stocks-discover /high-conviction error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// POST /api/stocks-discover/mosaic — standalone Mosaic Intelligence run on an
// explicit ticker list, or (default) the user's current holdings.
router.post("/mosaic", requireStocksAuth, async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "Mosaic Intelligence requires ANTHROPIC_API_KEY in env." });
    }
    const { tickers, mode = "balanced" } = req.body || {};
    let list = Array.isArray(tickers) ? tickers.filter((t) => typeof t === "string") : null;
    if (!list || !list.length) {
      const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
      list = [...new Set((profile?.positions || []).map((p) => p.ticker).filter(Boolean))];
    }
    const result = await runMosaicForTickers({ tickers: list.slice(0, 8), mode });
    res.json(result);
  } catch (err) {
    console.error("stocks-discover /mosaic error:", err);
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

// GET /api/stocks-discover/scorecard
//
// Aggregate hit-rate stats for past discovery candidates. For each
// candidate older than 7 days, computes the % return from priceAtDiscovery
// to current Yahoo price, and compares against SPY for the same window.
// Output:
//   { total, scored, avgReturnPct, medianReturnPct, hitRatePct (>0 returns),
//     vsBenchmarkPct (alpha vs SPY), winners[], losers[] }
router.get("/scorecard", requireStocksAuth, async (req, res) => {
  try {
    const since = new Date(Date.now() - 365 * 86400 * 1000);
    // Track EVERY discovered candidate over time regardless of action taken
    // (starred / dismissed / added). Dismiss only hides a name from future
    // scans — it must not drop it from outcome tracking.
    const candidates = await StocksDiscoveryCandidate.find({
      email: req.stocksUser.email,
      scanDate: { $gte: since, $lte: new Date(Date.now() - 7 * 86400 * 1000) }, // at least 7 days old
    }).lean();

    if (candidates.length === 0) {
      return res.json({ total: 0, scored: 0, avgReturnPct: null, hitRatePct: null, items: [] });
    }

    // Pull current price for each ticker + SPY in parallel
    const uniqueTickers = [...new Set(candidates.map((c) => c.ticker))];
    const priceMap = {};
    await Promise.all(uniqueTickers.map(async (t) => { priceMap[t] = await fetchCurrentPrice(t); }));
    const spyNow = await fetchCurrentPrice("SPY");

    // For SPY benchmark over each window, fetch one-shot historical data
    // for SPY going back 1 year, then look up the closest historical close
    // to each candidate's scanDate.
    let spyHistory = [];
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Curriculate)" } });
      if (r.ok) {
        const j = await r.json();
        const ts = j?.chart?.result?.[0]?.timestamp || [];
        const cl = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        spyHistory = ts.map((t, i) => ({ t: new Date(t * 1000), p: cl[i] })).filter((x) => x.p);
      }
    } catch { /* swallow */ }
    const spyAtDate = (date) => {
      if (!spyHistory.length) return null;
      const target = date.getTime();
      let closest = spyHistory[0];
      let bestDiff = Math.abs(closest.t.getTime() - target);
      for (const h of spyHistory) {
        const d = Math.abs(h.t.getTime() - target);
        if (d < bestDiff) { bestDiff = d; closest = h; }
      }
      return closest.p;
    };

    const items = [];
    for (const c of candidates) {
      const px = priceMap[c.ticker];
      if (px == null || !c.priceAtDiscovery) continue;
      const returnPct = ((px - c.priceAtDiscovery) / c.priceAtDiscovery) * 100;
      const spyStart = spyAtDate(new Date(c.scanDate));
      const spyReturnPct = (spyNow && spyStart)
        ? ((spyNow - spyStart) / spyStart) * 100
        : null;
      const alphaPct = spyReturnPct != null ? returnPct - spyReturnPct : null;
      items.push({
        _id: c._id,
        ticker: c.ticker,
        scanDate: c.scanDate,
        daysOld: Math.round((Date.now() - new Date(c.scanDate).getTime()) / 86400000),
        priceAtDiscovery: c.priceAtDiscovery,
        currentPrice: px,
        returnPct,
        spyReturnPct,
        alphaPct,
        priceTarget: c.thesis?.priceTarget || null,
        conviction: c.thesis?.conviction || null,
        starred: c.starred,
        dismissed: !!c.dismissed,
        addedToPortfolio: !!c.addedToPortfolio,
        // Point-in-time tracking captured by the daily outcome tracker
        peakPct: c.peakPct ?? null,
        troughPct: c.troughPct ?? null,
        outcome30d: c.outcome30d || null,
        outcome90d: c.outcome90d || null,
        outcome180d: c.outcome180d || null,
        outcome365d: c.outcome365d || null,
      });
    }

    if (items.length === 0) {
      return res.json({ total: candidates.length, scored: 0, avgReturnPct: null, hitRatePct: null, items: [] });
    }

    items.sort((a, b) => b.returnPct - a.returnPct);
    const returns = items.map((i) => i.returnPct).sort((a, b) => a - b);
    const median = returns.length % 2 === 0
      ? (returns[returns.length / 2 - 1] + returns[returns.length / 2]) / 2
      : returns[Math.floor(returns.length / 2)];
    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const hits = items.filter((i) => i.returnPct > 0).length;
    const beatBenchmark = items.filter((i) => i.alphaPct != null && i.alphaPct > 0).length;
    const benchmarked = items.filter((i) => i.alphaPct != null).length;
    const avgAlpha = benchmarked > 0
      ? items.filter((i) => i.alphaPct != null).reduce((s, i) => s + i.alphaPct, 0) / benchmarked
      : null;

    res.json({
      total: candidates.length,
      scored: items.length,
      avgReturnPct: avg,
      medianReturnPct: median,
      hitRatePct: (hits / items.length) * 100,
      benchmarkBeatRatePct: benchmarked > 0 ? (beatBenchmark / benchmarked) * 100 : null,
      avgAlphaVsSpyPct: avgAlpha,
      bestPick: items[0],
      worstPick: items[items.length - 1],
      items,
    });
  } catch (err) {
    console.error("stocks-discover /scorecard error:", err);
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
