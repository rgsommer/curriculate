// frontend/src/app/teebeepay/app/page.jsx
//
// TeebeePay logged-in app. Single page that switches between:
//   - Login (email → PIN → dashboard)
//   - Dashboard (company list)
//   - Company detail (pay period history + employee list tabs)
//
// Auth: localStorage'd authToken issued by /api/teebeepay/auth/verify-pin.
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Loader2, KeyRound, LogOut,
  Building2, Users, FileText, CheckCircle2, AlertCircle, Mail,
} from "lucide-react";

const C = {
  red: "#b9302a", redDeep: "#8a1f1a", gold: "#f4b400", goldDeep: "#c08c00",
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  cream: "#fffaf0", paper: "#ffffff",
};

const TOKEN_KEY = "teebeepay.authToken";
const ME_KEY    = "teebeepay.me";

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t)  { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }
function getMe() { try { return JSON.parse(localStorage.getItem(ME_KEY) || "null"); } catch { return null; } }
function setMe(m) { try { if (m) localStorage.setItem(ME_KEY, JSON.stringify(m)); else localStorage.removeItem(ME_KEY); } catch {} }

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), "Content-Type": "application/json" };
  const tok = getToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { setToken(null); setMe(null); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}

export default function TeebeePayApp() {
  const [view, setView] = useState("loading"); // loading | login | dashboard | company
  const [me, _setMe] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);

  // Bootstrap: check stored token by calling /me.
  useEffect(() => {
    (async () => {
      if (!getToken()) { setView("login"); return; }
      try {
        const { user } = await api("/api/teebeepay/me");
        setMe(user); _setMe(user);
        setView("dashboard");
      } catch {
        setView("login");
      }
    })();
  }, []);

  function signOut() { setToken(null); setMe(null); _setMe(null); setView("login"); }

  return (
    <div style={{
      minHeight: "100vh", background: "#f6f7f9", color: C.ink,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    }}>
      {view !== "login" && <AppHeader me={me} onSignOut={signOut} />}
      {view === "loading" && <Centered><Loader2 className="tbp-spin" size={28} color={C.red} /></Centered>}
      {view === "login" && <LoginCard onSignedIn={(u) => { _setMe(u); setMe(u); setView("dashboard"); }} />}
      {view === "dashboard" && <Dashboard me={me} onPick={(id) => { setSelectedCompanyId(id); setView("company"); }} />}
      {view === "company" && (
        <CompanyDetail
          me={me} companyId={selectedCompanyId}
          onBack={() => { setSelectedCompanyId(null); setView("dashboard"); }}
        />
      )}
      <style>{`@keyframes tbp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tbp-spin { animation: tbp-spin 0.9s linear infinite; }`}</style>
    </div>
  );
}

/* ─────────── Header ─────────── */

function AppHeader({ me, onSignOut }) {
  return (
    <header style={{
      background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <Link href="/teebeepay" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: C.ink }}>
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill={C.red} />
          <path d="M9 9h14M11 9v14M21 9v6c0 2-1.5 3-3.5 3H11"
            stroke={C.gold} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <strong style={{ fontSize: 17 }}>TeebeePay</strong>
      </Link>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
        {me && (
          <span style={{ fontSize: 13, color: C.muted }}>
            {me.email} · <strong style={{ color: C.inkSoft }}>{me.role}</strong>
          </span>
        )}
        <button onClick={onSignOut} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb",
          background: "#fff", color: C.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </header>
  );
}

