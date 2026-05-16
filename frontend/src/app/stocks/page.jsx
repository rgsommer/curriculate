"use client";

/**
 * Curriculate.net/stocks — Personal Stock Advisor
 *
 * Auth: passwordless email-PIN (5-digit code via Resend → HMAC session token).
 * Storage: MongoDB via the api.curriculate.net backend
 *   GET  /api/stocks-portfolio     — load current user's portfolio
 *   PUT  /api/stocks-portfolio     — upsert
 *   DELETE /api/stocks-portfolio   — reset
 * Only the {email, sessionToken} pair sits in localStorage so the user stays
 * signed in across refreshes; the actual portfolio is server-side.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  "https://api.curriculate.net";

// =============================================================================
// Auth persistence (only stores { email, sessionToken } — never portfolio data)
// =============================================================================
const AUTH_KEY = "stocksAdvisor.auth.v1";

function loadAuth() {
  if (typeof window === "undefined") return null;
  try {
    const j = JSON.parse(localStorage.getItem(AUTH_KEY));
    if (j && j.email && j.sessionToken) return j;
  } catch {}
  return null;
}
function saveAuth(auth) {
  if (typeof window === "undefined") return;
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

// =============================================================================
// API client
// =============================================================================
async function apiGetPortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`GET failed: ${r.status}`);
  return r.json();
}

async function apiPutPortfolio(sessionToken, profile) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      riskTolerance: profile.riskTolerance,
      fxUsdCad: profile.fxUsdCad,
      accounts: profile.accounts,
      positions: profile.positions,
    }),
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`PUT failed: ${r.status}`);
  return r.json();
}

async function apiDeletePortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`DELETE failed: ${r.status}`);
  return r.json();
}

async function apiMigratePortfolio(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-portfolio/migrate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error(`Migrate failed: ${r.status}`);
  return r.json();
}

async function apiRecordTrade(sessionToken, trade) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(trade),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

async function apiListPendingOrders(sessionToken) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.orders || [];
}
async function apiCreatePendingOrder(sessionToken, order) {
  const r = await fetch(`${BACKEND_URL}/api/stocks-pending-orders`, {
    method: "POST",
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

function valueOfPosition(p, fx) {
  if (p.ccy === "USD") {
    const cad = (p.priceCad ?? (p.priceUsd * fx)) * p.qty;
    return { cad, usd: (p.priceUsd ?? p.priceCad / fx) * p.qty };
  }
  return { cad: p.priceCad * p.qty, usd: (p.priceCad / fx) * p.qty };
}

function aggregateByTicker(positions, fx) {
  const m = {};
  positions.forEach((p) => {
    const v = valueOfPosition(p, fx);
    if (!m[p.ticker]) m[p.ticker] = { ticker: p.ticker, name: p.name, qty: 0, cad: 0, usd: 0 };
    m[p.ticker].qty += p.qty;
    m[p.ticker].cad += v.cad;
    m[p.ticker].usd += v.usd;
  });
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
function parseRecsFromBody(body) {
  if (!body || typeof body !== "string") return { intro: "", recs: [], outro: "" };
  // Find every "Action:" marker and the span of text that belongs to each rec
  // (from this Action: up to the next Action: or end of body).
  const actionRe = /\bAction:\s*/gi;
  const indices = [];
  let m;
  while ((m = actionRe.exec(body)) !== null) indices.push(m.index);
  if (indices.length === 0) return { intro: body, recs: [], outro: "" };

  const intro = body.slice(0, indices[0]).trim();
  const recs = [];
  let outro = "";
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : body.length;
    const chunk = body.slice(start, end);
    const parsed = parseSingleRec(chunk);
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

