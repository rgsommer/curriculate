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
  BarChart3, Percent, Upload, Image as ImageIcon,
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
  const [view, setView] = useState("loading"); // loading | login | dashboard | company | new_period | period | users | service_fees | employee
  const [me, _setMe] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
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

  function signOut() { setToken(null); setMe(null); _setMe(null); setView("login"); }
  function goCompany(id) { setSelectedCompanyId(id); setView("company"); }
  function goNewPeriod(id) { setSelectedCompanyId(id); setView("new_period"); }
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
        onHome={() => setView("dashboard")}
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
        onBack={() => setView("company")} onSaved={(pid) => goPeriod(pid)} />}
      {view === "period" && <PeriodDetail me={me} periodId={selectedPeriodId}
        onBack={() => setView("company")} />}
      {view === "users" && <UsersPage me={me} onBack={() => setView("dashboard")} />}
      {view === "service_fees" && <ServiceFeesPage me={me} onBack={() => setView("dashboard")} />}
      {view === "employee" && <EmployeeProfile me={me} employeeId={selectedEmployeeId}
        onBack={() => setView("company")} onOpenPeriod={goPeriod} />}
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

function AppHeader({ me, onSignOut, onUsers, onServiceFees, onHome, onProfile }) {
  const displayName = me?.first_name || me?.last_name
    ? `${me.first_name || ""} ${me.last_name || ""}`.trim()
    : me?.email || "";
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
        {me?.clearance >= 4 && (
          <button onClick={onServiceFees} style={btnGhostSmall} title="Service fees">
            <Percent size={14} /> Fees
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
  const [step, setStep] = useState("email");
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
      setPinToken(j.token); setStep("pin");
      setInfo("We've emailed you a 6-digit code. Enter it below.");
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  async function verifyPin() {
    setError(""); setSubmitting(true);
    try {
      const j = await api("/api/teebeepay/auth/verify-pin", {
        method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase(), pin: pin.trim(), token: pinToken }),
      });
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
        {step === "email" ? (
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
        ) : (
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

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {companies == null ? <Centered><Loader2 className="tbp-spin" size={24} color={C.red} /></Centered> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {companies.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)} style={companyCard}>
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
            </button>
          ))}
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
        periods == null ? <Loader2 className="tbp-spin" size={20} color={C.red} />
                        : <PeriodTable periods={periods} onOpen={onOpenPeriod} />
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

function EmployeeDialog({ companyId, employee, onClose, onSaved }) {
  const isEdit = !!employee;
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
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setError(""); setSubmitting(true);
    try {
      if (isEdit) {
        await api(`/api/teebeepay/companies/${companyId}/employees/${employee.id}`,
          { method: "PATCH", body: JSON.stringify(f) });
      } else {
        await api(`/api/teebeepay/companies/${companyId}/employees`,
          { method: "POST", body: JSON.stringify(f) });
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
        <Row>
          <Field label="Default hours per period"><input style={input} type="number" step="0.5" value={f.default_hours} onChange={(e) => set("default_hours", e.target.value)} /></Field>
          <Field label="FTE %"><input style={input} type="number" step="1" value={f.fte_pct} onChange={(e) => set("fte_pct", e.target.value)} /></Field>
          <Field label="Dependants"><input style={input} type="number" min="0" value={f.dependents} onChange={(e) => set("dependents", e.target.value)} /></Field>
        </Row>
      </FieldGroup>
      <FieldGroup label="Banking">
        <Row>
          <Field label="Bank code"><input style={input} value={f.bank_code} onChange={(e) => set("bank_code", e.target.value)} /></Field>
          <Field label="Branch"><input style={input} value={f.branch_code} onChange={(e) => set("branch_code", e.target.value)} /></Field>
        </Row>
        <Field label="Account number"><input style={input} value={f.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} /></Field>
        <Field label="Account name"><input style={input} value={f.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} /></Field>
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

function NewPeriod({ me, companyId, onBack, onSaved }) {
  const [employees, setEmployees] = useState(null);
  const [company, setCompany] = useState(null);
  const [period, setPeriod] = useState({
    period_start: "", period_end: "", pay_date: new Date().toISOString().slice(0, 10),
  });
  const [grid, setGrid] = useState({}); // employee_id -> { hours, cash_advance, note }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const j = await api(`/api/teebeepay/companies/${companyId}/employees`);
        const c = (await api("/api/teebeepay/companies")).companies.find((x) => x.id === companyId);
        setEmployees(j.employees.filter((e) => e.is_active));
        setCompany(c);
        const today = new Date();
        const end = new Date(today); end.setDate(end.getDate() - 1);
        const start = new Date(end); start.setDate(start.getDate() - 13);
        const pay = new Date(today);
        setPeriod((p) => ({ ...p, period_start: start.toISOString().slice(0, 10),
          period_end: end.toISOString().slice(0, 10), pay_date: pay.toISOString().slice(0, 10) }));
      } catch (e) { setError(e.message); }
    })();
  }, [companyId]);

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
      <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 800 }}>New pay period — {company.name}</h1>
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

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

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

