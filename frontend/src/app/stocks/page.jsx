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
  const saveTimerRef = useRef(null);
  const savedTimerRef = useRef(null);

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

  // Shared refresh-prices flow (used by Positions and Advice tabs)
  const refreshPrices = async () => {
    const tickers = [...new Set(user.positions.map((p) => p.ticker))];
    if (tickers.length === 0) { showToast("No positions to refresh."); return { ok: 0, fail: 0 }; }
    showToast(`Fetching ${tickers.length} tickers…`);
    let ok = 0, fail = 0;
    const updated = [...user.positions];
    for (const t of tickers) {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`);
        if (!r.ok) throw 0;
        const j = await r.json();
        const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
        const ccy = j?.chart?.result?.[0]?.meta?.currency;
        if (price) {
          updated.forEach((p, i) => {
            if (p.ticker === t) {
              if (ccy === "USD") updated[i] = { ...p, priceUsd: price };
              else if (ccy === "CAD") updated[i] = { ...p, priceCad: price };
            }
          });
          ok++;
        } else fail++;
      } catch { fail++; }
    }
    updateUser(() => ({ positions: updated }));
    showToast(`Fetched ${ok}/${tickers.length}. ${fail ? `${fail} CORS-blocked — enter manually.` : ""}`);
    return { ok, fail };
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
          {currentTab === "dashboard" && <DashboardView user={user} onTab={setCurrentTab} />}
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
          {currentTab === "advice" && <AdviceView user={user} onRefresh={refreshPrices} />}
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

function DashboardView({ user, onTab }) {
  const fx = user.fxUsdCad || 1.37;
  const total = totalCad(user.positions, fx);
  const agg = aggregateByTicker(user.positions, fx);
  const top = agg.slice(0, 8);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const advice = generateAdvice(user).slice(0, 3);

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="sa-breadcrumb">{today}</div>
      <div className="sa-disclaimer">Research and education only. Not licensed investment advice. Prices stored locally; refresh prices on the Positions tab.</div>
      <div className="sa-stats">
        <div className="sa-stat"><div className="label">Total value (CAD)</div><div className="value">{fmtMoney(total, "CAD")}</div></div>
        <div className="sa-stat"><div className="label">Positions</div><div className="value">{user.positions.length}</div></div>
        <div className="sa-stat"><div className="label">Unique tickers</div><div className="value">{agg.length}</div></div>
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

function AdviceView({ user, onRefresh }) {
  const [busy, setBusy] = useState(false);
  // useMemo on `user` ensures advice recomputes immediately when prices update
  const advice = useMemo(() => generateAdvice(user), [user]);

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    try { await onRefresh(); } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <div>
          <h2>Advice</h2>
          <div className="sa-breadcrumb">Rule-based signals from your current portfolio</div>
        </div>
        <button className="sa-btn" onClick={handleRefresh} disabled={busy} title="Re-fetch prices from Yahoo Finance and re-run the advice engine">
          {busy ? "Refreshing…" : "↻ Refresh prices + advice"}
        </button>
      </div>
      <div className="sa-disclaimer">⚠️ Research and education only. Not licensed investment advice. Decisions are yours.</div>
      {advice.map((c, i) => (
        <div key={i} className={`sa-advice-card ${c.sev === "danger" ? "danger" : c.sev === "warn" ? "warn" : c.sev === "good" ? "good" : ""}`}>
          <h3>{c.title}</h3>
          <p>{c.body}</p>
          {c.meta && <div className="meta">{c.meta}</div>}
        </div>
      ))}
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
  backdrop-filter: blur(4px); display: flex; align-items: center;
  justify-content: center; padding: 24px; z-index: 100;
  animation: sa-fade .15s ease;
}
.sa-modal {
  background: var(--sa-panel); border: 1px solid var(--sa-border);
  border-radius: 18px; padding: 28px; width: 100%; max-width: 500px;
  box-shadow: var(--sa-shadow-lg); animation: sa-pop .2s ease;
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