function parseSingleRec(chunk) {
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
  const ticker = headM[3].toUpperCase().replace(/\.+$/, "");

  // Extract each labeled field's value up to the next period
  const fieldVal = (label) => {
    const re = new RegExp(`${label}:\\s*([^.\\n]+?)(?:\\.|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : null;
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
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [modalIdx, setModalIdx] = useState(undefined);
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePrefill, setTradePrefill] = useState(null); // optional prefill for TradeModal
  const [executedRecKeys, setExecutedRecKeys] = useState(new Set()); // recs the user has executed in this session
  const [briefingPreview, setBriefingPreview] = useState(null); // { html, sent, error, busy }
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
          onSuccess={(email, sessionToken) => {
            const a = { email, sessionToken };
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
    setBriefingPreview({ busy: true });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.sessionToken}` },
        body: JSON.stringify({ send: false }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBriefingPreview({ html: j.html, markdown: j.markdown, subject: j.subject, sent: false });
    } catch (e) {
      setBriefingPreview({ error: e?.message || "Failed to generate briefing" });
    }
  };

  const sendBriefing = async () => {
    if (!briefingPreview || briefingPreview.busy) return;
    setBriefingPreview({ ...briefingPreview, busy: true });
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/send-briefing`, {
        method: "POST",
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
    showToast(`Trade recorded — ${trade.legs.map(l => `${l.side || ""} ${l.shares || ""} ${l.ticker || ""}`.trim()).join(", ")}`);
    return result;
  };

  // Shared refresh-prices flow — uses backend proxy to avoid Yahoo CORS
  const refreshPrices = async () => {
    const tickers = [...new Set(user.positions.map((p) => p.ticker))];
    if (tickers.length === 0) { showToast("No positions to refresh."); return { ok: 0, fail: 0 }; }
    showToast(`Fetching ${tickers.length} tickers…`);
    try {
      const r = await fetch(`${BACKEND_URL}/api/stocks-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { prices, failed } = await r.json();
      const updated = user.positions.map((p) => {
        const q = prices?.[p.ticker];
        if (!q) return p;
        if (q.currency === "USD") return { ...p, priceUsd: q.price };
        if (q.currency === "CAD") return { ...p, priceCad: q.price };
        return p;
      });
      updateUser(() => ({ positions: updated }));
      const ok = tickers.length - (failed?.length || 0);
      showToast(`Fetched ${ok}/${tickers.length}.${failed?.length ? ` Failed: ${failed.join(", ")}` : ""}`);
      return { ok, fail: failed?.length || 0 };
    } catch (e) {
      showToast(`Price fetch failed: ${e?.message || "network"}`);
      return { ok: 0, fail: tickers.length };
    }
  };

  return (
    <FullscreenShell>
      <div className="sa-app">
        <aside className="sa-side">
          <div className="sa-brand">Stocks <span>Advisor</span></div>
          <nav className="sa-nav">
            {[
              ["dashboard", "Dashboard"],
              ["positions", "Positions"],
              ["advice", "Advice"],
              ["performance", "Performance"],
              ["trades", "Trades"],
              ["settings", "Settings"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={currentTab === k ? "active" : ""}
                onClick={() => setCurrentTab(k)}
              >
                <span className="dot" /> {label}
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
              onClick={() => { saveAuth(null); setAuth(null); setProfile(null); }}
            >Sign out</button>
          </div>
        </aside>
        <main className="sa-main">
          {currentTab === "dashboard" && (
            <DashboardView
              user={user}
              onTab={setCurrentTab}
              onRefresh={refreshPrices}
              onAiAdvice={() => {
                // Switch to Advice tab and have it auto-run the AI fetch
                setPendingAiFetch(true);
                setCurrentTab("advice");
              }}
              onRecordTrade={() => setTradeModalOpen(true)}
              onEmailBriefing={previewBriefing}
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
          {currentTab === "performance" && <PerformanceView sessionToken={auth.sessionToken} />}
          {currentTab === "trades" && <TradesView sessionToken={auth.sessionToken} />}
          {currentTab === "settings" && (
            <SettingsView
              user={user}
              onChangeRisk={(v) => { updateUser(() => ({ riskTolerance: v })); showToast("Risk tolerance updated"); }}
              onChangeFx={(v) => { updateUser(() => ({ fxUsdCad: v })); showToast("FX updated"); }}
              onChangeCommission={(v) => { updateUser(() => ({ commissionPerTrade: v })); showToast("Commission updated"); }}
              onChangeFxSpread={(v) => { updateUser(() => ({ fxSpreadPct: v })); showToast("FX spread updated"); }}
              onChangeGoals={(v) => { updateUser(() => ({ goals: v })); }}
              onChangeContributionGoals={(g) => { updateUser(() => ({ annualContributionGoals: g })); showToast("Contribution goals updated"); }}
              onChangeAccountRisk={(accountId, riskLevel) => {
                updateUser((u) => ({
                  accounts: u.accounts.map(a => a.id === accountId ? { ...a, riskTolerance: riskLevel } : a),
                }));
                showToast("Account risk updated");
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
        {toast && <div className="sa-toast">{toast}</div>}
      </div>
      <StocksCSS />
    </FullscreenShell>
  );
}

// =============================================================================
// Subviews
// =============================================================================

function AuthView({ onSuccess }) {
  // step: "email" → enter email and request a PIN
  //       "pin"   → enter the 5-digit PIN we just emailed
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(null);
  const [pin, setPin] = useState(["", "", "", "", ""]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const requestPin = async () => {
    setErr(null);
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await fetch("/api/stocks/request-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error || "Could not send code. Try again.");
      setEmail(e);
      setToken(j.token);
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
    if (p.length !== 5) return setErr("Enter the 5-digit code.");
    setBusy(true);
    try {
      const r = await fetch("/api/stocks/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: p, token }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return setErr(j.error || "Incorrect or expired code.");
      onSuccess(email, j.sessionToken);
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
          <div className="sa-sub">Enter your email and we&apos;ll send you a 5-digit code to sign in.</div>
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
          We sent a 5-digit code to <b>{email}</b>. Enter it below. The code expires in 10 minutes.
        </div>
        {err && <div className="sa-err">{err}</div>}
        <div className="sa-row">
          <label>5-digit code</label>
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
                  if (next[i] && i < 4) {
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
            onClick={() => { setStep("email"); setPin(["", "", "", "", ""]); setErr(null); }}
          >← Use a different email</button>
          <button
            className="sa-btn ghost"
            onClick={() => { setPin(["", "", "", "", ""]); requestPin(); }}
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

function DashboardView({ user, onTab, onRefresh, onAiAdvice, onRecordTrade, onEmailBriefing, onEditPosition, pendingOrders, onFillPendingOrder, onCancelPendingOrder }) {
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  // Values stat row starts collapsed — privacy + reduces visual noise on load
  const [valuesCollapsed, setValuesCollapsed] = useState(true);
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
    try { await onRefresh(); } finally { setBusyRefresh(false); }
  };
  const handleAi = async () => {
    if (busyAi) return;
    setBusyAi(true);
    try { await onAiAdvice(); } finally { setBusyAi(false); }
  };

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
          <button className="sa-btn secondary" onClick={handleRefresh} disabled={busyRefresh || busyAi} title="Re-fetch live prices from Yahoo Finance via the backend proxy">
            {busyRefresh ? "Refreshing…" : "↻ Refresh prices"}
          </button>
          <button className="sa-btn" onClick={handleAi} disabled={busyAi || busyRefresh} title="Search the web for fresh news and have Claude generate updated advice">
            {busyAi ? "Thinking…" : "🧠 Update Advice"}
          </button>
        </div>
      </div>
      <div className="sa-disclaimer">Research and education only. Not licensed investment advice.</div>

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
      <HoldingsBreakdownCard user={user} fx={fx} onEditPosition={onEditPosition} />

      {/* Per-ticker performance — multi-line chart, range tabs */}
      <TickerPerformanceCard
        tickers={agg.map(a => a.ticker).slice(0, 10)}
        holdings={agg.slice(0, 10)}
        fx={fx}
      />

      <div className="sa-grid-2">
        <div className="sa-card">
          <h3>Allocation</h3>
          {top.length === 0 ? (
            <div className="sa-empty">No positions yet.<br /><button className="sa-btn" onClick={() => onTab("positions")}>Add positions</button></div>
          ) : top.map((a) => {
            const pct = (a.cad / total) * 100;
            return (
              <div key={a.ticker} className="sa-alloc-row">
                <div className="tk">{a.ticker}</div>
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

function PositionsView({ user, onOpenModal, onDelete, onAddAccount, onRefreshPrices }) {
  const fx = user.fxUsdCad || 1.37;
  const total = totalCad(user.positions, fx);
  return (
    <div>
      <h2>Positions</h2>
      <div className="sa-breadcrumb">{user.positions.length} positions across {user.accounts.length || 1} account{user.accounts.length === 1 ? "" : "s"}</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="sa-btn" onClick={() => onOpenModal(null)}>+ Add position</button>
        <button className="sa-btn secondary" onClick={onAddAccount}>+ Add account</button>
        <button className="sa-btn secondary" onClick={onRefreshPrices} title="Try fetch latest prices from Yahoo Finance">↻ Refresh prices</button>
      </div>
      <div className="sa-card" style={{ padding: 0 }}>
        <table className="sa-table">
          <thead><tr>
            <th>Ticker</th><th>Account</th><th>Qty</th><th>Price</th><th>CCY</th><th>Value (CAD)</th><th>%</th><th></th>
          </tr></thead>
          <tbody>
            {user.positions.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--sa-muted)" }}>No positions yet. Click <b>Add position</b> to get started.</td></tr>
            ) : user.positions.map((p, i) => {
              const v = valueOfPosition(p, fx);
              const acct = user.accounts.find((a) => a.id === p.acct);
              const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
              return (
                <tr key={i}>
                  <td className="tk">{p.ticker}<span className="sub">{p.name || ""}</span></td>
                  <td style={{ textAlign: "left", color: "var(--sa-muted)" }}>{acct ? acct.name : "—"}</td>
                  <td>{p.qty.toLocaleString()}</td>
                  <td>{price != null ? price.toFixed(4) : "—"}</td>
                  <td>{p.ccy}</td>
                  <td>{fmtMoney(v.cad, "CAD")}</td>
                  <td>{total > 0 ? ((v.cad / total) * 100).toFixed(1) : "0.0"}%</td>
                  <td>
                    <button className="sa-btn ghost" onClick={() => onOpenModal(i)}>edit</button>
                    {" "}
                    <button className="sa-btn ghost" onClick={() => onDelete(i)}>delete</button>
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

function AdviceView({ user, onRefresh, sessionToken, autoFetchAi, onAutoFetchConsumed, onExecuteRec, executedRecKeys, recKey, onClearExecuted }) {
  // Per-ticker P/L (CAD) used to annotate each rec row with the position's
  // current performance. Recomputed when prices or basis change.
  const pnlMap = useMemo(() => pnlByTicker(user.positions, user.fxUsdCad || 1.37), [user.positions, user.fxUsdCad]);
  const [consensusBusy, setConsensusBusy] = useState(false);
  const [consensusData, setConsensusData] = useState(null); // { consensus, alternatives, sources }
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAdvice, setAiAdvice] = useState(null); // { advice, sources, generatedAt }
  const [aiError, setAiError] = useState(null);
  const ruleAdvice = useMemo(() => generateAdvice(user), [user]);

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRefresh(); } finally { setBusy(false); }
  };

  const handleAi = async () => {
    if (aiBusy) return;
    setAiBusy(true); setAiError(null);
    try {
      // Refresh prices first so the AI sees fresh quotes
      await onRefresh();
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setAiAdvice(j);
      setConsensusData(null);
      // Fresh AI advice → clear stale "executed" marks (a new rec is not the
      // same as the old one even if ticker/side/qty happen to match)
      onClearExecuted?.();
    } catch (e) {
      setAiError(e?.message || "Failed");
    } finally {
      setAiBusy(false);
    }
  };

  const handleConsensus = async () => {
    if (consensusBusy || aiBusy) return;
    setConsensusBusy(true); setAiError(null);
    try {
      await onRefresh();
      const r = await fetch(`${BACKEND_URL}/api/stocks-advice/consensus`, {
        method: "POST",
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

  // Display mode priority: consensus > single AI run > rule-based fallback
  let shown, showingAi, showingConsensus = false, alternatives = null;
  if (consensusData) {
    shown = consensusData.consensus;
    alternatives = consensusData.alternatives || [];
    showingAi = true;
    showingConsensus = true;
  } else if (aiAdvice) {
    shown = aiAdvice.advice;
    showingAi = true;
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
              : showingAi
              ? `🧠 AI-generated · ${new Date(aiAdvice.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Rule-based signals from your current portfolio"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="sa-btn secondary" onClick={handleRefresh} disabled={busy || aiBusy || consensusBusy} title="Re-fetch prices and re-run the rule engine">
            {busy ? "Refreshing…" : "↻ Refresh prices"}
          </button>
          <button className="sa-btn secondary" onClick={handleConsensus} disabled={consensusBusy || aiBusy || busy} title="Run advice 3× in parallel and surface the recommendations that appear in ≥ 2 of 3 runs (high-conviction). Costs ~3× the single-run API spend.">
            {consensusBusy ? "Running 3×…" : "🧠🧠🧠 Consensus mode"}
          </button>
          <button className="sa-btn" onClick={handleAi} disabled={aiBusy || busy || consensusBusy} title="Search the web for fresh news on each holding and run Claude over the portfolio">
            {aiBusy ? "Thinking…" : "🧠 Update Advice"}
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
      {showingConsensus && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--sa-accent-soft)", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 12, color: "var(--sa-text-2)" }}>
          🧠🧠🧠 <b>Consensus mode</b> — recommendations shown below appeared in <b>at least 2 of {consensusData.runsSucceeded} independent generations</b>. Each card shows the run count. Lower-conviction ideas (appeared in only 1 run) are listed separately below.
        </div>
      )}
      {shown.map((c, i) => {
        const parsed = parseRecsFromBody(c.body);
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
            {hasRecs ? (
              <>
                {parsed.intro && <p>{parsed.intro}</p>}
                <RecsTable
                  recs={parsed.recs}
                  onExecuteRec={onExecuteRec}
                  executedRecKeys={executedRecKeys}
                  recKey={recKey}
                  pnlMap={pnlMap}
                />
                {parsed.outro && <p style={{ marginTop: 10, fontStyle: "italic", color: "var(--sa-text-2)" }}>{parsed.outro}</p>}
              </>
            ) : (
              // No structured recs detected — render the full body once as prose.
              <p>{c.body}</p>
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
            const parsed = parseRecsFromBody(c.body);
            const hasRecs = parsed.recs.length > 0;
            if (c.recId) parsed.recs.forEach(r => { r.recId = c.recId; });
            return (
              <div key={`alt-${i}`} className={`sa-advice-card ${c.sev === "danger" ? "danger" : c.sev === "warn" ? "warn" : c.sev === "good" ? "good" : ""}`} style={{ opacity: 0.85 }}>
                <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span>{c.title}</span>
                  <span style={{ background: "var(--sa-amber-soft)", color: "var(--sa-amber)", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>1/{c.totalRuns} runs</span>
                </h3>
                {hasRecs ? (
                  <>
                    {parsed.intro && <p>{parsed.intro}</p>}
                    <RecsTable recs={parsed.recs} onExecuteRec={onExecuteRec} executedRecKeys={executedRecKeys} recKey={recKey} pnlMap={pnlMap} />
                    {parsed.outro && <p style={{ marginTop: 10, fontStyle: "italic", color: "var(--sa-text-2)" }}>{parsed.outro}</p>}
                  </>
                ) : (
                  <p>{c.body}</p>
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

      {showingAi && !showingConsensus && aiAdvice.sources?.length > 0 && (
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

function SettingsView({ user, onChangeRisk, onChangeFx, onChangeCommission, onChangeFxSpread, onChangeGoals, onChangeContributionGoals, onChangeAccountRisk, onAddPlannedWithdrawal, onRemovePlannedWithdrawal, onExecutePlannedWithdrawal, onReset }) {
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

        {/* Per-account risk overrides */}
        {(user.accounts || []).length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--sa-border)" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Per-account risk override</div>
            <div className="sa-muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Set a different risk level per account — e.g. aggressive Non-Spousal, conservative RRSP for retirement runway. Default = inherit global.
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {user.accounts.map(a => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--sa-border)" }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{a.name}</span>
                  <select
                    value={a.riskTolerance || ""}
                    onChange={(e) => onChangeAccountRisk(a.id, e.target.value || null)}
                  >
                    <option value="">— inherit global ({user.riskTolerance}) —</option>
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
function RecsTable({ recs, onExecuteRec, executedRecKeys, recKey, pnlMap }) {
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
                  {isExecuted ? (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: "var(--sa-green)", color: "#fff",
                    }}>
                      ✓ Executed
                    </span>
                  ) : onExecuteRec && r.side !== "HOLD" ? (
                    <button
                      className="sa-btn"
                      style={{ padding: "5px 12px", fontSize: 12 }}
                      onClick={() => onExecuteRec(r)}
                      title="Open the Record Trade modal with this rec pre-filled"
                    >Execute →</button>
                  ) : null}
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
function BriefingPreviewModal({ preview, recipient, onClose, onSend }) {
  const { busy, html, error, sent, sendError, subject } = preview;

  return (
    <div className="sa-modal-bg" onClick={onClose}>
      <div
        className="sa-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Email Briefing — Preview</h3>
          <button className="sa-btn ghost" onClick={onClose} disabled={busy} style={{ padding: "4px 10px" }}>✕</button>
        </div>

        {/* Loading */}
        {busy && !html && (
          <div style={{ padding: "40px 0", textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--sa-text-2)", marginBottom: 8 }}>Generating briefing…</div>
            <div style={{ fontSize: 12, color: "var(--sa-muted)" }}>Searching news on each of your holdings · 20-40s</div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="sa-err">{error}</div>
        )}

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
                ✓ Sent to {recipient}
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

  // SELL sub-account inherited from the chosen holding (where it lives)
  const [sellSubCcy, setSellSubCcy] = useState("USD");

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
// Performance view — portfolio time series + "if-followed" advisor scorecard
// =============================================================================
function PerformanceView({ sessionToken }) {
  const [snaps, setSnaps] = useState(null);
  const [perfAccounts, setPerfAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("__total__");
  const [advisorPerf, setAdvisorPerf] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [scorecardDays, setScorecardDays] = useState(30);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true); setErr(null);
      try {
        const [snapRes, perfRes, scoreRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/stocks-portfolio/performance?days=365&accountId=${encodeURIComponent(selectedAccountId)}`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${BACKEND_URL}/api/stocks-advice/performance?days=30`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${BACKEND_URL}/api/stocks-advice/scorecard?days=${scorecardDays}`, {
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

      {/* ── ADVICE SCORECARD: what was taken, what worked, what didn't ── */}
      <AdviceScorecardCard
        scorecard={scorecard}
        days={scorecardDays}
        onChangeDays={setScorecardDays}
      />

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
function HoldingsBreakdownCard({ user, fx, onEditPosition }) {
  const [expandedTicker, setExpandedTicker] = useState(null);
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
            <tr style={{ borderTop: "1px dashed var(--sa-border)", background: "rgba(91,141,239,.04)" }}>
              <td style={{ ...recCellLeft, fontWeight: 500, color: "var(--sa-text-2)" }}>Cash</td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, color: cashUsd > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(cashUsd)}</span></td>
              <td style={recCell}>—</td>
              <td style={{ ...recCell, color: cashCad > 0 ? "var(--sa-green)" : "var(--sa-muted)" }}><span className="sa-amount">{fmt$(cashCad)}</span></td>
              <td style={{ ...recCell, fontWeight: 600 }}><span className="sa-amount">{fmt$(cashTotalCad)}</span></td>
            </tr>
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
// Per-ticker performance chart — multi-line, range-switchable
// =============================================================================
const TICKER_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2",
  "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7",
];

function TickerPerformanceCard({ tickers, holdings = [], fx = 1.37 }) {
  const [range, setRange] = useState("1d");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({}); // { ticker: { points, currency } }
  const [failed, setFailed] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!tickers || tickers.length === 0) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-prices/history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers, range }),
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
  }, [tickers.join(","), range]);

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
  const rangeLabel = { "1d": "today", "3d": "3 days", "7d": "7 days", "30d": "30 days", "1y": "1 year", "2y": "2 years" }[range];

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
        <div style={{ display: "flex", gap: 4, background: "var(--sa-panel-2)", padding: 3, borderRadius: 8 }}>
          {[
            ["1d", "1D"], ["3d", "3D"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"], ["2y", "2Y"],
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
      </div>
      {err && <div className="sa-err">{err}</div>}
      {busy && !labels.length && <div className="sa-muted" style={{ padding: 20, textAlign: "center" }}>Loading prices…</div>}
      {!busy && !labels.length && !err && <div className="sa-muted" style={{ padding: 20, textAlign: "center" }}>No data returned.</div>}
      {labels.length > 0 && (
        <>
          <MultiLineChart series={labels.map((t, i) => ({ ticker: t, points: data[t].points, color: colorFor(tickers.indexOf(t)) }))} range={range} />
          {/* Legend with final % */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14, fontSize: 12 }}>
            {labels.map((t) => {
              const pts = data[t].points;
              const finalPct = pts[pts.length - 1].pct;
              const color = colorFor(tickers.indexOf(t));
              return (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
                  <span style={{ fontWeight: 600 }}>{t}</span>
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

function MultiLineChart({ series, range }) {
  const W = 720, H = 280, PADL = 44, PADR = 14, PADT = 14, PADB = 30;
  // Pool all points to find min/max pct and time bounds
  let minPct = Infinity, maxPct = -Infinity;
  let minT = Infinity, maxT = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.pct < minPct) minPct = p.pct;
      if (p.pct > maxPct) maxPct = p.pct;
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
    }
  }
  if (!isFinite(minPct)) { minPct = -1; maxPct = 1; }
  // Padding for nice axes
  const padPct = (maxPct - minPct) * 0.08 || 1;
  minPct -= padPct; maxPct += padPct;
  // Ensure 0% line is visible
  if (minPct > 0) minPct = -0.5;
  if (maxPct < 0) maxPct = 0.5;
  const pctRange = maxPct - minPct;
  const tRange = (maxT - minT) || 1;

  const xOf = (t) => PADL + ((t - minT) / tRange) * (W - PADL - PADR);
  const yOf = (pct) => PADT + (1 - (pct - minPct) / pctRange) * (H - PADT - PADB);
  const yOfZero = yOf(0);

  // X-axis tick labels — based on range
  const fmtTick = (t) => {
    const d = new Date(t * 1000);
    if (range === "1d") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (range === "1y" || range === "2y") return d.toLocaleDateString([], { month: "short", year: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const tickTs = [minT, minT + tRange * 0.33, minT + tRange * 0.66, maxT];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* Y gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = PADT + t * (H - PADT - PADB);
        const pct = maxPct - t * pctRange;
        return (
          <g key={t}>
            <line x1={PADL} x2={W - PADR} y1={y} y2={y} stroke="#e4e8ef" strokeWidth="1" />
            <text x={PADL - 8} y={y + 4} fontSize="10" fill="#7a8499" textAnchor="end">
              {pct >= 0 ? "+" : ""}{pct.toFixed(pctRange < 4 ? 2 : 1)}%
            </text>
          </g>
        );
      })}
      {/* Zero line — emphasized */}
      <line x1={PADL} x2={W - PADR} y1={yOfZero} y2={yOfZero} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="3,3" />

      {/* Lines */}
      {series.map((s) => {
        if (s.points.length < 2) return null;
        const d = s.points.map((p, i) => (i === 0 ? "M" : "L") + xOf(p.t).toFixed(1) + "," + yOf(p.pct).toFixed(1)).join(" ");
        const last = s.points[s.points.length - 1];
        return (
          <g key={s.ticker}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            {/* Final dot */}
            <circle cx={xOf(last.t)} cy={yOf(last.pct)} r="3" fill={s.color} />
          </g>
        );
      })}

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

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stocks-trade?days=${days}`, {
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2>Trades</h2>
          <div className="sa-breadcrumb">Transaction journal · most recent first</div>
        </div>
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
                  <th style={recHeaderCellLeft}>Date</th>
                  <th style={recHeaderCellLeft}>Account</th>
                  <th style={recHeaderCellLeft}>Legs</th>
                  <th style={recHeaderCell}>Net cash (CAD)</th>
                  <th style={recHeaderCellLeft}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t._id || i} style={{ borderTop: "1px solid var(--sa-border)" }}>
                    <td style={recCellLeft}>{new Date(t.executedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
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
                    <td style={{ ...recCellLeft, color: "var(--sa-muted)", fontSize: 12, maxWidth: 220, whiteSpace: "normal" }}>
                      {t.notes || "—"}
                    </td>
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

// =============================================================================
// Advice Scorecard — the close-the-loop view. For each rec generated in the
// window: did the user execute it? Was the call right? How much $ did it
// produce (or save by being skipped)?
// =============================================================================
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
                  const f = summary.netDollarsFromFollowed;
                  const s = summary.netDollarsFromSkipped;
                  if (f > 0 && s < 0) return "✅ Good calls + good skips";
                  if (f > 0 && s > 0) return "🟢 Calls right, missed some";
                  if (f < 0 && s > 0) return "⚠️ Skipped winners, took losers";
                  if (f < 0 && s < 0) return "🟡 Whole cohort underwater";
                  return "—";
                })()}
              </div>
              <div className="sa-muted" style={{ fontSize: 11, marginTop: 4 }}>{summary.skipped} skipped · {summary.followed} taken</div>
            </div>
          </div>

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
.stocks-root input, .stocks-root select, .stocks-root textarea {
  font: inherit; color: var(--sa-text); background: #fff;
  border: 1.5px solid var(--sa-border); border-radius: 10px;
  padding: 11px 13px; outline: none; width: 100%;
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.stocks-root input:hover, .stocks-root select:hover { border-color: var(--sa-border-strong); }
.stocks-root input:focus, .stocks-root select:focus, .stocks-root textarea:focus {
  border-color: var(--sa-accent-2); box-shadow: 0 0 0 4px rgba(29,78,216,.10);
}
.stocks-root label {
  font-size: 11px; color: var(--sa-text-2); display: block; margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
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
  width: 60px; height: 64px; padding: 0; border-radius: 12px;
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
.sa-user {
  font-size: 12px; color: var(--sa-muted); padding: 14px 8px;
  border-top: 1px solid var(--sa-border); line-height: 1.6;
}
.sa-main { padding: 36px 44px; overflow: auto; }
@media (max-width: 980px) {
  .sa-app { grid-template-columns: 1fr; }
  .sa-side { display: none; }
  .sa-main { padding: 24px 18px; }
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
