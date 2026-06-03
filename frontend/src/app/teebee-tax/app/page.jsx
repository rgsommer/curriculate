// /teebee-tax/app — firm-internal tax workspace. Reuses TeebeePay email-PIN
// auth (Principal+ only). Prepare a return → enter the computation → review →
// file. Company income tax, individual income tax and GST.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, LogOut,
  Plus, Trash2, Check, FileText, Calculator, Stamp, RotateCcw, Info, Sparkles,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", line: "#e5e7eb",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  green: "#15803d", greenSoft: "#dcfce7",
  red: "#b9302a", amber: "#b45309",
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

// Multipart upload (no JSON Content-Type so the browser sets the boundary).
async function apiUpload(path, formData) {
  const tok = getToken();
  const r = await fetch(path, { method: "POST", headers: tok ? { Authorization: "Bearer " + tok } : {}, body: formData });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

// Client mirror of api/tax/_docs.ts checklistForTaxType (slot + label + required).
const TAX_DOC_CHECKLIST = {
  cit: [
    { slot: "financial_statements", label: "Financial statements (P&L, balance sheet)", required: true },
    { slot: "trial_balance", label: "Trial balance", required: false },
    { slot: "adjustments_workpaper", label: "Tax adjustments / computation workpaper", required: false },
    { slot: "depreciation_schedule", label: "Fixed-asset / depreciation schedule", required: false },
    { slot: "provisional_tax", label: "Provisional tax / instalment receipts", required: false },
    { slot: "prior_return", label: "Prior-year return / IRC assessment", required: false },
    { slot: "bank_statements", label: "Bank statements", required: false },
  ],
  individual: [
    { slot: "salary_summary", label: "Salary / wages summary (Form S, payment summary)", required: true },
    { slot: "other_income", label: "Other income evidence (rent, dividends, interest)", required: false },
    { slot: "deductions_evidence", label: "Deduction evidence (donations, etc.)", required: false },
    { slot: "prior_return", label: "Prior-year return / IRC assessment", required: false },
    { slot: "bank_statements", label: "Bank statements", required: false },
  ],
  gst: [
    { slot: "sales_ledger", label: "Sales ledger / output-tax workings", required: true },
    { slot: "purchases_ledger", label: "Purchases ledger / input-tax workings", required: true },
    { slot: "gst_invoices", label: "Tax invoices (sample)", required: false },
    { slot: "prior_return", label: "Prior-year return / IRC assessment", required: false },
    { slot: "bank_statements", label: "Bank statements", required: false },
  ],
};
function taxDocsFor(type) {
  return TAX_DOC_CHECKLIST[type] || [
    { slot: "prior_return", label: "Prior-year return / IRC assessment", required: false },
    { slot: "bank_statements", label: "Bank statements", required: false },
  ];
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

const K = (n) => "K" + (Number(n) || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (f) => (Number(f) * 100).toFixed(Number.isInteger(Number(f) * 100) ? 0 : 1) + "%";

const STATUS_META = {
  draft:    { label: "Draft",    bg: "#f1f5f9", fg: C.muted },
  prepared: { label: "Prepared", bg: C.goldSoft, fg: C.amber },
  reviewed: { label: "Reviewed", bg: "#dbeafe", fg: "#1d4ed8" },
  filed:    { label: "Filed",    bg: C.greenSoft, fg: C.green },
};

export default function TaxAppPage() {
  const [view, setView] = useState("loading"); // loading | login | dashboard | return
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [returns, setReturns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setView("login"); return; }
    try {
      const j = await api("/api/tax/me");
      setMe(j.user); setMeta(j.meta);
      await loadReturns();
      setView("dashboard");
    } catch { setView("login"); }
  }, []);

  async function loadReturns() {
    const j = await api("/api/tax/returns");
    setReturns(j.returns || []);
  }

  useEffect(() => { loadMe(); }, [loadMe]);

  function signOut() { setToken(null); setMe(null); setView("login"); }

  return (
    <main style={{
      minHeight: "100vh", background: "#f6f7fa", color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <header style={{ background: C.navy, color: "#fff", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/teebee" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#fff" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.gold, color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>TBA</div>
          <strong style={{ fontSize: 15 }}>TeeBee Tax</strong>
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
        <Dashboard me={me} returns={returns} onReload={loadReturns}
          onPick={(id) => { setSelectedId(id); setView("return"); }} />
      )}
      {view === "return" && selectedId && (
        <ReturnView returnId={selectedId} me={me} meta={meta}
          onBack={async () => { await loadReturns(); setSelectedId(null); setView("dashboard"); }} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin .9s linear infinite; }`}</style>
    </main>
  );
}

/* ──────────────── Login (email-PIN, reuses TeebeePay auth) ──────────────── */

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
      const r = await fetch("/api/teebeepay/auth/request-pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setPinToken(j.token); setInfo("Code sent. Check your email.");
      setStep("pin");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function verifyPin() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/teebeepay/auth/verify-pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), pin, token: pinToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setToken(j.authToken);
      onSignedIn();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Centered>
      <div style={{ maxWidth: 420, background: "#fff", borderRadius: 14, padding: 28, border: "1px solid " + C.line, boxShadow: "0 8px 32px rgba(15,44,82,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>TBA</div>
          <div>
            <strong style={{ fontSize: 18 }}>Sign in to TeeBee Tax</strong>
            <div style={{ fontSize: 12, color: C.muted }}>Email and a 6-digit code — no password.</div>
          </div>
        </div>
        {error && <Flash type="error">{error}</Flash>}
        {info && <Flash type="info">{info}</Flash>}
        {step === "email" ? (
          <>
            <Field label="Email">
              <input style={input} type="email" value={email} placeholder="you@teebee.com.pg"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && requestPin()} autoFocus />
            </Field>
            <button onClick={requestPin} disabled={!email || busy} style={btnPrimary}>
              {busy ? <><Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> Sending…</> : <>Send code <ArrowRight size={15} style={{ verticalAlign: -2 }} /></>}
            </button>
          </>
        ) : (
          <>
            <Field label="6-digit code">
              <input style={input} value={pin} inputMode="numeric" maxLength={6} placeholder="123456"
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && pin.length === 6 && verifyPin()} autoFocus />
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

/* ──────────────────────────────── Dashboard ─────────────────────────────── */

function Dashboard({ me, returns, onReload, onPick }) {
  const [creating, setCreating] = useState(false);
  const counts = useMemo(() => {
    const c = { draft: 0, prepared: 0, reviewed: 0, filed: 0 };
    for (const r of returns) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [returns]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18, gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Tax returns</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Prepare → review → file. PNG IRC rates built in.</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k} style={{ ...pill, background: m.bg, color: m.fg }}>{counts[k] || 0} {m.label}</span>
          ))}
        </div>
      </div>

      {!creating ? (
        <button onClick={() => setCreating(true)} style={{ ...btnPrimaryInline, marginBottom: 18 }}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 5 }} /> New return
        </button>
      ) : (
        <NewReturnForm onCancel={() => setCreating(false)} onCreated={async () => { setCreating(false); await onReload(); }} />
      )}

      {returns.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.muted, padding: 40 }}>
          No returns yet. Create one to start a computation.
          <div style={{ marginTop: 14 }}>
            <button
              onClick={async () => { try { await api("/api/tax/seed-test-data", { method: "POST" }); await onReload(); } catch (e) { alert(e.message); } }}
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
                <th style={th}>Taxpayer</th><th style={th}>Type</th><th style={th}>Period</th>
                <th style={{ ...th, textAlign: "right" }}>Tax payable</th><th style={th}>Status</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => {
                const payable = r.result ? (r.result.tax_payable ?? r.result.tax ?? r.result.net_gst ?? 0) : null;
                const refund = r.result?.refund_due || 0;
                const sm = STATUS_META[r.status] || STATUS_META.draft;
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid " + C.line, cursor: "pointer" }} onClick={() => onPick(r.id)}>
                    <td style={td}><strong>{r.taxpayer_name}</strong>{r.tin && <div style={{ fontSize: 11, color: C.muted }}>TIN {r.tin}</div>}</td>
                    <td style={td}>{r.type_label}</td>
                    <td style={td}>{r.period || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {payable == null ? <span style={{ color: C.muted }}>—</span>
                        : refund > 0 ? <span style={{ color: C.green }}>{K(refund)} refund</span>
                        : <span>{K(payable)}</span>}
                    </td>
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

function NewReturnForm({ onCancel, onCreated }) {
  const [f, setF] = useState({ taxpayer_name: "", tin: "", tax_type: "cit", period: "", fy_end: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function create() {
    setBusy(true); setError("");
    try {
      await api("/api/tax/returns", { method: "POST", body: JSON.stringify(f) });
      onCreated();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <strong style={{ fontSize: 15 }}>New tax return</strong>
      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
        <Field label="Taxpayer name"><input style={input} value={f.taxpayer_name} onChange={set("taxpayer_name")} placeholder="Acme Trading Ltd" autoFocus /></Field>
        <Field label="TIN (optional)"><input style={input} value={f.tin} onChange={set("tin")} placeholder="500000000" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 4 }}>
        <Field label="Return type">
          <select style={input} value={f.tax_type} onChange={set("tax_type")}>
            <option value="cit">Company Income Tax</option>
            <option value="individual">Individual Income Tax</option>
            <option value="gst">GST return</option>
          </select>
        </Field>
        <Field label="Period"><input style={input} value={f.period} onChange={set("period")} placeholder="2025" /></Field>
        <Field label="Year-end (optional)"><input style={input} value={f.fy_end} onChange={set("fy_end")} placeholder="31 Dec 2025" /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={create} disabled={!f.taxpayer_name.trim() || busy} style={btnPrimaryInline}>
          {busy ? <Loader2 size={14} className="spin" /> : "Create return"}
        </button>
        <button onClick={onCancel} style={btnGhostSm}>Cancel</button>
      </div>
    </div>
  );
}

/* ────────────────────────────── Return detail ───────────────────────────── */

function ReturnView({ returnId, me, meta, onBack }) {
  const [ret, setRet] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { const j = await api(`/api/tax/returns/${returnId}`); setRet(j.return); }
    catch (e) { setError(e.message); }
  }, [returnId]);
  useEffect(() => { load(); }, [load]);

  async function act(action, extra = {}) {
    setBusy(action); setError("");
    try {
      const j = await api(`/api/tax/returns/${returnId}`, { method: "PATCH", body: JSON.stringify({ action, ...extra }) });
      setRet(j.return);
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  if (!ret) return <Centered>{error ? <Flash type="error">{error}</Flash> : <Loader2 size={24} className="spin" color={C.gold} />}</Centered>;

  const sm = STATUS_META[ret.status] || STATUS_META.draft;
  const locked = ret.status === "filed";

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "20px 24px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={btnGhostSm}><ArrowLeft size={14} style={{ verticalAlign: -2 }} /> All returns</button>
        <button onClick={() => openPdf(`/api/tax/returns/${returnId}/report`).catch((e) => setError(e.message))} style={btnGhostSm}>
          <FileText size={14} style={{ verticalAlign: -2 }} /> Download return (PDF)
        </button>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 21, margin: 0 }}>{ret.taxpayer_name}</h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>
              {ret.type_label}{ret.period ? ` · ${ret.period}` : ""}{ret.tin ? ` · TIN ${ret.tin}` : ""}
            </div>
          </div>
          <span style={{ ...pill, background: sm.bg, color: sm.fg, marginLeft: "auto", fontSize: 12 }}>{sm.label}</span>
        </div>
        <SignoffTrail ret={ret} />
      </div>

      {error && <div style={{ marginBottom: 12 }}><Flash type="error">{error}</Flash></div>}

      <Computation ret={ret} locked={locked} onSaved={setRet} />

      <ResultPanel ret={ret} />

      <WorkflowBar ret={ret} me={me} busy={busy} act={act} />

      <TaxDocs returnId={returnId} taxType={ret.tax_type} setError={setError} />

      <AiWriteup endpoint={`/api/tax/returns/${returnId}/writeup`} initial={ret.ai_writeup} reviewLabel="for tax-agent review" />
    </div>
  );
}

function AiWriteup({ endpoint, initial, reviewLabel }) {
  const [summary, setSummary] = useState(initial?.summary || "");
  const [cover, setCover] = useState(initial?.cover_letter || "");
  const [recs, setRecs] = useState(initial?.recommendations || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const has = !!(summary || cover || recs);
  const ta = { width: "100%", minHeight: 110, padding: "10px 12px", borderRadius: 9, border: "1px solid #d1d5db", fontSize: 13.5, lineHeight: 1.5, color: "#0f172a", fontFamily: "inherit", boxSizing: "border-box", outline: "none", resize: "vertical" };
  const lbl = { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.04, margin: "12px 0 6px" };

  async function generate() {
    setBusy("gen"); setError(""); setInfo("");
    try { const j = await api(endpoint, { method: "POST" }); setSummary(j.summary || ""); setCover(j.cover_letter || ""); setRecs(j.recommendations || ""); setInfo("Draft generated — review and edit before use."); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  }
  async function save() {
    setBusy("save"); setError(""); setInfo("");
    try { await api(endpoint, { method: "PUT", body: JSON.stringify({ summary, cover_letter: cover, recommendations: recs }) }); setInfo("Saved — it will appear on the return PDF."); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  return (
    <div style={{ ...card, marginTop: 16 }}>
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
          <div style={lbl}>Summary</div>
          <textarea style={ta} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div style={{ ...lbl, color: "#0f2c52" }}>Tax-strategy recommendations &mdash; ways to reduce tax</div>
          <textarea style={{ ...ta, minHeight: 150 }} value={recs} onChange={(e) => setRecs(e.target.value)} />
          <div style={lbl}>Cover letter</div>
          <textarea style={ta} value={cover} onChange={(e) => setCover(e.target.value)} />
          <button onClick={save} disabled={busy === "save"} style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#0f2c52", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {busy === "save" ? <><Loader2 size={13} className="spin" /> Saving…</> : <><CheckCircle2 size={13} /> Save edits</>}
          </button>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 10 }}>Drafted from this return's data. Review and edit before issuing.</div>
        </>
      )}
    </div>
  );
}

function TaxDocs({ returnId, taxType, setError }) {
  const items = taxDocsFor(taxType);
  const [files, setFiles] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busySlot, setBusySlot] = useState(null);

  const load = useCallback(async () => {
    try { const j = await api(`/api/tax/returns/${returnId}/files`); setFiles(j.files || []); }
    catch (e) { setError && setError(e.message); }
  }, [returnId, setError]);
  useEffect(() => { load(); }, [load]);

  const bySlot = files.reduce((m, f) => { (m[f.slot] = m[f.slot] || []).push(f); return m; }, {});

  async function uploadTo(slot, file) {
    if (!file) return;
    setBusySlot(slot); setError && setError("");
    try { const fd = new FormData(); fd.append("file", file); fd.append("slot", slot); await apiUpload(`/api/tax/returns/${returnId}/files`, fd); await load(); }
    catch (e) { setError && setError(e.message); }
    finally { setBusySlot(null); }
  }
  async function bulkUpload(arr) {
    if (!arr.length) return;
    setBulkBusy(true); setError && setError("");
    for (const file of arr) {
      try { const fd = new FormData(); fd.append("file", file); fd.append("slot", "auto"); await apiUpload(`/api/tax/returns/${returnId}/files`, fd); }
      catch (e) { setError && setError(e.message); }
    }
    setBulkBusy(false); await load();
  }
  async function remove(fid) {
    if (!confirm("Remove this document?")) return;
    try { await api(`/api/tax/returns/${returnId}/files/${fid}`, { method: "DELETE" }); await load(); }
    catch (e) { setError && setError(e.message); }
  }

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <SectionHead icon={<FileText size={16} />} title="Supporting documents" />
      <div style={{ background: C.goldSoft, border: "1px dashed #e3c976", borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Upload documents — we&rsquo;ll file them automatically</div>
        <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>Add financials, schedules and workings at once; each is sorted into the checklist by its name.</div>
        <label style={{ ...btnPrimaryInline, cursor: bulkBusy ? "default" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
          {bulkBusy ? <><Loader2 size={14} className="spin" /> Filing…</> : <><FileText size={14} /> Choose files</>}
          <input type="file" hidden multiple disabled={bulkBusy} onChange={(e) => { bulkUpload(Array.from(e.target.files || [])); e.target.value = ""; }} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((it) => {
          const fs = bySlot[it.slot] || [];
          const done = fs.length > 0;
          return (
            <div key={it.slot} style={{ border: `1px solid ${done ? "#bbf7d0" : C.line}`, borderRadius: 10, padding: 12, background: done ? "#f0fdf4" : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {done ? <CheckCircle2 size={15} color={C.green} /> : <span style={{ width: 15, height: 15, borderRadius: 99, border: `2px solid ${it.required ? C.red : "#cbd5e1"}`, flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.label}</span>
                  {it.required && !done && <span style={{ fontSize: 10, color: C.red, marginLeft: 8, textTransform: "uppercase" }}>Required</span>}
                </div>
                <label style={{ ...btnGhostSm, cursor: busySlot === it.slot ? "default" : "pointer" }}>
                  {busySlot === it.slot ? <Loader2 size={12} className="spin" /> : <><Plus size={12} /> Add</>}
                  <input type="file" hidden disabled={busySlot === it.slot} onChange={(e) => { uploadTo(it.slot, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              </div>
              {fs.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {fs.map((f) => (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, background: "#fff", border: "1px solid " + C.line, borderRadius: 6, padding: "5px 9px" }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); openPdf(`/api/tax/returns/${returnId}/files/${f.id}`).catch(() => {}); }} style={{ color: C.navy, textDecoration: "none" }}>{f.filename}</a>
                      <button onClick={() => remove(f.id)} style={{ ...btnGhostSm, padding: "3px 7px", color: C.red, borderColor: "#fecaca" }}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {(bySlot.other || []).length > 0 && (
          <div style={{ fontSize: 12, color: C.muted }}>Unsorted: {(bySlot.other || []).map((f) => f.filename).join(", ")}</div>
        )}
      </div>
    </div>
  );
}

function SignoffTrail({ ret }) {
  const items = [
    ["Prepared", ret.prepared_by, ret.prepared_at],
    ["Reviewed", ret.reviewed_by, ret.reviewed_at],
    ["Filed", ret.filed_by, ret.filed_at],
  ];
  const any = items.some(([, by]) => by);
  if (!any) return null;
  return (
    <div style={{ display: "flex", gap: 22, marginTop: 14, paddingTop: 12, borderTop: "1px solid " + C.line, flexWrap: "wrap" }}>
      {items.map(([label, by, at]) => (
        <div key={label} style={{ fontSize: 12 }}>
          <div style={{ color: C.muted }}>{label}</div>
          {by ? <div style={{ color: C.ink, fontWeight: 600 }}>{by}<div style={{ color: C.muted, fontWeight: 400 }}>{at ? new Date(at).toLocaleDateString() : ""}</div></div>
              : <div style={{ color: "#cbd5e1" }}>—</div>}
        </div>
      ))}
      {ret.irc_reference && (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: C.muted }}>IRC reference</div>
          <div style={{ color: C.ink, fontWeight: 600 }}>{ret.irc_reference}</div>
        </div>
      )}
    </div>
  );
}

/* ── computation editors ─────────────────────────────────────────────────── */

function Computation({ ret, locked, onSaved }) {
  if (ret.tax_type === "cit") return <CitForm ret={ret} locked={locked} onSaved={onSaved} />;
  if (ret.tax_type === "individual") return <IndividualForm ret={ret} locked={locked} onSaved={onSaved} />;
  return <GstForm ret={ret} locked={locked} onSaved={onSaved} />;
}

function useSaveInputs(returnId, onSaved) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = useCallback(async (inputs) => {
    setBusy(true); setError("");
    try {
      const j = await api(`/api/tax/returns/${returnId}`, { method: "PATCH", body: JSON.stringify({ action: "save_inputs", inputs }) });
      onSaved(j.return);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [returnId, onSaved]);
  return { save, busy, error };
}

function CitForm({ ret, locked, onSaved }) {
  const init = ret.inputs || { accounting_profit: "", resident: true, adjustments: [], credits: [] };
  const [profit, setProfit] = useState(init.accounting_profit ?? "");
  const [resident, setResident] = useState(init.resident !== false);
  const [adjustments, setAdjustments] = useState(init.adjustments || []);
  const [credits, setCredits] = useState(init.credits || []);
  const { save, busy, error } = useSaveInputs(ret.id, onSaved);

  const addAdj = (preset) => setAdjustments((a) => [...a, preset || { label: "", amount: "", kind: "add_back" }]);
  const addCredit = () => setCredits((c) => [...c, { label: "", amount: "", kind: "provisional" }]);

  function persist() {
    save({
      accounting_profit: Number(profit) || 0,
      resident,
      adjustments: adjustments.map((a) => ({ label: a.label, amount: Number(a.amount) || 0, kind: a.kind })),
      credits: credits.map((c) => ({ label: c.label, amount: Number(c.amount) || 0, kind: c.kind })),
    });
  }

  return (
    <div style={card}>
      <SectionHead icon={<Calculator size={15} />} title="Company income tax computation" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Accounting profit before tax (K)">
          <input style={input} type="number" value={profit} disabled={locked} onChange={(e) => setProfit(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Residency">
          <select style={input} value={resident ? "res" : "non"} disabled={locked} onChange={(e) => setResident(e.target.value === "res")}>
            <option value="res">Resident company (30%)</option>
            <option value="non">Non-resident branch (48%)</option>
          </select>
        </Field>
      </div>

      <AdjustmentTable title="Tax adjustments" rows={adjustments} setRows={setAdjustments} locked={locked}
        kindOptions={[["add_back", "Add back"], ["deduction", "Deduction"]]} />
      {!locked && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {STANDARD_CIT_PRESETS.map((p) => (
            <button key={p.label} onClick={() => addAdj({ label: p.label, amount: "", kind: p.kind })} style={chip} title={p.hint}>
              <Plus size={11} style={{ verticalAlign: -1 }} /> {p.short}
            </button>
          ))}
          <button onClick={() => addAdj()} style={chip}><Plus size={11} style={{ verticalAlign: -1 }} /> Custom</button>
        </div>
      )}

      <AdjustmentTable title="Tax credits & instalments" rows={credits} setRows={setCredits} locked={locked}
        kindOptions={[["provisional", "Provisional tax"], ["foreign", "Foreign tax credit"], ["dividend_wht", "Dividend WHT"], ["other", "Other"]]} />
      {!locked && <button onClick={addCredit} style={{ ...chip, marginTop: 6 }}><Plus size={11} style={{ verticalAlign: -1 }} /> Add credit</button>}

      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      {!locked && (
        <button onClick={persist} disabled={busy} style={{ ...btnPrimaryInline, marginTop: 14 }}>
          {busy ? <Loader2 size={14} className="spin" /> : <>Save & recompute</>}
        </button>
      )}
    </div>
  );
}

const STANDARD_CIT_PRESETS = [
  { label: "Accounting depreciation (added back)", short: "Acct depreciation", kind: "add_back", hint: "Book depreciation is non-deductible." },
  { label: "Entertainment (non-deductible)", short: "Entertainment", kind: "add_back", hint: "Client entertainment is non-deductible." },
  { label: "Fines & penalties", short: "Fines/penalties", kind: "add_back", hint: "Never deductible." },
  { label: "Tax depreciation (capital allowance)", short: "Tax depreciation", kind: "deduction", hint: "Capital allowance claimed for tax." },
  { label: "Prior-year tax losses utilised", short: "Loss b/fwd", kind: "deduction", hint: "Carried-forward losses applied." },
];

function AdjustmentTable({ title, rows, setRows, locked, kindOptions }) {
  const upd = (i, k, v) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const del = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  if (rows.length === 0) return <div style={{ marginTop: 16 }}><div style={subhead}>{title}</div><div style={{ fontSize: 12.5, color: C.muted }}>None added.</div></div>;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={subhead}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1fr auto", gap: 6, alignItems: "center" }}>
            <input style={{ ...input, padding: "7px 9px" }} value={r.label} disabled={locked} placeholder="Description" onChange={(e) => upd(i, "label", e.target.value)} />
            <select style={{ ...input, padding: "7px 9px" }} value={r.kind} disabled={locked} onChange={(e) => upd(i, "kind", e.target.value)}>
              {kindOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input style={{ ...input, padding: "7px 9px", textAlign: "right" }} type="number" value={r.amount} disabled={locked} placeholder="0.00" onChange={(e) => upd(i, "amount", e.target.value)} />
            {!locked ? <button onClick={() => del(i)} style={iconBtn} title="Remove"><Trash2 size={14} /></button> : <span />}
          </div>
        ))}
      </div>
    </div>
  );
}

function IndividualForm({ ret, locked, onSaved }) {
  const [income, setIncome] = useState(ret.inputs?.taxable_income ?? "");
  const { save, busy, error } = useSaveInputs(ret.id, onSaved);
  return (
    <div style={card}>
      <SectionHead icon={<Calculator size={15} />} title="Individual income tax computation" />
      <Field label="Taxable income for the year (K)">
        <input style={input} type="number" value={income} disabled={locked} onChange={(e) => setIncome(e.target.value)} placeholder="0.00" />
      </Field>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
        <Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
        Resident marginal scale: tax-free to K12,500, then 22% / 30% / 35% / 40% / 42%.
      </div>
      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      {!locked && (
        <button onClick={() => save({ taxable_income: Number(income) || 0 })} disabled={busy} style={{ ...btnPrimaryInline, marginTop: 14 }}>
          {busy ? <Loader2 size={14} className="spin" /> : "Save & recompute"}
        </button>
      )}
    </div>
  );
}

function GstForm({ ret, locked, onSaved }) {
  const [sales, setSales] = useState(ret.inputs?.taxable_sales ?? "");
  const [purchases, setPurchases] = useState(ret.inputs?.creditable_purchases ?? "");
  const { save, busy, error } = useSaveInputs(ret.id, onSaved);
  return (
    <div style={card}>
      <SectionHead icon={<Calculator size={15} />} title="GST return (10%)" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Standard-rated sales, GST-exclusive (K)">
          <input style={input} type="number" value={sales} disabled={locked} onChange={(e) => setSales(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Creditable purchases, GST-exclusive (K)">
          <input style={input} type="number" value={purchases} disabled={locked} onChange={(e) => setPurchases(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      {error && <div style={{ marginTop: 10 }}><Flash type="error">{error}</Flash></div>}
      {!locked && (
        <button onClick={() => save({ taxable_sales: Number(sales) || 0, creditable_purchases: Number(purchases) || 0 })} disabled={busy} style={{ ...btnPrimaryInline, marginTop: 14 }}>
          {busy ? <Loader2 size={14} className="spin" /> : "Save & recompute"}
        </button>
      )}
    </div>
  );
}

/* ── result + workflow ───────────────────────────────────────────────────── */

function ResultPanel({ ret }) {
  const r = ret.result;
  if (!r) return null;
  let rows = [];
  if (ret.tax_type === "cit") {
    rows = [
      ["Accounting profit", K(r.accounting_profit)],
      ["Add: non-deductible add-backs", K(r.total_add_backs)],
      ["Less: tax deductions", "(" + K(r.total_deductions) + ")"],
      ["Taxable income", K(r.taxable_income), true],
      [`Gross tax @ ${PCT(r.rate)}`, K(r.gross_tax)],
      ["Less: credits & instalments", "(" + K(r.total_credits) + ")"],
    ];
  } else if (ret.tax_type === "individual") {
    rows = [
      ["Taxable income", K(r.taxable_income), true],
      ["Average rate", PCT(r.average_rate)],
      ["Marginal rate", PCT(r.marginal_rate)],
    ];
  } else {
    rows = [
      ["Output tax (on sales)", K(r.output_tax)],
      ["Less: input tax (on purchases)", "(" + K(r.input_tax) + ")"],
    ];
  }
  const payable = r.tax_payable ?? r.tax ?? r.net_gst ?? 0;
  const refund = r.refund_due || 0;

  return (
    <div style={{ ...card, marginTop: 16, background: C.navy, color: "#fff", border: "none" }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "#9fb3cc", marginBottom: 10 }}>Computation result</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map(([label, val, strong], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, paddingTop: strong ? 7 : 0, borderTop: strong ? "1px solid #2a3b56" : "none", fontWeight: strong ? 700 : 400 }}>
            <span style={{ color: strong ? "#fff" : "#cdd9e8" }}>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{val}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "2px solid " + C.gold, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 15 }}>{refund > 0 ? "Refund due" : ret.tax_type === "gst" ? "Net GST payable" : "Tax payable"}</strong>
        <strong style={{ fontSize: 22, color: C.gold }}>{refund > 0 ? K(refund) : K(payable)}</strong>
      </div>
    </div>
  );
}

function WorkflowBar({ ret, me, busy, act }) {
  const isPreparer = ret.prepared_by && me && ret.prepared_by === me.email;
  return (
    <div style={{ ...card, marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: C.muted, marginRight: 6 }}>Workflow:</span>

      {ret.status === "draft" && (
        <button onClick={() => act("prepare")} disabled={!ret.inputs || busy === "prepare"} style={btnPrimaryInline} title={!ret.inputs ? "Enter the computation first" : ""}>
          {busy === "prepare" ? <Loader2 size={14} className="spin" /> : <><Check size={14} style={{ verticalAlign: -2 }} /> Mark prepared</>}
        </button>
      )}
      {ret.status === "prepared" && (
        <button onClick={() => act("review")} disabled={busy === "review" || isPreparer} style={btnPrimaryInline}
          title={isPreparer ? "A different reviewer must sign off" : ""}>
          {busy === "review" ? <Loader2 size={14} className="spin" /> : <><Check size={14} style={{ verticalAlign: -2 }} /> Approve review</>}
        </button>
      )}
      {ret.status === "reviewed" && <FileButton ret={ret} busy={busy} act={act} />}
      {ret.status === "filed" && (
        <span style={{ ...pill, background: C.greenSoft, color: C.green }}><Stamp size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Filed with IRC{ret.irc_reference ? ` · ${ret.irc_reference}` : ""}</span>
      )}

      {ret.status !== "draft" && (
        <button onClick={() => act("reopen")} disabled={busy === "reopen"} style={{ ...btnGhostSm, marginLeft: "auto" }}>
          {busy === "reopen" ? <Loader2 size={13} className="spin" /> : <><RotateCcw size={13} style={{ verticalAlign: -2 }} /> Reopen</>}
        </button>
      )}
      {isPreparer && ret.status === "prepared" && (
        <span style={{ fontSize: 11.5, color: C.amber, width: "100%" }}>
          <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          You prepared this return — a different reviewer must approve it.
        </span>
      )}
    </div>
  );
}

function FileButton({ ret, busy, act }) {
  const [ref, setRef] = useState(ret.irc_reference || "");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input style={{ ...input, padding: "7px 9px", width: 180 }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="IRC reference no." />
      <button onClick={() => act("file", { irc_reference: ref })} disabled={!ref.trim() || busy === "file"} style={btnPrimaryInline}>
        {busy === "file" ? <Loader2 size={14} className="spin" /> : <><Stamp size={14} style={{ verticalAlign: -2 }} /> File return</>}
      </button>
    </div>
  );
}

/* ──────────────────────────────── shared UI ─────────────────────────────── */

function SectionHead({ icon, title }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, color: C.navy }}>
    <span style={{ color: C.gold }}>{icon}</span><strong style={{ fontSize: 15 }}>{title}</strong>
  </div>;
}
function Centered({ children }) {
  return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "60px 20px" }}>{children}</div>;
}
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}>
    <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>{label}</div>{children}
  </label>;
}
function Flash({ type, children }) {
  const map = {
    error: { bg: "#fef2f2", fg: C.red, Icon: AlertCircle },
    info: { bg: "#eff6ff", fg: "#1d4ed8", Icon: Info },
    success: { bg: C.greenSoft, fg: C.green, Icon: CheckCircle2 },
  };
  const s = map[type] || map.info; const Icon = s.Icon;
  return <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: s.bg, color: s.fg, padding: "9px 12px", borderRadius: 9, fontSize: 13 }}>
    <Icon size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{children}</span>
  </div>;
}

const card = { background: "#fff", border: "1px solid " + C.line, borderRadius: 13, padding: 18, boxShadow: "0 1px 3px rgba(15,44,82,.04)" };
const input = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 14, color: C.ink, background: "#fff", boxSizing: "border-box", outline: "none" };
const th = { padding: "10px 14px", fontWeight: 600, fontSize: 12 };
const td = { padding: "11px 14px", verticalAlign: "top" };
const subhead = { fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 7 };
const miniNav = { fontSize: 12.5, color: "#cdd9e8", textDecoration: "none", padding: "5px 10px", borderRadius: 7 };
const pill = { fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" };
const chip = { fontSize: 11.5, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", color: C.inkSoft, cursor: "pointer" };
const btnPrimary = { width: "100%", padding: "11px 16px", borderRadius: 10, border: "none", background: C.navy, color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer", marginTop: 6 };
const btnPrimaryInline = { padding: "9px 15px", borderRadius: 9, border: "none", background: C.navy, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const btnGhost = { width: "100%", padding: "9px", borderRadius: 9, border: "none", background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", marginTop: 8 };
const btnGhostSm = { padding: "7px 12px", borderRadius: 8, border: "1px solid " + C.line, background: "#fff", color: C.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 };
const iconBtn = { padding: "7px", borderRadius: 8, border: "1px solid " + C.line, background: "#fff", color: C.red, cursor: "pointer", display: "inline-flex" };
