"use client";

/**
 * Curriculate.net/stocks — Personal Stock Advisor
 *
 * Self-contained client-side app:
 *   • Email + 4-digit PIN signup/login (any user)
 *   • Risk tolerance picker
 *   • Multi-account portfolio CRUD
 *   • Rule-based advice engine
 *   • Yahoo Finance price-refresh attempt
 *
 * Data: localStorage today. To wire to MongoDB / shared auth, swap the
 *   loadAll/saveAll calls in the storage layer for fetches against
 *   /api/stocks/* (TODO — Phase 2).
 */

import React, { useEffect, useMemo, useState } from "react";

// =============================================================================
// Storage layer (localStorage; per-email scope)
// =============================================================================
const STORAGE_KEY = "stocksAdvisor.v1";

function loadAll() {
  if (typeof window === "undefined") return { users: {}, current: null };
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { users: {}, current: null };
  } catch {
    return { users: {}, current: null };
  }
}

function saveAll(s) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// Auth is server-side: PIN is emailed via /api/stocks/request-pin and
// verified via /api/stocks/verify-pin. The server returns a 30-day
// session token we keep in localStorage.

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
  const [state, setState] = useState({ users: {}, current: null });
  const [hydrated, setHydrated] = useState(false);
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [modalIdx, setModalIdx] = useState(undefined); // undefined = closed, null = new, number = edit

  // Hydrate from localStorage on mount
  useEffect(() => {
    setState(loadAll());
    setHydrated(true);
  }, []);

  const persist = (next) => {
    setState(next);
    saveAll(next);
  };

  const user = state.current ? state.users[state.current] : null;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Avoid SSR flash — render nothing until localStorage hydrated
  if (!hydrated) {
    return <FullscreenShell><div style={{ padding: 40, color: "#8a99b3" }}>Loading…</div></FullscreenShell>;
  }

  // === AUTH ===
  if (!state.current) {
    return (
      <FullscreenShell>
        <AuthView
          onSuccess={(email, sessionToken) => {
            const next = { ...state };
            if (!next.users[email]) {
              next.users[email] = {
                email,
                sessionToken,
                riskTolerance: null,
                positions: [],
                accounts: [],
                fxUsdCad: 1.372,
                createdAt: Date.now(),
              };
              // Seed Richard's portfolio on first sign-in
              if (email === "rgsommer@me.com") {
                next.users[email] = {
                  ...next.users[email],
                  riskTolerance: RICHARD_PORTFOLIO.riskTolerance,
                  accounts: RICHARD_PORTFOLIO.accounts,
                  positions: RICHARD_PORTFOLIO.positions,
                  fxUsdCad: RICHARD_PORTFOLIO.fxUsdCad,
                };
              }
            } else {
              next.users[email] = { ...next.users[email], sessionToken };
            }
            next.current = email;
            persist(next);
          }}
        />
      </FullscreenShell>
    );
  }

  // === ONBOARDING ===
  if (!user.riskTolerance) {
    return (
      <FullscreenShell>
        <OnboardingView
          onPick={(v) => {
            const next = { ...state };
            next.users[next.current] = { ...next.users[next.current], riskTolerance: v };
            persist(next);
          }}
        />
      </FullscreenShell>
    );
  }

  // === APP ===
  const updateUser = (mut) => {
    const next = { ...state };
    next.users[next.current] = { ...next.users[next.current], ...mut(next.users[next.current]) };
    persist(next);
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
            <button
              className="sa-btn ghost"
              style={{ display: "block", marginTop: 8, padding: "4px 0" }}
              onClick={() => persist({ ...state, current: null })}
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
              onRefreshPrices={async () => {
                const tickers = [...new Set(user.positions.map((p) => p.ticker))];
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
                showToast(`Fetched ${ok}/${tickers.length}. ${fail ? `${fail} failed (CORS) — manual entry.` : ""}`);
              }}
            />
          )}
          {currentTab === "advice" && <AdviceView user={user} />}
          {currentTab === "settings" && (
            <SettingsView
              user={user}
              onChangeRisk={(v) => { updateUser(() => ({ riskTolerance: v })); showToast("Risk tolerance updated"); }}
              onChangeFx={(v) => { updateUser(() => ({ fxUsdCad: v })); showToast("FX updated"); }}
              onReset={() => {
                if (confirm("Wipe all your positions and settings?")) {
                  const next = { ...state };
                  delete next.users[next.current];
                  next.current = null;
                  persist(next);
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

function AdviceView({ user }) {
  const advice = useMemo(() => generateAdvice(user), [user]);
  return (
    <div>
      <h2>Advice</h2>
      <div className="sa-breadcrumb">Rule-based signals from your current portfolio</div>
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
      body.stocks-app-mode .site-header,
      body.stocks-app-mode .site-footer { display: none !important; }
      body.stocks-app-mode { background: #0b0f17; }

      .stocks-root {
        --sa-bg:#0b0f17; --sa-panel:#121826; --sa-panel-2:#1a2236; --sa-border:#1f2940;
        --sa-text:#e6ecf5; --sa-muted:#8a99b3; --sa-accent:#5b8def; --sa-accent-2:#7aa9ff;
        --sa-green:#22c55e; --sa-red:#ef4444; --sa-amber:#f59e0b; --sa-purple:#a78bfa;
        background: var(--sa-bg); color: var(--sa-text); min-height: 100vh;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .stocks-root *, .stocks-root *::before, .stocks-root *::after { box-sizing: border-box; }
      .stocks-root input, .stocks-root select, .stocks-root textarea {
        font: inherit; color: inherit; background: var(--sa-panel-2);
        border: 1px solid var(--sa-border); border-radius: 8px; padding: 9px 11px; outline: none; width: 100%;
      }
      .stocks-root input:focus, .stocks-root select:focus { border-color: var(--sa-accent); }
      .stocks-root label { font-size: 12px; color: var(--sa-muted); display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
      .stocks-root h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: -.01em; color: var(--sa-text); }
      .stocks-root h3 { color: var(--sa-text); margin: 0 0 12px; font-size: 14px; }
      .sa-breadcrumb { color: var(--sa-muted); font-size: 13px; margin-bottom: 24px; }

      .sa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px;
        background: var(--sa-accent); color: #fff; border: none; border-radius: 8px; font-weight: 600;
        font: inherit; cursor: pointer; transition: .15s; }
      .sa-btn:hover { background: var(--sa-accent-2); }
      .sa-btn:disabled { opacity: .5; cursor: not-allowed; }
      .sa-btn.secondary { background: transparent; border: 1px solid var(--sa-border); color: var(--sa-text); }
      .sa-btn.secondary:hover { background: var(--sa-panel-2); }
      .sa-btn.danger { background: var(--sa-red); }
      .sa-btn.ghost { background: transparent; color: var(--sa-muted); padding: 6px 10px; }
      .sa-btn.ghost:hover { color: var(--sa-text); }

      .sa-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
      .sa-badge.green { background: rgba(34,197,94,.15); color: var(--sa-green); }
      .sa-badge.red { background: rgba(239,68,68,.15); color: var(--sa-red); }
      .sa-badge.amber { background: rgba(245,158,11,.15); color: var(--sa-amber); }
      .sa-badge.purple { background: rgba(167,139,250,.15); color: var(--sa-purple); }
      .sa-muted { color: var(--sa-muted); }

      .sa-card { background: var(--sa-panel); border: 1px solid var(--sa-border); border-radius: 12px; padding: 18px; }

      .sa-auth { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .sa-auth-card { width: 100%; max-width: 420px; background: var(--sa-panel); border: 1px solid var(--sa-border);
        border-radius: 12px; padding: 32px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      .sa-auth-card h1 { margin: 0 0 4px; font-size: 24px; color: var(--sa-text); }
      .sa-sub { color: var(--sa-muted); margin-bottom: 24px; font-size: 13px; }
      .sa-row { margin-bottom: 14px; }
      .sa-pin { display: flex; gap: 8px; justify-content: space-between; }
      .sa-pin input { text-align: center; font-size: 20px; font-weight: 600; letter-spacing: .1em; width: 48px; height: 54px; }
      .sa-err { background: rgba(239,68,68,.1); color: var(--sa-red); padding: 10px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
      .sa-switch { text-align: center; margin-top: 14px; font-size: 13px; color: var(--sa-muted); }

      .sa-app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
      .sa-side { background: var(--sa-panel); border-right: 1px solid var(--sa-border); padding: 24px 16px;
        display: flex; flex-direction: column; gap: 6px; }
      .sa-brand { font-weight: 700; font-size: 18px; letter-spacing: -.01em; margin-bottom: 24px; padding: 0 8px; }
      .sa-brand span { color: var(--sa-accent-2); }
      .sa-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
      .sa-nav button { display: flex; align-items: center; gap: 10px; padding: 9px 12px;
        background: transparent; border: none; border-radius: 8px; color: var(--sa-muted);
        text-align: left; font: inherit; font-weight: 500; cursor: pointer; width: 100%; }
      .sa-nav button:hover { background: var(--sa-panel-2); color: var(--sa-text); }
      .sa-nav button.active { background: var(--sa-panel-2); color: var(--sa-text); }
      .sa-nav button .dot { width: 6px; height: 6px; border-radius: 3px; background: var(--sa-accent); }
      .sa-user { font-size: 12px; color: var(--sa-muted); padding: 12px 8px; border-top: 1px solid var(--sa-border); }
      .sa-main { padding: 28px 36px; overflow: auto; }
      @media (max-width: 980px) { .sa-app { grid-template-columns: 1fr; } .sa-side { display: none; } }

      .sa-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
      .sa-stat { background: var(--sa-panel); border: 1px solid var(--sa-border); border-radius: 12px; padding: 16px; }
      .sa-stat .label { font-size: 11px; color: var(--sa-muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
      .sa-stat .value { font-size: 22px; font-weight: 700; letter-spacing: -.01em; }

      .sa-grid-2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; }
      @media (max-width: 980px) { .sa-grid-2 { grid-template-columns: 1fr; } }

      .sa-alloc-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--sa-border); }
      .sa-alloc-row:last-child { border-bottom: none; }
      .sa-alloc-row .tk { flex: 0 0 90px; font-weight: 600; }
      .sa-alloc-row .bar { flex: 1; height: 6px; background: var(--sa-panel-2); border-radius: 3px; overflow: hidden; }
      .sa-alloc-row .bar > div { height: 100%; background: var(--sa-accent); border-radius: 3px; }
      .sa-alloc-row .pct { flex: 0 0 60px; text-align: right; color: var(--sa-muted); font-variant-numeric: tabular-nums; }

      .sa-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      .sa-table th, .sa-table td { padding: 10px 8px; text-align: right; border-bottom: 1px solid var(--sa-border); }
      .sa-table th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--sa-muted); font-weight: 500; }
      .sa-table th:first-child, .sa-table td:first-child { text-align: left; }
      .sa-table tr:hover td { background: var(--sa-panel-2); }
      .sa-table td.tk { font-weight: 600; }
      .sa-table td.tk .sub { display: block; font-size: 11px; color: var(--sa-muted); font-weight: 400; }

      .sa-advice-card { background: var(--sa-panel); border: 1px solid var(--sa-border); border-radius: 12px;
        padding: 20px; margin-bottom: 14px; border-left: 3px solid var(--sa-accent); }
      .sa-advice-card.warn { border-left-color: var(--sa-amber); }
      .sa-advice-card.danger { border-left-color: var(--sa-red); }
      .sa-advice-card.good { border-left-color: var(--sa-green); }
      .sa-advice-card h3 { margin: 0 0 8px; font-size: 15px; }
      .sa-advice-card p { margin: 0 0 8px; line-height: 1.55; }
      .sa-advice-card .meta { font-size: 12px; color: var(--sa-muted); }

      .sa-disclaimer { font-size: 11px; color: var(--sa-muted); background: var(--sa-panel-2);
        padding: 10px 14px; border-radius: 8px; margin-bottom: 18px; line-height: 1.5; }

      .sa-risk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .sa-risk-card { padding: 14px; border: 1px solid var(--sa-border); border-radius: 10px; cursor: pointer; transition: .15s; }
      .sa-risk-card:hover { border-color: var(--sa-accent); }
      .sa-risk-card.sel { border-color: var(--sa-accent); background: rgba(91,141,239,.08); }
      .sa-risk-card h4 { margin: 0 0 4px; font-size: 14px; color: var(--sa-text); }
      .sa-risk-card p { margin: 0; font-size: 12px; color: var(--sa-muted); line-height: 1.4; }

      .sa-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex;
        align-items: center; justify-content: center; padding: 24px; z-index: 100; }
      .sa-modal { background: var(--sa-panel); border: 1px solid var(--sa-border); border-radius: 12px;
        padding: 24px; width: 100%; max-width: 480px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
      .sa-modal h3 { margin: 0 0 16px; }
      .sa-modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
      .sa-modal-row.three { grid-template-columns: 1fr 1fr 1fr; }

      .sa-empty { text-align: center; padding: 40px 20px; color: var(--sa-muted); }
      .sa-empty .sa-btn { margin-top: 14px; }

      .sa-toast { position: fixed; bottom: 24px; right: 24px; background: var(--sa-panel);
        border: 1px solid var(--sa-border); border-left: 3px solid var(--sa-green);
        padding: 12px 18px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
        z-index: 200; animation: sa-in .25s; }
      @keyframes sa-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;

function StocksCSS() {
  return <style dangerouslySetInnerHTML={{ __html: STOCKS_CSS }} />;
}
