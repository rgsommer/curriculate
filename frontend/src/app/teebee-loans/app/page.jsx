// /teebee-loans/app — firm-internal loan-preparation workspace. Reuses
// TeebeePay email-PIN auth (Principal+). Intake → score the financials against
// lender benchmarks → close gaps + assemble the package → submit to a lender.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, LogOut,
  Plus, Trash2, Check, Gauge, FileCheck2, Send, RotateCcw, Info, TrendingUp, TrendingDown, Sparkles,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", line: "#e5e7eb",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  green: "#15803d", greenSoft: "#dcfce7",
  amber: "#b45309", amberSoft: "#fef3c7",
  red: "#b9302a", redSoft: "#fee2e2",
};
const TOKEN_KEY = "teebeepay.authToken";

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }

async function openPdf(path) {
  const tok = getToken();
  const r = await fetch(path, { headers: tok ? { Authorization: "Bearer " + tok } : {} });
  if (!r.ok) throw new Error("Could not generate the document.");
  const url = URL.createObjectURL(await r.blob());
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function api(path, opts = {}) {
  const tok = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const r = await fetch(path, { ...opts, headers });
  if (r.status === 401) setToken(null);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const K = (n) => "K" + (Number(n) || 0).toLocaleString("en-PG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const K2 = (n) => "K" + (Number(n) || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_META = {
  intake:        { label: "Intake",        bg: "#f1f5f9", fg: C.muted },
  assessed:      { label: "Assessed",      bg: C.goldSoft, fg: C.amber },
  package_ready: { label: "Package ready", bg: "#dbeafe", fg: "#1d4ed8" },
  submitted:     { label: "Submitted",     bg: C.greenSoft, fg: C.green },
};
const BAND_META = {
  ready:        { label: "Loan-ready", fg: C.green, bg: C.greenSoft },
  nearly_ready: { label: "Nearly ready", fg: C.amber, bg: C.amberSoft },
  not_ready:    { label: "Not ready", fg: C.red, bg: C.redSoft },
};
const BANDC = { strong: C.green, adequate: C.amber, weak: C.red };

export default function LoanAppPage() {
  const [view, setView] = useState("loading"); // loading | login | dashboard | application
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [apps, setApps] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setView("login"); return; }
    try {
      const j = await api("/api/loans/me");
      setMe(j.user); setMeta(j.meta);
      await loadApps();
      setView("dashboard");
    } catch { setView("login"); }
  }, []);
  async function loadApps() { const j = await api("/api/loans/applications"); setApps(j.applications || []); }
  useEffect(() => { loadMe(); }, [loadMe]);
  function signOut() { setToken(null); setMe(null); setView("login"); }

  return (
    <main style={{ minHeight: "100vh", background: "#f6f7fa", color: C.ink, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/teebee" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#fff" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.gold, color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>TBA</div>
          <strong style={{ fontSize: 15 }}>TeeBee Loans</strong>
        </Link>
        {me && <span style={{ fontSize: 12, color: "#9fb3cc" }}>{me.email}</span>}
        {me && (
          <button onClick={signOut} style={{ ...miniNav, marginLeft: "auto", cursor: "pointer", background: "transparent", border: "1px solid #3a526b" }}>
            <LogOut size={13} style={{ verticalAlign: -2, marginRight: 6 }} /> Sign out
          </button>
        )}
      </header>

      {view === "loading" && <Centered><Loader2 size={26} className="spin" color={C.gold} /></Centered>}
      {view === "login" && <LoginCard onSignedIn={loadMe} />}
      {view === "dashboard" && (
        <Dashboard apps={apps} meta={meta} onReload={loadApps}
          onPick={(id) => { setSelectedId(id); setView("application"); }} />
      )}
      {view === "application" && selectedId && (
        <ApplicationView appId={selectedId} meta={meta}
          onBack={async () => { await loadApps(); setSelectedId(null); setView("dashboard"); }} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin .9s linear infinite; }`}</style>
    </main>
  );
}

/* ──────────────── Login ──────────────── */
function LoginCard({ onSignedIn }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pinToken, setPinToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function requestPin() {
    setBusy(true); setError(""); setInfo("");
    try {
      const r = await fetch("/api/teebeepay/auth/request-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setPinToken(j.token); setInfo("Code sent. Check your email."); setStep("pin");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function verifyPin() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/teebeepay/auth/verify-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), pin, token: pinToken }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setToken(j.authToken); onSignedIn();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Centered>
      <div style={{ maxWidth: 420, background: "#fff", borderRadius: 14, padding: 28, border: "1px solid " + C.line, boxShadow: "0 8px 32px rgba(15,44,82,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>TBA</div>
          <div>
            <strong style={{ fontSize: 18 }}>Sign in to TeeBee Loans</strong>
            <div style={{ fontSize: 12, color: C.muted }}>Email and a 6-digit code — no password.</div>
          </div>
        </div>
        {error && <Flash type="error">{error}</Flash>}
        {info && <Flash type="info">{info}</Flash>}
        {step === "email" ? (
          <>
            <Field label="Email">
              <input style={input} type="email" value={email} placeholder="you@teebee.com.pg" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && requestPin()} autoFocus />
            </Field>
            <button onClick={requestPin} disabled={!email || busy} style={btnPrimary}>
              {busy ? <><Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> Sending…</> : <>Send code <ArrowRight size={15} style={{ verticalAlign: -2 }} /></>}
            </button>
          </>
        ) : (
          <>
            <Field label="6-digit code">
              <input style={input} value={pin} inputMode="numeric" maxLength={6} placeholder="123456" onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && pin.length === 6 && verifyPin()} autoFocus />
            </Field>
            <button onClick={verifyPin} disabled={pin.length !== 6 || busy} style={btnPrimary}>
              {busy ? <><Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> Verifying…</> : "Sign in"}
            </button>
            <button onClick={() => setStep("email")} style={btnGhost}>← Use a different email</button>
          </>
        )}
      </div>
    </Centered>
  );
}

/* ──────────────── Dashboard (pipeline) ──────────────── */
function Dashboard({ apps, meta, onReload, onPick }) {
  const [creating, setCreating] = useState(false);
  const counts = useMemo(() => {
    const c = { intake: 0, assessed: 0, package_ready: 0, submitted: 0 };
    for (const a of apps) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [apps]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18, gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Loan pipeline</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Score financials, close the gaps, assemble the package, submit.</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ ...pill, background: m.bg, color: m.fg }}>{counts[k] || 0} {m.label}</span>
          ))}
        </div>
      </div>

      {!creating ? (
        <button onClick={() => setCreating(true)} style={{ ...btnPrimaryInline, marginBottom: 18 }}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 5 }} /> New application
        </button>
      ) : (
        <IntakeForm meta={meta} onCancel={() => setCreating(false)} onCreated={async () => { setCreating(false); await onReload(); }} />
      )}

      {apps.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.muted, padding: 40 }}>
          No applications yet. Start one from client intake.
          <div style={{ marginTop: 14 }}>
            <button
              onClick={async () => { try { await api("/api/loans/seed-test-data", { method: "POST" }); await onReload(); } catch (e) { alert(e.message); } }}
              style={{ ...btnPrimaryInline, background: "#fff", color: C.navy, border: "1px solid " + C.line }}
            >
              Load sample data
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", color: C.muted }}>
                <th style={th}>Business</th><th style={th}>Purpose</th>
                <th style={{ ...th, textAlign: "right" }}>Facility</th>
                <th style={{ ...th, textAlign: "center" }}>Readiness</th>
                <th style={{ ...th, textAlign: "center" }}>Package</th>
                <th style={th}>Status</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const sm = STATUS_META[a.status] || STATUS_META.intake;
                const bm = a.score_band ? BAND_META[a.score_band] : null;
                return (
                  <tr key={a.id} style={{ borderTop: "1px solid " + C.line, cursor: "pointer" }} onClick={() => onPick(a.id)}>
                    <td style={td}><strong>{a.business_name}</strong>{a.lender && <div style={{ fontSize: 11, color: C.muted }}>{a.lender}</div>}</td>
                    <td style={td}>{a.purpose || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.loan_amount != null ? K(a.loan_amount) : "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {a.score == null ? <span style={{ color: C.muted }}>—</span>
                        : <span style={{ ...pill, background: bm.bg, color: bm.fg }}>{a.score} · {bm.label}</span>}
                    </td>
                    <td style={{ ...td, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{a.package.done}/{a.package.total}</td>
                    <td style={td}><span style={{ ...pill, background: sm.bg, color: sm.fg }}>{sm.label}</span></td>
                    <td style={{ ...td, textAlign: "right" }}><ArrowRight size={15} color={C.muted} /></td>
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

function IntakeForm({ meta, onCancel, onCreated }) {
  const [f, setF] = useState({ business_name: "", contact_name: "", contact_email: "", industry: "", purpose: "", loan_amount: "", term_years: "5", interest_rate: "9.5", lender: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function create() {
    setBusy(true); setError("");
    try { await api("/api/loans/applications", { method: "POST", body: JSON.stringify(f) }); onCreated(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <strong style={{ fontSize: 15 }}>New loan application</strong>
      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.4fr", gap: 12, marginTop: 12 }}>
        <Field label="Business name"><input style={input} value={f.business_name} onChange={set("business_name")} placeholder="Acme Trading Ltd" autoFocus /></Field>
        <Field label="Contact name"><input style={input} value={f.contact_name} onChange={set("contact_name")} placeholder="Jane Kila" /></Field>
        <Field label="Contact email"><input style={input} value={f.contact_email} onChange={set("contact_email")} placeholder="jane@acme.com.pg" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr", gap: 12 }}>
        <Field label="Industry"><input style={input} value={f.industry} onChange={set("industry")} placeholder="Wholesale / retail" /></Field>
        <Field label="Loan purpose">
          <select style={input} value={f.purpose} onChange={set("purpose")}>
            <option value="">Select…</option>
            {(meta?.purpose_options || []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.4fr", gap: 12 }}>
        <Field label="Loan amount (K)"><input style={input} type="number" value={f.loan_amount} onChange={set("loan_amount")} placeholder="500000" /></Field>
        <Field label="Term (years)"><input style={input} type="number" value={f.term_years} onChange={set("term_years")} /></Field>
        <Field label="Rate (%)"><input style={input} type="number" value={f.interest_rate} onChange={set("interest_rate")} /></Field>
        <Field label="Target lender (optional)"><input style={input} value={f.lender} onChange={set("lender")} placeholder="BSP / Kina / Westpac" /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={create} disabled={!f.business_name.trim() || !f.loan_amount || busy} style={btnPrimaryInline}>
          {busy ? <Loader2 size={14} className="spin" /> : "Create application"}
        </button>
        <button onClick={onCancel} style={btnGhostSm}>Cancel</button>
      </div>
    </div>
  );
}

/* ──────────────── Application detail ──────────────── */
function ApplicationView({ appId, meta, onBack }) {
  const [app, setApp] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { const j = await api(`/api/loans/applications/${appId}`); setApp(j.application); }
    catch (e) { setError(e.message); }
  }, [appId]);
  useEffect(() => { load(); }, [load]);

  async function act(action, extra = {}) {
    setBusy(action); setError("");
    try { const j = await api(`/api/loans/applications/${appId}`, { method: "PATCH", body: JSON.stringify({ action, ...extra }) }); setApp(j.application); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  if (!app) return <Centered>{error ? <Flash type="error">{error}</Flash> : <Loader2 size={24} className="spin" color={C.gold} />}</Centered>;
  const sm = STATUS_META[app.status] || STATUS_META.intake;
  const locked = app.status === "submitted";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 24px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={btnGhostSm}><ArrowLeft size={14} style={{ verticalAlign: -2 }} /> Pipeline</button>
        <button onClick={() => openPdf(`/api/loans/applications/${appId}/report`).catch((e) => setError(e.message))} style={btnGhostSm}>
          <FileCheck2 size={14} style={{ verticalAlign: -2 }} /> Download package (PDF)
        </button>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 21, margin: 0 }}>{app.business_name}</h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>
              {[app.purpose, app.industry, app.contact_name].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <span style={{ ...pill, background: sm.bg, color: sm.fg, marginLeft: "auto", fontSize: 12 }}>{sm.label}</span>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 14, paddingTop: 12, borderTop: "1px solid " + C.line, flexWrap: "wrap", fontSize: 13 }}>
          <KV label="Facility" v={K(app.loan_amount)} />
          <KV label="Term" v={`${app.term_years} yr`} />
          <KV label="Rate" v={`${app.interest_rate}%`} />
          {app.result && <KV label="Annual repayment" v={K2(app.result.proposed_annual_debt_service)} />}
          {app.lender && <KV label="Lender" v={app.lender} />}
        </div>
      </div>

      {error && <div style={{ marginBottom: 12 }}><Flash type="error">{error}</Flash></div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, alignItems: "start" }}>
        <FinancialsForm app={app} locked={locked} onSaved={setApp} />
        <ScoreCard app={app} />
      </div>

      <PackageChecklist app={app} meta={meta} locked={locked} busy={busy} act={act} />
      <WorkflowBar app={app} busy={busy} act={act} />

      <AiWriteup endpoint={`/api/loans/applications/${appId}/writeup`} initial={app.ai_writeup} reviewLabel="for accountant review" />
    </div>
  );
}

function AiWriteup({ endpoint, initial, reviewLabel }) {
  const [summary, setSummary] = useState(initial?.summary || "");
  const [cover, setCover] = useState(initial?.cover_letter || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const has = !!(summary || cover);
  const ta = { width: "100%", minHeight: 110, padding: "10px 12px", borderRadius: 9, border: "1px solid #d1d5db", fontSize: 13.5, lineHeight: 1.5, color: "#0f172a", fontFamily: "inherit", boxSizing: "border-box", outline: "none", resize: "vertical" };
  const lbl = { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.04, margin: "12px 0 6px" };

  async function generate() {
    setBusy("gen"); setError(""); setInfo("");
    try { const j = await api(endpoint, { method: "POST" }); setSummary(j.summary || ""); setCover(j.cover_letter || ""); setInfo("Draft generated — review and edit before use."); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  }
  async function save() {
    setBusy("save"); setError(""); setInfo("");
    try { await api(endpoint, { method: "PUT", body: JSON.stringify({ summary, cover_letter: cover }) }); setInfo("Saved — it will appear on the package PDF."); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 13, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Sparkles size={16} color="#c9a227" />
        <strong style={{ fontSize: 14 }}>Write-up</strong>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#b45309", background: "#fef3c7", padding: "2px 7px", borderRadius: 99, textTransform: "uppercase", letterSpacing: 0.04 }}>Draft — {reviewLabel}</span>
        <button onClick={generate} disabled={busy === "gen"} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8, border: "none", background: "#0f2c52", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {busy === "gen" ? <><Loader2 size={13} className="spin" /> Drafting…</> : <><Sparkles size={13} /> {has ? "Regenerate" : "Generate draft"}</>}
        </button>
      </div>
      {error && <div style={{ marginTop: 10, background: "#fef2f2", color: "#b9302a", border: "1px solid #fecaca", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
      {info && <div style={{ marginTop: 10, background: "#dcfce7", color: "#14532d", border: "1px solid #bbf7d0", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{info}</div>}
      {has && (
        <>
          <div style={lbl}>Credit summary</div>
          <textarea style={ta} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div style={lbl}>Cover letter</div>
          <textarea style={ta} value={cover} onChange={(e) => setCover(e.target.value)} />
          <button onClick={save} disabled={busy === "save"} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#0f2c52", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {busy === "save" ? <><Loader2 size={13} className="spin" /> Saving…</> : <><CheckCircle2 size={13} /> Save edits</>}
          </button>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 10 }}>Drafted from this application's data. Review and edit before issuing.</div>
        </>
      )}
    </div>
  );
}

function KV({ label, v }) {
  return <div><div style={{ color: C.muted, fontSize: 12 }}>{label}</div><div style={{ fontWeight: 600 }}>{v}</div></div>;
}

const FIN_ROWS = [
  ["current_assets", "Current assets"],
  ["current_liabilities", "Current liabilities"],
  ["inventory", "Inventory (of current assets)"],
  ["total_assets", "Total assets"],
  ["total_liabilities", "Total liabilities"],
  ["total_equity", "Total equity"],
  ["revenue", "Revenue"],
  ["net_profit", "Net profit after tax"],
  ["ebitda", "EBITDA"],
  ["existing_annual_debt_service", "Existing annual debt service"],
  ["collateral_value", "Collateral value offered"],
];

function FinancialsForm({ app, locked, onSaved }) {
  const init = app.financials || {};
  const [f, setF] = useState(() => {
    const o = {}; for (const [k] of FIN_ROWS) o[k] = init[k] ?? ""; return o;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true); setError("");
    try {
      const financials = {}; for (const [k] of FIN_ROWS) financials[k] = Number(f[k]) || 0;
      const j = await api(`/api/loans/applications/${app.id}`, { method: "PATCH", body: JSON.stringify({ action: "save_financials", financials }) });
      onSaved(j.application);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={card}>
      <SectionHead icon={<Gauge size={15} />} title="Financials" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FIN_ROWS.map(([k, label]) => (
          <label key={k} style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: C.inkSoft }}>{label}</span>
            <input style={{ ...input, padding: "7px 9px", textAlign: "right" }} type="number" value={f[k]} disabled={locked} placeholder="0" onChange={set(k)} />
          </label>
        ))}
      </div>
      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      {!locked && (
        <button onClick={save} disabled={busy} style={{ ...btnPrimaryInline, marginTop: 14 }}>
          {busy ? <Loader2 size={14} className="spin" /> : "Save & score"}
        </button>
      )}
    </div>
  );
}

function ScoreCard({ app }) {
  const r = app.result;
  if (!r) return (
    <div style={{ ...card, textAlign: "center", color: C.muted, padding: 30 }}>
      <Gauge size={26} color="#cbd5e1" /><div style={{ marginTop: 8, fontSize: 13 }}>Enter the financials to generate a readiness score.</div>
    </div>
  );
  const bm = BAND_META[r.band];
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ background: C.navy, color: "#fff", padding: "18px 18px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "#9fb3cc", textTransform: "uppercase", letterSpacing: ".05em" }}>Loan-readiness score</div>
        <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.1, color: C.gold }}>{r.score}<span style={{ fontSize: 18, color: "#9fb3cc" }}>/100</span></div>
        <span style={{ ...pill, background: bm.bg, color: bm.fg }}>{bm.label}</span>
        <div style={{ fontSize: 12, color: "#9fb3cc", marginTop: 10 }}>
          DSCR cover on {K2(r.total_annual_debt_service)}/yr total debt service
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {r.metrics.map((m) => (
          <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: BANDC[m.band], flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: C.inkSoft, flex: 1 }}>{m.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: BANDC[m.band] }} title={m.benchmark}>{m.display}</span>
          </div>
        ))}
        {r.strengths.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...miniLabel, color: C.green }}><TrendingUp size={12} style={{ verticalAlign: -2 }} /> Strengths</div>
            {r.strengths.map((s, i) => <div key={i} style={{ fontSize: 12, color: C.inkSoft }}>• {s}</div>)}
          </div>
        )}
        {r.gaps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ ...miniLabel, color: C.red }}><TrendingDown size={12} style={{ verticalAlign: -2 }} /> Gaps to close</div>
            {r.gaps.map((s, i) => <div key={i} style={{ fontSize: 12, color: C.inkSoft }}>• {s}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function PackageChecklist({ app, meta, locked, busy, act }) {
  const items = meta?.package_checklist || [];
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SectionHead icon={<FileCheck2 size={15} />} title="Financing package" />
        <span style={{ ...pill, background: app.package.pct === 100 ? C.greenSoft : "#f1f5f9", color: app.package.pct === 100 ? C.green : C.muted, marginLeft: "auto", marginBottom: 14 }}>
          {app.package.done}/{app.package.total} ready
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {items.map((c) => {
          const on = !!app.checklist?.[c.key];
          return (
            <button key={c.key} disabled={locked || busy === "toggle_doc"} onClick={() => act("toggle_doc", { key: c.key, value: !on })}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, border: "1px solid " + (on ? C.green : C.line), background: on ? C.greenSoft : "#fff", cursor: locked ? "default" : "pointer", textAlign: "left" }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, background: on ? C.green : "#fff", border: "1px solid " + (on ? C.green : "#cbd5e1"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {on && <Check size={12} color="#fff" />}
              </span>
              <span style={{ fontSize: 12.5, color: on ? C.green : C.inkSoft }}>{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowBar({ app, busy, act }) {
  return (
    <div style={{ ...card, marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: C.muted, marginRight: 6 }}>Workflow:</span>
      {app.status === "intake" && (
        <button onClick={() => act("assess")} disabled={!app.financials || busy === "assess"} style={btnPrimaryInline} title={!app.financials ? "Enter the financials first" : ""}>
          {busy === "assess" ? <Loader2 size={14} className="spin" /> : <><Gauge size={14} style={{ verticalAlign: -2 }} /> Mark assessed</>}
        </button>
      )}
      {app.status === "assessed" && (
        <button onClick={() => act("package_ready")} disabled={busy === "package_ready" || app.package.pct !== 100} style={btnPrimaryInline}
          title={app.package.pct !== 100 ? "Complete the package checklist first" : ""}>
          {busy === "package_ready" ? <Loader2 size={14} className="spin" /> : <><FileCheck2 size={14} style={{ verticalAlign: -2 }} /> Package ready</>}
        </button>
      )}
      {app.status === "package_ready" && <SubmitButton app={app} busy={busy} act={act} />}
      {app.status === "submitted" && (
        <span style={{ ...pill, background: C.greenSoft, color: C.green }}>
          <Send size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Submitted{app.lender ? ` to ${app.lender}` : ""}{app.submitted_at ? ` · ${new Date(app.submitted_at).toLocaleDateString()}` : ""}
        </span>
      )}
      {app.status !== "intake" && (
        <button onClick={() => act("reopen")} disabled={busy === "reopen"} style={{ ...btnGhostSm, marginLeft: "auto" }}>
          {busy === "reopen" ? <Loader2 size={13} className="spin" /> : <><RotateCcw size={13} style={{ verticalAlign: -2 }} /> Reopen</>}
        </button>
      )}
      {app.status === "assessed" && app.package.pct !== 100 && (
        <span style={{ fontSize: 11.5, color: C.amber, width: "100%" }}>
          <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> {app.package.total - app.package.done} package document(s) still outstanding.
        </span>
      )}
    </div>
  );
}

function SubmitButton({ app, busy, act }) {
  const [lender, setLender] = useState(app.lender || "");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input style={{ ...input, padding: "7px 9px", width: 190 }} value={lender} onChange={(e) => setLender(e.target.value)} placeholder="Lender (BSP / Kina…)" />
      <button onClick={() => act("submit", { lender })} disabled={!lender.trim() || busy === "submit"} style={btnPrimaryInline}>
        {busy === "submit" ? <Loader2 size={14} className="spin" /> : <><Send size={14} style={{ verticalAlign: -2 }} /> Submit to lender</>}
      </button>
    </div>
  );
}

/* ──────────────── shared UI ──────────────── */
function SectionHead({ icon, title }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, color: C.navy }}>
    <span style={{ color: C.gold }}>{icon}</span><strong style={{ fontSize: 15 }}>{title}</strong>
  </div>;
}
function Centered({ children }) { return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "60px 20px" }}>{children}</div>; }
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}>
    <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>{label}</div>{children}
  </label>;
}
function Flash({ type, children }) {
  const map = { error: { bg: "#fef2f2", fg: C.red, Icon: AlertCircle }, info: { bg: "#eff6ff", fg: "#1d4ed8", Icon: Info }, success: { bg: C.greenSoft, fg: C.green, Icon: CheckCircle2 } };
  const s = map[type] || map.info; const Icon = s.Icon;
  return <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: s.bg, color: s.fg, padding: "9px 12px", borderRadius: 9, fontSize: 13 }}>
    <Icon size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{children}</span>
  </div>;
}

const card = { background: "#fff", border: "1px solid " + C.line, borderRadius: 13, padding: 18, boxShadow: "0 1px 3px rgba(15,44,82,.04)" };
const input = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 14, color: C.ink, background: "#fff", boxSizing: "border-box", outline: "none" };
const th = { padding: "10px 14px", fontWeight: 600, fontSize: 12 };
const td = { padding: "11px 14px", verticalAlign: "top" };
const miniLabel = { fontSize: 11.5, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".03em" };
const miniNav = { fontSize: 12.5, color: "#cdd9e8", textDecoration: "none", padding: "5px 10px", borderRadius: 7 };
const pill = { fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" };
const btnPrimary = { width: "100%", padding: "11px 16px", borderRadius: 10, border: "none", background: C.navy, color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer", marginTop: 6 };
const btnPrimaryInline = { padding: "9px 15px", borderRadius: 9, border: "none", background: C.navy, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const btnGhost = { width: "100%", padding: "9px", borderRadius: 9, border: "none", background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", marginTop: 8 };
const btnGhostSm = { padding: "7px 12px", borderRadius: 8, border: "1px solid " + C.line, background: "#fff", color: C.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 };
