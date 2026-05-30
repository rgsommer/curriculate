// /audit/app — client portal. Reuses TeebeePay's email-PIN auth (same users
// collection). Audit clients see only their own engagement(s); admins see all
// and can jump to /audit/admin for the queue view.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, KeyRound, LogOut,
  Upload, FileText, ClipboardList, Trash2, Sparkles,
  Target, ShieldAlert, ClipboardCheck, Plus, Check, ChevronRight,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  red: "#b9302a",
};
const TOKEN_KEY = "teebeepay.authToken";

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }

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

export default function AuditAppPage() {
  const [view, setView] = useState("loading"); // loading | login | dashboard | engagement
  const [me, setMe] = useState(null);
  const [engagements, setEngagements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const loadMe = useCallback(async () => {
    if (!getToken()) { setView("login"); return; }
    try {
      const j = await api("/api/audit/me");
      setMe(j.user); setEngagements(j.engagements || []);
      // If client has a single engagement, jump straight to it
      if (j.user.clearance < 3 && j.engagements.length === 1) {
        setSelectedId(j.engagements[0].id);
        setView("engagement");
      } else {
        setView("dashboard");
      }
    } catch { setView("login"); }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  function signOut() { setToken(null); setMe(null); setView("login"); }

  return (
    <main style={{
      minHeight: "100vh", background: "#f6f7fa", color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <header style={{
        background: C.navy, color: "#fff", padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <Link href="/audit" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#fff" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: C.gold, color: C.navy,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800,
          }}>TBA</div>
          <strong style={{ fontSize: 15 }}>Tee Bee Audit</strong>
        </Link>
        {me && me.clearance >= 3 && (
          <Link href="/audit/admin" style={{ ...miniNav, marginLeft: 16 }}>Admin queue →</Link>
        )}
        {me && (
          <button onClick={signOut} style={{ ...miniNav, marginLeft: "auto", cursor: "pointer", background: "transparent", border: "1px solid #3a526b" }}>
            <LogOut size={13} style={{ verticalAlign: -2, marginRight: 6 }} /> Sign out
          </button>
        )}
      </header>

      {view === "loading" && <Centered><Loader2 size={26} className="spin" color={C.gold} /></Centered>}
      {view === "login"   && <LoginCard onSignedIn={loadMe} />}
      {view === "dashboard" && (
        <Dashboard me={me} engagements={engagements}
          onPick={(id) => { setSelectedId(id); setView("engagement"); }} />
      )}
      {view === "engagement" && selectedId && (
        <EngagementView engagementId={selectedId} me={me}
          onBack={() => { setSelectedId(null); setView("dashboard"); }} />
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
      <div style={{
        maxWidth: 420, background: "#fff", borderRadius: 14, padding: 28,
        border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(15,44,82,.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9, background: C.navy, color: C.gold,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800,
          }}>TBA</div>
          <div>
            <strong style={{ fontSize: 18 }}>Sign in to Tee Bee Audit</strong>
            <div style={{ fontSize: 12, color: C.muted }}>Email and a 6-digit code — no password.</div>
          </div>
        </div>
        {error && <Flash type="error">{error}</Flash>}
        {info && <Flash type="info">{info}</Flash>}
        {step === "email" ? (
          <>
            <Field label="Email">
              <input style={input} type="email" value={email} placeholder="you@company.com.pg"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && requestPin()} autoFocus />
            </Field>
            <button onClick={requestPin} disabled={!email || busy} style={btnPrimary}>
              {busy ? <><Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> Sending…</>
                     : <>Send sign-in code <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px" }}>
              We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
            </p>
            <Field label="6-digit code">
              <input style={{ ...input, letterSpacing: 6, fontSize: 20, textAlign: "center", fontWeight: 700 }}
                inputMode="numeric" maxLength={6} value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && pin.length === 6 && verifyPin()} autoFocus />
            </Field>
            <button onClick={verifyPin} disabled={pin.length !== 6 || busy} style={btnPrimary}>
              {busy ? <><Loader2 size={16} className="spin" style={{ marginRight: 6 }} /> Verifying…</>
                     : <><KeyRound size={14} style={{ marginRight: 6 }} /> Sign in</>}
            </button>
            <button onClick={() => { setStep("email"); setPin(""); }} style={btnGhostLg}>← Back</button>
          </>
        )}
      </div>
    </Centered>
  );
}

/* ──────────────── Dashboard (multiple engagements) ──────────────── */

function Dashboard({ me, engagements, onPick }) {
  if (!engagements.length) {
    return (
      <div style={{ maxWidth: 760, margin: "40px auto", padding: 24 }}>
        <h1 style={h1}>No audit engagements yet</h1>
        <p style={lead}>
          We can't find an audit engagement linked to {me?.email}. If you've just sent us an inquiry,
          Theresia will be in touch shortly to set up your engagement. If you think this is a mistake,
          reply to your invitation email.
        </p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 980, margin: "32px auto", padding: 24 }}>
      <h1 style={h1}>Your audits</h1>
      <p style={lead}>Choose an engagement to upload documents and check status.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 18 }}>
        {engagements.map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} style={engagementCard}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 0.06 }}>
              {AUDIT_TYPE_LABEL[e.audit_type] || e.audit_type}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, margin: "6px 0 4px" }}>{e.company_name}</div>
            <div style={{ fontSize: 13, color: C.muted }}>
              FY end {e.fy_end || "—"} · status <strong style={{ color: C.ink }}>{e.status}</strong>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ──────────────── Engagement view (checklist + uploads) ──────────────── */

const AUDIT_TYPE_LABEL = {
  statutory: "Statutory audit", readiness: "Audit-readiness review",
  tax: "Tax / IRC audit", compliance: "Compliance audit",
  donor_fund: "Donor / SPV audit", landowner: "Landowner audit",
  other: "Other",
};

function EngagementView({ engagementId, me, onBack }) {
  const [eng, setEng] = useState(null);
  const [files, setFiles] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [findings, setFindings] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busySlot, setBusySlot] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [meta, fileList, find] = await Promise.all([
        api(`/api/audit/engagements/${engagementId}`),
        api(`/api/audit/engagements/${engagementId}/files`),
        api(`/api/audit/engagements/${engagementId}/findings`),
      ]);
      setEng(meta.engagement);
      setFiles(fileList.files || []);
      setFindings(find.findings || []);
      // Build checklist from audit_type (client-side mirror of /_checklist.ts)
      setChecklist(buildChecklist(meta.engagement.audit_type));
    } catch (e) { setError(e.message); }
  }, [engagementId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function uploadFile(slot, file) {
    if (!file) return;
    setBusySlot(slot); setError(""); setInfo("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slot", slot);
      await api(`/api/audit/engagements/${engagementId}/files`, { method: "POST", body: fd });
      setInfo(`Uploaded ${file.name}`);
      refresh();
    } catch (e) { setError(e.message); }
    finally { setBusySlot(null); }
  }
  async function deleteFile(fid) {
    if (!confirm("Remove this file?")) return;
    try {
      await api(`/api/audit/engagements/${engagementId}/files/${fid}`, { method: "DELETE" });
      refresh();
    } catch (e) { setError(e.message); }
  }
  async function runAnalysis() {
    setAnalyzing(true); setError(""); setInfo("");
    try {
      const j = await api(`/api/audit/engagements/${engagementId}/analyze`, { method: "POST" });
      setInfo(`Analysis complete — ${j.findings_count} finding${j.findings_count === 1 ? "" : "s"}.`);
      refresh();
    } catch (e) { setError(e.message); }
    finally { setAnalyzing(false); }
  }

  if (!eng) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const isAdmin = me?.clearance >= 3;
  const filesBySlot = files.reduce((m, f) => {
    (m[f.slot] = m[f.slot] || []).push(f); return m;
  }, {});

  return (
    <div style={{ maxWidth: 980, margin: "32px auto", padding: 24 }}>
      <button onClick={onBack} style={btnGhostSm}><ArrowLeft size={13} /> Back</button>
      <h1 style={{ ...h1, marginTop: 12 }}>{eng.company_name}</h1>
      <p style={lead}>
        {AUDIT_TYPE_LABEL[eng.audit_type] || eng.audit_type} · FY end {eng.fy_end || "—"} ·
        status <strong style={{ color: C.ink }}>{eng.status}</strong>
        {eng.agreed_fee != null && <> · agreed fee PGK {Number(eng.agreed_fee).toLocaleString()}</>}
      </p>
      {error && <Flash type="error">{error}</Flash>}
      {info && <Flash type="info">{info}</Flash>}

      {isAdmin && (
        <div style={{ display: "flex", gap: 10, margin: "18px 0", flexWrap: "wrap" }}>
          <button onClick={runAnalysis} disabled={analyzing} style={btnPrimaryInline}>
            {analyzing
              ? <><Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> Analyzing…</>
              : <><Sparkles size={14} style={{ marginRight: 6 }} /> Run software analysis</>}
          </button>
          <Link href="/audit/admin" style={{ ...btnGhostLg, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            Open admin queue
          </Link>
        </div>
      )}

      {/* Planning (firm-internal: materiality, risk register, working papers) */}
      {isAdmin && <AuditPlanningPanel engagementId={engagementId} />}

      {/* Findings (after analysis) */}
      {findings.length > 0 && (
        <div style={{
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18, marginBottom: 18,
        }}>
          <strong style={{ fontSize: 14 }}>
            Findings — {findings.length} · last run {eng.last_analysis_at ? new Date(eng.last_analysis_at).toLocaleString() : "—"}
          </strong>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {findings.map((f) => (
              <div key={f.id} style={{
                padding: 12, borderRadius: 8, fontSize: 13,
                border: "1px solid " + sevColor(f.severity).bd,
                background: sevColor(f.severity).bg,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ color: sevColor(f.severity).ink }}>{f.title}</strong>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color: sevColor(f.severity).ink,
                    textTransform: "uppercase", letterSpacing: 0.04,
                  }}>{f.severity}</span>
                </div>
                <div style={{ color: C.inkSoft }}>{f.detail}</div>
                {f.source_file && (
                  <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>Source: {f.source_file}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      <h2 style={{ ...h2, marginTop: 8 }}>Document checklist</h2>
      <p style={{ ...lead, fontSize: 14 }}>
        Upload each item below. Multiple files per slot are fine. Supported: XLSX, CSV, PDF, DOCX. Max 200 MB per file.
      </p>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {checklist.map((item) => {
          const slotFiles = filesBySlot[item.slot] || [];
          const done = slotFiles.length > 0;
          return (
            <div key={item.slot} style={{
              background: "#fff", border: `1px solid ${done ? "#bbf7d0" : "#e5e7eb"}`,
              borderRadius: 10, padding: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {done
                      ? <CheckCircle2 size={16} color="#16a34a" />
                      : <ClipboardList size={16} color={item.required ? C.red : C.muted} />}
                    <strong style={{ fontSize: 14 }}>{item.label}</strong>
                    {item.required && <span style={{ fontSize: 10, color: C.red, textTransform: "uppercase", letterSpacing: 0.05 }}>Required</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{item.description}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Accepts: {item.formats}</div>
                </div>
                <label style={{ ...btnGhostSm, cursor: "pointer" }}>
                  <Upload size={12} /> {busySlot === item.slot ? "Uploading…" : "Add file"}
                  <input type="file" hidden disabled={busySlot === item.slot}
                    onChange={(e) => uploadFile(item.slot, e.target.files?.[0])} />
                </label>
              </div>
              {slotFiles.length > 0 && (
                <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
                  {slotFiles.map((f) => (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                              fontSize: 12, padding: "6px 10px", background: "#fafbfc", borderRadius: 6 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <FileText size={12} color={C.muted} />
                        <a href={`/api/audit/engagements/${engagementId}/files/${f.id}`}
                           target="_blank" rel="noreferrer" style={{ color: C.navy, textDecoration: "none" }}>
                          {f.filename}
                        </a>
                        <span style={{ color: C.muted }}>· {(f.size / 1024).toFixed(0)} KB</span>
                      </span>
                      <button onClick={() => deleteFile(f.id)} style={{
                        ...btnGhostSm, color: C.red, borderColor: "#fecaca", padding: "3px 7px",
                      }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sevColor(sev) {
  if (sev === "high")   return { bg: "#fee2e2", bd: "#fecaca", ink: "#7f1d1d" };
  if (sev === "medium") return { bg: "#fef3c7", bd: "#fde68a", ink: "#7c2d12" };
  return                       { bg: "#dcfce7", bd: "#bbf7d0", ink: "#14532d" };
}
function rateColor(rating) {
  if (rating === "high")   return { bg: "#fee2e2", ink: "#7f1d1d" };
  if (rating === "medium") return { bg: "#fef3c7", ink: "#7c2d12" };
  return                          { bg: "#dcfce7", ink: "#14532d" };
}
const pgk = (n) => "PGK " + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/* ───────────── Audit planning: materiality + risks + working papers ──────────── */
function AuditPlanningPanel({ engagementId }) {
  const [sub, setSub] = useState("materiality");
  const tabs = [
    { k: "materiality", label: "Materiality", Icon: Target },
    { k: "risks", label: "Risk register", Icon: ShieldAlert },
    { k: "workpapers", label: "Working papers", Icon: ClipboardCheck },
  ];
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <strong style={{ fontSize: 14 }}>Audit planning</strong>
        <span style={{ fontSize: 11, color: C.muted }}>· firm-internal</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setSub(k)} style={{
            ...btnGhostSm, gap: 6,
            background: sub === k ? C.navy : "#fff", color: sub === k ? "#fff" : C.ink,
            borderColor: sub === k ? C.navy : "#d1d5db",
          }}><Icon size={13} /> {label}</button>
        ))}
      </div>
      {sub === "materiality" && <MaterialityForm engagementId={engagementId} />}
      {sub === "risks" && <RiskRegister engagementId={engagementId} />}
      {sub === "workpapers" && <WorkpaperList engagementId={engagementId} />}
    </div>
  );
}

function MaterialityForm({ engagementId }) {
  const [benchmarks, setBenchmarks] = useState([]);
  const [m, setM] = useState(null);          // computed result from server
  const [form, setForm] = useState({ benchmark: "pbt", benchmark_amount: "", pct: "", performance_pct: 75, trivial_pct: 5, basis_note: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await api(`/api/audit/engagements/${engagementId}/planning`);
      setBenchmarks(j.benchmarks || []);
      if (j.materiality) {
        setM(j.materiality);
        setForm((f) => ({ ...f, benchmark: j.materiality.benchmark, benchmark_amount: j.materiality.benchmark_amount,
          pct: j.materiality.pct, performance_pct: j.materiality.performance_pct, trivial_pct: j.materiality.trivial_pct,
          basis_note: j.materiality_meta?.basis_note || "" }));
      }
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, [engagementId]);
  useEffect(() => { load(); }, [load]);

  const band = benchmarks.find((b) => b.key === form.benchmark);
  async function save() {
    setBusy(true); setErr("");
    try {
      const j = await api(`/api/audit/engagements/${engagementId}/planning`, {
        method: "PUT",
        body: JSON.stringify({
          benchmark: form.benchmark, benchmark_amount: Number(form.benchmark_amount), pct: Number(form.pct),
          performance_pct: Number(form.performance_pct), trivial_pct: Number(form.trivial_pct), basis_note: form.basis_note,
        }),
      });
      setM(j.materiality);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (!loaded) return <Loader2 size={18} className="spin" color={C.gold} />;

  return (
    <div>
      {err && <Flash type="error">{err}</Flash>}
      <p style={{ ...lead, fontSize: 13, marginTop: 0 }}>
        Set planning materiality from a benchmark (ISA 320). Performance materiality and the clearly-trivial threshold are derived.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Benchmark">
          <select style={input} value={form.benchmark} onChange={(e) => setForm({ ...form, benchmark: e.target.value })}>
            {benchmarks.map((b) => <option key={b.key} value={b.key}>{b.label} ({b.pctLow}–{b.pctHigh}%)</option>)}
          </select>
        </Field>
        <Field label="Benchmark amount (PGK)">
          <input style={input} type="number" value={form.benchmark_amount}
            onChange={(e) => setForm({ ...form, benchmark_amount: e.target.value })} placeholder="e.g. 4200000" />
        </Field>
        <Field label={`Materiality %${band ? ` (suggested ${band.pctLow}–${band.pctHigh})` : ""}`}>
          <input style={input} type="number" step="0.1" value={form.pct}
            onChange={(e) => setForm({ ...form, pct: e.target.value })} placeholder={band ? String(band.pctHigh) : "1"} />
        </Field>
        <Field label="Performance materiality (% of planning)">
          <input style={input} type="number" value={form.performance_pct}
            onChange={(e) => setForm({ ...form, performance_pct: e.target.value })} />
        </Field>
      </div>
      {band && <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px" }}>{band.note}</p>}
      <Field label="Basis note (why this benchmark)">
        <textarea style={{ ...input, minHeight: 54 }} value={form.basis_note}
          onChange={(e) => setForm({ ...form, basis_note: e.target.value })} />
      </Field>
      <button onClick={save} disabled={busy} style={btnPrimaryInline}>
        {busy ? <><Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> Saving…</> : "Compute & save materiality"}
      </button>

      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 18 }}>
          {[
            { label: "Planning materiality", val: m.planning_materiality, hint: `${m.pct}% of ${pgk(m.benchmark_amount)}` },
            { label: "Performance materiality", val: m.performance_materiality, hint: `${m.performance_pct}% of planning` },
            { label: "Clearly trivial", val: m.clearly_trivial, hint: `${m.trivial_pct}% of planning` },
          ].map((c) => (
            <div key={c.label} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, background: C.cream }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.04 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.navy, marginTop: 4 }}>{pgk(c.val)}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.hint}</div>
            </div>
          ))}
          {!m.in_range && (
            <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#7c2d12", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px" }}>
              Note: {m.pct}% is outside the conventional band for this benchmark — document the rationale in the basis note.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskRegister({ engagementId }) {
  const [risks, setRisks] = useState(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [nr, setNr] = useState({ area: "", assertion: "", description: "", likelihood: 2, impact: 2, response: "" });

  const load = useCallback(async () => {
    try { const j = await api(`/api/audit/engagements/${engagementId}/risks`); setRisks(j.risks || []); }
    catch (e) { setErr(e.message); }
  }, [engagementId]);
  useEffect(() => { load(); }, [load]);

  async function patch(risk_id, body) {
    setErr("");
    try { await api(`/api/audit/engagements/${engagementId}/risks`, { method: "PATCH", body: JSON.stringify({ risk_id, ...body }) }); load(); }
    catch (e) { setErr(e.message); }
  }
  async function add() {
    setErr("");
    try {
      await api(`/api/audit/engagements/${engagementId}/risks`, { method: "POST", body: JSON.stringify(nr) });
      setNr({ area: "", assertion: "", description: "", likelihood: 2, impact: 2, response: "" }); setAdding(false); load();
    } catch (e) { setErr(e.message); }
  }
  if (!risks) return <Loader2 size={18} className="spin" color={C.gold} />;

  return (
    <div>
      {err && <Flash type="error">{err}</Flash>}
      <p style={{ ...lead, fontSize: 13, marginTop: 0 }}>
        Seeded with the presumed risks for this engagement type. Adjust likelihood × impact; the rating updates automatically.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {risks.map((r) => {
          const rc = rateColor(r.rating);
          return (
            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{r.area}</strong>
                  <span style={{ fontSize: 11, color: C.muted }}> · {r.assertion}</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.04,
                  background: rc.bg, color: rc.ink, padding: "3px 8px", borderRadius: 999 }}>{r.rating} risk</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.inkSoft, margin: "6px 0" }}>{r.description}</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
                {["likelihood", "impact"].map((k) => (
                  <label key={k} style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                    {k}
                    <select value={r[k]} onChange={(e) => patch(r.id, { [k]: Number(e.target.value) })}
                      style={{ ...input, width: "auto", padding: "5px 8px" }}>
                      <option value={1}>1 · low</option><option value={2}>2 · med</option><option value={3}>3 · high</option>
                    </select>
                  </label>
                ))}
                <button onClick={() => patch(r.id, { status: r.status === "addressed" ? "identified" : "addressed" })}
                  style={{ ...btnGhostSm, color: r.status === "addressed" ? "#14532d" : C.ink, borderColor: r.status === "addressed" ? "#bbf7d0" : "#d1d5db" }}>
                  {r.status === "addressed" ? <><Check size={12} /> Addressed</> : "Mark addressed"}
                </button>
              </div>
              <ResponseEditor value={r.response} onSave={(v) => patch(r.id, { response: v })} />
            </div>
          );
        })}
      </div>

      {adding ? (
        <div style={{ border: "1px dashed #cbd5e1", borderRadius: 10, padding: 14, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Area"><input style={input} value={nr.area} onChange={(e) => setNr({ ...nr, area: e.target.value })} /></Field>
            <Field label="Assertion"><input style={input} value={nr.assertion} onChange={(e) => setNr({ ...nr, assertion: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea style={{ ...input, minHeight: 48 }} value={nr.description} onChange={(e) => setNr({ ...nr, description: e.target.value })} /></Field>
          <Field label="Planned response"><textarea style={{ ...input, minHeight: 48 }} value={nr.response} onChange={(e) => setNr({ ...nr, response: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={add} style={btnPrimaryInline}>Add risk</button>
            <button onClick={() => setAdding(false)} style={btnGhostSm}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btnGhostSm, marginTop: 12 }}><Plus size={12} /> Add a risk</button>
      )}
    </div>
  );
}

function ResponseEditor({ value, onSave }) {
  const [v, setV] = useState(value || "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setV(value || ""); setDirty(false); }, [value]);
  return (
    <div>
      <textarea value={v} onChange={(e) => { setV(e.target.value); setDirty(true); }}
        placeholder="Planned audit response…" style={{ ...input, minHeight: 44, fontSize: 12.5 }} />
      {dirty && <button onClick={() => onSave(v)} style={{ ...btnGhostSm, marginTop: 6 }}><Check size={12} /> Save response</button>}
    </div>
  );
}

function WorkpaperList({ engagementId }) {
  const [wps, setWps] = useState(null);
  const [err, setErr] = useState("");
  const [openRef, setOpenRef] = useState(null);

  const load = useCallback(async () => {
    try { const j = await api(`/api/audit/engagements/${engagementId}/workpapers`); setWps(j.workpapers || []); }
    catch (e) { setErr(e.message); }
  }, [engagementId]);
  useEffect(() => { load(); }, [load]);

  async function act(wp_id, action, extra) {
    setErr("");
    try { await api(`/api/audit/engagements/${engagementId}/workpapers`, { method: "PATCH", body: JSON.stringify({ wp_id, action, ...extra }) }); load(); }
    catch (e) { setErr(e.message); }
  }
  if (!wps) return <Loader2 size={18} className="spin" color={C.gold} />;

  const wpStatusColor = (s) =>
    s === "signed_off" ? { bg: "#dcfce7", ink: "#14532d" } :
    s === "reviewed"   ? { bg: "#dbeafe", ink: "#1e40af" } :
    s === "prepared"   ? { bg: "#fef3c7", ink: "#7c2d12" } :
    s === "in_progress"? { bg: "#f1f5f9", ink: "#334155" } :
                         { bg: "#f8fafc", ink: "#94a3b8" };
  const signedCount = wps.filter((w) => w.status === "signed_off").length;

  return (
    <div>
      {err && <Flash type="error">{err}</Flash>}
      <p style={{ ...lead, fontSize: 13, marginTop: 0 }}>
        The audit file index. {signedCount}/{wps.length} signed off. Tick procedures, then move each paper through
        <strong> prepare → review → partner sign-off</strong>.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {wps.map((w) => {
          const sc = wpStatusColor(w.status);
          const open = openRef === w.ref;
          return (
            <div key={w.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => setOpenRef(open ? null : w.ref)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
                background: "#fff", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              }}>
                <ChevronRight size={14} color={C.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                <span style={{ fontWeight: 800, color: C.navy, width: 24 }}>{w.ref}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{w.title}<span style={{ color: C.muted, fontWeight: 400 }}> · {w.section}</span></span>
                <span style={{ fontSize: 11, color: C.muted }}>{w.progress}%</span>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.04,
                  background: sc.bg, color: sc.ink, padding: "3px 8px", borderRadius: 999 }}>{w.status.replace("_", " ")}</span>
              </button>
              {open && (
                <div style={{ padding: "0 14px 14px 48px", borderTop: "1px solid #f1f5f9" }}>
                  <div style={{ display: "grid", gap: 4, margin: "12px 0" }}>
                    {w.procedures.map((p, i) => (
                      <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.inkSoft, cursor: "pointer" }}>
                        <input type="checkbox" checked={p.done} onChange={() => {
                          const done = w.procedures.map((x) => x.done); done[i] = !done[i];
                          act(w.id, "set_procedures", { done });
                        }} />
                        <span style={{ textDecoration: p.done ? "line-through" : "none", color: p.done ? C.muted : C.inkSoft }}>{p.text}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    {w.status !== "signed_off" && w.status !== "reviewed" && (
                      <button onClick={() => act(w.id, "prepare")} style={btnGhostSm}>Mark prepared</button>)}
                    {w.status === "prepared" && (
                      <button onClick={() => act(w.id, "review")} style={btnGhostSm}>Mark reviewed</button>)}
                    {w.status === "reviewed" && (
                      <button onClick={() => act(w.id, "sign_off")} style={{ ...btnGhostSm, background: C.navy, color: "#fff", borderColor: C.navy }}><Check size={12} /> Partner sign-off</button>)}
                    {(w.status === "prepared" || w.status === "reviewed" || w.status === "signed_off") && (
                      <button onClick={() => act(w.id, "reopen")} style={{ ...btnGhostSm, color: C.red, borderColor: "#fecaca" }}>Reopen</button>)}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                    {w.prepared_by && <>Prepared by {w.prepared_by} · </>}
                    {w.reviewed_by && <>Reviewed by {w.reviewed_by} · </>}
                    {w.signed_off_by && <>Signed off by {w.signed_off_by}</>}
                  </div>
                  <NoteAdder onAdd={(note) => act(w.id, "add_note", { note })} notes={w.review_notes} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NoteAdder({ onAdd, notes }) {
  const [v, setV] = useState("");
  return (
    <div>
      {notes.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, background: "#fffaf0", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px" }}>
              <strong style={{ color: C.ink }}>{n.by}</strong>: {n.note}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a review note…" style={{ ...input, fontSize: 12.5 }} />
        <button onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }} style={btnGhostSm}>Add note</button>
      </div>
    </div>
  );
}

/* Mirror of api/audit/_checklist.ts — kept in sync manually for the client side */
function buildChecklist(type) {
  const BASE = [
    { slot: "trial_balance",        label: "Trial balance (year-end)",
      description: "Year-end TB with debit/credit columns. Accounting software export preferred.",
      formats: "XLSX, CSV", required: true },
    { slot: "general_ledger",       label: "General ledger export",
      description: "All transactions for the year, account-by-account.",
      formats: "XLSX, CSV", required: true },
    { slot: "bank_statements",      label: "Bank statements",
      description: "Every bank account, every month of the FY.",
      formats: "PDF, CSV", required: true },
    { slot: "bank_reconciliations", label: "Bank reconciliations",
      description: "Monthly bank rec workbooks if maintained.",
      formats: "XLSX, PDF", required: false },
    { slot: "prior_year_financials", label: "Prior-year audited financials",
      description: "Last year's signed audit report.",
      formats: "PDF", required: true },
  ];
  const PAYROLL = [
    { slot: "payroll_register",     label: "Payroll register",
      description: "Per-employee annual gross, SWT, NASFund, net.", formats: "XLSX, PDF", required: true },
    { slot: "irc_swt_evidence",     label: "IRC SWT remittance evidence",
      description: "IRC receipts per month.", formats: "PDF", required: false },
    { slot: "nasfund_evidence",     label: "NASFund / NCSL evidence",
      description: "NASFund receipts per month.", formats: "PDF", required: false },
  ];
  const COMPLIANCE = [
    { slot: "tax_returns",          label: "Prior tax returns",
      description: "Last 2 years' income, GST, withholding returns.", formats: "PDF", required: true },
    { slot: "ipa_filings",          label: "IPA filings",
      description: "Annual return, share register, director changes.", formats: "PDF", required: false },
  ];
  const ASSETS = [
    { slot: "fixed_asset_register", label: "Fixed-asset register",
      description: "Asset listing with cost, depreciation, NBV.", formats: "XLSX, PDF", required: true },
    { slot: "inventory_listing",    label: "Inventory listing (year-end)",
      description: "Stocktake report.", formats: "XLSX, PDF", required: false },
  ];
  const GOV = [
    { slot: "board_minutes",        label: "Board minutes",
      description: "Minutes during the audit year.", formats: "PDF, DOCX", required: false },
    { slot: "management_accounts",  label: "Monthly management accounts",
      description: "Internal P&L and BS per month.", formats: "XLSX, PDF", required: false },
  ];
  const DONOR = [
    { slot: "donor_agreement",      label: "Donor / grant agreement",
      description: "Signed grant agreement.", formats: "PDF", required: true },
    { slot: "donor_budget_actual",  label: "Budget vs. actual report",
      description: "Project-coded actuals vs. budget.", formats: "XLSX, PDF", required: true },
  ];
  const LANDOWNER = [
    { slot: "lo_directives",        label: "Royalty distributions / directives",
      description: "Royalty payments to ILGs/clans.", formats: "PDF, XLSX", required: true },
    { slot: "unit_trust_register",  label: "Unit trust beneficiary register",
      description: "Beneficiary listing & distribution history.", formats: "XLSX, PDF", required: false },
  ];
  switch (type) {
    case "statutory": return [...BASE, ...PAYROLL, ...COMPLIANCE, ...ASSETS, ...GOV];
    case "readiness": return [...BASE.map((b) => b.slot === "trial_balance" || b.slot === "general_ledger" ? b : { ...b, required: false }), ...PAYROLL, ...COMPLIANCE];
    case "tax":       return [...BASE.slice(0, 3), ...PAYROLL, ...COMPLIANCE];
    case "compliance":return [...PAYROLL, ...COMPLIANCE];
    case "donor_fund":return [...BASE, ...DONOR, ...PAYROLL, ...GOV];
    case "landowner": return [...BASE, ...LANDOWNER, ...PAYROLL, ...COMPLIANCE, ...ASSETS, ...GOV];
    default:          return [...BASE, ...PAYROLL, ...COMPLIANCE, ...ASSETS];
  }
}

/* ─────── reusables ─────── */
function Centered({ children }) {
  return (
    <div style={{ minHeight: "calc(100vh - 60px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </div>
  );
}
function Flash({ type, children }) {
  const palette = type === "error" ? { bg: "#fee2e2", bd: "#fecaca", ink: "#7f1d1d" } :
                  type === "info"  ? { bg: "#dbeafe", bd: "#bfdbfe", ink: "#1e40af" } :
                                      { bg: "#dcfce7", bd: "#bbf7d0", ink: "#14532d" };
  return <div style={{
    background: palette.bg, border: `1px solid ${palette.bd}`, color: palette.ink,
    padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13,
    display: "flex", alignItems: "center", gap: 8,
  }}><AlertCircle size={14} />{children}</div>;
}
function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.04 }}>{label}</span>
      {children}
    </label>
  );
}
const h1 = { margin: 0, fontSize: 28, fontWeight: 800, color: C.ink };
const h2 = { margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: C.ink };
const lead = { color: C.inkSoft, fontSize: 15, lineHeight: 1.55, margin: "8px 0 0" };
const input = {
  display: "block", width: "100%", padding: "11px 13px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 14, background: "#fff", color: C.ink, outline: "none",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "11px 18px", borderRadius: 8, width: "100%",
  background: C.navy, color: "#fff", fontWeight: 700, fontSize: 14,
  border: "none", cursor: "pointer", marginBottom: 8,
};
const btnPrimaryInline = {
  display: "inline-flex", alignItems: "center",
  padding: "9px 16px", borderRadius: 8,
  background: C.navy, color: "#fff", fontWeight: 700, fontSize: 14,
  border: "none", cursor: "pointer",
};
const btnGhostLg = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "11px 18px", borderRadius: 8, width: "100%",
  background: "#fff", color: C.ink, fontWeight: 600, fontSize: 14,
  border: "1px solid #d1d5db", cursor: "pointer",
};
const btnGhostSm = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
  background: "#fff", color: C.ink, border: "1px solid #d1d5db", cursor: "pointer",
};
const miniNav = {
  fontSize: 12, color: "#cbd5e1", textDecoration: "none",
  padding: "5px 10px", borderRadius: 6,
};
const engagementCard = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
  padding: 18, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
};
