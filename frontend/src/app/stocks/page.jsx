"use client";

/**
 * Curriculate.net/stocks — Personal Stock Advisor
 *
 * Auth: passwordless email-PIN (6-digit code via Resend → HMAC session token).
 * Storage: MongoDB via the api.curriculate.net backend
 *   GET  /api/stocks-portfolio     — load current user's portfolio
 *   PUT  /api/stocks-portfolio     — upsert
 *   DELETE /api/stocks-portfolio   — reset
 * The real session credential lives in an HttpOnly cookie (set by the backend
 * on verify-pin and sent automatically via `credentials: "include"`), so it is
 * NOT reachable by JavaScript/XSS. localStorage holds only the email as a
 * non-secret "we were signed in" hint; on reload the cookie re-authenticates
 * (a 401 from the portfolio GET clears the hint). `auth.sessionToken` here is a
 * non-secret placeholder kept only to gate effects/props — the cookie is the
 * source of truth.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

// Non-secret placeholder. The actual credential is the HttpOnly cookie; this
// value only needs to be truthy so existing "signed-in?" gates keep working.
const COOKIE_MARKER = "cookie";

// =============================================================================
// Auth persistence (stores only { email } — never the token or portfolio data)
// =============================================================================
const AUTH_KEY = "stocksAdvisor.auth.v1";

function loadAuth() {
  if (typeof window === "undefined") return null;
  try {
    const j = JSON.parse(localStorage.getItem(AUTH_KEY));
    if (j && j.email) return { email: j.email, sessionToken: COOKIE_MARKER };
  } catch {}
  return null;
}
function saveAuth(auth) {
  if (typeof window === "undefined") return;
  // Persist email only — the credential is the HttpOnly cookie.
  if (auth && auth.email) localStorage.setItem(AUTH_KEY, JSON.stringify({ email: auth.email }));
  else localStorage.removeItem(AUTH_KEY);
}

// Clear the HttpOnly session cookie on the server (sign-out).
async function apiLogout() {
  try {
    await fetch(`${BACKEND_URL}/api/stocks-auth/logout`, { method: "POST", credentials: "include" });
  } catch {}
}

// Stream AI advice via SSE so the UI can show progress during the long
// web_search turn. Resolves with the final payload ({advice, sources, ...})
// on the "done" event; throws on "error" or if the stream ends without a
// result — callers fall back to the blocking POST /api/stocks-advice.
async function streamAdvice({ onPhase } = {}) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-advice/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok || !r.body) throw new Error(`stream HTTP ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join("")); } catch { continue; }
      if (event === "status" && data?.phase) onPhase?.(data.phase);
      else if (event === "error") throw new Error(data?.error || "stream error");
      else if (event === "done") result = data;
    }
  }
  if (result) return result;
  throw new Error("stream ended without result");
}

// Human label for a streaming advice phase (shown on the busy button).
function aiPhaseLabel(phase) {
  switch (phase) {
    case "signals": return "Gathering signals…";
    case "thinking": return "Thinking…";
    case "searching": return "Searching the web…";
    case "validating": return "Checking prices…";
    default: return null;
  }
}

// =============================================================================
// API client
// =============================================================================
async function apiGetPortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`GET failed: ${r.status}`);
  return r.json();
}

async function apiPutPortfolio(sessionToken, profile) {
  // NOTE: every persistable field MUST be listed here. The server sanitizer
  // ignores fields it doesn't recognize, but it cannot recover fields the
  // client never sent — and the doc-level $set will leave them untouched.
  // (Bug history: goals + contribution goals silently dropped because the
  // body picked only 4 fields. Then AGAIN with intraday/options/no-touch/
  // sleeveTargets — Settings toggles appeared to not persist because
  // this whitelist wasn't updated when the schema was.)
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      riskTolerance: profile.riskTolerance,
      fxUsdCad: profile.fxUsdCad,
      commissionPerTrade: profile.commissionPerTrade,
      fxSpreadPct: profile.fxSpreadPct,
      consensusMode: profile.consensusMode,
      briefingTimes: profile.briefingTimes,
      briefingTz: profile.briefingTz,
      intradayUpdatesEnabled: profile.intradayUpdatesEnabled,
      optionsTradingEnabled: profile.optionsTradingEnabled,
      noTouchMode: profile.noTouchMode,
      disciplineCriticEnabled: profile.disciplineCriticEnabled,
      volSizingEnabled: profile.volSizingEnabled,
      riskPerTradePct: profile.riskPerTradePct,
      kellyFractionCap: profile.kellyFractionCap,
      pyramidingEnabled: profile.pyramidingEnabled,
      sleeveTargets: profile.sleeveTargets,
      goals: profile.goals,
      annualContributionGoals: profile.annualContributionGoals,
      accounts: profile.accounts,
      positions: profile.positions,
      plannedWithdrawals: profile.plannedWithdrawals,
    }),
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`PUT failed: ${r.status}`);
  return r.json();
}

async function apiDeletePortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    method: "DELETE",
    credentials: "include",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`DELETE failed: ${r.status}`);
  return r.json();
}

async function apiMigratePortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/migrate`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`Migrate failed: ${r.status}`);
  return r.json();
}

async function apiRecordTrade(sessionToken, trade) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-trade`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(trade),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

async function apiListPendingOrders(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.orders || [];
}
async function apiCreatePendingOrder(sessionToken, order) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(order),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.order;
}
async function apiFillPendingOrder(sessionToken, id, fill) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders/${id}/fill`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(fill || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}
async function apiCancelPendingOrder(sessionToken, id) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

// =============================================================================
// Seed: Richard's portfolio (auto-loads on first sign-in for rgsommer@me.com)
// =============================================================================
const RICHARD_PORTFOLIO = {
  riskTolerance: "aggressive",
  currency: "CAD",
  fxUsdCad: 1.372,
  accounts: [
    { id: "a1", name: "Non-Spousal (59659702)" },
    { id: "a2", name: "RRSP (59659702)" },
    { id: "a3", name: "TFSA (60367867)" },
  ],
  positions: [
    { acct: "a1", ticker: "RUM",   name: "Rumble Inc Class A",                qty: 771,  priceCad: 10.171,  priceUsd: 7.413, ccy: "USD" },
    { acct: "a1", ticker: "DJT",   name: "Trump Media & Tech",                qty: 3,    priceCad: 11.9485, priceUsd: 8.705, ccy: "USD" },
    { acct: "a2", ticker: "BBAI",  name: "BigBear AI",                        qty: 410,  priceCad: 5.6959,  priceUsd: 4.151, ccy: "USD" },
    { acct: "a2", ticker: "ENB",   name: "Enbridge Inc",                      qty: 18,   priceCad: 75.58,                    ccy: "CAD" },
    { acct: "a2", ticker: "SLV.V", name: "Silver Dollar Resources",           qty: 4555, priceCad: 0.33,                     ccy: "CAD" },
    { acct: "a2", ticker: "DJT",   name: "Trump Media (CAD sub)",             qty: 1267, priceCad: 11.9485, priceUsd: 8.705, ccy: "USD" },
    { acct: "a2", ticker: "DJTWW", name: "Trump Media Warrants (CAD sub)",    qty: 235,  priceCad: 5.8198,  priceUsd: 4.241, ccy: "USD" },
    { acct: "a2", ticker: "SOFI",  name: "SoFi Technologies",                 qty: 197,  priceUsd: 15.6211, ccy: "USD" },
    { acct: "a2", ticker: "SOUN",  name: "SoundHound AI",                     qty: 593,  priceUsd: 8.5087,  ccy: "USD" },
    { acct: "a2", ticker: "TSLA",  name: "Tesla Inc",                         qty: 34,   priceUsd: 426.8401, ccy: "USD" },
    { acct: "a2", ticker: "DJT",   name: "Trump Media (USD sub)",             qty: 1300, priceUsd: 8.705,   ccy: "USD" },
    { acct: "a2", ticker: "DJTWW", name: "Trump Media Warrants (USD sub)",    qty: 185,  priceUsd: 4.24,    ccy: "USD" },
    { acct: "a3", ticker: "DJT",   name: "Trump Media (TFSA CAD sub)",        qty: 1,    priceCad: 11.9416, priceUsd: 8.703, ccy: "USD" },
    { acct: "a3", ticker: "DJTWW", name: "Trump Media Warrants (TFSA CAD)",   qty: 1,    priceCad: 5.7512,  priceUsd: 4.19,  ccy: "USD" },
    { acct: "a3", ticker: "DJT",   name: "Trump Media (TFSA USD sub)",        qty: 904,  priceUsd: 8.70,    ccy: "USD" },
    { acct: "a3", ticker: "DJTWW", name: "Trump Media Warrants (TFSA USD)",   qty: 61,   priceUsd: 4.19,    ccy: "USD" },
  ],
};

// =============================================================================
// Formatters + math
// =============================================================================
const fmtMoney = (n, ccy = "CAD") => {
  if (n == null || isNaN(n)) return "—";
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "−" : "") + "$" + s + " " + ccy;
};

// Privacy mask — applied to USER-specific dollar amounts (account balances,
// position values, cash, etc.) when privacy mode is on. Market prices and
// rec-target prices stay visible since they're not user-private.
const PRIVACY_KEY = "stocksAdvisor.privacy.v1";
function loadPrivacy() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PRIVACY_KEY) === "1";
}
function savePrivacy(on) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(PRIVACY_KEY, "1");
  else localStorage.removeItem(PRIVACY_KEY);
}
const MASK = "$•••••";
const MASK_SHORT = "•••";
function priv(value, privacy) { return privacy ? MASK : value; }
function privShort(value, privacy) { return privacy ? MASK_SHORT : value; }

const fmtPct = (n) => (n == null || isNaN(n) ? "—" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%");

// Registered / tax-treatment classifications for a brokerage account.
// Shared by the Positions view account-header dropdown and the Settings
// per-account editor so the two never drift out of sync. Mirror of the
// enum on the backend AccountSchema — keep in lockstep on any change.
// The short label lives in badges/chips; the long label in dropdowns.
const ACCOUNT_TYPES = [
  { value: "individual",   short: "Individual",   long: "Individual (taxable non-registered)" },
  { value: "joint",        short: "Joint",        long: "Joint (taxable non-registered)" },
  { value: "rrsp",         short: "RRSP",         long: "RRSP — Registered Retirement Savings Plan" },
  { value: "spousal-rrsp", short: "Spousal RRSP", long: "Spousal RRSP" },
  { value: "tfsa",         short: "TFSA",         long: "TFSA — Tax-Free Savings Account" },
  { value: "fhsa",         short: "FHSA",         long: "FHSA — First Home Savings Account" },
  { value: "rrif",         short: "RRIF",         long: "RRIF — Registered Retirement Income Fund" },
  { value: "lira",         short: "LIRA",         long: "LIRA — Locked-In Retirement Account" },
  { value: "lif",          short: "LIF",          long: "LIF — Life Income Fund" },
  { value: "resp",         short: "RESP",         long: "RESP — Registered Education Savings Plan" },
  { value: "corporate",    short: "Corporate",    long: "Corporate (holding/opco)" },
  { value: "trust",        short: "Trust",        long: "Trust" },
  { value: "other",        short: "Other",        long: "Other" },
];
const ACCOUNT_TYPE_SHORT = Object.fromEntries(ACCOUNT_TYPES.map(t => [t.value, t.short]));

// Human-readable summary of a rescan-mailbox response. Backend returns
// { inserted, skipped, errors, batches, queryStripped, currentQuery,
//   details:{ inserted:[], skipped:[{reason,subject,from,...}], errors:[] } }.
// We aggregate skipped[].reason into buckets so the operator can tell
// dedup wins ("duplicate-poller", "matches-existing-trade") apart from
// real drops ("not-a-cibc-alert", "no-source").
function buildRescanBannerMessage(j) {
  if (j?.fatal) return `Rescan failed: ${j.fatal}`;
  if (j?.skipped === "not-configured") return "Rescan skipped — email integration not configured.";
  if (j?.skipped === "disabled")       return "Rescan skipped — email integration is disabled.";
  if (j?.skipped === "no-profile")     return "Rescan skipped — no portfolio profile.";
  const parts = [];
  if (Number.isFinite(j.inserted)) parts.push(`${j.inserted} inserted`);
  if (Number.isFinite(j.skipped)) parts.push(`${j.skipped} skipped`);
  if (Number.isFinite(j.errors)) parts.push(`${j.errors} errors`);
  if (Number.isFinite(j.batches) && j.batches > 1) parts.push(`${j.batches} batches`);
  let msg = `Rescan complete — ${parts.join(" · ") || "no matches"}`;
  const skippedRows = Array.isArray(j.details?.skipped) ? j.details.skipped : [];
  if (skippedRows.length > 0) {
    const bucketLabels = {
      "duplicate-poller":       "already recorded (reconcile-key)",
      "matches-existing-trade": "already in journal (manual/CSV/prior)",
      "not-a-cibc-alert":       "unrecognized format",
      "no-source":              "empty message",
    };
    const counts = {};
    for (const s of skippedRows) counts[s.reason] = (counts[s.reason] || 0) + 1;
    const breakdown = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${n} ${bucketLabels[reason] || reason}`)
      .join(" · ");
    if (breakdown) msg += `\nSkipped: ${breakdown}`;
  }
  if (j.queryStripped) {
    msg += `\n✓ Cleaned "is:unread" out of the mailbox filter — alerts you read on your phone will now be seen.`;
  }
  return msg;
}

function valueOfPosition(p, fx) {
  if (p.ccy === "USD") {
    const cad = (p.priceCad ?? (p.priceUsd * fx)) * p.qty;
    return { cad, usd: (p.priceUsd ?? p.priceCad / fx) * p.qty };
  }
  return { cad: p.priceCad * p.qty, usd: (p.priceCad / fx) * p.qty };
}

// Common-name → canonical-ticker aliases (mirrors backend TICKER_ALIASES
// for the chart path). Catches "RBC" → "RY" etc. so the chart fetches the
// right company's price data, not RBC Bearings'.
const CHART_TICKER_ALIASES = {
  "RBC": "RY", "ROYAL": "RY",
  "TDB": "TD",
  "SCOTIA": "BNS",
  "CIBC": "CM",
  "NATIONAL": "NA",
  "ENBRIDGE": "ENB",
  "FORTIS": "FTS",
  "TCENERGY": "TRP",
  "MANULIFE": "MFC",
  "SUNLIFE": "SLF",
  "GOOGLE": "GOOGL",
  "ALPHABET": "GOOGL",
  "FACEBOOK": "META",
  "FB": "META",
  "SQUARE": "XYZ",
  "SQ": "XYZ",
};

// Resolve the right exchange ticker for chart / quote lookups, based on
// the position's trading currency. ENB held in a CAD sub → "ENB.TO" (the
// TSX listing) so the chart shows the Canadian price, not the US ADR.
// If the ticker already carries a Canadian suffix (.TO/.V/.NE/.CN), or
// the position trades in USD, leave it as-is.
function resolveChartTicker(ticker, currency) {
  const raw = String(ticker || "").toUpperCase().replace(/\.+$/, "");
  const aliased = CHART_TICKER_ALIASES[raw] || raw;
  const hasCadSuffix = /\.(TO|V|NE|CN)$/.test(aliased);
  if (currency === "CAD" && !hasCadSuffix) return `${aliased}.TO`;
  return aliased;
}

function aggregateByTicker(positions, fx) {
  const m = {};
  positions.forEach((p) => {
    const v = valueOfPosition(p, fx);
    if (!m[p.ticker]) m[p.ticker] = {
      ticker: p.ticker,
      name: p.name,
      qty: 0,
      cad: 0,
      usd: 0,
      // Track how much value sits in each currency so we can pick the
      // right exchange listing for the chart (largest-bucket wins).
      _cadValue: 0,
      _usdValue: 0,
    };
    m[p.ticker].qty += p.qty;
    m[p.ticker].cad += v.cad;
    m[p.ticker].usd += v.usd;
    if (p.ccy === "USD") m[p.ticker]._usdValue += v.cad; // both in CAD-equiv
    else m[p.ticker]._cadValue += v.cad;
  });
  // Attach chartTicker to each agg row based on dominant currency
  for (const row of Object.values(m)) {
    const dominantCcy = row._cadValue >= row._usdValue ? "CAD" : "USD";
    row.chartTicker = resolveChartTicker(row.ticker, dominantCcy);
    row.chartCurrency = dominantCcy;
    delete row._cadValue;
    delete row._usdValue;
  }
  return Object.values(m).sort((a, b) => b.cad - a.cad);
}

const totalCad = (positions, fx) =>
  positions.reduce((s, p) => s + valueOfPosition(p, fx).cad, 0);

// Per-ticker P/L (in CAD) using stored cost basis. Positions without a
// recorded cost basis are excluded from cost totals; if a ticker's lots
// have NO basis recorded at all, pnlCad/pnlPct are null and the UI shows
// a "no basis" hint.
function pnlByTicker(positions, fx) {
  const out = {};
  for (const p of positions) {
    if (!out[p.ticker]) {
      out[p.ticker] = { ticker: p.ticker, qty: 0, valueCad: 0, costCad: 0, hasBasis: false };
    }
    const row = out[p.ticker];
    const fxMult = p.ccy === "USD" ? fx : 1;
    const price = p.ccy === "USD" ? (p.priceUsd ?? (p.priceCad ? p.priceCad / fx : 0)) : (p.priceCad ?? 0);
    const cost = p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
    row.qty += p.qty || 0;
    row.valueCad += price * (p.qty || 0) * fxMult;
    if (cost != null) {
      row.costCad += cost * (p.qty || 0) * fxMult;
      row.hasBasis = true;
    }
  }
  for (const t of Object.keys(out)) {
    const r = out[t];
    if (r.hasBasis && r.costCad > 0) {
      r.pnlCad = r.valueCad - r.costCad;
      r.pnlPct = (r.pnlCad / r.costCad) * 100;
    } else {
      r.pnlCad = null;
      r.pnlPct = null;
    }
  }
  return out;
}

// Sum cash across all accounts, converted to CAD.
function totalCashCad(accounts, fx) {
  if (!accounts) return 0;
  return accounts.reduce(
    (s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx,
    0
  );
}

// Per-currency cash totals across all accounts.
function totalCashByCurrency(accounts) {
  const out = { cad: 0, usd: 0 };
  if (!accounts) return out;
  for (const a of accounts) {
    out.cad += a.cashCad || 0;
    out.usd += a.cashUsd || 0;
  }
  return out;
}

// =============================================================================
// Recommendation parser — extracts structured BUY/SELL/TRIM rows from
// the prose body of an AI advice card.
//
// Input: a body string that may contain one or more "Action:" lines like
//   "Action: BUY 80 sh NVDA. Entry: $132-$135 USD. Target: $185 USD (9mo).
//    Stop: $115. Horizon: 9 months. Uses ~$10,640 USD."
// Output: { intro, recs: [{...}], outro }
// =============================================================================
// Extract the first plausible ticker from a card title like "PLTR — hold core"
// or "DJT concentration now 25.6%". Used as a fallback when the rec body
// has "Action: HOLD CURRENT" with no proper ticker after the verb.
function extractTickerFromTitle(title) {
  if (!title || typeof title !== "string") return null;
  const re = /\b([A-Z]{2,5}(?:\.[A-Z]{1,3})?)\b/g;
  let m;
  while ((m = re.exec(title)) !== null) {
    const t = m[1].toUpperCase();
    if (!REC_STOP_WORD_TICKERS.has(t)) return t;
  }
  return null;
}

function parseRecsFromBody(body, cardTitle = null) {
  if (!body || typeof body !== "string") return { intro: "", recs: [], outro: "" };
  // Find every "Action:" marker and the span of text that belongs to each rec
  // (from this Action: up to the next Action: or end of body).
  const actionRe = /\bAction:\s*/gi;
  const indices = [];
  let m;
  while ((m = actionRe.exec(body)) !== null) indices.push(m.index);
  if (indices.length === 0) return { intro: body, recs: [], outro: "" };

  const fallbackTicker = extractTickerFromTitle(cardTitle);
  const intro = body.slice(0, indices[0]).trim();
  const recs = [];
  let outro = "";
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : body.length;
    const chunk = body.slice(start, end);
    const parsed = parseSingleRec(chunk, fallbackTicker);
    if (parsed) recs.push(parsed);
  }
  // If the last rec ends before body end, anything after the last "." inside
  // the last chunk's content is intro/outro material — try to capture a tail
  // sentence like "Remaining ~$2,486 USD reserve for dip-buying."
  const lastIdx = indices[indices.length - 1];
  const tailStart = body.lastIndexOf(".", body.length - 1);
  if (tailStart > lastIdx + 20) {
    // Walk forward from the start of the last chunk to find the trailing prose
    const chunk = body.slice(lastIdx);
    // Strip out the parsed key/value fields and keep anything that wasn't matched
    const stripped = chunk
      .replace(/Action:[^.]*\./i, "")
      .replace(/Entry:[^.]*\./i, "")
      .replace(/Target:[^.]*\./i, "")
      .replace(/Stop:[^.]*\./i, "")
      .replace(/Horizon:[^.]*\./i, "")
      .replace(/Uses[^.]*\./i, "")
      .trim();
    if (stripped.length > 10) outro = stripped;
  }
  return { intro, recs, outro };
}

// English stop-words the AI sometimes writes after the action verb that
// would otherwise be matched as tickers — "SELL ENTIRE position", "HOLD
// CURRENT lot", "HOLD BOTH lots", "SELL ALL warrants", "HOLD BUT raise
// stop". These have to be rejected so the rec parser falls through to
// finding the real ticker later in the chunk (or drops the rec).
const REC_STOP_WORD_TICKERS = new Set([
  "ALL", "ANY", "BOTH", "BUT", "CURRENT", "ENTIRE", "EVERY", "NONE",
  "POSITION", "POSITIONS", "LOT", "LOTS", "REMAINING", "RESERVE",
  "STOP", "TARGET", "ENTRY", "ACTION", "HORIZON", "SOURCE",
  "USING", "USES", "INTO", "FROM", "BUY", "SELL", "HOLD", "TRIM",
  "NEW", "OLD", "MORE", "LESS", "BOTH", "EITHER", "NEITHER",
  "THE", "A", "AN", "AT", "ON", "TO", "OF", "FOR", "IN", "WITH",
  "USD", "CAD", "EUR", "GBP", "RRSP", "TFSA", "RESP", "FHSA",
  "MARKET", "LIMIT", "GTC", "DAY", "OCO",
]);

function parseSingleRec(chunk, fallbackTicker = null) {
  // Strip the leading "Action:"
  const text = chunk.replace(/^\s*Action:\s*/i, "");
  // Side
  const sideM = text.match(/^(BUY|SELL|TRIM|HOLD)\b/i);
  if (!sideM) return null;
  const side = sideM[1].toUpperCase();
  // After side: optional shares + ticker
  const headM = text.match(/^(BUY|SELL|TRIM|HOLD)\s+(\d[\d,]*)?\s*(?:sh)?\s*([A-Z][A-Z0-9.\-]{0,15})/i);
  if (!headM) return null;
  const shares = headM[2] ? parseInt(headM[2].replace(/,/g, ""), 10) : null;
  // Strip trailing dots — the regex's `.` allowance was capturing the
  // sentence-ending period (e.g. "BUY 40 sh PLTR." → ticker "PLTR.")
  let ticker = headM[3].toUpperCase().replace(/\.+$/, "");
  // Reject English stop-words and look deeper in the chunk for a real
  // ticker. The AI sometimes writes "Action: HOLD CURRENT position. Target:
  // $84 CAD." — we want the real ticker, not the word CURRENT.
  if (REC_STOP_WORD_TICKERS.has(ticker)) {
    // Search the rest of the chunk for a proper ticker pattern. Prefer the
    // first uppercase 2-5 letter token that isn't a stop-word.
    const tickerScan = /\b([A-Z]{2,5}(?:\.[A-Z]{1,3})?)\b/g;
    let realTicker = null;
    let scanM;
    while ((scanM = tickerScan.exec(text)) !== null) {
      const candidate = scanM[1].toUpperCase().replace(/\.+$/, "");
      if (!REC_STOP_WORD_TICKERS.has(candidate)) { realTicker = candidate; break; }
    }
    if (realTicker) {
      ticker = realTicker;
    } else if (fallbackTicker) {
      ticker = fallbackTicker.toUpperCase().replace(/\.+$/, "");
    } else {
      // No ticker recoverable — drop this rec so it doesn't render as
      // a junk row (the narrative below the Action line still shows).
      return null;
    }
  }

  // Extract each labeled field's value up to the next period/newline.
  // Stop at the FIRST period that isn't inside parens, so "Stop: $69 CAD
  // (2.5×ATR)" reads the full string and "Stop: $69. Horizon: 12mo" stops
  // at $69. Without paren-awareness we got fragments like "$69 CAD (2".
  const fieldVal = (label) => {
    const re = new RegExp(`${label}:\\s*([^\\n]+?)(?=\\s*(?:Entry|Target|Stop|Horizon|Order ticket|After fill|Account|Source|Cost note|Uses|Tax-fit|Rationale):|\\.\\s|\\.$|\\n|$)`, "i");
    const m = text.match(re);
    if (!m) return null;
    // Trim trailing period
    return m[1].trim().replace(/\.$/, "");
  };
  const entryRaw = fieldVal("Entry");
  const targetRaw = fieldVal("Target");
  const stopRaw = fieldVal("Stop");
  const horizonRaw = fieldVal("Horizon");
  const usesM = text.match(/Uses[^$0-9]*([~$]?\s*[\d.,]+)\s*(USD|CAD)?/i);
  const usesRaw = usesM ? usesM[1].trim() : null;
  const usesCcy = usesM?.[2]?.toUpperCase() || null;

  // Try to detect currency from any of the price strings
  const ccyFromText = (s) => {
    if (!s) return null;
    if (/\bCAD\b/i.test(s)) return "CAD";
    if (/\bUSD\b/i.test(s)) return "USD";
    return null;
  };
  const currency =
    ccyFromText(entryRaw) || ccyFromText(targetRaw) || ccyFromText(stopRaw) || usesCcy || "USD";

  // Parse a price scalar (low number of a range, or the single number)
  const priceLow = (s) => {
    if (!s) return null;
    const m = s.match(/\$?\s*([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  };

  return {
    side, ticker, shares,
    currency,
    entryText: entryRaw,
    entryLow: priceLow(entryRaw),
    targetText: targetRaw,
    targetVal: priceLow(targetRaw),
    stopText: stopRaw,
    stopVal: priceLow(stopRaw),
    horizonText: horizonRaw,
    usesText: usesRaw ? (usesRaw + (usesCcy ? ` ${usesCcy}` : "")) : null,
  };
}

// =============================================================================
// Advice engine
// =============================================================================
function generateAdvice(profile) {
  const fx = profile.fxUsdCad || 1.37;
  const total = totalCad(profile.positions, fx);
  const agg = aggregateByTicker(profile.positions, fx);
  const advice = [];

  agg.forEach((a) => {
    const pct = (a.cad / total) * 100;
    if (pct >= 30) {
      advice.push({
        sev: "danger",
        title: `Concentration risk: ${a.ticker} is ${pct.toFixed(1)}% of your book`,
        body: `Even on an aggressive mandate, a single-ticker weight above ~25% turns the whole portfolio into a bet on one company. Consider trimming ${a.ticker} toward 20-25% over the next 5 sessions and redeploying into ballast (ENB, cash) or non-correlated growth (NVDA, PLTR).`,
        meta: `Current value: ${fmtMoney(a.cad, "CAD")} · ${a.qty.toLocaleString()} shares`,
      });
    } else if (pct >= 20) {
      advice.push({
        sev: "warn",
        title: `Heavy exposure: ${a.ticker} is ${pct.toFixed(1)}% of your book`,
        body: `Acceptable on an aggressive mandate but worth watching. Set a mental stop-loss on ${a.ticker} so you don't ride a thesis-break all the way down.`,
        meta: `Current value: ${fmtMoney(a.cad, "CAD")}`,
      });
    }
  });

  const cluster = agg
    .filter((a) => ["DJT", "DJTWW", "RUM"].includes(a.ticker))
    .reduce((s, a) => s + a.cad, 0);
  const clusterPct = (cluster / total) * 100;
  if (clusterPct >= 30) {
    advice.push({
      sev: "warn",
      title: `Thematic cluster: ${clusterPct.toFixed(0)}% in Trump-media / right-wing-internet cluster (DJT + DJTWW + RUM)`,
      body: `These names move together on the same political-cycle catalysts. Treat the cluster as one bet for sizing purposes.`,
      meta: `Cluster value: ${fmtMoney(cluster, "CAD")}`,
    });
  }

  const tickers = agg.map((a) => a.ticker);
  if (!tickers.some((t) => ["VOO", "VTI", "XEQT", "XIC", "XIU", "SPY", "QQQ"].includes(t))) {
    advice.push({
      sev: "info",
      title: "No broad index exposure",
      body: `You're entirely in single-name picks. Even aggressive portfolios usually keep 10-25% in a broad index (XEQT for CAD, VOO/QQQ for USD) as the "if I'm wrong about everything else" cushion.`,
      meta: "Suggested: 10-15% in XEQT.TO or VOO",
    });
  }

  const cashHints = tickers.filter((t) => ["CASH", "CASH.TO", "HISA", "SGOV", "BIL"].includes(t));
  if (cashHints.length === 0) {
    advice.push({
      sev: "info",
      title: "No dry powder",
      body: `Holding 5-10% in CASH.TO (HISA equivalent, ~4.5% yield) gives you the ability to add to winners on dips. With your concentration, the upside of having dry powder is high.`,
      meta: "Tickers to consider: CASH.TO (HISA equivalent), SGOV (US T-bill ETF)",
    });
  }

  if (profile.riskTolerance === "conservative") {
    advice.push({
      sev: "warn",
      title: "Risk profile mismatch?",
      body: "Your risk tolerance is Conservative but your positions look aggressive. Either change your profile in Settings or consider rebalancing toward bonds, dividend stocks, and broad index ETFs.",
      meta: "",
    });
  }

  if (profile.positions.length === 0) {
    advice.unshift({
      sev: "info",
      title: "Add positions to get tailored advice",
      body: "Use the Positions tab to add your holdings. Once you have positions, this page will surface concentration, cluster, and diversification flags daily.",
      meta: "",
    });
  }

  advice.push({
    sev: "good",
    title: `Daily briefing — ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
    body: "Your morning briefing arrives at 7:30 AM ET each weekday via email. It covers overnight news on your top 5 holdings, today's expected catalysts, and one action recommendation with explicit price target, stop-loss, and horizon. Intraday alerts run at 12:30 PM ET to flag material moves only.",
    meta: "Aggressive ≠ All-in. Aggressive means accepting drawdowns to chase upside on a diversified growth book.",
  });

  return advice;
}

// =============================================================================
// Component
// =============================================================================
export default function StocksAdvisorPage() {
  // Auth: just { email, sessionToken } — kept in localStorage
  const [auth, setAuth] = useState(null);
  // Profile: { email, riskTolerance, fxUsdCad, accounts, positions } — server-backed
  const [profile, setProfile] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | saving | saved | error
  // Mirror sync state to a ref so background pollers can check the
  // current value without depending on it in their useEffect deps
  // (which would cause the interval to be torn down and rebuilt every
  // time a save completes).
  const syncStatusRef = useRef(syncStatus);
  useEffect(() => { syncStatusRef.current = syncStatus; }, [syncStatus]);
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [modalIdx, setModalIdx] = useState(undefined);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePrefill, setTradePrefill] = useState(null); // optional prefill for TradeModal
  const [executedRecKeys, setExecutedRecKeys] = useState(new Set()); // recs the user has executed in this session
  // Celebration modal — shown after a BUY trade linked to a rec lands.
  // Payload: { side, ticker, shares, price, currency, target, stop, horizonDays, orderTiming, account, thesis }
  const [positionEnteredCelebration, setPositionEnteredCelebration] = useState(null);
  const [briefingPreview, setBriefingPreview] = useState(null); // { html, sent, error, busy }
  const [monthlyPreview, setMonthlyPreview] = useState(null);   // { html, markdown, subject, sent, error, busy }
  const [pendingOrders, setPendingOrders] = useState([]);
  // Privacy mode: masks all USER dollar amounts (totals, position values,
  // cash, P&L). Market prices and rec entry/target/stop levels stay visible.
  const [privacyMode, setPrivacyMode] = useState(false);
  useEffect(() => { setPrivacyMode(loadPrivacy()); }, []);
  // Apply / remove the body class whenever privacyMode flips. MUST live up
  // here with the other hooks — putting it after the early returns below
  // is a rules-of-hooks violation that causes a runtime crash.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sa-privacy", privacyMode);
    return () => document.body.classList.remove("sa-privacy");
  }, [privacyMode]);
  const togglePrivacy = () => {
    const next = !privacyMode;
    setPrivacyMode(next);
    savePrivacy(next);
  };
  const saveTimerRef = useRef(null);
  const savedTimerRef = useRef(null);
  // Cross-tab AI advice request — when set, the Advice tab auto-triggers
  // a fresh AI fetch on mount, then resets the flag.
  const [pendingAiFetch, setPendingAiFetch] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Hydrate auth from localStorage ───────────────────────────────
  useEffect(() => {
    setAuth(loadAuth());
    setHydrated(true);
  }, []);

  // ── Fetch pending orders alongside profile ───────────────────────
  const refreshPendingOrders = async () => {
    if (!auth?.sessionToken) return;
    try {
      const list = await apiListPendingOrders(auth.sessionToken);
      setPendingOrders(list);
    } catch (e) {
      console.warn("Could not load pending orders:", e?.message);
    }
  };
  useEffect(() => {
    if (auth?.sessionToken) refreshPendingOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.sessionToken]);

  // ── Fetch profile when auth is established ───────────────────────
  useEffect(() => {
    if (!auth?.sessionToken) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoadingProfile(true);
    (async () => {
      try {
        // One-shot migration: clean trailing-dot tickers + infer subCcy from
        // seed-data position names. Idempotent — does nothing once clean.
        apiMigratePortfolio(auth.sessionToken).then((r) => {
          if (r?.tickerFixes || r?.subCcyFixes) {
            console.log(`[stocks] migrate:`, r.message);
          }
        }).catch(() => null);
        let p = await apiGetPortfolio(auth.sessionToken);
        // First-time sign-in seeding for the project author
        if (
          auth.email === "rgsommer@me.com" &&
          (!p.positions || p.positions.length === 0) &&
          !p.riskTolerance
        ) {
          p = {
            ...p,
            riskTolerance: RICHARD_PORTFOLIO.riskTolerance,
            fxUsdCad: RICHARD_PORTFOLIO.fxUsdCad,
            accounts: RICHARD_PORTFOLIO.accounts,
            positions: RICHARD_PORTFOLIO.positions,
          };
          // Persist the seed back to the server immediately
          await apiPutPortfolio(auth.sessionToken, p);
        }
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (cancelled) return;
        if (e?.message === "UNAUTHORIZED") {
          // Session expired — bounce to auth
          saveAuth(null);
          setAuth(null);
          showToast("Session expired — please sign in again");
        } else {
          showToast("Could not load portfolio: " + (e?.message || "network error"));
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => { cancelled = true; };
  }, [auth?.sessionToken, auth?.email]);

  // ── Background refresh for poller-driven position updates ────────
  // The email poller applies CIBC trade alerts to positions/cash on a
  // 15-min cron. Without this hook the user had to hit Refresh to see
  // the update. Now we quietly re-fetch every 45s (only when the tab
  // is visible AND no local save is pending — otherwise the poll
  // would clobber uncommitted Settings edits) and on visibilitychange
  // when the tab comes back into focus. If the server's lastSyncedAt
  // is newer than what we've got, we merge in the poller-owned fields
  // (positions + accounts cash) without touching the user's Settings
  // toggles / goals / etc.
  useEffect(() => {
    if (!auth?.sessionToken) return;
    const POLL_MS = 45 * 1000;

    const doPoll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // Skip while a debounced save is in flight — don't stomp local edits.
      if (syncStatusRef.current === "saving") return;
      try {
        const fresh = await apiGetPortfolio(auth.sessionToken);
        if (!fresh) return;
        setProfile((prev) => {
          if (!prev) return fresh;
          const prevSync = prev.lastSyncedAt ? new Date(prev.lastSyncedAt).getTime() : 0;
          const nextSync = fresh.lastSyncedAt ? new Date(fresh.lastSyncedAt).getTime() : 0;
          if (nextSync <= prevSync) return prev;
          // Merge: take the server's positions + accounts (poller-owned),
          // keep the client's Settings-level fields unchanged so an
          // in-flight edit isn't reverted just because we polled.
          return {
            ...prev,
            positions: fresh.positions || prev.positions,
            accounts: fresh.accounts || prev.accounts,
            lastSyncedAt: fresh.lastSyncedAt || prev.lastSyncedAt,
          };
        });
      } catch { /* silent — this is a background refresh */ }
    };

    const intervalId = setInterval(doPoll, POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) doPoll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [auth?.sessionToken]);

  // ── Debounced server save on profile mutation ────────────────────
  const updateProfile = (mut) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...mut(prev) };
      // Schedule a save (debounced 600ms so rapid edits coalesce)
      setSyncStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await apiPutPortfolio(auth.sessionToken, next);
          setSyncStatus("saved");
          savedTimerRef.current = setTimeout(() => setSyncStatus("idle"), 1500);
        } catch (e) {
          setSyncStatus("error");
          if (e?.message === "UNAUTHORIZED") {
            saveAuth(null);
            setAuth(null);
            showToast("Session expired — please sign in again");
          } else {
            showToast("Save failed: " + (e?.message || "network"));
          }
        }
      }, 600);
      return next;
    });
  };

  // ── Render gates ─────────────────────────────────────────────────
  if (!hydrated) {
    return <FullscreenShell><div style={{ padding: 40, color: "#7a8499" }}>Loading…</div><StocksCSS /></FullscreenShell>;
  }

  // AUTH
  if (!auth) {
    return (
      <FullscreenShell>
        <AuthView
          onSuccess={(email) => {
            const a = { email, sessionToken: COOKIE_MARKER };
            saveAuth(a);
            setAuth(a);
          }}
        />
        <StocksCSS />
      </FullscreenShell>
    );
  }

  // Loading profile from server
  if (loadingProfile || !profile) {
    return (
      <FullscreenShell>
        <div className="sa-auth">
          <div className="sa-auth-card">
            <h1>Loading your portfolio…</h1>
            <div className="sa-sub">Pulling latest from the server.</div>
          </div>
        </div>
        <StocksCSS />
      </FullscreenShell>
    );
  }

  // ONBOARDING
  if (!profile.riskTolerance) {
    return (
      <FullscreenShell>
        <OnboardingView
          onPick={(v) => updateProfile(() => ({ riskTolerance: v }))}
        />
        <StocksCSS />
      </FullscreenShell>
    );
  }

  // The subviews still take a `user` prop — pass `profile` as-is.
  const user = profile;
  const updateUser = updateProfile;

  // Generate the daily briefing on-demand. Two-step UI:
  //   step 1: preview (POST without send=true) — fast, no email
  //   step 2: confirm send (POST with send=true) — emails it
  const previewBriefing = async () => {
    // First attempt sets busy; a transient network error (fetch abort,
    // Failed-to-fetch on a proxy timeout, 502/503/504) triggers one silent
    // retry. Because the backend now dedupes in-flight generations by email
    // and caches the result for 5 minutes, the retry either awaits the
    // same in-flight promise or returns the cached result instantly — it
    // does NOT re-trigger a fresh 60-90s pipeline. So the retry is safe
    // and usually much faster than the first call.
    setBriefingPreview({ busy: true, hint: "Generating — this can take up to 90s. Retry will piggyback on the same run." });
    const attempt = async () => {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-briefing`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.sessionToken}` },
        body: JSON.stringify({ send: false }),
      });
      const j = await r.json();
      if (!r.ok) {
        const err = new Error(j?.error || `HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return j;
    };
    const isTransient = (e) => {
      const msg = String(e?.message || "").toLowerCase();
      if (/failed to fetch|networkerror|timeout|aborted|econnreset|network request failed/.test(msg)) return true;
      if ([502, 503, 504, 522, 524].includes(e?.status)) return true;
      return false;
    };
    try {
      let j;
      try {
        j = await attempt();
      } catch (e1) {
        if (!isTransient(e1)) throw e1;
        setBriefingPreview({ busy: true, hint: "Retrying — reusing the in-flight generation…" });
        await new Promise((r) => setTimeout(r, 1500));
        j = await attempt();
      }
      setBriefingPreview({ html: j.html, markdown: j.markdown, subject: j.subject, sent: false, cacheHit: j.cacheHit });
    } catch (e) {
      setBriefingPreview({ error: e?.message || "Failed to generate briefing" });
    }
  };

  // Monthly account report — preview-then-send, same UX as daily briefing.
  // Fires the end-of-month report on demand regardless of calendar position
  // (so the user can test-drive without waiting until the last trading day).
  const previewMonthlyReport = async () => {
    setMonthlyPreview({ busy: true });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-monthly-report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.sessionToken}` },
        body: JSON.stringify({ send: false }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMonthlyPreview({ html: j.html, markdown: j.markdown, subject: j.subject, accountsCovered: j.accountsCovered, sent: false });
    } catch (e) {
      setMonthlyPreview({ error: e?.message || "Failed to build monthly report" });
    }
  };

  const sendMonthlyReport = async () => {
    if (!monthlyPreview || monthlyPreview.busy) return;
    setMonthlyPreview({ ...monthlyPreview, busy: true });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-monthly-report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.sessionToken}` },
        body: JSON.stringify({ send: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMonthlyPreview({ html: j.html, markdown: j.markdown, subject: j.subject, accountsCovered: j.accountsCovered, sent: j.sent, sendError: j.sendError, messageId: j.messageId, to: j.to, ccSends: j.ccSends });
      const ccOk = (j.ccSends || []).filter(c => c.sent).length;
      const ccTotal = (j.ccSends || []).length;
      const ccPart = ccTotal > 0 ? ` + ${ccOk}/${ccTotal} cc` : "";
      if (j.sent) showToast(`Monthly report queued (id: ${(j.messageId || "—").slice(0, 8)}…)${ccPart}. Check spam if it doesn't arrive in 2 min.`);
      else if (j.sendError) showToast(`Email failed: ${j.sendError}`);
    } catch (e) {
      setMonthlyPreview({ ...monthlyPreview, sendError: e?.message || "Send failed", busy: false });
    }
  };

  const sendBriefing = async () => {
    if (!briefingPreview || briefingPreview.busy) return;
    setBriefingPreview({ ...briefingPreview, busy: true });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-briefing`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.sessionToken}` },
        // Pass the previously-previewed markdown so the backend reuses it
        // instead of regenerating — keeps the sent email identical to what
        // you just saw, and saves a 30s Claude call.
        body: JSON.stringify({ send: true, markdown: briefingPreview.markdown }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBriefingPreview({ html: j.html, markdown: j.markdown, subject: j.subject, sent: j.sent, sendError: j.sendError });
      if (j.sent) showToast(`Briefing emailed to ${auth.email}`);
      else if (j.sendError) showToast(`Email failed: ${j.sendError}`);
    } catch (e) {
      setBriefingPreview({ ...briefingPreview, sendError: e?.message || "Send failed", busy: false });
    }
  };

  // Stable key for a recommendation — used to mark which AI recs have been
  // executed (turns the row green in the advice table).
  const recKey = (rec) => `${rec.side}_${rec.ticker}_${rec.shares || ""}_${rec.entryLow || ""}_${rec.currency || ""}`;

  // Submit an order as pending (placed at broker, not yet filled).
  // Marks the source rec executed (visually) and adds a Pending Order row.
  const submitPendingOrder = async (order) => {
    await apiCreatePendingOrder(auth.sessionToken, order);
    await refreshPendingOrders();
    if (tradePrefill && !tradePrefill.plannedId) {
      const k = recKey(tradePrefill);
      setExecutedRecKeys(prev => { const next = new Set(prev); next.add(k); return next; });
    }
    showToast(`Pending order saved — ${order.side} ${order.qty} ${order.ticker} @ $${order.limitPrice}`);
  };

  // Fill a pending order — converts to a real journal entry, updates portfolio
  const fillPendingOrder = async (orderId, fill) => {
    const result = await apiFillPendingOrder(auth.sessionToken, orderId, fill);
    setProfile(result.portfolio);
    await refreshPendingOrders();
    showToast("Order marked filled");
    return result;
  };
  const cancelPendingOrder = async (orderId) => {
    await apiCancelPendingOrder(auth.sessionToken, orderId);
    await refreshPendingOrders();
    showToast("Pending order cancelled");
  };

  // Record a trade: post to /api/stocks-trade and refresh local profile.
  // If the trade originated from an Execute click on a recommendation,
  // mark that rec as executed so the row renders green AND attach the
  // rec's _id so the scorecard can link this trade back. If it originated
  // from a planned-withdrawal execution, remove that planned WD from the
  // user's list (it's now a real journal entry). If it originated from
  // filling a Pending Order, route through the fill endpoint instead.
  const recordTrade = async (trade) => {
    // Attach the rec _id if we have it (only set by Execute clicks)
    if (tradePrefill?.recId && /^[a-f0-9]{24}$/i.test(tradePrefill.recId)) {
      trade.linkedAdviceRecId = tradePrefill.recId;
    }
    // Pending-order fill path: convert the pending order to a real trade
    if (tradePrefill?._pendingOrderId) {
      const leg = trade.legs?.[0];
      if (!leg) throw new Error("No trade leg");
      const result = await fillPendingOrder(tradePrefill._pendingOrderId, {
        qty: leg.shares,
        price: leg.price,
        executedAt: trade.executedAt,
      });
      return result;
    }
    const result = await apiRecordTrade(auth.sessionToken, trade);
    let nextProfile = result.portfolio;
    if (tradePrefill?.plannedId) {
      nextProfile = {
        ...nextProfile,
        plannedWithdrawals: (nextProfile.plannedWithdrawals || []).filter((w) => w.id !== tradePrefill.plannedId),
      };
      // Persist the removal too
      apiPutPortfolio(auth.sessionToken, nextProfile).catch(() => null);
    }
    setProfile(nextProfile);
    if (tradePrefill && !tradePrefill.plannedId) {
      const k = recKey(tradePrefill);
      setExecutedRecKeys(prev => {
        const next = new Set(prev);
        next.add(k);
        return next;
      });
    }
    // If this trade was opened via Rectify, tell the Reconcile card the
    // discrepancy has been resolved (cross-through the row in the UI).
    if (typeof tradePrefill?._onTradeRecordedForRectify === "function") {
      try { tradePrefill._onTradeRecordedForRectify(); } catch (e) { /* noop */ }
    }
    // If this trade fulfills a BUY rec (Execute-clicked from Advice tab),
    // surface a celebration modal with target/stop/next-step guidance.
    // Falls back to the simple toast when it's a plain manual entry.
    const buyLeg = (trade.legs || []).find(l => l.side === "BUY");
    if (buyLeg && tradePrefill && (tradePrefill.targetPrice != null || tradePrefill.stopPrice != null)) {
      setPositionEnteredCelebration({
        side: "BUY",
        ticker: buyLeg.ticker,
        shares: buyLeg.shares,
        price: buyLeg.price,
        currency: buyLeg.currency,
        target: tradePrefill.targetPrice,
        stop: tradePrefill.stopPrice,
        horizonDays: tradePrefill.horizonDays,
        orderTiming: tradePrefill.orderTiming || null,
        accountName: trade.legs?.[0] ? (nextProfile.accounts || []).find(a => a.id === trade.account)?.name : null,
        thesis: tradePrefill.rationale || null,
      });
    } else {
      showToast(`Trade recorded — ${trade.legs.map(l => `${l.side || ""} ${l.shares || ""} ${l.ticker || ""}`.trim()).join(", ")}`);
    }
    return result;
  };

  // Shared refresh-prices flow — uses backend proxy to avoid Yahoo CORS.
  // For each position we fetch the exchange listing matching the position's
  // currency (ENB in a CAD sub → ENB.TO, not bare ENB which is the US
  // ADR). Then we map the response back onto the original position key
  // so priceCad / priceUsd land on the right field.
  const refreshPrices = async () => {
    if (user.positions.length === 0) { showToast("No positions to refresh."); return { ok: 0, fail: 0 }; }
    // Build a unique set of (exchangeTicker → [original ticker, currency])
    // mappings, so the backend gets the right listing per position.
    const fetchMap = new Map(); // exchangeTicker → { originalTicker, currency }
    for (const p of user.positions) {
      const exTicker = resolveChartTicker(p.ticker, p.ccy);
      const key = `${exTicker}|${p.ccy}`;
      if (!fetchMap.has(key)) fetchMap.set(key, { exchangeTicker: exTicker, originalTicker: p.ticker, currency: p.ccy });
    }
    const entries = [...fetchMap.values()];
    const tickers = [...new Set(entries.map(e => e.exchangeTicker))];
    showToast(`Fetching ${tickers.length} tickers…`);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { prices, failed } = await r.json();
      // Build a lookup: (originalTicker, currency) → fetched price
      const priceByOrig = {};
      for (const ent of entries) {
        const q = prices?.[ent.exchangeTicker];
        if (q) priceByOrig[`${ent.originalTicker}|${ent.currency}`] = q;
      }
      const fxRate = user.fxUsdCad || 1.37;
      const skipped = []; // tickers where the fetched price failed the drift check
      const updated = user.positions.map((p) => {
        const q = priceByOrig[`${p.ticker}|${p.ccy}`];
        if (!q) return p;
        // Drift-check the fetched price before writing. This is the
        // second half of the task #120 root-cause fix (first half:
        // trade applier no longer overwrites priceUsd). Yahoo/FMP
        // occasionally returns wildly wrong prices — pre-split values,
        // wrong-ticker aliases, cold-cache misses — and the July 29
        // NVDA-at-$42.55 briefing was directly caused by this refresh
        // path writing bad data. If the new price is either >3× the
        // prior stored price, <1/3 of it, or >50% different from the
        // cost basis (whichever is the tighter guard), skip the
        // write and keep the stored value. Toast the skipped set so
        // the user knows to click Refresh again or verify manually.
        //
        // Threshold set loose enough to allow real crash / earnings-
        // gap moves (~30-40%) and tight enough to catch the >100%
        // discrepancies that mean the feed is broken. Split events
        // are the one case where a legitimate 2-10× ratio is real;
        // brokers usually adjust the position book automatically
        // via a corporate-action feed, at which point a subsequent
        // refresh will see prices that agree with the new share
        // count. If a split is in progress and the check misfires,
        // the user can force the write by editing the position
        // directly — same escape hatch as any other manual override.
        const currentPrice = p.ccy === "USD" ? p.priceUsd : p.priceCad;
        const costBasis = p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
        const newPrice = q.price;
        const priorRatio = (Number.isFinite(currentPrice) && currentPrice > 0)
          ? newPrice / currentPrice : null;
        const basisDrift = (Number.isFinite(costBasis) && costBasis > 0)
          ? Math.abs(newPrice - costBasis) / costBasis : null;
        const priorDriftBad = priorRatio != null && (priorRatio > 3 || priorRatio < 0.333);
        // Reject the write when ANY of these fire:
        //
        //  (A) prior-price ratio is extreme (new > 3× prior OR < 1/3
        //      prior) AND basis drift is extreme (> 50%). This is the
        //      "big sudden move" case — new price disagrees with both
        //      the previous stored value AND the cost basis. Almost
        //      always a data-feed error caught mid-corruption.
        //
        //  (B) basis-drift is extreme downward — new price is < 25%
        //      of cost basis. This is the "sticky corruption" case
        //      where a prior refresh already poisoned the stored
        //      price, so subsequent refreshes returning similar-
        //      ballpark wrong values pass check (A) unchanged. The
        //      original NVDA-$42.55 corruption was survived by the
        //      first shipped guard because $42.55 → $43.65 is only
        //      1.03× ratio, but $43.65 vs $206.81 basis is -79%
        //      which triggers this rule. Real crash-day losses of
        //      75%+ on a normal ticker without headline news are
        //      vanishingly rare — if this misfires on a legitimate
        //      catastrophic move, the trader can manually edit the
        //      position row to override.
        const extremeBasisDrop = Number.isFinite(costBasis) && costBasis > 0
          && newPrice < costBasis * 0.25;
        if ((priorDriftBad && basisDrift != null && basisDrift > 0.5) || extremeBasisDrop) {
          const reason = extremeBasisDrop ? "new price <25% of basis (sticky-corruption fingerprint)" : "new price disagrees with both prior and basis (fresh-corruption fingerprint)";
          skipped.push(`${p.ticker} (feed said $${newPrice.toFixed(2)}, was $${currentPrice?.toFixed(2) ?? "?"}, basis $${costBasis?.toFixed(2) ?? "?"} — ${reason})`);
          console.warn(`[refresh-prices] SKIPPED ${p.ticker}: feed=$${newPrice}, prior=$${currentPrice}, basis=$${costBasis} (ratio=${priorRatio?.toFixed(2)}, basis-drift=${basisDrift != null ? (basisDrift * 100).toFixed(0) + "%" : "n/a"}) — ${reason}`);
          return p;
        }
        if (p.ccy === "USD") return { ...p, priceUsd: newPrice, priceCad: newPrice * fxRate };
        if (p.ccy === "CAD") return { ...p, priceCad: newPrice, priceUsd: newPrice / fxRate };
        return p;
      });
      updateUser(() => ({ positions: updated }));
      const ok = tickers.length - (failed?.length || 0) - skipped.length;
      const parts = [`Fetched ${ok}/${tickers.length}.`];
      if (failed?.length) parts.push(`Failed: ${failed.join(", ")}.`);
      if (skipped.length) parts.push(`⚠ Skipped as implausible (data-feed drift guard): ${skipped.join("; ")}. Kept the stored price.`);
      showToast(parts.join(" "));
      return { ok, fail: (failed?.length || 0), skipped: skipped.length };
    } catch (e) {
      showToast(`Price fetch failed: ${e?.message || "network"}`);
      return { ok: 0, fail: user.positions.length };
    }
  };

  return (
    <FullscreenShell>
      <div className="sa-app">
        <aside className="sa-side">
          <div className="sa-brand">Stocks <span>Advisor</span></div>
          <nav className="sa-nav">
            {[
              ["dashboard", "Dashboard", "Dash"],
              ["positions", "Positions", "Pos"],
              ["advice", "Advice", "Advice"],
              ["discover", "Discover", "Find"],
              ["news", "News", "News"],
              ["health", "Health", "Health"],
              ["returns", "Returns", "Ret"],
              ["alpha", "Alpha", "α"],
              ["trades", "Trades", "Trades"],
              ["reconcile", "Reconcile", "↻"],
              ["settings", "Settings", "⚙"],
            ].map(([k, label, shortLabel]) => (
              <button
                key={k}
                className={currentTab === k ? "active" : ""}
                onClick={() => setCurrentTab(k)}
              >
                <span className="dot" />
                <span className="full-label">{label}</span>
                <span className="short-label">{shortLabel}</span>
              </button>
            ))}
          </nav>
          <div className="sa-user">
            <button
              className="sa-btn ghost"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", marginBottom: 8, fontSize: 11, width: "100%" }}
              onClick={togglePrivacy}
              title={privacyMode ? "Show dollar amounts" : "Hide dollar amounts (privacy mode)"}
            >
              <span style={{ fontSize: 13 }}>{privacyMode ? "🙈" : "👁"}</span>
              <span>{privacyMode ? "Reveal values" : "Hide values"}</span>
            </button>
            {user.email}
            <br />
            <span className={`sa-badge ${
              user.riskTolerance === "aggressive" ? "purple"
                : user.riskTolerance === "speculative" ? "red"
                : user.riskTolerance === "moderate" ? "amber"
                : "green"
            }`}>{user.riskTolerance}</span>
            <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 8, height: 14 }}>
              {syncStatus === "saving" && "Saving…"}
              {syncStatus === "saved" && "✓ Saved"}
              {syncStatus === "error" && <span style={{ color: "var(--sa-red)" }}>⚠ Save failed</span>}
              {syncStatus === "idle" && profile?.lastSyncedAt && `Synced ${new Date(profile.lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </div>
            <button
              className="sa-btn ghost"
              style={{ display: "block", marginTop: 8, padding: "4px 0" }}
              onClick={() => { apiLogout(); saveAuth(null); setAuth(null); setProfile(null); }}
            >Sign out</button>
          </div>
        </aside>
        <main className="sa-main">
          {currentTab === "dashboard" && (
            <DashboardView
              user={user}
              sessionToken={auth.sessionToken}
              onTab={setCurrentTab}
              onRefresh={refreshPrices}
              onAiAdvice={() => {
                // Switch to Advice tab and have it auto-run the AI fetch
                setPendingAiFetch(true);
                setCurrentTab("advice");
              }}
              onRecordTrade={() => setTradeModalOpen(true)}
              onEmailBriefing={previewBriefing}
              onMonthlyReport={previewMonthlyReport}
              onEditPosition={(idx) => setModalIdx(idx)}
              pendingOrders={pendingOrders}
              onFillPendingOrder={async (order) => {
                // Prefill the Trade modal with the pending order so the user
                // can confirm/adjust the actual fill prices, then submit.
                setTradePrefill({
                  side: order.side, ticker: order.ticker,
                  shares: order.qty, entryLow: order.limitPrice,
                  currency: order.currency,
                  targetVal: order.targetPrice, stopVal: order.stopPrice,
                  _pendingOrderId: order._id, _pendingAccount: order.account,
                });
                setTradeModalOpen(true);
              }}
              onCancelPendingOrder={cancelPendingOrder}
            />
          )}
          {currentTab === "positions" && (
            <PositionsView
              user={user}
              sessionToken={auth.sessionToken}
              onOpenModal={(idx) => setModalIdx(idx)}
              onDelete={(idx) => {
                if (confirm(`Delete this position?`))
                  updateUser((u) => ({ positions: u.positions.filter((_, i) => i !== idx) }));
              }}
              onAddAccount={() => {
                const name = prompt("Account name (e.g., RRSP, TFSA, Margin)?");
                if (!name) return;
                updateUser((u) => ({ accounts: [...u.accounts, { id: "acct" + Date.now(), name }] }));
              }}
              onRefreshPrices={refreshPrices}
              onChangeAccountType={(accountId, accountType) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, accountType: accountType || null } : a),
                }));
                showToast("Account type updated");
              }}
            />
          )}
          {currentTab === "advice" && (
            <AdviceView
              user={user}
              onRefresh={refreshPrices}
              sessionToken={auth.sessionToken}
              autoFetchAi={pendingAiFetch}
              onAutoFetchConsumed={() => setPendingAiFetch(false)}
              onExecuteRec={(rec) => {
                setTradePrefill(rec);
                setTradeModalOpen(true);
              }}
              executedRecKeys={executedRecKeys}
              recKey={recKey}
              onClearExecuted={() => setExecutedRecKeys(new Set())}
            />
          )}
          {currentTab === "discover" && <DiscoverView sessionToken={auth.sessionToken} user={user} />}
          {currentTab === "news" && <NewsView sessionToken={auth.sessionToken} user={user} />}
          {currentTab === "returns" && <PerformanceView sessionToken={auth.sessionToken} user={user} />}
          {currentTab === "alpha" && <AlphaView sessionToken={auth.sessionToken} user={user} />}
          {currentTab === "health" && <HealthView sessionToken={auth.sessionToken} user={user} />}
          {currentTab === "trades" && <TradesView sessionToken={auth.sessionToken} />}
          {currentTab === "reconcile" && (
            <ReconcileView
              sessionToken={auth.sessionToken}
              user={user}
              onSaveBrokerAccountId={(accountId, brokerAccountId) => {
                updateUser((u) => ({
                  accounts: u.accounts.map((a) => a.id === accountId ? { ...a, brokerAccountId } : a),
                }));
              }}
              onRectify={(acct, issue, markResolved, opts) => {
                const appAcctId = acct.appAccountId || acct.acctId;
                const norm = (t) => String(t || "").toUpperCase().trim().replace(/\.(?:CN|TO|V|NE)$/i, "");
                if (issue.type === "cash") {
                  updateUser((u) => ({
                    accounts: u.accounts.map((a) => {
                      if (a.id !== appAcctId) return a;
                      const next = { ...a };
                      if (issue.currency === "CAD") next.cashCad = issue.csvValue;
                      else next.cashUsd = issue.csvValue;
                      return next;
                    }),
                  }));
                  showToast(`Rectified ${issue.currency} cash in ${acct.accountName} to ${issue.csvValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
                  return true;
                }
                if (issue.type === "position") {
                  // When opts.silent is set, skip the TradeModal and just
                  // apply the portfolio mutation. Used for "Delete (no
                  // trade)" on extras that were already booked in another
                  // account so we don't double-record the sell.
                  const silent = !!opts?.silent;
                  // Position discrepancy → open TradeModal so the user can
                  // type the actual fill price and record it as a journal
                  // entry (rather than silently rewriting the portfolio).
                  const prefill = !silent ? rectifyIssueToTradePrefill(acct, issue) : null;
                  if (prefill) {
                    prefill._onTradeRecordedForRectify = markResolved;
                    setTradePrefill(prefill);
                    setTradeModalOpen(true);
                    return "deferred";
                  }
                  // Fallback to silent update if the issue isn't trade-shaped
                  const targetTicker = (issue.csvTicker || issue.ticker).toUpperCase();
                  const normTarget = norm(targetTicker);
                  const subCcy = issue.subCurrency;
                  const ccy = issue.csvMarket === "CDN" ? "CAD" : issue.csvMarket === "US" ? "USD" : subCcy;
                  if (issue.kind === "extra_in_app") {
                    updateUser((u) => ({
                      positions: u.positions.filter((p) => !(
                        p.acct === appAcctId
                        && norm(p.ticker) === normTarget
                        && (p.subCcy || p.ccy) === subCcy
                      )),
                    }));
                    showToast(`Removed ${targetTicker} from ${acct.accountName} (${subCcy} sub)`);
                    return true;
                  }
                  if (issue.kind === "missing_in_app") {
                    const newPos = {
                      acct: appAcctId,
                      ticker: targetTicker,
                      name: issue.csvDescription || "",
                      qty: issue.csvQty,
                      ccy,
                      subCcy,
                      priceUsd: ccy === "USD" ? issue.csvPrice : null,
                      priceCad: ccy === "CAD" ? issue.csvPrice : null,
                      costBasisUsd: ccy === "USD" ? issue.csvPrice : null,
                      costBasisCad: ccy === "CAD" ? issue.csvPrice : null,
                      notes: "Added via reconciliation",
                    };
                    updateUser((u) => ({ positions: [...u.positions, newPos] }));
                    showToast(`Added ${issue.csvQty} sh ${targetTicker} to ${acct.accountName} (cost basis estimated at current price)`);
                    return true;
                  }
                  if (issue.kind === "qty_mismatch") {
                    updateUser((u) => {
                      const matchIdxs = [];
                      u.positions.forEach((p, idx) => {
                        if (p.acct === appAcctId
                          && norm(p.ticker) === normTarget
                          && (p.subCcy || p.ccy) === subCcy) {
                          matchIdxs.push(idx);
                        }
                      });
                      const currentTotal = matchIdxs.reduce((s, i) => s + (u.positions[i].qty || 0), 0);
                      const newTotal = issue.csvQty;
                      const nextPositions = [...u.positions];
                      if (matchIdxs.length === 1) {
                        nextPositions[matchIdxs[0]] = { ...nextPositions[matchIdxs[0]], qty: newTotal };
                      } else if (matchIdxs.length > 1 && currentTotal > 0) {
                        const scale = newTotal / currentTotal;
                        for (const i of matchIdxs) {
                          nextPositions[i] = { ...nextPositions[i], qty: (nextPositions[i].qty || 0) * scale };
                        }
                      }
                      return { positions: nextPositions };
                    });
                    showToast(`Set ${targetTicker} in ${acct.accountName} (${subCcy}) to ${issue.csvQty} sh`);
                    return true;
                  }
                }
                return false;
              }}
            />
          )}
          {currentTab === "settings" && (
            <SettingsView
              user={user}
              sessionToken={auth.sessionToken}
              onChangeRisk={(v) => { updateUser(() => ({ riskTolerance: v })); showToast("Risk tolerance updated"); }}
              onChangeFx={(v) => { updateUser(() => ({ fxUsdCad: v })); showToast("FX updated"); }}
              onChangeCommission={(v) => { updateUser(() => ({ commissionPerTrade: v })); showToast("Commission updated"); }}
              onChangeFxSpread={(v) => { updateUser(() => ({ fxSpreadPct: v })); showToast("FX spread updated"); }}
              onChangeSleeveTargets={(t) => { updateUser(() => ({ sleeveTargets: t })); showToast("Sleeve targets updated"); }}
              onChangeGoals={(v) => { updateUser(() => ({ goals: v })); }}
              onChangeContributionGoals={(g) => { updateUser(() => ({ annualContributionGoals: g })); showToast("Contribution goals updated"); }}
              onChangeAccountRisk={(accountId, riskLevel) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, riskTolerance: riskLevel } : a),
                }));
                showToast("Account risk updated");
              }}
              onChangeAccountType={(accountId, accountType) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, accountType: accountType || null } : a),
                }));
                showToast("Account type updated");
              }}
              onChangeAccountMonthlyReport={(accountId, enabled) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, monthlyReportEnabled: enabled } : a),
                }));
                showToast(enabled ? "Monthly report enabled" : "Monthly report disabled");
              }}
              onChangeAccountCcEmail={(accountId, email) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, monthlyReportCcEmail: email } : a),
                }));
                showToast(email ? `Monthly report cc: ${email}` : "Cc cleared");
              }}
              onChangeBeneficiaryAgreement={(accountId, ba) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, beneficiaryAgreement: ba } : a),
                }));
                showToast("Beneficiary agreement saved");
              }}
              onChangeConsensusMode={(v) => {
                updateUser(() => ({ consensusMode: v }));
                showToast(v ? "Consensus mode ON — Update Advice will run 3×" : "Consensus mode OFF — single-run advice");
              }}
              onChangeIntradayUpdates={(v) => {
                updateUser(() => ({ intradayUpdatesEnabled: v }));
                showToast(v ? "Midday updates enabled" : "Midday updates disabled");
              }}
              onChangeOptionsTrading={(v) => {
                updateUser(() => ({ optionsTradingEnabled: v }));
                showToast(v ? "Options trading enabled" : "Options trading disabled");
              }}
              onChangeNoTouchMode={(v) => {
                updateUser(() => ({ noTouchMode: v }));
                showToast(v ? "No-touch mode enabled" : "No-touch mode disabled");
              }}
              onChangeDisciplineCritic={(v) => {
                updateUser(() => ({ disciplineCriticEnabled: v }));
                showToast(v ? "Discipline critic enabled — every briefing will be audited" : "Discipline critic disabled");
              }}
              onChangeVolSizing={(v) => {
                updateUser(() => ({ volSizingEnabled: v }));
                showToast(v ? "Vol-scaled Kelly sizing enabled" : "Vol-scaled Kelly sizing disabled");
              }}
              onChangeRiskPerTrade={(v) => {
                updateUser(() => ({ riskPerTradePct: v }));
              }}
              onChangeKellyCap={(v) => {
                updateUser(() => ({ kellyFractionCap: v }));
              }}
              onChangePyramiding={(v) => {
                updateUser(() => ({ pyramidingEnabled: v }));
                showToast(v ? "Pyramiding on — add-on signals will surface at +1R and +2R" : "Pyramiding disabled");
              }}
              onChangeBriefingTimes={(times) => {
                updateUser(() => ({ briefingTimes: times }));
                showToast(times.length === 0 ? "Briefings disabled" : `Briefing scheduled at ${times.join(", ")}`);
              }}
              onChangeBriefingTz={(tz) => {
                updateUser(() => ({ briefingTz: tz }));
                showToast(`Briefing timezone: ${tz}`);
              }}
              onSaveBrokerAccountId={(accountId, brokerAccountId) => {
                updateUser((u) => ({
                  accounts: u.accounts.map((a) => a.id === accountId ? { ...a, brokerAccountId } : a),
                }));
              }}
              onRectify={(acct, issue, markResolved, opts) => {
                // acct.appAccountId is the matched app account id (set by
                // backend when resolveAppId succeeds). Fall back to acctId.
                const appAcctId = acct.appAccountId || acct.acctId;
                // Local mirror of the backend's normalizeTicker — strips
                // .CN/.TO/.V/.NE so positions match across naming styles.
                const norm = (t) => String(t || "").toUpperCase().trim().replace(/\.(?:CN|TO|V|NE)$/i, "");

                if (issue.type === "cash") {
                  updateUser((u) => ({
                    accounts: u.accounts.map((a) => {
                      if (a.id !== appAcctId) return a;
                      const next = { ...a };
                      if (issue.currency === "CAD") next.cashCad = issue.csvValue;
                      else next.cashUsd = issue.csvValue;
                      return next;
                    }),
                  }));
                  showToast(`Rectified ${issue.currency} cash in ${acct.accountName} to ${issue.csvValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
                  return true;
                }

                if (issue.type === "position") {
                  // opts.silent = "Delete (no trade)" path: skip TradeModal
                  // and just apply the silent portfolio mutation below.
                  const silent = !!opts?.silent;
                  // Position discrepancy → open TradeModal so the user can
                  // type the actual fill price and record as a journal entry.
                  const prefill = !silent ? rectifyIssueToTradePrefill(acct, issue) : null;
                  if (prefill) {
                    prefill._onTradeRecordedForRectify = markResolved;
                    setTradePrefill(prefill);
                    setTradeModalOpen(true);
                    return "deferred";
                  }
                  // Fallback (no prefill could be built) — silent update
                  const targetTicker = (issue.csvTicker || issue.ticker).toUpperCase();
                  const normTarget = norm(targetTicker);
                  const subCcy = issue.subCurrency;
                  // Infer trading currency from CIBC market (US → USD, CDN → CAD).
                  // Falls back to subCcy when csvMarket isn't available.
                  const ccy = issue.csvMarket === "CDN" ? "CAD"
                    : issue.csvMarket === "US" ? "USD"
                    : subCcy;

                  if (issue.kind === "extra_in_app") {
                    // Remove every app position matching (acct, normTicker, subCcy)
                    updateUser((u) => ({
                      positions: u.positions.filter((p) => !(
                        p.acct === appAcctId
                        && norm(p.ticker) === normTarget
                        && (p.subCcy || p.ccy) === subCcy
                      )),
                    }));
                    showToast(`Removed ${targetTicker} from ${acct.accountName} (${subCcy} sub)`);
                    return true;
                  }

                  if (issue.kind === "missing_in_app") {
                    // Build a new position with qty=csvQty. Use the CIBC
                    // current price as both market price and a cost-basis
                    // best guess (user can edit later).
                    const newPos = {
                      acct: appAcctId,
                      ticker: targetTicker,
                      name: issue.csvDescription || "",
                      qty: issue.csvQty,
                      ccy,
                      subCcy,
                      priceUsd: ccy === "USD" ? issue.csvPrice : null,
                      priceCad: ccy === "CAD" ? issue.csvPrice : null,
                      costBasisUsd: ccy === "USD" ? issue.csvPrice : null,
                      costBasisCad: ccy === "CAD" ? issue.csvPrice : null,
                      notes: "Added via reconciliation",
                    };
                    updateUser((u) => ({ positions: [...u.positions, newPos] }));
                    showToast(`Added ${issue.csvQty} sh ${targetTicker} to ${acct.accountName} (cost basis estimated at current price)`);
                    return true;
                  }

                  if (issue.kind === "qty_mismatch") {
                    // Find matching lots and set their qty to match CIBC.
                    // If one lot, set it directly. If multiple, scale
                    // proportionally so the sum equals csvQty.
                    updateUser((u) => {
                      const matchIdxs = [];
                      u.positions.forEach((p, idx) => {
                        if (p.acct === appAcctId
                          && norm(p.ticker) === normTarget
                          && (p.subCcy || p.ccy) === subCcy) {
                          matchIdxs.push(idx);
                        }
                      });
                      const currentTotal = matchIdxs.reduce((s, i) => s + (u.positions[i].qty || 0), 0);
                      const newTotal = issue.csvQty;
                      const nextPositions = [...u.positions];
                      if (matchIdxs.length === 1) {
                        nextPositions[matchIdxs[0]] = { ...nextPositions[matchIdxs[0]], qty: newTotal };
                      } else if (matchIdxs.length > 1 && currentTotal > 0) {
                        const scale = newTotal / currentTotal;
                        for (const i of matchIdxs) {
                          nextPositions[i] = { ...nextPositions[i], qty: (nextPositions[i].qty || 0) * scale };
                        }
                      }
                      return { positions: nextPositions };
                    });
                    showToast(`Set ${targetTicker} in ${acct.accountName} (${subCcy}) to ${issue.csvQty} sh`);
                    return true;
                  }
                }
                return false;
              }}
              onAddPlannedWithdrawal={(w) => {
                const id = "w" + Date.now() + Math.random().toString(36).slice(2, 6);
                updateUser((u) => ({
                  plannedWithdrawals: [...(u.plannedWithdrawals || []), { ...w, id, createdAt: new Date().toISOString() }],
                }));
                showToast("Planned withdrawal saved");
              }}
              onRemovePlannedWithdrawal={(id) => {
                updateUser((u) => ({
                  plannedWithdrawals: (u.plannedWithdrawals || []).filter((w) => w.id !== id),
                }));
              }}
              onExecutePlannedWithdrawal={(w) => {
                // Open the Trade modal in cash WITHDRAW mode pre-filled.
                // When the user confirms, the trade endpoint debits cash and
                // we remove the planned WD entry.
                setTradePrefill({ side: "WITHDRAW", currency: w.currency, amount: w.amount, plannedId: w.id, accountId: w.account });
                setTradeModalOpen(true);
              }}
              onReset={async () => {
                if (!confirm("Wipe all your positions and settings on the server?")) return;
                try {
                  await apiDeletePortfolio(auth.sessionToken);
                  await apiLogout();
                  saveAuth(null);
                  setAuth(null);
                  setProfile(null);
                } catch (e) {
                  showToast("Reset failed: " + (e?.message || "network"));
                }
              }}
            />
          )}
        </main>
        {modalIdx !== undefined && (
          <PositionModal
            user={user}
            idx={modalIdx}
            onClose={() => setModalIdx(undefined)}
            onSave={(p) => {
              updateUser((u) => ({
                positions: modalIdx == null ? [...u.positions, p] : u.positions.map((x, i) => (i === modalIdx ? p : x)),
              }));
              setModalIdx(undefined);
            }}
            onDelete={() => {
              updateUser((u) => ({ positions: u.positions.filter((_, i) => i !== modalIdx) }));
              setModalIdx(undefined);
            }}
          />
        )}
        {briefingPreview && (
          <BriefingPreviewModal
            preview={briefingPreview}
            recipient={auth.email}
            onClose={() => setBriefingPreview(null)}
            onSend={sendBriefing}
            onRetry={previewBriefing}
          />
        )}
        {monthlyPreview && (
          <BriefingPreviewModal
            preview={monthlyPreview}
            recipient={auth.email}
            onClose={() => setMonthlyPreview(null)}
            onSend={sendMonthlyReport}
            onRetry={previewMonthlyReport}
            title="Monthly Account Report — Preview"
            loadingLabel="Building monthly report…"
            loadingDetail="Computing per-account P&L and beneficiary payouts · 1-3s"
          />
        )}
        {tradeModalOpen && (
          <TradeModal
            user={user}
            prefill={tradePrefill}
            onClose={() => { setTradeModalOpen(false); setTradePrefill(null); }}
            onSubmit={async (trade) => {
              try {
                await recordTrade(trade);
                setTradeModalOpen(false);
                setTradePrefill(null);
              } catch (e) {
                throw e;
              }
            }}
            onSubmitPending={async (order) => {
              try {
                await submitPendingOrder(order);
                setTradeModalOpen(false);
                setTradePrefill(null);
              } catch (e) {
                throw e;
              }
            }}
          />
        )}
        {positionEnteredCelebration && (
          <PositionEnteredModal
            payload={positionEnteredCelebration}
            onClose={() => setPositionEnteredCelebration(null)}
          />
        )}
        {toast && <div className="sa-toast">{toast}</div>}
      </div>
      <StocksCSS />
    </FullscreenShell>
  );
}

// Post-action affirmation shown right after a BUY trade that fulfilled
// an AI rec lands. Reinforces the discipline loop: (1) confirm the
// entry, (2) name the exact GTC stop-limit ticket that should be queued
// next, (3) set expectation for what emails the app will send if
// target/stop hit or horizon expires.
function PositionEnteredModal({ payload, onClose }) {
  const p = payload;
  const isCad = p.currency === "CAD";
  const ccyLabel = isCad ? "CAD" : "USD";
  const pct = (from, to) => (from && to) ? ((to - from) / from) * 100 : null;
  const upside = pct(p.price, p.target);
  const downside = pct(p.price, p.stop);
  const rr = (upside != null && downside != null && downside < 0)
    ? Math.abs(upside / downside) : null;
  // The GTC stop-limit's limit price sits 1% below the stop trigger
  // (1.5% for lower-priced names) — same rule the briefing prompt teaches.
  const limitOffsetPct = p.stop != null && p.stop < 20 ? 0.015 : 0.01;
  const stopLimitPrice = p.stop != null ? p.stop * (1 - limitOffsetPct) : null;
  const horizonExit = p.horizonDays
    ? new Date(Date.now() + p.horizonDays * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const affirmations = [
    "Nice — you took the setup.",
    "Discipline shows up here.",
    "Good — that's the rec landing exactly as designed.",
    "Position on the board.",
    "Trade recorded — thesis in play now.",
  ];
  // Stable "random" pick based on ticker so refreshes don't flicker.
  const affirmIdx = String(p.ticker || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % affirmations.length;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000, padding: 20,
        animation: "fadeIn .18s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, maxWidth: 560, width: "100%",
          padding: "26px 28px 22px", boxShadow: "0 24px 60px rgba(15,23,42,0.30)",
          border: "1px solid var(--sa-border)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "#166534", textTransform: "uppercase", marginBottom: 4 }}>
          🎯 Position entered
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#0b1220", letterSpacing: "-.01em", marginBottom: 4 }}>
          {affirmations[affirmIdx]}
        </div>
        <div style={{ fontSize: 14, color: "var(--sa-text-2)", marginBottom: 16 }}>
          BUY <b>{p.shares?.toLocaleString?.()}</b> sh <b>{p.ticker}</b> @ <b>${p.price?.toFixed?.(2)}</b> {ccyLabel}
          {p.accountName && <> · in <b>{p.accountName}</b></>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: "#14532d", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>Target</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#166534", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              ${p.target?.toFixed?.(2)}
            </div>
            {upside != null && (
              <div style={{ fontSize: 11, color: "#166534", marginTop: 1 }}>+{upside.toFixed(1)}%</div>
            )}
          </div>
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: "#7f1d1d", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>Stop</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#991b1b", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              ${p.stop?.toFixed?.(2)}
            </div>
            {downside != null && (
              <div style={{ fontSize: 11, color: "#991b1b", marginTop: 1 }}>{downside.toFixed(1)}%</div>
            )}
          </div>
          <div style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: "#334155", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>R:R</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              {rr != null ? `1:${rr.toFixed(1)}` : "—"}
            </div>
            {p.horizonDays && (
              <div style={{ fontSize: 11, color: "#334155", marginTop: 1 }}>{p.horizonDays}d horizon</div>
            )}
          </div>
        </div>

        {p.stop != null && (
          <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>
              🕗 Queue this next in your broker
            </div>
            <div style={{ fontSize: 13, color: "#0b1220", fontFamily: "ui-monospace, Menlo, monospace", lineHeight: 1.5 }}>
              GTC STOP-LIMIT SELL {p.shares} {p.ticker},<br/>
              stop <b>${p.stop.toFixed(2)}</b> / limit <b>${stopLimitPrice.toFixed(2)}</b> {ccyLabel}
            </div>
            <div style={{ fontSize: 11, color: "#78350f", marginTop: 6 }}>
              The limit sits {(limitOffsetPct * 100).toFixed(1)}% below the stop trigger so a fast gap-down still fills.
            </div>
          </div>
        )}

        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1e3a8a", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>
            What triggers the next email
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#0f172a", lineHeight: 1.55 }}>
            {p.target != null && <li><b>Target hit</b> (${p.target.toFixed(2)}): &ldquo;Consider TRIMming to lock in gains.&rdquo;</li>}
            {p.stop != null && <li><b>Stop hit</b> (${p.stop.toFixed(2)}): &ldquo;SELL at market — thesis invalidated.&rdquo;</li>}
            {horizonExit && <li><b>Horizon expires</b> ({horizonExit}, {p.horizonDays}d out): reassess whether to hold, roll, or exit.</li>}
            <li><b>-8% hard-stop</b> from cost basis: real-time email + next briefing flags it in section 0c.</li>
          </ul>
          <div style={{ fontSize: 11, color: "#334155", marginTop: 8, fontStyle: "italic" }}>
            Otherwise, no action needed until the morning briefing.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sa-btn" onClick={onClose} style={{ padding: "10px 22px", fontSize: 14 }}>
            Nice, got it
          </button>
        </div>
      </div>
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}

// =============================================================================
// Subviews
// =============================================================================

function AuthView({ onSuccess }) {
  // step: "email" → enter email and request a PIN
  //       "pin"   → enter the 6-digit PIN we just emailed
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const requestPin = async () => {
    setErr(null);
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-auth/request-pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error || "Could not send code. Try again.");
      setEmail(e);
      setStep("pin");
      setTimeout(() => document.querySelector(".sa-pin input")?.focus(), 30);
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyPin = async () => {
    setErr(null);
    const p = pin.join("");
    if (p.length !== 6) return setErr("Enter the 6-digit code.");
    setBusy(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-auth/verify-pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: p }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return setErr(j.error || "Incorrect or expired code.");
      // The HttpOnly cookie was just set by the response; we ignore the token
      // in the body and never persist it.
      onSuccess(email);
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <div className="sa-auth">
        <div className="sa-auth-card">
          <h1>Stocks Advisor</h1>
          <div className="sa-sub">Enter your email and we&apos;ll send you a 6-digit code to sign in.</div>
          {err && <div className="sa-err">{err}</div>}
          <div className="sa-row">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              autoComplete="email"
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") requestPin(); }}
            />
          </div>
          <button
            className="sa-btn"
            style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
            onClick={requestPin}
            disabled={busy}
          >
            {busy ? "Sending…" : "Send sign-in code"}
          </button>
          <div className="sa-switch">No passwords. We email you a fresh code each time.</div>
        </div>
      </div>
    );
  }

  // step === "pin"
  return (
    <div className="sa-auth">
      <div className="sa-auth-card">
        <h1>Check your email</h1>
        <div className="sa-sub">
          We sent a 6-digit code to <b>{email}</b>. Enter it below. The code expires in 10 minutes.
        </div>
        {err && <div className="sa-err">{err}</div>}
        <div className="sa-row">
          <label>6-digit code</label>
          <div className="sa-pin">
            {pin.map((v, i) => (
              <input
                key={i}
                value={v}
                maxLength={1}
                inputMode="numeric"
                pattern="[0-9]*"
                onChange={(e) => {
                  const next = [...pin];
                  next[i] = e.target.value.replace(/[^0-9]/g, "");
                  setPin(next);
                  if (next[i] && i < 5) {
                    document.querySelectorAll(".sa-pin input")[i + 1]?.focus();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !pin[i] && i > 0) {
                    document.querySelectorAll(".sa-pin input")[i - 1]?.focus();
                  }
                  if (e.key === "Enter") verifyPin();
                }}
              />
            ))}
          </div>
        </div>
        <button
          className="sa-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
          onClick={verifyPin}
          disabled={busy}
        >
          {busy ? "Verifying…" : "Verify and sign in"}
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 13 }}>
          <button
            className="sa-btn ghost"
            onClick={() => { setStep("email"); setPin(["", "", "", "", "", ""]); setErr(null); }}
          >← Use a different email</button>
          <button
            className="sa-btn ghost"
            onClick={() => { setPin(["", "", "", "", "", ""]); requestPin(); }}
            disabled={busy}
          >Resend code</button>
        </div>
      </div>
    </div>
  );
}

function OnboardingView({ onPick }) {
  const [chosen, setChosen] = useState(null);
  const options = [
    ["conservative", "Conservative", "Capital preservation first. Bonds, dividends, blue chips. Minimal volatility."],
    ["moderate", "Moderate", "Balanced growth. Large-cap mix. Tolerate normal market swings."],
    ["aggressive", "Aggressive", "Growth-focused. Heavy equities, growth, thematic. Comfortable with significant volatility."],
    ["speculative", "Speculative", "Max growth. Small-caps, emerging tech, options-friendly. Can stomach large drawdowns."],
  ];
  return (
    <div className="sa-auth">
      <div className="sa-auth-card" style={{ maxWidth: 540 }}>
        <h1>Welcome</h1>
        <div className="sa-sub">Pick your risk tolerance. You can change this anytime.</div>
        <div className="sa-risk-grid">
          {options.map(([v, label, desc]) => (
            <div
              key={v}
              className={`sa-risk-card ${chosen === v ? "sel" : ""}`}
              onClick={() => setChosen(v)}
            >
              <h4>{label}</h4>
              <p>{desc}</p>
            </div>
          ))}
        </div>
        <button className="sa-btn" style={{ width: "100%", justifyContent: "center", marginTop: 18 }} disabled={!chosen} onClick={() => onPick(chosen)}>Continue</button>
      </div>
    </div>
  );
}

// Compact Dashboard chips for trading-regime + unusual-options-flow.
// Regime chip is a single line (colour-coded by trending/choppy/neutral)
// with a hover-tooltip listing the drivers. UOA chip shows a count of
// tickers with unusual flow; click to expand a compact per-ticker list
// with directional bias + top strike.
function RegimeAndUoaChips({ data }) {
  const [uoaOpen, setUoaOpen] = useState(false);
  const [varOpen, setVarOpen] = useState(false);
  const regime = data?.regime;
  const uoa = Array.isArray(data?.uoa) ? data.uoa : [];
  const riskVar = data?.riskVar;
  const cooldown = data?.lossCooldown;

  const regimeColor = regime?.regime === "trending" ? "#166534"
    : regime?.regime === "choppy" ? "#b45309"
    : regime?.regime === "neutral" ? "#334155" : "#6b7280";
  const regimeBg = regime?.regime === "trending" ? "#dcfce7"
    : regime?.regime === "choppy" ? "#fef3c7"
    : regime?.regime === "neutral" ? "#e2e8f0" : "#f1f5f9";
  const regimeIcon = regime?.regime === "trending" ? "📈"
    : regime?.regime === "choppy" ? "🌊"
    : regime?.regime === "neutral" ? "⚖️" : "";

  const bullishCount = uoa.filter(u => u.bias === "bullish").length;
  const bearishCount = uoa.filter(u => u.bias === "bearish").length;

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {regime && (
        <div
          title={
            regime.drivers?.length
              ? `Drivers:\n  • ${regime.drivers.join("\n  • ")}\n\nPrefer: ${regime.preferSetups?.join(", ") || "—"}\nAvoid: ${regime.avoidSetups?.join(", ") || "—"}`
              : "Trading-regime state (VIX + SPX trend + Fed liquidity)"
          }
          style={{
            padding: "8px 12px", borderRadius: 999,
            background: regimeBg, color: regimeColor,
            border: `1px solid ${regimeColor}`,
            fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
            cursor: "help",
          }}
        >
          <span style={{ fontSize: 16 }}>{regimeIcon}</span>
          <span style={{ fontWeight: 700 }}>{regime.regime?.toUpperCase()}</span>
          <span style={{ opacity: 0.75 }}>· prefer {regime.strategy?.replace("-", " ")}</span>
          {Number.isFinite(regime.confidence) && (
            <span style={{ opacity: 0.6, fontSize: 11 }}>({Math.round(regime.confidence * 100)}%)</span>
          )}
        </div>
      )}
      {riskVar && riskVar.bookValueCad > 0 && (() => {
        const usedPct = riskVar.used?.pct95 ?? 0;
        const limitPct = riskVar.limits?.pct95 ?? 2;
        const breach = riskVar.breach95;
        const nearBreach = usedPct >= limitPct * 0.75 && !breach;
        const color = breach ? "#7f1d1d" : nearBreach ? "#78350f" : "#166534";
        const bg = breach ? "#fee2e2" : nearBreach ? "#fef3c7" : "#dcfce7";
        return (
          <div
            title={
              "Portfolio 1-day 95% VaR (parametric, no correlation adjustment).\n" +
              `Used: $${Math.round(riskVar.portfolioVar95Cad).toLocaleString()} CAD (${usedPct.toFixed(2)}% of book)\n` +
              `Limit: ${limitPct}%\n` +
              `Headroom: $${Math.round(riskVar.headroomCad95).toLocaleString()} CAD\n` +
              `Coverage: ${riskVar.coverageCount}/${riskVar.totalCount} positions have vol data\n\n` +
              (riskVar.positionVars?.length ? "Top VaR contributors:\n  " + riskVar.positionVars.slice(0, 5).map(r => `${r.ticker}: $${Math.round(r.oneDayVar95Cad).toLocaleString()} (${(r.oneDayVar95Cad / riskVar.portfolioVar95Cad * 100).toFixed(0)}% of VaR)`).join("\n  ") : "")
            }
            onClick={() => setVarOpen(o => !o)}
            style={{
              padding: "8px 12px", borderRadius: varOpen ? 12 : 999,
              background: bg, color,
              border: `1px solid ${color}`,
              fontSize: 13, cursor: "pointer",
              display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>🎚️</span>
              <span style={{ fontWeight: 700 }}>VaR {usedPct.toFixed(2)}%</span>
              <span style={{ opacity: 0.75 }}>/ {limitPct}%</span>
              {breach && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700 }}>🚨 BREACH</span>}
              {!breach && nearBreach && <span style={{ marginLeft: 4, fontSize: 11 }}>near limit</span>}
              <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 4 }}>{varOpen ? "hide ▲" : "expand ▼"}</span>
            </div>
            {varOpen && (
              <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, borderTop: `1px solid ${color}`, paddingTop: 8, width: "100%", fontSize: 11.5 }}>
                <div style={{ fontVariantNumeric: "tabular-nums" }}>
                  95% VaR: <b>${Math.round(riskVar.portfolioVar95Cad).toLocaleString()} CAD</b> · limit ${Math.round(riskVar.limits?.cad95 || 0).toLocaleString()} · headroom ${Math.round(riskVar.headroomCad95).toLocaleString()}
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums" }}>
                  99% VaR: <b>${Math.round(riskVar.portfolioVar99Cad).toLocaleString()} CAD</b> ({riskVar.used?.pct99?.toFixed(2)}%) · limit {riskVar.limits?.pct99}%
                </div>
                <div style={{ marginTop: 6, opacity: 0.85 }}>Top VaR contributors:</div>
                {(riskVar.positionVars || []).slice(0, 5).map(r => (
                  <div key={r.ticker} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0", fontVariantNumeric: "tabular-nums", borderTop: "1px dashed rgba(0,0,0,0.15)" }}>
                    <span><b>{r.ticker}</b> · vol {r.annualizedVolPct?.toFixed(0)}%/yr</span>
                    <span>${Math.round(r.oneDayVar95Cad).toLocaleString()} <span style={{ opacity: 0.55 }}>({(r.oneDayVar95Cad / riskVar.portfolioVar95Cad * 100).toFixed(0)}%)</span></span>
                  </div>
                ))}
                <div style={{ marginTop: 6, opacity: 0.7 }}>
                  Coverage: {riskVar.coverageCount}/{riskVar.totalCount} positions have vol data — treat total as a lower bound.
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {cooldown?.active && (
        <div
          title={cooldown.reasons?.length ? `Reasons:\n  • ${cooldown.reasons.join("\n  • ")}` : ""}
          style={{
            padding: "8px 12px", borderRadius: 999,
            background: "#fee2e2", color: "#7f1d1d",
            border: "1px solid #ef4444",
            fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
            cursor: "help",
          }}
        >
          <span style={{ fontSize: 16 }}>🛑</span>
          <span style={{ fontWeight: 700 }}>COOLDOWN</span>
          <span style={{ opacity: 0.75 }}>
            no new positions{cooldown.cooldownUntil ? ` until ${new Date(cooldown.cooldownUntil).toISOString().slice(5, 10)}` : ""}
          </span>
        </div>
      )}
      {uoa.length > 0 && (
        <div
          onClick={() => setUoaOpen(o => !o)}
          style={{
            padding: "8px 12px", borderRadius: uoaOpen ? 12 : 999,
            background: "#fef3c7", color: "#78350f",
            border: "1px solid #fbbf24",
            fontSize: 13, cursor: "pointer",
            display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontWeight: 700 }}>UOA · {uoa.length} tickers</span>
            {(bullishCount > 0 || bearishCount > 0) && (
              <span style={{ opacity: 0.75 }}>· {bullishCount > 0 && `🟢 ${bullishCount}`}{bullishCount > 0 && bearishCount > 0 && " "}{bearishCount > 0 && `🔴 ${bearishCount}`}</span>
            )}
            <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 4 }}>{uoaOpen ? "hide ▲" : "expand ▼"}</span>
          </div>
          {uoaOpen && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, background: "#fffbeb", borderTop: "1px solid #fcd34d", paddingTop: 8, width: "100%" }}>
              {uoa.map(u => {
                const biasEmoji = u.bias === "bullish" ? "🟢" : u.bias === "bearish" ? "🔴" : "⚪";
                const topStrike = u.unusualStrikes?.[0];
                const ratio = u.callPutDollarRatio == null ? "—"
                  : !Number.isFinite(u.callPutDollarRatio) ? "call-only"
                  : u.callPutDollarRatio >= 1 ? `${u.callPutDollarRatio.toFixed(1)}× call$`
                  : `${(1 / u.callPutDollarRatio).toFixed(1)}× put$`;
                return (
                  <div key={u.ticker} style={{ padding: "3px 0", fontSize: 12, fontVariantNumeric: "tabular-nums", borderTop: "1px dashed #fde68a" }}>
                    <span style={{ fontWeight: 700 }}>{biasEmoji} {u.ticker}</span>
                    <span style={{ opacity: 0.75 }}> @ ${u.spot?.toFixed(2)} · {u.bias} · {ratio} · exp {u.expiration} ({u.dteDays}d)</span>
                    {topStrike && (
                      <div style={{ marginLeft: 22, opacity: 0.85, fontSize: 11 }}>
                        top: {topStrike.side.toUpperCase()} ${topStrike.strike} ({topStrike.offset === "OTM" ? `${topStrike.distancePct >= 0 ? "+" : ""}${topStrike.distancePct.toFixed(1)}%` : topStrike.offset}) · vol {topStrike.volume.toLocaleString()}, OI {topStrike.openInterest.toLocaleString()} · ${(topStrike.dollarVol / 1000).toFixed(0)}k
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Portfolio Health chip ────────────────────────────────────────────
// Single-glance answer to "am I OK regardless of what the market did?"
// Five guardrail dimensions rolled up into one traffic light, computed
// entirely client-side from data the Dashboard already has in hand:
//   • Risk budget (portfolio VaR vs the user's own limit)
//   • Sleeve balance (drift from 80/15/5 targets)
//   • Concentration (largest single position as % of book)
//   • Cash zone (LEAN / HEALTHY / AMPLE / IDLE-DRAG)
//   • Loss cooldown (recent drawdown / streak triggering discipline pause)
// Overall = worst of the five. Each tile is colour-coded and carries a
// one-line "why" so the trader can act on the red ones without hunting
// through five cards.
function PortfolioHealthChip({ user, regimeAndUoa }) {
  const fx = user.fxUsdCad || 1.37;

  // Rounding-error tolerance in CAD. A guardrail whose dollar-magnitude
  // breach is under this floor gets treated as OK even if the % would
  // flag "act" — otherwise the chip is always screaming about $24
  // over the VaR cap or $50 sleeve drift, which trains the operator
  // to ignore it. Applied to risk budget + sleeve balance only
  // (concentration and cash zone are % / band-based and don't benefit
  // from a dollar floor).
  const MATERIAL_BREACH_CAD = 100;

  // 1) Risk budget — VaR vs limit. Green when comfortably under; amber
  //    within 20% headroom; red on breach. Silent when we don't have
  //    vol data for any positions (no false-clean).
  const riskVar = regimeAndUoa?.riskVar || null;
  const varPct = riskVar?.used?.pct95 ?? null;
  const varLimit = riskVar?.limits?.pct95 ?? 2;
  const varBreach = !!riskVar?.breach95;
  const varHeadroomCad = Math.abs(riskVar?.headroomCad95 || 0);
  // Downgrade breach → watch when headroom is under the material floor;
  // treat as ok when it's near zero either side of the cap.
  const riskStatus = varPct == null
    ? null
    : varBreach
      ? (varHeadroomCad < MATERIAL_BREACH_CAD ? "watch" : "act")
      : (varPct >= varLimit * 0.8 ? "watch" : "ok");

  // 2) Sleeve balance — largest absolute drift from any single sleeve's
  //    target expressed as % of book. Under 5pp = green, under 15pp =
  //    amber, beyond = red. Dollar-floor override: any drift under
  //    $100 CAD is ok regardless of pp — trivial in absolute terms.
  const bal = computeSleeveBalanceClient(user);
  const worstSleeve = Object.entries(bal.headroomCad || {}).reduce(
    (worst, [k, v]) => Math.abs(v) > Math.abs(worst.v) ? { k, v } : worst,
    { k: null, v: 0 }
  );
  const bookAbs = Math.abs(bal.book) || 1;
  const driftPct = (Math.abs(worstSleeve.v) / bookAbs) * 100;
  const worstDriftCad = Math.abs(worstSleeve.v);
  const sleeveStatus = bal.book <= 0 ? null
    : worstDriftCad < MATERIAL_BREACH_CAD ? "ok"
    : driftPct < 5 ? "ok"
    : driftPct < 15 ? "watch" : "act";

  // 3) Concentration — largest single ticker share of positions. Under
  //    10% = green, under 20% = amber, beyond = red. Base-ticker match
  //    (XIU vs XIU.TO both roll up as XIU).
  const posByBase = {};
  for (const p of user.positions || []) {
    const base = String(p.ticker || "").toUpperCase().replace(/\..*$/, "");
    if (!base) continue;
    const cad = (Number.isFinite(p.priceCad) ? p.priceCad
      : Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0) * (p.qty || 0);
    posByBase[base] = (posByBase[base] || 0) + cad;
  }
  const posTotal = Object.values(posByBase).reduce((s, x) => s + x, 0);
  const largest = Object.entries(posByBase).reduce(
    (max, [k, v]) => v > max.v ? { k, v } : max, { k: null, v: 0 }
  );
  const concPct = posTotal > 0 ? (largest.v / posTotal) * 100 : 0;
  // Concentration tolerance band mirrors the §1 TRIM CONCENTRATION
  // mandate (SINGLE_NAME_CAP_PCT 20% + 1pp tolerance). Rounding-level
  // breaches (VOO at 20.9%) don't scream ACT — they're a "watch."
  // Only ≥ 21% flips to red and matches the mandate firing.
  const concStatus = posTotal <= 0 ? null
    : concPct < 10 ? "ok"
    : concPct < 21 ? "watch" : "act";

  // 4) Cash zone — same LEAN / HEALTHY / AMPLE / HIGH bands the
  //    briefing enforcer uses. HEALTHY = 3-10%. AMPLE = 10-15%.
  //    Below 3% = lean (amber), below 1% = red. Above 15% = ample
  //    (amber, capital drag), above 30% = red (heavy idle).
  const cashCad = (user.accounts || []).reduce(
    (s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx, 0
  );
  const bookTotal = posTotal + cashCad;
  const cashPct = bookTotal > 0 ? (cashCad / bookTotal) * 100 : 0;
  const cashLabel = cashPct < 3 ? "lean"
    : cashPct <= 10 ? "healthy"
    : cashPct <= 15 ? "ample"
    : "idle drag";
  const cashStatus = bookTotal <= 0 ? null
    : cashPct >= 3 && cashPct <= 15 ? "ok"
    : cashPct >= 1 && cashPct <= 30 ? "watch"
    : "act";

  // 5) Loss cooldown — active = red (discipline pause triggered), any
  //    partial signal (streak > 0, but under threshold) = amber, clean = green.
  const cool = regimeAndUoa?.lossCooldown || null;
  const coolStatus = cool == null ? null
    : cool.active ? "act"
    : (cool.streak > 0 || (cool.dailyDrawdownPct != null && cool.dailyDrawdownPct <= -1)) ? "watch"
    : "ok";
  const coolReason = cool?.reasons?.[0]
    || (cool?.streak > 0 ? `${cool.streak} losing trade${cool.streak === 1 ? "" : "s"} in a row` : null)
    || (cool?.dailyDrawdownPct != null && cool.dailyDrawdownPct <= -1 ? `${cool.dailyDrawdownPct.toFixed(1)}% day-over-day` : null)
    || "no recent stress signals";

  const dims = [
    {
      key: "risk", label: "Risk budget",
      status: riskStatus,
      value: varPct != null ? `VaR ${varPct.toFixed(2)}%` : "no vol data",
      detail: varPct != null ? `vs ${varLimit}% cap · headroom ${varBreach ? "−" : ""}$${Math.round(Math.abs(riskVar?.headroomCad95 || 0)).toLocaleString()}` : "need FMP tech data for held tickers",
    },
    {
      key: "sleeve", label: "Sleeve balance",
      status: sleeveStatus,
      value: bal.book > 0 ? `${driftPct.toFixed(0)}pp drift` : "—",
      detail: worstSleeve.k
        ? `${worstSleeve.k.toUpperCase()} ${worstSleeve.v >= 0 ? "under" : "over"} by $${Math.round(Math.abs(worstSleeve.v)).toLocaleString()} CAD`
        : "—",
    },
    {
      key: "conc", label: "Concentration",
      status: concStatus,
      value: largest.k ? `${concPct.toFixed(0)}% in ${largest.k}` : "—",
      detail: "of held positions",
    },
    {
      key: "cash", label: "Cash zone",
      status: cashStatus,
      value: bookTotal > 0 ? `${cashPct.toFixed(1)}%` : "—",
      detail: cashLabel,
    },
    {
      key: "cool", label: "Loss cooldown",
      status: coolStatus,
      value: cool?.active ? "ACTIVE" : cool?.streak > 0 ? "near" : "clear",
      detail: coolReason,
    },
  ];

  const priority = { act: 3, watch: 2, ok: 1 };
  const overall = dims.reduce((max, d) => {
    if (d.status == null) return max;
    return (priority[d.status] || 0) > (priority[max] || 0) ? d.status : max;
  }, "ok");

  const statusColor = (s) => s === "ok" ? "#166534"
    : s === "watch" ? "#92400e"
    : s === "act" ? "#991b1b"
    : "#64748b";
  const statusBg = (s) => s === "ok" ? "#f0fdf4"
    : s === "watch" ? "#fefce8"
    : s === "act" ? "#fef2f2"
    : "#f1f5f9";
  const statusBorder = (s) => s === "ok" ? "#bbf7d0"
    : s === "watch" ? "#fde68a"
    : s === "act" ? "#fecaca"
    : "#e2e8f0";
  const statusIcon = (s) => s === "ok" ? "✓" : s === "watch" ? "⚠" : s === "act" ? "✗" : "—";
  const overallLabel = overall === "ok" ? "GOOD" : overall === "watch" ? "WATCH" : "ACT NOW";
  const watchCount = dims.filter(d => d.status === "watch").length;
  const actCount = dims.filter(d => d.status === "act").length;
  const overallLine = overall === "ok"
    ? "All five guardrails clear. No urgent action."
    : overall === "watch"
      ? `${watchCount} guardrail${watchCount === 1 ? "" : "s"} drifting — see amber tile${watchCount === 1 ? "" : "s"}.`
      : `${actCount} guardrail${actCount === 1 ? "" : "s"} breached — see red tile${actCount === 1 ? "" : "s"}.`;

  return (
    <div style={{
      marginBottom: 12,
      background: statusBg(overall),
      border: `1px solid ${statusBorder(overall)}`,
      borderRadius: 10,
      padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>🩺 Portfolio Health</span>
          <span style={{
            padding: "3px 10px",
            borderRadius: 99,
            fontWeight: 800,
            fontSize: 11.5,
            letterSpacing: ".04em",
            background: statusColor(overall),
            color: "#fff",
          }}>{overallLabel}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sa-muted)" }}>{overallLine}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
        {dims.map(d => (
          <div key={d.key} style={{
            padding: "7px 9px",
            borderRadius: 6,
            background: "var(--sa-panel)",
            border: `1px solid ${statusBorder(d.status)}`,
            opacity: d.status == null ? 0.55 : 1,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, fontSize: 11, fontWeight: 700, color: statusColor(d.status), textTransform: "uppercase", letterSpacing: ".04em" }}>
              <span>{statusIcon(d.status)}</span>
              <span>{d.label}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: "tabular-nums", marginBottom: 1 }}>{d.value}</div>
            <div style={{ fontSize: 10.5, color: "var(--sa-muted)", lineHeight: 1.3 }}>{d.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// TodaysActionCard — the single canonical "what to do" surface
// pulled from the latest briefing snapshot (task #129 slice 3). This
// is the front-and-center consequence of the single-source-of-truth
// unification: the trader lands on the Dashboard and immediately sees
// the same rec the morning email would have shown, in one place, with
// no way to accidentally read a contradictory version from the Advice
// tab or a stale AI regen. If there's no snapshot yet (fresh account,
// briefing never fired) or no actionable card in the snapshot, the
// component renders a soft prompt to generate one — not a scary
// "no data" error.
function TodaysActionCard({ sessionToken, onGoToAdvice }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-advice/snapshot`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j && Array.isArray(j.advice)) setSnapshot(j);
      } catch { /* silent — card just shows the empty state */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  const advice = snapshot?.advice || [];
  // Find the "Today's one action" card first (the briefing's section 4
  // where the AI is instructed to name a single highest-conviction trade).
  // Fall back to any card whose title starts with an action verb — covers
  // section 0c hard-stop-exit lines or section 5 cash-deploy cards.
  const ACTION_TITLE_RE = /(today.?s\s*one\s*action|one\s*action|action|exit\s*at\s*market)/i;
  const VERB_RE = /^(🚨|⚠|👀|🔴|🟢|🛑|🎯)?\s*(BUY|SELL|TRIM|ADD|EXIT|HOLD|TIGHTEN|WATCH)\b/i;
  const oneAction = advice.find(c => ACTION_TITLE_RE.test(c.title || ""))
    || advice.find(c => VERB_RE.test((c.title || "").trim()))
    || null;
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null;
  const staleness = generatedAt
    ? (() => {
        const hrs = (Date.now() - generatedAt.getTime()) / 3600000;
        if (hrs < 1) return `${Math.round(hrs * 60)} min ago`;
        if (hrs < 24) return `${hrs.toFixed(1)}h ago`;
        return `${(hrs / 24).toFixed(1)}d ago`;
      })()
    : null;

  // Empty state — no snapshot at all, or the snapshot has no actionable card.
  if (!oneAction) {
    return (
      <div style={{
        marginBottom: 12,
        background: "var(--sa-panel-2)",
        border: "1px solid var(--sa-border)",
        borderRadius: 10, padding: "12px 14px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>📌 Today's action</div>
            <div style={{ fontSize: 13, color: "var(--sa-muted)", marginTop: 4 }}>
              {snapshot
                ? "No actionable trade in the latest briefing — the plan today is HOLD across the board."
                : "No briefing snapshot yet. Click Update Advice to generate today's plan."}
            </div>
          </div>
          <button className="sa-btn secondary" onClick={onGoToAdvice} style={{ fontSize: 12 }}>Open Advice →</button>
        </div>
      </div>
    );
  }

  // Trim the body so the card doesn't dominate the Dashboard. Keep the
  // first ~360 chars — enough for the Action/Entry/Target/Stop/Account
  // block plus a sentence of rationale. Full detail is one click away.
  const bodyPreview = (oneAction.body || "").trim().slice(0, 360);
  const truncated = (oneAction.body || "").length > 360;

  return (
    <div style={{
      marginBottom: 12,
      background: "linear-gradient(135deg, #eff6ff 0%, #ede9fe 100%)",
      border: "1px solid #c7d2fe",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "#4338ca", textTransform: "uppercase", letterSpacing: ".06em" }}>📌 Today's action</span>
          {staleness && (
            <span style={{ fontSize: 11, color: "var(--sa-muted)" }}>
              from briefing · {staleness}
            </span>
          )}
        </div>
        <button className="sa-btn secondary" onClick={onGoToAdvice} style={{ fontSize: 12 }}>Open full briefing →</button>
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "#1e293b" }}>
        {oneAction.title || "Today"}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--sa-text-2)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {bodyPreview}
        {truncated && <span style={{ color: "var(--sa-muted)" }}>…</span>}
      </div>
    </div>
  );
}

function DashboardView({ user, onTab, onRefresh, onAiAdvice, onRecordTrade, onEmailBriefing, onMonthlyReport, onEditPosition, pendingOrders, onFillPendingOrder, onCancelPendingOrder, sessionToken }) {
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  // Bumped after every successful Refresh Prices — passed to
  // TickerPerformanceCard so the chart re-fetches with nocache=true
  // instead of sitting on the 60s server-side history cache.
  const [perfChartTick, setPerfChartTick] = useState(0);
  // Values stat row starts collapsed — privacy + reduces visual noise on load
  const [valuesCollapsed, setValuesCollapsed] = useState(true);
  // Pre/post-market data per ticker — refreshed on mount and every 60s
  // during extended-hours windows so the dashboard reflects overnight moves
  // before the regular session opens.
  const [pmData, setPmData] = useState({});
  // Horizon review — per-open-rec status vs stated window. Used to flag
  // held tickers whose linked rec has ⌛ expired or gone 🔴 well-behind
  // so the trader sees the review-needed cue directly on Holdings.
  // Keyed by BASE ticker (SU vs SU.TO stripped) — see stocksHorizonReview.
  const [horizonByBase, setHorizonByBase] = useState({});
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/horizon-review`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !Array.isArray(j.rows)) return;
        const map = {};
        const baseOf = (t) => String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
        for (const row of j.rows) {
          const base = baseOf(row.ticker);
          // Prefer the worst-status row when a ticker has multiple open recs.
          const priority = { expired: 5, "hit-stop": 4, "well-behind": 3, lagging: 2, "on-pace": 1, "hit-target": 0, unknown: -1 };
          const cur = map[base];
          if (!cur || (priority[row.status] || 0) > (priority[cur.status] || 0)) {
            map[base] = row;
          }
        }
        setHorizonByBase(map);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // Trading regime + unusual options activity — combined endpoint so
  // one fetch surfaces both Dashboard chips. Silent-fail if the
  // endpoint is unavailable (chips just hide).
  const [regimeAndUoa, setRegimeAndUoa] = useState(null);
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/regime-and-uoa`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.ok) setRegimeAndUoa(j);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // Portfolio performance indicators — fetched from the daily snapshot series.
  const [perfIndicators, setPerfIndicators] = useState(null);
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/indicators`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.ok) setPerfIndicators(j);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);
  const fx = user.fxUsdCad || 1.37;
  const positionsCad = totalCad(user.positions, fx);
  const cashCad = totalCashCad(user.accounts, fx);
  const cashSplit = totalCashByCurrency(user.accounts);
  const total = positionsCad + cashCad;
  const agg = aggregateByTicker(user.positions, fx);
  const top = agg.slice(0, 8);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const advice = generateAdvice(user).slice(0, 3);
  const cashPct = total > 0 ? (cashCad / total) * 100 : 0;

  const handleRefresh = async () => {
    if (busyRefresh) return;
    setBusyRefresh(true);
    try {
      await onRefresh();
      // Bump so TickerPerformanceCard re-fetches with nocache=true and
      // the chart reflects the same fresh Yahoo bars that just landed
      // on the position cost-basis P/L.
      setPerfChartTick((n) => n + 1);
    } finally { setBusyRefresh(false); }
  };
  const handleAi = async () => {
    if (busyAi) return;
    setBusyAi(true);
    try { await onAiAdvice(); } finally { setBusyAi(false); }
  };

  // Batch-fetch pre/post-market quotes for every portfolio ticker + the
  // three index proxies. Refreshes on load, then every 60s while any of
  // the results is in an extended-hours state so intraday polling stops
  // once regular market is open.
  useEffect(() => {
    const tickers = [...new Set([
      "SPY", "QQQ", "IWM",
      ...user.positions.map((p) => resolveChartTicker(p.ticker, p.ccy)),
    ])].filter(Boolean);
    if (tickers.length === 0) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices/premarket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setPmData(j.data || {});
      } catch { /* ignore */ }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user.positions]);

  // Derive summary chips + biggest mover in user's portfolio during
  // extended hours. We accept BOTH pre- and post-market data; the
  // "active" side is picked by marketState.
  const pmDeriveActive = (row) => {
    if (!row) return null;
    if (row.marketState === "PRE" || row.marketState === "PREPRE") {
      return row.preMarketChangePct != null
        ? { label: "PRE", price: row.preMarketPrice, changePct: row.preMarketChangePct, at: row.preMarketTime }
        : null;
    }
    if (row.marketState === "POST" || row.marketState === "POSTPOST") {
      return row.postMarketChangePct != null
        ? { label: "POST", price: row.postMarketPrice, changePct: row.postMarketChangePct, at: row.postMarketTime }
        : null;
    }
    return null;
  };
  const pmSpy = pmDeriveActive(pmData["SPY"]);
  const pmQqq = pmDeriveActive(pmData["QQQ"]);
  const pmIwm = pmDeriveActive(pmData["IWM"]);
  // Biggest mover in the user's own positions (|% move| descending)
  const pmMovers = user.positions
    .map((p) => {
      const sym = resolveChartTicker(p.ticker, p.ccy);
      const active = pmDeriveActive(pmData[sym]);
      return active ? { ticker: p.ticker, sym, active } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.active.changePct) - Math.abs(a.active.changePct));
  const pmTopMover = pmMovers[0] || null;
  const showPmBanner = pmSpy || pmQqq || pmIwm || pmTopMover;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h2>Dashboard</h2>
          <div className="sa-breadcrumb">{today}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="sa-btn secondary" onClick={onRecordTrade} title="Record a buy / sell / swap / cash movement">
            + Record trade
          </button>
          <button className="sa-btn secondary" onClick={onEmailBriefing} title="Preview the daily briefing email — same content the morning cron sends">
            📧 Email Briefing
          </button>
          {(user.accounts || []).some(a => a.monthlyReportEnabled) && (
            <button className="sa-btn secondary" onClick={onMonthlyReport} title="Preview the end-of-month account report — covers every account flagged in Settings → Monthly reports">
              📊 Monthly Report
            </button>
          )}
          <button className="sa-btn secondary" onClick={handleRefresh} disabled={busyRefresh || busyAi} title="Re-fetch live prices from Yahoo Finance via the backend proxy">
            {busyRefresh ? "Refreshing…" : "↻ Refresh prices"}
          </button>
          <button className="sa-btn" onClick={handleAi} disabled={busyAi || busyRefresh} title="Search the web for fresh news and have Claude generate updated advice">
            {busyAi ? "Thinking…" : "🧠 Update Advice"}
          </button>
        </div>
      </div>
      <div className="sa-disclaimer">Research and education only. Not licensed investment advice.</div>

      <TodaysActionCard sessionToken={sessionToken} onGoToAdvice={() => onTab("advice")} />

      <PortfolioHealthChip user={user} regimeAndUoa={regimeAndUoa} />

      {showPmBanner && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "var(--sa-panel-2)", borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            {(pmSpy?.label || pmQqq?.label || pmIwm?.label || pmTopMover?.active?.label || "PRE")}-MARKET
          </span>
          {[["SPY", pmSpy], ["QQQ", pmQqq], ["IWM", pmIwm]].map(([sym, pm]) =>
            pm ? (
              <span key={sym} style={{ fontVariantNumeric: "tabular-nums" }}>
                <b>{sym}</b>{" "}
                <span style={{ color: pm.changePct >= 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>
                  {pm.changePct >= 0 ? "+" : ""}{pm.changePct.toFixed(2)}%
                </span>
              </span>
            ) : null
          )}
          {pmTopMover && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "var(--sa-muted)" }}>biggest in your portfolio:</span>{" "}
              <b>{pmTopMover.ticker}</b>{" "}
              <span style={{ color: pmTopMover.active.changePct >= 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>
                {pmTopMover.active.changePct >= 0 ? "+" : ""}{pmTopMover.active.changePct.toFixed(2)}%
              </span>
            </span>
          )}
        </div>
      )}

      {regimeAndUoa && (regimeAndUoa.regime || (regimeAndUoa.uoa || []).length > 0 || regimeAndUoa.riskVar || regimeAndUoa.lossCooldown?.active) && (
        <RegimeAndUoaChips data={regimeAndUoa} />
      )}

      {perfIndicators && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 12 }}>
          {(() => {
            const pct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
            const color = (v) => v == null ? "inherit" : (v >= 0 ? "#166534" : "#991b1b");
            const ann = perfIndicators.annualizedFrom14dPct;
            const projected12mo = (ann != null && Number.isFinite(perfIndicators.current))
              ? perfIndicators.current * (1 + ann / 100) : null;
            const maxG = perfIndicators.maxGrowthPct;
            const maxDate = perfIndicators.maxGrowthDate;
            const drawdown = perfIndicators.drawdownFromPeakPct;
            // hasDollar tags cells whose primary value or sub-line contains
            // absolute $ amounts. Those get the .sa-amount class so privacy
            // mode blurs them. Percentage-only cells stay visible even in
            // privacy mode since a % doesn't reveal absolute wealth.
            const twrr = perfIndicators.twrr || {};
            const bench = perfIndicators.benchmarks || {};
            const spySince = bench.spy?.sinceStartPct;
            const xicSince = bench.xic?.sinceStartPct;
            const alphaSpy = (twrr.sinceStartPct != null && spySince != null) ? twrr.sinceStartPct - spySince : null;
            const alphaXic = (twrr.sinceStartPct != null && xicSince != null) ? twrr.sinceStartPct - xicSince : null;
            const cells = [
              { label: "Portfolio value", v: `$${Math.round(perfIndicators.current).toLocaleString()} CAD`, hasDollar: true },
              { label: "Week over week", v: pct(perfIndicators.wowChangePct), color: color(perfIndicators.wowChangePct), sub: twrr.wowPct != null ? `TWRR ${pct(twrr.wowPct)}` : null },
              { label: `YTD${perfIndicators.ytdAnchorDate && perfIndicators.ytdAnchorDate.slice(0, 4) !== String(new Date().getUTCFullYear()) ? ` (since ${perfIndicators.ytdAnchorDate})` : ""}`, v: pct(perfIndicators.ytdChangePct), color: color(perfIndicators.ytdChangePct), sub: twrr.ytdPct != null ? `TWRR ${pct(twrr.ytdPct)}` : null },
              { label: "14d avg daily", v: pct(perfIndicators.avg14dDailyPct), color: color(perfIndicators.avg14dDailyPct) },
              {
                label: "Alpha vs SPY (since start)",
                v: alphaSpy == null ? "—" : `${alphaSpy >= 0 ? "+" : ""}${alphaSpy.toFixed(1)}pp`,
                color: color(alphaSpy),
                sub: spySince != null ? `SPY ${pct(spySince)}` : null,
              },
              {
                label: "Alpha vs XIC (since start)",
                v: alphaXic == null ? "—" : `${alphaXic >= 0 ? "+" : ""}${alphaXic.toFixed(1)}pp`,
                color: color(alphaXic),
                sub: xicSince != null ? `XIC ${pct(xicSince)}` : null,
              },
              {
                label: "Annualized (from 14d)",
                v: ann == null ? "—" : `${ann >= 0 ? "+" : ""}${ann.toFixed(0)}%`,
                color: color(ann),
                sub: projected12mo != null ? `→ $${Math.round(projected12mo).toLocaleString()} in 12mo` : null,
                subHasDollar: projected12mo != null,
              },
              {
                label: `Max growth${perfIndicators.oldestSnapshotDate ? ` (since ${perfIndicators.oldestSnapshotDate})` : ""}`,
                v: maxG == null ? "—" : `${maxG >= 0 ? "+" : ""}${maxG.toFixed(1)}%`,
                color: color(maxG),
                sub: maxDate
                  ? (drawdown != null && drawdown < 0
                    ? `peak ${maxDate} · ${drawdown.toFixed(1)}% off high`
                    : `peak ${maxDate} · at high`)
                  : null,
              },
            ];
            return cells.map((c, i) => (
              <div key={i} style={{ padding: "8px 10px", background: "var(--sa-panel)", border: "1px solid var(--sa-border)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{c.label}</div>
                <div className={c.hasDollar ? "sa-amount" : undefined} style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: c.color || "inherit", fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
                {c.sub && (
                  <div className={c.subHasDollar ? "sa-amount" : undefined} style={{ fontSize: 10.5, color: "var(--sa-muted)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{c.sub}</div>
                )}
              </div>
            ));
          })()}
        </div>
      )}

      {/* Values header — click to toggle the stat-card row */}
      <div
        onClick={() => setValuesCollapsed(c => !c)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "10px 14px", background: "var(--sa-panel)", border: "1px solid var(--sa-border)", borderRadius: 10, marginBottom: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--sa-muted)", transform: valuesCollapsed ? "none" : "rotate(90deg)", transition: "transform .15s", display: "inline-block" }}>▶</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Values</span>
          {valuesCollapsed && (
            <span className="sa-muted" style={{ fontSize: 12 }}>
              · {user.positions.length} positions · risk: <span style={{ textTransform: "capitalize" }}>{user.riskTolerance}</span> · click to reveal
            </span>
          )}
        </div>
      </div>

      {!valuesCollapsed && (
        <div className="sa-stats">
          <div className="sa-stat"><div className="label">Total value (CAD)</div><div className="value">{fmtMoney(total, "CAD")}</div><div className="delta muted" style={{ fontSize: 11, marginTop: 2 }}>{user.positions.length} positions · {fmtMoney(cashCad, "CAD")} cash</div></div>
          <div className="sa-stat"><div className="label">Equities</div><div className="value">{fmtMoney(positionsCad, "CAD")}</div><div className="delta muted" style={{ fontSize: 11, marginTop: 2 }}>{total > 0 ? ((positionsCad / total) * 100).toFixed(1) : "0"}% of book</div></div>
          <div className="sa-stat" style={{ borderColor: cashPct < 5 ? "#fde68a" : "var(--sa-border)" }}>
            <div className="label">Cash on hand</div>
            <div style={{ display: "flex", gap: 14, alignItems: "baseline", marginTop: 2 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>${cashSplit.cad.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: "var(--sa-muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>CAD</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>${cashSplit.usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: 10, color: "var(--sa-muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>USD</div>
              </div>
            </div>
            <div className="delta" style={{ fontSize: 11, marginTop: 6, color: cashPct < 5 ? "var(--sa-amber)" : "var(--sa-muted)" }}>
              {fmtMoney(cashCad, "CAD")} total · {cashPct.toFixed(1)}% of book{cashPct < 5 ? " · low" : ""}
            </div>
          </div>
          <div className="sa-stat"><div className="label">Risk profile</div><div className="value" style={{ textTransform: "capitalize" }}>{user.riskTolerance}</div></div>
        </div>
      )}
      {/* Pending orders — submitted at broker but not yet filled */}
      {pendingOrders && pendingOrders.length > 0 && (
        <PendingOrdersCard
          orders={pendingOrders}
          accounts={user.accounts || []}
          onFill={onFillPendingOrder}
          onCancel={onCancelPendingOrder}
        />
      )}

      {/* Holdings breakdown — one row per ticker, split by USD-sub vs CAD-sub */}
      <HoldingsBreakdownCard user={user} fx={fx} onEditPosition={onEditPosition} horizonByBase={horizonByBase} />

      {/* Per-ticker performance — multi-line chart, range tabs.
          Use chartTicker (e.g. "ENB.TO" for CAD-held Enbridge) so the
          chart reflects the exchange the user actually trades on.
          Previously top-10 only; now covers ALL held positions so the
          header %/$ is dollar-weighted over the full book instead of
          a top-10 subset. User Aug 12: "cover all positions, not
          top-10". Line-count cost: 12-color palette cycles at N>12
          (positions 13+ repeat colors from positions 1+); acceptable
          for the ~15-position typical book. Fetch cost is small —
          one Yahoo /history call per ticker, cached 60s server-side.*/}
      <TickerPerformanceCard
        tickers={agg.map(a => a.chartTicker || a.ticker)}
        holdings={agg.map(a => ({ ...a, ticker: a.chartTicker || a.ticker }))}
        fx={fx}
        sessionToken={sessionToken}
        refreshTick={perfChartTick}
      />

      <div className="sa-grid-2">
        <div className="sa-card">
          <h3>Allocation</h3>
          {top.length === 0 ? (
            <div className="sa-empty">No positions yet.<br /><button className="sa-btn" onClick={() => onTab("positions")}>Add positions</button></div>
          ) : top.map((a) => {
            const pct = (a.cad / total) * 100;
            // Look up pre/post-market for this allocation-row ticker.
            // Aggregate row's ticker may be un-suffixed (e.g., ENB) even
            // when the position is CAD (ENB.TO). Try both keys.
            const pmRow = pmData[a.ticker] || pmData[`${a.ticker}.TO`] || pmData[`${a.ticker}.V`] || null;
            const pmActive = pmDeriveActive(pmRow);
            return (
              <div key={a.ticker} className="sa-alloc-row">
                <div className="tk">
                  {a.ticker}
                  {pmActive && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: pmActive.changePct >= 0 ? "#dcfce7" : "#fee2e2", color: pmActive.changePct >= 0 ? "#166534" : "#991b1b", verticalAlign: "middle" }}>
                      {pmActive.label} {pmActive.changePct >= 0 ? "+" : ""}{pmActive.changePct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="bar"><div style={{ width: Math.min(100, pct).toFixed(1) + "%" }} /></div>
                <div className="pct">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
        <div className="sa-card">
          <h3>Top concerns</h3>
          {advice.map((c, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--sa-border)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: c.sev === "danger" ? "var(--sa-red)" : c.sev === "warn" ? "var(--sa-amber)" : c.sev === "good" ? "var(--sa-green)" : "var(--sa-text)" }}>{c.title}</div>
              <div style={{ fontSize: 13, color: "var(--sa-muted)" }}>{c.body.slice(0, 180)}{c.body.length > 180 ? "…" : ""}</div>
            </div>
          ))}
          <button className="sa-btn secondary" style={{ marginTop: 12 }} onClick={() => onTab("advice")}>See all advice</button>
        </div>
      </div>
    </div>
  );
}

function PositionsView({ user, sessionToken, onOpenModal, onDelete, onAddAccount, onRefreshPrices, onChangeAccountType }) {
  // Open BUY recs per held base-ticker — populates the Target / Stop
  // columns so the trader can see exit levels without opening the
  // briefing. Fetches once on mount, per-ticker keyed by BASE (XIU vs
  // XIU.TO both roll up as XIU) so the same rec surfaces for CAD and
  // USD listings of the same name. 30-day window covers the swing
  // horizon; longer-horizon recs re-fetch when the view remounts.
  const [openBuyRecsByBase, setOpenBuyRecsByBase] = useState({});
  // Full 30-day rec history per base ticker, all actions. Populated
  // alongside openBuyRecsByBase from the same fetch. Consumed by
  // PositionBar to plot little dots below the bar showing where past
  // BUY / SELL / EXIT / TRIM recs were emitted along the price axis
  // — "the AI has been calling entries around here" at a glance.
  const [recsHistoryByBase, setRecsHistoryByBase] = useState({});
  useEffect(() => {
    if (!sessionToken) return;
    const heldBases = [...new Set(
      (user.positions || [])
        .filter(p => (p.qty || 0) > 0)
        .map(p => String(p.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean)
    )];
    if (heldBases.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({ tickers: heldBases.join(","), hours: String(30 * 24) });
        const r = await fetch(`${BACKEND_URL}/api/stocks-advice/recs-for-tickers?${q.toString()}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const buyByBase = {};
        const histByBase = {};
        for (const rec of j.recs || []) {
          const base = String(rec.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
          if (!base) continue;
          if (rec.action === "BUY") {
            const prior = buyByBase[base];
            if (!prior || new Date(rec.generatedAt) > new Date(prior.generatedAt)) buyByBase[base] = rec;
          }
          if (Number.isFinite(rec.entryPrice) && rec.entryPrice > 0) {
            if (!histByBase[base]) histByBase[base] = [];
            histByBase[base].push({
              action: rec.action,
              entryPrice: rec.entryPrice,
              generatedAt: rec.generatedAt,
            });
          }
        }
        setOpenBuyRecsByBase(buyByBase);
        setRecsHistoryByBase(histByBase);
      } catch { /* silent — Target / Stop cells just show "—" */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, user.positions]);

  // Trades loaded once for the whole view; expanded rows filter locally.
  const [tradesByBaseTicker, setTradesByBaseTicker] = useState({});
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-trade?days=1825`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const idx = {};
        for (const t of (j.trades || [])) {
          for (const leg of (t.legs || [])) {
            if (!leg.ticker) continue;
            const base = String(leg.ticker).toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
            if (!idx[base]) idx[base] = [];
            idx[base].push({ ...leg, executedAt: t.executedAt, tradeId: t._id, account: t.accountName || t.account });
          }
        }
        for (const b of Object.keys(idx)) idx[b].sort((a, c) => new Date(a.executedAt) - new Date(c.executedAt));
        setTradesByBaseTicker(idx);
      } catch { /* silent — expand rows just say "no trades on file" */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const fx = user.fxUsdCad || 1.37;
  const bookTotal = totalCad(user.positions, fx) + (user.accounts || []).reduce(
    (s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx, 0
  );

  // Auto-derived trailing stops for SWING/SPEC positions that lack an
  // explicit stop from a Curriculate BUY rec. Fetched from
  // /api/stocks-portfolio/derived-stops which delegates to
  // services/stocksTechnicals — 60-day high minus 2.5×ATR. Keyed by the
  // ORIGINAL (exchange-qualified) ticker so ENB.TO vs ENB (US ADR) get
  // separate lookups. CORE positions are excluded (buy-and-hold — a
  // stop is not the right primitive there).
  const [derivedStopsByTicker, setDerivedStopsByTicker] = useState({});
  useEffect(() => {
    if (!sessionToken) return;
    const need = [...new Set(
      (user.positions || [])
        .filter((p) => (p.qty || 0) > 0)
        .filter((p) => {
          const sleeve = sleeveOfTicker(p.ticker);
          return sleeve === "swing" || sleeve === "spec";
        })
        .map((p) => ({ ticker: String(p.ticker || "").toUpperCase(), currency: p.ccy }))
        .filter((e) => e.ticker)
        .map((e) => JSON.stringify(e))
    )].map((s) => JSON.parse(s));
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/derived-stops`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({ tickers: need }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setDerivedStopsByTicker(j.stops || {});
      } catch { /* silent — Stop cells just show "—" as before */ }
    })();
    return () => { cancelled = true; };
    // Only refetch when the set of (ticker,ccy) pairs actually changes —
    // avoid re-firing on every price tick coming through the 45s poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, (user.positions || []).map((p) => `${p.ticker}|${p.ccy}|${(p.qty || 0) > 0 ? "1" : "0"}`).join(",")]);

  // Day-change (current vs prior close) for every held ticker — drives the
  // ▲/▼ trend arrow next to P/L%. Fetched once on mount; 60s server-side
  // cache means a page reload doesn't re-hit Yahoo. Fail-open — a missing
  // entry renders as ▬ (grey/dash) so a Yahoo hiccup doesn't block the row.
  const [dayChangeByTicker, setDayChangeByTicker] = useState({});
  useEffect(() => {
    const heldTickers = [...new Set(
      (user.positions || [])
        .filter((p) => (p.qty || 0) > 0)
        .map((p) => resolveChartTicker(p.ticker, p.ccy))
        .filter(Boolean)
    )];
    if (heldTickers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices/day-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: heldTickers }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        // Re-key by ORIGINAL (unqualified) ticker so the render loop can
        // look up by p.ticker directly. resolveChartTicker maps ENB CAD
        // → ENB.TO; we invert here.
        const byOrig = {};
        for (const p of (user.positions || [])) {
          if ((p.qty || 0) <= 0) continue;
          const ex = resolveChartTicker(p.ticker, p.ccy);
          const q = j.data?.[ex];
          if (q) byOrig[`${p.ticker}|${p.ccy}`] = q;
        }
        setDayChangeByTicker(byOrig);
      } catch { /* silent — arrows just render as ▬ */ }
    })();
    return () => { cancelled = true; };
    // Same dependency guard as derived-stops — only refetch on holdings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(user.positions || []).map((p) => `${p.ticker}|${p.ccy}|${(p.qty || 0) > 0 ? "1" : "0"}`).join(",")]);

  // Ticker filter — when set, only rows whose ticker matches (case-
  // insensitive substring) are rendered. Handy for hunting a mystery
  // symbol the briefing referenced but you can't spot in the list.
  const [tickerFilter, setTickerFilter] = useState("");
  const [dumpOpen, setDumpOpen] = useState(false);

  // Group positions by account, preserving the original index so edit/delete
  // callbacks still route correctly to user.positions[i].
  const positionsByAcct = new Map();
  const unassigned = [];
  (user.positions || []).forEach((p, idx) => {
    const tagged = Object.assign({}, p, { _origIdx: idx });
    const acct = (user.accounts || []).find((a) => a.id === p.acct);
    if (acct) {
      if (!positionsByAcct.has(p.acct)) positionsByAcct.set(p.acct, []);
      positionsByAcct.get(p.acct).push(tagged);
    } else {
      unassigned.push(tagged);
    }
  });

  // Per-account summaries, sorted by total value desc
  const accountSummaries = (user.accounts || []).map((a) => {
    const items = positionsByAcct.get(a.id) || [];
    const equityCad = items.reduce((s, p) => s + valueOfPosition(p, fx).cad, 0);
    const cashCadEquiv = (a.cashCad || 0) + (a.cashUsd || 0) * fx;
    return { account: a, items, equityCad, cashCadEquiv, total: equityCad + cashCadEquiv };
  }).sort((a, b) => b.total - a.total);

  // Total unrealized P/L split by NATIVE currency. CAD holdings summed in
  // CAD, USD in USD — never combined (an aggregated single-currency line
  // would misrepresent risk since it hides which side of the border the
  // exposure lives on). Percentage denominator is total cost basis in the
  // same currency, so a USD position with a 10% gain on $10k basis reads
  // consistently regardless of the CAD/USD rate.
  const pnlByCcy = (() => {
    const acc = {
      CAD: { pnl: 0, basis: 0, count: 0 },
      USD: { pnl: 0, basis: 0, count: 0 },
    };
    for (const p of (user.positions || [])) {
      if ((p.qty || 0) <= 0) continue;
      const ccy = p.ccy === "USD" ? "USD" : "CAD";
      const price = ccy === "USD" ? p.priceUsd : p.priceCad;
      const basis = ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
      if (price == null || basis == null || !(basis > 0)) continue;
      const pnl = (price - basis) * (p.qty || 0);
      acc[ccy].pnl += pnl;
      acc[ccy].basis += basis * (p.qty || 0);
      acc[ccy].count += 1;
    }
    return acc;
  })();

  return (
    <div>
      <h2>Positions</h2>
      <div className="sa-breadcrumb">
        {user.positions.length} position{user.positions.length === 1 ? "" : "s"} across {accountSummaries.length} account{accountSummaries.length === 1 ? "" : "s"}
        {unassigned.length > 0 && ` · ${unassigned.length} unassigned`}
      </div>
      {(pnlByCcy.CAD.count > 0 || pnlByCcy.USD.count > 0) && (
        <div className="sa-breadcrumb" style={{ fontSize: 12.5, marginTop: 2 }}>
          <span style={{ color: "var(--sa-muted)" }}>Unrealized P/L: </span>
          {(() => {
            const parts = [];
            for (const ccy of ["CAD", "USD"]) {
              const bkt = pnlByCcy[ccy];
              if (bkt.count === 0) continue;
              const pct = bkt.basis > 0 ? (bkt.pnl / bkt.basis) * 100 : null;
              const col = bkt.pnl > 0 ? "var(--sa-green)" : bkt.pnl < 0 ? "var(--sa-red)" : "var(--sa-muted)";
              parts.push(
                <span key={ccy} style={{ color: col, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  <span className="sa-amount">
                    {bkt.pnl >= 0 ? "+" : "−"}{fmtMoney(Math.abs(bkt.pnl), ccy)}
                  </span>
                  {pct != null && <span style={{ marginLeft: 4 }}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                </span>
              );
            }
            // Interleave with a " · " separator between currency buckets so
            // the two show as siblings, not stacked.
            const out = [];
            parts.forEach((el, i) => {
              if (i > 0) out.push(<span key={`sep-${i}`} style={{ color: "var(--sa-muted)", margin: "0 6px" }}>·</span>);
              out.push(el);
            });
            // Combined = CAD-bucket P&L + USD-bucket P&L converted at
            // current fx. Same for the basis denominator so the %
            // stays consistent with the split-by-currency numbers.
            // User Aug 13: "add a combined value and combined %". Note
            // in muted tone that this line moves with FX even when no
            // stock ticked — so a reader eyeballing "portfolio return"
            // knows why it drifts intraday. Show only when both
            // buckets have activity (otherwise it's redundant with
            // the single-ccy line above).
            if (pnlByCcy.CAD.count > 0 && pnlByCcy.USD.count > 0) {
              const combinedPnlCad = pnlByCcy.CAD.pnl + pnlByCcy.USD.pnl * fx;
              const combinedBasisCad = pnlByCcy.CAD.basis + pnlByCcy.USD.basis * fx;
              const combinedPct = combinedBasisCad > 0 ? (combinedPnlCad / combinedBasisCad) * 100 : null;
              const combinedCol = combinedPnlCad > 0 ? "var(--sa-green)" : combinedPnlCad < 0 ? "var(--sa-red)" : "var(--sa-muted)";
              out.push(
                <span key="combined-sep" style={{ color: "var(--sa-muted)", margin: "0 6px" }}>·</span>
              );
              out.push(
                <span key="combined" title={`CAD P/L + (USD P/L × fx ${fx.toFixed(4)}). Moves with FX even when no stock ticked.`}>
                  <span style={{ color: "var(--sa-muted)", fontSize: 11.5 }}>combined </span>
                  <span style={{ color: combinedCol, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    <span className="sa-amount">
                      {combinedPnlCad >= 0 ? "+" : "−"}{fmtMoney(Math.abs(combinedPnlCad), "CAD")}
                    </span>
                    {combinedPct != null && <span style={{ marginLeft: 4 }}>({combinedPct >= 0 ? "+" : ""}{combinedPct.toFixed(1)}%)</span>}
                  </span>
                </span>
              );
            }
            return out;
          })()}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button className="sa-btn" onClick={() => onOpenModal(null)}>+ Add position</button>
        <button className="sa-btn secondary" onClick={onAddAccount}>+ Add account</button>
        <button className="sa-btn secondary" onClick={onRefreshPrices} title="Try fetch latest prices from Yahoo Finance">↻ Refresh prices</button>
        <input
          type="search"
          placeholder="Filter by ticker (e.g. HIT)"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          style={{ padding: "6px 10px", minWidth: 180, fontFamily: "monospace" }}
        />
        <button className="sa-btn secondary" onClick={() => setDumpOpen(o => !o)} title="Show every row in the raw positions array — ticker, acct, qty, ccy, prices, cost basis. Use to hunt phantom lots the briefing referenced but you can't see in the account cards.">{dumpOpen ? "Hide raw" : "Dump raw JSON"}</button>
      </div>
      {dumpOpen && (
        <div className="sa-card" style={{ padding: 12, marginBottom: 14, background: "var(--sa-panel-2)", overflowX: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 6 }}>
            {user.positions.length} row{user.positions.length === 1 ? "" : "s"} in positions array. Ctrl-F for the ticker you're hunting.
          </div>
          <pre style={{ margin: 0, fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
{user.positions.map((p, i) => `${String(i).padStart(3, " ")}  ${String(p.ticker || "").padEnd(10)}  acct=${String(p.acct || "").padEnd(14)}  qty=${String(p.qty ?? 0).padEnd(6)}  ccy=${p.ccy || "?"}  sub=${p.subCcy || p.ccy || "?"}  pxUsd=${p.priceUsd ?? "-"}  pxCad=${p.priceCad ?? "-"}  basisUsd=${p.costBasisUsd ?? "-"}  basisCad=${p.costBasisCad ?? "-"}`).join("\n")}
          </pre>
        </div>
      )}

      {user.positions.length === 0 && accountSummaries.length === 0 && (
        <div className="sa-card" style={{ textAlign: "center", padding: 40, color: "var(--sa-muted)" }}>
          No positions yet. Click <b>Add position</b> to get started.
        </div>
      )}

      {accountSummaries.map(({ account, items, equityCad, cashCadEquiv, total: accTotal }) => (
        // Card was `overflow: hidden` which trapped the table under
        // the right margin on wide books — user Aug 13 couldn't reach
        // the edit/delete buttons. Switch to `overflow-x: auto` so the
        // table (and the full-width position bar sub-rows with
        // colSpan={13}) scroll horizontally when they exceed viewport
        // width, while keeping the vertical `hidden` for rounded-
        // corner clipping on the account header.
        <div key={account.id} className="sa-card" style={{ padding: 0, marginBottom: 14, overflowX: "auto", overflowY: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "var(--sa-panel-2)", borderBottom: "1px solid var(--sa-border)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{account.name}</div>
                {/* Inline account-type dropdown — one authoritative
                    control per account. When unset, the select shows
                    a subtle amber "set type" prompt so ambiguous labels
                    like "Non-Spousal" (which might really be an
                    Individual taxable account) don't hide the
                    ground-truth classification. */}
                {onChangeAccountType && (
                  <select
                    value={account.accountType || ""}
                    onChange={(e) => onChangeAccountType(account.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title="Registered / tax-treatment classification for this account"
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      border: `1px solid ${account.accountType ? "var(--sa-border)" : "#f59e0b"}`,
                      background: account.accountType ? "transparent" : "#fef3c7",
                      color: account.accountType ? "inherit" : "#78350f",
                      borderRadius: 4,
                      fontWeight: 500,
                    }}
                  >
                    <option value="">— set type —</option>
                    {ACCOUNT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.short}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 2 }}>
                {items.length} position{items.length === 1 ? "" : "s"} · cash <span className="sa-amount">{fmtMoney(account.cashCad || 0, "CAD")}</span> + <span className="sa-amount">{fmtMoney(account.cashUsd || 0, "USD")}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}><span className="sa-amount">{fmtMoney(accTotal, "CAD")}</span></div>
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 2 }}>
                equity <span className="sa-amount">{fmtMoney(equityCad, "CAD")}</span> · {bookTotal > 0 ? ((accTotal / bookTotal) * 100).toFixed(1) : "0"}% of book
              </div>
            </div>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: "16px 20px", color: "var(--sa-muted)", fontSize: 13, fontStyle: "italic" }}>
              Cash only — no positions held in this account.
            </div>
          ) : (
            <table className="sa-table" style={{ marginBottom: 0 }}>
              <thead><tr>
                <th>Ticker</th><th>Qty</th><th>Price</th><th>CCY</th><th>Basis</th><th>P/L %</th><th>P/L $</th><th title="Target price from the most recent open BUY rec (30-day window). Shows % distance from current price.">Target</th><th title="Stop price from the most recent open BUY rec (30-day window). Red when current is within 3% or already below.">Stop</th><th>Value (CAD)</th><th>% acct</th><th>% book</th><th></th>
              </tr></thead>
              <tbody>
                {items.flatMap((p) => {
                  const v = valueOfPosition(p, fx);
                  const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
                  const basis = p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
                  const pnlPct = (price != null && basis != null && basis > 0) ? ((price - basis) / basis) * 100 : null;
                  const pnlCcy = (price != null && basis != null && basis > 0) ? (price - basis) * (p.qty || 0) : null;
                  const pnlCad = pnlCcy != null ? (p.ccy === "USD" ? pnlCcy * fx : pnlCcy) : null;
                  const pnlColor = pnlPct == null ? "inherit" : pnlPct > 0 ? "#166534" : pnlPct < 0 ? "#991b1b" : "inherit";
                  const q = tickerFilter.trim().toLowerCase();
                  const matches = q && String(p.ticker || "").toLowerCase().includes(q);
                  if (q && !matches) return [];
                  const baseKey = String(p.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
                  const isExpanded = expandedTicker === `${p._origIdx}`;
                  const tradesForTicker = tradesByBaseTicker[baseKey] || [];
                  const rows = [(
                    <tr
                      key={p._origIdx}
                      style={{ ...(matches ? { background: "var(--sa-amber-soft)" } : undefined), cursor: "pointer" }}
                      onClick={() => setExpandedTicker(isExpanded ? null : `${p._origIdx}`)}
                    >
                      <td className="tk">
                        <span style={{ display: "inline-block", width: 12, color: "var(--sa-muted)", fontSize: 9, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                        {" "}
                        {p.ticker}
                        {(() => {
                          // Sleeve badge — same colour scheme the Test A
                          // and sleeve-balance blocks use, so every surface
                          // in the app labels a ticker's role identically.
                          const sleeve = sleeveOfTicker(p.ticker);
                          const bg = sleeve === "core" ? "#dbeafe"
                            : sleeve === "swing" ? "#dcfce7"
                            : "#fef3c7";
                          const fg = sleeve === "core" ? "#1e40af"
                            : sleeve === "swing" ? "#166534"
                            : "#78350f";
                          return (
                            <span
                              title={
                                sleeve === "core" ? "CORE — buy-and-hold anchor (broad ETFs), target 80% of book"
                                : sleeve === "swing" ? "SWING — Canadian large-caps + US mega-caps, target 15%, single-name conviction trades"
                                : "SPEC — high-vol / meme / early-stage names, cap 5%"
                              }
                              style={{
                                marginLeft: 6, padding: "1px 6px",
                                borderRadius: 4, fontSize: 9.5, fontWeight: 700,
                                letterSpacing: ".04em", background: bg, color: fg,
                                verticalAlign: "middle",
                              }}
                            >{sleeve.toUpperCase()}</span>
                          );
                        })()}
                        <span className="sub">{p.name || ""}</span>
                      </td>
                      <td>{p.qty.toLocaleString()}</td>
                      <td>{price != null ? price.toFixed(4) : "—"}</td>
                      <td>{p.ccy}</td>
                      <td>{basis != null ? basis.toFixed(2) : <span className="sa-muted">—</span>}</td>
                      <td style={{ color: pnlColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
                        {(() => {
                          // Day-change trend arrow — green ▲ / red ▼ / grey ▬.
                          // Purely visual — never blocks the row when the
                          // feed is unavailable (fail-open to ▬).
                          const dc = dayChangeByTicker[`${p.ticker}|${p.ccy}`];
                          const chg = dc?.changePct;
                          const arrow = chg == null ? "▬" : chg > 0.05 ? "▲" : chg < -0.05 ? "▼" : "▬";
                          const col = chg == null ? "var(--sa-muted)"
                            : chg > 0.05 ? "var(--sa-green)"
                            : chg < -0.05 ? "var(--sa-red)"
                            : "var(--sa-muted)";
                          const label = chg == null ? "" : ` ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`;
                          return (
                            <span
                              title={chg == null ? "Day change unavailable" : `Today: ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% vs prior close`}
                              style={{ marginLeft: 6, fontSize: 10.5, color: col, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
                            >{arrow}{label}</span>
                          );
                        })()}
                      </td>
                      <td style={{ color: pnlColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pnlCad != null ? <span className="sa-amount">{pnlCad >= 0 ? "+" : "−"}{fmtMoney(Math.abs(pnlCad), "CAD")}</span> : "—"}</td>
                      {(() => {
                        // Target / Stop from the most-recent open BUY rec on
                        // this base ticker. Distance is signed % from current
                        // price. Green when approaching target from below;
                        // red when stop is close or already breached.
                        const rec = openBuyRecsByBase[baseKey];
                        const cur = price;
                        const fmtDist = (from, to) => {
                          if (from == null || to == null || from <= 0) return "";
                          const d = ((to - from) / from) * 100;
                          return ` (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`;
                        };
                        // Auto-derived trail-stop fallback — surfaces the
                        // 60d-high − 2.5×ATR level for SWING/SPEC positions
                        // that have no user-set stop yet (i.e. no open BUY
                        // rec, or a rec that never set one). CORE ETFs
                        // stay "—" — buy-and-hold, stop isn't the right
                        // primitive. Rendered in muted colour with an
                        // "(auto)" tag so the user can see at a glance
                        // which stops came from a Curriculate rec vs the
                        // algorithm.
                        const sleeve = sleeveOfTicker(p.ticker);
                        const wantAuto = (sleeve === "swing" || sleeve === "spec");
                        const auto = wantAuto ? derivedStopsByTicker[String(p.ticker || "").toUpperCase()] : null;
                        if (!rec || !Number.isFinite(cur)) {
                          const autoStp = auto?.derivedStop;
                          const autoDistPct = auto?.stopDistancePct;
                          if (Number.isFinite(autoStp) && Number.isFinite(cur)) {
                            const breach = cur <= autoStp;
                            return (
                              <>
                                <td className="sa-muted">—</td>
                                <td
                                  style={{
                                    color: breach ? "#991b1b" : "var(--sa-muted)",
                                    fontVariantNumeric: "tabular-nums",
                                    fontWeight: breach ? 700 : 400,
                                  }}
                                  title={`Auto-derived from technicals: 60d high $${auto.high60d?.toFixed(2) ?? "?"} − 2.5×ATR14 $${auto.atr14?.toFixed(2) ?? "?"}. No Curriculate BUY rec on this position; this is the algorithm's suggested trail-stop level.${breach ? " ⚠ BREACHED." : ""}`}
                                >
                                  ${autoStp.toFixed(2)} {auto.currency || p.ccy || ""}
                                  {Number.isFinite(autoDistPct) && (
                                    <span style={{ fontSize: 10, color: "var(--sa-muted)", marginLeft: 4 }}>
                                      ({autoDistPct >= 0 ? "+" : ""}{autoDistPct.toFixed(1)}%)
                                    </span>
                                  )}
                                  <span style={{ fontSize: 9, color: "var(--sa-muted)", marginLeft: 4, fontStyle: "italic" }}>(auto)</span>
                                </td>
                              </>
                            );
                          }
                          return (
                            <>
                              <td className="sa-muted">—</td>
                              <td className="sa-muted">—</td>
                            </>
                          );
                        }
                        // Reject $0 targets/stops as bad data — mandate-
                        // persisted recs sometimes have targetPrice=0 in
                        // the DB (from a null→0 coercion path); rendering
                        // "$0.00 (-100.0%)" in the column is meaningless.
                        // User Aug 13: "target $0? same in column 8".
                        const tgt = Number.isFinite(rec.targetPrice) && rec.targetPrice > 0 ? rec.targetPrice : null;
                        const stp = Number.isFinite(rec.stopPrice) && rec.stopPrice > 0 ? rec.stopPrice : null;
                        const stopBreached = stp != null && cur <= stp;
                        const stopNear = stp != null && !stopBreached && ((cur - stp) / cur) * 100 <= 3;
                        const targetHit = tgt != null && cur >= tgt;
                        const targetColor = targetHit ? "#166534" : "var(--sa-text)";
                        const stopColor = stopBreached ? "#991b1b" : stopNear ? "#92400e" : "var(--sa-text)";
                        return (
                          <>
                            <td style={{ color: targetColor, fontVariantNumeric: "tabular-nums" }} title={targetHit ? "🎯 Target reached — consider trimming or moving stop up" : undefined}>
                              {tgt != null ? `$${tgt.toFixed(2)}` : "—"}
                              {tgt != null && <span style={{ fontSize: 10, color: "var(--sa-muted)" }}>{fmtDist(cur, tgt)}</span>}
                            </td>
                            <td style={{ color: stopColor, fontVariantNumeric: "tabular-nums", fontWeight: stopBreached ? 700 : 400 }} title={stopBreached ? "🛑 Stop breached — hard-stop discipline says exit" : stopNear ? "⚠ Within 3% of stop" : undefined}>
                              {stp != null
                                ? (<>${stp.toFixed(2)}<span style={{ fontSize: 10, color: "var(--sa-muted)" }}>{fmtDist(cur, stp)}</span></>)
                                : (() => {
                                    // Rec exists but has no explicit stop — fall
                                    // back to the auto-derived trail stop for
                                    // SWING/SPEC. Same muted-with-(auto)-tag
                                    // treatment as the "no rec at all" branch.
                                    const autoStp = auto?.derivedStop;
                                    const autoDistPct = auto?.stopDistancePct;
                                    if (!Number.isFinite(autoStp)) return "—";
                                    const breach = cur <= autoStp;
                                    return (
                                      <span
                                        style={{ color: breach ? "#991b1b" : "var(--sa-muted)", fontWeight: breach ? 700 : 400 }}
                                        title={`Auto-derived from technicals: 60d high $${auto.high60d?.toFixed(2) ?? "?"} − 2.5×ATR14 $${auto.atr14?.toFixed(2) ?? "?"}. The BUY rec on this position did not set an explicit stop; this is the algorithm's suggested trail-stop level.${breach ? " ⚠ BREACHED." : ""}`}
                                      >
                                        ${autoStp.toFixed(2)} {auto.currency || p.ccy || ""}
                                        {Number.isFinite(autoDistPct) && (
                                          <span style={{ fontSize: 10, color: "var(--sa-muted)", marginLeft: 4 }}>
                                            ({autoDistPct >= 0 ? "+" : ""}{autoDistPct.toFixed(1)}%)
                                          </span>
                                        )}
                                        <span style={{ fontSize: 9, color: "var(--sa-muted)", marginLeft: 4, fontStyle: "italic" }}>(auto)</span>
                                      </span>
                                    );
                                  })()}
                            </td>
                          </>
                        );
                      })()}
                      <td><span className="sa-amount">{fmtMoney(v.cad, "CAD")}</span></td>
                      <td>{equityCad > 0 ? ((v.cad / equityCad) * 100).toFixed(1) : "0.0"}%</td>
                      <td>{bookTotal > 0 ? ((v.cad / bookTotal) * 100).toFixed(1) : "0.0"}%</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="sa-btn ghost" onClick={() => onOpenModal(p._origIdx)}>edit</button>
                        {" "}
                        <button className="sa-btn ghost" onClick={() => onDelete(p._origIdx)}>delete</button>
                      </td>
                    </tr>
                  )];
                  // Persistent visual position bar under every ticker row.
                  // User Aug 8: "for each held ticker, I want a visual bar
                  // with an indicator showing where along the bar the
                  // position is, showing loss zone, entry, stop, profitable,
                  // target, current position." Reuses the same rec / auto-
                  // stop resolution as the Target/Stop cells above so a
                  // single source of truth drives both.
                  {
                    const rec = openBuyRecsByBase[baseKey];
                    const sleeve = sleeveOfTicker(p.ticker);
                    const wantAuto = (sleeve === "swing" || sleeve === "spec");
                    const auto = wantAuto ? derivedStopsByTicker[String(p.ticker || "").toUpperCase()] : null;
                    const barEntry = basis;
                    const barCurrent = price;
                    // A $0 stop is bad data — never plot it. Downstream
                    // scale math and the "stop $0.00" label look broken.
                    const recStop = Number.isFinite(rec?.stopPrice) && rec.stopPrice > 0 ? rec.stopPrice : null;
                    const autoStop = Number.isFinite(auto?.derivedStop) && auto.derivedStop > 0 ? auto.derivedStop : null;
                    const barStop = recStop ?? autoStop ?? null;
                    const stopSource = Number.isFinite(recStop) ? "rec" : "auto";
                    // Target: prefer rec.targetPrice; else derive as
                    // entry + 2R (2× risk from entry to stop) for
                    // SWING/SPEC/INCOME positions where R-multiple
                    // targets make sense. CORE ETFs are buy-and-hold —
                    // 2R above a -15% regime stop is +30%, a multi-
                    // year target, not useful as a bar reference.
                    // User Aug 13: "should show target" — bar had a
                    // stop tick and a current marker but no target
                    // tick for names where the rec never set one.
                    const R_MULT_DEFAULT = 2;
                    // Same > 0 guard as barStop above — reject $0
                    // targets as bad data (mandate persistence coercion).
                    let barTarget = Number.isFinite(rec?.targetPrice) && rec.targetPrice > 0 ? rec.targetPrice : null;
                    let targetSource = "rec";
                    if (!Number.isFinite(barTarget)
                        && (sleeve === "swing" || sleeve === "spec" || sleeve === "income")
                        && Number.isFinite(barStop)
                        && Number.isFinite(barCurrent)) {
                      // Anchor the R-multiple on whichever is higher —
                      // entry or current. For a fresh position (current
                      // ≈ entry) this gives entry + 2R = classic target.
                      // For a winner whose trail-stop has ratcheted
                      // above entry (BNS/NVDA case Aug 13: entry $110,
                      // stop $122 auto, current $125), the entry-based
                      // formula would put target below stop and
                      // collapse the bar scale. Anchor on current
                      // instead: current + 2×(current − stop) → target
                      // makes sense in the "if I got in here, where
                      // would I aim" sense.
                      const anchor = Number.isFinite(barEntry) ? Math.max(barEntry, barCurrent) : barCurrent;
                      const risk = anchor - barStop;
                      if (risk > 0) {
                        barTarget = anchor + R_MULT_DEFAULT * risk;
                        targetSource = "auto";
                      }
                    }
                    // Render the sub-row for every held ticker with a
                    // basis + live price. Even CORE ETFs (no stop, no
                    // target) get a minimal entry-vs-current strip so
                    // the reader gets a consistent visual per row.
                    // User Aug 13: "why do not all tickers have this
                    // bar" — was CORE ETFs by design; now universal.
                    if (Number.isFinite(barEntry) && Number.isFinite(barCurrent)) {
                      rows.push(
                        <tr key={`${p._origIdx}-bar`}>
                          <td colSpan={13} style={{ padding: 0, borderTop: "none" }}>
                            <PositionBar
                              entry={barEntry}
                              stop={barStop}
                              target={barTarget}
                              current={barCurrent}
                              currency={p.ccy}
                              stopSource={stopSource}
                              targetSource={targetSource}
                              recs={recsHistoryByBase[baseKey] || []}
                            />
                          </td>
                        </tr>
                      );
                    }
                  }
                  if (isExpanded) {
                    rows.push(
                      <tr key={`${p._origIdx}-trades`} style={{ background: "var(--sa-panel-2)" }}>
                        <td colSpan={13} style={{ padding: "8px 14px 10px 30px" }}>
                          {tradesForTicker.length === 0 ? (
                            <div className="sa-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                              No recorded trades for <b>{baseKey}</b> in the journal.
                            </div>
                          ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                              <thead>
                                <tr style={{ color: "var(--sa-muted)", textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>
                                  <th style={{ textAlign: "left", padding: "3px 8px" }}>Date</th>
                                  <th style={{ textAlign: "left", padding: "3px 8px" }}>Side</th>
                                  <th style={{ textAlign: "right", padding: "3px 8px" }}>Qty</th>
                                  <th style={{ textAlign: "right", padding: "3px 8px" }}>Fill</th>
                                  <th style={{ textAlign: "right", padding: "3px 8px" }}>vs now</th>
                                  <th style={{ textAlign: "right", padding: "3px 8px" }}>P/L $</th>
                                  <th style={{ textAlign: "left", padding: "3px 8px" }}>Account</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tradesForTicker.map((leg, i) => {
                                  const fillCcy = leg.currency || p.ccy;
                                  const nowInLegCcy = fillCcy === p.ccy ? price
                                    : (fillCcy === "USD" && p.ccy === "CAD") ? (p.priceCad != null ? p.priceCad / fx : null)
                                    : (fillCcy === "CAD" && p.ccy === "USD") ? (p.priceUsd != null ? p.priceUsd * fx : null)
                                    : price;
                                  const vsNow = (Number.isFinite(nowInLegCcy) && Number.isFinite(leg.pricePerShare) && leg.pricePerShare > 0)
                                    ? ((nowInLegCcy - leg.pricePerShare) / leg.pricePerShare) * 100
                                    : null;
                                  // BUY: gain if now > fill. SELL: gain if now < fill (you sold higher than today's price).
                                  const dir = leg.side === "BUY" ? 1 : leg.side === "SELL" ? -1 : 0;
                                  const realizedPnlCcy = (dir !== 0 && Number.isFinite(nowInLegCcy)) ? dir * (nowInLegCcy - leg.pricePerShare) * (leg.shares || 0) : null;
                                  const realizedPnlCad = realizedPnlCcy != null ? (fillCcy === "USD" ? realizedPnlCcy * fx : realizedPnlCcy) : null;
                                  const vsColor = vsNow == null ? "inherit" : (dir * vsNow > 0 ? "#166534" : dir * vsNow < 0 ? "#991b1b" : "inherit");
                                  return (
                                    <tr key={i} style={{ borderTop: "1px dashed var(--sa-border)" }}>
                                      <td style={{ padding: "3px 8px" }}>{new Date(leg.executedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}</td>
                                      <td style={{ padding: "3px 8px" }}>
                                        <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: leg.side === "BUY" ? "var(--sa-green-soft)" : leg.side === "SELL" ? "var(--sa-red-soft)" : "var(--sa-panel-2)", color: leg.side === "BUY" ? "var(--sa-green)" : leg.side === "SELL" ? "var(--sa-red)" : "var(--sa-muted)" }}>{leg.side}</span>
                                      </td>
                                      <td style={{ padding: "3px 8px", textAlign: "right" }}>{(leg.shares || 0).toLocaleString()}</td>
                                      <td style={{ padding: "3px 8px", textAlign: "right" }}>{Number(leg.pricePerShare).toFixed(2)} {fillCcy}</td>
                                      <td style={{ padding: "3px 8px", textAlign: "right", color: vsColor, fontWeight: 600 }}>{vsNow != null ? `${vsNow >= 0 ? "+" : ""}${vsNow.toFixed(1)}%` : "—"}</td>
                                      <td style={{ padding: "3px 8px", textAlign: "right", color: vsColor, fontWeight: 600 }}>{realizedPnlCad != null ? <span className="sa-amount">{realizedPnlCad >= 0 ? "+" : "−"}{fmtMoney(Math.abs(realizedPnlCad), "CAD")}</span> : "—"}</td>
                                      <td style={{ padding: "3px 8px", color: "var(--sa-muted)" }}>{leg.account || "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {unassigned.length > 0 && (
        <div className="sa-card" style={{ padding: 0, marginBottom: 14, overflow: "hidden", borderColor: "var(--sa-amber)" }}>
          <div style={{ padding: "12px 16px", background: "var(--sa-amber-soft)", borderBottom: "1px solid var(--sa-amber)" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--sa-amber)" }}>⚠ Unassigned positions</div>
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 2 }}>
              These positions reference an account ID that doesn't match any current account. Click Edit on each row to reassign.
            </div>
          </div>
          <table className="sa-table" style={{ marginBottom: 0 }}>
            <thead><tr>
              <th>Ticker</th><th>Acct ID</th><th>Qty</th><th>Price</th><th>CCY</th><th>Value (CAD)</th><th></th>
            </tr></thead>
            <tbody>
              {unassigned.map((p) => {
                const v = valueOfPosition(p, fx);
                const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
                return (
                  <tr key={p._origIdx}>
                    <td className="tk">{p.ticker}</td>
                    <td className="sa-muted">{p.acct || "—"}</td>
                    <td>{p.qty.toLocaleString()}</td>
                    <td>{price != null ? price.toFixed(4) : "—"}</td>
                    <td>{p.ccy}</td>
                    <td><span className="sa-amount">{fmtMoney(v.cad, "CAD")}</span></td>
                    <td>
                      <button className="sa-btn ghost" onClick={() => onOpenModal(p._origIdx)}>edit</button>
                      {" "}
                      <button className="sa-btn ghost" onClick={() => onDelete(p._origIdx)}>delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Inline-bold renderer — converts **text** → <strong>text</strong> inside a
// string while preserving non-bold spans as text. Used by the body-renderer.
function renderInlineBold(s) {
  if (!s) return null;
  const parts = String(s).split(/(\*\*[^*]+\*\*)/);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

// Color palette for the Call action badge.
function actionPalette(action) {
  if (!action) return null;
  const a = action.toUpperCase().trim();
  if (a.startsWith("BUY") || a.startsWith("ADD"))           return { bg: "var(--sa-green-soft)", fg: "var(--sa-green)" };
  if (a.startsWith("SELL") || a.startsWith("EXIT"))         return { bg: "#fee2e2", fg: "#b91c1c" };
  if (a.startsWith("TRIM"))                                 return { bg: "var(--sa-amber-soft)", fg: "var(--sa-amber)" };
  if (a.startsWith("HOLD"))                                 return { bg: "var(--sa-accent-soft)", fg: "var(--sa-accent-2)" };
  return { bg: "#f3f4f6", fg: "#374151" };
}

// Smart body renderer for advice/snapshot cards. Detects the "Signals per
// holding" pattern (2+ "**TICKER**:" markers) and renders each ticker as
// its own compact sub-card with a colored Call badge + bulletized prose.
// Falls back to plain markdown-bold prose for other cards.
// Split a **Call:** value into a compact badge label + a longer detail
// string. AI sometimes stuffs an entire sentence in there; we want the
// badge to fit on one line, so extract just the action verb + immediate
// price modifier and push the rest into the body bullets.
function splitCallText(full) {
  if (!full) return { label: null, detail: null };
  const trimmed = full.trim();
  // Try to capture: VERB (optional shares/qty) (optional price modifier)
  // e.g. "HOLD at $134", "TRIM 20%", "EXIT or TRIM to < 5% of book",
  //      "BUY 100 sh at $135", "SELL below $13", "ADD"
  const m = trimmed.match(/^((?:BUY|SELL|TRIM|HOLD|EXIT|ADD)(?:\s+or\s+(?:BUY|SELL|TRIM|HOLD|EXIT|ADD))?(?:\s+\d+(?:\s*%|\s*sh)?)?(?:\s+(?:at|near|to|below|above|by)\s+(?:<\s*|>\s*)?[\$\d.,]+\s*[A-Za-z%]*(?:\s+of\s+[a-z]+)?)?)\s*[.,]?\s*(.*)$/i);
  if (m) {
    return { label: m[1].trim(), detail: m[2] ? m[2].trim() : null };
  }
  // Fallback: take everything before the first comma/period as the label
  const splitIdx = trimmed.search(/[,.](?=\s|$)/);
  if (splitIdx > 0 && splitIdx < 40) {
    return { label: trimmed.slice(0, splitIdx).trim(), detail: trimmed.slice(splitIdx + 1).trim() || null };
  }
  // Last resort — truncate label, keep full text as detail
  return { label: trimmed.length > 40 ? trimmed.slice(0, 38) + "…" : trimmed, detail: trimmed.length > 40 ? trimmed : null };
}

// PriceWarningsBanner is intentionally hidden in the UI per user request —
// they want to receive perfect briefings, not error reports. The backend
// silently rewrites the briefing with verified prices when discrepancies
// are detected; for the card path we still attach the warnings array
// internally so we can log/regenerate, but we don't render anything.
function PriceWarningsBanner() {
  return null;
}

// Given a current price + a rec (with entry / stop), return a "zone status"
// used to color the rec block. Semantics reflect the swing-trader reality
// that a fill BELOW the recommended entry is BETTER (same thesis, cheaper
// basis, more room to the target) — it's what limit-buy-on-pullback
// discipline is designed to catch. Only chases ABOVE the entry are bad.
//
//   • "in-entry"       (green) — within ±2.5% of entry, above stop
//   • "pullback-entry" (green) — below entry-2.5%, above stop: BETTER fill,
//                                the thesis is intact
//   • "near-entry"     (amber) — 2.5-5% ABOVE entry, above stop: mild chase
//                                (below-entry side never lands here — that's
//                                pullback-entry green)
//   • "priced-out"     (red)   — >5% above entry: missed the entry, chase
//                                R:R is bad
//   • "stopped"        (red)   — at or below stop: thesis invalidated
//
// Pure function so both the freeform advice cards and the structured
// HighConviction/DailyPick cards apply the same rule.
function entryZoneStatus(currentPrice, rec) {
  if (currentPrice == null || !rec || !Number.isFinite(rec.entryPrice)) return null;
  const entry = rec.entryPrice;
  const stop = Number.isFinite(rec.stopPrice) ? rec.stopPrice : null;
  const price = currentPrice;
  if (stop != null && price <= stop) return "stopped";
  const distPct = ((price - entry) / entry) * 100;
  if (distPct > 5) return "priced-out";
  if (distPct > 2.5) return "near-entry";
  if (distPct >= -2.5) return "in-entry";
  // distPct < -2.5% AND above stop = pullback into value — good fill.
  return "pullback-entry";
}

// Palette for the zone status — used consistently everywhere. Pullback
// uses a richer green than mid-range in-entry so a scanning eye can
// tell them apart at a glance without reading the tag.
function zoneStyle(status) {
  if (status === "in-entry") return { bg: "#f0fdf4", border: "#86efac", accent: "#166534", tag: "IN ENTRY ZONE" };
  if (status === "pullback-entry") return { bg: "#dcfce7", border: "#4ade80", accent: "#14532d", tag: "PULLBACK — BETTER FILL" };
  if (status === "near-entry") return { bg: "#fefce8", border: "#fde68a", accent: "#a16207", tag: "NEAR ENTRY" };
  if (status === "priced-out") return { bg: "#fef2f2", border: "#fecaca", accent: "#991b1b", tag: "PRICED OUT" };
  if (status === "stopped") return { bg: "#fef2f2", border: "#fecaca", accent: "#991b1b", tag: "STOPPED OUT" };
  return null;
}

function renderAdviceBody(body, priceLookup = null, recLookup = null) {
  if (!body) return null;
  const text = String(body).trim();
  if (!text) return null;

  // Detect per-holding pattern
  const tickerRe = /\*\*([A-Z][A-Z0-9.\-]{0,9})\*\*:/g;
  const matches = [...text.matchAll(tickerRe)];
  if (matches.length >= 2) {
    const chunks = matches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      return { ticker: m[1], body: text.slice(start, end).trim() };
    });
    return (
      <div style={{ display: "grid", gap: 10, marginTop: 4, minWidth: 0 }}>
        {chunks.map((c, i) => {
          const callMatch = c.body.match(/\*\*Call:\s*([^*]+)\*\*\.?/i);
          const { label: actionLabel, detail: actionDetail } = splitCallText(callMatch ? callMatch[1] : null);
          const pal = actionPalette(actionLabel);
          const bodyClean = c.body.replace(/\*\*Call:[^*]+\*\*\.?\s*/i, "").trim();
          // Bullet list of sentences — prepend the action detail if any
          const sentences = bodyClean
            .split(/\s*\.\s+(?=[A-Z*\d])/)
            .map(s => s.replace(/\.+$/, "").trim())
            .filter(s => s.length > 3);
          const allSentences = actionDetail ? [actionDetail, ...sentences] : sentences;
          const px = priceLookup ? priceLookup(c.ticker) : null;
          const rec = recLookup ? recLookup(c.ticker) : null;
          const zone = entryZoneStatus(px?.price, rec);
          const zs = zoneStyle(zone);
          // Zone background wins over the neutral panel-2 when active. Left
          // border still comes from the action palette so BUY/SELL/HOLD
          // colour cues aren't lost.
          const blockBg = zs ? zs.bg : "var(--sa-panel-2)";
          const blockBorderColor = zs ? zs.border : (pal ? pal.fg : "var(--sa-border)");
          return (
            <div key={i} style={{ padding: "10px 14px", background: blockBg, borderRadius: 8, borderLeft: `3px solid ${blockBorderColor}`, minWidth: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--sa-text)" }}>{c.ticker}</span>
                {px && (
                  <span className="sa-amount" style={{ fontSize: 12, color: "var(--sa-text-2)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    ${px.price?.toFixed(2)} {px.currency || ""}
                  </span>
                )}
                {pal && actionLabel && (
                  <span style={{ background: pal.bg, color: pal.fg, padding: "2px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: ".04em" }}>
                    {actionLabel}
                  </span>
                )}
                {zs && (
                  <span style={{ background: zs.border, color: zs.accent, padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em" }}>
                    {zs.tag}
                  </span>
                )}
              </div>
              {rec && Number.isFinite(rec.entryPrice) && (() => {
                const roiPct = Number.isFinite(rec.targetPrice)
                  ? ((rec.targetPrice - rec.entryPrice) / rec.entryPrice) * 100 : null;
                const downsidePct = Number.isFinite(rec.stopPrice)
                  ? ((rec.stopPrice - rec.entryPrice) / rec.entryPrice) * 100 : null;
                const rr = (roiPct != null && downsidePct != null && downsidePct < 0)
                  ? Math.abs(roiPct / downsidePct) : null;
                // Compound-annualize the ROI so a 3.5% over 7d and a 3.5%
                // over 30d land on comparable scales. Formula assumes the
                // same setup is repeatable — sensible over a period, silly
                // if annualized numbers go to 4-digit % for 1-2d horizons.
                const h = Number.isFinite(rec.horizonDays) && rec.horizonDays > 0 ? rec.horizonDays : null;
                const annualized = (roiPct != null && h != null)
                  ? (Math.pow(1 + roiPct / 100, 365 / h) - 1) * 100 : null;
                const timingChip = (() => {
                  const t = rec.orderTiming;
                  if (!t) return null;
                  const styles = {
                    "pre-market":  { bg: "#fef3c7", fg: "#78350f", label: "pre-market" },
                    "at-open":     { bg: "#fee2e2", fg: "#7f1d1d", label: "at open (9:30)" },
                    "post-10am":   { bg: "#dcfce7", fg: "#14532d", label: "wait ≥10:00 ET" },
                    "gtc":         { bg: "#e0e7ff", fg: "#1e3a8a", label: "GTC" },
                  };
                  const s = styles[t] || { bg: "#e5e7eb", fg: "#111827", label: t };
                  return (
                    <span title="AI-suggested order timing (per market microstructure)" style={{ display: "inline-block", background: s.bg, color: s.fg, padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, marginLeft: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>
                      ⏱ {s.label}
                    </span>
                  );
                })();
                return (
                  <div style={{ fontSize: 11, color: "var(--sa-muted)", marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
                    entry ${rec.entryPrice.toFixed(2)}
                    {Number.isFinite(rec.targetPrice) && (
                      <> · target ${rec.targetPrice.toFixed(2)} <b style={{ color: "#166534" }}>({roiPct >= 0 ? "+" : ""}{roiPct.toFixed(1)}%{h ? ` over ${h}d` : ""})</b></>
                    )}
                    {Number.isFinite(rec.stopPrice) && (
                      <> · stop ${rec.stopPrice.toFixed(2)} <b style={{ color: "#991b1b" }}>({downsidePct.toFixed(1)}%)</b></>
                    )}
                    {rr != null && <> · R:R <b>1:{rr.toFixed(1)}</b></>}
                    {annualized != null && (
                      <> · <b style={{ color: "#166534" }}>ann. {annualized >= 0 ? "+" : ""}{annualized.toFixed(0)}%</b></>
                    )}
                    {timingChip}
                  </div>
                );
              })()}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: "var(--sa-text-2)", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                {allSentences.map((s, j) => (
                  <li key={j} style={{ marginBottom: 3 }}>{renderInlineBold(s)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback: plain paragraphs with bold markdown processed.
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  return (
    <div style={{ minWidth: 0 }}>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ margin: "0 0 8px 0", lineHeight: 1.6, wordBreak: "break-word", overflowWrap: "anywhere" }}>{renderInlineBold(p)}</p>
      ))}
    </div>
  );
}

function AdviceView({ user, onRefresh, sessionToken, autoFetchAi, onAutoFetchConsumed, onExecuteRec, executedRecKeys, recKey, onClearExecuted }) {
  // Per-ticker P/L (CAD) used to annotate each rec row with the position's
  // current performance. Recomputed when prices or basis change.
  const pnlMap = useMemo(() => pnlByTicker(user.positions, user.fxUsdCad || 1.37), [user.positions, user.fxUsdCad]);
  // Build a ticker → { price, currency } lookup from the user's positions
  // so per-ticker advice cards can display the current price next to the
  // ticker symbol. Uses the native trading currency of each position.
  // Live prices for held positions — used to color the rec block green
  // when the current price is inside the entry zone. Extended below by
  // fetchedPrices for tickers we don't hold (unowned recs).
  const heldPriceLookup = useMemo(() => {
    const m = {};
    for (const p of user.positions || []) {
      if (m[p.ticker]) continue;
      if (p.ccy === "USD" && p.priceUsd != null) m[p.ticker] = { price: p.priceUsd, currency: "USD" };
      else if (p.ccy === "CAD" && p.priceCad != null) m[p.ticker] = { price: p.priceCad, currency: "CAD" };
    }
    return m;
  }, [user.positions]);
  // Recent BUY recs keyed by ticker — for entry-zone coloring. Fetched
  // lazily when the Advice tab mounts and the snapshot/AI advice loads.
  const [recMap, setRecMap] = useState({});
  const [fetchedPriceMap, setFetchedPriceMap] = useState({});
  const priceLookup = useMemo(() => {
    return (ticker) => heldPriceLookup[ticker] || fetchedPriceMap[ticker] || null;
  }, [heldPriceLookup, fetchedPriceMap]);
  const recLookup = useMemo(() => {
    return (ticker) => recMap[ticker] || null;
  }, [recMap]);
  const [consensusBusy, setConsensusBusy] = useState(false);
  const [consensusData, setConsensusData] = useState(null); // { consensus, alternatives, sources }
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPhase, setAiPhase] = useState(null); // streaming progress phase
  const [aiAdvice, setAiAdvice] = useState(null); // { advice, sources, generatedAt }
  const [aiError, setAiError] = useState(null);
  // Briefing-derived snapshot — auto-loaded on Advice tab mount. Lets the
  // app surface the same content as the latest email briefing (cron or
  // on-demand) without spending a fresh Anthropic call.
  const [snapshotAdvice, setSnapshotAdvice] = useState(null); // { generatedAt, source, advice, markdown }
  // Persisted per-rec intent map (recIdStr → "executed" | "skipped").
  // Independent from the trade journal — this is what YOU said you meant
  // to do; the poller / trade journal record what actually happened.
  const [intentMap, setIntentMap] = useState({});
  const ruleAdvice = useMemo(() => generateAdvice(user), [user]);

  // Load user-stated intents on mount / when session changes. Silent on
  // failure — the toggles just render as "unmarked" if the fetch drops.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/rec-intents`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !Array.isArray(j.intents)) return;
        const m = {};
        for (const it of j.intents) m[String(it.recId)] = it.intent;
        setIntentMap(m);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // Set (or clear) an intent for a rec. Optimistically updates local
  // state, POSTs to backend, rolls back on error.
  const setIntent = async (recId, recType, nextIntent) => {
    if (!recId || !sessionToken) return;
    const prev = intentMap[recId] || null;
    setIntentMap(m => {
      const next = { ...m };
      if (nextIntent == null) delete next[recId];
      else next[recId] = nextIntent;
      return next;
    });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/rec-intent`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recId, recType, intent: nextIntent }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
    } catch (e) {
      // rollback — the visible checkbox flip reverting IS the error signal
      setIntentMap(m => {
        const next = { ...m };
        if (prev == null) delete next[recId];
        else next[recId] = prev;
        return next;
      });
      console.warn("[rec-intent] save failed:", e?.message);
    }
  };

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-advice/snapshot`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (r.status === 404) return; // no snapshot yet — fine
        if (!r.ok) return;
        const j = await r.json();
        // Defensive: ensure shape is { advice: [{title, body}], ... }.
        // If the server returns something unexpected, fall back to null so
        // the Advice tab uses the rule-based view instead of crashing.
        if (!cancelled && j && Array.isArray(j.advice)) {
          const safeAdvice = j.advice
            .filter(c => c && typeof c.title === "string")
            .map(c => ({
              title: String(c.title),
              body: typeof c.body === "string" ? c.body : "",
            }));
          setSnapshotAdvice({
            generatedAt: j.generatedAt || null,
            source: j.source || "cron",
            advice: safeAdvice,
            markdown: typeof j.markdown === "string" ? j.markdown : "",
          });
        }
      } catch (e) {
        // Swallow — rule-based fallback is still available and the user can
        // still click Update Advice for a fresh run.
        console.warn("[snapshot] load failed:", e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // Scrape all **TICKER**: mentions across every advice surface currently
  // rendered — snapshot cards, AI advice cards, consensus cards. Then batch
  // fetch: recent BUY recs (for entry/target/stop) + live prices (for tickers
  // we don't already hold). Both feed the entry-zone color coding.
  useEffect(() => {
    if (!sessionToken) return;
    const bodies = [];
    if (snapshotAdvice?.advice) for (const c of snapshotAdvice.advice) if (c.body) bodies.push(c.body);
    if (aiAdvice?.advice) for (const c of aiAdvice.advice) if (c.body) bodies.push(c.body);
    if (consensusData?.consensus) for (const c of consensusData.consensus) if (c.body) bodies.push(c.body);
    if (bodies.length === 0) return;
    const tickerRe = /\*\*([A-Z][A-Z0-9.\-]{0,9})\*\*:/g;
    const tickers = new Set();
    for (const b of bodies) {
      let m;
      while ((m = tickerRe.exec(b)) !== null) tickers.add(m[1]);
    }
    if (tickers.size === 0) return;
    const list = [...tickers];
    let cancelled = false;
    (async () => {
      // Recent open BUY recs (last 14 days) — matched by ticker.
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-advice/recs-for-tickers?tickers=${encodeURIComponent(list.join(","))}&hours=${14 * 24}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          const map = {};
          for (const rec of j.recs || []) {
            if (rec.action !== "BUY") continue;
            if (map[rec.ticker]) continue; // keep newest (list is sorted -generatedAt)
            map[rec.ticker] = { entryPrice: rec.entryPrice, targetPrice: rec.targetPrice, stopPrice: rec.stopPrice, currency: rec.entryCurrency };
          }
          if (!cancelled) setRecMap(map);
        }
      } catch { /* ignore */ }
      // Live prices for tickers we don't already hold (held ones use
      // heldPriceLookup). Uses the same public backend proxy as
      // refreshPrices — no auth required.
      const needPrices = list.filter((t) => !heldPriceLookup[t]);
      if (needPrices.length === 0) return;
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: needPrices }),
        });
        if (r.ok) {
          const j = await r.json();
          const priceMap = {};
          for (const [t, q] of Object.entries(j.prices || {})) {
            if (q?.price != null) priceMap[t] = { price: q.price, currency: q.currency || "USD" };
          }
          if (!cancelled) setFetchedPriceMap((prev) => ({ ...prev, ...priceMap }));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, snapshotAdvice, aiAdvice, consensusData, heldPriceLookup]);

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRefresh(); } finally { setBusy(false); }
  };

  // Update Advice — unified path (task #129 slice 2). Instead of hitting
  // the now-display-only POST /advice endpoint, this regenerates the
  // canonical daily briefing (POST /send-briefing?fresh=1) and refetches
  // the snapshot the Advice tab already renders from. Result: one voice
  // across surfaces. Every "Update Advice" click produces the same recs
  // the morning email would have shown, persisting through the briefing
  // pipeline that owns rec-storage.
  const handleAi = async () => {
    if (aiBusy) return;
    setAiBusy(true); setAiError(null); setAiPhase("thinking");
    try {
      await onRefresh();
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-briefing?fresh=1`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ send: false, fresh: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      // Refetch the snapshot the Advice tab renders from. saveAdviceSnapshot
      // ran inside the briefing pipeline, so the fresh markdown is already
      // on the server — just pull the new cards.
      const snapR = await fetch(`${BACKEND_URL}/api/stocks-advice/snapshot`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (snapR.ok) {
        const snap = await snapR.json();
        if (snap && Array.isArray(snap.advice)) {
          const safeAdvice = snap.advice
            .filter(c => c && typeof c.title === "string")
            .map(c => ({ title: String(c.title), body: typeof c.body === "string" ? c.body : "" }));
          setSnapshotAdvice({
            generatedAt: snap.generatedAt || null,
            source: snap.source || "on-demand",
            advice: safeAdvice,
            markdown: typeof snap.markdown === "string" ? snap.markdown : "",
          });
        }
      }
      // Clear any previously-shown fresh AI advice + consensus view since
      // the snapshot is now the single source of truth for display.
      setAiAdvice(null);
      setConsensusData(null);
      onClearExecuted?.();
    } catch (e) {
      setAiError(e?.message || "Failed");
    } finally {
      setAiBusy(false); setAiPhase(null);
    }
  };

  const handleConsensus = async () => {
    if (consensusBusy || aiBusy) return;
    setConsensusBusy(true); setAiError(null);
    try {
      await onRefresh();
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/consensus`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setConsensusData(j);
      setAiAdvice(null);
      onClearExecuted?.();
    } catch (e) {
      setAiError(e?.message || "Consensus failed");
    } finally {
      setConsensusBusy(false);
    }
  };

  // Auto-trigger AI fetch when arriving from the Dashboard button
  useEffect(() => {
    if (autoFetchAi) {
      onAutoFetchConsumed?.();
      handleAi();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetchAi]);

  // Display mode priority:
  //   1. fresh consensus (just ran 3×)
  //   2. fresh single AI run (just clicked Update Advice)
  //   3. briefing snapshot (auto-loaded — same content as latest email)
  //   4. rule-based fallback (always available, no API call)
  let shown, showingAi, showingConsensus = false, alternatives = null, showingSnapshot = false;
  if (consensusData) {
    shown = consensusData.consensus;
    alternatives = consensusData.alternatives || [];
    showingAi = true;
    showingConsensus = true;
  } else if (aiAdvice) {
    shown = aiAdvice.advice;
    showingAi = true;
  } else if (snapshotAdvice && snapshotAdvice.advice && snapshotAdvice.advice.length > 0) {
    shown = snapshotAdvice.advice;
    showingAi = true;
    showingSnapshot = true;
  } else {
    shown = ruleAdvice;
    showingAi = false;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <div>
          <h2>Advice</h2>
          <div className="sa-breadcrumb">
            {showingConsensus
              ? `🧠🧠🧠 Consensus across ${consensusData.runsSucceeded}/${consensusData.runs} runs · ${new Date(consensusData.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : aiAdvice
              ? `🧠 AI-generated · ${new Date(aiAdvice.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : showingSnapshot
              ? (() => {
                  // Defensive: snapshotAdvice may exist with weird/missing dates
                  const ts = snapshotAdvice?.generatedAt ? new Date(snapshotAdvice.generatedAt) : null;
                  const tsLabel = (ts && !isNaN(ts.getTime()))
                    ? ts.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "recently";
                  const src = snapshotAdvice?.source || "cron";
                  return `📬 From latest briefing email · ${tsLabel} (${src}) — click Update Advice for a fresh run`;
                })()
              : "Rule-based signals from your current portfolio"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="sa-btn secondary" onClick={handleRefresh} disabled={busy || aiBusy || consensusBusy} title="Re-fetch prices and re-run the rule engine">
            {busy ? "Refreshing…" : "↻ Refresh prices"}
          </button>
          {/* Update Advice — unified path (task #129 slice 2 + 4).
              Regenerates the canonical daily briefing and refreshes the
              Advice tab from its snapshot. Consensus branch retired: it
              produced a third independent rec stream that could disagree
              with the briefing AND the on-demand Advice output — three
              voices where one is enough. If the trader wants extra
              conviction, the briefing itself can be regenerated on the
              server with consensus mode ON via Settings, and the result
              still lands as a single snapshot the whole app reads. */}
          <button
            className="sa-btn"
            onClick={handleAi}
            disabled={aiBusy || busy}
            title="Regenerate the canonical daily briefing and refresh the Advice tab from it. Same recs that would appear in tomorrow's morning email."
          >
            {aiBusy ? (aiPhaseLabel(aiPhase) || "Regenerating briefing…") : "🧠 Update Advice"}
          </button>
        </div>
      </div>
      <div className="sa-disclaimer">⚠️ Research and education only. Not licensed investment advice. Decisions are yours.</div>
      {aiError && <div className="sa-err">{aiError}</div>}
      {showingAi && (
        <div style={{ marginBottom: 12, textAlign: "right" }}>
          <button className="sa-btn ghost" onClick={() => { setAiAdvice(null); setConsensusData(null); }}>Back to rule-based view</button>
        </div>
      )}
      {showingConsensus && !consensusData.degraded && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--sa-accent-soft)", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 12, color: "var(--sa-text-2)" }}>
          🧠🧠🧠 <b>Consensus mode</b> — recommendations shown below appeared in <b>at least 2 of {consensusData.runsSucceeded} independent generations</b>. Each card shows the run count. Lower-conviction ideas (appeared in only 1 run) are listed separately below.
        </div>
      )}
      {showingConsensus && consensusData.degraded && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--sa-amber-soft)", border: "1px solid #fde68a", borderRadius: 10, fontSize: 12, color: "var(--sa-amber)" }}>
          ⚠️ <b>Consensus degraded.</b> {consensusData.degradedReason || "Only 1 of 3 generations succeeded — showing single-run advice instead of consensus."} Click Update Advice again to retry.
        </div>
      )}
      {shown.map((c, i) => {
        const parsed = parseRecsFromBody(c.body, c.title);
        const hasRecs = parsed.recs.length > 0;
        // Propagate the card's recId down to each parsed rec so Execute
        // clicks know which DB row they're executing.
        if (c.recId) parsed.recs.forEach(r => { r.recId = c.recId; });
        return (
          <div key={i} className={`sa-advice-card ${c.sev === "danger" ? "danger" : c.sev === "warn" ? "warn" : c.sev === "good" ? "good" : ""}`}>
            <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>{c.title}</span>
              {showingConsensus && c.consensusCount && (
                <span style={{ background: c.consensusCount === c.totalRuns ? "var(--sa-green-soft)" : "var(--sa-accent-soft)", color: c.consensusCount === c.totalRuns ? "var(--sa-green)" : "var(--sa-accent-2)", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {c.consensusCount}/{c.totalRuns} runs
                </span>
              )}
            </h3>
            <PriceWarningsBanner warnings={c.priceWarnings} />
            {hasRecs ? (
              <>
                {parsed.intro && renderAdviceBody(parsed.intro, priceLookup, recLookup)}
                <RecsTable
                  recs={parsed.recs}
                  onExecuteRec={onExecuteRec}
                  executedRecKeys={executedRecKeys}
                  recKey={recKey}
                  pnlMap={pnlMap}
                  intentMap={intentMap}
                  onSetIntent={(rec, nextIntent) => setIntent(rec.recId, "advice", nextIntent)}
                />
                {parsed.outro && <p style={{ marginTop: 10, fontStyle: "italic", color: "var(--sa-text-2)" }}>{renderInlineBold(parsed.outro)}</p>}
              </>
            ) : (
              // No structured recs detected — render with the smart body
              // renderer: per-ticker mini-cards when the briefing emitted
              // "Signals per holding" content, otherwise prose with bold.
              renderAdviceBody(c.body, priceLookup, recLookup)
            )}
            {c.meta && <div className="meta">{c.meta}</div>}
          </div>
        );
      })}
      {showingConsensus && alternatives && alternatives.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--sa-text-2)", fontSize: 14, marginBottom: 10 }}>
            <span style={{ background: "var(--sa-amber-soft)", color: "var(--sa-amber)", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>1 of {consensusData.runsSucceeded}</span>
            Lower-conviction alternatives
          </h3>
          <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            These appeared in only one run — treat as "worth considering" ideas, not commitments.
          </div>
          {alternatives.map((c, i) => {
            const parsed = parseRecsFromBody(c.body, c.title);
            const hasRecs = parsed.recs.length > 0;
            if (c.recId) parsed.recs.forEach(r => { r.recId = c.recId; });
            return (
              <div key={`alt-${i}`} className={`sa-advice-card ${c.sev === "danger" ? "danger" : c.sev === "warn" ? "warn" : c.sev === "good" ? "good" : ""}`} style={{ opacity: 0.85 }}>
                <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span>{c.title}</span>
                  <span style={{ background: "var(--sa-amber-soft)", color: "var(--sa-amber)", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>1/{c.totalRuns} runs</span>
                </h3>
                <PriceWarningsBanner warnings={c.priceWarnings} />
                {hasRecs ? (
                  <>
                    {parsed.intro && renderAdviceBody(parsed.intro, priceLookup, recLookup)}
                    <RecsTable recs={parsed.recs} onExecuteRec={onExecuteRec} executedRecKeys={executedRecKeys} recKey={recKey} pnlMap={pnlMap} intentMap={intentMap} onSetIntent={(rec, nextIntent) => setIntent(rec.recId, "advice", nextIntent)} />
                    {parsed.outro && <p style={{ marginTop: 10, fontStyle: "italic", color: "var(--sa-text-2)" }}>{renderInlineBold(parsed.outro)}</p>}
                  </>
                ) : (
                  renderAdviceBody(c.body, priceLookup, recLookup)
                )}
                {c.meta && <div className="meta">{c.meta}</div>}
              </div>
            );
          })}
        </div>
      )}

      {showingConsensus && consensusData.sources?.length > 0 && (
        <div className="sa-card" style={{ marginTop: 14 }}>
          <h3>Sources (across all runs)</h3>
          <ul style={{ paddingLeft: 18, margin: 0, color: "var(--sa-text-2)", fontSize: 13, lineHeight: 1.7 }}>
            {consensusData.sources.slice(0, 20).map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--sa-accent-2)" }}>{s.title || s.url}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aiAdvice && !showingConsensus && aiAdvice.sources?.length > 0 && (
        <div className="sa-card" style={{ marginTop: 14 }}>
          <h3>Sources</h3>
          <ul style={{ paddingLeft: 18, margin: 0, color: "var(--sa-text-2)", fontSize: 13, lineHeight: 1.7 }}>
            {aiAdvice.sources.slice(0, 12).map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--sa-accent-2)" }}>
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// One row in the "Monthly reports & beneficiary agreements" card. Handles
// the monthly-report checkbox + the collapsible beneficiary-agreement editor.
// Encapsulates its own draft state so saving one row doesn't blow away
// in-progress edits on another row.
function AccountReportRow({ account, onToggleMonthly, onChangeCcEmail, onSaveAgreement }) {
  const ba = account.beneficiaryAgreement || {};
  const [ccEmail, setCcEmail] = useState(account.monthlyReportCcEmail || "");
  const ccValid = ccEmail === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccEmail.trim());
  const [open, setOpen] = useState(!!ba.enabled);
  const [enabled, setEnabled] = useState(!!ba.enabled);
  const [name, setName] = useState(ba.name || "");
  const [principal, setPrincipal] = useState(ba.principalCad || "");
  const [ratePct, setRatePct] = useState(ba.interestRatePct ?? "");
  const [sharePct, setSharePct] = useState(ba.profitSharePct ?? "");
  const [shareEndPct, setShareEndPct] = useState(ba.profitShareEndPct ?? "");
  const [shareRampYears, setShareRampYears] = useState(ba.profitShareRampYears ?? "");
  const [carry, setCarry] = useState(ba.carryLosses !== false);
  const [startDate, setStartDate] = useState(ba.startDate ? new Date(ba.startDate).toISOString().slice(0, 10) : "");
  const [principalStartDate, setPrincipalStartDate] = useState(ba.principalStartDate ? new Date(ba.principalStartDate).toISOString().slice(0, 10) : "");
  const [notes, setNotes] = useState(ba.notes || "");
  const [lockUntilDate, setLockUntilDate] = useState(ba.lockUntilDate ? new Date(ba.lockUntilDate).toISOString().slice(0, 10) : "");
  const [penaltyPct, setPenaltyPct] = useState(ba.earlyPayoutPenaltyPct ?? "");
  const [noticeMonths, setNoticeMonths] = useState(ba.redemptionNoticeMonths ?? "");
  const [installments, setInstallments] = useState(ba.payoutInstallments ?? "");
  const [installmentFrequency, setInstallmentFrequency] = useState(ba.payoutInstallmentFrequency || "quarterly");
  const [buyoutRight, setBuyoutRight] = useState(!!ba.accountHolderBuyoutRight);
  const [cpiPct, setCpiPct] = useState(ba.cpiAdjustmentPct ?? "");
  const [inflows, setInflows] = useState(
    Array.isArray(ba.inflows) && ba.inflows.length > 0
      ? ba.inflows.map((i) => ({
          description: i.description || "",
          amountCad: i.amountCad || 0,
          frequency: i.frequency || "monthly",
          startDate: i.startDate ? new Date(i.startDate).toISOString().slice(0, 10) : "",
          endDate: i.endDate ? new Date(i.endDate).toISOString().slice(0, 10) : "",
        }))
      : []
  );

  const addInflow = () => setInflows([...inflows, { description: "", amountCad: 0, frequency: "monthly", startDate: "", endDate: "" }]);
  const updateInflow = (i, patch) => setInflows(inflows.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeInflow = (i) => setInflows(inflows.filter((_, idx) => idx !== i));

  // Loans extended to the beneficiary (car loan, etc.) — separate from
  // inflows. Each loan tracks amortization (computed server-side for the
  // monthly report).
  const [loans, setLoans] = useState(
    Array.isArray(ba.loans) && ba.loans.length > 0
      ? ba.loans.map(l => ({
          id: l.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `loan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`),
          description: l.description || "Car loan",
          loanAmountCad: l.loanAmountCad || 0,
          interestRatePct: l.interestRatePct ?? 0,
          startDate: l.startDate ? new Date(l.startDate).toISOString().slice(0, 10) : "",
          termMonths: l.termMonths || 60,
          notes: l.notes || "",
        }))
      : []
  );
  const addLoan = () => setLoans([...loans, {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `loan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    description: "Car loan",
    loanAmountCad: 0,
    interestRatePct: 0,
    startDate: new Date().toISOString().slice(0, 10),
    termMonths: 60,
    notes: "",
  }]);
  const updateLoan = (i, patch) => setLoans(loans.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeLoan = (i) => setLoans(loans.filter((_, idx) => idx !== i));

  // Quick monthly-payment preview using standard amortization
  const previewPayment = (amount, rate, term) => {
    const P = parseFloat(amount) || 0;
    const r = (parseFloat(rate) || 0) / 100 / 12;
    const N = parseInt(term) || 0;
    if (P <= 0 || N <= 0) return null;
    if (r === 0) return P / N;
    return P * (r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1);
  };

  const save = () => {
    onSaveAgreement({
      enabled,
      name: name.trim(),
      principalCad: parseFloat(principal) || 0,
      interestRatePct: parseFloat(ratePct) || 0,
      profitSharePct: parseFloat(sharePct) || 0,
      profitShareEndPct: shareEndPct === "" ? null : (parseFloat(shareEndPct) || 0),
      profitShareRampYears: parseFloat(shareRampYears) || 0,
      carryLosses: !!carry,
      startDate: startDate ? new Date(startDate + "T12:00:00").toISOString() : null,
      principalStartDate: principalStartDate ? new Date(principalStartDate + "T12:00:00").toISOString() : null,
      inflows: inflows
        .filter((i) => i.description.trim() && parseFloat(i.amountCad) > 0)
        .map((i) => ({
          description: i.description.trim(),
          amountCad: parseFloat(i.amountCad) || 0,
          frequency: i.frequency === "yearly" ? "yearly" : "monthly",
          startDate: i.startDate ? new Date(i.startDate + "T12:00:00").toISOString() : null,
          endDate: i.endDate ? new Date(i.endDate + "T12:00:00").toISOString() : null,
        })),
      notes: notes.trim(),
      lockUntilDate: lockUntilDate ? new Date(lockUntilDate + "T12:00:00").toISOString() : null,
      earlyPayoutPenaltyPct: parseFloat(penaltyPct) || 0,
      redemptionNoticeMonths: parseInt(noticeMonths) || 0,
      payoutInstallments: parseInt(installments) || 1,
      payoutInstallmentFrequency: installmentFrequency,
      accountHolderBuyoutRight: !!buyoutRight,
      cpiAdjustmentPct: parseFloat(cpiPct) || 0,
      loans: loans
        .filter(l => (parseFloat(l.loanAmountCad) || 0) > 0 && l.startDate && (parseInt(l.termMonths) || 0) > 0)
        .map(l => ({
          id: l.id,
          description: (l.description || "Loan").trim().slice(0, 100),
          loanAmountCad: parseFloat(l.loanAmountCad) || 0,
          interestRatePct: parseFloat(l.interestRatePct) || 0,
          startDate: new Date(l.startDate + "T12:00:00").toISOString(),
          termMonths: parseInt(l.termMonths) || 0,
          notes: (l.notes || "").trim().slice(0, 500),
        })),
    });
  };

  // Live preview of expected total inflows/yr
  const annualInflows = inflows.reduce((sum, i) => {
    const amt = parseFloat(i.amountCad) || 0;
    return sum + (i.frequency === "yearly" ? amt : amt * 12);
  }, 0);

  return (
    <div style={{ border: "1px solid var(--sa-border)", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{account.name}</div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={!!account.monthlyReportEnabled}
            onChange={(e) => onToggleMonthly(e.target.checked)}
          />
          Monthly report
        </label>
        <button className="sa-btn ghost" onClick={() => setOpen(!open)} style={{ fontSize: 12 }}>
          {open ? "Hide" : "Edit"} beneficiary agreement {ba.enabled ? "✓" : ""}
        </button>
      </div>

      {/* Optional extra recipient — only meaningful when monthly report is on.
          Sent a dedicated single-account email so they don't see other accts. */}
      {account.monthlyReportEnabled && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--sa-border)", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--sa-muted)", whiteSpace: "nowrap" }}>Also email to (optional):</span>
          <input
            type="email"
            value={ccEmail}
            onChange={(e) => setCcEmail(e.target.value)}
            onBlur={() => {
              if (ccValid && ccEmail !== (account.monthlyReportCcEmail || "")) {
                onChangeCcEmail(ccEmail.trim().toLowerCase());
              }
            }}
            placeholder="e.g. tamara@example.com — leave blank for owner-only"
            style={{ width: "100%", fontSize: 13, borderColor: ccValid ? undefined : "var(--sa-red)" }}
          />
          <span className="sa-muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
            {!ccValid ? "✗ invalid email"
              : account.monthlyReportCcEmail ? "✓ saved"
              : "—"}
          </span>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--sa-border)" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span><b>Enable beneficiary agreement</b> — capital in this account is held for someone else under specific terms</span>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label>Beneficiary name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tamara" maxLength={80} />
            </div>
            <div>
              <label>Agreement start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>Default start for inflows (overridable per inflow below).</div>
            </div>
            <div>
              <label>Principal placement date (optional)</label>
              <input type="date" value={principalStartDate} onChange={(e) => setPrincipalStartDate(e.target.value)} />
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>When the principal is/was actually placed. Interest accrues only from this date. Defaults to agreement start.</div>
            </div>
            <div>
              <label>Principal owed (CAD)</label>
              <input type="number" min="0" step="any" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="e.g. 50000" />
            </div>
            <div>
              <label>Annual interest rate (%)</label>
              <input type="number" min="0" max="100" step="any" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="e.g. 3" />
            </div>
            <div>
              <label>Profit share — starting (%)</label>
              <input type="number" min="0" max="100" step="any" value={sharePct} onChange={(e) => setSharePct(e.target.value)} placeholder="e.g. 30" />
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>Share of positive profit at agreement start. Ramps to End below over Ramp Years.</div>
            </div>
            <div style={{ display: "flex", alignItems: "end", paddingBottom: 8 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
                I absorb losses (beneficiary protected on the principal)
              </label>
            </div>
          </div>

          {/* Profit-share ramp — rewards patience instead of penalizing early withdrawal */}
          <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--sa-accent-soft)", border: "1px solid #bfdbfe", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Profit-share ramp (incentive instead of penalty)</div>
            <div className="sa-muted" style={{ fontSize: 11, marginBottom: 8 }}>
              Set an end % and a ramp duration to make the profit-share grow over time. e.g., start 30% → end 50% over 5 years means: cash out year 1 → 34% share, year 5+ → full 50%. Leave End blank to keep a flat share (legacy behavior).
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label>End share (%)</label>
                <input type="number" min="0" max="100" step="any" value={shareEndPct} onChange={(e) => setShareEndPct(e.target.value)} placeholder="e.g. 50 (blank = no ramp)" />
              </div>
              <div>
                <label>Ramp years</label>
                <input type="number" min="0" max="50" step="0.5" value={shareRampYears} onChange={(e) => setShareRampYears(e.target.value)} placeholder="e.g. 5" />
              </div>
            </div>
            {sharePct !== "" && shareEndPct !== "" && shareRampYears !== "" && parseFloat(shareRampYears) > 0 && (
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 8 }}>
                Preview: {parseFloat(sharePct)}% at agreement start → linearly to {parseFloat(shareEndPct)}% after {parseFloat(shareRampYears)} years → capped thereafter.
                {parseFloat(shareRampYears) > 0 && ` (Per-year step: +${((parseFloat(shareEndPct) - parseFloat(sharePct)) / parseFloat(shareRampYears)).toFixed(2)}%/yr)`}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--sa-border)" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Structural protections (recommended)</div>
            <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>
              These mechanisms handle the same risks as an early-payout penalty (forced liquidation, tax-bracket spikes, retirement-income disruption) but more fairly. Notice + installments + buyout right + CPI together usually make the binary penalty unnecessary.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label>Redemption notice (months)</label>
                <input type="number" min="0" max="60" step="1" value={noticeMonths} onChange={(e) => setNoticeMonths(e.target.value)} placeholder="e.g. 12" />
                <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>Advance written notice required before redemption.</div>
              </div>
              <div>
                <label># of installments</label>
                <input type="number" min="1" max="40" step="1" value={installments} onChange={(e) => setInstallments(e.target.value)} placeholder="e.g. 4" />
                <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>1 = lump sum. 4 quarterly = year-long stretch.</div>
              </div>
              <div>
                <label>Installment frequency</label>
                <select value={installmentFrequency} onChange={(e) => setInstallmentFrequency(e.target.value)}>
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="yearly">yearly</option>
                </select>
              </div>
              <div>
                <label>CPI adjustment (%/yr)</label>
                <input type="number" min="0" max="20" step="0.1" value={cpiPct} onChange={(e) => setCpiPct(e.target.value)} placeholder="e.g. 2.5" />
                <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>Compounds annually to preserve real principal value.</div>
              </div>
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 12 }}>
              <input type="checkbox" checked={buyoutRight} onChange={(e) => setBuyoutRight(e.target.checked)} />
              <span><b>Account-holder buyout right</b> — I may settle the agreement at any time at my convenience, with no penalty to the beneficiary</span>
            </label>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--sa-border)" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "var(--sa-muted)" }}>Early-payout penalty <span style={{ fontSize: 11, fontWeight: 400 }}>(legacy — leave at 0 if using structural protections above)</span></div>
            <div className="sa-muted" style={{ fontSize: 11, marginBottom: 10 }}>
              Binary penalty: if cashed out before the lock-until date, deduct % of the greater of (profit share) or (principal). Recommended only if the structural protections aren't enough for your situation.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label>Lock until date</label>
                <input type="date" value={lockUntilDate} onChange={(e) => setLockUntilDate(e.target.value)} />
              </div>
              <div>
                <label>Penalty (%)</label>
                <input type="number" min="0" max="100" step="any" value={penaltyPct} onChange={(e) => setPenaltyPct(e.target.value)} placeholder="0 = disabled" />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Inflows from beneficiary</div>
              <button className="sa-btn ghost" onClick={addInflow} style={{ fontSize: 12 }}>+ Add inflow</button>
            </div>
            <div className="sa-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              What the beneficiary pays you on a recurring basis (car insurance, room & board, phone, etc.). Used to compute net carry.
            </div>
            {inflows.length === 0 && (
              <div className="sa-muted" style={{ fontSize: 12, paddingBottom: 8 }}>No inflows yet.</div>
            )}
            {inflows.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 130px 130px auto", gap: 8, marginBottom: 4, fontSize: 11, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                <span>Description</span><span>Amount (CAD)</span><span>Frequency</span><span>From</span><span>To (if ended)</span><span></span>
              </div>
            )}
            {inflows.map((i, idx) => {
              const ended = i.endDate && new Date(i.endDate) < new Date();
              return (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 130px 130px auto", gap: 8, marginBottom: 6, opacity: ended ? 0.6 : 1 }}>
                  <input value={i.description} onChange={(e) => updateInflow(idx, { description: e.target.value })} placeholder="e.g. Car insurance" maxLength={100} />
                  <input type="number" min="0" step="any" value={i.amountCad} onChange={(e) => updateInflow(idx, { amountCad: e.target.value })} placeholder="CAD" />
                  <select value={i.frequency} onChange={(e) => updateInflow(idx, { frequency: e.target.value })}>
                    <option value="monthly">per month</option>
                    <option value="yearly">per year</option>
                  </select>
                  <input type="date" value={i.startDate || ""} onChange={(e) => updateInflow(idx, { startDate: e.target.value })} title="When this inflow began (optional — defaults to agreement start)" />
                  <input type="date" value={i.endDate || ""} onChange={(e) => updateInflow(idx, { endDate: e.target.value })} title="When this inflow stopped (optional — leave blank if still ongoing)" />
                  <button className="sa-btn ghost" onClick={() => removeInflow(idx)} style={{ fontSize: 12 }} title="Remove this inflow row entirely. To stop accrual on a past date but keep the historical record, set the To date instead.">✕</button>
                </div>
              );
            })}
            {inflows.length > 0 && (
              <div className="sa-muted" style={{ fontSize: 12, marginTop: 6 }}>
                Total expected inflow: ≈ <b>${annualInflows.toLocaleString()}</b>/year
              </div>
            )}
          </div>

          {/* Loans extended to beneficiary — amortizing car loan, etc. */}
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--sa-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Loans extended to beneficiary</label>
              <button className="sa-btn ghost" onClick={addLoan} style={{ fontSize: 12 }}>+ Add loan</button>
            </div>
            <div className="sa-muted" style={{ fontSize: 11, marginBottom: 8 }}>
              Track loans (car, etc.) you've given the beneficiary. Monthly payment is auto-computed; the report shows balance, interest paid, and months remaining.
            </div>
            {loans.length === 0 && (
              <div className="sa-muted" style={{ fontSize: 12 }}>No loans tracked.</div>
            )}
            {loans.map((l, idx) => {
              const monthly = previewPayment(l.loanAmountCad, l.interestRatePct, l.termMonths);
              return (
                <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 0.8fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: 11 }}>Description</label>
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) => updateLoan(idx, { description: e.target.value })}
                      placeholder="Car loan"
                      style={{ width: "100%", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Loan amount (CAD)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={l.loanAmountCad}
                      onChange={(e) => updateLoan(idx, { loanAmountCad: e.target.value })}
                      placeholder="e.g. 25000"
                      style={{ width: "100%", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Rate %/yr</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={l.interestRatePct}
                      onChange={(e) => updateLoan(idx, { interestRatePct: e.target.value })}
                      placeholder="e.g. 5.5"
                      style={{ width: "100%", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Term (months)</label>
                    <input
                      type="number"
                      min="1"
                      max="600"
                      step="1"
                      value={l.termMonths}
                      onChange={(e) => updateLoan(idx, { termMonths: e.target.value })}
                      placeholder="60"
                      style={{ width: "100%", fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Start date</label>
                    <input
                      type="date"
                      value={l.startDate || ""}
                      onChange={(e) => updateLoan(idx, { startDate: e.target.value })}
                      style={{ width: "100%", fontSize: 13 }}
                    />
                  </div>
                  <button
                    className="sa-btn ghost"
                    onClick={() => removeLoan(idx)}
                    style={{ fontSize: 12 }}
                    title="Remove this loan"
                  >✕</button>
                  {monthly && (
                    <div className="sa-muted" style={{ gridColumn: "1 / -1", fontSize: 11, marginTop: -4 }}>
                      → Monthly payment ≈ <b>${monthly.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> over {l.termMonths || 0} months · total interest ≈ <b>${((monthly * (parseInt(l.termMonths) || 0)) - (parseFloat(l.loanAmountCad) || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Free-form context the AI should know about this agreement."
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button className="sa-btn" onClick={save}>Save agreement</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Settings card for daily briefing send schedule. Up to 4 HH:MM times in
// the user's chosen timezone. Empty list = briefings disabled for this user.
function BriefingScheduleCard({ times = [], tz = "America/New_York", onChangeTimes, onChangeTz }) {
  const [draft, setDraft] = useState("");
  const safeTimes = Array.isArray(times) ? times : [];

  const addTime = () => {
    const t = String(draft || "").trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) return;
    const [h, m] = t.split(":");
    const norm = `${h.padStart(2, "0")}:${m}`;
    if (safeTimes.includes(norm)) { setDraft(""); return; }
    if (safeTimes.length >= 4) return;
    const next = [...safeTimes, norm].sort();
    onChangeTimes && onChangeTimes(next);
    setDraft("");
  };

  const removeTime = (t) => {
    onChangeTimes && onChangeTimes(safeTimes.filter(x => x !== t));
  };

  // Common timezones — keep this short; user can paste a custom IANA name.
  const tzOptions = [
    "America/New_York", "America/Toronto", "America/Vancouver",
    "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney",
  ];

  return (
    <div className="sa-card" style={{ marginBottom: 14 }}>
      <h3>Email briefing schedule</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Set up to <b>4</b> times per day to receive the briefing by email. Times are in your selected timezone. Leave empty to disable scheduled briefings (you can still use <b>Send briefing now</b> manually).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label>Timezone</label>
          <select value={tz} onChange={(e) => onChangeTz && onChangeTz(e.target.value)}>
            {tzOptions.includes(tz) ? null : <option value={tz}>{tz}</option>}
            {tzOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label>Add a time (24h, e.g. 07:30)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="time"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={safeTimes.length >= 4}
              style={{ flex: 1 }}
            />
            <button
              className="sa-btn secondary"
              onClick={addTime}
              disabled={safeTimes.length >= 4 || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(draft || "")}
              style={{ fontSize: 12 }}
            >Add</button>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {safeTimes.length === 0 ? (
          <div className="sa-muted" style={{ fontSize: 12 }}>No times scheduled — briefings disabled.</div>
        ) : safeTimes.map(t => (
          <div key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--sa-panel-2)", borderRadius: 20, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{t}</span>
            <button
              className="sa-btn ghost"
              onClick={() => removeTime(t)}
              style={{ fontSize: 11, padding: "0 6px" }}
              title="Remove this time"
            >✕</button>
          </div>
        ))}
      </div>
      {safeTimes.length >= 4 && (
        <div className="sa-muted" style={{ fontSize: 11, marginTop: 8 }}>Maximum 4 times reached. Remove one to add another.</div>
      )}
    </div>
  );
}

// Settings card for the Gmail-inbox integration used by the broker-alert
// poller (Phase 2). Displays connection status when configured, and a
// form to set/rotate the app password when not. The app password is
// masked and never round-trips to the client after save.
// One row in the "needs manual review" panel: shows the trade summary,
// current holders of the ticker, and lets the user pick an account
// from a dropdown to resolve the row. Clicking Resolve fires the
// server-side resolve endpoint which updates + applies positions.
function PendingReviewRow({ row, allAccounts, onResolve }) {
  const leg = row.leg;
  // Default the picker to the account with the most matching shares
  // (typically the right one for a SELL). Falls back to the first
  // holder, then any account, then empty.
  const preferred = (row.holdersOfTicker || [])
    .slice()
    .sort((a, b) => b.qty - a.qty)[0];
  const [pickedAcct, setPickedAcct] = React.useState(preferred?.acctId || allAccounts?.[0]?.id || "");
  const [resolving, setResolving] = React.useState(false);
  const submit = async () => {
    if (!pickedAcct) return;
    setResolving(true);
    try { await onResolve(pickedAcct); }
    finally { setResolving(false); }
  };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 200px 120px", gap: 10,
      alignItems: "center", padding: "8px 10px", background: "#fff",
      border: "1px solid #fecaca", borderRadius: 6,
    }}>
      <div>
        <div style={{ fontWeight: 600 }}>
          {leg.side} {leg.shares} {leg.ticker} @ ${leg.pricePerShare?.toFixed?.(2)} {leg.currency}
        </div>
        <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 2 }}>
          {new Date(row.executedAt).toLocaleDateString()} · {row.reason || "no reason recorded"}
        </div>
        {row.holdersOfTicker?.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 3 }}>
            Currently held: {row.holdersOfTicker.map(h => `${h.name}=${h.qty}`).join(" · ")}
          </div>
        )}
      </div>
      <select value={pickedAcct} onChange={(e) => setPickedAcct(e.target.value)} style={{ width: "100%" }}>
        {(allAccounts || []).map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{(row.holdersOfTicker || []).find(h => h.acctId === a.id) ? " ✓" : ""}
          </option>
        ))}
      </select>
      <button className="sa-btn" onClick={submit} disabled={resolving || !pickedAcct} style={{ padding: "8px 12px", fontSize: 12 }}>
        {resolving ? "Applying…" : "Resolve"}
      </button>
    </div>
  );
}

function EmailIntegrationCard({ sessionToken }) {
  const [state, setState] = useState({ loading: true });
  const [mailboxAddress, setMailboxAddress] = useState("rgsommer.junk@gmail.com");
  const [appPassword, setAppPassword] = useState("");
  const [imapQuery, setImapQuery] = useState("from:alerts@cibc.com newer_than:30d");
  const [banner, setBanner] = useState(null); // { kind: "ok"|"err", msg }
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    if (!sessionToken) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setState({ loading: false, ...j });
      if (j.configured) {
        setMailboxAddress(j.mailboxAddress || "");
        setImapQuery(j.imapSearchQuery || "from:alerts@cibc.com newer_than:30d");
      }
    } catch (e) {
      setState({ loading: false, configured: false, encryptionReady: false });
      setBanner({ kind: "err", msg: `Couldn't load status: ${e?.message || "network"}` });
    }
  };
  useEffect(() => { load(); }, [sessionToken]);

  const save = async () => {
    setBanner(null);
    setSaving(true);
    try {
      const body = { mailboxAddress: mailboxAddress.trim(), imapSearchQuery: imapQuery.trim() };
      if (appPassword.trim()) body.appPassword = appPassword.trim();
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setAppPassword("");
      setEditing(false);
      setBanner({ kind: "ok", msg: j.created ? "Saved. Poller build (Phase 2B) will pick this up." : "Updated." });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Save failed" });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setBanner(null);
    setTesting(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/test`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setBanner({ kind: "ok", msg: j.message });
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Test failed" });
    } finally { setTesting(false); }
  };

  // Reconstruct-from-journal audit state.
  const [reconstruct, setReconstruct] = useState(null);
  const [reconstructLoading, setReconstructLoading] = useState(false);
  const showReconstruct = async () => {
    setReconstructLoading(true);
    setReconstruct(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/reconstruct-audit`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setReconstruct(j);
    } catch (e) {
      setBanner({ kind: "err", msg: `Reconstruct failed: ${e?.message || "unknown"}` });
    } finally { setReconstructLoading(false); }
  };

  // Duplicate-journal audit state — populated by GET /journal-audit
  // and consumed by the audit expand section. Selection is a Set of
  // trade _ids the user has ticked for deletion.
  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSelected, setAuditSelected] = useState(new Set());
  const [deletingDupes, setDeletingDupes] = useState(false);
  const showAudit = async () => {
    setAuditLoading(true);
    setAudit(null);
    setAuditSelected(new Set());
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/journal-audit?days=90`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setAudit(j);
    } catch (e) {
      setBanner({ kind: "err", msg: `Audit failed: ${e?.message || "unknown"}` });
    } finally { setAuditLoading(false); }
  };
  const deleteSelectedDuplicates = async () => {
    const ids = [...auditSelected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} trade${ids.length === 1 ? "" : "s"} and REVERSE their position + cash mutations?\n\nThis is irreversible. The affected positions should snap back to what they'd be without those trades. Continue?`)) return;
    setDeletingDupes(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/journal-audit/delete`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tradeIds: ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setBanner({ kind: j.failed > 0 ? "err" : "ok", msg: `Duplicates deleted: ${j.succeeded} ok${j.failed > 0 ? `, ${j.failed} failed (over-sell on reversal — leave those alone)` : ""}` });
      // Re-run audit + reload profile so positions reflect the changes.
      await showAudit();
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Delete failed: ${e?.message || "unknown"}` });
    } finally { setDeletingDupes(false); }
  };

  // Read-only journal snapshot — hits backfill in dry-run so the user
  // can see, at a glance, how many poller trades are stuck and why
  // without having to run an actual apply.
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const showJournalState = async () => {
    setSnapshotting(true);
    setSnapshot(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/backfill-positions?dryRun=1`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setSnapshot(j);
    } catch (e) {
      setBanner({ kind: "err", msg: `Snapshot failed: ${e?.message || "unknown"}` });
    } finally { setSnapshotting(false); }
  };

  const [backfilling, setBackfilling] = useState(false);
  const backfillPositions = async () => {
    if (!window.confirm("Retroactively apply positions + cash for any poller-reconciled trades that were journalled BEFORE the position-update fix landed. Skip trades that fail (e.g. over-sell against current portfolio). Continue?")) return;
    setBanner(null);
    setBackfilling(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/backfill-positions`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      let msg;
      if (j.appliedCount === 0 && j.failedCount === 0) {
        const d = j.diagnostic;
        if (d) {
          msg = `${d.interpretation} · Journal: ${d.totalInJournal} total · ${d.cibcEmailTrades} poller-sourced (${d.cibcEmailAlreadyApplied} already applied, ${d.cibcEmailAutoStillUnapplied} auto/unapplied, ${d.cibcEmailNeedsReview} needs-review) · ${d.tradesWithNoBrokerSource} manual`;
        } else {
          msg = "No trades needed backfill — nothing to apply.";
        }
      } else {
        msg = `Backfill: ${j.appliedCount} applied · ${j.failedCount} failed${j.failedCount ? " (see server logs — likely over-sell against current holdings)" : ""}`;
      }
      setBanner({ kind: j.failedCount > 0 ? "err" : "ok", msg });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Backfill failed" });
    } finally { setBackfilling(false); }
  };

  // Needs-review list for the inline resolution panel.
  const [pendingReview, setPendingReview] = useState({ loading: false, rows: [], allAccounts: [] });
  const loadPendingReview = async () => {
    if (!sessionToken) return;
    setPendingReview(p => ({ ...p, loading: true }));
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/pending-review`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setPendingReview({
        loading: false,
        rows: Array.isArray(j.rows) ? j.rows : [],
        allAccounts: Array.isArray(j.allAccounts) ? j.allAccounts : [],
      });
    } catch { setPendingReview(p => ({ ...p, loading: false })); }
  };
  useEffect(() => { if (state?.configured) loadPendingReview(); }, [state?.configured, sessionToken]);

  const resolveTrade = async (tradeId, accountId) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/resolve-trade`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, accountId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setBanner({ kind: "ok", msg: `Resolved: applied to ${j.account}. Positions + cash updated.` });
      await loadPendingReview();
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Resolve failed: ${e?.message || "unknown"}` });
    }
  };

  const [retrying, setRetrying] = useState(false);
  const retryNeedsReview = async () => {
    if (!window.confirm("Re-run the reconciler over every needs-review poller trade using the current (improved) account-inference logic. Trades that now resolve to 'auto' get positions + cash applied; the rest stay needs-review with an updated reason. Continue?")) return;
    setBanner(null);
    setRetrying(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/retry-needs-review`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      let msg = `Retry complete — ${j.promotedCount || 0} promoted (positions applied) · ${j.stillReviewCount || 0} still need review · ${j.failedCount || 0} failed`;
      if (j.promoted?.length > 0) {
        msg += `\nPromoted:\n${j.promoted.slice(0, 6).map(p => `  · ${p.side} ${p.shares} ${p.ticker} → ${p.account}`).join("\n")}`;
      }
      if (j.stillReview?.length > 0) {
        msg += `\nStill need review:\n${j.stillReview.map(p => `  · ${p.ticker} — ${p.reason}`).join("\n")}`;
      }
      setBanner({ kind: j.failedCount > 0 ? "err" : "ok", msg });
      await load();
      await loadPendingReview();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Retry failed" });
    } finally { setRetrying(false); }
  };

  const [rescanning, setRescanning] = useState(false);
  const rescanMailbox = async () => {
    if (!window.confirm("Reset the mailbox scan pointer and re-poll from the earliest matching message. Uses the same dedup key as normal polls, so it cannot double-insert anything. Use this when the Test connection button reports matching messages but Poll now finds 0.")) return;
    setBanner(null);
    setRescanning(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/rescan-mailbox`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      let msg = buildRescanBannerMessage(j);
      // Settings page keeps the extra per-row detail — useful for
      // debugging parser edge-cases when you're actively iterating on
      // the mailbox filter.
      const skippedRows = (j.details?.skipped || []).slice(0, 10);
      if (skippedRows.length > 0) {
        const lines = skippedRows.map(s => `  · ${s.reason} · "${(s.subject || "(no subject)").slice(0, 80)}"${s.from ? ` — from ${s.from}` : ""}`);
        msg += `\nSkipped detail:\n${lines.join("\n")}`;
      }
      setBanner({ kind: j.fatal ? "err" : "ok", msg });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Rescan failed" });
    } finally { setRescanning(false); }
  };

  const [pollingNow, setPollingNow] = useState(false);
  const pollNow = async () => {
    setBanner(null);
    setPollingNow(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/poll-now`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      const parts = [];
      if (Number.isFinite(j.inserted)) parts.push(`${j.inserted} inserted`);
      if (Number.isFinite(j.skipped)) parts.push(`${j.skipped} skipped`);
      if (Number.isFinite(j.errors)) parts.push(`${j.errors} errors`);
      if (j.fatal) parts.push(`fatal: ${j.fatal}`);
      if (j.skipped && typeof j.skipped === "string") parts.push(`(${j.skipped})`);
      // If ANYTHING was skipped, surface subject + reason inline so the user
      // can tell whether the skip is real (missed CIBC alert) or expected
      // (dividend deposit notice, statement notification — same sender,
      // wrong body format for parser).
      const skippedRows = (j.details?.skipped || []).slice(0, 10);
      let msg = `Poll complete — ${parts.join(" · ") || "no changes"}`;
      if (skippedRows.length > 0) {
        const lines = skippedRows.map(s => `  · ${s.reason} · "${(s.subject || "(no subject)").slice(0, 80)}"${s.from ? ` — from ${s.from}` : ""}`);
        msg += `\nSkipped detail:\n${lines.join("\n")}`;
      }
      setBanner({ kind: j.fatal ? "err" : "ok", msg });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Poll failed" });
    } finally { setPollingNow(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the email integration? Stored credentials are deleted.")) return;
    setBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration`, {
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setAppPassword("");
      setEditing(false);
      setBanner({ kind: "ok", msg: "Integration removed." });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: e?.message || "Disconnect failed" });
    }
  };

  const showForm = !state.configured || editing;

  return (
    <div className="sa-card" style={{ marginBottom: 14 }}>
      <h3>Broker-alert email integration <span className="sa-muted" style={{ fontSize: 11, fontWeight: 500, marginLeft: 6 }}>(polls every 15 min)</span></h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.55 }}>
        Points the reconciler at the Gmail inbox where CIBC forwards trade confirmations. On each poll, matching messages are parsed, linked to the corresponding rec, and inserted into the trade journal — independently from the &quot;Executed&quot; checkboxes. The app password is stored AES-256-GCM encrypted, decryption key server-side only.
      </div>

      {!state.loading && state.encryptionReady === false && (
        <div style={{ padding: "8px 12px", background: "#fef3c7", color: "#78350f", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
          ⚠ Server encryption key (STOCKS_INTEGRATION_KEY) not set. Ask the deploy owner to generate one and add it to the Render env, otherwise saves will 503.
        </div>
      )}

      {banner && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 12,
          background: banner.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color: banner.kind === "ok" ? "#14532d" : "#7f1d1d",
          border: `1px solid ${banner.kind === "ok" ? "#86efac" : "#fca5a5"}`,
          whiteSpace: "pre-wrap", // preserve newlines so multi-line skip detail wraps correctly
          fontFamily: banner.msg?.includes("\n") ? "ui-monospace, Menlo, monospace" : "inherit",
        }}>{banner.msg}</div>
      )}

      {state.loading ? (
        <div className="sa-muted" style={{ fontSize: 12 }}>Loading integration status…</div>
      ) : state.configured && !editing ? (
        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <div><b>Mailbox:</b> <code>{state.mailboxAddress}</code></div>
          <div><b>App password:</b> <span style={{ fontFamily: "monospace" }}>{state.passwordMask}</span></div>
          <div><b>Filter:</b> <code>{state.imapSearchQuery}</code></div>
          <div><b>Endpoint:</b> <code>{state.imapHost || "imap.gmail.com"}:{state.imapPort || 993}</code> (TLS)</div>
          <div><b>Status:</b>{" "}
            {state.enabled === false ? <span style={{ color: "#78350f" }}>paused</span>
              : state.lastPolledAt ? (
                state.lastPollSucceeded
                  ? <span style={{ color: "#14532d" }}>last poll ✓ {new Date(state.lastPolledAt).toLocaleString()}</span>
                  : <span style={{ color: "#7f1d1d" }}>last poll ✗ {state.lastPollError || "unknown error"}</span>
              ) : <span className="sa-muted">never polled — poller ships in Phase 2B</span>}
          </div>
          <div><b>Reconciled trades:</b> {state.reconciledCount || 0} since {state.configuredAt ? new Date(state.configuredAt).toLocaleDateString() : "setup"}</div>
          {state.pollerHeartbeat && (() => {
            const hb = state.pollerHeartbeat.lastTickAt ? new Date(state.pollerHeartbeat.lastTickAt) : null;
            const ageMin = hb ? Math.round((Date.now() - hb.getTime()) / 60000) : null;
            const stale = ageMin != null && ageMin > 30;
            return (
              <div style={{ fontSize: 12 }}>
                <b>Cron heartbeat:</b>{" "}
                {hb ? (
                  <span style={{ color: stale ? "#7f1d1d" : "#14532d" }}>
                    last */15 tick fired {hb.toLocaleString()} ({ageMin} min ago{stale ? " — STALE, likely the dyno was asleep at the scheduled minute" : ""})
                  </span>
                ) : (
                  <span style={{ color: "#78350f" }}>no tick recorded yet — cron may not be running (STOCKS_BRIEFING_ENABLED=1?)</span>
                )}
              </div>
            );
          })()}
          {Array.isArray(state.recentTrades) && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: state.recentTrades.length === 0 ? "#fef3c7" : "#f1f5f9", border: `1px solid ${state.recentTrades.length === 0 ? "#fde68a" : "#e2e8f0"}`, borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {state.recentTrades.length === 0
                  ? "⚠ No trades ingested from the poller yet"
                  : `Last ${state.recentTrades.length} poller-ingested trade${state.recentTrades.length === 1 ? "" : "s"}:`}
              </div>
              {state.recentTrades.length === 0 ? (
                <div style={{ color: "#78350f" }}>
                  The poller has run but no CIBC alerts have been parsed and journalled. Either alerts aren&apos;t yet reaching Gmail (check forwarding), or all matching messages have been skipped (click <b>Poll now</b> to see skip detail).
                </div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {state.recentTrades.map(t => (
                    <li key={t._id}>
                      <code style={{ fontSize: 11 }}>{new Date(t.executedAt).toISOString().slice(0, 10)}</code> · {t.leg} · <i>{t.account}</i>
                      {" · "}
                      <span style={{ color: t.status === "auto" ? "#14532d" : "#78350f" }}>{t.status}</span>
                      {" · "}
                      <span style={{ color: t.positionApplied ? "#14532d" : "#7f1d1d" }}>{t.positionApplied ? "positions applied" : "positions NOT applied"}</span>
                      {" · "}
                      <button
                        className="sa-btn ghost"
                        style={{ fontSize: 11, padding: "1px 6px" }}
                        onClick={async () => {
                          if (!window.confirm(`Reapply this trade to positions + cash?\n\n${t.leg}\n\nOnly click if the current position DOES NOT already reflect this trade. If it does, reapply will double-apply.`)) return;
                          try {
                            const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/reapply-trade`, {
                              method: "POST", credentials: "include",
                              headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
                              body: JSON.stringify({ tradeId: t._id }),
                            });
                            const j = await r.json();
                            if (!r.ok) throw new Error(j.error || `${r.status}`);
                            setBanner({ kind: "ok", msg: `Reapplied ${t.leg} to positions + cash.` });
                            await load();
                          } catch (e) {
                            setBanner({ kind: "err", msg: `Reapply failed: ${e?.message || "unknown"}` });
                          }
                        }}
                        title="Force-reapply this trade's legs to positions + cash. Use ONLY if the position still shows the pre-trade quantity (i.e. the earlier apply was a silent no-op)."
                      >Reapply</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {pendingReview.rows?.length > 0 && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: "#7f1d1d" }}>
                🔍 {pendingReview.rows.length} trade{pendingReview.rows.length === 1 ? "" : "s"} need{pendingReview.rows.length === 1 ? "s" : ""} manual review
              </div>
              <div style={{ marginBottom: 8, color: "#7f1d1d" }}>
                For each row, pick the account it should be charged to, then click Resolve. Positions + cash will update immediately.
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {pendingReview.rows.map(row => (
                  <PendingReviewRow
                    key={row._id}
                    row={row}
                    allAccounts={pendingReview.allAccounts}
                    onResolve={(acctId) => resolveTrade(row._id, acctId)}
                  />
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="sa-btn" onClick={() => setEditing(true)}>Edit / rotate password</button>
            <button className="sa-btn" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
            <button className="sa-btn" onClick={pollNow} disabled={pollingNow}>{pollingNow ? "Polling…" : "Poll now"}</button>
            <button className="sa-btn" onClick={rescanMailbox} disabled={rescanning} title="Reset the UID high-water mark and re-poll from the earliest matching message. Use when Test connection reports N matches but Poll now finds 0.">{rescanning ? "Rescanning…" : "Rescan mailbox"}</button>
            <button className="sa-btn" onClick={backfillPositions} disabled={backfilling}>{backfilling ? "Backfilling…" : "Backfill positions"}</button>
            <button className="sa-btn" onClick={retryNeedsReview} disabled={retrying} title="Re-run reconciler over stuck needs-review trades using improved account-inference. Promotes to auto + applies positions when it can now resolve them.">{retrying ? "Retrying…" : "Retry needs-review"}</button>
            <button className="sa-btn" onClick={showJournalState} disabled={snapshotting} title="Read-only snapshot: how many CIBC-email trades are in the journal, how many are applied vs stuck, and the newest few needs-review samples.">{snapshotting ? "Reading…" : "Journal state"}</button>
            <button className="sa-btn" onClick={showAudit} disabled={auditLoading} title="Scan the trade journal for duplicates — same email + ticker + account + side + shares within 3 days. Delete duplicates in bulk with automatic position + cash reversal to repair the book.">{auditLoading ? "Auditing…" : "Find duplicates"}</button>
            <button className="sa-btn" onClick={showReconstruct} disabled={reconstructLoading} title="Walk every applied trade in the journal and diff against current positions + cash. Any unexplained drift = a bug or manual edit the trader can act on.">{reconstructLoading ? "Reconstructing…" : "Reconstruct audit"}</button>
            <button className="sa-btn danger" onClick={disconnect}>Disconnect</button>
          </div>
          {audit && (
            <div style={{ marginTop: 10, padding: "12px 14px", background: audit.groupCount === 0 ? "#dcfce7" : "#fee2e2", border: `1px solid ${audit.groupCount === 0 ? "#86efac" : "#fecaca"}`, borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: audit.groupCount === 0 ? "#166534" : "#7f1d1d" }}>
                {audit.groupCount === 0
                  ? "✓ No duplicate trades detected in the last " + audit.days + " days."
                  : `⚠ ${audit.groupCount} duplicate cluster${audit.groupCount === 1 ? "" : "s"} found in the last ${audit.days} days · ${audit.groups.reduce((s, g) => s + g.trades.length, 0)} total trades in these clusters`}
              </div>
              {audit.groupCount > 0 && (
                <div style={{ color: "#7f1d1d", marginBottom: 10 }}>
                  Each cluster is a set of trades with identical fingerprint (ticker + account + side + shares) within 3 days. Almost certainly the same real trade recorded multiple times by the poller. Select the ones to <b>DELETE</b> — the app will reverse each deleted trade's positions + cash so the book heals as duplicates are pruned. Keep at least ONE per cluster (usually the earliest, or the one with a linked rec).
                </div>
              )}
              {audit.groups.map((g, gi) => (
                <div key={gi} style={{ marginBottom: 10, padding: 8, background: "white", border: "1px solid #fecaca", borderRadius: 6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {g.fingerprint.side} {g.fingerprint.shares} {g.fingerprint.tickerBase} · {g.accountName} · {g.trades.length} copies span {g.spanHours}h
                  </div>
                  {g.trades.map((t, ti) => {
                    const isSelected = auditSelected.has(t._id);
                    return (
                      <div key={t._id} style={{ padding: "4px 0", borderTop: ti === 0 ? "none" : "1px dashed #fecaca", display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setAuditSelected(prev => {
                              const next = new Set(prev);
                              if (next.has(t._id)) next.delete(t._id); else next.add(t._id);
                              return next;
                            });
                          }}
                          style={{ marginTop: 3, width: 14, height: 14, accentColor: "#ef4444" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div><b>{t.leg}</b> · {new Date(t.executedAt).toLocaleString()}</div>
                          <div style={{ color: "#6b7280", fontSize: 11 }}>
                            {t.status || "—"} · {t.source || "manual"} · {t.positionApplied ? "positions applied" : "positions NOT applied"}
                            {t.linkedAdviceRecId && <span> · <b style={{ color: "#065f46" }}>linked to advice rec</b></span>}
                            {t.linkedDailyPickId && <span> · <b style={{ color: "#065f46" }}>linked to daily pick</b></span>}
                          </div>
                          {t.notes && <div style={{ color: "#6b7280", fontSize: 11, fontStyle: "italic" }}>{t.notes}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {audit.groupCount > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="sa-btn danger"
                    onClick={deleteSelectedDuplicates}
                    disabled={deletingDupes || auditSelected.size === 0}
                    title="Delete each selected trade AND reverse its position + cash mutation on the portfolio."
                  >
                    {deletingDupes ? "Deleting…" : `Delete ${auditSelected.size} selected + reverse`}
                  </button>
                  <button className="sa-btn" onClick={() => setAuditSelected(new Set())} disabled={auditSelected.size === 0}>Clear selection</button>
                  <span className="sa-muted" style={{ fontSize: 11 }}>
                    Suggestion: for each cluster, KEEP the earliest (or the one linked to an advice rec) and delete the rest.
                  </span>
                </div>
              )}
            </div>
          )}
          {reconstruct && (
            <div style={{ marginTop: 10, padding: "12px 14px", background: (reconstruct.summary.positionDriftCount + reconstruct.summary.cashDriftCount) === 0 ? "#dcfce7" : "#fef3c7", border: `1px solid ${(reconstruct.summary.positionDriftCount + reconstruct.summary.cashDriftCount) === 0 ? "#86efac" : "#fbbf24"}`, borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: (reconstruct.summary.positionDriftCount + reconstruct.summary.cashDriftCount) === 0 ? "#166534" : "#78350f" }}>
                Reconstruct audit · {reconstruct.summary.tradesConsidered} applied trades walked ·
                {" "}<b>{reconstruct.summary.positionDriftCount}</b> position drifts ·
                {" "}<b>{reconstruct.summary.cashDriftCount}</b> cash drifts
              </div>
              <div className="sa-muted" style={{ marginBottom: 8, fontSize: 11 }}>
                Green = matches journal · Blue = pre-journal / dividends / deposits (fine) · Amber = drift · Red = looks like a duplicate application. If everything is green + blue, the journal and portfolio are consistent — the reconciliation loop is closed.
              </div>
              {reconstruct.positionRows.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Account</th>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Ticker</th>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Sub</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Journal implies</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Actual</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Delta</th>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Diagnosis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconstruct.positionRows.map((r, i) => {
                        const tagBg = r.tag.level === "ok" ? "#dcfce7"
                          : r.tag.level === "pre-journal" ? "#dbeafe"
                          : r.tag.level === "info" ? "#dbeafe"
                          : r.tag.level === "duplicate" ? "#fee2e2"
                          : "#fef3c7";
                        const tagFg = r.tag.level === "ok" ? "#166534"
                          : r.tag.level === "pre-journal" || r.tag.level === "info" ? "#1e40af"
                          : r.tag.level === "duplicate" ? "#b91c1c"
                          : "#78350f";
                        return (
                          <tr key={i} style={{ borderTop: "1px solid var(--sa-border)", background: tagBg }}>
                            <td style={{ padding: "4px 8px" }}>{r.account}</td>
                            <td style={{ padding: "4px 8px", fontWeight: 700 }}>{r.ticker}</td>
                            <td style={{ padding: "4px 8px", color: "var(--sa-muted)" }}>{r.subCcy}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>{r.impliedShares.toFixed(0)}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>{r.actualShares.toFixed(0)}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: Math.abs(r.delta) < 0.5 ? "inherit" : (r.delta > 0 ? "#b91c1c" : "#b91c1c") }}>{r.delta >= 0 ? "+" : ""}{r.delta.toFixed(0)}</td>
                            <td style={{ padding: "4px 8px", color: tagFg }}>{r.tag.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {reconstruct.cashRows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, marginTop: 4 }}>Cash reconciliation</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Account</th>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>CCY</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Journal implies</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Actual</th>
                        <th style={{ textAlign: "right", padding: "4px 8px" }}>Delta</th>
                        <th style={{ textAlign: "left", padding: "4px 8px" }}>Interpretation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconstruct.cashRows.map((r, i) => {
                        const tagBg = r.tag.level === "ok" ? "#dcfce7"
                          : r.tag.level === "info" ? "#dbeafe"
                          : "#fef3c7";
                        const tagFg = r.tag.level === "ok" ? "#166534"
                          : r.tag.level === "info" ? "#1e40af"
                          : "#78350f";
                        return (
                          <tr key={i} style={{ borderTop: "1px solid var(--sa-border)", background: tagBg }}>
                            <td style={{ padding: "4px 8px" }}>{r.account}</td>
                            <td style={{ padding: "4px 8px" }}>{r.currency}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>${Math.round(r.impliedCash).toLocaleString()}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>${Math.round(r.actualCash).toLocaleString()}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: Math.abs(r.delta) < 5 ? "inherit" : "#b91c1c" }}>{r.delta >= 0 ? "+" : ""}${Math.round(r.delta).toLocaleString()}</td>
                            <td style={{ padding: "4px 8px", color: tagFg }}>{r.tag.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {snapshot && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--sa-panel-2)", borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Journal state (read-only)</div>
              {snapshot.diagnostic ? (
                <>
                  <div style={{ marginBottom: 6 }}>{snapshot.diagnostic.interpretation}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
                    <div>Total in journal: <b>{snapshot.diagnostic.totalInJournal}</b></div>
                    <div>Poller-sourced: <b>{snapshot.diagnostic.cibcEmailTrades}</b></div>
                    <div>Applied: <b>{snapshot.diagnostic.cibcEmailAlreadyApplied}</b></div>
                    <div>Auto/unapplied: <b style={{ color: snapshot.diagnostic.cibcEmailAutoStillUnapplied > 0 ? "var(--sa-amber)" : "inherit" }}>{snapshot.diagnostic.cibcEmailAutoStillUnapplied}</b></div>
                    <div>Needs review: <b style={{ color: snapshot.diagnostic.cibcEmailNeedsReview > 0 ? "var(--sa-amber)" : "inherit" }}>{snapshot.diagnostic.cibcEmailNeedsReview}</b></div>
                    <div>Manual (no source): <b>{snapshot.diagnostic.tradesWithNoBrokerSource}</b></div>
                  </div>
                  {Array.isArray(snapshot.diagnostic.needsReviewSamples) && snapshot.diagnostic.needsReviewSamples.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ color: "var(--sa-muted)", marginBottom: 4 }}>Newest needs-review samples:</div>
                      {snapshot.diagnostic.needsReviewSamples.map(s => (
                        <div key={s._id} style={{ padding: "4px 0", borderTop: "1px solid var(--sa-border)" }}>
                          <div><b>{s.leg}</b> — {s.account || "no account"}</div>
                          <div style={{ color: "var(--sa-muted)" }}>{s.reason || "(no reason recorded)"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div>Backfill would apply <b>{snapshot.candidateCount}</b> auto trades. Click "Backfill positions" to apply.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--sa-muted)" }}>Gmail address the poller reads from</label>
            <input
              type="email"
              value={mailboxAddress}
              onChange={(e) => setMailboxAddress(e.target.value)}
              placeholder="e.g. rgsommer.junk@gmail.com"
              autoComplete="email"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--sa-muted)" }}>Gmail app password (16 chars; spaces OK, stripped on save)</label>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={state.configured ? "leave blank to keep existing" : "xxxx xxxx xxxx xxxx"}
              autoComplete="new-password"
              style={{ width: "100%", fontFamily: "monospace" }}
            />
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Google Account → Security → 2-Step Verification → App passwords. Only this app, only IMAP scope. Not your regular Gmail password.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--sa-muted)" }}>Gmail search filter (poller only reads matching messages)</label>
            <input
              type="text"
              value={imapQuery}
              onChange={(e) => setImapQuery(e.target.value)}
              placeholder="from:alerts@cibc.com newer_than:30d"
              style={{ width: "100%", fontFamily: "monospace" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="sa-btn" onClick={save} disabled={saving || !mailboxAddress.trim() || (!state.configured && !appPassword.trim())}>
              {saving ? "Saving…" : (state.configured ? "Update" : "Save")}
            </button>
            {editing && <button className="sa-btn" onClick={() => { setEditing(false); setAppPassword(""); }}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// QuestradeIntegrationCard — connect / manage a read-only Questrade
// integration for account activity reconciliation. Explicitly NO
// order-execution UI: our backend has no `POST /orders` code and this
// card never asks for anything that could execute a trade. Reads
// Questrade activities, maps accounts, reconciles fills to the trade
// journal same as the CIBC email poller.
// =============================================================================
function QuestradeIntegrationCard({ sessionToken, user }) {
  const [state, setState] = useState({ loading: true });
  const [refreshToken, setRefreshToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [polling, setPolling] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [banner, setBanner] = useState(null);
  const [liveAccounts, setLiveAccounts] = useState(null);
  const [linkDraft, setLinkDraft] = useState({}); // { questradeAccountNumber: curriculateAccountId }
  const [savingLinks, setSavingLinks] = useState(false);

  const load = async () => {
    if (!sessionToken) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/status`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setState({ loading: false, ...j });
      if (j.accountLinks?.length) {
        const draft = {};
        for (const l of j.accountLinks) draft[l.questradeAccountNumber] = l.curriculateAccountId;
        setLinkDraft(draft);
      }
    } catch (e) {
      setState({ loading: false, configured: false });
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sessionToken]);

  const connect = async () => {
    if (!refreshToken.trim()) return;
    setBanner(null); setConnecting(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/connect`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ refreshToken: refreshToken.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setRefreshToken(""); // clear immediately from memory
      setBanner({ kind: "ok", msg: `Connected. API server: ${j.apiServer}. Now map your Questrade accounts below.` });
      await load();
      await loadLiveAccounts();
    } catch (e) {
      setBanner({ kind: "err", msg: `Connect failed: ${e?.message || e}` });
    } finally { setConnecting(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Questrade? Your account links are preserved but the poller stops and the refresh token is wiped. You can reconnect with a fresh App Hub token later.")) return;
    setBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/disconnect`, {
        method: "POST", credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBanner({ kind: "ok", msg: "Disconnected." });
      setLiveAccounts(null); setLinkDraft({});
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Disconnect failed: ${e?.message || e}` });
    }
  };

  const toggleEnabled = async () => {
    setToggling(true); setBanner(null);
    try {
      const next = !state.enabled;
      const r = await fetch(`${BACKEND_URL}/api/questrade/toggle-enabled`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ enabled: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBanner({ kind: "ok", msg: `Poller ${j.enabled ? "enabled" : "paused"}.` });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Toggle failed: ${e?.message || e}` });
    } finally { setToggling(false); }
  };

  const loadLiveAccounts = async () => {
    setBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/accounts`, {
        credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setLiveAccounts(j.accounts || []);
    } catch (e) {
      setBanner({ kind: "err", msg: `Fetch accounts failed: ${e?.message || e}` });
    }
  };

  const saveLinks = async () => {
    if (!liveAccounts) return;
    setSavingLinks(true); setBanner(null);
    try {
      const links = liveAccounts
        .map(a => ({
          questradeAccountNumber: a.number,
          curriculateAccountId: linkDraft[a.number] || "",
          questradeType: a.type || "",
          questradeStatus: a.status || "",
          enabled: true,
        }))
        .filter(l => l.curriculateAccountId);
      const r = await fetch(`${BACKEND_URL}/api/questrade/account-links`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ links }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBanner({ kind: "ok", msg: `Saved ${j.accountLinks?.length || 0} account link(s).` });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Save failed: ${e?.message || e}` });
    } finally { setSavingLinks(false); }
  };

  const pollNow = async () => {
    setPolling(true); setBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/poll-now`, {
        method: "POST", credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (j.skipped) setBanner({ kind: "ok", msg: `Poll skipped: ${j.skipped}` });
      else setBanner({ kind: "ok", msg: `Polled: ${j.inserted} inserted · ${j.skipped} skipped · ${j.errors} errors` });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Poll failed: ${e?.message || e}` });
    } finally { setPolling(false); }
  };

  const rescan = async () => {
    if (!window.confirm("Rescan the last 90 days of Questrade activities? Uses reconcile-key + fuzzy dedup so no double-inserts.")) return;
    setRescanning(true); setBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/questrade/rescan`, {
        method: "POST", credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBanner({ kind: "ok", msg: `Rescan: ${j.inserted} inserted · ${j.skipped} skipped · ${j.errors} errors` });
      await load();
    } catch (e) {
      setBanner({ kind: "err", msg: `Rescan failed: ${e?.message || e}` });
    } finally { setRescanning(false); }
  };

  const accounts = user?.accounts || [];

  return (
    <div className="sa-card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Questrade integration</h3>
          <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Read-only. Polls your Questrade account activity every 5 min and reconciles fills to the trade journal.
            <br /><b>Order execution stays in Questrade&#39;s UI</b> — this integration never places, modifies, or cancels orders.
          </div>
        </div>
      </div>

      {banner && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap",
          background: banner.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color: banner.kind === "ok" ? "#166534" : "#7f1d1d",
          border: `1px solid ${banner.kind === "ok" ? "#86efac" : "#fecaca"}`,
        }}>{banner.msg}</div>
      )}

      {state.loading ? (
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 10 }}>Loading Questrade status…</div>
      ) : !state.configured ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 8 }}>
            Not connected. Register a Personal App at <a href="https://apphub.questrade.com/UI/UserApps.aspx" target="_blank" rel="noopener noreferrer">apphub.questrade.com</a>, generate a device token, and paste it below. The token is single-use — our backend rotates it to a fresh encrypted token the moment you click Connect.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <input
              type="password" autoComplete="off" spellCheck={false}
              placeholder="Paste Questrade refresh token"
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              style={{ flex: 1, minWidth: 240, padding: "6px 8px", fontFamily: "monospace", fontSize: 13, border: "1px solid var(--sa-border)", borderRadius: 4 }}
            />
            <button className="sa-btn" onClick={connect} disabled={connecting || !refreshToken.trim()}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 13 }}>
          <div>
            <b>Status:</b>{" "}
            {state.needsReconnect ? (
              <span style={{ color: "#7f1d1d" }}>reconnect required</span>
            ) : state.enabled === false ? (
              <span style={{ color: "#78350f" }}>paused</span>
            ) : state.lastPolledAt ? (
              state.lastPollSucceeded
                ? <span style={{ color: "#14532d" }}>last poll ✓ {new Date(state.lastPolledAt).toLocaleString()}</span>
                : <span style={{ color: "#7f1d1d" }}>last poll ✗ {state.lastPollError || "unknown"}</span>
            ) : <span className="sa-muted">connected, never polled</span>}
          </div>
          <div><b>Refresh token:</b> <span style={{ fontFamily: "monospace" }}>{state.tokenMask || "•••"}</span> <span className="sa-muted" style={{ fontSize: 11 }}>(rotates on every exchange)</span></div>
          <div><b>API server:</b> <code style={{ fontSize: 11 }}>{state.apiServer || "—"}</code></div>
          <div><b>Reconciled trades:</b> {state.reconciledCount || 0} since connect</div>
          <div><b>Watermark:</b> <span className="sa-muted" style={{ fontSize: 11 }}>{state.lastActivityTs || "no activities processed yet"}</span></div>

          {/* Account link mapper */}
          <div style={{ marginTop: 10, padding: 10, background: "var(--sa-panel-2)", borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <b>Account mapping</b>
              <button className="sa-btn ghost" onClick={loadLiveAccounts}>↻ Fetch Questrade accounts</button>
            </div>
            {!liveAccounts && state.accountLinks?.length > 0 ? (
              <div style={{ fontSize: 12 }}>
                {state.accountLinks.map((l) => {
                  const local = accounts.find(a => a.id === l.curriculateAccountId);
                  return (
                    <div key={l.questradeAccountNumber} style={{ padding: "3px 0" }}>
                      <code>{l.questradeAccountNumber}</code> ({l.questradeType || "?"}) → <b>{local?.name || l.curriculateAccountId}</b>
                    </div>
                  );
                })}
                <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>Click "Fetch Questrade accounts" to edit.</div>
              </div>
            ) : liveAccounts ? (
              <div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)", marginBottom: 8 }}>
                  For each Questrade account, pick the matching Curriculate account. Leave unset to skip that account.
                </div>
                {liveAccounts.length === 0 ? (
                  <div className="sa-muted" style={{ fontSize: 12 }}>No accounts returned.</div>
                ) : liveAccounts.map((a) => (
                  <div key={a.number} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, minWidth: 200 }}>
                      <code>{a.number}</code> · {a.type} · {a.status} {a.isPrimary ? "· primary" : ""}
                    </span>
                    <select
                      value={linkDraft[a.number] || ""}
                      onChange={(e) => setLinkDraft({ ...linkDraft, [a.number]: e.target.value })}
                      style={{ padding: "4px 6px", border: "1px solid var(--sa-border)", borderRadius: 4, fontSize: 12 }}
                    >
                      <option value="">— skip —</option>
                      {accounts.map(la => (
                        <option key={la.id} value={la.id}>{la.name} ({la.id})</option>
                      ))}
                    </select>
                  </div>
                ))}
                <button className="sa-btn" style={{ marginTop: 8 }} onClick={saveLinks} disabled={savingLinks}>
                  {savingLinks ? "Saving…" : "Save mapping"}
                </button>
              </div>
            ) : (
              <div className="sa-muted" style={{ fontSize: 12 }}>
                No account links yet. Click "Fetch Questrade accounts" to load your Questrade account list, then map each to a Curriculate account.
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="sa-btn ghost" onClick={toggleEnabled} disabled={toggling}>
              {toggling ? "…" : state.enabled === false ? "▶ Enable poller" : "⏸ Pause poller"}
            </button>
            <button className="sa-btn ghost" onClick={pollNow} disabled={polling || state.enabled === false}>
              {polling ? "Polling…" : "↻ Poll now"}
            </button>
            <button className="sa-btn ghost" onClick={rescan} disabled={rescanning || state.enabled === false}>
              {rescanning ? "Rescanning…" : "⟳ Rescan last 90 days"}
            </button>
            <button className="sa-btn ghost" onClick={disconnect} style={{ color: "#7f1d1d" }}>
              Disconnect
            </button>
          </div>

          {state.needsReconnect && (
            <div style={{ padding: 8, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, marginTop: 8, fontSize: 12 }}>
              Refresh token invalid — reconnect with a fresh App Hub device token.
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                <input
                  type="password" autoComplete="off" spellCheck={false}
                  placeholder="Paste fresh Questrade refresh token"
                  value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)}
                  style={{ flex: 1, padding: "6px 8px", fontFamily: "monospace", fontSize: 13, border: "1px solid var(--sa-border)", borderRadius: 4 }}
                />
                <button className="sa-btn" onClick={connect} disabled={connecting || !refreshToken.trim()}>Reconnect</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsView({ user, sessionToken, onChangeRisk, onChangeFx, onChangeCommission, onChangeFxSpread, onChangeGoals, onChangeContributionGoals, onChangeAccountRisk, onChangeAccountType, onChangeAccountMonthlyReport, onChangeAccountCcEmail, onChangeBeneficiaryAgreement, onChangeConsensusMode, onChangeIntradayUpdates, onChangeOptionsTrading, onChangeNoTouchMode, onChangeDisciplineCritic, onChangeVolSizing, onChangeRiskPerTrade, onChangeKellyCap, onChangePyramiding, onChangeBriefingTimes, onChangeBriefingTz, onChangeSleeveTargets, onAddPlannedWithdrawal, onRemovePlannedWithdrawal, onExecutePlannedWithdrawal, onReset }) {
  const [goalsDraft, setGoalsDraft] = useState(user.goals || "");
  const [goalsSavedAt, setGoalsSavedAt] = useState(null);
  // Contribution goals — each is { amount, period }. Legacy flat numbers are
  // coerced to { amount, period: "yearly" } so existing portfolios upgrade
  // seamlessly without a one-shot migration step.
  const cgRaw = user.annualContributionGoals || {};
  const readGoal = (v) => {
    if (typeof v === "number") return { amount: v || 0, period: "yearly" };
    if (v && typeof v === "object") return { amount: v.amount || 0, period: v.period || "yearly" };
    return { amount: 0, period: "yearly" };
  };
  const cgRrsp = readGoal(cgRaw.rrsp);
  const cgResp = readGoal(cgRaw.resp);
  const cgTfsa = readGoal(cgRaw.tfsa);
  const [rrspGoal, setRrspGoal] = useState(cgRrsp.amount || "");
  const [rrspPeriod, setRrspPeriod] = useState(cgRrsp.period);
  const [respGoal, setRespGoal] = useState(cgResp.amount || "");
  const [respPeriod, setRespPeriod] = useState(cgResp.period);
  const [tfsaGoal, setTfsaGoal] = useState(cgTfsa.amount || "");
  const [tfsaPeriod, setTfsaPeriod] = useState(cgTfsa.period);
  // Local form state for adding a new planned withdrawal
  const [wAmount, setWAmount] = useState("");
  const [wCcy, setWCcy] = useState("CAD");
  const [wDate, setWDate] = useState("");
  const [wAccount, setWAccount] = useState(user.accounts?.[0]?.id || "");
  const [wNotes, setWNotes] = useState("");

  const planned = (user.plannedWithdrawals || []).slice().sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));

  const handleAdd = () => {
    const amt = parseFloat(wAmount);
    if (!amt || amt <= 0) return alert("Enter an amount > 0");
    if (!wDate) return alert("Pick a target date");
    onAddPlannedWithdrawal({ amount: amt, currency: wCcy, targetDate: new Date(wDate + "T12:00:00").toISOString(), account: wAccount, notes: wNotes });
    setWAmount(""); setWDate(""); setWNotes("");
  };

  return (
    <div>
      <h2>Settings</h2>
      <div className="sa-breadcrumb">Account preferences</div>

      {/* Goals — free-form text injected at the top of every AI prompt */}
      <div className="sa-card" style={{ marginBottom: 14, borderColor: "#bfdbfe", background: "linear-gradient(135deg,#eff6ff,#fff)" }}>
        <h3 style={{ margin: 0 }}>🎯 Long-term goals &amp; constraints</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
          Free-form. Whatever you write here gets injected at the TOP of every AI advice / briefing prompt. Recommendations will be checked against these goals before being issued. Be specific.
        </div>
        <textarea
          value={goalsDraft}
          onChange={(e) => setGoalsDraft(e.target.value)}
          rows={9}
          maxLength={5000}
          placeholder={`Examples (use as many as apply):
- The $90K cash bucket is long-term — do not redeploy for short-term trades.
- I want to withdraw $1,000/month starting in 2035.
- Planned withdrawal $5,000 on Jun 15 (for property tax).
- My RRSP contribution limit is $86K — prioritize filling it.
- Retirement target: 2030.
- I'd rather underperform in calm markets than blow up in volatile ones.
- Never recommend a position over 25% of portfolio after the rebalance.`}
          style={{ width: "100%", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", fontSize: 13, lineHeight: 1.5, padding: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12 }}>
          <span className="sa-muted">
            {goalsDraft.length} / 5000 characters
            {goalsSavedAt && <span style={{ marginLeft: 12, color: "var(--sa-green)" }}>✓ Saved at {goalsSavedAt}</span>}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="sa-btn secondary"
              onClick={() => setGoalsDraft(user.goals || "")}
              disabled={goalsDraft === (user.goals || "")}
            >Revert</button>
            <button
              className="sa-btn"
              onClick={() => {
                onChangeGoals(goalsDraft);
                setGoalsSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
              }}
              disabled={goalsDraft === (user.goals || "")}
            >Save goals</button>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Planned cash needs</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Tell the advisor about upcoming withdrawals so recommendations preserve the cash. Stays planned until you Execute → records the WITHDRAW trade and clears the entry.
        </div>

        {planned.length > 0 && (
          <div style={{ marginBottom: 14, border: "1px solid var(--sa-border)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--sa-panel-2)" }}>
                  <th style={recHeaderCellLeft}>Amount</th>
                  <th style={recHeaderCellLeft}>By</th>
                  <th style={recHeaderCellLeft}>Account</th>
                  <th style={recHeaderCellLeft}>Notes</th>
                  <th style={recHeaderCell}></th>
                </tr>
              </thead>
              <tbody>
                {planned.map((w) => {
                  const daysOut = Math.round((new Date(w.targetDate).getTime() - Date.now()) / 86400000);
                  const urgent = daysOut <= 7;
                  const acctName = user.accounts.find(a => a.id === w.account)?.name || "—";
                  return (
                    <tr key={w.id} style={{ borderTop: "1px solid var(--sa-border)" }}>
                      <td style={{ ...recCellLeft, fontWeight: 600 }}>
                        ${w.amount.toLocaleString()} {w.currency}
                      </td>
                      <td style={{ ...recCellLeft, color: urgent ? "var(--sa-red)" : "var(--sa-text-2)" }}>
                        {new Date(w.targetDate).toLocaleDateString()} <span style={{ fontSize: 11 }}>({daysOut < 0 ? `${-daysOut}d overdue` : `${daysOut}d`})</span>
                      </td>
                      <td style={{ ...recCellLeft, color: "var(--sa-muted)" }}>{acctName}</td>
                      <td style={{ ...recCellLeft, color: "var(--sa-muted)", fontSize: 12, maxWidth: 220 }}>{w.notes || "—"}</td>
                      <td style={{ ...recCell, whiteSpace: "nowrap" }}>
                        <button className="sa-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => onExecutePlannedWithdrawal(w)}>Execute →</button>
                        {" "}
                        <button className="sa-btn ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { if (confirm("Remove this planned withdrawal?")) onRemovePlannedWithdrawal(w.id); }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ background: "var(--sa-panel-2)", padding: 14, borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "var(--sa-text-2)" }}>Add a planned withdrawal</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr 1fr", gap: 10 }}>
            <div><label>Amount</label><input type="number" step="any" min="0" value={wAmount} onChange={(e) => setWAmount(e.target.value)} placeholder="5000" /></div>
            <div><label>Ccy</label>
              <select value={wCcy} onChange={(e) => setWCcy(e.target.value)}>
                <option value="CAD">CAD</option><option value="USD">USD</option>
              </select>
            </div>
            <div><label>Target date</label><input type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} /></div>
            <div><label>Account</label>
              <select value={wAccount} onChange={(e) => setWAccount(e.target.value)}>
                {user.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <div><label>Notes (optional)</label><input value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder="Property tax, tuition, etc." maxLength={300} /></div>
            <div style={{ display: "flex", alignItems: "flex-end" }}><button className="sa-btn" onClick={handleAdd}>+ Add</button></div>
          </div>
        </div>
      </div>
      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Risk tolerance</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>Global default — applies to any account that doesn't override below.</div>
        <div className="sa-risk-grid">
          {["conservative", "moderate", "aggressive", "speculative"].map((v) => (
            <div key={v} className={`sa-risk-card ${user.riskTolerance === v ? "sel" : ""}`} onClick={() => onChangeRisk(v)}>
              <h4 style={{ textTransform: "capitalize" }}>{v}</h4>
            </div>
          ))}
        </div>

        {/* Per-account risk overrides + tax-treatment classification */}
        {(user.accounts || []).length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--sa-border)" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Per-account overrides</div>
            <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Set each account&#39;s <b>type</b> (registered/tax classification) and optional risk override. Account name is a nickname (e.g. &quot;Non-Spousal&quot;); type is what actually determines tax treatment downstream — RRSP US-dividend handling, TFSA growth focus, taxable capital-gains realization, contribution-room tracking.
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {user.accounts.map(a => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 220px 200px", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--sa-border)" }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{a.name}</span>
                  <select
                    value={a.accountType || ""}
                    onChange={(e) => onChangeAccountType(a.id, e.target.value)}
                    title="Registered / tax-treatment classification"
                  >
                    <option value="">— unset —</option>
                    {ACCOUNT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.long}</option>
                    ))}
                  </select>
                  <select
                    value={a.riskTolerance || ""}
                    onChange={(e) => onChangeAccountRisk(a.id, e.target.value || null)}
                    title="Risk override — leave inherited unless a specific account has a different mandate"
                  >
                    <option value="">— risk: inherit ({user.riskTolerance}) —</option>
                    <option value="conservative">Conservative</option>
                    <option value="moderate">Moderate</option>
                    <option value="aggressive">Aggressive</option>
                    <option value="speculative">Speculative</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeConsensusMode(!user.consensusMode)}>
        <h3>AI advice mode</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={!!user.consensusMode}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Consensus mode</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Run advice <b>3× in parallel</b> on every click of <b>Update Advice</b>, and surface only the ideas that appear in <b>at least 2 of 3</b> runs (high-conviction). Costs ~3× the single-run API spend and takes longer. If only 1 of 3 succeeds, you get that single run as a fallback with a "degraded" notice instead of an error.
            </div>
          </div>
        </div>
      </div>

      <BriefingScheduleCard
        times={user.briefingTimes || []}
        tz={user.briefingTz || "America/New_York"}
        onChangeTimes={onChangeBriefingTimes}
        onChangeTz={onChangeBriefingTz}
      />

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeIntradayUpdates(!user.intradayUpdatesEnabled)}>
        <h3>Midday market updates</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.intradayUpdatesEnabled}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Enable intraday tape updates (11:00 · 13:00 · 15:00 ET, weekdays)</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              A short mid-day briefing that emails you <b>only when something actionable has changed</b> since morning: a position P&amp;L stop crossed, a fresh SEC 8-K on a holding, a Fed liquidity regime flip, or a Test A pick that just entered its entry zone. Quiet tape = no email. Uses the same signal pipeline + prompt cache as the morning briefing, so per-update cost is a fraction.
            </div>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeOptionsTrading(!user.optionsTradingEnabled)}>
        <h3>Options trading</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.optionsTradingEnabled}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Include covered-call overlay suggestions in briefings</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              When on, the daily briefing may include a compact <b>section 6a &quot;Options overlay&quot;</b> with concrete covered-call recs (strike, expiration, mid premium, monthly yield, ~delta). Deliberately narrow to reduce mistakes:
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li><b>Covered calls only</b> — no long options, no spreads, no naked positions</li>
                <li><b>Canadian large-caps (SWING sleeve) only</b> — RY, TD, ENB, BMO, etc.</li>
                <li><b>Non-Spousal account only</b> — TFSA/RRSP excluded (CRA business-income risk in TFSA; broker restrictions in RRSP)</li>
                <li><b>IV rank ≥ 70</b> — only when premium is genuinely rich</li>
                <li><b>Only when the position is in an unrealized gain</b> — capping upside on a losing position piles risk on risk</li>
                <li><b>Skips</b> if an earnings date falls inside the expiration window (IV crush inverts the trade)</li>
              </ul>
              Confirm options approval with your broker before enabling. Talk to an accountant about T5008 implications if you plan to run this frequently.
            </div>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeNoTouchMode(!user.noTouchMode)}>
        <h3>No-touch mode</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.noTouchMode}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>I queue all orders before ~8:45 AM ET and don&apos;t touch them during the day</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Assumes you set every order before the market opens (limit + GTC) and can&apos;t adjust during the session. When on:
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li>Every briefing opens with a <b>🕗 QUEUE BEFORE 8:45 AM ET</b> copy-paste block — the exact ticket text to type into your broker</li>
                <li>orderTiming defaults shift to <b>GTC</b> (or <b>pre-market</b> for gap-and-go); the AI is told to never emit <code>post-10am</code> or <code>at-open</code></li>
                <li>Intraday briefings (if enabled) quiet down to <b>hard-stop hits only</b> — informational signals aren&apos;t actionable when you can&apos;t touch orders</li>
                <li>A short <b>EOD recap</b> emails at 4:15 PM ET Mon–Fri: what filled today, what stopped, what to queue tomorrow</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeDisciplineCritic(!user.disciplineCriticEnabled)}>
        <h3>Discipline critic (independent audit)</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.disciplineCriticEnabled}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Route every briefing through a second AI model for a discipline audit</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              After the primary briefing is written, sends it through a fast OpenAI model (gpt-4o-mini) with a 5-point rubric before delivery:
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li><b>Unjustified TRIM/EXIT</b> — SELL/TRIM without a cited trigger (target hit, stop breached, horizon expired, material news)</li>
                <li><b>Unknown ticker</b> — a rec on a symbol not in your holdings or the discovery pool</li>
                <li><b>Price discrepancy</b> — a current-price claim &gt;10% off from the holdings-table reference</li>
                <li><b>Reverses yesterday</b> — a call that flips your prior briefing without naming a specific new trigger</li>
                <li><b>Liquidation card on held ticker</b> — any "SELL AT MARKET / DELISTED / NOT FOUND" for a name you own</li>
              </ul>
              If anything flags, an amber banner is prepended to the emailed briefing naming each violation. Never blocks send. Costs ~$0.01–0.02/briefing, adds 1–3s latency. Requires the operator to have <code>OPENAI_API_KEY</code> set on the deploy — otherwise the toggle is a no-op.
            </div>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangeVolSizing(!user.volSizingEnabled)}>
        <h3>Vol-scaled × Kelly position sizing</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.volSizingEnabled}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Size every new pick by risk budget × vol × setup expectancy</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Instead of relying on the AI's improvised share counts (which tend to round to visually neat numbers), each new BUY rec's size is computed from three constraints:
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li><b>Risk budget</b> — never lose more than X% of book on any single trade if the stop hits</li>
                <li><b>Vol scaling</b> — shrink positions on high-ATR names so book vol stays consistent</li>
                <li><b>Kelly gate</b> — scale by setup expectancy from the Setup scorecard; unproven or negative-expectancy setups get quarter size</li>
              </ul>
              This is the sizing edge that separates disciplined pros from retail. Uses your Setup scorecard as the expectancy input, so it only takes real teeth once the daily-pick engine has run enough cycles to populate it.
            </div>
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, display: "flex", gap: 16, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
              <label>Risk per trade{" "}
                <input
                  type="number" min="0.1" max="5" step="0.1"
                  value={user.riskPerTradePct ?? 1.0}
                  onChange={(e) => onChangeRiskPerTrade(parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 4 }}
                />% of book
              </label>
              <label>Kelly fraction cap{" "}
                <input
                  type="number" min="0.1" max="1" step="0.05"
                  value={user.kellyFractionCap ?? 0.25}
                  onChange={(e) => onChangeKellyCap(parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 4 }}
                /> (0.25 = quarter-Kelly)
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14, cursor: "pointer" }} onClick={() => onChangePyramiding(!user.pyramidingEnabled)}>
        <h3>Systematic pyramiding (add to winners)</h3>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={!!user.pyramidingEnabled}
            readOnly
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: "#4f46e5", pointerEvents: "none" }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Emit add-on signals when a position moves +1R or +2R in your favour</div>
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Retail underperforms because they trim winners early. Pros pyramid — add to positions that prove out, and trail the stop so each add-on secures partial gains. The briefing will surface every open pick that's crossed a threshold:
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                <li><b>Layer 1 at +1R</b> — add 50% of original size, move stop to break-even + 0.25R</li>
                <li><b>Layer 2 at +2R</b> — add 25% of original size, move stop to +1R</li>
              </ul>
              R = (current − entry) / (entry − stop). Max 2 layers. Positions with earnings inside 3 trading days are skipped (post-earnings gap can reverse the R in one bar).
            </div>
          </div>
        </div>
      </div>

      <EmailIntegrationCard sessionToken={sessionToken} />

      <QuestradeIntegrationCard sessionToken={sessionToken} user={user} />

      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Contribution goals</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Target dollar amounts to contribute to each registered account. Choose monthly (steady drip) or yearly (lump sum). Surfaces in briefings as deadlines approach (RRSP: Mar 1, TFSA: Jan 1 reset, RESP: Dec 31). AI prioritizes filling these when new cash arrives and matches your chosen cadence.
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {[
            { key: "rrsp", label: "RRSP", amount: rrspGoal, setAmount: setRrspGoal, period: rrspPeriod, setPeriod: setRrspPeriod, placeholder: rrspPeriod === "monthly" ? "e.g. 2700" : "e.g. 32000" },
            { key: "resp", label: "RESP", amount: respGoal, setAmount: setRespGoal, period: respPeriod, setPeriod: setRespPeriod, placeholder: respPeriod === "monthly" ? "e.g. 208" : "e.g. 2500" },
            { key: "tfsa", label: "TFSA", amount: tfsaGoal, setAmount: setTfsaGoal, period: tfsaPeriod, setPeriod: setTfsaPeriod, placeholder: tfsaPeriod === "monthly" ? "e.g. 583" : "e.g. 7000" },
          ].map((row) => {
            const num = parseFloat(row.amount) || 0;
            const annual = row.period === "monthly" ? num * 12 : num;
            const hint = num > 0
              ? (row.period === "monthly"
                  ? `≈ $${annual.toLocaleString()}/year`
                  : `≈ $${Math.round(annual / 12).toLocaleString()}/month`)
              : null;
            return (
              <div key={row.key} style={{ display: "grid", gridTemplateColumns: "80px 1fr 130px 110px", gap: 10, alignItems: "end" }}>
                <div style={{ fontWeight: 600, fontSize: 14, paddingBottom: 8 }}>{row.label}</div>
                <div>
                  <label>Amount (CAD)</label>
                  <input type="number" min="0" step="any" value={row.amount} onChange={(e) => row.setAmount(e.target.value)} placeholder={row.placeholder} />
                </div>
                <div>
                  <label>Frequency</label>
                  <select value={row.period} onChange={(e) => row.setPeriod(e.target.value)}>
                    <option value="yearly">per year</option>
                    <option value="monthly">per month</option>
                  </select>
                </div>
                <div className="sa-muted" style={{ fontSize: 11, paddingBottom: 10 }}>{hint || ""}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            className="sa-btn"
            onClick={() => onChangeContributionGoals({
              rrsp: { amount: parseFloat(rrspGoal) || 0, period: rrspPeriod },
              resp: { amount: parseFloat(respGoal) || 0, period: respPeriod },
              tfsa: { amount: parseFloat(tfsaGoal) || 0, period: tfsaPeriod },
            })}
          >Save contribution goals</button>
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Monthly reports & beneficiary agreements</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Tick "Monthly report" for any account you want featured in a dedicated block on the last-trading-day briefing AND in a separate end-of-month email after market close. If you hold capital for someone (e.g. on a loan + profit-share arrangement), open the beneficiary agreement panel to capture the terms — the monthly report will show their live payout amount.
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {(user.accounts || []).map((a) => (
            <AccountReportRow
              key={a.id}
              account={a}
              onToggleMonthly={(v) => onChangeAccountMonthlyReport(a.id, v)}
              onChangeCcEmail={(email) => onChangeAccountCcEmail(a.id, email)}
              onSaveAgreement={(ba) => onChangeBeneficiaryAgreement(a.id, ba)}
            />
          ))}
          {(user.accounts || []).length === 0 && (
            <div className="sa-muted" style={{ fontSize: 12 }}>No accounts yet. Add one from the Positions tab.</div>
          )}
        </div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Trading costs at your broker</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label>Commission per trade (CAD)</label>
            <input
              type="number" step="0.01" min="0"
              defaultValue={user.commissionPerTrade ?? 9.95}
              onChange={(e) => onChangeCommission(parseFloat(e.target.value) || 0)}
            />
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 6 }}>
              Each BUY and SELL counts separately. A swap = 2 commissions.
            </div>
          </div>
          <div>
            <label>FX spread, one-way (%)</label>
            <input
              type="number" step="0.05" min="0" max="10"
              defaultValue={user.fxSpreadPct ?? 1.5}
              onChange={(e) => onChangeFxSpread(parseFloat(e.target.value) || 0)}
            />
            <div className="sa-muted" style={{ fontSize: 12, marginTop: 6 }}>
              Your broker's spread when converting USD↔CAD. Round-trip cost is 2× this.
            </div>
          </div>
        </div>
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 10, padding: 10, background: "var(--sa-panel-2)", borderRadius: 8 }}>
          Recommendations now factor these in: trades smaller than ~${((user.commissionPerTrade ?? 9.95) * 100).toFixed(0)} get rejected as too small, and USD↔CAD conversions need to clear a {(((user.fxSpreadPct ?? 1.5) * 2).toFixed(1))}% round-trip drag.
        </div>
      </div>
      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>FX rate (USD → CAD)</h3>
        <input type="number" step="0.001" defaultValue={user.fxUsdCad} style={{ maxWidth: 200 }} onChange={(e) => onChangeFx(parseFloat(e.target.value) || 1.37)} />
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 6 }}>Used to compute CAD-equivalent of USD positions. Update manually for now; auto-pull TBD.</div>
      </div>

      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Sleeve targets (auto-enforced in briefing)</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Split the book into three disciplinary sleeves. Every morning the briefing checks actual vs target and prevents new speculative BUYs when the SPEC sleeve is full. Values must sum to 100.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div>
            <label>Core (%)</label>
            <input
              type="number" step="1" min="0" max="100"
              defaultValue={user.sleeveTargets?.core ?? 80}
              onChange={(e) => onChangeSleeveTargets({ ...(user.sleeveTargets || { core: 80, swing: 15, spec: 5 }), core: parseFloat(e.target.value) || 0 })}
            />
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Broad ETFs + bonds (buy-and-hold anchor).
            </div>
          </div>
          <div>
            <label>Swing (%)</label>
            <input
              type="number" step="1" min="0" max="100"
              defaultValue={user.sleeveTargets?.swing ?? 15}
              onChange={(e) => onChangeSleeveTargets({ ...(user.sleeveTargets || { core: 80, swing: 15, spec: 5 }), swing: parseFloat(e.target.value) || 0 })}
            />
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Canadian large-caps (your proven template).
            </div>
          </div>
          <div>
            <label>Spec (% CAP)</label>
            <input
              type="number" step="1" min="0" max="100"
              defaultValue={user.sleeveTargets?.spec ?? 5}
              onChange={(e) => onChangeSleeveTargets({ ...(user.sleeveTargets || { core: 80, swing: 15, spec: 5 }), spec: parseFloat(e.target.value) || 0 })}
            />
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>
              High-vol / meme US names. Hard cap.
            </div>
          </div>
        </div>
        {(() => {
          const t = user.sleeveTargets || { core: 80, swing: 15, spec: 5 };
          const sum = (t.core || 0) + (t.swing || 0) + (t.spec || 0);
          const off = Math.abs(sum - 100) > 0.01;
          return off ? (
            <div style={{ fontSize: 12, color: "var(--sa-amber)", marginTop: 10, padding: "8px 10px", background: "var(--sa-amber-soft)", borderRadius: 6 }}>
              ⚠ Current sum: {sum.toFixed(0)}%. Enforcer will normalize to 100% ({((t.core || 0) / sum * 100).toFixed(0)} / {((t.swing || 0) / sum * 100).toFixed(0)} / {((t.spec || 0) / sum * 100).toFixed(0)}). For predictable enforcement, edit so the values sum to 100 exactly.
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--sa-muted)", marginTop: 8 }}>
              ✓ Sums to 100%. Default: 80 / 15 / 5. Journal analysis basis: your Canadian book is 7-for-7; spec sleeve is where all prior losses came from — the SPEC cap is the load-bearing rule.
            </div>
          );
        })()}
      </div>
      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Notifications</h3>
        <div className="sa-muted">Daily briefing arrives at 7:30 AM ET each weekday via email; intraday alerts at 12:30 PM ET (only on material moves). Backed by the Curriculate Resend integration.</div>
      </div>


      <div className="sa-card" style={{ marginBottom: 14, borderColor: "var(--sa-red)" }}>
        <h3>Danger zone</h3>
        <button className="sa-btn danger" onClick={onReset}>Reset my data</button>
      </div>
    </div>
  );
}

// =============================================================================
// Reconcile card — upload CIBC AccountHoldings CSV files, diff against the
// app's stored positions and cash balances. Read-only: flags discrepancies
// for the user to manually fix in Holdings or via Record Trade. No
// auto-apply (the user is the source of truth on intent; the app is the
// source of truth on history).
// =============================================================================
// Mirror of backend normalizeTicker — strips Canadian exchange suffixes
// so SLV.CN matches SLV when locating positions to rectify.
function normalizeTickerClient(t) {
  return String(t || "").toUpperCase().trim().replace(/\.(?:CN|TO|V|NE)$/i, "");
}

// Map a reconciliation discrepancy to a TradeModal prefill. Used when the
// user clicks Rectify on a position-level issue — instead of silently
// overwriting the portfolio, we open the trade modal so they can enter
// the actual fill price and record it as a proper journal entry. Returns
// null when the issue isn't trade-shaped (e.g. cash-only) or when there's
// not enough info to build a sensible prefill.
function rectifyIssueToTradePrefill(acct, issue) {
  if (!issue || issue.type !== "position") return null;
  const ticker = String(issue.csvTicker || issue.ticker || "").toUpperCase().replace(/\.+$/, "");
  if (!ticker) return null;
  const appAccountId = acct.appAccountId || acct.acctId;
  // The CIBC sub the position lives in (CAD/USD) — drives the trade currency
  // and the sub it settles through.
  const ccy = issue.subCurrency || (issue.csvMarket === "US" ? "USD" : "CAD");
  // Suggested entry price = CIBC's listed price when present; otherwise blank
  // so the user must type it.
  const suggestedPrice = Number.isFinite(issue.csvPrice) && issue.csvPrice > 0
    ? Number(issue.csvPrice)
    : null;

  // Three trade-shaped kinds:
  //   extra_in_app   — app has it, CIBC doesn't → SELL appQty
  //   missing_in_app — CIBC has it, app doesn't → BUY csvQty
  //   qty_mismatch   — both have it; sign of delta picks BUY or SELL
  if (issue.kind === "extra_in_app") {
    return {
      side: "SELL", ticker, shares: issue.appQty, currency: ccy,
      accountId: appAccountId, entryLow: suggestedPrice,
      _rectifyIssueLabel: `Reconcile: SELL ${issue.appQty} ${ticker} (CIBC shows 0)`,
    };
  }
  if (issue.kind === "missing_in_app") {
    return {
      side: "BUY", ticker, shares: issue.csvQty, currency: ccy,
      accountId: appAccountId, entryLow: suggestedPrice,
      _rectifyIssueLabel: `Reconcile: BUY ${issue.csvQty} ${ticker} (missing from app)`,
    };
  }
  if (issue.kind === "qty_mismatch") {
    const delta = (issue.csvQty || 0) - (issue.appQty || 0);
    if (delta === 0) return null;
    const isBuy = delta > 0;
    return {
      side: isBuy ? "BUY" : "SELL",
      ticker,
      shares: Math.abs(delta),
      currency: ccy,
      accountId: appAccountId,
      entryLow: suggestedPrice,
      _rectifyIssueLabel: `Reconcile: ${isBuy ? "BUY" : "SELL"} ${Math.abs(delta)} ${ticker} (app ${issue.appQty} → CIBC ${issue.csvQty})`,
    };
  }
  return null;
}

// =============================================================================
// Reconcile view — standalone tab wrapping ReconcileCard. Lifts the
// reconciliation feature out of Settings (which was getting long) so it
// has equal weight with Holdings / Advice / Performance etc.
// =============================================================================
function ReconcileView({ sessionToken, user, onSaveBrokerAccountId, onRectify }) {
  return (
    <div>
      <h2>Reconcile</h2>
      <div className="sa-breadcrumb">
        Compare app holdings against your CIBC Investor's Edge export · flag and rectify discrepancies
      </div>
      <ReconcileCard
        sessionToken={sessionToken}
        accounts={user.accounts || []}
        onSaveBrokerAccountId={onSaveBrokerAccountId}
        onRectify={onRectify}
      />
    </div>
  );
}

function ReconcileCard({ sessionToken, accounts, onSaveBrokerAccountId, onRectify }) {
  const [files, setFiles] = useState([]); // [{ filename, content }]
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState(null);
  const [err, setErr] = useState(null);
  // accountMap: { [cibcAcctId]: appAccountId } — manual overrides for
  // when the user's app account ids differ from the CIBC account numbers.
  // Initialized from any brokerAccountId fields already saved on accounts,
  // so a one-time mapping persists across sessions.
  const [accountMap, setAccountMap] = useState(() => {
    const m = {};
    for (const a of accounts || []) {
      if (a.brokerAccountId) m[a.brokerAccountId] = a.id;
    }
    return m;
  });
  // Track resolved (rectified) discrepancies so the row visually clears
  // without re-running reconcile. Keyed by `${appAcctId}|${type}|${ticker||currency}|${subCcy||""}`.
  const [resolvedKeys, setResolvedKeys] = useState(new Set());
  const issueKey = (appAcctId, issue) => issue.type === "cash"
    ? `${appAcctId}|cash|${issue.currency}`
    : `${appAcctId}|pos|${issue.ticker}|${issue.subCurrency}`;
  const handleRectify = (acct, issue, opts = {}) => {
    if (!onRectify) return;
    const issueK = issueKey(acct.appAccountId || acct.acctId, issue);
    const markResolved = () => {
      setResolvedKeys((prev) => {
        const next = new Set(prev);
        next.add(issueK);
        return next;
      });
    };
    // 3rd arg lets parent defer resolution (e.g. when it opens a trade
    // modal — only mark resolved after the trade actually records).
    // 4th arg (options) lets the caller request silent-update mode for
    // extras that were already booked in another account (no trade needed).
    const result = onRectify(acct, issue, markResolved, opts);
    if (result === false) return; // rejected
    if (result === true) markResolved(); // legacy sync path (cash etc.)
    // Any other return value = deferred — parent will call markResolved.
  };
  // Keep accountMap in sync if accounts prop updates (after save)
  useEffect(() => {
    setAccountMap((prev) => {
      const next = { ...prev };
      for (const a of accounts || []) {
        if (a.brokerAccountId && !next[a.brokerAccountId]) {
          next[a.brokerAccountId] = a.id;
        }
      }
      return next;
    });
  }, [accounts]);

  const onDrop = async (e) => {
    e.preventDefault();
    const dropped = [...(e.dataTransfer?.files || [])];
    await loadFiles(dropped);
  };
  const onPickFiles = async (e) => {
    const picked = [...(e.target.files || [])];
    await loadFiles(picked);
    e.target.value = ""; // allow re-picking the same files
  };
  const loadFiles = async (fileList) => {
    if (!fileList.length) return;
    setErr(null);
    const next = [...files];
    for (const f of fileList) {
      if (!/\.csv$/i.test(f.name)) continue;
      try {
        const content = await f.text();
        next.push({ filename: f.name, content });
      } catch (e) {
        setErr(`Failed to read ${f.name}: ${e?.message || ""}`);
      }
    }
    setFiles(next);
  };
  const removeFile = (i) => setFiles(files.filter((_, idx) => idx !== i));
  const reset = () => { setFiles([]); setDiff(null); setErr(null); setAccountMap({}); setResolvedKeys(new Set()); };

  const runReconcile = async () => {
    if (busy || files.length === 0) return;
    setBusy(true); setErr(null); setDiff(null);
    // Reset cross-through marks on recheck — the new diff is computed
    // against the updated portfolio, so any rows still flagged are NEW
    // discrepancies (or persistent ones), not previously-resolved ones.
    setResolvedKeys(new Set());
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-reconcile`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ files, accountMap }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setDiff(j);
      // Persist any newly-confirmed mappings so future reconciles
      // auto-match without the user remapping.
      if (onSaveBrokerAccountId && Object.keys(accountMap).length > 0) {
        for (const [cibcId, appId] of Object.entries(accountMap)) {
          const acct = (accounts || []).find((a) => a.id === appId);
          if (acct && acct.brokerAccountId !== cibcId) {
            onSaveBrokerAccountId(appId, cibcId);
          }
        }
      }
    } catch (e) {
      setErr(e?.message || "Reconciliation failed");
    } finally {
      setBusy(false);
    }
  };

  const fmt$ = (n) => n == null ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="sa-card" style={{ marginBottom: 14 }}>
      <h3>Reconcile holdings with broker</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Drag in the AccountHoldings CSV files you downloaded from CIBC Investor's Edge. <b>Combined Holdings</b> exports (one file per account, contains both currencies) are recommended — 3 files cover everything. The older single-sub format (6 files for 3 accounts × 2 currencies) also works. The app flags discrepancies in quantity and cash balance — read-only, no auto-correct.
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "2px dashed var(--sa-border)",
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          background: "var(--sa-panel-2)",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 14, marginBottom: 6 }}>📁 Drag CSV files here, or</div>
        <label className="sa-btn secondary" style={{ display: "inline-block", cursor: "pointer", fontSize: 13 }}>
          Browse for files
          <input type="file" accept=".csv" multiple onChange={onPickFiles} style={{ display: "none" }} />
        </label>
        <div className="sa-muted" style={{ fontSize: 11, marginTop: 8 }}>
          Tip: in CIBC Investor's Edge, go to Accounts → Holdings → click "Combined Holdings" view → CSV download. Repeat for each account (Non-Spousal, Spousal, TFSA). You'll get 3 files that cover everything.
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Files staged ({files.length}):</div>
          <div style={{ display: "grid", gap: 4 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "var(--sa-panel-2)", borderRadius: 6, fontSize: 12 }}>
                <span>{f.filename}</span>
                <button className="sa-btn ghost" onClick={() => removeFile(i)} style={{ fontSize: 11, padding: "2px 8px" }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
        {(files.length > 0 || diff) && <button className="sa-btn ghost" onClick={reset} disabled={busy}>Clear</button>}
        <button className="sa-btn" onClick={runReconcile} disabled={busy || files.length === 0}>
          {busy ? "Reconciling…" : `🔍 Reconcile ${files.length} file${files.length === 1 ? "" : "s"}`}
        </button>
      </div>

      {err && <div className="sa-err">{err}</div>}

      {diff && diff.accounts && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--sa-border)" }}>
          {(() => {
            // Build the unique set of CIBC account ids that came through
            // parsing, so we can show a mapping row for each.
            const cibcAcctsSeen = [];
            const seen = new Set();
            for (const pf of diff.parsedFiles || []) {
              if (!pf?.accountId || seen.has(pf.accountId)) continue;
              seen.add(pf.accountId);
              cibcAcctsSeen.push({ id: pf.accountId, name: pf.accountName });
            }
            const anyUnmatched = (diff.accounts || []).some((a) => a.unmatched);
            if (cibcAcctsSeen.length === 0) return null;
            return (
              <div style={{ background: "var(--sa-panel-2)", padding: 12, borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Map CIBC accounts → app accounts
                </div>
                <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  {anyUnmatched
                    ? "Your app account ids don't match the CIBC numbers. Pick the matching app account for each CIBC account below, then click Reconcile again. Mappings are saved so future uploads auto-match."
                    : "Auto-matched (from saved mappings). Override any if you've reorganized accounts."}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {cibcAcctsSeen.map((cibc) => (
                    <div key={cibc.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10, alignItems: "center", fontSize: 12 }}>
                      <div>
                        <b>{cibc.name}</b>
                        <span className="sa-muted" style={{ marginLeft: 6 }}>(CIBC id {cibc.id})</span>
                      </div>
                      <select
                        value={accountMap[cibc.id] || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAccountMap((prev) => {
                            const next = { ...prev };
                            if (v) next[cibc.id] = v;
                            else delete next[cibc.id];
                            return next;
                          });
                        }}
                      >
                        <option value="">— pick app account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} (id {a.id})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {anyUnmatched && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button className="sa-btn" onClick={runReconcile} disabled={busy}>
                      {busy ? "Reconciling…" : "Reconcile with mapping"}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Results ({diff.parsedFiles.length} files parsed, {diff.accounts.length} accounts checked)
              {resolvedKeys.size > 0 && (
                <span className="sa-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                  · {resolvedKeys.size} rectified
                </span>
              )}
            </div>
            <button
              className="sa-btn secondary"
              onClick={runReconcile}
              disabled={busy || files.length === 0}
              style={{ fontSize: 12 }}
              title="Re-run reconciliation against your latest portfolio state — useful after rectifying discrepancies."
            >
              {busy ? "Rechecking…" : "🔄 Recheck"}
            </button>
          </div>

          {diff.accounts.length === 0 && (
            <div className="sa-muted" style={{ fontSize: 13 }}>No accounts to compare.</div>
          )}

          {diff.accounts.map((a, i) => {
            if (a.unmatched) {
              return (
                <div key={i} className="sa-card" style={{ background: "var(--sa-amber-soft)", borderColor: "var(--sa-amber)", marginBottom: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--sa-amber)" }}>⚠ Unmatched: {a.accountName} (id {a.acctId})</div>
                  <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>{a.message}</div>
                </div>
              );
            }
            if (a.appOnly) {
              return (
                <div key={i} className="sa-card" style={{ background: "var(--sa-panel-2)", marginBottom: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.accountName} — not in upload</div>
                  <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>{a.message}</div>
                </div>
              );
            }
            if (a.clean) {
              return (
                <div key={i} className="sa-card" style={{ background: "var(--sa-green-soft)", borderColor: "#bbf7d0", marginBottom: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--sa-green)" }}>✓ {a.accountName} — matches CIBC exactly</div>
                  <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Cash: {fmt$(a.app.cashCad)} CAD + {fmt$(a.app.cashUsd)} USD · Positions: {a.app.positionsCount}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="sa-card" style={{ background: "#fef2f2", borderColor: "#fecaca", marginBottom: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#b91c1c" }}>⚠ {a.accountName} — {a.issues.length} discrepanc{a.issues.length === 1 ? "y" : "ies"}</div>
                <div className="sa-muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 10 }}>
                  App says: {fmt$(a.app.cashCad)} CAD · {fmt$(a.app.cashUsd)} USD · {a.app.positionsCount} positions{" → "}
                  CIBC says: {fmt$(a.csv.cashCad)} CAD · {fmt$(a.csv.cashUsd)} USD · {a.csv.positionsCount} positions
                </div>
                <table style={{ width: "100%", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr style={{ color: "var(--sa-muted)", textAlign: "left" }}>
                      <th style={{ padding: "4px 6px", fontWeight: 500 }}>Type</th>
                      <th style={{ padding: "4px 6px", fontWeight: 500 }}>Item</th>
                      <th style={{ padding: "4px 6px", fontWeight: 500, textAlign: "right" }}>App</th>
                      <th style={{ padding: "4px 6px", fontWeight: 500, textAlign: "right" }}>CIBC</th>
                      <th style={{ padding: "4px 6px", fontWeight: 500, textAlign: "right" }}>Delta</th>
                      <th style={{ padding: "4px 6px", fontWeight: 500, textAlign: "right" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.issues.map((issue, j) => {
                      const k = issueKey(a.appAccountId || a.acctId, issue);
                      const isResolved = resolvedKeys.has(k);
                      const rowStyle = {
                        borderTop: "1px solid #fecaca",
                        opacity: isResolved ? 0.45 : 1,
                        textDecoration: isResolved ? "line-through" : "none",
                      };
                      const isPosIssue = issue.type === "position";
                      const isExtra = isPosIssue && issue.kind === "extra_in_app";
                      const adjustLabel = !isPosIssue
                        ? `Set ${a.accountName} ${issue.currency} cash to ${fmt$(issue.csvValue)}`
                        : issue.kind === "extra_in_app"
                          ? `Delete ${issue.appQty} sh ${issue.csvTicker || issue.ticker} from ${a.accountName} (no trade recorded)`
                          : issue.kind === "missing_in_app"
                            ? `Add ${issue.csvQty} sh ${issue.csvTicker || issue.ticker} to ${a.accountName} at cost basis $${issue.csvPrice} (no trade recorded)`
                            : `Set ${issue.csvTicker || issue.ticker} qty in ${a.accountName} to ${issue.csvQty} (no trade recorded — current ${issue.appQty})`;
                      const rectifyBtn = !isResolved && (
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          {isPosIssue && (
                            <button
                              className="sa-btn"
                              onClick={() => handleRectify(a, issue)}
                              style={{ fontSize: 11, padding: "3px 10px" }}
                              title="Opens trade modal — enter your actual fill price and record as a journal trade. Use when this represents a real BUY/SELL that isn't in the app yet."
                            >Trade</button>
                          )}
                          <button
                            className="sa-btn ghost"
                            onClick={() => {
                              if (confirm(`${adjustLabel}.\n\nUse Adjust only when this is a data-hygiene fix — dividends, corporate actions, prior manual entries, or trades already recorded elsewhere. No trade will be journaled and no P&L will be attributed.`)) {
                                handleRectify(a, issue, { silent: true });
                              }
                            }}
                            style={{ fontSize: 11, padding: "3px 10px" }}
                            title={isPosIssue
                              ? "Directly set the position qty to CIBC's number. No trade recorded. Use for dividends, corporate actions, or when the trade was booked elsewhere."
                              : "Directly set the cash balance to CIBC's number. No trade recorded. Use for dividends, interest, FX conversions."}
                          >Adjust</button>
                        </div>
                      );
                      const resolvedBadge = isResolved && (
                        <span style={{ fontSize: 11, color: "var(--sa-green)" }}>✓ rectified</span>
                      );
                      if (issue.type === "cash") {
                        return (
                          <tr key={j} style={rowStyle}>
                            <td style={{ padding: "4px 6px" }}>Cash</td>
                            <td style={{ padding: "4px 6px" }}>{issue.currency}</td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}><span className="sa-amount">{fmt$(issue.appValue)}</span></td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}><span className="sa-amount">{fmt$(issue.csvValue)}</span></td>
                            <td style={{ padding: "4px 6px", textAlign: "right", color: issue.delta < 0 ? "#b91c1c" : "var(--sa-green)" }}>
                              <span className="sa-amount">{issue.delta > 0 ? "+" : ""}{fmt$(issue.delta)}</span>
                            </td>
                            <td style={{ padding: "4px 6px", textAlign: "right" }}>{rectifyBtn}{resolvedBadge}</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={j} style={rowStyle}>
                          <td style={{ padding: "4px 6px" }}>
                            {issue.kind === "missing_in_app" && "Missing"}
                            {issue.kind === "extra_in_app" && "Extra"}
                            {issue.kind === "qty_mismatch" && "Qty"}
                          </td>
                          <td style={{ padding: "4px 6px" }}>
                            <b>{issue.csvTicker || issue.ticker}</b> <span className="sa-muted">({issue.subCurrency} sub)</span>
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{issue.appQty.toLocaleString()}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{issue.csvQty.toLocaleString()}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right", color: issue.delta < 0 ? "#b91c1c" : "var(--sa-green)" }}>
                            {issue.delta > 0 ? "+" : ""}{issue.delta.toLocaleString()}
                          </td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{rectifyBtn}{resolvedBadge}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(() => {
                  const unresolved = a.issues.filter((iss) => !resolvedKeys.has(issueKey(a.appAccountId || a.acctId, iss)));
                  const cashOnly = unresolved.filter((iss) => iss.type === "cash");
                  const positions = unresolved.filter((iss) => iss.type === "position");
                  if (unresolved.length <= 1) return null;
                  return (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                      {positions.length > 0 && (
                        <div className="sa-muted" style={{ fontSize: 11, alignSelf: "center" }}>
                          {positions.length} position discrepanc{positions.length === 1 ? "y" : "ies"} — Rectify individually to set fill price
                        </div>
                      )}
                      {cashOnly.length > 0 && (
                        <button
                          className="sa-btn secondary"
                          style={{ fontSize: 11 }}
                          onClick={() => {
                            for (const iss of cashOnly) {
                              handleRectify(a, iss);
                            }
                          }}
                        >Rectify {cashOnly.length} cash row{cashOnly.length === 1 ? "" : "s"} in {a.accountName}</button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PositionModal({ user, idx, onClose, onSave, onDelete }) {
  const existing = idx != null
    ? user.positions[idx]
    : { ticker: "", name: "", qty: 0, ccy: "USD", priceUsd: 0, priceCad: null, acct: user.accounts[0]?.id || "" };
  const [form, setForm] = useState(existing);
  const update = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="sa-modal-bg" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{idx == null ? "Add position" : "Edit position"}</h3>
        <div className="sa-modal-row">
          <div><label>Ticker</label><input value={form.ticker} onChange={(e) => update("ticker", e.target.value)} placeholder="AAPL" /></div>
          <div><label>Account</label>
            <select value={form.acct} onChange={(e) => update("acct", e.target.value)}>
              {user.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="sa-modal-row">
          <div><label>Name (optional)</label><input value={form.name || ""} onChange={(e) => update("name", e.target.value)} /></div>
          <div><label>Market (where stock trades)</label>
            <select value={form.ccy} onChange={(e) => {
              update("ccy", e.target.value);
              // If subCcy hasn't been manually set, follow the market change
              if (!form.subCcy) update("subCcy", e.target.value);
            }}>
              <option value="USD">USD (NYSE/NASDAQ)</option>
              <option value="CAD">CAD (TSX)</option>
            </select>
          </div>
        </div>
        <div className="sa-modal-row">
          <div>
            <label>Held in sub-account</label>
            <select value={form.subCcy || form.ccy} onChange={(e) => update("subCcy", e.target.value)}>
              <option value="USD">USD sub-account</option>
              <option value="CAD">CAD sub-account</option>
            </select>
            {form.subCcy && form.subCcy !== form.ccy && (
              <div style={{ fontSize: 11, color: "var(--sa-amber)", marginTop: 6, padding: 8, background: "var(--sa-amber-soft)", borderRadius: 6, border: "1px solid #fde68a" }}>
                ⚠ Cross-currency: {form.ccy} stock held in {form.subCcy} sub. There's FX friction when you bought and there will be again when you sell.
              </div>
            )}
          </div>
          <div></div>
        </div>
        <div className="sa-modal-row three">
          <div><label>Quantity</label><input type="number" step="any" value={form.qty} onChange={(e) => update("qty", parseFloat(e.target.value) || 0)} /></div>
          <div><label>Price (USD)</label><input type="number" step="any" value={form.priceUsd ?? ""} onChange={(e) => update("priceUsd", parseFloat(e.target.value) || null)} /></div>
          <div><label>Price (CAD)</label><input type="number" step="any" value={form.priceCad ?? ""} onChange={(e) => update("priceCad", parseFloat(e.target.value) || null)} /></div>
        </div>
        <div className="sa-modal-row">
          <div>
            <label>Cost basis per share (USD)</label>
            <input type="number" step="any" value={form.costBasisUsd ?? ""} onChange={(e) => update("costBasisUsd", parseFloat(e.target.value) || null)} placeholder="Your avg buy price" />
          </div>
          <div>
            <label>Cost basis per share (CAD)</label>
            <input type="number" step="any" value={form.costBasisCad ?? ""} onChange={(e) => update("costBasisCad", parseFloat(e.target.value) || null)} placeholder="Your avg buy price" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 4, background: "var(--sa-panel-2)", padding: 8, borderRadius: 6 }}>
          💡 Enter cost basis (your avg purchase price per share) to enable the position P/L column on Advice cards. Use whichever currency matches the position above. If you don't know exact basis, use a reasonable average — you can update later.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          {idx != null && <button className="sa-btn danger" onClick={onDelete}>Delete</button>}
          <button className="sa-btn secondary" onClick={onClose}>Cancel</button>
          <button className="sa-btn" onClick={() => {
            const p = { ...form, ticker: (form.ticker || "").trim().toUpperCase(), name: (form.name || "").trim() };
            if (!p.ticker || !p.qty) { alert("Ticker and quantity required."); return; }
            onSave(p);
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// RecsTable — renders an array of parsed trade recommendations as a structured
// table inside an advice card body. Each row has an Execute button that
// opens the trade modal pre-populated with that rec's details.
// =============================================================================
// Cycles a rec's user-stated intent through: none → executed → skipped → none.
// Rendered as a compact chip; independent from the trade-journal execution.
function RecIntentChip({ intent, onCycle, disabled }) {
  const styles = intent === "executed"
    ? { bg: "#dcfce7", fg: "#14532d", label: "✓ Executed", title: "You marked this rec as executed. Click to switch to Skipped." }
    : intent === "skipped"
      ? { bg: "#f3f4f6", fg: "#374151", label: "− Skipped", title: "You marked this rec as consciously skipped. Click to clear." }
      : { bg: "transparent", fg: "var(--sa-muted)", label: "◯ mark", title: "Click to mark this rec Executed (intent — independent from the trade journal / poller)." };
  const nextIntent = intent === "executed" ? "skipped" : intent === "skipped" ? null : "executed";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCycle(nextIntent)}
      title={styles.title}
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "3px 8px", borderRadius: 999,
        fontSize: 10.5, fontWeight: 600, textTransform: "none",
        border: intent ? "1px solid transparent" : "1px dashed var(--sa-border)",
        background: styles.bg, color: styles.fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >{styles.label}</button>
  );
}

function RecsTable({ recs, onExecuteRec, executedRecKeys, recKey, pnlMap, intentMap, onSetIntent }) {
  return (
    <div style={{
      border: "1px solid var(--sa-border)", borderRadius: 10,
      overflowX: "auto", margin: "10px 0",
      background: "#fff",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--sa-panel-2)" }}>
            <th style={recHeaderCellLeft}>Action</th>
            <th style={recHeaderCell}>Ticker</th>
            <th style={recHeaderCell}>Position P/L</th>
            <th style={recHeaderCell}>Qty</th>
            <th style={recHeaderCell}>Entry</th>
            <th style={recHeaderCell}>Target</th>
            <th style={recHeaderCell}>Stop</th>
            <th style={recHeaderCell}>Horizon</th>
            <th style={recHeaderCell}>Uses</th>
            <th style={recHeaderCell}></th>
          </tr>
        </thead>
        <tbody>
          {recs.map((r, i) => {
            const isExecuted = executedRecKeys && recKey && executedRecKeys.has(recKey(r));
            const pnl = pnlMap?.[r.ticker];

            const sideColor =
              r.side === "BUY" ? "var(--sa-green)"
              : r.side === "SELL" || r.side === "TRIM" ? "var(--sa-red)"
              : "var(--sa-amber)";
            const sideBg =
              r.side === "BUY" ? "var(--sa-green-soft)"
              : r.side === "SELL" || r.side === "TRIM" ? "var(--sa-red-soft)"
              : "var(--sa-amber-soft)";

            const rowBg = isExecuted ? "var(--sa-green-soft)" : "transparent";
            const rowBorder = isExecuted ? "1px solid #86efac" : (i > 0 ? "1px solid var(--sa-border)" : "none");

            return (
              <tr key={i} style={{ borderTop: rowBorder, background: rowBg, transition: "background .3s ease" }}>
                <td style={recCellLeft}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: sideBg, color: sideColor,
                  }}>{r.side}</span>
                </td>
                <td style={{ ...recCell, fontWeight: 600 }}>{r.ticker}</td>
                <td style={recCell}>
                  {!pnl || pnl.qty === 0 ? (
                    <span style={{ color: "var(--sa-muted)", fontSize: 11 }}>no position</span>
                  ) : pnl.pnlPct == null ? (
                    <span title="No cost basis on file for this ticker. Edit the position to add it." style={{ color: "var(--sa-muted)", fontSize: 11, fontStyle: "italic" }}>
                      no basis
                    </span>
                  ) : (
                    <div style={{ lineHeight: 1.25 }} className="sa-amount">
                      <div style={{ color: pnl.pnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)", fontWeight: 600 }}>
                        {pnl.pnlPct >= 0 ? "+" : ""}{pnl.pnlPct.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 10, color: pnl.pnlCad >= 0 ? "var(--sa-green)" : "var(--sa-red)", opacity: 0.85 }}>
                        {pnl.pnlCad >= 0 ? "+" : "−"}${Math.abs(pnl.pnlCad).toLocaleString(undefined, { maximumFractionDigits: 0 })} CAD
                      </div>
                    </div>
                  )}
                </td>
                <td style={recCell}>{r.shares ? r.shares.toLocaleString() : "—"}</td>
                <td style={recCell}>{r.entryText || "—"}</td>
                <td style={recCell}>{r.targetText || "—"}</td>
                <td style={recCell}>{r.stopText || "—"}</td>
                <td style={recCell}>{r.horizonText || "—"}</td>
                <td style={recCell}>{r.usesText || "—"}</td>
                <td style={recCell}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    {r.recId && onSetIntent && r.side !== "HOLD" && (
                      <RecIntentChip
                        intent={intentMap?.[r.recId] || null}
                        onCycle={(next) => onSetIntent(r, next)}
                      />
                    )}
                    {isExecuted ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: "var(--sa-green)", color: "#fff",
                      }}>
                        ✓ Recorded
                      </span>
                    ) : onExecuteRec && r.side !== "HOLD" ? (
                      <button
                        className="sa-btn"
                        style={{ padding: "5px 12px", fontSize: 12 }}
                        onClick={() => onExecuteRec(r)}
                        title="Open the Record Trade modal with this rec pre-filled"
                      >Record →</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const recHeaderCell = { padding: "10px 8px", textAlign: "right", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", fontWeight: 600, borderBottom: "1px solid var(--sa-border)", whiteSpace: "nowrap" };
const recHeaderCellLeft = { ...recHeaderCell, textAlign: "left", paddingLeft: 14 };
const recCell = { padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" };
const recCellLeft = { ...recCell, textAlign: "left", paddingLeft: 14 };

// =============================================================================
// Briefing preview modal — shows what the daily email will look like
// =============================================================================
function BriefingPreviewModal({ preview, recipient, onClose, onSend, onRetry, title, loadingLabel, loadingDetail }) {
  const { busy, html, error, sent, sendError, subject, messageId, ccSends } = preview;
  const headerTitle = title || "Email Briefing — Preview";
  const loadLabel = loadingLabel || "Generating briefing…";
  const loadDetail = loadingDetail || "Pulling news, fundamentals, technicals, macro context, and earnings signals across your holdings · 20-40s";

  // Estimated-progress bar for the busy state. The backend doesn't stream
  // real progress from /send-briefing (single POST), so we animate an
  // exponential-approach curve toward 95% over ~45s. Feels responsive
  // AND stays honest — the bar never claims to be "done" until the
  // response actually arrives. Stage labels cycle through the pipeline
  // in the same order the backend runs it, timed by elapsed seconds.
  const [progress, setProgress] = useState(0);
  const [stageLabel, setStageLabel] = useState("Loading portfolio & holdings…");
  useEffect(() => {
    if (!busy || html) return;
    const startedAt = Date.now();
    const stages = [
      { after:  0, label: "Loading portfolio & holdings…" },
      { after:  3, label: "Fetching macro context, Fed liquidity, sector rotation…" },
      { after:  6, label: "Fetching per-holding technicals, fundamentals, catalysts, options…" },
      { after: 12, label: "Fetching short interest, insider filings, transcripts, patents…" },
      { after: 18, label: "Running Anthropic Sonnet with web search — this is the slow part…" },
      { after: 45, label: "Composing the briefing narrative…" },
      { after: 75, label: "Still working — long briefings can push past 90s…" },
    ];
    const tick = () => {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      // Asymptote at 95% — reserve the last 5% for the actual response.
      const pct = 95 * (1 - Math.exp(-elapsedSec / 20));
      setProgress(pct);
      // Pick the deepest stage whose `after` we've passed.
      const active = stages.filter((s) => elapsedSec >= s.after).slice(-1)[0];
      if (active) setStageLabel(active.label);
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [busy, html]);
  // When html arrives, snap to 100% briefly before the modal transitions.
  useEffect(() => { if (html) setProgress(100); }, [html]);

  return (
    <div className="sa-modal-bg" onClick={onClose}>
      <div
        className="sa-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{headerTitle}</h3>
          <button className="sa-btn ghost" onClick={onClose} disabled={busy} style={{ padding: "4px 10px" }}>✕</button>
        </div>

        {/* Loading */}
        {busy && !html && (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--sa-text-2)", marginBottom: 12, fontWeight: 600 }}>{loadLabel}</div>
            <div style={{
              width: "100%", height: 10, background: "var(--sa-panel-2)",
              borderRadius: 999, overflow: "hidden", marginBottom: 10,
              border: "1px solid var(--sa-border)",
            }}>
              <div style={{
                width: `${progress.toFixed(1)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #2563eb, #7c3aed)",
                transition: "width 300ms ease-out",
                borderRadius: 999,
              }} />
            </div>
            <div style={{ fontSize: 11, fontFamily: "SF Mono, Menlo, Consolas, monospace", color: "var(--sa-muted)", marginBottom: 6 }}>
              {progress.toFixed(0)}%
            </div>
            <div style={{ fontSize: 12, color: "var(--sa-text-2)", fontStyle: "italic" }}>{stageLabel}</div>
            <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 10 }}>{loadDetail}</div>
            {preview.hint && (
              <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 8, padding: "6px 10px", background: "var(--sa-panel-2)", borderRadius: 6, display: "inline-block" }}>
                ↺ {preview.hint}
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (() => {
          // "Failed to fetch" from the browser is a TypeError raised when
          // the connection dies at the transport layer — usually a Render
          // cold-start on a request the client dropped. Not a real 5xx
          // from our server. Show a friendlier message with a Retry.
          const isTransient = /failed to fetch|networkerror|load failed|the network connection was lost|timed? ?out|aborted|econnreset/i.test(String(error));
          const bg = isTransient ? "#fef3c7" : "#fee2e2";
          const border = isTransient ? "#fbbf24" : "#fca5a5";
          const fg = isTransient ? "#78350f" : "#7f1d1d";
          const label = isTransient
            ? "The briefing pipeline didn't respond in time — most often a Render dyno cold-start. Retry usually works on the second attempt."
            : error;
          return (
            <div style={{ padding: "16px 18px", background: bg, border: `1px solid ${border}`, borderRadius: 8, color: fg }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {isTransient ? "⚠ Briefing didn't come back" : "Briefing failed"}
              </div>
              <div style={{ fontSize: 12.5, marginBottom: 10 }}>{label}</div>
              {isTransient && (
                <div style={{ fontSize: 11, color: fg, opacity: 0.85, marginBottom: 10 }}>
                  Raw error: <code>{String(error)}</code>
                </div>
              )}
              {onRetry && (
                <button className="sa-btn" onClick={onRetry} style={{ padding: "6px 14px" }}>
                  Retry
                </button>
              )}
            </div>
          );
        })()}

        {/* Preview ready */}
        {html && (
          <>
            <div style={{ fontSize: 13, color: "var(--sa-muted)", marginBottom: 12 }}>
              <b style={{ color: "var(--sa-text)" }}>Subject:</b> {subject}<br/>
              <b style={{ color: "var(--sa-text)" }}>To:</b> {recipient}
            </div>

            <div style={{
              border: "1px solid var(--sa-border)", borderRadius: 12, overflow: "hidden",
              background: "#fff", maxHeight: "55vh", overflowY: "auto",
              marginBottom: 14,
            }}>
              {/* iframe sandboxes the inline styles from the email body */}
              <iframe
                title="Briefing preview"
                srcDoc={html}
                sandbox=""
                style={{ width: "100%", height: "55vh", border: "none", display: "block" }}
              />
            </div>

            {sent && (
              <div style={{ background: "var(--sa-green-soft)", color: "var(--sa-green)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12, border: "1px solid #bbf7d0" }}>
                <div>✓ Queued at Resend → <b>{recipient}</b></div>
                {messageId && (
                  <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85, fontFamily: "SF Mono, Menlo, Consolas, monospace" }}>
                    Resend message id: {messageId}
                  </div>
                )}
                {Array.isArray(ccSends) && ccSends.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(5,150,105,.2)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Per-account recipients (single-account reports):</div>
                    {ccSends.map((cc, i) => (
                      <div key={i} style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>
                        {cc.sent ? "✓" : "✗"} <b>{cc.accountName}</b> → {cc.email}
                        {cc.messageId && <span style={{ fontFamily: "SF Mono, Menlo, Consolas, monospace", marginLeft: 6, opacity: 0.7 }}>({cc.messageId.slice(0, 12)}…)</span>}
                        {cc.error && <span style={{ color: "var(--sa-red)", marginLeft: 6 }}>— {cc.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
                  Doesn't show up in your inbox in 2 min? Check spam/junk first. If still missing, look up the message id in the Resend dashboard — that's the ground truth on delivery.
                </div>
              </div>
            )}
            {sendError && (
              <div className="sa-err" style={{ marginBottom: 12 }}>Email send failed: {sendError}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="sa-btn secondary" onClick={onClose} disabled={busy}>Close</button>
              {!sent && (
                <button className="sa-btn" onClick={onSend} disabled={busy}>
                  {busy ? "Sending…" : `📧 Send to ${recipient}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Trade modal — Buy / Sell / Swap
// =============================================================================
function TradeModal({ user, onClose, onSubmit, onSubmitPending, prefill }) {
  // Decide initial mode + leg pre-population based on prefill.
  // BUY → buy mode; SELL/TRIM → sell mode; WITHDRAW/DEPOSIT → cash mode.
  const initialMode = prefill
    ? (prefill.side === "BUY" ? "buy"
        : (prefill.side === "SELL" || prefill.side === "TRIM") ? "sell"
        : (prefill.side === "WITHDRAW" || prefill.side === "DEPOSIT") ? "cash"
        : "swap")
    : "swap";
  const [mode, setMode] = useState(initialMode);
  const [account, setAccount] = useState(prefill?.accountId || user.accounts?.[0]?.id || "");
  const [executedAt] = useState(() => new Date().toISOString().slice(0, 10));

  // Equity leg state (prefilled when a rec is being executed)
  const [sellTicker, setSellTicker] = useState(prefill && (prefill.side === "SELL" || prefill.side === "TRIM") ? prefill.ticker : "");
  const [sellShares, setSellShares] = useState(prefill && (prefill.side === "SELL" || prefill.side === "TRIM") && prefill.shares ? String(prefill.shares) : "");
  const [sellPrice, setSellPrice] = useState(prefill && (prefill.side === "SELL" || prefill.side === "TRIM") && prefill.entryLow ? String(prefill.entryLow) : "");
  const [sellCcy, setSellCcy] = useState(prefill && (prefill.side === "SELL" || prefill.side === "TRIM") ? (prefill.currency || "USD") : "USD");

  const [buyTicker, setBuyTicker] = useState(prefill && prefill.side === "BUY" ? prefill.ticker : "");
  const [buyShares, setBuyShares] = useState(prefill && prefill.side === "BUY" && prefill.shares ? String(prefill.shares) : "");
  const [buyPrice, setBuyPrice] = useState(prefill && prefill.side === "BUY" && prefill.entryLow ? String(prefill.entryLow) : "");
  const [buyCcy, setBuyCcy] = useState(prefill && prefill.side === "BUY" ? (prefill.currency || "USD") : "CAD");
  // Sub-account the BUY settles through. Defaults to ticker's market currency
  // (no FX). Flip to the other when buying USD stock from CAD cash etc.
  const [buySubCcy, setBuySubCcy] = useState(prefill && prefill.side === "BUY" ? (prefill.currency || "USD") : "CAD");

  // Cash leg state — prefilled if this opens from an "Execute" on a planned WD
  const [cashDirection, setCashDirection] = useState(
    prefill?.side === "WITHDRAW" ? "WITHDRAW" : prefill?.side === "DEPOSIT" ? "DEPOSIT" : "DEPOSIT"
  );
  const [cashAmount, setCashAmount] = useState(prefill?.amount ? String(prefill.amount) : "");
  const [cashCcy, setCashCcy] = useState(prefill?.currency || "CAD");

  // Transfer state — move cash from one account/currency to another
  const [xferFromAcct, setXferFromAcct] = useState(user.accounts?.[0]?.id || "");
  const [xferFromCcy, setXferFromCcy] = useState("CAD");
  const [xferToAcct, setXferToAcct] = useState(user.accounts?.[1]?.id || user.accounts?.[0]?.id || "");
  const [xferToCcy, setXferToCcy] = useState("CAD");
  const [xferAmount, setXferAmount] = useState("");

  // Order-plan state — comes from the prefill if executing a rec.
  // Target = expected upside (limit-sell take-profit)
  // Stop   = downside invalidation (stop-limit-sell)
  const [planTarget, setPlanTarget] = useState(prefill?.targetVal != null ? String(prefill.targetVal) : "");
  const [planStop, setPlanStop] = useState(prefill?.stopVal != null ? String(prefill.stopVal) : "");
  const [showPlan, setShowPlan] = useState(prefill?.targetVal != null || prefill?.stopVal != null);

  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const fx = user.fxUsdCad || 1.37;
  const sellNum = parseFloat(sellShares) * parseFloat(sellPrice);
  const buyNum = parseFloat(buyShares) * parseFloat(buyPrice);
  const sellCadVal = isNaN(sellNum) ? 0 : (sellCcy === "USD" ? sellNum * fx : sellNum);
  const buyCadVal = isNaN(buyNum) ? 0 : (buyCcy === "USD" ? buyNum * fx : buyNum);

  const cashAmtNum = parseFloat(cashAmount);
  const cashCadVal = isNaN(cashAmtNum) ? 0 : (cashCcy === "USD" ? cashAmtNum * fx : cashAmtNum);

  // Cash impact: positive = cash in, negative = cash used
  let netCash = 0;
  if (mode === "buy") netCash = -buyCadVal;
  else if (mode === "sell") netCash = sellCadVal;
  else if (mode === "swap") netCash = sellCadVal - buyCadVal;
  else if (mode === "cash") netCash = cashDirection === "DEPOSIT" ? cashCadVal : -cashCadVal;
  else if (mode === "transfer") netCash = 0; // moving cash, not adding/removing

  // Tickers visible in the user's portfolio for BUY autocomplete suggestion
  const ownedTickers = [...new Set(user.positions.map(p => p.ticker))];

  // SELL sub-account inherited from the chosen holding (where it lives).
  // When opened via Rectify-as-Trade, we know the sub already (the
  // discrepancy carries it) so we pre-populate to spare the user a click.
  const [sellSubCcy, setSellSubCcy] = useState(
    prefill && (prefill.side === "SELL" || prefill.side === "TRIM") && prefill.currency
      ? prefill.currency
      : "USD"
  );

  // Aggregate holdings by (ticker, market, sub) so each lot is selectable.
  // A USD stock parked in the CAD sub is a separate dropdown option from the
  // same stock in the USD sub.
  const accountHoldings = useMemo(() => {
    const m = new Map();
    for (const p of user.positions) {
      if (p.acct !== account) continue;
      const sub = p.subCcy || p.ccy;
      const key = `${p.ticker}|${p.ccy}|${sub}`;
      const last = p.ccy === "USD" ? p.priceUsd : p.priceCad;
      if (!m.has(key)) {
        m.set(key, { ticker: p.ticker, ccy: p.ccy, subCcy: sub, qty: 0, lastPrice: last, name: p.name || "" });
      }
      const h = m.get(key);
      h.qty += p.qty || 0;
      if (last && (h.lastPrice == null || h.lastPrice === 0)) h.lastPrice = last;
    }
    return [...m.values()].sort((a, b) => (b.qty * (b.lastPrice || 0)) - (a.qty * (a.lastPrice || 0)));
  }, [user.positions, account]);

  // Reset sell fields when account changes if current selection isn't valid
  useEffect(() => {
    if ((mode === "sell" || mode === "swap") && sellTicker) {
      const match = accountHoldings.find(h => h.ticker === sellTicker && h.ccy === sellCcy && (h.subCcy || h.ccy) === sellSubCcy);
      if (!match) {
        setSellTicker(""); setSellShares(""); setSellPrice(""); setSellCcy("USD"); setSellSubCcy("USD");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const selectedHolding = accountHoldings.find(h => h.ticker === sellTicker && h.ccy === sellCcy && (h.subCcy || h.ccy) === sellSubCcy) || null;
  const selectSellHolding = (key) => {
    if (!key) {
      setSellTicker(""); setSellShares(""); setSellPrice(""); setSellCcy("USD"); setSellSubCcy("USD");
      return;
    }
    const [ticker, ccy, sub] = key.split("|");
    const h = accountHoldings.find(x => x.ticker === ticker && x.ccy === ccy && x.subCcy === sub);
    if (!h) return;
    setSellTicker(h.ticker);
    setSellCcy(h.ccy);
    setSellSubCcy(h.subCcy);
    setSellShares(String(h.qty));
    setSellPrice(h.lastPrice ? String(h.lastPrice) : "");
  };

  const handleSubmit = async () => {
    setErr(null);
    if (!account) return setErr("Pick an account.");
    const legs = [];

    if (mode === "cash") {
      const a = parseFloat(cashAmount);
      if (!a || a <= 0) return setErr("Amount must be > 0.");
      legs.push({ side: cashDirection, amount: a, currency: cashCcy });
    } else if (mode === "transfer") {
      const a = parseFloat(xferAmount);
      if (!a || a <= 0) return setErr("Transfer amount must be > 0.");
      if (!xferFromAcct || !xferToAcct) return setErr("Pick source and destination accounts.");
      if (xferFromAcct === xferToAcct && xferFromCcy === xferToCcy) {
        return setErr("Source and destination are the same — nothing to transfer.");
      }
      // If currencies differ, apply FX spread cost (broker takes the spread)
      const isFxConv = xferFromCcy !== xferToCcy;
      const sourceAmount = a;
      const fxSpreadFraction = (user.fxSpreadPct ?? 1.5) / 100;
      // Convert: from CAD → USD divides by fx; USD → CAD multiplies by fx
      let destAmount = sourceAmount;
      if (isFxConv) {
        const rawRate = xferFromCcy === "CAD" ? (1 / fx) : fx;
        // Broker keeps the spread → destination receives 1 - spread of converted amount
        destAmount = sourceAmount * rawRate * (1 - fxSpreadFraction);
      }
      legs.push(
        { side: "WITHDRAW", amount: sourceAmount, currency: xferFromCcy, account: xferFromAcct },
        { side: "DEPOSIT",  amount: destAmount,   currency: xferToCcy,   account: xferToAcct }
      );
    } else {
      if (mode === "buy" || mode === "swap") {
        const s = parseFloat(buyShares); const p = parseFloat(buyPrice);
        if (!buyTicker || !s || s <= 0 || !(p >= 0)) return setErr("BUY leg needs ticker, shares > 0, and a price.");
        legs.push({
          side: "BUY",
          ticker: buyTicker.trim().toUpperCase().replace(/\.+$/, ""),
          shares: s, price: p, currency: buyCcy,
          settleCcy: buySubCcy, // which cash bucket settles + which sub the position parks in
        });
      }
      if (mode === "sell" || mode === "swap") {
        const s = parseFloat(sellShares); const p = parseFloat(sellPrice);
        if (!sellTicker || !s || s <= 0 || !(p >= 0)) return setErr("SELL leg needs ticker, shares > 0, and a price.");
        legs.unshift({
          side: "SELL",
          ticker: sellTicker.trim().toUpperCase().replace(/\.+$/, ""),
          shares: s, price: p, currency: sellCcy,
          settleCcy: sellSubCcy, // proceeds credit the same sub the position lives in
        });
      }
    }

    if (legs.length === 0) return setErr("Nothing to do.");
    setBusy(true);
    try {
      await onSubmit({ account, executedAt: new Date(executedAt + "T12:00:00").toISOString(), legs, notes });
    } catch (e) {
      setErr(e?.message || "Trade failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sa-modal-bg" onClick={onClose}>
      <div className="sa-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>Record a trade</h3>

        {/* Mode picker */}
        <div style={{ display: "flex", gap: 6, background: "var(--sa-panel-2)", padding: 4, borderRadius: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {[
            ["buy", "Buy"],
            ["sell", "Sell"],
            ["swap", "Swap"],
            ["cash", "Cash"],
            ["transfer", "Transfer"],
          ].map(([v, label]) => (
            <button
              key={v}
              className={`sa-btn ${mode === v ? "" : "ghost"}`}
              style={{ flex: 1, padding: "8px 10px", boxShadow: "none", background: mode === v ? "var(--sa-accent)" : "transparent", color: mode === v ? "#fff" : "var(--sa-text-2)" }}
              onClick={() => setMode(v)}
            >{label}</button>
          ))}
        </div>

        <div className="sa-modal-row">
          <div>
            <label>Account</label>
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              {user.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label>Date</label>
            <input type="date" defaultValue={executedAt} />
          </div>
        </div>

        {/* SELL leg */}
        {(mode === "sell" || mode === "swap") && (
          <div style={{ background: "var(--sa-red-soft)", border: "1px solid #fecaca", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--sa-red)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Sell</div>

            <div className="sa-modal-row" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <label>Position to sell from</label>
                {accountHoldings.length === 0 ? (
                  <div style={{ padding: "10px 12px", background: "#fff", border: "1.5px solid var(--sa-border)", borderRadius: 10, color: "var(--sa-muted)", fontSize: 13 }}>
                    No positions in this account.
                  </div>
                ) : (
                  <select value={sellTicker && sellCcy && sellSubCcy ? `${sellTicker}|${sellCcy}|${sellSubCcy}` : ""} onChange={(e) => selectSellHolding(e.target.value)}>
                    <option value="">— pick a holding —</option>
                    {accountHoldings.map((h) => {
                      const subLabel = h.ccy === h.subCcy ? h.ccy : `${h.ccy} stock, ${h.subCcy} sub`;
                      return (
                        <option key={`${h.ticker}|${h.ccy}|${h.subCcy}`} value={`${h.ticker}|${h.ccy}|${h.subCcy}`}>
                          {h.ticker} ({subLabel}) — {h.qty.toLocaleString()} sh{h.lastPrice ? ` · last $${h.lastPrice.toFixed(2)}` : ""}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            </div>

            {selectedHolding && (
              <>
                <div className="sa-modal-row">
                  <div>
                    <label>Shares to sell</label>
                    <input type="number" step="any" min="0" max={selectedHolding.qty}
                      value={sellShares} onChange={(e) => setSellShares(e.target.value)} placeholder="250" />
                    <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                      <span>Available: {selectedHolding.qty.toLocaleString()} sh</span>
                      <button type="button" className="sa-btn ghost" style={{ padding: "0", fontSize: 11, color: "var(--sa-accent-2)" }}
                        onClick={() => setSellShares(String(selectedHolding.qty))}>
                        Sell all
                      </button>
                    </div>
                  </div>
                  <div>
                    <label>Fill price ({sellCcy})</label>
                    <input type="number" step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="8.85" />
                    {selectedHolding.lastPrice && (
                      <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 4 }}>
                        Last known: ${selectedHolding.lastPrice.toFixed(2)} {sellCcy}
                      </div>
                    )}
                  </div>
                </div>
                {sellCadVal > 0 && (
                  <div style={{ fontSize: 12, color: "var(--sa-text-2)", marginTop: 4 }}>
                    Gross: {sellCcy === "USD" ? `$${sellNum.toFixed(2)} USD ≈ ` : ""}${sellCadVal.toFixed(2)} CAD
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* BUY leg */}
        {(mode === "buy" || mode === "swap") && (
          <div style={{ background: "var(--sa-green-soft)", border: "1px solid #bbf7d0", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--sa-green)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Buy</div>
            <div className="sa-modal-row">
              <div>
                <label>Ticker</label>
                <input value={buyTicker} onChange={(e) => setBuyTicker(e.target.value)} placeholder="ENB" list="owned-tickers" />
              </div>
              <div>
                <label>Market (ticker currency)</label>
                <select value={buyCcy} onChange={(e) => {
                  setBuyCcy(e.target.value);
                  setBuySubCcy(e.target.value); // default sub = market when user changes market
                }}>
                  <option value="USD">USD (NYSE/NASDAQ)</option>
                  <option value="CAD">CAD (TSX)</option>
                </select>
              </div>
            </div>
            <div className="sa-modal-row">
              <div><label>Shares</label><input type="number" step="any" value={buyShares} onChange={(e) => setBuyShares(e.target.value)} placeholder="40" /></div>
              <div><label>Fill price ({buyCcy})</label><input type="number" step="any" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="75.50" /></div>
            </div>
            <div className="sa-modal-row" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <label>Settle from cash bucket</label>
                <select value={buySubCcy} onChange={(e) => setBuySubCcy(e.target.value)}>
                  <option value="USD">USD sub-account cash</option>
                  <option value="CAD">CAD sub-account cash</option>
                </select>
                {buySubCcy !== buyCcy && (
                  <div style={{ fontSize: 11, color: "var(--sa-amber)", marginTop: 6, padding: 8, background: "var(--sa-amber-soft)", borderRadius: 6, border: "1px solid #fde68a" }}>
                    ⚠ Cross-currency: buying {buyCcy} stock with {buySubCcy} cash triggers FX conversion (~{(user.fxSpreadPct ?? 1.5).toFixed(2)}% spread). The position will be parked in the {buySubCcy} sub.
                  </div>
                )}
              </div>
            </div>
            {buyCadVal > 0 && (
              <div style={{ fontSize: 12, color: "var(--sa-text-2)", marginTop: 4 }}>
                Gross: {buyCcy === "USD" ? `$${buyNum.toFixed(2)} USD ≈ ` : ""}${buyCadVal.toFixed(2)} CAD
              </div>
            )}
          </div>
        )}

        {/* TRANSFER leg — move cash between accounts (and currencies) */}
        {mode === "transfer" && (() => {
          const fromAcct = user.accounts.find(a => a.id === xferFromAcct);
          const toAcct = user.accounts.find(a => a.id === xferToAcct);
          const fromBalance = fromAcct ? (xferFromCcy === "USD" ? (fromAcct.cashUsd || 0) : (fromAcct.cashCad || 0)) : 0;
          const amtNum = parseFloat(xferAmount) || 0;
          const isFx = xferFromCcy !== xferToCcy;
          const fxSpread = (user.fxSpreadPct ?? 1.5) / 100;
          const rawRate = xferFromCcy === "CAD" ? (1 / fx) : fx;
          const destAmt = isFx ? amtNum * rawRate * (1 - fxSpread) : amtNum;
          return (
            <div style={{ background: "var(--sa-accent-soft)", border: "1px solid #bfdbfe", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "var(--sa-accent-2)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
                Transfer cash
              </div>
              <div className="sa-modal-row">
                <div>
                  <label>From account</label>
                  <select value={xferFromAcct} onChange={(e) => setXferFromAcct(e.target.value)}>
                    {user.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label>From currency</label>
                  <select value={xferFromCcy} onChange={(e) => setXferFromCcy(e.target.value)}>
                    <option value="CAD">CAD</option><option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="sa-modal-row">
                <div>
                  <label>To account</label>
                  <select value={xferToAcct} onChange={(e) => setXferToAcct(e.target.value)}>
                    {user.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label>To currency</label>
                  <select value={xferToCcy} onChange={(e) => setXferToCcy(e.target.value)}>
                    <option value="CAD">CAD</option><option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="sa-modal-row" style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  <label>Amount to send ({xferFromCcy})</label>
                  <input type="number" step="any" min="0" value={xferAmount}
                    onChange={(e) => setXferAmount(e.target.value)} placeholder="1000" />
                  {fromAcct && (
                    <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 4 }}>
                      Available in {fromAcct.name} {xferFromCcy}: ${fromBalance.toFixed(2)} {xferFromCcy}
                      {amtNum > fromBalance && <span style={{ color: "var(--sa-red)", marginLeft: 8 }}>⚠ exceeds balance</span>}
                    </div>
                  )}
                </div>
              </div>
              {isFx && amtNum > 0 && (
                <div style={{ background: "#fff", border: "1px solid var(--sa-border)", borderRadius: 8, padding: 10, marginTop: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="sa-muted">FX rate: {xferFromCcy} → {xferToCcy}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{rawRate.toFixed(4)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="sa-muted">Spread cost (~{(fxSpread * 100).toFixed(2)}%)</span>
                    <span style={{ color: "var(--sa-amber)", fontVariantNumeric: "tabular-nums" }}>−${(amtNum * rawRate * fxSpread).toFixed(2)} {xferToCcy}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--sa-border)", paddingTop: 6, marginTop: 6, fontWeight: 600 }}>
                    <span>{toAcct?.name || "Destination"} receives</span>
                    <span style={{ color: "var(--sa-green)", fontVariantNumeric: "tabular-nums" }}>+${destAmt.toFixed(2)} {xferToCcy}</span>
                  </div>
                </div>
              )}
              {!isFx && amtNum > 0 && (
                <div style={{ background: "#fff", border: "1px solid var(--sa-border)", borderRadius: 8, padding: 10, marginTop: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                    <span>{toAcct?.name || "Destination"} receives</span>
                    <span style={{ color: "var(--sa-green)", fontVariantNumeric: "tabular-nums" }}>+${amtNum.toFixed(2)} {xferToCcy}</span>
                  </div>
                  <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Same currency — no FX cost.
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* CASH leg (deposit/withdraw) */}
        {mode === "cash" && (() => {
          const acctRow = user.accounts.find(a => a.id === account);
          return (
            <div style={{ background: "var(--sa-accent-soft)", border: "1px solid #bfdbfe", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "var(--sa-accent-2)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Cash movement</div>
              <div className="sa-modal-row">
                <div>
                  <label>Direction</label>
                  <select value={cashDirection} onChange={(e) => setCashDirection(e.target.value)}>
                    <option value="DEPOSIT">Deposit (add cash)</option>
                    <option value="WITHDRAW">Withdraw (remove cash)</option>
                  </select>
                </div>
                <div>
                  <label>Currency</label>
                  <select value={cashCcy} onChange={(e) => setCashCcy(e.target.value)}>
                    <option value="CAD">CAD</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="sa-modal-row" style={{ gridTemplateColumns: "1fr" }}>
                <div>
                  <label>Amount ({cashCcy})</label>
                  <input type="number" step="any" min="0" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} placeholder="5000" />
                  {acctRow && (
                    <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 4 }}>
                      Current balance in this account: ${(cashCcy === "USD" ? (acctRow.cashUsd || 0) : (acctRow.cashCad || 0)).toFixed(2)} {cashCcy}
                    </div>
                  )}
                </div>
              </div>
              {cashCadVal > 0 && cashCcy === "USD" && (
                <div style={{ fontSize: 12, color: "var(--sa-text-2)", marginTop: 4 }}>
                  ≈ ${cashCadVal.toFixed(2)} CAD (at FX {fx.toFixed(3)})
                </div>
              )}
            </div>
          );
        })()}

        <div className="sa-modal-row" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <label>Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., Reduce DJT concentration per Friday's briefing" maxLength={500} />
          </div>
        </div>

        {/* Order plan — bracket / OCO instructions to paste into CIBC Investor's Edge */}
        {(mode === "buy" || mode === "sell" || mode === "swap") && (() => {
          const commission = Number(user.commissionPerTrade ?? 9.95);
          // Determine which leg drives the plan
          const isBuyDriven = (mode === "buy" || mode === "swap") && buyTicker && buyShares && buyPrice;
          const isSellDriven = mode === "sell" && sellTicker && sellShares && sellPrice;
          const driverTicker = isBuyDriven ? buyTicker.toUpperCase() : (isSellDriven ? sellTicker.toUpperCase() : "");
          const driverShares = isBuyDriven ? parseFloat(buyShares) : (isSellDriven ? parseFloat(sellShares) : 0);
          const driverPrice = isBuyDriven ? parseFloat(buyPrice) : (isSellDriven ? parseFloat(sellPrice) : 0);
          const driverCcy = isBuyDriven ? buyCcy : (isSellDriven ? sellCcy : "USD");
          if (!driverTicker || !driverShares || !driverPrice) return null;

          const target = parseFloat(planTarget);
          const stop = parseFloat(planStop);
          const hasTarget = Number.isFinite(target) && target > 0;
          const hasStop = Number.isFinite(stop) && stop > 0;
          const stopLimit = hasStop ? (driverCcy === "CAD" ? (stop * 0.985) : (stop * 0.985)) : null; // ~1.5% below stop

          // Order count for commission estimate
          let orderCount = 1;
          if (mode === "swap") orderCount = 2;
          if (isBuyDriven && hasStop) orderCount += 1;
          if (isBuyDriven && hasTarget) orderCount += 1;
          const totalCommish = orderCount * commission;

          return (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: 14, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--sa-accent-2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  📋 Order plan (CIBC Investor's Edge ready)
                </div>
                <button
                  type="button"
                  onClick={() => setShowPlan(!showPlan)}
                  style={{ background: "transparent", border: "none", color: "var(--sa-accent-2)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                >{showPlan ? "Hide" : "Show"}</button>
              </div>
              {showPlan && (
                <>
                  {/* Optional inputs for target/stop if prefill didn't have them */}
                  <div className="sa-modal-row">
                    <div>
                      <label>Take-profit target ({driverCcy})</label>
                      <input type="number" step="any" value={planTarget} onChange={(e) => setPlanTarget(e.target.value)} placeholder={isBuyDriven ? "84.00 (sell limit)" : ""} />
                    </div>
                    <div>
                      <label>Stop-loss trigger ({driverCcy})</label>
                      <input type="number" step="any" value={planStop} onChange={(e) => setPlanStop(e.target.value)} placeholder={isBuyDriven ? "69.00 (stop)" : ""} />
                    </div>
                  </div>

                  <div style={{ background: "#fff", border: "1px solid #cfd6e0", borderRadius: 8, fontFamily: "SF Mono, Menlo, Consolas, monospace", fontSize: 12, padding: 0, marginTop: 10 }}>
                    {/* Order 1: Entry */}
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--sa-border)" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: isBuyDriven ? "var(--sa-green)" : "var(--sa-red)", letterSpacing: ".06em" }}>1. ENTRY ORDER · place now</div>
                      <div style={{ marginTop: 4 }}>
                        <b>LIMIT {isBuyDriven ? "BUY" : "SELL"}</b> {driverShares} {driverTicker} @ <b>${driverPrice.toFixed(2)} {driverCcy}</b> {isBuyDriven ? "(max)" : "(min)"}, <b>Day</b>
                      </div>
                    </div>

                    {/* Order 2: Stop (only for BUY) */}
                    {isBuyDriven && hasStop && (
                      <div style={{ padding: "10px 14px", borderBottom: hasTarget ? "1px solid var(--sa-border)" : "none" }}>
                        <div style={{ fontWeight: 700, fontSize: 11, color: "var(--sa-red)", letterSpacing: ".06em" }}>2. PROTECTIVE STOP · place once #1 fills</div>
                        <div style={{ marginTop: 4 }}>
                          <b>GTC STOP-LIMIT SELL</b> {driverShares} {driverTicker}, stop <b>${stop.toFixed(2)}</b> / limit <b>${stopLimit.toFixed(2)}</b> {driverCcy}
                        </div>
                      </div>
                    )}

                    {/* Order 3: Take profit (only for BUY) */}
                    {isBuyDriven && hasTarget && (
                      <div style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 700, fontSize: 11, color: "var(--sa-green)", letterSpacing: ".06em" }}>3. TAKE-PROFIT · place once #1 fills</div>
                        <div style={{ marginTop: 4 }}>
                          <b>GTC LIMIT SELL</b> {driverShares} {driverTicker} @ <b>${target.toFixed(2)} {driverCcy}</b>
                        </div>
                      </div>
                    )}
                  </div>

                  {isBuyDriven && hasStop && hasTarget && (
                    <div style={{ fontSize: 11, color: "var(--sa-text-2)", marginTop: 8, padding: 8, background: "rgba(255,255,255,.7)", borderRadius: 6 }}>
                      💡 <b>Bracket / OCO setup:</b> at CIBC Investor's Edge, link orders #2 and #3 as a One-Cancels-Other pair (Multi-Leg / Conditional Orders). Whichever fires first auto-cancels the other so you never end up double-sold. Note: CIBC GTC is 30 days max — refresh if your thesis runs longer.
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>Estimated commission: {orderCount} orders × ${commission.toFixed(2)} = <b>${totalCommish.toFixed(2)} CAD</b></span>
                    <button
                      type="button"
                      style={{ background: "transparent", border: "1px solid var(--sa-border)", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "var(--sa-text-2)", cursor: "pointer" }}
                      onClick={() => {
                        const lines = [
                          `1. LIMIT ${isBuyDriven ? "BUY" : "SELL"} ${driverShares} ${driverTicker} @ $${driverPrice.toFixed(2)} ${driverCcy} (${isBuyDriven ? "max" : "min"}), Day`,
                        ];
                        if (isBuyDriven && hasStop) lines.push(`2. GTC STOP-LIMIT SELL ${driverShares} ${driverTicker}, stop $${stop.toFixed(2)} / limit $${stopLimit.toFixed(2)} ${driverCcy}`);
                        if (isBuyDriven && hasTarget) lines.push(`3. GTC LIMIT SELL ${driverShares} ${driverTicker} @ $${target.toFixed(2)} ${driverCcy}`);
                        navigator.clipboard?.writeText(lines.join("\n"));
                      }}
                    >📋 Copy to clipboard</button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Cost preview — commissions + optional FX-spread warning */}
        {mode !== "cash" && (() => {
          const commission = Number(user.commissionPerTrade ?? 9.95);
          const fxSpread = Number(user.fxSpreadPct ?? 1.5);
          const legCount = mode === "swap" ? 2 : 1;
          const commTotal = commission * legCount;
          // FX warning only if a swap mixes currencies
          const mixedCcy = mode === "swap" && sellCcy && buyCcy && sellCcy !== buyCcy;
          const fxRoundtripPct = mixedCcy ? fxSpread : 0;
          const fxCadCost = mixedCcy ? (Math.min(sellCadVal, buyCadVal) * fxSpread / 100) : 0;
          if (commTotal <= 0 && !mixedCcy) return null;
          return (
            <div style={{ background: "var(--sa-amber-soft)", border: "1px solid #fde68a", padding: "10px 14px", borderRadius: 10, marginTop: 12, fontSize: 12, color: "var(--sa-amber)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Est. commission ({legCount} {legCount === 1 ? "leg" : "legs"})</span>
                <span style={{ fontWeight: 600 }}>~${commTotal.toFixed(2)} CAD</span>
              </div>
              {mixedCcy && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span>FX spread ({fxSpread}% one-way × {sellCcy}→{buyCcy})</span>
                  <span style={{ fontWeight: 600 }}>~${fxCadCost.toFixed(2)} CAD drag</span>
                </div>
              )}
              <div style={{ color: "var(--sa-muted)", fontSize: 11, marginTop: 6 }}>
                Costs are estimates based on Settings. Adjust there if your broker differs.
              </div>
            </div>
          );
        })()}

        {Math.abs(netCash) > 0.005 && (
          <div style={{
            background: "var(--sa-panel-2)", padding: "10px 14px", borderRadius: 10, marginTop: 12,
            display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
          }}>
            <span style={{ color: "var(--sa-text-2)" }}>Net cash impact</span>
            <span style={{ fontWeight: 600, color: netCash >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
              {netCash >= 0 ? "+" : "−"}${Math.abs(netCash).toFixed(2)} CAD {netCash >= 0 ? "(cash in)" : "(cash used)"}
            </span>
          </div>
        )}

        {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18, flexWrap: "wrap" }}>
          <button className="sa-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {/* "Submit only" — for the workflow: I just placed the LIMIT order
              at CIBC and it hasn't filled yet. Logs as a Pending Order. */}
          {onSubmitPending && (mode === "buy" || mode === "sell") && (
            <button
              className="sa-btn secondary"
              title="Logged as pending until you mark it filled. No journal entry or cash change yet."
              disabled={busy}
              onClick={async () => {
                setErr(null);
                const isBuy = mode === "buy";
                const ticker = (isBuy ? buyTicker : sellTicker).trim().toUpperCase().replace(/\.+$/, "");
                const qty = parseFloat(isBuy ? buyShares : sellShares);
                const limitPrice = parseFloat(isBuy ? buyPrice : sellPrice);
                if (!ticker || !qty || !(limitPrice >= 0)) return setErr("Need ticker, qty, and limit price.");
                setBusy(true);
                try {
                  await onSubmitPending({
                    side: isBuy ? "BUY" : "SELL",
                    ticker, qty, limitPrice,
                    currency: isBuy ? buyCcy : sellCcy,
                    settleCcy: isBuy ? buySubCcy : sellSubCcy,
                    account,
                    targetPrice: planTarget ? parseFloat(planTarget) : null,
                    stopPrice: planStop ? parseFloat(planStop) : null,
                    notes,
                  });
                } catch (e) {
                  setErr(e?.message || "Submit failed.");
                } finally { setBusy(false); }
              }}
            >📋 Submit as pending</button>
          )}
          <button className="sa-btn" onClick={handleSubmit} disabled={busy}>
            {busy ? "Recording…" : "Record fill now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Fullscreen shell — hides site header/footer for app feel
// =============================================================================
function FullscreenShell({ children }) {
  useEffect(() => {
    // Hide site chrome while on /stocks; restore on unmount
    document.body.classList.add("stocks-app-mode");
    return () => document.body.classList.remove("stocks-app-mode");
  }, []);
  return <div className="stocks-root">{children}</div>;
}

// =============================================================================
// HighConvictionCard — renders one multi-factor pick with a transparent
// per-module score breakdown, bull/bear, catalysts, risk, and zones.
// =============================================================================
const HC_FACTOR_ORDER = [
  ["fundamentals", "Fundamentals"],
  ["momentum", "Growth / momentum"],
  ["technical", "Technical setup"],
  ["catalysts", "Catalysts / events"],
  ["sentiment", "Sentiment / news"],
  ["riskControl", "Risk control"],
];

function hcRiskColor(rating) {
  if (rating === "Low") return { bg: "var(--sa-green-soft)", fg: "var(--sa-green)" };
  if (rating === "Medium") return { bg: "var(--sa-accent-soft)", fg: "var(--sa-accent-2)" };
  if (rating === "High") return { bg: "var(--sa-amber-soft)", fg: "#b45309" };
  return { bg: "var(--sa-red-soft)", fg: "var(--sa-red)" }; // Speculative
}

function HcScoreBar({ score }) {
  const v = Number.isFinite(score) ? score : null;
  const color = v == null ? "#cbd5e1" : v >= 70 ? "var(--sa-green)" : v >= 45 ? "var(--sa-accent)" : "var(--sa-amber)";
  return (
    <div style={{ height: 8, background: "var(--sa-panel-2)", borderRadius: 5, overflow: "hidden", flex: 1, minWidth: 60 }}>
      <div style={{ width: `${v == null ? 0 : v}%`, height: "100%", background: color }} />
    </div>
  );
}

const MOSAIC_CAT_LABELS = {
  insiderFilings: "Insider / filings", demand: "Demand", hiring: "Hiring", supplyChain: "Supply chain",
  regulatory: "Regulatory", marketStructure: "Market structure", managementLanguage: "Mgmt language",
};

function mosaicDirIcon(d) {
  if (d === "confirming") return { icon: "✓", color: "var(--sa-green)" };
  if (d === "contradictory") return { icon: "✗", color: "var(--sa-red)" };
  return { icon: "•", color: "var(--sa-muted)" };
}

function MosaicBlock({ mosaic }) {
  const conf = mosaic.overallConfirmation;
  const confColor = conf === "confirming" ? "var(--sa-green)" : conf === "contradictory" ? "var(--sa-red)" : "var(--sa-amber)";
  return (
    <div style={{ marginTop: 12, border: "1px solid var(--sa-border)", borderRadius: 10, padding: 12, background: "var(--sa-panel-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>🧩 Mosaic Edge</span>
        <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mosaic.edgeScore ?? "—"}</span>
        <span style={{ fontSize: 11, color: "var(--sa-muted)" }}>conf {mosaic.confidence ?? "—"}% · {mosaic.mode} mode</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: confColor, border: `1px solid ${confColor}` }}>{conf}</span>
        {mosaic.rumourFlagged && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--sa-amber-soft)", color: "#b45309" }}>RUMOUR-FLAGGED</span>}
        <span style={{ fontSize: 11, color: "var(--sa-muted)" }}>· already priced in: <b>{mosaic.alreadyPricedIn}</b></span>
      </div>

      {Array.isArray(mosaic.topSignals) && mosaic.topSignals.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sa-text-2)", textTransform: "uppercase", letterSpacing: ".05em" }}>Top hidden-momentum signals</div>
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 5 }}>
            {mosaic.topSignals.map((s, i) => {
              const d = mosaicDirIcon(s.direction);
              return (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>
                  <span style={{ color: d.color, fontWeight: 700, marginRight: 5 }}>{d.icon}</span>
                  {s.signal}
                  <span style={{ display: "inline-flex", gap: 5, marginLeft: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, background: "var(--sa-accent-soft)", color: "var(--sa-accent-2)", padding: "1px 6px", borderRadius: 6 }}>{s.sourceCategory || MOSAIC_CAT_LABELS[s.category] || "public"}</span>
                    <span style={{ fontSize: 10, color: "var(--sa-muted)" }}>conf {s.confidence} · false-signal {s.falseSignalRisk} · priced-in {s.pricedIn}</span>
                    {s.isRumour && <span style={{ fontSize: 10, color: "var(--sa-amber)" }}>rumour</span>}
                    {s.isSocialOnly && <span style={{ fontSize: 10, color: "var(--sa-amber)" }}>social-only</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category mini-scores */}
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10.5, color: "var(--sa-muted)" }}>
        {(mosaic.categories || []).map((c) => (
          <span key={c.key}>{MOSAIC_CAT_LABELS[c.key] || c.key}: <b style={{ color: "var(--sa-text-2)" }}>{c.score ?? "n/a"}</b></span>
        ))}
      </div>

      {Array.isArray(mosaic.penaltiesApplied) && mosaic.penaltiesApplied.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--sa-red)" }}>Penalties: {mosaic.penaltiesApplied.join(", ")}</div>
      )}
      {Array.isArray(mosaic.eventPressure) && mosaic.eventPressure.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--sa-text-2)" }}>Event timing: {mosaic.eventPressure.join(" · ")}</div>
      )}
      {mosaic.followUp && <div style={{ marginTop: 6, fontSize: 11.5 }}><b>Follow-up research:</b> {mosaic.followUp}</div>}
      <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--sa-muted)", lineHeight: 1.45 }}>
        ⚖️ {mosaic.legalityNote} <i>{mosaic.disclaimer}</i>
      </div>
    </div>
  );
}

// Structural-conviction trend from the candidate's scoreHistory (deterministic
// composite over time, appended on scans + daily by the tracker). Smoothed over
// the last few readings so one noisy point doesn't flip it.
function convictionTrend(history) {
  const pts = (history || []).filter((p) => p && Number.isFinite(p.score)).slice(-6);
  if (pts.length < 2) return { dir: "new", points: pts.length };
  const last = pts[pts.length - 1].score;
  const priors = pts.slice(0, -1).slice(-3);
  const base = priors.reduce((s, p) => s + p.score, 0) / priors.length;
  const delta = Math.round(last - base);
  const dir = delta >= 4 ? "rising" : delta <= -4 ? "falling" : "stable";
  return { dir, delta, points: pts.length };
}

function ConvictionTrendBadge({ history }) {
  const t = convictionTrend(history);
  if (!t) return null;
  // Hide the badge when there's insufficient history to say anything
  // real. Previously showed "conviction: building…" for < 2 points,
  // which read as a positive signal ("conviction is growing") when
  // it actually just meant "not enough data yet." Silent > misleading.
  if (t.dir === "new") return null;
  const cfg = {
    rising: { icon: "▲", color: "var(--sa-green)", label: "rising" },
    falling: { icon: "▼", color: "var(--sa-red)", label: "falling" },
    stable: { icon: "▬", color: "var(--sa-muted)", label: "stable" },
  }[t.dir];
  return (
    <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }} title={`Structural (AI-free) conviction ${cfg.label} over last ${t.points} readings`}>
      {cfg.icon} conviction {cfg.label}{t.delta ? ` (${t.delta > 0 ? "+" : ""}${t.delta})` : ""}
    </span>
  );
}

function MoonshotCard({ pick, rank }) {
  const m = pick.moonshot || {};
  const [open, setOpen] = useState(false);
  const ccy = pick.currencyAtDiscovery || "USD";
  const cap = pick.marketCap ? `$${(pick.marketCap / 1e9).toFixed(pick.marketCap >= 1e9 ? 2 : 3)}B` : "—";
  const exch = (pick.exchange || "").toUpperCase();
  const isCanada = ccy === "CAD" || /^(TSX|TSXV|CN|NEO|NE)$/.test(exch) || /\.(TO|V|NE|CN)$/i.test(pick.ticker || "");
  const market = `${exch ? exch + " · " : ""}${isCanada ? "🇨🇦 Canada" : "🇺🇸 US"}`;
  const sig = m.signals || {};
  const Badge = ({ label, v }) => v == null ? null : (
    <span style={{ fontSize: 10.5, background: "var(--sa-panel-2)", borderRadius: 6, padding: "2px 7px" }}>{label} <b>{v}</b></span>
  );
  const Field = ({ label, children }) => !children ? null : (
    <div style={{ fontSize: 12, marginTop: 6 }}><span style={{ color: "var(--sa-muted)", fontWeight: 600 }}>{label}: </span>{children}</div>
  );

  return (
    <div className="sa-card" style={{ padding: 16, border: "1px solid var(--sa-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            <span style={{ color: "var(--sa-muted)", marginRight: 6 }}>#{rank}</span>{pick.ticker}
            <span style={{ color: "var(--sa-text-2)", fontWeight: 500, marginLeft: 8, fontSize: 13 }}>{pick.name}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            {pick.priceAtDiscovery != null ? `$${pick.priceAtDiscovery} ${ccy}` : "—"} · {cap} · {market} · {pick.sector || "—"} · {m.timeHorizon || "long-term"}
          </div>
          <div style={{ marginTop: 3 }}><ConvictionTrendBadge history={pick.scoreHistory} /></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{m.compositeScore ?? "—"}</div>
          <div style={{ fontSize: 10, color: "var(--sa-muted)", letterSpacing: ".06em" }}>MOONSHOT</div>
        </div>
      </div>

      {/* Asymmetry / probabilities */}
      <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        {m.estimatedUpside && <span style={{ fontSize: 13 }}><span style={{ color: "var(--sa-muted)" }}>Upside:</span> <b style={{ color: "var(--sa-green)" }}>{m.estimatedUpside}</b></span>}
        <span style={{ fontSize: 13 }}><span style={{ color: "var(--sa-muted)" }}>P(5x):</span> <b>{m.p5xPct != null ? m.p5xPct + "%" : "—"}</b></span>
        <span style={{ fontSize: 13 }}><span style={{ color: "var(--sa-muted)" }}>P(10x):</span> <b>{m.p10xPct != null ? m.p10xPct + "%" : "—"}</b></span>
        <span style={{ fontSize: 12, color: "var(--sa-muted)" }}>confidence {m.confidence || "—"}</span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--sa-muted)", marginTop: 2 }}>Probabilities are rough base-rate-anchored priors, not forecasts.</div>

      {/* Signal badges */}
      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {m.shortTerm ? (
          <>
            <Badge label="Catalyst" v={m.shortTerm.catalystDensity} />
            <Badge label="Supply/demand" v={m.shortTerm.supplyDemand} />
            <Badge label="Narrative" v={m.shortTerm.narrativeIgnition} />
            <Badge label="Sector mom." v={m.shortTerm.sectorMomentum} />
            <Badge label="Un-crowded" v={m.shortTerm.crowdingInverse} />
            {m.shortTerm.narrativeStage && <span style={{ fontSize: 10.5, background: "var(--sa-accent-soft)", color: "var(--sa-accent-2)", borderRadius: 6, padding: "2px 7px" }}>Stage: <b>{m.shortTerm.narrativeStage}</b></span>}
          </>
        ) : (
          <>
            <Badge label="Pre-parabolic" v={sig.preParabolic} />
            <Badge label="Reality-lag" v={sig.realityLag} />
            <Badge label="Synthetic-insider" v={sig.syntheticInsider} />
            <Badge label="Mosaic edge" v={sig.mosaicEdge} />
          </>
        )}
      </div>

      {m.shortTerm && (
        <div style={{ marginTop: 8, border: "1px solid var(--sa-border)", borderRadius: 8, padding: "8px 10px", background: "var(--sa-panel-2)" }}>
          {Array.isArray(m.shortTerm.catalystCalendar) && m.shortTerm.catalystCalendar.length > 0 && (
            <Field label="📅 Catalyst calendar (90d)">{m.shortTerm.catalystCalendar.join(" · ")}</Field>
          )}
          <Field label="Float / short">{m.shortTerm.floatShort}</Field>
          {Array.isArray(m.shortTerm.supplyKillers) && m.shortTerm.supplyKillers.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--sa-red)" }}><b>⚠ Supply killers:</b> {m.shortTerm.supplyKillers.join(" · ")}</div>
          )}
          <Field label="Options read">{m.shortTerm.optionsRead}</Field>
          <Field label="Sector momentum">{m.shortTerm.sectorMomentumNote}</Field>
          {Array.isArray(m.shortTerm.precedents) && m.shortTerm.precedents.length > 0 && (
            <Field label="Precedents">{m.shortTerm.precedents.join(" · ")}</Field>
          )}
          {(m.shortTerm.invalidationPrice != null || m.shortTerm.maxPositionPct != null || m.shortTerm.stopStrategy) && (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              <span style={{ color: "var(--sa-muted)", fontWeight: 600 }}>Stop discipline: </span>
              {m.shortTerm.invalidationPrice != null && <>invalidation <b>${m.shortTerm.invalidationPrice} {ccy}</b> · </>}
              {m.shortTerm.maxPositionPct != null && <>max size <b>{m.shortTerm.maxPositionPct}%</b> · </>}
              {m.shortTerm.stopStrategy}
            </div>
          )}
        </div>
      )}

      <Field label="Why the market may underestimate it">{m.marketUnderestimation}</Field>
      <Field label="Narrative shift">{m.narrativeShift}</Field>
      <Field label="TAM thesis">{m.tamThesis}</Field>
      <Field label="Final thesis">{m.finalThesis}</Field>

      <button className="sa-btn ghost" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide detail" : "Show full thesis, catalysts, risks & sources"}
      </button>
      {open && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--sa-border)", paddingTop: 8 }}>
          <Field label="Institutional signals">{m.institutionalSignals}</Field>
          <Field label="Technical setup">{m.technicalSummary}</Field>
          <Field label="Revenue / margin trajectory">{m.revenueMarginTrajectory}</Field>
          <Field label="Future dominance">{m.futureDominance}</Field>
          <Field label="Best case">{m.bestCase}</Field>
          <Field label="Bear case">{m.bearCase}</Field>
          {Array.isArray(m.keyCatalysts) && m.keyCatalysts.length > 0 && (
            <Field label="Key catalysts">{m.keyCatalysts.join(" · ")}</Field>
          )}
          {Array.isArray(m.coreRisks) && m.coreRisks.length > 0 && (
            <Field label="Core risks">{m.coreRisks.join(" · ")}</Field>
          )}
          {Array.isArray(m.redFlags) && m.redFlags.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--sa-red)" }}><b>🚩 Red flags:</b> {m.redFlags.join(" · ")}</div>
          )}
          {Array.isArray(sig.preParabolicWhy) && sig.preParabolicWhy.length > 0 && (
            <div style={{ fontSize: 11, marginTop: 6, color: "var(--sa-muted)" }}>Pre-parabolic: {sig.preParabolicWhy.join(" · ")}</div>
          )}

          {/* Authoritative alt-data: EDGAR Form 4, FMP transcript QoQ, USPTO patents */}
          {m.altData && (m.altData.insider || m.altData.transcript || m.altData.patents) && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--sa-border)", background: "var(--sa-panel-2)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sa-text-2)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>📡 Alt-data (authoritative public sources)</div>
              {m.altData.insider && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <b>Insider (EDGAR Form 4)</b> <span style={{ color: "var(--sa-muted)" }}>score {m.altData.insider.score ?? "—"}</span>
                  <div style={{ fontSize: 11, color: "var(--sa-text-2)" }}>{m.altData.insider.summary}</div>
                  {Array.isArray(m.altData.insider.details?.recentBuys) && m.altData.insider.details.recentBuys.length > 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--sa-muted)", marginTop: 2 }}>
                      Recent buys: {m.altData.insider.details.recentBuys.slice(0, 3).map((b, i) =>
                        `${b.filer} (${b.title}) ${b.shares?.toLocaleString()} sh${b.dollars ? ` ≈ $${Math.round(b.dollars).toLocaleString()}` : ""} on ${b.date}`
                      ).join(" · ")}
                    </div>
                  )}
                </div>
              )}
              {m.altData.transcript && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  <b>Transcript QoQ NLP</b> <span style={{ color: "var(--sa-muted)" }}>score {m.altData.transcript.score ?? "—"} · {m.altData.transcript.details?.direction || "—"}</span>
                  <div style={{ fontSize: 11, color: "var(--sa-text-2)" }}>{m.altData.transcript.summary}</div>
                  {Array.isArray(m.altData.transcript.details?.newlyPresent) && m.altData.transcript.details.newlyPresent.length > 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--sa-green)", marginTop: 2 }}>New bullish terms: {m.altData.transcript.details.newlyPresent.join(", ")}</div>
                  )}
                  {Array.isArray(m.altData.transcript.details?.newRedFlags) && m.altData.transcript.details.newRedFlags.length > 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--sa-red)", marginTop: 2 }}>New cautionary terms: {m.altData.transcript.details.newRedFlags.join(", ")}</div>
                  )}
                </div>
              )}
              {m.altData.patents && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  <b>USPTO patent filings</b> <span style={{ color: "var(--sa-muted)" }}>score {m.altData.patents.score ?? "—"}</span>
                  <div style={{ fontSize: 11, color: "var(--sa-text-2)" }}>{m.altData.patents.summary}</div>
                </div>
              )}
            </div>
          )}

          {Array.isArray(m.sources) && m.sources.length > 0 && (
            <div style={{ fontSize: 11, marginTop: 6 }}>
              Sources: {m.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--sa-accent)", marginRight: 8 }}>{s.title?.slice(0, 40) || "link"}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HighConvictionCard({ pick, rank }) {
  const [showDetail, setShowDetail] = useState(false);
  const [livePrice, setLivePrice] = useState(null);
  const mf = pick.multiFactor || {};
  const ccy = pick.currencyAtDiscovery || "USD";
  const risk = hcRiskColor(mf.riskRating);
  const cap = pick.marketCap ? `$${(pick.marketCap / 1e9).toFixed(pick.marketCap >= 1e9 ? 2 : 3)}B` : "—";
  const price = pick.priceAtDiscovery != null ? `$${pick.priceAtDiscovery} ${ccy}` : "—";

  // Live price for entry-zone highlight. Cheap: one price fetch per card
  // on mount; the response is cached upstream so 10 cards on the page are
  // effectively 10 identical calls — trivial.
  useEffect(() => {
    if (!pick.ticker) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: [pick.ticker] }),
        });
        if (!r.ok) return;
        const j = await r.json();
        const q = j.prices?.[pick.ticker];
        if (!cancelled && q?.price != null) setLivePrice(q.price);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [pick.ticker]);

  // Parse entryZone strings like "$140.00-$148.00", "140-148", or "$145" into
  // a numeric range. Used for the definitive "current price inside AI-stated
  // entry zone" check that beats a ±% heuristic when we have real bounds.
  const parseEntryRange = (s) => {
    if (!s) return null;
    const nums = String(s).match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length === 0) return null;
    const a = parseFloat(nums[0]);
    const b = nums.length > 1 ? parseFloat(nums[1]) : a;
    return { low: Math.min(a, b), high: Math.max(a, b) };
  };
  const entryRange = parseEntryRange(mf.projection?.entryZone);
  // Zone status: use the AI's stated range when we have one. Same
  // semantics as entryZoneStatus, but "in-entry" is anywhere INSIDE the
  // stated range (not a ±% around a midpoint), and "pullback-entry"
  // covers everything below the low but above stop — a better fill
  // in the same setup.
  let projZone = null;
  if (livePrice != null && entryRange) {
    const stop = Number.isFinite(mf.projection?.stop) ? mf.projection.stop : (Number.isFinite(+mf.projection?.stop) ? +mf.projection.stop : null);
    if (stop != null && livePrice <= stop) projZone = "stopped";
    else if (livePrice >= entryRange.low && livePrice <= entryRange.high) projZone = "in-entry";
    else if (livePrice > entryRange.high) {
      // Above the top of the range: near-entry within 5%, priced-out beyond.
      const abovePct = ((livePrice - entryRange.high) / entryRange.high) * 100;
      projZone = abovePct <= 5 ? "near-entry" : "priced-out";
    } else {
      // Below range.low, above stop → pullback into value: green.
      projZone = "pullback-entry";
    }
  }
  const projZoneStyle = zoneStyle(projZone);
  // Which market the opportunity is in (exchange + country).
  const exch = (pick.exchange || "").toUpperCase();
  const isCanada = ccy === "CAD" || /^(TSX|TSXV|CN|NEO|NE)$/.test(exch) || /\.(TO|V|NE|CN)$/i.test(pick.ticker || "");
  const market = `${exch ? exch + " · " : ""}${isCanada ? "🇨🇦 Canada" : "🇺🇸 US"}`;

  return (
    <div className="sa-card" style={{ padding: 16, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sa-muted)" }}>#{rank}</span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{pick.ticker}</span>
            <span style={{ fontSize: 13, color: "var(--sa-text-2)" }}>{pick.name}</span>
            {mf.hypePenaltyApplied && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "var(--sa-red-soft)", color: "var(--sa-red)" }}>HYPE-PENALIZED</span>
            )}
            {mf.adversarial?.verdict && (() => {
              const v = mf.adversarial.verdict;
              const style = v === "confirmed_long"
                ? { bg: "#dcfce7", fg: "#166534", label: "✓ BEAR-TESTED" }
                : v === "risk_flagged"
                ? { bg: "#fef3c7", fg: "#92400e", label: "⚠ BEAR-CASE FLAGGED" }
                : { bg: "#fee2e2", fg: "#991b1b", label: "✗ ADVERSARIAL REJECT" };
              return (
                <span title={`Adjusted score by ${mf.adversarial.confidenceAdjustment >= 0 ? "+" : ""}${mf.adversarial.confidenceAdjustment}`} style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: style.bg, color: style.fg }}>{style.label}</span>
              );
            })()}
          </div>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            {price} · {cap} · {market} · {pick.sector || "—"} · {mf.timeHorizon || "medium-term"}
          </div>
          <div style={{ marginTop: 3 }}><ConvictionTrendBadge history={pick.scoreHistory} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{mf.weightedScore ?? "—"}</div>
            <div style={{ fontSize: 9.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>score</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1, marginTop: 4 }}>{mf.confidence ?? "—"}%</div>
            <div style={{ fontSize: 9.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>conf.</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 8, background: risk.bg, color: risk.fg, whiteSpace: "nowrap" }}>{mf.riskRating || "—"}</span>
        </div>
      </div>

      {/* Factor breakdown bars */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 5 }}>
        {HC_FACTOR_ORDER.map(([key, label]) => {
          const f = mf.factors?.[key] || {};
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
              <span style={{ width: 130, color: "var(--sa-text-2)" }}>{label}</span>
              <span style={{ width: 30, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{f.score ?? "n/a"}</span>
              <HcScoreBar score={f.score} />
              <span style={{ width: 34, textAlign: "right", color: "var(--sa-muted)" }}>{f.weight != null ? `${Math.round(f.weight * 100)}%` : ""}</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sa-green)", textTransform: "uppercase", letterSpacing: ".05em" }}>Bull case</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3 }}>{mf.bullCase || "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sa-red)", textTransform: "uppercase", letterSpacing: ".05em" }}>Bear case</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3 }}>{mf.bearCase || "—"}</div>
        </div>
      </div>

      {Array.isArray(mf.keyCatalysts) && mf.keyCatalysts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sa-text-2)", textTransform: "uppercase", letterSpacing: ".05em" }}>Key catalysts</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
            {mf.keyCatalysts.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
        {mf.watchZone && <div><span style={{ color: "var(--sa-muted)" }}>Watch/buy zone:</span> <b>{mf.watchZone}</b></div>}
        {mf.stopLevel && <div><span style={{ color: "var(--sa-muted)" }}>Invalidation/stop:</span> <b>{mf.stopLevel}</b></div>}
      </div>

      {mf.projection && (
        <div style={{
          marginTop: 10,
          border: `1px solid ${projZoneStyle ? projZoneStyle.border : "var(--sa-border)"}`,
          background: projZoneStyle ? projZoneStyle.bg : "transparent",
          borderRadius: 8, padding: "8px 10px", fontSize: 12,
        }}>
          {projZoneStyle && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline" }}>
              <span style={{ background: projZoneStyle.border, color: projZoneStyle.accent, padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em" }}>{projZoneStyle.tag}</span>
              {livePrice != null && <span style={{ fontSize: 11, color: "var(--sa-muted)" }}>live: ${livePrice.toFixed(2)} {ccy}</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
            <span>
              <span style={{ color: "var(--sa-muted)" }}>Projected ROI:</span>{" "}
              <b style={{ color: mf.projection.projectedRoiPct >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
                {mf.projection.projectedRoiPct >= 0 ? "+" : ""}{mf.projection.projectedRoiPct}%
              </b>
              {mf.projection.downsidePct != null && (
                <span style={{ color: "var(--sa-muted)" }}> (downside {mf.projection.downsidePct}%)</span>
              )}
            </span>
            <span><span style={{ color: "var(--sa-muted)" }}>Time frame:</span> <b>{mf.projection.timeframe}</b></span>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
            <span><span style={{ color: "var(--sa-muted)" }}>Entry:</span> <b>${mf.projection.entryZone} {ccy}</b></span>
            <span><span style={{ color: "var(--sa-muted)" }}>Target:</span> <b>${mf.projection.target} {ccy}</b></span>
            <span><span style={{ color: "var(--sa-muted)" }}>Stop:</span> <b>${mf.projection.stop} {ccy}</b></span>
          </div>
          {(mf.projection.fibSupport || mf.projection.fibResistance || mf.projection.fibNote) && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--sa-border)", fontSize: 11.5 }}>
              <span style={{ color: "var(--sa-muted)", fontWeight: 600 }}>Fib anchors:</span>
              {mf.projection.fibSupport && (
                <span><span style={{ color: "var(--sa-muted)" }}>support</span> <b>{mf.projection.fibSupport.pct}% = ${mf.projection.fibSupport.price} {ccy}</b></span>
              )}
              {mf.projection.fibResistance && (
                <span><span style={{ color: "var(--sa-muted)" }}>resistance</span> <b>{mf.projection.fibResistance.pct}% = ${mf.projection.fibResistance.price} {ccy}</b></span>
              )}
              {mf.projection.fibNote && (
                <span style={{ color: "#a16207", fontWeight: 700 }}>{mf.projection.fibNote}</span>
              )}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--sa-muted)" }}>
            {mf.projection.basis} — mechanical projection, not a forecast.
          </div>
        </div>
      )}

      {mf.whyBeatOthers && (
        <div style={{ marginTop: 10, fontSize: 12, background: "var(--sa-panel-2)", borderRadius: 8, padding: "8px 10px" }}>
          <span style={{ fontWeight: 700 }}>Why it beat the others: </span>{mf.whyBeatOthers}
        </div>
      )}
      {mf.whatProvesWrong && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: "var(--sa-red)" }}>What proves this wrong: </span>{mf.whatProvesWrong}
        </div>
      )}

      {mf.shortInterestData && (mf.shortInterestData.siPctOfFloat != null || mf.shortInterestData.squeezeScore != null) && (
        <div style={{ marginTop: 10, fontSize: 12, background: mf.shortInterestData.setupType === "short-squeeze-candidate" ? "#fef3c7" : mf.shortInterestData.setupType === "high-si-warning" ? "#fef2f2" : "var(--sa-panel-2)", border: `1px solid ${mf.shortInterestData.setupType === "short-squeeze-candidate" ? "#fde68a" : mf.shortInterestData.setupType === "high-si-warning" ? "#fecaca" : "var(--sa-border)"}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: mf.shortInterestData.setupType === "short-squeeze-candidate" ? "#92400e" : "var(--sa-muted)", marginBottom: 4 }}>
            {mf.shortInterestData.setupType === "short-squeeze-candidate" ? "🎯 Short-squeeze setup" : mf.shortInterestData.setupType === "high-si-warning" ? "⚠ High short interest" : "📊 Short interest"}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {mf.shortInterestData.siPctOfFloat != null && <span><span style={{ color: "var(--sa-muted)" }}>SI:</span> <b>{mf.shortInterestData.siPctOfFloat.toFixed(1)}% of float</b></span>}
            {mf.shortInterestData.dtc != null && <span><span style={{ color: "var(--sa-muted)" }}>DTC:</span> <b>{mf.shortInterestData.dtc.toFixed(1)}d</b></span>}
            {mf.shortInterestData.momChangePct != null && <span><span style={{ color: "var(--sa-muted)" }}>MoM:</span> <b style={{ color: mf.shortInterestData.momChangePct >= 0 ? "#a16207" : "#166534" }}>{mf.shortInterestData.momChangePct >= 0 ? "+" : ""}{mf.shortInterestData.momChangePct.toFixed(0)}%</b></span>}
            {mf.shortInterestData.floatShares != null && <span><span style={{ color: "var(--sa-muted)" }}>Float:</span> <b>{(mf.shortInterestData.floatShares / 1e6).toFixed(0)}M</b></span>}
            {mf.shortInterestData.squeezeScore != null && <span><span style={{ color: "var(--sa-muted)" }}>Squeeze score:</span> <b>{mf.shortInterestData.squeezeScore}</b></span>}
          </div>
          {mf.shortInterestData.setupType === "short-squeeze-candidate" && mf.shortInterestData.squeezeContributors?.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#78350f" }}>
              {mf.shortInterestData.squeezeContributors.slice(0, 4).map((c, i) => <div key={i}>· {c}</div>)}
            </div>
          )}
          {mf.shortInterestData.reportDate && (
            <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--sa-muted)" }}>FINRA report {mf.shortInterestData.reportDate}</div>
          )}
        </div>
      )}

      {mf.catalystsData && (mf.catalystsData.nextEarnings || (mf.catalystsData.recentAnalysts?.length > 0)) && (
        <div style={{ marginTop: 10, fontSize: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#1e40af", marginBottom: 4 }}>🗓 Catalysts</div>
          {mf.catalystsData.nextEarnings && (
            <div style={{ marginTop: 4 }}>
              <b>Next earnings:</b> {mf.catalystsData.nextEarnings.date} ({mf.catalystsData.nextEarnings.time?.toUpperCase() || "—"}) — in <b style={{ color: mf.catalystsData.nextEarnings.daysAway <= 3 ? "#991b1b" : mf.catalystsData.nextEarnings.daysAway <= 7 ? "#92400e" : "inherit" }}>{mf.catalystsData.nextEarnings.daysAway}d</b>
              {mf.catalystsData.nextEarnings.epsEstimate != null && <span style={{ color: "var(--sa-muted)" }}> · est EPS ${mf.catalystsData.nextEarnings.epsEstimate.toFixed(2)}</span>}
            </div>
          )}
          {mf.catalystsData.analystSummary?.total > 0 && (
            <div style={{ marginTop: 4 }}>
              <b>Analysts (30d):</b> {mf.catalystsData.analystSummary.total} actions —
              <span style={{ color: "#166534", marginLeft: 4 }}>{mf.catalystsData.analystSummary.ups} up</span> ·
              <span style={{ color: "#991b1b", marginLeft: 4 }}>{mf.catalystsData.analystSummary.downs} down</span> ·
              <span style={{ color: "var(--sa-muted)", marginLeft: 4 }}>{mf.catalystsData.analystSummary.inits} init</span>
            </div>
          )}
          {mf.catalystsData.recentAnalysts?.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--sa-text-2)" }}>
              {mf.catalystsData.recentAnalysts.slice(0, 3).map((a, i) => (
                <div key={i}>· {a.date} · <b>{a.firm}</b> {a.action}{a.priorGrade ? ` (${a.priorGrade}→${a.newGrade})` : ""}{a.priceTarget ? ` → PT $${a.priceTarget}` : ""}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {mf.chartVision && (
        <div style={{ marginTop: 10, fontSize: 12, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6d28d9", marginBottom: 6 }}>👁 Chart vision AI</div>
          {mf.chartVision.gestalt && <div style={{ marginTop: 3, fontStyle: "italic" }}>"{mf.chartVision.gestalt}"</div>}
          {mf.chartVision.patterns?.length > 0 && (
            <div style={{ marginTop: 4 }}><b>Patterns:</b> {mf.chartVision.patterns.join(", ")}</div>
          )}
          {mf.chartVision.trendStage && (
            <div style={{ marginTop: 3 }}><b>Trend stage:</b> {mf.chartVision.trendStage}</div>
          )}
          {(mf.chartVision.supportLevels?.length > 0 || mf.chartVision.resistanceLevels?.length > 0) && (
            <div style={{ marginTop: 3 }}>
              {mf.chartVision.supportLevels?.length > 0 && <span><b>Support:</b> {mf.chartVision.supportLevels.join(", ")}</span>}
              {mf.chartVision.supportLevels?.length > 0 && mf.chartVision.resistanceLevels?.length > 0 && " · "}
              {mf.chartVision.resistanceLevels?.length > 0 && <span><b>Resistance:</b> {mf.chartVision.resistanceLevels.join(", ")}</span>}
            </div>
          )}
          {mf.chartVision.smaRelationship && (
            <div style={{ marginTop: 3 }}><b>vs SMA50:</b> {mf.chartVision.smaRelationship}</div>
          )}
          {mf.chartVision.divergences && mf.chartVision.divergences !== "none material" && (
            <div style={{ marginTop: 3 }}><b>Divergences:</b> {mf.chartVision.divergences}</div>
          )}
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: mf.chartVision.conviction === "high" ? "#dcfce7" : mf.chartVision.conviction === "low" ? "#fee2e2" : "#fef3c7", color: mf.chartVision.conviction === "high" ? "#166534" : mf.chartVision.conviction === "low" ? "#991b1b" : "#92400e" }}>
              CHART CONVICTION: {mf.chartVision.conviction?.toUpperCase()}
            </span>
            {mf.chartVision.convictionReason && <span style={{ fontSize: 11, color: "var(--sa-muted)" }}>— {mf.chartVision.convictionReason}</span>}
          </div>
          {mf.chartVision.chartUrl && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: "#6d28d9", fontWeight: 600 }}>Show the chart Claude analyzed</summary>
              <img src={mf.chartVision.chartUrl} alt={`${pick.ticker} chart`} style={{ marginTop: 6, maxWidth: "100%", borderRadius: 6, border: "1px solid #ddd6fe" }} />
            </details>
          )}
        </div>
      )}

      {mf.adversarial && (
        <div style={{ marginTop: 10, fontSize: 12, background: mf.adversarial.verdict === "confirmed_long" ? "#f0fdf4" : "#fef3c7", border: `1px solid ${mf.adversarial.verdict === "confirmed_long" ? "#bbf7d0" : "#fde68a"}`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", marginBottom: 4 }}>🎯 Adversarial short-seller stress-test</div>
          {mf.adversarial.bearThesis && <div style={{ marginTop: 4 }}><b>Bear thesis:</b> {mf.adversarial.bearThesis}</div>}
          {mf.adversarial.weakestPoint && <div style={{ marginTop: 4 }}><b>Weakest bull-case point:</b> {mf.adversarial.weakestPoint}</div>}
          {mf.adversarial.hiddenRisk && <div style={{ marginTop: 4 }}><b>Risk the bull thesis missed:</b> {mf.adversarial.hiddenRisk}</div>}
          {mf.adversarial.reasoning && <div style={{ marginTop: 6, fontStyle: "italic", color: "var(--sa-text-2)" }}>Verdict: {mf.adversarial.reasoning}</div>}
        </div>
      )}

      {pick.mosaic && <MosaicBlock mosaic={pick.mosaic} />}

      <button className="sa-btn ghost" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setShowDetail((s) => !s)}>
        {showDetail ? "Hide score detail" : "Show score detail & data flags"}
      </button>
      {showDetail && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--sa-text-2)" }}>
          {HC_FACTOR_ORDER.map(([key, label]) => {
            const f = mf.factors?.[key] || {};
            if (!f.contributors || f.contributors.length === 0) return null;
            return (
              <div key={key} style={{ marginBottom: 6 }}>
                <b>{label} ({f.score ?? "n/a"}):</b> {f.contributors.join(" · ")}
              </div>
            );
          })}
          {Array.isArray(mf.dataFlags) && mf.dataFlags.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--sa-amber)" }}>
              ⚠ Missing/stale data: {mf.dataFlags.join("; ")}
            </div>
          )}
          {Array.isArray(mf.sources) && mf.sources.length > 0 && (
            <div style={{ marginTop: 6 }}>
              Sources: {mf.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--sa-accent)", marginRight: 8 }}>{s.title?.slice(0, 40) || "link"}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Discover view — find high-potential candidate stocks NOT in your portfolio.
// On-demand scan: pulls FMP screener universe (microcap–smallcap growth setups),
// composite-scores each candidate, asks the AI to write a bull thesis + kill
// thesis for the top 8, surfaces them as cards with conviction badges.
// =============================================================================
function DiscoverView({ sessionToken, user }) {
  const [candidates, setCandidates] = useState([]);
  const [starredOlder, setStarredOlder] = useState([]);
  const [scanDate, setScanDate] = useState(null);
  const [scanMode, setScanMode] = useState(null); // "fmp-screened" | "ai-only" | "suppressed"
  const [suppressReason, setSuppressReason] = useState(null);
  const [upgradeMessage, setUpgradeMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  // Configurable scan parameters
  const [topN, setTopN] = useState(8);
  const [marketCapMin, setMarketCapMin] = useState(200);   // millions
  const [marketCapMax, setMarketCapMax] = useState(5000);  // millions
  const [sectorsCsv, setSectorsCsv] = useState("");
  // High-conviction multi-factor screen (additive — separate from the scan above)
  const [hcRiskMode, setHcRiskMode] = useState("balanced");
  const [hcMarket, setHcMarket] = useState("both");         // both | us | canada
  const [hcMosaic, setHcMosaic] = useState(false);          // include Mosaic Intelligence
  const [hcMosaicMode, setHcMosaicMode] = useState("balanced"); // mosaic alt-data mode
  const [msBusy, setMsBusy] = useState(false);
  const [msError, setMsError] = useState(null);
  const [msResult, setMsResult] = useState(null); // moonshot { picks, disclaimer, ... }
  const [msHorizon, setMsHorizon] = useState("long"); // long 3-10y | short 3-18mo
  const [hcBusy, setHcBusy] = useState(false);
  const [hcError, setHcError] = useState(null);
  const [hcResult, setHcResult] = useState(null); // { picks, disclaimer, mode, upgradeRecommendation }

  // Load existing candidates on mount
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-discover/candidates`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setCandidates(j.candidates || []);
        setStarredOlder(j.starred || []);
        setScanDate(j.scanDate || null);
      } catch (e) { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  const runScan = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        topN: Math.max(1, Math.min(15, parseInt(topN, 10) || 8)),
        marketCapMin: (parseFloat(marketCapMin) || 200) * 1_000_000,
        marketCapMax: (parseFloat(marketCapMax) || 5000) * 1_000_000,
      };
      if (sectorsCsv.trim()) {
        body.sectors = sectorsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      }
      const r = await fetch(`${BACKEND_URL}/api/stocks-discover/scan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setCandidates(j.candidates || []);
      setScanDate(j.scanDate || new Date().toISOString());
      setScanMode(j.mode || null);
      setUpgradeMessage(j.upgradeRecommendation || null);
      setSuppressReason(j.suppressReason || null);
    } catch (e) {
      setError(e?.message || "Scan failed");
    } finally {
      setBusy(false);
    }
  };

  const runHighConviction = async () => {
    if (hcBusy) return;
    setHcBusy(true); setHcError(null);
    try {
      const body = { riskMode: hcRiskMode, market: hcMarket, includeMosaic: hcMosaic, mosaicMode: hcMosaicMode };
      if (sectorsCsv.trim()) body.sectors = sectorsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`${BACKEND_URL}/api/stocks-discover/high-conviction`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setHcResult(j);
    } catch (e) {
      setHcError(e?.message || "Screen failed");
    } finally {
      setHcBusy(false);
    }
  };

  const runMoonshot = async () => {
    if (msBusy) return;
    setMsBusy(true); setMsError(null);
    try {
      const body = { market: hcMarket, horizon: msHorizon };
      if (sectorsCsv.trim()) body.sectors = sectorsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`${BACKEND_URL}/api/stocks-discover/moonshot`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsResult(j);
    } catch (e) {
      setMsError(e?.message || "Moonshot scan failed");
    } finally {
      setMsBusy(false);
    }
  };

  const toggleStar = async (id) => {
    try {
      await fetch(`${BACKEND_URL}/api/stocks-discover/candidates/${id}/star`, {
        method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      setCandidates((cs) => cs.map((c) => c._id === id ? { ...c, starred: !c.starred } : c));
    } catch {}
  };
  const dismiss = async (id) => {
    if (!confirm("Hide this candidate from future scans?")) return;
    try {
      await fetch(`${BACKEND_URL}/api/stocks-discover/candidates/${id}/dismiss`, {
        method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      setCandidates((cs) => cs.filter((c) => c._id !== id));
    } catch {}
  };

  const convictionStyle = (c) => {
    if (c === "high") return { bg: "var(--sa-green-soft)", fg: "var(--sa-green)" };
    if (c === "medium") return { bg: "var(--sa-accent-soft)", fg: "var(--sa-accent-2)" };
    return { bg: "#f3f4f6", fg: "#6b7280" };
  };

  return (
    <div>
      <h2>Discover</h2>
      <div className="sa-breadcrumb">
        Multi-bagger candidate scanner — AI-written thesis for each. Honest expectation: most leads underperform; a small number 5-10×.
      </div>

      {/* ── High-conviction multi-factor screen (top 2-3, transparent scoring) ── */}
      <div className="sa-card" style={{ marginBottom: 18, padding: 16, borderColor: "var(--sa-accent)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🎯 High-Conviction Screen</div>
            <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 2, maxWidth: 560 }}>
              Combines fundamentals, momentum, technicals, catalysts, sentiment & risk control into one transparent 0–100 score. Returns the 2–3 strongest evidence clusters — not guarantees.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={hcRiskMode}
              onChange={(e) => setHcRiskMode(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13 }}
              title="Risk mode re-weights the six factors"
            >
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
              <option value="speculative">Speculative</option>
            </select>
            <select
              value={hcMarket}
              onChange={(e) => setHcMarket(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13 }}
              title="Which market to screen"
            >
              <option value="both">🇺🇸🇨🇦 Both markets</option>
              <option value="us">🇺🇸 US only</option>
              <option value="canada">🇨🇦 Canada only</option>
            </select>
            <button className="sa-btn" onClick={runHighConviction} disabled={hcBusy}>
              {hcBusy ? "Screening…" : "Run high-conviction screen"}
            </button>
          </div>
        </div>

        {/* Mosaic Intelligence toggle — public-data signal aggregation as a 7th factor */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={hcMosaic} onChange={(e) => setHcMosaic(e.target.checked)} />
            <span style={{ fontWeight: 600 }}>🧩 Add Mosaic Intelligence</span>
          </label>
          <span style={{ color: "var(--sa-muted)" }}>public-data signal mosaic (insider filings, hiring, demand, supply chain, regulatory, market structure, mgmt language)</span>
          {hcMosaic && (
            <select value={hcMosaicMode} onChange={(e) => setHcMosaicMode(e.target.value)} style={{ padding: "5px 8px", borderRadius: 7, fontSize: 12 }} title="Mosaic alt-data mode">
              <option value="conservative">Conservative signals only</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive alt-data</option>
            </select>
          )}
        </div>

        {hcError && <div className="sa-err" style={{ marginTop: 12 }}>{hcError}</div>}

        {hcResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ background: "var(--sa-amber-soft)", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {hcResult.disclaimer}
            </div>
            {hcResult.upgradeRecommendation && (
              <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 12 }}>{hcResult.upgradeRecommendation}</div>
            )}
            {(!hcResult.picks || hcResult.picks.length === 0) ? (
              <div style={{ fontSize: 13, color: "var(--sa-muted)" }}>
                {hcResult.error || "No candidates cleared a genuine high-conviction bar this run."}
                {hcResult.diagnostic?.shortlistSize != null && (
                  <span> (screened {hcResult.diagnostic.shortlistSize} shortlist names.)</span>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {hcResult.belowBar && (
                  <div style={{ background: "var(--sa-amber-soft)", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>
                    ⓘ No candidate cleared the high-conviction bar this run — showing the strongest shortlist names ranked on <b>hard data only</b> (fundamentals / momentum / technical / risk). Catalysts & sentiment were not confirmed. Treat these as <b>watchlist candidates</b>, not buy signals.
                  </div>
                )}
                {hcResult.picks.map((p, i) => (
                  <HighConvictionCard key={p._id || p.ticker} pick={p} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Moonshot 10x mode ── */}
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🚀 Moonshot 10x</div>
        <div style={{ fontSize: 12.5, color: "var(--sa-muted)", marginTop: 4, marginBottom: 10, lineHeight: 1.5 }}>
          Aggressive hunt for 2–5 asymmetric 5x–10x setups — pre-parabolic structure, market-reality lag, synthetic-insider & Mosaic signals, calibrated probabilities. Uses the market + sectors selected above. <b>Speculative — most won't 5x.</b>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8, marginBottom: 10, width: "fit-content" }}>
          {[["long", "Long-term (3–10y)"], ["short", "Short-term (3–18mo)"]].map(([v, label]) => (
            <button key={v} onClick={() => setMsHorizon(v)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, cursor: "pointer", background: msHorizon === v ? "var(--sa-accent)" : "transparent", color: msHorizon === v ? "#fff" : "var(--sa-text-2)" }}>{label}</button>
          ))}
        </div>
        {msHorizon === "short" && (
          <div style={{ fontSize: 11.5, color: "var(--sa-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Short-term mode weights catalysts, supply/demand mechanics, and early-stage narrative ignition over slow fundamentals. Auto-rejects names with no catalyst in 6 months, lockup/ATM overhang, peak crowding, sector downtrends, or under $5M/day volume.
          </div>
        )}
        <button className="sa-btn" onClick={runMoonshot} disabled={msBusy}>
          {msBusy ? "Hunting moonshots…" : `🚀 Run Moonshot ${msHorizon === "short" ? "(short-term)" : "(long-term)"} scan`}
        </button>
        {msError && <div className="sa-err" style={{ marginTop: 12 }}>{msError}</div>}
        {msResult && (
          <div style={{ marginTop: 14 }}>
            <div style={{ background: "var(--sa-amber-soft)", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
              ⚠️ {msResult.disclaimer}
            </div>
            {msResult.upgradeRecommendation && (
              <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 12 }}>{msResult.upgradeRecommendation}</div>
            )}
            {(!msResult.picks || msResult.picks.length === 0) ? (
              <div style={{ fontSize: 13, color: "var(--sa-muted)" }}>
                {msResult.error || "No candidate cleared the asymmetric-10x bar this run."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {msResult.picks.map((p, i) => (
                  <MoonshotCard key={p._id || p.ticker} pick={p} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sa-card" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Presets — one click to scan a theme</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            { id: "growth",   label: "🚀 Small-cap growth",    min: 200,  max: 5000,  sectors: "" },
            { id: "micro",    label: "🌱 Microcap moonshots",  min: 50,   max: 500,   sectors: "" },
            { id: "biotech",  label: "🧬 Biotech catalysts",   min: 100,  max: 3000,  sectors: "Healthcare" },
            { id: "ai",       label: "🤖 AI infrastructure",   min: 500,  max: 20000, sectors: "Technology" },
            { id: "energy",   label: "⚡ Energy transition",   min: 300,  max: 8000,  sectors: "Energy,Utilities,Industrials" },
            { id: "defense",  label: "🛡 Defense / aerospace", min: 200,  max: 5000,  sectors: "Industrials" },
            { id: "consumer", label: "🛒 Consumer turnarounds",min: 100,  max: 3000,  sectors: "Consumer Cyclical,Consumer Defensive" },
            { id: "fintech",  label: "💳 Fintech disruption",  min: 200,  max: 6000,  sectors: "Financial Services,Technology" },
            { id: "canadian", label: "🍁 Canadian smallcap",   min: 100,  max: 3000,  sectors: "Basic Materials,Energy" },
          ].map((p) => (
            <button
              key={p.id}
              className="sa-btn ghost"
              onClick={() => {
                setMarketCapMin(p.min);
                setMarketCapMax(p.max);
                setSectorsCsv(p.sectors);
              }}
              style={{ fontSize: 12, padding: "5px 11px" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, paddingTop: 4, borderTop: "1px dashed var(--sa-border)" }}>Scan parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--sa-muted)" }}>Top N</label>
            <input type="number" min="1" max="15" value={topN} onChange={(e) => setTopN(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--sa-muted)" }}>Min mkt cap ($M)</label>
            <input type="number" min="0" value={marketCapMin} onChange={(e) => setMarketCapMin(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--sa-muted)" }}>Max mkt cap ($M)</label>
            <input type="number" min="0" value={marketCapMax} onChange={(e) => setMarketCapMax(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--sa-muted)" }}>Sectors (comma-separated, blank = all)</label>
            <input type="text" value={sectorsCsv} onChange={(e) => setSectorsCsv(e.target.value)} placeholder="Technology, Healthcare, Energy" />
          </div>
          <button className="sa-btn" onClick={runScan} disabled={busy}>
            {busy ? "Scanning…" : "🔍 Scan"}
          </button>
        </div>
        <div className="sa-muted" style={{ fontSize: 11, marginTop: 8 }}>
          A scan calls FMP ~80 times + Claude once per candidate (~$1 of AI spend per 10 candidates). Don't run more than weekly.
        </div>
      </div>

      {error && <div className="sa-err" style={{ marginBottom: 14 }}>{error}</div>}
      {scanMode === "suppressed" && (
        <div className="sa-card" style={{ marginBottom: 14, padding: "12px 16px", background: "var(--sa-red-soft, #fef2f2)", borderColor: "var(--sa-red, #dc2626)" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>🛡 Discovery suppressed by kill switch</div>
          <div className="sa-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            The discretionary discovery engine is currently paused because recent performance is below the recovery threshold:<br/><br/>
            <code style={{ background: "var(--sa-panel-2)", padding: "2px 6px", borderRadius: 4 }}>{suppressReason || "kill switch active"}</code><br/><br/>
            <b>Why:</b> when the 30d hit rate falls below 40% or the average PnL falls below −1.5%, the engine stops surfacing new SPEC candidates — every new pick would just add to the loss pile. It reopens automatically once performance clears the floor (or a canary pick fires once per rolling week to keep sampling).<br/><br/>
            <b>Also active:</b> theme-first gate (SPEC candidates outside your enabled themes are dropped), per-setup ban (setup types with ≥10 closed samples and &lt;30% win rate are filtered), and the high-conviction SPEC gate (requires thesisHorizonMonths ≥ 3 and a structural driver). See the §3 GATES line in your daily briefing for live status.
          </div>
        </div>
      )}
      {scanMode === "ai-only" && (
        <div className="sa-card" style={{ marginBottom: 14, padding: "12px 16px", background: "var(--sa-amber-soft)", borderColor: "var(--sa-amber)" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>⚠ AI-only mode — FMP screener unavailable on your plan</div>
          <div className="sa-muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Discovery fell back to AI-only mode because your FMP plan doesn't include the stock-screener endpoint. AI-only mode surfaces candidates via web search — useful but less rigorous than a real fundamentals-driven screen across 80+ tickers. <br/><br/>
            <b>For your use case (Canadian portfolio with TSX names + small-cap discovery), FMP Premium ($49/mo annually = $588/yr) is the right tier.</b> Starter ($19/mo) is <b>US-only</b> and won't cover your Canadian holdings. Premium adds: full stock screener · 750 calls/min · 30y history · <b>UK + Canada coverage</b> · technical indicators · corporate calendars (for catalyst-aware discovery).<br/><br/>
            Upgrade at <a href="https://financialmodelingprep.com/developer/docs/pricing" target="_blank" rel="noopener noreferrer" style={{ color: "var(--sa-accent-2)" }}>financialmodelingprep.com</a>. Keep the same FMP_API_KEY env var — the system will automatically switch back to the rigorous screened path on the next scan.
          </div>
        </div>
      )}
      {busy && (
        <div className="sa-card" style={{ padding: 24, textAlign: "center", color: "var(--sa-muted)" }}>
          Running discovery scan… <br />
          <div style={{ fontSize: 12, marginTop: 6 }}>FMP universe + per-ticker fundamentals + AI thesis writer × Top N · 60-120s</div>
        </div>
      )}

      {!busy && candidates.length === 0 && (
        <div className="sa-card" style={{ padding: 24, textAlign: "center", color: "var(--sa-muted)" }}>
          No candidates yet. Click <b>🔍 Scan</b> to find some.
        </div>
      )}

      {scanDate && candidates.length > 0 && (
        <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          📅 Last scan: {new Date(scanDate).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} — {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
        </div>
      )}

      {candidates.map((c) => {
        const pal = convictionStyle(c.thesis?.conviction);
        const expanded = expandedId === c._id;
        const upsidePct = (c.thesis?.priceTarget && c.priceAtDiscovery)
          ? ((c.thesis.priceTarget - c.priceAtDiscovery) / c.priceAtDiscovery) * 100
          : null;
        return (
          <div key={c._id} className="sa-advice-card" style={{ marginBottom: 12, borderLeft: `4px solid ${pal.fg}` }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 17 }}>{c.ticker}</span>
                <span style={{ marginLeft: 8, fontSize: 13, color: "var(--sa-muted)" }}>{c.name || ""}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sa-muted)" }}>· {c.sector || "—"} · ${(c.marketCap / 1_000_000).toFixed(0)}M cap</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ background: pal.bg, color: pal.fg, padding: "2px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: ".04em" }}>
                  {c.thesis?.conviction?.toUpperCase() || "—"} conviction
                </span>
                <span className="sa-muted" style={{ fontSize: 11 }}>{c.score > 0 ? `score ${c.score}/100` : "not scored"}</span>
                <ConvictionTrendBadge history={c.scoreHistory} />
              </div>
            </div>

            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--sa-text)" }}>
              <b>Bull case:</b> {c.thesis?.bullCase || "—"}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--sa-text-2)", marginTop: 6 }}>
              <b style={{ color: "#b91c1c" }}>Kill thesis:</b> {c.thesis?.killThesis || "—"}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--sa-text-2)" }}>
              Price now: <b><span className="sa-amount">${c.priceAtDiscovery?.toFixed(2)}</span></b>
              {c.thesis?.priceTarget && (
                <>
                  {" "}· Target: <b><span className="sa-amount">${c.thesis.priceTarget.toFixed(2)}</span></b>
                  {upsidePct != null && (
                    <span style={{ marginLeft: 6, color: upsidePct > 0 ? "var(--sa-green)" : "var(--sa-amber)" }}>
                      ({upsidePct > 0 ? "+" : ""}{upsidePct.toFixed(0)}%)
                    </span>
                  )}
                </>
              )}
              {c.thesis?.horizonMonths && <> · Horizon: <b>{c.thesis.horizonMonths}mo</b></>}
            </div>

            {expanded && (
              <div style={{ marginTop: 12, padding: 12, background: "var(--sa-panel-2)", borderRadius: 6 }}>
                {c.thesis?.catalysts?.length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Catalysts to watch</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                      {c.thesis.catalysts.map((cat, i) => <li key={i}>{cat}</li>)}
                    </ul>
                  </>
                )}
                <div style={{ marginTop: 12, fontSize: 11, color: "var(--sa-muted)" }}>
                  <b>Signals:</b> rev growth {c.signals?.revenueGrowthPct?.toFixed(1) ?? "—"}% · gross margin {c.signals?.grossMarginPct?.toFixed(1) ?? "—"}% · debt/equity {c.signals?.netDebtToEquity?.toFixed(2) ?? "—"}
                </div>
                {c.thesis?.sources?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Sources</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
                      {c.thesis.sources.slice(0, 8).map((s, i) => (
                        <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--sa-accent-2)" }}>{s.title || s.url}</a></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="sa-btn ghost" onClick={() => setExpandedId(expanded ? null : c._id)} style={{ fontSize: 12 }}>
                {expanded ? "Hide details" : "More details"}
              </button>
              <button className="sa-btn ghost" onClick={() => toggleStar(c._id)} style={{ fontSize: 12 }}>
                {c.starred ? "★ Starred" : "☆ Star"}
              </button>
              <button className="sa-btn ghost" onClick={() => dismiss(c._id)} style={{ fontSize: 12, color: "var(--sa-amber)" }}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })}

      {starredOlder.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, color: "var(--sa-text-2)", marginBottom: 8 }}>★ Starred from earlier scans</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {starredOlder.map((c) => (
              <div key={c._id} className="sa-card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div>
                  <b>{c.ticker}</b>
                  <span style={{ marginLeft: 6, fontSize: 12, color: "var(--sa-muted)" }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)" }}>
                  found {new Date(c.scanDate).toLocaleDateString()} · target <span className="sa-amount">${c.thesis?.priceTarget?.toFixed(2) ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Performance view — portfolio time series + "if-followed" advisor scorecard
// =============================================================================
function PerformanceView({ sessionToken, user }) {
  const [snaps, setSnaps] = useState(null);
  const [perfAccounts, setPerfAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("__total__");
  const [advisorPerf, setAdvisorPerf] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [scorecardDays, setScorecardDays] = useState(30);
  const [discoveryScorecard, setDiscoveryScorecard] = useState(null);
  const [setupScorecard, setSetupScorecard] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [tradesActivity, setTradesActivity] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  // Data-status panel — counts of every persisted record type, so "why is
  // this empty?" can be answered with hard numbers instead of guessing.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-advice/data-status`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setDataStatus(j);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // Pull Discovery scorecard once on mount (decoupled from advice scorecard
  // since it has its own data shape and time-window logic).
  // Fetch trade history once on mount — feeds the trades-activity tile.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-trade?days=365`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setTradesActivity(j.trades || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-discover/scorecard`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setDiscoveryScorecard(j);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true); setErr(null);
      try {
        const [snapRes, perfRes, scoreRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/stocks-portfolio/performance?days=365&accountId=${encodeURIComponent(selectedAccountId)}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${BACKEND_URL}/api/stocks-advice/performance?days=30`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${BACKEND_URL}/api/stocks-advice/scorecard?days=${scorecardDays}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
        ]);
        const snapJ = await snapRes.json();
        const perfJ = await perfRes.json();
        const scoreJ = await scoreRes.json();
        if (!cancelled) {
          setSnaps(snapJ?.snapshots || []);
          setPerfAccounts(snapJ?.accounts || []);
          setAdvisorPerf(perfJ);
          setScorecard(scoreJ);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, scorecardDays, selectedAccountId]);

  return (
    <div>
      <h2>Performance</h2>
      <div className="sa-breadcrumb">Portfolio value over time · advisor scorecard</div>

      {/* ── DATA STATUS: how much is actually in the database, with
          actionable hints when sections below come back empty. */}
      <DataStatusPanel data={dataStatus} sessionToken={sessionToken} />

      <BriefingDiagnosticsCard sessionToken={sessionToken} />

      <AlertsCard sessionToken={sessionToken} />

      <EightKFeedCard sessionToken={sessionToken} />

      <WeekInReviewCard sessionToken={sessionToken} user={user} />

      <SourceScorecardCard sessionToken={sessionToken} />

      <DailyPickCard sessionToken={sessionToken} user={user} />

      <PointInTimeBacktestCard sessionToken={sessionToken} />

      <BacktestCard sessionToken={sessionToken} />

      <InsiderSignalsCard sessionToken={sessionToken} />

      <OptionsFlowCard sessionToken={sessionToken} />

      <DisciplineBacktestCard sessionToken={sessionToken} />

      <TradeJournalAnalysisCard sessionToken={sessionToken} />

      {/* ── ADVICE SCORECARD: what was taken, what worked, what didn't ── */}
      <AdviceScorecardCard
        scorecard={scorecard}
        days={scorecardDays}
        onChangeDays={setScorecardDays}
      />

      {/* ── DISCOVERY SCORECARD: did the Discover engine actually find winners? ── */}
      <TradesActivityCard trades={tradesActivity} />
      <DiscoveryScorecardCard data={discoveryScorecard} />
      <SetupScorecardCard data={setupScorecard} sessionToken={sessionToken} onLoad={setSetupScorecard} />
      <SizingBacktestCard sessionToken={sessionToken} />
      <TcaCard sessionToken={sessionToken} />

      {/* ── Advisor scorecard ── */}
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>If you had followed my advice</h3>
        {busy && <div className="sa-muted">Loading…</div>}
        {err && <div className="sa-err">{err}</div>}
        {!busy && advisorPerf && (
          advisorPerf.windows?.every((w) => w.recCount === 0) ? (
            <div className="sa-muted" style={{ fontSize: 13 }}>
              No tracked recommendations yet. Visit the Advice tab and click <b>🧠 Update Advice</b> — every actionable recommendation gets logged and scored here.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {advisorPerf.windows.map((w) => (
                <div key={w.days} style={{ background: "var(--sa-panel-2)", padding: 14, borderRadius: 10 }}>
                  <div className="sa-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>
                    Last {w.days} days
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: w.avgPnlPct == null ? "var(--sa-muted)" : (w.avgPnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)") }}>
                    {w.avgPnlPct == null ? "—" : (w.avgPnlPct >= 0 ? "+" : "") + w.avgPnlPct.toFixed(2) + "%"}
                  </div>
                  <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {w.recCount} {w.recCount === 1 ? "rec" : "recs"}{w.hitRate != null ? ` · ${w.hitRate.toFixed(0)}% hit rate` : ""}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Recent recommendations table ── */}
      {advisorPerf?.recent?.length > 0 && (
        <div className="sa-card" style={{ marginBottom: 18, padding: 0 }}>
          <div style={{ padding: "18px 22px 8px" }}>
            <h3 style={{ margin: 0 }}>Recent recommendations</h3>
          </div>
          <table className="sa-table">
            <thead><tr>
              <th>Generated</th><th>Ticker</th><th>Action</th><th>Entry</th><th>Target</th><th>Stop</th><th>Now</th><th>P&amp;L</th>
            </tr></thead>
            <tbody>
              {advisorPerf.recent.map((r, i) => (
                <tr key={i}>
                  <td style={{ textAlign: "left" }}>{new Date(r.generatedAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>{r.ticker}</td>
                  <td style={{ textAlign: "left" }}><span className={`sa-badge ${r.action === "BUY" ? "green" : r.action === "SELL" || r.action === "TRIM" ? "red" : "amber"}`}>{r.action}</span></td>
                  <td>{r.entryPrice ? "$" + r.entryPrice.toFixed(2) : "—"}</td>
                  <td>{r.targetPrice ? "$" + r.targetPrice.toFixed(2) : "—"}</td>
                  <td>{r.stopPrice ? "$" + r.stopPrice.toFixed(2) : "—"}</td>
                  <td>{r.currentPrice ? "$" + r.currentPrice.toFixed(2) : "—"}</td>
                  <td style={{ fontWeight: 600, color: r.pnlPct == null ? "var(--sa-muted)" : (r.pnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)") }}>
                    {r.pnlPct == null ? "—" : (r.pnlPct >= 0 ? "+" : "") + r.pnlPct.toFixed(2) + "%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Portfolio value chart with per-account selector ── */}
      <div className="sa-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>
            {selectedAccountId === "__total__"
              ? "Portfolio total value (last 12 months)"
              : `${perfAccounts.find(a => a.id === selectedAccountId)?.name || "Account"} — last 12 months`}
          </h3>
          {perfAccounts.length > 0 && (
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              style={{ maxWidth: 240, fontSize: 13, padding: "6px 10px" }}
            >
              <option value="__total__">📊 All accounts (aggregate)</option>
              {perfAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>
        {busy && <div className="sa-muted">Loading…</div>}
        {!busy && (snaps == null || snaps.length === 0) && (
          <div className="sa-muted" style={{ fontSize: 13 }}>
            No history yet. Every time you save changes on /stocks, a daily snapshot is recorded — the chart will fill in over the coming days.
          </div>
        )}
        {!busy && snaps && snaps.length > 0 && <PortfolioChart snaps={snaps} />}
      </div>
    </div>
  );
}

// =============================================================================
// Pending Orders card — orders submitted at the broker that haven't filled.
// Each row has a Mark Filled (records the trade with actual fill data) and
// Cancel (removes the pending order without recording).
// =============================================================================
function PendingOrdersCard({ orders, accounts, onFill, onCancel }) {
  return (
    <div className="sa-card" style={{ marginBottom: 24, padding: 0, overflow: "hidden", borderColor: "#bfdbfe" }}>
      <div style={{ padding: "16px 22px 10px", background: "#eff6ff" }}>
        <h3 style={{ margin: 0 }}>📋 Pending orders at broker</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 2 }}>
          Orders you've placed at CIBC but haven't filled yet. When the broker fills (or you cancel), come back to mark it.
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--sa-panel-2)" }}>
              <th style={recHeaderCellLeft}>Side</th>
              <th style={recHeaderCellLeft}>Ticker</th>
              <th style={recHeaderCell}>Qty</th>
              <th style={recHeaderCell}>Limit</th>
              <th style={recHeaderCellLeft}>Account</th>
              <th style={recHeaderCellLeft}>Submitted</th>
              <th style={recHeaderCell}></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const acctName = accounts.find(a => a.id === o.account)?.name || "—";
              const sideColor = o.side === "BUY" ? "var(--sa-green)" : "var(--sa-red)";
              const sideBg = o.side === "BUY" ? "var(--sa-green-soft)" : "var(--sa-red-soft)";
              const age = Math.floor((Date.now() - new Date(o.submittedAt).getTime()) / 60000); // mins
              const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`;
              return (
                <tr key={o._id} style={{ borderTop: "1px solid var(--sa-border)" }}>
                  <td style={recCellLeft}>
                    <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: sideBg, color: sideColor }}>{o.side}</span>
                  </td>
                  <td style={{ ...recCellLeft, fontWeight: 600 }}>{o.ticker}</td>
                  <td style={recCell}>{o.qty.toLocaleString()}</td>
                  <td style={recCell}><span className="sa-amount">${o.limitPrice.toFixed(2)} {o.currency}</span></td>
                  <td style={{ ...recCellLeft, color: "var(--sa-muted)" }}>{acctName}</td>
                  <td style={{ ...recCellLeft, color: "var(--sa-muted)", fontSize: 12 }}>{ageStr}</td>
                  <td style={{ ...recCell, whiteSpace: "nowrap" }}>
                    <button className="sa-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => onFill(o)}>✓ Mark filled</button>
                    {" "}
                    <button className="sa-btn ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => { if (confirm("Cancel this pending order?")) onCancel(o._id); }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// Holdings breakdown — one row per ticker, split by which currency sub-account
// the position is parked in (USD-sub vs CAD-sub). Shows total CAD equivalent.
// Plus a CASH row at the bottom. Plus totals.
// =============================================================================
// Small colored dot + tooltip indicating a linked open rec's horizon
// status. Renders NOTHING when the ticker has no matching horizon row
// or the linked rec is on-pace (green) — silence is the good state.
function HorizonDot({ row }) {
  if (!row) return null;
  const style = {
    expired:      { bg: "#f59e0b", text: "⌛ Horizon expired — needs EXIT / ROLL / TRIM decision" },
    "hit-stop":   { bg: "#dc2626", text: "🛑 Rec's stop was hit — thesis invalidated" },
    "well-behind":{ bg: "#ef4444", text: "🔴 Well behind pace — thesis may have broken" },
    lagging:      { bg: "#eab308", text: "🟡 Lagging expected pace — no action yet" },
  }[row.status];
  if (!style) return null; // on-pace / hit-target / unknown → no dot
  return (
    <span
      title={`${style.text} · day ${row.daysElapsed}/${row.horizonDays} · entry $${row.entry?.toFixed?.(2)} → now ${row.current != null ? `$${row.current.toFixed(2)}` : "n/a"} · target $${row.target?.toFixed?.(2)}`}
      style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: style.bg, marginLeft: 6, verticalAlign: "middle",
        boxShadow: `0 0 0 2px ${style.bg}33`,
      }}
    />
  );
}

function HoldingsBreakdownCard({ user, fx, onEditPosition, horizonByBase = {} }) {
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [cashExpanded, setCashExpanded] = useState(false); // per-account cash breakdown
  const [collapsed, setCollapsed] = useState(true); // whole card starts collapsed

  // Group by ticker; track the actual position indices that compose each
  // ticker so we can show per-lot detail and route Edit clicks back to the
  // correct row in user.positions.
  const byTicker = new Map();
  (user.positions || []).forEach((p, posIdx) => {
    if (!byTicker.has(p.ticker)) {
      byTicker.set(p.ticker, {
        ticker: p.ticker, qtyUsdSub: 0, valueUsd: 0, qtyCadSub: 0, valueCad: 0,
        lots: [], // [{ posIdx, p }]
      });
    }
    const row = byTicker.get(p.ticker);
    const sub = p.subCcy || p.ccy;
    const qty = p.qty || 0;
    if (sub === "USD") {
      row.qtyUsdSub += qty;
      row.valueUsd += (p.priceUsd || 0) * qty;
    } else {
      row.qtyCadSub += qty;
      row.valueCad += (p.priceCad || 0) * qty;
    }
    row.lots.push({ posIdx, p });
  });
  const rows = [...byTicker.values()]
    .map(r => ({ ...r, totalCad: r.valueCad + r.valueUsd * fx }))
    .sort((a, b) => b.totalCad - a.totalCad);

  // Cash totals across all accounts
  let cashUsd = 0, cashCad = 0;
  for (const a of user.accounts || []) {
    cashUsd += a.cashUsd || 0;
    cashCad += a.cashCad || 0;
  }
  const cashTotalCad = cashCad + cashUsd * fx;

  // Grand totals
  const totals = rows.reduce(
    (acc, r) => ({ valueUsd: acc.valueUsd + r.valueUsd, valueCad: acc.valueCad + r.valueCad }),
    { valueUsd: 0, valueCad: 0 }
  );
  const equityTotalCad = totals.valueCad + totals.valueUsd * fx;
  const grandTotalCad = equityTotalCad + cashTotalCad;

  const fmt$ = (n) => n === 0 ? "—" : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtQ = (n) => n === 0 ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  // Count of split tickers (held in both subs — surfaced even when collapsed)
  const splitCount = rows.filter(r => r.qtyUsdSub > 0 && r.qtyCadSub > 0).length;

  return (
    <div className="sa-card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
      <div
        style={{ padding: "18px 22px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--sa-muted)", transform: collapsed ? "none" : "rotate(90deg)", transition: "transform .15s", display: "inline-block" }}>▶</span>
            Holdings breakdown
          </h3>
          <div className="sa-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {collapsed
              ? `${rows.length} tickers · ${fmt$(grandTotalCad)} CAD${splitCount > 0 ? ` · ${splitCount} split across subs` : ""} · click to expand`
              : "One row per ticker, split by which currency sub-account holds the position. US stocks held in a CAD sub are flagged so AI recs can plan consolidation. Mirrors how CIBC Investor's Edge shows sub-account balances."}
          </div>
        </div>
      </div>
      {!collapsed && (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--sa-panel-2)" }}>
              <th style={{ ...recHeaderCellLeft }}>Ticker</th>
              <th style={recHeaderCell}>Qty (USD-sub)</th>
              <th style={recHeaderCell}>Value (USD)</th>
              <th style={recHeaderCell}>Qty (CAD-sub)</th>
              <th style={recHeaderCell}>Value (CAD)</th>
              <th style={recHeaderCell}>Total (≈CAD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...recCellLeft, color: "var(--sa-muted)", padding: 28, textAlign: "center" }}>
                No positions yet. Add some on the Positions tab.
              </td></tr>
            ) : rows.flatMap((r) => {
              const split = r.qtyUsdSub > 0 && r.qtyCadSub > 0;
              const isExpanded = expandedTicker === r.ticker;
              const rowEls = [
                <tr
                  key={r.ticker}
                  onClick={() => setExpandedTicker(isExpanded ? null : r.ticker)}
                  style={{ borderTop: "1px solid var(--sa-border)", cursor: "pointer", background: isExpanded ? "rgba(91,141,239,.05)" : "transparent" }}
                >
                  <td style={{ ...recCellLeft, fontWeight: 600 }}>
                    <span style={{ display: "inline-block", width: 14, color: "var(--sa-muted)", fontSize: 10, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                    {r.ticker}
                    <HorizonDot row={horizonByBase[String(r.ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "")]} />
                    {split && <span title="Held in both USD and CAD subs — consider consolidating to avoid FX friction" style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, background: "var(--sa-amber-soft)", color: "var(--sa-amber)", borderRadius: 4 }}>SPLIT</span>}
                  </td>
                  <td style={recCell}>{fmtQ(r.qtyUsdSub)}</td>
                  <td style={recCell}><span className="sa-amount">{fmt$(r.valueUsd)}</span></td>
                  <td style={recCell}>{fmtQ(r.qtyCadSub)}</td>
                  <td style={recCell}><span className="sa-amount">{fmt$(r.valueCad)}</span></td>
                  <td style={{ ...recCell, fontWeight: 600 }}><span className="sa-amount">{fmt$(r.totalCad)}</span></td>
                </tr>
              ];
              if (isExpanded) {
                rowEls.push(
                  <tr key={r.ticker + "-detail"} style={{ background: "var(--sa-panel-2)" }}>
                    <td colSpan={6} style={{ padding: "10px 22px" }}>
                      <table style={{ width: "100%", fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: "var(--sa-muted)" }}>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Account</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Market</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Sub</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Qty</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Price</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Cost basis</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Value</th>
                            <th style={{ padding: "4px 8px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.lots.map(({ posIdx, p }) => {
                            const acctName = user.accounts.find(a => a.id === p.acct)?.name || "—";
                            const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
                            const cost = p.ccy === "USD" ? p.costBasisUsd : p.costBasisCad;
                            const value = (price || 0) * (p.qty || 0);
                            const sub = p.subCcy || p.ccy;
                            return (
                              <tr key={posIdx} style={{ borderTop: "1px solid var(--sa-border)" }}>
                                <td style={{ padding: "6px 8px" }}>{acctName}</td>
                                <td style={{ padding: "6px 8px" }}>{p.ccy}</td>
                                <td style={{ padding: "6px 8px" }}>{sub}{p.ccy !== sub && <span style={{ color: "var(--sa-amber)", marginLeft: 4 }} title="Market ≠ sub: this lot has FX exposure">⚠</span>}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>{p.qty.toLocaleString()}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>{price ? `$${price.toFixed(2)}` : "—"}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>{cost != null ? `$${cost.toFixed(2)}` : <span className="sa-muted">—</span>}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} {p.ccy}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                  {onEditPosition && (
                                    <button
                                      className="sa-btn ghost"
                                      style={{ padding: "3px 10px", fontSize: 11 }}
                                      onClick={(e) => { e.stopPropagation(); onEditPosition(posIdx); }}
                                    >Edit</button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                );
              }
              return rowEls;
            })}
            <tr
              onClick={() => setCashExpanded(v => !v)}
              style={{ borderTop: "1px dashed var(--sa-border)", background: cashExpanded ? "rgba(91,141,239,.08)" : "rgba(91,141,239,.04)", cursor: "pointer" }}
            >
              <td style={{ ...recCellLeft, fontWeight: 500, color: "var(--sa-text-2)" }}>
                <span style={{ display: "inline-block", width: 14, color: "var(--sa-muted)", fontSize: 10, transform: cashExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                Cash
                <span className="sa-muted" style={{ marginLeft: 6, fontSize: 11, fontWeight: 400 }}>· {(user.accounts || []).length} account{(user.accounts || []).length === 1 ? "" : "s"}</span>
              </td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, color: cashUsd > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(cashUsd)}</span></td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, color: cashCad > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(cashCad)}</span></td>
              <td style={{ ...recCell, fontWeight: 600 }}><span className="sa-amount">{fmt$(cashTotalCad)}</span></td>
            </tr>
            {cashExpanded && (
              <tr style={{ background: "var(--sa-panel-2)" }}>
                <td colSpan={6} style={{ padding: "10px 22px" }}>
                  <table style={{ width: "100%", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr style={{ color: "var(--sa-muted)" }}>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Account</th>
                        <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>USD cash</th>
                        <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>CAD cash</th>
                        <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Total (≈CAD)</th>
                        <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>% of cash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(user.accounts || []).map((a) => {
                        const u = a.cashUsd || 0;
                        const c = a.cashCad || 0;
                        const tot = c + u * fx;
                        const pct = cashTotalCad > 0 ? (tot / cashTotalCad) * 100 : 0;
                        const empty = u === 0 && c === 0;
                        return (
                          <tr key={a.id} style={{ borderTop: "1px solid var(--sa-border)", opacity: empty ? 0.55 : 1 }}>
                            <td style={{ padding: "6px 8px", fontWeight: 500 }}>{a.name}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: u > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(u)}</span></td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: c > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(c)}</span></td>
                            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}><span className="sa-amount">{fmt$(tot)}</span></td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{pct > 0 ? pct.toFixed(1) + "%" : "—"}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: "1px dashed var(--sa-border)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700 }}>All accounts</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}><span className="sa-amount">{fmt$(cashUsd)}</span></td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}><span className="sa-amount">{fmt$(cashCad)}</span></td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}><span className="sa-amount">{fmt$(cashTotalCad)}</span></td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)" }}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid var(--sa-border)", background: "var(--sa-panel-2)" }}>
              <td style={{ ...recCellLeft, fontWeight: 700 }}>TOTAL</td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, fontWeight: 700 }}><span className="sa-amount">{fmt$(totals.valueUsd + cashUsd)}</span></td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, fontWeight: 700 }}><span className="sa-amount">{fmt$(totals.valueCad + cashCad)}</span></td>
              <td style={{ ...recCell, fontWeight: 700 }}><span className="sa-amount">{fmt$(grandTotalCad)}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// =============================================================================
// PositionBar — one-line visual per held ticker
//
// Layout, left→right, on a price scale from `scaleMin` to `scaleMax`:
//
//   [ below-stop ][ loss (stop→entry) ][ profit (entry→target) ][ above-target ]
//         │              │                       │                     │
//        stop         entry                    target                  ▲ current marker
//
// Colors mirror the P/L convention: red family below entry, green above.
// The "below stop" and "above target" bands only appear when current
// actually drifts into them, so a healthy position doesn't visually
// scream at the edges. When target is null (many CORE ETFs) the profit
// zone is open-ended right. When stop is null the loss zone anchors at
// scaleMin. If BOTH are null we return null (nothing meaningful to plot).
// =============================================================================
function PositionBar({ entry, stop, target, current, currency, stopSource = "rec", targetSource = "rec", recs = [] }) {
  if (!Number.isFinite(entry) || !Number.isFinite(current)) return null;
  // Sanity guard — a target that isn't above the stop breaks the
  // profit-zone segment math and collapses the scale (all ticks land
  // near position 0, labels stack unreadably). Silently drop the
  // target and render as stop+entry+current only; caller's derivation
  // is broken but we shouldn't render garbage.
  if (Number.isFinite(target) && Number.isFinite(stop) && target <= stop) {
    target = null;
  }

  // Scale endpoints — 10% padding beyond the outer of stop/target so
  // the marker still has room to move when current is at a boundary.
  let scaleMin, scaleMax;
  if (Number.isFinite(stop) && Number.isFinite(target)) {
    const span = Math.max(target - stop, 0.01);
    scaleMin = Math.min(stop, current) - span * 0.05;
    scaleMax = Math.max(target, current) + span * 0.05;
  } else if (Number.isFinite(stop)) {
    const span = Math.max(entry - stop, 0.01);
    scaleMin = Math.min(stop, current) - span * 0.1;
    scaleMax = Math.max(entry, current) + span * 0.5;
  } else if (Number.isFinite(target)) {
    const span = Math.max(target - entry, 0.01);
    scaleMin = Math.min(entry, current) - span * 0.3;
    scaleMax = Math.max(target, current) + span * 0.1;
  } else {
    // No stop, no target — CORE-ETF / buy-and-hold fallback. Scale
    // by ~15% around the wider of entry/current so the reader gets
    // "am I up or down and by how much" at a glance. Same visual
    // grammar as the other cases (red left of entry, green right,
    // "now" pill above the current marker) minus the tick decoration.
    const anchor = Math.max(Math.abs(entry), Math.abs(current), 0.01);
    const half = anchor * 0.15;
    scaleMin = Math.min(entry, current) - half;
    scaleMax = Math.max(entry, current) + half;
  }
  const pos = (v) => Math.max(0, Math.min(100, ((v - scaleMin) / (scaleMax - scaleMin)) * 100));
  const cP = pos(current);
  const eP = pos(entry);
  const sP = Number.isFinite(stop) ? pos(stop) : null;
  const tP = Number.isFinite(target) ? pos(target) : null;

  // Segments — non-overlapping absolute-positioned strips [0..100].
  const segs = [];
  if (sP != null) {
    if (sP > 0) segs.push({ from: 0, to: sP, color: "#fecaca" });      // below-stop danger
    segs.push({ from: sP, to: eP, color: "#fee2e2" });                 // stop→entry loss
  } else {
    segs.push({ from: 0, to: eP, color: "#fee2e2" });                  // no stop → below-entry is all loss
  }
  if (tP != null) {
    segs.push({ from: eP, to: tP, color: "#d1fae5" });                 // entry→target profit
    if (tP < 100) segs.push({ from: tP, to: 100, color: "#bbf7d0" });  // above-target bonus
  } else {
    segs.push({ from: eP, to: 100, color: "#d1fae5" });                // no target → profit open-ended
  }

  // Marker color reflects the CURRENT zone.
  let markerColor, markerLabel;
  if (sP != null && current <= stop) { markerColor = "#991b1b"; markerLabel = "🛑 stop breached"; }
  else if (current < entry)          { markerColor = "#b91c1c"; markerLabel = "loss"; }
  else if (tP != null && current >= target) { markerColor = "#065f46"; markerLabel = "🎯 at/above target"; }
  else                               { markerColor = "#059669"; markerLabel = "profit"; }

  const fmt = (v) => Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
  const stopLabel = Number.isFinite(stop) ? (stopSource === "auto" ? `stop ${fmt(stop)} (auto)` : `stop ${fmt(stop)}`) : null;
  const targetLabel = Number.isFinite(target) ? (targetSource === "auto" ? `target ${fmt(target)} (auto)` : `target ${fmt(target)}`) : null;

  // Sanity check — a bar where entry sits at or beyond the edge of the
  // scale gets rendered zero-width and looks broken. Skip when the
  // computed positions collapse.
  if (Math.abs(scaleMax - scaleMin) < 0.001) return null;

  return (
    <div style={{ padding: "6px 30px 10px 30px" }} title={`${markerLabel} · current ${fmt(current)} ${currency || ""}`}>
      {/* Bar. marginBottom accommodates staggered tick labels (up to
          two 12px rows) + a 14px rec-history dots strip when recs
          array is populated. Kept generous so the caller row below
          doesn't hug our labels. */}
      <div style={{ position: "relative", height: 12, marginBottom: recs.length > 0 ? 46 : 32 }}>
        {segs.map((s, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${s.from}%`,
            width: `${Math.max(0, s.to - s.from)}%`,
            top: 3, height: 6, background: s.color, borderRadius: 1,
          }} />
        ))}
        {/* Vertical tick markers */}
        {sP != null && (
          <div style={{ position: "absolute", left: `calc(${sP}% - 1px)`, top: 0, width: 2, height: 12, background: "#991b1b" }} />
        )}
        <div style={{ position: "absolute", left: `calc(${eP}% - 1px)`, top: 0, width: 2, height: 12, background: "#334155" }} />
        {tP != null && (
          <div style={{ position: "absolute", left: `calc(${tP}% - 1px)`, top: 0, width: 2, height: 12, background: "#065f46" }} />
        )}
        {/* Current-position marker (triangle above the bar with $ label) */}
        <div style={{
          position: "absolute", left: `calc(${cP}% - 6px)`, top: -8,
          width: 0, height: 0,
          borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
          borderTop: `10px solid ${markerColor}`,
        }} />
        <div style={{
          position: "absolute",
          left: `${cP}%`, transform: `translateX(${cP > 90 ? "-100%" : cP < 10 ? "0%" : "-50%"})`,
          top: -22, fontSize: 10, fontWeight: 700, color: markerColor,
          background: "var(--sa-panel-1, #fff)", padding: "0 4px", whiteSpace: "nowrap",
          border: `1px solid ${markerColor}`, borderRadius: 3,
        }}>
          now {fmt(current)}
        </div>
        {/* Tick labels under the bar. Stagger onto row 1 vs row 2 when
            two labels would horizontally overlap. Sort ticks by
            position; walk left→right, giving each new tick row 0 by
            default but bumping to row 1 if its position is within
            OVERLAP_PP percentage points of the previously-placed
            tick on the same row. Fixes BNS/NVDA case where
            stop/entry landed within 10% of each other and rendered
            as unreadable "et.pyh.$$110st|op $122.25" garbage. */}
        {(() => {
          const OVERLAP_PP = 18; // rough px estimate of label width in % of bar
          const ROW_H = 12;      // px between staggered rows
          const ticks = [];
          if (sP != null) ticks.push({ pos: sP, color: "#991b1b", text: stopLabel });
          ticks.push({ pos: eP, color: "#334155", text: `entry ${fmt(entry)}` });
          if (tP != null) ticks.push({ pos: tP, color: "#065f46", text: targetLabel });
          ticks.sort((a, b) => a.pos - b.pos);
          const rowsLastPos = [-999, -999]; // last-placed pos for row 0 and row 1
          for (const t of ticks) {
            const row = (t.pos - rowsLastPos[0]) < OVERLAP_PP ? 1 : 0;
            t.row = row;
            rowsLastPos[row] = t.pos;
          }
          return ticks.map((t, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${t.pos}%`,
                transform: `translateX(${t.pos > 90 ? "-100%" : t.pos < 10 ? "0%" : "-50%"})`,
                top: 14 + t.row * ROW_H,
                fontSize: 9.5,
                color: t.color,
                whiteSpace: "nowrap",
              }}
            >
              {t.text}
            </div>
          ));
        })()}
        {/* Rec-history dots — user Aug 13 "show BUY and SELL rec
            points". For each rec in the 30-day window on this base
            ticker, plot a small dot at its entryPrice on the same
            price scale as the main bar. Green = BUY, red = SELL /
            EXIT / TRIM. Tooltip on hover shows action + price + date.
            Positioned below the tick-labels strip so it never
            collides with them. Off-scale recs (entryPrice outside
            scaleMin..scaleMax) are clamped to the edges rather
            than dropped, since the "we've been calling entries in
            this zone" signal matters even when a specific rec is
            outside today's stop/target frame. */}
        {recs.length > 0 && (() => {
          const strip = [];
          for (const r of recs) {
            if (!Number.isFinite(r.entryPrice) || r.entryPrice <= 0) continue;
            const p = Math.max(0, Math.min(100, ((r.entryPrice - scaleMin) / (scaleMax - scaleMin)) * 100));
            const isBuy = r.action === "BUY";
            const isSell = r.action === "SELL" || r.action === "EXIT" || r.action === "TRIM";
            if (!isBuy && !isSell) continue;
            const dotColor = isBuy ? "#059669" : "#b91c1c";
            const when = r.generatedAt ? new Date(r.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
            const title = `${r.action} rec @ ${fmt(r.entryPrice)}${when ? ` · ${when}` : ""}`;
            strip.push({ p, dotColor, title });
          }
          if (strip.length === 0) return null;
          const stripTop = 14 + (2 * 12) + 4; // below label row 1 + small gap
          return (
            <>
              {strip.map((d, i) => (
                <div
                  key={`rec-${i}`}
                  title={d.title}
                  style={{
                    position: "absolute",
                    left: `${d.p}%`,
                    top: stripTop,
                    transform: "translateX(-50%)",
                    width: 6, height: 6, borderRadius: "50%",
                    background: d.dotColor,
                    border: "1px solid #fff",
                    boxSizing: "content-box",
                  }}
                />
              ))}
              {/* Muted legend on the right so the dots aren't
                  cryptic on first sight. Only render when there's
                  actually a rec — no dots, no legend. */}
              <div style={{
                position: "absolute",
                right: 0, top: stripTop + 8,
                fontSize: 9, color: "var(--sa-muted)",
                whiteSpace: "nowrap",
              }}>
                ● BUY  ● SELL  (past 30d, {strip.length})
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// =============================================================================
// News tab — per-ticker headlines + general market wire
// =============================================================================
function formatNewsTimestamp(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const ageMs = Date.now() - t;
  const min = Math.floor(ageMs / 60000);
  if (min < 60) return `${Math.max(0, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NewsItem({ item }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--sa-border)",
        marginBottom: 8,
        textDecoration: "none",
        color: "inherit",
        background: "var(--sa-card-bg, #fff)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {item.image ? (
          <img
            src={item.image}
            alt=""
            width={64}
            height={64}
            style={{ objectFit: "cover", borderRadius: 6, flexShrink: 0, background: "#f1f5f9" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35, marginBottom: 4 }}>
            {item.title}
          </div>
          {item.snippet ? (
            <div style={{ fontSize: 12, color: "var(--sa-muted)", lineHeight: 1.45, marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {item.snippet}
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: "var(--sa-muted)", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {item.publisher ? <span style={{ fontWeight: 500 }}>{item.publisher}</span> : null}
            {item.publisher && item.publishedAt ? <span>·</span> : null}
            {item.publishedAt ? <span>{formatNewsTimestamp(item.publishedAt)}</span> : null}
          </div>
        </div>
      </div>
    </a>
  );
}

function NewsView({ sessionToken, user }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [activeTicker, setActiveTicker] = useState("ALL"); // "ALL" | "GENERAL" | ticker
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-news`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setData(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load news");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, refreshTick]);

  const perTicker = data?.perTicker || {};
  const general = Array.isArray(data?.general) ? data.general : [];
  const heldTickers = (user?.positions || [])
    .filter((p) => (p.qty || 0) > 0)
    .map((p) => p.ticker)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .sort();

  // Merged/all view — flatten per-ticker items with symbol context, newest first
  const allTickerItems = [];
  for (const t of heldTickers) {
    for (const item of (perTicker[t] || [])) {
      allTickerItems.push({ ...item, _ticker: t });
    }
  }
  allTickerItems.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  let renderItems = [];
  let renderHeader = "";
  if (activeTicker === "ALL") {
    renderItems = allTickerItems;
    renderHeader = `${allTickerItems.length} items across ${heldTickers.length} held tickers`;
  } else if (activeTicker === "GENERAL") {
    renderItems = general;
    renderHeader = `${general.length} market-wide items`;
  } else {
    renderItems = perTicker[activeTicker] || [];
    renderHeader = `${renderItems.length} items for ${activeTicker}`;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>News</h2>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 4 }}>
            Per-ticker headlines for every held name, plus the general market wire.
            {data?.generatedAt ? <> · Fetched {new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</> : null}
          </div>
        </div>
        <button className="sa-btn secondary" onClick={() => setRefreshTick((n) => n + 1)} disabled={busy}>
          {busy ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {data && data.fmpEnabled === false ? (
        <div className="sa-card" style={{ marginBottom: 14, padding: 12, background: "#fef3c7", border: "1px solid #fbbf24" }}>
          FMP integration is disabled (no <code>FMP_API_KEY</code> or <code>FMP_DISABLED=1</code>). News feed requires FMP.
        </div>
      ) : null}

      {/* Ticker filter chips */}
      <div className="sa-card" style={{ padding: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[
            { key: "ALL", label: "All portfolio", count: allTickerItems.length },
            { key: "GENERAL", label: "Market", count: general.length },
            ...heldTickers.map((t) => ({ key: t, label: t, count: (perTicker[t] || []).length })),
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveTicker(key)}
              style={{
                border: "1px solid var(--sa-border)",
                background: activeTicker === key ? "var(--sa-primary, #2563eb)" : "transparent",
                color: activeTicker === key ? "#fff" : "inherit",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: activeTicker === key ? 600 : 500,
                cursor: "pointer",
              }}
              title={`${count} item${count === 1 ? "" : "s"}`}
            >
              {label}{count > 0 ? <span style={{ marginLeft: 6, opacity: 0.75 }}>{count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div className="sa-card" style={{ padding: 12, color: "var(--sa-red)" }}>
          Error loading news: {err}
        </div>
      ) : busy && !data ? (
        <div className="sa-empty">Loading news…</div>
      ) : renderItems.length === 0 ? (
        <div className="sa-empty">
          {activeTicker === "ALL" && heldTickers.length === 0
            ? "No held positions — add some in the Positions tab and news will populate."
            : "No items found for this filter."}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 8 }}>{renderHeader}</div>
          {renderItems.map((item, i) => (
            <div key={`${item.url || item.title}-${i}`}>
              {activeTicker === "ALL" && item._ticker ? (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--sa-muted)", marginBottom: 4, marginTop: i === 0 ? 0 : 4 }}>
                  {item._ticker}
                </div>
              ) : null}
              <NewsItem item={item} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Health tab — structural allocation + AI narrative review
// =============================================================================
const SLEEVE_COLORS = { core: "#2563eb", swing: "#7c3aed", income: "#059669", spec: "#dc2626" };

// Health-view scoped formatters — `fmtPct` and `fmtCad` are already
// defined at module scope with different signatures. Prefix with `hv`
// to keep those overloads distinct.
function hvFmtCad(n) {
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()} CAD`;
}
function hvFmtPct(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

// Very small inline markdown renderer — enough for headers, lists,
// paragraphs, and bold. Avoids pulling in a dependency for a single
// analysis section. Escapes HTML on the source.
function renderNarrative(md) {
  if (!md) return null;
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (line) => escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
  const lines = md.split(/\r?\n/);
  const html = [];
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { html.push("</ul>"); inUl = false; }
    if (inOl) { html.push("</ol>"); inOl = false; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeLists(); continue; }
    if (line.startsWith("### ")) { closeLists(); html.push(`<h4 style="margin:16px 0 6px;font-size:15px;font-weight:700">${inline(line.slice(4))}</h4>`); continue; }
    if (line.startsWith("## ")) { closeLists(); html.push(`<h3 style="margin:18px 0 8px;font-size:17px;font-weight:700">${inline(line.slice(3))}</h3>`); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inUl) { closeLists(); html.push('<ul style="margin:4px 0 4px 20px;padding:0">'); inUl = true; }
      html.push(`<li style="margin:4px 0;line-height:1.5">${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inOl) { closeLists(); html.push('<ol style="margin:4px 0 4px 22px;padding:0">'); inOl = true; }
      html.push(`<li style="margin:4px 0;line-height:1.5">${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }
    closeLists();
    html.push(`<p style="margin:6px 0;line-height:1.55">${inline(line)}</p>`);
  }
  closeLists();
  return <div dangerouslySetInnerHTML={{ __html: html.join("") }} />;
}

// ─────────────────────────────────────────────────────────────────────
// AlphaView — Phase 2 measurement dashboard.
// Reads GET /api/stocks-advice/alpha and renders the honest scorecard:
// rec-population return vs SPY/QQQ/XIC over rolling windows, plus per-
// source/setup/sleeve/regime buckets with confidence flags. This is the
// tab the user opens to answer "is the engine actually adding alpha?"
// ─────────────────────────────────────────────────────────────────────
function AlphaView({ sessionToken, user }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lookback, setLookback] = useState(90);

  const load = async () => {
    if (!sessionToken) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/alpha?lookback=${lookback}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setErr(e?.message || "Failed to load alpha"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionToken, lookback]);

  const refresh = async () => {
    if (!sessionToken || refreshing) return;
    setRefreshing(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/alpha/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ lookback }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j.alpha || null);
    } catch (e) { setErr(e?.message || "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  if (busy && !data) return <div className="sa-empty">Loading alpha rollup…</div>;
  if (err) return <div className="sa-card" style={{ padding: 12, color: "var(--sa-red)" }}>Error: {err}</div>;
  if (!data) return <div className="sa-empty">No data.</div>;

  const fmtPct = (v, digits = 2) => (v == null || !Number.isFinite(v)) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
  const fmtInt = (v) => (v == null || !Number.isFinite(v)) ? "—" : String(Math.round(v));
  const pctColor = (v) => (v == null || !Number.isFinite(v)) ? "var(--sa-muted)" : v > 0 ? "var(--sa-green)" : v < 0 ? "var(--sa-red)" : "var(--sa-muted)";
  const confidenceBadge = (c) => {
    const bg = c === "high" ? "#10b981" : c === "medium" ? "#f59e0b" : "#6b7280";
    return <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 4, background: bg, color: "white", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{c}</span>;
  };

  const qualityBanner = () => {
    if (data.sampleQuality === "sufficient") return null;
    const msg = data.sampleQuality === "warming-up"
      ? `Sample warming up (${data.totalRecs} recs, ${lookback}d lookback). Numbers get more reliable at 100+ recs — check back in a week or two.`
      : `Insufficient data (${data.totalRecs} recs, ${lookback}d lookback). Alpha bands are noise until the sample crosses 30 recs; anything below is trivia.`;
    return (
      <div style={{ padding: 10, marginBottom: 12, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, fontSize: 12, color: "#78350f" }}>
        ⚠ {msg}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Advice Engine Alpha</h2>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 4 }}>
            Rec population return vs SPY / QQQ / XIC. Measures the engine, not your execution.
            {data.totalRecs > 0 && (
              <> · {data.totalRecs} recs ({data.openCount} open, {data.closedCount} closed) · asof {new Date(data.asOf).toLocaleString()}</>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))}
            style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--sa-border)" }}>
            <option value={30}>30d lookback</option>
            <option value={90}>90d lookback</option>
            <option value={180}>180d lookback</option>
            <option value={365}>1y lookback</option>
          </select>
          <button className="sa-btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Mark to market"}
          </button>
        </div>
      </div>

      {qualityBanner()}

      {/* Alpha vs benchmarks table */}
      <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Rec-population alpha vs benchmarks</div>
        <div style={{ fontSize: 11, color: "var(--sa-muted)", marginBottom: 10 }}>
          Recommendation-matched alpha: for every rec, benchmark return is measured over that rec's own <em>generatedAt → exit/asOf</em> window,
          alpha = rec_return − matched_benchmark_return, then averaged across recs in the window.
          Positive = engine beat the ETF over the same holding period. Negative = you'd have done better in the ETF.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--sa-card-alt)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Window</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>n</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Engine mean</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>SPY</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>α vs SPY</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>QQQ</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>α vs QQQ</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>XIC</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>α vs XIC</th>
              </tr>
            </thead>
            <tbody>
              {(data.alphaWindows || []).map((w) => (
                <tr key={w.windowDays} style={{ borderTop: "1px solid var(--sa-border)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{w.windowDays}d</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{w.n}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: pctColor(w.meanRecReturn) }}>{fmtPct(w.meanRecReturn)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{fmtPct(w.benchmarks?.SPY)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: pctColor(w.alpha?.SPY) }}>{fmtPct(w.alpha?.SPY)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{fmtPct(w.benchmarks?.QQQ)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: pctColor(w.alpha?.QQQ) }}>{fmtPct(w.alpha?.QQQ)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{fmtPct(w.benchmarks?.["XIC.TO"])}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: pctColor(w.alpha?.["XIC.TO"]) }}>{fmtPct(w.alpha?.["XIC.TO"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bucket tables */}
      <BucketTable title="By source" rows={data.bySource} formatKey={(k) => k || "unknown"} fmtPct={fmtPct} pctColor={pctColor} fmtInt={fmtInt} confidenceBadge={confidenceBadge} />
      <BucketTable title="By action" rows={data.byAction} formatKey={(k) => k} fmtPct={fmtPct} pctColor={pctColor} fmtInt={fmtInt} confidenceBadge={confidenceBadge} />
      <BucketTable title="By sleeve" rows={data.bySleeve} formatKey={(k) => k} fmtPct={fmtPct} pctColor={pctColor} fmtInt={fmtInt} confidenceBadge={confidenceBadge} />
      <BucketTable title="By setup" rows={data.bySetup} formatKey={(k) => k} fmtPct={fmtPct} pctColor={pctColor} fmtInt={fmtInt} confidenceBadge={confidenceBadge} />
      <BucketTable title="By regime" rows={data.byRegime} formatKey={(k) => k} fmtPct={fmtPct} pctColor={pctColor} fmtInt={fmtInt} confidenceBadge={confidenceBadge} />

      {/* Recent closed recs — the "what actually happened" table */}
      {data.recentRecs?.length > 0 && (
        <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent recs ({data.recentRecs.length})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--sa-card-alt)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Ticker</th>
                  <th style={{ padding: "6px 8px" }}>Action</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Source</th>
                  <th style={{ padding: "6px 8px" }}>Setup</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Entry</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Current/Exit</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>P/L</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Days</th>
                  <th style={{ padding: "6px 8px" }}>Opened</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRecs.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--sa-border)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.ticker}</td>
                    <td style={{ padding: "6px 8px" }}>{r.action}</td>
                    <td style={{ padding: "6px 8px", color: r.status === "target-hit" ? "var(--sa-green)" : r.status === "stop-hit" ? "var(--sa-red)" : "var(--sa-muted)" }}>{r.status}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--sa-muted)" }}>{r.source || "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11 }}>{r.setup}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>${r.entryPrice?.toFixed(2) ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>${r.exitPrice?.toFixed(2) ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: pctColor(r.returnPct) }}>{fmtPct(r.returnPct)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(r.holdingDays)}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: "var(--sa-muted)" }}>{r.generatedAt ? new Date(r.generatedAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable bucket table for AlphaView. Renders one grouping (by-source,
// by-setup, by-sleeve, by-regime) with n, hit rate, mean return, 95% CI,
// and a confidence badge derived from sample size.
function BucketTable({ title, rows, formatKey, fmtPct, pctColor, fmtInt, confidenceBadge }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--sa-card-alt)", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Key</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>n</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Open / Closed</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Hit rate</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Mean return</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Median</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>95% CI</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Avg days held</th>
              <th style={{ padding: "6px 8px" }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--sa-border)" }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{formatKey(r.key)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.n}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--sa-muted)", fontSize: 11 }}>{r.openCount} / {r.closedCount}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.hitRate == null ? "—" : `${(r.hitRate * 100).toFixed(0)}%`}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: pctColor(r.meanReturn) }}>{fmtPct(r.meanReturn)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: pctColor(r.medianReturn) }}>{fmtPct(r.medianReturn)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "var(--sa-muted)" }}>
                  {r.ci95 ? `[${fmtPct(r.ci95[0])}, ${fmtPct(r.ci95[1])}]` : "—"}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(r.avgHoldingDays)}</td>
                <td style={{ padding: "6px 8px" }}>{confidenceBadge(r.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HealthView({ sessionToken, user }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeErr, setAnalyzeErr] = useState(null);

  const load = async () => {
    if (!sessionToken) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-health`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e) {
      setErr(e?.message || "Failed to load health snapshot");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionToken]);

  const runAnalysis = async () => {
    if (!sessionToken || analyzing) return;
    setAnalyzing(true); setAnalyzeErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-health/analysis`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData((prev) => ({ ...(prev || {}), snapshot: j.snapshot, lastAnalysis: j.analysis }));
    } catch (e) {
      setAnalyzeErr(e?.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  if (busy && !data) return <div className="sa-empty">Loading portfolio health…</div>;
  if (err) return <div className="sa-card" style={{ padding: 12, color: "var(--sa-red)" }}>Error: {err}</div>;
  if (!data) return <div className="sa-empty">No data.</div>;

  const s = data.snapshot;
  const analysis = data.lastAnalysis;
  const analysisStale = analysis?.generatedAt ? (Date.now() - new Date(analysis.generatedAt).getTime()) > 24 * 60 * 60 * 1000 : true;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Portfolio Health</h2>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 4 }}>
            Structural review: allocations, overlaps, concentrations, sector exposure.
            Book: <strong>{hvFmtCad(s.bookTotalCad)}</strong> · {s.positionCount} positions across {s.accountCount} accounts.
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "var(--sa-muted)" }}>Deterministic health</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: s.healthScore >= 8 ? "var(--sa-green)" : s.healthScore >= 6 ? "#d97706" : "var(--sa-red)", lineHeight: 1 }}>
            {s.healthScore.toFixed(1)}<span style={{ fontSize: 16, color: "var(--sa-muted)", fontWeight: 400 }}>/10</span>
          </div>
        </div>
      </div>

      {/* Sleeve balance */}
      <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Sleeve balance</div>
        <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", marginBottom: 8, border: "1px solid var(--sa-border)" }}>
          {["core", "swing", "income", "spec"].map((k) => {
            const pct = s.sleeves?.actualPct?.[k] || 0;
            if (pct < 0.5) return null;
            return (
              <div key={k} title={`${k.toUpperCase()}: ${hvFmtPct(pct)}`}
                   style={{ background: SLEEVE_COLORS[k], width: `${pct}%`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                {pct >= 8 ? `${k.toUpperCase()} ${pct.toFixed(0)}%` : ""}
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, fontSize: 12 }}>
          {["core", "swing", "income", "spec"].map((k) => {
            const actual = s.sleeves?.actualPct?.[k];
            const target = s.sleeves?.targetsPct?.[k];
            const dev = s.sleeves?.deviations?.[k];
            const devSign = dev > 0 ? "+" : "";
            const devColor = Math.abs(dev || 0) < 3 ? "var(--sa-muted)" : dev < 0 ? "var(--sa-red)" : "#d97706";
            return (
              <div key={k} style={{ padding: 8, border: "1px solid var(--sa-border)", borderRadius: 6 }}>
                <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: 11, color: SLEEVE_COLORS[k] }}>{k}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{hvFmtPct(actual)}</div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)" }}>target {hvFmtPct(target, 0)}</div>
                <div style={{ fontSize: 11, color: devColor, fontWeight: 600 }}>{devSign}{dev?.toFixed(1)}pp</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI narrative */}
      <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>AI Health Review</div>
            <div style={{ fontSize: 11, color: "var(--sa-muted)" }}>
              {analysis?.generatedAt
                ? <>Last analyzed {new Date(analysis.generatedAt).toLocaleString()} {analysis.aiScore != null ? `· AI score ${analysis.aiScore}/10` : ""} {analysisStale ? "· ⚠ stale (>24h)" : ""}</>
                : "No analysis yet — generate one when you're ready."}
            </div>
          </div>
          <button className="sa-btn" onClick={runAnalysis} disabled={analyzing || s.positionCount === 0}>
            {analyzing ? "Analyzing…" : analysis ? "↻ Regenerate" : "Analyze"}
          </button>
        </div>
        {analyzeErr ? <div style={{ color: "var(--sa-red)", fontSize: 12, marginTop: 6 }}>Error: {analyzeErr}</div> : null}
        {analysis?.aiNarrative ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--sa-text)" }}>
            {renderNarrative(analysis.aiNarrative)}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 10 }}>
            Click <strong>Analyze</strong> to generate a written review of your portfolio's structure — overlaps, hidden problems, concentration flags, and 3-5 ranked next moves.
          </div>
        )}
      </div>

      {/* Concentrations */}
      {s.concentrations.length > 0 && (
        <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Concentration flags</div>
          {s.concentrations.map((c) => (
            <div key={c.base} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--sa-border)" }}>
              <div>
                <strong>{c.base}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", borderRadius: 4, background: c.severity === "breach" ? "#fee2e2" : "#fef3c7", color: c.severity === "breach" ? "#991b1b" : "#92400e", fontWeight: 600 }}>
                  {c.severity === "breach" ? "BREACH" : "WARN"}
                </span>
                <div style={{ fontSize: 11, color: "var(--sa-muted)" }}>
                  {c.tickers.length > 1 ? `across ${c.tickers.join(", ")} · ` : ""}sleeve: {c.sleeves.join("/")}
                </div>
              </div>
              <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontWeight: 700 }}>{hvFmtPct(c.pctOfBook)}</div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)" }}>{hvFmtCad(c.cadValue)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Overlaps */}
      {s.overlaps.length > 0 && (
        <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Overlap flags</div>
          {s.overlaps.map((o, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--sa-border)" }}>
              {o.kind === "etf-family" ? (
                <>
                  <div style={{ fontWeight: 600 }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 2 }}>Held: <strong>{o.held.join(" + ")}</strong> · combined {hvFmtPct(o.totalPctOfBook)} of book</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{o.note}</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>{o.ticker} owned directly AND via {o.heldInEtfs.join(" / ")}</div>
                  <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 2 }}>Direct: {hvFmtPct(o.singleNamePctOfBook)} of book · Implied via ETF: ~{hvFmtPct(o.impliedEtfExposurePctOfBook)}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{o.note}</div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Allocations table */}
      <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>All positions</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--sa-muted)", borderBottom: "1px solid var(--sa-border)" }}>
                <th style={{ padding: "6px 8px" }}>Ticker</th>
                <th style={{ padding: "6px 8px" }}>Sleeve</th>
                <th style={{ padding: "6px 8px" }}>Account</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Value (CAD)</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>% book</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>P/L</th>
              </tr>
            </thead>
            <tbody>
              {s.allocations.map((a) => (
                <tr key={`${a.ticker}-${a.account}`} style={{ borderBottom: "1px solid var(--sa-border)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{a.ticker} <span style={{ fontSize: 10, color: "var(--sa-muted)" }}>{a.currency}</span></td>
                  <td style={{ padding: "6px 8px", textTransform: "uppercase", fontSize: 11, color: SLEEVE_COLORS[a.sleeve] || "var(--sa-muted)", fontWeight: 600 }}>{a.sleeve}</td>
                  <td style={{ padding: "6px 8px", color: "var(--sa-muted)" }}>{a.account}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{hvFmtCad(a.cadValue)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{hvFmtPct(a.pctOfBook)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: a.pnlPct == null ? "var(--sa-muted)" : a.pnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
                    {a.pnlPct == null ? "—" : `${a.pnlPct >= 0 ? "+" : ""}${a.pnlPct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tax placement — US-dividend / US-ETF holdings vs account type */}
      {s.taxPlacement?.flagged?.length > 0 && (
        <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Tax placement</div>
            {s.taxPlacement.totalAnnualDragCad > 0 && (
              <div style={{ fontSize: 12, color: "#7f1d1d", fontVariantNumeric: "tabular-nums" }}>
                ~<b>{hvFmtCad(s.taxPlacement.totalAnnualDragCad)}/yr</b> unrecoverable drag
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--sa-muted)", marginBottom: 8 }}>
            Canada-US tax treaty exempts US dividends in RRSP/RRIF from 15% US withholding. Same holdings in TFSA/FHSA pay the withholding permanently (unrecoverable); in taxable accounts it&#39;s recoverable via T1 Foreign Tax Credit.
          </div>
          {s.taxPlacement.flagged.map((f, i) => (
            <div key={`${f.ticker}-${f.accountId}-${i}`} style={{ padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--sa-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div>
                  <strong>{f.ticker}</strong>
                  <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 600,
                    background: f.severity === "warn" ? "#fee2e2" : "#e0e7ff",
                    color: f.severity === "warn" ? "#991b1b" : "#3730a3",
                  }}>{f.severity === "warn" ? "MISPLACED" : "INFO"}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sa-muted)" }}>
                    in {f.account} ({f.accountType || "unset type"})
                  </span>
                </div>
                <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                  {f.annualDragCad > 0 && (
                    <span style={{ color: f.severity === "warn" ? "#7f1d1d" : "var(--sa-muted)", fontWeight: 600 }}>
                      ~{hvFmtCad(f.annualDragCad)}/yr
                    </span>
                  )}
                  <span style={{ marginLeft: 8, color: "var(--sa-muted)" }}>{hvFmtCad(f.valueCad)}</span>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sa-muted)", marginTop: 4, lineHeight: 1.45 }}>{f.note}</div>
            </div>
          ))}
          {s.taxPlacement.coverage?.unclassifiedAccounts > 0 && (
            <div style={{ marginTop: 10, padding: 8, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 4, fontSize: 11, color: "#78350f" }}>
              ⚠ {s.taxPlacement.coverage.unclassifiedAccounts} account{s.taxPlacement.coverage.unclassifiedAccounts === 1 ? "" : "s"} without a type set — tax-placement flags may be incomplete. Set each account&#39;s type in Positions view or Settings.
            </div>
          )}
        </div>
      )}

      {/* Sector exposure */}
      <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Sector exposure</div>
        {s.sectorExposure.map((se) => (
          <div key={se.sector} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{se.sector}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{hvFmtPct(se.pctOfBook)} <span style={{ color: "var(--sa-muted)", fontSize: 11 }}>({hvFmtCad(se.cadValue)})</span></span>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 6 }}>
          Broad ETFs (VOO/XIU/XEQT/etc.) group into "Multi-sector" — assigning them to a single sector would misrepresent the underlying exposure.
        </div>
      </div>

      {/* Deductions */}
      {s.deductions.length > 0 && (
        <div className="sa-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>How the {s.healthScore.toFixed(1)}/10 broke down</div>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 6 }}>Start at 10; deductions are rule-based and transparent.</div>
          {s.deductions.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
              <span>{d.reason}</span>
              <span style={{ color: "var(--sa-red)", fontVariantNumeric: "tabular-nums" }}>{d.points.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Per-ticker performance chart — multi-line, range-switchable
// =============================================================================
const TICKER_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2",
  "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7",
];

function TickerPerformanceCard({ tickers, holdings = [], fx = 1.37, sessionToken = null, refreshTick = 0 }) {
  const [range, setRange] = useState("1d");
  const [mode, setMode] = useState("pct"); // "pct" = % change | "price" = native $ price
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({}); // { ticker: { points, currency } }
  const [failed, setFailed] = useState([]);
  const [err, setErr] = useState(null);
  // Map of ticker → { action, targetPrice, stopPrice, status, hitAt, hitPrice }
  // for any open BUY/SELL/TRIM rec issued in the past 48 hours. Used to
  // (a) highlight legend entries green when target was hit during the day,
  // (b) draw horizontal target/stop bands on the price-mode chart.
  const [recsByTicker, setRecsByTicker] = useState({});

  useEffect(() => {
    if (!sessionToken || !tickers || tickers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `${BACKEND_URL}/api/stocks-advice/recs-for-tickers?tickers=${encodeURIComponent(tickers.join(","))}&hours=48`;
        const r = await fetch(url, { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const map = {};
        for (const rec of j.recs || []) map[rec.ticker] = rec;
        setRecsByTicker(map);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, tickers.join(",")]);

  useEffect(() => {
    if (!tickers || tickers.length === 0) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        // nocache when the user just clicked Refresh Prices — bypasses
        // the 60s server-side HISTORY_CACHE so fresh bars land in the
        // chart immediately instead of after the TTL expires. Bumped
        // refreshTick is the signal.
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers, range, nocache: refreshTick > 0 }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setData(j.data || {});
        setFailed(j.failed || []);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load history");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tickers.join(","), range, refreshTick]);

  const labels = tickers.filter(t => data[t]?.points?.length > 0);
  const colorFor = (i) => TICKER_COLORS[i % TICKER_COLORS.length];

  // Portfolio-level performance over the selected range (top-10 holdings only)
  // For each ticker with both holdings + historical data, compute
  // qty × (lastPrice - firstPrice), converting to CAD via fx for USD names.
  let totalStartCad = 0, totalEndCad = 0;
  let coveredTickers = 0;
  for (const t of labels) {
    const h = holdings.find(x => x.ticker === t);
    if (!h || !h.qty) continue;
    const pts = data[t].points;
    if (!pts || pts.length < 2) continue;
    const fxMult = (data[t].currency === "USD") ? fx : 1;
    totalStartCad += h.qty * pts[0].price * fxMult;
    totalEndCad   += h.qty * pts[pts.length - 1].price * fxMult;
    coveredTickers++;
  }
  const totalDeltaCad = totalEndCad - totalStartCad;
  const totalPct = totalStartCad > 0 ? (totalDeltaCad / totalStartCad) * 100 : null;
  const showTotal = totalPct != null && Number.isFinite(totalPct) && coveredTickers > 0;
  const totalColor = totalPct == null ? "var(--sa-muted)" : (totalPct >= 0 ? "var(--sa-green)" : "var(--sa-red)");
  const rangeLabel = { "1h": "past hour", "4h": "past 4 hours", "1d": "today", "3d": "3 days", "7d": "7 days", "30d": "30 days", "1y": "1 year", "2y": "2 years" }[range];

  return (
    <div className="sa-card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>Per-ticker performance</h3>
          {showTotal && (() => {
            const totalDeltaUsd = totalDeltaCad / fx;
            const sign = totalDeltaCad >= 0 ? "+" : "−";
            return (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: totalColor, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>
                  {totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%
                </span>
                <span style={{ fontSize: 14, fontWeight: 500, color: totalColor, fontVariantNumeric: "tabular-nums" }}>
                  {sign}${Math.abs(totalDeltaUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                </span>
                <span style={{ fontSize: 14, color: "var(--sa-muted)" }}>·</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: totalColor, fontVariantNumeric: "tabular-nums" }}>
                  {sign}${Math.abs(totalDeltaCad).toLocaleString(undefined, { maximumFractionDigits: 0 })} CAD
                </span>
                <span style={{ fontSize: 12, color: "var(--sa-muted)" }}>over {rangeLabel}</span>
              </div>
            );
          })()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
            {[
              ["1h", "1H"], ["4h", "4H"], ["1d", "1D"], ["3d", "3D"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"], ["2y", "2Y"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRange(v)}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600,
                  border: "none", borderRadius: 6, cursor: "pointer",
                  background: range === v ? "var(--sa-accent)" : "transparent",
                  color: range === v ? "#fff" : "var(--sa-text-2)",
                }}
              >{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
            {[
              ["pct", "% change"], ["price", "$ price"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                style={{
                  padding: "5px 12px", fontSize: 11, fontWeight: 600,
                  border: "none", borderRadius: 6, cursor: "pointer",
                  background: mode === v ? "var(--sa-accent-2)" : "transparent",
                  color: mode === v ? "#fff" : "var(--sa-text-2)",
                }}
                title={v === "pct" ? "Show % change relative to start of period (each line normalized)" : "Show actual price in native currency (each line on its own scale)"}
              >{label}</button>
            ))}
          </div>
        </div>
      </div>
      {err && <div className="sa-err">{err}</div>}
      {busy && !labels.length && <div className="sa-muted" style={{ padding: 20, textAlign: "center" }}>Loading prices…</div>}
      {!busy && !labels.length && !err && (
        <div className="sa-muted" style={{ padding: 20, textAlign: "center" }}>
          {failed.length > 0
            ? <>No data returned. Price feed failed for: <code>{failed.join(", ")}</code>. Try a different range or check the backend log for the specific fetch errors.</>
            : tickers.length === 0
              ? <>No tickers to chart. Add positions first, then reload.</>
              : <>No data returned. Backend accepted the request but returned zero series — likely a Yahoo Finance blip; retry in a minute.</>}
        </div>
      )}
      {labels.length > 0 && (
        <>
          <MultiLineChart series={labels.map((t, i) => ({ ticker: t, points: data[t].points, color: colorFor(tickers.indexOf(t)), currency: data[t].currency }))} range={range} mode={mode} />
          {/* Legend — shows final % AND current price for each ticker.
              When a recent rec's target was hit during the day, the entry
              gets a green 🎯 badge + green background. Stop hits get a 🛑
              + amber background. Hit detection runs twice:
                (a) server-side via rec.status (monitorOpenRecs caught it)
                (b) client-side via chart's intraday max/min vs target/stop
              Either is sufficient — protects against the monitor not
              running mid-day. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14, fontSize: 12 }}>
            {labels.map((t) => {
              const pts = data[t].points;
              const last = pts[pts.length - 1];
              const finalPct = last.pct;
              const lastPrice = last.price;
              const ccy = data[t].currency || "USD";
              const color = colorFor(tickers.indexOf(t));
              const rec = recsByTicker[t];
              // Compute target/stop hit. Direction-aware:
              //   BUY: target hit if any point.price >= targetPrice
              //   SELL/TRIM: target hit if any point.price <= targetPrice
              // Hit detection — "is the price on the wrong side of my
              // exit level RIGHT NOW?", not "did it ever touch the level
              // at any point in the visible chart window". The old
              // whole-window max/min gave false positives on stops
              // brushed by an intraday wick and never revisited (e.g.
              // a fresh BUY rec today would flag stopHit because the
              // chart's 7d range included last Tuesday's flush that
              // touched the stop level well BEFORE the rec was even
              // generated). Now: server-side rec.status is the
              // authoritative signal (persistently set by the monitor
              // when a genuine hit happened), and the client-side
              // check uses CURRENT price only.
              let targetHit = false;
              let stopHit = false;
              if (rec) {
                if (rec.status === "target-hit") targetHit = true;
                if (rec.status === "stop-hit") stopHit = true;
                if (!targetHit && !stopHit && Number.isFinite(lastPrice)) {
                  if (rec.action === "BUY") {
                    if (rec.targetPrice != null && lastPrice >= rec.targetPrice) targetHit = true;
                    if (rec.stopPrice != null && lastPrice <= rec.stopPrice) stopHit = true;
                  } else if (rec.action === "SELL" || rec.action === "TRIM") {
                    if (rec.targetPrice != null && lastPrice <= rec.targetPrice) targetHit = true;
                    if (rec.stopPrice != null && lastPrice >= rec.stopPrice) stopHit = true;
                  }
                }
              }
              // Three tiers when a rec is open:
              //   • target-hit → deep green + 🎯 (best)
              //   • stop-hit   → deep red   + 🛑 (worst)
              //   • on-track   → light green (rec exists, price is
              //                   between stop and target; the plan
              //                   is still working)
              // No open rec → transparent (nothing to track against).
              const onTrack = !!rec && !targetHit && !stopHit;
              const highlightBg = targetHit
                ? "var(--sa-green-soft)"
                : stopHit
                ? "#fee2e2"
                : onTrack
                ? "#f0fdf4"
                : "transparent";
              const highlightBorder = targetHit
                ? "1px solid #bbf7d0"
                : stopHit
                ? "1px solid #fecaca"
                : onTrack
                ? "1px solid #dcfce7"
                : "1px solid transparent";
              return (
                <div
                  key={t}
                  title={
                    targetHit
                      ? `🎯 Target hit — ${rec.action} rec from ${new Date(rec.generatedAt).toLocaleDateString()} target $${rec.targetPrice}`
                      : stopHit
                      ? `🛑 Stop hit — ${rec.action} rec from ${new Date(rec.generatedAt).toLocaleDateString()} stop $${rec.stopPrice}`
                      : onTrack
                      ? `✓ On plan — ${rec.action} rec from ${new Date(rec.generatedAt).toLocaleDateString()}, target $${rec.targetPrice ?? "—"}, stop $${rec.stopPrice ?? "—"}. Price is inside the working range.`
                      : undefined
                  }
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 8px", borderRadius: 6,
                    background: highlightBg, border: highlightBorder,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
                  <span style={{ fontWeight: 600 }}>{t}</span>
                  {targetHit && <span style={{ fontSize: 11 }}>🎯</span>}
                  {stopHit && <span style={{ fontSize: 11 }}>🛑</span>}
                  <span className="sa-amount" style={{ color: "var(--sa-text)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    ${lastPrice?.toFixed(2)} {ccy}
                  </span>
                  <span style={{ color: finalPct >= 0 ? "var(--sa-green)" : "var(--sa-red)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                    {finalPct >= 0 ? "+" : ""}{finalPct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
          {failed.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--sa-muted)" }}>
              Could not fetch: {failed.join(", ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MultiLineChart({ series, range, mode = "pct" }) {
  // PADR widened to make room for right-edge ticker labels (5-7 chars,
  // ~9px font ⇒ ~50-60px band).
  const W = 720, H = 280, PADL = 56, PADR = 66, PADT = 14, PADB = 30;

  // In % mode all lines share one normalized Y axis (% change from start).
  // In price mode each line has its own scale (TSLA at $400 and RUM at $5
  // would otherwise be invisible on the same axis) — we normalize each
  // line independently into the 0-1 Y range and label the axis with %
  // change as the shared reference, plus per-line price labels at the
  // right edge of the chart.
  const valueKey = mode === "price" ? "price" : "pct";

  // Time bounds — always pooled across all series
  let minT = Infinity, maxT = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
    }
  }
  const tRange = (maxT - minT) || 1;
  const xOf = (t) => PADL + ((t - minT) / tRange) * (W - PADL - PADR);

  // Per-series y normalization. For pct mode we use a global min/max so
  // the gridlines mean something. For price mode each series is on its
  // own 0-1 axis (with a 8% padding) since prices can't be combined.
  let globalMin = Infinity, globalMax = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      const v = p[valueKey];
      if (v < globalMin) globalMin = v;
      if (v > globalMax) globalMax = v;
    }
  }
  if (!isFinite(globalMin)) { globalMin = -1; globalMax = 1; }

  const seriesScale = (s) => {
    if (mode === "pct") {
      // Shared axis: ensure 0 is visible, add 8% padding
      let lo = globalMin, hi = globalMax;
      const pad = (hi - lo) * 0.08 || 1;
      lo -= pad; hi += pad;
      if (lo > 0) lo = -0.5;
      if (hi < 0) hi = 0.5;
      return { lo, hi };
    }
    // Per-line scale in price mode
    let lo = Infinity, hi = -Infinity;
    for (const p of s.points) { if (p.price < lo) lo = p.price; if (p.price > hi) hi = p.price; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || (hi * 0.05) || 1;
    return { lo: lo - pad, hi: hi + pad };
  };

  // Shared range (for axis gridlines + zero line) — only meaningful in pct mode
  const sharedScale = seriesScale({ points: series.flatMap((s) => s.points) });
  const yOfShared = (v) => PADT + (1 - (v - sharedScale.lo) / (sharedScale.hi - sharedScale.lo)) * (H - PADT - PADB);
  const yOfSeries = (s, v) => {
    const { lo, hi } = seriesScale(s);
    return PADT + (1 - (v - lo) / (hi - lo || 1)) * (H - PADT - PADB);
  };

  // X-axis tick labels — based on range
  const fmtTick = (t) => {
    const d = new Date(t * 1000);
    if (range === "1h" || range === "4h" || range === "1d") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (range === "1y" || range === "2y") return d.toLocaleDateString([], { month: "short", year: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const tickTs = [minT, minT + tRange * 0.33, minT + tRange * 0.66, maxT];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* Y gridlines (always labeled in % for cross-series comparability) */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = PADT + t * (H - PADT - PADB);
        const pct = sharedScale.hi - t * (sharedScale.hi - sharedScale.lo);
        return (
          <g key={t}>
            <line x1={PADL} x2={W - PADR} y1={y} y2={y} stroke="#e4e8ef" strokeWidth="1" />
            {mode === "pct" && (
              <text x={PADL - 8} y={y + 4} fontSize="10" fill="#7a8499" textAnchor="end">
                {pct >= 0 ? "+" : ""}{pct.toFixed((sharedScale.hi - sharedScale.lo) < 4 ? 2 : 1)}%
              </text>
            )}
          </g>
        );
      })}
      {mode === "pct" && (
        <line x1={PADL} x2={W - PADR} y1={yOfShared(0)} y2={yOfShared(0)} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="3,3" />
      )}
      {mode === "price" && (
        <text x={PADL - 8} y={PADT + 6} fontSize="9" fill="#7a8499" textAnchor="end">price ($)</text>
      )}

      {/* Lines */}
      {series.map((s) => {
        if (s.points.length < 2) return null;
        const yFn = mode === "pct" ? (v) => yOfShared(v) : (v) => yOfSeries(s, v);
        const d = s.points.map((p, i) => (i === 0 ? "M" : "L") + xOf(p.t).toFixed(1) + "," + yFn(p[valueKey]).toFixed(1)).join(" ");
        const last = s.points[s.points.length - 1];
        const lastY = yFn(last[valueKey]);
        return (
          <g key={s.ticker}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={xOf(last.t)} cy={lastY} r="3" fill={s.color} />
          </g>
        );
      })}

      {/* Right-edge ticker labels — compute native end-Y per series,
          then greedily spread overlapping labels vertically so each is
          readable next to its color. In price mode append the last
          price; in pct mode we already show the value in the axis grid
          plus the color-coded legend rows below the chart. */}
      {(() => {
        const labelH = 11;
        const items = series
          .filter((s) => s.points.length >= 2)
          .map((s) => {
            const yFn = mode === "pct" ? (v) => yOfShared(v) : (v) => yOfSeries(s, v);
            const last = s.points[s.points.length - 1];
            return {
              ticker: s.ticker,
              color: s.color,
              nativeY: yFn(last[valueKey]),
              endX: xOf(last.t),
              last,
            };
          })
          .sort((a, b) => a.nativeY - b.nativeY);
        // Greedy vertical spread: for each item, push its label down if
        // it would collide with the previous label's bottom.
        let cursor = PADT;
        for (const it of items) {
          it.labelY = Math.max(it.nativeY, cursor + labelH * 0.7);
          cursor = it.labelY;
        }
        // Clamp any labels that spilled past the plot bottom by
        // squeezing the tail up.
        const maxY = H - PADB;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].labelY > maxY) items[i].labelY = maxY;
          if (i > 0 && items[i].labelY - items[i - 1].labelY < labelH) {
            items[i - 1].labelY = items[i].labelY - labelH;
          }
        }
        return items.map((it) => (
          <g key={"lbl-" + it.ticker}>
            {/* Leader line when the label had to be moved off the true endpoint */}
            {Math.abs(it.labelY - it.nativeY) > 2 && (
              <line
                x1={it.endX + 3} y1={it.nativeY}
                x2={W - PADR + 2} y2={it.labelY}
                stroke={it.color} strokeWidth="0.6" strokeDasharray="2,2" opacity="0.6"
              />
            )}
            <text x={W - PADR + 4} y={it.labelY + 3} fontSize="9" fill={it.color} fontWeight="600">
              {it.ticker}{mode === "price" ? ` $${it.last.price.toFixed(it.last.price > 100 ? 0 : 2)}` : ""}
            </text>
          </g>
        ));
      })()}

      {/* X-axis ticks */}
      {tickTs.map((t, i) => (
        <text key={i} x={xOf(t)} y={H - 8} fontSize="10" fill="#7a8499" textAnchor={i === 0 ? "start" : i === tickTs.length - 1 ? "end" : "middle"}>
          {fmtTick(t)}
        </text>
      ))}
    </svg>
  );
}

// =============================================================================
// Trades view — the transaction journal. Every BUY / SELL / DEPOSIT /
// WITHDRAW you've recorded, most recent first, with the trade legs spelled
// out and net cash impact in CAD.
// =============================================================================
function TradesView({ sessionToken }) {
  const [trades, setTrades] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(90);
  const [deletingId, setDeletingId] = useState(null);
  // Pending-review index keyed by trade id — populated from the same
  // /email-integration/pending-review endpoint that Settings uses.
  // Lets us show a ⚠ Verify affordance right on the Trades row instead
  // of making the trader scroll down to Settings to resolve one.
  const [pendingReviewById, setPendingReviewById] = useState({});
  const [allAccounts, setAllAccounts] = useState([]);
  const [verifyExpanded, setVerifyExpanded] = useState(null);
  const [verifyBanner, setVerifyBanner] = useState(null);
  const loadPendingReview = async () => {
    if (!sessionToken) return;
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/pending-review`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) return;
      const j = await r.json();
      const idx = {};
      for (const row of j.rows || []) idx[row._id] = row;
      setPendingReviewById(idx);
      setAllAccounts(Array.isArray(j.allAccounts) ? j.allAccounts : []);
    } catch { /* silent */ }
  };
  useEffect(() => { loadPendingReview(); }, [sessionToken]);
  const resolveOne = async (tradeId, accountId) => {
    setVerifyBanner(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/resolve-trade`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, accountId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setVerifyBanner({ kind: "ok", msg: `Applied to ${j.account}. Positions + cash updated.` });
      setVerifyExpanded(null);
      await loadPendingReview();
      await load();
    } catch (e) {
      setVerifyBanner({ kind: "err", msg: `Verify failed: ${e?.message || "unknown"}` });
    }
  };

  const load = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-trade?days=${days}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setTrades(j.trades || []);
    } catch (e) { setErr(e?.message || "Failed to load"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-trade?days=${days}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setTrades(j.trades || []);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days]);

  const editTradeShares = async (t) => {
    // For each BUY/SELL leg, prompt for the new share count. Enter blank
    // to keep the leg unchanged. DEPOSIT/WITHDRAW legs are skipped (edit
    // those via delete + re-add for now).
    if (deletingId) return;
    const patch = [];
    let anyChange = false;
    for (const leg of t.legs) {
      if (leg.side === "DEPOSIT" || leg.side === "WITHDRAW") {
        patch.push({});
        continue;
      }
      const label = `${leg.side} ${leg.shares} ${leg.ticker} @ $${Number(leg.pricePerShare).toFixed(2)} ${leg.currency}`;
      const input = window.prompt(
        `Correct share count for:\n${label}\n\nEnter new share count, or leave blank to keep as-is.\nCurrent: ${leg.shares}`,
        String(leg.shares)
      );
      if (input == null) return; // cancel entire edit
      const trimmed = input.trim();
      if (trimmed === "" || trimmed === String(leg.shares)) {
        patch.push({});
        continue;
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
        alert(`Invalid share count: ${trimmed}`);
        return;
      }
      patch.push({ shares: n });
      anyChange = true;
    }
    if (!anyChange) return;
    // Preview and confirm
    const previewLines = t.legs.map((leg, i) => {
      const p = patch[i];
      if (!p?.shares) return null;
      return `${leg.side} ${leg.ticker}: ${leg.shares} → ${p.shares}`;
    }).filter(Boolean).join("\n");
    if (!window.confirm(`Apply these changes?\n\n${previewLines}\n\nPositions and cash will be recomputed to reflect the corrected legs.`)) return;
    setDeletingId(t._id);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-trade/${t._id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ legs: patch }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
    } catch (e) { alert(`Edit failed: ${e?.message || "network"}`); }
    finally { setDeletingId(null); }
  };

  const deleteTrade = async (t) => {
    if (deletingId) return;
    const legsDesc = (t.legs || []).map((l) =>
      (l.side === "DEPOSIT" || l.side === "WITHDRAW")
        ? `${l.side} $${Math.round(Number(l.grossValue) || 0).toLocaleString()} ${l.currency}`
        : `${l.side} ${l.shares} ${l.ticker} @ $${Number(l.pricePerShare).toFixed(2)} ${l.currency}`
    ).join(" · ");
    const confirmed = window.confirm(
      `Delete this journal entry?\n\n` +
      `${new Date(t.executedAt).toLocaleDateString()}\n${legsDesc}\n\n` +
      `⚠ This removes the JOURNAL entry only. Position quantities and cash balances are NOT automatically undone — reconcile them on the Positions tab if needed.`
    );
    if (!confirmed) return;
    setDeletingId(t._id);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-trade/${t._id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) { alert(`Delete failed: ${e?.message || "network"}`); }
    finally { setDeletingId(null); }
  };

  // Quick summary stats
  let totalTrades = 0, totalDeposit = 0, totalWithdraw = 0, totalBuyValue = 0, totalSellValue = 0;
  for (const t of trades || []) {
    totalTrades++;
    for (const leg of t.legs || []) {
      const gross = Number(leg.grossValue) || 0;
      const cad = leg.currency === "USD" ? gross * (t.fxUsdCadAtTrade || 1.37) : gross;
      if (leg.side === "BUY") totalBuyValue += cad;
      else if (leg.side === "SELL") totalSellValue += cad;
      else if (leg.side === "DEPOSIT") totalDeposit += cad;
      else if (leg.side === "WITHDRAW") totalWithdraw += cad;
    }
  }

  const fmtMoney0 = (n) => "$" + Math.round(Math.abs(n)).toLocaleString();

  // Rescan mailbox from the Trades page — same endpoint as Settings,
  // so trader can force a CIBC alert re-poll without navigating away
  // from the trade list. Uses the same dedup key as normal polls, so
  // no double-inserts. Shows an inline banner with the result.
  const [rescanning, setRescanning] = useState(false);
  const [rescanBanner, setRescanBanner] = useState(null);
  const rescanMailbox = async () => {
    setRescanBanner(null);
    setRescanning(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/email-integration/rescan-mailbox`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setRescanBanner({
        kind: j.fatal ? "err" : "ok",
        msg: buildRescanBannerMessage(j),
      });
      await load();
      await loadPendingReview();
    } catch (e) {
      setRescanBanner({ kind: "err", msg: `Rescan failed: ${e?.message || "unknown"}` });
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div>
      {rescanBanner && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap",
          background: rescanBanner.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color: rescanBanner.kind === "ok" ? "#166534" : "#7f1d1d",
          border: `1px solid ${rescanBanner.kind === "ok" ? "#86efac" : "#fecaca"}`,
        }}>{rescanBanner.msg}</div>
      )}
      {verifyBanner && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12,
          background: verifyBanner.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color: verifyBanner.kind === "ok" ? "#166534" : "#7f1d1d",
          border: `1px solid ${verifyBanner.kind === "ok" ? "#86efac" : "#fecaca"}`,
        }}>{verifyBanner.msg}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2>Trades</h2>
          <div className="sa-breadcrumb">
            Transaction journal · most recent first
            {Object.keys(pendingReviewById).length > 0 && (
              <> · <span style={{ color: "#7f1d1d", fontWeight: 700 }}>{Object.keys(pendingReviewById).length} trade{Object.keys(pendingReviewById).length === 1 ? "" : "s"} need verify — see rows highlighted in pink</span></>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="sa-btn"
            onClick={rescanMailbox}
            disabled={rescanning}
            title="Re-poll the CIBC alert mailbox from the earliest matching message. Uses the same dedup key as the background poller, so no double-inserts. Use this after placing a trade to pick it up immediately instead of waiting for the next scheduled poll."
          >
            {rescanning ? "Rescanning…" : "↻ Rescan mailbox"}
          </button>
          <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
            {[30, 90, 365, 1825].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600,
                  border: "none", borderRadius: 6, cursor: "pointer",
                  background: days === d ? "var(--sa-accent)" : "transparent",
                  color: days === d ? "#fff" : "var(--sa-text-2)",
                }}
              >{d === 1825 ? "5y" : d === 365 ? "1y" : d === 90 ? "90d" : "30d"}</button>
            ))}
          </div>
        </div>
      </div>

      {!busy && trades && trades.length > 0 && (
        <div className="sa-stats" style={{ marginBottom: 18 }}>
          <div className="sa-stat"><div className="label">Trades</div><div className="value">{totalTrades}</div></div>
          <div className="sa-stat"><div className="label">Bought (CAD)</div><div className="value">{fmtMoney0(totalBuyValue)}</div></div>
          <div className="sa-stat"><div className="label">Sold (CAD)</div><div className="value">{fmtMoney0(totalSellValue)}</div></div>
          <div className="sa-stat"><div className="label">Deposits − Withdrawals</div><div className="value" style={{ color: totalDeposit - totalWithdraw >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>{totalDeposit - totalWithdraw >= 0 ? "+" : "−"}{fmtMoney0(totalDeposit - totalWithdraw)}</div></div>
        </div>
      )}

      {err && <div className="sa-err">{err}</div>}
      {busy && <div className="sa-muted" style={{ padding: 24 }}>Loading…</div>}
      {!busy && trades && trades.length === 0 && (
        <div className="sa-card" style={{ padding: 32, textAlign: "center" }}>
          <div className="sa-muted" style={{ marginBottom: 14 }}>
            No trades recorded in the last {days} day{days === 1 ? "" : "s"}.
          </div>
          <div className="sa-muted" style={{ fontSize: 12 }}>
            Every Buy / Sell / Swap / Cash movement you record from the Dashboard or Advice tab lands here.
          </div>
        </div>
      )}

      {!busy && trades && trades.length > 0 && (
        <div className="sa-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--sa-panel-2)" }}>
                  <th style={{ ...recHeaderCellLeft, width: "1%", whiteSpace: "nowrap" }}>Date</th>
                  <th style={{ ...recHeaderCellLeft, width: "1%", whiteSpace: "nowrap" }}>Account</th>
                  <th style={{ ...recHeaderCellLeft, width: "1%", whiteSpace: "nowrap" }}>Legs</th>
                  <th style={{ ...recHeaderCell, width: "1%", whiteSpace: "nowrap" }}>Net cash (CAD)</th>
                  <th style={{ ...recHeaderCellLeft, width: "auto" }}>Notes</th>
                  <th style={{ ...recHeaderCell, width: "1%", whiteSpace: "nowrap" }}></th>
                </tr>
              </thead>
              <tbody>
                {trades.flatMap((t, i) => {
                  const pending = pendingReviewById[t._id];
                  const isPending = !!pending;
                  const rowStyle = isPending
                    ? { borderTop: "1px solid var(--sa-border)", background: "#fef2f2" }
                    : { borderTop: "1px solid var(--sa-border)" };
                  const rows = [(
                  <tr key={t._id || i} style={rowStyle}>
                    <td style={recCellLeft}>
                      {new Date(t.executedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {isPending && (
                        <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: "#7f1d1d", letterSpacing: ".04em" }}>⚠ NEEDS REVIEW</div>
                      )}
                    </td>
                    <td style={recCellLeft}><span className="sa-muted">{t.accountName || "—"}</span></td>
                    <td style={recCellLeft}>
                      {(t.legs || []).map((leg, li) => {
                        const sideColor =
                          leg.side === "BUY" ? "var(--sa-green)"
                          : leg.side === "SELL" ? "var(--sa-red)"
                          : leg.side === "DEPOSIT" ? "var(--sa-accent-2)"
                          : leg.side === "WITHDRAW" ? "var(--sa-amber)"
                          : "var(--sa-muted)";
                        const sideBg =
                          leg.side === "BUY" ? "var(--sa-green-soft)"
                          : leg.side === "SELL" ? "var(--sa-red-soft)"
                          : leg.side === "DEPOSIT" ? "var(--sa-accent-soft)"
                          : leg.side === "WITHDRAW" ? "var(--sa-amber-soft)"
                          : "var(--sa-panel-2)";
                        const isCash = leg.side === "DEPOSIT" || leg.side === "WITHDRAW";
                        return (
                          <div key={li} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8, marginBottom: li < t.legs.length - 1 ? 4 : 0 }}>
                            <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: sideBg, color: sideColor }}>{leg.side}</span>
                            {isCash ? (
                              <span>${Number(leg.grossValue).toLocaleString(undefined, { maximumFractionDigits: 0 })} {leg.currency}</span>
                            ) : (
                              <span>{leg.shares?.toLocaleString()} {leg.ticker} @ ${Number(leg.pricePerShare).toFixed(2)} {leg.currency}</span>
                            )}
                          </div>
                        );
                      })}
                    </td>
                    <td style={{ ...recCell, color: t.netCashCad >= 0 ? "var(--sa-green)" : "var(--sa-red)", fontWeight: 600 }}>
                      <span className="sa-amount">{t.netCashCad >= 0 ? "+" : "−"}${Math.abs(t.netCashCad || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </td>
                    <td style={{ ...recCellLeft, color: "var(--sa-muted)", fontSize: 12, whiteSpace: "normal", lineHeight: 1.4 }}>
                      {t.notes || "—"}
                    </td>
                    <td style={{ ...recCell, textAlign: "right", whiteSpace: "nowrap" }}>
                      {isPending && (
                        <button
                          className="sa-btn"
                          style={{ padding: "3px 8px", fontSize: 11, marginRight: 4, background: "#dc2626", color: "white" }}
                          title="Pick an account and apply this trade to positions + cash."
                          onClick={() => setVerifyExpanded(verifyExpanded === t._id ? null : t._id)}
                        >
                          {verifyExpanded === t._id ? "Cancel" : "Verify"}
                        </button>
                      )}
                      <button
                        className="sa-btn ghost"
                        style={{ padding: "3px 8px", fontSize: 11, marginRight: 4 }}
                        title="Change the share count on any leg. Positions and cash auto-recompute."
                        onClick={() => editTradeShares(t)}
                        disabled={deletingId === t._id}
                      >
                        {deletingId === t._id ? "…" : "Edit"}
                      </button>
                      <button
                        className="sa-btn ghost"
                        style={{ padding: "3px 8px", fontSize: 11 }}
                        title="Delete this trade journal entry. Positions are not auto-adjusted."
                        onClick={() => deleteTrade(t)}
                        disabled={deletingId === t._id}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  )];
                  if (isPending && verifyExpanded === t._id) {
                    rows.push(
                      <tr key={`${t._id}-verify`} style={{ background: "#fef2f2" }}>
                        <td colSpan={6} style={{ padding: "10px 14px" }}>
                          <PendingReviewRow
                            row={pending}
                            allAccounts={allAccounts}
                            onResolve={(acctId) => resolveOne(t._id, acctId)}
                          />
                          <div style={{ marginTop: 6, fontSize: 11, color: "#7f1d1d" }}>
                            Reason: {pending.reason || "(no reason recorded)"}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Advice Scorecard — the close-the-loop view. For each rec generated in the
// window: did the user execute it? Was the call right? How much $ did it
// produce (or save by being skipped)?
// =============================================================================
// =============================================================================
// Discovery scorecard — did the Discover engine actually find winners?
// Compares each past candidate's % return from priceAtDiscovery to current
// Yahoo price, against SPY's return over the same window. Honest feedback.
// =============================================================================
// =============================================================================
// Data status panel — answers "why is this empty?" with hard counts from
// the database. Each row shows what's in the DB and, if empty, the
// concrete next-step that would populate it.
// =============================================================================
// One-click diagnostic for "why aren't my briefings arriving?" Runs from
// inside the app so the user's session cookie is always attached — no
// cross-domain / cookie fiddling.
function AlertsCard({ sessionToken }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ ticker: "", condition: "above", price: "", rvolMin: "", currency: "USD", note: "" });

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/alerts`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (r.ok) setItems(j.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [sessionToken]);

  const create = async (e) => {
    e?.preventDefault?.();
    if (creating) return;
    setCreating(true); setMsg(null);
    try {
      const body = {
        ticker: form.ticker.toUpperCase().trim(),
        condition: form.condition,
        price: Number(form.price),
        rvolMin: form.rvolMin === "" ? null : Number(form.rvolMin),
        currency: form.currency,
        note: form.note.trim(),
      };
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/alerts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setForm({ ticker: "", condition: "above", price: "", rvolMin: "", currency: "USD", note: "" });
      setMsg({ ok: true, text: `Alert armed for ${body.ticker} ${body.condition} $${body.price}` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Failed" });
    } finally { setCreating(false); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this alert?")) return;
    await fetch(`${BACKEND_URL}/api/stocks-advice/alerts/${id}`, {
      method: "DELETE", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
    });
    load();
  };

  const rearm = async (id) => {
    await fetch(`${BACKEND_URL}/api/stocks-advice/alerts/${id}/rearm`, {
      method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
    });
    load();
  };

  const tickNow = async () => {
    setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/alerts/tick-now`, {
        method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setMsg({ ok: true, text: `Tick complete — checked ${j.checked}, fired ${j.fired}` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Tick failed" }); }
  };

  const active = items.filter((a) => a.active);
  const triggered = items.filter((a) => !a.active);

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🔔 Price alerts</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Fires an email when a ticker crosses a level (optionally on RVOL ≥ N). Cron ticks every 5 min during US market hours.
          </div>
        </div>
        <button className="sa-btn ghost" onClick={tickNow} title="Force one alert-check now, off-schedule, ignoring market hours">Tick now</button>
      </div>

      <form onSubmit={create} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Ticker</div>
          <input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} placeholder="NVDA" required style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Condition</div>
          <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }}>
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Price</div>
          <input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="145.00" required style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>RVOL min (optional)</div>
          <input type="number" step="0.1" value={form.rvolMin} onChange={(e) => setForm({ ...form, rvolMin: e.target.value })} placeholder="2.0" style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Ccy</div>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }}>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
          </select>
        </label>
        <button className="sa-btn" type="submit" disabled={creating}>{creating ? "Adding…" : "Arm alert"}</button>
      </form>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note (optional) — e.g. 'add on VCP breakout'" style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 12 }} />

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12.5, background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`, color: msg.ok ? "#166534" : "#991b1b", borderRadius: 8, padding: "8px 10px" }}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--sa-muted)" }}>Loading alerts…</div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", marginBottom: 6 }}>Active ({active.length})</div>
              {active.map((a) => (
                <div key={a._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: "var(--sa-panel-2)", fontSize: 12.5, marginBottom: 4 }}>
                  <b style={{ minWidth: 60 }}>{a.ticker}</b>
                  <span>{a.condition === "above" ? "↑" : "↓"} ${a.price} {a.currency}</span>
                  {a.rvolMin && <span style={{ color: "var(--sa-muted)" }}>+ RVOL ≥ {a.rvolMin}x</span>}
                  {a.note && <span style={{ flex: 1, color: "var(--sa-text-2)", fontStyle: "italic" }}>{a.note}</span>}
                  <button className="sa-btn ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => remove(a._id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
          {triggered.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", marginBottom: 6 }}>Triggered ({triggered.length})</div>
              {triggered.slice(0, 20).map((a) => (
                <div key={a._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: "#fefce8", fontSize: 12, marginBottom: 4 }}>
                  <b style={{ minWidth: 60 }}>{a.ticker}</b>
                  <span>{a.condition === "above" ? "↑" : "↓"} ${a.price}</span>
                  <span style={{ color: "var(--sa-muted)" }}>→ fired @ ${a.triggeredPrice?.toFixed(2)} {a.triggeredAt ? `on ${new Date(a.triggeredAt).toLocaleString()}` : ""}</span>
                  <span style={{ flex: 1 }} />
                  <button className="sa-btn ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => rearm(a._id)}>Re-arm</button>
                  <button className="sa-btn ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => remove(a._id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
          {active.length === 0 && triggered.length === 0 && (
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--sa-muted)" }}>No alerts yet. Arm one above.</div>
          )}
        </>
      )}
    </div>
  );
}

// Client-side mirror of stocksSleeveEnforcer.js so we can classify a
// pick locally without a round-trip. Keep in sync — these lists are
// small and change rarely. Fallback: any .TO/.V/.NE/.CN suffix → SWING.
const SLEEVE_CORE_ETFS = new Set([
  "SPY","VOO","IVV","VTI","ITOT","SPTM","QQQ","VUG","SCHG",
  "IWM","VB","XIU","XIC","VCN","XEQT","XGRO","XBAL","VBAL","VGRO","VEQT",
  "VFV","XUS","VUN","XUU","AGG","BND","XBB","VAB","ZAG","TLT","IEF",
]);
const SLEEVE_SWING_TICKERS = new Set([
  "RY","TD","BMO","BNS","CM","NA","CWB","MFC","SLF","IFC","GWO",
  "ENB","TRP","CNQ","SU","CVE","IMO","TOU","ARX",
  "FTS","H","EMA","AQN","BCE","T","RCI","CP","CNR",
  "L","ATD","MG","CTC","WCN","GIB","BN","BAM","REI","CAR","CSU","OTEX",
  // US mega-cap large-caps — single-name conviction trades, not spec.
  // Mirrors backend stocksSleeveEnforcer.SWING_TICKERS.
  "MSFT","AAPL","GOOGL","GOOG","AMZN","META","NVDA","TSLA",
  "BRK.B","BRKB","V","MA","JPM","WMT","HD","PG","JNJ","KO",
  "XOM","CVX","UNH","COST","AVGO","AMD","NFLX","CRM","ORCL",
  "ADBE","CSCO","PEP","TMO","ABT","MRK","PFE","LLY","DIS",
  "BAC","WFC","GS","MS","C",
]);
const SLEEVE_SPEC_TICKERS = new Set([
  "DJT","DJTWW","GME","AMC","BBAI","SOUN","RIVN","LCID",
  "PLTR","RKLB","IONQ","SMCI","COIN","MSTR","HOOD",
  "NIO","XPEV","LI","BABA","PDD",
]);
function sleeveOfTicker(ticker) {
  const raw = String(ticker || "").toUpperCase();
  const base = raw.replace(/\..*$/, "");
  if (SLEEVE_CORE_ETFS.has(base)) return "core";
  if (SLEEVE_SWING_TICKERS.has(base)) return "swing";
  if (SLEEVE_SPEC_TICKERS.has(base)) return "spec";
  if (/\.(TO|V|NE|CN)$/i.test(raw)) return "swing";
  return "spec";
}
// Compute sleeve balance from user.positions. Mirrors
// stocksSleeveEnforcer.computeSleeveBalance but stays skinny.
function computeSleeveBalanceClient(user) {
  const fx = user?.fxUsdCad || 1.37;
  const targets = user?.sleeveTargets || { core: 80, swing: 15, spec: 5 };
  const sum = (targets.core || 0) + (targets.swing || 0) + (targets.spec || 0);
  const targetPct = sum > 0
    ? { core: (targets.core / sum) * 100, swing: (targets.swing / sum) * 100, spec: (targets.spec / sum) * 100 }
    : { core: 80, swing: 15, spec: 5 };
  const totals = { core: 0, swing: 0, spec: 0 };
  for (const p of (user?.positions || [])) {
    const sleeve = sleeveOfTicker(p.ticker);
    const cad = (Number.isFinite(p.priceCad) ? p.priceCad : (Number.isFinite(p.priceUsd) ? p.priceUsd * fx : 0)) * (p.qty || 0);
    totals[sleeve] += cad;
  }
  const cashCad = (user?.accounts || []).reduce((s, a) => s + (a.cashCad || 0) + (a.cashUsd || 0) * fx, 0);
  const book = totals.core + totals.swing + totals.spec + cashCad;
  const targetsCad = {
    core: book * targetPct.core / 100,
    swing: book * targetPct.swing / 100,
    spec: book * targetPct.spec / 100,
  };
  return {
    book, cashCad, fx, totals, targetsCad, targetPct,
    headroomCad: {
      core: targetsCad.core - totals.core,
      swing: targetsCad.swing - totals.swing,
      spec: targetsCad.spec - totals.spec,
    },
  };
}

// Baseball cards — per-source performance table (task #128). Aggregates
// every closed rec (target-hit, stop-hit, expired) by sourceLabel over
// the selected window and shows trades / win rate / avg return /
// expectancy / worst-trade for each. Feedback loop that lets the trader
// (and future backtest-gating) empirically retire sources whose recs
// don't earn their spot. Sources with < 20 trades are tagged "unproven"
// so the reader doesn't over-index on small-sample noise.
function SourceScorecardCard({ sessionToken }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/stocks-advice/source-scorecard?days=${days}`,
          { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "load failed");
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days]);

  const fmtPct = (v, sign = false) => {
    if (v == null) return "—";
    const s = v >= 0 ? "+" : "";
    return `${sign ? s : (v < 0 ? "" : "")}${v.toFixed(2)}%`;
  };
  const clr = (v) => v == null ? "inherit" : v > 0 ? "#166534" : v < 0 ? "#991b1b" : "inherit";

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>⚾ Source scorecard</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Every closed rec bucketed by where it came from — sonnet-briefing / auto-sell-trail / rule-stop / etc. Best expectancy sorts to the top. Sources with &lt;20 trades tagged unproven (small-sample noise, not signal).
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: days === d ? "var(--sa-panel)" : "transparent",
                color: days === d ? "inherit" : "var(--sa-muted)",
                border: "none", cursor: "pointer",
              }}
            >{d}d</button>
          ))}
        </div>
      </div>
      {busy && <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>}
      {err && <div className="sa-err">{err}</div>}
      {data && (data.rows || []).length === 0 && (
        <div className="sa-muted" style={{ fontSize: 12.5, padding: "12px 4px", fontStyle: "italic" }}>
          No closed recs in the last {days} days yet. The scorecard populates as target/stop hits + expiries close out open recs.
          {data.totalRecsInWindow > 0 && ` (${data.totalRecsInWindow} recs generated, all still open.)`}
        </div>
      )}
      {data && data.rows?.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Source</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="Number of closed recs">Trades</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="% of closed recs where return was positive">Win %</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="Average return across every closed rec">Avg</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="Winners: average return">Avg win</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="Losers: average return (negative)">Avg loss</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="Worst single-trade return in the window">Worst</th>
                <th style={{ textAlign: "right", padding: "6px 8px" }} title="winRate × avgWin − (1 − winRate) × |avgLoss| — expected return per rec">Expectancy</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.source} style={{ borderTop: "1px dashed var(--sa-border)", background: i === 0 && r.proven ? "#f0fdf4" : "transparent" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.source}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.trades}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.winRate.toFixed(0)}%</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: clr(r.avgReturnPct), fontWeight: 600 }}>{fmtPct(r.avgReturnPct, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#166534" }}>{fmtPct(r.avgWinPct, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#991b1b" }}>{fmtPct(r.avgLossPct, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#991b1b" }}>{fmtPct(r.worstTradePct, true)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: clr(r.expectancyPct), fontWeight: 700 }}>{fmtPct(r.expectancyPct, true)}</td>
                  <td style={{ padding: "6px 8px", fontSize: 10.5, color: "var(--sa-muted)" }}>
                    {r.proven
                      ? <span style={{ color: "#166534" }}>✓ proven (n≥20)</span>
                      : <span style={{ color: "#92400e" }}>⚠ unproven</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--sa-muted)", fontStyle: "italic" }}>
            Best-expectancy source highlighted green if proven. Retire (or gate) sources with negative expectancy once they cross n=20 — they're actively subtracting from your returns.
          </div>
        </div>
      )}
    </div>
  );
}

// Rolling 7-day retrospective + forward look. Answers three questions
// at a glance: what did I do this week (trades + commission burn),
// how did I do (book change vs SPY/XIC alpha), and what's ahead
// (open recs whose horizon expires in the coming week).
function WeekInReviewCard({ sessionToken, user }) {
  // Base-ticker set for held positions — used to distinguish SELL recs
  // that mean "close/trim an existing long" (target/stop are meaningless
  // — you're just exiting) from SELL recs on unheld tickers, which are
  // genuine short-sale setups with a downside target and upside cover.
  // Rendering "$430 stop" on a SELL you already own reads as nonsense.
  const heldBases = useMemo(() => {
    const s = new Set();
    for (const p of user?.positions || []) {
      if (!(p.qty > 0)) continue;
      const b = String(p.ticker || "").toUpperCase().replace(/\..*$/, "");
      if (b) s.add(b);
    }
    return s;
  }, [user]);
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/stocks-portfolio/week-in-review?days=${days}`,
          { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "load failed");
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days]);

  const fmtCad = (n) => n == null ? "—" : `$${Math.round(Math.abs(n)).toLocaleString()} CAD`;
  const fmtPct = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const clrPnl = (n) => n == null ? "inherit" : n > 0 ? "#166534" : n < 0 ? "#b91c1c" : "inherit";
  const dayLabel = days === 7 ? "week" : `${days}d window`;

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>📅 Week in review</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            What you did · how you did · what's next. Rolling {dayLabel} — activity + book delta + open recs expiring in the next {days} days.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: days === d ? "var(--sa-panel)" : "transparent",
                color: days === d ? "inherit" : "var(--sa-muted)",
                border: "none", cursor: "pointer",
              }}
            >{d}d</button>
          ))}
        </div>
      </div>
      {busy && <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>}
      {err && <div className="sa-err" style={{ fontSize: 12 }}>Failed to load: {err}</div>}
      {!busy && !err && data && (() => {
        const a = data.activity || {};
        const p = data.performance || {};
        const f = data.forwardLook || {};
        const outperformedSpy = p.alphaVsSpyPp != null && p.alphaVsSpyPp > 0;
        const outperformedXic = p.alphaVsXicPp != null && p.alphaVsXicPp > 0;
        return (
          <>
            {/* Activity strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
              <div style={{ padding: "10px 12px", background: "var(--sa-panel-2)", borderRadius: 8 }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>You did</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 3 }}>{a.tradeCount} trade{a.tradeCount === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 3 }}>
                  {a.byAction?.BUY || 0} BUY · {a.byAction?.SELL || 0} SELL{(a.byAction?.TRIM || 0) > 0 ? ` · ${a.byAction.TRIM} TRIM` : ""}
                </div>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--sa-panel-2)", borderRadius: 8 }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Commission burn</div>
                <div className="sa-amount" style={{ fontSize: 20, fontWeight: 700, marginTop: 3, color: a.commissionsPaidCad > 100 ? "#991b1b" : "inherit" }}>
                  {fmtCad(a.commissionsPaidCad)}
                </div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 3 }}>
                  {a.tradeCount} × ${Math.round((a.commissionsPaidCad || 0) / Math.max(1, a.tradeCount))} each
                </div>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--sa-panel-2)", borderRadius: 8 }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Notional moved</div>
                <div className="sa-amount" style={{ fontSize: 20, fontWeight: 700, marginTop: 3 }}>
                  {fmtCad(a.totalNotionalCad)}
                </div>
                {a.biggestTrade && (
                  <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 3 }}>
                    biggest: {a.biggestTrade.side} {a.biggestTrade.shares} {a.biggestTrade.ticker}
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 12px", background: p.changeCad >= 0 ? "#dcfce7" : "#fee2e2", borderRadius: 8, border: `1px solid ${p.changeCad >= 0 ? "#86efac" : "#fca5a5"}` }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Book Δ this {days === 7 ? "week" : `${days}d`}</div>
                <div className="sa-amount" style={{ fontSize: 20, fontWeight: 700, marginTop: 3, color: clrPnl(p.changeCad) }}>
                  {p.changeCad != null ? `${p.changeCad >= 0 ? "+" : "−"}${fmtCad(p.changeCad)}` : "—"}
                </div>
                <div style={{ fontSize: 11, color: clrPnl(p.changePct), marginTop: 3 }}>
                  {fmtPct(p.changePct)}
                </div>
              </div>
            </div>

            {/* Vs benchmark line */}
            {(p.alphaVsSpyPp != null || p.alphaVsXicPp != null) && (
              <div style={{ padding: "10px 12px", background: "var(--sa-panel)", border: "1px solid var(--sa-border)", borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
                <b>vs benchmarks:</b>{" "}
                {p.alphaVsSpyPp != null && (
                  <span style={{ color: clrPnl(p.alphaVsSpyPp) }}>
                    SPY {fmtPct(p.spyChangePct)} → alpha {p.alphaVsSpyPp >= 0 ? "+" : ""}{p.alphaVsSpyPp.toFixed(1)}pp{outperformedSpy ? " ✓" : ""}
                  </span>
                )}
                {p.alphaVsSpyPp != null && p.alphaVsXicPp != null && <span style={{ color: "var(--sa-muted)" }}> · </span>}
                {p.alphaVsXicPp != null && (
                  <span style={{ color: clrPnl(p.alphaVsXicPp) }}>
                    XIC {fmtPct(p.xicChangePct)} → alpha {p.alphaVsXicPp >= 0 ? "+" : ""}{p.alphaVsXicPp.toFixed(1)}pp{outperformedXic ? " ✓" : ""}
                  </span>
                )}
              </div>
            )}

            {/* Forward look */}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
                Next {days} days · {f.openRecsExpiringInWindow?.length || 0} open rec{f.openRecsExpiringInWindow?.length === 1 ? "" : "s"} decision-window
              </div>
              {(f.openRecsExpiringInWindow || []).length === 0 ? (
                <div className="sa-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                  No open recs expire in the coming {days} days. {f.totalOpenRecs > 0 ? `${f.totalOpenRecs} open rec${f.totalOpenRecs === 1 ? "" : "s"} still tracking with longer horizons.` : "No open recs on file."}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr style={{ color: "var(--sa-muted)", background: "var(--sa-panel-2)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        <th style={{ textAlign: "left", padding: "5px 8px" }}>Ticker</th>
                        <th style={{ textAlign: "left", padding: "5px 8px" }}>Side</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Entry</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Target</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Stop</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Horizon</th>
                        <th style={{ textAlign: "right", padding: "5px 8px" }}>Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.openRecsExpiringInWindow.map((r, i) => {
                        // Distinguish "trim/exit existing long" (SELL on a
                        // ticker in the position book) from "genuine short
                        // setup" (SELL on an unheld name). For the first
                        // case the stop/target fields carry no useful info
                        // — the rec just says "get out around $entry"
                        // — and rendering them as prices reads as a broken
                        // short setup with stop above entry.
                        const base = String(r.ticker || "").toUpperCase().replace(/\..*$/, "");
                        const isCloseExisting = r.action === "SELL" && heldBases.has(base);
                        return (
                          <tr key={i} style={{ borderTop: "1px dashed var(--sa-border)" }}>
                            <td style={{ padding: "5px 8px", fontWeight: 700 }}>{r.ticker}</td>
                            <td style={{ padding: "5px 8px" }}>
                              <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: r.action === "BUY" ? "var(--sa-green-soft)" : "var(--sa-red-soft)", color: r.action === "BUY" ? "var(--sa-green)" : "var(--sa-red)" }}>
                                {isCloseExisting ? "EXIT" : r.action}
                              </span>
                            </td>
                            <td style={{ padding: "5px 8px", textAlign: "right" }}>
                              ${Number(r.entryPrice).toFixed(2)}
                              {isCloseExisting && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--sa-muted)" }}>at market</span>}
                            </td>
                            {isCloseExisting ? (
                              <td colSpan={2} style={{ padding: "5px 8px", textAlign: "center", color: "var(--sa-muted)", fontSize: 11, fontStyle: "italic" }}>
                                close existing position — no target / stop
                              </td>
                            ) : (
                              <>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "#166534" }}>{Number(r.targetPrice) > 0 ? `$${Number(r.targetPrice).toFixed(2)}` : "—"}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", color: "#991b1b" }}>{Number(r.stopPrice) > 0 ? `$${Number(r.stopPrice).toFixed(2)}` : "—"}</td>
                              </>
                            )}
                            <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{r.horizonDays}d</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--sa-muted)" }}>{new Date(r.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── Test A: forced daily-pick discipline ───────────────────────────
function DailyPickCard({ sessionToken, user }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // Live prices per pick ticker — drives entry-zone row coloring.
  const [pickPrices, setPickPrices] = useState({});

  const load = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/daily-picks?days=60`, { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      if (r.ok) setData(j);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, [sessionToken]);

  // Fetch live prices for every OPEN pick's ticker whenever picks reload,
  // so the entry-zone highlight reflects today's market.
  useEffect(() => {
    const opens = (data?.items || []).filter((p) => p.status === "open");
    if (opens.length === 0) { setPickPrices({}); return; }
    const tickers = [...new Set(opens.map((p) => p.ticker))];
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const m = {};
        for (const [t, q] of Object.entries(j.prices || {})) if (q?.price != null) m[t] = q.price;
        setPickPrices(m);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [data]);

  const generateNow = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/daily-picks/generate-now`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "generate failed");
      setMsg({ ok: true, text: j.skipped ? `Already have ${j.existing} picks today` : `Generated ${j.inserted?.length ?? 0} picks` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Failed" }); }
    finally { setBusy(false); }
  };
  const sweepNow = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/daily-picks/sweep-now`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      setMsg({ ok: true, text: `Swept ${j.checked} · closed ${j.closed}` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Failed" }); }
    finally { setBusy(false); }
  };
  const dedupeNow = async () => {
    if (busy) return;
    if (!window.confirm("Delete duplicate daily-pick rows? For every (ticker, day) bucket, the highest-scoring row is kept (or the one you've entered a position on) — all others deleted.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/daily-picks/dedupe`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsg({ ok: true, text: `Scanned ${j.buckets} (ticker, day) buckets · removed ${j.removed} duplicate rows` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Failed" }); }
    finally { setBusy(false); }
  };
  const backfillLinks = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-trade/backfill-daily-pick-links`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsg({ ok: true, text: `Scanned ${j.scanned} unlinked trades · linked ${j.linked} to matching swing picks` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Failed" }); }
    finally { setBusy(false); }
  };

  const rawItems = data?.items || [];
  // Suppress stale duplicate recs once a position has been entered.
  // Rule: for any base ticker with an entered open pick, hide OTHER
  // open picks on that ticker — the earlier rec that led to the buy
  // is what remains visible (as POSITION ENTERED), and any later or
  // earlier still-open pick for the same name is just noise now that
  // the position is on. Closed picks are kept (history matters).
  const enteredBases = new Set(
    rawItems
      .filter((p) => p.status === "open" && p.enteredAt)
      .map((p) => String(p.ticker || "").toUpperCase().replace(/\..*$/, ""))
  );
  const items = rawItems.filter((p) => {
    if (p.status !== "open") return true;
    if (p.enteredAt) return true;
    const base = String(p.ticker || "").toUpperCase().replace(/\..*$/, "");
    return !enteredBases.has(base);
  });
  const suppressedCount = rawItems.length - items.length;
  const s = data?.summary;

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🎯 Test A · Forced daily picks (real-time discipline)</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Cron generates <b>exactly 2 picks/day</b> at 09:15 ET using the deterministic composite score — no cherry-picking, no LLM narrative. Every pick tracked to close. Requires STOCKS_DAILY_PICK_ENABLED=1.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="sa-btn ghost" onClick={backfillLinks} disabled={busy} title="Retroactively link recorded trades to matching swing picks (e.g. AMZN buy that fulfilled a pick but wasn't linked at record time).">Backfill trade links</button>
          <button className="sa-btn ghost" onClick={dedupeNow} disabled={busy} title="Delete duplicate rows per (ticker, day). Keeps the highest-scoring row or an entered position; discards the rest.">Dedupe</button>
          <button className="sa-btn ghost" onClick={sweepNow} disabled={busy}>Sweep now</button>
          <button className="sa-btn" onClick={generateNow} disabled={busy}>Generate now</button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 10, fontSize: 12.5, background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`, color: msg.ok ? "#166534" : "#991b1b", borderRadius: 8, padding: "8px 10px" }}>{msg.text}</div>}

      {s && s.totalPicks > 0 && (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          {[
            { label: "Total picks", v: s.totalPicks },
            { label: "Open", v: s.openCount },
            { label: "Closed", v: s.closedCount },
            { label: "Win rate", v: s.winRate != null ? `${s.winRate.toFixed(0)}%` : "—" },
            { label: "Avg return", v: s.avgReturnPct != null ? `${s.avgReturnPct >= 0 ? "+" : ""}${s.avgReturnPct.toFixed(1)}%` : "—", color: (s.avgReturnPct ?? 0) >= 0 ? "#166534" : "#991b1b" },
            { label: "Net P&L @ $5k/trade", v: `${s.netPnlAt5kPerTrade >= 0 ? "+" : ""}$${Math.round(s.netPnlAt5kPerTrade).toLocaleString()}`, color: s.netPnlAt5kPerTrade >= 0 ? "#166534" : "#991b1b" },
          ].map((x, i) => (
            <div key={i} style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 6, textAlign: "center" }}>
              <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{x.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: x.color || "inherit" }}>{x.v}</div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && user && (() => {
        const bal = computeSleeveBalanceClient(user);
        const fmtCad = (n) => `$${Math.round(Math.abs(n)).toLocaleString()}`;
        return (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {["core", "swing", "spec"].map((k) => {
              const h = bal.headroomCad[k];
              const isOver = h < 0;
              const label = k.toUpperCase();
              return (
                <div key={k} style={{ padding: "8px 10px", background: isOver ? "#fee2e2" : "var(--sa-panel-2)", border: `1px solid ${isOver ? "#fca5a5" : "var(--sa-border)"}`, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{label} sleeve</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, color: isOver ? "#b91c1c" : "#166534" }}>
                    {isOver ? `-${fmtCad(h)} over` : `${fmtCad(h)} headroom`}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sa-muted)", marginTop: 2 }}>
                    now {fmtCad(bal.totals[k])} · target {fmtCad(bal.targetsCad[k])} ({bal.targetPct[k].toFixed(0)}%)
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {items.length > 0 && (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--sa-border)", color: "var(--sa-muted)", textTransform: "uppercase", fontSize: 10, letterSpacing: ".06em" }}>
                <th style={{ padding: "5px 8px", textAlign: "left" }}>Pick date</th>
                <th style={{ padding: "5px 8px", textAlign: "left" }}>Ticker</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Entry</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Stop</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Target</th>
                <th style={{ padding: "5px 8px", textAlign: "left" }}>Sleeve fit</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Score</th>
                <th style={{ padding: "5px 8px", textAlign: "left" }}>Setup</th>
                <th style={{ padding: "5px 8px", textAlign: "left" }}>Status</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Return</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const livePx = pickPrices[p.ticker];
                const entered = !!p.enteredAt;
                // Entry-zone highlight suppressed once user has entered —
                // the pick is no longer a fresh idea, it's an active position.
                const zone = (p.status === "open" && !entered) ? entryZoneStatus(livePx, { entryPrice: p.entryPrice, stopPrice: p.stopPrice }) : null;
                const zs = zoneStyle(zone);
                // Muted row bg + explicit tag when entered.
                const rowBg = entered ? "#f1f5f9" : (zs ? zs.bg : "transparent");
                const rowOpacity = entered ? 0.75 : 1;
                return (
                  <tr key={p._id} style={{ borderBottom: "1px solid var(--sa-border)", background: rowBg, opacity: rowOpacity }}>
                    <td style={{ padding: "5px 8px" }}>{new Date(p.pickDate).toLocaleDateString()}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 700 }}>
                      {p.ticker}
                      {entered && (
                        <span style={{ marginLeft: 6, background: "#dbeafe", color: "#1e40af", padding: "1px 6px", borderRadius: 99, fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", verticalAlign: "middle" }}>
                          POSITION ENTERED
                        </span>
                      )}
                      {!entered && zs && <span style={{ marginLeft: 6, background: zs.border, color: zs.accent, padding: "1px 6px", borderRadius: 99, fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", verticalAlign: "middle" }}>{zs.tag}</span>}
                      {entered && p.enteredShares && p.enteredPrice != null && (
                        <div style={{ fontSize: 9.5, color: "var(--sa-muted)", fontWeight: 400, marginTop: 2 }}>
                          bought {p.enteredShares} sh @ ${Number(p.enteredPrice).toFixed(2)} on {new Date(p.enteredAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      ${p.entryPrice.toFixed(2)}
                      {livePx != null && <div style={{ fontSize: 9.5, color: "var(--sa-muted)" }}>now ${livePx.toFixed(2)}</div>}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#991b1b", fontVariantNumeric: "tabular-nums" }}>
                      ${p.stopPrice?.toFixed(2) ?? "—"}
                      {Number.isFinite(p.stopPrice) && (() => {
                        // Same anchoring rule as target: use the lower of
                        // entry and now. If now has pulled below entry,
                        // that's your actual worst-case downside to stop.
                        const now = livePx;
                        const anchor = (Number.isFinite(now) && now < p.entryPrice) ? now : p.entryPrice;
                        const anchoredToNow = anchor === now && anchor !== p.entryPrice;
                        const dist = ((p.stopPrice - anchor) / anchor) * 100;
                        return (
                          <div style={{ fontSize: 9.5 }}>({dist.toFixed(1)}%{anchoredToNow ? " from now" : ""})</div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#166534", fontVariantNumeric: "tabular-nums" }}>
                      ${p.targetPrice?.toFixed(2) ?? "—"}
                      {Number.isFinite(p.targetPrice) && (() => {
                        // Anchor the ROI to whichever is LOWER — entry or
                        // current price. If the pick has pulled below entry,
                        // "now" is the actionable buy price and the ROI to
                        // target is bigger, so we show that. If it's above
                        // entry, the original entry-based ROI narrative
                        // stands and we keep the pick's stated upside.
                        const now = livePx;
                        const anchor = (Number.isFinite(now) && now < p.entryPrice) ? now : p.entryPrice;
                        const anchoredToNow = anchor === now && anchor !== p.entryPrice;
                        const roi = ((p.targetPrice - anchor) / anchor) * 100;
                        const h = Number.isFinite(p.horizonDays) && p.horizonDays > 0 ? p.horizonDays : null;
                        const ann = h ? (Math.pow(1 + roi / 100, 365 / h) - 1) * 100 : null;
                        return (
                          <>
                            <div style={{ fontSize: 9.5 }}>(+{roi.toFixed(1)}%{h ? ` / ${h}d` : ""}{anchoredToNow ? " from now" : ""})</div>
                            {ann != null && <div style={{ fontSize: 9.5, color: "#14532d" }}>ann. +{ann.toFixed(0)}%</div>}
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 10.5 }}>
                      {(() => {
                        if (!user) return "—";
                        const sleeve = sleeveOfTicker(p.ticker);
                        const bal = computeSleeveBalanceClient(user);
                        const headroom = bal.headroomCad[sleeve];
                        const sleeveTagBg = sleeve === "core" ? "#dbeafe"
                          : sleeve === "swing" ? "#dcfce7"
                          : "#fef3c7";
                        const sleeveTagFg = sleeve === "core" ? "#1e40af"
                          : sleeve === "swing" ? "#166534"
                          : "#78350f";
                        // Convert entry to CAD to estimate # of shares that fit.
                        const isCadTicker = /\.(TO|V|NE|CN)$/i.test(p.ticker || "") || p.currency === "CAD";
                        const entryCad = isCadTicker ? p.entryPrice : (p.entryPrice * bal.fx);
                        const sharesFit = (headroom > 0 && entryCad > 0) ? Math.floor(headroom / entryCad) : 0;
                        return (
                          <>
                            <span style={{ padding: "1px 6px", borderRadius: 4, background: sleeveTagBg, color: sleeveTagFg, fontWeight: 700, fontSize: 10 }}>{sleeve.toUpperCase()}</span>
                            <div style={{ marginTop: 2, color: headroom > 0 ? "#166534" : "#991b1b", fontVariantNumeric: "tabular-nums" }}>
                              {headroom > 0
                                ? `${sharesFit} sh fits ($${Math.round(headroom).toLocaleString()})`
                                : `sleeve OVER by $${Math.round(Math.abs(headroom)).toLocaleString()}`}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{p.deterministicScore ?? "—"}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10.5, color: "var(--sa-muted)" }}>{p.setupName || "—"}</td>
                    <td style={{ padding: "5px 8px", fontSize: 10.5 }}>{p.status}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: (p.pnlPct ?? 0) >= 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>{p.pnlPct != null ? `${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(!items || items.length === 0) && <div style={{ marginTop: 12, fontSize: 12, color: "var(--sa-muted)" }}>No picks yet. Click <b>Generate now</b> to seed today's picks; the cron takes over from tomorrow morning.</div>}
      {suppressedCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--sa-muted)", fontStyle: "italic" }}>
          {suppressedCount} duplicate open rec{suppressedCount === 1 ? "" : "s"} hidden — position already entered on those tickers.
        </div>
      )}
    </div>
  );
}

// ── Test B: point-in-time historical backtest ──────────────────────
function PointInTimeBacktestCard({ sessionToken }) {
  const [capital, setCapital] = useState(50000);
  const [days, setDays] = useState(30);
  const [picksPerDay, setPicksPerDay] = useState(2);
  const [horizonDays, setHorizonDays] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const q = new URLSearchParams({ capital: String(capital), days: String(days), picksPerDay: String(picksPerDay), horizonDays: String(horizonDays) });
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/backtest-pit?${q.toString()}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) { setErr(e?.message || "Backtest failed"); }
    finally { setBusy(false); }
  };

  const p = result?.portfolio;
  const money = (v) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const pct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🔬 Test B · Point-in-time historical backtest</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Walks each trading day D; uses <b>only OHLC data through D</b> to pick top N; simulates forward against actual future bars. Signals: technicals + Fib + volume + named setups. No lookahead. No LLM narrative (deterministic composite only). No cherry-picking.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Capital ($)</div>
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Lookback (days)</div>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={7} max={180} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Picks / day</div>
          <input type="number" value={picksPerDay} onChange={(e) => setPicksPerDay(Number(e.target.value))} min={1} max={5} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Horizon (days)</div>
          <input type="number" value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))} min={2} max={60} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <button className="sa-btn" onClick={run} disabled={busy}>{busy ? "Running…" : "Run PIT backtest"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}
      {result && !result.ok && <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)", background: "var(--sa-panel-2)", borderRadius: 8, padding: "10px 12px" }}>{result.reason}</div>}

      {result?.ok && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
            {[
              { label: "Capital", v: money(result.startingCapital) },
              { label: "Final value", v: money(p.finalValue), color: p.totalNetPnl >= 0 ? "#166534" : "#991b1b" },
              { label: "Net P&L", v: `${p.totalNetPnl >= 0 ? "+" : ""}${money(p.totalNetPnl)}`, color: p.totalNetPnl >= 0 ? "#166534" : "#991b1b" },
              { label: "Return", v: pct(p.totalReturnPct), color: p.totalReturnPct >= 0 ? "#166534" : "#991b1b" },
              { label: "SPY", v: pct(p.benchmarkSpyPct) },
              { label: "Alpha", v: pct(p.alphaPct), color: (p.alphaPct ?? 0) >= 0 ? "#166534" : "#991b1b" },
              { label: "Trades", v: result.tradesExecuted },
              { label: "Win rate", v: p.winRate != null ? `${p.winRate.toFixed(0)}%` : "—" },
              { label: "Avg winner", v: p.avgWinnerPct != null ? `+${p.avgWinnerPct.toFixed(1)}%` : "—", color: "#166534" },
              { label: "Avg loser", v: p.avgLoserPct != null ? `${p.avgLoserPct.toFixed(1)}%` : "—", color: "#991b1b" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: s.color || "inherit" }}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 8 }}>
            Universe: {result.universeSize} tickers · {result.tradingDaysProcessed} trading days · horizon {result.horizonDays}d · picks/day {result.picksPerDay}
          </div>

          {result.trades.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--sa-border)", color: "var(--sa-muted)", textTransform: "uppercase", fontSize: 10, letterSpacing: ".06em" }}>
                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Ticker</th>
                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Entry</th>
                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Exit</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Held</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Score</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>Return</th>
                    <th style={{ padding: "5px 8px", textAlign: "right" }}>P&L</th>
                    <th style={{ padding: "5px 8px", textAlign: "left" }}>Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--sa-border)" }}>
                      <td style={{ padding: "5px 8px", fontWeight: 700 }}>{t.ticker}</td>
                      <td style={{ padding: "5px 8px" }}>{t.entryDate} <span style={{ color: "var(--sa-muted)", fontSize: 10 }}>${t.entryPrice.toFixed(2)}</span></td>
                      <td style={{ padding: "5px 8px" }}>{t.exitDate} <span style={{ color: "var(--sa-muted)", fontSize: 10 }}>${t.exitPrice.toFixed(2)}</span></td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{t.holdDays}d</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>{t.deterministicScore}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: t.pnlPct >= 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: t.pnlDollars >= 0 ? "#166534" : "#991b1b", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.pnlDollars >= 0 ? "+" : ""}${Math.abs(Math.round(t.pnlDollars)).toLocaleString()}</td>
                      <td style={{ padding: "5px 8px", fontSize: 10.5, color: "var(--sa-muted)" }}>{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 10.5, color: "var(--sa-muted)", background: "var(--sa-panel-2)", padding: "8px 10px", borderRadius: 6 }}>
            ⚠ {result.disclaimer}
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestCard({ sessionToken }) {
  const [capital, setCapital] = useState(50000);
  const [days, setDays] = useState(30);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const q = new URLSearchParams({ capital: String(capital), days: String(days), maxConcurrent: String(maxConcurrent) });
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/backtest?${q.toString()}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) { setErr(e?.message || "Backtest failed"); }
    finally { setBusy(false); }
  };

  const p = result?.portfolio;
  const money = (v, ccy) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}${ccy ? " " + ccy : ""}`;
  const pct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>💰 Paper-trade backtest</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            "If I had followed every AI BUY rec for the last N days with $C, what would ROI have been?" Equal-weighted, exits use target/stop-hits or mark-to-market vs today. Benchmark: SPY buy-and-hold same window.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Starting capital ($)</div>
          <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Lookback (days)</div>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={7} max={365} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Max concurrent positions</div>
          <input type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} min={1} max={30} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <button className="sa-btn" onClick={run} disabled={busy}>{busy ? "Running…" : "Run backtest"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}

      {result && !result.ok && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)", background: "var(--sa-panel-2)", borderRadius: 8, padding: "10px 12px" }}>
          {result.reason}
        </div>
      )}

      {result?.ok && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
            {[
              { label: `Starting capital`, v: money(result.startingCapital) },
              { label: `Final value`, v: money(p.finalValue), color: p.totalNetPnl >= 0 ? "#166534" : "#991b1b" },
              { label: `Net P&L`, v: `${p.totalNetPnl >= 0 ? "+" : ""}${money(p.totalNetPnl)}`, color: p.totalNetPnl >= 0 ? "#166534" : "#991b1b" },
              { label: `Return`, v: pct(p.totalReturnPct), color: p.totalReturnPct >= 0 ? "#166534" : "#991b1b" },
              { label: `SPY same window`, v: pct(p.benchmarkSpyPct) },
              { label: `Alpha vs SPY`, v: pct(p.alphaPct), color: (p.alphaPct ?? 0) >= 0 ? "#166534" : "#991b1b" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: s.color || "inherit" }}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 8 }}>
            {result.tradesExecuted} paper trades from {result.buysConsidered} BUY recs ({result.totalRecsInWindow} total recs in window) · {result.skipped.length} skipped · Cash left uninvested: {money(p.cashLeftUninvested)}
          </div>

          {result.trades.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--sa-border)", color: "var(--sa-muted)", textTransform: "uppercase", fontSize: 10.5, letterSpacing: ".06em" }}>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Ticker</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Entry</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Exit</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Held</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Return</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>P&L</th>
                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Exit reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--sa-border)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>{t.ticker} <span style={{ color: "var(--sa-muted)", fontSize: 10 }}>{t.currency}</span></td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${t.entryPrice.toFixed(2)} <span style={{ color: "var(--sa-muted)", fontSize: 10 }}>{new Date(t.entryDate).toLocaleDateString()}</span></td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${t.exitPrice.toFixed(2)} <span style={{ color: "var(--sa-muted)", fontSize: 10 }}>{new Date(t.exitDate).toLocaleDateString()}</span></td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{t.holdDays}d</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: t.pnlPct >= 0 ? "#166534" : "#991b1b", fontWeight: 600 }}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: t.pnlDollars >= 0 ? "#166534" : "#991b1b", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.pnlDollars >= 0 ? "+" : ""}{money(t.pnlDollars, t.currency)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 10.5, color: "var(--sa-muted)" }}>{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 10.5, color: "var(--sa-muted)", background: "var(--sa-panel-2)", padding: "8px 10px", borderRadius: 6 }}>
            ⚠ {result.disclaimer}
          </div>
        </div>
      )}
    </div>
  );
}

// SEC Form 4 insider cluster signals — daily-cron-detected clusters of
// insider buys/sells across held tickers + starred watchlist. Backend
// route: GET /api/stocks-insider-signals/recent.
function InsiderSignalsCard({ sessionToken }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);

  const load = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-insider-signals/recent?days=${days}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setErr(e?.message || "Load failed"); }
    finally { setBusy(false); }
  };

  const signals = (data?.signals || []).slice().sort((a, b) => (b.strength || 0) - (a.strength || 0));
  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🕵 Insider signals (SEC Form 4)</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3, maxWidth: 780 }}>
            Cluster BUY / SELL patterns detected across your holdings + starred watchlist. A cluster BUY (≥ 3 insiders, exec-weighted score ≥ 5) is a well-documented positive forward signal. Data comes from a nightly EDGAR sync; click a row to open the SEC filing.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Lookback (days)</div>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={1} max={90} style={{ width: 110, padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <button className="sa-btn" onClick={load} disabled={busy}>{busy ? "Loading…" : "Load signals"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}
      {data && !err && signals.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)" }}>
          No cluster signals in the last {data.days}d across {data.tickers?.length || 0} tracked tickers. The nightly sync (03:00 ET) refills.
        </div>
      )}

      {signals.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--sa-muted)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Ticker</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Kind</th>
                <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Score</th>
                <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Insiders</th>
                <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Shares</th>
                <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Value USD</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Detected</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const isBuy = s.kind === "cluster_buy";
                const secUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4&dateb=&owner=include&count=20&CIK=${encodeURIComponent(s.ticker)}`;
                return (
                  <tr key={s._id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>
                      <a href={secUrl} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", textDecoration: "none" }}>{s.ticker} ↗</a>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ background: isBuy ? "#dcfce7" : "#fee2e2", color: isBuy ? "#065f46" : "#991b1b", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                        {isBuy ? "🔥 BUY" : "⚠ SELL"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{s.strength}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.uniqueInsiderCount}{s.execCount > 0 ? ` (${s.execCount} exec)` : ""}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.totalSharesTraded?.toLocaleString?.() ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {s.totalValueUsd
                        ? s.totalValueUsd >= 1e6
                          ? `$${(s.totalValueUsd / 1e6).toFixed(2)}M`
                          : `$${Math.round(s.totalValueUsd / 1000)}k`
                        : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--sa-muted)" }}>
                      {new Date(s.detectedAt).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Persisted options-flow signals across held + starred tickers. Signals
// are generated by the daily-briefing scanner (UW-primary + Yahoo-
// fallback); this card just reads recent rows via
// GET /api/stocks-options-flow/recent.
function OptionsFlowCard({ sessionToken }) {
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);

  const load = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-options-flow/recent?days=${days}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setErr(e?.message || "Load failed"); }
    finally { setBusy(false); }
  };

  const signals = data?.signals || [];
  const labelFor = (t) => ({
    sweep_bullish: "🟢 Bullish sweep",
    sweep_bearish: "🔴 Bearish sweep",
    put_call_extreme: "P/C extreme",
    unusual_call_volume: "⚡ Unusual volume",
    iv_compression: "💤 IV crush",
  })[t] || t;
  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>📊 Options flow</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3, maxWidth: 780 }}>
            Recent unusual options activity across your holdings + starred watchlist. Sourced from Unusual Whales when a subscription is present (UNUSUAL_WHALES_API_KEY), otherwise from a free Yahoo-chain heuristic. Corroborating signal only — combine with fundamentals + technicals + sector rotation before acting.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Lookback (days)</div>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={1} max={30} style={{ width: 110, padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <button className="sa-btn" onClick={load} disabled={busy}>{busy ? "Loading…" : "Load signals"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}
      {data && !err && signals.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)" }}>
          No options-flow signals in the last {data.days}d across {data.tickers?.length || 0} tracked tickers. The daily briefing scanner refills these.
        </div>
      )}

      {signals.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--sa-muted)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Ticker</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Signal</th>
                <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Strength</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Source</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Detail</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--sa-border)" }}>Detected</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                let detail = "";
                if (s.signalType === "sweep_bullish" || s.signalType === "sweep_bearish") {
                  const n = s.meta?.notionalUsd || 0;
                  detail = `$${Math.round(n / 1000)}k · ${s.meta?.optionType || ""} · ${s.meta?.expiration || ""}`;
                } else if (s.signalType === "put_call_extreme") {
                  const r = s.meta?.callPutDollarRatio;
                  detail = Number.isFinite(r)
                    ? (r >= 1 ? `${r.toFixed(1)}× call$` : `${(1 / r).toFixed(1)}× put$`)
                    : "";
                } else if (s.signalType === "unusual_call_volume") {
                  const top = s.meta?.strikes?.[0];
                  detail = top ? `${top.side?.toUpperCase()} $${top.strike} vol ${top.volume?.toLocaleString?.() || top.volume}` : "";
                }
                return (
                  <tr key={s._id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{s.ticker}</td>
                    <td style={{ padding: "6px 8px" }}>{labelFor(s.signalType)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{s.strength}</td>
                    <td style={{ padding: "6px 8px", fontSize: 11 }}>
                      <span style={{ background: s.source === "uw" ? "#dbeafe" : "#fef3c7", color: s.source === "uw" ? "#1e40af" : "#78350f", padding: "2px 7px", borderRadius: 99, fontWeight: 600 }}>
                        {s.source?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 12 }}>{detail}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--sa-muted)" }}>
                      {s.detectedAt ? new Date(s.detectedAt).toISOString().slice(0, 10) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Pass A discipline backtest — takes the user's current portfolio and
// runs it back through N years of Yahoo history under three scenarios:
// buy-and-hold, trailing-stop-cash, trailing-stop-redeploy. Plus XEQT
// benchmark. Answers "did the discipline layer save/cost me money on
// this exact book vs doing nothing?"
function DisciplineBacktestCard({ sessionToken }) {
  const [years, setYears] = useState(5);
  const [trailStopPct, setTrailStopPct] = useState(20);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const q = new URLSearchParams({
        years: String(years),
        trailStopPct: String(trailStopPct / 100),
      });
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/backtest-discipline?${q.toString()}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) { setErr(e?.message || "Backtest failed"); }
    finally { setBusy(false); }
  };

  const money = (v) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
  const pct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const rows = result?.scenarios ? [
    { key: "hold", label: "Buy-and-hold", desc: result.scenarios.hold?.description, sum: result.scenarios.hold?.summary },
    { key: "stops", label: "Trailing stops → cash", desc: result.scenarios.stops?.description, sum: result.scenarios.stops?.summary, events: result.scenarios.stops?.stopEventCount },
    { key: "redeploy", label: "Trailing stops → redeploy to index", desc: result.scenarios.redeploy?.description, sum: result.scenarios.redeploy?.summary, events: result.scenarios.redeploy?.redeployEventCount },
    { key: "benchmark", label: `100% ${result.inputs?.benchmarkTicker || "XEQT.TO"} (benchmark)`, desc: result.scenarios.benchmark?.description, sum: result.scenarios.benchmark?.summary },
  ] : [];

  // Best CAGR wins the "recommended" badge
  const bestCagr = rows.reduce((best, r) => (r.sum?.cagrPct ?? -Infinity) > (best?.cagrPct ?? -Infinity) ? r.sum : best, null);

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🧪 Discipline framework backtest (Pass A)</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3, maxWidth: 780 }}>
            Takes your <b>current portfolio</b> and simulates 3 scenarios over the last N years: pure buy-and-hold vs a trailing-stop discipline (cash on exit) vs discipline with proceeds redeployed to an index. Plus XEQT benchmark. Isolates whether the discipline layer helps or hurts on your actual book. <b>Does NOT backtest AI advice</b> — that would be data-leaked.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Lookback (years)</div>
          <input type="number" value={years} onChange={(e) => setYears(Number(e.target.value))} min={1} max={10} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 11 }}>
          <div style={{ color: "var(--sa-muted)", marginBottom: 2 }}>Trailing stop (% from peak)</div>
          <input type="number" value={trailStopPct} onChange={(e) => setTrailStopPct(Number(e.target.value))} min={5} max={50} step={1} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--sa-border)", borderRadius: 6, fontSize: 13 }} />
        </label>
        <button className="sa-btn" onClick={run} disabled={busy}>{busy ? "Running…" : "Run backtest"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}

      {result?.error && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)", background: "var(--sa-panel-2)", borderRadius: 8, padding: "10px 12px" }}>
          {result.error}
          {result.missingTickers?.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12 }}>Missing history for: {result.missingTickers.join(", ")}</div>
          )}
        </div>
      )}

      {result?.scenarios && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginBottom: 8 }}>
            Window: <b>{result.inputs.startDate}</b> → <b>{result.inputs.endDate}</b> · {result.inputs.positionCount} positions · FX ${result.inputs.fxUsdCad}/USD
            {result.inputs.tickersMissingHistory?.length > 0 && (
              <span style={{ color: "#b45309" }}> · Skipped (no history): {result.inputs.tickersMissingHistory.join(", ")}</span>
            )}
          </div>

          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ color: "var(--sa-muted)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", fontWeight: 500, borderBottom: "1px solid var(--sa-border)" }}>Scenario</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Start</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>End</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Total return</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>CAGR</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Max DD</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right", borderBottom: "1px solid var(--sa-border)" }}>Stops</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isBest = r.sum && bestCagr && Math.abs(r.sum.cagrPct - bestCagr.cagrPct) < 0.01;
                return (
                  <tr key={r.key} style={{ borderBottom: "1px solid #f1f5f9", background: isBest ? "#ecfdf5" : undefined }}>
                    <td style={{ padding: "8px", fontWeight: 600 }}>
                      {r.label}{isBest && <span style={{ marginLeft: 6, background: "#059669", color: "#fff", fontSize: 10, padding: "2px 6px", borderRadius: 999, verticalAlign: "middle" }}>BEST</span>}
                      <div style={{ fontSize: 11, color: "var(--sa-muted)", fontWeight: 400, marginTop: 2 }}>{r.desc}</div>
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.sum?.startValueCad)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(r.sum?.endValueCad)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.sum?.totalReturnPct ?? 0) >= 0 ? "#166534" : "#991b1b" }}>{pct(r.sum?.totalReturnPct)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.sum?.cagrPct ?? 0) >= 0 ? "#166534" : "#991b1b", fontWeight: 700 }}>{pct(r.sum?.cagrPct)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>{pct(r.sum?.maxDrawdownPct)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.events ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.scenarios.stops?.stopEvents?.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--sa-muted)" }}>{result.scenarios.stops.stopEvents.length} stop events triggered — see individual exits</summary>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}>
                <thead>
                  <tr style={{ color: "var(--sa-muted)", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px" }}>Ticker</th>
                    <th style={{ padding: "4px 8px" }}>Exit date</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Peak</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Exit</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Drawdown</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Proceeds</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.stops.stopEvents.map((e, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>{e.ticker}</td>
                      <td style={{ padding: "4px 8px" }}>{e.exitDate}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${e.peakPrice?.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${e.exitPrice?.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#991b1b" }}>{e.drawdownFromPeakPct?.toFixed(1)}%</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${Math.round(e.proceedsCad).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <div style={{ marginTop: 14, fontSize: 12, color: "var(--sa-muted)", background: "#fef3c7", border: "1px solid #fcd34d", padding: "10px 12px", borderRadius: 8 }}>
            <b>Honest caveat:</b> This tests the DISCIPLINE FRAMEWORK only. The AI-advice layer is not backtested — today's Claude already knows what happened historically, so any "AI backtest" would be data-leaked. To measure AI-advice quality, use the Advice Scorecard which runs forward from today.
          </div>
        </div>
      )}
    </div>
  );
}

function TradeJournalAnalysisCard({ sessionToken }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/trade-journal/analyze`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) { setErr(e?.message || "Analysis failed"); }
    finally { setBusy(false); }
  };

  const a = result?.analysis;
  const r = result?.rollups;

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>🧠 Trade journal pattern learning</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            AI reads your closed trades and finds YOUR specific winning + losing patterns. Personal edge, nothing generic. Needs ≥5 closed round-trips (FIFO-paired BUY/SELL legs).
          </div>
        </div>
        <button className="sa-btn" onClick={run} disabled={busy}>{busy ? "Analyzing…" : "Run analysis"}</button>
      </div>

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}
      {result && !result.ok && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sa-muted)", background: "var(--sa-panel-2)", borderRadius: 8, padding: "10px 12px" }}>
          {result.reason}
        </div>
      )}
      {result?.ok && (
        <div style={{ marginTop: 14 }}>
          {r && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
              {[
                { label: "Closed trades", v: r.totalTrades },
                { label: "Win rate", v: `${r.winRate.toFixed(0)}%` },
                { label: "Avg winner", v: `+${r.avgWinnerPct.toFixed(1)}%`, color: "#166534" },
                { label: "Avg loser", v: `${r.avgLoserPct.toFixed(1)}%`, color: "#991b1b" },
                { label: "Avg hold", v: `${r.avgHoldDays.toFixed(0)}d` },
                { label: "Net $", v: `${r.netDollarsTotal >= 0 ? "+" : ""}$${r.netDollarsTotal.toFixed(0)}`, color: r.netDollarsTotal >= 0 ? "#166534" : "#991b1b" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: s.color || "inherit" }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}

          {a?.personalEdgeSummary && (
            <div style={{ fontSize: 13, lineHeight: 1.55, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#1e40af", marginBottom: 4 }}>💎 Your edge</div>
              {a.personalEdgeSummary}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {a?.winningPatterns?.length > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#166534", marginBottom: 6 }}>✓ Winning patterns</div>
                {a.winningPatterns.map((p, i) => <div key={i} style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>· {p}</div>)}
              </div>
            )}
            {a?.losingPatterns?.length > 0 && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#991b1b", marginBottom: 6 }}>✗ Losing patterns</div>
                {a.losingPatterns.map((p, i) => <div key={i} style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>· {p}</div>)}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {a?.hiddenStrength && (
              <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#6d28d9", marginBottom: 4 }}>🔎 Hidden strength</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{a.hiddenStrength}</div>
              </div>
            )}
            {a?.hiddenWeakness && (
              <div style={{ background: "#fefce8", border: "1px solid #fef08a", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#a16207", marginBottom: 4 }}>💧 Hidden leak</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{a.hiddenWeakness}</div>
              </div>
            )}
          </div>

          {a?.concreteRecommendations?.length > 0 && (
            <div style={{ background: "var(--sa-panel-2)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", marginBottom: 6 }}>📋 Concrete rule changes</div>
              {a.concreteRecommendations.map((rec, i) => <div key={i} style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{i + 1}. {rec}</div>)}
            </div>
          )}

          {r?.byHoldBand?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--sa-muted)", marginBottom: 6 }}>Win rate by hold length</div>
              {r.byHoldBand.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "3px 0" }}>
                  <span style={{ minWidth: 180 }}>{b.band}</span>
                  <span>{b.count} trades</span>
                  <span style={{ color: b.winRate >= 60 ? "#166534" : b.winRate < 40 ? "#991b1b" : "inherit" }}>{b.winRate?.toFixed(0)}% win</span>
                  <span style={{ color: b.avgGainPct >= 0 ? "#166534" : "#991b1b" }}>avg {b.avgGainPct >= 0 ? "+" : ""}{b.avgGainPct?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--sa-muted)", textAlign: "right" }}>
            Analyzed {result.closedTradesCount} closed round-trips at {new Date(result.analyzedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function EightKFeedCard({ sessionToken }) {
  const [items, setItems] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/eightk-feed`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (r.ok) { setItems(j.items || []); setTracked(j.trackedTickers || []); }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [sessionToken]);

  const pollNow = async () => {
    if (polling) return;
    setPolling(true); setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/eightk-poll-now`, {
        method: "POST", credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setMsg({ ok: true, text: `Polled ${j.tickersChecked} tickers · ${j.newFilings} new filings · ${j.emails} emails sent` });
      load();
    } catch (e) { setMsg({ ok: false, text: e?.message || "Poll failed" }); }
    finally { setPolling(false); }
  };

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>📄 SEC 8-K feed <span style={{ fontSize: 11, color: "var(--sa-muted)", fontWeight: 400 }}>(last 30d, {tracked.length} tickers tracked)</span></h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Real-time material events (M&A, earnings, exec changes, restatements, bankruptcies) for your portfolio + alert tickers. High-signal items email you within ~15 min of filing.
          </div>
        </div>
        <button className="sa-btn ghost" onClick={pollNow} disabled={polling}>{polling ? "Polling…" : "Poll now"}</button>
      </div>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12.5, background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`, color: msg.ok ? "#166534" : "#991b1b", borderRadius: 8, padding: "8px 10px" }}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--sa-muted)" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--sa-muted)" }}>
          {tracked.length === 0
            ? "No tracked tickers — add positions or alerts, then filings will appear here."
            : "No 8-K filings in last 30 days for tracked tickers. Click Poll now to check."}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {items.map((f) => (
            <div key={f._id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 6, background: f.highSignal ? "#fef3c7" : "var(--sa-panel-2)", fontSize: 12.5, marginBottom: 5 }}>
              <b style={{ minWidth: 60 }}>{f.ticker}</b>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {f.highSignal && <span style={{ color: "#92400e", marginRight: 6 }}>⚡</span>}
                  {(f.itemLabels || []).slice(0, 2).join(" · ")}{(f.itemLabels || []).length > 2 ? ` +${f.itemLabels.length - 2} more` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--sa-muted)", marginTop: 2 }}>
                  Items {(f.itemNumbers || []).join(", ")} · {new Date(f.filedAt).toLocaleString()}
                </div>
              </div>
              {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="sa-btn ghost" style={{ padding: "2px 8px", fontSize: 11 }}>SEC filing →</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefingDiagnosticsCard({ sessionToken }) {
  const [busy, setBusy] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [anthropicBusy, setAnthropicBusy] = useState(false);
  const [anthropicResult, setAnthropicResult] = useState(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setData(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/briefing-diagnostics`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setErr(e?.message || "Diagnostics failed");
    } finally { setBusy(false); }
  };

  const triggerNow = async () => {
    if (triggering) return;
    setTriggering(true); setTriggerMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/trigger-briefing-now`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setTriggerMsg(j.note || "Send triggered. Wait ~90s then click Run diagnostics.");
    } catch (e) {
      setTriggerMsg(`Trigger failed: ${e?.message || "network"}`);
    } finally { setTriggering(false); }
  };

  const checkAnthropic = async () => {
    if (anthropicBusy) return;
    setAnthropicBusy(true); setAnthropicResult(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/check-anthropic`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      setAnthropicResult(j);
    } catch (e) {
      setAnthropicResult({ ok: false, diagnostic: `Network error: ${e?.message || e}` });
    } finally { setAnthropicBusy(false); }
  };

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Briefing diagnostics</h3>
          <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 3 }}>
            Not receiving daily briefing emails? Run this — it checks every link in the chain (cron flag, Resend key, portfolio config, scheduling match, idempotency, recent successful sends).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="sa-btn" onClick={run} disabled={busy}>
            {busy ? "Checking…" : "Run diagnostics"}
          </button>
          <button className="sa-btn secondary" onClick={triggerNow} disabled={triggering} title="Force-fire a real briefing send now, off-schedule. If it works you get an email; if not, the failure appears in diagnostics.">
            {triggering ? "Triggering…" : "Force-send now"}
          </button>
          <button className="sa-btn secondary" onClick={checkAnthropic} disabled={anthropicBusy} title="Ping Anthropic with the deployed ANTHROPIC_API_KEY and show exactly what the server sees. Diagnoses 'low credit balance' errors by revealing which key/account is actually being used.">
            {anthropicBusy ? "Pinging Anthropic…" : "Check Anthropic key"}
          </button>
        </div>
      </div>

      {anthropicResult && (
        <div style={{ marginTop: 12, fontSize: 12.5, background: anthropicResult.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${anthropicResult.ok ? "#bbf7d0" : "#fecaca"}`, color: anthropicResult.ok ? "#166534" : "#991b1b", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{anthropicResult.diagnostic || (anthropicResult.ok ? "OK" : "Failed")}</div>
          <div style={{ fontFamily: "SF Mono,Menlo,Consolas,monospace", fontSize: 11.5, lineHeight: 1.55, color: anthropicResult.ok ? "#14532d" : "#7f1d1d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {`status: ${anthropicResult.status ?? "—"}\nelapsed: ${anthropicResult.elapsedMs ?? "—"}ms\nkey prefix (match this in Anthropic Console → API Keys): ${anthropicResult.keyPrefix ?? "—"}\nerror.type: ${anthropicResult.errorType ?? "—"}\nerror.message: ${anthropicResult.errorMessage ?? "—"}\n\nraw response body:\n${anthropicResult.rawBody ?? ""}`}
          </div>
        </div>
      )}

      {triggerMsg && (
        <div style={{ marginTop: 10, fontSize: 12.5, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 8, padding: "10px 12px" }}>
          {triggerMsg}
        </div>
      )}

      {err && <div className="sa-err" style={{ marginTop: 12 }}>{err}</div>}

      {data && (
        <div style={{ marginTop: 14 }}>
          {Array.isArray(data.summary) && data.summary.length > 0 ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
              <b>{data.summary.length} failing check{data.summary.length === 1 ? "" : "s"}:</b> {data.summary.join(" · ")}
            </div>
          ) : (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
              ✓ All chain checks pass. If briefings still aren't arriving, look at Resend logs (delivery/bounce/spam) — the sending pipeline itself is healthy.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {(data.checks || []).map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: c.ok ? "var(--sa-green)" : "var(--sa-red)", minWidth: 14 }}>{c.ok ? "✓" : "✗"}</span>
                <div style={{ flex: 1 }}>
                  <div>{c.name}</div>
                  {c.note && <div style={{ fontSize: 12, color: "var(--sa-muted)", marginTop: 2 }}>{c.note}</div>}
                </div>
              </div>
            ))}
          </div>

          {data.lastBriefingError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>🔥 Last send failed at stage: {data.lastBriefingError.stage || "(unknown)"}</div>
              <div style={{ fontSize: 12 }}>{data.lastBriefingError.message}</div>
              {data.lastBriefingError.at && <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 4 }}>at {new Date(data.lastBriefingError.at).toLocaleString()}</div>}
            </div>
          )}

          <div style={{ fontSize: 11, color: "var(--sa-muted)", background: "var(--sa-panel-2)", padding: "8px 10px", borderRadius: 6, fontFamily: "SF Mono,Menlo,Consolas,monospace", lineHeight: 1.6 }}>
            <div>current time in {data.briefingTz}: <b>{data.currentTimeInTz}</b> · date {data.currentDateInTz}</div>
            <div>your briefingTimes: <b>[{(data.briefingTimes || []).join(", ") || "empty"}]</b></div>
            <div>would be due right now: <b>{data.wouldBeDueNow ? "yes" : "no"}</b> · lastBriefingSentKey: <b>{data.lastBriefingSentKey || "(never)"}</b></div>
            <div>last successful send: <b>{data.lastBriefingSuccessAt ? new Date(data.lastBriefingSuccessAt).toLocaleString() : "(never)"}</b></div>
            <div>last attempt (function entered): <b>{data.lastBriefingAttemptAt ? new Date(data.lastBriefingAttemptAt).toLocaleString() : "(never)"}</b>{data.lastBriefingAttemptKey ? ` · key=${data.lastBriefingAttemptKey}` : ""}</div>
            <div>cron heartbeat: <b>{data.cronHeartbeat?.lastTickAt ? new Date(data.cronHeartbeat.lastTickAt).toLocaleString() : "(no heartbeat yet)"}</b> · last tick due-count: <b>{data.cronHeartbeat?.lastTickDueCount ?? "—"}</b></div>
            <div>latest snapshot (source={data.latestSnapshotSource || "—"}): <b>{data.latestCronSnapshot ? new Date(data.latestCronSnapshot).toLocaleString() : (data.latestOnDemandSnapshot ? new Date(data.latestOnDemandSnapshot).toLocaleString() : "(none)")}</b></div>
            <div>AI recs generated (last 7d): <b>{data.recentRecCount7d}</b></div>
            <div>env: STOCKS_BRIEFING_ENABLED=<b>{String(data.env?.STOCKS_BRIEFING_ENABLED)}</b> · RESEND_API_KEY=<b>{data.env?.RESEND_API_KEY_present ? "present" : "MISSING"}</b></div>
            <div>from: <b>{data.env?.STOCKS_BRIEFING_FROM}</b></div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataStatusPanel({ data, sessionToken }) {
  if (!data) return null;
  const fmtDate = (d) => d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const rows = [
    {
      label: "AI advice recs",
      count: data.adviceRecs?.total ?? 0,
      detail: data.adviceRecs?.total
        ? `${data.adviceRecs.last7d} in last 7d · ${data.adviceRecs.last30d} in 30d · ${data.adviceRecs.last90d} in 90d`
        : null,
      hint: !data.adviceRecs?.total
        ? "Zero recs parsed from any briefing so far. Click 🔬 Diagnose parsing below to see what format the AI is emitting — most likely a missing <RECS> JSON block (fixed 2026-07-15; next briefing should populate)."
        : data.adviceRecs.last7d === 0
        ? `${data.adviceRecs.total} recs exist but none in the last 7 days. Switch the scorecard window to 30d/90d, or run Update Advice now.`
        : null,
      action: !data.adviceRecs?.total ? "diagnose-parsing" : null,
    },
    {
      label: "Portfolio snapshots",
      count: data.snapshots?.total ?? 0,
      detail: data.snapshots?.total
        ? `oldest ${fmtDate(data.snapshots.oldest)} → newest ${fmtDate(data.snapshots.newest)}`
        : null,
      hint: !data.snapshots?.total
        ? "Snapshots write on every portfolio PUT. Save any change in Settings or add a trade — one snapshot fires per save. After a few saves the 12-month chart starts plotting."
        : null,
    },
    {
      label: "Discovery candidates",
      count: data.discoveryCandidates?.total ?? 0,
      detail: data.discoveryCandidates?.total
        ? `oldest ${fmtDate(data.discoveryCandidates.oldest)} · ${data.discoveryCandidates.oldEnoughForScoring} old enough (>7d) for scoring`
        : null,
      hint: !data.discoveryCandidates?.total
        ? "Click 🔍 Scan on the Discover tab. With FMP Premium active, each scan saves 8 candidates."
        : data.discoveryCandidates.oldEnoughForScoring === 0
        ? "Have candidates but none older than 7 days yet — the scorecard needs aged data. Check back in a week."
        : null,
    },
    {
      label: "Trade journal entries",
      count: data.trades?.total ?? 0,
      detail: data.trades?.total ? `newest ${fmtDate(data.trades.newest)}` : null,
      hint: !data.trades?.total
        ? "Record a trade on the Dashboard or Trades tab. Trades feed the 'Followed vs Skipped' scorecard split."
        : null,
    },
    {
      label: "Latest briefing snapshot",
      count: data.latestBriefingSnapshot ? 1 : 0,
      detail: data.latestBriefingSnapshot ? fmtDate(data.latestBriefingSnapshot) : null,
      hint: !data.latestBriefingSnapshot
        ? "Tomorrow's 7:30 AM cron will create one; or click 📧 Email Briefing → Preview now to generate on demand."
        : null,
    },
  ];

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: 0 }}>Data status</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        Hard counts of what's actually in the database for your account. If a section below shows "empty," this panel tells you why and what to do.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "grid", gridTemplateColumns: "auto 80px 1fr", gap: 12, alignItems: "baseline", padding: "8px 12px", background: r.count === 0 ? "var(--sa-amber-soft)" : "var(--sa-panel-2)", borderRadius: 6, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.count === 0 ? "var(--sa-amber)" : "var(--sa-text)" }}>{r.count}</span>
            <span style={{ fontSize: 12, color: "var(--sa-muted)", lineHeight: 1.5 }}>
              {r.detail}
              {r.detail && r.hint && <br />}
              {r.hint && <span style={{ color: "var(--sa-amber)" }}>💡 {r.hint}</span>}
            </span>
          </div>
        ))}
      </div>
      {rows.some((r) => r.action === "diagnose-parsing") && <RecParseDiagnostic sessionToken={sessionToken} />}
    </div>
  );
}

function RecParseDiagnostic({ sessionToken }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    if (busy || !sessionToken) return;
    setBusy(true); setErr(null); setData(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/rec-parse-diagnostic`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setErr(e?.message || "Diagnostic failed"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 12, padding: "10px 12px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "#78350f" }}>
          <b>🔬 Diagnose rec parsing</b> — reads the latest briefing and shows what the parser found, whether the AI emitted the required &lt;RECS&gt; block, and any lines that look actionable but weren't captured.
        </div>
        <button className="sa-btn" onClick={run} disabled={busy}>{busy ? "Running…" : "Run diagnostic"}</button>
      </div>
      {err && <div style={{ marginTop: 10, color: "#991b1b" }}>{err}</div>}
      {data && !data.ok && <div style={{ marginTop: 10, fontSize: 12 }}>{data.reason}</div>}
      {data?.ok && (
        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
          <div><b>Snapshot from:</b> {new Date(data.generatedAt).toLocaleString()} · markdown length {data.markdownLength.toLocaleString()} chars</div>
          <div><b>&lt;RECS&gt; block present:</b> {data.hasJsonBlock ? "✓ yes" : "✗ no"}</div>
          <div><b>Parsed:</b> {data.parsedCount} recs</div>
          <div style={{ marginTop: 6, color: "#78350f" }}>{data.hint}</div>
          {data.probableRecLines.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Lines with BUY/SELL/TRIM ({data.probableRecLines.length})</summary>
              <div style={{ marginTop: 6, background: "#fff", padding: "6px 8px", borderRadius: 4, fontFamily: "SF Mono,Menlo,Consolas,monospace", fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
                {data.probableRecLines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </details>
          )}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Last 2500 chars of briefing (looking for &lt;RECS&gt; block)</summary>
            <div style={{ marginTop: 6, background: "#fff", padding: "6px 8px", borderRadius: 4, fontFamily: "SF Mono,Menlo,Consolas,monospace", fontSize: 10.5, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}>
              {data.markdownTail}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// Trades-activity summary — works off the existing trade journal so it
// surfaces real performance data even before any AI rec is tracked.
function TradesActivityCard({ trades }) {
  if (trades == null) {
    return (
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>Trades activity</h3>
        <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>
      </div>
    );
  }
  if (!trades.length) {
    return (
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>Trades activity</h3>
        <div className="sa-muted" style={{ padding: 14, fontSize: 13 }}>No trades recorded yet. Record one on the Dashboard or Trades tab.</div>
      </div>
    );
  }
  const now = Date.now();
  const windows = [["7d", 7], ["30d", 30], ["90d", 90], ["1y", 365]];
  const fmt = (n) => (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const tickerCounts = {};
  let mostRecent = null;
  for (const t of trades) {
    const ts = new Date(t.executedAt).getTime();
    if (!mostRecent || ts > mostRecent) mostRecent = ts;
    for (const l of t.legs || []) {
      if (!l.ticker) continue;
      tickerCounts[l.ticker] = (tickerCounts[l.ticker] || 0) + 1;
    }
  }
  const stats = windows.map(([label, days]) => {
    const since = now - days * 86400 * 1000;
    const inW = trades.filter((t) => new Date(t.executedAt).getTime() >= since);
    let net = 0, gross = 0;
    for (const t of inW) {
      net += Number(t.netCashCad) || 0;
      for (const l of t.legs || []) {
        const g = Number(l.grossValue) || 0;
        const fx = (l.currency === "USD" ? (t.fxUsdCadAtTrade || 1.37) : 1);
        gross += g * fx;
      }
    }
    return { label, count: inW.length, net, gross };
  });
  const top = Object.entries(tickerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const last = new Date(mostRecent).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const color = (n) => n == null ? "var(--sa-muted)" : (n >= 0 ? "var(--sa-green)" : "var(--sa-red)");
  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: 0 }}>Trades activity</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        {trades.length} trade{trades.length === 1 ? "" : "s"} on file · most recent {last}. Net cash flow is the sum of journaled SELL/DEPOSIT minus BUY/WITHDRAW per window (CAD-normalised).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
        {stats.map((s) => (
          <div key={s.label} className="sa-stat">
            <div className="label">{s.label}</div>
            <div className="value" style={{ color: color(s.net) }}><span className="sa-amount">{s.count > 0 ? fmt(s.net) : "—"}</span></div>
            <div className="delta muted">{s.count} trade{s.count === 1 ? "" : "s"} · gross <span className="sa-amount">${Math.round(s.gross).toLocaleString()}</span></div>
          </div>
        ))}
      </div>
      {top.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--sa-muted)" }}>
          Most-traded (1y): {top.map(([t, n]) => <span key={t} style={{ marginRight: 12 }}><b style={{ color: "var(--sa-text-2)" }}>{t}</b> ×{n}</span>)}
        </div>
      )}
    </div>
  );
}

// Setup expectancy scorecard — aggregates every CLOSED daily pick by
// setupName (bull flag, pocket pivot, VCP, coiled spring, etc.) and
// reports the honest ex-ante edge per setup. Answers the trader's real
// question: "which setups deserve more capital and which should I
// retire?" Only closed picks (target/stop/horizon-exit) count — no
// mark-to-market inflation on positions that haven't paid out.
function SetupScorecardCard({ data, sessionToken, onLoad }) {
  const [days, setDays] = useState(365);
  const [minSample, setMinSample] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/stocks-portfolio/setup-scorecard?days=${days}&min=${minSample}`,
          { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (!cancelled) onLoad?.(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "load failed");
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days, minSample, onLoad]);

  const fmtPct = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const cellPnl = (n) => ({
    color: n == null ? "var(--sa-muted)" : n > 0 ? "var(--sa-green)" : n < 0 ? "#b91c1c" : "inherit",
    fontVariantNumeric: "tabular-nums",
  });

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3>Setup scorecard — which setups actually generate edge</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Every CLOSED daily pick (target-hit / stop-hit / horizon-exit) grouped by named setup. Expectancy = <code>P(win) × avg win + P(loss) × avg loss</code>. Rows with fewer than the minimum sample size are hidden as noise. This is the honest ex-ante edge test — no cherry-picking, no mark-to-market on open positions.
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>Window:{" "}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} style={{ fontSize: 12 }}>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
            <option value={365}>1y</option>
            <option value={730}>2y</option>
            <option value={1825}>5y</option>
          </select>
        </label>
        <label>Min sample:{" "}
          <select value={minSample} onChange={(e) => setMinSample(parseInt(e.target.value, 10))} style={{ fontSize: 12 }}>
            <option value={1}>1</option>
            <option value={3}>3 (default)</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
          </select>
        </label>
        {data?.totalClosedPicks != null && (
          <span className="sa-muted">
            {data.totalClosedPicks} closed picks in the {days}d window · {data.setups?.length || 0} setup{data.setups?.length === 1 ? "" : "s"} shown
          </span>
        )}
      </div>
      {busy && <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>}
      {err && <div className="sa-err" style={{ fontSize: 12 }}>Failed to load: {err}</div>}
      {!busy && !err && data && (
        data.setups?.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, fontVariantNumeric: "tabular-nums", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 12 }}>
                  <th style={{ textAlign: "left", padding: "6px 10px" }}>Setup</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Trades</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Wins</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Win rate</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Avg gain</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Avg win</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Avg loss</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {data.setups.map((s) => (
                  <tr key={s.setupName} style={{ borderTop: "1px solid var(--sa-border)" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{s.setupName}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{s.trades}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{s.wins}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{s.winRatePct.toFixed(0)}%</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", ...cellPnl(s.avgGainPct) }}>{fmtPct(s.avgGainPct)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", ...cellPnl(s.avgWinPct) }}>{fmtPct(s.avgWinPct)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", ...cellPnl(s.avgLossPct) }}>{fmtPct(s.avgLossPct)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, ...cellPnl(s.expectancyPct) }}>{fmtPct(s.expectancyPct)}</td>
                  </tr>
                ))}
              </tbody>
              {data.overall && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--sa-border)", background: "var(--sa-panel-2)", fontSize: 12 }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>Overall (across all setups)</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{data.overall.trades}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>—</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{data.overall.winRatePct.toFixed(0)}%</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", ...cellPnl(data.overall.avgGainPct) }}>{fmtPct(data.overall.avgGainPct)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="sa-muted" style={{ padding: 20, fontSize: 13 }}>
            {data.totalClosedPicks === 0
              ? "No closed daily picks yet in this window — the setup scorecard needs picks that hit target, stop, or horizon-expire to compute an ex-ante edge. Come back once the daily-pick engine has cycled a few times."
              : `No setups yet with ≥ ${minSample} closed picks. Lower the Min sample filter to see smaller-sample rows, or expand the window.`}
          </div>
        )
      )}
    </div>
  );
}

// Sizing backtest — replays every closed daily pick under three sizing
// strategies (naive 100 sh, equal-risk 1%, vol-Kelly) and shows the
// end-book / return / drawdown side-by-side. Lets the trader see the
// sizing edge before betting real money on it. Backend fills in the
// approximations + caveats.
function SizingBacktestCard({ sessionToken }) {
  const [days, setDays] = useState(365);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/stocks-portfolio/sizing-backtest?days=${days}`,
          { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "load failed");
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days]);

  const fmtCad = (n) => n == null ? "—" : `$${Math.round(n).toLocaleString()} CAD`;
  const fmtPct = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const stratRow = (key, s) => {
    const isBest = data?.strategies && key === Object.keys(data.strategies).reduce((best, k) =>
      (data.strategies[k].totalReturnPct ?? -Infinity) > (data.strategies[best].totalReturnPct ?? -Infinity) ? k : best,
    Object.keys(data.strategies)[0]);
    return (
      <tr key={key} style={{ borderTop: "1px solid var(--sa-border)" }}>
        <td style={{ padding: "6px 10px", fontWeight: 600 }}>{s.label}{isBest && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--sa-green)" }}>★ best</span>}</td>
        <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCad(s.endBookCad)}</td>
        <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.totalReturnPct > 0 ? "var(--sa-green)" : s.totalReturnPct < 0 ? "#b91c1c" : "inherit" }}>{fmtPct(s.totalReturnPct)}</td>
        <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b91c1c" }}>-{s.maxDrawdownPct.toFixed(1)}%</td>
      </tr>
    );
  };

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3>Sizing backtest — would vol-Kelly actually beat the alternatives?</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Replays every CLOSED daily pick under three sizing strategies on the same starting book. If vol-Kelly wins on <b>end book</b> AND has a smaller <b>max drawdown</b>, the edge is real. If it only wins on end book but drags a worse drawdown, it's just leverage — decide whether you want that risk profile.
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>Window:{" "}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} style={{ fontSize: 12 }}>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
            <option value={365}>1y</option>
            <option value={730}>2y</option>
            <option value={1825}>5y</option>
          </select>
        </label>
        {data && (
          <span className="sa-muted">
            {data.totalClosedPicks} closed pick{data.totalClosedPicks === 1 ? "" : "s"} · start ${Math.round(data.startingBookCad).toLocaleString()} CAD
          </span>
        )}
      </div>
      {busy && <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>}
      {err && <div className="sa-err" style={{ fontSize: 12 }}>Failed to load: {err}</div>}
      {!busy && !err && data && (
        data.totalClosedPicks === 0 ? (
          <div className="sa-muted" style={{ padding: 20, fontSize: 13 }}>
            No closed daily picks in this window yet. Come back once the daily-pick engine has cycled a few times.
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 12 }}>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Strategy</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>End book</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Total return</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Max drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.strategies).map(([key, s]) => stratRow(key, s))}
                </tbody>
              </table>
            </div>
            <details style={{ marginTop: 12, fontSize: 11, color: "var(--sa-muted)" }}>
              <summary style={{ cursor: "pointer" }}>Caveats / approximations (click)</summary>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
                {data.caveats.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </details>
          </>
        )
      )}
    </div>
  );
}

// Trade Cost Analysis card — surfaces slippage by hour-of-day bucket
// so the trader can see if their market-at-open habit is quietly
// costing bps. Uses (H+L+C)/3 as a VWAP proxy on the day's OHLC.
function TcaCard({ sessionToken }) {
  const [days, setDays] = useState(365);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/stocks-portfolio/tca?days=${days}`,
          { credentials: "include", headers: { Authorization: `Bearer ${sessionToken}` } }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e?.message || "load failed");
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [sessionToken, days]);

  const bucketLabel = (b) => ({
    "pre-open": "Pre-market (< 09:30)",
    "open-30": "Open 30 min (09:30–09:59)",
    "mid-morn": "Mid-morn (10:00–10:59)",
    "midday": "Midday (11:00–14:59)",
    "close-hour": "Close hour (15:00–15:59)",
    "after-hours": "After-hours (≥ 16:00)",
    "unknown": "Unknown timestamp",
  }[b] || b);

  const fmtBps = (bps) => bps == null ? "—" : `${bps >= 0 ? "+" : ""}${bps.toFixed(1)} bps`;
  const bpsColor = (bps) => bps == null ? "inherit" : bps > 3 ? "#b91c1c" : bps > 0 ? "#78350f" : "var(--sa-green)";

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3>Trade cost analysis — are you losing bps to bad timing?</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        For every recorded trade, compares the fill price to that day's typical price ((H+L+C)/3) as a VWAP proxy. Bucketed by time-of-day in ET. Positive slippage = you paid too much on a BUY or sold too cheap on a SELL. Systematic red on the open-30 row is a common finding for retail — the fix is usually GTC limit orders inside 09:30-09:45.
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>Window:{" "}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} style={{ fontSize: 12 }}>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
            <option value={365}>1y</option>
            <option value={730}>2y</option>
          </select>
        </label>
        {data?.sampleSize != null && (
          <span className="sa-muted">
            {data.sampleSize} trades scored · {data.tickersFetched} tickers fetched
          </span>
        )}
      </div>
      {busy && <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>}
      {err && <div className="sa-err" style={{ fontSize: 12 }}>Failed to load: {err}</div>}
      {!busy && !err && data && (
        data.sampleSize === 0 ? (
          <div className="sa-muted" style={{ padding: 20, fontSize: 13 }}>
            No recorded trades in this window. Record trades on the Dashboard or Trades tab; TCA populates once at least one day of OHLC is available for each ticker.
          </div>
        ) : (
          <>
            {data.summary && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
                <div style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Avg slippage</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: bpsColor(data.summary.avgSlippageBps), fontVariantNumeric: "tabular-nums" }}>{fmtBps(data.summary.avgSlippageBps)}</div>
                </div>
                <div style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Median slippage</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: bpsColor(data.summary.medianSlippageBps), fontVariantNumeric: "tabular-nums" }}>{fmtBps(data.summary.medianSlippageBps)}</div>
                </div>
                <div style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Best bucket</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: "var(--sa-green)" }}>{bucketLabel(data.summary.bestBucket) || "—"}</div>
                </div>
                <div style={{ padding: "8px 10px", background: "var(--sa-panel-2)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "var(--sa-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Worst bucket</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: "#b91c1c" }}>{bucketLabel(data.summary.worstBucket) || "—"}</div>
                </div>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--sa-panel-2)", color: "var(--sa-muted)", fontSize: 12 }}>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Bucket</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Trades</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Avg slippage</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Median</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Min</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>Max</th>
                    <th style={{ textAlign: "right", padding: "6px 10px" }}>$ cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byBucket.map((b) => (
                    <tr key={b.bucket} style={{ borderTop: "1px solid var(--sa-border)" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{bucketLabel(b.bucket)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>{b.trades}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", color: bpsColor(b.avgSlippageBps), fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmtBps(b.avgSlippageBps)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtBps(b.medianSlippageBps)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--sa-muted)" }}>{fmtBps(b.minSlippageBps)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--sa-muted)" }}>{fmtBps(b.maxSlippageBps)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: b.totalSlippageDollars > 0 ? "#b91c1c" : "var(--sa-green)" }}>${Math.abs(Math.round(b.totalSlippageDollars)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sa-muted" style={{ fontSize: 11, marginTop: 8 }}>{data.caveat}</div>
          </>
        )
      )}
    </div>
  );
}

function DiscoveryScorecardCard({ data }) {
  if (!data) {
    return (
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>Discovery scorecard</h3>
        <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>
      </div>
    );
  }
  const fmtPct = (n) => n == null ? "—" : ((n >= 0 ? "+" : "") + n.toFixed(1) + "%");
  const colorPct = (n) => n == null ? "var(--sa-muted)" : (n >= 0 ? "var(--sa-green)" : "var(--sa-red)");

  if (data.scored === 0) {
    return (
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>Discovery scorecard</h3>
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 4 }}>Did the Discover engine actually find winners? Returns measured from priceAtDiscovery to today vs SPY for the same window.</div>
        <div className="sa-muted" style={{ padding: 20, textAlign: "center" }}>
          {data.total === 0
            ? "No discovery candidates yet. Click 🔍 Scan on the Discover tab."
            : `${data.total} candidate${data.total === 1 ? "" : "s"} on file but none old enough (>7 days) or scoreable.`}
        </div>
      </div>
    );
  }

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: 0 }}>Discovery scorecard</h3>
      <div className="sa-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 14 }}>
        Each past Discover candidate's % return from priceAtDiscovery to today, vs SPY over the same window. Honest performance check — most leads underperform; the question is whether the winners pay for the losers.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div className="sa-stat"><div className="label">Candidates scored</div><div className="value">{data.scored}</div><div className="delta muted">of {data.total} tracked</div></div>
        <div className="sa-stat"><div className="label">Avg return</div><div className="value" style={{ color: colorPct(data.avgReturnPct) }}><span className="sa-amount">{fmtPct(data.avgReturnPct)}</span></div><div className="delta muted">median <span className="sa-amount">{fmtPct(data.medianReturnPct)}</span></div></div>
        <div className="sa-stat"><div className="label">Hit rate (&gt;0%)</div><div className="value">{data.hitRatePct != null ? data.hitRatePct.toFixed(0) + "%" : "—"}</div><div className="delta muted">winners</div></div>
        <div className="sa-stat"><div className="label">vs SPY (alpha)</div><div className="value" style={{ color: colorPct(data.avgAlphaVsSpyPct) }}><span className="sa-amount">{fmtPct(data.avgAlphaVsSpyPct)}</span></div><div className="delta muted">avg per candidate</div></div>
        <div className="sa-stat"><div className="label">Beat SPY</div><div className="value">{data.benchmarkBeatRatePct != null ? data.benchmarkBeatRatePct.toFixed(0) + "%" : "—"}</div><div className="delta muted">of scored</div></div>
      </div>

      <table className="sa-table" style={{ marginBottom: 0 }}>
        <thead><tr>
          <th>Ticker</th>
          <th>Found</th>
          <th>At</th>
          <th>Now</th>
          <th>Return</th>
          <th>Peak</th>
          <th>SPY return</th>
          <th>Alpha</th>
          <th>Horizon outcomes</th>
          <th>Conv</th>
        </tr></thead>
        <tbody>
          {data.items.map((i) => {
            const horizons = [["30d", i.outcome30d], ["90d", i.outcome90d], ["180d", i.outcome180d], ["365d", i.outcome365d]]
              .filter(([, o]) => o && o.pct != null)
              .map(([lbl, o]) => `${lbl} ${fmtPct(o.pct)}`);
            return (
            <tr key={i._id}>
              <td className="tk">{i.starred && "★ "}{i.dismissed && "✕ "}{i.ticker}</td>
              <td className="sa-muted">{new Date(i.scanDate).toLocaleDateString([], { month: "short", day: "numeric" })} ({i.daysOld}d)</td>
              <td><span className="sa-amount">${i.priceAtDiscovery?.toFixed(2)}</span></td>
              <td><span className="sa-amount">${i.currentPrice?.toFixed(2)}</span></td>
              <td style={{ color: colorPct(i.returnPct), fontWeight: 600 }}><span className="sa-amount">{fmtPct(i.returnPct)}</span></td>
              <td style={{ color: colorPct(i.peakPct) }}><span className="sa-amount">{fmtPct(i.peakPct)}</span></td>
              <td style={{ color: colorPct(i.spyReturnPct) }}><span className="sa-amount">{fmtPct(i.spyReturnPct)}</span></td>
              <td style={{ color: colorPct(i.alphaPct), fontWeight: 600 }}><span className="sa-amount">{fmtPct(i.alphaPct)}</span></td>
              <td className="sa-muted" style={{ fontSize: 10.5 }}>{horizons.length ? horizons.join(" · ") : "—"}</td>
              <td className="sa-muted" style={{ fontSize: 11 }}>{i.conviction || "—"}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdviceScorecardCard({ scorecard, days, onChangeDays }) {
  if (!scorecard) {
    return (
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>Advice scorecard</h3>
        <div className="sa-muted" style={{ padding: 20 }}>Loading…</div>
      </div>
    );
  }
  const { summary, items } = scorecard;
  const fmt$ = (n) => (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fmtPct = (n) => n == null ? "—" : ((n >= 0 ? "+" : "") + n.toFixed(1) + "%");

  return (
    <div className="sa-card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>Advice scorecard</h3>
          <div className="sa-muted" style={{ fontSize: 12, marginTop: 2 }}>
            Followed = you executed the rec. Skipped = no matching trade. Outcomes mark-to-market.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => onChangeDays(d)}
              style={{
                padding: "5px 12px", fontSize: 12, fontWeight: 600,
                border: "none", borderRadius: 6, cursor: "pointer",
                background: days === d ? "var(--sa-accent)" : "transparent",
                color: days === d ? "#fff" : "var(--sa-text-2)",
              }}
            >{d === 365 ? "1y" : `${d}d`}</button>
          ))}
        </div>
      </div>

      {summary.total === 0 ? (
        <div className="sa-muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>
          No AI recommendations in the last {days} days. Click <b>🧠 Update Advice</b> on the Advice tab to start populating this.
        </div>
      ) : (
        <>
          {/* Top-line summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "var(--sa-panel-2)", padding: 12, borderRadius: 10 }}>
              <div className="sa-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>Follow rate</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.followRate.toFixed(0)}%</div>
              <div className="sa-muted" style={{ fontSize: 11 }}>{summary.followed} of {summary.total} recs</div>
            </div>
            <div style={{ background: "var(--sa-green-soft)", padding: 12, borderRadius: 10, border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: 11, color: "var(--sa-green)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>From followed</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: summary.netDollarsFromFollowed >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
                {summary.netDollarsFromFollowed === 0 ? "—" : fmt$(summary.netDollarsFromFollowed)}
              </div>
              <div className="sa-muted" style={{ fontSize: 11 }}>Avg: {fmtPct(summary.avgFollowedPnlPct)}</div>
            </div>
            <div style={{ background: "var(--sa-amber-soft)", padding: 12, borderRadius: 10, border: "1px solid #fde68a" }}>
              <div style={{ fontSize: 11, color: "var(--sa-amber)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>Skipped would-be</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: summary.netDollarsFromSkipped >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
                {summary.netDollarsFromSkipped === 0 ? "—" : fmt$(summary.netDollarsFromSkipped)}
              </div>
              <div className="sa-muted" style={{ fontSize: 11 }}>Avg: {fmtPct(summary.avgSkippedPnlPct)}</div>
            </div>
            <div style={{ background: "var(--sa-panel-2)", padding: 12, borderRadius: 10 }}>
              <div className="sa-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>Verdict</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                {(() => {
                  // Prefer the server-computed time-aware verdict when present;
                  // fall back to the old net-only labels for cold-start clients.
                  const v = summary.verdict;
                  if (v?.slug) {
                    const label = {
                      "too-early": "🕒 Too early to grade",
                      "mid-cycle-drawdown": "🟡 Mid-cycle drawdown",
                      "followed-outperforming": "✅ Your picks are winning",
                      "cohort-green": "🟢 Whole cohort profitable",
                      "adverse-selection": "⚠ Skipped winners, took losers",
                      "underperforming": "🔴 Underperforming signal",
                      "insufficient-data": "— Not enough data yet",
                    }[v.slug] || v.slug;
                    return label;
                  }
                  const f = summary.netDollarsFromFollowed;
                  const s = summary.netDollarsFromSkipped;
                  if (f > 0 && s < 0) return "✅ Good calls + good skips";
                  if (f > 0 && s > 0) return "🟢 Calls right, missed some";
                  if (f < 0 && s > 0) return "⚠️ Skipped winners, took losers";
                  if (f < 0 && s < 0) return "🟡 Whole cohort underwater";
                  return "—";
                })()}
              </div>
              {summary.verdict?.message && (
                <div style={{ fontSize: 11, color: "var(--sa-text-2)", marginTop: 6, lineHeight: 1.5 }}>{summary.verdict.message}</div>
              )}
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>{summary.skipped} skipped · {summary.followed} taken{Number.isFinite(summary.avgHorizonPctElapsed) && ` · avg ${summary.avgHorizonPctElapsed.toFixed(0)}% into horizon`}</div>
            </div>
          </div>

          {/* Positions taken from advice — acknowledges what the user actually did.
              Filters to followed recs and shows them with current status. */}
          {(() => {
            const taken = items.filter(i => i.followed).slice(0, 6);
            if (taken.length === 0) return null;
            return (
              <div style={{ marginTop: 14, marginBottom: 14, padding: "14px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#14532d", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
                  ✓ You took {summary.followed} of the last {summary.total} recs — positions on the board
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {taken.map((it) => {
                    const pnl = it.actualPnlPct;
                    const pnlColor = pnl == null ? "var(--sa-muted)" : pnl >= 0 ? "#166534" : "#991b1b";
                    return (
                      <div key={it.recId} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "6px 10px", background: "#fff", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12 }}>
                        <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: it.action === "BUY" ? "#dcfce7" : "#fee2e2", color: it.action === "BUY" ? "#14532d" : "#991b1b" }}>{it.action}</span>
                        <div>
                          <b>{it.ticker}</b> · fill ${it.tradeFillPrice?.toFixed?.(2)} → now ${it.currentPrice?.toFixed?.(2)}
                          {it.horizonDays && (
                            <span className="sa-muted" style={{ marginLeft: 8, fontSize: 11 }}>
                              day {it.daysElapsed} of {it.horizonDays} ({it.horizonPct?.toFixed?.(0)}%)
                            </span>
                          )}
                          {it.followedVia === "fuzzy-base-ticker" && <span className="sa-muted" style={{ marginLeft: 6, fontSize: 10, fontStyle: "italic" }}>· auto-linked</span>}
                        </div>
                        <div style={{ color: pnlColor, fontWeight: 700, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                          {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Per-rec table */}
          <div style={{ border: "1px solid var(--sa-border)", borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--sa-panel-2)" }}>
                  <th style={recHeaderCellLeft}>When</th>
                  <th style={recHeaderCellLeft}>Rec</th>
                  <th style={recHeaderCellLeft}>Status</th>
                  <th style={recHeaderCell}>Entry → Now</th>
                  <th style={recHeaderCell}>Hypo P&amp;L</th>
                  <th style={recHeaderCell}>If followed</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 50).map((it) => {
                  const sideColor =
                    it.action === "BUY" ? "var(--sa-green)" :
                    it.action === "SELL" || it.action === "TRIM" ? "var(--sa-red)" : "var(--sa-amber)";
                  const sideBg =
                    it.action === "BUY" ? "var(--sa-green-soft)" :
                    it.action === "SELL" || it.action === "TRIM" ? "var(--sa-red-soft)" : "var(--sa-amber-soft)";
                  const statusLabel =
                    it.status === "target-hit" ? "🎯 Target" :
                    it.status === "stop-hit" ? "🛑 Stop" :
                    it.status === "expired" ? "⏰ Expired" : "🟢 Open";
                  const followLabel = it.followed
                    ? <span style={{ color: "var(--sa-green)", fontWeight: 600 }}>✓ Followed</span>
                    : <span style={{ color: "var(--sa-muted)" }}>— Skipped</span>;
                  return (
                    <tr key={it.recId} style={{ borderTop: "1px solid var(--sa-border)" }}>
                      <td style={{ ...recCellLeft, color: "var(--sa-muted)" }}>{new Date(it.generatedAt).toLocaleDateString()}</td>
                      <td style={recCellLeft}>
                        <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: sideBg, color: sideColor, marginRight: 6 }}>{it.action}</span>
                        <b>{it.ticker}</b>
                        {it.shares ? <span style={{ color: "var(--sa-muted)" }}> · {it.shares} sh</span> : null}
                        {it.entryPrice ? <span style={{ color: "var(--sa-muted)" }}> · ${it.entryPrice.toFixed(2)}</span> : null}
                        <div style={{ fontSize: 11, marginTop: 2 }}>{followLabel}</div>
                      </td>
                      <td style={{ ...recCellLeft, color: it.status === "target-hit" ? "var(--sa-green)" : it.status === "stop-hit" ? "var(--sa-red)" : "var(--sa-text-2)", fontWeight: 500 }}>
                        {statusLabel}
                      </td>
                      <td style={recCell}>
                        {it.entryPrice && it.currentPrice
                          ? <>${it.entryPrice.toFixed(2)} → ${it.currentPrice.toFixed(2)}</>
                          : "—"}
                      </td>
                      <td style={{ ...recCell, color: it.hypoPnlPct == null ? "var(--sa-muted)" : (it.hypoPnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)"), fontWeight: 600 }}>
                        {fmtPct(it.hypoPnlPct)}
                      </td>
                      <td style={{ ...recCell, color: it.followed
                        ? (it.actualPnlPct == null ? "var(--sa-muted)" : it.actualPnlPct >= 0 ? "var(--sa-green)" : "var(--sa-red)")
                        : "var(--sa-muted)", fontWeight: 600 }}>
                        {it.followed
                          ? (it.actualPnlPct == null ? "—"
                              : <>{fmtPct(it.actualPnlPct)} <div style={{ fontSize: 10, fontWeight: 400 }}>{it.actualDollars != null ? fmt$(it.actualDollars) : ""}</div></>)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Inline SVG line chart — zero deps
function PortfolioChart({ snaps }) {
  const W = 720, H = 240, PADX = 40, PADY = 18;
  const vals = snaps.map((s) => s.totalCad);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const xStep = (W - PADX * 2) / Math.max(1, snaps.length - 1);

  const points = snaps.map((s, i) => {
    const x = PADX + i * xStep;
    const y = PADY + (1 - (s.totalCad - min) / range) * (H - PADY * 2);
    return [x, y];
  });

  const linePath = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const areaPath = linePath + ` L${points[points.length - 1][0]},${H - PADY} L${PADX},${H - PADY} Z`;

  const firstVal = snaps[0].totalCad;
  const lastVal = snaps[snaps.length - 1].totalCad;
  const totalChange = ((lastVal - firstVal) / firstVal) * 100;
  const totalChangeAbs = lastVal - firstVal;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700 }} className="sa-amount">${lastVal.toLocaleString(undefined, { maximumFractionDigits: 0 })} CAD</div>
          <div className="sa-muted" style={{ fontSize: 13 }}>Today</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: totalChange >= 0 ? "var(--sa-green)" : "var(--sa-red)" }} className="sa-amount">
            {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}%
          </div>
          <div className="sa-muted" style={{ fontSize: 12 }}>
            <span className="sa-amount">{totalChangeAbs >= 0 ? "+" : "−"}${Math.abs(totalChangeAbs).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> since first snapshot
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <defs>
          <linearGradient id="saGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(29,78,216,.18)" />
            <stop offset="100%" stopColor="rgba(29,78,216,0)" />
          </linearGradient>
        </defs>
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={PADX} x2={W - PADX} y1={PADY + t * (H - PADY * 2)} y2={PADY + t * (H - PADY * 2)} stroke="#e4e8ef" strokeWidth="1" />
        ))}
        <path d={areaPath} fill="url(#saGrad)" />
        <path d={linePath} fill="none" stroke="#1d4ed8" strokeWidth="2" strokeLinejoin="round" />
        {/* Endpoint dot */}
        {points.length > 0 && (
          <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="4" fill="#1d4ed8" />
        )}
        {/* Y-axis labels */}
        <text x="8" y={PADY + 4} fontSize="10" fill="#7a8499">${(max / 1000).toFixed(0)}K</text>
        <text x="8" y={H - PADY + 4} fontSize="10" fill="#7a8499">${(min / 1000).toFixed(0)}K</text>
        {/* X-axis (first + last dates) */}
        <text x={PADX} y={H - 2} fontSize="10" fill="#7a8499">{snaps[0].date}</text>
        <text x={W - PADX} y={H - 2} fontSize="10" fill="#7a8499" textAnchor="end">{snaps[snaps.length - 1].date}</text>
      </svg>
    </div>
  );
}

// =============================================================================
// All component CSS (scoped via .sa-* class prefix)
//
// We use a plain <style> tag with dangerouslySetInnerHTML rather than
// styled-jsx — styled-jsx is not wired into this app's Next.js App
// Router config, so `<style jsx>` blocks are silently dropped at build.
// =============================================================================
const STOCKS_CSS = `
/* ── Layout: hide site chrome, set app background ─────────────── */
body.stocks-app-mode .site-header,
body.stocks-app-mode .site-footer { display: none !important; }

/* Privacy mode — blur every element marked .sa-amount + a few common
   value-bearing classes automatically. Market prices / rec target prices /
   stop prices live inside .sa-clear and stay visible. */
body.sa-privacy .sa-amount,
body.sa-privacy .sa-stat .value,
body.sa-privacy .sa-stat .delta {
  filter: blur(7px) !important;
  user-select: none !important;
  transition: filter .15s;
}
body.sa-privacy .sa-amount:hover,
body.sa-privacy .sa-stat .value:hover,
body.sa-privacy .sa-stat .delta:hover {
  filter: blur(0) !important;
}
/* Anything wrapped in .sa-clear is exempt from privacy blur — used for
   rec entry/target/stop prices that are market info, not user balances. */
body.sa-privacy .sa-clear { filter: none !important; }

body.stocks-app-mode {
  background:
    radial-gradient(1100px 600px at 80% -10%, #eef2ff 0%, transparent 60%),
    radial-gradient(900px 500px at -10% 80%, #ecfdf5 0%, transparent 55%),
    #fafbff;
  min-height: 100vh;
}

/* ── Root tokens (light, premium fintech) ─────────────────────── */
.stocks-root {
  --sa-bg: transparent;
  --sa-panel: #ffffff;
  --sa-panel-2: #f5f7fb;
  --sa-panel-hover: #f0f3f9;
  --sa-border: #e4e8ef;
  --sa-border-strong: #cfd6e0;
  --sa-text: #0b1220;
  --sa-text-2: #475467;
  --sa-muted: #7a8499;
  --sa-accent: #0b1220;        /* primary buttons - rich black */
  --sa-accent-2: #1d4ed8;      /* focus / link */
  --sa-accent-soft: #eef2ff;
  --sa-green: #059669;
  --sa-green-soft: #ecfdf5;
  --sa-red: #dc2626;
  --sa-red-soft: #fef2f2;
  --sa-amber: #b45309;
  --sa-amber-soft: #fef3c7;
  --sa-purple: #6d28d9;
  --sa-purple-soft: #f5f3ff;
  --sa-shadow-sm: 0 1px 2px rgba(11, 18, 32, 0.04);
  --sa-shadow: 0 1px 3px rgba(11, 18, 32, 0.06), 0 8px 24px rgba(11, 18, 32, 0.04);
  --sa-shadow-lg: 0 12px 40px rgba(11, 18, 32, 0.10), 0 2px 8px rgba(11, 18, 32, 0.06);

  color: var(--sa-text); min-height: 100vh;
  font: 14px/1.55 var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  font-feature-settings: "cv02","cv03","cv04","cv11";
}
.stocks-root *, .stocks-root *::before, .stocks-root *::after { box-sizing: border-box; }

/* Form controls */
/* Exclude checkbox/radio so they don't get width:100% + border + padding
   applied — that was making the whole row clickable-as-input and blocking
   the checkbox itself from receiving pointer events. */
.stocks-root input:not([type="checkbox"]):not([type="radio"]),
.stocks-root select, .stocks-root textarea {
  font: inherit; color: var(--sa-text); background: #fff;
  border: 1.5px solid var(--sa-border); border-radius: 10px;
  padding: 11px 13px; outline: none; width: 100%;
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.stocks-root input:not([type="checkbox"]):not([type="radio"]):hover,
.stocks-root select:hover { border-color: var(--sa-border-strong); }
.stocks-root input:not([type="checkbox"]):not([type="radio"]):focus,
.stocks-root select:focus, .stocks-root textarea:focus {
  border-color: var(--sa-accent-2); box-shadow: 0 0 0 4px rgba(29,78,216,.10);
}
/* Legacy field labels ("EMAIL", "PASSWORD") get the uppercase caps
   treatment. label.sa-toggle-label is the escape hatch for on/off
   toggle rows where the label wraps a checkbox + body prose. */
.stocks-root label:not(.sa-toggle-label) {
  font-size: 11px; color: var(--sa-text-2); display: block; margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
}
.stocks-root label.sa-toggle-label {
  text-transform: none; letter-spacing: normal; font-weight: 400;
  font-size: inherit; color: inherit; display: flex; margin-bottom: 0;
}
.stocks-root h1, .stocks-root h2, .stocks-root h3, .stocks-root h4 { color: var(--sa-text); }
.stocks-root h2 { margin: 0 0 6px; font-size: 26px; letter-spacing: -.02em; font-weight: 700; }
.stocks-root h3 { margin: 0 0 14px; font-size: 14px; font-weight: 600; letter-spacing: -.005em; }
.sa-breadcrumb { color: var(--sa-muted); font-size: 13px; margin-bottom: 28px; }

/* Buttons */
.sa-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px 18px; background: var(--sa-accent); color: #fff;
  border: none; border-radius: 10px; font: inherit; font-weight: 600; font-size: 14px;
  cursor: pointer; transition: transform .12s ease, background .15s ease, box-shadow .15s ease;
  box-shadow: var(--sa-shadow-sm);
}
.sa-btn:hover { background: #1a2438; transform: translateY(-1px); box-shadow: var(--sa-shadow); }
.sa-btn:active { transform: translateY(0); }
.sa-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
.sa-btn.secondary {
  background: #fff; border: 1.5px solid var(--sa-border); color: var(--sa-text);
}
.sa-btn.secondary:hover { background: var(--sa-panel-2); border-color: var(--sa-border-strong); }
.sa-btn.danger { background: var(--sa-red); }
.sa-btn.danger:hover { background: #b91c1c; }
.sa-btn.ghost {
  background: transparent; color: var(--sa-muted); padding: 6px 10px;
  font-weight: 500; box-shadow: none;
}
.sa-btn.ghost:hover { color: var(--sa-text); background: var(--sa-panel-2); transform: none; }

/* Badges */
.sa-badge {
  display: inline-block; padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em; text-transform: capitalize;
}
.sa-badge.green { background: var(--sa-green-soft); color: var(--sa-green); }
.sa-badge.red { background: var(--sa-red-soft); color: var(--sa-red); }
.sa-badge.amber { background: var(--sa-amber-soft); color: var(--sa-amber); }
.sa-badge.purple { background: var(--sa-purple-soft); color: var(--sa-purple); }
.sa-muted { color: var(--sa-muted); }

/* Cards */
.sa-card {
  background: var(--sa-panel); border: 1px solid var(--sa-border);
  border-radius: 14px; padding: 22px; box-shadow: var(--sa-shadow-sm);
}

/* ── Auth views ────────────────────────────────────────────────── */
.sa-auth {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.sa-auth-card {
  width: 100%; max-width: 440px; background: var(--sa-panel);
  border: 1px solid var(--sa-border); border-radius: 18px;
  padding: 40px 36px; box-shadow: var(--sa-shadow-lg);
}
.sa-auth-card h1 {
  margin: 0 0 6px; font-size: 28px; font-weight: 700; letter-spacing: -.02em;
}
.sa-sub { color: var(--sa-text-2); margin-bottom: 28px; font-size: 14px; line-height: 1.55; }
.sa-row { margin-bottom: 18px; }
.sa-pin {
  display: flex; gap: 10px; justify-content: space-between;
}
.sa-pin input {
  text-align: center; font-size: 24px; font-weight: 700;
  font-feature-settings: "tnum"; letter-spacing: 0;
  flex: 1 1 0; min-width: 0; max-width: 60px; height: 64px; padding: 0; border-radius: 12px;
}
.sa-err {
  background: var(--sa-red-soft); color: var(--sa-red);
  padding: 12px 14px; border-radius: 10px; font-size: 13px; line-height: 1.45;
  margin-bottom: 16px; border: 1px solid #fecaca;
}
.sa-switch {
  text-align: center; margin-top: 18px; font-size: 13px; color: var(--sa-muted);
}

/* ── App shell ─────────────────────────────────────────────────── */
.sa-app {
  display: grid; grid-template-columns: 240px 1fr; min-height: 100vh;
}
.sa-side {
  background: rgba(255,255,255,.7); backdrop-filter: blur(8px);
  border-right: 1px solid var(--sa-border); padding: 28px 18px;
  display: flex; flex-direction: column; gap: 4px;
}
.sa-brand {
  font-weight: 800; font-size: 18px; letter-spacing: -.02em;
  margin-bottom: 28px; padding: 0 8px; color: var(--sa-text);
}
.sa-brand span { color: var(--sa-accent-2); font-weight: 700; }
.sa-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.sa-nav button {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: transparent; border: none; border-radius: 10px;
  color: var(--sa-text-2); text-align: left; font: inherit; font-size: 14px;
  font-weight: 500; cursor: pointer; width: 100%;
  transition: background .15s, color .15s;
}
.sa-nav button:hover { background: var(--sa-panel-2); color: var(--sa-text); }
.sa-nav button.active {
  background: var(--sa-panel-2); color: var(--sa-text); font-weight: 600;
}
.sa-nav button .dot {
  width: 6px; height: 6px; border-radius: 3px; background: var(--sa-border-strong);
}
.sa-nav button.active .dot { background: var(--sa-accent-2); }
/* Desktop shows the full label; short label is hidden. CSS swap below
   flips this on mobile so all 7 tabs fit on a 360px viewport. */
.sa-nav button .short-label { display: none; }
.sa-nav button .full-label { display: inline; }
.sa-user {
  font-size: 12px; color: var(--sa-muted); padding: 14px 8px;
  border-top: 1px solid var(--sa-border); line-height: 1.6;
}
.sa-main { padding: 36px 44px; overflow: auto; }
@media (max-width: 980px) {
  .sa-app { grid-template-columns: 1fr; }
  /* On mobile, convert the side panel into a sticky horizontal nav bar
     so the user always has tab navigation. Hide the brand and user-info
     blocks to save space; sign-out is still reachable via Settings. */
  .sa-side {
    display: flex;
    flex-direction: row;
    position: sticky;
    top: 0;
    z-index: 50;
    border-right: none;
    border-bottom: 1px solid var(--sa-border);
    background: rgba(255,255,255,.94);
    backdrop-filter: blur(10px);
    padding: 8px 10px;
    gap: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .sa-brand, .sa-user { display: none; }
  .sa-nav {
    flex-direction: row;
    gap: 2px;
    flex: 1;
    /* No horizontal scroll — buttons distribute via flex:1 so all 7
       tabs fit the viewport using short labels. */
    overflow-x: hidden;
    white-space: nowrap;
    justify-content: space-between;
  }
  .sa-nav button {
    flex: 1 1 0;
    min-width: 0;
    padding: 6px 4px;
    font-size: 11px;
    border-radius: 6px;
    text-align: center;
    justify-content: center;
    gap: 0;
  }
  .sa-nav button .dot { display: none; }
  .sa-nav button .full-label { display: none; }
  .sa-nav button .short-label { display: inline; }
  .sa-side { padding: 6px 8px; }
  .sa-main { padding: 18px 12px; }
}

/* ── Dashboard ────────────────────────────────────────────────── */
.sa-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px; margin-bottom: 28px;
}
.sa-stat {
  background: var(--sa-panel); border: 1px solid var(--sa-border);
  border-radius: 14px; padding: 18px 20px; box-shadow: var(--sa-shadow-sm);
}
.sa-stat .label {
  font-size: 11px; color: var(--sa-muted);
  text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; font-weight: 600;
}
.sa-stat .value {
  font-size: 24px; font-weight: 700; letter-spacing: -.015em;
  font-feature-settings: "tnum"; color: var(--sa-text);
}

.sa-grid-2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; }
@media (max-width: 980px) { .sa-grid-2 { grid-template-columns: 1fr; } }

/* Allocation rows */
.sa-alloc-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px solid var(--sa-border);
}
.sa-alloc-row:last-child { border-bottom: none; }
.sa-alloc-row .tk { flex: 0 0 90px; font-weight: 600; font-size: 13px; }
.sa-alloc-row .bar {
  flex: 1; height: 8px; background: var(--sa-panel-2);
  border-radius: 999px; overflow: hidden;
}
.sa-alloc-row .bar > div {
  height: 100%; background: linear-gradient(90deg, var(--sa-accent-2), #60a5fa);
  border-radius: 999px; transition: width .4s ease;
}
.sa-alloc-row .pct {
  flex: 0 0 60px; text-align: right; color: var(--sa-text-2);
  font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 500;
}

/* Tables */
.sa-table {
  width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums;
}
.sa-table th, .sa-table td {
  padding: 14px 14px; text-align: right; border-bottom: 1px solid var(--sa-border);
}
.sa-table tr:last-child td { border-bottom: none; }
.sa-table th {
  font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--sa-muted); font-weight: 600; background: var(--sa-panel-2);
}
.sa-table th:first-child, .sa-table td:first-child {
  text-align: left; padding-left: 22px;
}
.sa-table th:last-child, .sa-table td:last-child { padding-right: 22px; }
.sa-table tr:hover td { background: rgba(245,247,251,.5); }
.sa-table td.tk { font-weight: 600; color: var(--sa-text); }
.sa-table td.tk .sub {
  display: block; font-size: 11px; color: var(--sa-muted);
  font-weight: 400; margin-top: 2px;
}

/* Advice */
.sa-advice-card {
  background: var(--sa-panel); border: 1px solid var(--sa-border);
  border-radius: 14px; padding: 22px 24px; margin-bottom: 14px;
  border-left: 4px solid var(--sa-accent-2); box-shadow: var(--sa-shadow-sm);
  /* Contain long content (AI sometimes emits a single-line URL or a very
     long Call: badge) so it can't push the card past its parent's width. */
  overflow-wrap: anywhere;
  word-break: break-word;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.sa-advice-card.warn { border-left-color: var(--sa-amber); background: linear-gradient(to right, #fffbeb 0%, #fff 8%); }
.sa-advice-card.danger { border-left-color: var(--sa-red); background: linear-gradient(to right, #fef2f2 0%, #fff 8%); }
.sa-advice-card.good { border-left-color: var(--sa-green); background: linear-gradient(to right, #ecfdf5 0%, #fff 8%); }
.sa-advice-card h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 1.4; }
.sa-advice-card p { margin: 0 0 10px; line-height: 1.6; color: var(--sa-text-2); }
.sa-advice-card .meta {
  font-size: 12px; color: var(--sa-muted); margin-top: 8px;
  padding-top: 8px; border-top: 1px dashed var(--sa-border);
}

.sa-disclaimer {
  font-size: 11.5px; color: var(--sa-text-2); background: var(--sa-panel-2);
  padding: 12px 16px; border-radius: 10px; margin-bottom: 20px;
  line-height: 1.55; border: 1px solid var(--sa-border);
}

/* Risk-tolerance picker */
.sa-risk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sa-risk-card {
  padding: 18px; border: 1.5px solid var(--sa-border); border-radius: 12px;
  cursor: pointer; transition: all .15s ease; background: #fff;
}
.sa-risk-card:hover {
  border-color: var(--sa-accent-2); transform: translateY(-1px);
  box-shadow: var(--sa-shadow);
}
.sa-risk-card.sel {
  border-color: var(--sa-accent-2); background: var(--sa-accent-soft);
  box-shadow: 0 0 0 4px rgba(29,78,216,.08);
}
.sa-risk-card h4 {
  margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--sa-text);
}
.sa-risk-card p { margin: 0; font-size: 12.5px; color: var(--sa-text-2); line-height: 1.5; }

/* Modal */
.sa-modal-bg {
  position: fixed; inset: 0; background: rgba(11,18,32,.5);
  backdrop-filter: blur(4px); display: flex; align-items: flex-start;
  justify-content: center; padding: 24px; z-index: 100;
  overflow-y: auto; /* allow scrolling the backdrop on very tall content */
  animation: sa-fade .15s ease;
}
.sa-modal {
  background: var(--sa-panel); border: 1px solid var(--sa-border);
  border-radius: 18px; padding: 28px; width: 100%; max-width: 500px;
  box-shadow: var(--sa-shadow-lg); animation: sa-pop .2s ease;
  margin: auto; /* center vertically when content fits; align-top when it doesn't */
  max-height: calc(100vh - 48px);
  overflow-y: auto;     /* scroll inside the modal so action buttons stay reachable */
  display: flex; flex-direction: column;
}
.sa-modal h3 { margin: 0 0 20px; font-size: 17px; font-weight: 600; }
.sa-modal-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;
}
.sa-modal-row.three { grid-template-columns: 1fr 1fr 1fr; }

.sa-empty {
  text-align: center; padding: 48px 24px; color: var(--sa-muted);
}
.sa-empty .sa-btn { margin-top: 18px; }

.sa-toast {
  position: fixed; bottom: 28px; right: 28px; background: var(--sa-text);
  color: #fff; border-radius: 10px; padding: 12px 18px;
  font-size: 13.5px; font-weight: 500; box-shadow: var(--sa-shadow-lg);
  z-index: 200; animation: sa-in .25s ease;
  max-width: 360px;
}

@keyframes sa-in {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes sa-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sa-pop {
  from { transform: translateY(8px) scale(.98); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
`;

function StocksCSS() {
  return <style dangerouslySetInnerHTML={{ __html: STOCKS_CSS }} />;
}
