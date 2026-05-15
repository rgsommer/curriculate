// backend/routes/stocksPortfolio.js
//
// Per-user stocks-advisor portfolio storage. Backs the /stocks page
// served by the Next.js frontend.
//
// Endpoints (all mounted under /stocks-portfolio):
//
//   GET    /                            — fetch your own portfolio   [Bearer sessionToken]
//   PUT    /                            — upsert your own portfolio  [Bearer sessionToken]
//   DELETE /                            — delete your own portfolio  [Bearer sessionToken]
//   GET    /performance                 — daily snapshots time series [Bearer sessionToken]
//   GET    /by-email/:email             — fetch by email              [X-Cron-Secret header]
//
// Auth model:
//   • End-user routes verify the HMAC session token that was issued by
//     the frontend's /api/stocks/verify-pin route. The signing secret
//     is read from STOCKS_SECRET (falls back to MEDICENTRE_SECRET) —
//     identical to the frontend so tokens round-trip.
//   • The /by-email/:email route is for the daily-briefing scheduled
//     task in Cowork. It's gated by CRON_SECRET (separate env var).

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────
// Secrets / token verification
// ──────────────────────────────────────────────────────────────────────

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
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (payload?.sub !== "stocks-session") return null;
    if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload?.email !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

function getBearer(req) {
  const a = req.headers?.authorization || req.headers?.Authorization || "";
  return typeof a === "string" && a.startsWith("Bearer ") ? a.slice(7).trim() : null;
}

// User-token middleware
function requireStocksAuth(req, res, next) {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });
  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired session" });
  req.stocksUser = { email: payload.email.toLowerCase() };
  next();
}

// Cron-secret middleware (for scheduled-task access by email)
function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const got = req.headers["x-cron-secret"];
  if (!got || got !== expected) return res.status(401).json({ error: "Bad cron secret" });
  next();
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function valueOfPosition(p, fx) {
  if (p.ccy === "USD") {
    const cad = (p.priceCad ?? (p.priceUsd ? p.priceUsd * fx : 0)) * (p.qty || 0);
    return { cad, usd: (p.priceUsd ?? (p.priceCad ? p.priceCad / fx : 0)) * (p.qty || 0) };
  }
  return { cad: (p.priceCad || 0) * (p.qty || 0), usd: ((p.priceCad || 0) / fx) * (p.qty || 0) };
}

function totalCad(positions, fx) {
  return (positions || []).reduce((s, p) => s + valueOfPosition(p, fx).cad, 0);
}

