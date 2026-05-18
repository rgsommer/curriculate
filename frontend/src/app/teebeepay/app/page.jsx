// frontend/src/app/teebeepay/app/page.jsx
//
// TeebeePay logged-in app — single page that switches between login,
// dashboard (companies list + add), company detail (periods/employees
// tabs, with create-employee + new-pay-period actions), and a payroll
// entry grid for entering hours + approving.
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Loader2, KeyRound, LogOut,
  Building2, Users, FileText, CheckCircle2, AlertCircle, Mail,
  Plus, X, Edit2, Send, Download, Settings, UserPlus, Trash2,
  BarChart3, Percent, Upload, Image as ImageIcon, ClipboardList, Activity,
  ShieldCheck, NotebookPen, AlertTriangle, Layers, Network,
  GraduationCap, HelpCircle, ChevronRight, ChevronLeft,
} from "lucide-react";

const C = {
  red: "#b9302a", redDeep: "#8a1f1a", gold: "#f4b400", goldDeep: "#c08c00",
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  cream: "#fffaf0", paper: "#ffffff",
};

const TOKEN_KEY = "teebeepay.authToken";
const ME_KEY    = "teebeepay.me";

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }
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
  const [view, setView] = useState("loading"); // loading | login | dashboard | company | new_period | period | users | service_fees | employee | my_team
  const [me, _setMe] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [clonePeriodId, setClonePeriodId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    (async () => {
      if (!getToken()) { setView("login"); return; }
      try {
        const { user } = await api("/api/teebeepay/me");
        _setMe(user); setMe(user);
        setView("dashboard");
      } catch { setView("login"); }
    })();
  }, []);

  // Direct employees (clearance 0) to their self-serve portal once signed in.
  useEffect(() => {
    if (me && me.clearance === 0 && (view === "dashboard" || view === "loading")) {
      setView("my_stubs");
    }
  }, [me, view]);

  function signOut() { setToken(null); setMe(null); _setMe(null); setView("login"); }
  function goCompany(id) { setSelectedCompanyId(id); setView("company"); }
  function goNewPeriod(id) { setClonePeriodId(null); setSelectedCompanyId(id); setView("new_period"); }
  function goClonePeriod(id, fromPid) { setClonePeriodId(fromPid); setSelectedCompanyId(id); setView("new_period"); }
  function goPeriod(pid) { setSelectedPeriodId(pid); setView("period"); }
  function goEmployee(eid) { setSelectedEmployeeId(eid); setView("employee"); }

  return (
    <div style={{
      minHeight: "100vh", background: "#f6f7f9", color: C.ink,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    }}>
      {view !== "login" && <AppHeader me={me} onSignOut={signOut}
        onUsers={() => setView("users")}
        onServiceFees={() => setView("service_fees")}
        onAuditLog={() => setView("audit_log")}
        onMyTeam={() => setView("my_team")}
        onHome={() => setView(me?.clearance === 0 ? "my_stubs" : "dashboard")}
        onProfile={() => setShowProfile(true)} />}
      {showProfile && me && (
        <ProfileDialog me={me} onClose={() => setShowProfile(false)}
          onSaved={(u) => { _setMe({ ...me, ...u }); setMe({ ...me, ...u }); setShowProfile(false); }} />
      )}
      {/* First-sign-in name prompt — auto-show if name is blank. */}
      {me && !me.first_name && !showProfile && view !== "login" && (
        <ProfileDialog me={me} required
          onClose={() => { /* required — stays open */ }}
          onSaved={(u) => { _setMe({ ...me, ...u }); setMe({ ...me, ...u }); }} />
      )}
      {view === "loading"   && <Centered><Loader2 className="tbp-spin" size={28} color={C.red} /></Centered>}
      {view === "login"     && <LoginCard onSignedIn={(u) => { _setMe(u); setMe(u); setView("dashboard"); }} />}
      {view === "dashboard" && <Dashboard me={me} onPick={goCompany} />}
      {view === "company"   && <CompanyDetail me={me} companyId={selectedCompanyId}
        onBack={() => setView("dashboard")} onNewPeriod={() => goNewPeriod(selectedCompanyId)}
        onOpenPeriod={goPeriod} onOpenEmployee={goEmployee} />}
      {view === "new_period" && <NewPeriod me={me} companyId={selectedCompanyId}
        cloneFromPeriodId={clonePeriodId}
        onBack={() => setView("company")} onSaved={(pid) => goPeriod(pid)} />}
      {view === "period" && <PeriodDetail me={me} periodId={selectedPeriodId}
        onBack={() => setView("company")}
        onClone={() => goClonePeriod(selectedCompanyId, selectedPeriodId)} />}
      {view === "users" && <UsersPage me={me} onBack={() => setView("dashboard")} />}
      {view === "service_fees" && <ServiceFeesPage me={me} onBack={() => setView("dashboard")} />}
      {view === "employee" && <EmployeeProfile me={me} employeeId={selectedEmployeeId}
        onBack={() => setView("company")} onOpenPeriod={goPeriod} />}
      {view === "audit_log" && <AuditLogPage me={me} onBack={() => setView("dashboard")} />}
      {view === "my_team" && <MyTeamPage me={me} onBack={() => setView("dashboard")} />}
      {view === "my_stubs" && <MyStubsPortal me={me} />}
      <style>{`
        @keyframes tbp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .tbp-spin { animation: tbp-spin 0.9s linear infinite; }
        .tbp-grid input { padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; width: 100%; background: #fff; color: ${C.ink}; }
        .tbp-grid input:focus { outline: none; border-color: ${C.red}; }
      `}</style>
    </div>
  );
}

/* ─────────── Header / shared bits ─────────── */

function AppHeader({ me, onSignOut, onUsers, onServiceFees, onHome, onProfile, onAuditLog, onMyTeam }) {
  const displayName = me?.first_name || me?.last_name
    ? `${me.first_name || ""} ${me.last_name || ""}`.trim()
    : me?.email || "";
  // Show the "My team" button if the user supervises at least one division
  // that submits hours. Cheap probe — /supervisor/team returns [] for non-supervisors.
  const [hasTeam, setHasTeam] = useState(false);
  useEffect(() => {
    if (!me) { setHasTeam(false); return; }
    (async () => {
      try {
        const j = await api("/api/teebeepay/supervisor/team");
        setHasTeam(Array.isArray(j.teams) && j.teams.length > 0);
      } catch { setHasTeam(false); }
    })();
  }, [me?.uid]);
  return (
    <header style={{
      background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: C.ink }}>
        <Logo size={30} />
        <strong style={{ fontSize: 17 }}>TeebeePay</strong>
      </button>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {hasTeam && (
          <button onClick={onMyTeam} style={{ ...btnGhostSmall, background: "#fef3c7", borderColor: "#fde68a", color: "#9c6c00" }} title="Enter your team's hours">
            <Network size={14} /> My team
          </button>
        )}
        {me?.clearance >= 4 && (
          <button onClick={onServiceFees} style={btnGhostSmall} title="Service fees">
            <Percent size={14} /> Fees
          </button>
        )}
        {me?.clearance >= 2 && (
          <button onClick={onAuditLog} style={btnGhostSmall} title="Audit log">
            <Activity size={14} /> Log
          </button>
        )}
        {me?.clearance >= 3 && (
          <button onClick={onUsers} style={btnGhostSmall}>
            <Users size={14} /> Users
          </button>
        )}
        {me && (
          <button onClick={onProfile} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
            background: "none", border: "1px solid transparent", borderRadius: 6, cursor: "pointer",
            color: C.inkSoft, fontSize: 13,
          }} title="Edit your profile">
            <div style={{
              width: 26, height: 26, borderRadius: 999, background: C.cream,
              color: C.redDeep, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
            }}>{initials(me)}</div>
            <span style={{ textAlign: "left", lineHeight: 1.15 }}>
              <strong style={{ fontSize: 13, color: C.ink, display: "block" }}>{displayName}</strong>
              <small style={{ fontSize: 11, color: C.muted }}>{me.role}</small>
            </span>
          </button>
        )}
        <button onClick={onSignOut} style={btnGhostSmall}><LogOut size={14} /> Sign out</button>
      </div>
    </header>
  );
}

function initials(me) {
  const f = (me.first_name || "").trim().charAt(0).toUpperCase();
  const l = (me.last_name || "").trim().charAt(0).toUpperCase();
  if (f || l) return (f + l) || f || l;
  return (me.email || "?").charAt(0).toUpperCase();
}
function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill={C.red} />
      <path d="M9 9h14M11 9v14M21 9v6c0 2-1.5 3-3.5 3H11" stroke={C.gold} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function Centered({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>{children}</div>;
}

/* ─────────── Login ─────────── */

function LoginCard({ onSignedIn }) {
  const [step, setStep] = useState("email");   // email | pin | totp
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [totp, setTotp] = useState("");
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
      setPinToken(j.token); setStep("pin");
      setInfo("We've emailed you a 6-digit code. Enter it below.");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  async function verifyPin() {
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/teebeepay/auth/verify-pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(), pin: pin.trim(),
          token: pinToken, totp: totp.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (res.status === 401 && j.error === "2fa_required") {
        setError(""); setInfo("Enter the 6-digit code from your authenticator app.");
        setStep("totp");
        return;
      }
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setToken(j.authToken); setMe(j.user); onSignedIn(j.user);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", background: `linear-gradient(135deg, ${C.red} 0%, ${C.redDeep} 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 36, width: "100%", maxWidth: 420,
        boxShadow: "0 30px 60px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
          <Logo size={40} />
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
            <input type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && email && requestPin()} style={input} />
            <button onClick={requestPin} disabled={!email || submitting} style={btnPrimary}>
              {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 8 }} /> Sending…</>
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
            <input type="text" inputMode="numeric" maxLength={6} placeholder="••••••"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && pin.length === 6 && verifyPin()} autoFocus
              style={{ ...input, letterSpacing: 6, fontSize: 22, textAlign: "center", fontWeight: 700 }} />
            <button onClick={verifyPin} disabled={pin.length !== 6 || submitting} style={btnPrimary}>
              {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 8 }} /> Signing in…</>
                          : <>Sign in <KeyRound size={16} style={{ marginLeft: 6 }} /></>}
            </button>
            <button onClick={() => { setStep("email"); setPin(""); setError(""); setInfo(""); }} style={btnGhost}>← Use a different email</button>
          </>
        )}
        {step === "totp" && (
          <>
            <Label>Authenticator code</Label>
            <p style={{ fontSize: 13, color: C.muted, marginTop: -2, marginBottom: 10 }}>
              Open your authenticator app (Google Authenticator, Authy, 1Password…) and enter the 6-digit code for TeebeePay.
            </p>
            <input type="text" inputMode="numeric" maxLength={6} placeholder="••••••"
              value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && totp.length === 6 && verifyPin()} autoFocus
              style={{ ...input, letterSpacing: 6, fontSize: 22, textAlign: "center", fontWeight: 700 }} />
            <button onClick={verifyPin} disabled={totp.length !== 6 || submitting} style={btnPrimary}>
              {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 8 }} /> Verifying…</>
                          : <>Verify &amp; sign in <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
            </button>
            <button onClick={() => { setStep("pin"); setTotp(""); setError(""); setInfo(""); }} style={btnGhost}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────── Dashboard with Add Company ─────────── */

