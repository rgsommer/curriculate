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
//     the backend's /api/stocks-auth/verify-pin route. The signing secret
//     is read from STOCKS_SECRET (falls back to MEDICENTRE_SECRET) —
//     identical to the frontend so tokens round-trip.
//   • The /by-email/:email route is for the daily-briefing scheduled
//     task in Cowork. It's gated by CRON_SECRET (separate env var).

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksPortfolioSnapshot from "../models/StocksPortfolioSnapshot.js";
import { computeTwrr, annualizeTwrr } from "../services/stocksTwrr.js";
import { computeBenchmarkReturns } from "../services/stocksBenchmark.js";
import { computeCompliance } from "../services/stocksCompliance.js";
import { computeAttribution } from "../services/stocksAttribution.js";
import StocksRecIntent from "../models/StocksRecIntent.js";
import StocksEmailIntegration from "../models/StocksEmailIntegration.js";
import StocksTradeJournal from "../models/StocksTradeJournal.js";
import { encryptSecret, isEncryptionConfigured, maskSecret } from "../services/stocksEncryption.js";
import { backfillTradeToPortfolio } from "../services/stocksTradeApplier.js";

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

// Prefer the HttpOnly session cookie; fall back to the Authorization bearer
// (kept for transition + non-browser callers).
function getSessionToken(req) {
  const cookie = req.headers?.cookie || "";
  const m = cookie.match(/(?:^|;\s*)stocks_session=([^;]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  const a = req.headers?.authorization || req.headers?.Authorization || "";
  return typeof a === "string" && a.startsWith("Bearer ") ? a.slice(7).trim() : null;
}

// User-token middleware
function requireStocksAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: "Missing session credential" });
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

