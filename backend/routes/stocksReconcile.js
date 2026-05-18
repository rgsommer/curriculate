// backend/routes/stocksReconcile.js
//
// POST /api/stocks-reconcile
//
// Accepts one or more CIBC Investor's Edge AccountHoldings CSV exports
// (the file you download from "Accounts → Holdings → Download CSV"),
// parses them, and returns a structured diff against your app's current
// portfolio:
//
//   - Positions in CSV but missing in app
//   - Positions in app but missing in CSV
//   - Qty mismatches (per ticker, per account, per sub-currency)
//   - Cash balance mismatches (per account, per currency)
//
// The diff is read-only. The user reviews and chooses what to fix manually
// in the existing UI (or we can build an "Apply all" button later).
//
// CIBC CSV structure (one file per account × sub-currency combo):
//   Line 1: "ACCTID Account-Name SUBCCY"   e.g.  "60367867 TFSA - TFSA USD"
//   Line 2: Account holder name
//   Line 3: Date stamp
//   Lines 6-8: Today's Market Value / Cash Balance / Total Value
//   Line ~11: "Asset type","Currency held in","Symbol","Market","Description",
//             "Quantity","Price","Price change $","Price change %","Market value",
//             "Market value change $"
//   Following rows: one per position until a blank row
//
// USD-sub-account CSVs include an extra "Exchange rate" line.

import express from "express";
import crypto from "crypto";
import StocksPortfolio from "../models/StocksPortfolio.js";

const router = express.Router();

// ── token verification (same scheme as other stocks routes) ──────────
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

// ── CSV parsing ──────────────────────────────────────────────────────
function parseCsvRow(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function num(s) {
  if (typeof s !== "string") return 0;
  return parseFloat(s.replace(/,/g, "")) || 0;
}

export function parseCibcCsv(csv) {
  // Strip UTF-8 BOM if present (CIBC's export starts with ﻿)
  const clean = String(csv || "").replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);
  const rows = lines.map(parseCsvRow);
  if (rows.length === 0) return { error: "Empty file" };

  // Header line: "60367867 TFSA - TFSA USD"
  const headerCell = (rows[0] && rows[0][0] || "").replace(/^﻿/, "");
  const m = headerCell.match(/^(\d{6,12})\s+(.+?)\s+(CAD|USD)\s*$/);
  if (!m) {
    return { error: `Unrecognized header: "${headerCell}". Expected "ACCT_ID Account-Name CAD|USD"` };
  }
  const accountId = m[1];
  const accountName = m[2].trim();
  const subCurrency = m[3];

  let cashBalance = 0;
  let marketValue = 0;
  let totalValue = 0;
  let asOfDate = null;
  if (rows[2] && rows[2][0]) asOfDate = rows[2][0].trim();

  for (const r of rows) {
    const k = String(r[0] || "").trim();
    if (k === "Today's Cash Balance") cashBalance = num(r[1]);
    else if (k === "Today's Market Value of Securities") marketValue = num(r[1]);
    else if (k === "Today's Total Value") totalValue = num(r[1]);
  }

  // Positions: find "Asset type" header row, then collect until blank symbol
  const positions = [];
  let inPositions = false;
  for (const r of rows) {
    const first = String(r[0] || "").trim();
    if (first === "Asset type") { inPositions = true; continue; }
    if (!inPositions) continue;
    if (!first || !r[2]) {
      if (positions.length > 0) break;
      continue;
    }
    const [assetType, ccyHeld, symbol, market, description, qtyStr, priceStr] = r;
    if (assetType !== "Equities") continue;
    positions.push({
      ticker: String(symbol).toUpperCase().trim().replace(/\.+$/, ""),
      ccyHeld: ccyHeld === "USD" ? "USD" : "CAD",
      market: String(market || "").toUpperCase(), // US or CDN
      description: String(description || "").trim(),
      qty: num(qtyStr),
      price: num(priceStr),
    });
  }

  return {
    accountId,
    accountName,
    subCurrency,
    cashBalance,
    marketValue,
    totalValue,
    asOfDate,
    positions,
  };
}