function Dashboard({ me, onPick }) {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try { const j = await api("/api/teebeepay/companies"); setCompanies(j.companies || []); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const greeting = me?.first_name ? `Welcome back, ${me.first_name}.` : "Welcome back.";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{greeting}</h1>
        {me?.clearance >= 3 && (
          <button onClick={() => setShowAdd(true)} style={btnPrimaryInline}>
            <Plus size={16} /> Add company
          </button>
        )}
      </div>
      <p style={{ color: C.muted, fontSize: 15, margin: "0 0 28px" }}>
        {companies == null ? "Loading client companies…" :
         companies.length === 0 ? "No companies yet — add your first one to get started." :
         `${companies.length} ${companies.length === 1 ? "company" : "companies"} on your roster.`}
      </p>

      {me?.clearance >= 2 && <ManagerStepsForToday onOpenCompany={onPick} />}

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {companies == null ? <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {companies.map((c) => {
            const badge = c.status === "pending_approval"
              ? { bg: "#fef3c7", bd: "#fde68a", color: "#9c6c00", label: "Awaiting approval" }
              : c.status === "approved_pending_upload"
                ? { bg: "#dbeafe", bd: "#bfdbfe", color: "#1d4ed8", label: "Ready to upload" }
                : null;
            return (
              <button key={c.id} onClick={() => onPick(c.id)} style={{ ...companyCard, position: "relative" }}>
                {badge && (
                  <span style={{
                    position: "absolute", top: 12, right: 12,
                    background: badge.bg, border: `1px solid ${badge.bd}`,
                    color: badge.color, padding: "3px 8px", borderRadius: 999,
                    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.04, textTransform: "uppercase",
                  }}>{badge.label}</span>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: "#fff7e0", color: C.goldDeep,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Building2 size={20} />
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{c.abbreviation && `${c.abbreviation} · `}{c.pay_interval}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.muted }}>
                  <span><strong style={{ color: C.ink }}>{c.periods}</strong> pay periods</span>
                  <span><strong style={{ color: C.ink }}>{c.employees}</strong> active employees</span>
                </div>
                {c.latest_period && badge && (
                  <div style={{ marginTop: 10, fontSize: 11, color: C.muted, textAlign: "left" }}>
                    Period {c.latest_period.period_start} → {c.latest_period.period_end} · pay date {c.latest_period.pay_date}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showAdd && <CompanyDialog onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh(); }} />}
    </div>
  );
}

function CompanyDialog({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", abbreviation: "", pay_interval: "fortnightly", default_hours: 80,
    bank_code: "088", branch_code: "", bank_account_no: "", bank_account_name: "", bank_client_no: "",
    office_email: "", manager_email: "", ncsl_employer_no: "", payslip_message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError(""); setSubmitting(true);
    try { await api("/api/teebeepay/companies", { method: "POST", body: JSON.stringify(f) }); onSaved(); }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal title="Add company" onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <Field label="Company name *">
        <input style={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sample Trading Ltd" autoFocus />
      </Field>
      <Field label="Abbreviation (used in file names)">
        <input style={input} value={f.abbreviation} onChange={(e) => set("abbreviation", e.target.value)} placeholder="e.g. STL" />
      </Field>
      <Row>
        <Field label="Pay interval">
          <select style={input} value={f.pay_interval} onChange={(e) => set("pay_interval", e.target.value)}>
            <option value="fortnightly">Fortnightly</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <Field label="Default hours / period">
          <input style={input} type="number" step="0.5" value={f.default_hours} onChange={(e) => set("default_hours", e.target.value)} />
        </Field>
      </Row>
      <FieldGroup label="Bank (BSP defaults shown)">
        <Row>
          <Field label="Bank code"><input style={input} value={f.bank_code} onChange={(e) => set("bank_code", e.target.value)} /></Field>
          <Field label="Branch"><input style={input} value={f.branch_code} onChange={(e) => set("branch_code", e.target.value)} placeholder="e.g. 314" /></Field>
        </Row>
        <Field label="Account number"><input style={input} value={f.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} /></Field>
        <Field label="Account name"><input style={input} value={f.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} /></Field>
        <Field label="BSP client number"><input style={input} value={f.bank_client_no} onChange={(e) => set("bank_client_no", e.target.value)} placeholder="e.g. 1267866" /></Field>
      </FieldGroup>
      <FieldGroup label="Office & NASFund">
        <Field label="Office email"><input style={input} type="email" value={f.office_email} onChange={(e) => set("office_email", e.target.value)} /></Field>
        <Field label="Manager email"><input style={input} type="email" value={f.manager_email} onChange={(e) => set("manager_email", e.target.value)} /></Field>
        <Field label="NCSL employer number"><input style={input} value={f.ncsl_employer_no} onChange={(e) => set("ncsl_employer_no", e.target.value)} placeholder="e.g. 018768" /></Field>
      </FieldGroup>
      <Field label="Default pay-slip message">
        <textarea style={{ ...input, minHeight: 70 }} value={f.payslip_message}
          onChange={(e) => set("payslip_message", e.target.value)}
          placeholder="Attached is your pay slip for the current pay period…" />
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!f.name || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Creating…</> : "Create company"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Company detail (periods + employees, with add) ─────────── */

function CompanyDetail({ me, companyId, onBack, onNewPeriod, onOpenPeriod, onOpenEmployee }) {
  const [tab, setTab] = useState("periods");
  const [periods, setPeriods] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [showEmpDialog, setShowEmpDialog] = useState(null); // null | {} | employee_id
  const [showImport, setShowImport] = useState(false);
  const [selectedEmps, setSelectedEmps] = useState(new Set());

  const refresh = useCallback(async () => {
    setError("");
    setSelectedEmps(new Set());
    try {
      const { companies } = await api("/api/teebeepay/companies");
      const co = companies.find((c) => c.id === companyId);
      if (co) setCompanyName(co.name);
      const [pj, ej] = await Promise.all([
        api(`/api/teebeepay/companies/${companyId}/periods`),
        api(`/api/teebeepay/companies/${companyId}/employees`),
      ]);
      setPeriods(pj.periods || []); setEmployees(ej.employees || []);
    } catch (e) { setError(e.message); }
  }, [companyId]);
  useEffect(() => { refresh(); }, [refresh]);

  function toggleSel(id) {
    setSelectedEmps((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  }
  async function bulkDeactivate() {
    if (!selectedEmps.size) return;
    if (!confirm(`Mark ${selectedEmps.size} employee(s) as inactive? They won't appear on future pay periods.`)) return;
    try {
      await api(`/api/teebeepay/companies/${companyId}/employees/bulk-deactivate`, {
        method: "POST", body: JSON.stringify({ employee_ids: [...selectedEmps] }),
      });
      refresh();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> All companies</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 18px" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{companyName || "Company"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {me?.clearance >= 1 && (
            <button onClick={onNewPeriod} style={btnPrimaryInline}>
              <Plus size={16} /> New pay period
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 24 }}>
        <Tab active={tab === "periods"} onClick={() => setTab("periods")}>
          <FileText size={15} style={{ marginRight: 6 }} /> Pay periods {periods != null && `(${periods.length})`}
        </Tab>
        <Tab active={tab === "employees"} onClick={() => setTab("employees")}>
          <Users size={15} style={{ marginRight: 6 }} /> Employees {employees != null && `(${employees.length})`}
        </Tab>
        {me?.clearance >= 2 && (
          <Tab active={tab === "divisions"} onClick={() => setTab("divisions")}>
            <Layers size={15} style={{ marginRight: 6 }} /> Divisions
          </Tab>
        )}
        {me?.clearance >= 2 && (
          <Tab active={tab === "reports"} onClick={() => setTab("reports")}>
            <BarChart3 size={15} style={{ marginRight: 6 }} /> Reports
          </Tab>
        )}
        {me?.clearance >= 2 && (
          <Tab active={tab === "tax_rules"} onClick={() => setTab("tax_rules")}>
            <Settings size={15} style={{ marginRight: 6 }} /> Tax rules
          </Tab>
        )}
        {me?.clearance >= 3 && (
          <Tab active={tab === "settings"} onClick={() => setTab("settings")}>
            <Edit2 size={15} style={{ marginRight: 6 }} /> Settings
          </Tab>
        )}
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {tab === "periods" && (
        <>
          <SupervisorSubmissions companyId={companyId} />
          {periods == null ? <Loader2 className="tbp-spin" size={20} color={C.red} />
                           : <PeriodTable periods={periods} onOpen={onOpenPeriod} />}
        </>
      )}

      {tab === "employees" && (
        <>
          {me?.clearance >= 2 && (
            <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setShowEmpDialog({})} style={btnPrimaryInline}>
                <Plus size={16} /> Add employee
              </button>
              <button onClick={() => setShowImport(true)} style={btnGhostLg}>
                <Upload size={14} style={{ marginRight: 6 }} /> Import from CSV
              </button>
              {selectedEmps.size > 0 && (
                <button onClick={bulkDeactivate} style={{ ...btnGhostLg, color: "#991b1b", borderColor: "#fecaca" }}>
                  <Trash2 size={14} style={{ marginRight: 6 }} /> Deactivate {selectedEmps.size} selected
                </button>
              )}
            </div>
          )}
          {employees == null ? <Loader2 className="tbp-spin" size={20} color={C.red} />
                             : <EmployeeTable employees={employees}
                                 selected={selectedEmps} onToggleSel={toggleSel}
                                 onEdit={(e) => setShowEmpDialog(e)} canEdit={me?.clearance >= 2}
                                 onOpen={(e) => onOpenEmployee && onOpenEmployee(e.id)} />}
        </>
      )}

      {tab === "divisions" && (
        <DivisionsPanel companyId={companyId} employees={employees || []} canEdit={me?.clearance >= 2} />
      )}

      {tab === "tax_rules" && (
        <TaxRulesPanel companyId={companyId} canEdit={me?.clearance >= 3} />
      )}

      {tab === "reports" && (
        <ReportsPanel companyId={companyId} />
      )}

      {tab === "settings" && (
        <CompanySettingsPanel companyId={companyId} onSaved={refresh} />
      )}

      {showEmpDialog && (
        <EmployeeDialog companyId={companyId} employee={showEmpDialog.id ? showEmpDialog : null}
          allEmployees={employees || []}
          me={me}
          onClose={() => setShowEmpDialog(null)}
          onSaved={() => { setShowEmpDialog(null); refresh(); }} />
      )}
      {showImport && (
        <ImportEmployeesDialog companyId={companyId}
          onClose={() => setShowImport(false)}
          onSaved={() => { setShowImport(false); refresh(); }} />
      )}
    </div>
  );
}

/* ─────────── CSV Import dialog ─────────── */

function ImportEmployeesDialog({ companyId, onClose, onSaved }) {
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function readFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
  }

  async function submit() {
    setError(""); setResult(null); setSubmitting(true);
    try {
      const j = await api(`/api/teebeepay/companies/${companyId}/employees/import`, {
        method: "POST", body: JSON.stringify({ csv }),
      });
      setResult(j);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal title="Import employees from CSV" onClose={onClose} wide>
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
        Paste the contents of your "PNGPay Bulk Employees" spreadsheet (or any CSV with matching
        headers). Required headers: <code>fname</code>, <code>lname</code>. Recognised:
        {" "}<code>account_name</code>, <code>bank_code</code>, <code>branch_code</code>,
        {" "}<code>bank_account</code>, <code>position</code>, <code>department</code>,
        {" "}<code>dob</code>, <code>datestarted</code>, <code>anual_price</code>,
        {" "}<code>hour_price</code>, <code>hours</code>, <code>fte</code>, <code>email</code>,
        {" "}<code>phone</code>, <code>dependents</code>, <code>nas</code>, <code>meals</code>,
        {" "}<code>school_fees</code>, <code>leave_fares</code>, <code>allowance_*</code>,
        {" "}<code>vol_salary</code>, <code>vol_ncsl</code>, <code>residency_status</code>,
        {" "}<code>declaration</code>, <code>status</code>, <code>notes</code>.
        {" "}Duplicates (matching first + last name) are skipped.
      </p>
      <Field label="Pick a .csv file">
        <input type="file" accept=".csv,text/csv" onChange={readFile} style={{ fontSize: 13 }} />
      </Field>
      <Field label="…or paste CSV directly">
        <textarea
          rows={12} value={csv} onChange={(e) => setCsv(e.target.value)}
          placeholder="fname,lname,account_name,bank_code,branch_code,bank_account,position,department,…"
          style={{ ...input, minHeight: 200, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12 }}
        />
      </Field>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {result && (
        <FlashBox type="info" icon={<CheckCircle2 size={16} />}>
          <strong>{result.created}</strong> created · <strong>{result.skipped}</strong> skipped (duplicates / missing names)
          {result.errors && result.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>{result.errors.length} error(s)</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </FlashBox>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={btnGhostLg}>{result ? "Close" : "Cancel"}</button>
        {result ? (
          <button onClick={onSaved} style={btnPrimaryInline}>Refresh list</button>
        ) : (
          <button onClick={submit} disabled={!csv.trim() || submitting} style={btnPrimaryInline}>
            {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Importing…</>
                        : "Import"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function PeriodTable({ periods, onOpen }) {
  if (!periods.length) return <Empty>No pay periods yet. Click "New pay period" to start.</Empty>;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <table style={tableStyle}>
        <thead><tr>
          <th style={th}>Pay date</th><th style={th}>Period</th><th style={th}>Status</th>
          <th style={{ ...th, textAlign: "right" }}># entries</th>
          <th style={{ ...th, textAlign: "right" }}>Net (K)</th>
          <th style={{ ...th, textAlign: "right" }}></th>
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
              <td style={{ ...td, textAlign: "right" }}>
                <button onClick={() => onOpen(p.id)} style={btnGhostSmall}>Open <ArrowRight size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeTable({ employees, selected, onToggleSel, onEdit, canEdit, onOpen }) {
  if (!employees.length) return <Empty>No employees yet.</Empty>;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <table style={tableStyle}>
        <thead><tr>
          {canEdit && <th style={{ ...th, width: 40 }}></th>}
          <th style={th}>Name</th><th style={th}>Email</th><th style={th}>Pay</th>
          <th style={th}>Bank account</th><th style={th}>Active</th>
          <th style={{ ...th, width: 120 }}></th>
        </tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9",
              background: selected?.has(e.id) ? "#fff7e0" : undefined }}>
              {canEdit && (
                <td style={{ ...td, width: 40 }}>
                  <input type="checkbox" checked={selected?.has(e.id) || false}
                    onChange={() => onToggleSel(e.id)} disabled={!e.is_active} />
                </td>
              )}
              <td style={td}>
                <button onClick={() => onOpen && onOpen(e)} style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: C.ink, fontSize: "inherit", textAlign: "left", fontFamily: "inherit",
                }}>{e.last_name}, {e.first_name}</button>
              </td>
              <td style={{ ...td, color: C.muted }}>{e.email || "—"}</td>
              <td style={td}>{e.pay_type === "salary" ? `Salary K${(e.annual_salary || 0).toLocaleString()}` : `Hourly K${(e.hourly_rate || 0).toFixed(2)}`}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                {e.bank_account_name || "—"} {e.bank_account_no ? `· ${e.bank_account_no}` : ""}
              </td>
              <td style={td}><CheckCircle2 size={16} color={e.is_active ? "#16a34a" : "#94a3b8"} /></td>
              <td style={{ ...td, display: "flex", gap: 6 }}>
                <button onClick={() => onOpen && onOpen(e)} style={btnGhostSmall} title="Open profile">
                  View
                </button>
                {canEdit && (
                  <button onClick={() => onEdit(e)} style={btnGhostSmall} title="Edit">
                    <Edit2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeDialog({ companyId, employee, allEmployees, me, onClose, onSaved }) {
  const isEdit = !!employee;
  const [divisions, setDivisions] = useState([]);
  const [showAdjustPay, setShowAdjustPay] = useState(false);
  const [payHistory, setPayHistory] = useState([]);
  useEffect(() => {
    (async () => {
      try { setDivisions((await api(`/api/teebeepay/companies/${companyId}/divisions`)).divisions || []); }
      catch { setDivisions([]); }
    })();
  }, [companyId]);
  // Load pay history for existing employees (so the "View pay history" link has data)
  useEffect(() => {
    if (!isEdit) { setPayHistory([]); return; }
    (async () => {
      try {
        const j = await api(`/api/teebeepay/companies/${companyId}/employees/${employee.id}`);
        setPayHistory(Array.isArray(j.employee?.pay_history) ? j.employee.pay_history : []);
      } catch { setPayHistory([]); }
    })();
  }, [companyId, isEdit, employee?.id]);
  // Seed bank_accounts: prefer the array; else build single-row from legacy fields.
  const seedBankAccounts = (() => {
    if (employee?.bank_accounts && employee.bank_accounts.length) return employee.bank_accounts;
    if (employee?.bank_account_no || employee?.bank_account_name) {
      return [{
        bank_code: employee.bank_code || "088",
        branch_code: employee.branch_code || "",
        account_no: employee.bank_account_no || "",
        account_name: employee.bank_account_name || "",
        percentage: 100,
      }];
    }
    return [{ bank_code: "088", branch_code: "", account_no: "", account_name: "", percentage: 100 }];
  })();

  const [f, setF] = useState({
    first_name: employee?.first_name || "",
    last_name: employee?.last_name || "",
    email: employee?.email || "",
    dob: employee?.dob || "",
    pay_type: employee?.pay_type || "hourly",
    hourly_rate: employee?.hourly_rate ?? "",
    annual_salary: employee?.annual_salary ?? "",
    default_hours: employee?.default_hours ?? 80,
    fte_pct: employee?.fte_pct ?? 100,
    dependents: employee?.dependents ?? 0,
    residency_status: employee?.residency_status || "resident",
    declaration_lodged: employee?.declaration_lodged !== false,
    bank_accounts: seedBankAccounts,
    // legacy single-bank mirrors (kept in sync with bank_accounts[0])
    bank_account_no: employee?.bank_account_no || "",
    bank_account_name: employee?.bank_account_name || "",
    branch_code: employee?.branch_code || "",
    bank_code: employee?.bank_code || "088",
    housing_allowance: employee?.housing_allowance ?? 0,
    meals_allowance: employee?.meals_allowance ?? 0,
    school_fees_allowance: employee?.school_fees_allowance ?? 0,
    salary_sacrifice: employee?.salary_sacrifice ?? 0,
    ncsl_voluntary: employee?.ncsl_voluntary ?? 0,
    nas_extra_pct: employee?.nas_extra_pct ?? 0,
    is_active: employee?.is_active !== false,
    division_id: employee?.division_id || "",
  });

  // Helpers for the bank_accounts array.
  function setAccount(idx, key, value) {
    setF((x) => {
      const ba = [...x.bank_accounts];
      ba[idx] = { ...ba[idx], [key]: value };
      // Keep legacy single-bank mirrors in sync with the first row.
      const first = ba[0] || {};
      return {
        ...x, bank_accounts: ba,
        bank_account_no: first.account_no || "",
        bank_account_name: first.account_name || "",
        branch_code: first.branch_code || "",
        bank_code: first.bank_code || "088",
      };
    });
  }
  function addAccount() {
    setF((x) => {
      // Auto-rebalance: split the new account out of whatever's currently 100% on row 1, etc.
      const newRow = { bank_code: "088", branch_code: "", account_no: "", account_name: "", percentage: 0 };
      return { ...x, bank_accounts: [...x.bank_accounts, newRow] };
    });
  }
  function removeAccount(idx) {
    setF((x) => {
      const ba = x.bank_accounts.filter((_, i) => i !== idx);
      // If only one left, force it to 100%.
      if (ba.length === 1) ba[0] = { ...ba[0], percentage: 100 };
      return { ...x, bank_accounts: ba.length ? ba : [{ bank_code: "088", branch_code: "", account_no: "", account_name: "", percentage: 100 }] };
    });
  }
  const pctTotal = f.bank_accounts.reduce((s, a) => s + (Number(a.percentage) || 0), 0);
  const pctOk = Math.abs(pctTotal - 100) < 0.5;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setError(""); setSubmitting(true);
    if (f.bank_accounts.length > 1 && !pctOk) {
      setSubmitting(false);
      setError(`Bank account percentages must sum to 100. Currently ${pctTotal.toFixed(1)}.`);
      return;
    }
    try {
      const payload = {
        ...f,
        // Strip empty accounts before sending; backend stores bank_accounts array.
        bank_accounts: f.bank_accounts.filter((a) => a.account_no || a.account_name),
      };
      if (isEdit) {
        await api(`/api/teebeepay/companies/${companyId}/employees/${employee.id}`,
          { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api(`/api/teebeepay/companies/${companyId}/employees`,
          { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  return (
    <Modal title={isEdit ? `Edit ${employee.first_name} ${employee.last_name}` : "Add employee"} onClose={onClose} wide>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <Row>
        <Field label="First name *"><input style={input} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus /></Field>
        <Field label="Last name *"><input style={input} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Email (for pay stubs)"><input style={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Date of birth (for NASFund)"><input style={input} type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
      </Row>
      <FieldGroup label="Compensation">
        <Row>
          <Field label="Pay type">
            <select style={input} value={f.pay_type} onChange={(e) => set("pay_type", e.target.value)}>
              <option value="hourly">Hourly</option><option value="salary">Salary</option>
            </select>
          </Field>
          <Field label={f.pay_type === "salary" ? "Annual salary (PGK)" : "Hourly rate (PGK)"}>
            <input style={input} type="number" step="0.01"
              value={f.pay_type === "salary" ? f.annual_salary : f.hourly_rate}
              onChange={(e) => set(f.pay_type === "salary" ? "annual_salary" : "hourly_rate", e.target.value)} />
          </Field>
        </Row>
        {isEdit && (me?.clearance >= 3) && (
          <div style={{ marginTop: 6, padding: 12, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12, color: C.muted }}>
                <strong style={{ color: C.ink }}>Adjust pay (Principal-only).</strong> Increase or decrease by % or fixed PGK,
                with a reason. Journaled to the audit log + the employee's pay history.
              </div>
              <button type="button" onClick={() => setShowAdjustPay(true)} style={btnGhostLg}>
                <Percent size={14} style={{ marginRight: 6 }} /> Adjust pay
              </button>
            </div>
            {payHistory.length > 0 && (
              <details style={{ marginTop: 10, fontSize: 12 }}>
                <summary style={{ cursor: "pointer", color: C.inkSoft, fontWeight: 600 }}>
                  Pay history ({payHistory.length} change{payHistory.length === 1 ? "" : "s"})
                </summary>
                <table style={{ width: "100%", marginTop: 8, fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.06 }}>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>Date</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>Field</th>
                      <th style={{ textAlign: "right", padding: "4px 6px" }}>From</th>
                      <th style={{ textAlign: "right", padding: "4px 6px" }}>To</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>By</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...payHistory].reverse().map((h, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{h.effective_date || (h.ts && new Date(h.ts).toISOString().slice(0, 10))}</td>
                        <td style={{ padding: "4px 6px", color: C.muted }}>{h.pay_field === "hourly_rate" ? "Hourly" : "Annual"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(h.old_value || 0).toFixed(2)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{Number(h.new_value || 0).toFixed(2)}</td>
                        <td style={{ padding: "4px 6px", color: C.muted }}>{h.by_email}</td>
                        <td style={{ padding: "4px 6px", color: C.inkSoft }}>{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}
        <Row>
          <Field label="Default hours per period"><input style={input} type="number" step="0.5" value={f.default_hours} onChange={(e) => set("default_hours", e.target.value)} /></Field>
          <Field label="FTE %"><input style={input} type="number" step="1" value={f.fte_pct} onChange={(e) => set("fte_pct", e.target.value)} /></Field>
          <Field label="Dependants"><input style={input} type="number" min="0" value={f.dependents} onChange={(e) => set("dependents", e.target.value)} /></Field>
        </Row>
      </FieldGroup>
      <FieldGroup label="Organisation">
        <Field label="Division">
          <select style={input} value={f.division_id}
            onChange={(e) => set("division_id", e.target.value)}>
            <option value="">— no division —</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.supervisor_name ? ` · supervisor ${d.supervisor_name}` : ""}
                {d.supervisor_submits_hours ? " · supervisor enters hours" : ""}
              </option>
            ))}
          </select>
          {(() => {
            const d = divisions.find((x) => x.id === f.division_id);
            if (!d) return null;
            return (
              <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>
                Default hours per period: <strong>{d.default_hours ?? 80}</strong>
                {d.supervisor_submits_hours
                  ? <> · hours entered by <strong>{d.supervisor_name || d.supervisor_email || "the supervisor"}</strong> each pay period</>
                  : <> · hours entered by the company's site-payroll user</>}
              </p>
            );
          })()}
          <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>
            Manage divisions on this company's <strong>Divisions</strong> tab.
          </p>
        </Field>
      </FieldGroup>
      <FieldGroup label={`Banking (${f.bank_accounts.length} account${f.bank_accounts.length === 1 ? "" : "s"})`}>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
          Split this employee's net pay across multiple accounts by percentage. Total must equal 100%.
        </p>
        {f.bank_accounts.map((a, i) => (
          <div key={i} style={{
            border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 10,
            background: i === 0 ? "#fff" : "#fafbfc",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06 }}>
                Account {i + 1}
              </strong>
              {f.bank_accounts.length > 1 && (
                <button type="button" onClick={() => removeAccount(i)}
                  style={{ ...btnGhostSmall, color: "#991b1b", padding: "2px 8px" }}>
                  <Trash2 size={11} /> Remove
                </button>
              )}
            </div>
            <Row>
              <Field label="Bank code"><input style={input} value={a.bank_code || ""} onChange={(e) => setAccount(i, "bank_code", e.target.value)} placeholder="088" /></Field>
              <Field label="Branch"><input style={input} value={a.branch_code || ""} onChange={(e) => setAccount(i, "branch_code", e.target.value)} /></Field>
              <Field label="% of net pay">
                <input style={{ ...input, ...(pctOk ? {} : { borderColor: "#fca5a5" }) }} type="number" min="0" max="100" step="0.1"
                  value={a.percentage ?? 0} onChange={(e) => setAccount(i, "percentage", Number(e.target.value))} />
              </Field>
            </Row>
            <Row>
              <Field label="Account number"><input style={input} value={a.account_no || ""} onChange={(e) => setAccount(i, "account_no", e.target.value)} /></Field>
              <Field label="Account name"><input style={input} value={a.account_name || ""} onChange={(e) => setAccount(i, "account_name", e.target.value)} /></Field>
            </Row>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={addAccount} style={btnGhostLg}>
            <Plus size={14} style={{ marginRight: 6 }} /> Add another account
          </button>
          <div style={{ fontSize: 13, color: pctOk ? "#166534" : "#991b1b", fontWeight: 600 }}>
            Total: {pctTotal.toFixed(1)}% {pctOk ? "✓" : "(must equal 100%)"}
          </div>
        </div>
      </FieldGroup>
      <FieldGroup label="Tax & NASFund settings">
        <Row>
          <Field label="Residency status">
            <select style={input} value={f.residency_status} onChange={(e) => set("residency_status", e.target.value)}>
              <option value="resident">Resident</option><option value="non_resident">Non-resident</option>
            </select>
          </Field>
          <Field label="Declaration lodged?">
            <select style={input} value={f.declaration_lodged ? "yes" : "no"} onChange={(e) => set("declaration_lodged", e.target.value === "yes")}>
              <option value="yes">Yes (Table A)</option><option value="no">No (Table B)</option>
            </select>
          </Field>
        </Row>
      </FieldGroup>
      <FieldGroup label="Standing allowances (per period, taxable)">
        <Row>
          <Field label="Housing"><input style={input} type="number" step="0.01" value={f.housing_allowance} onChange={(e) => set("housing_allowance", e.target.value)} /></Field>
          <Field label="Meals"><input style={input} type="number" step="0.01" value={f.meals_allowance} onChange={(e) => set("meals_allowance", e.target.value)} /></Field>
          <Field label="School fees"><input style={input} type="number" step="0.01" value={f.school_fees_allowance} onChange={(e) => set("school_fees_allowance", e.target.value)} /></Field>
        </Row>
      </FieldGroup>
      <FieldGroup label="Standing deductions (per period)">
        <Row>
          <Field label="Salary sacrifice (pre-tax)"><input style={input} type="number" step="0.01" value={f.salary_sacrifice} onChange={(e) => set("salary_sacrifice", e.target.value)} /></Field>
          <Field label="NCSL voluntary (pre-tax)"><input style={input} type="number" step="0.01" value={f.ncsl_voluntary} onChange={(e) => set("ncsl_voluntary", e.target.value)} /></Field>
          <Field label="NAS extra %"><input style={input} type="number" step="0.1" value={f.nas_extra_pct} onChange={(e) => set("nas_extra_pct", e.target.value)} /></Field>
        </Row>
      </FieldGroup>
      {isEdit && (
        <Field label="Active employee?">
          <select style={input} value={f.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")}>
            <option value="1">Active — appears on new pay periods</option>
            <option value="0">Inactive — excluded from new pay periods</option>
          </select>
        </Field>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!f.first_name || !f.last_name || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : isEdit ? "Save changes" : "Save employee"}
        </button>
      </div>
      {showAdjustPay && (
        <AdjustPayDialog companyId={companyId} employee={employee}
          onClose={() => setShowAdjustPay(false)}
          onSaved={() => { setShowAdjustPay(false); onSaved(); }} />
      )}
    </Modal>
  );
}

/* ─────────── Tax rules panel ─────────── */

function TaxRulesPanel({ companyId, canEdit }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setError(""); setInfo("");
    try {
      const j = await api(`/api/teebeepay/companies/${companyId}/tax-rules`);
      setData(j);
      if (j.active?.data) setDraft(JSON.stringify(j.active.data, null, 2));
    } catch (e) { setError(e.message); }
  }, [companyId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function save() {
    setError(""); setInfo(""); setSubmitting(true);
    try {
      let parsed;
      try { parsed = JSON.parse(draft); }
      catch (e) { setError("Invalid JSON: " + e.message); setSubmitting(false); return; }
      await api(`/api/teebeepay/companies/${companyId}/tax-rules`, {
        method: "POST", body: JSON.stringify({ data: parsed }),
      });
      setInfo("Saved as new version. Future pay periods will use this; historical periods keep their original calculations.");
      refresh();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (!data) return <Loader2 className="tbp-spin" size={20} color={C.red} />;
  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>
            Active version: <span style={{ color: C.muted }}>{data.active?.effective_from || "—"}</span>
          </strong>
          <span style={{ fontSize: 12, color: C.muted }}>{data.versions.length} historical version(s)</span>
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          PNG IRC publishes Salary or Wages Tax tables once per budget. Edit when those change.
          Past pay periods keep the rules that were active when they ran.
        </p>
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}

      <textarea
        value={draft} onChange={(e) => setDraft(e.target.value)}
        readOnly={!canEdit}
        rows={28}
        style={{
          width: "100%", padding: 14, borderRadius: 10, border: "1px solid #d1d5db",
          background: "#fafbfc", fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 12, lineHeight: 1.5, color: C.ink, outline: "none",
        }}
      />
      {canEdit && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={save} disabled={submitting} style={btnPrimaryInline}>
            {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                        : "Save as new version"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────── New pay period (entry grid) ─────────── */

function NewPeriod({ me, companyId, cloneFromPeriodId, onBack, onSaved }) {
  const [employees, setEmployees] = useState(null);
  const [supervisedEmployees, setSupervisedEmployees] = useState([]);
  const [company, setCompany] = useState(null);
  const [period, setPeriod] = useState({
    period_start: "", period_end: "", pay_date: new Date().toISOString().slice(0, 10),
  });
  const [tutorOpen, setTutorOpen] = useState(false);
  const tutorKey = `teebeepay.tutor.new_period.${me?.uid || "anon"}`;
  useEffect(() => {
    if (employees == null || !company) return;
    try {
      if (!localStorage.getItem(tutorKey)) {
        setTutorOpen(true);
        localStorage.setItem(tutorKey, new Date().toISOString());
      }
    } catch { /* localStorage blocked */ }
  }, [employees, company, tutorKey]);
  const [grid, setGrid] = useState({}); // employee_id -> { hours, cash_advance, note }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [baseline, setBaseline] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await api(`/api/teebeepay/companies/${companyId}/employees`);
        const c = (await api("/api/teebeepay/companies")).companies.find((x) => x.id === companyId);
        // Active + exclude supervisor-managed employees (those are handled by
        // their supervisor's "My team's hours" view; the period POST pulls
        // their pending_hours in automatically).
        const all = j.employees.filter((e) => e.is_active);
        const active = all.filter((e) => !e.division_supervisor_submits_hours);
        const supervised = all.filter((e) => e.division_supervisor_submits_hours);
        setEmployees(active);
        setSupervisedEmployees(supervised);
        setCompany(c);
        // Load baseline for anomaly detection (best-effort; ignore errors)
        try { setBaseline(await api(`/api/teebeepay/companies/${companyId}/period-baseline`)); }
        catch {}

        if (cloneFromPeriodId) {
          // Clone mode: pre-fill grid + period dates from the source period.
          const src = await api(`/api/teebeepay/payroll-periods/${cloneFromPeriodId}`);
          const srcEnd = src.period.period_end;
          const nextStart = nextDay(srcEnd);
          const nextEnd   = addDays(nextStart, 13);
          const nextPay   = addDays(nextEnd, 0);
          setPeriod({ period_start: nextStart, period_end: nextEnd, pay_date: nextPay });

          // Build a {employee_id -> {hours, cash_advance, note}} from the
          // source period. Only carry across to currently-active employees.
          const activeIds = new Set(active.map((e) => e.id));
          const initial = {};
          let cloned = 0;
          for (const e of src.entries) {
            if (!activeIds.has(e.employee_id)) continue;
            initial[e.employee_id] = {
              hours: e.hours ?? 0,
              cash_advance: 0,          // advances reset — they're per-period
              note: "",                 // notes reset — usually period-specific
            };
            cloned++;
          }
          setGrid(initial);
          setInfo(`Cloned ${cloned} employee${cloned === 1 ? "" : "s"} from ${src.period.period_start} → ${src.period.period_end}. Hours pre-filled; cash advances and notes reset.`);
        } else {
          const today = new Date();
          const end = new Date(today); end.setDate(end.getDate() - 1);
          const start = new Date(end); start.setDate(start.getDate() - 13);
          const pay = new Date(today);
          setPeriod({
            period_start: start.toISOString().slice(0, 10),
            period_end:   end.toISOString().slice(0, 10),
            pay_date:     pay.toISOString().slice(0, 10),
          });
        }
      } catch (e) { setError(e.message); }
    })();
  }, [companyId, cloneFromPeriodId]);

  function nextDay(iso) {
    const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function set(eid, k, v) {
    setGrid((g) => ({ ...g, [eid]: { ...(g[eid] || { hours: 0, cash_advance: 0, note: "" }), [k]: v } }));
  }

  function defaultHours(e) {
    return e.default_hours || company?.default_hours || 80;
  }

  function dblToggleHours(e) {
    const cur = Number(grid[e.id]?.hours) || 0;
    const def = defaultHours(e);
    set(e.id, "hours", cur === def ? 0 : def);
  }

  async function submit() {
    setError(""); setSubmitting(true);
    try {
      const entries = (employees || []).map((e) => ({
        employee_id: e.id,
        hours: grid[e.id]?.hours || 0,
        cash_advance: grid[e.id]?.cash_advance || 0,
        note: grid[e.id]?.note || "",
      }));
      const j = await api(`/api/teebeepay/companies/${companyId}/payroll-periods`, {
        method: "POST", body: JSON.stringify({ ...period, entries }),
      });
      onSaved(j.id);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (!employees || !company) return <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Back to {company.name}</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 800 }}>
          {cloneFromPeriodId ? "Clone pay period" : "New pay period"} — {company.name}
        </h1>
        <button onClick={() => setTutorOpen(true)} style={{ ...btnGhostSmall, color: C.redDeep }} title="Show the quick tutorial">
          <GraduationCap size={14} style={{ marginRight: 6 }} /> Show tour
        </button>
      </div>
      {tutorOpen && (
        <Tutor eyebrow="Bookkeeper tour"
          steps={buildBookkeeperTutorSteps(me, company, employees, supervisedEmployees)}
          onClose={() => setTutorOpen(false)} />
      )}
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Double-click an <strong>hours</strong> cell to toggle between the default and zero. Notes appear on the employee's pay stub.
      </p>

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18, marginBottom: 18 }}>
        <Row>
          <Field label="Period start"><input style={input} type="date" value={period.period_start} onChange={(e) => setPeriod({ ...period, period_start: e.target.value })} /></Field>
          <Field label="Period end"><input style={input} type="date" value={period.period_end} onChange={(e) => setPeriod({ ...period, period_end: e.target.value })} /></Field>
          <Field label="Pay date"><input style={input} type="date" value={period.pay_date} onChange={(e) => setPeriod({ ...period, pay_date: e.target.value })} /></Field>
        </Row>
      </div>

      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <SupervisedNotice items={supervisedEmployees} />
      <AnomalyBanner employees={employees} grid={grid} company={company} baseline={baseline} />

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <table className="tbp-grid" style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Employee</th>
              <th style={{ ...th, width: 80, textAlign: "right" }}>Default</th>
              <th style={{ ...th, width: 110 }}>Hours</th>
              <th style={{ ...th, width: 110 }}>Cash advance</th>
              <th style={th}>Note (shown on stub)</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const g = grid[e.id] || {};
              const def = defaultHours(e);
              return (
                <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{e.last_name}, {e.first_name}</td>
                  <td style={{ ...td, textAlign: "right", color: C.muted }}>{def}</td>
                  <td style={td}>
                    <input type="number" step="0.25" min="0" value={g.hours ?? 0}
                      onDoubleClick={() => dblToggleHours(e)}
                      onChange={(ev) => set(e.id, "hours", ev.target.value)} />
                  </td>
                  <td style={td}>
                    <input type="number" step="0.01" value={g.cash_advance ?? 0}
                      onChange={(ev) => set(e.id, "cash_advance", ev.target.value)} />
                  </td>
                  <td style={td}><input type="text" value={g.note ?? ""}
                    onChange={(ev) => set(e.id, "note", ev.target.value)} placeholder="Optional" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onBack} style={btnGhostLg}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : <>Submit for approval <ArrowRight size={16} style={{ marginLeft: 6 }} /></>}
        </button>
      </div>
    </div>
  );
}

/* ─────────── Anomaly banner ─────────── */

function AnomalyBanner({ employees, grid, company, baseline }) {
  if (!baseline?.baseline || baseline.baseline.n_samples === 0) return null;

  // Estimate this run's headcount + gross from the grid (gross = hours × rate).
  let headcount = 0, estGross = 0;
  for (const e of (employees || [])) {
    const h = Number(grid[e.id]?.hours) || 0;
    if (h <= 0) continue;
    headcount++;
    if (e.pay_type === "salary") {
      // periods per year — fortnightly default; use company.pay_interval
      const ppy = company?.pay_interval === "weekly" ? 52 : company?.pay_interval === "monthly" ? 12 : 26;
      estGross += (Number(e.annual_salary) || 0) / ppy;
    } else {
      estGross += h * (Number(e.hourly_rate) || 0);
    }
  }

  const bGross = baseline.baseline.gross_median || 0;
  const bHead  = baseline.baseline.headcount_median || 0;
  const issues = [];
  if (bGross > 0) {
    const pct = (estGross - bGross) / bGross;
    if (Math.abs(pct) >= 0.25 && estGross > 0) {
      issues.push(`Estimated gross K${estGross.toFixed(0)} is ${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}% vs the median of the last ${baseline.baseline.n_samples} periods (K${bGross.toFixed(0)})`);
    }
  }
  if (bHead > 0 && headcount > 0) {
    const diff = headcount - bHead;
    if (Math.abs(diff) >= Math.max(2, bHead * 0.25)) {
      issues.push(`${headcount} active employees this run vs ${bHead} typical — ${diff > 0 ? "+" : ""}${diff}`);
    }
  }

  if (!issues.length) return null;
  return (
    <div style={{
      background: "#fffbe6", border: "1px solid #fde68a", color: "#9c6c00",
      borderRadius: 10, padding: "12px 14px", marginBottom: 14,
      display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong>Worth a second look.</strong> {issues.join(" · ")}.
        {" "}This is informational only — the run still saves. If everything's right, ignore.
      </div>
    </div>
  );
}

/* ─────────── Period detail + Approve ─────────── */

function PeriodDetail({ me, periodId, onBack, onClone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState(null);
  const [resending, setResending] = useState(null); // entry id while sending
  const [resendOk, setResendOk] = useState(null);   // entry id of last success

  const refresh = useCallback(async () => {
    setError("");
    try { setData(await api(`/api/teebeepay/payroll-periods/${periodId}`)); }
    catch (e) { setError(e.message); }
  }, [periodId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function approve() {
    if (!confirm("Approve this pay period and email pay stubs to employees?")) return;
    setApproving(true);
    try { setResult(await api(`/api/teebeepay/payroll-periods/${periodId}/approve`, { method: "POST" })); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setApproving(false); }
  }

  async function resend(entryId) {
    setResending(entryId); setError(""); setResendOk(null);
    try {
      await api(`/api/teebeepay/payroll-periods/${periodId}/entries/${entryId}/resend`, { method: "POST" });
      setResendOk(entryId);
      setTimeout(() => setResendOk(null), 3000);
    } catch (e) { setError(e.message); }
    finally { setResending(null); }
  }

  if (!data) return <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>;
  const { period, entries } = data;
  const totals = entries.reduce((a, e) => ({
    gross: a.gross + (e.gross || 0),
    tax: a.tax + (e.tax || 0),
    nasfund: a.nasfund + (e.nasfund || 0),
    other: a.other + (e.other_deductions || 0),
    net: a.net + (e.net || 0),
  }), { gross: 0, tax: 0, nasfund: 0, other: 0, net: 0 });

  function downloadHref(kind) {
    return `/api/teebeepay/payroll-periods/${periodId}/${kind}`;
  }
  async function authedDownload(href, filename) {
    const tok = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(href, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) { setError(`Download failed (${res.status})`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename || "download"; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Back to company</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Pay period {period.period_start} → {period.period_end}</h1>
        <StatusBadge status={period.status} historical={!!period.imported_from} />
      </div>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 12px" }}>
        Pay date {period.pay_date} · {entries.length} entries
      </p>

      {me?.clearance >= 2 && (
        <PeriodNotes periodId={periodId} initialNotes={period.period_notes || ""}
          author={period.period_notes_by || null} updatedAt={period.period_notes_at || null} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => authedDownload(downloadHref("archive"),
          `TeebeePay-${(period.pay_date || "").replace(/-/g, "")}.zip`)} style={btnPrimaryInline}>
          <Download size={14} /> Download archive (ZIP)
        </button>
        <button onClick={() => authedDownload(downloadHref("bsp"),
          `BSPPayroll-${(period.pay_date || "").replace(/-/g, "")}.csv`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> BSP batch CSV
        </button>
        <button onClick={() => authedDownload(downloadHref("nasfund"),
          `NASFund-${(period.period_end || "").replace(/-/g, "")}.xlsx`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> NASFund XLSX
        </button>
        <button onClick={() => authedDownload(downloadHref("iif"),
          `Payroll-${(period.pay_date || "").replace(/-/g, "")}_QB_IIF.iif`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> QuickBooks IIF
        </button>
        {onClone && (
          <button onClick={onClone} style={btnGhostLg}>
            <Plus size={14} style={{ marginRight: 6 }} /> Use as template for new period
          </button>
        )}
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {result && (
        <FlashBox type="info" icon={<CheckCircle2 size={16} />}>
          Approved. Total gross K{result.totalGross?.toLocaleString()}. Pay stubs emailed: {result.stubsSent}{result.stubsFailed ? `, failed: ${result.stubsFailed}` : ""}.
        </FlashBox>
      )}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
        <table style={tableStyle}>
          <thead><tr>
            <th style={th}>Employee</th>
            <th style={{ ...th, textAlign: "right" }}>Hours</th>
            <th style={{ ...th, textAlign: "right" }}>Gross</th>
            <th style={{ ...th, textAlign: "right" }}>Tax</th>
            <th style={{ ...th, textAlign: "right" }}>Nasfund</th>
            <th style={{ ...th, textAlign: "right" }}>Other</th>
            <th style={{ ...th, textAlign: "right" }}>Net</th>
            <th style={th}>Note</th>
            {period.status === "approved" && <th style={{ ...th, width: 100 }}></th>}
          </tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={td}>{e.employee_name}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.hours ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.gross != null ? e.gross.toFixed(2) : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.tax != null ? e.tax.toFixed(2) : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.nasfund != null ? e.nasfund.toFixed(2) : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.other_deductions != null ? e.other_deductions.toFixed(2) : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{e.net != null ? e.net.toFixed(2) : "—"}</td>
                <td style={{ ...td, color: C.muted, fontSize: 13 }}>{e.note || ""}</td>
                {period.status === "approved" && (
                  <td style={td}>
                    {e.employee_email ? (
                      <button onClick={() => resend(e.id)} disabled={resending === e.id} style={btnGhostSmall} title={`Re-send to ${e.employee_email}`}>
                        {resending === e.id ? <Loader2 className="tbp-spin" size={12} /> :
                          resendOk === e.id   ? <><CheckCircle2 size={12} color="#16a34a" /> Sent</> :
                                                <><Send size={12} /> Re-send</>}
                      </button>
                    ) : <span style={{ fontSize: 11, color: C.muted }}>no email</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#fafbfc", fontWeight: 700 }}>
              <td style={td}>Totals</td>
              <td></td>
              <td style={{ ...td, textAlign: "right" }}>{totals.gross.toFixed(2)}</td>
              <td style={{ ...td, textAlign: "right" }}>{totals.tax.toFixed(2)}</td>
              <td style={{ ...td, textAlign: "right" }}>{totals.nasfund.toFixed(2)}</td>
              <td style={{ ...td, textAlign: "right" }}>{totals.other.toFixed(2)}</td>
              <td style={{ ...td, textAlign: "right" }}>{totals.net.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {period.status === "pending_approval" && me?.clearance >= 2 && (
        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={approve} disabled={approving} style={btnPrimaryInline}>
            {approving ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Approving…</>
                       : <><Send size={16} style={{ marginRight: 6 }} /> Approve &amp; email pay stubs</>}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────── Reports panel ─────────── */

function ReportsPanel({ companyId }) {
  const [period, setPeriod] = useState("monthly");
  const [data, setData] = useState(null);
  const [leaveData, setLeaveData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setError(""); setData(null);
      try { setData(await api(`/api/teebeepay/companies/${companyId}/reports?period=${period}`)); }
      catch (e) { setError(e.message); }
    })();
  }, [companyId, period]);

  useEffect(() => {
    (async () => {
      try { setLeaveData(await api(`/api/teebeepay/companies/${companyId}/leave-balances`)); }
      catch { setLeaveData(null); }
    })();
  }, [companyId]);

  if (error) return <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>;
  if (!data) return <Loader2 className="tbp-spin" size={20} color={C.red} />;

  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  async function fileDownload(path, fallbackName) {
    try {
      const r = await fetch(path, { headers: { Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY) } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (r.headers.get("content-disposition") || "")
        .match(/filename="([^"]+)"/)?.[1] || fallbackName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  }
  const download = (format) => fileDownload(
    `/api/teebeepay/companies/${companyId}/reports?period=${period}&format=${format}`,
    `report.${format}`,
  );
  const downloadYearEnd = (format) => fileDownload(
    `/api/teebeepay/companies/${companyId}/year-end?year=${new Date().getUTCFullYear()}&format=${format}`,
    `year-end.${format}`,
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Bucket:</strong>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...input, maxWidth: 200 }}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.muted }}>
          Lifetime gross: <strong style={{ color: C.ink }}>K {fmt(data.totalGross)}</strong>
        </span>
        <button onClick={() => download("xlsx")} style={btnGhostLg}>
          <FileSpreadsheet size={14} style={{ marginRight: 6 }} /> Download XLSX
        </button>
        <button onClick={() => download("pdf")} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> Download PDF
        </button>
      </div>

      {/* Year-to-date tile row */}
      <div style={{
        background: "#fffaf0", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 18px",
      }}>
        <div style={{ fontSize: 11, color: C.goldDeep, fontWeight: 700, textTransform: "uppercase",
                       letterSpacing: 0.06, marginBottom: 8 }}>
          Year to date — {data.currentYear}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16 }}>
          <YtdStat label="Gross"   value={`K ${fmt(data.ytd?.gross)}`} />
          <YtdStat label="Tax"     value={`K ${fmt(data.ytd?.tax)}`} />
          <YtdStat label="Nasfund" value={`K ${fmt(data.ytd?.nasfund)}`} />
          <YtdStat label="Net"     value={`K ${fmt(data.ytd?.net)}`} highlight />
          <YtdStat label={period === "weekly" ? "Weeks" : "Months"} value={String(data.ytd?.periods || 0)} />
        </div>
      </div>

      <ReportTable title={`${period === "weekly" ? "Weekly" : "Monthly"} summary`}
        rows={data.summary} cols={[
          { k: "bucket", label: period === "weekly" ? "Week" : "Month" },
          { k: "n_emp", label: "Employees", num: true },
          { k: "gross", label: "Gross", num: true },
          { k: "tax", label: "Tax", num: true },
          { k: "nasfund", label: "Nasfund", num: true },
          { k: "other", label: "Other", num: true },
          { k: "net", label: "Net", num: true, bold: true },
        ]} empty="No payroll history yet." fmt={fmt} />

      <ReportTable title="By department (all-time)"
        rows={data.byDept} cols={[
          { k: "dept", label: "Department" },
          { k: "n", label: "# entries", num: true },
          { k: "gross", label: "Gross", num: true },
          { k: "net", label: "Net", num: true, bold: true },
        ]} empty="No departments yet." fmt={fmt} />

      <ReportTable title="Top 25 employees by gross"
        rows={data.byEmployee} cols={[
          { k: "name", label: "Employee" },
          { k: "n", label: "# periods", num: true },
          { k: "gross", label: "Gross", num: true },
          { k: "net", label: "Net", num: true, bold: true },
        ]} empty="No employee data yet." fmt={fmt} />

      {data.shares?.length > 0 && (
        <ReportTable title="Master-user payroll shares"
          rows={data.shares} cols={[
            { k: "name", label: "Employee" },
            { k: "pct", label: "%", num: true },
            { k: "lifetime", label: "Cumulative share", num: true, bold: true },
          ]} empty="No share payouts configured." fmt={fmt} />
      )}

      {leaveData && <LeaveBalancesTable data={leaveData} />}

      {/* Year-end employer summary pack */}
      <div style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 14 }}>Year-end employer summary ({new Date().getUTCFullYear()})</strong>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4, maxWidth: 640 }}>
              Per-employee annual totals — gross, allowances, SWT, Nasfund employee &amp; employer, other deductions, net.
              XLSX is the master sheet for your records. PDF is a one-page-per-employee payment summary.
              This is the working data behind <strong>IRC Form S</strong>; once the official template is finalised we'll
              slot the same numbers into the IRC layout.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => downloadYearEnd("xlsx")} style={btnGhostLg}>
              <FileSpreadsheet size={14} style={{ marginRight: 6 }} /> XLSX
            </button>
            <button onClick={() => downloadYearEnd("pdf")} style={btnGhostLg}>
              <Download size={14} style={{ marginRight: 6 }} /> PDF (1 page/employee)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaveBalancesTable({ data }) {
  const codes = data.leave_types || [];
  const rows = data.rows || [];
  if (!rows.length) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18 }}>
        <strong style={{ fontSize: 14 }}>Leave balances — {data.year}</strong>
        <p style={{ fontSize: 13, color: C.muted, margin: "8px 0 0" }}>
          No leave taken yet in {data.year}. Leave entries are captured when a supervisor in
          timesheet mode tags a day with a leave type (Annual, Sick, Bereavement, etc.). After the
          bookkeeper cuts that pay period, the day is recorded permanently here.
        </p>
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 14 }}>
        Leave balances — {data.year}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...tableStyle, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>Employee</th>
              {codes.map((lt) => (
                <th key={lt.code} style={{ ...th, textAlign: "right" }}>
                  {lt.name}
                  {lt.max_days_per_year != null && (
                    <span style={{ color: C.muted, fontWeight: 400, marginLeft: 4 }}>/{lt.max_days_per_year}</span>
                  )}
                </th>
              ))}
              <th style={{ ...th, textAlign: "right" }}>Paid total</th>
              <th style={{ ...th, textAlign: "right" }}>Unpaid total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={td}>
                  <strong>{r.name}</strong>
                  {!r.active && <span style={{ marginLeft: 6, fontSize: 11, color: C.muted }}>(inactive)</span>}
                </td>
                {codes.map((lt) => {
                  const used = r.usage?.[lt.code] || 0;
                  const cap = lt.max_days_per_year;
                  const over = cap != null && used > cap;
                  return (
                    <td key={lt.code} style={{ ...td, textAlign: "right",
                                                color: over ? "#b91c1c" : (used > 0 ? C.ink : C.muted),
                                                fontWeight: over ? 700 : 400,
                                                fontVariantNumeric: "tabular-nums" }}>
                      {used || "—"}
                    </td>
                  );
                })}
                <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {r.total_paid_days || "—"}
                </td>
                <td style={{ ...td, textAlign: "right", color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                  {r.total_unpaid_days || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 16px", borderTop: "1px solid #f1f5f9", fontSize: 11, color: C.muted }}>
        Days over the annual cap are shown in red. Caps are configured on <strong>Settings → Leave types</strong>.
      </div>
    </div>
  );
}

function YtdStat({ label, value, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.04 }}>{label}</div>
      <div style={{ fontSize: highlight ? 22 : 18, fontWeight: highlight ? 800 : 700,
                     color: highlight ? C.redDeep : C.ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

function ReportTable({ title, rows, cols, empty, fmt }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 14 }}>
        {title}
      </div>
      {!rows.length ? <Empty>{empty}</Empty> : (
        <table style={tableStyle}>
          <thead><tr>
            {cols.map((c) => (
              <th key={c.k} style={{ ...th, textAlign: c.num ? "right" : "left" }}>{c.label}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                {cols.map((c) => (
                  <td key={c.k} style={{
                    ...td, textAlign: c.num ? "right" : "left",
                    fontVariantNumeric: c.num ? "tabular-nums" : undefined,
                    fontWeight: c.bold ? 700 : undefined,
                  }}>
                    {c.num ? fmt(r[c.k]) : (r[c.k] != null ? r[c.k] : "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─────────── Company settings panel ─────────── */

function CompanySettingsPanel({ companyId, onSaved }) {
  const [co, setCo] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try { setCo((await api(`/api/teebeepay/companies/${companyId}`)).company); }
    catch (e) { setError(e.message); }
  }, [companyId]);
  useEffect(() => { refresh(); }, [refresh]);

  const set = (k, v) => setCo((x) => ({ ...x, [k]: v }));

  async function save() {
    setError(""); setInfo(""); setSubmitting(true);
    try {
      await api(`/api/teebeepay/companies/${companyId}`, { method: "PATCH",
        body: JSON.stringify(co) });
      setInfo("Saved.");
      if (onSaved) onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  async function uploadSignature(file, name, title) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = async () => {
        try {
          await api(`/api/teebeepay/companies/${companyId}/signature`, {
            method: "POST",
            body: JSON.stringify({ image: r.result, name, title }),
          });
          resolve();
        } catch (e) { reject(e); }
      };
      r.onerror = () => reject(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
  }
  async function removeSignature() {
    if (!confirm("Remove the AP signature image?")) return;
    try {
      await fetch(`/api/teebeepay/companies/${companyId}/signature`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY) },
      });
      refresh();
    } catch (e) { setError(e.message); }
  }

  if (!co) return <Loader2 className="tbp-spin" size={20} color={C.red} />;

  return (
    <div>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}

      <FieldGroup label="Identity">
        <Row>
          <Field label="Company name"><input style={input} value={co.name || ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Abbreviation"><input style={input} value={co.abbreviation || ""} onChange={(e) => set("abbreviation", e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="Pay interval">
            <select style={input} value={co.pay_interval || "fortnightly"} onChange={(e) => set("pay_interval", e.target.value)}>
              <option value="fortnightly">Fortnightly</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Default hours / period"><input style={input} type="number" step="0.5" value={co.default_hours || 80} onChange={(e) => set("default_hours", e.target.value)} /></Field>
          <Field label="Currency"><input style={input} value={co.currency || "PGK"} onChange={(e) => set("currency", e.target.value)} /></Field>
        </Row>
      </FieldGroup>

      <FieldGroup label="Bank">
        <Row>
          <Field label="Bank code"><input style={input} value={co.bank_code || "088"} onChange={(e) => set("bank_code", e.target.value)} /></Field>
          <Field label="Branch"><input style={input} value={co.branch_code || ""} onChange={(e) => set("branch_code", e.target.value)} /></Field>
        </Row>
        <Field label="Account number"><input style={input} value={co.bank_account_no || ""} onChange={(e) => set("bank_account_no", e.target.value)} /></Field>
        <Field label="Account name"><input style={input} value={co.bank_account_name || ""} onChange={(e) => set("bank_account_name", e.target.value)} /></Field>
        <Field label="BSP client number"><input style={input} value={co.bank_client_no || ""} onChange={(e) => set("bank_client_no", e.target.value)} /></Field>
      </FieldGroup>

      <FieldGroup label="Office & NASFund">
        <Row>
          <Field label="Office email"><input style={input} type="email" value={co.office_email || ""} onChange={(e) => set("office_email", e.target.value)} /></Field>
          <Field label="Manager email"><input style={input} type="email" value={co.manager_email || ""} onChange={(e) => set("manager_email", e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="NCSL employer number"><input style={input} value={co.ncsl_employer_no || ""} onChange={(e) => set("ncsl_employer_no", e.target.value)} /></Field>
          <Field label="NCSL date of registration"><input style={input} type="date" value={co.ncsl_date_of_reg || ""} onChange={(e) => set("ncsl_date_of_reg", e.target.value)} /></Field>
        </Row>
      </FieldGroup>

      <FieldGroup label="Supervisor hours deadline">
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
          When you set a day-of-week and time, TeebeePay emails every division supervisor that hasn't yet submitted
          their team's hours — a reminder lands in their inbox on the morning of that day. Managers see a status panel
          on the Pay periods tab showing who's in and who isn't.
        </p>
        <Row>
          <Field label="Day of week (hours due by)">
            <select style={input} value={co.hours_due_day === 0 || co.hours_due_day ? String(co.hours_due_day) : ""}
              onChange={(e) => set("hours_due_day", e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">— no scheduled deadline —</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
              <option value="0">Sunday</option>
            </select>
          </Field>
          <Field label="Time (PG)">
            <input style={input} type="time" value={co.hours_due_time || ""}
              onChange={(e) => set("hours_due_time", e.target.value)} />
          </Field>
        </Row>
      </FieldGroup>

      <LeaveTypesEditor co={co} onChange={(arr) => set("leave_types", arr)} />

      <LateAttendanceConfig co={co} setField={set} />

      <BillingConfig co={co} setField={set} />

      <Field label="Default pay-slip message">
        <textarea style={{ ...input, minHeight: 70 }} value={co.payslip_message || ""}
          onChange={(e) => set("payslip_message", e.target.value)} />
      </Field>

      <FieldGroup label="Authorised Person (AP) signature — embedded in NASFund returns">
        <SignaturePanel company={co} onUpload={uploadSignature} onRemove={removeSignature} onAfter={refresh} />
      </FieldGroup>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={save} disabled={submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function SignaturePanel({ company, onUpload, onRemove, onAfter }) {
  const [name, setName] = useState(company.ap_signature_name || "");
  const [title, setTitle] = useState(company.ap_signature_title || "");
  const [users, setUsers] = useState(null);
  const [pick, setPick] = useState(""); // user id, "" = none, "__other__" = free text
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = React.useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await api("/api/teebeepay/users");
        const eligible = (j.users || [])
          .filter((u) => u.clearance >= 2 && u.is_active !== false)
          .sort((a, b) => (b.clearance - a.clearance) || a.email.localeCompare(b.email));
        setUsers(eligible);
        // If the stored AP name matches a known user, pre-select them.
        const cur = (company.ap_signature_name || "").trim().toLowerCase();
        if (cur) {
          const match = eligible.find((u) => {
            const full = `${u.first_name || ""} ${u.last_name || ""}`.trim().toLowerCase();
            return full === cur || u.email.toLowerCase() === cur;
          });
          if (match) setPick(match.id);
          else if (cur) setPick("__other__");
        }
      } catch { setUsers([]); }
    })();
  }, [company.ap_signature_name]);

  function userLabel(u) {
    const full = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    const titlePart = u.title ? ` · ${u.title}` : "";
    return full ? `${full}${titlePart} (${u.email})` : `${u.email}${titlePart}`;
  }

  function onPickUser(uid) {
    setPick(uid);
    if (!uid) { setName(""); setTitle(""); return; }
    if (uid === "__other__") return; // leave name/title as-is; user edits below
    const u = (users || []).find((x) => x.id === uid);
    if (!u) return;
    const full = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
    setName(full);
    if (u.title) setTitle(u.title);
  }

  async function pickAndUpload() {
    if (!fileRef.current?.files?.[0]) {
      setError("Pick an image file first."); return;
    }
    setError(""); setSubmitting(true);
    try {
      await onUpload(fileRef.current.files[0], name, title);
      if (onAfter) onAfter();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  const showFreeText = pick === "__other__" || pick === "";

  return (
    <div>
      <Field label="AP name">
        {users == null ? (
          <input style={{ ...input, color: C.muted }} value="Loading users…" readOnly />
        ) : (
          <select style={input} value={pick} onChange={(e) => onPickUser(e.target.value)}>
            <option value="">— choose a user —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            <option value="__other__">Other (type a name)…</option>
          </select>
        )}
        {showFreeText && (
          <input style={{ ...input, marginTop: 8 }} value={name}
            onChange={(e) => setName(e.target.value)} placeholder="e.g. Theresia Bob" />
        )}
      </Field>
      <Field label="AP title">
        <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Principal" />
        <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>
          Pre-filled from the user's profile when you pick one above — edit freely if needed.
        </p>
      </Field>
      {company.ap_signature_image && (
        <div style={{ marginBottom: 14, padding: 14, background: "#fafbfc", borderRadius: 8, border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Current signature on file:</div>
          <img alt="AP signature"
            src={`data:${company.ap_signature_mime};base64,${company.ap_signature_image}`}
            style={{ maxHeight: 80, maxWidth: 280, display: "block", marginBottom: 10 }} />
          <button onClick={onRemove} style={{ ...btnGhostLg, color: "#991b1b", borderColor: "#fecaca" }}>
            <Trash2 size={13} style={{ marginRight: 6 }} /> Remove
          </button>
        </div>
      )}
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <Field label={company.ap_signature_image ? "Replace signature image (PNG or JPEG, max 500 KB)" : "Upload signature image (PNG or JPEG, max 500 KB)"}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg"
          style={{ ...input, padding: 8 }} />
      </Field>
      <button onClick={pickAndUpload} disabled={submitting} style={btnGhostLg}>
        {submitting ? <><Loader2 className="tbp-spin" size={14} style={{ marginRight: 6 }} /> Uploading…</>
                    : <><Upload size={14} style={{ marginRight: 6 }} /> Upload signature</>}
      </button>
    </div>
  );
}

/* ─────────── Leave types editor (Principal-level) ─────────── */

const DEFAULT_LEAVE_TYPES = [
  { code: "ANNUAL",       name: "Annual leave",         paid: true,  max_days_per_year: 14 },
  { code: "SICK",         name: "Sick leave",           paid: true,  max_days_per_year: 6 },
  { code: "BEREAVEMENT",  name: "Bereavement leave",    paid: true,  max_days_per_year: 3 },
  { code: "COMPASSIONATE", name: "Compassionate leave", paid: true,  max_days_per_year: 3 },
  { code: "MATERNITY",    name: "Maternity leave",      paid: false, max_days_per_year: null },
  { code: "UNPAID",       name: "Unpaid leave",         paid: false, max_days_per_year: null },
  { code: "ABSENT_UNAUTH", name: "Absent (unauthorised)", paid: false, max_days_per_year: null },
];

function LeaveTypesEditor({ co, onChange }) {
  const rows = Array.isArray(co.leave_types) && co.leave_types.length ? co.leave_types : DEFAULT_LEAVE_TYPES;
  function setRow(i, key, v) {
    const next = rows.map((r, idx) => idx === i ? { ...r, [key]: v } : r);
    onChange(next);
  }
  function add() {
    onChange([...rows, { code: "", name: "", paid: false, max_days_per_year: null }]);
  }
  function remove(i) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function reset() {
    onChange(DEFAULT_LEAVE_TYPES);
  }
  return (
    <FieldGroup label="Leave types (paid / unpaid categories shown on the timesheet)">
      <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
        Supervisors pick one of these per day on the timesheet when an employee isn't at work normally — bereavement, sick,
        unpaid, etc. <strong>Paid</strong> types contribute the day's standard hours; <strong>unpaid</strong> contribute 0.
        Defaults reflect the PNG Employment Act minimums.
      </p>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.06 }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Code</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
            <th style={{ textAlign: "center", padding: "6px 8px" }}>Paid</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Max days / yr</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
              <td style={{ padding: "4px 8px" }}>
                <input style={{ ...input, padding: "5px 8px", fontSize: 12, fontFamily: "ui-monospace, monospace" }}
                  value={r.code || ""} onChange={(e) => setRow(i, "code", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} />
              </td>
              <td style={{ padding: "4px 8px" }}>
                <input style={{ ...input, padding: "5px 8px", fontSize: 13 }}
                  value={r.name || ""} onChange={(e) => setRow(i, "name", e.target.value)} />
              </td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}>
                <input type="checkbox" checked={!!r.paid} onChange={(e) => setRow(i, "paid", e.target.checked)} />
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>
                <input style={{ ...input, padding: "5px 8px", fontSize: 13, textAlign: "right", width: 80 }} type="number" min="0"
                  value={r.max_days_per_year ?? ""}
                  onChange={(e) => setRow(i, "max_days_per_year", e.target.value === "" ? null : Number(e.target.value))} />
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>
                <button onClick={() => remove(i)} style={{ ...btnGhostSmall, color: "#991b1b", padding: "3px 6px" }}>
                  <Trash2 size={11} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={add} type="button" style={btnGhostLg}>
          <Plus size={14} style={{ marginRight: 6 }} /> Add leave type
        </button>
        <button onClick={reset} type="button" style={btnGhostLg}>
          Restore PNG defaults
        </button>
      </div>
    </FieldGroup>
  );
}

/* ─────────── Late-attendance config (Principal-only) ─────────── */

function LateAttendanceConfig({ co, setField }) {
  const recips = Array.isArray(co.late_alert_recipients) ? co.late_alert_recipients : ["supervisor"];
  function toggleRecip(kind) {
    const next = recips.includes(kind) ? recips.filter((r) => r !== kind) : [...recips, kind];
    setField("late_alert_recipients", next);
  }
  return (
    <FieldGroup label="Late-attendance alerts (Principal-set)">
      <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
        When an employee accumulates this many <strong>Late</strong> or <strong>Absent (unauthorised)</strong> incidents in a
        rolling window, TeebeePay emails the recipients you tick below. Leave the threshold blank to disable. Repeats are
        suppressed within a window so you don't get spammed.
      </p>
      <Row>
        <Field label="Threshold (incidents)">
          <input style={input} type="number" min="0" placeholder="e.g. 3"
            value={co.late_threshold_count ?? ""}
            onChange={(e) => setField("late_threshold_count", e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
        <Field label="Window (days)">
          <input style={input} type="number" min="1"
            value={co.late_window_days ?? 30}
            onChange={(e) => setField("late_window_days", e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      </Row>
      <Field label="Notify">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
          {[
            { k: "principal",  label: "Principal & system owner" },
            { k: "supervisor", label: "Division supervisor" },
            { k: "bookkeeper", label: "Bookkeeper" },
          ].map((r) => (
            <label key={r.k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={recips.includes(r.k)} onChange={() => toggleRecip(r.k)} />
              {r.label}
            </label>
          ))}
        </div>
      </Field>
      <p style={{ fontSize: 11, color: C.muted, margin: "8px 0 0" }}>
        Incidents are recorded when a supervisor saves a day with leave type <strong>Late</strong> or
        <strong> Absent (unauthorised)</strong>. Other leave types (sick, bereavement, etc.) do not count toward this threshold.
      </p>
    </FieldGroup>
  );
}

/* ─────────── Billing config (service tier + per-employee rate) ─────────── */

function BillingConfig({ co, setField }) {
  const [defaults, setDefaults] = useState(null);
  useEffect(() => {
    (async () => {
      try { setDefaults((await api("/api/teebeepay/pricing-defaults")).pricing); }
      catch { setDefaults({ basic_rate_per_employee: 9, full_rate_per_employee: 14 }); }
    })();
  }, []);
  const tier = co.service_level === "full" ? "full" : "basic";
  const inherited = defaults
    ? (tier === "full" ? defaults.full_rate_per_employee : defaults.basic_rate_per_employee)
    : (tier === "full" ? 14 : 9);
  const override = Number(co.flat_rate_per_employee || 0);
  const effective = override > 0 ? override : inherited;
  const empCount = co.active_employees ?? co.employees ?? null;
  const projected = empCount != null ? effective * empCount : null;
  return (
    <FieldGroup label="Billing — service tier & rate">
      <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
        TeebeePay offers two tiers. <strong>Self-service</strong> gives the client all outputs to file themselves;
        <strong> Managed bureau</strong> adds Theresia's personal review and filing of BSP, NASFund, IRC SWT,
        and Form S. The per-employee rate comes from the bureau-wide pricing defaults (set on the Service fees page)
        unless you override it below.
      </p>
      <Row>
        <Field label="Service tier">
          <select style={input} value={co.service_level || "basic"}
            onChange={(e) => setField("service_level", e.target.value)}>
            <option value="basic">Basic — self-service payroll</option>
            <option value="full">Full — managed bureau</option>
          </select>
        </Field>
        <Field label={`Per-employee rate override (${co.currency || "PGK"} / period)`}>
          <input style={input} type="number" step="0.01" min="0"
            value={co.flat_rate_per_employee ?? ""}
            placeholder={`(blank = inherit ${inherited})`}
            onChange={(e) => setField("flat_rate_per_employee", e.target.value === "" ? 0 : Number(e.target.value))} />
          <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>
            {override > 0
              ? <>Overriding the bureau default for this company.</>
              : <>Inheriting bureau default: <strong>{co.currency || "PGK"} {Number(inherited).toFixed(2)}</strong> per employee per period.</>}
          </p>
        </Field>
      </Row>
      {projected != null && projected > 0 && (
        <div style={{
          background: "#fffaf0", border: "1px solid #fde68a", borderRadius: 8,
          padding: "10px 14px", marginTop: 10, fontSize: 13, color: C.ink,
        }}>
          <strong>Projected fee per pay period:</strong>{" "}
          {co.currency || "PGK"} {Number(projected).toFixed(2)}
          <span style={{ marginLeft: 8, color: C.muted }}>
            ({empCount} active employees × {co.currency || "PGK"} {Number(effective).toFixed(2)})
          </span>
        </div>
      )}
    </FieldGroup>
  );
}

/* ─────────── Adjust pay dialog (Principal-only) ─────────── */

function AdjustPayDialog({ companyId, employee, onClose, onSaved }) {
  const isHourly = employee.pay_type === "hourly";
  const curVal = Number(isHourly ? employee.hourly_rate : employee.annual_salary) || 0;
  const fieldLabel = isHourly ? "hourly rate" : "annual salary";
  const [f, setF] = useState({
    kind: "percent",
    direction: "increase",
    value: "",
    reason: "",
    effective_date: new Date().toISOString().slice(0, 10),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const v = Number(f.value) || 0;
  const delta = f.kind === "percent" ? curVal * (v / 100) : v;
  const signed = f.direction === "increase" ? delta : -delta;
  const projected = Math.max(0, Math.round((curVal + signed) * 100) / 100);

  async function save() {
    setError("");
    if (!f.reason.trim()) { setError("Reason is required for the audit log."); return; }
    if (v <= 0) { setError("Enter a positive amount."); return; }
    setSubmitting(true);
    try {
      await api(`/api/teebeepay/companies/${companyId}/employees/${employee.id}/adjust-pay`, {
        method: "POST",
        body: JSON.stringify({
          kind: f.kind, direction: f.direction, value: v,
          reason: f.reason.trim(), effective_date: f.effective_date,
        }),
      });
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal title={`Adjust pay — ${employee.first_name} ${employee.last_name}`} onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
        Current {fieldLabel}: <strong style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>
        PGK {curVal.toFixed(2)}</strong>. This change is journaled to the audit log and to the employee's pay history.
      </p>
      <Row>
        <Field label="Direction">
          <select style={input} value={f.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="increase">Increase</option>
            <option value="decrease">Decrease</option>
          </select>
        </Field>
        <Field label="Kind">
          <select style={input} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="percent">By percentage</option>
            <option value="fixed">By fixed amount (PGK)</option>
          </select>
        </Field>
        <Field label={f.kind === "percent" ? "% value" : "PGK value"}>
          <input style={input} type="number" step="0.01" min="0" value={f.value}
            onChange={(e) => set("value", e.target.value)}
            placeholder={f.kind === "percent" ? "e.g. 5" : "e.g. 50.00"} autoFocus />
        </Field>
      </Row>
      <Field label="Effective date">
        <input style={input} type="date" value={f.effective_date}
          onChange={(e) => set("effective_date", e.target.value)} />
      </Field>
      <Field label="Reason (recorded in audit log)">
        <textarea style={{ ...input, minHeight: 60 }} value={f.reason}
          onChange={(e) => set("reason", e.target.value)}
          placeholder="e.g. Annual review increase, promotion to Senior Driver, CPI adjustment FY26…" />
      </Field>
      <div style={{
        background: signed >= 0 ? "#dcfce7" : "#fee2e2",
        border: `1px solid ${signed >= 0 ? "#bbf7d0" : "#fecaca"}`,
        borderRadius: 8, padding: "10px 14px", marginTop: 12, fontSize: 13,
        color: signed >= 0 ? "#14532d" : "#7f1d1d", fontVariantNumeric: "tabular-nums",
      }}>
        <strong>Projected new {fieldLabel}:</strong> PGK {projected.toFixed(2)} <span style={{ opacity: 0.7 }}>
        ({signed >= 0 ? "+" : ""}{(signed).toFixed(2)} from PGK {curVal.toFixed(2)})</span>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={submitting || !v || !f.reason.trim()} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Applying…</>
                      : "Apply adjustment"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Pricing defaults editor (Principal+) ─────────── */

function PricingDefaultsEditor() {
  const [p, setP] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    (async () => {
      try { setP((await api("/api/teebeepay/pricing-defaults")).pricing); }
      catch (e) { setError(e.message); }
    })();
  }, []);
  if (!p) return null;
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  async function save() {
    setSubmitting(true); setError(""); setInfo("");
    try {
      await api("/api/teebeepay/pricing-defaults", { method: "PATCH", body: JSON.stringify(p) });
      setInfo("Saved. New companies inherit these unless they have a per-company override.");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: 18, marginBottom: 22,
    }}>
      <strong style={{ fontSize: 14 }}>Bureau-wide pricing defaults</strong>
      <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 14px" }}>
        These rates are inherited by every company unless overridden on that company's Settings → Billing.
        Setup fees are charged once when a new client onboards.
      </p>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}
      <Row>
        <Field label="Self-service rate (per employee, per period)">
          <input style={input} type="number" step="0.01" min="0" value={p.basic_rate_per_employee ?? 9}
            onChange={(e) => set("basic_rate_per_employee", Number(e.target.value))} />
        </Field>
        <Field label="Managed-bureau rate (per employee, per period)">
          <input style={input} type="number" step="0.01" min="0" value={p.full_rate_per_employee ?? 14}
            onChange={(e) => set("full_rate_per_employee", Number(e.target.value))} />
        </Field>
      </Row>
      <Row>
        <Field label="Setup fee — small (≤20 employees)">
          <input style={input} type="number" step="0.01" min="0" value={p.setup_fee_small ?? 500}
            onChange={(e) => set("setup_fee_small", Number(e.target.value))} />
        </Field>
        <Field label="Setup fee — medium (21–50)">
          <input style={input} type="number" step="0.01" min="0" value={p.setup_fee_medium ?? 1000}
            onChange={(e) => set("setup_fee_medium", Number(e.target.value))} />
        </Field>
        <Field label="Setup fee — large (>50)">
          <input style={input} type="number" step="0.01" min="0" value={p.setup_fee_large ?? 2000}
            onChange={(e) => set("setup_fee_large", Number(e.target.value))} />
        </Field>
      </Row>
      <Field label="Post-approval summary email">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
          <input type="checkbox" checked={p.post_approval_email_enabled !== false}
            onChange={(e) => set("post_approval_email_enabled", e.target.checked)} />
          <span>
            <strong>Send an email to every Principal when a pay period is approved.</strong>
            <br />
            <span style={{ fontSize: 12, color: C.muted }}>
              Includes totals, the bank-funding amount to transfer, the upload instructions below, and a PDF
              attachment listing every employee with their hours, rate, gross, tax, deductions, and net.
              Recipients: users with role = principal (active). System owners are excluded by design.
            </span>
          </span>
        </label>
      </Field>
      <Field label="Bank upload instructions (appended to every Principal approval email)">
        <textarea style={{ ...input, minHeight: 110, fontSize: 13, lineHeight: 1.5 }}
          placeholder={"e.g. 1. Log in to BSP Internet Business Banking → File Upload\n2. Select the CSV from the period page\n3. Confirm totals match the breakdown above\n4. Approve in BSP …"}
          value={p.bank_upload_instructions ?? ""}
          onChange={(e) => set("bank_upload_instructions", e.target.value)} />
        <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>
          Plain text. Line breaks preserved. Shown verbatim in the post-approval email Principals receive.
        </p>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={save} disabled={submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</> : "Save pricing defaults"}
        </button>
      </div>
    </div>
  );
}

/* ─────────── Service fees page (owner only) ─────────── */

function ServiceFeesPage({ me, onBack }) {
  const [fees, setFees] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try { setFees((await api("/api/teebeepay/service-fees")).fees); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function toggle(f) {
    try {
      await api(`/api/teebeepay/service-fees/${f.id}`, { method: "PATCH",
        body: JSON.stringify({ is_active: !f.is_active }) });
      refresh();
    } catch (e) { setError(e.message); }
  }
  async function remove(f) {
    if (!confirm(`Remove ${f.name} from service-fee disbursements?`)) return;
    try {
      await fetch(`/api/teebeepay/service-fees/${f.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY) },
      });
      refresh();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Service fees</h1>
        <button onClick={() => setShowAdd(true)} style={btnPrimaryInline}>
          <Plus size={16} /> Add fee recipient
        </button>
      </div>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
        <strong>Weight</strong> drives how each pay run's fees are split between recipients. Two models:
        <span style={{ display: "block", marginTop: 6 }}>
          <strong>Flat-rate (preferred)</strong> — set <em>flat rate per employee</em> on each company's Settings tab.
          Total fee = active employees × rate. Recipients split that pot by their weights (e.g. Theresia 3, Richard 2 → 60% / 40%).
        </span>
        <span style={{ display: "block", marginTop: 4 }}>
          <strong>Legacy % of gross</strong> — if a company's flat rate is unset, the weight is treated as a percentage of
          that period's gross payroll (Theresia 3% of gross, Richard 2% of gross). Same numbers; different base.
        </span>
      </p>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      <PricingDefaultsEditor />

      {fees == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> :
       !fees.length ? <Empty>No service fee recipients yet.</Empty> :
       (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Name</th>
              <th style={{ ...th, textAlign: "right" }}>Weight</th>
              <th style={th}>Bank account</th>
              <th style={th}>Branch</th>
              <th style={th}>Active</th>
              <th style={{ ...th, width: 130 }}></th>
            </tr></thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}><strong>{f.name}</strong></td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.weight}</td>
                  <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                    {f.account_name || "—"}{f.account_no ? ` · ${f.account_no}` : ""}
                  </td>
                  <td style={{ ...td, color: C.muted }}>{f.branch_code || "—"}</td>
                  <td style={td}><CheckCircle2 size={16} color={f.is_active ? "#16a34a" : "#94a3b8"} /></td>
                  <td style={td}>
                    <button onClick={() => toggle(f)} style={{ ...btnGhostSmall, marginRight: 6 }}>
                      {f.is_active ? "Pause" : "Resume"}
                    </button>
                    <button onClick={() => remove(f)} style={{ ...btnGhostSmall, color: "#991b1b" }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )
      }

      {showAdd && (
        <ServiceFeeDialog onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }} />
      )}
    </div>
  );
}

function ServiceFeeDialog({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", weight: "", bank_code: "088",
    branch_code: "", account_no: "", account_name: "", notes: "" });
  const [users, setUsers] = useState(null);
  const [pick, setPick] = useState(""); // selected user id, "" for none, "__other__" for free text
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Pull users that could plausibly be recipients (principal/system_owner/bookkeeper).
  useEffect(() => {
    (async () => {
      try {
        const j = await api("/api/teebeepay/users");
        const eligible = (j.users || [])
          .filter((u) => u.clearance >= 2 && u.is_active !== false)
          .sort((a, b) => (b.clearance - a.clearance) || a.email.localeCompare(b.email));
        setUsers(eligible);
      } catch { setUsers([]); }
    })();
  }, []);

  function userLabel(u) {
    const full = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    return full ? `${full} (${u.email})` : u.email;
  }

  function onPickUser(uid) {
    setPick(uid);
    if (!uid || uid === "__other__") {
      // clear name when going back to "Choose…" / "Other"
      if (!uid) set("name", "");
      return;
    }
    const u = (users || []).find((x) => x.id === uid);
    if (!u) return;
    const full = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
    setF((x) => ({
      ...x,
      name: full,
      // Pre-fill account_name only if it hasn't been edited yet
      account_name: x.account_name || full,
    }));
  }

  async function save() {
    setError(""); setSubmitting(true);
    try { await api("/api/teebeepay/service-fees", { method: "POST", body: JSON.stringify(f) }); onSaved(); }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  return (
    <Modal title="Add service-fee recipient" onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <Row>
        <Field label="Recipient *">
          {users == null ? (
            <input style={{ ...input, color: C.muted }} value="Loading users…" readOnly />
          ) : (
            <select style={input} value={pick} onChange={(e) => onPickUser(e.target.value)} autoFocus>
              <option value="">— choose a user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{userLabel(u)}</option>
              ))}
              <option value="__other__">Other (type a name)…</option>
            </select>
          )}
          {pick === "__other__" && (
            <input style={{ ...input, marginTop: 8 }} value={f.name}
              onChange={(e) => set("name", e.target.value)} placeholder="Recipient name" />
          )}
        </Field>
        <Field label="Weight *">
          <input style={input} type="number" step="0.1" value={f.weight}
            onChange={(e) => set("weight", e.target.value)} placeholder="e.g. 3" />
          <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>
            Used as a ratio with other recipients' weights (flat-rate model) or as % of gross (legacy model) — see top of page.
          </p>
        </Field>
      </Row>
      <Row>
        <Field label="Bank code"><input style={input} value={f.bank_code} onChange={(e) => set("bank_code", e.target.value)} /></Field>
        <Field label="Branch"><input style={input} value={f.branch_code} onChange={(e) => set("branch_code", e.target.value)} /></Field>
      </Row>
      <Field label="Account number *"><input style={input} value={f.account_no} onChange={(e) => set("account_no", e.target.value)} /></Field>
      <Field label="Account name"><input style={input} value={f.account_name} onChange={(e) => set("account_name", e.target.value)} /></Field>
      <Field label="Notes (internal)"><input style={input} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!f.name || !f.weight || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</> : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Users page ─────────── */

function UsersPage({ me, onBack }) {
  const [users, setUsers] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [uj, cj] = await Promise.all([
        api("/api/teebeepay/users"),
        api("/api/teebeepay/companies"),
      ]);
      setUsers(uj.users || []); setCompanies(cj.companies || []);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function toggleActive(u) {
    try {
      await api(`/api/teebeepay/users/${u.id}`, { method: "PATCH",
        body: JSON.stringify({ is_active: !u.is_active }) });
      refresh();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Users</h1>
        {me?.clearance >= 3 && (
          <button onClick={() => setShowInvite(true)} style={btnPrimaryInline}>
            <UserPlus size={16} /> Invite user
          </button>
        )}
      </div>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
        Each user signs in via email-PIN. Set their role to determine what they can see and do.
      </p>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {users == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Name &amp; email</th>
              <th style={th}>Role</th>
              <th style={th}>Company</th>
              <th style={th}>Last sign-in</th>
              <th style={th}>Active</th>
              <th style={{ ...th, width: 80 }}></th>
            </tr></thead>
            <tbody>
              {users.map((u) => {
                const fullName = (u.first_name || u.last_name)
                  ? `${u.first_name || ""} ${u.last_name || ""}`.trim()
                  : null;
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: C.ink }}>
                        {fullName || <span style={{ color: C.muted, fontStyle: "italic" }}>(no name set)</span>}
                        {u.email === me.email && <span style={{ marginLeft: 6, color: C.muted, fontSize: 12, fontWeight: 400 }}>(you)</span>}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted }}>{u.email}</div>
                    </td>
                    <td style={td}><RoleBadge role={u.role} /></td>
                    <td style={{ ...td, color: C.muted }}>{u.company_name || "—"}</td>
                    <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toISOString().slice(0, 10) : "never"}
                    </td>
                    <td style={td}><CheckCircle2 size={16} color={u.is_active ? "#16a34a" : "#94a3b8"} /></td>
                    <td style={td}>
                      {me.clearance >= 3 && (u.email === me.email || u.clearance < me.clearance) && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button onClick={() => setEditing(u)} style={btnGhostSmall}>Edit</button>
                          {u.email !== me.email && u.clearance < me.clearance && (
                            <button onClick={() => toggleActive(u)} style={btnGhostSmall}>
                              {u.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteUserDialog companies={companies} me={me}
          onClose={() => setShowInvite(false)}
          onSaved={() => { setShowInvite(false); refresh(); }} />
      )}
      {editing && (
        <EditUserDialog user={editing} companies={companies} me={me}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

function EditUserDialog({ user, companies, me, onClose, onSaved }) {
  const [f, setF] = useState({
    first_name: user.first_name || "",
    last_name:  user.last_name  || "",
    title:      user.title      || "",
    email:      user.email      || "",
    role:       user.role,
    company_id: user.company_id || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const isSelf = user.email === me.email;
  // Only system_owner can change roles freely. Anyone clearance>=3 can edit users
  // strictly below their own clearance; nobody can promote at-or-above their own level
  // (server enforces this too).
  const canChangeAccess = !isSelf && me.clearance >= 3 && user.clearance < me.clearance;

  async function save() {
    setError(""); setSubmitting(true);
    try {
      const body = {
        first_name: f.first_name.trim(),
        last_name:  f.last_name.trim(),
        title:      f.title.trim(),
        email:      f.email.trim().toLowerCase(),
      };
      if (canChangeAccess) {
        body.role = f.role;
        body.company_id = f.company_id || null;
      }
      await api(`/api/teebeepay/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  const canSubmit = f.first_name.trim() && f.last_name.trim() && f.email.trim();

  return (
    <Modal title="Edit user" onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
        {isSelf
          ? "Editing your own profile. Email changes apply to your next sign-in."
          : `Editing ${user.email}.`}
      </p>
      <Row>
        <Field label="First name *">
          <input style={input} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus />
        </Field>
        <Field label="Last name *">
          <input style={input} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
      </Row>
      <Field label="Email *">
        <input style={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Title (appears on NASFund signatures, pay-stub footers)">
        <input style={input} value={f.title} onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Principal, Bookkeeper" />
      </Field>
      <Field label="Role">
        <select
          style={{ ...input, opacity: canChangeAccess ? 1 : 0.6 }}
          value={f.role}
          disabled={!canChangeAccess}
          onChange={(e) => set("role", e.target.value)}
        >
          {me.clearance >= 4 && <option value="system_owner">system_owner (level 4)</option>}
          {me.clearance >= 4 && <option value="principal">principal — runs the bureau (level 3)</option>}
          <option value="bookkeeper">bookkeeper — back-office (level 2)</option>
          <option value="site_payroll">site_payroll — per-company key person (level 1)</option>
          <option value="employee">employee — view own stubs only (level 0)</option>
        </select>
      </Field>
      <Field label="Assign to a single company (leave blank for system-wide access)">
        <select
          style={{ ...input, opacity: canChangeAccess ? 1 : 0.6 }}
          value={f.company_id}
          disabled={!canChangeAccess}
          onChange={(e) => set("company_id", e.target.value)}
        >
          <option value="">— all companies (principal/bookkeeper) —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      {!canChangeAccess && (
        <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>
          {isSelf
            ? "You can't change your own role or company assignment."
            : "Role/company changes require higher clearance than this user."}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!canSubmit || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

function RoleBadge({ role }) {
  const levels = {
    system_owner: { color: "#581c87", bg: "#f3e8ff", label: "owner" },
    principal:    { color: "#9c2410", bg: "#fed7aa", label: "principal" },
    bookkeeper:   { color: "#9c6c00", bg: "#fef3c7", label: "bookkeeper" },
    site_payroll: { color: "#1e40af", bg: "#dbeafe", label: "site_payroll" },
    employee:     { color: "#475569", bg: "#f1f5f9", label: "employee" },
  };
  const it = levels[role] || { color: C.muted, bg: "#f1f5f9", label: role };
  return <Badge color={it.color} bg={it.bg}>{it.label}</Badge>;
}

function InviteUserDialog({ companies, me, onClose, onSaved }) {
  const [f, setF] = useState({
    first_name: "", last_name: "", title: "", email: "",
    role: me.clearance >= 4 ? "principal" : "bookkeeper",
    company_id: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setError(""); setSubmitting(true);
    try {
      await api("/api/teebeepay/users", { method: "POST", body: JSON.stringify(f) });
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  const canSubmit = f.first_name.trim() && f.last_name.trim() && f.email.trim();
  return (
    <Modal title="Invite user" onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
        They'll be able to sign in immediately at <code>/teebeepay/app</code> with their email. No password is set —
        we email them a 6-digit code each time.
      </p>
      <Row>
        <Field label="First name *">
          <input style={input} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus />
        </Field>
        <Field label="Last name *">
          <input style={input} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
      </Row>
      <Field label="Email *">
        <input style={input} type="email" value={f.email} onChange={(e) => set("email", e.target.value)}
          placeholder="name@company.com" />
      </Field>
      <Field label="Title (appears on NASFund signatures, pay-stub footers)">
        <input style={input} value={f.title} onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Principal, Bookkeeper, Site Manager" />
      </Field>
      <Field label="Role">
        <select style={input} value={f.role} onChange={(e) => set("role", e.target.value)}>
          {me.clearance >= 4 && <option value="principal">principal — runs the bureau (level 3)</option>}
          <option value="bookkeeper">bookkeeper — back-office (level 2)</option>
          <option value="site_payroll">site_payroll — per-company key person (level 1)</option>
          <option value="employee">employee — view own stubs only (level 0)</option>
        </select>
      </Field>
      <Field label="Assign to a single company (leave blank for system-wide access)">
        <select style={input} value={f.company_id} onChange={(e) => set("company_id", e.target.value)}>
          <option value="">— all companies (principal/bookkeeper) —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!canSubmit || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : "Invite"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── My-profile dialog (edit own first/last name) ─────────── */

function ProfileDialog({ me, required, onClose, onSaved }) {
  const [f, setF] = useState({
    first_name: me.first_name || "",
    last_name: me.last_name || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [tfa, setTfa] = useState(null); // null | { secret, qr, otpauth, code, ... } during setup
  const [tfaCode, setTfaCode] = useState("");
  const [tfaErr, setTfaErr] = useState("");
  const [disableCode, setDisableCode] = useState("");

  async function startTfa() {
    setTfaErr("");
    try {
      const j = await api("/api/teebeepay/auth/2fa/setup", { method: "POST" });
      setTfa(j); setTfaCode("");
    } catch (e) { setTfaErr(e.message); }
  }
  async function confirmTfa() {
    setTfaErr("");
    try {
      await api("/api/teebeepay/auth/2fa/verify-setup", { method: "POST", body: JSON.stringify({ code: tfaCode }) });
      setTfa(null); setTfaCode("");
      // refresh /me
      const j = await api("/api/teebeepay/me");
      onSaved({ totp_enabled: !!j.user.totp_enabled });
    } catch (e) { setTfaErr(e.message); }
  }
  async function disableTfa() {
    setTfaErr("");
    if (!disableCode) { setTfaErr("Enter a current authenticator code to confirm."); return; }
    try {
      await api("/api/teebeepay/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code: disableCode }) });
      setDisableCode("");
      const j = await api("/api/teebeepay/me");
      onSaved({ totp_enabled: !!j.user.totp_enabled });
    } catch (e) { setTfaErr(e.message); }
  }
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setError(""); setSubmitting(true);
    try {
      await api(`/api/teebeepay/users/${me.uid}`, {
        method: "PATCH", body: JSON.stringify(f),
      });
      onSaved({ first_name: f.first_name.trim(), last_name: f.last_name.trim() });
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  const canSubmit = f.first_name.trim() && f.last_name.trim();
  return (
    <Modal title={required ? "Welcome — set your name" : "Your profile"} onClose={required ? () => {} : onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {required && (
        <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
          Quick one-time step so TeebeePay can greet you properly and put your name on audit logs.
        </p>
      )}
      <Row>
        <Field label="First name *">
          <input style={input} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus />
        </Field>
        <Field label="Last name *">
          <input style={input} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
      </Row>
      <Field label="Email"><input style={{ ...input, background: "#fafbfc", color: C.muted }} value={me.email} readOnly /></Field>
      <Field label="Role"><input style={{ ...input, background: "#fafbfc", color: C.muted }} value={me.role} readOnly /></Field>

      {!required && (
        <FieldGroup label="Two-factor authentication (TOTP)">
          {me.totp_enabled ? (
            <>
              <p style={{ fontSize: 13, color: "#166534", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} /> Active. Sign-in requires your authenticator code.
              </p>
              <Row>
                <Field label="Authenticator code">
                  <input style={input} value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••" inputMode="numeric" maxLength={6} />
                </Field>
                <Field label=" ">
                  <button onClick={disableTfa} type="button" style={{ ...btnGhostLg, color: "#991b1b", borderColor: "#fecaca" }}>
                    Disable 2FA
                  </button>
                </Field>
              </Row>
              {tfaErr && <FlashBox type="error" icon={<AlertCircle size={16} />}>{tfaErr}</FlashBox>}
            </>
          ) : tfa ? (
            <>
              <p style={{ fontSize: 13, color: C.inkSoft, margin: "0 0 10px" }}>
                Scan this with Google Authenticator, Authy, 1Password, or any TOTP app — then enter the 6-digit code it shows.
              </p>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 12 }}>
                <img src={tfa.qr} alt="QR code" style={{ width: 160, height: 160, border: "1px solid #e5e7eb", borderRadius: 8 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06, marginBottom: 6 }}>
                    Or enter manually
                  </div>
                  <div style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13,
                    background: "#f3f4f6", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all" }}>
                    {tfa.secret}
                  </div>
                </div>
              </div>
              <Row>
                <Field label="Code from app *">
                  <input style={input} inputMode="numeric" maxLength={6} value={tfaCode}
                    onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••" />
                </Field>
                <Field label=" ">
                  <button onClick={confirmTfa} type="button" disabled={tfaCode.length !== 6} style={btnPrimaryInline}>
                    Enable 2FA
                  </button>
                </Field>
              </Row>
              <button onClick={() => setTfa(null)} type="button" style={{ ...btnGhostLg, marginTop: 4 }}>
                Cancel enrolment
              </button>
              {tfaErr && <FlashBox type="error" icon={<AlertCircle size={16} />}>{tfaErr}</FlashBox>}
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: C.muted, margin: "0 0 10px" }}>
                Adds a one-time code on every sign-in (alongside email-PIN). Strongly recommended for the system owner.
              </p>
              <button onClick={startTfa} type="button" style={btnPrimaryInline}>
                <ShieldCheck size={14} style={{ marginRight: 6 }} /> Set up 2FA
              </button>
              {tfaErr && <FlashBox type="error" icon={<AlertCircle size={16} />}>{tfaErr}</FlashBox>}
            </>
          )}
        </FieldGroup>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        {!required && <button onClick={onClose} style={btnGhostLg}>Cancel</button>}
        <button onClick={save} disabled={!canSubmit || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Employee profile ─────────── */

function EmployeeProfile({ me, employeeId, onBack, onOpenPeriod }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);
  useEffect(() => {
    (async () => {
      try { setData(await api(`/api/teebeepay/employees/${employeeId}`)); }
      catch (e) { setError(e.message); }
    })();
  }, [employeeId]);

  function toggleSel(entryId) {
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(entryId)) ns.delete(entryId); else ns.add(entryId);
      return ns;
    });
  }
  function selectAll(history) {
    setSelected(new Set(history.filter(h => !h.imported).map(h => h.entry_id)));
  }
  async function emailSelected() {
    if (!selected.size || !data?.employee.email) return;
    if (!confirm(`Email ${selected.size} pay stub(s) to ${data.employee.email}?`)) return;
    setSending(true); setError(""); setInfo("");
    let sent = 0, failed = 0;
    for (const entryId of selected) {
      const h = data.history.find(x => x.entry_id === entryId);
      if (!h) continue;
      try {
        await api(`/api/teebeepay/payroll-periods/${h.pay_period_id}/entries/${entryId}/resend`, { method: "POST" });
        sent++;
      } catch { failed++; }
    }
    setSending(false);
    setSelected(new Set());
    setInfo(`Sent ${sent} stub${sent === 1 ? "" : "s"}${failed ? `. ${failed} failed.` : "."}`);
  }

  if (error) return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Back</button>
      <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>
    </div>
  );
  if (!data) return <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>;
  const { employee, history, lifetime } = data;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Back to {employee.company_name}</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
            {employee.first_name} {employee.last_name}
            {!employee.is_active && (
              <span style={{ marginLeft: 12, fontSize: 13, color: C.muted, fontWeight: 500 }}>(inactive)</span>
            )}
          </h1>
          <p style={{ color: C.muted, fontSize: 14, margin: "6px 0 0" }}>
            {[employee.job_function, employee.department, employee.email].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 26 }}>
        <StatCard label="Pay periods" value={history.length} />
        <StatCard label="Lifetime gross"   value={`K${lifetime.gross.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <StatCard label="Lifetime tax"     value={`K${lifetime.tax.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <StatCard label="Lifetime Nasfund" value={`K${lifetime.nasfund.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <StatCard label="Lifetime net"     value={`K${lifetime.net.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} highlight />
      </div>

      {/* Details */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 26 }}>
        <InfoCard title="Personal">
          <InfoRow k="Date of birth"   v={employee.dob || "—"} />
          <InfoRow k="Start date"      v={employee.start_date || "—"} />
          {employee.end_date && <InfoRow k="End date" v={employee.end_date} />}
          <InfoRow k="Email"           v={employee.email || "—"} />
          <InfoRow k="Phone"           v={employee.phone || "—"} />
          <InfoRow k="Dependants"      v={employee.dependents ?? 0} />
        </InfoCard>
        <InfoCard title="Compensation & tax">
          <InfoRow k="Pay type"        v={employee.pay_type} />
          <InfoRow k={employee.pay_type === "salary" ? "Annual salary" : "Hourly rate"}
            v={employee.pay_type === "salary" ? `K${(employee.annual_salary || 0).toLocaleString()}` : `K${(employee.hourly_rate || 0).toFixed(2)}`} />
          <InfoRow k="Default hours"   v={employee.default_hours ?? "—"} />
          <InfoRow k="FTE %"           v={employee.fte_pct ?? 100} />
          <InfoRow k="Residency"       v={employee.residency_status || "resident"} />
          <InfoRow k="Declaration"     v={employee.declaration_lodged === false ? "Not lodged" : "Lodged"} />
        </InfoCard>
        <InfoCard title="Banking">
          <InfoRow k="Bank"            v={employee.bank_code || "088"} />
          <InfoRow k="Branch"          v={employee.branch_code || "—"} />
          <InfoRow k="Account #"       v={employee.bank_account_no || "—"} />
          <InfoRow k="Account name"    v={employee.bank_account_name || "—"} />
          {employee.bank_accounts && employee.bank_accounts.length > 1 && (
            <InfoRow k="Splits across" v={`${employee.bank_accounts.length} accounts`} />
          )}
        </InfoCard>
        <InfoCard title="Notes">
          <p style={{ margin: 0, fontSize: 13, color: C.inkSoft, whiteSpace: "pre-wrap" }}>
            {employee.notes || <span style={{ color: C.muted }}>No notes recorded.</span>}
          </p>
        </InfoCard>
      </div>

      {/* History */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Payroll history</h2>
        {employee.email && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {selected.size > 0 ? (
              <>
                <span style={{ fontSize: 13, color: C.muted }}>{selected.size} selected</span>
                <button onClick={() => setSelected(new Set())} style={btnGhostSmall}>Clear</button>
                <button onClick={emailSelected} disabled={sending} style={btnPrimaryInline}>
                  {sending ? <><Loader2 className="tbp-spin" size={14} style={{ marginRight: 6 }} /> Sending…</>
                           : <><Send size={14} /> Email {selected.size} stub{selected.size === 1 ? "" : "s"} to {employee.email}</>}
                </button>
              </>
            ) : (
              <button onClick={() => selectAll(history)} style={btnGhostSmall}
                disabled={!history.some(h => !h.imported)}>
                Select all approved
              </button>
            )}
          </div>
        )}
      </div>
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}
      {!history.length ? <Empty>No pay periods yet for this employee.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              {employee.email && <th style={{ ...th, width: 36 }}></th>}
              <th style={th}>Pay date</th><th style={th}>Period</th>
              <th style={{ ...th, textAlign: "right" }}>Hours</th>
              <th style={{ ...th, textAlign: "right" }}>Gross</th>
              <th style={{ ...th, textAlign: "right" }}>Tax</th>
              <th style={{ ...th, textAlign: "right" }}>Nasfund</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
              <th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.entry_id} style={{ borderTop: "1px solid #f1f5f9",
                  background: selected.has(h.entry_id) ? "#fff7e0" : undefined }}>
                  {employee.email && (
                    <td style={{ ...td, width: 36 }}>
                      <input type="checkbox" checked={selected.has(h.entry_id)}
                        onChange={() => toggleSel(h.entry_id)}
                        disabled={h.imported} title={h.imported ? "Historical entries don't have email-able stubs" : ""} />
                    </td>
                  )}
                  <td style={td}>
                    <button onClick={() => onOpenPeriod(h.pay_period_id)} style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      color: C.red, fontWeight: 600, textDecoration: "underline",
                    }}>{h.pay_date}</button>
                  </td>
                  <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                    {h.period_start} — {h.period_end}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.hours ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.gross != null ? h.gross.toFixed(2) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.tax != null ? h.tax.toFixed(2) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.nasfund != null ? h.nasfund.toFixed(2) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    {h.net != null ? h.net.toFixed(2) : "—"}
                  </td>
                  <td style={td}><StatusBadge status={h.status} historical={h.imported} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? "#fff7e0" : "#fff",
      border: highlight ? "1px solid #f4b400" : "1px solid #e5e7eb",
      borderRadius: 12, padding: 18,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.08, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
function InfoCard({ title, children }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.08, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function InfoRow({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ color: C.ink, fontWeight: 500 }}>{v}</span>
    </div>
  );
}

/* ─────────── Per-period notes ─────────── */

function PeriodNotes({ periodId, initialNotes, author, updatedAt }) {
  const [notes, setNotes] = useState(initialNotes || "");
  const [open, setOpen] = useState(!!initialNotes);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(updatedAt || null);
  const [savedBy, setSavedBy] = useState(author || null);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      await api(`/api/teebeepay/payroll-periods/${periodId}`, {
        method: "PATCH", body: JSON.stringify({ period_notes: notes }),
      });
      setSavedAt(new Date());
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        ...btnGhostLg, marginBottom: 14,
      }}>
        <NotebookPen size={14} style={{ marginRight: 6 }} /> Add a note for this period
      </button>
    );
  }

  return (
    <div style={{
      background: "#fffbe6", border: "1px solid #fde68a", borderRadius: 10,
      padding: 16, marginBottom: 18,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13, color: "#9c6c00", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <NotebookPen size={14} /> Period notes (visible to bookkeeper+)
        </strong>
        {savedAt && savedBy && (
          <span style={{ fontSize: 11, color: C.muted }}>
            saved by {savedBy} · {new Date(savedAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
        placeholder="e.g. Mark was sick all fortnight; advance to Jerry to be repaid next period; office closed Friday."
        style={{ ...input, background: "#fff", minHeight: 70 }} />
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={() => setOpen(false)} style={btnGhostLg}>Close</button>
        <button onClick={save} disabled={saving} style={btnPrimaryInline}>
          {saving ? <><Loader2 className="tbp-spin" size={14} style={{ marginRight: 6 }} /> Saving…</> : "Save note"}
        </button>
      </div>
    </div>
  );
}

/* ─────────── Audit log page ─────────── */

function AuditLogPage({ me, onBack }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({ action: "", company: "" });
  const [companies, setCompanies] = useState([]);

  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams();
    if (filter.action) qs.set("action", filter.action);
    if (filter.company) qs.set("company", filter.company);
    qs.set("limit", "300");
    try {
      const j = await api(`/api/teebeepay/audit-log?${qs.toString()}`);
      setEntries(j.entries || []);
    } catch (e) { setError(e.message); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try { setCompanies((await api("/api/teebeepay/companies")).companies || []); } catch {}
    })();
  }, []);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
      <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 800 }}>Audit log</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
        Every payroll approval, rejection, pay-stub re-send, employee edit, and user invite — recorded for the bureau's records.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <select style={{ ...input, width: "auto" }} value={filter.action}
          onChange={(e) => setFilter((x) => ({ ...x, action: e.target.value }))}>
          <option value="">All actions</option>
          <option value="payroll.submit">payroll.submit</option>
          <option value="payroll.approve">payroll.approve</option>
          <option value="payroll.reject">payroll.reject</option>
          <option value="stub.resend">stub.resend</option>
          <option value="user.invite">user.invite</option>
          <option value="nasfund.reminder_sent">nasfund.reminder_sent</option>
        </select>
        {me?.clearance >= 3 && (
          <select style={{ ...input, width: "auto" }} value={filter.company}
            onChange={(e) => setFilter((x) => ({ ...x, company: e.target.value }))}>
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {entries == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>When</th>
              <th style={th}>Actor</th>
              <th style={th}>Action</th>
              <th style={th}>Company</th>
              <th style={th}>Details</th>
            </tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} style={{ ...td, color: C.muted, textAlign: "center", padding: 30 }}>
                  No log entries match these filters.
                </td></tr>
              ) : entries.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ ...td, color: C.muted, fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
                    {new Date(e.ts).toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{e.actor_email || "system"}</div>
                    {e.actor_kind !== "user" && (
                      <div style={{ fontSize: 11, color: C.muted }}>{e.actor_kind}</div>
                    )}
                  </td>
                  <td style={td}><ActionBadge action={e.action} /></td>
                  <td style={{ ...td, color: C.muted }}>{e.company_name || "—"}</td>
                  <td style={{ ...td, color: C.inkSoft, fontSize: 13 }}>
                    {summariseDetails(e.action, e.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action }) {
  const presets = {
    "payroll.submit":         { bg: "#dbeafe", fg: "#1e40af" },
    "payroll.approve":        { bg: "#dcfce7", fg: "#166534" },
    "payroll.reject":         { bg: "#fee2e2", fg: "#991b1b" },
    "stub.resend":            { bg: "#fef3c7", fg: "#9c6c00" },
    "user.invite":            { bg: "#ede9fe", fg: "#5b21b6" },
    "nasfund.reminder_sent":  { bg: "#fffaf0", fg: "#9c2410" },
  };
  const p = presets[action] || { bg: "#f1f5f9", fg: C.muted };
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999,
      background: p.bg, color: p.fg, fontSize: 11, fontWeight: 600,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    }}>{action}</span>
  );
}

function summariseDetails(action, d) {
  if (!d) return "";
  if (action === "payroll.submit")
    return `${d.entries} entries · ${d.period_start} → ${d.period_end}${d.approver_emailed ? ` · approver: ${d.approver_emailed}` : ""}`;
  if (action === "payroll.approve")
    return `${d.entries} entries · K${(d.totalGross || 0).toFixed(2)} gross · ${d.stubsSent || 0} stubs sent${d.via === "email_magic_link" ? " (via email link)" : ""}`;
  if (action === "payroll.reject")
    return d.reason || "(no reason given)";
  if (action === "stub.resend")
    return `→ ${d.to || "?"}`;
  if (action === "user.invite")
    return `invited ${d.invited_email} as ${d.role}${d.name ? ` (${d.name})` : ""}`;
  if (action === "nasfund.reminder_sent")
    return `→ ${d.to} · ${d.daysOut} days before ${d.deadline}`;
  try { return JSON.stringify(d).slice(0, 120); } catch { return ""; }
}

/* ─────────── Employee self-serve portal ─────────── */

function MyStubsPortal({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try { setData(await api("/api/teebeepay/my-stubs")); }
      catch (e) { setError(e.message); }
    })();
  }, []);

  const displayName = me.first_name ? `${me.first_name}` : "there";

  if (error) return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px" }}>
      <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>
    </div>
  );
  if (!data) return <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>;

  const lifetime = data.stubs.reduce((a, s) => ({
    gross: a.gross + (Number(s.gross) || 0),
    tax: a.tax + (Number(s.tax) || 0),
    nasfund: a.nasfund + (Number(s.nasfund) || 0),
    net: a.net + (Number(s.net) || 0),
  }), { gross: 0, tax: 0, nasfund: 0, net: 0 });

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800 }}>Hi {displayName}.</h1>
      <p style={{ color: C.muted, fontSize: 15, margin: "0 0 26px" }}>
        {data.stubs.length === 0
          ? "No pay stubs are linked to your email yet. If you think this is wrong, contact your payroll office."
          : `You have ${data.stubs.length} pay stub${data.stubs.length === 1 ? "" : "s"} on file across ${data.employees.length} employer${data.employees.length === 1 ? "" : "s"}.`}
      </p>

      {data.stubs.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 26 }}>
            <StatCard label="Lifetime gross"   value={`K${lifetime.gross.toFixed(2)}`} />
            <StatCard label="Lifetime tax"     value={`K${lifetime.tax.toFixed(2)}`} />
            <StatCard label="Lifetime Nasfund" value={`K${lifetime.nasfund.toFixed(2)}`} />
            <StatCard label="Lifetime net"     value={`K${lifetime.net.toFixed(2)}`} highlight />
          </div>

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={th}>Pay date</th>
                <th style={th}>Employer</th>
                <th style={{ ...th, textAlign: "right" }}>Gross</th>
                <th style={{ ...th, textAlign: "right" }}>Tax</th>
                <th style={{ ...th, textAlign: "right" }}>Net</th>
                <th style={th}>Status</th>
              </tr></thead>
              <tbody>
                {data.stubs.map((s) => (
                  <tr key={s.entry_id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={td}>{s.pay_date || s.period_end || "—"}</td>
                    <td style={{ ...td, color: C.muted, fontSize: 13 }}>{s.company.name}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {s.gross != null ? s.gross.toFixed(2) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {s.tax != null ? s.tax.toFixed(2) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {s.net != null ? s.net.toFixed(2) : "—"}
                    </td>
                    <td style={td}><StatusBadge status={s.status} historical={s.imported} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────── Supervised-employees notice (NewPeriod grid) ─────────── */

function SupervisedNotice({ items }) {
  if (!items || !items.length) return null;
  // Group by division for clarity
  const byDiv = {};
  for (const e of items) {
    const k = e.division_name || "(unnamed division)";
    (byDiv[k] = byDiv[k] || []).push(e);
  }
  return (
    <div style={{
      background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8,
      padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#92400e",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <Network size={16} style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <strong>{items.length} supervisor-managed {items.length === 1 ? "employee" : "employees"} not shown.</strong> Their hours
        are entered by their division supervisor and pulled in when this period is submitted.
        <div style={{ marginTop: 6, color: "#78350f", fontSize: 12 }}>
          {Object.entries(byDiv).map(([div, list]) => (
            <span key={div} style={{ display: "inline-block", marginRight: 14 }}>
              <strong>{div}:</strong> {list.length}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Supervisor submissions status (Periods tab) ─────────── */

function SupervisorSubmissions({ companyId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const [dj, ej] = await Promise.all([
          api(`/api/teebeepay/companies/${companyId}/divisions`),
          api(`/api/teebeepay/companies/${companyId}/employees`),
        ]);
        const divs = (dj.divisions || []).filter((d) => d.supervisor_submits_hours);
        if (!divs.length) { setRows([]); return; }
        const emps = ej.employees || [];
        const out = divs.map((d) => {
          const team = emps.filter((e) => e.division_id === d.id && e.is_active);
          const withHours = team.filter((e) => e.pending_hours_at);
          const latest = withHours.reduce((max, e) =>
            (!max || new Date(e.pending_hours_at) > new Date(max)) ? e.pending_hours_at : max, null);
          return {
            id: d.id, name: d.name,
            supervisor_name: d.supervisor_name, supervisor_email: d.supervisor_email,
            team_size: team.length,
            submitted_count: withHours.length,
            latest_at: latest,
          };
        });
        setRows(out);
      } catch { setRows([]); }
    })();
  }, [companyId]);

  if (rows == null) return null;
  if (!rows.length) return null;
  const totalTeam = rows.reduce((s, r) => s + r.team_size, 0);
  const totalSubmitted = rows.reduce((s, r) => s + r.submitted_count, 0);
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: 16, marginBottom: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>
          <Network size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Supervisor submissions ({totalSubmitted} / {totalTeam} employees)
        </strong>
      </div>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.06 }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Division</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Supervisor</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Hours in</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.team_size ? r.submitted_count / r.team_size : 0;
            const status = r.submitted_count === 0
              ? { color: "#991b1b", bg: "#fee2e2", label: "Not submitted" }
              : r.submitted_count < r.team_size
                ? { color: "#9c6c00", bg: "#fef3c7", label: "Partial" }
                : { color: "#166534", bg: "#dcfce7", label: "All in" };
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px", fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: "8px", color: C.muted }}>{r.supervisor_name || <em>(none)</em>}</td>
                <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {r.submitted_count}/{r.team_size}
                  <span style={{ marginLeft: 8, color: C.muted, fontSize: 12 }}>({Math.round(pct * 100)}%)</span>
                </td>
                <td style={{ padding: "8px" }}>
                  <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                  {r.latest_at && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: C.muted }}>
                      last save {new Date(r.latest_at).toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Divisions admin panel (company tab) ─────────── */

function DivisionsPanel({ companyId, employees, canEdit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | {} (new) | row object
  const refresh = useCallback(async () => {
    setError("");
    try { setRows((await api(`/api/teebeepay/companies/${companyId}/divisions`)).divisions || []); }
    catch (e) { setError(e.message); }
  }, [companyId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function remove(d) {
    if (!confirm(`Delete the "${d.name}" division? This cannot be undone.`)) return;
    try {
      await api(`/api/teebeepay/companies/${companyId}/divisions/${d.id}`, { method: "DELETE" });
      refresh();
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: C.muted, maxWidth: 720 }}>
          Group this company's employees into divisions. A division can have its own supervisor — if you tick "supervisor
          enters hours", that supervisor's "My team" view feeds the hours into each fortnight automatically.
        </p>
        {canEdit && (
          <button onClick={() => setEditing({})} style={btnPrimaryInline}>
            <Plus size={16} /> Add division
          </button>
        )}
      </div>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {rows == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> :
       !rows.length ? <Empty>No divisions yet. Add the first one with the button above.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Name</th>
              <th style={th}>Supervisor</th>
              <th style={{ ...th, textAlign: "right" }}>Default hours</th>
              <th style={th}>Supervisor enters hours</th>
              <th style={{ ...th, textAlign: "right" }}># employees</th>
              <th style={{ ...th, width: 120 }}></th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}><strong>{d.name}</strong></td>
                  <td style={{ ...td, color: C.muted }}>{d.supervisor_name || <em>(none)</em>}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.default_hours ?? "—"}</td>
                  <td style={td}>
                    {d.supervisor_submits_hours
                      ? <Badge color="#9c6c00" bg="#fef3c7">Yes — supervisor</Badge>
                      : <Badge color={C.muted} bg="#f1f5f9">No — site payroll</Badge>}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: C.muted }}>{d.employee_count}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {canEdit && <button onClick={() => setEditing(d)} style={{ ...btnGhostSmall, marginRight: 6 }}>Edit</button>}
                    {canEdit && <button onClick={() => remove(d)} style={{ ...btnGhostSmall, color: "#991b1b" }}><Trash2 size={12} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DivisionDialog companyId={companyId} division={editing.id ? editing : null}
          employees={employees}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

function DivisionDialog({ companyId, division, employees, onClose, onSaved }) {
  const isEdit = !!division;
  const [f, setF] = useState({
    name: division?.name || "",
    supervisor_employee_id: division?.supervisor_employee_id || "",
    supervisor_submits_hours: !!division?.supervisor_submits_hours,
    default_hours: division?.default_hours ?? 80,
    timesheet_mode: !!division?.timesheet_mode,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError(""); setSubmitting(true);
    try {
      const body = {
        name: f.name.trim(),
        supervisor_employee_id: f.supervisor_employee_id || null,
        supervisor_submits_hours: !!f.supervisor_submits_hours,
        default_hours: f.default_hours === "" || f.default_hours == null ? null : Number(f.default_hours),
        timesheet_mode: !!f.timesheet_mode,
      };
      if (isEdit) {
        await api(`/api/teebeepay/companies/${companyId}/divisions/${division.id}`,
          { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/api/teebeepay/companies/${companyId}/divisions`,
          { method: "POST", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal title={isEdit ? `Edit division — ${division.name}` : "Add division"} onClose={onClose}>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      <Field label="Name *">
        <input style={input} value={f.name} onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Field, HQ, Maintenance, Lae Branch" autoFocus />
      </Field>
      <Row>
        <Field label="Supervisor">
          <select style={input} value={f.supervisor_employee_id}
            onChange={(e) => {
              const v = e.target.value;
              setF((x) => ({ ...x, supervisor_employee_id: v,
                supervisor_submits_hours: v ? x.supervisor_submits_hours : false }));
            }}>
            <option value="">— none —</option>
            {(employees || [])
              .filter((x) => x.is_active !== false)
              .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.first_name} {x.last_name}{x.email ? ` (${x.email})` : ""}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Default hours per period">
          <input style={input} type="number" step="0.5" value={f.default_hours}
            onChange={(e) => set("default_hours", e.target.value)} placeholder="80" />
        </Field>
      </Row>
      <label style={{
        display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
        fontSize: 13, color: f.supervisor_employee_id ? C.ink : C.muted,
        cursor: f.supervisor_employee_id ? "pointer" : "not-allowed",
      }}>
        <input type="checkbox" checked={!!f.supervisor_submits_hours} disabled={!f.supervisor_employee_id}
          onChange={(e) => set("supervisor_submits_hours", e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <strong>Supervisor enters this division's hours each pay period.</strong>
          <br />
          <span style={{ fontSize: 12, color: C.muted }}>
            When ticked, the supervisor (above) sees a "My team" page where they enter hours for this division;
            those hours flow into the next pay period automatically. When unticked, the company's site-payroll user enters them.
          </span>
        </span>
      </label>
      <label style={{
        display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12,
        fontSize: 13, color: f.supervisor_submits_hours ? C.ink : C.muted,
        cursor: f.supervisor_submits_hours ? "pointer" : "not-allowed",
      }}>
        <input type="checkbox" checked={!!f.timesheet_mode} disabled={!f.supervisor_submits_hours}
          onChange={(e) => set("timesheet_mode", e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <strong>Timesheet mode — track hours per day instead of one fortnight total.</strong>
          <br />
          <span style={{ fontSize: 12, color: C.muted }}>
            When ticked, each employee row in the supervisor's <em>My team</em> view expands to a 14-day grid.
            For each day the supervisor can either type the hours, or tap <strong>Clock in</strong> /
            <strong> Clock out</strong> to record the time directly. Hours are summed for the fortnight.
            Off by default — use it for hourly wage earners; leave off for salaried employees.
          </span>
        </span>
      </label>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!f.name.trim() || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : (isEdit ? "Save changes" : "Add division")}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Generic tutor modal (reusable across roles) ─────────── */

function Tutor({ eyebrow = "Quick tour", steps, onClose }) {
  const [step, setStep] = useState(0);
  const cur = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, maxWidth: 560, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
      }}>
        {/* Header strip with gold accent */}
        <div style={{ background: "linear-gradient(135deg, #fffaf0 0%, #fff7e0 100%)", padding: "18px 22px", borderBottom: "1px solid #fde68a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: "#fff",
              border: "1px solid #fde68a", display: "flex", alignItems: "center", justifyContent: "center",
            }}>{cur.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.goldDeep, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06 }}>
                {eyebrow} · step {step + 1} of {steps.length}
              </div>
              <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: C.ink }}>{cur.title}</h3>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 4 }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", fontSize: 14, lineHeight: 1.55, color: C.inkSoft }}>
          {cur.body}
        </div>

        {/* Step dots + nav */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {steps.map((_, i) => (
              <button key={i} onClick={() => setStep(i)} aria-label={`Go to step ${i + 1}`}
                style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: i === step ? C.red : "#e5e7eb",
                  border: "none", padding: 0, cursor: "pointer",
                }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} style={btnGhostLg}>
                <ChevronLeft size={14} style={{ marginRight: 4 }} /> Back
              </button>
            )}
            {isLast ? (
              <button onClick={onClose} style={btnPrimaryInline}>
                <CheckCircle2 size={14} style={{ marginRight: 6 }} /> Got it
              </button>
            ) : (
              <button onClick={() => setStep(step + 1)} style={btnPrimaryInline}>
                Next <ChevronRight size={14} style={{ marginLeft: 4 }} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Supervisor tutor — content (personalised by team data) */
function buildSupervisorTutorSteps(me, teams) {
  const totalEmployees = (teams || []).reduce((s, t) => s + (t.employees?.length || 0), 0);
  const divisionNames = (teams || []).map((t) => t.division_name);
  const companyNames = Array.from(new Set((teams || []).map((t) => t.company_name)));
  const firstName = (me?.first_name || "").trim() || me?.email || "there";
  return [
    {
      icon: <GraduationCap size={26} color={C.gold} />,
      title: `Welcome, ${firstName} — let's get you running`,
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            You've been set up as a supervisor on TeebeePay. That means you're the one who enters this team's
            hours each pay period — instead of the bookkeeper guessing or chasing you for them.
          </p>
          <p style={{ background: "#fff7e0", padding: 12, borderRadius: 8, border: "1px solid #fde68a", margin: "12px 0 0", fontSize: 13 }}>
            <strong>You supervise:</strong> {divisionNames.join(", ")}
            {" · "}<strong>{totalEmployees}</strong> employee{totalEmployees === 1 ? "" : "s"}
            {" · across "}<strong>{companyNames.length}</strong> compan{companyNames.length === 1 ? "y" : "ies"}.
          </p>
        </>
      ),
    },
    {
      icon: <NotebookPen size={26} color={C.gold} />,
      title: "Each row is one of your team members",
      body: (
        <>
          <p style={{ marginTop: 0 }}>For every employee, you enter three things this fortnight:</p>
          <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 14, lineHeight: 1.7 }}>
            <li><strong>Hours</strong> — what they actually worked. Pre-filled with the division default.</li>
            <li><strong>Cash advance</strong> (optional) — money already given; deducted from net pay.</li>
            <li><strong>Note</strong> (optional) — short explanation. Appears on their pay-stub email.</li>
          </ul>
          <p style={{ background: "#f3f4f6", padding: 12, borderRadius: 8, margin: "10px 0 0", fontSize: 13 }}>
            <strong>Tip — the double-click shortcut.</strong> Double-click an <em>Hours</em> cell to toggle between
            the division default and zero. Fastest way to mark absences.
          </p>
        </>
      ),
    },
    {
      icon: <CheckCircle2 size={26} color={C.gold} />,
      title: "Save whenever you like",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            Hit <strong>Save hours</strong> at the bottom whenever you want. You can keep editing later. Nothing is
            "submitted" yet — the bookkeeper picks these numbers up when they cut the next pay run.
          </p>
          <p style={{ marginTop: 12 }}>Each row shows the time of your last save under the employee's name.</p>
        </>
      ),
    },
    {
      icon: <AlertTriangle size={26} color={C.gold} />,
      title: "There's a deadline",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            Each company sets a day and time by which supervisor hours must be in. You'll get an email reminder
            the morning of that day if you haven't saved yet.
          </p>
          <p style={{ background: "#fee2e2", border: "1px solid #fecaca", padding: 12, borderRadius: 8, margin: "12px 0 0", fontSize: 13, color: "#7f1d1d" }}>
            <strong>Late submissions hold up the pay run.</strong> Save early — you can always edit again later.
          </p>
        </>
      ),
    },
    {
      icon: <HelpCircle size={26} color={C.gold} />,
      title: "You're set",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            Click <strong>Got it</strong> to start. You can re-open this tour any time via the
            <strong> Show tour </strong> button at the top of the page. The
            <strong> Steps for today </strong>panel always shows what's outstanding.
          </p>
        </>
      ),
    },
  ];
}

/* Bookkeeper tutor — content (NewPeriod page) */
function buildBookkeeperTutorSteps(me, company, employees, supervisedEmployees) {
  const firstName = (me?.first_name || "").trim() || me?.email || "there";
  const cName = company?.name || "this company";
  const sCount = (supervisedEmployees || []).length;
  return [
    {
      icon: <GraduationCap size={26} color={C.gold} />,
      title: `Welcome, ${firstName} — let's cut your first pay run`,
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            You're about to create a new pay period for <strong>{cName}</strong>. Each row below is an active
            employee. Set the period dates at the top, fill in hours, click <strong>Submit</strong>.
          </p>
          <p style={{ background: "#fff7e0", padding: 12, borderRadius: 8, border: "1px solid #fde68a", margin: "12px 0 0", fontSize: 13 }}>
            TeebeePay calculates the rest — SWT, Nasfund, allowances, deductions, net pay — and emails the approver
            for sign-off before any pay-stub goes out.
          </p>
        </>
      ),
    },
    {
      icon: <NotebookPen size={26} color={C.gold} />,
      title: "Enter hours fast",
      body: (
        <>
          <p style={{ marginTop: 0 }}>Three columns per row:</p>
          <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 14, lineHeight: 1.7 }}>
            <li><strong>Hours</strong> — what they worked. Defaults to the employee's standard hours.</li>
            <li><strong>Cash advance</strong> — money already given out, deducted from net.</li>
            <li><strong>Note</strong> — short explanation, appears on their pay-stub email.</li>
          </ul>
          <p style={{ background: "#f3f4f6", padding: 12, borderRadius: 8, margin: "10px 0 0", fontSize: 13 }}>
            <strong>Tip — the double-click shortcut.</strong> Double-click an Hours cell to toggle between the
            employee's default and zero. Fastest way through a long roster.
          </p>
        </>
      ),
    },
    {
      icon: <Network size={26} color={C.gold} />,
      title: sCount > 0
        ? `${sCount} supervisor-managed employee${sCount === 1 ? "" : "s"} are handled elsewhere`
        : "Supervisor-managed employees are handled elsewhere",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            Employees in divisions where the supervisor enters hours are <strong>hidden</strong> from this grid —
            you'll see them in the yellow notice above.
          </p>
          <p style={{ marginTop: 10 }}>
            Their hours come in from the supervisor's <strong>My team's hours</strong> page automatically.
            The <strong>Supervisor submissions</strong> panel on the Pay periods tab tells you who's in and who's not.
            When you submit this period, TeebeePay pulls their saved hours into the entries.
          </p>
        </>
      ),
    },
    {
      icon: <AlertTriangle size={26} color={C.gold} />,
      title: "Watch for anomaly banners",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            As you type, TeebeePay compares your running totals to the median of the last six pay periods.
            If gross pay or headcount drifts more than 25%, a yellow banner appears at the top.
          </p>
          <p style={{ background: "#fef3c7", padding: 12, borderRadius: 8, margin: "10px 0 0", fontSize: 13, color: "#7c2d12" }}>
            It's just a flag — sometimes the difference is real. But it catches the "I typed 800 instead of 80"
            kind of mistake before it lands in everyone's pay stubs.
          </p>
        </>
      ),
    },
    {
      icon: <Mail size={26} color={C.gold} />,
      title: "Submit and the approver gets emailed",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            When you submit, the period moves to <strong>Pending approval</strong> and the company's manager email
            receives a one-click magic link to review the totals. No login required for them.
          </p>
          <p style={{ marginTop: 10 }}>
            After they approve, you can email pay-stubs, download the BSP batch, NASFund return, QuickBooks IIF,
            or the whole period as a ZIP.
          </p>
        </>
      ),
    },
    {
      icon: <HelpCircle size={26} color={C.gold} />,
      title: "You're set",
      body: (
        <p style={{ margin: 0 }}>
          Click <strong>Got it</strong> to begin. Reach out by replying to any TeebeePay email if you get stuck.
        </p>
      ),
    },
  ];
}

/* ─────────── Steps for today (running checklist for supervisors) ─────────── */

function StepsForToday({ teams, draft }) {
  const [collapsed, setCollapsed] = useState(false);
  const all = (teams || []).flatMap((t) => t.employees.map((e) => ({ ...e, _team: t })));
  if (!all.length) return null;
  const total = all.length;
  const saved = all.filter((e) => !!e.pending_hours_at).length;
  // "Touched this session" — employees whose draft differs from current pending values
  const touched = all.filter((e) => {
    const d = draft[e.id] || {};
    return Number(d.hours) !== Number(e.pending_hours || 0)
        || Number(d.cash_advance) !== Number(e.pending_cash_advance || 0)
        || (d.note || "") !== (e.pending_note || "");
  }).length;
  const pct = Math.round((saved / total) * 100);
  const state = saved === 0 ? "not_started" : saved === total ? "complete" : "partial";

  const palette = {
    not_started: { bg: "#fee2e2", bd: "#fecaca", ink: "#7f1d1d", accent: "#b91c1c" },
    partial:     { bg: "#fef3c7", bd: "#fde68a", ink: "#78350f", accent: "#ca8a04" },
    complete:    { bg: "#dcfce7", bd: "#bbf7d0", ink: "#14532d", accent: "#16a34a" },
  }[state];

  const items = [
    { done: total > 0, text: `Review the ${total}-row grid — one row per team member` },
    { done: false,     text: `Update hours where they differ from the division default (double-click to toggle ↔ 0)` },
    { done: false,     text: `Note any cash advances or context (visible on their pay-stub email)` },
    { done: saved > 0 || touched > 0, text: `Click "Save hours" — you can keep editing after` },
    { done: saved === total && total > 0, text: `Once every row is saved you're done — the bookkeeper takes over` },
  ];

  return (
    <div style={{
      background: palette.bg, border: `1px solid ${palette.bd}`, borderRadius: 10,
      padding: collapsed ? "10px 14px" : "14px 16px", marginBottom: 18, color: palette.ink,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClipboardList size={18} />
          <strong style={{ fontSize: 14 }}>
            Steps for today — {state === "complete" ? "all done! " : `${saved} of ${total} saved (${pct}%)`}
          </strong>
        </div>
        <button onClick={() => setCollapsed((x) => !x)} style={{
          background: "none", border: "none", cursor: "pointer", color: palette.ink, fontSize: 12, fontWeight: 600,
        }}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Progress bar */}
          <div style={{ marginTop: 10, height: 6, background: "rgba(0,0,0,0.07)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: palette.accent, transition: "width 200ms" }} />
          </div>

          {/* Checklist */}
          <ol style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 13 }}>
            {items.map((it, i) => (
              <li key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0",
                opacity: it.done ? 0.7 : 1,
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                  background: it.done ? palette.accent : "transparent",
                  color: it.done ? "#fff" : palette.ink,
                  border: it.done ? "none" : `1.5px solid ${palette.accent}`,
                  fontSize: 11, fontWeight: 700, marginTop: 1,
                }}>{it.done ? "✓" : i + 1}</span>
                <span style={{ textDecoration: it.done ? "line-through" : "none" }}>{it.text}</span>
              </li>
            ))}
          </ol>

          {touched > 0 && saved < total && (
            <p style={{ margin: "10px 0 0", fontSize: 12, fontWeight: 600 }}>
              {touched} row{touched === 1 ? "" : "s"} edited but not yet saved — click <strong>Save hours</strong> below.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────── Manager Steps for today (Dashboard widget) ─────────── */

function ManagerStepsForToday({ onOpenCompany }) {
  const [d, setD] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    (async () => {
      try { setD(await api("/api/teebeepay/manager/today-tasks")); }
      catch { setD({}); /* fail open — widget just stays empty */ }
    })();
  }, []);
  if (!d) return null;
  const pending = d.pending_approval || [];
  const noStubs = d.approved_no_stubs || [];
  const supPending = d.supervisor_pending_divisions || 0;
  const nasfundSoon = !!d.nasfund_deadline;

  // Build steps with current state
  const items = [
    {
      done: supPending === 0,
      attention: supPending > 0,
      title: supPending === 0
        ? "Supervisor submissions — all in"
        : `Chase ${supPending} supervisor submission${supPending === 1 ? "" : "s"}`,
      detail: supPending > 0
        ? <>Companies with pending supervisors: {Object.entries(d.supervisor_pending_by_company || {}).map(([n, v]) => `${n} (${v})`).join(", ")}</>
        : <>Every active division supervisor has submitted hours within the last 6 days.</>,
    },
    {
      done: pending.length === 0,
      attention: pending.length > 0,
      title: pending.length === 0
        ? "No pay periods awaiting approval"
        : `Review ${pending.length} period${pending.length === 1 ? "" : "s"} awaiting approval`,
      detail: pending.length > 0 ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {pending.slice(0, 4).map((p) => (
            <li key={p.id}>
              <button onClick={() => onOpenCompany && onOpenCompany(p.company_id)}
                style={{ background: "none", border: "none", color: C.redDeep, textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>
                {p.company_name}
              </button>
              {" · "}pay date {p.pay_date}
            </li>
          ))}
          {pending.length > 4 && <li>… and {pending.length - 4} more</li>}
        </ul>
      ) : null,
    },
    {
      done: noStubs.length === 0,
      attention: noStubs.length > 0,
      title: noStubs.length === 0
        ? "All approved periods have had pay-stubs emailed"
        : `Send pay-stubs for ${noStubs.length} approved period${noStubs.length === 1 ? "" : "s"}`,
      detail: noStubs.length > 0 ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {noStubs.slice(0, 4).map((p) => (
            <li key={p.id}>
              <button onClick={() => onOpenCompany && onOpenCompany(p.company_id)}
                style={{ background: "none", border: "none", color: C.redDeep, textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>
                {p.company_name}
              </button>
              {" · "}pay date {p.pay_date}
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      done: !nasfundSoon,
      attention: nasfundSoon,
      title: nasfundSoon
        ? `NASFund deadline this week — ${d.nasfund_deadline}`
        : "No NASFund deadline this week",
      detail: nasfundSoon
        ? <>Monthly NCSL contribution returns are due. Download each company's NASFund XLSX from its latest pay period and file with the fund.</>
        : null,
    },
  ];

  const attentionCount = items.filter((i) => i.attention).length;
  const allClear = attentionCount === 0;
  const palette = allClear
    ? { bg: "#dcfce7", bd: "#bbf7d0", ink: "#14532d", accent: "#16a34a" }
    : { bg: "#fef3c7", bd: "#fde68a", ink: "#78350f", accent: "#ca8a04" };

  return (
    <div style={{
      background: palette.bg, border: `1px solid ${palette.bd}`, borderRadius: 10,
      padding: collapsed ? "10px 14px" : "14px 16px", marginBottom: 18, color: palette.ink,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClipboardList size={18} />
          <strong style={{ fontSize: 14 }}>
            Steps for today — {allClear ? "all clear" : `${attentionCount} ${attentionCount === 1 ? "thing needs" : "things need"} attention`}
          </strong>
        </div>
        <button onClick={() => setCollapsed((x) => !x)} style={{
          background: "none", border: "none", cursor: "pointer", color: palette.ink, fontSize: 12, fontWeight: 600,
        }}>{collapsed ? "Show" : "Hide"}</button>
      </div>

      {!collapsed && (
        <ol style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 13 }}>
          {items.map((it, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0",
                                  opacity: it.done && !it.attention ? 0.7 : 1 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                background: it.done ? palette.accent : "transparent",
                color: it.done ? "#fff" : palette.ink,
                border: it.done ? "none" : `1.5px solid ${palette.accent}`,
                fontSize: 11, fontWeight: 700, marginTop: 1,
              }}>{it.done ? "✓" : i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{it.title}</div>
                {it.detail && <div style={{ marginTop: 2, color: palette.ink, opacity: 0.85 }}>{it.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ─────────── My team's hours (supervisor view) ─────────── */

function MyTeamPage({ me, onBack }) {
  const [teams, setTeams] = useState(null);
  const [draft, setDraft] = useState({}); // emp_id -> { hours, cash_advance, note }
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  // Auto-open the tutor the first time this user lands on the page.
  // Per-user key so different supervisors each get their own onboarding.
  const tutorKey = `teebeepay.tutor.my_team.${me?.uid || "anon"}`;

  const refresh = useCallback(async () => {
    setError(""); setInfo("");
    try {
      const j = await api("/api/teebeepay/supervisor/team");
      setTeams(j.teams || []);
      // Seed draft from any existing pending hours / timesheet
      const seed = {};
      for (const t of (j.teams || [])) {
        for (const e of t.employees) {
          const baseHours = e.pending_hours != null ? e.pending_hours : (e.default_hours || t.default_hours || 80);
          seed[e.id] = {
            hours: baseHours,
            cash_advance: e.pending_cash_advance || 0,
            note: e.pending_note || "",
            timesheet: e.pending_timesheet || {},
          };
        }
      }
      setDraft(seed);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function set(eid, k, v) {
    setDraft((d) => ({ ...d, [eid]: { ...(d[eid] || { hours: 0, cash_advance: 0, note: "" }), [k]: v } }));
  }
  function dblToggleHours(emp, def) {
    const cur = Number(draft[emp.id]?.hours) || 0;
    set(emp.id, "hours", cur === def ? 0 : def);
  }

  async function save() {
    setError(""); setInfo(""); setSubmitting(true);
    try {
      const entries = [];
      for (const t of teams || []) {
        for (const e of t.employees) {
          const d = draft[e.id] || {};
          const row = {
            employee_id: e.id,
            cash_advance: Number(d.cash_advance) || 0,
            note: d.note || "",
          };
          if (t.timesheet_mode) {
            row.timesheet = d.timesheet || {};
          } else {
            row.hours = Number(d.hours) || 0;
          }
          entries.push(row);
        }
      }
      const j = await api("/api/teebeepay/supervisor/pending-hours", {
        method: "POST", body: JSON.stringify({ entries }),
      });
      setInfo(`Saved hours for ${j.saved} employee${j.saved === 1 ? "" : "s"}. The site-payroll team will see these when they cut the next pay period.`);
      refresh();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  // Auto-launch tutorial on first successful team-load for this user.
  useEffect(() => {
    if (teams == null || !teams.length) return;
    try {
      if (!localStorage.getItem(tutorKey)) {
        setTutorOpen(true);
        localStorage.setItem(tutorKey, new Date().toISOString());
      }
    } catch { /* localStorage blocked — silently skip */ }
  }, [teams, tutorKey]);

  if (teams == null) return <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered>;
  if (!teams.length) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px" }}>
        <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
        <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800 }}>My team's hours</h1>
        <p style={{ color: C.muted, fontSize: 14 }}>
          You aren't currently set up as a supervisor on any division that submits hours. Ask the bookkeeper to assign you
          on the company's <strong>Divisions</strong> tab.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>My team's hours</h1>
        <button onClick={() => setTutorOpen(true)} style={{ ...btnGhostSmall, color: C.redDeep }} title="Show the quick tutorial">
          <GraduationCap size={14} style={{ marginRight: 6 }} /> Show tour
        </button>
      </div>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
        Enter the hours each of your team members worked this pay period. Save whenever you like — the values are picked
        up automatically when the bookkeeper cuts the next pay run. Double-click an hours cell to toggle between the
        division default and zero (e.g. didn't work this fortnight).
      </p>
      {tutorOpen && (
        <Tutor eyebrow="Supervisor tour"
          steps={buildSupervisorTutorSteps(me, teams)}
          onClose={() => setTutorOpen(false)} />
      )}
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}

      <StepsForToday teams={teams} draft={draft} />

      {(() => {
        const post = (teams || []).flatMap((t) => t.employees.filter((e) => e.post_consumption));
        if (!post.length) return null;
        return (
          <div style={{
            background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 10,
            padding: "12px 16px", marginBottom: 18, color: "#7f1d1d", display: "flex", gap: 10,
          }}>
            <AlertTriangle size={18} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <strong>{post.length} employee{post.length === 1 ? "'s" : "s'"} hours are for a period already paid.</strong> Changes you save here
              will queue for the <em>next</em> fortnight, not back-apply to the prior one. If a correction is needed for the
              paid period, tell the bookkeeper — they can apply an adjustment in the next pay run.
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                Affected: {post.map((e) => `${e.first_name} ${e.last_name}`).join(", ")}
              </div>
            </div>
          </div>
        );
      })()}

      {teams.map((t) => (
        <div key={t.division_id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 18, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ fontSize: 15 }}>{t.company_name} · {t.division_name}</strong>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {t.employees.length} employees · default hours per period: <strong>{t.default_hours}</strong>
                {t.timesheet_mode && (
                  <> · <Badge color="#9c6c00" bg="#fef3c7">Timesheet mode</Badge>
                  <span style={{ marginLeft: 6 }}>fortnight {t.period_start} → {t.period_end}</span></>
                )}
              </div>
            </div>
          </div>
          {t.timesheet_mode ? (
            <TimesheetTeamGrid team={t} draft={draft} setDraft={setDraft} />
          ) : (
            <PeriodTeamGrid team={t} draft={draft} setRowField={set} dblToggleHours={dblToggleHours} />
          )}
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={save} disabled={submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</>
                      : <>Save hours</>}
        </button>
      </div>
    </div>
  );
}

/* ─────────── My team — Period-mode grid (one row per employee) ─────────── */

function PeriodTeamGrid({ team, draft, setRowField, dblToggleHours }) {
  return (
    <table className="tbp-grid" style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>Employee</th>
          <th style={{ ...th, width: 80, textAlign: "right" }}>Default</th>
          <th style={{ ...th, width: 110 }}>Hours</th>
          <th style={{ ...th, width: 110 }}>Cash advance</th>
          <th style={th}>Note (shows on stub)</th>
        </tr>
      </thead>
      <tbody>
        {team.employees.map((e) => {
          const def = e.default_hours || team.default_hours || 80;
          const d = draft[e.id] || {};
          return (
            <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
              <td style={td}>
                <strong>{e.first_name} {e.last_name}</strong>
                {e.pending_hours_at && (
                  <div style={{ fontSize: 11, color: C.muted }}>
                    last saved {new Date(e.pending_hours_at).toLocaleString()}
                    {Array.isArray(e.submission_history) && e.submission_history.length > 1 && (
                      <> · <strong>{e.submission_history.length}</strong> saves this fortnight</>
                    )}
                  </div>
                )}
                {e.post_consumption && (
                  <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>
                    <AlertTriangle size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                    Period already paid — changes queue for next fortnight
                  </div>
                )}
              </td>
              <td style={{ ...td, textAlign: "right", color: C.muted }}>{def}</td>
              <td style={td}>
                <input style={{ ...input, padding: "6px 8px", textAlign: "right" }} type="number" step="0.5"
                  value={d.hours ?? ""} onChange={(ev) => setRowField(e.id, "hours", ev.target.value)}
                  onDoubleClick={() => dblToggleHours(e, def)} />
              </td>
              <td style={td}>
                <input style={{ ...input, padding: "6px 8px", textAlign: "right" }} type="number" step="0.01"
                  value={d.cash_advance ?? ""} onChange={(ev) => setRowField(e.id, "cash_advance", ev.target.value)} />
              </td>
              <td style={td}>
                <input style={{ ...input, padding: "6px 8px" }} value={d.note || ""}
                  onChange={(ev) => setRowField(e.id, "note", ev.target.value)} placeholder="(optional)" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─────────── My team — Timesheet-mode grid (expandable per-day) ─────────── */

function timesheetTotal(ts) {
  if (!ts) return 0;
  function clockToMin(s) {
    if (!s) return null;
    const [h, m] = String(s).split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }
  let sum = 0;
  for (const k of Object.keys(ts)) {
    const d = ts[k] || {};
    if (d.hours != null && d.hours !== "") {
      sum += Number(d.hours) || 0;
    } else if (d.clock_in && d.clock_out) {
      const a = clockToMin(d.clock_in), b = clockToMin(d.clock_out);
      if (a != null && b != null && b > a) sum += (b - a) / 60;
    }
  }
  return Math.round(sum * 100) / 100;
}

function TimesheetTeamGrid({ team, draft, setDraft }) {
  const [expanded, setExpanded] = useState(new Set());
  function toggle(eid) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(eid) ? n.delete(eid) : n.add(eid);
      return n;
    });
  }
  function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function setCell(eid, date, key, val) {
    setDraft((dr) => {
      const row = { ...(dr[eid] || { timesheet: {} }) };
      const ts = { ...(row.timesheet || {}) };
      const day = { ...(ts[date] || {}) };
      day[key] = val;
      ts[date] = day;
      row.timesheet = ts;
      return { ...dr, [eid]: row };
    });
  }
  function tapClock(eid, date) {
    setDraft((dr) => {
      const row = { ...(dr[eid] || { timesheet: {} }) };
      const ts = { ...(row.timesheet || {}) };
      const day = { ...(ts[date] || {}) };
      const t = nowHHMM();
      // If no clock_in or both filled, start a new clock_in (overwriting any complete pair).
      if (!day.clock_in || (day.clock_in && day.clock_out)) {
        day.clock_in = t; day.clock_out = null;
      } else {
        day.clock_out = t;
      }
      ts[date] = day;
      row.timesheet = ts;
      return { ...dr, [eid]: row };
    });
  }
  function clearDay(eid, date) {
    setDraft((dr) => {
      const row = { ...(dr[eid] || { timesheet: {} }) };
      const ts = { ...(row.timesheet || {}) };
      delete ts[date];
      row.timesheet = ts;
      return { ...dr, [eid]: row };
    });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  const today = todayISO();

  return (
    <table className="tbp-grid" style={tableStyle}>
      <thead>
        <tr>
          <th style={{ ...th, width: 38 }}></th>
          <th style={th}>Employee</th>
          <th style={{ ...th, width: 100, textAlign: "right" }}>Hours total</th>
          <th style={{ ...th, width: 110 }}>Cash advance</th>
          <th style={th}>Note (shows on stub)</th>
        </tr>
      </thead>
      <tbody>
        {team.employees.map((e) => {
          const d = draft[e.id] || {};
          const ts = d.timesheet || {};
          const total = timesheetTotal(ts);
          const isOpen = expanded.has(e.id);
          return (
            <React.Fragment key={e.id}>
              <tr style={{ borderTop: "1px solid #f1f5f9", cursor: "pointer", background: isOpen ? "#fafbfc" : "transparent" }}
                  onClick={() => toggle(e.id)}>
                <td style={{ ...td, textAlign: "center", color: C.muted, userSelect: "none" }}>
                  {isOpen ? "▾" : "▸"}
                </td>
                <td style={td}>
                  <strong>{e.first_name} {e.last_name}</strong>
                  {e.pending_hours_at && (
                    <div style={{ fontSize: 11, color: C.muted }}>
                      last saved {new Date(e.pending_hours_at).toLocaleString()}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {total.toFixed(2)} h
                </td>
                <td style={td} onClick={(ev) => ev.stopPropagation()}>
                  <input style={{ ...input, padding: "6px 8px", textAlign: "right" }} type="number" step="0.01"
                    value={d.cash_advance ?? ""}
                    onChange={(ev) => setDraft((dr) => ({ ...dr, [e.id]: { ...(dr[e.id] || { timesheet: {} }), cash_advance: ev.target.value } }))} />
                </td>
                <td style={td} onClick={(ev) => ev.stopPropagation()}>
                  <input style={{ ...input, padding: "6px 8px" }} value={d.note || ""}
                    onChange={(ev) => setDraft((dr) => ({ ...dr, [e.id]: { ...(dr[e.id] || { timesheet: {} }), note: ev.target.value } }))}
                    placeholder="(optional)" />
                </td>
              </tr>
              {isOpen && (
                <tr style={{ background: "#fafbfc", borderTop: "1px solid #f1f5f9" }}>
                  <td colSpan={5} style={{ padding: "0 0 14px 0" }}>
                    <div style={{ padding: "10px 16px", fontSize: 12, color: C.muted }}>
                      For each day: tap <strong>Clock in</strong> to record now, then <strong>Clock out</strong> to close
                      the shift. Or just type the hours. <strong>Clear</strong> wipes the day.
                    </div>
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 8, padding: "0 16px",
                    }}>
                      {(team.period_days || []).map((dateStr) => {
                        const day = ts[dateStr] || {};
                        const isToday = dateStr === today;
                        const dateObj = new Date(dateStr + "T00:00:00Z");
                        const dow = dateObj.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
                        const dd = dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
                        const dayHours = day.hours != null && day.hours !== ""
                          ? Number(day.hours)
                          : (day.clock_in && day.clock_out
                            ? timesheetTotal({ k: { clock_in: day.clock_in, clock_out: day.clock_out } })
                            : 0);
                        return (
                          <div key={dateStr} style={{
                            border: `1px solid ${isToday ? "#fde68a" : "#e5e7eb"}`,
                            borderRadius: 8, padding: 10,
                            background: isToday ? "#fffbeb" : "#fff",
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? "#9c6c00" : C.ink }}>
                                {dow} {dd}{isToday ? " · today" : ""}
                              </span>
                              <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                                {dayHours ? `${dayHours.toFixed(2)} h` : "—"}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                              <input type="time" value={day.clock_in || ""}
                                onChange={(ev) => setCell(e.id, dateStr, "clock_in", ev.target.value)}
                                style={{ ...input, padding: "4px 6px", fontSize: 12, flex: 1 }} />
                              <input type="time" value={day.clock_out || ""}
                                onChange={(ev) => setCell(e.id, dateStr, "clock_out", ev.target.value)}
                                style={{ ...input, padding: "4px 6px", fontSize: 12, flex: 1 }} />
                            </div>
                            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                              <input type="number" step="0.25" value={day.hours ?? ""}
                                placeholder="or hours"
                                onChange={(ev) => setCell(e.id, dateStr, "hours", ev.target.value)}
                                style={{ ...input, padding: "4px 6px", fontSize: 12, flex: 1, textAlign: "right" }} />
                            </div>
                            <select value={day.leave_type || ""}
                              onChange={(ev) => setCell(e.id, dateStr, "leave_type", ev.target.value || null)}
                              style={{ ...input, padding: "4px 6px", fontSize: 12, marginBottom: 6 }}>
                              <option value="">— at work —</option>
                              {(team.leave_types || []).map((lt) => (
                                <option key={lt.code} value={lt.code}>
                                  {lt.name}{lt.paid ? " · paid" : " · unpaid"}
                                </option>
                              ))}
                            </select>
                            <input style={{ ...input, padding: "4px 6px", fontSize: 12, marginBottom: 6 }}
                              value={day.note || ""} placeholder="Day note (late, family event…)"
                              onChange={(ev) => setCell(e.id, dateStr, "note", ev.target.value)} />
                            <div style={{ display: "flex", gap: 4 }}>
                              <button type="button" onClick={() => tapClock(e.id, dateStr)}
                                style={{ ...btnGhostSmall, padding: "4px 6px", fontSize: 11, flex: 1 }}>
                                {!day.clock_in || (day.clock_in && day.clock_out) ? "Clock in" : "Clock out"}
                              </button>
                              <button type="button" onClick={() => clearDay(e.id, dateStr)}
                                style={{ ...btnGhostSmall, padding: "4px 6px", fontSize: 11, color: "#991b1b" }}>
                                Clear
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─────────── Reusable bits ─────────── */

function StatusBadge({ status, historical }) {
  if (historical) return <Badge color="#1e40af" bg="#dbeafe">Historical</Badge>;
  if (status === "approved") return <Badge color="#166534" bg="#dcfce7">Approved</Badge>;
  if (status === "pending_approval") return <Badge color="#9c6c00" bg="#fef3c7">Pending</Badge>;
  return <Badge color={C.muted} bg="#f1f5f9">{status || "draft"}</Badge>;
}
function Badge({ color, bg, children }) {
  return <span style={{ background: bg, color, padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.04 }}>{children}</span>;
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
function Empty({ children }) {
  return <div style={{ padding: 30, textAlign: "center", color: C.muted, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>{children}</div>;
}
function Modal({ title, wide, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: 28, width: "100%",
        maxWidth: wide ? 720 : 480, maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 30px 60px rgba(0,0,0,.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.inkSoft, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
function FieldGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 18, padding: 14, background: "#fafbfc", borderRadius: 8, border: "1px solid #f0f1f4" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}
function Row({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${React.Children.count(children)}, 1fr)`, gap: 12 }}>{children}</div>;
}
function Label({ children }) {
  return <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.inkSoft, marginBottom: 6 }}>{children}</label>;
}
function FlashBox({ type, icon, children }) {
  const color = type === "error" ? "#991b1b" : "#1e40af";
  const bg = type === "error" ? "#fee2e2" : "#dbeafe";
  return (
    <div style={{ background: bg, color, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span><span>{children}</span>
    </div>
  );
}

/* ─────────── Styles ─────────── */

const input = {
  display: "block", width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 14, outline: "none", background: "#fff", color: C.ink,
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%",
  padding: "12px 18px", borderRadius: 10, border: "none", cursor: "pointer",
  background: C.red, color: "#fff", fontWeight: 700, fontSize: 15,
};
const btnPrimaryInline = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
  background: C.red, color: "#fff", fontWeight: 600, fontSize: 14,
};
const btnGhost = {
  display: "block", width: "100%", marginTop: 12,
  padding: "10px 18px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff",
  color: C.inkSoft, fontWeight: 500, fontSize: 13, cursor: "pointer",
};
const btnGhostLg = {
  padding: "9px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
  color: C.inkSoft, fontWeight: 600, fontSize: 14, cursor: "pointer",
};
const btnGhostSmall = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "6px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff",
  color: C.inkSoft, fontWeight: 500, fontSize: 13, cursor: "pointer",
};
const btnBack = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "none", border: "none", color: C.muted, fontSize: 13, fontWeight: 500,
  padding: 0, marginBottom: 14, cursor: "pointer",
};
const companyCard = {
  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
  padding: 20, textAlign: "left", cursor: "pointer", display: "block", width: "100%",
};
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 14, background: "#fff" };
const th = { padding: "12px 14px", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06, textAlign: "left", background: "#fafbfc" };
const td = { padding: "10px 14px" };