export async function writeDailySnapshot(doc) {
  const fx = doc.fxUsdCad || 1.37;
  const date = new Date().toISOString().slice(0, 10);
  const accounts = doc.accounts || [];

  // Per-account snapshots
  const perAccount = accounts.map(a => {
    let equitiesCad = 0;
    for (const p of doc.positions || []) {
      if (p.acct !== a.id || !p.qty) continue;
      const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
      if (!price) continue;
      equitiesCad += p.ccy === "USD" ? price * p.qty * fx : price * p.qty;
    }
    const cashCad = a.cashCad || 0;
    const cashUsd = a.cashUsd || 0;
    const total = equitiesCad + cashCad + cashUsd * fx;
    return {
      email: doc.email, date, accountId: a.id,
      equitiesCad, cashCad, cashUsd, totalCad: total,
      fxUsdCad: fx, positionsCount: (doc.positions || []).filter(p => p.acct === a.id).length,
    };
  });

  // Aggregate row
  const aggTotal = perAccount.reduce((s, r) => s + r.totalCad, 0);
  const aggEquities = perAccount.reduce((s, r) => s + r.equitiesCad, 0);
  const aggCashCad = perAccount.reduce((s, r) => s + r.cashCad, 0);
  const aggCashUsd = perAccount.reduce((s, r) => s + r.cashUsd, 0);

  const upserts = [
    ...perAccount.map(r =>
      StocksPortfolioSnapshot.findOneAndUpdate(
        { email: r.email, date: r.date, accountId: r.accountId },
        { $set: r },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    ),
    StocksPortfolioSnapshot.findOneAndUpdate(
      { email: doc.email, date, accountId: "__total__" },
      { $set: {
          email: doc.email, date, accountId: "__total__",
          totalCad: aggTotal,
          equitiesCad: aggEquities,
          cashCad: aggCashCad,
          cashUsd: aggCashUsd,
          fxUsdCad: fx,
          positionsCount: (doc.positions || []).length,
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
  ];
  await Promise.all(upserts);
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
  if (typeof body.consensusMode === "boolean") {
    out.consensusMode = body.consensusMode;
  }
  if (Array.isArray(body.briefingTimes)) {
    // Accept 0-4 entries in HH:MM 24-hour format; silently drop invalid ones.
    const valid = body.briefingTimes
      .filter(t => typeof t === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))
      .map(t => {
        // Normalize "7:30" → "07:30"
        const [h, m] = t.split(":");
        return `${h.padStart(2, "0")}:${m}`;
      });
    // Dedupe + sort + cap at 4
    out.briefingTimes = [...new Set(valid)].sort().slice(0, 4);
  }
  if (typeof body.briefingTz === "string" && body.briefingTz.length > 0 && body.briefingTz.length < 64) {
    out.briefingTz = body.briefingTz;
  }
  if (typeof body.intradayUpdatesEnabled === "boolean") {
    out.intradayUpdatesEnabled = body.intradayUpdatesEnabled;
  }
  if (typeof body.noTouchMode === "boolean") {
    out.noTouchMode = body.noTouchMode;
  }
  if (typeof body.optionsTradingEnabled === "boolean") {
    out.optionsTradingEnabled = body.optionsTradingEnabled;
  }
  if (typeof body.goals === "string") {
    out.goals = body.goals.slice(0, 5000);
  }
  if (body.annualContributionGoals && typeof body.annualContributionGoals === "object") {
    // Accept either shape:
    //   Legacy: { rrsp: 32000, resp: 2500, tfsa: 7000 }            (number = yearly)
    //   New:    { rrsp: { amount: 700, period: "monthly" }, ... }
    const g = body.annualContributionGoals;
    const norm = (v) => {
      if (typeof v === "number") {
        return { amount: v >= 0 ? v : 0, period: "yearly" };
      }
      if (v && typeof v === "object") {
        const a = typeof v.amount === "number" && v.amount >= 0 ? v.amount : 0;
        const p = v.period === "monthly" ? "monthly" : "yearly";
        return { amount: a, period: p };
      }
      return { amount: 0, period: "yearly" };
    };
    out.annualContributionGoals = {
      rrsp: norm(g.rrsp),
      resp: norm(g.resp),
      tfsa: norm(g.tfsa),
    };
  }
  if (Array.isArray(body.accounts)) {
    const sanitizeBeneficiaryAgreement = (ba) => {
      if (!ba || typeof ba !== "object") return { enabled: false };
      const inflowsRaw = Array.isArray(ba.inflows) ? ba.inflows : [];
      const loansRaw = Array.isArray(ba.loans) ? ba.loans : [];
      return {
        enabled: !!ba.enabled,
        loans: loansRaw
          .filter((l) => l && typeof l.id === "string"
            && typeof l.loanAmountCad === "number" && l.loanAmountCad >= 0
            && typeof l.termMonths === "number" && l.termMonths >= 1
            && l.startDate)
          .slice(0, 10)
          .map((l) => ({
            id: String(l.id).slice(0, 64),
            description: String(l.description || "Car loan").slice(0, 100),
            loanAmountCad: Number(l.loanAmountCad) || 0,
            interestRatePct: typeof l.interestRatePct === "number" && l.interestRatePct >= 0 && l.interestRatePct <= 100
              ? l.interestRatePct : 0,
            startDate: new Date(l.startDate),
            termMonths: Math.round(Number(l.termMonths)),
            notes: String(l.notes || "").slice(0, 500),
          })),
        name: String(ba.name || "").slice(0, 80),
        principalCad: typeof ba.principalCad === "number" && ba.principalCad >= 0 ? ba.principalCad : 0,
        interestRatePct: typeof ba.interestRatePct === "number" && ba.interestRatePct >= 0 && ba.interestRatePct <= 100
          ? ba.interestRatePct : 0,
        profitSharePct: typeof ba.profitSharePct === "number" && ba.profitSharePct >= 0 && ba.profitSharePct <= 100
          ? ba.profitSharePct : 0,
        profitShareEndPct: typeof ba.profitShareEndPct === "number" && ba.profitShareEndPct >= 0 && ba.profitShareEndPct <= 100
          ? ba.profitShareEndPct : null,
        profitShareRampYears: typeof ba.profitShareRampYears === "number" && ba.profitShareRampYears >= 0 && ba.profitShareRampYears <= 50
          ? ba.profitShareRampYears : 0,
        carryLosses: ba.carryLosses !== false, // default true
        startDate: ba.startDate ? new Date(ba.startDate) : null,
        principalStartDate: ba.principalStartDate ? new Date(ba.principalStartDate) : null,
        inflows: inflowsRaw
          .filter((i) => i && typeof i.description === "string" && typeof i.amountCad === "number" && i.amountCad >= 0)
          .slice(0, 20)
          .map((i) => ({
            description: String(i.description).slice(0, 100),
            amountCad: Number(i.amountCad) || 0,
            frequency: i.frequency === "yearly" ? "yearly" : "monthly",
            startDate: i.startDate ? new Date(i.startDate) : null,
            endDate: i.endDate ? new Date(i.endDate) : null,
          })),
        notes: String(ba.notes || "").slice(0, 1000),
        lockUntilDate: ba.lockUntilDate ? new Date(ba.lockUntilDate) : null,
        earlyPayoutPenaltyPct: typeof ba.earlyPayoutPenaltyPct === "number" && ba.earlyPayoutPenaltyPct >= 0 && ba.earlyPayoutPenaltyPct <= 100
          ? ba.earlyPayoutPenaltyPct : 0,
        redemptionNoticeMonths: typeof ba.redemptionNoticeMonths === "number" && ba.redemptionNoticeMonths >= 0 && ba.redemptionNoticeMonths <= 60
          ? Math.round(ba.redemptionNoticeMonths) : 0,
        payoutInstallments: typeof ba.payoutInstallments === "number" && ba.payoutInstallments >= 1 && ba.payoutInstallments <= 40
          ? Math.round(ba.payoutInstallments) : 1,
        payoutInstallmentFrequency: ["monthly", "quarterly", "yearly"].includes(ba.payoutInstallmentFrequency)
          ? ba.payoutInstallmentFrequency : "quarterly",
        accountHolderBuyoutRight: !!ba.accountHolderBuyoutRight,
        cpiAdjustmentPct: typeof ba.cpiAdjustmentPct === "number" && ba.cpiAdjustmentPct >= 0 && ba.cpiAdjustmentPct <= 20
          ? ba.cpiAdjustmentPct : 0,
      };
    };
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
        // Per-account risk override (nullable; falls back to global)
        riskTolerance: ["conservative", "moderate", "aggressive", "speculative"].includes(a.riskTolerance)
          ? a.riskTolerance : null,
        // Per-account monthly report flag + optional beneficiary agreement
        monthlyReportEnabled: !!a.monthlyReportEnabled,
        brokerAccountId: typeof a.brokerAccountId === "string"
          ? a.brokerAccountId.trim().slice(0, 32)
          : "",
        // Basic email validation: must contain "@" and a dot after it.
        // Empty string means "no extra recipient".
        monthlyReportCcEmail: (typeof a.monthlyReportCcEmail === "string"
          && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.monthlyReportCcEmail.trim()))
          ? a.monthlyReportCcEmail.trim().toLowerCase()
          : "",
        beneficiaryAgreement: sanitizeBeneficiaryAgreement(a.beneficiaryAgreement),
      }));
  }
  if (Array.isArray(body.positions)) {
    // Money/quantity coercion — reject NaN/Infinity (which `typeof === "number"`
    // would otherwise let through) and clamp to sane bounds so a malformed
    // client PUT can't poison cost basis / P&L math downstream.
    const money = (v) => (Number.isFinite(v) && v >= 0 && v <= 1e7 ? v : null);
    const qtyNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : 0;
    };
    out.positions = body.positions
      .filter((p) => p && p.ticker && p.qty != null)
      .slice(0, 500)
      .map((p) => ({
        acct: String(p.acct || "").slice(0, 64),
        // Strip trailing dots — defensive cleanup at the persistence layer
        // in case bad tickers slip through the AI parser.
        ticker: String(p.ticker || "").toUpperCase().slice(0, 16).replace(/\.+$/, ""),
        name: String(p.name || "").slice(0, 200),
        qty: qtyNum(p.qty),
        ccy: p.ccy === "CAD" ? "CAD" : "USD",
        subCcy: p.subCcy === "CAD" ? "CAD" : p.subCcy === "USD" ? "USD" : null,
        priceUsd: money(p.priceUsd),
        priceCad: money(p.priceCad),
        costBasisUsd: money(p.costBasisUsd),
        costBasisCad: money(p.costBasisCad),
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
//      so the existing seed data correctly reflects the broker's sub-account split.
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
    const filter = {
      email: req.stocksUser.email,
      createdAt: { $gte: since },
    };
    // Optional account filter — accountId param scopes to one account.
    if (req.query.accountId) filter.accountId = String(req.query.accountId);
    const snaps = await StocksPortfolioSnapshot.find(filter)
      .sort({ date: 1 })
      .lean();

    // Also surface the per-account list so the frontend can build a selector
    const accounts = await StocksPortfolio.findOne({ email: req.stocksUser.email }, { accounts: 1 }).lean();
    res.json({
      snapshots: snaps,
      accounts: accounts?.accounts || [],
    });
  } catch (err) {
    console.error("stocks-portfolio performance error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/stocks-portfolio/indicators
// Aggregate performance stats derived from the daily aggregate snapshots.
// Returns { current, wowChangePct, ytdChangePct, avg14dDailyPct,
// annualizedFrom14dPct, oldestSnapshotDate }. Points at accountId
// "__total__" (portfolio-wide). Silent nulls when the underlying series
// is too thin — better than misleading numbers.
router.get("/indicators", requireStocksAuth, async (req, res) => {
  try {
    const email = req.stocksUser.email;
    const snaps = await StocksPortfolioSnapshot.find({ email, accountId: "__total__" })
      .sort({ date: 1 })
      .lean();
    if (snaps.length === 0) return res.json({ ok: false, reason: "No portfolio snapshots yet." });
    const latest = snaps[snaps.length - 1];
    const current = latest.totalCad;

    // Helper: find snapshot at-or-before a target YYYY-MM-DD, walking back
    // from the end of the array. Handles weekends/holidays gracefully.
    const findAtOrBefore = (targetYmd) => {
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].date <= targetYmd) return snaps[i];
      }
      return null;
    };
    const ymdDaysAgo = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };

    const wowSnap = findAtOrBefore(ymdDaysAgo(7));
    const wowChangePct = wowSnap && wowSnap.totalCad > 0
      ? ((current - wowSnap.totalCad) / wowSnap.totalCad) * 100 : null;

    // YTD anchor = last snapshot on or before Jan 1 of this year. If the
    // series doesn't reach back that far, we can still show the change
    // vs the oldest snapshot as a fallback.
    const ytdAnchor = `${new Date().getUTCFullYear()}-01-01`;
    const ytdSnap = findAtOrBefore(ytdAnchor) || snaps[0];
    const ytdChangePct = ytdSnap && ytdSnap.totalCad > 0
      ? ((current - ytdSnap.totalCad) / ytdSnap.totalCad) * 100 : null;

    // 14d avg daily % — average of daily returns over the last 14 snapshots
    // (or as many as we have if fewer). Excludes today's snapshot from
    // the denominator so we compute returns pair-wise.
    let avg14dDailyPct = null;
    if (snaps.length >= 2) {
      const window = snaps.slice(-15); // last 15 snaps → 14 daily returns max
      const returns = [];
      for (let i = 1; i < window.length; i++) {
        const a = window[i - 1].totalCad;
        const b = window[i].totalCad;
        if (a > 0 && b > 0) returns.push((b - a) / a);
      }
      if (returns.length > 0) {
        const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
        avg14dDailyPct = mean * 100;
      }
    }
    // Annualized = compound the daily return over 252 trading days.
    // Uses the arithmetic 14d avg — good enough for a headline stat.
    const annualizedFrom14dPct = avg14dDailyPct != null
      ? (Math.pow(1 + avg14dDailyPct / 100, 252) - 1) * 100 : null;

    // Max % growth since start-of-tracking (the earliest snapshot). Useful
    // as a "high-water mark" — the best gain the portfolio ever hit vs
    // its inception value. Drawdown-from-peak is a natural sibling stat.
    const startValue = snaps[0].totalCad;
    let peakSnap = snaps[0];
    for (const s of snaps) if (s.totalCad > peakSnap.totalCad) peakSnap = s;
    const maxGrowthPct = startValue > 0
      ? ((peakSnap.totalCad - startValue) / startValue) * 100 : null;
    const currentGrowthPct = startValue > 0
      ? ((current - startValue) / startValue) * 100 : null;
    const drawdownFromPeakPct = peakSnap.totalCad > 0
      ? ((current - peakSnap.totalCad) / peakSnap.totalCad) * 100 : null;

    // TWRR (time-weighted, cash-flow-adjusted). This is the real answer
    // to "how am I doing on trading?" — deposits and withdrawals don't
    // distort it the way naive total-value % change does.
    const now = new Date();
    const wowStart = new Date(now); wowStart.setDate(wowStart.getDate() - 7);
    const ytdStart = new Date(`${now.getUTCFullYear()}-01-01T00:00:00Z`);
    const startWindow = new Date(snaps[0].date + "T00:00:00Z");
    const [wowTwrr, ytdTwrr, allTwrr] = await Promise.all([
      computeTwrr(email, wowStart, now).catch(() => null),
      computeTwrr(email, ytdStart, now).catch(() => null),
      computeTwrr(email, startWindow, now).catch(() => null),
    ]);
    const daysSinceStart = Math.max(1, Math.floor((now - startWindow) / 86400000));
    const annualizedFromTwrrPct = allTwrr
      ? annualizeTwrr(allTwrr.twrrPct, daysSinceStart)
      : null;

    // Benchmark comparison (SPY + XIC) — cached module-level so hitting
    // this endpoint from a page reload doesn't hammer Yahoo.
    const benchmarks = await computeBenchmarkReturns({
      oldestSnapshotDate: snaps[0].date,
      latestSnapshotDate: latest.date,
    }).catch(() => null);

    res.json({
      ok: true,
      current,
      currency: "CAD",
      wowChangePct,
      wowAnchorDate: wowSnap?.date || null,
      ytdChangePct,
      ytdAnchorDate: ytdSnap?.date || null,
      avg14dDailyPct,
      annualizedFrom14dPct,
      maxGrowthPct,
      maxGrowthDate: peakSnap.date,
      maxGrowthValue: peakSnap.totalCad,
      currentGrowthPct,
      drawdownFromPeakPct,
      startValue,
      snapshotCount: snaps.length,
      oldestSnapshotDate: snaps[0].date,
      latestSnapshotDate: latest.date,
      // Cash-flow-adjusted returns — deposits/withdrawals from the
      // trade journal (DEPOSIT/WITHDRAW legs) are subtracted from the
      // numerator of each sub-period. See services/stocksTwrr.js.
      twrr: {
        wowPct: wowTwrr?.twrrPct ?? null,
        ytdPct: ytdTwrr?.twrrPct ?? null,
        sinceStartPct: allTwrr?.twrrPct ?? null,
        annualizedPct: annualizedFromTwrrPct,
        netExternalFlowCad: allTwrr?.netExternalFlowCad ?? null,
      },
      benchmarks,
    });
  } catch (err) {
    console.error("stocks-portfolio indicators error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/stocks-portfolio/compliance
// Discipline compliance report for the last 90 days: take rate, hard-
// stop compliance, no-repeat pattern. Silent metrics on quiet weeks.
// ──────────────────────────────────────────────────────────────────────
router.get("/compliance", requireStocksAuth, async (req, res) => {
  try {
    const cmp = await computeCompliance(req.stocksUser.email);
    res.json({ ok: true, compliance: cmp });
  } catch (err) {
    console.error("stocks-portfolio compliance error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/stocks-portfolio/attribution
// Return attribution: closed trade P&L bucketed by sleeve / setup /
// score band / AI-vs-manual. Complements calibration by showing the
// actual dollar impact of each dimension, not just win rate.
// ──────────────────────────────────────────────────────────────────────
router.get("/attribution", requireStocksAuth, async (req, res) => {
  try {
    const att = await computeAttribution(req.stocksUser.email);
    res.json({ ok: true, attribution: att });
  } catch (err) {
    console.error("stocks-portfolio attribution error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/stocks-portfolio/rec-intents
// Returns the user's marked intent per rec (executed / skipped) so the
// UI can render checkbox state. Optional `since` filter for freshness.
// ──────────────────────────────────────────────────────────────────────
router.get("/rec-intents", requireStocksAuth, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 90 * 86400000);
    const rows = await StocksRecIntent.find({
      email: req.stocksUser.email,
      markedAt: { $gte: since },
    }).lean();
    res.json({ ok: true, intents: rows });
  } catch (err) {
    console.error("stocks-portfolio rec-intents error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/rec-intent
// Upsert an intent for a rec. Body: { recType, recId, intent, notes? }.
// Passing intent=null clears the mark. Never gates or affects the trade
// journal — intents and executions are independent stores.
// ──────────────────────────────────────────────────────────────────────
router.post("/rec-intent", requireStocksAuth, async (req, res) => {
  try {
    const { recType, recId, intent, notes } = req.body || {};
    if (!["advice", "daily-pick"].includes(recType)) {
      return res.status(400).json({ error: "recType must be 'advice' or 'daily-pick'" });
    }
    if (!recId || typeof recId !== "string" || !/^[a-f0-9]{24}$/i.test(recId)) {
      return res.status(400).json({ error: "recId must be a 24-char hex ObjectId" });
    }
    if (intent != null && !["executed", "skipped"].includes(intent)) {
      return res.status(400).json({ error: "intent must be 'executed', 'skipped', or null (to clear)" });
    }
    const filter = { email: req.stocksUser.email, recType, recId };
    if (intent == null) {
      await StocksRecIntent.deleteOne(filter);
      return res.json({ ok: true, cleared: true });
    }
    const doc = await StocksRecIntent.findOneAndUpdate(
      filter,
      { $set: { intent, markedAt: new Date(), notes: notes ? String(notes).slice(0, 500) : "" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, intent: doc });
  } catch (err) {
    console.error("stocks-portfolio rec-intent error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/stocks-portfolio/email-integration
// Returns the (non-secret) config + poller heartbeat for this user, or
// null if not configured. Never returns the encrypted password blob.
// ──────────────────────────────────────────────────────────────────────
router.get("/email-integration", requireStocksAuth, async (req, res) => {
  try {
    const doc = await StocksEmailIntegration.findOne({ email: req.stocksUser.email }).lean();
    if (!doc) {
      return res.json({
        ok: true,
        configured: false,
        encryptionReady: isEncryptionConfigured(),
      });
    }
    res.json({
      ok: true,
      configured: true,
      encryptionReady: isEncryptionConfigured(),
      provider: doc.provider,
      mailboxAddress: doc.mailboxAddress,
      passwordMask: "••••" + " ••••" + " ••••" + " ••••", // fixed mask; never derived from ciphertext
      imapSearchQuery: doc.imapSearchQuery,
      imapHost: doc.imapHost,
      imapPort: doc.imapPort,
      enabled: doc.enabled,
      lastPolledAt: doc.lastPolledAt,
      lastPollSucceeded: doc.lastPollSucceeded,
      lastPollError: doc.lastPollError,
      reconciledCount: doc.reconciledCount,
      configuredAt: doc.configuredAt,
    });
  } catch (err) {
    console.error("stocks-portfolio email-integration GET error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/email-integration
// Save or update the integration. Body: { mailboxAddress, appPassword,
// imapSearchQuery?, enabled? }. If appPassword is omitted, keeps the
// existing one (edit-metadata-only flow).
// ──────────────────────────────────────────────────────────────────────
router.post("/email-integration", requireStocksAuth, async (req, res) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "Server encryption key not configured (STOCKS_INTEGRATION_KEY)." });
    }
    const { mailboxAddress, appPassword, imapSearchQuery, enabled } = req.body || {};
    if (typeof mailboxAddress !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailboxAddress)) {
      return res.status(400).json({ error: "mailboxAddress must be a valid email address" });
    }

    const update = {
      mailboxAddress: mailboxAddress.trim().toLowerCase(),
    };
    if (typeof imapSearchQuery === "string" && imapSearchQuery.trim().length > 0) {
      update.imapSearchQuery = imapSearchQuery.trim().slice(0, 500);
    }
    if (typeof enabled === "boolean") update.enabled = enabled;

    // Only re-encrypt if a new password was submitted. Users editing
    // just the mailbox address / query don't need to re-enter the pw.
    if (typeof appPassword === "string" && appPassword.length > 0) {
      const normalized = appPassword.replace(/\s+/g, "");
      // Gmail app passwords are 16 chars alphanumeric. Warn but accept
      // anything reasonably-shaped so we don't lock out edge cases.
      if (normalized.length < 8 || normalized.length > 64) {
        return res.status(400).json({ error: "appPassword length looks wrong (expected 16 chars for Gmail app passwords)" });
      }
      update.envelopePassword = encryptSecret(normalized);
      update.lastPollError = "";      // clearing the error on fresh credentials
      update.lastPollSucceeded = null;
    }

    const existing = await StocksEmailIntegration.findOne({ email: req.stocksUser.email });
    if (!existing) {
      if (!update.envelopePassword) {
        return res.status(400).json({ error: "appPassword is required on first-time setup" });
      }
      update.email = req.stocksUser.email;
      update.provider = "gmail";
      update.configuredAt = new Date();
      const created = await StocksEmailIntegration.create(update);
      return res.json({ ok: true, created: true, id: created._id.toString() });
    }
    await StocksEmailIntegration.updateOne({ _id: existing._id }, { $set: update });
    res.json({ ok: true, updated: true });
  } catch (err) {
    console.error("stocks-portfolio email-integration POST error:", err);
    if (err?.code === "MISSING_ENCRYPTION_KEY" || err?.code === "INVALID_ENCRYPTION_KEY") {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// DELETE /api/stocks-portfolio/email-integration
// Removes the integration entirely. Poller state resets.
// ──────────────────────────────────────────────────────────────────────
router.delete("/email-integration", requireStocksAuth, async (req, res) => {
  try {
    await StocksEmailIntegration.deleteOne({ email: req.stocksUser.email });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("stocks-portfolio email-integration DELETE error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/email-integration/test
// Live IMAP round-trip: connect to Gmail with the stored credentials,
// list the mailbox, count messages matching the configured filter.
// Returns a definite yes/no + counts so the user knows the poller
// will actually see mail before waiting for the next cron tick.
// ──────────────────────────────────────────────────────────────────────
router.post("/email-integration/test", requireStocksAuth, async (req, res) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "Server encryption key not configured (STOCKS_INTEGRATION_KEY)." });
    }
    const { testConnection } = await import("../services/stocksEmailPoller.js");
    const result = await testConnection(req.stocksUser.email);
    if (!result.ok) return res.status(400).json(result);
    res.json({
      ok: true,
      mailboxPath: result.mailboxPath,
      exists: result.exists,
      matchingCount: result.matchingCount,
      query: result.query,
      message: `Logged in to ${result.mailboxPath} · ${result.exists} total messages · ${result.matchingCount} match filter "${result.query}".`,
    });
  } catch (err) {
    console.error("stocks-portfolio email-integration test error:", err);
    res.status(500).json({ error: `Internal error: ${err?.message || "unknown"}` });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/email-integration/backfill-positions
// Retroactively apply legs of previously-reconciled poller trades whose
// positions never got updated (pre-Phase-2B-fix rows). Dry-run mode
// available via ?dryRun=1 to preview counts without mutating.
// ──────────────────────────────────────────────────────────────────────
router.post("/email-integration/backfill-positions", requireStocksAuth, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    const email = req.stocksUser.email;
    const candidates = await StocksTradeJournal.find({
      email,
      brokerReconcileSource: "cibc-email",
      positionApplied: { $ne: true },
      // Only apply "auto" status — needs-review trades still need
      // manual account/rec resolution before their positions can move.
      brokerReconcileStatus: "auto",
    }).sort({ executedAt: 1 }).lean();

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        candidateCount: candidates.length,
        candidates: candidates.map(c => ({
          _id: String(c._id),
          executedAt: c.executedAt,
          account: c.accountName || c.account,
          leg: c.legs?.[0] ? `${c.legs[0].side} ${c.legs[0].shares} ${c.legs[0].ticker} @ $${c.legs[0].pricePerShare}` : null,
        })),
      });
    }

    // Apply in date order so multi-alert sequences on the same ticker
    // (e.g. SELL 100 then SELL 200) mutate in the order they hit the
    // broker. Skip failures — they might be over-sells against a
    // portfolio state that no longer reflects reality, and we don't
    // want one bad apple to stall the whole backfill.
    const applied = [];
    const failed = [];
    for (const doc of candidates) {
      // Re-fetch the mongoose doc so save() persists — the applier
      // does its own findOne on portfolio, so we only need the doc
      // shape here for legs/account/executedAt.
      try {
        await backfillTradeToPortfolio(doc);
        applied.push({ _id: String(doc._id), ticker: doc.legs?.[0]?.ticker, side: doc.legs?.[0]?.side, shares: doc.legs?.[0]?.shares });
      } catch (e) {
        failed.push({ _id: String(doc._id), ticker: doc.legs?.[0]?.ticker, error: e?.message || String(e) });
      }
    }
    res.json({
      ok: true,
      dryRun: false,
      appliedCount: applied.length,
      failedCount: failed.length,
      applied,
      failed,
    });
  } catch (err) {
    console.error("stocks-portfolio backfill-positions error:", err);
    res.status(500).json({ error: `Internal: ${err?.message || err}` });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/stocks-portfolio/email-integration/poll-now
// Trigger a poll immediately (bypass the cron schedule). Returns the
// same summary the cron logs — inserted / skipped / errors counts +
// per-message detail. Useful right after saving credentials so you
// don't have to wait 15 min for the first tick.
// ──────────────────────────────────────────────────────────────────────
router.post("/email-integration/poll-now", requireStocksAuth, async (req, res) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "Server encryption key not configured (STOCKS_INTEGRATION_KEY)." });
    }
    const { pollUserMailbox } = await import("../services/stocksEmailPoller.js");
    const result = await pollUserMailbox(req.stocksUser.email);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("stocks-portfolio email-integration poll-now error:", err);
    res.status(500).json({ error: `Internal error: ${err?.message || "unknown"}` });
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