async function writeDailySnapshot(doc) {
  const fx = doc.fxUsdCad || 1.37;
  const total = totalCad(doc.positions, fx);
  const date = new Date().toISOString().slice(0, 10);
  await StocksPortfolioSnapshot.findOneAndUpdate(
    { email: doc.email, date },
    { $set: { totalCad: total, fxUsdCad: fx, positionsCount: doc.positions?.length || 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function sanitizePortfolioInput(body, email) {
  // Whitelist + coerce types so client can't inject odd fields.
  const out = { email };
  if (body.riskTolerance && ["conservative", "moderate", "aggressive", "speculative"].includes(body.riskTolerance)) {
    out.riskTolerance = body.riskTolerance;
  }
  if (typeof body.fxUsdCad === "number" && body.fxUsdCad > 0 && body.fxUsdCad < 10) {
    out.fxUsdCad = body.fxUsdCad;
  }
  if (typeof body.commissionPerTrade === "number" && body.commissionPerTrade >= 0 && body.commissionPerTrade < 1000) {
    out.commissionPerTrade = body.commissionPerTrade;
  }
  if (typeof body.fxSpreadPct === "number" && body.fxSpreadPct >= 0 && body.fxSpreadPct < 10) {
    out.fxSpreadPct = body.fxSpreadPct;
  }
  if (Array.isArray(body.accounts)) {
    out.accounts = body.accounts
      .filter((a) => a && typeof a.id === "string" && typeof a.name === "string")
      .slice(0, 50)
      .map((a) => ({
        id: String(a.id).slice(0, 64),
        name: String(a.name).slice(0, 120),
        // Preserve cash balances on every PUT — bug previously stripped these,
        // wiping cash on the next non-cash profile save.
        cashUsd: typeof a.cashUsd === "number" && Number.isFinite(a.cashUsd) ? a.cashUsd : 0,
        cashCad: typeof a.cashCad === "number" && Number.isFinite(a.cashCad) ? a.cashCad : 0,
      }));
  }
  if (Array.isArray(body.positions)) {
    out.positions = body.positions
      .filter((p) => p && p.ticker && p.qty != null)
      .slice(0, 500)
      .map((p) => ({
        acct: String(p.acct || "").slice(0, 64),
        // Strip trailing dots — defensive cleanup at the persistence layer
        // in case bad tickers slip through the AI parser.
        ticker: String(p.ticker || "").toUpperCase().slice(0, 16).replace(/\.+$/, ""),
        name: String(p.name || "").slice(0, 200),
        qty: Number(p.qty) || 0,
        ccy: p.ccy === "CAD" ? "CAD" : "USD",
        subCcy: p.subCcy === "CAD" ? "CAD" : p.subCcy === "USD" ? "USD" : null,
        priceUsd: typeof p.priceUsd === "number" ? p.priceUsd : null,
        priceCad: typeof p.priceCad === "number" ? p.priceCad : null,
        costBasisUsd: typeof p.costBasisUsd === "number" ? p.costBasisUsd : null,
        costBasisCad: typeof p.costBasisCad === "number" ? p.costBasisCad : null,
        notes: String(p.notes || "").slice(0, 500),
      }));
  }
  if (Array.isArray(body.plannedWithdrawals)) {
    out.plannedWithdrawals = body.plannedWithdrawals
      .filter((w) => w && typeof w.amount === "number" && w.amount > 0 && (w.currency === "USD" || w.currency === "CAD") && w.targetDate)
      .slice(0, 50)
      .map((w) => ({
        id: String(w.id || ("w" + Date.now() + Math.random().toString(36).slice(2, 6))).slice(0, 64),
        amount: Number(w.amount),
        currency: w.currency,
        targetDate: new Date(w.targetDate),
        account: String(w.account || "").slice(0, 64),
        notes: String(w.notes || "").slice(0, 300),
        createdAt: w.createdAt ? new Date(w.createdAt) : new Date(),
      }));
  }
  out.lastSyncedAt = new Date();
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Routes (user-token)
// ──────────────────────────────────────────────────────────────────────

router.get("/", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    if (!doc) {
      return res.json({
        email: req.stocksUser.email,
        riskTolerance: null,
        fxUsdCad: 1.37,
        accounts: [],
        positions: [],
        lastSyncedAt: null,
      });
    }
    res.json(doc);
  } catch (err) {
    console.error("stocks-portfolio GET error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.put("/", requireStocksAuth, async (req, res) => {
  try {
    const update = sanitizePortfolioInput(req.body || {}, req.stocksUser.email);
    const doc = await StocksPortfolio.findOneAndUpdate(
      { email: req.stocksUser.email },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // Best-effort daily snapshot — don't fail the PUT if it errors
    writeDailySnapshot(doc).catch((e) => console.warn("snapshot warn:", e?.message));
    res.json(doc);
  } catch (err) {
    console.error("stocks-portfolio PUT error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/", requireStocksAuth, async (req, res) => {
  try {
    await StocksPortfolio.deleteOne({ email: req.stocksUser.email });
    await StocksPortfolioSnapshot.deleteMany({ email: req.stocksUser.email });
    res.json({ ok: true });
  } catch (err) {
    console.error("stocks-portfolio DELETE error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/migrate
//
// Cleans up the authenticated user's portfolio:
//   1. Strips trailing dots from any ticker (PLTR./ENB./SOFI./BBAI. → PLTR/ENB/SOFI/BBAI)
//   2. Infers subCcy from position name if it contains "(CAD sub)" or "(USD sub)"
//      so the existing seed data correctly reflects RBC's sub-account split.
// Returns counts of fixes applied. Idempotent — safe to call multiple times.
// ─────────────────────────────────────────────────────────────────────
router.post("/migrate", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksPortfolio.findOne({ email: req.stocksUser.email });
    if (!doc) return res.json({ tickerFixes: 0, subCcyFixes: 0, message: "No portfolio." });

    let tickerFixes = 0;
    let subCcyFixes = 0;

    doc.positions = (doc.positions || []).map((p) => {
      const next = { ...(p.toObject?.() || p) };
      // 1. Trailing-dot cleanup
      const cleanedTicker = String(next.ticker || "").toUpperCase().replace(/\.+$/, "");
      if (cleanedTicker !== next.ticker) {
        next.ticker = cleanedTicker;
        tickerFixes++;
      }
      // 2. Infer subCcy from name field if it carries the hint
      if (next.subCcy == null && typeof next.name === "string") {
        const lc = next.name.toLowerCase();
        if (lc.includes("cad sub")) { next.subCcy = "CAD"; subCcyFixes++; }
        else if (lc.includes("usd sub")) { next.subCcy = "USD"; subCcyFixes++; }
      }
      return next;
    });

    if (tickerFixes > 0 || subCcyFixes > 0) {
      doc.markModified("positions");
      doc.lastSyncedAt = new Date();
      await doc.save();
    }

    res.json({
      tickerFixes,
      subCcyFixes,
      positionsTotal: doc.positions.length,
      message: tickerFixes + subCcyFixes === 0 ? "Nothing to migrate." : `Cleaned ${tickerFixes} tickers and inferred ${subCcyFixes} sub-account currencies.`,
    });
  } catch (err) {
    console.error("stocks-portfolio migrate error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/performance", requireStocksAuth, async (req, res) => {
  try {
    const since = new Date();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 365, 7), 1825);
    since.setDate(since.getDate() - days);
    const snaps = await StocksPortfolioSnapshot.find({
      email: req.stocksUser.email,
      createdAt: { $gte: since },
    })
      .sort({ date: 1 })
      .lean();
    res.json({ snapshots: snaps });
  } catch (err) {
    console.error("stocks-portfolio performance error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Cron-secret endpoint (used by Cowork scheduled tasks)
// ──────────────────────────────────────────────────────────────────────

router.get("/by-email/:email", requireCronSecret, async (req, res) => {
  try {
    const email = String(req.params.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Missing email" });
    const doc = await StocksPortfolio.findOne({ email }).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (err) {
    console.error("stocks-portfolio by-email error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