/* ─────────── Period detail + Approve ─────────── */

function PeriodDetail({ me, periodId, onBack }) {
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => authedDownload(downloadHref("bsp"),
          `BSPPayroll-${(period.pay_date || "").replace(/-/g, "")}.csv`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> BSP batch CSV
        </button>
        <button onClick={() => authedDownload(downloadHref("nasfund"),
          `NASFund-${(period.period_end || "").replace(/-/g, "")}.xlsx`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> NASFund return XLSX
        </button>
        <button onClick={() => authedDownload(downloadHref("iif"),
          `Payroll-${(period.pay_date || "").replace(/-/g, "")}_QB_IIF.iif`)} style={btnGhostLg}>
          <Download size={14} style={{ marginRight: 6 }} /> QuickBooks IIF
        </button>
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
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setError(""); setData(null);
      try { setData(await api(`/api/teebeepay/companies/${companyId}/reports?period=${period}`)); }
      catch (e) { setError(e.message); }
    })();
  }, [companyId, period]);

  if (error) return <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>;
  if (!data) return <Loader2 className="tbp-spin" size={20} color={C.red} />;

  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <strong style={{ fontSize: 14 }}>Bucket:</strong>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...input, maxWidth: 200 }}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.muted }}>
          Lifetime gross: <strong style={{ color: C.ink }}>K {fmt(data.totalGross)}</strong>
        </span>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = React.useRef(null);

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

  return (
    <div>
      <Row>
        <Field label="AP name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Theresia Bob" /></Field>
        <Field label="AP title"><input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Principal" /></Field>
      </Row>
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
        Each recipient gets <strong>their % of total gross</strong> from every approved pay run, automatically appended to the BSP batch file. Typical: Theresia 3%, Richard 2%.
      </p>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {fees == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> :
       !fees.length ? <Empty>No service fee recipients yet.</Empty> :
       (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Name</th>
              <th style={{ ...th, textAlign: "right" }}>% of gross</th>
              <th style={th}>Bank account</th>
              <th style={th}>Branch</th>
              <th style={th}>Active</th>
              <th style={{ ...th, width: 130 }}></th>
            </tr></thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}><strong>{f.name}</strong></td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.pct_of_gross}%</td>
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
  const [f, setF] = useState({ name: "", pct_of_gross: "", bank_code: "088",
    branch_code: "", account_no: "", account_name: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
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
        <Field label="Name *"><input style={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Theresia Bob" autoFocus /></Field>
        <Field label="% of gross *"><input style={input} type="number" step="0.1" value={f.pct_of_gross} onChange={(e) => set("pct_of_gross", e.target.value)} placeholder="e.g. 3" /></Field>
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
        <button onClick={save} disabled={!f.name || !f.pct_of_gross || submitting} style={btnPrimaryInline}>
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
                      {u.email !== me.email && me.clearance >= 3 && u.clearance < me.clearance && (
                        <button onClick={() => toggleActive(u)} style={btnGhostSmall}>
                          {u.is_active ? "Deactivate" : "Reactivate"}
                        </button>
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
    </div>
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
    first_name: "", last_name: "", email: "",
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

/* ─────────── Company Settings panel (edit + logo + signature) ─────────── */

function CompanySettingsPanel({ companyId, onSaved }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const j = await api(`/api/teebeepay/companies/${companyId}`);
      setC(j.company);
    } catch (e) { setError(e.message); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  function set(k, v) { setC((x) => ({ ...x, [k]: v })); }

  async function save() {
    setSaving(true); setError(""); setInfo("");
    try {
      await api(`/api/teebeepay/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: c.name, abbreviation: c.abbreviation, pay_interval: c.pay_interval,
          default_hours: c.default_hours, currency: c.currency,
          bank_code: c.bank_code, branch_code: c.branch_code,
          bank_account_no: c.bank_account_no, bank_account_name: c.bank_account_name,
          bank_client_no: c.bank_client_no,
          office_email: c.office_email, manager_email: c.manager_email,
          payslip_message: c.payslip_message,
          ncsl_employer_no: c.ncsl_employer_no, ncsl_date_of_reg: c.ncsl_date_of_reg,
          is_active: c.is_active !== false,
        }),
      });
      setInfo("Saved.");
      if (onSaved) onSaved();
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function uploadImage(kind, file, extra) {
    const r = new FileReader();
    return new Promise((resolve, reject) => {
      r.onload = async () => {
        try {
          await api(`/api/teebeepay/companies/${companyId}/${kind}`, {
            method: "POST", body: JSON.stringify({ image: r.result, ...(extra || {}) }),
          });
          await load(); resolve();
        } catch (e) { reject(e); }
      };
      r.onerror = () => reject(new Error("Failed to read file"));
      r.readAsDataURL(file);
    });
  }

  async function removeImage(kind) {
    if (!confirm(`Remove ${kind}?`)) return;
    try { await api(`/api/teebeepay/companies/${companyId}/${kind}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e.message); }
  }

  if (!c) return <Loader2 className="tbp-spin" size={20} color={C.red} />;
  return (
    <div>
      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}
      {info && <FlashBox type="info" icon={<CheckCircle2 size={16} />}>{info}</FlashBox>}

      <FieldGroup label="Identity">
        <Row>
          <Field label="Company name"><input style={input} value={c.name || ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Abbreviation"><input style={input} value={c.abbreviation || ""} onChange={(e) => set("abbreviation", e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="Pay interval">
            <select style={input} value={c.pay_interval || "fortnightly"} onChange={(e) => set("pay_interval", e.target.value)}>
              <option value="fortnightly">Fortnightly</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Default hours / period"><input style={input} type="number" step="0.5" value={c.default_hours || 80} onChange={(e) => set("default_hours", e.target.value)} /></Field>
          <Field label="Currency"><input style={input} value={c.currency || "PGK"} onChange={(e) => set("currency", e.target.value)} /></Field>
        </Row>
      </FieldGroup>

      <FieldGroup label="Company bank account (source of payroll funds)">
        <Row>
          <Field label="Bank code"><input style={input} value={c.bank_code || "088"} onChange={(e) => set("bank_code", e.target.value)} /></Field>
          <Field label="Branch"><input style={input} value={c.branch_code || ""} onChange={(e) => set("branch_code", e.target.value)} /></Field>
        </Row>
        <Field label="Account number"><input style={input} value={c.bank_account_no || ""} onChange={(e) => set("bank_account_no", e.target.value)} /></Field>
        <Field label="Account name"><input style={input} value={c.bank_account_name || ""} onChange={(e) => set("bank_account_name", e.target.value)} /></Field>
        <Field label="BSP client number"><input style={input} value={c.bank_client_no || ""} onChange={(e) => set("bank_client_no", e.target.value)} /></Field>
      </FieldGroup>

      <FieldGroup label="Office, manager, NASFund">
        <Row>
          <Field label="Office email"><input style={input} type="email" value={c.office_email || ""} onChange={(e) => set("office_email", e.target.value)} /></Field>
          <Field label="Manager email"><input style={input} type="email" value={c.manager_email || ""} onChange={(e) => set("manager_email", e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="NCSL employer number"><input style={input} value={c.ncsl_employer_no || ""} onChange={(e) => set("ncsl_employer_no", e.target.value)} /></Field>
          <Field label="NCSL date of registration"><input style={input} type="date" value={c.ncsl_date_of_reg || ""} onChange={(e) => set("ncsl_date_of_reg", e.target.value)} /></Field>
        </Row>
        <Field label="Default pay-slip message"><textarea style={{ ...input, minHeight: 70 }} value={c.payslip_message || ""} onChange={(e) => set("payslip_message", e.target.value)} /></Field>
      </FieldGroup>

      <FieldGroup label="Company logo (appears on pay-stub emails)">
        {c.logo_image ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={`data:${c.logo_mime || "image/png"};base64,${c.logo_image}`}
              alt="logo" style={{ maxHeight: 60, maxWidth: 200, border: "1px solid #e5e7eb", borderRadius: 6, padding: 6, background: "#fff" }} />
            <button onClick={() => removeImage("logo")} style={{ ...btnGhostLg, color: "#991b1b", borderColor: "#fecaca" }}>
              <Trash2 size={14} style={{ marginRight: 6 }} /> Remove
            </button>
          </div>
        ) : (
          <input type="file" accept="image/png,image/jpeg,image/svg+xml"
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              try { await uploadImage("logo", f); } catch (e) { setError(e.message); }
            }}
            style={{ fontSize: 13 }} />
        )}
        <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>PNG, JPEG or SVG · max 300 KB</p>
      </FieldGroup>

      <FieldGroup label="Authorised Person signature (embedded in NASFund returns)">
        <Row>
          <Field label="AP name">
            <input style={input} value={c.ap_signature_name || ""} onChange={(e) => set("ap_signature_name", e.target.value)} placeholder="e.g. Theresia Bob" />
          </Field>
          <Field label="AP title">
            <input style={input} value={c.ap_signature_title || ""} onChange={(e) => set("ap_signature_title", e.target.value)} placeholder="e.g. Principal" />
          </Field>
        </Row>
        {c.ap_signature_image ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
            <img src={`data:${c.ap_signature_mime || "image/png"};base64,${c.ap_signature_image}`}
              alt="signature" style={{ maxHeight: 70, maxWidth: 220, border: "1px solid #e5e7eb", borderRadius: 6, padding: 6, background: "#fff" }} />
            <button onClick={() => removeImage("signature")} style={{ ...btnGhostLg, color: "#991b1b", borderColor: "#fecaca" }}>
              <Trash2 size={14} style={{ marginRight: 6 }} /> Remove
            </button>
          </div>
        ) : (
          <input type="file" accept="image/png,image/jpeg"
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              try { await uploadImage("signature", f, { name: c.ap_signature_name || "", title: c.ap_signature_title || "" }); }
              catch (e) { setError(e.message); }
            }}
            style={{ fontSize: 13 }} />
        )}
        <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>PNG or JPEG · max 500 KB · embedded in NASFund XLSX downloads</p>
      </FieldGroup>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={save} disabled={saving} style={btnPrimaryInline}>
          {saving ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</> : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/* ─────────── Service Fees admin ─────────── */

function ServiceFeesPage({ me, onBack }) {
  const [fees, setFees] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try { setFees((await api("/api/teebeepay/service-fees")).fees || []); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(f) {
    try { await api(`/api/teebeepay/service-fees/${f.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !f.is_active }) }); load(); }
    catch (e) { setError(e.message); }
  }
  async function remove(f) {
    if (!confirm(`Remove the ${f.name} service-fee recipient?`)) return;
    try { await api(`/api/teebeepay/service-fees/${f.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      <button onClick={onBack} style={btnBack}><ArrowLeft size={14} /> Dashboard</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Service fees</h1>
        <button onClick={() => setShowAdd(true)} style={btnPrimaryInline}><Plus size={16} /> Add recipient</button>
      </div>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
        Each active recipient gets their % of the <strong>total gross</strong> on every approved payroll —
        across every client company. The amount is added to the BSP batch alongside employee net pay.
      </p>

      {error && <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>}

      {fees == null ? <Loader2 className="tbp-spin" size={20} color={C.red} /> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Recipient</th>
              <th style={{ ...th, textAlign: "right" }}>%</th>
              <th style={th}>Account</th>
              <th style={th}>Active</th>
              <th style={{ ...th, width: 140 }}></th>
            </tr></thead>
            <tbody>
              {fees.length === 0 ? (
                <tr><td colSpan={5} style={{ ...td, color: C.muted, textAlign: "center", padding: 30 }}>
                  No service-fee recipients yet. Add one with the button above.
                </td></tr>
              ) : fees.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{f.name}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{f.pct_of_gross}%</td>
                  <td style={{ ...td, color: C.muted, fontSize: 13 }}>
                    {f.account_name || "—"} {f.account_no ? `· ${f.account_no}` : ""}
                    {f.branch_code ? ` · branch ${f.branch_code}` : ""}
                  </td>
                  <td style={td}><CheckCircle2 size={16} color={f.is_active ? "#16a34a" : "#94a3b8"} /></td>
                  <td style={{ ...td, display: "flex", gap: 6 }}>
                    <button onClick={() => toggle(f)} style={btnGhostSmall}>{f.is_active ? "Pause" : "Resume"}</button>
                    <button onClick={() => remove(f)} style={{ ...btnGhostSmall, color: "#991b1b" }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <ServiceFeeDialog onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function ServiceFeeDialog({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", pct_of_gross: "", account_name: "", account_no: "", branch_code: "", bank_code: "088", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
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
        <Field label="Name *"><input style={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Theresia" autoFocus /></Field>
        <Field label="% of total gross *"><input style={input} type="number" step="0.1" value={f.pct_of_gross} onChange={(e) => set("pct_of_gross", e.target.value)} placeholder="3.0" /></Field>
      </Row>
      <Field label="Account name"><input style={input} value={f.account_name} onChange={(e) => set("account_name", e.target.value)} /></Field>
      <Row>
        <Field label="Bank"><input style={input} value={f.bank_code} onChange={(e) => set("bank_code", e.target.value)} /></Field>
        <Field label="Branch"><input style={input} value={f.branch_code} onChange={(e) => set("branch_code", e.target.value)} /></Field>
        <Field label="Account #"><input style={input} value={f.account_no} onChange={(e) => set("account_no", e.target.value)} /></Field>
      </Row>
      <Field label="Notes (private)"><input style={input} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={btnGhostLg}>Cancel</button>
        <button onClick={save} disabled={!f.name || !f.pct_of_gross || submitting} style={btnPrimaryInline}>
          {submitting ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Saving…</> : "Add recipient"}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────── Reports panel ─────────── */

function ReportsPanel({ companyId }) {
  const [period, setPeriod] = useState("monthly");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError(""); setData(null);
    try { setData(await api(`/api/teebeepay/companies/${companyId}/reports?period=${period}`)); }
    catch (e) { setError(e.message); }
  }, [companyId, period]);
  useEffect(() => { load(); }, [load]);

  if (error) return <FlashBox type="error" icon={<AlertCircle size={16} />}>{error}</FlashBox>;
  if (!data) return <Loader2 className="tbp-spin" size={20} color={C.red} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Bucket:</span>
        <button onClick={() => setPeriod("monthly")} style={period === "monthly" ? btnPrimaryInline : btnGhostLg}>Monthly</button>
        <button onClick={() => setPeriod("weekly")} style={period === "weekly" ? btnPrimaryInline : btnGhostLg}>Weekly</button>
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.muted }}>
          Lifetime gross K{data.totalGross.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "16px 0 10px" }}>By {period === "weekly" ? "week" : "month"}</h2>
      {!data.summary.length ? <Empty>No data yet.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 26 }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Bucket</th>
              <th style={{ ...th, textAlign: "right" }}>Employees</th>
              <th style={{ ...th, textAlign: "right" }}>Gross</th>
              <th style={{ ...th, textAlign: "right" }}>Tax</th>
              <th style={{ ...th, textAlign: "right" }}>Nasfund</th>
              <th style={{ ...th, textAlign: "right" }}>Other</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
            </tr></thead>
            <tbody>
              {data.summary.map((b) => (
                <tr key={b.bucket} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{b.bucket}</td>
                  <td style={{ ...td, textAlign: "right" }}>{b.n_emp}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(b.gross || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(b.tax || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(b.nasfund || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(b.other || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{(b.net || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "16px 0 10px" }}>By department (all-time)</h2>
      {!data.byDept.length ? <Empty>No data.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 26 }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Department</th>
              <th style={{ ...th, textAlign: "right" }}>Entries</th>
              <th style={{ ...th, textAlign: "right" }}>Gross</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
            </tr></thead>
            <tbody>
              {data.byDept.map((d) => (
                <tr key={d.dept || "_"} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{d.dept || <span style={{ color: C.muted }}>(none)</span>}</td>
                  <td style={{ ...td, textAlign: "right" }}>{d.n}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(d.gross || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(d.net || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "16px 0 10px" }}>Top 25 employees by lifetime gross</h2>
      {!data.byEmployee.length ? <Empty>No data.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 26 }}>
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>Employee</th>
              <th style={{ ...th, textAlign: "right" }}>Periods</th>
              <th style={{ ...th, textAlign: "right" }}>Gross</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
            </tr></thead>
            <tbody>
              {data.byEmployee.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{e.name}</td>
                  <td style={{ ...td, textAlign: "right" }}>{e.n}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(e.gross || 0).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(e.net || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.shares.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "16px 0 10px" }}>Payroll-share earners</h2>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={th}>Name</th><th style={{ ...th, textAlign: "right" }}>%</th>
                <th style={{ ...th, textAlign: "right" }}>Estimated lifetime</th>
              </tr></thead>
              <tbody>
                {data.shares.map((s, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={td}>{s.name}</td>
                    <td style={{ ...td, textAlign: "right" }}>{s.pct}%</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{s.lifetime.toFixed(2)}</td>
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

/* ─────────── Employee profile ─────────── */

function EmployeeProfile({ me, employeeId, onBack, onOpenPeriod }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try { setData(await api(`/api/teebeepay/employees/${employeeId}`)); }
      catch (e) { setError(e.message); }
    })();
  }, [employeeId]);

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
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Payroll history</h2>
      {!history.length ? <Empty>No pay periods yet for this employee.</Empty> : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead><tr>
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
                <tr key={h.entry_id} style={{ borderTop: "1px solid #f1f5f9" }}>
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
