// backend/routes/questrade.js
//
// Read-only Questrade integration endpoints. Every route here reads
// from Questrade or writes to our own model — none of them submit
// orders to Questrade. Order execution intentionally not built.
//
//   POST /api/questrade/connect             seed refresh token + save
//   POST /api/questrade/disconnect          wipe token, disable poller
//   POST /api/questrade/toggle-enabled      pause without disconnecting
//   GET  /api/questrade/status              connection + last poll + linked accounts
//   GET  /api/questrade/accounts            live account list (for account-link UI)
//   POST /api/questrade/account-links       user maps Questrade → internal accounts
//   POST /api/questrade/poll-now            manual poll (dev convenience)
//   POST /api/questrade/rescan              90-day rescan (resets watermark)

import express from "express";
import crypto from "crypto";
import QuestradeIntegration from "../models/QuestradeIntegration.js";
import { encryptSecret, isEncryptionConfigured, maskSecret } from "../services/stocksEncryption.js";
import { testConnection, exchangeRefreshToken, fetchAccounts } from "../services/questradeClient.js";
import { pollQuestradeMailboxLike, rescanQuestradeActivities } from "../services/questradeActivityPoller.js";

const router = express.Router();

// ── Auth (mirror of stocksPortfolio.js) ──────────────────────────
function getSecret() { return process.env.STOCKS_SECRET || process.env.MEDICENTRE_SECRET || ""; }
function b64urlDecode(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function b64url(buf) { return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
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

// ── POST /connect ────────────────────────────────────────────
router.post("/connect", requireStocksAuth, express.json({ limit: "8kb" }), async (req, res) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: "Server encryption key not configured (STOCKS_INTEGRATION_KEY)." });
    }
    const seed = String(req.body?.refreshToken || "").trim();
    if (!seed) return res.status(400).json({ error: "refreshToken required" });
    // Test the seed BEFORE persisting so a bad paste doesn't blank
    // an existing working integration.
    let firstExchange;
    try { firstExchange = await testConnection(seed); }
    catch (e) { return res.status(400).json({ error: `Seed token failed: ${e?.message || e}` }); }
    const doc = await QuestradeIntegration.findOneAndUpdate(
      { email: req.stocksUser.email },
      {
        $set: {
          envelopeRefreshToken: encryptSecret(firstExchange.refreshToken),
          accessToken: firstExchange.accessToken,
          apiServer: firstExchange.apiServer,
          accessTokenExpiresAt: firstExchange.expiresAt,
          enabled: true,
          needsReconnect: false,
          lastPollError: "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, apiServer: doc.apiServer, enabled: doc.enabled });
  } catch (err) {
    console.error("questrade/connect error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// ── POST /disconnect ─────────────────────────────────────────
router.post("/disconnect", requireStocksAuth, async (req, res) => {
  try {
    const doc = await QuestradeIntegration.findOneAndUpdate(
      { email: req.stocksUser.email },
      { $set: { enabled: false, envelopeRefreshToken: "", accessToken: "", apiServer: "", accessTokenExpiresAt: null, needsReconnect: false, lastPollError: "" } },
      { new: true }
    );
    res.json({ ok: true, disconnected: !!doc });
  } catch (err) {
    console.error("questrade/disconnect error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /toggle-enabled ─────────────────────────────────────
router.post("/toggle-enabled", requireStocksAuth, express.json({ limit: "1kb" }), async (req, res) => {
  try {
    const enabled = req.body?.enabled === true;
    const doc = await QuestradeIntegration.findOneAndUpdate(
      { email: req.stocksUser.email },
      { $set: { enabled } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "No Questrade integration configured yet" });
    res.json({ ok: true, enabled: doc.enabled });
  } catch (err) {
    console.error("questrade/toggle error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /status ──────────────────────────────────────────────
router.get("/status", requireStocksAuth, async (req, res) => {
  try {
    const doc = await QuestradeIntegration.findOne({ email: req.stocksUser.email }).lean();
    if (!doc) return res.json({ configured: false });
    res.json({
      configured: true,
      enabled: doc.enabled,
      needsReconnect: doc.needsReconnect,
      apiServer: doc.apiServer,
      hasToken: !!doc.envelopeRefreshToken,
      tokenMask: doc.envelopeRefreshToken ? maskSecret("questrade-refresh-token") : "",
      lastPolledAt: doc.lastPolledAt,
      lastPollSucceeded: doc.lastPollSucceeded,
      lastPollError: doc.lastPollError,
      lastActivityTs: doc.lastActivityTs,
      reconciledCount: doc.reconciledCount,
      accountLinks: doc.accountLinks || [],
    });
  } catch (err) {
    console.error("questrade/status error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /accounts (live) ─────────────────────────────────────
// Fetches live from Questrade so the account-link mapper UI can
// show the exact accounts + types the user has.
router.get("/accounts", requireStocksAuth, async (req, res) => {
  try {
    const integ = await QuestradeIntegration.findOne({ email: req.stocksUser.email });
    if (!integ) return res.status(404).json({ error: "Not connected to Questrade yet" });
    const accounts = await fetchAccounts(integ);
    res.json({ ok: true, accounts });
  } catch (err) {
    console.error("questrade/accounts error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// ── POST /account-links ──────────────────────────────────────
// Body: { links: [{ questradeAccountNumber, curriculateAccountId,
//                    questradeType, questradeStatus, enabled }] }
router.post("/account-links", requireStocksAuth, express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.links) ? req.body.links : null;
    if (!raw) return res.status(400).json({ error: "links[] required" });
    const clean = raw
      .filter(l => l && l.questradeAccountNumber && l.curriculateAccountId)
      .map(l => ({
        questradeAccountNumber: String(l.questradeAccountNumber),
        curriculateAccountId: String(l.curriculateAccountId),
        questradeType: l.questradeType ? String(l.questradeType) : "",
        questradeStatus: l.questradeStatus ? String(l.questradeStatus) : "",
        enabled: l.enabled !== false,
      }));
    const doc = await QuestradeIntegration.findOneAndUpdate(
      { email: req.stocksUser.email },
      { $set: { accountLinks: clean } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not connected to Questrade yet" });
    res.json({ ok: true, accountLinks: doc.accountLinks });
  } catch (err) {
    console.error("questrade/account-links error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /poll-now ────────────────────────────────────────────
router.post("/poll-now", requireStocksAuth, async (req, res) => {
  try {
    const r = await pollQuestradeMailboxLike(req.stocksUser.email);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error("questrade/poll-now error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// ── POST /rescan ──────────────────────────────────────────────
router.post("/rescan", requireStocksAuth, async (req, res) => {
  try {
    const r = await rescanQuestradeActivities(req.stocksUser.email);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error("questrade/rescan error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

export default router;
