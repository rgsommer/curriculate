// backend/routes/stocksHealth.js
//
// Powers the Health tab. Two endpoints:
//
//   GET  /api/stocks-health              — always-fresh structural snapshot
//                                          (allocations, sleeves, overlaps,
//                                          concentrations, sectorExposure,
//                                          deterministic healthScore) plus
//                                          the most recent AI narrative if
//                                          one exists.
//
//   POST /api/stocks-health/analysis     — compute snapshot then call
//                                          Anthropic to write a narrative
//                                          review. Persists to
//                                          StocksHealthAnalysis.
//
// AI narrative is deliberately separate from the snapshot — the score
// and the data are deterministic and can be trusted between calls;
// the narrative is the "advisor's read" and is regenerated on request.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksHealthAnalysis from "../models/StocksHealthAnalysis.js";
import { computePortfolioHealth } from "../services/stocksPortfolioHealth.js";

const router = express.Router();

// ── Auth (mirror of stocksPortfolio.js) ──────────────────────────
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
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; }
  catch { return null; }
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

// ── GET /api/stocks-health ──────────────────────────────────────
router.get("/", requireStocksAuth, async (req, res) => {
  try {
    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    if (!profile) return res.status(404).json({ error: "Portfolio not found" });
    const snapshot = computePortfolioHealth(profile);
    const lastAnalysis = await StocksHealthAnalysis.findOne({ email: req.stocksUser.email }).lean().catch(() => null);
    res.json({
      ok: true,
      snapshot,
      lastAnalysis: lastAnalysis ? {
        generatedAt: lastAnalysis.generatedAt,
        aiNarrative: lastAnalysis.aiNarrative,
        aiScore: lastAnalysis.aiScore,
        model: lastAnalysis.model,
      } : null,
    });
  } catch (err) {
    console.error("stocks-health error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Build the analysis prompt. Keep it structured — the model gets the
// data as JSON and is told to lean on it rather than pulling from
// general knowledge. Same voice/discipline as the daily briefing:
// concrete, quantified, no filler.
function buildAnalysisPrompt(snapshot) {
  const clean = {
    bookTotalCad: snapshot.bookTotalCad,
    positionCount: snapshot.positionCount,
    accountCount: snapshot.accountCount,
    cash: snapshot.cash,
    sleeves: {
      actualPct: snapshot.sleeves?.actualPct,
      targetsPct: snapshot.sleeves?.targetsPct,
      deviations: snapshot.sleeves?.deviations,
      totals: snapshot.sleeves?.totals,
    },
    allocations: snapshot.allocations.map(a => ({
      ticker: a.ticker, base: a.base, account: a.account, currency: a.currency,
      qty: a.qty, cadValue: Math.round(a.cadValue), pctOfBook: +a.pctOfBook.toFixed(2),
      sleeve: a.sleeve, pnlPct: a.pnlPct != null ? +a.pnlPct.toFixed(1) : null,
    })),
    concentrations: snapshot.concentrations,
    overlaps: snapshot.overlaps,
    sectorExposure: snapshot.sectorExposure.map(s => ({
      sector: s.sector, pctOfBook: +s.pctOfBook.toFixed(1),
    })),
    deterministicHealthScore: snapshot.healthScore,
    deductions: snapshot.deductions,
  };
  return `You are reviewing the STRUCTURAL HEALTH of an investor's portfolio — not day-to-day performance, not price direction. Reason ONLY over the JSON snapshot below.

Voice: concrete, quantified, second-person ("your portfolio", "you're"), no filler. Match the tone of a candid CFA speaking to a numerate client. NEVER include headlines like "Executive Summary" or "Conclusion" — the reader knows what they're reading. NEVER lecture about basics — assume the reader knows what an ETF is, what diversification is, what a sleeve is.

Cover, in this order, with H3 (###) section headers:

### The picture
2-4 sentences on total value, what the top-3 exposures are, and the sleeve mix at a glance. Include CAD amounts.

### What's working
Bullet points. Only include items that are quantifiably good — "~62% in broad ETFs", "no single position >20%", "sleeve X within target band". Skip if nothing qualifies.

### Hidden problems
The most important section. Call out every meaningful ETF-family overlap AND every single-name-in-ETF duplication from the snapshot's overlaps array. Show the arithmetic: "You own X directly (Y% of book) AND ~Z% of the same via ETF W → implied exposure ~A%."

### Concentration & sleeve gaps
Every concentrations[] entry ≥15% gets a line. Every sleeve gap ≥5pp gets a line. Say what the target is and by how much you're off.

### Position that jumps out
The single position most worth flagging on qualitative grounds — usually the largest SPEC position, or a single-name with unusual sector risk. One paragraph.

### Overall
One line: "Score: X/10" (use your own judgment — not the deterministic score in the snapshot, which is anchored to only a few rules). One-sentence justification. If your score differs from the deterministic ${clean.deterministicHealthScore}/10 in the snapshot, briefly say why in half a sentence.

### Next moves (ranked)
3-5 numbered items, most impactful first. Each is one line: "Trim X to Y% by selling Z shares." or "Consolidate A+B+C into one holding to reduce overlap." Be specific — no "consider" hedges.

DATA SNAPSHOT:
${JSON.stringify(clean, null, 2)}

Output the sections above as markdown. Return ONLY the markdown — no preamble, no closing pleasantries.`;
}

// ── POST /api/stocks-health/analysis ────────────────────────────
router.post("/analysis", requireStocksAuth, express.json({ limit: "32kb" }), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });
    }
    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    if (!profile) return res.status(404).json({ error: "Portfolio not found" });
    const snapshot = computePortfolioHealth(profile);
    if (snapshot.positionCount === 0) {
      return res.status(400).json({ error: "No positions to analyze" });
    }
    const model = process.env.STOCKS_ADVICE_MODEL || "claude-sonnet-4-6";
    const prompt = buildAnalysisPrompt(snapshot);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.error("[stocks-health/analysis] anthropic error:", r.status, errBody.slice(0, 300));
      return res.status(502).json({ error: `Anthropic ${r.status}` });
    }
    const j = await r.json();
    const aiNarrative = (j?.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    // Extract AI's own score line (e.g., "Score: 7.5/10")
    let aiScore = null;
    const scoreMatch = aiNarrative.match(/score\s*:?\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    if (scoreMatch) aiScore = parseFloat(scoreMatch[1]);

    const doc = await StocksHealthAnalysis.findOneAndUpdate(
      { email: req.stocksUser.email },
      { $set: { generatedAt: new Date(), snapshot, aiNarrative, aiScore, model } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({
      ok: true,
      snapshot,
      analysis: {
        generatedAt: doc.generatedAt,
        aiNarrative,
        aiScore,
        model,
      },
    });
  } catch (err) {
    console.error("stocks-health/analysis error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