function Centered({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>{children}</div>;
}

/* ─────────── Login ─────────── */

function LoginCard({ onSignedIn }) {
  const [step, setStep] = useState("email");  // email | pin
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pinToken, setPinToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function requestPin() {
    setError(""); setInfo(""); setSubmitting(true);
    try {
      const j = await api("/api/teebeepay/auth/request-pin", {
        method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setPinToken(j.token);
      setStep("pin");
      setInfo("We've emailed you a 6-digit code. Enter it below.");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  async function verifyPin() {
    setError(""); setSubmitting(true);
    try {
      const j = await api("/api/teebeepay/auth/verify-pin", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), pin: pin.trim(), token: pinToken }),
      });
      setToken(j.authToken); setMe(j.user);
      onSignedIn(j.user);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDeep} 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 36, width: "100%", maxWidth: 420,
        boxShadow: "0 30px 60px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill={C.red} />
            <path d="M9 9h14M11 9v14M21 9v6c0 2-1.5 3-3.5 3H11"
              stroke={C.gold} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>TeebeePay</h1>
            <div style={{ fontSize: 13, color: C.muted }}>Sign in to your account</div>
          </div>
        </div>

        {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
        {info && step === "pin" && <FlashBox type="info" icon={<Mail size={16} />}>{info}</FlashBox>}

        {step === "email" && (
          <>
            <Label>Email address</Label>
            <input
              type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && email && requestPin()}
              style={input}
            />
            <button onClick={requestPin} disabled={!email || submitting} style={btnPrimary}>
              {submitting
                ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 8 }} /> Sending code…</>
                : <>Send sign-in code <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
            </button>
            <p style={{ marginTop: 18, fontSize: 12, color: C.muted, textAlign: "center" }}>
              We'll email you a 6-digit code. No password needed.
            </p>
          </>
        )}

        {step === "pin" && (
          <>
            <Label>6-digit code</Label>
            <input
              type="text" inputMode="numeric" maxLength={6} placeholder="••••••"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && pin.length === 6 && verifyPin()}
              autoFocus
              style={{ ...input, letterSpacing: 6, fontSize: 22, textAlign: "center", fontWeight: 700 }}
            />
            <button onClick={verifyPin} disabled={pin.length !== 6 || submitting} style={btnPrimary}>
              {submitting
                ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 8 }} /> Signing in…</>
                : <>Sign in <KeyRound size={16} style={{ marginLeft: 6 }} /></>}
            </button>
            <button onClick={() => { setStep("email"); setPin(""); setError(""); setInfo(""); }}
              style={btnGhost}>← Use a different email</button>
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 6 }}>{children}</label>;
}
const input = {
  display: "block", width: "100%", padding: "12px 14px", borderRadius: 10,
  border: "1px solid #d1d5db", fontSize: 15, outline: "none", marginBottom: 14, background: "#fff",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%",
  padding: "12px 18px", borderRadius: 10, border: "none", cursor: "pointer",
  background: C.red, color: "#fff", fontWeight: 700, fontSize: 15,
};
const btnGhost = {
  display: "block", width: "100%", marginTop: 12,
  padding: "10px 18px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff",
  color: C.inkSoft, fontWeight: 500, fontSize: 13, cursor: "pointer",
};

function FlashBox({ type, icon, children }) {
  const color = type === "error" ? "#991b1b" : "#1e40af";
  const bg = type === "error" ? "#fee2e2" : "#dbeafe";
  return (
    <div style={{ background: bg, color, padding: "10px 14px", borderRadius: 8,
      fontSize: 13, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/* ─────────── Dashboard ─────────── */

function Dashboard({ me, onPick }) {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const j = await api("/api/teebeepay/companies");
      setCompanies(j.companies || []);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800 }}>Welcome back.</h1>
      <p style={{ color: C.muted, fontSize: 15, margin: "0 0 28px" }}>
        {companies == null ? "Loading your client companies…" :
         companies.length === 0 ? "No companies set up yet." :
         `${companies.length} ${companies.length === 1 ? "company" : "companies"} on your roster.`}
      </p>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {companies == null ? (
        <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {companies.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)} style={companyCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: "#fff7e0",
                  color: C.goldDeep, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Building2 size={20} />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {c.abbreviation && `${c.abbreviation} · `}{c.pay_interval}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.muted }}>
                <span><strong style={{ color: C.ink }}>{c.periods}</strong> pay periods</span>
                <span><strong style={{ color: C.ink }}>{c.employees}</strong> active employees</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const companyCard = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
  padding: 20, textAlign: "left", cursor: "pointer", display: "block", width: "100%",
};

/* ─────────── Company detail ─────────── */

function CompanyDetail({ me, companyId, onBack }) {
  const [tab, setTab] = useState("periods");
  const [periods, setPeriods] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { companies } = await api("/api/teebeepay/companies");
        const co = companies.find((c) => c.id === companyId);
        if (co) setCompanyName(co.name);
        const [pj, ej] = await Promise.all([
          api(`/api/teebeepay/companies/${companyId}/periods`),
          api(`/api/teebeepay/companies/${companyId}/employees`),
        ]);
        setPeriods(pj.periods || []);
        setEmployees(ej.employees || []);
      } catch (e) { setError(e.message); }
    })();
  }, [companyId]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "none", border: "none", color: C.muted, fontSize: 13,
        fontWeight: 500, padding: 0, marginBottom: 14, cursor: "pointer",
      }}>
        <ArrowLeft size={14} /> All companies
      </button>
      <h1 style={{ margin: "0 0 18px", fontSize: 26, fontWeight: 800 }}>{companyName || "Company"}</h1>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 24 }}>
        <Tab active={tab === "periods"} onClick={() => setTab("periods")}>
          <FileText size={15} style={{ marginRight: 6 }} /> Pay periods {periods != null && `(${periods.length})`}
        </Tab>
        <Tab active={tab === "employees"} onClick={() => setTab("employees")}>
          <Users size={15} style={{ marginRight: 6 }} /> Employees {employees != null && `(${employees.length})`}
        </Tab>
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {tab === "periods" && (
        periods == null
          ? <Loader2 className="tbp-spin" size={20} color={C.red} />
          : <PeriodTable periods={periods} />
      )}

      {tab === "employees" && (
        employees == null
          ? <Loader2 className="tbp-spin" size={20} color={C.red} />
          : <EmployeeTable employees={employees} />
      )}
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 16px", border: "none", background: "none", cursor: "pointer",
      fontSize: 14, fontWeight: 600, color: active ? C.red : C.muted,
      borderBottom: active ? `2px solid ${C.red}` : "2px solid transparent",
      display: "inline-flex", alignItems: "center", marginBottom: -1,
    }}>{children}</button>
  );
}

