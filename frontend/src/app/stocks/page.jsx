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
  const [briefingPreview, setBriefingPreview] = useState(null); // { html, sent, error, busy }
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
        body: JSON.stringify({ send: true }),
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

  // Record a trade: post to /api/stocks-trade and refresh local profile
  const recordTrade = async (trade) => {
    const result = await apiRecordTrade(auth.sessionToken, trade);
    setProfile(result.portfolio);
    showToast(`Trade recorded — ${trade.legs.map(l => `${l.side} ${l.shares} ${l.ticker}`).join(", ")}`);
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
            />
          )}
          {currentTab === "performance" && <PerformanceView sessionToken={auth.sessionToken} />}
          {currentTab === "settings" && (
            <SettingsView
              user={user}
              onChangeRisk={(v) => { updateUser(() => ({ riskTolerance: v })); showToast("Risk tolerance updated"); }}
              onChangeFx={(v) => { updateUser(() => ({ fxUsdCad: v })); showToast("FX updated"); }}
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
            onClose={() => setTradeModalOpen(false)}
            onSubmit={async (trade) => {
              try {
                await recordTrade(trade);
                setTradeModalOpen(false);
              } catch (e) {
                throw e; // let the modal show the error
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

function DashboardView({ user, onTab, onRefresh, onAiAdvice, onRecordTrade, onEmailBriefing }) {
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
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
            {busyAi ? "Thinking…" : "🧠 Get fresh AI advice"}
          </button>
        </div>
      </div>
      <div className="sa-disclaimer">Research and education only. Not licensed investment advice.</div>
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

function AdviceView({ user, onRefresh, sessionToken, autoFetchAi, onAutoFetchConsumed }) {
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
    } catch (e) {
      setAiError(e?.message || "Failed");
    } finally {
      setAiBusy(false);
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

  const shown = aiAdvice?.advice || ruleAdvice;
  const showingAi = !!aiAdvice;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <div>
          <h2>Advice</h2>
          <div className="sa-breadcrumb">
            {showingAi
              ? `🧠 AI-generated · ${new Date(aiAdvice.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Rule-based signals from your current portfolio"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sa-btn secondary" onClick={handleRefresh} disabled={busy || aiBusy} title="Re-fetch prices and re-run the rule engine">
            {busy ? "Refreshing…" : "↻ Refresh prices"}
          </button>
          <button className="sa-btn" onClick={handleAi} disabled={aiBusy || busy} title="Search the web for fresh news on each holding and run Claude over the portfolio">
            {aiBusy ? "Thinking…" : "🧠 Get fresh AI advice"}
          </button>
        </div>
      </div>
      <div className="sa-disclaimer">⚠️ Research and education only. Not licensed investment advice. Decisions are yours.</div>
      {aiError && <div className="sa-err">{aiError}</div>}
      {showingAi && (
        <div style={{ marginBottom: 12, textAlign: "right" }}>
          <button className="sa-btn ghost" onClick={() => setAiAdvice(null)}>Back to rule-based view</button>
        </div>
      )}
      {shown.map((c, i) => (
        <div key={i} className={`sa-advice-card ${c.sev === "danger" ? "danger" : c.sev === "warn" ? "warn" : c.sev === "good" ? "good" : ""}`}>
          <h3>{c.title}</h3>
          <p>{c.body}</p>
          {c.meta && <div className="meta">{c.meta}</div>}
        </div>
      ))}
      {showingAi && aiAdvice.sources?.length > 0 && (
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

function SettingsView({ user, onChangeRisk, onChangeFx, onReset }) {
  return (
    <div>
      <h2>Settings</h2>
      <div className="sa-breadcrumb">Account preferences</div>
      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>Risk tolerance</h3>
        <div className="sa-risk-grid">
          {["conservative", "moderate", "aggressive", "speculative"].map((v) => (
            <div key={v} className={`sa-risk-card ${user.riskTolerance === v ? "sel" : ""}`} onClick={() => onChangeRisk(v)}>
              <h4 style={{ textTransform: "capitalize" }}>{v}</h4>
            </div>
          ))}
        </div>
      </div>
      <div className="sa-card" style={{ marginBottom: 14 }}>
        <h3>FX rate (USD → CAD)</h3>
        <input type="number" step="0.001" defaultValue={user.fxUsdCad} style={{ maxWidth: 200 }} onChange={(e) => onChangeFx(parseFloat(e.target.value) || 1.37)} />
        <div className="sa-muted" style={{ fontSize: 12, marginTop: 6 }}>Used to compute CAD-equivalent of USD positions.</div>
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
          <div><label>Currency</label>
            <select value={form.ccy} onChange={(e) => update("ccy", e.target.value)}>
              <option value="USD">USD</option><option value="CAD">CAD</option>
            </select>
          </div>
        </div>
        <div className="sa-modal-row three">
          <div><label>Quantity</label><input type="number" step="any" value={form.qty} onChange={(e) => update("qty", parseFloat(e.target.value) || 0)} /></div>
          <div><label>Price (USD)</label><input type="number" step="any" value={form.priceUsd ?? ""} onChange={(e) => update("priceUsd", parseFloat(e.target.value) || null)} /></div>
          <div><label>Price (CAD)</label><input type="number" step="any" value={form.priceCad ?? ""} onChange={(e) => update("priceCad", parseFloat(e.target.value) || null)} /></div>
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
function TradeModal({ user, onClose, onSubmit }) {
  const [mode, setMode] = useState("swap"); // "buy" | "sell" | "swap" | "cash"
  const [account, setAccount] = useState(user.accounts?.[0]?.id || "");
  const [executedAt] = useState(() => new Date().toISOString().slice(0, 10));

  // Equity leg state
  const [sellTicker, setSellTicker] = useState("");
  const [sellShares, setSellShares] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellCcy, setSellCcy] = useState("USD");

  const [buyTicker, setBuyTicker] = useState("");
  const [buyShares, setBuyShares] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [buyCcy, setBuyCcy] = useState("CAD");

  // Cash leg state
  const [cashDirection, setCashDirection] = useState("DEPOSIT"); // DEPOSIT | WITHDRAW
  const [cashAmount, setCashAmount] = useState("");
  const [cashCcy, setCashCcy] = useState("CAD");

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

  // Tickers visible in the user's portfolio for BUY autocomplete suggestion
  const ownedTickers = [...new Set(user.positions.map(p => p.ticker))];

  // Aggregate holdings in the currently-selected account, by (ticker, ccy).
  // The SELL dropdown uses this so the user can only sell things they own,
  // and we can show "X available" + last known price as a fill-price hint.
  const accountHoldings = useMemo(() => {
    const m = new Map();
    for (const p of user.positions) {
      if (p.acct !== account) continue;
      const key = `${p.ticker}|${p.ccy}`;
      const last = p.ccy === "USD" ? p.priceUsd : p.priceCad;
      if (!m.has(key)) {
        m.set(key, { ticker: p.ticker, ccy: p.ccy, qty: 0, lastPrice: last, name: p.name || "" });
      }
      const h = m.get(key);
      h.qty += p.qty || 0;
      if (last && (h.lastPrice == null || h.lastPrice === 0)) h.lastPrice = last;
    }
    return [...m.values()].sort((a, b) => (b.qty * (b.lastPrice || 0)) - (a.qty * (a.lastPrice || 0)));
  }, [user.positions, account]);

  // When account changes (or when selecting an option), reset sell fields if
  // current selection isn't valid in the new account.
  useEffect(() => {
    if ((mode === "sell" || mode === "swap") && sellTicker) {
      const match = accountHoldings.find(h => h.ticker === sellTicker && h.ccy === sellCcy);
      if (!match) {
        setSellTicker(""); setSellShares(""); setSellPrice(""); setSellCcy("USD");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const selectedHolding = accountHoldings.find(h => h.ticker === sellTicker && h.ccy === sellCcy) || null;
  const selectSellHolding = (key) => {
    if (!key) {
      setSellTicker(""); setSellShares(""); setSellPrice(""); setSellCcy("USD");
      return;
    }
    const [ticker, ccy] = key.split("|");
    const h = accountHoldings.find(x => x.ticker === ticker && x.ccy === ccy);
    if (!h) return;
    setSellTicker(h.ticker);
    setSellCcy(h.ccy);
    setSellShares(String(h.qty));         // default to selling the whole position; user adjusts down
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
    } else {
      if (mode === "buy" || mode === "swap") {
        const s = parseFloat(buyShares); const p = parseFloat(buyPrice);
        if (!buyTicker || !s || s <= 0 || !(p >= 0)) return setErr("BUY leg needs ticker, shares > 0, and a price.");
        legs.push({ side: "BUY", ticker: buyTicker.trim().toUpperCase(), shares: s, price: p, currency: buyCcy });
      }
      if (mode === "sell" || mode === "swap") {
        const s = parseFloat(sellShares); const p = parseFloat(sellPrice);
        if (!sellTicker || !s || s <= 0 || !(p >= 0)) return setErr("SELL leg needs ticker, shares > 0, and a price.");
        legs.unshift({ side: "SELL", ticker: sellTicker.trim().toUpperCase(), shares: s, price: p, currency: sellCcy });
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
                  <select value={sellTicker && sellCcy ? `${sellTicker}|${sellCcy}` : ""} onChange={(e) => selectSellHolding(e.target.value)}>
                    <option value="">— pick a holding —</option>
                    {accountHoldings.map((h) => (
                      <option key={`${h.ticker}|${h.ccy}`} value={`${h.ticker}|${h.ccy}`}>
                        {h.ticker} ({h.ccy}) — {h.qty.toLocaleString()} sh{h.lastPrice ? ` · last $${h.lastPrice.toFixed(2)}` : ""}
                      </option>
                    ))}
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
                <label>Currency</label>
                <select value={buyCcy} onChange={(e) => setBuyCcy(e.target.value)}>
                  <option value="USD">USD</option><option value="CAD">CAD</option>
                </select>
              </div>
            </div>
            <div className="sa-modal-row">
              <div><label>Shares</label><input type="number" step="any" value={buyShares} onChange={(e) => setBuyShares(e.target.value)} placeholder="40" /></div>
              <div><label>Fill price</label><input type="number" step="any" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="75.50" /></div>
            </div>
            {buyCadVal > 0 && (
              <div style={{ fontSize: 12, color: "var(--sa-text-2)", marginTop: 4 }}>
                Gross: {buyCcy === "USD" ? `$${buyNum.toFixed(2)} USD ≈ ` : ""}${buyCadVal.toFixed(2)} CAD
              </div>
            )}
          </div>
        )}

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

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="sa-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sa-btn" onClick={handleSubmit} disabled={busy}>
            {busy ? "Recording…" : "Record trade"}
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
  const [advisorPerf, setAdvisorPerf] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true); setErr(null);
      try {
        const [snapRes, perfRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/stocks-portfolio/performance?days=365`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${BACKEND_URL}/api/stocks-advice/performance?days=30`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
        ]);
        const snapJ = await snapRes.json();
        const perfJ = await perfRes.json();
        if (!cancelled) {
          setSnaps(snapJ?.snapshots || []);
          setAdvisorPerf(perfJ);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  return (
    <div>
      <h2>Performance</h2>
      <div className="sa-breadcrumb">Portfolio value over time · advisor scorecard</div>

      {/* ── Advisor scorecard ── */}
      <div className="sa-card" style={{ marginBottom: 18 }}>
        <h3>If you had followed my advice</h3>
        {busy && <div className="sa-muted">Loading…</div>}
        {err && <div className="sa-err">{err}</div>}
        {!busy && advisorPerf && (
          advisorPerf.windows?.every((w) => w.recCount === 0) ? (
            <div className="sa-muted" style={{ fontSize: 13 }}>
              No tracked recommendations yet. Visit the Advice tab and click <b>🧠 Get fresh AI advice</b> — every actionable recommendation gets logged and scored here.
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

      {/* ── Portfolio value chart ── */}
      <div className="sa-card">
        <h3>Portfolio total value (last 12 months)</h3>
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
          <div style={{ fontSize: 26, fontWeight: 700 }}>${lastVal.toLocaleString(undefined, { maximumFractionDigits: 0 })} CAD</div>
          <div className="sa-muted" style={{ fontSize: 13 }}>Today</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: totalChange >= 0 ? "var(--sa-green)" : "var(--sa-red)" }}>
            {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}%
          </div>
          <div className="sa-muted" style={{ fontSize: 12 }}>
            {totalChangeAbs >= 0 ? "+" : "−"}${Math.abs(totalChangeAbs).toLocaleString(undefined, { maximumFractionDigits: 0 })} since first snapshot
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