// ── Diff computation ──────────────────────────────────────────────────
//
// For each parsed file, find the matching app account (by id), then
// compare positions and cash. Aggregate across multiple files for the
// same app account (one file per sub-currency).
function computeDiff(profile, parsedFiles) {
  // Build app-side snapshot grouped by account
  const appByAcct = new Map(); // acctId → { cashCad, cashUsd, positions: Map<ticker|subCcy, qty> }
  for (const a of profile.accounts || []) {
    appByAcct.set(a.id, {
      account: a,
      cashCad: a.cashCad || 0,
      cashUsd: a.cashUsd || 0,
      positions: new Map(),
    });
  }
  for (const p of profile.positions || []) {
    const bucket = appByAcct.get(p.acct);
    if (!bucket) continue;
    const sub = p.subCcy || p.ccy;
    const key = `${p.ticker}|${sub}`;
    bucket.positions.set(key, (bucket.positions.get(key) || 0) + (p.qty || 0));
  }

  // Group parsed files by account id
  const csvByAcct = new Map(); // acctId → { cashCad, cashUsd, positions: Map, files: [...] }
  for (const f of parsedFiles) {
    if (f.error) continue;
    if (!csvByAcct.has(f.accountId)) {
      csvByAcct.set(f.accountId, { cashCad: 0, cashUsd: 0, positions: new Map(), files: [], names: new Set() });
    }
    const b = csvByAcct.get(f.accountId);
    b.names.add(f.accountName);
    b.files.push(f);
    if (f.subCurrency === "CAD") b.cashCad += f.cashBalance;
    else b.cashUsd += f.cashBalance;
    for (const p of f.positions) {
      // CIBC's "Currency held in" tells us which sub-account holds the position
      const key = `${p.ticker}|${p.ccyHeld}`;
      b.positions.set(key, (b.positions.get(key) || 0) + p.qty);
    }
  }

  // Compute per-account diff
  const accounts = [];
  for (const [acctId, csv] of csvByAcct.entries()) {
    const app = appByAcct.get(acctId);
    if (!app) {
      accounts.push({
        acctId,
        accountName: [...csv.names].join(" / "),
        unmatched: true,
        message: `CIBC account ${acctId} doesn't match any app account. Add an account with id "${acctId}" in Settings (or fix the existing one), then re-upload.`,
        csvFiles: csv.files.length,
      });
      continue;
    }

    const issues = [];
    // Cash diff (use ~$1 tolerance to avoid rounding noise)
    if (Math.abs((app.cashCad || 0) - csv.cashCad) > 1) {
      issues.push({
        type: "cash",
        currency: "CAD",
        appValue: app.cashCad,
        csvValue: csv.cashCad,
        delta: csv.cashCad - app.cashCad,
      });
    }
    if (Math.abs((app.cashUsd || 0) - csv.cashUsd) > 1) {
      issues.push({
        type: "cash",
        currency: "USD",
        appValue: app.cashUsd,
        csvValue: csv.cashUsd,
        delta: csv.cashUsd - app.cashUsd,
      });
    }

    // Position diffs: walk union of keys
    const allKeys = new Set([...app.positions.keys(), ...csv.positions.keys()]);
    for (const key of allKeys) {
      const [ticker, sub] = key.split("|");
      const appQty = app.positions.get(key) || 0;
      const csvQty = csv.positions.get(key) || 0;
      if (Math.abs(appQty - csvQty) < 0.0001) continue;
      let kind;
      if (appQty === 0) kind = "missing_in_app";
      else if (csvQty === 0) kind = "extra_in_app";
      else kind = "qty_mismatch";
      issues.push({
        type: "position",
        kind,
        ticker,
        subCurrency: sub,
        appQty,
        csvQty,
        delta: csvQty - appQty,
      });
    }

    accounts.push({
      acctId,
      accountName: app.account.name,
      app: { cashCad: app.cashCad, cashUsd: app.cashUsd, positionsCount: app.positions.size },
      csv: { cashCad: csv.cashCad, cashUsd: csv.cashUsd, positionsCount: csv.positions.size, files: csv.files.length },
      issues,
      clean: issues.length === 0,
    });
  }

  // Also flag app accounts that weren't in any uploaded CSV
  for (const [acctId, app] of appByAcct.entries()) {
    if (csvByAcct.has(acctId)) continue;
    if (app.positions.size > 0 || (app.cashCad || 0) > 0 || (app.cashUsd || 0) > 0) {
      accounts.push({
        acctId,
        accountName: app.account.name,
        appOnly: true,
        message: `No CIBC file uploaded for "${app.account.name}" (id ${acctId}). Skipping — re-upload with this account's CSV if you want it reconciled.`,
        app: { cashCad: app.cashCad, cashUsd: app.cashUsd, positionsCount: app.positions.size },
      });
    }
  }

  return { accounts };
}

// ── Route ────────────────────────────────────────────────────────────
router.post("/", requireStocksAuth, async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : null;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Send { files: [{ filename, content }, ...] }" });
    }
    if (files.length > 20) {
      return res.status(400).json({ error: "Maximum 20 CSVs per request" });
    }

    const parsed = files.map((f) => {
      const r = parseCibcCsv(f?.content || "");
      return { filename: f?.filename || "", ...r };
    });

    const profile = await StocksPortfolio.findOne({ email: req.stocksUser.email }).lean();
    if (!profile) return res.status(404).json({ error: "No portfolio found" });

    const diff = computeDiff(profile, parsed);
    res.json({
      asOf: new Date().toISOString(),
      parsedFiles: parsed.map((p) => ({
        filename: p.filename,
        accountId: p.accountId,
        accountName: p.accountName,
        subCurrency: p.subCurrency,
        positionsCount: p.positions?.length || 0,
        cashBalance: p.cashBalance,
        error: p.error || null,
      })),
      ...diff,
    });
  } catch (err) {
    console.error("stocks-reconcile error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

export default router;