function PeriodTable({ periods }) {
  if (!periods.length) return <Empty>No pay periods yet.</Empty>;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={th}>Pay date</th>
          <th style={th}>Period</th>
          <th style={th}>Status</th>
          <th style={{ ...th, textAlign: "right" }}># entries</th>
          <th style={{ ...th, textAlign: "right" }}>Total net (K)</th>
        </tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} style={{ borderTop: "1px solid #f1f5f9" }}>
              <td style={td}>{p.pay_date}</td>
              <td style={td}>{p.period_start} — {p.period_end}</td>
              <td style={td}><StatusBadge status={p.status} historical={p.imported_from_history} /></td>
              <td style={{ ...td, textAlign: "right" }}>{p.n_entries}</td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {p.total_net_imported != null ? p.total_net_imported.toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status, historical }) {
  if (historical) return <Badge color="#1e40af" bg="#dbeafe">Historical</Badge>;
  if (status === "approved") return <Badge color="#166534" bg="#dcfce7">Approved</Badge>;
  if (status === "pending_approval") return <Badge color="#9c6c00" bg="#fef3c7">Pending</Badge>;
  return <Badge color={C.muted} bg="#f1f5f9">{status || "draft"}</Badge>;
}
function Badge({ color, bg, children }) {
  return <span style={{ background: bg, color, padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.04 }}>{children}</span>;
}

function EmployeeTable({ employees }) {
  if (!employees.length) return <Empty>No employees in your clearance range.</Empty>;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={th}>Name</th>
          <th style={th}>Email</th>
          <th style={th}>Pay</th>
          <th style={th}>Bank account</th>
          <th style={th}>Active</th>
        </tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
              <td style={td}>{e.last_name}, {e.first_name}</td>
              <td style={{ ...td, color: C.muted }}>{e.email || "—"}</td>
              <td style={td}>
                {e.pay_type === "salary"
                  ? `Salary K${(e.annual_salary || 0).toLocaleString()}`
                  : `Hourly K${(e.hourly_rate || 0).toFixed(2)}`}
              </td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                {e.bank_account_name || "—"} {e.bank_account_no ? `· ${e.bank_account_no}` : ""}
              </td>
              <td style={td}><CheckCircle2 size={16} color={e.is_active ? "#16a34a" : "#94a3b8"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 14, background: "#fff" };
const th = { padding: "12px 14px", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06, textAlign: "left", background: "#fafbfc" };
const td = { padding: "12px 14px" };

function Empty({ children }) {
  return <div style={{ padding: 30, textAlign: "center", color: C.muted, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>{children}</div>;
}
